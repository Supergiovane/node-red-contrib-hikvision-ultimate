module.exports = (RED) => {
    const { createHttpClient } = require('./utils/httpClient');
    const hikDiscovery = require('./utils/hikDiscovery');
    const { createAlertStreamParser } = require('./utils/alertStreamParser');


    const { createAlarmCapabilities } = require('./utils/alarmCapabilities');
    const { createAlarmMetadata, eventTypes: metadataEventTypes } = require('./utils/alarmMetadata');
    const { XMLParser, XMLValidator } = require("fast-xml-parser");
    const https = require('https');
    const http = require('http');

    function cameraURL(settings, path) {
        const protocol = settings.protocol || "http";
        const host = String(settings.host || "").trim();
        const port = Number(settings.port || (protocol === "https" ? 443 : 80));
        if (!["http", "https"].includes(protocol) || !host || /[\s/@?#\\]/.test(host)
            || !Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error("Invalid camera connection settings");
        }
        const hostname = host.includes(":") && !host.startsWith("[") ? "[" + host + "]" : host;
        return new URL(protocol + "://" + hostname + ":" + port + (path.startsWith("/") ? path : "/" + path)).toString();
    }

    // Register editor routes once; redeploying a config must not retain old nodes or agents.
    async function getInfoCam(req, res) {
        let agent;
        let failureStatus = 400;
        const controller = new globalThis.AbortController();
        const cancel = () => controller.abort();
        res.once?.("close", cancel);
        try {
            let params = req.method === "POST" ? req.body : undefined;
            if (!params || typeof params !== "object" || Array.isArray(params)) {
                const raw = String(req.query.params || "");
                try { params = JSON.parse(raw); }
                catch (_) { params = JSON.parse(decodeURIComponent(raw)); }
            }
            if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("Invalid connection parameters");
            const stored = RED.nodes.getNode(req.query.nodeID || params.nodeID);
            const credentials = stored && stored.credentials || {};
            const password = params.password === "__PWRD__" ? credentials.password : params.password;
            if (params.password === "__PWRD__" && password === undefined) {
                res.status(400).json({ error: "Missing stored credentials" });
                return;
            }
            const url = cameraURL(params, "/ISAPI/System/deviceInfo");
            agent = params.protocol === "https" ? new https.Agent({ rejectUnauthorized: false }) : new http.Agent();
            const client = createHttpClient({
                username: params.user === undefined ? credentials.user : params.user,
                password,
                authentication: params.authentication === "basic" ? "basic" : "digest"
            });
            failureStatus = 502;
            const response = await client.fetch(url, { method: "GET", agent, signal: controller.signal, timeout: 15000, size: 1024 * 1024 });
            if (!response.ok) {
                response.body.destroy();
                res.status(502).json({ error: "Camera returned HTTP " + response.status });
                return;
            }
            const body = await response.text();
            const parsed = new XMLParser().parse(body);
            if (!parsed || !parsed.DeviceInfo) throw new Error("Camera did not return device information");
            res.json(parsed);
        } catch (error) {
            if (!res.destroyed && !res.headersSent) res.status(failureStatus).json({ error: error.message || "Unable to read camera information" });
        } finally {
            res.removeListener?.("close", cancel);
            agent?.destroy();
        }
    }
    RED.httpAdmin.get("/hikvisionUltimateGetInfoCam", RED.auth.needsPermission('Hikvisionconfig.read'), getInfoCam);
    RED.httpAdmin.post("/hikvisionUltimateGetInfoCam", RED.auth.needsPermission('Hikvisionconfig.read'), getInfoCam);
    RED.httpAdmin.get("/hikvisionUltimateAlarmCapabilities", RED.auth.needsPermission('Hikvisionconfig.read'), async (req, res) => {
        const channelID = String(req.query.channelID === undefined ? "0" : req.query.channelID);
        if (!/^(0|[1-9]\d{0,5})$/.test(channelID)) {
            res.status(400).json({ error: "Invalid channel ID" });
            return;
        }
        const node = RED.nodes.getNode(req.query.nodeID);
        if (!node || node.isClosing || typeof node.fetchAlarmCapabilities !== "function") {
            res.status(404).json({ error: "Save and deploy the camera configuration before reading its capabilities" });
            return;
        }
        try {
            const result = req.query.cached === "true"
                ? node.getAlarmCapabilitiesSnapshot(channelID)
                : await node.fetchAlarmCapabilities(channelID, req.query.refresh === "true");
            res.json(result);
        } catch (error) {
            res.status(502).json({ error: error.message || "Unable to read camera capabilities" });
        }
    });
    RED.httpAdmin.get("/hikvisionUltimateAlarmMetadata", RED.auth.needsPermission('Hikvisionconfig.read'), async (req, res) => {
        const channelID = req.query.channelID === undefined ? "0" : req.query.channelID;
        const eventType = req.query.eventType === undefined ? "" : req.query.eventType;
        try {
            if (typeof channelID !== 'string' || !/^(0|[1-9]\d{0,5})$/.test(channelID)) throw new Error('Invalid channel ID');
            metadataEventTypes(eventType);
        } catch (_) {
            res.status(400).json({ error: "Invalid channel ID or event type" });
            return;
        }
        const node = RED.nodes.getNode(req.query.nodeID);
        if (!node || node.isClosing || typeof node.fetchAlarmMetadata !== "function") {
            res.status(404).json({ error: "Save and deploy the camera configuration before reading names" });
            return;
        }
        try {
            res.json(await node.fetchAlarmMetadata(channelID, eventType, req.query.refresh === "true"));
        } catch (error) {
            res.status(502).json({ error: error.message || "Unable to read channel and zone names" });
        }
    });

    function normalizeDiscoveredDevice(device) {
        const normalized = Object.assign({}, device);
        const host = normalized.IPv4Address || normalized.ipv4Address || normalized.IPAddress || normalized.ipAddress || "";
        const port = normalized.HttpPort || normalized.httpPort || normalized.Port || normalized.port || 80;
        const description = normalized.DeviceDescription || normalized.deviceDescription || normalized.DeviceName || normalized.deviceName || "";
        const model = normalized.Model || normalized.model || "";
        const firmware = normalized.SoftwareVersion || normalized.softwareVersion || normalized.FirmwareVersion || normalized.firmwareVersion || "";
        const serial = normalized.DeviceSN || normalized.SerialNO || normalized.SerialNumber || normalized.serialNumber || "";

        normalized.host = host.toString();
        normalized.port = port.toString();
        normalized.name = description ? description.toString() : (model ? model.toString() : normalized.host);
        normalized.model = model ? model.toString() : "";
        normalized.firmware = firmware ? firmware.toString() : "";
        normalized.serialNumber = serial ? serial.toString() : "";
        normalized.label = [
            normalized.name,
            normalized.host ? "(" + normalized.host + ":" + normalized.port + ")" : "",
            normalized.model,
            normalized.firmware
        ].filter(Boolean).join(" ");

        return normalized;
    }

    RED.httpAdmin.get("/hikvisionUltimateDiscoverOnlineDevices", RED.auth.needsPermission('Hikvisionconfig.read'), async function (req, res) {
        try {
            const timeoutMs = Number(req.query.timeoutMs);
            const devices = await hikDiscovery.Discover(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 2500);
            const normalizedDevices = devices
                .map(normalizeDiscoveredDevice)
                .filter(device => device.host)
                .sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
            res.json(normalizedDevices);
        } catch (error) {
            RED.log.error("Hikvision-config: discovery failed: " + (error.message || " unknown error"));
            res.json([]);
        }
    });

    function Hikvisionconfig(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.credentials = node.credentials || {};
        node.port = config.port || 80;
        node.debug = (config.debuglevel === undefined || config.debuglevel === "no") ? false : true;
        node.name = config.name || config.host || "";
        node.host = config.host;// + ":" + node.port;
        node.protocol = config.protocol || "http";
        node.nodeClients = []; // Stores the registered clients
        node.isConnected = false; // Healthy only after receiving a valid alert or heartbeat.
        let connectionFailureReported = false;
        node.isClosing = false;
        node.timerCheckHeartBeat = null;
        node.errorDescription = ""; // Contains the error description in case of connection error.
        node.authentication = String(config.authentication || "digest").toLowerCase() === "basic" ? "basic" : "digest";
        node.deviceinfo = config.deviceinfo || {};
        const configuredStreamTimeout = config.streamtimeout;
        const streamTimeoutMinutes = configuredStreamTimeout === undefined || configuredStreamTimeout === null || configuredStreamTimeout === "" ? 0 : Number(configuredStreamTimeout);
        const safeStreamTimeoutMinutes = Number.isFinite(streamTimeoutMinutes) && streamTimeoutMinutes > 0 ? streamTimeoutMinutes : 0;
        node.streamtimeout = safeStreamTimeoutMinutes;
        node.streamTimeoutMs = safeStreamTimeoutMinutes > 0 ? safeStreamTimeoutMinutes * 60000 : 0;
        node.heartBeatTimerDisconnectionCounter = 0;
        const configuredDisconnectionLimit = Number(config.heartbeattimerdisconnectionlimit);
        node.heartbeattimerdisconnectionlimit = Number.isInteger(configuredDisconnectionLimit) && configuredDisconnectionLimit > 0 ? configuredDisconnectionLimit : 2;
        let activeStream = null;
        let streamGeneration = 0;
        let startupTimer = null;
        let reconnectTimer = null;
        let reconnectDelayMs = 2000;
        const pendingRequests = new Set();
        node.onLineHikvisionDevicesDiscoverList = null; // 12/01/2023 holds the online devices, used in the HTML
        if (node.debug) RED.log.info("Hikvision-config: initialized " + (node.name || node.host) + " (" + node.protocol + "://" + node.host + ":" + node.port + ")");

        function forEachClient(callback) {
            node.nodeClients.forEach(client => {
                try { callback(client); }
                catch (error) {
                    if (node.debug) RED.log.error("Hikvision-config: client callback failed: " + error.message);
                }
            });
        }
        node.setAllClientsStatus = ({ fill, shape, text }) => {
            forEachClient(client => client.setNodeStatus({ fill, shape, text }));
        };

        // 14/07/2021 custom agent as global variable, to avoid issue with self signed certificates
        const customHttpsAgent = new https.Agent({
            rejectUnauthorized: false,
            keepAlive: true, // Mantiene vive le connessioni
            maxSockets: 10,  // Numero massimo di connessioni simultanee
        });
        const customHttpAgent = new http.Agent({
            rejectUnauthorized: false,
            keepAlive: true, // Mantiene vive le connessioni
            maxSockets: 10,  // Numero massimo di connessioni simultanee
        });

        const capabilitiesClient = createHttpClient({
            username: node.credentials.user,
            password: node.credentials.password,
            authentication: node.authentication === "basic" ? "basic" : "digest"
        });
        const discoveryBackoff = { until: 0, warning: '' };
        const fetchDiscovery = (path, options = {}) => {
            if (node.isClosing) return Promise.reject(new Error("Camera configuration is closing"));
            return capabilitiesClient.fetch(cameraURL(node, path), {
                ...options,
                method: "GET",
                agent: node.protocol === "https" ? customHttpsAgent : customHttpAgent
            });
        };
        const alarmCapabilities = createAlarmCapabilities({ fetch: fetchDiscovery, backoff: discoveryBackoff });
        const alarmMetadata = createAlarmMetadata({ fetch: fetchDiscovery, getCapabilities: () => alarmCapabilities.snapshot(), backoff: discoveryBackoff });
        node.fetchAlarmCapabilities = (channelID = "0", force = false) => alarmCapabilities.refresh(channelID, force);
        node.getAlarmCapabilitiesSnapshot = (channelID = "0") => alarmCapabilities.snapshot(channelID);
        node.fetchAlarmMetadata = (channelID = "0", eventType = "", force = false) => alarmMetadata.refresh(channelID, eventType, force);

        function clearHeartbeatTimer() {
            if (node.timerCheckHeartBeat !== null) clearTimeout(node.timerCheckHeartBeat);
            node.timerCheckHeartBeat = null;
        }

        node.resetHeartBeatTimer = () => {
            clearHeartbeatTimer();
            if (node.isClosing || !activeStream) return;
            const generation = activeStream.generation;
            const timeoutMs = node.streamTimeoutMs > 0 ? Math.min(40000, node.streamTimeoutMs) : 40000;
            node.timerCheckHeartBeat = setTimeout(() => {
                node.timerCheckHeartBeat = null;
                failStream(generation, "Timeout waiting heartbeat");
            }, timeoutMs);
        };

        function extractBoundary(contentType) {
            const match = /boundary="?([^";]+)"?/i.exec(contentType || "");
            return match ? match[1].trim().replace(/^--/, '') : "boundary";
        }

        function clearReconnectTimer() {
            if (reconnectTimer !== null) clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        function scheduleReconnect(reason) {
            if (node.isClosing || reconnectTimer !== null) return;
            const delayMs = reconnectDelayMs;
            reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                if (node.isClosing) return;
                if (node.debug) RED.log.warn("Hikvision-config: reconnecting stream (" + reason + ")");
                startAlarmStream();
            }, delayMs);
        }

        function stopStream() {
            const previous = activeStream;
            activeStream = null;
            streamGeneration += 1;
            clearHeartbeatTimer();
            if (!previous) return;
            previous.controller.abort();
            previous.body?.destroy();
            previous.agent.destroy();
        }

        function failStream(generation, reason) {
            if (node.isClosing || !activeStream || activeStream.generation !== generation) return;
            stopStream();
            node.errorDescription = reason;
            node.isConnected = false;
            node.heartBeatTimerDisconnectionCounter += 1;
            if (node.heartBeatTimerDisconnectionCounter >= node.heartbeattimerdisconnectionlimit) {
                if (!connectionFailureReported) {
                    connectionFailureReported = true;
                    forEachClient(client => client.sendPayload({ topic: client.topic || "", errorDescription: reason, payload: true }));
                }
                node.setAllClientsStatus({ fill: "red", shape: "ring", text: "Lost connection...Retry... " + reason });
            } else {
                node.setAllClientsStatus({ fill: "yellow", shape: "ring", text: "Temporary lost connection. " + reason });
            }
            if (node.debug) RED.log.warn("Hikvision-config: " + reason);
            scheduleReconnect(reason);
        }

        function markStreamHealthy(generation) {
            if (node.isClosing || !activeStream || activeStream.generation !== generation) return;
            reconnectDelayMs = 2000;
            node.heartBeatTimerDisconnectionCounter = 0;
            node.resetHeartBeatTimer();
            if (node.isConnected) return;
            node.isConnected = true;
            node.errorDescription = "";
            if (connectionFailureReported) {
                connectionFailureReported = false;
                forEachClient(client => client.sendPayload({ topic: client.topic || "", errorDescription: "", payload: false }));
            }
            node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Waiting for event." });
        }

        async function startAlarmStream() {
            if (node.isClosing || activeStream) return;
            clearReconnectTimer();
            const generation = ++streamGeneration;
            const controller = new globalThis.AbortController();
            const agent = node.protocol === "https"
                ? new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 1 })
                : new http.Agent({ keepAlive: true, maxSockets: 1 });
            activeStream = { generation, controller, agent, body: null };
            node.setAllClientsStatus({ fill: connectionFailureReported ? "red" : "grey", shape: "ring", text: "Connecting..." });
            try {
                const client = createHttpClient({
                    username: node.credentials.user,
                    password: node.credentials.password,
                    authentication: node.authentication === "basic" ? "basic" : "digest",
                    logger: node.debug ? RED.log : undefined
                });
                const response = await client.fetch(cameraURL(node, "/ISAPI/Event/notification/alertStream"), {
                    method: "GET",
                    headers: { "Accept": "*/*", "Cache-Control": "no-cache", "User-Agent": "node-red-contrib-hikvision-ultimate" },
                    agent,
                    signal: controller.signal,
                    connectTimeout: 15000,
                    timeout: 0
                });
                if (node.isClosing || !activeStream || activeStream.generation !== generation) {
                    response.body.destroy();
                    return;
                }
                activeStream.body = response.body;
                if (!response.ok) throw new Error("Camera returned HTTP " + response.status);
                const contentType = String(response.headers.get("content-type") || "").toLowerCase();
                if (!contentType.includes("multipart") && !contentType.includes("application/xml") && !contentType.includes("text/xml")) {
                    throw new Error("Unsupported Content-Type: " + (contentType || "missing"));
                }
                const isCurrent = () => !node.isClosing && activeStream && activeStream.generation === generation;
                const parser = createAlertStreamParser({
                    boundary: extractBoundary(response.headers.get("content-type")),
                    // Transport bytes alone do not prove that alarm delivery works.
                    onXml: data => { if (isCurrent()) handleXML(data, () => markStreamHealthy(generation)); },
                    onJson: data => { if (isCurrent()) handleJSON(data, () => markStreamHealthy(generation)); },
                    onImage: (data, extension) => { if (isCurrent()) handleIMG(data, extension); },
                    onUnsupported: type => { if (node.debug) RED.log.warn("Hikvision-config: unsupported stream part " + type); },
                    onError: error => failStream(generation, "Alert stream parser error: " + error.message)
                });
                const finish = reason => {
                    if (!isCurrent()) return;
                    parser.flush();
                    failStream(generation, reason);
                };
                response.body.on("error", error => finish("Stream response error: " + error.message));
                response.body.once("end", () => finish("Stream response ended"));
                response.body.once("close", () => finish("Stream response closed"));
                response.body.on("data", chunk => { if (isCurrent()) parser.feed(chunk); });
                if (isCurrent()) {
                    node.setAllClientsStatus({ fill: connectionFailureReported ? "red" : "grey", shape: "ring", text: "Waiting for heartbeat or event." });
                    node.resetHeartBeatTimer();
                }
            } catch (error) {
                failStream(generation, error.message || "Stream connection failed");
            }
        }

        //#region "HANDLE STREAM MESSAGE"
        // Handle the complete stream message
        // ###################################
        async function handleIMG(result, extension) {
            try {
                if (node.debug) RED.log.info("Hikvision-config: image part received (" + result.length + " bytes, " + extension + ")");
                forEachClient(oClient => {
                    oClient.sendPayload({ topic: oClient.topic || "", payload: result, type: 'img', extension: extension });
                });
            } catch (error) {
                if (node.debug) RED.log.error("Hikvision-config: image part handling error: " + (error.message || " unknown error"));
            }
        }
        function containsAlert(value, depth = 0) {
            if (depth > 24 || !value || typeof value !== "object") return false;
            if (Array.isArray(value)) return value.some(entry => containsAlert(entry, depth + 1));
            if (typeof value.eventType === "string" && value.eventType.trim()) return true;
            const cid = value.CIDEvent;
            if (cid && typeof cid === "object" && !Array.isArray(cid)
                && ((typeof cid.type === "string" && cid.type.trim())
                    || typeof cid.code === "number" || (typeof cid.code === "string" && cid.code.trim()))) return true;
            return containsAlert(value.EventNotificationAlert, depth + 1) || containsAlert(value.SmartEvent, depth + 1);
        }
        function handleXML(result, onValid) {
            try {
                const isHeartbeatEvent = (eventEntry) => {
                    if (!eventEntry || typeof eventEntry !== "object") return false;
                    const eventType = eventEntry.eventType !== undefined ? eventEntry.eventType.toString().toLowerCase() : "";
                    const eventState = eventEntry.eventState !== undefined ? eventEntry.eventState.toString().toLowerCase() : "";
                    const activePostCount = Number(eventEntry.activePostCount);
                    return eventType === "videoloss" && eventState === "inactive" && (activePostCount === 0 || activePostCount === 1);
                };

                const summarizeEvent = (eventEntry) => {
                    if (!eventEntry || typeof eventEntry !== "object") return "unknown event";
                    const eventType = eventEntry.eventType || "unknown";
                    const eventState = eventEntry.eventState || "unknown";
                    const channelID = eventEntry.channelID || eventEntry.dynChannelID || "unknown";
                    const dateTime = eventEntry.dateTime || "no timestamp";
                    return eventType + " " + eventState + " channel " + channelID + " at " + dateTime;
                };

                const xmlText = Buffer.isBuffer(result) ? result.toString("utf8") : result.toString();
                // Some firmwares batch multiple alert roots in one length-framed
                // part. Validate every tag while preserving the original batch shape.
                const batchText = xmlText.replace(/^\s*<\?xml\s[^?]*\?>/, "");
                if (!xmlText.trim().startsWith("<") || /<!DOCTYPE|<!ENTITY/i.test(xmlText)
                    || (XMLValidator.validate(xmlText) !== true
                        && XMLValidator.validate("<HikvisionAlertBatch>" + batchText + "</HikvisionAlertBatch>") !== true)) {
                    throw new Error("Invalid XML alert document");
                }
                const parser = new XMLParser({ removeNSPrefix: true });
                const parsedXML = parser.parse(xmlText);

                // Some devices/firmwares occasionally deliver multiple EventNotificationAlert
                // entries in a single parsed object/array: normalize to a flat events list.
                const eventsToForward = [];
                if (parsedXML !== null && parsedXML !== undefined) {
                    const root = parsedXML.EventNotificationAlert !== undefined ? parsedXML.EventNotificationAlert : parsedXML;
                    if (Array.isArray(root)) {
                        root.forEach((ev) => {
                            if (ev && typeof ev === "object") eventsToForward.push(ev);
                        });
                    } else if (root && typeof root === "object") {
                        eventsToForward.push(root);
                    }
                }

                if (eventsToForward.some(eventEntry => containsAlert(eventEntry))) onValid();
                const normalizedEvents = [];
                eventsToForward.forEach((eventEntry) => {
                    if (eventEntry.channelID === undefined && eventEntry.dynChannelID !== undefined) {
                        // API Version 1.0
                        eventEntry.channelID = eventEntry.dynChannelID;
                    }
                    alarmCapabilities.observe(eventEntry);
                    alarmMetadata.observe(eventEntry);
                    normalizedEvents.push(eventEntry);
                });

                if (node.debug) {
                    const interestingEvents = normalizedEvents.filter(eventEntry => !isHeartbeatEvent(eventEntry));
                    if (interestingEvents.length > 0) {
                        interestingEvents.forEach(eventEntry => {
                            RED.log.info("Hikvision-config: event received " + summarizeEvent(eventEntry));
                        });
                    } else if (normalizedEvents.length > 0) {
                        RED.log.debug("Hikvision-config: heartbeat event received");
                    }
                }

                // Each parser callback represents one event. Preserve repeated events, regions,
                // and timestamps even when a device clock is inaccurate or a batch is recovered.
                normalizedEvents.forEach((eventEntry) => {
                    forEachClient(oClient => {
                        oClient.sendPayload({ topic: oClient.topic || "", payload: eventEntry, type: 'event' });
                    });
                });
            } catch (error) {
                if (node.debug) RED.log.error("Hikvision-config: XML parse/handling error: " + (error.message || " unknown error"));
                throw error;
            }
        }
        function handleJSON(result, onValid) {
            try {
                const oJSON = JSON.parse(result);
                if (oJSON !== null && typeof oJSON === "object") {
                    if (containsAlert(oJSON)) onValid();
                    // Observe supported wrappers without changing the JSON payload contract
                    // used by Raw and other clients of this configuration node.
                    alarmCapabilities.observe(oJSON);
                    alarmMetadata.observe(oJSON);
                    forEachClient(oClient => {
                        oClient.sendPayload({ topic: oClient.topic || "", payload: oJSON, type: 'event' });
                    });
                }
            } catch (error) {
                if (node.debug) RED.log.error("Hikvision-config: JSON parse/handling error: " + (error.message || " unknown error"));
                throw error;
            }
        }
        // ###################################
        //#endregion

        startupTimer = setTimeout(() => {
            startupTimer = null;
            startAlarmStream();
        }, 10000); // First connection.
        //#endregion

        //#region GENERIC GET OT PUT CALL
        // Function to get or post generic data on camera
        node.request = async function (_callerNode, _method, _URL, _body, _fromXMLNode) {
            if (node.isClosing) return;
            if (_fromXMLNode === undefined) _fromXMLNode = false; // 07/10/2021 Does the request come from an XML node?
            var clientGenericRequest;
            const authMode = (node.authentication || "digest").toLowerCase();
            clientGenericRequest = createHttpClient({
                username: node.credentials.user,
                password: node.credentials.password,
                authentication: authMode === "basic" ? "basic" : "digest",
                logger: node.debug ? RED.log : undefined
            });

            var reqController = new globalThis.AbortController();
            pendingRequests.add(reqController);
            var options = {
                // These properties are part of the Fetch Standard
                method: _method.toString().toUpperCase(),
                headers: {},        // request headers. format is the identical to that accepted by the Headers constructor (see below)
                body: _body,         // request body. can be null, a string, a Buffer, a Blob, or a Node.js Readable stream
                redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                signal: reqController.signal,       // pass an instance of AbortSignal to optionally abort requests

                // The following properties are node-fetch extensions
                follow: 20,         // maximum redirect count. 0 to not follow redirect
                timeout: 15000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: node.protocol === "https" ? customHttpsAgent : customHttpAgent // http(s).Agent instance or function that returns an instance (see below),        

            };

            try {
                if (!_URL.startsWith("/")) _URL = "/" + _URL;

                // 07/10/2021 Strip the body in case of GET and HEAD (otherwise, Fetch thwors an error)
                if (options.method.toString().toUpperCase() === "GET" || options.method.toString().toUpperCase() === "HEAD") delete (options.body)

                const response = await clientGenericRequest.fetch(cameraURL(node, _URL), options);
                if (node.isClosing) {
                    response.body.destroy();
                    return;
                }

                if (response.status >= 200 && response.status < 300) {
                    //node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Connected." });
                } else {
                    // _callerNode.setNodeStatus({ fill: "red", shape: "ring", text: response.statusText + ' ' + response.status || " unknown response code" });
                    // // 07/04/2021 Wrong URL? Send this and is captured by picture node to try another url
                    //  _callerNode.sendPayload({ topic: _callerNode.topic || "", payload: false, wrongResponse: response.status });
                    // throw new Error("Error response: " + response.statusText + ' ' + response.status || " unknown response code");
                }

                if (response.ok) {
                    var body = "";

                    // 07/10/2021 If the request comes from XML node, return any response
                    if (_fromXMLNode) {
                        body = await response.buffer();
                        if (node.isClosing) return;
                        //_callerNode.sendPayload({ topic: _callerNode.topic || "", payload:  body.toString("base64")});
                        const parser = new XMLParser();
                        try {
                            let result = parser.parse(body.toString());
                            _callerNode.sendPayload({ topic: _callerNode.name || "", payload: result });
                        } catch (error) {
                            _callerNode.sendPayload({ topic: _callerNode.name || "", payload: body.toString() });
                        }
                    } else if (_URL.toLowerCase().includes("/ptzctrl/")) {// Based on URL, will return the appropriate encoded body
                        response.body.resume();
                        _callerNode.sendPayload({ topic: _callerNode.topic || "", payload: true });
                    } else if (_URL.toLowerCase().includes("/streaming")) {
                        body = await response.buffer();
                        if (node.isClosing) return;
                        //_callerNode.sendPayload({ topic: _callerNode.topic || "", payload:  body.toString("base64")});
                        _callerNode.sendPayload({ topic: _callerNode.topic || "", payload: body });
                    } else {
                        response.body.resume();
                    }
                } else {
                    response.body.resume();
                    if (_fromXMLNode) {
                        // 07/10/2021 If the request comes from XML node, return any response
                        _callerNode.sendPayload({ topic: _callerNode.name || "", wrongResponse: response.status });
                    } else if (_URL.toLowerCase().includes("/ptzctrl/")) {

                    } else if (_URL.toLowerCase().includes("/streaming/") || _URL.toLowerCase().includes("/streamingproxy/")) {
                        _callerNode.setNodeStatus({ fill: "red", shape: "ring", text: response.statusText + ' ' + response.status || " unknown response code" });
                        // 07/04/2021 Wrong URL? Send this and is captured by picture node to try another url
                        _callerNode.sendPayload({ topic: _callerNode.topic || "", payload: false, wrongResponse: response.status });
                    } else {
                        _callerNode.setNodeStatus({ fill: "red", shape: "ring", text: response.statusText + ' ' + response.status || " unknown response code" });
                    }
                    throw new Error("Error response: " + response.statusText + ' ' + response.status || " unknown response code");

                }

            } catch (err) {
                if (node.isClosing) return;
                //console.log("ORRORE " + err.message);
                // Main Error
                _callerNode.setNodeStatus({ fill: "grey", shape: "ring", text: "clientGenericRequest.fetch error: " + err.message });
                _callerNode.sendPayload({ topic: _callerNode.topic || "", errorDescription: err.message, payload: true });
                if (node.debug) RED.log.error("Hikvision-config: clientGenericRequest.fetch error " + err.message);
                // Abort request
                if (reqController !== null) {
                    try {
                        //if (reqController !== null) reqController.abort().then(ok => { }).catch(err => { });
                        if (reqController !== null) reqController.abort();
                    } catch (error) { }
                }
            } finally {
                pendingRequests.delete(reqController);
            }
        };
        //#endregion

        //#region "FUNCTIONS"
        node.on('close', function (removed, done) {
            if (typeof removed === "function") done = removed;
            node.isClosing = true;
            if (startupTimer !== null) clearTimeout(startupTimer);
            startupTimer = null;
            clearReconnectTimer();
            stopStream();
            alarmCapabilities.close();
            alarmMetadata.close();
            pendingRequests.forEach(request => request.abort());
            pendingRequests.clear();
            customHttpAgent.destroy();
            customHttpsAgent.destroy();
            if (typeof done === "function") done();
        });

        node.addClient = (_Node) => {
            if (node.isClosing) return;
            const isNewClient = !node.nodeClients.some(client => client.id === _Node.id);
            // Check if node already exists
            if (isNewClient) {
                // Add _Node to the clients array
                node.nodeClients.push(_Node)
            }
            if (node.debug) RED.log.info("Hikvision-config: registered client " + (_Node.type || _Node.id || "unknown") + " (" + node.nodeClients.length + " total)");
            try {
                _Node.setNodeStatus({
                    fill: connectionFailureReported ? "red" : node.isConnected ? "green" : "grey",
                    shape: "ring",
                    text: connectionFailureReported ? "Lost connection...Retry... " + node.errorDescription : node.isConnected ? "Waiting for event." : "Waiting for connection"
                });
            } catch (error) { }
            // A partial deploy can add an Alarm node while the shared config is
            // already offline. That subscriber must receive the current error too.
            if (isNewClient && connectionFailureReported) {
                try { _Node.sendPayload({ topic: _Node.topic || "", errorDescription: node.errorDescription, payload: true }); }
                catch (error) { if (node.debug) RED.log.error("Hikvision-config: client callback failed: " + error.message); }
            }
        };

        node.removeClient = (_Node) => {
            // Remove the client node from the clients array
            //if (node.debug) RED.log.info( "BEFORE Node " + _Node.id + " has been unsubscribed from receiving KNX messages. " + node.nodeClients.length);
            try {
                node.nodeClients = node.nodeClients.filter(x => x.id !== _Node.id)
            } catch (error) { }
            //if (node.debug) RED.log.info("AFTER Node " + _Node.id + " has been unsubscribed from receiving KNX messages. " + node.nodeClients.length);

            // If no clien nodes, disconnect from bus.
            if (node.nodeClients.length === 0) {

            }
        };
        //#endregion
    }


    RED.nodes.registerType("Hikvision-config", Hikvisionconfig, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" }
        }
    });
}
