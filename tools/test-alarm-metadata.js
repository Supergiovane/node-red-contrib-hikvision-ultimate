'use strict';

const nodeTest = require('node:test');
const test = (name, callback) => nodeTest(name, { timeout: 5000 }, callback);
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { createAlarmMetadata } = require('../nodes/utils/alarmMetadata');

const INPUTS = '/ISAPI/System/Video/inputs/channels';
const PROXY_INPUTS = '/ISAPI/ContentMgmt/InputProxy/channels';
const inputList = entries => '<VideoInputChannelList>' + entries.map(([id, name]) => `<VideoInputChannel><id>${id}</id><name>${name}</name></VideoInputChannel>`).join('') + '</VideoInputChannelList>';
const proxyList = entries => '<InputProxyChannelList>' + entries.map(([id, name]) => `<InputProxyChannel><id>${id}</id><name>${name}</name></InputProxyChannel>`).join('') + '</InputProxyChannelList>';
function response(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, text: async () => typeof body === 'string' ? body : JSON.stringify(body), body: { destroy() {} } };
}
function device(overrides = {}, options = {}) {
    const calls = [];
    const data = { [INPUTS]: inputList([[1, 'Ingresso'], [2, 'Garage']]), ...overrides };
    const service = createAlarmMetadata({
        fetch: async (path, requestOptions) => {
            calls.push({ path, options: requestOptions });
            const value = data[path];
            if (typeof value === 'function') return value(requestOptions);
            if (value instanceof Error) throw value;
            if (value && typeof value.ok === 'boolean') return value;
            return response(value || '', value === undefined || value === null ? 404 : 200);
        },
        ...options
    });
    return { service, calls, data };
}
async function until(predicate) {
    const deadline = Date.now() + 1000;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error('Expected metadata request was not started');
        await delay(1);
    }
}
const paths = calls => calls.map(call => call.path);
const named = result => result.channels.filter(channel => channel.name).map(channel => [channel.id, channel.name]);

test('configured channel names preserve numeric-looking names, XML entities and escaped labels', async t => {
    const { service, calls } = device({ [INPUTS]: inputList([[1, '001'], [40, 'Porta &amp; garage'], [999999, '&lt;b&gt;Camera&lt;/b&gt;']]) });
    t.after(() => service.close());
    const result = await service.refresh();
    assert.deepEqual(named(result), [['1', '001'], ['40', 'Porta & garage'], ['999999', '<b>Camera</b>']]);
    assert.deepEqual(paths(calls), [INPUTS]);
    assert.deepEqual(result.zones, []);
    assert.equal(result.status, 'ok');
});

test('configured channel names override observed names and observations survive an offline fetch', async t => {
    const { service, data } = device();
    t.after(() => service.close());
    service.observe({ eventType: 'vmd', channelID: 1, channelName: 'Old event name' });
    assert.equal(service.snapshot().channels.find(channel => channel.id === '1').name, 'Old event name');
    await service.refresh();
    service.observe({ EventNotificationAlert: { eventType: 'vmd', dynChannelID: 1, channelName: 'Still old' } });
    assert.equal(service.snapshot().channels.find(channel => channel.id === '1').name, 'Ingresso');
    service.observe({ eventType: 'futureEvent', channelID: 8, channelName: 'Observed only' });
    data[INPUTS] = new Error('offline');
    const result = await service.refresh('0', '', true);
    assert.equal(result.channels.find(channel => channel.id === '1').name, 'Ingresso');
    assert.equal(result.channels.find(channel => channel.id === '8').name, 'Observed only');
    assert.notEqual(result.status, 'ok');
});

