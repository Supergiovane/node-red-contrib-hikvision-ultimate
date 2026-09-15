'use strict';

const nodeTest = require('node:test');
const test = (name, callback) => nodeTest(name, { timeout: 5000 }, callback);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { setTimeout: delay } = require('node:timers/promises');

const configPath = path.resolve(__dirname, '../nodes/Hikvision-config.js');
async function until(predicate) {
    const deadline = Date.now() + 2500;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error('Expected lifecycle state was not reached');
        await delay(5);
    }
}
async function setup(t, options = {}) {
    const responses = [];
    const sockets = new Set();
    const server = http.createServer((req, res) => {
        responses.push(res);
        res.writeHead(200, { 'Content-Type': options.contentType || 'application/xml' });
        res.flushHeaders();
    });
    server.on('connection', socket => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const timers = new Map();
    let timerID = 0;
    let Constructor;
    const emitter = new EventEmitter();
    const RED = {
        log: { info() {}, warn() {}, error() {}, debug() {} },
        auth: { needsPermission() { return () => {}; } },
        httpAdmin: { get() {}, post() {} },
        nodes: {
            registerType(name, ctor) { Constructor = ctor; },
            createNode(node) {
                node.on = emitter.on.bind(emitter);
                node.credentials = { user: 'test', password: 'test' };
            }
        }
    };
    const context = {
        module: { exports: {} }, require: createRequire(configPath), Buffer, URL, AbortController,
        setTimeout(fn, ms) { const id = ++timerID; timers.set(id, { fn, ms }); return id; },
        clearTimeout(id) { timers.delete(id); }
    };
    vm.runInNewContext(fs.readFileSync(configPath, 'utf8'), context, { filename: configPath });
    context.module.exports(RED);
    const node = new Constructor({ host: '127.0.0.1', port: server.address().port, protocol: 'http', authentication: 'basic', ...options.config });
    const messages = [], statuses = [];
    node.addClient({ id: 'alarm', topic: 'alarm', sendPayload: msg => messages.push(msg), setNodeStatus: status => statuses.push(status) });
    t.after(async () => {
        emitter.emit('close', false, () => {});
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
        assert.equal(timers.size, 0);
    });
    const count = ms => [...timers.values()].filter(timer => timer.ms === ms).length;
    const run = ms => {
        const entry = [...timers.entries()].find(([, timer]) => timer.ms === ms);
        assert.ok(entry, 'Expected timer: ' + ms);
        timers.delete(entry[0]);
        entry[1].fn();
    };
    return { node, messages, statuses, responses, timers, count, run };
}
const validAlert = '<EventNotificationAlert><eventType>futureEvent</eventType><channelID>1</channelID></EventNotificationAlert>';
const heartbeat = '<EventNotificationAlert><eventType>videoloss</eventType><eventState>inactive</eventState><activePostCount>0</activePostCount></EventNotificationAlert>';
const failures = app => app.messages.filter(msg => msg.errorDescription && msg.payload === true);
const recoveries = app => app.messages.filter(msg => msg.errorDescription === '' && msg.payload === false);
const events = app => app.messages.filter(msg => msg.type === 'event');
const part = (type, body) => `--frame\r\nContent-Type: ${type}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}\r\n`;

test('A newly deployed subscriber receives an existing connection error exactly once', async t => {
    const app = await setup(t, { config: { heartbeattimerdisconnectionlimit: 1 } });
    await connect(app);
    app.run(40000);
    const messages = [], statuses = [];
    const client = { id: 'new-alarm', topic: 'new', sendPayload: message => messages.push(message), setNodeStatus: status => statuses.push(status) };
    app.node.addClient(client);
    app.node.addClient(client);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].payload, true);
    assert.equal(statuses.at(-1).fill, 'red');
    await connect(app, 2000);
    app.responses.at(-1).write(heartbeat);
    await until(() => app.node.isConnected);
    assert.equal(messages.filter(message => message.errorDescription === '' && message.payload === false).length, 1);
});

async function connect(app, wait = 10000) {
    const previous = app.responses.length;
    app.run(wait);
    await until(() => app.responses.length > previous && app.count(40000) === 1);
}

test('HTTP headers alone never mark the initial alarm connection healthy', async t => {
    const app = await setup(t);
    assert.equal(app.node.isConnected, false);
    await connect(app);
    assert.equal(app.node.isConnected, false);
    assert.equal(app.statuses.some(status => status.fill === 'green'), false);
    assert.equal(recoveries(app).length, 0);
    app.responses[0].write(heartbeat);
    await until(() => app.node.isConnected);
    assert.equal(recoveries(app).length, 0, 'Initial success is not a recovery from a reported failure');
    assert.equal(app.node.heartBeatTimerDisconnectionCounter, 0);
    assert.equal(events(app).length, 1);
});

