'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createDeviceProbe, deviceURL, parseDeviceInfo, DEVICE_TYPES } = require('../nodes/utils/deviceReachability');
const { parseChallenge } = require('../nodes/utils/httpClient');
const info = '<?xml version="1.0"?><DeviceInfo xmlns="http://www.hikvision.com/ver20/XMLSchema"><deviceName>Tettoia Nord</deviceName><model>Camera</model></DeviceInfo>';

async function setup(t, handler, timeoutMs = 250) {
    const sockets = new Set();
    const server = http.createServer(handler);
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const probe = createDeviceProbe({ timeoutMs });
    t.after(async () => {
        probe.close();
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
    });
    const device = { type: 'Hikvision-config', name: 'Camera', host: '127.0.0.1', port: server.address().port, protocol: 'http', authentication: 'basic', credentials: { user: 'admin', password: 'test-secret' } };
    return { device, probe, sockets };
}

test('Device URLs support configured ports, every config family and IPv6 without duplicate ports', () => {
    for (const type of DEVICE_TYPES) {
        for (const host of ['camera.local', '192.0.2.1', '[2001:db8::1]']) {
            const runtimeHost = host + (type === 'Hikvision-config' ? '' : ':8443');
            assert.equal(deviceURL({ type, host: runtimeHost, port: 8443, protocol: 'https' }), 'https://' + host + ':8443/ISAPI/System/deviceInfo');
        }
    }
    assert.equal(deviceURL({ type: 'Hikvision-config', host: '2001:db8::1', port: 80 }), 'http://[2001:db8::1]/ISAPI/System/deviceInfo');
    for (const host of ['user:password@host', 'host/path', 'host?query', 'host#hash', 'host\\path', 'host name', 'host:12']) {
        assert.throws(() => deviceURL({ type: 'Hikvision-config', host, port: 80 }));
    }
    for (const port of [0, 0.5, -1, 65536, 'NaN']) assert.throws(() => deviceURL({ host: 'camera', port }));
    assert.throws(() => deviceURL({ host: 'camera', protocol: 'ftp' }));
});

test('Only structurally valid nonempty DeviceInfo is accepted', () => {
    for (const body of [info, '<h:DeviceInfo xmlns:h="urn:test"><h:deviceID>001</h:deviceID></h:DeviceInfo>', '{"DeviceInfo":{"deviceName":"Camera"}}']) assert.equal(parseDeviceInfo(body), true);
    for (const body of ['', '  ', '<html><body>Login</body></html>', '<ResponseStatus><statusCode>1</statusCode></ResponseStatus>', '<DeviceInfo/>', '<DeviceInfo>text</DeviceInfo>',
        '<DeviceInfo><deviceName> </deviceName></DeviceInfo>', '<DeviceInfo><deviceName><nested>Camera</nested></deviceName></DeviceInfo>', '<DeviceInfo><deviceName>One</deviceName><deviceName>Two</deviceName></DeviceInfo>',
        '<DeviceInfo><model>x</model></DeviceInfo><Other/>', '<DeviceInfo><model>truncated', '{"DeviceInfo":[]}', '{"DeviceInfo":{"model":42}}',
        '<!DOCTYPE DeviceInfo [<!ENTITY e SYSTEM "file:///etc/passwd">]><DeviceInfo><model>&e;</model></DeviceInfo>']) {
        assert.throws(() => parseDeviceInfo(body), 'Must reject: ' + body);
    }
});

test('Probe performs an authenticated uncached GET and waits for the complete body', async t => {
    let endResponse;
    const app = await setup(t, (req, res) => {
        assert.equal(req.method, 'GET');
        assert.equal(req.url, '/ISAPI/System/deviceInfo');
        assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('admin:test-secret').toString('base64'));
        assert.equal(req.headers['cache-control'], 'no-cache');
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.write(info);
        endResponse = () => res.end();
    });
    let settled = false;
    const checking = app.probe.check(app.device).then(result => { settled = true; return result; });
    while (!endResponse) await delay(2);
    await delay(10);
    assert.equal(settled, false, 'A valid document without HTTP end is not sufficient');
    endResponse();
    const result = await checking;
    assert.equal(result.reachable, true);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.error, null);
    assert.ok(result.responseTime >= 10);
    assert.doesNotMatch(JSON.stringify(result), /test-secret|admin|Tettoia|model/);
});

