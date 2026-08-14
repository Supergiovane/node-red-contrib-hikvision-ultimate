/* Unit test for Temperature Measurement Precautionary Alarm events.
 * Run with:
 *   npm run test:alarm-tmpa
 */

const assert = require("assert");
const EventEmitter = require("events");

const registeredTypes = {};
const sentMessages = [];
const server = {
    debug: false,
    addClient(node) {
        this.client = node;
    },
    removeClient() {}
};

const RED = {
    log: { info() {} },
    nodes: {
        createNode(node) {
            const emitter = new EventEmitter();
            node.on = emitter.on.bind(emitter);
            node.emit = emitter.emit.bind(emitter);
            node.status = () => {};
            node.warn = () => {};
            node.send = messages => sentMessages.push(messages);
        },
        getNode() {
            return server;
        },
        registerType(name, constructor) {
            registeredTypes[name] = constructor;
        }
    }
};

require("../nodes/hikvisionUltimateAlarm.js")(RED);

const AlarmNode = registeredTypes.hikvisionUltimateAlarm;
assert.ok(AlarmNode, "Alarm node was not registered");

const tmpaDetails = {
    thermometryUnit: "celsius",
    ruleTemperature: 9,
    currTemperature: 57.6,
    ruleCalibType: "region",
    ruleType: "highest temp is higher than",
    MaximumTemperaturePoint: {
        RegionCoordinates: { positionX: 384, positionY: 218 }
    },
    AbsoluteHigh: { elevation: 0, azimuth: 0, absoluteZoom: 0.1 },
    presetNo: 1,
    alarmRuleTemperature: 150.1
};

new AlarmNode({
    name: "TMPA test",
    topic: "thermal/prealarm",
    server: "camera-config",
    reactto: "tmpa",
    devicetype: 0,
    filterzone: "2",
    channelID: "2"
});

server.client.sendPayload({
    payload: {
        channelID: 2,
        eventType: "TMPA",
        eventState: "active",
        eventDescription: "Temperature Measurement Precautionary Alarm",
        DetectionRegionList: {
            DetectionRegionEntry: {
                regionID: 2,
                TMPA: tmpaDetails
            }
        }
    },
    type: "event"
});

assert.strictEqual(sentMessages.length, 1, "TMPA event was not forwarded exactly once");
assert.strictEqual(sentMessages[0][1], null, "Unexpected error output");
assert.strictEqual(sentMessages[0][2], null, "Unexpected image output");
assert.deepStrictEqual(sentMessages[0][0], {
    payload: true,
    topic: "thermal/prealarm",
    channelid: 2,
    zone: 2,
    description: "Temperature Measurement Precautionary Alarm",
    tmpa: tmpaDetails
});

console.log("TMPA alarm test PASSED.");