test('channel metadata is cached and simultaneous editor refreshes share one discovery', async t => {
    let now = 1000;
    const { service, calls, data } = device({}, { now: () => now });
    t.after(() => service.close());
    const [one, two] = await Promise.all([service.refresh(), service.refresh()]);
    assert.deepEqual(one, two);
    assert.deepEqual(paths(calls), [INPUTS]);
    data[INPUTS] = inputList([[1, 'Renamed'], [2, 'Garage']]);
    await service.refresh();
    assert.equal(calls.length, 1);
    assert.equal(service.snapshot().channels.find(channel => channel.id === '1').name, 'Ingresso');
    now += 300001;
    const refreshed = await service.refresh();
    assert.equal(calls.length, 2);
    assert.equal(refreshed.channels.find(channel => channel.id === '1').name, 'Renamed');
    await service.refresh('0', '', true);
    assert.equal(calls.length, 3);
});

test('NVR input proxy fallback is queried when the camera input list is unsupported', async t => {
    const { service, calls } = device({ [INPUTS]: null, [PROXY_INPUTS]: proxyList([[33, 'Piano 2'], [48, 'Scala']]) });
    t.after(() => service.close());
    const result = await service.refresh();
    assert.deepEqual(named(result), [['33', 'Piano 2'], ['48', 'Scala']]);
    assert.deepEqual(paths(calls), [INPUTS, PROXY_INPUTS]);
});

test('NVR input proxy fallback completes names missing from known camera channels', async t => {
    const { service, calls } = device({ [INPUTS]: inputList([[1, 'Analogico']]), [PROXY_INPUTS]: proxyList([[33, 'Rete']]) }, {
        getCapabilities: () => ({ channels: [{ id: '1', name: '' }, { id: '33', name: '' }] })
    });
    t.after(() => service.close());
    assert.deepEqual(named(await service.refresh()), [['1', 'Analogico'], ['33', 'Rete']]);
    assert.deepEqual(paths(calls), [INPUTS, PROXY_INPUTS]);
});

test('channel names refresh replaces removed configured channels, including an empty list', async t => {
    const { service, data } = device({ [PROXY_INPUTS]: '<InputProxyChannelList/>' });
    t.after(() => service.close());
    await service.refresh();
    data[INPUTS] = inputList([[2, 'Garage nuovo']]);
    assert.deepEqual(named(await service.refresh('0', '', true)), [['2', 'Garage nuovo']]);
    data[INPUTS] = '<VideoInputChannelList/>';
    assert.deepEqual(named(await service.refresh('0', '', true)), []);
});

test('capability min/max/opt attributes do not become configured channel names', async t => {
    const body = '<VideoInputChannelList><VideoInputChannel><id>1</id><name min="0" max="64" opt="notAName"/></VideoInputChannel></VideoInputChannelList>';
    const { service } = device({ [INPUTS]: body });
    t.after(() => service.close());
    const result = await service.refresh();
    assert.equal(result.channels.some(channel => ['0', '64', 'notAName', '[object Object]'].includes(channel.name)), false);
});

for (const body of [
    '<html><body><name>Login</name></body></html>',
    '<!DOCTYPE x [<!ENTITY label "Injected">]><VideoInputChannelList/>',
    '<VideoInputChannelList><VideoInputChannel>',
    '<ResponseStatus><statusCode>4</statusCode></ResponseStatus>'
]) {
    test('invalid or unrelated channel metadata preserves a previously configured name: ' + body.slice(0, 32), async t => {
        const { service, data } = device();
        t.after(() => service.close());
        await service.refresh();
        data[INPUTS] = body;
        const result = await service.refresh('0', '', true);
        assert.equal(result.channels.find(channel => channel.id === '1').name, 'Ingresso');
        assert.notEqual(result.status, 'ok');
    });
}

for (const status of [401, 403, 429, 503]) {
    test(`HTTP ${status} pauses all metadata discovery across channels, events and forced refreshes`, async t => {
        let now = 1000;
        let destroyed = 0;
        const denied = response('', status);
        denied.body.destroy = () => { destroyed++; };
        const { service, calls } = device({ [INPUTS]: denied }, { now: () => now });
        t.after(() => service.close());
        await Promise.all([service.refresh('1', 'vmd'), service.refresh('2', 'linedetection')]);
        await service.refresh('3', 'fielddetection', true);
        assert.deepEqual(paths(calls), [INPUTS]);
        assert.equal(destroyed, 1);
        assert.notEqual(service.snapshot().status, 'ok');
        now += 30001;
        await service.refresh('2', 'vmd');
        assert.equal(calls.length, 2);
    });
}

