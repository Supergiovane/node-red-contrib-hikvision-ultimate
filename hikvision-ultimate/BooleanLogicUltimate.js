module.exports = function (RED) {
	function BooleanLogicUltimate(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		var fs = require("fs");
		var path = require("path");
		var decimal = /^\s*[+-]{0,1}\s*([\d]+(\.[\d]*)*)\s*$/

		node.config = config;
		node.jSonStates = {}; // JSON object containing the states. 
		node.sInitializeWith = typeof node.config.sInitializeWith === "undefined" ? "WaitForPayload" : node.config.sInitializeWith;
		node.persistPath = path.join(RED.settings.userDir, "booleanlogicultimatepersist"); // 26/10/2020 Contains the path for the states dir.

		// Helper for the config html, to be able to delete the peristent states file
		RED.httpAdmin.get("/stateoperation_delete", RED.auth.needsPermission('BooleanLogicUltimate.read'), function (req, res) {
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

		// 26/10/2020 Check for path and create it if doens't exists
		if (!fs.existsSync(node.persistPath)) {
			// Create the path
			try {
				fs.mkdirSync(node.persistPath);
				// Backward compatibility: Copy old states dir into the new folder
				if (fs.existsSync("states")) {
					var filenames = fs.readdirSync("states");
					filenames.forEach(file => {
						RED.log.info("BooleanLogicUltimate: migrating from old states path to the new persist " + file);
						fs.copyFileSync("states/" + file, path.join(node.persistPath, path.basename(file)));
					});
				}
			} catch (error) { }
		}

		// Populate the state array with the persisten file
		if (node.config.persist == true) {
			try {
				var contents = fs.readFileSync(path.join(node.persistPath, node.id.toString())).toString();
				if (typeof contents !== 'undefined') {
					node.jSonStates = JSON.parse(contents);
					setNodeStatus({ fill: "blue", shape: "ring", text: "Loaded persistent states (" + Object.keys(node.jSonStates).length + " total)." });
				}
			} catch (error) {
				setNodeStatus({ fill: "grey", shape: "ring", text: "No persistent states" });
			}

		} else {
			setNodeStatus({ fill: "yellow", shape: "dot", text: "Waiting for input states" });
		}


		// 14/08/2019 If some inputs are to be initialized, create a dummy items in the array
		initUndefinedInputs();


		this.on('input', function (msg) {

			// 28/08/2020 inform user about undefined topic or payload
			if (!msg.hasOwnProperty("topic") || typeof (msg.topic) == "undefined") {
				setNodeStatus({ fill: "red", shape: "dot", text: "Received invalid topic!" });
				return;
			}
			// 28/08/2020 inform user about undefined topic or payload
			if (!msg.hasOwnProperty("payload") || typeof (msg.payload) == "undefined") {
				setNodeStatus({ fill: "red", shape: "dot", text: "Received invalid payload!" });
				return;
			}
			var topic = msg.topic;
			var payload = msg.payload;
			var value = ToBoolean(payload);

			// 14/08/2019 if inputs are initialized, remove a "dummy" item from the state's array, as soon as new topic arrives
			if (node.sInitializeWith !== "WaitForPayload") {
				// Search if the current topic is in the state array
				if (typeof node.jSonStates[topic] === "undefined") {
					// Delete one dummy 
					for (let index = 0; index < node.config.inputCount; index++) {
						if (node.jSonStates.hasOwnProperty("dummy" + index)) {
							//RED.log.info(JSON.stringify(node.jSonStates))
							delete node.jSonStates["dummy" + index];
							//RED.log.info(JSON.stringify(node.jSonStates))
							break;
						}
					}
				}
			}

			// Add current attribute
			node.jSonStates[topic] = value;

			// Save the state array to a perisistent file
			if (node.config.persist == true) {
				try {
					fs.writeFileSync(path.join(node.persistPath, node.id.toString()), JSON.stringify(node.jSonStates));
				} catch (error) {
					setNodeStatus({ fill: "red", shape: "dot", text: "Node cannot write to filesystem: " + error });
				}
			}

			// Do we have as many inputs as we expect?
			var keyCount = Object.keys(node.jSonStates).length;

			if (keyCount == node.config.inputCount) {

				var resAND = CalculateResult("AND");
				var resOR = CalculateResult("OR");
				var resXOR = CalculateResult("XOR");

				if (node.config.filtertrue == "onlytrue") {
					if (!resAND) { resAND = null };
					if (!resOR) { resOR = null };
					if (!resXOR) { resXOR = null };
				}

				// Operation mode evaluation
				if (node.config.outputtriggeredby == "onlyonetopic") {
					if (typeof node.config.triggertopic !== "undefined"
						&& node.config.triggertopic !== ""
						&& msg.hasOwnProperty("topic") && msg.topic !== ""
						&& node.config.triggertopic === msg.topic) {
						SetResult(resAND, resOR, resXOR, node.config.topic, msg);
					} else {
						setNodeStatus({ fill: "grey", shape: "ring", text: "Saved (" + (msg.hasOwnProperty("topic") ? msg.topic : "empty input topic") + ") " + value });
					}
				} else {
					SetResult(resAND, resOR, resXOR, node.config.topic, msg);
				}
			}
			else if (keyCount > node.config.inputCount) {
				setNodeStatus({ fill: "gray", shape: "ring", text: "Reset due to unexpected new topic" });
				DeletePersistFile();
			} else {
				setNodeStatus({ fill: "green", shape: "ring", text: "Arrived topic " + keyCount + " of " + node.config.inputCount });
			}

		});

		this.on('close', function (removed, done) {
			if (removed) {
				// This node has been deleted
				// Delete persistent states on change/deploy
				DeletePersistFile();
			} else {
				// This node is being restarted
			}
			done();
		});

		function DeletePersistFile() {
			// Detele the persist file
			try {
				if (fs.existsSync(path.join(node.persistPath, node.id.toString()))) fs.unlinkSync(path.join(node.persistPath, node.id.toString()));
				setNodeStatus({ fill: "red", shape: "ring", text: "Persistent states deleted (" + node.id.toString() + ")." });
			} catch (error) {
				setNodeStatus({ fill: "red", shape: "ring", text: "Error deleting persistent file: " + error.toString() });
			}
			node.jSonStates = {}; // Resets inputs
			// 14/08/2019 If the inputs are to be initialized, create a dummy items in the array
			initUndefinedInputs();
		}

		function initUndefinedInputs() {
			if (node.sInitializeWith !== "WaitForPayload") {
				var nTotalDummyToCreate = Number(node.config.inputCount) - Object.keys(node.jSonStates).length;
				if (nTotalDummyToCreate > 0) {
					RED.log.info("BooleanLogicUltimate: Will create " + nTotalDummyToCreate + " dummy (" + node.sInitializeWith + ") values")
					for (let index = 0; index < nTotalDummyToCreate; index++) {
						node.jSonStates["dummy" + index] = node.sInitializeWith === "false" ? false : true;
					}
					setTimeout(() => { setNodeStatus({ fill: "green", shape: "ring", text: "Initialized " + nTotalDummyToCreate + " undefined inputs with " + node.sInitializeWith }); }, 4000)
				}
			}
		}

		function setNodeStatus({ fill, shape, text }) {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		function CalculateResult(_operation) {
			var res;

			if (_operation == "XOR") {
				res = PerformXOR();
			}
			else {
				// We need a starting value to perform AND and OR operations.				
				var keys = Object.keys(node.jSonStates);
				res = node.jSonStates[keys[0]];

				for (var i = 1; i < keys.length; ++i) {
					var key = keys[i];
					res = PerformSimpleOperation(_operation, res, node.jSonStates[key]);
				}
			}

			return res;
		}

		function PerformXOR() {
			// XOR = exclusively one input is true. As such, we just count the number of true values and compare to 1.
			var trueCount = 0;

			for (var key in node.jSonStates) {
				if (node.jSonStates[key]) {
					trueCount++;
				}
			}

			return trueCount == 1;
		}

		function PerformSimpleOperation(operation, val1, val2) {
			var res;

			if (operation === "AND") {
				res = val1 && val2;
			}
			else if (operation === "OR") {
				res = val1 || val2;
			}
			else {
				node.error("Unknown operation: " + operation);
			}

			return res;
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

		function SetResult(_valueAND, _valueOR, _valueXOR, optionalTopic, _msg) {
			setNodeStatus({ fill: "green", shape: "dot", text: "(AND)" + (_valueAND !== null ? _valueAND : "---") + " (OR)" + (_valueOR !== null ? _valueOR : "---") + " (XOR)" + (_valueXOR !== null ? _valueXOR : "---") });

			var msgAND = null;
			if (_valueAND != null) {
				msgAND = RED.util.cloneMessage(_msg);
				msgAND.topic = optionalTopic === undefined ? "result" : optionalTopic;
				msgAND.operation = "AND";
				msgAND.payload = _valueAND;

			}
			var msgOR = null;
			if (_valueOR != null) {
				msgOR = RED.util.cloneMessage(_msg);
				msgOR.topic = optionalTopic === undefined ? "result" : optionalTopic;
				msgOR.operation = "OR";
				msgOR.payload = _valueOR;
			}
			var msgXOR = null;
			if (_valueXOR != null) {
				msgXOR = RED.util.cloneMessage(_msg);
				msgXOR.topic = optionalTopic === undefined ? "result" : optionalTopic;
				msgXOR.operation = "XOR";
				msgXOR.payload = _valueXOR;
			}
			node.send([msgAND, msgOR, msgXOR]);

		};
	}

	RED.nodes.registerType("BooleanLogicUltimate", BooleanLogicUltimate);
}