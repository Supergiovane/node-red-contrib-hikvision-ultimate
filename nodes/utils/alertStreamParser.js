function createAlertStreamParser(options) {
    const boundary = options.boundary || "boundary";
    const onXml = typeof options.onXml === "function" ? options.onXml : () => { };
    const onJson = typeof options.onJson === "function" ? options.onJson : () => { };
    const onImage = typeof options.onImage === "function" ? options.onImage : () => { };
    const onUnsupported = typeof options.onUnsupported === "function" ? options.onUnsupported : () => { };
    const onError = typeof options.onError === "function" ? options.onError : () => { };
    const onActivity = typeof options.onActivity === "function" ? options.onActivity : () => { };
    const scanRawXml = options.scanRawXml !== false;
    const maxMultipartBufferBytes = options.maxMultipartBufferBytes || (8 * 1024 * 1024);
    const maxXmlScanBufferChars = options.maxXmlScanBufferChars || (512 * 1024);
    const boundaryToken = Buffer.from("--" + boundary);
    const xmlStartTag = "<EventNotificationAlert";
    const xmlEndTag = "</EventNotificationAlert>";
    let multipartBuffer = Buffer.alloc(0);
    let xmlScanBuffer = "";
    let xmlScanTail = "";

    function normalizeHeaderName(name) {
        return name.toString().trim().toLowerCase();
    }

    function parsePartHeaders(headerText) {
        const headers = {};
        headerText.split(/\r?\n/).forEach((line) => {
            const separatorIndex = line.indexOf(":");
            if (separatorIndex === -1) return;
            const key = normalizeHeaderName(line.slice(0, separatorIndex));
            const value = line.slice(separatorIndex + 1).trim();
            if (key) headers[key] = value;
        });
        return headers;
    }

    function getExtensionFromContentType(contentType) {
        const normalizedContentType = (contentType || "").toString().toLowerCase();
        if (normalizedContentType.includes("application/xml") || normalizedContentType.includes("text/xml")) return "xml";
        if (normalizedContentType.includes("application/json") || normalizedContentType.includes("text/json")) return "json";
        if (normalizedContentType.includes("image/jpeg") || normalizedContentType.includes("image/jpg")) return "jpg";
        if (normalizedContentType.includes("image/png")) return "png";
        return "bin";
    }

    function trimPartBody(body) {
        if (body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10) return body.slice(0, -2);
        if (body.length >= 1 && body[body.length - 1] === 10) return body.slice(0, -1);
        return body;
    }

    function feedXmlScanner(chunk) {
        const chunkText = xmlScanTail + chunk.toString("utf8");
        xmlScanTail = "";
        if (!xmlScanBuffer && !chunkText.includes(xmlStartTag) && !chunkText.includes(xmlEndTag)) {
            xmlScanTail = chunkText.slice(-(xmlStartTag.length - 1));
            return;
        }

        xmlScanBuffer += chunkText;
        if (xmlScanBuffer.length > maxXmlScanBufferChars) {
            const lastStart = xmlScanBuffer.lastIndexOf(xmlStartTag);
            if (lastStart > -1) {
                xmlScanBuffer = xmlScanBuffer.slice(lastStart);
            } else {
                xmlScanBuffer = xmlScanBuffer.slice(-maxXmlScanBufferChars);
            }
        }

        while (xmlScanBuffer.length > 0) {
            const startIndex = xmlScanBuffer.indexOf(xmlStartTag);
            if (startIndex === -1) {
                xmlScanTail = xmlScanBuffer.slice(-(xmlStartTag.length - 1));
                xmlScanBuffer = "";
                return;
            }
            if (startIndex > 0) xmlScanBuffer = xmlScanBuffer.slice(startIndex);

            const endIndex = xmlScanBuffer.indexOf(xmlEndTag);
            if (endIndex === -1) return;

            const endTagLength = xmlEndTag.length;
            const xml = xmlScanBuffer.slice(0, endIndex + endTagLength);
            xmlScanBuffer = xmlScanBuffer.slice(endIndex + endTagLength);
            onXml(Buffer.from(xml, "utf8"));
        }
    }

    function dispatchPart(headers, body) {
        const extension = getExtensionFromContentType(headers["content-type"]);
        if (extension === "xml") {
            onXml(body);
        } else if (extension === "json") {
            onJson(body);
        } else if (extension === "jpg" || extension === "png") {
            onImage(body, extension);
        } else {
            onUnsupported(headers["content-type"] || "unknown");
        }
    }

    function findHeaderEnd(buffer) {
        const crlfEnd = buffer.indexOf(Buffer.from("\r\n\r\n"));
        if (crlfEnd !== -1) return { index: crlfEnd, length: 4 };
        const lfEnd = buffer.indexOf(Buffer.from("\n\n"));
        if (lfEnd !== -1) return { index: lfEnd, length: 2 };
        return null;
    }

    function processMultipartBuffer() {
        while (multipartBuffer.length > 0) {
            let boundaryIndex = multipartBuffer.indexOf(boundaryToken);
            if (boundaryIndex === -1) {
                if (multipartBuffer.length > maxMultipartBufferBytes) {
                    multipartBuffer = multipartBuffer.slice(-boundaryToken.length);
                    onUnsupported("buffer-trimmed-boundary");
                }
                return;
            }

            if (boundaryIndex > 0) multipartBuffer = multipartBuffer.slice(boundaryIndex);

            const afterBoundaryIndex = boundaryToken.length;
            if (multipartBuffer.length < afterBoundaryIndex + 2) return;
            if (multipartBuffer.slice(afterBoundaryIndex, afterBoundaryIndex + 2).toString() === "--") {
                multipartBuffer = Buffer.alloc(0);
                return;
            }

            let headerStart = afterBoundaryIndex;
            if (multipartBuffer[headerStart] === 13 && multipartBuffer[headerStart + 1] === 10) {
                headerStart += 2;
            } else if (multipartBuffer[headerStart] === 10) {
                headerStart += 1;
            } else {
                multipartBuffer = multipartBuffer.slice(afterBoundaryIndex);
                continue;
            }

            const headerSearchBuffer = multipartBuffer.slice(headerStart);
            const headerEnd = findHeaderEnd(headerSearchBuffer);
            if (!headerEnd) {
                if (multipartBuffer.length > maxMultipartBufferBytes) {
                    multipartBuffer = multipartBuffer.slice(-boundaryToken.length);
                    onUnsupported("buffer-trimmed-headers");
                }
                return;
            }

            const headerText = headerSearchBuffer.slice(0, headerEnd.index).toString("latin1");
            const bodyStart = headerStart + headerEnd.index + headerEnd.length;
            const nextBoundaryIndex = multipartBuffer.indexOf(boundaryToken, bodyStart);
            if (nextBoundaryIndex === -1) {
                if (multipartBuffer.length > maxMultipartBufferBytes) {
                    multipartBuffer = multipartBuffer.slice(-maxMultipartBufferBytes);
                    onUnsupported("buffer-trimmed-body");
                }
                return;
            }

            const headers = parsePartHeaders(headerText);
            const body = trimPartBody(multipartBuffer.slice(bodyStart, nextBoundaryIndex));
            try {
                dispatchPart(headers, body);
            } catch (error) {
                onError(error);
            }
            multipartBuffer = multipartBuffer.slice(nextBoundaryIndex);
        }
    }

    return {
        feed(chunk) {
            try {
                onActivity();
                if (scanRawXml) feedXmlScanner(chunk);
                multipartBuffer = Buffer.concat([multipartBuffer, chunk]);
                processMultipartBuffer();
            } catch (error) {
                onError(error);
            }
        },
        flush() {
            if (scanRawXml && xmlScanBuffer.length > 0) feedXmlScanner(Buffer.alloc(0));
        }
    };
}

module.exports = { createAlertStreamParser };
