'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const helper = require('../nodes/utils/deviceReachability');
const source = fs.readFileSync(require.resolve('../nodes/hikvisionUltimateDeviceStatus.js'), 'utf8');

function setup(t, config = {}, handler) {
    const app = { now: 0, timers: new Map(), nodes: new Map(), calls: [], messages: [], statuses: [], errors: [], active: 0, peak: 0, closeCount: 0 };
    let timerID = 0, Constructor;
    const closing = [];
    class TestDate extends Date {
        constructor(...args) { super(...(args.length ? args : [app.now])); }
        static now() { return app.now; }
    }
    const success = (reachable = true, httpStatus = 200) => ({ reachable, httpStatus, checkedAt: new TestDate().toISOString(), responseTime: 10, error: reachable ? null : { code: 'HTTP_' + httpStatus, message: 'Test failure' } });
    const probe = {
        async check(device) {
            app.calls.push(device);
            app.active++;
            app.peak = Math.max(app.peak, app.active);
            let cancel;
            const abort = new Promise(resolve => { cancel = () => resolve(success(false, null)); closing.push(cancel); });
            try { return await Promise.race([handler ? handler(device, success, app) : Promise.resolve(success(!!device)), abort]); }
            finally { app.active--; closing.splice(closing.indexOf(cancel), 1); }
        },
        close() { app.closeCount++; for (const cancel of closing.slice()) cancel(); }
    };
    const ids = config.devices || ['one', 'two'];
    if (Array.isArray(ids)) ids.forEach(id => app.nodes.set(id, { id, name: 'Camera ' + id, host: 'camera-' + id, type: 'Hikvision-config', credentials: { password: 'private' } }));
    const RED = { nodes: {
        registerType(type, ctor) { assert.equal(type, 'hikvisionUltimateDeviceStatus'); Constructor = ctor; },
        getNode(id) { return app.nodes.get(id); },
        createNode(node) {
            const emitter = new EventEmitter();
            node.on = emitter.on.bind(emitter);
            node.emit = emitter.emit.bind(emitter);
            node.send = output => app.messages.push(output);
            node.status = status => app.statuses.push(status);
            node.warn = message => app.errors.push(message);
            node.error = message => app.errors.push(message);
        }
    } };
    const context = { module: { exports: {} }, require() { return { ...helper, createDeviceProbe(options) { app.probeOptions = options; return probe; } }; }, Date: TestDate,
        setTimeout(fn, ms) { const id = ++timerID; app.timers.set(id, { fn, at: app.now + ms }); return id; },
        clearTimeout(id) { app.timers.delete(id); }
    };
    vm.runInNewContext(source, context);
    context.module.exports(RED);
    app.node = new Constructor({ devices: ids, topic: 'monitor', ...config });
    app.input = () => new Promise(resolve => app.node.emit('input', {}, undefined, resolve));
    app.advance = ms => { app.now += ms; };
    app.fire = async ms => {
        app.advance(ms);
        const entry = [...app.timers].find(([, timer]) => timer.at <= app.now);
        assert.ok(entry, 'Expected a scheduled check');
        app.timers.delete(entry[0]);
        await entry[1].fn();
    };
    app.events = () => app.messages.filter(output => output[1]).map(output => output[1]);
    app.summaries = () => app.messages.filter(output => output[0]).map(output => output[0]);
    app.close = () => new Promise(resolve => app.node.emit('close', false, resolve));
    t.after(async () => { await app.close(); assert.equal(app.timers.size, 0); assert.equal(app.active, 0); });
    return app;
}

test('Automatic startup checks each selected device and schedules the next cycle after completion', async t => {
    const app = setup(t);
    assert.equal(app.calls.length, 0);
    assert.equal(app.probeOptions.timeoutMs, 5000);
    await app.fire(1000);
    assert.deepEqual(app.events().map(msg => msg.payload), [true, true]);
    assert.deepEqual(app.events().map(msg => msg.device.id), ['one', 'two']);
    assert.equal(app.events()[0].topic, 'monitor');
    assert.equal(app.summaries()[0].payload, true);
    assert.equal(app.summaries()[0].available, 2);
    assert.equal(app.statuses.at(-1).fill, 'green');
    assert.equal([...app.timers.values()][0].at, 31000);
    assert.doesNotMatch(JSON.stringify(app.messages), /private|credentials/);
});

