const test = require('node:test');
const assert = require('node:assert/strict');
const { createAlarmCapabilities, extractCapabilities, parseDocument } = require('../nodes/utils/alarmCapabilities');

const caps = '/ISAPI/Event/capabilities';
const allChannels = '/ISAPI/Event/channels/capabilities';
const channel = id => '/ISAPI/Event/channels/' + id + '/capabilities';
function response(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, text: async () => typeof body === 'string' ? body : JSON.stringify(body) };
}
function device(overrides = {}, options = {}) {
    const calls = [];
    const data = {
        '/ISAPI/System/capabilities': '<DeviceCap><SmartCap><isSupportLineDetection>true</isSupportLineDetection></SmartCap></DeviceCap>',
        [caps]: '<EventCap><isSupportVideoLoss>true</isSupportVideoLoss></EventCap>',
        '/ISAPI/Smart/capabilities': '<SmartCap><isSupportFieldDetection>true</isSupportFieldDetection></SmartCap>',
        [allChannels]: '<ChannelEventCapList><ChannelEventCap><id>1</id><eventType opt="VMD,novelEvent"/></ChannelEventCap><ChannelEventCap><id>40</id><eventType opt="fielddetection"/></ChannelEventCap></ChannelEventCapList>',
        [channel(1)]: '<ChannelEventCap><eventType opt="VMD,novelEvent"/></ChannelEventCap>',
        [channel(40)]: '<ChannelEventCap><eventType opt="fielddetection"/></ChannelEventCap>',
        ...overrides
    };
    const service = createAlarmCapabilities({
        fetch: async (path, requestOptions) => {
            calls.push(path);
            const result = data[path];
            if (typeof result === 'function') return result(requestOptions);
            if (result instanceof Error) throw result;
            return response(result || '', result ? 200 : 404);
        }, ...options
    });
    return { service, calls, data };
}

test('XML namespaces, explicit support flags, and opt attributes are parsed conservatively', () => {
    const parsed = parseDocument('<ns:DeviceCap xmlns:ns="urn:hik"><ns:SmartCap><ns:isSupportLineDetection>true</ns:isSupportLineDetection><ns:isSupportFieldDetection>false</ns:isSupportFieldDetection><ns:isSupportFaceDetect opt="true,false">false</ns:isSupportFaceDetect><ns:isSupportROI>true</ns:isSupportROI></ns:SmartCap><encoding><eventType opt="notAnEvent"/></encoding></ns:DeviceCap>');
    assert.deepEqual(extractCapabilities(parsed, '/ISAPI/System/capabilities').events.map(e => e.id), ['linedetection']);
    const channelResult = extractCapabilities(parseDocument('<ChannelEventCap><id>37</id><eventType opt="VMD,newFirmwareEvent"/></ChannelEventCap>'), channel(37), '37');
    assert.deepEqual(channelResult.events.map(e => e.id), ['VMD', 'newFirmwareEvent']);
    assert.deepEqual(channelResult.events[1].channels, ['37']);
});

test('JSON opt attributes and explicit false are respected', () => {
    const result = extractCapabilities({ ChannelEventCap: { id: 2, eventType: { '@opt': ['VMD', 'temperatureDetection'] }, isSupportLineDetection: false } }, channel(2), '2');
    assert.deepEqual(result.events.map(e => e.id), ['VMD', 'temperatureDetection']);
});

test('rejects malformed XML, entity definitions, response status, and HTML login pages', () => {
    assert.throws(() => parseDocument('<EventCap>'));
    assert.throws(() => parseDocument('<!DOCTYPE foo><EventCap/>'));
    assert.throws(() => parseDocument('not XML'));
    assert.throws(() => parseDocument(' '.repeat(2 * 1024 * 1024 + 1)));
    assert.throws(() => extractCapabilities(parseDocument('<html><body>Login</body></html>'), caps));
    assert.throws(() => extractCapabilities({ ResponseStatus: { statusCode: 4 } }, caps));
});

