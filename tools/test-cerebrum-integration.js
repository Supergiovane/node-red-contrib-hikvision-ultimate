/* Read-only publication of the Hikvision configuration nodes to Cerebrum Ultimate. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { CEREBRUM_REGISTRY_KEY, getCerebrumRegistry } = require('../nodes/utils/cerebrumIntegration');
const { armingFromCid, attachHikvisionCerebrum } = require('../nodes/utils/hikvisionCerebrum');

// Same dispatch the configuration nodes use.
const dispatch = (configNode, msg) => configNode.nodeClients.forEach((client) => client.sendPayload(msg));

function setup(kind) {
  delete globalThis[CEREBRUM_REGISTRY_KEY];
  const configNode = { id: `${kind}1`, name: 'Casa', nodeClients: [], isConnected: true };
  const integration = attachHikvisionCerebrum({ configNode, kind });
  const provider = getCerebrumRegistry().providers.get(`hikvision-ultimate:${kind}1`);
  const events = [];
  provider.subscribe((event) => events.push(event));
  return { configNode, integration, provider, events, seen: () => events.map((event) => [event.entityId, event.eventType, event.state]) };
}

test('camera/NVR events become channel states and the connection is tracked', async () => {
  const { configNode, integration, provider, seen } = setup('camera');
  assert.equal(provider.adapterId, 'hikvision');
  assert.equal(provider.callService, undefined);
  dispatch(configNode, { type: 'event', payload: { eventType: 'VMD', eventState: 'active', channelID: 2, eventDescription: 'Motion alarm' } });
  dispatch(configNode, { type: 'event', payload: { eventType: 'VMD', eventState: 'active', channelID: 2 } });
  dispatch(configNode, { type: 'img', payload: Buffer.from('jpeg') });
  dispatch(configNode, { type: 'event', payload: { eventType: 'VMD', eventState: 'inactive', channelID: 2 } });
  dispatch(configNode, { errorDescription: 'timeout', payload: true });
  assert.deepEqual(seen(), [
    ['camera1/ch2/VMD', 'state_changed', 'active'],
    ['camera1/ch2/VMD', 'state_changed', 'inactive'],
    ['camera1/connection', 'state_changed', 'disconnected']
  ]);
  assert.equal((await provider.getEntity('camera1/ch2/VMD')).state, 'inactive');
  integration.dispose();
  assert.equal(configNode.nodeClients.length, 0);
  assert.equal(getCerebrumRegistry().providers.has('hikvision-ultimate:camera1'), false);
});

test('AX Pro zones and arming state', async () => {
  const { configNode, provider, seen } = setup('axpro');
  const zone = { id: 1, name: 'Porta ingresso', status: 'notTrigger', magnetOpenStatus: false, alarm: false, armed: true, bypassed: false, tamperEvident: false, subSystemNo: 1 };
  dispatch(configNode, { payload: { ZoneList: [{ Zone: zone }] } });
  dispatch(configNode, { payload: { ZoneList: [{ Zone: zone }] } });
  dispatch(configNode, { payload: { ZoneList: [{ Zone: { ...zone, magnetOpenStatus: true, alarm: true } }] } });
  dispatch(configNode, { type: 'event', payload: { CIDEvent: { code: 3401, type: 'armAndDisarm', name: 'Max', system: 1, subSystemName: 'Casa' } } });
  assert.deepEqual(seen(), [
    ['axpro1/zone/1', 'state_changed', 'closed'],
    ['axpro1/zone/1', 'state_changed', 'alarm'],
    ['axpro1/area/1', 'state_changed', 'armed'],
    ['axpro1/area/1', 'cid_event', '3401 armAndDisarm']
  ]);
  assert.equal((await provider.getEntity('axpro1/area/1')).state, 'armed');
  assert.equal(armingFromCid({ type: 'armAndDisarm', code: 1401 }), 'disarmed');
  assert.equal(armingFromCid({ type: 'armAndDisarm', code: 3441 }), 'armed_partial');
});

test('video intercom, ANPR and access control', () => {
  const doorbell = setup('doorbell');
  dispatch(doorbell.configNode, { CallerInfo: { status: 'Ring', floorNo: 1, unitNo: 1 } });
  assert.deepEqual(doorbell.seen(), [['doorbell1/call', 'state_changed', 'ring']]);

  const anpr = setup('anpr');
  dispatch(anpr.configNode, { plate: { plateNumber: 'AB123CD', direction: 'forward' }, payload: 'AB123CD' });
  dispatch(anpr.configNode, { plate: { plateNumber: 'AB123CD' }, payload: 'AB123CD' });
  assert.deepEqual(anpr.seen(), [
    ['anpr1/plate', 'state_changed', 'AB123CD'],
    ['anpr1/plate', 'plate_detected', 'AB123CD'],
    ['anpr1/plate', 'plate_detected', 'AB123CD']
  ]);

  const access = setup('access');
  dispatch(access.configNode, { payload: { major: 5, minor: 21, doorNo: 1, eventDescription: '(EVENT) Door Ulock' }, connected: true });
  assert.deepEqual(access.seen(), [
    ['access1/door/1', 'state_changed', '(EVENT) Door Ulock'],
    ['access1/door/1', 'access_event', '(EVENT) Door Ulock']
  ]);
});
