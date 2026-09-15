/* Deterministic lifecycle tests with local HTTP cameras and a manual Node-RED timer clock. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { createRequire } = require('module');

const configPath = path.resolve(__dirname, '../nodes/Hikvision-config.js');
const localRequire = createRequire(configPath);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error('Timed out: ' + label);
        await sleep(5);
    }
}
class Clock {
    constructor() { this.timers = new Map(); this.next = 1; }
    setTimeout(fn, delay) { const id = this.next++; this.timers.set(id, { fn, delay }); return id; }
    clearTimeout(id) { this.timers.delete(id); }
    count(delay) { return [...this.timers.values()].filter(timer => timer.delay === delay).length; }
    run(delay) {
        const entry = [...this.timers.entries()].find(([, timer]) => timer.delay === delay);
        assert.ok(entry, 'Expected timer with delay ' + delay);
        this.timers.delete(entry[0]);
        entry[1].fn();
    }
}
function runtime() {
    const clock = new Clock();
    const routes = [];
    const instances = new Map();
    let Constructor;
    const RED = {
        log: { info() {}, warn() {}, error() {}, debug() {} },
        auth: { needsPermission(permission) { assert.strictEqual(permission, 'Hikvisionconfig.read'); return () => {}; } },
        httpAdmin: {
            get(route, permission, handler) { routes.push({ method: 'get', route, handler }); },
            post(route, permission, handler) { routes.push({ method: 'post', route, handler }); }
        },
        nodes: {
            registerType(name, constructor) { Constructor = constructor; },
            getNode(id) { return instances.get(id); },
            createNode(node, config) {
                const emitter = new EventEmitter();
                node.on = emitter.on.bind(emitter);
                node.emit = emitter.emit.bind(emitter);
                node.id = config.id;
                node.credentials = config.credentials || { user: 'test-user', password: 'test-password' };
                instances.set(node.id, node);
            }
        }
    };
    const context = { module: { exports: {} }, require: localRequire, Buffer, URL, AbortController,
        setTimeout: clock.setTimeout.bind(clock), clearTimeout: clock.clearTimeout.bind(clock) };
    vm.runInNewContext(fs.readFileSync(configPath, 'utf8'), context, { filename: configPath });
    context.module.exports(RED);
    return {
        clock, routes,
        create(config) {
            const node = new Constructor({ id: 'camera', host: '127.0.0.1', protocol: 'http', authentication: 'basic', ...config });
            const messages = [], statuses = [];
            node.addClient({ id: 'client-' + node.id, topic: 'camera/test', sendPayload: msg => messages.push(msg), setNodeStatus: status => statuses.push(status) });
            return { node, messages, statuses };
        },
        async route(method, url, query = {}, body) {
            const route = routes.find(candidate => candidate.method === method && candidate.route === url);
            assert.ok(route, 'Route registered: ' + url);
            const response = new EventEmitter();
            response.code = 200;
            response.status = code => { response.code = code; return response; };
            response.json = data => { response.data = data; response.headersSent = true; };
            await route.handler({ method: method.toUpperCase(), query, body }, response);
            return response;
        }
    };
}
async function closeNode(node) {
    let closed = false;
    node.emit('close', false, () => { closed = true; });
    assert.ok(closed, 'Node close callback completes without an arbitrary delay');
}
async function camera(handler) {
    const sockets = new Set();
    const server = http.createServer(handler);
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        port: server.address().port, sockets,
        async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
    };
}
const eventXML = (region = 1) => `<EventNotificationAlert><dynChannelID>4</dynChannelID><dateTime>2000-01-01T00:00:00Z</dateTime><eventType>futureEvent</eventType><eventState>active</eventState><DetectionRegionList><DetectionRegionEntry><regionID>${region}</regionID></DetectionRegionEntry></DetectionRegionList></EventNotificationAlert>`;
const alarmMessages = messages => messages.filter(msg => msg.type === 'event');

async function basicLifecycle() {
    let currentResponse, requests = 0;
    const mock = await camera((req, res) => {
        requests += 1;
        assert.strictEqual(req.headers.authorization, 'Basic ' + Buffer.from('test-user:test-password').toString('base64'));
        currentResponse = res;
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.flushHeaders();
    });
    const app = runtime();
    const { node, messages } = app.create({ port: mock.port, heartbeattimerdisconnectionlimit: 1 });
    try {
        assert.strictEqual(app.clock.count(10000), 1);
        app.clock.run(10000);
        await until(() => app.clock.count(40000) === 1, 'Basic stream accepted');
        currentResponse.write(eventXML(1) + eventXML(2));
        await until(() => alarmMessages(messages).length === 2, 'both regions forwarded');
        assert.strictEqual(alarmMessages(messages)[0].payload.channelID, 4, 'dynChannelID normalized');
        assert.strictEqual(alarmMessages(messages)[1].payload.DetectionRegionList.DetectionRegionEntry.regionID, 2);
        assert.ok(node.getAlarmCapabilitiesSnapshot('4').events.some(event => event.id.toLowerCase() === 'futureevent'), 'Stream events enrich capability snapshot');
        currentResponse.end();
        await until(() => app.clock.count(2000) === 1, 'XML end schedules reconnect');
        await sleep(15);
        assert.strictEqual(app.clock.timers.size, 1, 'end and close schedule only one reconnect');
        assert.strictEqual(messages.filter(msg => msg.errorDescription && msg.payload === true).length, 1);
        app.clock.run(2000);
        await until(() => requests === 2 && app.clock.count(40000) === 1, 'stream reconnected');
        assert.strictEqual(messages.filter(msg => msg.errorDescription === '' && msg.payload === false).length, 0, 'Response headers alone must not report recovery');
        currentResponse.write(eventXML(3));
        await until(() => alarmMessages(messages).length === 3, 'recovery activity');
        assert.strictEqual(messages.filter(msg => msg.errorDescription === '' && msg.payload === false).length, 1, 'Valid activity reports recovery');
        currentResponse.destroy();
        await until(() => app.clock.count(2000) === 1, 'abrupt close schedules reconnect');
        assert.strictEqual(app.clock.timers.size, 1, 'error and close share one reconnect');
        app.clock.run(2000);
        await until(() => requests === 3 && app.clock.count(40000) === 1, 'reconnect after truncated response');
        currentResponse.write(eventXML(4));
        await until(() => alarmMessages(messages).length === 4, 'activity after abrupt reconnect');
        app.clock.run(40000);
        await until(() => app.clock.count(2000) === 1, 'heartbeat schedules reconnect');
        await closeNode(node);
        assert.strictEqual(app.clock.timers.size, 0, 'close clears reconnect and heartbeat timers');
        await until(() => mock.sockets.size === 0, 'close destroys active camera sockets');
        assert.strictEqual(requests, 3, 'close never reconnects');
    } finally { await closeNode(node); await mock.close(); }
}

async function multipartIntegrity() {
    let currentResponse;
    const mock = await camera((req, res) => {
        currentResponse = res;
        res.writeHead(200, { 'Content-Type': 'multipart/mixed; boundary=alarmFrame' });
        res.flushHeaders();
    });
    const app = runtime();
    const { node, messages } = app.create({ port: mock.port });
    const part = (type, body) => Buffer.concat([
        Buffer.from(`--alarmFrame\r\nContent-Type: ${type}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n`),
        Buffer.from(body), Buffer.from('\r\n')
    ]);
    try {
        app.clock.run(10000);
        await until(() => app.clock.count(40000) === 1, 'multipart stream accepted');
        currentResponse.write(part('application/xml', eventXML(1)));
        await until(() => alarmMessages(messages).length === 1, 'length-framed XML delivered without waiting for next boundary');
        const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from(eventXML(99)), Buffer.from([0xff, 0xd9])]);
        currentResponse.write(part('image/jpeg', jpeg));
        currentResponse.write(part('application/xml', eventXML(2)));
        await until(() => messages.filter(msg => msg.type === 'img').length === 1 && alarmMessages(messages).length >= 2, 'multipart image and second XML');
        await sleep(15);
        assert.strictEqual(alarmMessages(messages).length, 2, 'XML emits once per part and image bytes are not interpreted as events');
        assert.strictEqual(alarmMessages(messages)[1].payload.DetectionRegionList.DetectionRegionEntry.regionID, 2);
        await closeNode(node);
        assert.strictEqual(app.clock.timers.size, 0);
    } finally { await closeNode(node); await mock.close(); }
}

function digestParameters(header) {
    const result = {};
    for (const match of header.matchAll(/([a-z]+)=(?:"([^"]*)"|([^, ]+))/gi)) result[match[1]] = match[2] === undefined ? match[3] : match[2];
    return result;
}
async function digestLifecycle() {
    let authRequests = 0, handshakeSocket;
    const mock = await camera((req, res) => {
        if (!req.headers.authorization) {
            handshakeSocket = req.socket.remotePort;
            res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="camera", nonce="known-nonce", qop="auth", algorithm=SHA-256', 'Content-Length': '9' });
            res.end('challenge');
            return;
        }
        authRequests += 1;
        assert.strictEqual(req.socket.remotePort, handshakeSocket, 'Digest challenge and authenticated request share one socket');
        const params = digestParameters(req.headers.authorization);
        const hash = input => crypto.createHash('sha256').update(input).digest('hex');
        const expected = hash(`${hash('test-user:camera:test-password')}:known-nonce:${params.nc}:${params.cnonce}:auth:${hash('GET:' + req.url)}`);
        assert.strictEqual(params.response, expected, 'Digest SHA-256 uses the advertised algorithm');
        res.writeHead(200, { 'Content-Type': 'multipart/mixed; boundary=customBoundary' });
        const body = JSON.stringify({ EventNotificationAlert: { dynChannelID: 7, eventType: 'futureJSON', eventState: 'active' } });
        res.write(`--customBoundary\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}\r\n--customBoundary\r\n`);
    });
    const app = runtime();
    const { node, messages } = app.create({ port: mock.port, authentication: 'digest' });
    try {
        app.clock.run(10000);
        await until(() => alarmMessages(messages).length === 1, 'Digest JSON alarm');
        assert.strictEqual(alarmMessages(messages)[0].payload.EventNotificationAlert.dynChannelID, 7, 'JSON wrapper and device fields remain intact for Raw clients');
        assert.ok(node.getAlarmCapabilitiesSnapshot('7').events.some(event => event.id.toLowerCase() === 'futurejson'), 'Wrapped JSON is still discovered');
        assert.strictEqual(authRequests, 1);
        await closeNode(node);
        await until(() => mock.sockets.size === 0, 'Digest close cleans sockets');
        assert.strictEqual(app.clock.timers.size, 0);
    } finally { await closeNode(node); await mock.close(); }
}

async function deployAndRoutes() {
    let requests = 0;
    const mock = await camera((req, res) => {
        requests += 1;
        if (req.url === '/ISAPI/System/deviceInfo') {
            res.writeHead(200, { 'Content-Type': 'application/xml' });
            res.end('<DeviceInfo><deviceName>Mock camera</deviceName><model>Local</model></DeviceInfo>');
        } else {
            res.writeHead(503);
            res.end('offline');
        }
    });
    const app = runtime();
    const first = app.create({ id: 'old', port: mock.port }).node;
    await closeNode(first);
    assert.strictEqual(app.clock.timers.size, 0, 'close before initial connect cancels startup');
    const second = app.create({ id: 'new', port: mock.port }).node;
    try {
        assert.strictEqual(app.routes.filter(route => route.route === '/hikvisionUltimateGetInfoCam' && route.method === 'get').length, 1, 'GET route registered once across config creation/deploy');
        assert.strictEqual(app.routes.filter(route => route.route === '/hikvisionUltimateAlarmCapabilities').length, 1);
        const params = { host: '127.0.0.1', port: mock.port, protocol: 'http', authentication: 'basic', user: 'test-user', password: '__PWRD__' };
        const response = await app.route('post', '/hikvisionUltimateGetInfoCam', { nodeID: 'new' }, params);
        assert.strictEqual(response.code, 200);
        assert.strictEqual(response.data.DeviceInfo.deviceName, 'Mock camera');
        const oldGet = await app.route('get', '/hikvisionUltimateGetInfoCam', { nodeID: 'new', params: encodeURIComponent(JSON.stringify(params)) });
        assert.strictEqual(oldGet.code, 200, 'Legacy GET remains compatible');
        const malformed = await app.route('get', '/hikvisionUltimateGetInfoCam', { params: '%' });
        assert.strictEqual(malformed.code, 400, 'Malformed editor params return a structured error');
        const missing = await app.route('get', '/hikvisionUltimateAlarmCapabilities', { nodeID: 'missing' });
        assert.strictEqual(missing.code, 404);
        const badChannel = await app.route('get', '/hikvisionUltimateAlarmCapabilities', { nodeID: 'new', channelID: '../../x' });
        assert.strictEqual(badChannel.code, 400);
        const cached = await app.route('get', '/hikvisionUltimateAlarmCapabilities', { nodeID: 'new', cached: 'true' });
        assert.strictEqual(cached.code, 200);
        assert.strictEqual(requests, 2, 'Snapshot route performs no camera requests');
        const genericMessages = [];
        await second.request({ name: 'XML test', topic: 'request', sendPayload: msg => genericMessages.push(msg), setNodeStatus() {} }, 'GET', '/ISAPI/System/deviceInfo', null, true);
        assert.strictEqual(genericMessages.length, 1);
        assert.strictEqual(genericMessages[0].payload.DeviceInfo.deviceName, 'Mock camera', 'Generic requests use the configured nonstandard port');
        app.clock.run(10000);
        await until(() => app.clock.count(2000) === 1, '503 schedules retry');
        app.clock.run(2000);
        await until(() => app.clock.count(4000) === 1, 'repeated failures increase backoff');
        await closeNode(second);
        assert.strictEqual(app.clock.timers.size, 0, 'deployment cancels pending retry');
        await until(() => mock.sockets.size === 0, 'deployment closes agents');
    } finally { await closeNode(second); await mock.close(); }
}

async function closeDuringHandshake() {
    let requests = 0;
    const mock = await camera(() => { requests += 1; });
    const app = runtime();
    const { node } = app.create({ port: mock.port, authentication: 'digest' });
    try {
        app.clock.run(10000);
        await until(() => requests === 1, 'Digest request pending headers');
        await closeNode(node);
        await until(() => mock.sockets.size === 0, 'abort closes pending handshake');
        assert.strictEqual(app.clock.timers.size, 0);
    } finally { await closeNode(node); await mock.close(); }
}

async function editorMetadataRoutes() {
    const requests = [];
    const mock = await camera((req, res) => {
        requests.push({ method: req.method, path: req.url });
        res.setHeader('Content-Type', 'application/xml');
        if (req.url === '/ISAPI/System/Video/inputs/channels') {
            res.end('<VideoInputChannelList><VideoInputChannel><id>1</id><name>001</name></VideoInputChannel><VideoInputChannel><id>2</id><name>Porta &amp; scala</name></VideoInputChannel></VideoInputChannelList>');
        } else if (req.url === '/ISAPI/Intelligent/channels/1/capabilities') {
            res.end('<IntelliCap><isBehaviorSupport>false</isBehaviorSupport></IntelliCap>');
        } else if (req.url === '/ISAPI/Smart/FieldDetection/1') {
            res.end('<FieldDetection><id>1</id><FieldDetectionRegionList><FieldDetectionRegion><id>2</id><name>Ingresso</name></FieldDetectionRegion></FieldDetectionRegionList></FieldDetection>');
        } else {
            res.writeHead(404);
            res.end('<ResponseStatus><statusCode>4</statusCode></ResponseStatus>');
        }
    });
    const app = runtime();
    const { node } = app.create({ id: 'metadata-camera', port: mock.port });
    try {
        assert.strictEqual(app.routes.filter(route => route.route === '/hikvisionUltimateAlarmMetadata').length, 1, 'Metadata route is registered once');
        const missing = await app.route('get', '/hikvisionUltimateAlarmMetadata', { nodeID: 'missing' });
        assert.strictEqual(missing.code, 404);
        for (const query of [
            { channelID: ['1'], eventType: 'fieldDetection' },
            { channelID: '01', eventType: 'fieldDetection' },
            { channelID: '1000000', eventType: 'fieldDetection' },
            { channelID: '1', eventType: ['fieldDetection'] },
            { channelID: '1', eventType: 'fieldDetection/../../System' },
            { channelID: '1', eventType: 'x'.repeat(513) },
            { channelID: '1', eventType: Array.from({ length: 17 }, (_, i) => 'event' + i).join(',') }
        ]) {
            const invalid = await app.route('get', '/hikvisionUltimateAlarmMetadata', { nodeID: node.id, ...query });
            assert.strictEqual(invalid.code, 400, 'Invalid metadata query is rejected before contacting the device');
        }
        assert.strictEqual(requests.length, 0);
        const query = { nodeID: node.id, channelID: '1', eventType: 'fieldDetection' };
        const metadata = await app.route('get', '/hikvisionUltimateAlarmMetadata', query);
        assert.strictEqual(metadata.code, 200);
        assert.strictEqual(metadata.data.channels.find(channel => channel.id === '1').name, '001');
        assert.strictEqual(metadata.data.channels.find(channel => channel.id === '2').name, 'Porta & scala');
        assert.strictEqual(metadata.data.zones[0].id, '2');
        assert.strictEqual(metadata.data.zones[0].name, 'Ingresso');
        assert.strictEqual(metadata.data.zones[0].channelID, '1');
        assert.strictEqual(requests.length, 3);
        await app.route('get', '/hikvisionUltimateAlarmMetadata', { ...query, eventType: 'fielddetection' });
        assert.strictEqual(requests.length, 3, 'Editor metadata is cached across canonical event aliases');
        await app.route('get', '/hikvisionUltimateAlarmMetadata', { ...query, refresh: 'true' });
        assert.strictEqual(requests.length, 6, 'Explicit refresh reloads names and rules');
        assert.ok(requests.every(request => request.method === 'GET'), 'Metadata discovery does not change camera configuration');
        await closeNode(node);
        const closed = await app.route('get', '/hikvisionUltimateAlarmMetadata', query);
        assert.strictEqual(closed.code, 404);
        assert.strictEqual(requests.length, 6);
    } finally { await closeNode(node); await mock.close(); }
}

(async () => {
    await basicLifecycle();
    await digestLifecycle();
    await multipartIntegrity();
    await deployAndRoutes();
    await closeDuringHandshake();
    await editorMetadataRoutes();
    console.log('Hikvision connection tests PASSED (Basic/Digest, events, heartbeat, reconnect, deploy, editor routes).');
})().catch(error => { console.error(error); process.exitCode = 1; });
