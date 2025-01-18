const _ = require('lodash')

module.exports = function (RED) {
	function hikvisionUltimateAxPro(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.topic = config.topic || config.name;
		node.server = RED.nodes.getNode(config.server)
		node.zonesStatus = [] // Contains the status of all zones
		node.outputtype = Number(config.outputtype || 0)

		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		// Called from config node, to send output to the flow
		node.sendPayload = (_msg) => {
			if (_msg === null || _msg === undefined) return;
			_msg.topic = node.topic;
			if (_msg.hasOwnProperty("errorDescription")) { node.send([null, _msg]); return; }; // It's a connection error/restore comunication.
			// If heartbeat, return
			if (_msg.payload.hasOwnProperty("eventType") && _msg.payload.hasOwnProperty("eventState") && _msg.payload.eventType === "cidEvent" && _msg.payload.eventState === "inactive") return
			if ((node.outputtype === 0 || node.outputtype === 1) && _msg.payload.hasOwnProperty('CIDEvent')) {
				// ALARM EVENT
				node.send([{ payload: { CIDEvent: RED.util.cloneMessage(_msg.payload.CIDEvent) } }, null]); // Clone message to avoid adding _msgid
			}
			if ((node.outputtype === 0 || node.outputtype === 2) && _msg.payload.hasOwnProperty('ZoneList')) {
				// CHECK ONLY THE CHANGED ZONE STATUS
				for (let index = 0; index < _msg.payload.ZoneList.length; index++) {
					try {
						const receivedZone = _msg.payload.ZoneList[index].Zone;
						let foundInZoneStatus = node.zonesStatus.find((element) => element.id === receivedZone.id)
						if (!_.isEqual(foundInZoneStatus, receivedZone)) {
							if (foundInZoneStatus === undefined) {
								node.zonesStatus.push(receivedZone) // Add updated
							} else {
								node.zonesStatus[node.zonesStatus.findIndex((element) => element.id === receivedZone.id)] = receivedZone
								//node.zonesStatus.splice(foundInZoneStatus)
								//node.zonesStatus.push(receivedZone) // Add updated
							}
							node.setNodeStatus({ fill: "green", shape: "dot", text: "Zone changed " + receivedZone.name });
							node.send([{ payload: { zoneUpdate: RED.util.cloneMessage(receivedZone) } }, null]); // Clone message to avoid adding _msgid
						}
					} catch (error) { }
				}
			} else {
				//node.send([_msg, null])
				node.setNodeStatus({ fill: "green", shape: "ring", text: "Waiting for zone change" });
			}

		}

		// On each deploy, unsubscribe+resubscribe
		if (node.server) {
			node.server.removeClient(node);
			node.server.addClient(node);
		}

		this.on('input', function (msg) {
			try {
				// Disarm Area
				if (msg.hasOwnProperty("disarmArea")) {
					node.server.disarmArea(msg.disarmArea)
				}
				// Arm Away Area
				if (msg.hasOwnProperty("armAwayArea")) {
					node.server.armAwayArea(msg.armAwayArea)
				}
				// Arm Stay Area
				if (msg.hasOwnProperty("armStayArea")) {
					node.server.armStayArea(msg.armStayArea)
				}
				// Clear Alarm Area
				if (msg.hasOwnProperty("clearAlarmArea")) {
					node.server.clearAlarmArea(msg.clearAlarmArea)
				}

				// Disarm All Area in a batch
				if (msg.hasOwnProperty("disarmAllAreas")) {
					node.server.disarmAllAreas()
				}
				// Clear All Alarm Areas
				if (msg.hasOwnProperty("clearAllAlarmAreas")) {
					node.server.clearAllAlarmAreas()
				}

			} catch (error) { }


		});

		node.on("close", function (done) {
			if (node.server) {
				node.server.removeClient(node);
			}
			done();
		});

	}

	RED.nodes.registerType("hikvisionUltimateAxPro", hikvisionUltimateAxPro);
}