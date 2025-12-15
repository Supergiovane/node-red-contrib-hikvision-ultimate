
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

		// Current state of the node
		node.currentAlarmMSG = {}; // Stores the current alarm object
		node.total_alarmfilterduration = 0; // stores the total time an alarm has been true in the alarmfilterperiod time.
		node.isNodeInAlarm = false; // Stores the current state of the filtered alarm.
		node.isRunningTimerFilterPeriod = false; // Indicates wether the period timer is running;
		
		// Get the node config
		node.channelID = config.channelID || "0";
		node.intelligentevent = config.intelligentevent || "all";
		node.alarmfilterduration = config.alarmfilterduration !== undefined ? Number(config.alarmfilterduration) : 0;
		node.alarmfilterperiod = config.alarmfilterperiod !== undefined ? Number(config.alarmfilterperiod) : 0;

		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		// Starts the timer that counts the time the alarm has been true
		startTimerAlarmFilterDuration = () => {
			node.timer_alarmfilterduration = setInterval(() => {
				if (node.currentAlarmMSG.hasOwnProperty("payload")) {
					if (node.currentAlarmMSG.payload === true) {
						node.total_alarmfilterduration += 1;
						if (node.isRunningTimerFilterPeriod) node.setNodeStatus({ fill: "red", shape: "ring", text: "Zone " + node.currentAlarmMSG.zone + " pre alert count " + node.total_alarmfilterduration });
						if (node.total_alarmfilterduration >= node.alarmfilterduration) {
							if (!node.isNodeInAlarm) {
								// Emit alarm
								if (node.timer_alarmfilterperiod !== null) clearTimeout(node.timer_alarmfilterperiod);
								node.isRunningTimerFilterPeriod = false;
								node.isNodeInAlarm = true;
								node.total_alarmfilterduration = 0;
								node.setNodeStatus({ fill: "red", shape: "dot", text: "Zone " + node.currentAlarmMSG.zone + " alarm" });
								node.send([node.currentAlarmMSG, null, null]);
							} else { node.total_alarmfilterduration = 0; }
						}
					}
				}
			}, 1000);
		}

		// This timer resets the node.total_alarmfilterduration
		startTimerAlarmFilterPeriod = () => {
			node.isRunningTimerFilterPeriod = true;
			node.total_alarmfilterduration = 0;
			node.timer_alarmfilterperiod = setTimeout(() => {
				node.total_alarmfilterduration = 0;
				node.isRunningTimerFilterPeriod = false;
			}, node.alarmfilterperiod * 1000);
		}

		// If filter is enabled, start timer
		if (node.alarmfilterduration !== 0) startTimerAlarmFilterDuration();
		
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
			var sEventType = "";
			var bAlarmStatus = false;
            
            // Check for smart events in JSON or XML-parsed format
			if (_msg.type === 'event' && typeof _msg.payload === 'object') {
				const payload = _msg.payload;
                
                // Based on research, smart events might come in a 'SmartEvent' wrapper (JSON) or 'EventNotificationAlert' (XML)
                const event = payload.SmartEvent || payload.EventNotificationAlert || payload;

				if (event.hasOwnProperty("eventType") && event.hasOwnProperty("eventState")) {
					sEventType = event.eventType.toString().toLowerCase();

					// Ignore basic events like plain motion/videoloss: they are handled by the standard Alarm node
					const basicEventTypes = ["vmd", "videoloss"];
					if (basicEventTypes.includes(sEventType)) {
						logDebug(`Ignoring basic event type ${sEventType} on Intelligent node`);
						return;
					}

					// Filter channel
					let sChannelID = event.channelID || event.dynChannelID || "0";

					// Filter regionID (Zone)
					let iRegionID = 0;
					if (event.hasOwnProperty("DetectionRegionList") && event.DetectionRegionList.hasOwnProperty("DetectionRegionEntry") && event.DetectionRegionList.DetectionRegionEntry.hasOwnProperty("regionID")) {
						iRegionID = Number(event.DetectionRegionList.DetectionRegionEntry.regionID);
					}

					if (Number(node.channelID) === 0 || Number(node.channelID) === Number(sChannelID)) {

						// Filter by object type (human/vehicle)
						let sHumanReadableObjectType = "";
						if (event.hasOwnProperty("customData") && event.customData.hasOwnProperty("objectType")) {
							sHumanReadableObjectType = event.customData.objectType.toString().toLowerCase(); // should be "person" or "vehicle"
						} else if (event.hasOwnProperty("targetType")) {
							sHumanReadableObjectType = event.targetType.toString().toLowerCase(); // should be "human" or "vehicle"
						}

						let bObjectMatch = false;
						const hasClassification = sHumanReadableObjectType && sHumanReadableObjectType.length > 0;

						if (hasClassification) {
							if (node.intelligentevent === "all") {
								bObjectMatch = true;
							} else if (node.intelligentevent === "human" && (sHumanReadableObjectType.includes("person") || sHumanReadableObjectType.includes("human"))) {
								bObjectMatch = true;
							} else if (node.intelligentevent === "vehicle" && sHumanReadableObjectType.includes("vehicle")) {
								bObjectMatch = true;
							} else if (node.intelligentevent === "animal" && sHumanReadableObjectType.includes("zoology")) {
								bObjectMatch = true;
							}
						} else {
							// No object classification available; accept only if user selected "all"
							// (and basic events like VMD/videoloss have already been filtered out above)
							if (node.intelligentevent === "all") {
								bObjectMatch = true;
							}
						}

						if (bObjectMatch) {
							bAlarmStatus = (event.eventState.toString().toLowerCase() === "active" ? true : false);

							oRetMsg.payload = bAlarmStatus;
							oRetMsg.topic = node.topic;
							oRetMsg.channelid = sChannelID; 
							oRetMsg.zone = iRegionID; 
							oRetMsg.description = event.eventDescription || event.eventType;

							// Attach full parsed event for downstream processing
							oRetMsg.event = event;

							// Try to extract image-related info (if provided by the camera)
							try {
								let imageName = null;
								let imageUrl = null;

								// Common direct fields
								if (event.picName !== undefined && event.picName !== null) {
									imageName = event.picName.toString();
								}
								if (event.picUrl !== undefined && event.picUrl !== null) {
									imageUrl = event.picUrl.toString();
								}
								// Variants with different casing
								if (!imageUrl && event.PicUrl) imageUrl = event.PicUrl.toString();
								if (!imageUrl && event.picURL) imageUrl = event.picURL.toString();
								if (!imageUrl && event.PictureURL) imageUrl = event.PictureURL.toString();

								// Sometimes nested inside customData
								if (event.customData) {
									if (!imageName && event.customData.picName) {
										imageName = event.customData.picName.toString();
									}
									if (!imageUrl && event.customData.picUrl) {
										imageUrl = event.customData.picUrl.toString();
									}
								}

								if (imageName) {
									oRetMsg.imageName = imageName;
								}
								if (imageUrl) {
									oRetMsg.imageUrl = imageUrl;
								}
							} catch (err) {
								// Ignore errors while extracting optional image info
							}

							node.isNodeInAlarm = bAlarmStatus;
							
							logDebug(`Event ${sEventType} state ${bAlarmStatus ? "active" : "inactive"} channel ${sChannelID} zone ${iRegionID} object ${sHumanReadableObjectType}`);
						}
					}
				}
			}

			// Check whether the filter is enabled or not
			if (oRetMsg.hasOwnProperty("payload")) {
				if (node.alarmfilterduration == 0) {
					// No filter, send message immediately
					const fill = oRetMsg.payload ? "red" : "green";
					const shape = oRetMsg.payload ? "dot" : "ring";
					node.setNodeStatus({ fill: fill, shape: shape, text: oRetMsg.description + " Ch: " + oRetMsg.channelid + " Zone: " + oRetMsg.zone });
					node.send([oRetMsg, null, null]);
					logDebug(`Forwarded alarm immediately (${oRetMsg.description || "no description"})`);
				} else {
					// Filter is enabled, handle debounce logic
					node.currentAlarmMSG = oRetMsg;
					if (oRetMsg.payload === false && node.isNodeInAlarm) {
						node.send([oRetMsg, null, null]);
						node.currentAlarmMSG = {};
						node.isNodeInAlarm = false;
						logDebug("Alarm reset forwarded after filter duration");
						node.setNodeStatus({ fill: "green", shape: "ring", text: `Reset ${oRetMsg.description}` });
					} else if (oRetMsg.payload === true && !node.isNodeInAlarm) {
						if (!node.isRunningTimerFilterPeriod) {
							startTimerAlarmFilterPeriod();
							logDebug("Alarm filter timer started");
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
			if (node.timer_alarmfilterduration !== null) clearInterval(node.timer_alarmfilterduration);
			if (node.timer_alarmfilterperiod !== null) clearTimeout(node.timer_alarmfilterperiod);
			if (node.server) {
				node.server.removeClient(node);
			}
			done();
		});

	}

	RED.nodes.registerType("hikvisionUltimateIntelligent", hikvisionUltimateIntelligent);
}
