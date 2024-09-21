

module.exports = function (RED) {
	function hikvisionUltimateAlarm(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.topic = config.topic || config.name;
		node.server = RED.nodes.getNode(config.server)
		node.reactto = (config.reactto === null || config.reactto === undefined) ? "vmd" : config.reactto.toLowerCase();// Rect to alarm coming from...
		node.filterzone = config.filterzone || "0";// Rect to alarm coming from zone...
		node.channelID = config.channelID || "0";// Rect to alarm coming from channelID...
		node.currentAlarmMSG = {}; // Stores the current alarm object
		node.total_alarmfilterduration = 0; // stores the total time an alarm has been true in the alarmfilterperiod time.
		node.isNodeInAlarm = false; // Stores the current state of the filtered alarm.
		node.isRunningTimerFilterPeriod = false; // Indicates wether the period timer is running;
		node.alarmfilterduration = config.alarmfilterduration !== undefined ? Number(config.alarmfilterduration) : 0;
		node.alarmfilterperiod = config.alarmfilterperiod !== undefined ? Number(config.alarmfilterperiod) : 0;
		node.devicetype = config.devicetype !== undefined ? config.devicetype : 0;
		if (node.devicetype == 0) node.alarmfilterduration = 0; // Normal events, set it to zero

		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		// 29/01/2021 start the timer that counts the time the alarm has been true
		// ###################################
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
								//node.setNodeStatus({ fill: "yellow", shape: "ring", text: "STOP TimerFilterPeriod" });
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
		// 29/01/2021 This timer resets the node.total_alarmfilterduration
		startTimerAlarmFilterPeriod = () => {
			//node.setNodeStatus({ fill: "yellow", shape: "ring", text: "START TimerFilterPeriod" });
			node.isRunningTimerFilterPeriod = true;
			node.total_alarmfilterduration = 0;
			node.timer_alarmfilterperiod = setTimeout(() => {
				node.total_alarmfilterduration = 0;
				//node.setNodeStatus({ fill: "yellow", shape: "ring", text: "ELAPSED TimerFilterPeriod" });
				node.isRunningTimerFilterPeriod = false;
			}, node.alarmfilterperiod * 1000);
		}
		if (node.alarmfilterduration !== 0) startTimerAlarmFilterDuration(); // If filter is enabled, start timer
		// ###################################



		// Called from config node, to send output to the flow
		node.sendPayload = (_msg, extension = '') => {
			if (_msg === null || _msg === undefined) return;
			_msg.topic = node.topic;
			if (_msg.hasOwnProperty("errorDescription")) { node.send([null, _msg, null]); return; }; // It's a connection error/restore comunication.
			if (!_msg.hasOwnProperty("payload") || (_msg.hasOwnProperty("payload") && _msg.payload === undefined)) return;

			if (_msg.type === 'img') {
				_msg.extension = extension;
				node.send([null, null, _msg]);
				return;
			}
			var oRetMsg = {}; // Return message

			// Check what alarm type must i search for.
			// Security devices issue a CID alarm
			//#region "CID"
			// #################################
			if ((node.devicetype == 1 || node.devicetype == 2)
				&& _msg.payload.hasOwnProperty("CIDEvent")
				&& _msg.payload.CIDEvent.type.toString().toLowerCase() === "zonealarm"
				&& _msg.payload.CIDEvent.hasOwnProperty("zone")) {
				oRetMsg.topic = _msg.topic;
				oRetMsg.alarm = _msg.payload; // Put the full alarm description here.
				oRetMsg.zone = _msg.payload.CIDEvent.zone + 1; // The zone on device's ISAPI is base 0, while the zone on UI is base 1.

				// CID Alarm (node.reactto is CID:startAlarmCode-endAlarmCode)
				let sAlarmCodeStart = node.reactto.split(":")[1].split("-")[0];
				let sAlarmCodeEnd = node.reactto.split(":")[1].split("-")[1];

				if (Number(node.filterzone) === 0 || Number(node.filterzone) === Number(oRetMsg.zone)) { // Filter only selcted zones
					// Get the Hikvision alarm codes, that differs from standard SIA codes.
					switch (_msg.payload.CIDEvent.code.toString().toLowerCase()) {
						// Standard SIA Code is _msg.payload.CIDEvent.standardCIDcode
						case sAlarmCodeStart:
							// Starts alarm
							oRetMsg.payload = true;
							node.setNodeStatus({ fill: "red", shape: "ring", text: "Zone " + oRetMsg.zone + "  pre alert" });
							break;
						case sAlarmCodeEnd:
							// End alarm.
							oRetMsg.payload = false;
							node.setNodeStatus({ fill: "green", shape: "dot", text: "Zone " + oRetMsg.zone + " normal" });
							break;
						default:
							// Unknown CID code.
							node.setNodeStatus({ fill: "grey", shape: "ring", text: "Zone " + oRetMsg.zone + " unknowk CID code " + _msg.payload.CIDEvent.code });
							return; // Unknown state
					}
				}
			}
			// #################################
			//#endregion


			// Camera/NVR, no CID codes, just standard hikvision strings
			//#region "STANDARD"
			// #################################

			// STANDARD MOTION EVENT VERSION 2.0
			// {
			// 	"topic": "",
			// 	"payload": {
			// 	  "$": {
			// 		"version": "2.0",
			// 		"xmlns": "http://www.isapi.org/ver20/XMLSchema"
			// 	  },
			// 	  "ipAddress": "192.168.1.32",
			// 	  "portNo": "80",
			// 	  "protocolType": "HTTP",
			// 	  "macAddress": "xxx",
			// 	  "dynChannelID": "13",
			// 	  "channelID": "13",
			// 	  "dateTime": "2021-01-29T09:58:05+01:00",
			// 	  "activePostCount": "38",
			// 	  "eventType": "VMD",
			// 	  "eventState": "active",
			// 	  "eventDescription": "Motion alarm",
			// 	  "channelName": "Viessmann"
			// 	},
			// 	"_msgid": "913ac479.52e768"
			//   }

			// STANDARD MOTION EVENT VERSION 1.0
			// {
			// 	"payload":{
			// 	   "$":{
			// 		  "version":"1.0",
			// 		  "xmlns":"http://www.hikvision.com/ver20/XMLSchema"
			// 	   },
			// 	   "ipAddress":"192.168.60.25",
			// 	   "portNo":"80",
			// 	   "protocol":"HTTP",
			// 	   "macAddress":"44:47:cc:cf:82:17",
			// 	   "dynChannelID":"4",
			// 	   "dateTime":"2021-07-01T09:11:21+02:00",
			// 	   "activePostCount":"1",
			// 	   "eventType":"VMD",
			// 	   "eventState":"active",
			// 	   "eventDescription":"Motion alarm"
			// 	}
			//  }

			// SMART EVENT VERSION 2.0
			// {
			// 	"topic": "",
			// 	"payload": {
			// 	  "$": {
			// 		"version": "2.0",
			// 		"xmlns": "http://www.isapi.org/ver20/XMLSchema"
			// 	  },
			// 	  "ipAddress": "192.168.1.32",
			// 	  "portNo": "80",
			// 	  "protocolType": "HTTP",
			// 	  "macAddress": "xxx",
			// 	  "dynChannelID": "13",
			// 	  "channelID": "13",
			// 	  "dateTime": "2021-01-29T10:26:44+01:00",
			// 	  "activePostCount": "1",
			// 	  "eventType": "fielddetection",
			// 	  "eventState": "active",
			// 	  "eventDescription": "fielddetection alarm",
			// 	  "channelName": "Viessmann",
			// 	  "DetectionRegionList": {
			// 		"DetectionRegionEntry": {
			// 		  "regionID": "0",
			// 		  "RegionCoordinatesList": "\n",
			// 		  "TargetRect": {
			// 			"X": "0.000000",
			// 			"Y": "0.000000",
			// 			"width": "0.000000",
			// 			"height": "0.000000"
			// 		  }
			// 		}
			// 	  }
			// 	},
			// 	"_msgid": "853ba286.3a708"
			//   }


			// DURATION EVENT VERSION 2.0 (this is a uration event of some alarm not trapped) https://github.com/Supergiovane/node-red-contrib-hikvision-ultimate/issues/16
			// {
			// 	"$": {
			// 	  "version": "2.0",
			// 	  "xmlns": "http://www.hikvision.com/ver20/XMLSchema"
			// 	},
			// 	"ipAddress": "10.0.0.2",
			// 	"ipv6Address": "::ffff:10.0.0.2",
			// 	"portNo": "80",
			// 	"protocol": "HTTP",
			// 	"macAddress": "08:a1:89:6a:3d:59",
			// 	"channelID": "1",
			// 	"dateTime": "2021-04-24T16:59:47+08:00",
			// 	"activePostCount": "1",
			// 	"eventType": "duration",
			// 	"eventState": "active",
			// 	"eventDescription": "duration alarm",
			// 	"channelName": "Hik",
			// 	"DurationList": {
			// 	  "Duration": {
			// 		"relationEvent": "fielddetection"
			// 	  }
			// 	},
			// 	"isDataRetransmission": "false"
			//   }

			if (node.devicetype == 0) {
				var sEventType = "";
				var bAlarmStatus = false;
				let sEventDesc = "";
				sEventDesc = (_msg.payload.hasOwnProperty("eventDescription") ? _msg.payload.eventDescription : "");

				if (_msg.payload.hasOwnProperty("eventType")) {
					// Check if it's only a hearbeat alarm
					sEventType = _msg.payload.eventType.toString().toLowerCase();
					if (sEventType === "videoloss" && _msg.payload.hasOwnProperty("activePostCount") && _msg.payload.activePostCount == "0") {
						node.setNodeStatus({ fill: "green", shape: "ring", text: "Received HeartBeat (the device is online)" });
						return; // It's a Heartbeat
					}
					if (sEventType === "duration" && !node.isNodeInAlarm) {

						// This is a duration event of an alarm, so i must get the real alarm event from the relationEvent prop
						if (_msg.payload.hasOwnProperty("DurationList") && _msg.payload.DurationList.hasOwnProperty("Duration") && _msg.payload.DurationList.Duration.hasOwnProperty("relationEvent")) {
							sEventType = _msg.payload.DurationList.Duration.relationEvent.toString().toLowerCase();
							sEventDesc = sEventDesc + " of " + sEventType + ". Zone number will be ignored.";
						}
					}
				}

				// Filter channel
				let sChannelID = "0";
				if (_msg.payload.hasOwnProperty("channelID")) {
					// API Version 2.0
					sChannelID = _msg.payload.channelID;
				} else if (_msg.payload.hasOwnProperty("dynChannelID")) {
					// API Version 1.0
					sChannelID = _msg.payload.dynChannelID;
				}


				// Filter regionID (Zone)
				let iRegionID = 0;
				if (_msg.payload.hasOwnProperty("DetectionRegionList") && _msg.payload.DetectionRegionList.hasOwnProperty("DetectionRegionEntry") && _msg.payload.DetectionRegionList.DetectionRegionEntry.hasOwnProperty("regionID")) iRegionID = Number(_msg.payload.DetectionRegionList.DetectionRegionEntry.regionID);// Era + 1;

				if (Number(node.channelID) === 0 || Number(node.channelID) === Number(sChannelID)) {  // Filter only selcted channel

					if (Number(node.filterzone) === 0 || Number(node.filterzone) === iRegionID || iRegionID === 0) {  // Filter only selcted regionID (zone). iRegionID is 0 when the eventtype is "duration"

						if (_msg.payload.hasOwnProperty("eventState")) {
							bAlarmStatus = (_msg.payload.eventState.toString().toLowerCase() === "active" ? true : false);
						} else {
							// Mmmm.... no event state?
							node.setNodeStatus({ fill: "red", shape: "ring", text: "Received alarm but no state!" });
							return;
						}

						// check alarm filter
						var aReactTo = node.reactto.split(","); // node.reactto can contain multiple names for the same event, depending on firmware
						for (let index = 0; index < aReactTo.length; index++) {
							const element = aReactTo[index];
							if (element !== null && element !== undefined && element.trim() !== "" && sEventType === element) {
								oRetMsg.payload = bAlarmStatus;
								oRetMsg.topic = _msg.topic;
								oRetMsg.channelid = sChannelID; // Channel ID (in case of NVR)
								oRetMsg.zone = iRegionID; // Zone
								oRetMsg.description = sEventDesc;
								node.isNodeInAlarm = bAlarmStatus;
								break; // Find first occurrence, exit.
							}
						}
					}
				}
			}
			// #################################
			//#endregion

			// 29/01/2020 check wether the filter is enabled or not
			if (oRetMsg.hasOwnProperty("payload")) {
				if (node.alarmfilterduration == 0) {
					node.send([oRetMsg, null, null]);
				} else {
					// Sends the false only in case the isNodeInAlarm is true.
					node.currentAlarmMSG = oRetMsg;
					if (oRetMsg.payload === false && node.isNodeInAlarm) {
						node.send([oRetMsg, null, null]);
						node.currentAlarmMSG = {};
						node.isNodeInAlarm = false;
					} else if (oRetMsg.payload === true && !node.isNodeInAlarm) {
						if (!node.isRunningTimerFilterPeriod) {
							startTimerAlarmFilterPeriod();
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

		this.on('input', function (msg) {
			// TEST VERSION 2.0
			msg.payload = `{
				"$": {
				  "version": "2.0",
				  "xmlns": "http://www.hikvision.com/ver20/XMLSchema"
				},
				"ipAddress": "10.0.0.2",
				"ipv6Address": "::ffff:10.0.0.2",
				"portNo": "80",
				"protocol": "HTTP",
				"macAddress": "08:a1:89:6a:3d:59",
				"channelID": "1",
				"dateTime": "2021-04-24T16:59:47+08:00",
				"activePostCount": "1",
				"eventType": "duration",
				"eventState": "active",
				"eventDescription": "duration alarm",
				"channelName": "Hik",
				"DurationList": {
				  "Duration": {
					"relationEvent": "fielddetection"
				  }
				},
				"isDataRetransmission": "false"
			  }`;
			// TEST VERSION 1.0
			msg.payload = `{
				   "$":{
					  "version":"1.0",
					  "xmlns":"http://www.hikvision.com/ver20/XMLSchema"
				   },
				   "ipAddress":"192.168.60.25",
				   "portNo":"80",
				   "protocol":"HTTP",
				   "macAddress":"44:47:cc:cf:82:17",
				   "dynChannelID":"4",
				   "dateTime":"2021-07-01T09:11:21+02:00",
				   "activePostCount":"1",
				   "eventType":"VMD",
				   "eventState":"active",
				   "eventDescription":"Motion alarm"
				}`;

			try {
				msg.payload = JSON.parse(msg.payload);
				node.sendPayload(msg);

				setTimeout(() => {
					msg.payload = `{"$":{"version":"2.0","xmlns":"http://www.hikvision.com/ver20/XMLSchema"},"ipAddress":"10.0.0.2","ipv6Address":"::ffff:10.0.0.2","portNo":"80","protocol":"HTTP","macAddress":"08:a1:89:6a:3d:59","channelID":"1","dateTime":"2021-04-24T16:59:56+08:00","activePostCount":"1","eventType":"fielddetection","eventState":"inactive","eventDescription":"fielddetection alarm","channelName":"Hik"}`;
					try {
						msg.payload = JSON.parse(msg.payload);
						node.sendPayload(msg);
					} catch (error) {
					}

				}, 5000);
			} catch (error) {

			}


		});

		node.on("close", function (done) {
			if (node.server) {
				node.server.removeClient(node);
			}
			if (node.timer_alarmfilterduration !== null) clearInterval(node.timer_alarmfilterduration);
			if (node.timer_alarmfilterperiod !== null) clearTimeout(node.timer_alarmfilterperiod);
			if (node.server) {
				node.server.removeClient(node);
			}
			done();
		});

	}

	RED.nodes.registerType("hikvisionUltimateAlarm", hikvisionUltimateAlarm);
}