test('Startup failures reach the threshold; silent HTTP reconnects never emit recovery', async t => {
    const app = await setup(t);
    await connect(app);
    app.run(40000);
    await until(() => app.count(2000));
    assert.equal(failures(app).length, 0);
    await connect(app, 2000);
    app.run(40000);
    await until(() => app.count(4000));
    assert.equal(failures(app).length, 1, 'Offline startup reports the first threshold crossing');
    await connect(app, 4000);
    assert.equal(app.node.isConnected, false);
    assert.equal(recoveries(app).length, 0);
    app.run(40000);
    await until(() => app.count(8000));
    assert.equal(failures(app).length, 1, 'Persistent failure emits only one error transition');
    await connect(app, 8000);
    app.responses.at(-1).write(validAlert);
    await until(() => app.node.isConnected);
    assert.equal(recoveries(app).length, 1);
    assert.equal(events(app).length, 1, 'An event without state remains available to Raw clients');
    app.run(40000);
    await until(() => app.count(2000));
    assert.equal(app.node.heartBeatTimerDisconnectionCounter, 1, 'A valid event reset the consecutive failures');
});

test('Malformed multipart bytes do not reset consecutive failures or reconnect backoff', async t => {
    const app = await setup(t, { contentType: 'multipart/mixed; boundary=frame' });
    await connect(app);
    app.responses.at(-1).write('--frame\r\nmalformed header\r\n\r\n');
    await until(() => app.count(2000));
    assert.equal(app.node.heartBeatTimerDisconnectionCounter, 1);
    await connect(app, 2000);
    app.responses.at(-1).write('--frame\r\nmalformed header\r\n\r\n');
    await until(() => app.count(4000));
    assert.equal(app.node.heartBeatTimerDisconnectionCounter, 2);
    assert.equal(failures(app).length, 1);
    assert.equal(recoveries(app).length, 0);
    assert.equal(app.node.isConnected, false);
});

for (const [type, body] of [
    ['application/xml', '<EventNotificationAlert><eventType>vmd</eventType><eventState>active</EventNotificationAlert>'],
    ['application/json', '{"eventType":"vmd",}']
]) {
    test(`Malformed length-framed ${type} causes reconnect and never delivers a partial alarm`, async t => {
        const app = await setup(t, { contentType: 'multipart/mixed; boundary=frame', config: { heartbeattimerdisconnectionlimit: 1 } });
        await connect(app);
        app.responses[0].write(part(type, body));
        await until(() => app.count(2000));
        assert.equal(events(app).length, 0);
        assert.equal(failures(app).length, 1);
        assert.equal(app.node.isConnected, false);
        assert.equal(app.timers.size, 1, 'Parse error, socket error and close share one reconnect');
    });
}

test('Unrelated stream bytes cannot postpone the valid-alert watchdog indefinitely', async t => {
    const app = await setup(t);
    await connect(app);
    const originalWatchdog = [...app.timers.keys()][0];
    app.responses[0].write('   ');
    await delay(10);
    assert.equal([...app.timers.keys()][0], originalWatchdog);
    assert.equal(app.node.isConnected, false);
    app.run(40000);
    await until(() => app.count(2000));
});

test('JSON CID alerts restore health while preserving their original Raw payload shape', async t => {
    const app = await setup(t, { contentType: 'multipart/mixed; boundary=frame', config: { heartbeattimerdisconnectionlimit: 1 } });
    await connect(app);
    app.run(40000);
    await until(() => app.count(2000));
    await connect(app, 2000);
    const payload = { CIDEvent: { code: 3103, type: 'zoneAlarm', zone: 0 }, vendorField: 'preserved' };
    app.responses.at(-1).write(part('application/json', JSON.stringify(payload)));
    await until(() => app.node.isConnected);
    assert.equal(recoveries(app).length, 1);
    assert.equal(events(app).length, 1);
    assert.equal(JSON.stringify(events(app)[0].payload), JSON.stringify(payload));
});

test('Well-formed JSON metadata is available to Raw clients without declaring alarm recovery', async t => {
    const app = await setup(t, { contentType: 'multipart/mixed; boundary=frame' });
    await connect(app);
    app.responses[0].write(part('application/json', '{"metadata":{"temperature":21}}'));
    await until(() => events(app).length === 1);
    assert.equal(app.node.isConnected, false);
    assert.equal(recoveries(app).length, 0);
});

test('Wrapped SmartEvent JSON proves stream health and stays wrapped for Intelligent clients', async t => {
    const app = await setup(t, { contentType: 'multipart/mixed; boundary=frame' });
    await connect(app);
    const payload = { SmartEvent: { eventType: 'futureSmart', eventState: 'active' } };
    app.responses[0].write(part('application/json', JSON.stringify(payload)));
    await until(() => app.node.isConnected);
    assert.equal(events(app).length, 1);
    assert.equal(JSON.stringify(events(app)[0].payload), JSON.stringify(payload));
});

test('A length-framed batch of valid XML alerts preserves all events', async t => {
    const app = await setup(t, { contentType: 'multipart/mixed; boundary=frame' });
    await connect(app);
    app.responses[0].write(part('application/xml', validAlert + heartbeat));
    await until(() => events(app).length === 2);
    assert.equal(app.node.isConnected, true);
    assert.equal(failures(app).length, 0);
    assert.equal(events(app)[0].payload.eventType, 'futureEvent');
    assert.equal(events(app)[1].payload.eventType, 'videoloss');
});
