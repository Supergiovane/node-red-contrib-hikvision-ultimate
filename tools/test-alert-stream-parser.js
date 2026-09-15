"use strict";
/* Run with node tools/test-alert-stream-parser.js. No camera or external service. */
const assert = require("node:assert/strict");
const { createAlertStreamParser } = require("../nodes/utils/alertStreamParser");
const boundary = "hik-test-boundary";
const xml = Buffer.from('<EventNotificationAlert><eventType>vmd</eventType><eventDescription>Porta già aperta — 日本語 🔔</eventDescription></EventNotificationAlert>');
const json = Buffer.from(JSON.stringify({ eventType: "vmd", description: 'A quoted "bracket }" and slash \\', data: [{ value: "日本語" }] }));
function harness(options = {}) {
    const received = { xml: [], json: [], images: [], unsupported: [], errors: [], activities: 0 };
    const parser = createAlertStreamParser({
        boundary,
        onXml: bytes => received.xml.push(bytes),
        onJson: bytes => received.json.push(bytes),
        onImage: (bytes, extension) => received.images.push({ bytes, extension }),
        onUnsupported: type => received.unsupported.push(type),
        onError: error => received.errors.push(error),
        onActivity: () => received.activities++, ...options
    });
    return { parser, received };
}
function part(type, body, length = true, newline = "\r\n") {
    return Buffer.concat([
        Buffer.from("--" + boundary + newline + "Content-Type: " + type + newline +
            (length ? "Content-Length: " + body.length + newline : "") + newline), body, Buffer.from(newline)
    ]);
}
function ending(newline = "\r\n") { return Buffer.from("--" + boundary + "--" + newline); }
function feedOneByte(parser, bytes) { for (const byte of bytes) parser.feed(Buffer.from([byte])); }

// Every split position, including all UTF-8 boundaries, headers, length and delimiter bytes.
for (const length of [false, true]) {
    for (const newline of ["\r\n", "\n"]) {
        const wire = Buffer.concat([part("application/xml; charset=UTF-8", xml, length, newline), part("application/json", json, length, newline), ending(newline)]);
        for (let split = 0; split <= wire.length; split++) {
            const { parser, received } = harness();
            parser.feed(wire.subarray(0, split));
            parser.feed(wire.subarray(split));
            parser.flush();
            assert.deepEqual(received.errors, [], "Unexpected error at split " + split);
            assert.deepEqual(received.xml, [xml], "XML duplicated/corrupted at split " + split);
            assert.deepEqual(received.json, [json], "JSON duplicated/corrupted at split " + split);
        }
        const { parser, received } = harness();
        feedOneByte(parser, wire);
        parser.flush();
        assert.deepEqual(received.errors, []);
        assert.deepEqual(received.xml, [xml]);
        assert.deepEqual(received.json, [json]);
    }
}

// An alarm is dispatched on the final body byte, without waiting for another event/boundary.
for (const [type, body, key] of [["application/xml", xml, "xml"], ["application/json", json, "json"]]) {
    for (const length of [true, false]) {
        const { parser, received } = harness();
        const wire = part(type, body, length).subarray(0, -2);
        parser.feed(wire.subarray(0, -1));
        assert.equal(received[key].length, 0);
        parser.feed(wire.subarray(-1));
        assert.deepEqual(received[key], [body]);
        parser.feed(Buffer.concat([Buffer.from("\r\n"), ending()]));
        parser.flush();
        assert.deepEqual(received[key], [body], "Boundary must not redispatch an already emitted document");
        assert.deepEqual(received.errors, []);
    }
}