test('DeviceInfo probe authenticates using an independently verified Digest exchange', async t => {
    let requests = 0;
    const app = await setup(t, (req, res) => {
        requests++;
        if (!req.headers.authorization) {
            res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="camera", nonce="test-nonce", algorithm=MD5, qop="auth"' });
            res.end('challenge');
        } else {
            const fields = parseChallenge(req.headers.authorization);
            const md5 = text => crypto.createHash('md5').update(text).digest('hex');
            const expected = md5(md5('admin:camera:test-secret') + ':test-nonce:' + fields.nc + ':' + fields.cnonce + ':auth:' + md5('GET:/ISAPI/System/deviceInfo'));
            assert.equal(fields.response, expected);
            res.end(info);
        }
    });
    assert.equal((await app.probe.check({ ...app.device, authentication: 'digest' })).reachable, true);
    assert.equal(requests, 2);
});

test('AX Pro reuses its existing session without starting another login', async t => {
    let requests = 0;
    const app = await setup(t, (req, res) => {
        requests++;
        assert.equal(req.headers.cookie, 'session=private');
        assert.equal(req.headers.authorization, undefined);
        res.end(info);
    });
    const device = { ...app.device, type: 'AXPro-config', host: app.device.host + ':' + app.device.port, authentication: 'sha256-salted' };
    assert.equal((await app.probe.check(device)).error.code, 'AUTH_SESSION_UNAVAILABLE');
    const result = await app.probe.check({ ...device, authCookie: 'session=private' });
    assert.equal(result.reachable, true);
    assert.equal(requests, 1);
    assert.doesNotMatch(JSON.stringify(result), /private|cookie|test-secret/);
});

for (const status of [204, 301, 401, 403, 404, 429, 500, 503]) {
    test('HTTP ' + status + ' cannot masquerade as successful device information', async t => {
        const app = await setup(t, (req, res) => { res.writeHead(status, { Location: '/login' }); res.end(info); });
        const result = await app.probe.check(app.device);
        assert.equal(result.reachable, false);
        assert.equal(result.httpStatus, status);
        assert.equal(result.error.code, status === 204 ? 'EMPTY_RESPONSE' : 'HTTP_' + status);
    });
}

for (const mode of ['no headers', 'empty body', 'trickling body', 'digest challenge']) {
    test('Total deadline bounds a stalled ' + mode, { timeout: 3000 }, async t => {
        const app = await setup(t, (req, res) => {
            if (mode === 'no headers') return;
            res.writeHead(mode === 'digest challenge' ? 401 : 200, { 'WWW-Authenticate': 'Digest realm="camera", nonce="n", qop="auth"' });
            res.flushHeaders();
            if (mode === 'trickling body' || mode === 'digest challenge') {
                const timer = setInterval(() => res.write(' '), 5);
                res.once('close', () => clearInterval(timer));
            }
        }, 60);
        const result = await app.probe.check({ ...app.device, authentication: mode === 'digest challenge' ? 'digest' : 'basic' });
        assert.equal(result.reachable, false);
        assert.equal(result.error.code, 'TIMEOUT');
        assert.ok(result.responseTime < 1000);
    });
}

test('Truncated and oversized bodies fail; a subsequent complete response recovers', async t => {
    let attempt = 0;
    const app = await setup(t, (req, res) => {
        attempt++;
        if (attempt === 1) { res.writeHead(200, { 'Content-Length': Buffer.byteLength(info) + 100 }); res.end(info); }
        else if (attempt === 2) res.end('x'.repeat(1024 * 1024 + 1));
        else res.end(info);
    });
    assert.equal((await app.probe.check(app.device)).reachable, false);
    assert.equal((await app.probe.check(app.device)).error.code, 'ERR_RESPONSE_TOO_LARGE');
    assert.equal((await app.probe.check(app.device)).reachable, true);
});

test('Close cancels active sockets and prevents future requests', { timeout: 3000 }, async t => {
    let entered = false;
    const app = await setup(t, () => { entered = true; }, 2000);
    const checking = app.probe.check(app.device);
    while (!entered) await delay(2);
    app.probe.close();
    assert.equal((await checking).reachable, false);
    const result = await app.probe.check(app.device);
    assert.equal(result.error.code, 'CLOSED');
    for (let i = 0; app.sockets.size && i < 100; i++) await delay(2);
    assert.equal(app.sockets.size, 0);
});

test('Missing, closing and unrelated config nodes never pass a reachability check', async () => {
    const probe = createDeviceProbe();
    for (const device of [undefined, { type: 'mqtt-broker' }, { type: 'Hikvision-config', isClosing: true }]) {
        assert.equal((await probe.check(device)).error.code, 'MISSING_CONFIG');
    }
    probe.close();
});
