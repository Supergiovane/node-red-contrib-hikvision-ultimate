

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
		node.sendPayload = (_msg, extension = '') => {
			if (_msg === null || _msg === undefined) return;
			_msg.topic = node.topic;
			if (_msg.hasOwnProperty("errorDescription")) { node.send([null, _msg, null]); return; }; // It's a connection error/restore comunication.
			if (!_msg.hasOwnProperty("payload") || (_msg.hasOwnProperty("payload") && _msg.payload === undefined)) return;

			if (_msg.type !== undefined && _msg.type === 'img') {
				_msg.extension = extension;
				node.send([null, null, _msg]);
				return;
			}


			// Heartbeat discard
			// 	<activePostCount>0</activePostCount>
			//  <eventType>videoloss</eventType>
			//  <eventState>inactive</eventState>
			if (_msg.hasOwnProperty("payload")
				&& _msg.payload.hasOwnProperty("eventType")
				&& _msg.payload.eventType.toString().toLowerCase() === "videoloss"
				&& _msg.payload.eventState.toString().toLowerCase() === "inactive"
				&& _msg.payload.hasOwnProperty("activePostCount") && (Number(_msg.payload.activePostCount) === 0 || Number(_msg.payload.activePostCount) === 1)) {
				// It's a HertBeat, exit.
				node.setNodeStatus({ fill: "green", shape: "ring", text: "Waiting for alert..." });
				return;
			};

			node.setNodeStatus({ fill: "green", shape: "dot", text: "Alert received" });
			node.send([_msg, null, null]);
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