

module.exports = function (RED) {
	function hikvisionUltimateRadar(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.server = RED.nodes.getNode(config.server)
		node.filterzone = config.filterzone || "0";// Rect to alarm coming from...

		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		// Called from config node, to send output to the flow
		node.sendPayload = (_msg) => {
			if (_msg === null || _msg === undefined) return;
			if (_msg.hasOwnProperty("errorDescription")) { node.send([null,_msg]); return; }; // It's a connection error/restore comunication.
			// Radar alarm JSON
			/* 	{
					"ipAddress": "192.168.1.25",
					"ipv6Address": "",
					"portNo": 80,
					"protocol": "HTTP",
					"macAddress": "banana",
					"channelID": 1,
					"dateTime": "2012-01-13T03:15:14+01:00",
					"activePostCount": 1,
					"eventType": "cidEvent",
					"eventState": "active",
					"eventDescription": "CID event",
					"CIDEvent": {
						"code": 1103,
						"standardCIDcode": 1130,
						"type": "zoneAlarm",
						"trigger": "2012-01-13T03:15:14+01:00",
						"upload": "2012-01-13T03:15:14+01:00",
						"CameraList": [],
						"NVRList": [
							{
								"id": 1,
								"ip": "192.168.1.32",
								"port": 8000,
								"channel": 1
							}
						],
						"zone": 1
					}
				} */
			//var oRetMsg = RED.util.cloneMessage(_msg);
		
			if (_msg.hasOwnProperty("payload")
				&& _msg.payload.hasOwnProperty("CIDEvent")
				&& _msg.payload.CIDEvent.type.toString().toLowerCase() === "zonealarm"
				&& _msg.payload.CIDEvent.hasOwnProperty("zone")) {
				var oRetMsg = {}; // Return message
				oRetMsg.connected = _msg.connected;
				oRetMsg.alarm = _msg.payload; // Put the full alarm description here.
				oRetMsg.zone = _msg.payload.CIDEvent.zone + 1; // The zone on device's ISAPI is base 0, while the zone on UI is base 1.
				if (Number(node.filterzone) === 0 || Number(node.filterzone) === Number(oRetMsg.zone)) { // Filter only selcted zones
					// Get the Hikvision alarm codes, that differs from standard SIA codes.
					switch (_msg.payload.CIDEvent.code.toString().toLowerCase()) {
						case "1103":
							// Start alarm. Standard SIA Code is _msg.payload.CIDEvent.standardCIDcode: 1130
							oRetMsg.payload = true;
							node.setNodeStatus({ fill: "red", shape: "dot", text: "Zone " + oRetMsg.zone + " alert" });
							break;
						case "3103":
							// End alarm. Standard SIA Code is _msg.payload.CIDEvent.standardCIDcode: 3130
							oRetMsg.payload = false;
							node.setNodeStatus({ fill: "green", shape: "dot", text: "Zone " + oRetMsg.zone + " normal" });
							break;
						default:
							// Unknown CID code.
							oRetMsg.payload = null;
							node.setNodeStatus({ fill: "grey", shape: "ring", text: "Zone " + oRetMsg.zone + " unknowk CID code " + _msg.payload.CIDEvent.code });
							return; // Unknown state
					}
					node.send([oRetMsg,null]);
				}
			}
		}

		// On each deploy, unsubscribe+resubscribe
		if (node.server) {
			node.server.removeClient(node);
			node.server.addClient(node);
		}

		this.on('input', function (msg) {
		
		});

		node.on("close", function (done) {
			if (node.server) {
				node.server.removeClient(node);
			}
			done();
		});

	}

	RED.nodes.registerType("hikvisionUltimateRadar", hikvisionUltimateRadar);
}