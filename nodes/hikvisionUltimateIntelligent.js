
module.exports = function (RED) {
	function hikvisionUltimateIntelligent(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.topic = config.topic || config.name;
		node.server = RED.nodes.getNode(config.server)
		const isDebug = node.server && node.server.debug;
		const logDebug = (text) => {
			if (isDebug) RED.log.info(`hikvisionUltimateIntelligent: ${text}`);
		};
		node.channelID = config.channelID || "0";
		node.filterzone = config.filterzone || "0";

		node.intelligentevent = config.intelligentevent || "all";

		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}
		
		// Called from config node, to send output to the flow
		node.sendPayload = (_msg, extension = '') => {
			if (_msg === null || _msg === undefined) return;
			
			if (_msg.hasOwnProperty("errorDescription")) {
				logDebug(`Connection status message: ${_msg.errorDescription || ""}`);
				_msg.topic = node.topic;
				node.send([null, _msg, null]);
				return;
			}; // It's a connection error/restore comunication.
			
			if (!_msg.hasOwnProperty("payload") || (_msg.hasOwnProperty("payload") && _msg.payload === undefined)) {
				logDebug("Discarded incoming message without payload");
				return;
			}

			if (_msg.type === 'img') {
				_msg.topic = node.topic;
				_msg.extension = extension;
				logDebug("Forwarding image payload");
				node.send([null, null, _msg]);
				return;
			}
			
            var oRetMsg = {}; // Return message
            
            // Check for smart events in JSON or XML-parsed format
			if (_msg.type === 'event' && typeof _msg.payload === 'object') {
                const payload = _msg.payload;
                
                // Based on research, smart events might come in a 'SmartEvent' wrapper (JSON) or 'EventNotificationAlert' (XML)
                const event = payload.SmartEvent || payload.EventNotificationAlert || payload;

				if (event.hasOwnProperty("eventType") && event.hasOwnProperty("eventState")) {
					
					// Filter channel
					let sChannelID = event.channelID || event.dynChannelID || "0";

					// Filter regionID (Zone)
					let iRegionID = 0;
					if (event.hasOwnProperty("DetectionRegionList") && event.DetectionRegionList.hasOwnProperty("DetectionRegionEntry") && event.DetectionRegionList.DetectionRegionEntry.hasOwnProperty("regionID")) {
						iRegionID = Number(event.DetectionRegionList.DetectionRegionEntry.regionID);
					}

					if (Number(node.channelID) === 0 || Number(node.channelID) === Number(sChannelID)) {
						if (Number(node.filterzone) === 0 || Number(node.filterzone) === iRegionID) {

							let sHumanReadableObjectType = "";
							if (event.hasOwnProperty("customData") && event.customData.hasOwnProperty("objectType")) {
								sHumanReadableObjectType = event.customData.objectType.toString().toLowerCase(); // should be "person" or "vehicle"
							} else if (event.hasOwnProperty("targetType")) {
								sHumanReadableObjectType = event.targetType.toString().toLowerCase(); // should be "human" or "vehicle"
							}

							let bEventOK = false;
							if (node.intelligentevent === "all") {
								bEventOK = true;
							} else if (node.intelligentevent === "human" && (sHumanReadableObjectType.includes("person") || sHumanReadableObjectType.includes("human"))) {
								bEventOK = true;
							} else if (node.intelligentevent === "vehicle" && sHumanReadableObjectType.includes("vehicle")) {
								bEventOK = true;
							}

							if (bEventOK) {
								const bAlarmStatus = (event.eventState.toString().toLowerCase() === "active" ? true : false);

								oRetMsg.payload = bAlarmStatus;
								oRetMsg.topic = node.topic;
								oRetMsg.channelid = sChannelID; 
								oRetMsg.zone = iRegionID; 
								oRetMsg.description = event.eventDescription || event.eventType;
								oRetMsg.event = event; // Keep the original event object
								
								const fill = bAlarmStatus ? "red" : "green";
								const shape = bAlarmStatus ? "dot" : "ring";
								node.setNodeStatus({ fill: fill, shape: shape, text: oRetMsg.description + " Ch: " + sChannelID + " Zone: " + iRegionID });
								
								logDebug(`Forwarding Smart Event: ${oRetMsg.description} on Channel ${sChannelID}, Zone ${iRegionID}`);
								node.send([oRetMsg, null, null]);
							}
						}
					}
				}
			}
		}

		// On each deploy, unsubscribe+resubscribe
		if (node.server) {
			node.server.removeClient(node);
			node.server.addClient(node);
		}

		node.on("close", function (done) {
			if (node.server) {
				node.server.removeClient(node);
			}
			done();
		});

	}

	RED.nodes.registerType("hikvisionUltimateIntelligent", hikvisionUltimateIntelligent);
}
