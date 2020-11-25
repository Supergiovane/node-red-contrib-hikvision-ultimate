module.exports = function (RED) {
	function InjectUltimate(config) {
		RED.nodes.createNode(this, config);
		this.config = config;
		var node = this;
		node.curVal = true;
		node.topic = config.topic || "Inject";
		setNodeStatus({ fill: "grey", shape: "dot", text: "Waiting" });


		RED.httpAdmin.post("/InjectUltimate/:id", RED.auth.needsPermission("InjectUltimate.write"), function (req, res) {
			var node = RED.nodes.getNode(req.params.id);
			if (node != null) {
				try {
					node.buttonpressed();
					res.sendStatus(200);
				} catch (err) {
					res.sendStatus(500);
					node.error(RED._("InjectUltimate.failed", { error: err.toString() }));
				}
			} else {
				res.sendStatus(404);
			}
		});

		// 29/08/2020 triggered by button press
		node.buttonpressed = () => {
			setNodeStatus({ fill: "green", shape: "dot", text: "Pin1:true, Pin2:false, Pin3:" + node.curVal.toString() + " (next " + (!node.curVal).toString() + ")" });
			var msgTrue = { payload: true, topic: node.topic };
			var msgFalse = { payload: false, topic: node.topic };
			var msgToggled = { payload: node.curVal, topic: node.topic };
			node.curVal = !node.curVal;
			node.send([msgTrue, msgFalse, msgToggled]);
		}

		function setNodeStatus({ fill, shape, text }) {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

	}



	RED.nodes.registerType("InjectUltimate", InjectUltimate);
}