test('Initial unknown, failure threshold, unchanged outage and immediate recovery', async t => {
    let online = false;
    const app = setup(t, { devices: ['one'], interval: 0 }, (device, result) => result(online, online ? 200 : 500));
    await app.input();
    assert.equal(app.events().length, 0);
    assert.equal(app.summaries().at(-1).payload, null);
    assert.equal(app.summaries().at(-1).unknown, 1);
    app.advance(5000); await app.input();
    assert.equal(app.events().at(-1).payload, false);
    assert.equal(app.events().at(-1).consecutiveFailures, 2);
    assert.equal(app.statuses.at(-1).fill, 'red');
    app.advance(5000); await app.input();
    assert.equal(app.events().length, 1);
    online = true;
    app.advance(5000); await app.input();
    assert.deepEqual(app.events().map(msg => msg.payload), [false, true]);
    assert.equal(app.events().at(-1).lastSuccess, new Date(app.now).toISOString());
    assert.equal(app.events().at(-1).consecutiveFailures, 0);
    assert.equal(app.timers.size, 0);
});

test('An isolated failure preserves confirmed availability and exposes the failed latest check', async t => {
    let online = true;
    const app = setup(t, { devices: ['one'], interval: 0 }, (device, result) => result(online, online ? 200 : 500));
    await app.input();
    online = false;
    app.advance(5000); await app.input();
    assert.equal(app.events().length, 1);
    assert.equal(app.summaries().at(-1).payload, true);
    assert.equal(app.summaries().at(-1).devices[0].reachable, false);
    assert.equal(app.summaries().at(-1).devices[0].available, true);
    online = true;
    app.advance(5000); await app.input();
    assert.equal(app.events().length, 1);
    online = false;
    app.advance(5000); await app.input();
    assert.equal(app.events().length, 1, 'A success resets consecutive failures');
    app.advance(5000); await app.input();
    assert.deepEqual(app.events().map(msg => msg.payload), [true, false]);
});

test('Mixed devices keep independent states and aggregate a confirmed outage', async t => {
    const app = setup(t, { devices: ['online', 'offline', 'pending'], interval: 0, failureThreshold: 1 }, (device, result) => result(device.id !== 'offline', device.id === 'offline' ? 500 : 200));
    await app.input();
    const summary = app.summaries().at(-1);
    assert.equal(summary.payload, false);
    assert.equal(summary.available, 2);
    assert.equal(summary.unavailable, 1);
    assert.equal(summary.total, 3);
});

test('Input bursts cannot recheck a device or count cached failures toward the threshold', async t => {
    const app = setup(t, { devices: ['one'], interval: 0 }, (device, result) => result(false, 500));
    await app.input();
    for (let i = 0; i < 10; i++) await app.input();
    assert.equal(app.calls.length, 1);
    assert.equal(app.events().length, 0);
    assert.equal(app.summaries().at(-1).devices[0].consecutiveFailures, 1);
    app.advance(5000); await app.input();
    assert.equal(app.calls.length, 2);
    assert.equal(app.events().at(-1).payload, false);
});

for (const code of [401, 403, 429, 503]) {
    test('HTTP ' + code + ' imposes a 30 second cooldown, including input-triggered checks', async t => {
        const app = setup(t, { devices: ['one'], interval: 0 }, (device, result) => result(false, code));
        await app.input();
        app.advance(29999); await app.input();
        assert.equal(app.calls.length, 1);
        app.advance(1); await app.input();
        assert.equal(app.calls.length, 2);
        assert.equal(app.events().at(-1).payload, false);
    });
}

test('Four concurrent requests maximum, individual results stream promptly and input triggers coalesce', async t => {
    const release = [];
    const app = setup(t, { devices: ['1', '2', '3', '4', '5', '6'], interval: 0 }, (device, result) => new Promise(resolve => release.push(() => resolve(result()))));
    const checking = app.input();
    assert.equal(app.active, 4);
    await app.input();
    assert.equal(app.calls.length, 4);
    release.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.events().length, 1);
    assert.equal(app.calls.length, 5);
    while (release.length) { release.shift()(); await new Promise(resolve => setImmediate(resolve)); }
    await checking;
    assert.equal(app.peak, 4);
    assert.equal(app.events().length, 6);
    assert.equal(app.summaries().length, 1);
});

