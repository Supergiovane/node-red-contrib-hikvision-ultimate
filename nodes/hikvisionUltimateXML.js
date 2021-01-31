

module.exports = function (RED) {
	function hikvisionUltimateXML(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.server = RED.nodes.getNode(config.server)
		node.XML = config.XML === undefined ? "" : config.XML;
		node.path = config.path === undefined ? "" : config.path;
		node.method = config.method === undefined ? "PUT" : config.method;


		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}



		this.on('input', function (msg) {

			// Overrides
			if (msg.hasOwnProperty("XML")) node.XML = msg.XML;
			if (msg.hasOwnProperty("path")) node.path = msg.path;
			if (msg.hasOwnProperty("method")) node.method = msg.method;
			
			node.setNodeStatus({ fill: "green", shape: "ring", text: "OK" });
			try {
				// Params: _callerNode, _method, _URL, _body
				node.server.request(node, node.method, node.path, node.XML);
			} catch (error) {
				
			}

		});

		// Called from config node, to send output to the flow
		node.sendPayload = (_msg) => {
			
		};


		node.on("close", function (done) {
			done();
		});

	}

	RED.nodes.registerType("hikvisionUltimateXML", hikvisionUltimateXML);
}