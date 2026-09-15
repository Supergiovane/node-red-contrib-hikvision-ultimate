'use strict';

const nodeTest = require('node:test');
const test = (name, fn) => nodeTest(name, { timeout: 5000 }, fn);
const assert = require('node:assert/strict');
const http = require('node:http');
const { once, getEventListeners } = require('node:events');
const crypto = require('node:crypto');
const { createHttpClient, parseChallenge } = require('../nodes/utils/httpClient');

async function serve(t, handler) {
    const server = http.createServer(handler);
    const sockets = new Set();
    server.on('connection', socket => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
    });
    return `http://127.0.0.1:${server.address().port}`;
}

function client(authentication = 'none', credentials = {}) {
    return createHttpClient({ authentication, username: 'admin', password: 'secret', ...credentials });
}

// The mock validates the wire response independently of the implementation's
// Digest builder, using the cnonce received from the client.
function digestIsValid(header, algorithm, method, uri, body, username = 'admin', password = 'secret') {
    const fields = parseChallenge(header);
    if (!fields || fields.username !== username || fields.uri !== uri) return false;
    const digestName = algorithm.startsWith('SHA-512-256') ? 'sha512-256' : algorithm.startsWith('SHA-256') ? 'sha256' : 'md5';
    const hash = text => crypto.createHash(digestName).update(text).digest('hex');
    let ha1 = hash(`${username}:${fields.realm}:${password}`);
    if (algorithm.endsWith('-SESS')) ha1 = hash(`${ha1}:${fields.nonce}:${fields.cnonce}`);
    const ha2 = hash(`${method}:${uri}${fields.qop === 'auth-int' ? ':' + hash(body) : ''}`);
    const expected = fields.qop
        ? hash(`${ha1}:${fields.nonce}:${fields.nc}:${fields.cnonce}:${fields.qop}:${ha2}`)
        : hash(`${ha1}:${fields.nonce}:${ha2}`);
    return fields.response === expected;
}

test('Basic authentication preserves request body and JSON response API', async t => {
    let received;
    const url = await serve(t, async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        received = { body: Buffer.concat(chunks).toString(), auth: req.headers.authorization, length: req.headers['content-length'] };
        res.setHeader('Content-Type', 'application/json');
        res.end('{"success":true}');
    });
    const response = await client('basic').fetch(url, { method: 'PUT', body: 'caffè', timeout: 1000 });
    assert.deepEqual(await response.json(), { success: true });
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(response.ok, true);
    assert.deepEqual(received, { body: 'caffè', auth: 'Basic YWRtaW46c2VjcmV0', length: '6' });
});

for (const algorithm of ['MD5', 'MD5-SESS', 'SHA-256', 'SHA-256-SESS', 'SHA-512-256', 'SHA-512-256-SESS']) {
    for (const qop of ['auth', 'auth-int', null]) {
        test(`Digest ${algorithm} ${qop || 'legacy no qop'} authenticates on one keep-alive socket`, async t => {
            const requestSockets = [];
            let requests = 0;
            const url = await serve(t, async (req, res) => {
                requests++;
                requestSockets.push(req.socket);
                const chunks = [];
                for await (const chunk of req) chunks.push(chunk);
                const body = Buffer.concat(chunks);
                if (!req.headers.authorization) {
                    res.writeHead(401, { 'WWW-Authenticate': `Basic realm="fallback", Digest Realm = "camera", Nonce = "abc", algorithm=${algorithm}${qop ? `, qop="${qop}"` : ''}` });
                    res.write(Buffer.alloc(128 * 1024, 'a'));
                    setImmediate(() => res.end('challenge complete'));
                } else {
                    const valid = digestIsValid(req.headers.authorization, algorithm, 'POST', '/event?a=1', body);
                    res.writeHead(valid ? 200 : 403);
                    res.end(valid ? 'authenticated' : 'bad digest');
                }
            });
            const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
            t.after(() => agent.destroy());
            const response = await client('digest').fetch(`${url}/event?a=1`, { method: 'POST', body: Buffer.from([0, 1, 255, 23]), agent, timeout: 1000 });
            assert.equal(response.status, 200);
            assert.equal(await response.text(), 'authenticated');
            assert.equal(requests, 2);
            assert.equal(requestSockets[0], requestSockets[1]);
        });
    }
}

