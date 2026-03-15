module.exports = function (RED) {
	function hikvisionUltimatePTZ(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		const POSITION_POLL_INTERVAL_MS = 1000;
		const POSITION_WAIT_TIMEOUT_MS = 30000;
		const POSITION_NO_MOVEMENT_GRACE_MS = 2500;
		const POSITION_STABLE_POLLS_REQUIRED = 2;
		const POSITION_TOLERANCE = {
			azimuth: 0.2,
			elevation: 0.2,
			absoluteZoom: 5
		};
		node.topic = config.topic || node.name;
		node.server = RED.nodes.getNode(config.server)
		const isDebug = node.server && node.server.debug;
		const logDebug = (text) => {
			if (isDebug) RED.log.info(`hikvisionUltimatePTZ: ${text}`);
		};
		node.PTZPreset = (config.PTZPreset === null || config.PTZPreset === undefined) ? "1" : config.PTZPreset;
		node.channelID = (config.channelID === null || config.channelID === undefined) ? "1" : config.channelID;
		node.waitForCameraPositionReached = config.waitForCameraPositionReached === true || config.waitForCameraPositionReached === "true";
		node.activeOperation = null;
		node.timerPollPosition = null;
		node.operationCounter = 0;

		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}

		function clearPollTimer() {
			if (node.timerPollPosition !== null) {
				clearTimeout(node.timerPollPosition);
				node.timerPollPosition = null;
			}
		}

		function clearActiveOperation() {
			clearPollTimer();
			node.activeOperation = null;
		}

		function abortActiveOperation(reason) {
			if (node.activeOperation !== null) {
				logDebug(reason || `Cancelling PTZ operation ${node.activeOperation.id}`);
			}
			clearActiveOperation();
		}

		function buildSuccessMessage(position = null) {
			let msg = {
				topic: node.topic,
				payload: true
			};
			if (node.activeOperation !== null) {
				msg.channelID = node.activeOperation.channelID;
				msg.PTZPreset = node.activeOperation.PTZPreset;
				msg.waitForCameraPositionReached = node.activeOperation.waitForCameraPositionReached;
			}
			if (position !== null) {
				msg.cameraPositionReached = true;
				msg.cameraPosition = RED.util.cloneMessage(position);
			}
			return msg;
		}

		function buildErrorMessage(errorDescription) {
			let msg = {
				topic: node.topic,
				errorDescription: errorDescription,
				payload: true
			};
			if (node.activeOperation !== null) {
				msg.channelID = node.activeOperation.channelID;
				msg.PTZPreset = node.activeOperation.PTZPreset;
				msg.waitForCameraPositionReached = node.activeOperation.waitForCameraPositionReached;
			}
			return msg;
		}

		function createOperation(waitForCameraPositionReached, originalMsg) {
			node.operationCounter += 1;
			return {
				id: node.operationCounter,
				channelID: node.channelID,
				PTZPreset: node.PTZPreset,
				waitForCameraPositionReached: waitForCameraPositionReached,
				originalMsg: RED.util.cloneMessage(originalMsg || {}),
				phase: "idle",
				initialPosition: null,
				lastPosition: null,
				movementDetected: false,
				stablePollCount: 0,
				gotoAckAt: 0
			};
		}

		function getPositionValue(position, propertyName) {
			if (position === null || position === undefined || !position.hasOwnProperty(propertyName)) return null;
			const value = Number(position[propertyName]);
			return Number.isFinite(value) ? value : null;
		}

		function extractPosition(payload) {
			if (payload === null || payload === undefined || typeof payload !== "object") return null;
			let source = null;
			if (payload.hasOwnProperty("PTZAbsoluteEx")) source = payload.PTZAbsoluteEx;
			else if (payload.hasOwnProperty("AbsoluteHigh")) source = payload.AbsoluteHigh;
			else source = payload;

			if (source === null || source === undefined || typeof source !== "object") return null;

			const position = {
				azimuth: getPositionValue(source, "azimuth"),
				elevation: getPositionValue(source, "elevation"),
				absoluteZoom: getPositionValue(source, "absoluteZoom")
			};

			if (position.azimuth === null && position.elevation === null && position.absoluteZoom === null) return null;
			return position;
		}

		function positionsDiffer(positionA, positionB) {
			if (positionA === null || positionB === null) return false;
			return ["azimuth", "elevation", "absoluteZoom"].some(propertyName => {
				const valueA = getPositionValue(positionA, propertyName);
				const valueB = getPositionValue(positionB, propertyName);
				if (valueA === null || valueB === null) return false;
				return Math.abs(valueA - valueB) > POSITION_TOLERANCE[propertyName];
			});
		}

		function schedulePositionPoll(delayMs = POSITION_POLL_INTERVAL_MS) {
			clearPollTimer();
			node.timerPollPosition = setTimeout(() => {
				if (node.activeOperation === null) return;
				requestCurrentPosition(node.activeOperation, "pollingPosition");
			}, delayMs);
		}

		function requestCurrentPosition(operation, phase) {
			if (node.activeOperation === null || node.activeOperation.id !== operation.id) return;
			node.activeOperation.phase = phase;
			node.setNodeStatus({ fill: "yellow", shape: "ring", text: "Reading PTZ position..." });
			logDebug(`Reading PTZ position for channel ${operation.channelID} (${phase})`);
			node.server.request(node, "GET", "/ISAPI/PTZCtrl/channels/" + operation.channelID + "/absoluteEx", "", true);
		}

		function completeOperationWithSuccess(position = null) {
			let msg = buildSuccessMessage(position);
			clearActiveOperation();
			node.send([msg, null]);
			if (position !== null) {
				node.setNodeStatus({ fill: "green", shape: "dot", text: "Camera position reached." });
				logDebug(`Camera position reached for channel ${msg.channelID} preset ${msg.PTZPreset}`);
			} else {
				node.setNodeStatus({ fill: "green", shape: "dot", text: "PTZ preset command sent." });
				logDebug(`PTZ command acknowledged for channel ${msg.channelID} preset ${msg.PTZPreset}`);
			}
		}

		function completeOperationWithError(errorDescription) {
			let msg = buildErrorMessage(errorDescription);
			clearActiveOperation();
			node.send([null, msg]);
			logDebug(`PTZ operation error: ${errorDescription}`);
		}

		function evaluatePolledPosition(position) {
			const operation = node.activeOperation;
			if (operation === null) return;

			if (operation.initialPosition !== null && positionsDiffer(position, operation.initialPosition)) {
				operation.movementDetected = true;
			}

			if (operation.lastPosition !== null && !positionsDiffer(position, operation.lastPosition)) {
				operation.stablePollCount += 1;
			} else {
				operation.stablePollCount = 0;
			}

			operation.lastPosition = position;

			const elapsedMs = Date.now() - operation.gotoAckAt;
			const reachedBecauseSettledAfterMovement = operation.movementDetected && operation.stablePollCount >= POSITION_STABLE_POLLS_REQUIRED;
			const reachedBecauseAlreadyThere = !operation.movementDetected && elapsedMs >= POSITION_NO_MOVEMENT_GRACE_MS && operation.stablePollCount >= POSITION_STABLE_POLLS_REQUIRED;

			if (reachedBecauseSettledAfterMovement || reachedBecauseAlreadyThere) {
				completeOperationWithSuccess(position);
				return;
			}

			if (elapsedMs >= POSITION_WAIT_TIMEOUT_MS) {
				completeOperationWithError("Timeout waiting for the camera to reach the PTZ position");
				return;
			}

			node.setNodeStatus({ fill: "yellow", shape: "ring", text: "Waiting for camera position reached..." });
			schedulePositionPoll();
		}

		// Called from config node, to send output to the flow
		node.sendPayload = (_msg) => {
			if (_msg === null || _msg === undefined) return;

			if (_msg.type !== undefined && _msg.type === 'img') {
				// The payload is an image, exit.
				return;
			}

			_msg.topic = node.topic;
			if (_msg.hasOwnProperty("errorDescription")) {
				completeOperationWithError(_msg.errorDescription || "Unknown PTZ error");
				return;
			}; // It's a connection error/restore comunication.
			if (!_msg.hasOwnProperty("payload") || (_msg.hasOwnProperty("payload") && _msg.payload === undefined)) return;

			if (typeof _msg.payload === "object" && _msg.payload !== null) {
				const operation = node.activeOperation;
				if (_msg.payload.hasOwnProperty("eventType")) {
					try {
						var sAlarmType = _msg.payload.eventType.toString().toLowerCase();
						logDebug(`Ignoring alertStream event ${sAlarmType} while waiting for PTZ command response`);
					} catch (error) {
						logDebug("Ignoring alertStream event while waiting for PTZ command response");
					}
					return;
				}

				const position = extractPosition(_msg.payload);
				if (operation === null || (operation.phase !== "readingInitialPosition" && operation.phase !== "pollingPosition")) {
					logDebug("Ignoring non-boolean PTZ payload");
					return;
				}

				if (position === null) {
					completeOperationWithError("The camera did not return a supported PTZ position payload");
					return;
				}

				if (operation.phase === "readingInitialPosition") {
					operation.initialPosition = position;
					operation.lastPosition = position;
					logDebug(`Initial PTZ position read for channel ${operation.channelID}: ${JSON.stringify(position)}`);
					recallPTZ(operation);
					return;
				}

				if (operation.phase === "pollingPosition") {
					logDebug(`Polled PTZ position for channel ${operation.channelID}: ${JSON.stringify(position)}`);
					evaluatePolledPosition(position);
					return;
				}

				return;
			}

			if (typeof _msg.payload !== "boolean") return;

			const operation = node.activeOperation;
			if (operation === null || operation.phase !== "sendingGoto") {
				logDebug("Ignoring PTZ boolean payload without a matching pending goto request");
				return;
			}
			if (operation !== null && operation.phase === "sendingGoto" && operation.waitForCameraPositionReached) {
				operation.gotoAckAt = Date.now();
				operation.phase = "pollingPosition";
				node.setNodeStatus({ fill: "yellow", shape: "ring", text: "Waiting for camera position reached..." });
				logDebug(`PTZ command acknowledged, waiting for camera position on channel ${operation.channelID} preset ${operation.PTZPreset}`);
				schedulePositionPoll(POSITION_POLL_INTERVAL_MS);
				return;
			}

			completeOperationWithSuccess();
		}

		// On each deploy, unsubscribe+resubscribe
		if (node.server) {
			node.server.removeClient(node);
			node.server.addClient(node);
		}

			this.on('input', function (msg) {
				if (msg === null || msg === undefined) return;
				abortActiveOperation("Cancelled previous PTZ wait because a new input was received");
				if (msg.hasOwnProperty("payload") && msg.hasOwnProperty("payload") !== null && msg.hasOwnProperty("payload") !== undefined) {
					if (typeof msg.payload === "boolean" && msg.payload === true) {
					let operation = createOperation(node.waitForCameraPositionReached, msg);
					node.activeOperation = operation;
					logDebug(`Recall PTZ preset ${node.PTZPreset} on channel ${node.channelID} (boolean trigger, wait mode ${operation.waitForCameraPositionReached})`);
					if (operation.waitForCameraPositionReached) requestCurrentPosition(operation, "readingInitialPosition");
					else recallPTZ(operation);
					} else if (typeof msg.payload === "object" && msg.payload !== null) {
						// Set the preset via input msg
						if (msg.payload.hasOwnProperty("channelID")) node.channelID = msg.payload.channelID;
						if (msg.payload.hasOwnProperty("PTZPreset")) node.PTZPreset = msg.payload.PTZPreset;
						node.setNodeStatus({ fill: "green", shape: "dot", text: "Preset passed by msg input." });
					let operation = createOperation(node.waitForCameraPositionReached, msg);
					node.activeOperation = operation;
					logDebug(`Recall PTZ with payload overrides: channel ${node.channelID} preset ${node.PTZPreset} (wait mode ${operation.waitForCameraPositionReached})`);
					if (operation.waitForCameraPositionReached) requestCurrentPosition(operation, "readingInitialPosition");
					else recallPTZ(operation);
				}
			}

		});

		// Recalls the PTZ
			function recallPTZ(operation) {
			// Recall PTZ Preset
			// Params: _callerNode, _method, _URL, _body
				try {
					if (operation !== null && operation !== undefined) {
						operation.phase = "sendingGoto";
					}
					node.setNodeStatus({ fill: "yellow", shape: "ring", text: operation !== null && operation.waitForCameraPositionReached ? "Sending PTZ command..." : "Sending PTZ command..." });
					const requestChannelID = operation !== null && operation !== undefined ? operation.channelID : node.channelID;
					const requestPTZPreset = operation !== null && operation !== undefined ? operation.PTZPreset : node.PTZPreset;
					logDebug(`Sending PTZ goto preset request channel ${requestChannelID}, preset ${requestPTZPreset}`);
					node.server.request(node, "PUT", "/ISAPI/PTZCtrl/channels/" + requestChannelID + "/presets/" + requestPTZPreset + "/goto", "");
				} catch (error) {
				logDebug(`Error sending PTZ command: ${error.message || error}`);
				completeOperationWithError(error.message || error);

			}
		}

		node.on("close", function (done) {
			clearActiveOperation();
			if (node.server) {
				node.server.removeClient(node);
			}
			done();
		});

	}

	RED.nodes.registerType("hikvisionUltimatePTZ", hikvisionUltimatePTZ);
}
