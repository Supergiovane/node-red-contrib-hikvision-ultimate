module.exports = function (RED) {
	function hikvisionUltimatePTZ(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.topic = config.topic || node.name;
		node.server = RED.nodes.getNode(config.server)
		node.PTZPreset = (config.PTZPreset === null || config.PTZPreset === undefined) ? "1" : config.PTZPreset;
		node.channelID = (config.channelID === null || config.channelID === undefined) ? "1" : config.channelID;

		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		// Called from config node, to send output to the flow
		node.sendPayload = (_msg) => {
			if (_msg === null || _msg === undefined) return;
			_msg.topic = node.topic;
			if (_msg.hasOwnProperty("errorDescription")) { node.send([null, _msg]); return; }; // It's a connection error/restore comunication.
			if (_msg.hasOwnProperty("payload")) {
				if (_msg.payload.hasOwnProperty("eventType")) {
					// Chech if it's only a hearbeat alarm
					try {
						var sAlarmType = _msg.payload.eventType.toString().toLowerCase();
						if (sAlarmType === "videoloss" && _msg.payload.hasOwnProperty("activePostCount") && _msg.payload.activePostCount == "0") {
							node.setNodeStatus({ fill: "green", shape: "ring", text: "Received HeartBeat (the device is online)" });
							return; // It's a Heartbeat
						}
					} catch (error) { }
				}
			}
			node.send([_msg, null]);
			node.setNodeStatus({ fill: "green", shape: "dot", text: "PTZ Pteset recalled." });
		}

		// On each deploy, unsubscribe+resubscribe
		if (node.server) {
			node.server.removeClient(node);
			node.server.addClient(node);
		}

		this.on('input', function (msg) {
			if (msg === null || msg === undefined) return;
			if (msg.hasOwnProperty("payload") && msg.hasOwnProperty("payload") !== null && msg.hasOwnProperty("payload") !== undefined) {
				if (msg.payload === true) {
					// Recall PTZ Preset
					// Params: _callerNode, _method, _URL, _body
					try {
						node.server.request(node, "PUT", "/ISAPI/PTZCtrl/channels/" + node.channelID + "/presets/" + node.PTZPreset + "/goto", "");
					} catch (error) {

					}
				}
			}

		});

		node.on("close", function (done) {
			if (node.server) {
				node.server.removeClient(node);
			}
			done();
		});

	}

	RED.nodes.registerType("hikvisionUltimatePTZ", hikvisionUltimatePTZ);
}