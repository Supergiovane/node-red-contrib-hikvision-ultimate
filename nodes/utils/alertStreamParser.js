"use strict";

function createAlertStreamParser(options = {}) {
    const callback = name => typeof options[name] === "function" ? options[name] : () => {};
    const onXml = callback("onXml");
    const onJson = callback("onJson");
    const onImage = callback("onImage");
    const onUnsupported = callback("onUnsupported");
    const onError = callback("onError");
    const onActivity = callback("onActivity");
    const positiveLimit = (value, fallback) => Number.isSafeInteger(value) && value > 0 ? value : fallback;
    const maxPart = positiveLimit(options.maxMultipartBufferBytes, 8 * 1024 * 1024);
    // Keep the old option name for callers; use bytes so split UTF-8 stays intact.
    const maxXml = positiveLimit(options.maxXmlScanBufferChars, 512 * 1024);
    const maxHeader = Math.min(maxPart, 64 * 1024);
    const boundary = Buffer.from("--" + (options.boundary || "boundary"));
    const xmlStart = Buffer.from("<EventNotificationAlert");
    let buffer = Buffer.alloc(0);
    let mode = options.scanRawXml === false ? "multipart" : "auto";
    let phase = "boundary";
    let failed = false;
    let ended = false;
    let flushing = false;
    let headers;
    let extension;
    let contentLength;
    let xml;
    let json;
    let boundaryOffset = 0;

    function fail(error) {
        if (failed) return;
        failed = true;
        buffer = Buffer.alloc(0);
        // A terminal framing error is reported once; the connection owner reconnects.
        onError(error instanceof Error ? error : new Error(error));
    }
    function consume(length) {
        buffer = buffer.subarray(length);
        boundaryOffset = 0;
    }
    function boundaryAt(index) {
        if (index !== 0 && buffer[index - 1] !== 10) return null;
        let cursor = index + boundary.length;
        if (cursor >= buffer.length) return null;
        let closing = false;
        if (buffer[cursor] === 45) {
            if (cursor + 1 >= buffer.length || buffer[cursor + 1] !== 45) return null;
            closing = true;
            cursor += 2;
        }
        while (buffer[cursor] === 32 || buffer[cursor] === 9) cursor++;
        if (closing && cursor === buffer.length && flushing) return { index, end: cursor, closing };
        if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) return { index, end: cursor + 2, closing };
        if (buffer[cursor] === 10) return { index, end: cursor + 1, closing };
        return null;
    }
    function findBoundary(from = 0) {
        let index = buffer.indexOf(boundary, from);
        let pending = null;
        while (index !== -1) {
            const match = boundaryAt(index);
            if (match) return match;
            if ((index === 0 || buffer[index - 1] === 10) && pending === null) {
                const suffix = buffer.subarray(index + boundary.length).toString("latin1");
                if (/^(?:--)?[ \t]*\r?$/.test(suffix) || suffix === "-") pending = index;
            }
            index = buffer.indexOf(boundary, index + 1);
        }
        // Preserve a partial delimiter even when optional trailing whitespace spans chunks.
        boundaryOffset = pending === null ? Math.max(0, buffer.length - boundary.length - 1) : pending;
        return null;
    }
    function findXmlStart() {
        let index = buffer.indexOf(xmlStart);
        while (index !== -1) {
            const next = buffer[index + xmlStart.length];
            if (next === 62 || next === 47 || next === 32 || next === 9 || next === 10 || next === 13) return index;
            index = buffer.indexOf(xmlStart, index + 1);
        }
        return -1;
    }
    function kind(contentType) {
        const mime = (contentType || "").split(";")[0].trim().toLowerCase();
        if (mime === "application/xml" || mime === "text/xml") return "xml";
        if (mime === "application/json" || mime === "text/json") return "json";
        if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
        if (mime === "image/png") return "png";
        return "bin";
    }
    function dispatch(body) {
        // Copy before handing buffers to clients; retaining an event cannot retain a large batch.
        if (extension === "xml") onXml(Buffer.from(body));
        else if (extension === "json") onJson(Buffer.from(body));
        else if (extension === "jpg" || extension === "png") onImage(Buffer.from(body), extension);
        else onUnsupported(headers["content-type"] || "unknown");
    }
    function parseHeaders(text) {
        const result = Object.create(null);
        if (!text) return result;
        for (const line of text.split(/\r?\n/)) {
            const match = /^([^\s:]+)\s*:\s*(.*)$/.exec(line);
            if (!match) throw new Error("Malformed alert stream part header");
            const name = match[1].toLowerCase();
            if (Object.prototype.hasOwnProperty.call(result, name)) throw new Error("Duplicate alert stream part header: " + name);
            result[name] = match[2].trim();
        }
        return result;
    }
    function newXmlScanner() { return { cursor: 0, names: [], started: false }; }
    function completeXml(scanner) {
        while (scanner.cursor < buffer.length) {
            const start = buffer.indexOf(60, scanner.cursor);
            if (start === -1) { scanner.cursor = buffer.length; return null; }
            if (start + 1 >= buffer.length) { scanner.cursor = start; return null; }
            const tail = buffer.subarray(start);
            let terminator;
            if (tail.subarray(0, 4).toString("ascii") === "<!--") terminator = "-->";
            else if (tail.subarray(0, 9).toString("ascii") === "<![CDATA[") terminator = "]]>";
            else if (buffer[start + 1] === 63) terminator = "?>";
            else if (buffer[start + 1] === 33) {
                if (tail.length < 9) { scanner.cursor = start; return null; }
                throw new Error("Unsupported XML declaration in alert stream");
            }
            if (terminator) {
                const end = buffer.indexOf(terminator, start + 2);
                if (end === -1) { scanner.cursor = start; return null; }
                scanner.cursor = end + terminator.length;
                continue;
            }
            let quote = 0;
            let end = start + 1;
            for (; end < buffer.length; end++) {
                const byte = buffer[end];
                if (quote) { if (byte === quote) quote = 0; }
                else if (byte === 34 || byte === 39) quote = byte;
                else if (byte === 62) break;
            }
            if (end === buffer.length) { scanner.cursor = start; return null; }
            const tag = buffer.subarray(start + 1, end).toString("utf8");
            const match = /^(\/?)\s*([A-Za-z_][\w:.-]*)(?:\s|\/|$)/.exec(tag);
            if (!match) throw new Error("Malformed XML tag in alert stream");
            if (match[1]) {
                if (scanner.names.pop() !== match[2]) throw new Error("Mismatched XML tag in alert stream");
            } else {
                scanner.started = true;
                if (!/\/\s*$/.test(tag)) scanner.names.push(match[2]);
                if (scanner.names.length > 1024) throw new Error("Alert XML nesting limit exceeded");
            }
            scanner.cursor = end + 1;
            if (scanner.started && scanner.names.length === 0) return scanner.cursor;
        }
        return null;
    }
    function completeJson(scanner) {
        for (; scanner.cursor < buffer.length; scanner.cursor++) {
            const byte = buffer[scanner.cursor];
            if (!scanner.started) {
                if (byte === 32 || byte === 9 || byte === 10 || byte === 13) continue;
                if (byte !== 123 && byte !== 91) { scanner.scalar = true; return null; }
                scanner.started = true;
            }
            if (scanner.quoted) {
                if (scanner.escaped) scanner.escaped = false;
                else if (byte === 92) scanner.escaped = true;
                else if (byte === 34) scanner.quoted = false;
            } else if (byte === 34) scanner.quoted = true;
            else if (byte === 123 || byte === 91) scanner.stack.push(byte);
            else if (byte === 125 || byte === 93) {
                if (scanner.stack.pop() !== (byte === 125 ? 123 : 91)) throw new Error("Mismatched JSON bracket in alert stream");
                if (!scanner.stack.length) return scanner.cursor + 1;
            }
        }
        return null;
    }
    function pendingLimit() {
        if (mode === "raw") return maxXml;
        if (mode === "multipart" && phase === "body") return extension === "xml" ? Math.min(maxXml, maxPart) : maxPart;
        return maxHeader;
    }
    function checkSize(length, limit) {
        if (length > limit) throw new Error("Alert stream " + (extension || mode) + " buffer limit exceeded");
    }
    function process() {
        while (!failed && !ended) {
            if (mode === "auto") {
                const multipart = findBoundary();
                const raw = findXmlStart();
                if (multipart && (raw === -1 || multipart.index < raw)) mode = "multipart";
                else if (raw !== -1) { consume(raw); mode = "raw"; }
                else return;
            }
            if (mode === "raw") {
                if (!xml) {
                    const start = findXmlStart();
                    if (start === -1) return;
                    if (!/^\s*(?:<\?xml[\s\S]*?\?>\s*)?$/.test(buffer.subarray(0, start).toString("utf8"))) throw new Error("Unexpected data between alert XML documents");
                    consume(start);
                    xml = newXmlScanner();
                }
                const end = completeXml(xml);
                if (end === null) return;
                checkSize(end, maxXml);
                onXml(Buffer.from(buffer.subarray(0, end)));
                consume(end);
                xml = null;
                continue;
            }
            if (phase === "boundary") {
                const match = findBoundary();
                if (!match) return;
                consume(match.end);
                if (match.closing) { ended = true; buffer = Buffer.alloc(0); return; }
                phase = "headers";
            } else if (phase === "headers") {
                let end = buffer.indexOf("\r\n\r\n");
                let delimiter = 4;
                const lf = buffer.indexOf("\n\n");
                if (lf !== -1 && (end === -1 || lf < end)) { end = lf; delimiter = 2; }
                if (buffer[0] === 10) { end = 0; delimiter = 1; }
                else if (buffer[0] === 13 && buffer[1] === 10) { end = 0; delimiter = 2; }
                if (end === -1) return;
                checkSize(end + delimiter, maxHeader);
                headers = parseHeaders(buffer.subarray(0, end).toString("latin1"));
                extension = kind(headers["content-type"]);
                contentLength = null;
                if (headers["content-length"] !== undefined) {
                    if (!/^\d+$/.test(headers["content-length"])) throw new Error("Invalid alert stream Content-Length");
                    contentLength = Number(headers["content-length"]);
                    if (!Number.isSafeInteger(contentLength)) throw new Error("Invalid alert stream Content-Length");
                    checkSize(contentLength, extension === "xml" ? Math.min(maxPart, maxXml) : maxPart);
                }
                consume(end + delimiter);
                xml = extension === "xml" ? newXmlScanner() : null;
                json = extension === "json" ? { cursor: 0, stack: [], started: false, quoted: false, escaped: false, scalar: false } : null;
                phase = "body";
            } else if (phase === "body") {
                // A declared length takes precedence over boundary-like bytes in images or text.
                if (contentLength !== null) {
                    if (buffer.length < contentLength) return;
                    dispatch(buffer.subarray(0, contentLength));
                    consume(contentLength);
                    phase = "afterBody";
                    continue;
                }
                const complete = xml ? completeXml(xml) : json && !json.scalar ? completeJson(json) : null;
                const match = findBoundary(boundaryOffset);
                if (complete !== null && (!match || complete <= match.index)) {
                    checkSize(complete, pendingLimit());
                    dispatch(buffer.subarray(0, complete));
                    consume(complete);
                    // This document has already been emitted, even if its boundary arrives much later.
                    phase = "afterBody";
                    continue;
                }
                if (!match) return;
                if (xml || (json && !json.scalar)) throw new Error("Truncated alert stream document before boundary");
                let end = match.index;
                if (end && buffer[end - 1] === 10) end--;
                if (end && buffer[end - 1] === 13) end--;
                checkSize(end, pendingLimit());
                dispatch(buffer.subarray(0, end));
                consume(match.index);
                phase = "boundary";
            } else if (phase === "afterBody") {
                let offset = 0;
                while ([9, 10, 13, 32].includes(buffer[offset])) offset++;
                consume(offset);
                if (!buffer.length) return;
                // Some firmware sends consecutive alert XML documents inside one MIME part.
                // Only XML without Content-Length may continue; declared lengths stay authoritative.
                if (extension === "xml" && contentLength === null && buffer[0] === 60) {
                    xml = newXmlScanner();
                    phase = "body";
                    continue;
                }
                const length = Math.min(buffer.length, boundary.length);
                if (!buffer.subarray(0, length).equals(boundary.subarray(0, length))) throw new Error("Expected multipart boundary after alert body");
                if (buffer.length < boundary.length) return;
                const match = boundaryAt(0);
                if (!match) {
                    const suffix = buffer.subarray(boundary.length).toString("latin1");
                    if (!/^(?:--)?[ \t]*\r?$/.test(suffix) && suffix !== "-") throw new Error("Malformed multipart boundary");
                    return;
                }
                phase = "boundary";
            }
        }
    }
    return {
        feed(chunk) {
            if (failed || ended) return;
            try {
                if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
                if (!chunk.length) return;
                onActivity();
                // Process a large coalesced TCP batch incrementally: the limit applies to an
                // incomplete frame, never to a batch containing many small valid events.
                let offset = 0;
                while (offset < chunk.length && !failed && !ended) {
                    const count = Math.min(chunk.length - offset, 64 * 1024, pendingLimit() + 1 - buffer.length);
                    if (count <= 0) throw new Error("Alert stream buffer limit exceeded");
                    buffer = Buffer.concat([buffer, chunk.subarray(offset, offset + count)]);
                    offset += count;
                    process();
                    if (!failed && !ended) checkSize(buffer.length, pendingLimit());
                }
            } catch (error) { fail(error); }
        },
        flush() {
            if (failed || ended) return;
            try {
                flushing = true;
                process();
                if (ended || failed) return;
                if (mode === "raw" && !xml && /^\s*$/.test(buffer.toString("utf8"))) { ended = true; buffer = Buffer.alloc(0); return; }
                if (mode === "auto" && !buffer.length) { ended = true; return; }
                throw new Error("Truncated alert stream");
            } catch (error) { fail(error); }
        }
    };
}

module.exports = { createAlertStreamParser };
