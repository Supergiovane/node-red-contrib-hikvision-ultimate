

module.exports = function (RED) {
	function hikvisionUltimateDoorbell(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.topic = config.topic || config.name;
		node.server = RED.nodes.getNode(config.server)
		node.ringStatus = (config.ringStatus === null || config.ringStatus === undefined) ? "all" : config.ringStatus.toLowerCase();
		node.floorNo = (config.floorNo === null || config.floorNo === undefined) ? "all" : config.floorNo;
		node.unitNo = (config.unitNo === null || config.unitNo === undefined) ? "all" : config.unitNo;
		node.zoneNo = (config.zoneNo === null || config.zoneNo === undefined) ? "all" : config.zoneNo;
		node.buildingNo = (config.buildingNo === null || config.buildingNo === undefined) ? "all" : config.buildingNo;
		node.currentEmittedMSG = {}; // To keep the current status and avoid emitting msg if already emitted.

		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}


		// Called from config node, to send output to the flow
		// Expected return JSON from ISAPI/VideoIntercom/callerInfo
		// {
		//     "CallerInfo":	{
		//         "buildingNo":	1,
		//         "floorNo":	1,
		//         "zoneNo":	1,
		//         "unitNo":	1,
		//         "devNo":	88,
		//         "devType":	1,
		//         "lockNum":	1,
		//         "status":	"idle" ("idle,ring,onCall")
		//     }
		// }
		// "devType":{ 1-door station, 2-master station, 
		// 3-indoor station, 4-outer door station, 5-villa door station, 6-doorphone,
		// 7-Infosight Client Software, 8-iVMS-4200 Client Software, 9-APP, 
		// 10-doorbell, 11-VOIP Client Software, 12-network camera, 13-access control device*/
		node.sendPayload = (_msg) => {
			if (_msg === null || _msg === undefined) return;

			if (_msg.type !== undefined && _msg.type === 'img') {
				_msg.extension = extension;
				node.send([null, null, _msg]);
				return;
			}


			_msg.topic = node.topic;
			_msg.payload = true;
			if (_msg.hasOwnProperty("errorDescription")) { node.send([null, _msg]); return; }; // It's a connection error/restore comunication.
			//node.send([_msg, null]);
			if (_msg.hasOwnProperty("CallerInfo") && _msg.CallerInfo.hasOwnProperty("status")) {

				if (
					((node.ringStatus === "all" || node.ringStatus === _msg.CallerInfo.status.toString()))
					&& (node.floorNo === "all" || node.floorNo === _msg.CallerInfo.floorNo.toString())
					&& (node.unitNo === "all" || node.unitNo === _msg.CallerInfo.unitNo.toString())
					&& (node.zoneNo === "all" || node.zoneNo === _msg.CallerInfo.zoneNo.toString())
					&& (node.buildingNo === "all" || node.buildingNo === _msg.CallerInfo.buildingNo.toString())
				) {
					delete _msg._msgid; // To allow objects compare
					delete node.currentEmittedMSG._msgid; // To allow objects compare

					if (RED.util.compareObjects(node.currentEmittedMSG, _msg)) return; // Omit sending the same notification more than once
					node.currentEmittedMSG = _msg;
					// Oputputs only msg that are no "idle"
					if (_msg.CallerInfo.status.toString() !== "idle") node.send([_msg, null]);
				}

			}
		}

		// On each deploy, unsubscribe+resubscribe
		if (node.server) {
			node.server.removeClient(node);
			node.server.addClient(node);
		}


		this.on('input', function (msg) {
			// node.request = async function (_callerNode, _method, _URL, _body) {

			if (msg.hasOwnProperty("openDoor")) {
				// Open the door latch
				let iDoor = msg.openDoor || 1;
				// <RemoteOpenDoor version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"> 
				// <gateWayIndex>
				// 	<!--required, xs:integer, access control point No., currently, the value can only be equal to 1--> 
				// </gateWayIndex>
				// <command>
				// 	<!--required, xs:string, unlocking command, currently, only the "unlock" is supported-->
				// </command>
				// <controlSrc>
				// 	<!--required, xs:string, control command source, the format is "web site+IP address"-->
				// </controlSrc>
				// </RemoteOpenDoor>
				let sBody = `<RemoteOpenDoor version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
				<gateWayIndex>`+ iDoor + `</gateWayIndex>
				<command>unlock</command>
				<controlSrc>HikvisionUltimate</controlSrc>
				</RemoteOpenDoor>
				`;

				// Try with API 2.0
				node.server.request(node, "PUT", "/ISAPI/VideoIntercom/remoteOpenDoor", sBody).then(success => {
					node.setNodeStatus({ fill: "green", shape: "ring", text: "Door unlocked" });
					msg.payload = true;
					node.send([msg, null]);
				}).catch(error => {
					// Try with API 1.0
					node.server.request(node, "PUT", "/ISAPI/AccessControl/RemoteControl/door/" + iDoor, "<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>").then(success => {
						node.setNodeStatus({ fill: "green", shape: "ring", text: "Door unlocked" });
						msg.payload = true;
						node.send([msg, null]);
					}).catch(error => {
						node.setNodeStatus({ fill: "red", shape: "ring", text: "Error unlocking door " + error.message });
						msg.payload = false;
						node.send([msg, null]);
					});

				});

			}

			if (msg.hasOwnProperty("hangUp")) {
				try {
					// Both calls are needed to stop current ring and call

					// Stop ringing. This stops the APP ringing.
					// Try with API 2.0, but with some firmware it doesn't work
					node.server.request(node, "DELETE", "/ISAPI/VideoIntercom/ring", "").then(success => {
						node.setNodeStatus({ fill: "green", shape: "ring", text: "Stop ringing" });
					}).catch(error => {
						node.setNodeStatus({ fill: "red", shape: "ring", text: "Error stop ringing " + error.message });
						RED.log.error("hikvisionUltimateDoorbell: Error stopping ring " + error.message);
					});

					// Stop current call initiated by the intercom. This stops the intercom call.
					// Try with API 2.0
					setTimeout(() => {
						//const jHangUp = JSON.stringify(JSON.parse(`{"CallSignal": { "cmdType": "hangUp" } }`));
						try {
							const jHangUp = JSON.parse(JSON.stringify(JSON.parse(`{"CallSignal": {"cmdType": "hangUp"}}`)))
							node.server.request(node, "PUT", "/ISAPI/VideoIntercom/callSignal?format=json", jHangUp).then(success => {
								node.setNodeStatus({ fill: "green", shape: "ring", text: "Hang Up" });
							}).catch(error => {
								RED.log.error("hikvisionUltimateDoorbell: Error hangUp " + error.message);
							});
						} catch (error) {
						}

						setTimeout(() => {
							try {
								const jReject = JSON.parse(JSON.stringify(JSON.parse(`{"CallSignal": {"cmdType": "reject"}}`)))
								node.server.request(node, "PUT", "/ISAPI/VideoIntercom/callSignal?format=json", jReject).then(success => {
									node.setNodeStatus({ fill: "green", shape: "ring", text: "reject" });
								}).catch(error => {
									RED.log.error("hikvisionUltimateDoorbell: Error reject " + error.message);
								});
							} catch (error) {
							}

						}, 1000);
					}, 1000);
				} catch (error) {

				}

			}



		});

		node.on("close", function (done) {
			if (node.server) {
				node.server.removeClient(node);
			}
			if (node.server) {
				node.server.removeClient(node);
			}
			done();
		});

	}

	RED.nodes.registerType("hikvisionUltimateDoorbell", hikvisionUltimateDoorbell);
}