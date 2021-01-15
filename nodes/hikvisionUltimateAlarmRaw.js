

module.exports = function (RED) {
	function hikvisionUltimateAlarmRaw(config) {
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

			if (_msg.hasOwnProperty("payload")
				&& _msg.payload.hasOwnProperty("eventType")
				&& _msg.payload.eventType.toString().toLowerCase() === "videoloss"
				&& _msg.payload.eventState.toString().toLowerCase() === "inactive"
				&& _msg.payload.hasOwnProperty("activePostCount") && Number(_msg.payload.activePostCount) === 0) {
				// It's a HertBeat, exit.
				node.setNodeStatus({ fill: "green", shape: "ring", text: "Waiting for alert..." });
				return;
			};

			node.setNodeStatus({ fill: "green", shape: "dot", text: "Alert received" });
			node.send([_msg, null]);
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

	RED.nodes.registerType("hikvisionUltimateAlarmRaw", hikvisionUltimateAlarmRaw);
}