

module.exports = function (RED) {
	function hikvisionUltimateAccessControlTerminal(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.topic = config.topic || config.name;
		node.server = RED.nodes.getNode(config.server)
		node.filtermajorevent = Number(config.filtermajorevent) || 0;
		node.filterminorevent = parseInt(config.filterminorevent || 0, 16); // Hex to decimal


		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		// Called from config node, to send output to the flow
		node.sendPayload = (_msg) => {
			if (_msg === null || _msg === undefined) return;
			_msg.topic = node.topic;
			if (_msg.hasOwnProperty("errorDescription")) { node.send([null, _msg]); return; }; // It's a connection error/restore comunication.
			if (!_msg.hasOwnProperty("payload") || (_msg.hasOwnProperty("payload") && (_msg.payload === undefined || _msg.payload === null))) return;

			// Apply filter
			if (node.filtermajorevent > 0) {
				if (Number(_msg.payload.major) === node.filtermajorevent) {
					if (node.filterminorevent > 0) {
						if (Number(_msg.payload.minor) === node.filterminorevent) {
							node.send([_msg, null]);
							setTimeout(() => {
								node.setNodeStatus({ fill: "green", shape: "dot", text: "Event " + _msg.payload.eventDescription });
							}, 1000);
						} else {
							try {
								setTimeout(() => {
									node.setNodeStatus({ fill: "grey", shape: "dot", text: "Filtered " + _msg.payload.eventDescription });
								}, 500);
							} catch (error) { }
							return;
						}
					} else {
						node.send([_msg, null]);
						setTimeout(() => {
							node.setNodeStatus({ fill: "green", shape: "dot", text: "Event " + _msg.payload.eventDescription });
						}, 1000);
					}
				}
			} else {
				node.send([_msg, null]);
				try {
					setTimeout(() => {
						node.setNodeStatus({ fill: "green", shape: "dot", text: "Event " + _msg.payload.eventDescription });
					}, 1000);
				} catch (error) { }
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

	RED.nodes.registerType("hikvisionUltimateAccessControlTerminal", hikvisionUltimateAccessControlTerminal);
}