

module.exports = function (RED) {
	function hikvisionUltimateANPR(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.server = RED.nodes.getNode(config.server)

		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		// Called from config node, to send output to the flow
		node.sendPayload = (_msg) => {
			if (_msg.payload === null) { node.send(_msg); return; }; // If null, then it's disconnected. Avoid processing the event

			var retMsg = { topic: _msg.topic, connected: _msg.connected };
			if (_msg.payload.EventNotificationAlert.hasOwnProperty("ANPR")) {
				if (_msg.payload.EventNotificationAlert.ANPR.hasOwnProperty("licensePlate")){
					retMsg.payload = { licensePlate: _msg.payload.EventNotificationAlert.ANPR.licensePlate };
					if (_msg.payload.EventNotificationAlert.ANPR.hasOwnProperty("confidenceLevel")) retMsg.payload.confidenceLevel = _msg.payload.EventNotificationAlert.ANPR.confidenceLevel;
					node.setNodeStatus({ fill: "green", shape: "dot", text: "Plate: " + retMsg.payload.licensePlate });
					node.send(retMsg);
				}				
			} else {
				// The connection is alive, but we've no plates
				node.setNodeStatus({ fill: "green", shape: "ring", text: "Connected. Waiting for plate..." });
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

	RED.nodes.registerType("hikvisionUltimateANPR", hikvisionUltimateANPR);
}