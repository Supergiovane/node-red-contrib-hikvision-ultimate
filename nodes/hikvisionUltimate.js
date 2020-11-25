module.exports = function (RED) {
	function hikvisionAlarmRaw(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		var urllib = require('urllib');

		node.config = config;
		node.jSonStates = {}; // JSON object containing the states. 
		node.sInitializeWith = typeof node.config.sInitializeWith === "undefined" ? "WaitForPayload" : node.config.sInitializeWith;
		node.persistPath = path.join(RED.settings.userDir, "hikvisionAlarmRawpersist"); // 26/10/2020 Contains the path for the states dir.

		// Helper for the config html, to be able to delete the peristent states file
		RED.httpAdmin.get("/stateoperation_delete", RED.auth.needsPermission('hikvisionAlarmRaw.read'), function (req, res) {
			//node.send({ req: req });
			// Detele the persist file
			//var _node = RED.nodes.getNode(req.query.nodeid); // Gets node object from nodeit, because when called from the config html, the node object is not defined
			var _nodeid = req.query.nodeid;
			try {
				if (fs.existsSync(path.join(node.persistPath, _nodeid.toString()))) fs.unlinkSync(path.join(node.persistPath, _nodeid.toString()));
			} catch (error) {
			}
			res.json({ status: 220 });
		});


		
		var options = {
			"digestAuth": "admin:cd87m.cd87m",
			"streaming": true,
			"timeout": 5000
		};
		urllib.request('http://192.168.1.32/ISAPI/Event/notification/alertStream', options, function (err, data, res) {
			if (err) {
				console.log("ERROR: " + err);
			}
			try {
				console.log("STATUS: " + res.statusCode);
			} catch (error) {
			}
			try {
				console.log("HEADERS: " + res.headers);
			} catch (error) {
			}
			try {
				console.log("DATA: " + data.toString());

			} catch (error) {

			}
			res.on('data', function (chunk) {
				console.log("chunk: " + chunk.toString());
			});
			res.on('end', function () {
				console.log("END");
				done();
			});

		});


		this.on('input', function (msg) {

			setNodeStatus({ fill: "green", shape: "ring", text: "banana" });
		});

		this.on('close', function (removed, done) {
			
			done();
		});

		

		function setNodeStatus({ fill, shape, text }) {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		
	}

	RED.nodes.registerType("hikvisionAlarmRaw", hikvisionAlarmRaw);
}