test('A replaced configuration is resolved again without a stale cached success', async t => {
    const app = setup(t, { devices: ['one'], interval: 0 });
    await app.input();
    const fresh = { ...app.nodes.get('one'), name: 'Replacement', credentials: { password: 'new-secret' } };
    app.nodes.set('one', fresh);
    await app.input();
    assert.equal(app.calls.length, 2, 'New credentials bypass the old configuration cooldown');
    assert.equal(app.calls.at(-1), fresh);
    assert.equal(app.events().at(-1).device.name, 'Replacement');
    assert.doesNotMatch(JSON.stringify(app.messages), /new-secret/);
});

test('A result arriving from a removed configuration cannot mark the replacement online', async t => {
    let release;
    const app = setup(t, { devices: ['one'], interval: 0 }, (device, result) => new Promise(resolve => { release = () => resolve(result()); }));
    const checking = app.input();
    app.nodes.set('one', { ...app.nodes.get('one'), name: 'Replacement' });
    release(); await checking;
    assert.equal(app.events().length, 0);
    assert.equal(app.summaries().at(-1).payload, null);
});

test('Missing and disabled configurations cannot make an empty or partial list healthy', async t => {
    const app = setup(t, { devices: ['one', 'two'], interval: 0, failureThreshold: 1 });
    app.nodes.delete('two');
    await app.input();
    assert.equal(app.summaries().at(-1).payload, false);
    assert.equal(app.summaries().at(-1).total, 2);
    assert.equal(app.events().find(msg => msg.device.id === 'two').payload, false);
});

test('A configuration that remains closed fails checks instead of remaining unknown forever', async t => {
    const app = setup(t, { devices: ['one'], interval: 0, failureThreshold: 1 }, (device, result) => result(!device.isClosing, 500));
    app.nodes.get('one').isClosing = true;
    await app.input();
    assert.equal(app.summaries().at(-1).payload, false);
    assert.equal(app.events().at(-1).payload, false);
});

test('Native config references use remapped IDs and preserve a missing device in a mixed selection', async t => {
    const app = setup(t, { devices: ['original'], device_Hikvision_0: 'remapped', device_Speaker_0: 'missing', deviceCount: 2, interval: 0, failureThreshold: 1 });
    app.nodes.set('remapped', { id: 'remapped', type: 'Hikvision-config', name: 'Subflow camera' });
    await app.input();
    assert.equal(app.calls[0].id, 'remapped');
    assert.equal(app.calls[1], undefined);
    assert.equal(app.summaries().at(-1).total, 2);
    assert.equal(app.summaries().at(-1).payload, false);
    assert.deepEqual(app.events().map(msg => msg.device.id), ['remapped', 'missing']);
});

test('Every-check mode emits fresh checks; downstream mutations cannot change cached snapshots', async t => {
    const app = setup(t, { devices: ['one'], interval: 0, changesOnly: false });
    await app.input();
    app.events()[0].device.name = 'Changed downstream';
    app.summaries()[0].devices[0].device.host = 'Changed downstream';
    await app.input();
    assert.equal(app.events().length, 1, 'A rate limited trigger did not perform a new check');
    assert.equal(app.summaries().at(-1).devices[0].device.name, 'Camera one');
    assert.equal(app.summaries().at(-1).devices[0].device.host, 'camera-one');
    app.advance(5000); await app.input();
    assert.equal(app.events().length, 2);
    assert.equal(app.events().at(-1).changed, false);
});

test('Close cancels ongoing checks, suppresses late results and completes without scheduling again', async t => {
    const app = setup(t, {}, () => new Promise(() => {}));
    const checking = app.input();
    await app.close();
    await checking;
    assert.equal(app.messages.length, 0);
    assert.equal(app.timers.size, 0);
    assert.equal(app.active, 0);
    await app.input();
    assert.equal(app.calls.length, 2);
});

test('Invalid selections and timing values never start network checks', async t => {
    for (const config of [{ devices: [] }, { devices: ['one', 'one'] }, { devices: ['one', 7] }, { devices: 'one' },
        { devices: Array.from({ length: 65 }, (_, i) => String(i)) }, { interval: 1 }, { interval: '' }, { timeout: 0 }, { timeout: 61 }, { failureThreshold: 0 }]) {
        const app = setup(t, config);
        await app.input();
        assert.equal(app.calls.length, 0);
        assert.equal(app.timers.size, 0);
        assert.equal(app.statuses.at(-1).fill, 'red');
    }
});