test('failed metadata requests are negatively cached and retried after the failure TTL', async t => {
    let now = 1000;
    const { service, calls } = device({ [INPUTS]: null, [PROXY_INPUTS]: null }, { now: () => now });
    t.after(() => service.close());
    await service.refresh();
    const firstCount = calls.length;
    assert.ok(firstCount > 0);
    await service.refresh();
    assert.equal(calls.length, firstCount);
    now += 30001;
    await service.refresh();
    assert.equal(calls.length, firstCount * 2);
});

test('connection and response-body deadlines abort stalled metadata requests', async t => {
    for (const stallBody of [false, true]) {
        const receivedSignals = [];
        const { service } = device({
            [INPUTS]: options => {
                receivedSignals.push(options.signal);
                assert.ok(options.size > 0, 'Metadata requests limit the response body');
                assert.ok(options.timeout > 0, 'Metadata requests pass a transport timeout');
                return stallBody ? { ok: true, status: 200, text: () => new Promise(() => {}) } : new Promise(() => {});
            }
        }, { requestTimeoutMs: 20 });
        t.after(() => service.close());
        const result = await service.refresh();
        assert.equal(receivedSignals.length, 1);
        assert.equal(receivedSignals[0].aborted, true);
        assert.notEqual(result.status, 'ok');
    }
});

test('closing aborts pending work, returns promptly and rejects late cache writes', async t => {
    let lateResponse;
    let signal;
    const { service, calls } = device({ [INPUTS]: options => {
        signal = options.signal;
        return new Promise(resolve => { lateResponse = resolve; });
    } });
    t.after(() => service.close());
    const pending = service.refresh();
    await until(() => calls.length === 1);
    service.close();
    assert.equal(signal.aborted, true);
    const result = await pending;
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.channels, []);
    lateResponse(response(inputList([[1, 'Too late']])));
    await delay(1);
    assert.deepEqual(service.snapshot().channels, []);
    assert.deepEqual(service.snapshot().zones, []);
    await service.refresh('2', 'vmd', true);
    assert.equal(calls.length, 1);
});

test('channel IDs and event tokens are validated before any camera request', async t => {
    const { service, calls } = device();
    t.after(() => service.close());
    for (const channel of ['-1', '01', '1000000', '1/../2', ' 1 ', 'NaN']) {
        await assert.rejects(service.refresh(channel, 'vmd'));
    }
    for (const event of ['../vmd', 'vmd?channel=2', '<script>', 'x'.repeat(513)]) {
        await assert.rejects(service.refresh('1', event));
    }
    assert.equal(calls.length, 0);
});

test('all-channel metadata never scans rules across multiple NVR channels', async t => {
    const { service, calls } = device({}, { getCapabilities: () => ({ channels: [{ id: '1' }, { id: '2' }] }) });
    t.after(() => service.close());
    const result = await service.refresh('0', 'linedetection');
    assert.deepEqual(paths(calls), [INPUTS]);
    assert.deepEqual(result.zones, []);
});

test('unknown syntactically valid event types never become arbitrary camera URLs', async t => {
    const { service, calls } = device();
    t.after(() => service.close());
    const result = await service.refresh('1', 'FutureVendor.Event:7');
    assert.deepEqual(paths(calls), [INPUTS]);
    assert.deepEqual(result.zones, []);
});

