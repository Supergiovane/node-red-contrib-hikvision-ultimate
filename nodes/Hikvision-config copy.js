
module.exports = (RED) => {
    const discoHikvisionDevices = require('./utils/hikDiscovery');
    const DigestFetch = require('digest-fetch'); // 04/6/2022 DO NOT UPGRADE TO NODE-FETCH V3, BECAUSE DIGEST-FETCH DOESN'T SUPPORT IT
    const { XMLParser } = require("fast-xml-parser");

    const readableStr = require('stream').Readable;
    const https = require('https');
    const http = require('http');
    const Dicer = require('dicer');


    function Hikvisionconfig(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.port = config.port || 80;
        node.debug = (config.debuglevel === undefined || config.debuglevel === "no") ? false : true;
        node.host = config.host + ":" + node.port;
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
        var oReadable = new readableStr();
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

            if (jParams.password === "__PWRD__") {
                // The password isn't changed or (the server node was already present, it's only updated)
                _nodeServer = RED.nodes.getNode(req.query.nodeID);// Retrieve node.id of the config node.
                if (jParams.authentication === "digest") clientInfo = new DigestFetch(jParams.user, _nodeServer.credentials.password); // Instantiate the fetch client.
                if (jParams.authentication === "basic") clientInfo = new DigestFetch(jParams.user, _nodeServer.credentials.password, { basic: true }); // Instantiate the fetch client.
            } else {
                // The node is NEW
                if (jParams.authentication === "digest") clientInfo = new DigestFetch(jParams.user, jParams.password); // Instantiate the fetch client.
                if (jParams.authentication === "basic") clientInfo = new DigestFetch(jParams.user, jParams.password, { basic: true }); // Instantiate the fetch client.
            }


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
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: jParams.protocol === "https" ? customHttpsAgent : customHttpAgent        // http(s).Agent instance or function that returns an instance (see below)
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
                    startAlarmStream()
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
                    setTimeout(startAlarmStream, 2000); // Reconnect
                }
            }, 40000);
        }

        //#region ALARMSTREAM
        // Funzione per estrarre il boundary dal Content-Type
        function extractBoundary(contentType) {
            const match = contentType.match(/boundary=(.*)$/);
            return match ? match[1] : null;
        }
        var clientAlarmStream;
        async function startAlarmStream() {

            node.resetHeartBeatTimer(); // First thing, start the heartbeat timer.
            node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Connecting..." });

            if (node.authentication === "digest") clientAlarmStream = new DigestFetch(node.credentials.user, node.credentials.password); // Instantiate the fetch client.
            if (node.authentication === "basic") clientAlarmStream = new DigestFetch(node.credentials.user, node.credentials.password, { basic: true }); // Instantiate the fetch client.

            controller = new globalThis.AbortController(); // For aborting the stream request
            var optionsAlarmStream = {
                // These properties are part of the Fetch Standard
                method: 'GET',
                headers: {},        // request headers. format is the identical to that accepted by the Headers constructor (see below)
                body: null,         // request body. can be null, a string, a Buffer, a Blob, or a Node.js Readable stream
                redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                signal: controller.signal,       // pass an instance of AbortSignal to optionally abort requests

                // The following properties are node-fetch extensions
                follow: 20,         // maximum redirect count. 0 to not follow redirect
                timeout: 15000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: node.protocol === "https" ? customHttpsAgent : customHttpAgent

            };

            try {

                const res = await clientAlarmStream.fetch(node.protocol + "://" + node.host + "/ISAPI/Event/notification/alertStream", optionsAlarmStream);

                if (res.status >= 200 && res.status <= 300) {
                    node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Waiting for event." });
                } else {
                    node.setAllClientsStatus({ fill: "red", shape: "ring", text: res.statusText || " unknown response code" });
                    //  if (node.debug)  RED.log.error("BANANA Error response " + response.statusText);
                    node.errorDescription = "StatusResponse problem " + (res.statusText || " unknown status response code");
                    throw new Error("StatusResponse " + (res.statusText || " unknown response code"));
                }
                if (res.ok) {
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
                        const contentType = res.headers.get('content-type');
                        if (!contentType) {
                            if (node.debug) RED.log.error("Hikvision-config: No Content-Type in response");

                        }
                        if (contentType.includes('multipart')) {
                            const boundary = extractBoundary(contentType);
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
                                console.error('Error in Dicer:', err);
                            });

                            // Pipa lo stream multipart in Dicer
                            res.body.pipe(dicer);

                        } else {
                            //throw new Error('Unsupported Content-Type');
                        }

                    } catch (error) {
                        if (node.debug) RED.log.error("Hikvision-config: streamPipeline: Please be sure to have the latest Node.JS version installed: " + (error.message || " unknown error"));
                    }

                }

            } catch (error) {
                // Main Error
                // Abort request
                //node.errorDescription = "Fetch error " + JSON.stringify(error, Object.getOwnPropertyNames(error));
                node.errorDescription = "Fetch error " + (error.message || " unknown error");
                if (node.debug) RED.log.error("Hikvision-config: FETCH ERROR: " + (error.message || " unknown error"));
            };

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
                const oXML = parser.parse(result);
                if (node.debug) RED.log.error("BANANA SBANANATO XML -> JSON " + JSON.stringify(oXML));
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

        setTimeout(startAlarmStream, 10000); // First connection.
        //#endregion

        //#region GENERIC GET OT PUT CALL
        // Function to get or post generic data on camera
        node.request = async function (_callerNode, _method, _URL, _body, _fromXMLNode) {
            if (_fromXMLNode === undefined) _fromXMLNode = false; // 07/10/2021 Does the request come from an XML node?
            var clientGenericRequest;
            if (node.authentication === "digest") clientGenericRequest = new DigestFetch(node.credentials.user, node.credentials.password); // Instantiate the fetch client.
            if (node.authentication === "basic") clientGenericRequest = new DigestFetch(node.credentials.user, node.credentials.password, { basic: true }); // Instantiate the fetch client.

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
                agent: node.protocol === "https" ? customHttpsAgent : customHttpAgent         // http(s).Agent instance or function that returns an instance (see below)
            };

            try {
                if (!_URL.startsWith("/")) _URL = "/" + _URL;

                // 07/10/2021 Strip the body in case of GET and HEAD (otherwise, Fetch thwors an error)
                if (options.method.toString().toUpperCase() === "GET" || options.method.toString().toUpperCase() === "HEAD") delete (options.body)

                const response = await clientGenericRequest.fetch(node.protocol + "://" + node.host + _URL, options);

                if (response.status >= 200 && response.status < 300) {
                    //node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Connected." });
                } else {
                    // _callerNode.setNodeStatus({ fill: "red", shape: "ring", text: response.statusText || " unknown response code" });
                    // // 07/04/2021 Wrong URL? Send this and is captured by picture node to try another url
                    //  _callerNode.sendPayload({ topic: _callerNode.topic || "", payload: false, wrongResponse: response.status });
                    // throw new Error("Error response: " + response.statusText || " unknown response code");
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
                        _callerNode.setNodeStatus({ fill: "red", shape: "ring", text: response.statusText || " unknown response code" });
                        // 07/04/2021 Wrong URL? Send this and is captured by picture node to try another url
                        _callerNode.sendPayload({ topic: _callerNode.topic || "", payload: false, wrongResponse: response.status });
                    } else {
                        _callerNode.setNodeStatus({ fill: "red", shape: "ring", text: response.statusText || " unknown response code" });
                    }
                    throw new Error("Error response: " + response.statusText || " unknown response code");

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
