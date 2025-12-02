

module.exports = function (RED) {
	function hikvisionUltimateANPR(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.topic = config.topic || config.name;
		node.server = RED.nodes.getNode(config.server)
		const isDebug = node.server && node.server.debug;
		const logDebug = (text) => {
			if (isDebug) RED.log.info(`hikvisionUltimateANPR: ${text}`);
		};
		node.avoidsameplatetime = config.avoidsameplatetime || 20; // Doesn't send the same plate in this timeframe, in seconds.
		node.currentPlate = ""; // Stores the current plate (for the avoidsameplatetime function)
		node.timerAvoidSamePlate = null; // Timer for avoiding repeating plate
		node.bAvoidSamePlate = false;

		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		// Called from config node, to send output to the flow
		node.sendPayload = (_msg) => {
			if (_msg === null || _msg === undefined) return;
			_msg.topic = node.topic;
			if (_msg.hasOwnProperty("errorDescription")) {
				logDebug(`Connection status message: ${_msg.errorDescription || ""}`);
				node.send([null, _msg]);
				return;
			}; // It's a connection error/restore comunication.
			if (!_msg.hasOwnProperty("payload") || (_msg.hasOwnProperty("payload") && (_msg.payload === undefined || _msg.payload === null))) {
				logDebug("Discarded incoming message without payload");
				return;
			}

			if (node.currentPlate === _msg.payload) {
				if (node.bAvoidSamePlate) {
					logDebug(`Skipping duplicate plate '${_msg.payload}' for ${node.avoidsameplatetime}s window`);
					try { node.setNodeStatus({ fill: "grey", shape: "ring", text: "Temporary block same plate " + _msg.payload }); } catch (error) { };
					return;
				}
			}

			// Timer for avoiding same plate 
			// ##########################
			if (node.timerAvoidSamePlate !== null) clearTimeout(node.timerAvoidSamePlate);
			node.bAvoidSamePlate = true;
			node.timerAvoidSamePlate = setTimeout(() => {
				node.bAvoidSamePlate = false;
			}, node.avoidsameplatetime * 1000);
			// ##########################

			node.currentPlate = _msg.payload;
			logDebug(`Emitting plate '${node.currentPlate}'`);
			node.send([_msg, null]);
			try {
				node.setNodeStatus({ fill: "green", shape: "dot", text: "Plate " + _msg.payload });
			} catch (error) { }
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
