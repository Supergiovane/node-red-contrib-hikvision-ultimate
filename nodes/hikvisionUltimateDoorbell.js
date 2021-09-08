

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
			_msg.topic = node.topic;
			if (_msg.hasOwnProperty("errorDescription")) { node.send([null, _msg]); return; }; // It's a connection error/restore comunication.

			if (_msg.hasOwnProperty("CallerInfo") && _msg.CallerInfo.hasOwnProperty("status")) {

				if (
					((node.ringStatus === "all" || node.ringStatus === _msg.CallerInfo.status.toString()) && _msg.CallerInfo.status.toString() !== "idle")
					&& (node.floorNo === "all" || node.floorNo === _msg.CallerInfo.floorNo.toString())
					&& (node.unitNo === "all" || node.unitNo === _msg.CallerInfo.unitNo.toString())
					&& (node.zoneNo === "all" || node.zoneNo === _msg.CallerInfo.zoneNo.toString())
					&& (node.buildingNo === "all" || node.buildingNo === _msg.CallerInfo.buildingNo.toString())
				) {
					_msg.payload = true;
					node.send(_msg, null);
				}

			}



		}

		// On each deploy, unsubscribe+resubscribe
		if (node.server) {
			node.server.removeClient(node);
			node.server.addClient(node);
		}

		this.on('input', function (msg) {
			node.send(msg, null);

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