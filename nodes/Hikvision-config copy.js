

module.exports = (RED) => {
    const { createHttpClient } = require('./utils/httpClient');


    const STREAM_TIMEOUT = 30000; // 30 seconds
    const NONCE_COUNT = '00000001';

    const { XMLParser } = require("fast-xml-parser");
    const https = require('https');
    const http = require('http');
    const Dicer = require('dicer');
    const crypto = require('crypto');
    let transferProtocol; // can be http or https class
    let stream;

    // Helper function to parse the WWW-Authenticate header
    function parseDigestHeader(header) {
        const challenge = {};
        const parts = header.substring(7).split(',');

        for (const part of parts) {
            const [key, value] = part.trim().split('=');
            challenge[key] = value?.replace(/"/g, '') || '';
        }

        return challenge;
    }

    function Hikvisionconfig(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.port = config.port || 80;
        node.debug = (config.debuglevel === undefined || config.debuglevel === "no") ? false : true;
        node.host = config.host;// + ":" + node.port;
        node.protocol = config.protocol || "http";
        node.nodeClients = []; // Stores the registered clients
        node.isConnected = true; // Assumes, that is already connected.
        node.timerCheckHeartBeat = null;
        node.errorDescription = ""; // Contains the error description in case of connection error.
        node.authentication = config.authentication || "digest";
        node.deviceinfo = config.deviceinfo || {};
        node.heartBeatTimerDisconnectionCounter = 0;
        node.heartbeattimerdisconnectionlimit = config.heartbeattimerdisconnectionlimit || 2;
        var controller = null; // AbortController
        node.onLineHikvisionDevicesDiscoverList = null; // 12/01/2023 holds the online devices, used in the HTML

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
            // Reset node.timerCheckHeartBeat
            if (node.timerCheckHeartBeat !== null) clearTimeout(node.timerCheckHeartBeat);
            node.timerCheckHeartBeat = setTimeout(() => {
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
            const match = contentType.match(/boundary=(.*)$/);
            return match ? match[1] : null;
        }

        // Function to continue with authenticated request
        function continueWithAuthenticatedRequest(options) {
            if (node.debug) RED.log.debug('Hikvision-config: Starting authenticated stream...');
            try {
                node.setAllClientsStatus({ fill: 'green', shape: 'dot', text: 'Stream running' });

                stream = transferProtocol.request(options, continueWithStream);

                stream.setTimeout(STREAM_TIMEOUT, () => {
                    if (node.debug) RED.log.error('Hikvision-config: Connection timeout after 30 seconds');
                    try {
                        stopStream();
                    } catch (error) {
                    }

                });

                stream.on('error', (err) => {
                    if (node.debug) RED.log.error('Hikvision-config: Stream error: ' + err.message);
                    try {
                        stopStream();
                    } catch (error) {
                    }
                });

                stream.on('close', () => {

                });

                stream.end();
            } catch (err) {
                if (node.debug) RED.log.error('Hikvision-config: continueWithAuthenticatedRequest: Stream error: ' + err.message);
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
                node.resetHeartBeatTimer();
                try {
                    const contentType = res.headers['content-type'];
                    if (!contentType) {
                        if (node.debug) RED.log.error("Hikvision-config: No Content-Type in response");

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
                                }
                            });

                            part.on('data', (data) => {
                                try {
                                    node.resetHeartBeatTimer();
                                    partData.push(data);  // Aggiungi i chunk di dati alla parte
                                } catch (error) {
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
                                        case 'jpg' || 'png':
                                            //const filename = generateFilename(extension);
                                            //saveFile(fullData, filename);  // Salva l'immagine su disco
                                            handleIMG(fullData, extension);
                                            break;
                                        default:
                                            break;
                                    }
                                } catch (error) {
                                }
                            });
                            part.on('error', (err) => {
                                //console.error('Error in part:', err);
                            });

                        });

                        dicer.on('finish', () => {
                            //console.log('Finished parsing multipart stream.');
                        });

                        dicer.on('error', (err) => {
                            if (node.debug) RED.log.error("Hikvision-config: Error in Dicer:" + err.stack);
                        });

                        // Pipa lo stream multipart in Dicer
                        res.pipe(dicer);

                    } else {
                        throw new Error('Unsupported Content-Type');
                    }

                } catch (error) {
                    if (node.debug) RED.log.error("Hikvision-config: streamPipeline: Please be sure to have the latest Node.JS version installed: " + (error.message || " unknown error"));
                }

            } catch (error) {
                // Main Error
                // Abort request
                //node.errorDescription = "Fetch error " + JSON.stringify(error, Object.getOwnPropertyNames(error));
                node.errorDescription = "Request error " + (error.message || " unknown error");
                if (node.debug) RED.log.error("Hikvision-config: REQUEST ERROR: " + (error.message || " unknown error"));
            };

            // ++++++++++++++++++++++++++++++++++++++++++++++++++
        }
        // Function to stop the stream
        function stopStream() {
            try {
                if (stream) {
                    // Remove all listeners to prevent reconnection logic
                    stream.removeAllListeners();
                    stream.destroy();
                    stream = null;
                }
            } catch (err) {
            }
        }

        // ------------------------------------------------

        async function startAlarmStream() {

            node.resetHeartBeatTimer(); // First thing, start the heartbeat timer.
            node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Connecting..." });

            // Make an initial request to get authentication challenge
            if (node.protocol === "http") transferProtocol = require('http');
            if (node.protocol === "https") transferProtocol = require('https');
            // 14/07/2021 custom agent as global variable, to avoid issue with self signed certificates
            const transferProtocolAgent = new transferProtocol.Agent({
                rejectUnauthorized: false,
                keepAlive: true, // Mantiene vive le connessioni
                maxSockets: 10,  // Numero massimo di connessioni simultanee
            });

            if (node.authentication === 'basic') {
                const options = {
                    hostname: node.host,
                    port: node.port,
                    path: '/ISAPI/Event/notification/alertStream',
                    method: 'GET',
                    headers: {
                        'Authorization': 'Basic ' + Buffer.from(`${node.credentials.user}:${node.credentials.password}`).toString('base64')
                    },
                    protocol: node.protocol + ":"
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
                            return;
                        }
                        if (!authHeader.startsWith('Digest ')) {
                            if (node.debug) RED.log.error('Hikvision-config: Server does not support Digest authentication');
                            return;
                        }

                        // Parse the challenge
                        const challenge = parseDigestHeader(authHeader);

                        // Create digest authentication header
                        const ha1 = crypto.createHash('md5').update(`${node.credentials.user}:${challenge.realm}:${node.credentials.password}`).digest('hex');
                        const ha2 = crypto.createHash('md5').update(`${'GET'}:${'/ISAPI/Event/notification/alertStream'}`).digest('hex');
                        const cnonce = crypto.randomBytes(8).toString('hex');

                        const digestResponse = crypto.createHash('md5').update(
                            `${ha1}:${challenge.nonce}:${NONCE_COUNT}:${cnonce}:${challenge.qop}:${ha2}`
                        ).digest('hex');

                        const authString = `Digest username="${node.credentials.user}", realm="${challenge.realm}", ` +
                            `nonce="${challenge.nonce}", uri="${'/ISAPI/Event/notification/alertStream'}", ` +
                            `cnonce="${cnonce}", nc=${NONCE_COUNT}, qop=${challenge.qop}, ` +
                            `response="${digestResponse}", algorithm="${challenge.algorithm || 'MD5'}"`;

                        // Now make the authenticated request
                        const options = {
                            hostname: node.host,
                            port: node.port,
                            path: '/ISAPI/Event/notification/alertStream',
                            method: 'GET',
                            headers: {
                                'Authorization': authString
                            },
                            agent: transferProtocolAgent
                        };

                        // Continue with normal stream setup using the options object
                        continueWithAuthenticatedRequest(options);
                    } else {
                        // If no auth needed (unlikely but possible)
                        continueWithStream(response);
                    }
                });

                initialReq.on('error', (err) => {
                    if (node.debug) RED.log.error('Hikvision-config: Initial request error: ' + err.message);
                });

                initialReq.end();
            } catch (error) {
                if (node.debug) RED.log.error('Hikvision-config: StartAlarmStream: ' + err.message);
            }
        };

        //#region "HANDLE STREAM MESSAGE"
        // Handle the complete stream message
        // ###################################
        async function handleIMG(result, extension) {
            try {
                if (node.debug) RED.log.error("BANANA SBANANATO IMG -> JSON " + JSON.stringify(oXML));
                node.nodeClients.forEach(oClient => {
                    oClient.sendPayload({ topic: oClient.topic || "", payload: result, type: 'img', extension: extension });
                });
            } catch (error) {
                if (node.debug) RED.log.error("BANANA ERRORE fast-xml-parser(sRet, function (err, result) " + error.message || "");
            }
        }
        async function handleXML(result) {
            try {
                const parser = new XMLParser();
                let oXML = parser.parse(result);
                if (oXML.EventNotificationAlert?.channelID === undefined && oXML.EventNotificationAlert?.dynChannelID !== undefined) {
                    // API Version 1.0
                    oXML.EventNotificationAlert.channelID = oXML.EventNotificationAlert?.dynChannelID;
                } else {
                    // API Version 2.0
                }
                if (node.debug) RED.log.info("BANANA SBANANATO XML -> JSON " + JSON.stringify(oXML));
                node.nodeClients.forEach(oClient => {
                    if (oXML !== undefined) oClient.sendPayload({ topic: oClient.topic || "", payload: oXML.EventNotificationAlert, type: 'event' });
                });
            } catch (error) {
                if (node.debug) RED.log.error("BANANA ERRORE fast-xml-parser(sRet, function (err, result) " + error.message || "");
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