// Some firmware batches multiple alert documents in a single part without Content-Length.
// Emit every complete document immediately, preserving text/CDATA and never redispatching at the boundary.
{
    const second = Buffer.from('<EventNotificationAlert><text>second \u00e8 <![CDATA[<EventNotificationAlert>literal</EventNotificationAlert>]]></text></EventNotificationAlert>');
    const body = Buffer.concat([xml, second]);
    const wire = Buffer.concat([part("application/xml", body, false), ending()]);
    for (let split = 0; split <= wire.length; split++) {
        const { parser, received } = harness();
        parser.feed(wire.subarray(0, split)); parser.feed(wire.subarray(split)); parser.flush();
        assert.deepEqual(received.errors, [], "Concatenated XML failed at split " + split);
        assert.deepEqual(received.xml, [xml, second]);
    }
    const { parser, received } = harness();
    feedOneByte(parser, part("application/xml", xml, false).subarray(0, -2));
    assert.deepEqual(received.xml, [xml]);
    feedOneByte(parser, second);
    assert.deepEqual(received.xml, [xml, second], "Second alert must arrive before the next MIME boundary");
    parser.feed(Buffer.concat([Buffer.from("\r\n"), ending()])); parser.flush();
    assert.deepEqual(received.errors, []);
    assert.deepEqual(received.xml, [xml, second]);

    const tiny = Buffer.from("<EventNotificationAlert><x/></EventNotificationAlert>");
    const bounded = harness({ maxXmlScanBufferChars: 128, maxMultipartBufferBytes: 256 });
    bounded.parser.feed(Buffer.concat([part("application/xml", Buffer.concat(Array.from({ length: 100 }, () => tiny)), false), ending()]));
    bounded.parser.flush();
    assert.deepEqual(bounded.received.errors, []);
    assert.equal(bounded.received.xml.length, 100, "The size limit applies to each event, not all XML documents in a part");

    const oversized = harness({ maxXmlScanBufferChars: 128, maxMultipartBufferBytes: 256 });
    oversized.parser.feed(part("application/xml", Buffer.concat([tiny, Buffer.from("<EventNotificationAlert>" + "x".repeat(200))]), false));
    assert.deepEqual(oversized.received.xml, [tiny]);
    assert.equal(oversized.received.errors.length, 1);
    assert.match(oversized.received.errors[0].message, /limit/i);
}

// Content-Length is authoritative, even with valid-looking MIME boundaries/XML inside JPEGs.
{
    const image = Buffer.concat([Buffer.from([255, 216, 0, 128, 255]), Buffer.from("\r\n--" + boundary + "\r\nContent-Type: application/xml\r\n\r\n"), xml, Buffer.from([0, 255, 217, 13, 10])]);
    const wire = Buffer.concat([part("image/jpeg", image), part("application/xml", xml), ending()]);
    for (let split = 0; split <= wire.length; split++) {
        const { parser, received } = harness();
        parser.feed(wire.subarray(0, split)); parser.feed(wire.subarray(split)); parser.flush();
        assert.deepEqual(received.errors, []);
        assert.deepEqual(received.images, [{ bytes: image, extension: "jpg" }]);
        assert.deepEqual(received.xml, [xml]);
    }
    const { parser, received } = harness();
    parser.feed(part("image/jpeg", image).subarray(0, -2));
    assert.deepEqual(received.images, [{ bytes: image, extension: "jpg" }], "Length-framed images must dispatch immediately");
}

// Without a length, only a MIME delimiter on its own line can terminate a binary body.
{
    const image = Buffer.concat([Buffer.from([255, 216]), Buffer.from("embedded--" + boundary + "\r\n\n--" + boundary + "-wrong\n--" + boundary + "--wrong\n--" + boundary + "Extra\n"), xml, Buffer.from([255, 217])]);
    const wire = Buffer.concat([part("image/jpeg", image, false), ending()]);
    const { parser, received } = harness();
    feedOneByte(parser, wire); parser.flush();
    assert.deepEqual(received.errors, []);
    assert.deepEqual(received.images, [{ bytes: image, extension: "jpg" }]);
    assert.deepEqual(received.xml, [], "Binary content must never enter the raw XML scanner");
}

// Delimiter whitespace can span chunks, and a closing marker without a newline is accepted at EOF.
{
    const image = Buffer.from([255, 216, 1, 2, 3, 255, 217]);
    const { parser, received } = harness();
    feedOneByte(parser, Buffer.concat([part("image/jpeg", image, false), Buffer.from("--" + boundary + "--" + " ".repeat(40))]));
    assert.equal(received.images.length, 0, "A partial boundary line must await its terminator or EOF");
    parser.flush();
    assert.deepEqual(received.errors, []);
    assert.deepEqual(received.images, [{ bytes: image, extension: "jpg" }]);
}

// Raw XML is a separate mode, with no duplicate scanner and byte-exact Unicode preservation.
{
    const wire = Buffer.concat([Buffer.from('<?xml version="1.0"?>\r\n'), xml, Buffer.from("\n"), xml]);
    for (let split = 0; split <= wire.length; split++) {
        const { parser, received } = harness();
        parser.feed(wire.subarray(0, split)); parser.feed(wire.subarray(split)); parser.flush();
        assert.deepEqual(received.errors, []);
        assert.deepEqual(received.xml, [xml, xml]);
    }
    const { parser, received } = harness();
    feedOneByte(parser, wire); parser.flush();
    assert.deepEqual(received.errors, []);
    assert.deepEqual(received.xml, [xml, xml]);
    const forced = harness({ scanRawXml: false });
    forced.parser.feed(wire); forced.parser.flush();
    assert.deepEqual(forced.received.xml, []);
    assert.equal(forced.received.errors.length, 1);
}

