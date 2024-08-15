

module.exports = function (RED) {
	function hikvisionUltimateSpeaker(config) {
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
			if (!_msg.hasOwnProperty("payload") || (_msg.hasOwnProperty("payload") && (_msg.payload === undefined || _msg.payload === null))) return;


			node.send([_msg, null]);
			try {
				//node.setNodeStatus({ fill: "green", shape: "dot", text: "Plate " + _msg.payload });
			} catch (error) { }
		}

		// On each deploy, unsubscribe+resubscribe
		if (node.server) {
			node.server.removeClient(node);
			node.server.addClient(node);
		}

		this.on('input', function (msg) {
			if (msg.payload === true) {
				(async () => {
					msg.payload = await node.server.playAloud(config.customAudioID, config.volume);
					node.send([msg, null]);
					node.setNodeStatus({ fill: "green", shape: "dot", text: "Play" });
				})();
			}
			if (msg.payload === false) {
				(async () => {
					msg.payload = await node.server.stopFile(config.customAudioID);
					node.send([msg, null]);
					node.setNodeStatus({ fill: "grey", shape: "dot", text: "Stop" });
				})();
			}
		});

		node.on("close", function (done) {
			if (node.server) {
				node.server.removeClient(node);
			}
			done();
		});

	}

	RED.nodes.registerType("hikvisionUltimateSpeaker", hikvisionUltimateSpeaker);
}