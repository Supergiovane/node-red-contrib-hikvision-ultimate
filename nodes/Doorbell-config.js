
module.exports = (RED) => {

    const DigestFetch = require('digest-fetch')
    // const AbortController = require('abort-controller');
    const { XMLParser } = require("fast-xml-parser");
    const readableStr = require('stream').Readable;
    const https = require('https');

    function Doorbellconfig(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.port = config.port || 80;
        node.debug = false //config.host.toString().toLowerCase().indexOf("banana") > -1;
        node.host = config.host.toString().toLowerCase().replace("banana", "") + ":" + node.port;
        node.protocol = config.protocol || "http";
        node.nodeClients = []; // Stores the registered clients
        node.isConnected = true; // Assumes, that is already connected.
        node.errorDescription = ""; // Contains the error description in case of connection error.
        node.authentication = config.authentication || "digest";
        node.deviceinfo = config.deviceinfo || {};
        node.timerCheckRing = null;
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

        // 14/12/2020 Get the infos from the doorbell
        RED.httpAdmin.get("/hikvisionUltimateGetInfoDoorBell", RED.auth.needsPermission('Doorbellconfig.read'), function (req, res) {
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



        //#region "HANDLE STREAM MESSAGE"
        // Handle the complete stream message, enclosed into the --boundary stream string
        // If there is more boundary, process each one separately
        // ###################################
        async function handleChunk(result) {
            try {
                // 05/12/2020 process the data
                let jSonStatus = JSON.parse(result);
                if (node.debug) RED.log.info("Doorbell-config: handleChunk: " + result);
                node.nodeClients.forEach(oClient => {
                    oClient.sendPayload(jSonStatus);
                });
            } catch (error) {
                if (node.debug) RED.log.error("Doorbell-config: readStream error: " + (error.message || " unknown error"));
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

                const response = await clientCallStatus.fetch(node.protocol + "://" + node.host + "/ISAPI/VideoIntercom/callerInfo?format=json", optionsAlarmStream);
                //const response = await clientCallStatus.fetch(node.protocol + "://" + node.host + "/ISAPI/VideoIntercom/callStatus?format=json", optionsAlarmStream);

                if (response.status >= 200 && response.status <= 300) {
                    node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Waiting for event." });
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
                        if (node.debug) RED.log.info("Doorbell-config: before Pipelining...");
                        if (oReadable !== null) oReadable.removeAllListeners() // 09/01/2023
                        oReadable = readableStr.from(response.body, { encoding: 'utf8' });
                        oReadable.on('data', async (chunk) => {
                            if (node.debug) RED.log.info("Doorbell-config: oReadable.on('data') " + chunk);
                            if (chunk.includes("}")) {
                                try {
                                    await handleChunk(chunk);
                                } catch (error) {
                                    throw (error);
                                }
                            }
                        });
                        oReadable.on('end', function () {
                            if (node.debug) RED.log.info("Doorbell-config: queryCallStatus: STREAMING HAS ENDED.");
                            if (node.timerCheckRing !== null) clearTimeout(node.timerCheckRing);
                            node.timerCheckRing = setTimeout(queryCallStatus, 2000);
                        });

                        oReadable.on('error', function (error) {
                            if (node.debug) RED.log.error("Doorbell-config: queryCallStatus: " + (error.message || " unknown error"));
                            if (node.timerCheckRing !== null) clearTimeout(node.timerCheckRing);
                            node.timerCheckRing = setTimeout(queryCallStatus, 10000);
                        });

                        //await queryCallStatus(response.body, readStream);
                    } catch (error) {
                        if (node.debug) RED.log.error("Doorbell-config: queryCallStatus: " + (error.message || " unknown error"));

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
                if (node.debug) RED.log.error("Doorbell-config: FETCH ERROR: " + (error.message || " unknown error"));


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

        //#region GENERIC GET OT PUT CALL
        // Function to get or post generic data on device
        node.request = async function (_callerNode, _method, _URL, _body) {
            var clientGenericRequest;
            if (node.authentication === "digest") clientGenericRequest = new DigestFetch(node.credentials.user, node.credentials.password); // Instantiate the fetch client.
            if (node.authentication === "basic") clientGenericRequest = new DigestFetch(node.credentials.user, node.credentials.password, { basic: true }); // Instantiate the fetch client.

            let reqController = new globalThis.AbortController(); // For aborting the stream request
            var options = {
                // These properties are part of the Fetch Standard
                method: _method.toString().toUpperCase(),
                headers: {},        // request headers. format is the identical to that accepted by the Headers constructor (see below)
                body: _body,         // request body. can be null, a string, a Buffer, a Blob, or a Node.js Readable stream
                redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                signal: reqController.signal,       // pass an instance of AbortSignal to optionally abort requests

                // The following properties are node-fetch extensions
                follow: 20,         // maximum redirect count. 0 to not follow redirect
                timeout: 8000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: node.protocol === "https" ? customHttpsAgent : null         // http(s).Agent instance or function that returns an instance (see below)
            };
            try {
                if (!_URL.startsWith("/")) _URL = "/" + _URL;
                const response = await clientGenericRequest.fetch(node.protocol + "://" + node.host + _URL, options);
                if (response.ok) {
                    try {
                        const oReadable = readableStr.from(response.body, { encoding: 'utf8' });
                        oReadable.on('data', (chunk) => {
                            if (node.debug) RED.log.error(chunk);
                        });
                    } catch (error) {
                        throw new Error("Error readableStream: " + error.message || "");
                    }
                } else {
                    throw new Error("Error response: " + response.statusText || " unknown response code");
                }

            } catch (error) {
                // Main Error
                if (node.debug) RED.log.error("Doorbell-config: clientGenericRequest.fetch error " + error.message);
                throw (new Error("clientGenericRequest.fetch error:" + error.message));
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


    RED.nodes.registerType("Doorbell-config", Doorbellconfig, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" }
        }
    });
}
