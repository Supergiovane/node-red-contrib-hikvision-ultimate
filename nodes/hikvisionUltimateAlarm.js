

module.exports = function (RED) {
	function hikvisionUltimateAlarm(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.topic = config.topic || config.name;
		node.server = RED.nodes.getNode(config.server)
		node.reactto = (config.reactto === null || config.reactto === undefined) ? "vmd" : config.reactto.toLowerCase();// Rect to alarm coming from...

		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		// Called from config node, to send output to the flow
		node.sendPayload = (_msg) => {
			if (_msg === null || _msg === undefined) return;
			_msg.topic = node.topic;
			if (_msg.hasOwnProperty("errorDescription")) { node.send([null, _msg]); return; }; // It's a connection error/restore comunication.

			var sAlarmType = "";
			var bAlarmStatus = false;
			if (_msg.hasOwnProperty("payload")) {
				if (_msg.payload.hasOwnProperty("eventType")) {
					// Check if it's only a hearbeat alarm
					sAlarmType = _msg.payload.eventType.toString().toLowerCase();
					if (sAlarmType === "videoloss" && _msg.payload.hasOwnProperty("activePostCount") && _msg.payload.activePostCount == "0") {
						node.setNodeStatus({ fill: "green", shape: "ring", text: "Received HeartBeat (the device is online)" });
						return; // It's a Heartbeat
					}
				}
				if (_msg.payload.hasOwnProperty("eventState")) {
					bAlarmStatus = (_msg.payload.eventState.toString().toLowerCase() === "active" ? true : false);
				} else {
					// Mmmm.... no event state?
					node.setNodeStatus({ fill: "red", shape: "ring", text: "Received alarm but no state!" });
					return;
				}
				//console.log ("BANANA " + _msg.payload.eventState.toString().toLowerCase())
				// check alarm filter
				var aReactTo = node.reactto.split(","); // node.reactto can contain multiple names for the same event, depending from firmware
				for (let index = 0; index < aReactTo.length; index++) {
					const element = aReactTo[index];
					if (element !== null && element !== undefined && element.trim() !== "" && sAlarmType === element) {
						var oRetMsg = {}; // Return message
						oRetMsg.payload = bAlarmStatus;
						oRetMsg.topic = _msg.topic;
						oRetMsg.channelid = (_msg.payload.hasOwnProperty("channelID") ? _msg.payload.channelID : "0");
						oRetMsg.description = (_msg.payload.hasOwnProperty("eventDescription") ? _msg.payload.eventDescription : "");
						node.send([oRetMsg, null]);
						node.setNodeStatus({ fill: "green", shape: "dot", text: "Alarm " + (bAlarmStatus === true ? "start" : "end") });
						return; // Find first occurrence, exit.

					}
				}
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

	RED.nodes.registerType("hikvisionUltimateAlarm", hikvisionUltimateAlarm);
}