const intelliCaps = channel => `/ISAPI/Intelligent/channels/${channel}/capabilities`;
const behaviorPath = channel => `/ISAPI/Intelligent/channels/${channel}/behaviorRule/1`;
const thermalPath = channel => `/ISAPI/Thermal/channels/${channel}/thermometry/1`;
const classicRules = [
    { event: 'fieldDetection', canonical: 'fielddetection', resource: 'FieldDetection', root: 'FieldDetection', list: 'FieldDetectionRegionList', item: 'FieldDetectionRegion' },
    { event: 'lineDetection', canonical: 'linedetection', resource: 'LineDetection', root: 'LineDetection', list: 'LineItemList', item: 'LineItem' },
    { event: 'regionEntrance', canonical: 'regionentrance', resource: 'regionEntrance', root: 'RegionEntrance', list: 'RegionEntranceRegionList', item: 'RegionEntranceRegion' },
    { event: 'regionExiting', canonical: 'regionexiting', resource: 'regionExiting', root: 'RegionExiting', list: 'RegionExitingRegionList', item: 'RegionExitingRegion' }
];
function classicPath(spec, channel) { return `/ISAPI/Smart/${spec.resource}/${channel}`; }
function classicBody(spec, items, channel = 1) {
    return `<${spec.root}><id>${channel}</id><${spec.list}>` + items.map(([id, name]) => `<${spec.item}><id>${id}</id><name>${name}</name><enabled>false</enabled><RegionCoordinatesList><RegionCoordinates><id>999</id></RegionCoordinates></RegionCoordinatesList></${spec.item}>`).join('') + `</${spec.list}></${spec.root}>`;
}
function behaviorBody(items) {
    return '<BehaviorRule><sid>1</sid><sceneName>Camera scene</sceneName><RuleInfoList>' + items.map(([id, name, event]) => `<RuleInfo><ruleId>${id}</ruleId><ruleName>${name}</ruleName><enabled>true</enabled><eventType>${event}</eventType><ruleType>region</ruleType></RuleInfo>`).join('') + '</RuleInfoList></BehaviorRule>';
}
function thermalBody(items) {
    return '<ThermometryScene><id>1</id><name>Scene name is not a zone</name><ThermometryRegionList>' + items.map(([id, name]) => `<ThermometryRegion><id>${id}</id><name>${name}</name><enabled>true</enabled><type>region</type></ThermometryRegion>`).join('') + '</ThermometryRegionList></ThermometryScene>';
}

for (const spec of classicRules) {
    test(`classic ${spec.event} rules use input channel IDs and exact-case whitelisted resources`, async t => {
        const { service, calls } = device({
            [INPUTS]: inputList([[37, 'Camera 37']]),
            [intelliCaps(37)]: null,
            [classicPath(spec, 37)]: classicBody(spec, [[0, 'Reserved all'], [2, '001'], [7, 'Porta &amp; scala']], 37)
        });
        t.after(() => service.close());
        const result = await service.refresh('37', spec.event);
        assert.deepEqual(result.zones.map(zone => [zone.id, zone.name, zone.channelID, zone.eventType]), [
            ['2', '001', '37', spec.canonical], ['7', 'Porta & scala', '37', spec.canonical]
        ]);
        assert.deepEqual(paths(calls), [INPUTS, intelliCaps(37), classicPath(spec, 37)]);
        assert.equal(result.zones.some(zone => ['0', '37', '999'].includes(zone.id)), false, 'All, channel IDs and coordinate IDs are not rules');
        assert.equal(result.status, 'ok', 'Unsupported optional Intelligent capabilities do not make a successful classic read fail');
    });
}

