

module.exports = function (RED) {
	function hikvisionUltimateAlarmRaw(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.server = RED.nodes.getNode(config.server)
		

		// On each deploy, unsubscribe+resubscribe
		if (node.server) {
			node.server.removeClient(node);
			node.server.addClient(node);
		}



		node.on("close", function (done) {
			if (node.server) {
				node.server.removeClient(node);
			}
			done();
		})


		function setNodeStatus({ fill, shape, text }) {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}


	}

	RED.nodes.registerType("hikvisionUltimateAlarmRaw", hikvisionUltimateAlarmRaw);
}