test('discovery is shared, cached, scoped per channel, and preserves unknown device event names', async t => {
    const { service, calls } = device();
    t.after(() => service.close());
    const [one, two] = await Promise.all([service.refresh('1'), service.refresh('1')]);
    assert.deepEqual(one, two);
    assert.equal(calls.length, 5);
    assert.deepEqual(one.events.map(e => e.id), ['novelEvent', 'VMD']);
    assert.deepEqual(one.channels.map(c => c.id), ['1', '40']);
    await service.refresh('1');
    assert.equal(calls.length, 5);
    const forty = await service.refresh('40');
    assert.deepEqual(forty.events.map(e => e.id), ['fielddetection']);
    assert.equal(calls.length, 6);
    await service.refresh('1', true);
    assert.equal(calls.length, 11);
});

test('observes XML/JSON events, ignores heartbeats, and resolves duration without inventing boolean states', () => {
    const { service } = device();
    service.observe({ eventType: 'videoloss', eventState: 'inactive', activePostCount: 0 });
    service.observe({ eventType: 'videoloss', eventState: 'inactive', activePostCount: 1 });
    service.observe({ EventNotificationAlert: [
        { eventType: 'CUSTOM', eventState: 'active', dynChannelID: 48, channelName: 'Ingresso', eventDescription: 'Evento nuovo' },
        { eventType: 'stateless', channelID: 1 },
        { eventType: 'duration', eventState: 'inactive', channelID: 48, DurationList: { Duration: [{ relationEvent: 'custom' }, { relationEvent: 'duration' }] } }
    ] });
    const result = service.snapshot('48');
    assert.deepEqual(result.events.map(e => e.id), ['custom']);
    assert.equal(result.events[0].hasState, true);
    assert.deepEqual(result.events[0].sources, ['observed']);
    assert.equal(service.snapshot('1').events[0].hasState, false);
    assert.equal(result.channels.find(c => c.id === '48').name, 'Ingresso');
    service.close();
});

test('bad credentials stop scanning immediately and failed discovery is negatively cached', async t => {
    let clock = 1000;
    const { service, calls } = device({ '/ISAPI/System/capabilities': () => response('', 401) }, { now: () => clock });
    t.after(() => service.close());
    assert.equal((await service.refresh()).status, 'unavailable');
    assert.equal(calls.length, 1);
    await service.refresh();
    assert.equal(calls.length, 1);
    clock += 30001;
    await service.refresh();
    assert.equal(calls.length, 2);
});

test('authentication failure cooldown applies across channel changes and forced refreshes', async t => {
    const { service, calls } = device({ '/ISAPI/System/capabilities': () => response('', 401) });
    t.after(() => service.close());
    await Promise.all([service.refresh('1'), service.refresh('40')]);
    await service.refresh('40', true);
    assert.equal(calls.length, 1);
});

test('specific channel response supersedes earlier channel and device capabilities', async t => {
    const { service } = device({
        [allChannels]: '<ChannelEventCapList><ChannelEventCap><id>1</id><isSupportLineDetection>true</isSupportLineDetection></ChannelEventCap></ChannelEventCapList>',
        [channel(1)]: '<ChannelEventCap><isSupportLineDetection>false</isSupportLineDetection><eventType opt="VMD"/></ChannelEventCap>'
    });
    t.after(() => service.close());
    assert.deepEqual((await service.refresh('1')).events.map(e => e.id), ['VMD']);
});

test('refresh actually reloads channel enumeration and replaces removed channel data', async t => {
    const { service, data, calls } = device({
        [allChannels]: null,
        '/ISAPI/System/Video/inputs/channels': '<VideoInputChannelList><VideoInputChannel><id>1</id></VideoInputChannel></VideoInputChannelList>',
        '/ISAPI/ContentMgmt/InputProxy/channels': '<InputProxyChannelList/>',
        [channel(2)]: '<ChannelEventCap><id>2</id><eventType opt="otherEvent"/></ChannelEventCap>'
    });
    t.after(() => service.close());
    await service.refresh('0');
    data['/ISAPI/System/Video/inputs/channels'] = '<VideoInputChannelList><VideoInputChannel><id>2</id></VideoInputChannel></VideoInputChannelList>';
    const result = await service.refresh('0', true);
    assert.deepEqual(result.channels.map(c => c.id), ['2']);
    assert.equal(calls.filter(path => path === '/ISAPI/System/Video/inputs/channels').length, 2);
});