test('classic rule metadata is cached per channel and event family, including canonical aliases', async t => {
    const field = classicRules[0];
    const line = classicRules[1];
    const { service, calls, data } = device({
        [intelliCaps(1)]: '<IntelliCap><isBehaviorSupport>false</isBehaviorSupport></IntelliCap>',
        [intelliCaps(2)]: '<IntelliCap><isBehaviorSupport>false</isBehaviorSupport></IntelliCap>',
        [classicPath(field, 1)]: classicBody(field, [[2, 'Intrusione uno']]),
        [classicPath(field, 2)]: classicBody(field, [[2, 'Intrusione due']], 2),
        [classicPath(line, 1)]: classicBody(line, [[2, 'Linea uno']])
    });
    t.after(() => service.close());
    assert.equal((await service.refresh('1', 'fielddetection')).zones[0].name, 'Intrusione uno');
    const afterFirst = calls.length;
    assert.equal((await service.refresh('1', ' FIELDDETECTION,fielddetection ')).zones[0].name, 'Intrusione uno');
    assert.equal(calls.length, afterFirst);
    assert.equal((await service.refresh('2', 'fielddetection')).zones[0].name, 'Intrusione due');
    assert.equal((await service.refresh('1', 'linedetection')).zones[0].name, 'Linea uno');
    assert.equal(service.snapshot('1', 'fielddetection').zones[0].name, 'Intrusione uno');
    data[classicPath(field, 1)] = classicBody(field, [[2, 'Renamed intrusion']]);
    assert.equal((await service.refresh('1', 'fieldDetection', true)).zones[0].name, 'Renamed intrusion');
    assert.equal(service.snapshot('2', 'fielddetection').zones[0].name, 'Intrusione due');
});

test('Intelligent support chooses behavior rules without probing a forbidden classic endpoint', async t => {
    const { service, calls } = device({
        [intelliCaps(1)]: '<IntelliCap><isBehaviorSupport>true</isBehaviorSupport></IntelliCap>',
        [behaviorPath(1)]: behaviorBody([[2, 'Ingresso &amp; viale', 'fieldDetection'], [3, 'Linea cancello', 'lineDetection']]),
        '/ISAPI/Smart/FieldDetection/1': response('', 403)
    });
    t.after(() => service.close());
    const result = await service.refresh('1', 'fielddetection');
    assert.deepEqual(result.zones.map(zone => [zone.id, zone.name, zone.channelID, zone.eventType]), [['2', 'Ingresso & viale', '1', 'fielddetection']]);
    assert.deepEqual(paths(calls), [INPUTS, intelliCaps(1), behaviorPath(1)]);
    assert.equal(String(result.zones[0].sceneID), '1');
    assert.ok(result.warnings.some(warning => /scene|scena/i.test(warning)), 'The scene used for configured names is explicit');
});

test('Intelligent rules with the same ID in different event families never overwrite each other', async t => {
    const { service, calls } = device({
        [intelliCaps(1)]: '<IntelliCap><isBehaviorSupport>true</isBehaviorSupport></IntelliCap>',
        [behaviorPath(1)]: behaviorBody([[2, 'Intrusione', 'fieldDetection'], [2, 'Attraversamento', 'lineDetection'], [8, 'Uscita', 'regionExiting']])
    });
    t.after(() => service.close());
    assert.equal((await service.refresh('1', 'fielddetection')).zones[0].name, 'Intrusione');
    assert.equal((await service.refresh('1', 'lineDetection')).zones[0].name, 'Attraversamento');
    assert.equal((await service.refresh('1', 'regionExiting')).zones[0].id, '8');
    assert.equal(service.snapshot('1', 'fieldDetection').zones[0].name, 'Intrusione');
    assert.equal(paths(calls).filter(path => path === behaviorPath(1)).length, 1, 'All families share one cached configuration document');
});

test('rule names observed from event regions stay scoped by channel and event family', async t => {
    const { service } = device();
    t.after(() => service.close());
    service.observe({ EventNotificationAlert: [
        { eventType: 'fieldDetection', channelID: 1, DetectionRegionList: { DetectionRegionEntry: [{ regionID: 2, regionName: 'Area uno' }, { regionID: 9, ruleName: 'Area nove' }] } },
        { eventType: 'lineDetection', channelID: 1, DetectionRegionList: { DetectionRegionEntry: { regionID: 2, regionName: 'Linea due' } } },
        { eventType: 'fieldDetection', dynChannelID: 2, DetectionRegionList: { DetectionRegionEntry: { regionID: 2, name: 'Altro canale' } } }
    ] });
    assert.deepEqual(service.snapshot('1', 'fielddetection').zones.map(zone => [zone.id, zone.name]), [['2', 'Area uno'], ['9', 'Area nove']]);
    assert.deepEqual(service.snapshot('1', 'linedetection').zones.map(zone => [zone.id, zone.name]), [['2', 'Linea due']]);
    assert.deepEqual(service.snapshot('2', 'fielddetection').zones.map(zone => [zone.id, zone.name]), [['2', 'Altro canale']]);
    assert.deepEqual(service.snapshot('0', 'fielddetection').zones, [], 'All-channel selection cannot merge equal region IDs from different channels');
});