test('Digest escapes and unescapes quotes, backslashes and commas', async t => {
    const username = 'some"user\\name';
    const realm = 'camera,"realm\\one';
    let received;
    const url = await serve(t, async (req, res) => {
        for await (const chunk of req) { void chunk; }
        if (!req.headers.authorization) {
            res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="camera,\\"realm\\\\one", nonce="nonce\\"one", opaque="opaque\\\\value", qop="auth,auth-int"' });
            res.end();
            return;
        }
        received = parseChallenge(req.headers.authorization);
        res.end(digestIsValid(req.headers.authorization, 'MD5', 'GET', '/', Buffer.alloc(0), username) ? 'ok' : 'bad');
    });
    const response = await client('digest', { username }).fetch(url, { timeout: 1000 });
    assert.equal(await response.text(), 'ok');
    assert.equal(received.realm, realm);
    assert.equal(received.nonce, 'nonce"one');
    assert.equal(received.opaque, 'opaque\\value');
    assert.equal(received.qop, 'auth');
});

test('Digest retries one stale challenge and stops bounded repeated stale challenges', async t => {
    let requests = 0;
    const url = await serve(t, (req, res) => {
        requests++;
        req.resume();
        res.writeHead(401, { 'WWW-Authenticate': `Digest realm="camera", nonce="n${requests}", qop="auth", stale=true` });
        res.end(`failure ${requests}`);
    });
    const response = await client('digest').fetch(url, { timeout: 1000 });
    assert.equal(response.status, 401);
    assert.equal(await response.text(), 'failure 3');
    assert.equal(requests, 3);
});

test('Digest succeeds after stale nonce and replays the same body', async t => {
    const bodies = [];
    const url = await serve(t, async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        bodies.push(Buffer.concat(chunks).toString());
        if (bodies.length < 3) {
            res.writeHead(401, { 'WWW-Authenticate': `Digest realm="camera", nonce="n${bodies.length}", qop="auth", stale=${bodies.length === 2}` });
            res.end();
        } else {
            const auth = parseChallenge(req.headers.authorization);
            assert.equal(auth.nc, '00000001');
            res.end(auth.nonce === 'n2' && digestIsValid(req.headers.authorization, 'MD5', 'PUT', '/', Buffer.from('body')) ? 'ok' : 'bad');
        }
    });
    assert.equal(await (await client('digest').fetch(url, { method: 'PUT', body: 'body', timeout: 1000 })).text(), 'ok');
    assert.deepEqual(bodies, ['body', 'body', 'body']);
});

test('Digest bad credentials stops after one authenticated request and keeps final body readable', async t => {
    let requests = 0;
    const url = await serve(t, (req, res) => {
        requests++;
        res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="camera", nonce="abc", qop="auth"' });
        res.end('wrong password');
    });
    const response = await client('digest').fetch(url, { timeout: 1000 });
    assert.equal(await response.text(), 'wrong password');
    assert.equal(requests, 2);
});

