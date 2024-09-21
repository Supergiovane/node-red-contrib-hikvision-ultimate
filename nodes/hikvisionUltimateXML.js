

module.exports = function (RED) {
	function hikvisionUltimateXML(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.server = RED.nodes.getNode(config.server)
		node.xmlText = config.xmlText === undefined ? "" : config.xmlText;
		node.path = config.path === undefined ? "" : config.path;
		node.method = config.method === undefined ? "PUT" : config.method;


		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		// Called from config node, to send output to the flow
		node.sendPayload = (_msg) => {
			if (_msg.type !== undefined && _msg.type === 'img') {
				// The payload is an image, exit.
				return;
			}
			node.setNodeStatus({ fill: "green", shape: "ring", text: "Received response" });
			if (_msg === null || _msg === undefined) return;
			node.send(_msg);

		}

		this.on('input', function (msg) {

			// Overrides
			if (msg.hasOwnProperty("XML")) node.xmlText = msg.XML;
			if (msg.hasOwnProperty("path")) node.path = msg.path;
			if (msg.hasOwnProperty("method")) node.method = msg.method;

			node.setNodeStatus({ fill: "green", shape: "ring", text: "Send request..." });
			try {
				// Params: _callerNode, _method, _URL, _body, _fromXMLNode
				node.server.request(node, node.method, node.path, node.xmlText, true);
			} catch (error) {

			}

		});


		node.on("close", function (done) {
			done();
		});

	}

	RED.nodes.registerType("hikvisionUltimateXML", hikvisionUltimateXML);
}