test('configured rule names override observations and a failed refresh retains the previous names', async t => {
    const field = classicRules[0];
    const { service, data } = device({ [intelliCaps(1)]: null, [classicPath(field, 1)]: classicBody(field, [[2, 'Nome configurato']]) });
    t.after(() => service.close());
    service.observe({ eventType: 'fieldDetection', channelID: 1, DetectionRegionList: { DetectionRegionEntry: { regionID: 2, regionName: 'Nome osservato' } } });
    assert.equal((await service.refresh('1', 'fielddetection')).zones[0].name, 'Nome configurato');
    data[classicPath(field, 1)] = new Error('offline');
    const cached = await service.refresh('1', 'fielddetection', true);
    assert.equal(cached.zones[0].name, 'Nome configurato');
    assert.notEqual(cached.status, 'ok');
});

test('classic capability attribute ranges never become named rule IDs', async t => {
    const { service } = device({
        [intelliCaps(1)]: null,
        '/ISAPI/Smart/FieldDetection/1': '<FieldDetection><id>1</id><FieldDetectionRegionList><FieldDetectionRegion><id min="1" max="8"/><name min="0" max="64"/></FieldDetectionRegion></FieldDetectionRegionList></FieldDetection>'
    });
    t.after(() => service.close());
    assert.deepEqual((await service.refresh('1', 'fielddetection')).zones, []);
});

test('single-channel all-channel selection may read its rules but never assumes streaming channel 101', async t => {
    const field = classicRules[0];
    const { service, calls } = device({
        [INPUTS]: inputList([[7, 'Camera unica']]),
        [intelliCaps(7)]: null,
        [classicPath(field, 7)]: classicBody(field, [[2, 'Area unica']], 7)
    });
    t.after(() => service.close());
    const result = await service.refresh('0', 'fieldDetection');
    assert.deepEqual(result.zones.map(zone => [zone.id, zone.channelID]), [['2', '7']]);
    assert.deepEqual(paths(calls), [INPUTS, intelliCaps(7), classicPath(field, 7)]);
});

test('thermal scene names are scoped to the requested camera channel and scene 1', async t => {
    const { service, calls } = device({
        [thermalPath(1)]: thermalBody([[0, 'Reserved all'], [2, 'Quadro &amp; cavi'], [7, '001']]),
        [thermalPath(2)]: thermalBody([[2, 'Altro quadro']])
    });
    t.after(() => service.close());
    const result = await service.refresh('1', 'thermometry');
    assert.deepEqual(result.zones.map(zone => [zone.id, zone.name, zone.channelID, String(zone.sceneID)]), [['2', 'Quadro & cavi', '1', '1'], ['7', '001', '1', '1']]);
    assert.ok(result.warnings.some(warning => /scene|scena/i.test(warning)));
    const afterFirst = calls.length;
    assert.equal((await service.refresh('1', 'TMA')).zones[0].name, 'Quadro & cavi');
    assert.equal((await service.refresh('1', 'TMPA')).zones[0].name, 'Quadro & cavi');
    assert.equal(calls.length, afterFirst, 'Thermal variants share a configuration cache');
    assert.equal((await service.refresh('2', 'thermometry')).zones[0].name, 'Altro quadro');
    assert.equal(service.snapshot('1', 'thermometry').zones[0].name, 'Quadro & cavi');
    assert.equal(paths(calls).some(path => /Intelligent|Smart/.test(path)), false);
});

