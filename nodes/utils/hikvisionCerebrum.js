'use strict';

// Publishes the Hikvision configuration nodes to Cerebrum Ultimate, read-only:
// camera/NVR events, AX Pro zones and arming state, video intercom call state,
// ANPR plates and access-control events, plus the connection of each device.
//
// It listens as one more client of the configuration node, so the existing
// event paths are not modified. Nothing can be commanded from Cerebrum.

const { registerCerebrumIntegration } = require('./cerebrumIntegration.js');

const KIND_TITLES = Object.freeze({
  camera: 'camera/NVR',
  axpro: 'AX Pro alarm',
  doorbell: 'video intercom',
  anpr: 'ANPR camera',
  access: 'access control terminal'
});

const ADAPTER = Object.freeze({
  id: 'hikvision',
  title: 'Hikvision',
  packageName: 'node-red-contrib-hikvision-ultimate',
  kind: 'security',
  capabilities: ['camera-events', 'alarm-zones', 'arming-state', 'intercom', 'anpr', 'access-control'],
  access: 'observe',
  operations: [
    { id: 'list-entities', description: 'Hikvision devices: connection of each device; camera/NVR event states per channel (motion, line crossing, intrusion, video loss… active/inactive); AX Pro alarm zones (closed/open/alarm, bypassed, tamper) and arming state per area; video intercom call state (idle, ring, onCall); last ANPR plate; last access-control event per door. Read-only.' },
    { id: 'read-entity', description: 'Current state of one Hikvision entity by its exact id.' }
  ]
});

const text = (value) => (value === undefined || value === null ? '' : String(value));

// CID arm/disarm events: 1xxx = opening (disarm), 3xxx = closing (arm).
function armingFromCid(cid) {
  if (!cid || cid.type !== 'armAndDisarm') return '';
  const code = text(cid.code);
  if (code.startsWith('1')) return 'disarmed';
  if (code.startsWith('3')) return ['441', '456'].includes(code.slice(1)) ? 'armed_partial' : 'armed';
  return '';
}

function zoneState(zone) {
  if (zone.alarm === true) return 'alarm';
  if (zone.magnetOpenStatus === true || zone.status === 'trigger') return 'open';
  return 'closed';
}

