module.exports = function (RED) {
	function InterruptFlowUltimate(config) {
		RED.nodes.createNode(this, config);
		this.config = config;
		var node = this;
		setNodeStatus({ fill: "green", shape: "ring", text: "-> pass" });
		node.bInviaMessaggio = true; // Send the message or not
		node.currentMsg = {}; // Stores current payload
		node.sTriggerTopic = node.config.triggertopic.replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/gi, '') || "trigger"; // Topic controlling the bInviaMessaggio
		this.on('input', function (msg) {
			var sIncomingTopic = "";
			if (msg.hasOwnProperty("topic")) {
				// 06/11/2019 
				sIncomingTopic = msg.topic.replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/gi, ''); // Cut unwanted Characters
				if (sIncomingTopic == node.sTriggerTopic) {
					if (msg.hasOwnProperty("play")) {
						node.currentMsg.isReplay = true;
						setNodeStatus({ fill: "yellow", shape: "dot", text: "-> replay" });
						// Restore previous status
						setTimeout(() => {
							if (node.bInviaMessaggio) {
								setNodeStatus({ fill: "green", shape: "dot", text: "-> pass" });
							} else {
								setNodeStatus({ fill: "red", shape: "dot", text: "|| stop (stored last msg)" });
							}
						}, 1000)
						node.send(node.currentMsg);
						return;
					} else if (ToBoolean(msg.payload) === true) {
						node.bInviaMessaggio = true;
						setNodeStatus({ fill: "green", shape: "dot", text: "-> pass" });
						return;
					} else if (ToBoolean(msg.payload) === false) {
						node.bInviaMessaggio = false;
						setNodeStatus({ fill: "red", shape: "dot", text: "|| stop (stored last msg)" });
						return;
					}
				}
			}
			if (node.bInviaMessaggio) {
				node.currentMsg = msg;
				node.send(msg);
			}
		});

		function setNodeStatus({ fill, shape, text }) {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}


		function ToBoolean(value) {
			var res = false;

			if (typeof value === 'boolean') {
				res = value;
			}
			else if (typeof value === 'number' || typeof value === 'string') {
				// Is it formated as a decimal number?
				if (decimal.test(value)) {
					var v = parseFloat(value);
					res = v != 0;
				}
				else {
					res = value.toLowerCase() === "true";
				}
			}

			return res;
		};
	}


	RED.nodes.registerType("InterruptFlowUltimate", InterruptFlowUltimate);
}