test('temperature difference events never inherit thermometry region names by assumption', async t => {
    const { service, calls } = device({ [thermalPath(1)]: thermalBody([[2, 'Wrong family']]) });
    t.after(() => service.close());
    const result = await service.refresh('1', 'temperature,temperatureDetection');
    assert.deepEqual(result.zones, []);
    assert.deepEqual(paths(calls), [INPUTS]);
});

test('observed channels without names still prevent ambiguous all-channel zone selection', t => {
    const { service } = device();
    t.after(() => service.close());
    service.observe({ eventType: 'fieldDetection', channelID: 1, channelName: 'Named channel', DetectionRegionList: { DetectionRegionEntry: { regionID: 2, regionName: 'Area uno' } } });
    service.observe({ eventType: 'fieldDetection', channelID: 2, DetectionRegionList: { DetectionRegionEntry: { regionID: 2, regionName: 'Area due' } } });
    assert.deepEqual(service.snapshot('0', 'fielddetection').zones, []);
    assert.deepEqual(service.snapshot().channels.map(channel => channel.id), ['1', '2']);
});

test('metadata requests are serialized and excess editor requests cannot grow an unbounded queue', async t => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let active = 0, maximumActive = 0;
    const data = {};
    const field = classicRules[0];
    for (let channel = 1; channel <= 20; channel++) {
        data[intelliCaps(channel)] = async () => {
            active++;
            maximumActive = Math.max(maximumActive, active);
            await gate;
            active--;
            return response('<IntelliCap><isBehaviorSupport>false</isBehaviorSupport></IntelliCap>');
        };
        data[classicPath(field, channel)] = classicBody(field, [[2, 'Area ' + channel]], channel);
    }
    const { service, calls } = device(data);
    t.after(() => { release(); service.close(); });
    const settled = Promise.allSettled(Array.from({ length: 20 }, (_, index) => service.refresh(String(index + 1), 'fielddetection')));
    await until(() => active === 1);
    assert.equal(maximumActive, 1);
    release();
    const results = await settled;
    assert.equal(maximumActive, 1);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 8);
    assert.equal(results.filter(result => result.status === 'rejected').length, 12);
    assert.equal(paths(calls).filter(path => /Intelligent/.test(path)).length, 8);
    assert.ok(results.filter(result => result.status === 'rejected').every(result => /busy|retry|queue/i.test(result.reason.message)));
});

test('observed channel and zone metadata has bounded retention', t => {
    const { service } = device();
    t.after(() => service.close());
    for (let channel = 1; channel <= 3000; channel++) {
        service.observe({ eventType: 'fieldDetection', channelID: channel, channelName: 'Camera ' + channel, DetectionRegionList: { DetectionRegionEntry: { regionID: 2, regionName: 'Area ' + channel } } });
    }
    assert.ok(service.snapshot().channels.length <= 1024);
    assert.equal(service.snapshot('3000', 'fielddetection').zones[0].name, 'Area 3000');
    assert.deepEqual(service.snapshot('1', 'fielddetection').zones, []);
});

test('selected NVR channel triggers name fallback before the capabilities cache has populated', async t => {
    const { service, calls } = device({ [INPUTS]: inputList([[1, 'Analog camera']]), [PROXY_INPUTS]: proxyList([[37, 'IP camera']]) });
    t.after(() => service.close());
    assert.equal((await service.refresh('37')).channels.find(channel => channel.id === '37').name, 'IP camera');
    assert.deepEqual(paths(calls), [INPUTS, PROXY_INPUTS]);
});

test('saved legacy catalog IDs are canonicalized before validating metadata event tokens', async t => {
    const { service, calls } = device();
    t.after(() => service.close());
    assert.equal((await service.refresh('1', 'AID_\u200bcongestion')).channels.find(channel => channel.id === '1').name, 'Ingresso');
    assert.deepEqual(paths(calls), [INPUTS]);
});

