
module.exports = (RED) => {

    const DigestFetch = require('digest-fetch')
    // const AbortController = require('abort-controller');
    const { XMLParser } = require("fast-xml-parser");
    const readableStr = require('stream').Readable;
    const https = require('https');

    function Speakerconfig(config) {
        RED.nodes.createNode(this, config)
        var node = this;
        node.port = config.port || 80;
        node.debug = config.host.toString().toLowerCase().indexOf("banana") > -1;
        node.host = config.host.toString().toLowerCase().replace("banana", "") + ":" + node.port;
        node.protocol = config.protocol || "http";
        node.nodeClients = []; // Stores the registered clients
        node.isConnected = true; // Assumes, that is already connected.
        node.errorDescription = ""; // Contains the error description in case of connection error.
        node.authentication = config.authentication || "digest";
        node.deviceinfo = config.deviceinfo || {};
        var oReadable = new readableStr();
        var controller = null; // AbortController

        node.setAllClientsStatus = ({ fill, shape, text }) => {
            function nextStatus(oClient) {
                oClient.setNodeStatus({ fill: fill, shape: shape, text: text })
            }
            node.nodeClients.map(nextStatus);
        }
        // 14/07/2021 custom agent as global variable, to avoid issue with self signed certificates
        const customHttpsAgent = new https.Agent({
            rejectUnauthorized: false
        });

        // 14/12/2020 Get the infos from the Speaker
        RED.httpAdmin.get("/hikvisionUltimateGetInfoSpeaker", RED.auth.needsPermission('Speakerconfig.read'), function (req, res) {
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
                timeout: 5000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: jParams.protocol === "https" ? customHttpsAgent : null        // http(s).Agent instance or function that returns an instance (see below)
            };
            try {
                (async () => {
                    try {
                        const resInfo = await clientInfo.fetch(jParams.protocol + "://" + jParams.host + ":" + jParams.port + "/ISAPI/System/deviceInfo", opt);
                        const body = await resInfo.text();
                        const parser = new XMLParser();
                        let result = parser.parse(body);
                        res.json(result);
                        return;
                    } catch (error) {
                        RED.log.error("Errore  hikvisionUltimateGetInfoCam " + error.message);
                        res.json(error);
                    }

                })();

            } catch (err) {
                res.json(err);
            }
        });

        // 17/94/2024 Get the files
        RED.httpAdmin.get("/hikvisionUltimateGetSpeakerFiles", RED.auth.needsPermission('Speakerconfig.read'), function (req, res) {
            var jParams = RED.nodes.getNode(req.query.nodeID);// Retrieve node.id of the config node.
            var _nodeServer = null;
            var clientInfo;

            if (jParams.credentials.password === "__PWRD__") {
                // The password isn't changed or (the server node was already present, it's only updated)
                _nodeServer = RED.nodes.getNode(req.query.nodeID);// Retrieve node.id of the config node.
                if (jParams.authentication === "digest") clientInfo = new DigestFetch(jParams.credentials.user, _nodeServer.credentials.password); // Instantiate the fetch client.
                if (jParams.authentication === "basic") clientInfo = new DigestFetch(jParams.credentials.user, _nodeServer.credentials.password, { basic: true }); // Instantiate the fetch client.
            } else {
                // The node is NEW
                if (jParams.authentication === "digest") clientInfo = new DigestFetch(jParams.credentials.user, jParams.credentials.password); // Instantiate the fetch client.
                if (jParams.authentication === "basic") clientInfo = new DigestFetch(jParams.credentials.user, jParams.credentials.password, { basic: true }); // Instantiate the fetch client.
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
                timeout: 5000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: jParams.protocol === "https" ? customHttpsAgent : null        // http(s).Agent instance or function that returns an instance (see below)
            };
            try {
                (async () => {
                    try {
                        // const resInfo = await clientInfo.fetch(jParams.protocol + "://" + jParams.host + ":" + jParams.port + "/ISAPI/AccessControl/EventCardLinkageCfg/CustomAudio?format=json", opt);
                        const resInfo = await clientInfo.fetch(jParams.protocol + "://" + jParams.host + "/ISAPI/AccessControl/EventCardLinkageCfg/CustomAudio?format=json", opt);
                        const body = await resInfo.json();
                        res.json(body.CustomAudioInfoList);
                        return;
                    } catch (error) {
                        RED.log.error("Errore hikvisionUltimateGetInfoSpeaker " + error.message);
                        res.json(error);
                    }
                })();

            } catch (err) {
                res.json(err);
            }
        });

        // 17/94/2024 Get the files
        RED.httpAdmin.get("/hikvisionUltimateSpeakerTest", RED.auth.needsPermission('Speakerconfig.read'), function (req, res) {
            var jParams = RED.nodes.getNode(req.query.nodeID).server;// Retrieve node.id of the config node.
            let customAudioID = req.query.customAudioID;
            var _nodeServer = null;
            var clientInfo;
            if (jParams.credentials.password === "__PWRD__") {
                // The password isn't changed or (the server node was already present, it's only updated)
                _nodeServer = RED.nodes.getNode(req.query.nodeID);// Retrieve node.id of the config node.
                if (jParams.authentication === "digest") clientInfo = new DigestFetch(jParams.credentials.user, _nodeServer.credentials.password); // Instantiate the fetch client.
                if (jParams.authentication === "basic") clientInfo = new DigestFetch(jParams.credentials.user, _nodeServer.credentials.password, { basic: true }); // Instantiate the fetch client.
            } else {
                // The node is NEW
                if (jParams.authentication === "digest") clientInfo = new DigestFetch(jParams.credentials.user, jParams.credentials.password); // Instantiate the fetch client.
                if (jParams.authentication === "basic") clientInfo = new DigestFetch(jParams.credentials.user, jParams.credentials.password, { basic: true }); // Instantiate the fetch client.
            }


            var opt = {
                // These properties are part of the Fetch Standard
                method: "PUT",
                headers: {},        // request headers. format is the identical to that accepted by the Headers constructor (see below)
                body: null,         // request body. can be null, a string, a Buffer, a Blob, or a Node.js Readable stream
                redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                signal: null,       // pass an instance of AbortSignal to optionally abort requests

                // The following properties are node-fetch extensions
                follow: 20,         // maximum redirect count. 0 to not follow redirect
                timeout: 5000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: jParams.protocol === "https" ? customHttpsAgent : null        // http(s).Agent instance or function that returns an instance (see below)
            };
            try {
                (async () => {
                    try {
                        // const resInfo = await clientInfo.fetch(jParams.protocol + "://" + jParams.host + ":" + jParams.port + "/ISAPI/AccessControl/EventCardLinkageCfg/CustomAudio?format=json", opt);
                        const resInfo = await clientInfo.fetch(jParams.protocol + "://" + jParams.host + "/ISAPI/Event/triggers/notifications/AudioAlarm/AudioOut/1/PlayCustomAudioFile?format=json&customAudioID=" + customAudioID + "&audioVolume=2&loopPlaybackTimes=1", opt);
                        const body = await resInfo.json();
                        res.json({});
                        return;
                    } catch (error) {
                        RED.log.error("Errore hikvisionUltimateGetInfoSpeaker " + error.message);
                        res.json(error);
                    }

                })();

            } catch (err) {
                res.json(err);
            }
        });

        // PLAY THE FILE ALOUD VIA THE SPEAKER
        node.playAloud = async function (_customAudioID, _volume) {
            var jParams = node;
            var clientInfo;

            // Set Auth
            if (jParams.authentication === "digest") clientInfo = new DigestFetch(jParams.credentials.user, jParams.credentials.password); // Instantiate the fetch client.
            if (jParams.authentication === "basic") clientInfo = new DigestFetch(jParams.credentials.user, jParams.credentials.password, { basic: true }); // Instantiate the fetch client.

            var opt = {
                // These properties are part of the Fetch Standard
                method: "PUT",
                headers: {},        // request headers. format is the identical to that accepted by the Headers constructor (see below)
                body: JSON.stringify({ "audioOutID": [1] }),       // request body.
                redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                signal: null,       // pass an instance of AbortSignal to optionally abort requests

                // The following properties are node-fetch extensions
                follow: 20,         // maximum redirect count. 0 to not follow redirect
                timeout: 5000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: jParams.protocol === "https" ? customHttpsAgent : null        // http(s).Agent instance or function that returns an instance (see below)
            };

            try {
                // STOP PLAYING PREVIOUS FILE, IF ANY
                const resInfoStop = await clientInfo.fetch(jParams.protocol + "://" + jParams.host + "/ISAPI/AccessControl/EventCardLinkageCfg/CustomAudio/" + _customAudioID + "/stop?format=json", opt);
                // PLAY THE FILE
                const resInfo = await clientInfo.fetch(jParams.protocol + "://" + jParams.host + "/ISAPI/Event/triggers/notifications/AudioAlarm/AudioOut/1/PlayCustomAudioFile?format=json&customAudioID=" + _customAudioID + "&audioVolume=" + _volume + "&loopPlaybackTimes=1", opt);
                const body = await resInfo.json();
                if (body.statusCode === 1) {
                    return true;
                } else {
                    return false;
                }
            } catch (error) {
                RED.log.error("Errore playAloud Stop " + error.message);
                return false;
            }
        };

        node.stopFile = async function (_customAudioID) {
            var jParams = node;
            var clientInfo;

            // Set Auth
            if (jParams.authentication === "digest") clientInfo = new DigestFetch(jParams.credentials.user, jParams.credentials.password); // Instantiate the fetch client.
            if (jParams.authentication === "basic") clientInfo = new DigestFetch(jParams.credentials.user, jParams.credentials.password, { basic: true }); // Instantiate the fetch client.

            var opt = {
                // These properties are part of the Fetch Standard
                method: "PUT",
                headers: {},        // request headers. format is the identical to that accepted by the Headers constructor (see below)
                body: JSON.stringify({ "audioOutID": [1] }),         // request body.
                redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                signal: null,       // pass an instance of AbortSignal to optionally abort requests

                // The following properties are node-fetch extensions
                follow: 20,         // maximum redirect count. 0 to not follow redirect
                timeout: 5000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: jParams.protocol === "https" ? customHttpsAgent : null        // http(s).Agent instance or function that returns an instance (see below)
            };
            // STOP PLAYING PREVIOUS FILE
            try {
                // const resInfo = await clientInfo.fetch(jParams.protocol + "://" + jParams.host + ":" + jParams.port + "/ISAPI/AccessControl/EventCardLinkageCfg/CustomAudio?format=json", opt);
                const resInfo = await clientInfo.fetch(jParams.protocol + "://" + jParams.host + "/ISAPI/AccessControl/EventCardLinkageCfg/CustomAudio/" + _customAudioID + "/stop?format=json", opt);
                const body = await resInfo.json();
                if (body.statusCode === 1) {
                    return true;
                } else {
                    return false;
                }
            } catch (error) {
                RED.log.error("Errore stopFile Stop " + error.message);
                return false;
            }
        }

        //#region "HANDLE STREAM MESSAGE"
        // Handle the complete stream message, enclosed into the --boundary stream string
        // If there is more boundary, process each one separately
        // ###################################
        async function handleChunk(result) {
            try {
                // 05/12/2020 process the data
                let jSonStatus = JSON.parse(result);
                if (node.debug) RED.log.info("Speaker-config: handleChunk: " + result);
                node.nodeClients.forEach(oClient => {
                    oClient.sendPayload(jSonStatus);
                });
            } catch (error) {
                if (node.debug) RED.log.error("Speaker-config: readStream error: " + (error.message || " unknown error"));
                node.errorDescription = "readStream error " + (error.message || " unknown error");
                throw (error);

            }
        }
        // ###################################
        //#endregion

        //#region CallStatus
        async function queryCallStatus() {

            var clientCallStatus;
            if (node.authentication === "digest") clientCallStatus = new DigestFetch(node.credentials.user, node.credentials.password); // Instantiate the fetch client.
            if (node.authentication === "basic") clientCallStatus = new DigestFetch(node.credentials.user, node.credentials.password, { basic: true }); // Instantiate the fetch client.

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
                timeout: 4000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: node.protocol === "https" ? customHttpsAgent : null

            };
            try {

                const response = await clientCallStatus.fetch(node.protocol + "://" + node.host + "/ISAPI/System/deviceInfo", optionsAlarmStream);
                //const response = await clientCallStatus.fetch(node.protocol + "://" + node.host + "/ISAPI/VideoIntercom/callStatus?format=json", optionsAlarmStream);

                if (response.status >= 200 && response.status <= 300) {
                    node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Connected :-)" });
                } else {
                    node.setAllClientsStatus({ fill: "red", shape: "ring", text: response.statusText || " unknown response code" });
                    //  if (node.debug)  RED.log.error("BANANA Error response " + response.statusText);
                    node.errorDescription = "StatusResponse problem " + (response.statusText || " unknown status response code");
                    throw new Error("StatusResponse " + (response.statusText || " unknown response code"));
                }
                if (response.ok) {
                    if (!node.isConnected) {
                        node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Connected." });
                        node.nodeClients.forEach(oClient => {
                            oClient.sendPayload({ topic: oClient.topic || "", errorDescription: "", payload: false });
                        })
                        node.errorDescription = ""; // Reset the error
                    }
                    node.isConnected = true;
                    try {
                        if (node.debug) RED.log.info("Speaker-config: before Pipelining...");
                        if (oReadable !== null) oReadable.removeAllListeners() // 09/01/2023
                        oReadable = readableStr.from(response.body, { encoding: 'utf8' });
                        oReadable.on('data', async (chunk) => {
                            if (node.debug) RED.log.info("Speaker-config: oReadable.on('data') " + chunk);
                            if (chunk.includes("}")) {
                                try {
                                    await handleChunk(chunk);
                                } catch (error) {
                                    throw (error);
                                }
                            }
                        });
                        oReadable.on('end', function () {
                            if (node.debug) RED.log.info("Speaker-config: queryCallStatus: STREAMING HAS ENDED.");
                            if (node.timerCheckRing !== null) clearTimeout(node.timerCheckRing);
                            node.timerCheckRing = setTimeout(queryCallStatus, 2000);
                        });

                        oReadable.on('error', function (error) {
                            if (node.debug) RED.log.error("Speaker-config: queryCallStatus: " + (error.message || " unknown error"));
                            if (node.timerCheckRing !== null) clearTimeout(node.timerCheckRing);
                            node.timerCheckRing = setTimeout(queryCallStatus, 10000);
                        });

                        //await queryCallStatus(response.body, readStream);
                    } catch (error) {
                        if (node.debug) RED.log.error("Speaker-config: queryCallStatus: " + (error.message || " unknown error"));

                        // Signal disconnection
                        // ######################
                        if (node.isConnected) {
                            if (node.errorDescription === "") node.errorDescription = "queryCallStatus error " + (error.message || " unknown error");
                            node.nodeClients.forEach(oClient => {
                                oClient.sendPayload({ topic: oClient.topic || "", errorDescription: node.errorDescription, payload: true });
                            });
                            node.setAllClientsStatus({ fill: "red", shape: "ring", text: "queryCallStatus error...Retry... " + node.errorDescription });
                            node.isConnected = false;
                        }
                        // ######################

                        if (node.timerCheckRing !== null) clearTimeout(node.timerCheckRing);
                        node.timerCheckRing = setTimeout(queryCallStatus, 10000);
                    }

                }

            } catch (error) {
                // Main Error
                // Abort request
                //node.errorDescription = "Fetch error " + JSON.stringify(error, Object.getOwnPropertyNames(error));
                node.errorDescription = "Fetch error " + (error.message || " unknown error");
                if (node.debug) RED.log.error("Speaker-config: FETCH ERROR: " + (error.message || " unknown error"));


                // Signal disconnection
                // ######################
                if (node.isConnected) {
                    if (node.errorDescription === "") node.errorDescription = "Timeout waiting response " + (error.message || " unknown error"); // In case of timeout 
                    node.nodeClients.forEach(oClient => {
                        oClient.sendPayload({ topic: oClient.topic || "", errorDescription: node.errorDescription, payload: true });
                    });
                    node.setAllClientsStatus({ fill: "red", shape: "ring", text: "Timeout waiting response...Retry... " + node.errorDescription });
                    node.isConnected = false;
                }
                // ######################

                if (node.timerCheckRing !== null) clearTimeout(node.timerCheckRing);
                node.timerCheckRing = setTimeout(queryCallStatus, 10000);
            };

        };


        if (node.timerCheckRing !== null) clearTimeout(node.timerCheckRing);
        node.timerCheckRing = setTimeout(queryCallStatus, 6000); // First connection.
        //#endregion



        //#region "Base FUNCTIONS"
        node.on('close', function (removed, done) {
            if (controller !== null) {
                try {
                    controller.abort();
                } catch (error) { }
            }
            if (node.timerCheckRing !== null) clearTimeout(node.timerCheckRing);
            done();
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


    RED.nodes.registerType("Speaker-config", Speakerconfig, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" }
        }
    });
}