// XML framing understands CDATA/comments, quoted >, self-closing tags and nested documents.
{
    const special = Buffer.from('<EventNotificationAlert test=">"><x/><text><![CDATA[</EventNotificationAlert>]]></text><!-- </EventNotificationAlert> --></EventNotificationAlert>');
    for (const wire of [special, Buffer.concat([part("text/xml", special, false), ending()])]) {
        const { parser, received } = harness();
        feedOneByte(parser, wire); parser.flush();
        assert.deepEqual(received.errors, []);
        assert.deepEqual(received.xml, [special]);
    }
    const selfClosing = Buffer.from("<EventNotificationAlert/>");
    const { parser, received } = harness();
    parser.feed(selfClosing); parser.flush();
    assert.deepEqual(received.errors, []);
    assert.deepEqual(received.xml, [selfClosing]);
}

// Frame limits are terminal and report one error, including unclosed XML starting at offset 0.
for (const wire of [
    Buffer.from("<EventNotificationAlert>" + "x".repeat(300)),
    part("application/xml", Buffer.from("<EventNotificationAlert>" + "x".repeat(300))),
    part("image/jpeg", Buffer.alloc(300)),
    part("image/jpeg", Buffer.alloc(300), false),
    Buffer.from("--" + boundary + "\r\nContent-Type: image/jpeg\r\nX: " + "x".repeat(300)),
    Buffer.from("preamble".repeat(100))
]) {
    const { parser, received } = harness({ maxXmlScanBufferChars: 128, maxMultipartBufferBytes: 256 });
    feedOneByte(parser, wire);
    parser.feed(xml); parser.flush();
    assert.equal(received.errors.length, 1, "Size error must be terminal and reported once");
    assert.match(received.errors[0].message, /limit/i);
    assert.deepEqual(received.xml, []);
    assert.deepEqual(received.images, []);
}

// Limits apply per pending frame, not to a TCP batch larger than the total buffer limit.
{
    const tiny = Buffer.from("<EventNotificationAlert><x/></EventNotificationAlert>");
    for (const multipart of [false, true]) {
        const { parser, received } = harness({ maxXmlScanBufferChars: 128, maxMultipartBufferBytes: 256 });
        const wire = Buffer.concat(Array.from({ length: 100 }, () => multipart ? part("application/xml", tiny) : tiny).concat(multipart ? [ending()] : []));
        parser.feed(wire); parser.flush();
        assert.deepEqual(received.errors, []);
        assert.equal(received.xml.length, 100);
        assert.ok(received.xml.every(body => body.equals(tiny)));
    }
}

// Invalid length, headers, tags and missing final bytes/boundaries fail instead of silently trimming.
for (const wire of [
    Buffer.from("--" + boundary + "\r\nContent-Type: application/xml\r\nContent-Length: -1\r\n\r\n"),
    Buffer.from("--" + boundary + "\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\n"),
    Buffer.from("--" + boundary + "\r\nNot a header\r\n\r\n"),
    Buffer.from("<EventNotificationAlert><a></b></EventNotificationAlert>"),
    Buffer.from("<EventNotificationAlert>unfinished"),
    part("image/jpeg", Buffer.from("12345")).subarray(0, -4),
    part("application/xml", xml).subarray(0, -2),
    Buffer.concat([part("application/xml", Buffer.from("<EventNotificationAlert>"), false), ending()]),
    Buffer.concat([part("application/json", Buffer.from('{"missing":'), false), ending()]),
    Buffer.concat([part("application/xml", xml), Buffer.from("garbage")])
]) {
    const { parser, received } = harness();
    parser.feed(wire); parser.flush(); parser.flush(); parser.feed(xml);
    assert.equal(received.errors.length, 1, "Malformed/truncated stream must report one terminal error");
}

// Unknown MIME types and zero-byte length parts retain callback compatibility.
{
    const { parser, received } = harness();
    parser.feed(Buffer.concat([part("application/octet-stream", Buffer.alloc(0)), part("image/png", Buffer.from([1, 2, 3])), ending()]));
    parser.flush();
    assert.deepEqual(received.errors, []);
    assert.deepEqual(received.unsupported, ["application/octet-stream"]);
    assert.deepEqual(received.images, [{ bytes: Buffer.from([1, 2, 3]), extension: "png" }]);
}
console.log("Alert stream parser tests PASSED.");