test('a classic rule response for a different channel is never reused as selected-channel names', async t => {
    const field = classicRules[0];
    const { service } = device({ [intelliCaps(1)]: null, [classicPath(field, 1)]: classicBody(field, [[2, 'Wrong channel']], 2) });
    t.after(() => service.close());
    const result = await service.refresh('1', 'fielddetection');
    assert.deepEqual(result.zones, []);
    assert.notEqual(result.status, 'ok');
});

for (const kind of ['behavior', 'thermal']) {
    test(`a ${kind} response for another scene is rejected`, async t => {
        const data = kind === 'behavior' ? {
            [intelliCaps(1)]: '<IntelliCap><isBehaviorSupport>true</isBehaviorSupport></IntelliCap>',
            [behaviorPath(1)]: behaviorBody([[2, 'Wrong scene', 'fieldDetection']]).replace('<sid>1</sid>', '<sid>2</sid>')
        } : { [thermalPath(1)]: thermalBody([[2, 'Wrong scene']]).replace('<id>1</id>', '<id>2</id>') };
        const { service } = device(data);
        t.after(() => service.close());
        const result = await service.refresh('1', kind === 'behavior' ? 'fieldDetection' : 'thermometry');
        assert.deepEqual(result.zones, []);
        assert.notEqual(result.status, 'ok');
    });
}

for (const first of ['capabilities', 'metadata']) {
    test(`a ${first} authentication failure pauses both discovery services`, async t => {
        const { createAlarmCapabilities } = require('../nodes/utils/alarmCapabilities');
        const backoff = { until: 0, warning: '' };
        const calls = [];
        const fetch = async path => { calls.push(path); return response('', 401); };
        const capabilities = createAlarmCapabilities({ fetch, backoff });
        const metadata = createAlarmMetadata({ fetch, backoff });
        t.after(() => { capabilities.close(); metadata.close(); });
        if (first === 'capabilities') {
            await capabilities.refresh('1');
            await metadata.refresh('1', 'fielddetection', true);
        } else {
            await metadata.refresh('1', 'fielddetection');
            await capabilities.refresh('1', true);
        }
        assert.equal(calls.length, 1);
        assert.notEqual(capabilities.snapshot().status, 'ok');
        assert.notEqual(metadata.snapshot().status, 'ok');
    });
}

for (const kind of ['behavior', 'thermal']) {
    test(`JSON ${kind} scene IDs must be scalar IDs, never coerced from arrays`, async t => {
        const data = kind === 'behavior' ? {
            [intelliCaps(1)]: '<IntelliCap><isBehaviorSupport>true</isBehaviorSupport></IntelliCap>',
            [behaviorPath(1)]: { BehaviorRule: { sid: ['1'], RuleInfoList: { RuleInfo: { ruleId: '2', ruleName: 'Invalid scene', eventType: 'fieldDetection' } } } }
        } : {
            [thermalPath(1)]: { ThermometryScene: { id: ['1'], ThermometryRegionList: { ThermometryRegion: { id: '2', name: 'Invalid scene' } } } }
        };
        const { service } = device(data);
        t.after(() => service.close());
        const result = await service.refresh('1', kind === 'behavior' ? 'fielddetection' : 'thermometry');
        assert.deepEqual(result.zones, []);
        assert.notEqual(result.status, 'ok');
    });
}

test('Intelligent support cannot be inferred by coercing a JSON array to true', async t => {
    const field = classicRules[0];
    const { service, calls } = device({
        [intelliCaps(1)]: { IntelliCap: { isBehaviorSupport: ['true'] } },
        [classicPath(field, 1)]: classicBody(field, [[2, 'Classic rule']]),
        [behaviorPath(1)]: behaviorBody([[2, 'Wrong endpoint', 'fieldDetection']])
    });
    t.after(() => service.close());
    assert.equal((await service.refresh('1', 'fielddetection')).zones[0].name, 'Classic rule');
    assert.equal(paths(calls).includes(behaviorPath(1)), false);
});
