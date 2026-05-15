module.exports = (RED) => {
    const { createHttpClient } = require('./utils/httpClient');
    const hikDiscovery = require('./utils/hikDiscovery');


    const NONCE_COUNT = '00000001';

    const { XMLParser } = require("fast-xml-parser");
    const https = require('https');
    const http = require('http');
    const Dicer = require('dicer');
    const crypto = require('crypto');

    // Helper function to parse the WWW-Authenticate header
    function parseDigestHeader(header) {
        if (!header) return {};
        const trimmed = header.trim();
        const paramsPart = trimmed.replace(/^digest\s+/i, '');
        const challenge = {};
        const regex = /([a-z0-9_-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/ig;
        let match;

        while ((match = regex.exec(paramsPart)) !== null) {
            let value = match[2].trim();
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            }
            challenge[match[1]] = value;
        }

        return challenge;
    }

    function pickDigestQop(qop) {
        if (!qop) return null;
        const qops = qop.split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
        if (qops.includes("auth")) return "auth";
        return qops[0] || null;
    }

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
        node.port = config.port || 80;
        node.debug = (config.debuglevel === undefined || config.debuglevel === "no") ? false : true;
        node.name = config.name || config.host || "";
        node.host = config.host;// + ":" + node.port;
        node.protocol = config.protocol || "http";
        node.nodeClients = []; // Stores the registered clients
        node.isConnected = true; // Assumes, that is already connected.
        node.isClosing = false;
        node.timerCheckHeartBeat = null;
        node.errorDescription = ""; // Contains the error description in case of connection error.
        node.authentication = config.authentication || "digest";
        node.deviceinfo = config.deviceinfo || {};
        const configuredStreamTimeout = config.streamtimeout;
        const streamTimeoutMinutes = configuredStreamTimeout === undefined || configuredStreamTimeout === null || configuredStreamTimeout === "" ? 0 : Number(configuredStreamTimeout);
        const safeStreamTimeoutMinutes = Number.isFinite(streamTimeoutMinutes) && streamTimeoutMinutes > 0 ? streamTimeoutMinutes : 0;
        node.streamtimeout = safeStreamTimeoutMinutes;
        node.streamTimeoutMs = safeStreamTimeoutMinutes > 0 ? safeStreamTimeoutMinutes * 60000 : 0;
        node.heartBeatTimerDisconnectionCounter = 0;
        node.heartbeattimerdisconnectionlimit = config.heartbeattimerdisconnectionlimit || 2;
        var controller = null; // AbortController
        let transferProtocol = null; // can be http or https class (per-node)
        let streamRequest = null; // Per-node alert stream request
        let reconnectTimer = null;
        let reconnectReason = "";
        const intentionallyClosedRequests = new WeakSet();
        let reconnectDelayMs = 2000;
        const MAX_ABSOLUTE_EVENT_AGE_MS = 2 * 60 * 1000; // Drop events older than 2 minutes
        const MAX_RELATIVE_BATCH_EVENT_AGE_MS = 20 * 1000; // In large recovered batches, keep only near-tail events
        const MAX_FORWARD_EVENTS_PER_BATCH = 128; // Safety cap to avoid flooding downstream nodes
        node.onLineHikvisionDevicesDiscoverList = null; // 12/01/2023 holds the online devices, used in the HTML
        if (node.debug) RED.log.info("Hikvision-config: initialized " + (node.name || node.host) + " (" + node.protocol + "://" + node.host + ":" + node.port + ")");

        node.setAllClientsStatus = ({ fill, shape, text }) => {
            function nextStatus(oClient) {
                oClient.setNodeStatus({ fill: fill, shape: shape, text: text })
            }
            node.nodeClients.map(nextStatus);
        }

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

        // 14/12/2020 Get the infos from the camera
        RED.httpAdmin.get("/hikvisionUltimateGetInfoCam", RED.auth.needsPermission('Hikvisionconfig.read'), function (req, res) {
            var jParams = JSON.parse(decodeURIComponent(req.query.params));// Retrieve node.id of the config node.
            var _nodeServer = null;
            var clientInfo;

            const requestedAuth = (jParams.authentication || "digest").toLowerCase();
            const authentication = requestedAuth === "basic" ? "basic" : "digest";
            let passwordToUse = jParams.password;

            if (jParams.password === "__PWRD__") {
                _nodeServer = RED.nodes.getNode(req.query.nodeID);
                if (!_nodeServer || !_nodeServer.credentials || !_nodeServer.credentials.password) {
                    res.json({ error: "Missing stored credentials" });
                    return;
                }
                passwordToUse = _nodeServer.credentials.password;
            }

            clientInfo = createHttpClient({
                username: jParams.user,
                password: passwordToUse,
                authentication,
                logger: node.debug ? RED.log : undefined
            });


            var opt = {
                // These properties are part of the Fetch Standard
                method: "GET",
                headers: {},        // request headers. format is the identical to that accepted by the Headers constructor (see below)
                body: null,         // request body. can be null, a string, a Buffer, a Blob, or a Node.js Readable stream
                redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                signal: null,       // pass an instance of AbortSignal to optionally abort requests

                // The following properties are node-fetch extensions
                follow: 20,         // maximum redirect count. 0 to not follow redirect
                timeout: 15000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,       // http(s).Agent instance or function that returns an instance (see below)
                agent: jParams.protocol === "https" ? customHttpsAgent : customHttpAgent,// http(s).Agent instance or function that returns an instance (see below),        
            };
            try {
                (async () => {
                    try {
                        const resInfo = await clientInfo.fetch(jParams.protocol + "://" + jParams.host + ":" + jParams.port + "/ISAPI/System/deviceInfo", opt);
                        const body = await resInfo.text();
                        const parser = new XMLParser();
                        try {
                            let jObj = parser.parse(body);
                            res.json(jObj);
                            return;
                        } catch (error) {
                            res.json(error);
                            return;
                        }

                    } catch (error) {
                        RED.log.error("Errore  hikvisionUltimateGetInfoCam " + error.message);
                        res.json(error);
                    }

                })();

            } catch (err) {
                res.json(err);
            }
        });

        // This function starts the heartbeat timer, to detect the disconnection from the server
        node.resetHeartBeatTimer = () => {
            if (node.isClosing) return;
            // Reset node.timerCheckHeartBeat
            if (node.timerCheckHeartBeat !== null) clearTimeout(node.timerCheckHeartBeat);
            node.timerCheckHeartBeat = setTimeout(() => {
                if (node.isClosing) return;
                node.heartBeatTimerDisconnectionCounter += 1;
                if (node.heartBeatTimerDisconnectionCounter < node.heartbeattimerdisconnectionlimit) {
                    // 28/12/2020 Retry again until connection attempt limit reached
                    node.setAllClientsStatus({ fill: "yellow", shape: "ring", text: "Temporary lost connection. Attempt " + node.heartBeatTimerDisconnectionCounter + " of " + node.heartbeattimerdisconnectionlimit });
                    if (controller !== null) {
                        try {
                            controller.abort();
                        } catch (error) { }
                    }
                    try {
                        startAlarmStream()
                    } catch (error) {
                    }

                } else {
                    // 28/12/2020 Connection attempt limit reached
                    node.heartBeatTimerDisconnectionCounter = 0;
                    if (node.isConnected) {
                        if (node.errorDescription === "") node.errorDescription = "Timeout waiting heartbeat"; // In case of timeout of a stream, there is no error throwed.
                        node.nodeClients.forEach(oClient => {
                            oClient.sendPayload({ topic: oClient.topic || "", errorDescription: node.errorDescription, payload: true });
                        });
                        node.setAllClientsStatus({ fill: "red", shape: "ring", text: "Lost connection...Retry... " + node.errorDescription });
                    }
                    if (controller !== null) {
                        try {
                            controller.abort();
                        } catch (error) { }
                    }
                    node.isConnected = false;
                    setTimeout(() => {
                        if (node.isClosing) return;
                        try {
                            startAlarmStream()
                        } catch (error) {
                        }
                    }, 2000); // Reconnect
                }
            }, 40000);
        }

        //#region ALARMSTREAM
        // Funzione per estrarre il boundary dal Content-Type
        function extractBoundary(contentType) {
            if (!contentType) return null;
            const match = /boundary="?([^";]+)"?/i.exec(contentType);
            if (!match) return null;
            return match[1].trim().replace(/^--/, '');
        }

        function clearReconnectTimer() {
            if (reconnectTimer !== null) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
        }

        function scheduleReconnect(reason, delayMs) {
            if (node.isClosing) return;
            if (reconnectTimer !== null) return;
            reconnectReason = reason || "unknown";
            const effectiveDelayMs = delayMs || reconnectDelayMs;
            reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                if (node.isClosing) return;
                try {
                    if (node.debug) RED.log.warn("Hikvision-config: reconnecting stream (" + reconnectReason + ")");
                    startAlarmStream();
                } catch (error) {
                    if (node.debug) RED.log.error("Hikvision-config: reconnect scheduling failed: " + (error.message || " unknown error"));
                }
            }, effectiveDelayMs);
        }

        // Function to continue with authenticated request
        function continueWithAuthenticatedRequest(options) {
            if (node.debug) RED.log.info('Hikvision-config: Starting authenticated stream...');
            try {
                node.setAllClientsStatus({ fill: 'green', shape: 'dot', text: 'Stream running' });
                clearReconnectTimer();

                streamRequest = transferProtocol.request(options, continueWithStream);
                const activeStreamRequest = streamRequest;
                reconnectDelayMs = 2000;

                if (node.streamTimeoutMs > 0) {
                    streamRequest.setTimeout(node.streamTimeoutMs, () => {
                        if (node.debug) {
                            const minutes = node.streamtimeout;
                            RED.log.error(`Hikvision-config: Connection timeout after ${minutes} minute${minutes === 1 ? '' : 's'}`);
                        }
                        try {
                            stopStream();
                        } catch (error) {
                        }
                        scheduleReconnect("request timeout");
                    });
                }

                streamRequest.on('error', (err) => {
                    if (intentionallyClosedRequests.has(activeStreamRequest)) return;
                    if (node.debug) RED.log.error('Hikvision-config: Stream error: ' + err.message);
                    try {
                        stopStream();
                    } catch (error) {
                    }
                    scheduleReconnect("request error: " + (err.message || "unknown"));
                });

                streamRequest.on('close', () => {
                    if (node.isClosing || intentionallyClosedRequests.has(activeStreamRequest)) return;
                    scheduleReconnect("request closed");
                });

                streamRequest.end();
            } catch (err) {
                if (node.debug) RED.log.error('Hikvision-config: continueWithAuthenticatedRequest: Stream error: ' + err.message);
                scheduleReconnect("request setup exception");
            }

        }

        // Function to handle the response stream
        function continueWithStream(res) {

            controller = new globalThis.AbortController(); // For aborting the stream request


            try {

                if (res.statusCode >= 200 && res.statusCode <= 300) {
                    node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Waiting for event." });
                } else {
                    node.setAllClientsStatus({ fill: "red", shape: "ring", text: res.statusMessage + ' ' + res.statusCode });
                    //  if (node.debug)  RED.log.error("BANANA Error response " + response.statusMessage + ' ' + response.statusCode);
                    node.errorDescription = "StatusResponse problem " + res.statusMessage + ' ' + res.statusCode;
                    stopStream();
                    throw new Error("StatusResponse " + res.statusMessage + ' ' + res.statusCode);
                }

                if (!node.isConnected) {
                    node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Connected." });
                    node.nodeClients.forEach(oClient => {
                        oClient.sendPayload({ topic: oClient.topic || "", errorDescription: "", payload: false });
                    })
                    node.errorDescription = ""; // Reset the error
                }
                node.isConnected = true;
                reconnectDelayMs = 2000;
                node.resetHeartBeatTimer();
                try {
                    const contentType = res.headers['content-type'];
                    if (!contentType) {
                        if (node.debug) RED.log.error("Hikvision-config: No Content-Type in response");
                        stopStream();
                        scheduleReconnect("missing content-type");
                        return;
                    }
                    if (contentType.includes('multipart')) {
                        let boundary = extractBoundary(contentType);
                        if (!boundary) {
                            if (node.debug) RED.log.error("Hikvision-config: Failed to extract boundary from multipart stream");
                            boundary = "boundary"
                        }

                        // Inizializza Dicer per il parsing del multipart
                        const dicer = new Dicer({ boundary });

                        dicer.on('part', (part) => {
                            let partData = [];
                            let extension = 'bin';  // Default estensione per parti non riconosciute

                            part.on('header', (header) => {
                                try {
                                    //console.log('Part headers:', header);
                                    node.resetHeartBeatTimer();
                                    // Verifica il tipo di parte
                                    if (header['content-type'] && (header['content-type'][0].includes('image/jpeg') || header['content-type'][0].includes('image/jpg'))) {
                                        extension = 'jpg';  // Estensione corretta per immagini JPEG
                                    } else if (header['content-type'] && header['content-type'][0].includes('image/png')) {
                                        extension = 'png';  // Estensione corretta per immagini PNG
                                    } else if (header['content-type'] && header['content-type'][0].includes('application/xml')) {
                                        extension = 'xml';  // Estensione corretta per immagini PNG
                                    } else if (header['content-type'] && header['content-type'][0].includes('application/json')) {
                                        extension = 'json';  // Estensione corretta per immagini PNG
                                    }
                                } catch (error) {
                                    if (node.debug) RED.log.error("Hikvision-config: part header parse error: " + (error.message || " unknown error"));
                                }
                            });

                            part.on('data', (data) => {
                                try {
                                    node.resetHeartBeatTimer();
                                    partData.push(data);  // Aggiungi i chunk di dati alla parte
                                } catch (error) {
                                    if (node.debug) RED.log.error("Hikvision-config: part data handling error: " + (error.message || " unknown error"));
                                }
                            });

                            part.on('end', () => {
                                try {
                                    node.resetHeartBeatTimer();
                                    const fullData = Buffer.concat(partData);  // Unisci i chunk di dati
                                    switch (extension) {
                                        case 'xml':
                                            handleXML(fullData);
                                            break;
                                        case 'json':
                                            handleJSON(fullData);
                                            break;
                                        case 'png':
                                        case 'jpg':
                                            //const filename = generateFilename(extension);
                                            //saveFile(fullData, filename);  // Salva l'immagine su disco
                                            handleIMG(fullData, extension);
                                            break;
                                        default:
                                            if (node.debug) RED.log.warn("Hikvision-config: unsupported multipart part content type");
                                            break;
                                    }
                                } catch (error) {
                                    if (node.debug) RED.log.error("Hikvision-config: part end handling error: " + (error.message || " unknown error"));
                                }
                            });
                            part.on('error', (err) => {
                                if (node.debug) RED.log.error("Hikvision-config: Error in multipart part: " + (err.message || " unknown error"));
                            });

                        });

                        dicer.on('finish', () => {
                            //console.log('Finished parsing multipart stream.');
                        });

                        dicer.on('error', (err) => {
                            if (node.debug) RED.log.error("Hikvision-config: Error in Dicer:" + err.stack);
                            scheduleReconnect("multipart parser error");
                        });

                        const onRawData = () => {
                            try {
                                node.resetHeartBeatTimer();
                            } catch (error) {
                            }
                        };
                        const cleanupRawDataListener = () => {
                            res.removeListener('data', onRawData);
                        };
                        res.on('data', onRawData);
                        res.once('end', cleanupRawDataListener);
                        res.once('close', cleanupRawDataListener);
                        res.once('error', cleanupRawDataListener);
                        res.once('end', () => {
                            if (node.isClosing) return;
                            if (node.debug) RED.log.warn("Hikvision-config: stream response ended, reconnecting");
                            stopStream();
                            scheduleReconnect("response ended");
                        });
                        res.once('close', () => {
                            if (node.isClosing) return;
                            if (node.debug) RED.log.warn("Hikvision-config: stream response closed, reconnecting");
                            stopStream();
                            scheduleReconnect("response closed");
                        });
                        res.once('error', (err) => {
                            if (node.isClosing) return;
                            if (node.debug) RED.log.error("Hikvision-config: stream response error: " + (err.message || " unknown error"));
                            stopStream();
                            scheduleReconnect("response error");
                        });

                        // Pipa lo stream multipart in Dicer
                        res.pipe(dicer);

                    } else {
                        node.errorDescription = "Unsupported Content-Type: " + contentType;
                        if (node.debug) RED.log.error("Hikvision-config: Unsupported Content-Type " + contentType);
                        stopStream();
                        scheduleReconnect("unsupported content-type");
                    }

                } catch (error) {
                    if (node.debug) RED.log.error("Hikvision-config: streamPipeline: Please be sure to have the latest Node.JS version installed: " + (error.message || " unknown error"));
                    stopStream();
                    scheduleReconnect("stream pipeline exception");
                }

            } catch (error) {
                // Main Error
                // Abort request
                //node.errorDescription = "Fetch error " + JSON.stringify(error, Object.getOwnPropertyNames(error));
                node.errorDescription = "Request error " + (error.message || " unknown error");
                if (node.debug) RED.log.error("Hikvision-config: REQUEST ERROR: " + (error.message || " unknown error"));
                scheduleReconnect("response handling error");
            };

            // ++++++++++++++++++++++++++++++++++++++++++++++++++
        }
        // Function to stop the stream
        function stopStream() {
            try {
                if (streamRequest) {
                    const requestToStop = streamRequest;
                    intentionallyClosedRequests.add(requestToStop);
                    // Keep an error listener attached while destroying the request.
                    // Node 24 can still emit ECONNRESET/socket hang up during TLS teardown.
                    requestToStop.on('error', () => { });
                    requestToStop.destroy();
                    streamRequest = null;
                }
            } catch (err) {
                if (node.debug) RED.log.error("Hikvision-config: stopStream error " + (err.message || " unknown error"));
            }
        }

        // ------------------------------------------------

        async function startAlarmStream() {

            if (node.isClosing) return;
            if (node.debug) RED.log.info("Hikvision-config: opening alert stream for " + (node.name || node.host) + " using " + node.authentication);
            stopStream();
            clearReconnectTimer();

            node.resetHeartBeatTimer(); // First thing, start the heartbeat timer.
            node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Connecting..." });

            // Make an initial request to get authentication challenge
            if (node.protocol === "http") transferProtocol = require('http');
            if (node.protocol === "https") transferProtocol = require('https');
            // Reuse one socket for the digest 401 challenge and the authenticated stream, like curl does.
            const transferProtocolAgent = new transferProtocol.Agent({
                rejectUnauthorized: false,
                keepAlive: true,
                maxSockets: 1
            });
            const streamHeaders = {
                "Accept": "*/*",
                "Cache-Control": "no-cache",
                "User-Agent": "node-red-contrib-hikvision-ultimate"
            };

            if (node.authentication === 'basic') {
                const options = {
                    hostname: node.host,
                    port: node.port,
                    path: '/ISAPI/Event/notification/alertStream',
                    method: 'GET',
                    headers: {
                        ...streamHeaders,
                        'Authorization': 'Basic ' + Buffer.from(`${node.credentials.user}:${node.credentials.password}`).toString('base64')
                    },
                    protocol: node.protocol + ":",
                    agent: transferProtocolAgent
                };
                continueWithAuthenticatedRequest(options);
                return;
            }

            // Digest authentication logic
            const initialOptions = {
                hostname: node.host,
                port: node.port,
                path: '/ISAPI/Event/notification/alertStream',
                method: 'GET',
                headers: streamHeaders,
                agent: transferProtocolAgent,
                protocol: node.protocol + ":"
            };

            try {
                const initialReq = transferProtocol.request(initialOptions, (response) => {
                    // Handle 401 response with WWW-Authenticate header
                    if (response.statusCode === 401) {
                        // Extract authenticate header
                        const authHeader = response.headers['www-authenticate'];
                        if (!authHeader) {
                            if (node.debug) RED.log.error('Hikvision-config: Missing WWW-Authenticate header in response');
                            response.resume();
                            scheduleReconnect("missing digest challenge");
                            return;
                        }
                        if (!authHeader.startsWith('Digest ')) {
                            if (node.debug) RED.log.error('Hikvision-config: Server does not support Digest authentication');
                            response.resume();
                            scheduleReconnect("digest not supported by server");
                            return;
                        }

                        // Parse the challenge
                        const challenge = parseDigestHeader(authHeader);
                        const qop = pickDigestQop(challenge.qop);
                        const algorithm = (challenge.algorithm || 'MD5').toUpperCase();
                        const nonceCount = NONCE_COUNT;

                        // Create digest authentication header
                        const ha1 = crypto.createHash('md5').update(`${node.credentials.user}:${challenge.realm}:${node.credentials.password}`).digest('hex');
                        const ha2 = crypto.createHash('md5').update(`${'GET'}:${'/ISAPI/Event/notification/alertStream'}`).digest('hex');
                        const cnonce = crypto.randomBytes(8).toString('hex');

                        let digestInput = `${ha1}:${challenge.nonce}:${ha2}`;
                        if (qop) digestInput = `${ha1}:${challenge.nonce}:${nonceCount}:${cnonce}:${qop}:${ha2}`;
                        const digestResponse = crypto.createHash('md5').update(digestInput).digest('hex');

                        const authParts = [
                            `username="${node.credentials.user}"`,
                            `realm="${challenge.realm || ''}"`,
                            `nonce="${challenge.nonce || ''}"`,
                            `uri="${'/ISAPI/Event/notification/alertStream'}"`,
                            `response="${digestResponse}"`,
                            `algorithm="${algorithm}"`
                        ];
                        if (challenge.opaque) authParts.push(`opaque="${challenge.opaque}"`);
                        if (qop) {
                            authParts.push(`qop=${qop}`);
                            authParts.push(`nc=${nonceCount}`);
                            authParts.push(`cnonce="${cnonce}"`);
                        }
                        const authString = `Digest ${authParts.join(', ')}`;

                        // Now make the authenticated request
                        const options = {
                            hostname: node.host,
                            port: node.port,
                            path: '/ISAPI/Event/notification/alertStream',
                            method: 'GET',
                            headers: {
                                ...streamHeaders,
                                'Authorization': authString
                            },
                            agent: transferProtocolAgent,
                            protocol: node.protocol + ":"
                        };

                        response.once('end', () => {
                            continueWithAuthenticatedRequest(options);
                        });
                        response.once('error', (err) => {
                            if (node.debug) RED.log.error('Hikvision-config: Initial digest response error: ' + (err.message || " unknown error"));
                            scheduleReconnect("initial digest response error");
                        });
                        // Drain the 401 body before opening the authenticated long-lived stream, mirroring curl's digest flow.
                        response.resume();
                    } else {
                        // If no auth needed (unlikely but possible)
                        continueWithStream(response);
                    }
                });
                streamRequest = initialReq;

                initialReq.on('error', (err) => {
                    if (node.isClosing || intentionallyClosedRequests.has(initialReq)) return;
                    if (node.debug) RED.log.error('Hikvision-config: Initial request error: ' + err.message);
                    scheduleReconnect("initial request error: " + (err.message || "unknown"));
                });
                initialReq.setTimeout(15000, () => {
                    if (node.debug) RED.log.error('Hikvision-config: Initial request timeout');
                    stopStream();
                    scheduleReconnect("initial request timeout");
                });

                initialReq.end();
            } catch (error) {
                if (node.debug) RED.log.error('Hikvision-config: StartAlarmStream: ' + (error.message || " unknown error"));
                scheduleReconnect("start stream exception");
            }
        };

        //#region "HANDLE STREAM MESSAGE"
        // Handle the complete stream message
        // ###################################
        async function handleIMG(result, extension) {
            try {
                if (node.debug) RED.log.info("Hikvision-config: image part received (" + result.length + " bytes, " + extension + ")");
                node.nodeClients.forEach(oClient => {
                    oClient.sendPayload({ topic: oClient.topic || "", payload: result, type: 'img', extension: extension });
                });
            } catch (error) {
                if (node.debug) RED.log.error("Hikvision-config: image part handling error: " + (error.message || " unknown error"));
            }
        }
        async function handleXML(result) {
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

                const parseEventDateMs = (eventEntry) => {
                    if (!eventEntry || typeof eventEntry !== "object") return null;
                    if (!eventEntry.dateTime) return null;
                    const parsed = Date.parse(eventEntry.dateTime.toString());
                    return Number.isFinite(parsed) ? parsed : null;
                };

                const parser = new XMLParser();
                const parsedXML = parser.parse(result);

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

                const normalizedEvents = [];
                eventsToForward.forEach((eventEntry) => {
                    if (eventEntry.channelID === undefined && eventEntry.dynChannelID !== undefined) {
                        // API Version 1.0
                        eventEntry.channelID = eventEntry.dynChannelID;
                    }
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

                let eventsAfterStaleFilter = normalizedEvents;
                let droppedStaleEvents = 0;
                let droppedOverflowEvents = 0;

                if (normalizedEvents.length > 1) {
                    const nowMs = Date.now();
                    let newestEventMs = null;
                    normalizedEvents.forEach((eventEntry) => {
                        const eventMs = parseEventDateMs(eventEntry);
                        if (eventMs !== null && (newestEventMs === null || eventMs > newestEventMs)) newestEventMs = eventMs;
                    });

                    eventsAfterStaleFilter = normalizedEvents.filter((eventEntry) => {
                        const eventMs = parseEventDateMs(eventEntry);
                        if (eventMs === null) return true;
                        if (nowMs >= eventMs && (nowMs - eventMs) > MAX_ABSOLUTE_EVENT_AGE_MS) {
                            droppedStaleEvents += 1;
                            return false;
                        }
                        if (newestEventMs !== null && (newestEventMs - eventMs) > MAX_RELATIVE_BATCH_EVENT_AGE_MS) {
                            droppedStaleEvents += 1;
                            return false;
                        }
                        return true;
                    });
                }

                if (eventsAfterStaleFilter.length > MAX_FORWARD_EVENTS_PER_BATCH) {
                    droppedOverflowEvents = eventsAfterStaleFilter.length - MAX_FORWARD_EVENTS_PER_BATCH;
                    eventsAfterStaleFilter = eventsAfterStaleFilter.slice(-MAX_FORWARD_EVENTS_PER_BATCH);
                }

                if (node.debug && normalizedEvents.length > 1) {
                    RED.log.warn("Hikvision-config: XML batch with " + normalizedEvents.length + " events received");
                    if (droppedStaleEvents > 0) RED.log.warn("Hikvision-config: dropped " + droppedStaleEvents + " stale event(s) from recovered batch");
                    if (droppedOverflowEvents > 0) RED.log.warn("Hikvision-config: dropped " + droppedOverflowEvents + " overflow event(s) from recovered batch");
                    RED.log.warn("Hikvision-config: forwarding " + eventsAfterStaleFilter.length + " event(s) after stale/batch filtering");
                }

                eventsAfterStaleFilter.forEach((eventEntry) => {
                    node.nodeClients.forEach(oClient => {
                        oClient.sendPayload({ topic: oClient.topic || "", payload: eventEntry, type: 'event' });
                    });
                });
            } catch (error) {
                if (node.debug) RED.log.error("Hikvision-config: XML parse/handling error: " + (error.message || " unknown error"));
            }
        }
        async function handleJSON(result) {
            try {
                const oJSON = JSON.parse(result);
                if (oJSON !== null && oJSON !== undefined) {
                    node.nodeClients.forEach(oClient => {
                        oClient.sendPayload({ topic: oClient.topic || "", payload: oJSON, type: 'event' });
                    })
                }
            } catch (error) {
                if (node.debug) RED.log.error("BANANA ERRORE fast-xml-parser(sRet, function (err, result) " + error.message || "");
            }
        }
        // ###################################
        //#endregion

        setTimeout(() => {
            if (node.isClosing) return;
            try {
                startAlarmStream();
            } catch (error) {
            }
        }, 10000); // First connection.
        //#endregion

        //#region GENERIC GET OT PUT CALL
        // Function to get or post generic data on camera
        node.request = async function (_callerNode, _method, _URL, _body, _fromXMLNode) {
            if (_fromXMLNode === undefined) _fromXMLNode = false; // 07/10/2021 Does the request come from an XML node?
            var clientGenericRequest;
            const authMode = (node.authentication || "digest").toLowerCase();
            clientGenericRequest = createHttpClient({
                username: node.credentials.user,
                password: node.credentials.password,
                authentication: authMode === "basic" ? "basic" : "digest",
                logger: node.debug ? RED.log : undefined
            });

            var reqController = new globalThis.AbortController(); // For aborting the stream request
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

                const response = await clientGenericRequest.fetch(node.protocol + "://" + node.host + _URL, options);

                if (response.status >= 200 && response.status < 300) {
                    //node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Connected." });
                } else {
                    // _callerNode.setNodeStatus({ fill: "red", shape: "ring", text: response.statusMessage + ' ' + response.statusCode || " unknown response code" });
                    // // 07/04/2021 Wrong URL? Send this and is captured by picture node to try another url
                    //  _callerNode.sendPayload({ topic: _callerNode.topic || "", payload: false, wrongResponse: response.status });
                    // throw new Error("Error response: " + response.statusMessage + ' ' + response.statusCode || " unknown response code");
                }

                if (response.ok) {
                    var body = "";

                    // 07/10/2021 If the request comes from XML node, return any response
                    if (_fromXMLNode) {
                        body = await response.buffer(); // "data:image/png;base64," +    
                        //_callerNode.sendPayload({ topic: _callerNode.topic || "", payload:  body.toString("base64")});
                        const parser = new XMLParser();
                        try {
                            let result = parser.parse(body.toString());
                            _callerNode.sendPayload({ topic: _callerNode.name || "", payload: result });
                        } catch (error) {
                            _callerNode.sendPayload({ topic: _callerNode.name || "", payload: body.toString() });
                        }
                    } else if (_URL.toLowerCase().includes("/ptzctrl/")) {// Based on URL, will return the appropriate encoded body
                        _callerNode.sendPayload({ topic: _callerNode.topic || "", payload: true });
                    } else if (_URL.toLowerCase().includes("/streaming")) {
                        body = await response.buffer(); // "data:image/png;base64," +    
                        //_callerNode.sendPayload({ topic: _callerNode.topic || "", payload:  body.toString("base64")});
                        _callerNode.sendPayload({ topic: _callerNode.topic || "", payload: body });
                    }
                } else {
                    if (_fromXMLNode) {
                        // 07/10/2021 If the request comes from XML node, return any response
                        _callerNode.sendPayload({ topic: _callerNode.name || "", wrongResponse: response.status });
                    } else if (_URL.toLowerCase().includes("/ptzctrl/")) {

                    } else if (_URL.toLowerCase().includes("/streaming/") || _URL.toLowerCase().includes("/streamingproxy/")) {
                        _callerNode.setNodeStatus({ fill: "red", shape: "ring", text: response.statusMessage + ' ' + response.statusCode || " unknown response code" });
                        // 07/04/2021 Wrong URL? Send this and is captured by picture node to try another url
                        _callerNode.sendPayload({ topic: _callerNode.topic || "", payload: false, wrongResponse: response.status });
                    } else {
                        _callerNode.setNodeStatus({ fill: "red", shape: "ring", text: response.statusMessage + ' ' + response.statusCode || " unknown response code" });
                    }
                    throw new Error("Error response: " + response.statusMessage + ' ' + response.statusCode || " unknown response code");

                }

            } catch (err) {
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
            }
        };
        //#endregion




        //#region "FUNCTIONS"
        node.on('close', function (removed, done) {
            node.isClosing = true;
            clearReconnectTimer();
            stopStream();
            if (controller !== null) {
                try {
                    controller.abort();
                } catch (error) { }
            }
            if (node.timerCheckHeartBeat !== null) clearTimeout(node.timerCheckHeartBeat);
            setTimeout(() => {
                done();
            }, 2000);

        });


        node.addClient = (_Node) => {
            // Check if node already exists
            if (node.nodeClients.filter(x => x.id === _Node.id).length === 0) {
                // Add _Node to the clients array
                node.nodeClients.push(_Node)
            }
            if (node.debug) RED.log.info("Hikvision-config: registered client " + (_Node.type || _Node.id || "unknown") + " (" + node.nodeClients.length + " total)");
            try {
                _Node.setNodeStatus({ fill: "grey", shape: "ring", text: "Waiting for connection" });
            } catch (error) { }
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
