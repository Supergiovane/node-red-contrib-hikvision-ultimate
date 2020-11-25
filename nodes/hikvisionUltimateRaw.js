var urllib = require('urllib');

module.exports = function (RED) {
	function hikvisionAlarmRaw(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.server = RED.nodes.getNode(config.server)

		
		
		
		

		function setNodeStatus({ fill, shape, text }) {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		
	}

	RED.nodes.registerType("hikvisionAlarmRaw", hikvisionAlarmRaw);
}