test('Missing Digest challenge leaves the original 401 body readable', async t => {
    const url = await serve(t, (req, res) => res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="camera"' }).end('basic only'));
    assert.equal(await (await client('digest').fetch(url, { timeout: 1000 })).text(), 'basic only');
});

test('Unsupported Digest qop and algorithm reject without retrying', async t => {
    for (const challenge of ['qop="unsupported"', 'algorithm=SHA-999']) {
        let requests = 0;
        const url = await serve(t, (req, res) => {
            requests++;
            res.writeHead(401, { 'WWW-Authenticate': `Digest realm="camera", nonce="abc", ${challenge}` }).end('bad challenge');
        });
        await assert.rejects(client('digest').fetch(url, { timeout: 1000 }), /Unsupported digest/);
        assert.equal(requests, 1);
    }
});

test('Timeout rejects a server that never sends headers', async t => {
    const controller = new AbortController();
    const url = await serve(t, () => {});
    await assert.rejects(client().fetch(url, { timeout: 50, signal: controller.signal }), { code: 'ETIMEDOUT' });
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('Timeout includes waiting in the agent queue', async t => {
    const url = await serve(t, (req, res) => res.writeHead(200).flushHeaders());
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    t.after(() => agent.destroy());
    const first = await client().fetch(url, { agent });
    await assert.rejects(client().fetch(url, { agent, timeout: 50 }), { code: 'ETIMEDOUT' });
    first.body.destroy();
});

test('Body stalls reject text() and detach AbortSignal listeners', async t => {
    const controller = new AbortController();
    const url = await serve(t, (req, res) => {
        res.writeHead(200, { 'Content-Length': 10 });
        res.write('start');
    });
    const response = await client().fetch(url, { timeout: 50, signal: controller.signal });
    await assert.rejects(response.text(), { code: 'ETIMEDOUT' });
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('connectTimeout stops at headers and permits a long-lived event stream', async t => {
    const url = await serve(t, (req, res) => {
        res.writeHead(200).flushHeaders();
        const timer = setTimeout(() => res.end('late event'), 100);
        res.once('close', () => clearTimeout(timer));
    });
    assert.equal(await (await client().fetch(url, { connectTimeout: 50, timeout: 0 })).text(), 'late event');
});

test('Truncated content-length body rejects promptly, including delayed body reads', async t => {
    let socket;
    const url = await serve(t, (req, res) => {
        socket = req.socket;
        res.writeHead(200, { 'Content-Length': 100 });
        res.write('partial');
    });
    for (const lateRead of [false, true]) {
        const response = await client().fetch(url, { timeout: 1000 });
        const error = once(response.body, 'error');
        const read = lateRead ? null : response.text();
        if (read) read.catch(() => {});
        socket.destroy();
        await error;
        await assert.rejects(read || response.text(), /aborted|closed/);
    }
});

test('Truncated chunked response rejects instead of resolving partial data', async t => {
    let socket;
    const url = await serve(t, (req, res) => {
        socket = req.socket;
        res.write('partial');
    });
    const response = await client().fetch(url, { timeout: 1000 });
    const read = response.text();
    socket.destroy();
    await assert.rejects(read, /aborted|closed/);
});

test('Abort before fetch rejects and does not register listeners', async t => {
    const controller = new AbortController();
    controller.abort();
    const url = await serve(t, (req, res) => res.end('unexpected'));
    await assert.rejects(client().fetch(url, { signal: controller.signal }), { name: 'AbortError', code: 'ABORT_ERR' });
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('Abort after headers fails the body and closes the underlying socket', async t => {
    let socket;
    const controller = new AbortController();
    const url = await serve(t, (req, res) => {
        socket = req.socket;
        res.write('start');
    });
    const response = await client().fetch(url, { signal: controller.signal });
    const closed = once(socket, 'close');
    const read = response.text();
    controller.abort();
    await assert.rejects(read, { name: 'AbortError', code: 'ABORT_ERR' });
    await closed;
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('Destroying the body tears down a never-ending response', async t => {
    let socket;
    const url = await serve(t, (req, res) => {
        socket = req.socket;
        res.write('start');
    });
    const response = await client().fetch(url);
    const closed = once(socket, 'close');
    response.body.destroy();
    await closed;
    await assert.rejects(response.text(), /closed/);
});

test('Successful calls release AbortSignal handlers before returning to a shared agent', async t => {
    const controller = new AbortController();
    const url = await serve(t, (req, res) => res.end('ok'));
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    t.after(() => agent.destroy());
    for (let i = 0; i < 12; i++) {
        assert.equal(await (await client().fetch(url, { agent, signal: controller.signal })).text(), 'ok');
        assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    }
});

test('size limits are enforced on both declared and chunked bodies', async t => {
    for (const declared of [false, true]) {
        const url = await serve(t, (req, res) => {
            if (declared) res.setHeader('Content-Length', 10);
            res.end('0123456789');
        });
        const response = await client().fetch(url, { size: 5, timeout: 1000 });
        await assert.rejects(response.text(), { code: 'ERR_RESPONSE_TOO_LARGE' });
    }
});


test('Digest challenge drain has a deadline even when event-stream timeout is disabled', async t => {
    const url = await serve(t, (req, res) => {
        res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="camera", nonce="abc", qop="auth"' });
        res.write('unfinished challenge');
    });
    await assert.rejects(client('digest').fetch(url, { connectTimeout: 50, timeout: 0 }), { code: 'ETIMEDOUT' });
});

test('Abort before response headers rejects and detaches its listener', async t => {
    const controller = new AbortController();
    let requestArrived;
    const arrived = new Promise(resolve => { requestArrived = resolve; });
    const url = await serve(t, () => requestArrived());
    const response = client().fetch(url, { signal: controller.signal, timeout: 1000 });
    await arrived;
    controller.abort();
    await assert.rejects(response, { name: 'AbortError', code: 'ABORT_ERR' });
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('Abort while draining a Digest challenge prevents the authenticated retry', async t => {
    let requests = 0;
    const controller = new AbortController();
    const url = await serve(t, (req, res) => {
        requests++;
        res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="camera", nonce="abc", qop="auth"' });
        res.write('unfinished challenge');
        setImmediate(() => controller.abort());
    });
    await assert.rejects(client('digest').fetch(url, { signal: controller.signal, connectTimeout: 1000 }), { name: 'AbortError', code: 'ABORT_ERR' });
    assert.equal(requests, 1);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('HTTPS connection deadline covers a peer that never completes the TLS handshake', async t => {
    const net = require('node:net');
    const sockets = new Set();
    const server = net.createServer(socket => {
        sockets.add(socket);
        socket.on('data', () => {});
        socket.once('close', () => sockets.delete(socket));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
    });
    await assert.rejects(client().fetch(`https://127.0.0.1:${server.address().port}`, { connectTimeout: 50, timeout: 0 }), { code: 'ETIMEDOUT' });
});

test('A failed body is safe before any caller error listener is attached', async t => {
    let socket;
    const url = await serve(t, (req, res) => {
        socket = req.socket;
        res.writeHead(200, { 'Content-Length': 100 });
        res.write('partial');
    });
    const response = await client().fetch(url, { timeout: 1000 });
    const closed = new Promise(resolve => response.body.once('close', resolve));
    socket.destroy();
    await closed;
    await assert.rejects(response.text(), /aborted|closed/);
});

test('Reused socket does not retain the previous request timeout', async t => {
    let requests = 0;
    const url = await serve(t, (req, res) => {
        requests++;
        if (requests === 1) res.end('first');
        else {
            res.writeHead(200).flushHeaders();
            const timer = setTimeout(() => res.end('second'), 100);
            res.once('close', () => clearTimeout(timer));
        }
    });
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    t.after(() => agent.destroy());
    assert.equal(await (await client().fetch(url, { agent, timeout: 50 })).text(), 'first');
    assert.equal(await (await client().fetch(url, { agent, connectTimeout: 50, timeout: 0 })).text(), 'second');
});

test('IPv6 URL literals are passed to http.request without address brackets', async t => {
    const server = http.createServer((req, res) => res.end('IPv6 camera'));
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '::1', resolve);
        });
    } catch (error) {
        if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) {
            t.skip('IPv6 loopback is unavailable on this host');
            return;
        }
        throw error;
    }
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    assert.equal(await (await client().fetch(`http://[::1]:${server.address().port}/`, { timeout: 1000 })).text(), 'IPv6 camera');
});