test('unsupported NVR input endpoint does not prevent refreshing a camera channel list', async t => {
    const { service, data } = device({
        [allChannels]: null,
        '/ISAPI/System/Video/inputs/channels': '<VideoInputChannelList><VideoInputChannel><id>1</id></VideoInputChannel></VideoInputChannelList>',
        [channel(2)]: '<ChannelEventCap><id>2</id><eventType opt="otherEvent"/></ChannelEventCap>'
    });
    t.after(() => service.close());
    await service.refresh();
    data['/ISAPI/System/Video/inputs/channels'] = '<VideoInputChannelList><VideoInputChannel><id>2</id></VideoInputChannel></VideoInputChannelList>';
    assert.deepEqual((await service.refresh('0', true)).channels.map(c => c.id), ['2']);
});

test('all-channel result includes failure of an automatically queried camera channel', async t => {
    const { service } = device({
        [allChannels]: '<ChannelEventCapList><ChannelEventCap><id>1</id><eventType opt="VMD"/></ChannelEventCap></ChannelEventCapList>',
        [channel(1)]: new Error('offline')
    });
    t.after(() => service.close());
    const result = await service.refresh();
    assert.equal(result.status, 'partial');
    assert.ok(result.warnings.some(warning => warning.includes(channel(1))));
});

test('partial response and camera offline retain prior data plus observed events', async t => {
    const { service, data } = device();
    t.after(() => service.close());
    await service.refresh();
    service.observe({ eventType: 'fromStream', channelID: 1, eventState: 'active' });
    Object.keys(data).forEach(path => data[path] = new Error('private endpoint failed'));
    const result = await service.refresh('0', true);
    assert.equal(result.status, 'cached');
    assert.ok(result.events.some(e => e.id === 'fromStream'));
    assert.ok(result.events.some(e => e.id === 'novelEvent'));
    assert.ok(result.warnings.every(w => !w.includes('private')));
});

test('deadline also bounds a fetch that never settles, and close aborts a pending refresh', async () => {
    let signal;
    const { service } = device({ '/ISAPI/System/capabilities': options => { signal = options.signal; return new Promise(() => {}); } }, { requestTimeoutMs: 15 });
    const result = await service.refresh();
    assert.equal(signal.aborted, true);
    assert.equal(result.status, 'partial');
    service.close();
    const hanging = device({ '/ISAPI/System/capabilities': () => new Promise(() => {}) });
    const refresh = hanging.service.refresh();
    await new Promise(resolve => setImmediate(resolve));
    hanging.service.close();
    const closed = await refresh;
    assert.equal(closed.status, 'unavailable');
    assert.deepEqual(closed.events, []);
});

test('discovers input channels as fallback and queries single-camera event capabilities', async t => {
    const { service, calls } = device({
        [allChannels]: null,
        '/ISAPI/System/Video/inputs/channels': '<VideoInputChannelList><VideoInputChannel><id>1</id><name>Front</name></VideoInputChannel></VideoInputChannelList>'
    });
    t.after(() => service.close());
    const result = await service.refresh();
    assert.ok(calls.includes(channel(1)));
    assert.equal(result.channels[0].name, 'Front');
    assert.ok(result.events.some(e => e.id === 'novelEvent'));
});

test('bounds passive memory and validates channel input before fetching', async t => {
    const { service, calls } = device();
    t.after(() => service.close());
    for (let i = 0; i < 3000; i++) service.observe({ eventType: 'custom' + i, channelID: i + 1 });
    assert.equal(service.snapshot().events.length, 1024);
    assert.equal(service.snapshot().channels.length, 1024);
    assert.throws(() => service.snapshot('../admin'));
    await assert.rejects(service.refresh('-1'));
    assert.equal(calls.length, 0);
});

test('malformed passive metadata never throws into the alarm stream handler', () => {
    const { service } = device();
    assert.doesNotThrow(() => service.observe({ eventType: 'videoloss', eventState: { toString: null }, channelID: { toString: null } }));
    assert.doesNotThrow(() => service.observe({ eventType: 'newEvent', eventState: ['inactive'], channelID: [1] }));
    const recursive = {};
    recursive.EventNotificationAlert = recursive;
    assert.doesNotThrow(() => service.observe(recursive));
    assert.equal(service.snapshot().events.find(event => event.id === 'newEvent').hasState, false);
    service.close();
});