function attachHikvisionCerebrum({ configNode, kind }) {
  const base = configNode.id;
  const deviceName = configNode.name || configNode.host || base;
  const entitiesById = new Map();
  const integration = registerCerebrumIntegration({
    adapter: ADAPTER,
    provider: {
      id: `hikvision-ultimate:${base}`,
      title: `Hikvision ${KIND_TITLES[kind] || kind} ${deviceName}`,
      ownerNodeId: base,
      deviceKind: kind,
      isReady: () => configNode.isConnected !== false,
      listEntities: async () => Array.from(entitiesById.values()).map((entity) => ({ ...entity })),
      getEntity: async (id) => {
        const entity = entitiesById.get(text(id));
        return entity ? { ...entity } : null;
      }
    },
    minIntervalMs: 0
  });

  // eventType 'state_changed' updates the state; other event types are
  // delivered every time (plates, access events, repeated alarms).
  const publish = (entity, eventType = 'state_changed') => {
    entitiesById.set(entity.id, entity);
    const details = { ...entity };
    ['id', 'name', 'kind', 'capability', 'state'].forEach((key) => delete details[key]);
    integration.emit({
      entityId: entity.id,
      eventType,
      state: entity.state,
      resourceName: entity.name,
      resourceType: `hikvision-${kind}`,
      deviceName,
      kind: entity.kind,
      capability: entity.capability,
      details
    });
  };

  const connection = (connected, reason) => publish({
    id: `${base}/connection`,
    name: `${deviceName} connection`,
    kind: 'connectivity',
    capability: 'status',
    state: connected ? 'connected' : 'disconnected',
    reason: text(reason)
  });

  const handlers = {
    camera(msg) {
      if (msg.type !== 'event' || !msg.payload || typeof msg.payload !== 'object') return;
      const event = msg.payload;
      const eventType = text(event.eventType);
      if (!eventType) return;
      const channel = text(event.channelID !== undefined ? event.channelID : event.dynChannelID) || '0';
      publish({
        id: `${base}/ch${channel}/${eventType}`,
        name: `${deviceName} channel ${channel} ${event.eventDescription || eventType}`,
        kind: 'camera_event',
        capability: 'event',
        state: text(event.eventState) || 'active',
        channel,
        eventType,
        at: text(event.dateTime)
      });
    },
    axpro(msg) {
      const payload = msg.payload;
      if (!payload || typeof payload !== 'object') return;
      if (Array.isArray(payload.ZoneList)) {
        payload.ZoneList.forEach((item) => {
          const zone = item && item.Zone;
          if (!zone || zone.id === undefined) return;
          publish({
            id: `${base}/zone/${zone.id}`,
            name: text(zone.name) || `Zone ${zone.id}`,
            kind: 'alarm_zone',
            capability: 'open_close',
            state: zoneState(zone),
            armed: zone.armed === true,
            bypassed: zone.bypassed === true || zone.shielded === true,
            tamper: zone.tamperEvident === true,
            sensorStatus: text(zone.sensorStatus),
            detectorType: text(zone.detectorType),
            area: text(zone.subSystemNo)
          });
        });
      }
      const cid = payload.CIDEvent || (payload.EventNotificationAlert && payload.EventNotificationAlert.CIDEvent);
      if (cid) {
        const system = text(cid.system) || '0';
        const previous = entitiesById.get(`${base}/area/${system}`);
        const area = {
          id: `${base}/area/${system}`,
          name: text(cid.subSystemName) || `${deviceName} area ${system}`,
          kind: 'alarm_panel',
          capability: 'alarm_state',
          state: armingFromCid(cid) || (previous ? previous.state : 'unknown'),
          lastCidCode: text(cid.code),
          lastCidType: text(cid.type),
          user: text(cid.name),
          at: text(cid.trigger)
        };
        publish(area);
        publish({ ...area, state: `${text(cid.code)} ${text(cid.type)}` }, 'cid_event');
        entitiesById.set(area.id, area);
      }
    },
    doorbell(msg) {
      const caller = msg && msg.CallerInfo;
      if (!caller || caller.status === undefined) return;
      publish({
        id: `${base}/call`,
        name: `${deviceName} call`,
        kind: 'intercom',
        capability: 'call_state',
        state: text(caller.status).toLowerCase(),
        floorNo: text(caller.floorNo),
        unitNo: text(caller.unitNo)
      });
    },
    anpr(msg) {
      const plate = msg && msg.plate;
      if (!plate || !plate.plateNumber) return;
      const entity = {
        id: `${base}/plate`,
        name: `${deviceName} last plate`,
        kind: 'anpr',
        capability: 'event',
        state: text(plate.plateNumber),
        direction: text(plate.direction),
        at: text(plate.captureTime)
      };
      publish(entity);
      publish(entity, 'plate_detected');
    },
    access(msg) {
      const event = msg && msg.payload;
      if (!event || typeof event !== 'object' || event.major === undefined) return;
      const door = text(event.doorNo) || '0';
      const entity = {
        id: `${base}/door/${door}`,
        name: `${deviceName} door ${door}`,
        kind: 'access_control',
        capability: 'event',
        state: text(event.eventDescription) || `${event.major}/${event.minor}`,
        person: text(event.name),
        verifyMode: text(event.currentVerifyMode),
        at: text(event.time)
      };
      publish(entity);
      publish(entity, 'access_event');
    }
  };

  const handle = handlers[kind] || (() => {});
  const client = {
    id: `cerebrum-ultimate:${base}`,
    type: 'cerebrum-ultimate-observer',
    topic: '',
    setNodeStatus: () => {},
    sendPayload: (msg) => {
      if (!msg || !integration.hasSubscribers()) return;
      try {
        if (Object.prototype.hasOwnProperty.call(msg, 'errorDescription')) {
          connection(msg.payload !== true, msg.errorDescription);
          return;
        }
        if (msg.type === 'img') return;
        handle(msg);
      } catch (error) { /* Cerebrum must never break Hikvision */ }
    }
  };
  // Added before the flow nodes, so it reads each message before any client
  // reuses it.
  if (Array.isArray(configNode.nodeClients)) configNode.nodeClients.push(client);

  return {
    client,
    provider: integration.provider,
    entities: () => Array.from(entitiesById.values()),
    dispose() {
      if (Array.isArray(configNode.nodeClients)) configNode.nodeClients = configNode.nodeClients.filter((candidate) => candidate !== client);
      integration.dispose();
    }
  };
}

module.exports = { armingFromCid, attachHikvisionCerebrum };
