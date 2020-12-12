
module.exports = function (RED) {

	const sharp = require("sharp"); // Resize

	function hikvisionUltimatePicture(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.server = RED.nodes.getNode(config.server)
		node.PTZPreset = (config.PTZPreset === null || config.PTZPreset === undefined) ? "1" : config.PTZPreset;
		node.channelID = (config.channelID === null || config.channelID === undefined) ? "1" : config.channelID;
		node.rotateimage = (config.rotateimage === null || config.rotateimage === undefined) ? "0" : config.rotateimage;
		node.heightimage = (config.heightimage === null || config.heightimage === undefined || config.heightimage.trim() === "") ? "0" : config.heightimage;
		node.widthimage = (config.widthimage === null || config.widthimage === undefined || config.rotateimage.trim() === "") ? "0" : config.widthimage;

		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		// Called from config node, to send output to the flow
		node.sendPayload = (_msg) => {
			if (_msg === null || _msg === undefined) return;
			if (_msg.hasOwnProperty("errorDescription")) { node.send([null, _msg]); return; }; // It's a connection error/restore comunication.
			if (_msg.hasOwnProperty("payload")) {
				if (_msg.payload.hasOwnProperty("eventType")) {
					// Chech if it's only a hearbeat alarm
					try {
						var sAlarmType = _msg.payload.eventType.toString().toLowerCase();
						if (sAlarmType === "videoloss" && _msg.payload.hasOwnProperty("activePostCount") && _msg.payload.activePostCount == "0") {
							node.setNodeStatus({ fill: "green", shape: "ring", text: "Received HeartBeat (the device is online)" });
							return; // It's a Heartbeat
						}
					} catch (error) { }
				}
			};

			var msg_payload = sharp(_msg.payload);
			if (node.rotateimage !== 0) msg_payload = msg_payload.rotate(Number(node.rotateimage));
			if (node.heightimage !== "0" && node.widthimage !== "0") msg_payload = msg_payload.resize(Number(node.widthimage), Number(node.heightimage));
			msg_payload.toBuffer().then(picture => {
				_msg.payload = "data:image/jpg;base64," + picture.toString("base64");
				node.send(_msg, null);
				node.setNodeStatus({ fill: "green", shape: "dot", text: "Picture received" });
			}).catch(err => { });

			// sharp(_msg.payload).rotate().resize(4000, 3000).toBuffer().then(picture => {
			// 	_msg.payload = picture.toString("base64");
			// 	node.send(_msg, null);
			// 	node.setNodeStatus({ fill: "green", shape: "dot", text: "Picture received" });
			// }).catch(err => { });



		}

		// On each deploy, unsubscribe+resubscribe
		if (node.server) {
			node.server.removeClient(node);
			node.server.addClient(node);
		}

		this.on('input', function (msg) {
			if (msg === null || msg === undefined) return;
			if (msg.hasOwnProperty("payload") && msg.hasOwnProperty("payload") !== null && msg.hasOwnProperty("payload") !== undefined) {
				if (msg.payload === true) {
					// Recall PTZ Preset
					// Params: _callerNode, _method, _URL, _body
					try {
						// http://192.168.1.13/ISAPI/Streaming/Channels/101/picture
						node.server.request(node, "GET", "/ISAPI/Streaming/channels/" + node.channelID + "01/picture", null);
					} catch (error) {

					}
				}
			}

		});

		node.on("close", function (done) {
			if (node.server) {
				node.server.removeClient(node);
			}
			done();
		});

	}

	RED.nodes.registerType("hikvisionUltimatePicture", hikvisionUltimatePicture);
}