

module.exports = function (RED) {
	function hikvisionUltimateRadar(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.topic = config.topic || config.name;
		node.server = RED.nodes.getNode(config.server)
		node.filterzone = config.filterzone || "0";// Rect to alarm coming from...
		node.alarmfilterduration = config.alarmfilterduration !== undefined ? config.alarmfilterduration : 0;
		node.alarmfilterperiod = config.alarmfilterperiod !== undefined ? config.alarmfilterperiod : 0;
		node.currentAlarmMSG = {}; // Stores the current alarm object
		node.total_alarmfilterduration = 0; // stores the total time an alarm has been true in the alarmfilterperiod time.
		node.isNodeInAlarm = false; // Stores the current state of the filtered alarm.
		node.isRunningTimerFilterPeriod = false; // Indicates wether the period timer is running;

		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		// 15/01/2021 start the timer that counts the time the alarm has been true
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
								node.send([node.currentAlarmMSG, null]);
							} else { node.total_alarmfilterduration = 0; }
						}
					}
				}
			}, 1000);
		}
		// This timer resets the node.total_alarmfilterduration
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
		node.sendPayload = (_msg) => {
			if (_msg === null || _msg === undefined) return;
			_msg.topic = node.topic;
			if (_msg.hasOwnProperty("errorDescription")) { node.send([null, _msg]); return; }; // It's a connection error/restore comunication.
			// Radar alarm JSON
			/* 	{
					"ipAddress": "192.168.1.25",
					"ipv6Address": "",
					"portNo": 80,
					"protocol": "HTTP",
					"macAddress": "banana",
					"channelID": 1,
					"dateTime": "2012-01-13T03:15:14+01:00",
					"activePostCount": 1,
					"eventType": "cidEvent",
					"eventState": "active",
					"eventDescription": "CID event",
					"CIDEvent": {
						"code": 1103,
						"standardCIDcode": 1130,
						"type": "zoneAlarm",
						"trigger": "2012-01-13T03:15:14+01:00",
						"upload": "2012-01-13T03:15:14+01:00",
						"CameraList": [],
						"NVRList": [
							{
								"id": 1,
								"ip": "192.168.1.32",
								"port": 8000,
								"channel": 1
							}
						],
						"zone": 1
					}
				} */
			//var oRetMsg = RED.util.cloneMessage(_msg);

			if (_msg.hasOwnProperty("payload")
				&& _msg.payload.hasOwnProperty("CIDEvent")
				&& _msg.payload.CIDEvent.type.toString().toLowerCase() === "zonealarm"
				&& _msg.payload.CIDEvent.hasOwnProperty("zone")) {
				let oRetMsg = {}; // Return message
				oRetMsg.topic = _msg.topic;
				oRetMsg.connected = _msg.connected;
				oRetMsg.alarm = _msg.payload; // Put the full alarm description here.
				oRetMsg.zone = _msg.payload.CIDEvent.zone + 1; // The zone on device's ISAPI is base 0, while the zone on UI is base 1.
				if (Number(node.filterzone) === 0 || Number(node.filterzone) === Number(oRetMsg.zone)) { // Filter only selcted zones
					// Get the Hikvision alarm codes, that differs from standard SIA codes.
					switch (_msg.payload.CIDEvent.code.toString().toLowerCase()) {
						// Standard SIA Code is _msg.payload.CIDEvent.standardCIDcode
						case "1103":
							// Bulgary alarm
							oRetMsg.payload = true;
							node.setNodeStatus({ fill: "red", shape: "ring", text: "Zone " + oRetMsg.zone + "  pre alert" });
							break;
						case "3103":
							// End Bulgary alarm.
							oRetMsg.payload = false;
							node.setNodeStatus({ fill: "green", shape: "dot", text: "Zone " + oRetMsg.zone + " normal" });
							break;
						case "1148":
							// Motion Alarm start (The radar has been moved). 
							node.setNodeStatus({ fill: "red", shape: "dot", text: "Device motion alarm" });
							break;
						case "3148":
							// Motion Alarm end. 
							node.setNodeStatus({ fill: "green", shape: "dot", text: "Device motion restored" });
							break;
						case "3148":
							// Radar armed. 
							node.setNodeStatus({ fill: "green", shape: "dot", text: "Radar armed" });
							break;
						case "1401":
							// Radar armed. 
							node.setNodeStatus({ fill: "red", shape: "dot", text: "Radar disarmed" });
							break;
						default:
							// Unknown CID code.
							node.setNodeStatus({ fill: "grey", shape: "ring", text: "Zone " + oRetMsg.zone + " unknowk CID code " + _msg.payload.CIDEvent.code });
							return; // Unknown state
					}

					// 16/01/2020 check wether the filter is enabled or not
					if (node.alarmfilterduration === 0) {
						node.send([oRetMsg, null]);
					} else {
						// Sends the false only in case the isNodeInAlarm is true.
						node.currentAlarmMSG = oRetMsg;
						if (oRetMsg.payload === false && node.isNodeInAlarm) {
							node.send([oRetMsg, null]);
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
		}

		// On each deploy, unsubscribe+resubscribe
		if (node.server) {
			node.server.removeClient(node);
			node.server.addClient(node);
		}

		this.on('input', function (msg) {
			node.sendPayload(msg);
		});

		node.on("close", function (done) {
			if (node.timer_alarmfilterduration !== null) clearInterval(node.timer_alarmfilterduration);
			if (node.timer_alarmfilterperiod !== null) clearTimeout(node.timer_alarmfilterperiod);
			if (node.server) {
				node.server.removeClient(node);
			}
			done();
		});

	}

	RED.nodes.registerType("hikvisionUltimateRadar", hikvisionUltimateRadar);
}