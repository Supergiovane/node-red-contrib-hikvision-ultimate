/* Alarm output semantics and filter lifecycle, using an isolated manual timer clock. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { createRequire } = require('module');
const { documentedEventGroups, legacyCatalogEventIds, canonicalEventType, isSameEventType } = require('../nodes/utils/alarmEventAliases');

class Clock {
    constructor() { this.now = 0; this.nextID = 1; this.timers = new Map(); }
    add(fn, delay, repeat = false) {
        const id = this.nextID++;
        this.timers.set(id, { fn, at: this.now + Number(delay), delay: Number(delay), repeat });
        return id;
    }
    clear(id) { this.timers.delete(id); }
    tick(milliseconds) {
        const end = this.now + milliseconds;
        let iterations = 0;
        while (true) {
            const pending = [...this.timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
            if (!pending.length) break;
            assert.ok(iterations++ < 10000, 'Timer loop must stay bounded');
            const [id, timer] = pending[0];
            this.now = timer.at;
            if (timer.repeat) timer.at += timer.delay;
            else this.timers.delete(id);
            timer.fn();
        }
        this.now = end;
    }
}
function runtime() {
    const clock = new Clock();
    const clients = new Map(), nodes = [];
    const server = { debug: false, addClient(node) { clients.set(node.id, node); }, removeClient(node) { clients.delete(node.id); } };
    let Constructor;
    const RED = {
        log: { info() {}, warn() {}, error() {}, debug() {} },
        nodes: {
            getNode() { return server; },
            registerType(type, constructor) { Constructor = constructor; },
            createNode(node) {
                const emitter = new EventEmitter();
                node.on = emitter.on.bind(emitter);
                node.emit = emitter.emit.bind(emitter);
                node.id = 'alarm-' + nodes.length;
                node.messages = [];
                node.statuses = [];
                node.send = output => node.messages.push(output);
                node.status = status => node.statuses.push(status);
                node.warn = () => {};
                nodes.push(node);
            }
        }
    };
    const file = path.resolve(__dirname, '../nodes/hikvisionUltimateAlarm.js');
    const context = {
        module: { exports: {} }, require: createRequire(file), Buffer,
        setTimeout: (fn, delay) => clock.add(fn, delay), clearTimeout: id => clock.clear(id),
        setInterval: (fn, delay) => clock.add(fn, delay, true), clearInterval: id => clock.clear(id)
    };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    context.module.exports(RED);
    return {
        clock, clients,
        create(config = {}) { return new Constructor({ name: 'Alarm', topic: 'alarm/test', server: 'camera', devicetype: 0, reactto: 'customFutureEvent', channelID: '0', filterzone: '0', ...config }); },
        close(node) {
            let done = false;
            node.emit('close', () => { done = true; });
            assert.ok(done, 'Alarm close callback completes');
        },
        finish() {
            for (const node of nodes) this.close(node);
            assert.strictEqual(clock.timers.size, 0, 'All timers cleaned up');
            assert.strictEqual(clients.size, 0, 'All clients unregistered');
        }
    };
}
const deliver = (node, payload) => node.sendPayload({ payload, type: 'event' });
const event = overrides => ({ eventType: 'customFutureEvent', eventState: 'active', channelID: 4, ...overrides });
const alarms = node => node.messages.filter(outputs => outputs[0]).map(outputs => outputs[0]);
const cid = (code, zone = 0) => ({ CIDEvent: { type: 'zoneAlarm', code, zone } });
const tests = [];
function test(name, callback) { tests.push({ name, callback }); }

test('Custom event types, aliases, channel fallback and state transitions', app => {
    const node = app.create({ reactto: 'olderAlias, customFutureEvent', channelID: '7' });
    deliver(node, event({ channelID: undefined, dynChannelID: 7 }));
    deliver(node, event({ channelID: 8 }));
    deliver(node, event({ channelID: undefined, dynChannelID: 7, eventState: 'INACTIVE' }));
    assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true, false]);
    assert.strictEqual(alarms(node)[0].channelid, 7);
});

test('Malformed channel IDs cannot route a reset to a selected camera', app => {
    const node = app.create({ channelID: '4' });
    for (const channelID of [[4], { toString: null }, null, false, '4.5']) {
        assert.doesNotThrow(() => deliver(node, event({ channelID, eventState: 'inactive' })));
    }
    assert.strictEqual(alarms(node).length, 0);
});

test('Malformed descriptive metadata does not prevent a valid correlated reset', app => {
    const node = app.create();
    deliver(node, event());
    assert.doesNotThrow(() => deliver(node, event({ eventType: 'duration', eventState: 'inactive', eventDescription: { toString: null }, DurationList: { Duration: { relationEvent: 'customFutureEvent' } } })));
    assert.deepStrictEqual(alarms(node).map(message => message.payload), [true, false]);
});

test('Missing, null and unknown state never emit an alarm reset', app => {
    const node = app.create();
    deliver(node, event());
    for (const state of [undefined, null, '', 'unknown', 'reset', 'false', false, 0, 1, {}, { state: 'inactive' }]) {
        deliver(node, event({ eventState: state }));
    }
    assert.strictEqual(alarms(node).length, 1);
    assert.strictEqual(alarms(node)[0].payload, true);
    assert.strictEqual(node.isNodeInAlarm, true);
});

test('An array state cannot masquerade as inactive or active', app => {
    const node = app.create();
    deliver(node, event());
    deliver(node, event({ eventState: ['inactive'] }));
    deliver(node, event({ eventState: ['active'] }));
    assert.strictEqual(alarms(node).length, 1, 'Malformed repeated state elements must not be coerced into a valid alarm state');
    assert.strictEqual(node.isNodeInAlarm, true);
});

test('Malformed and null payloads do not throw or emit alarms', app => {
    const node = app.create();
    for (const message of [undefined, null, 0, false, '', {}, { payload: null }, { payload: undefined }, { payload: 'bad' }, { payload: 3 }, { payload: false }]) {
        assert.doesNotThrow(() => node.sendPayload(message));
    }
    for (const payload of [{}, { eventType: null }, { eventType: 'customFutureEvent', DurationList: null },
        { eventType: 'duration', eventState: 'inactive', DurationList: { Duration: null } },
        { eventType: 'unrelated', eventState: 'inactive', DetectionRegionList: { DetectionRegionEntry: [null, 1, false] } }]) {
        assert.doesNotThrow(() => deliver(node, payload));
    }
    assert.strictEqual(alarms(node).length, 0);
});

test('Selected region may be the second DetectionRegionEntry', app => {
    const node = app.create({ filterzone: '5' });
    const tma = { currTemperature: 61.5 };
    deliver(node, event({ DetectionRegionList: { DetectionRegionEntry: [{ regionID: 2 }, { regionID: 5, TMA: tma }] } }));
    assert.strictEqual(alarms(node).length, 1);
    assert.strictEqual(alarms(node)[0].zone, 5);
    assert.strictEqual(alarms(node)[0].tma, tma);
    deliver(node, event({ eventState: 'inactive', DetectionRegionList: { DetectionRegionEntry: [{ regionID: 1 }, { regionID: 2 }] } }));
    assert.strictEqual(alarms(node).length, 1, 'A different region must not reset the selected region');
});

test('Image extension survives forwarding from the config node', app => {
    const node = app.create();
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    node.sendPayload({ payload: image, type: 'img', extension: 'jpg' });
    assert.strictEqual(node.messages.length, 1);
    assert.strictEqual(node.messages[0][0], null);
    assert.strictEqual(node.messages[0][2].extension, 'jpg');
    assert.strictEqual(node.messages[0][2].payload, image);
    node.sendPayload({ payload: image, type: 'img' }, 'png');
    assert.strictEqual(node.messages[1][2].extension, 'png');
});

test('Correlated duration event resets a running alarm, unrelated duration does not', app => {
    const node = app.create({ reactto: 'fielddetection', channelID: '4', filterzone: '3' });
    deliver(node, event({ eventType: 'fielddetection', DetectionRegionList: { DetectionRegionEntry: { regionID: 3 } } }));
    deliver(node, event({ eventType: 'duration', eventState: 'inactive', DurationList: { Duration: { relationEvent: 'linedetection' } } }));
    assert.strictEqual(alarms(node).length, 1);
    deliver(node, event({ eventType: 'duration', eventState: 'inactive', DurationList: { Duration: { relationEvent: 'fielddetection' } } }));
    assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true, false]);
});

test('Thermometry alias remains separate from TMPA', app => {
    const node = app.create({ reactto: 'thermometry' });
    deliver(node, event({ eventType: 'TMA' }));
    deliver(node, event({ eventType: 'TMPA', eventState: 'inactive' }));
    assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true]);
});

test('JSON event wrapper and array are handled without changing the original envelope', app => {
    const node = app.create();
    const first = { EventNotificationAlert: event() };
    const second = { EventNotificationAlert: [event({ eventState: 'inactive' }), event(), null] };
    deliver(node, first);
    deliver(node, second);
    deliver(node, [event({ eventState: 'inactive' }), null, { eventType: 'unrelated', eventState: 'active' }]);
    assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true, false, true, false]);
    assert.ok(first.EventNotificationAlert, 'Original wrapper remains available to Raw clients');
    assert.ok(Array.isArray(second.EventNotificationAlert));
});

test('CID filter timers and period closures remain independent between nodes', app => {
    const a = app.create({ reactto: 'CID:1131-3131', devicetype: 1, filterzone: '1', alarmfilterduration: 2, alarmfilterperiod: 10 });
    const b = app.create({ reactto: 'CID:1131-3131', devicetype: 1, filterzone: '2', alarmfilterduration: 3, alarmfilterperiod: 20 });
    deliver(a, cid('1131', 0));
    deliver(b, cid('1131', 1));
    app.clock.tick(2000);
    assert.deepStrictEqual(alarms(a).map(msg => msg.payload), [true]);
    assert.strictEqual(alarms(b).length, 0);
    deliver(a, cid('3131', 0));
    app.clock.tick(1000);
    assert.deepStrictEqual(alarms(a).map(msg => msg.payload), [true, false]);
    assert.deepStrictEqual(alarms(b).map(msg => msg.payload), [true]);
    assert.strictEqual(alarms(b)[0].zone, 2);
    deliver(b, cid('3131', 1));
    assert.deepStrictEqual(alarms(b).map(msg => msg.payload), [true, false]);
});

test('A short CID pulse does not emit false before the filtered alarm starts', app => {
    const node = app.create({ reactto: 'CID:1131-3131', devicetype: 1, alarmfilterduration: 3, alarmfilterperiod: 10 });
    deliver(node, cid('1131'));
    app.clock.tick(1000);
    deliver(node, cid('3131'));
    app.clock.tick(1000);
    assert.strictEqual(alarms(node).length, 0);
    deliver(node, cid('1131'));
    app.clock.tick(2000);
    assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true]);
});

test('Closing one CID node cancels its timers and leaves the other node running', app => {
    const a = app.create({ reactto: 'CID:1131-3131', devicetype: 1, alarmfilterduration: 2, alarmfilterperiod: 10 });
    const b = app.create({ reactto: 'CID:1131-3131', devicetype: 1, alarmfilterduration: 2, alarmfilterperiod: 10 });
    deliver(a, cid('1131'));
    deliver(b, cid('1131'));
    app.close(a);
    deliver(a, cid('3131'));
    app.clock.tick(2000);
    assert.strictEqual(a.messages.length, 0);
    assert.deepStrictEqual(alarms(b).map(msg => msg.payload), [true]);
    assert.strictEqual(app.clients.size, 1);
});

test('Malformed CID zones cannot cause an alarm or reset in zone 1', app => {
    const node = app.create({ reactto: 'CID:1131-3131', devicetype: 1, filterzone: '1' });
    deliver(node, cid('1131', 0));
    for (const zone of [null, '', false, [], [0], {}, undefined]) deliver(node, { CIDEvent: { type: 'zoneAlarm', code: '3131', zone } });
    assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true]);
});

test('Malformed CID code and type arrays cannot masquerade as a reset', app => {
    const node = app.create({ reactto: 'CID:1131-3131', devicetype: 1, filterzone: '1' });
    deliver(node, cid('1131', 0));
    deliver(node, cid(['3131'], 0));
    deliver(node, { CIDEvent: { type: ['zoneAlarm'], code: '3131', zone: 0 } });
    assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true]);
});

test('A malformed region ID cannot bypass the selected region and reset an alarm', app => {
    const node = app.create({ filterzone: '5' });
    deliver(node, event({ DetectionRegionList: { DetectionRegionEntry: { regionID: 5 } } }));
    for (const regionID of [null, '', false, [], [0], {}]) {
        deliver(node, event({ eventState: 'inactive', DetectionRegionList: { DetectionRegionEntry: { regionID } } }));
    }
    assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true]);
});

test('Device properties named hasOwnProperty cannot crash payload handling', app => {
    const node = app.create();
    assert.doesNotThrow(() => deliver(node, event({ hasOwnProperty: null })));
    assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true]);
    assert.doesNotThrow(() => deliver(node, event({ DetectionRegionList: { DetectionRegionEntry: { regionID: 1, hasOwnProperty: 'device-field' } } })));
    assert.strictEqual(alarms(node).length, 2);
});

test('Video-loss heartbeats never reset a real alarm and active events are retained', app => {
    const node = app.create({ reactto: 'videoloss' });
    deliver(node, event({ eventType: 'videoloss', activePostCount: 1 }));
    deliver(node, event({ eventType: 'videoloss', eventState: 'inactive', activePostCount: 0 }));
    deliver(node, event({ eventType: 'videoloss', eventState: 'inactive', activePostCount: 1 }));
    assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true], 'Both known inactive heartbeat forms are ignored');
    deliver(node, event({ eventType: 'videoloss', eventState: 'active', activePostCount: 0 }));
    deliver(node, event({ eventType: 'videoloss', eventState: 'inactive', activePostCount: 2 }));
    assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true, true, false], 'Real start/reset events still pass');
});

test('A correlated reset may appear second in a Duration array', app => {
    const node = app.create({ reactto: 'fielddetection' });
    deliver(node, event({ eventType: 'fielddetection' }));
    deliver(node, event({ eventType: 'duration', eventState: 'inactive', DurationList: { Duration: [{ relationEvent: 'linedetection' }, { relationEvent: 'fielddetection' }] } }));
    assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true, false]);
});

test('Saved VMD and motionDetection IDs and alias lists accept both event names once', app => {
    for (const reactto of ['vmd', 'motionDetection', 'VMD', 'MoTiOnDeTeCtIoN', 'vmd,motionDetection', 'motionDetection,vmd', ' VMD , motionDetection ']) {
        const node = app.create({ reactto });
        for (const eventType of ['VMD', 'motionDetection', 'vMd', 'MOTIONDETECTION']) {
            deliver(node, event({ eventType, eventState: 'active' }));
            deliver(node, event({ eventType, eventState: 'inactive' }));
        }
        assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true, false, true, false, true, false, true, false], reactto + ' accepts each wire event exactly once');
    }
});

test('VMD aliases match active and inactive duration relations in either direction', app => {
    for (const [reactto, relationEvent] of [['vmd', 'motionDetection'], ['motionDetection', 'VMD'], ['vmd,motionDetection', 'MOTIONDETECTION']]) {
        const node = app.create({ reactto });
        deliver(node, event({ eventType: 'duration', DurationList: { Duration: { relationEvent } } }));
        deliver(node, event({ eventType: 'duration', eventState: 'inactive', DurationList: { Duration: [{ relationEvent: 'linedetection' }, { relationEvent }] } }));
        assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true, false], reactto + ' handles the correlated duration alias once');
    }
});

test('VMD alias matching preserves selected channel and region filters', app => {
    for (const [reactto, eventType] of [['vmd', 'motionDetection'], ['motionDetection', 'VMD']]) {
        const node = app.create({ reactto, channelID: '4', filterzone: '2' });
        const region = regionID => ({ DetectionRegionEntry: { regionID } });
        deliver(node, event({ eventType, DetectionRegionList: region(2) }));
        deliver(node, event({ eventType, eventState: 'inactive', channelID: 5, DetectionRegionList: region(2) }));
        deliver(node, event({ eventType, eventState: 'inactive', DetectionRegionList: region(3) }));
        assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true]);
        deliver(node, event({ eventType, eventState: 'inactive', DetectionRegionList: region(2) }));
        assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true, false]);
    }
});

test('Motion aliases do not match line crossing, TMPA or other motion event IDs', app => {
    for (const reactto of ['vmd', 'motionDetection', 'vmd,motionDetection']) {
        const node = app.create({ reactto });
        deliver(node, event({ eventType: 'VMD' }));
        for (const eventType of ['linedetection', 'TMPA', 'motionDetectionExtra', 'VMDHumanVehicle']) {
            deliver(node, event({ eventType, eventState: 'active' }));
            deliver(node, event({ eventType, eventState: 'inactive' }));
            deliver(node, event({ eventType: 'duration', eventState: 'inactive', DurationList: { Duration: { relationEvent: eventType } } }));
        }
        assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true], reactto + ' leaves unrelated alarms separate');
        deliver(node, event({ eventType: 'motionDetection', eventState: 'inactive' }));
        assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true, false]);
    }
});

test('Every documented ISAPI alias pair matches both directions, case variants and lists once', app => {
    for (const group of documentedEventGroups) {
        for (const reactto of [group[0], group[1], group[0].toUpperCase(), group[1].toUpperCase(), group.join(','), group.slice().reverse().join(',')]) {
            const node = app.create({ reactto });
            for (const eventType of [group[0], group[1], group[0].toUpperCase(), group[1].toUpperCase()]) {
                deliver(node, event({ eventType, eventState: 'active' }));
                deliver(node, event({ eventType, eventState: 'inactive' }));
            }
            assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true, false, true, false, true, false, true, false], reactto + ' receives exactly one output per event');
        }
    }
});

test('Every documented ISAPI alias pair matches duration relations in both directions', app => {
    for (const group of documentedEventGroups) {
        for (const [reactto, relationEvent] of [[group[0], group[1]], [group[1], group[0]], [group.join(','), group[1].toUpperCase()]]) {
            const node = app.create({ reactto });
            deliver(node, event({ eventType: 'duration', DurationList: { Duration: { relationEvent } } }));
            deliver(node, event({ eventType: 'duration', eventState: 'inactive', DurationList: { Duration: [{ relationEvent: 'unrelatedFutureEvent' }, { relationEvent }] } }));
            assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true, false], reactto + ' resolves a correlated duration alias exactly once');
        }
    }
});

test('Documented aliases do not merge unrelated tamper, face, fire or temperature events', app => {
    const separateSets = [
        ['shelteralarm', 'hide', 'block'],
        ['facedetection', 'faceDetect'],
        ['faceCapture', 'facedetection', 'faceDetect'],
        ['fireDetection', 'smokeDetection', 'smokeAndFireDetection'],
        ['temperature', 'thermometry', 'tmpa'],
        ['temperature', 'tma', 'tmpa']
    ];
    for (const names of separateSets) {
        for (const selected of names) {
            const node = app.create({ reactto: selected });
            deliver(node, event({ eventType: selected }));
            for (const different of names.filter(name => name !== selected)) {
                assert.strictEqual(isSameEventType(selected, different), false, selected + ' differs from ' + different);
                deliver(node, event({ eventType: different }));
                deliver(node, event({ eventType: different, eventState: 'inactive' }));
                deliver(node, event({ eventType: 'duration', eventState: 'inactive', DurationList: { Duration: { relationEvent: different } } }));
            }
            assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true], selected + ' ignores unrelated events and duration resets');
        }
    }
});

test('Thermal compatibility stays outside the official alias registry', app => {
    assert.strictEqual(isSameEventType('thermometry', 'tma'), false, 'The official registry must not claim this legacy compatibility as a documented alias');
    for (const [reactto, eventType] of [['thermometry', 'TMA'], ['tma', 'thermometry']]) {
        const node = app.create({ reactto });
        deliver(node, event({ eventType }));
        deliver(node, event({ eventType: 'TMPA', eventState: 'inactive' }));
        deliver(node, event({ eventType, eventState: 'inactive' }));
        assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true, false]);
    }
});

test('Alias registry leaves unknown IDs intact and rejects malformed values', () => {
    assert.strictEqual(canonicalEventType('FutureCustomEvent'), 'futurecustomevent');
    assert.strictEqual(isSameEventType('FutureCustomEvent', 'FUTURECUSTOMEVENT'), true);
    assert.strictEqual(isSameEventType('FutureCustomEvent', 'futureCustomEventExtra'), false);
    for (const value of [undefined, null, false, 0, {}, [], ['vmd']]) {
        assert.strictEqual(canonicalEventType(value), '');
        assert.strictEqual(isSameEventType(value, value), false);
        assert.strictEqual(isSameEventType('vmd', value), false);
    }
    assert.strictEqual(isSameEventType('', ''), false);
});

test('HTML catalog alias groups agree with the official runtime registry', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../nodes/hikvisionUltimateAlarm.html'), 'utf8');
    const options = html.match(/<select id="node-input-reactto">([\s\S]*?)<\/select>/)[1];
    const entries = [...options.matchAll(/<option value="([^"]+)">([^<]*)<\/option>/g)]
        .filter(match => match[2].includes('(Camera/NVR)'))
        .map(match => match[1].split(','));
    for (const entry of entries.filter(aliases => aliases.length > 1)) {
        for (const alias of entry) assert.strictEqual(isSameEventType(entry[0], alias), true, entry.join(',') + ' must agree with the runtime registry');
    }
    for (const group of documentedEventGroups) {
        const matching = entries.filter(entry => entry.some(alias => isSameEventType(alias, group[0])));
        assert.strictEqual(matching.length, 1, group.join(',') + ' has one canonical catalog entry');
    }
});

test('Five historical catalog typos match cleaned IDs in either direction without duplicate output', app => {
    assert.strictEqual(Object.keys(legacyCatalogEventIds).length, 5);
    for (const [legacy, corrected] of Object.entries(legacyCatalogEventIds)) {
        assert.strictEqual(canonicalEventType(legacy), corrected.toLowerCase());
        for (const reactto of [legacy, corrected, legacy + ',' + corrected, legacy.toUpperCase()]) {
            const node = app.create({ reactto });
            for (const eventType of [legacy, corrected]) {
                deliver(node, event({ eventType, eventState: 'active' }));
                deliver(node, event({ eventType, eventState: 'inactive' }));
            }
            assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true, false, true, false], JSON.stringify(reactto) + ' accepts each form once');
        }
    }
});

test('Historical catalog typos also match duration start and reset relations', app => {
    for (const [legacy, corrected] of Object.entries(legacyCatalogEventIds)) {
        for (const [reactto, relationEvent] of [[legacy, corrected], [corrected, legacy], [legacy + ',' + corrected, corrected.toUpperCase()]]) {
            const node = app.create({ reactto });
            deliver(node, event({ eventType: 'duration', DurationList: { Duration: { relationEvent } } }));
            deliver(node, event({ eventType: 'duration', eventState: 'inactive', DurationList: { Duration: [{ relationEvent: 'unrelatedFutureEvent' }, { relationEvent }] } }));
            assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true, false], JSON.stringify(reactto) + ' resolves a legacy duration relation once');
        }
    }
});

test('Unknown Unicode IDs remain distinct outside the five historical catalog typos', app => {
    for (const [custom, plain] of [
        ['custom_\u200bevent', 'custom_event'],
        ['AID_\u200bpedestrian', 'AID_pedestrian'],
        ['AID_con\u200bgestion', 'AID_congestion'],
        ['AID_\u200b\u200bcongestion', 'AID_congestion'],
        ['AID_\u200ccongestion', 'AID_congestion']
    ]) {
        assert.strictEqual(canonicalEventType(custom), custom.toLowerCase(), 'Unlisted Unicode IDs are preserved');
        assert.strictEqual(isSameEventType(custom, plain), false);
        const node = app.create({ reactto: plain });
        deliver(node, event({ eventType: plain }));
        deliver(node, event({ eventType: custom, eventState: 'inactive' }));
        deliver(node, event({ eventType: 'duration', eventState: 'inactive', DurationList: { Duration: { relationEvent: custom } } }));
        assert.deepStrictEqual(alarms(node).map(msg => msg.payload), [true], 'Unrelated Unicode events must not reset an alarm');
    }
});

let failures = 0;
for (const { name, callback } of tests) {
    const app = runtime();
    try { callback(app); console.log('PASS ' + name); }
    catch (error) { failures += 1; console.error('FAIL ' + name + '\n' + error.stack); }
    finally { app.finish(); }
}
if (failures) process.exitCode = 1;
else console.log(`Alarm runtime tests PASSED (${tests.length} cases).`);
