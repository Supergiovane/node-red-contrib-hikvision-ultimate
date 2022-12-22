

module.exports = function (RED) {
	function hikvisionUltimateAxPro(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.topic = config.topic || config.name;
		node.server = RED.nodes.getNode(config.server)

		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		// Called from config node, to send output to the flow
		node.sendPayload = (_msg) => {
			if (_msg === null || _msg === undefined) return;
			_msg.topic = node.topic;
			if (_msg.hasOwnProperty("errorDescription")) { node.send([null, _msg]); return; }; // It's a connection error/restore comunication.
			if (!_msg.hasOwnProperty("payload") || (_msg.hasOwnProperty("payload") && _msg.payload === undefined)) return;
			if (_msg.payload.hasOwnProperty('CIDEvent')) {
				// Move the CID Event out of the payload
				_msg.CIDEvent = _msg.payload.CIDEvent
				// Delete the Payload
				delete (_msg.payload)
			} else {
				node.setNodeStatus({ fill: "green", shape: "ring", text: "Waiting for alarm" });
				return // Discard Heartbeat
			}
			node.setNodeStatus({ fill: "green", shape: "dot", text: "Alert received" });
			node.send([_msg, null]);
		}

		// On each deploy, unsubscribe+resubscribe
		if (node.server) {
			node.server.removeClient(node);
			node.server.addClient(node);
		}

		this.on('input', function (msg) {

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