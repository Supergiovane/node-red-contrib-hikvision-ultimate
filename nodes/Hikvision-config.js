
module.exports = (RED) => {

    const DigestFetch = require('digest-fetch')
    const AbortController = require('abort-controller');
    const xml2js = require('xml2js').Parser({ explicitArray: false }).parseString;
    const util = require('util');

    function Hikvisionconfig(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.debug = config.host.indexOf("banana") > -1;
        node.host = config.host.replace("banana", "");
        node.port = config.port;
        node.protocol = config.protocol || "http";
        node.nodeClients = []; // Stores the registered clients
        node.isConnected = true; // Assumes, that is already connected.
        node.timerCheckHeartBeat = null;
        node.errorDescription = ""; // Contains the error description in case of connection error.
        node.authentication = config.authentication || "digest";
        var controller = null; // AbortController

        node.setAllClientsStatus = ({ fill, shape, text }) => {
            function nextStatus(oClient) {
                oClient.setNodeStatus({ fill: fill, shape: shape, text: text })
            }
            node.nodeClients.map(nextStatus);
        }



        // This function starts the heartbeat timer, to detect the disconnection from the server
        node.resetHeartBeatTimer = () => {
            // Reset node.timerCheckHeartBeat
            if (node.timerCheckHeartBeat !== null) clearTimeout(node.timerCheckHeartBeat);
            node.timerCheckHeartBeat = setTimeout(() => {
                if (node.isConnected) {
                    if (node.errorDescription === "") node.errorDescription = "Timeout waiting heartbeat"; // In case of timeout of a stream, there is no error throwed.
                    node.nodeClients.forEach(oClient => {
                        oClient.sendPayload({ topic: oClient.topic || "", errorDescription: node.errorDescription, payload: true });
                    });
                    node.setAllClientsStatus({ fill: "red", shape: "ring", text: "Lost connection...Retry... " + node.errorDescription });
                }
                try {
                    if (controller !== null) controller.abort().then(ok => { }).catch(err => { });
                } catch (error) { }
                node.isConnected = false;
                setTimeout(startAlarmStream, 2000); // Reconnect
            }, 50000);
        }

        //#region ALARMSTREAM
        async function startAlarmStream() {

            node.resetHeartBeatTimer(); // First thing, start the heartbeat timer.
            node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Connecting..." });

            var client;
            if (node.authentication === "digest") client = new DigestFetch(node.credentials.user, node.credentials.password); // Instantiate the fetch client.
            if (node.authentication === "basic") client = new DigestFetch(node.credentials.user, node.credentials.password, { basic: true }); // Instantiate the fetch client.

            controller = new AbortController(); // For aborting the stream request
            var options = {
                // These properties are part of the Fetch Standard
                method: 'GET',
                headers: {},        // request headers. format is the identical to that accepted by the Headers constructor (see below)
                body: null,         // request body. can be null, a string, a Buffer, a Blob, or a Node.js Readable stream
                redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                signal: controller.signal,       // pass an instance of AbortSignal to optionally abort requests

                // The following properties are node-fetch extensions
                follow: 20,         // maximum redirect count. 0 to not follow redirect
                timeout: 0,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: null

            };
            try {


                //#region "HANDLE STREAM MESSAGE"
                // Async get the body, called by streamPipeline(response.body, readStream);
                // Handle the complete stream message, enclosed into the --boundary stream string
                // ###################################
                const streamPipeline = util.promisify(require('stream').pipeline);
                async function readStream(stream) {
                    try {
                        let result = ""; // The complete message, as soon as --boudary is received.
                        for await (const chunk of stream) {
                            result += chunk.toString();
                            if (node.debug)  RED.log.error("BANANA CHUNK: ######################\n" + chunk.toString() + "\n###################### FINE BANANA CHUNK");
                            if (node.debug)  RED.log.error("BANANA RESULT: \n" + result + "\n###################### FINE BANANA RESULT");
                            //  if (node.debug)  RED.log.error("HEADESR " + JSON.stringify(stream))
                            // Gotta --boundary, process the message
                            if (result.indexOf("--boundary") > -1) {
                                // 05/12/2020 Check how many boundary i received i split result in every single message
                                var aResults = result.split("--boundary");
                                result = ""; // Reset the result
                                aResults.forEach(sRet => {
                                    if (node.debug)  RED.log.error("SPLITTATO RESULT: ######################\n" + sRet + "\n###################### FINE SPLITTATO RESULT");
                                    if (sRet.trim() !== "") {
                                        if (node.debug)  RED.log.error("BANANA PROCESSING" + sRet);
                                        try {
                                            //sRet = sRet.replace(/--boundary/g, '');
                                            var i = sRet.indexOf("<"); // Get only the XML, starting with "<"
                                            if (i > -1) {
                                                sRet = sRet.substring(i);
                                                // By xml2js
                                                xml2js(sRet, function (err, result) {
                                                    if (err) {
                                                        sRet = "";
                                                    } else {
                                                        if (node.debug)  RED.log.error("BANANA SBANANATO XML -> JSON " + JSON.stringify(result));
                                                        if (result !== null && result !== undefined && result.hasOwnProperty("EventNotificationAlert")) {
                                                            node.nodeClients.forEach(oClient => {
                                                                if (result !== undefined) oClient.sendPayload({ topic: oClient.topic || "", payload: result.EventNotificationAlert });
                                                            });
                                                        }
                                                    }
                                                });
                                            } else {
                                                i = sRet.indexOf("{") // It's a Json
                                                if (i > -1) {
                                                    if (node.debug)  RED.log.error("BANANA SBANANATO JSON " + sRet);
                                                    sRet = sRet.substring(i);
                                                    try {
                                                        sRet = JSON.parse(sRet);
                                                        //  if (node.debug)  RED.log.error("BANANA JSONATO: " + sRet);
                                                        if (sRet !== null && sRet !== undefined) {
                                                            node.nodeClients.forEach(oClient => {
                                                                oClient.sendPayload({ topic: oClient.topic || "", payload: sRet });
                                                            })
                                                        }
                                                    } catch (error) {
                                                        sRet = "";
                                                    }
                                                } else {
                                                    // Invalid body
                                                    if (node.debug) RED.log.info("Hikvision-config: DecodingBody Info only: Invalid Json " + sRet);
                                                }
                                            }
                                            // All is fine. Reset and restart the hearbeat timer
                                            // Hikvision sends an heartbeat alarm (videoloss), depending on firmware, every 300ms or more.
                                            // If this HeartBeat isn't received, abort the stream request and restart.
                                            node.resetHeartBeatTimer();
                                        } catch (error) {
                                            //  if (node.debug) RED.log.error("BANANA startAlarmStream decodifica body: " + error);
                                            if (node.debug) RED.log.warn("Hikvision-config: DecodingBody error: " + (error.message || " unknown error"));
                                            throw (error);
                                        }
                                    }
                                });
                            }
                        }
                    } catch (error) {
                        if (node.debug) RED.log.info("Hikvision-config: readStream error: " + (error.message || " unknown error"));
                        node.errorDescription = "readStream error " + (error.message || " unknown error");
                        throw (error);

                    }
                }
                // ###################################
                //#endregion

                const response = await client.fetch(node.protocol + "://" + node.host + "/ISAPI/Event/notification/alertStream", options);

                if (response.status >= 200 && response.status <= 300) {
                    node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Waiting for Alarm." });
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
                    streamPipeline(response.body, readStream);
                }

            } catch (error) {
                // Main Error
                // Abort request
                //node.errorDescription = "Fetch error " + JSON.stringify(error, Object.getOwnPropertyNames(error));
                node.errorDescription = "Fetch error " + (error.message || " unknown error");
                if (node.debug) RED.log.error("Hikvision-config: FETCH ERROR: " + (error.message || " unknown error"));
            };

        };
        setTimeout(startAlarmStream, 10000); // First connection.
        //#endregion

        //#region GENERIC GET OT PUT CALL
        // Function to get or post generic data on camera
        node.request = async function(_callerNode, _method, _URL, _body) {
            var client;
            if (node.authentication === "digest") client = new DigestFetch(node.credentials.user, node.credentials.password); // Instantiate the fetch client.
            if (node.authentication === "basic") client = new DigestFetch(node.credentials.user, node.credentials.password, { basic: true }); // Instantiate the fetch client.

            reqController = new AbortController(); // For aborting the stream request
            var options = {
                // These properties are part of the Fetch Standard
                method: _method.toString().toUpperCase(),
                headers: {},        // request headers. format is the identical to that accepted by the Headers constructor (see below)
                body: _body,         // request body. can be null, a string, a Buffer, a Blob, or a Node.js Readable stream
                redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                signal: reqController.signal,       // pass an instance of AbortSignal to optionally abort requests

                // The following properties are node-fetch extensions
                follow: 20,         // maximum redirect count. 0 to not follow redirect
                timeout: 5000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: null         // http(s).Agent instance or function that returns an instance (see below)
            };
            try {
                if (!_URL.startsWith("/")) _URL = "/" + _URL;
                const response = await client.fetch(node.protocol + "://" + node.host + _URL, options);
                if (response.status >= 200 && response.status <= 300) {
                    //node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Connected." });
                } else {
                    _callerNode.setNodeStatus({ fill: "red", shape: "ring", text: response.statusText || " unknown response code" });
                    //console.log("BANANA Error response " + response.statusText);
                    throw new Error("Error response: " + response.statusText || " unknown response code");
                }
                if (response.ok) {
                    var body = "";
                    // Based on URL, will return the appropriate encoded body
                    if (_URL.toLowerCase().includes("/ptzctrl/")) {
                        _callerNode.sendPayload({ topic: _callerNode.topic || "", payload: true });
                    }else if (_URL.toLowerCase().includes("/streaming/")) {
                        body = await response.buffer(); // "data:image/png;base64," +
                        //_callerNode.sendPayload({ topic: _callerNode.topic || "", payload:  body.toString("base64")});
                        _callerNode.sendPayload({ topic: _callerNode.topic || "", payload:  body});
                    }
                }
                
            } catch (err) {
                //console.log("ORRORE " + err.message);
                // Main Error
                _callerNode.setNodeStatus({ fill: "grey", shape: "ring", text: "Horror: " + err.message });
                _callerNode.sendPayload({ topic: _callerNode.topic || "", errorDescription: err.message, payload: true });
                // Abort request
                try {
                    if (reqController !== null) reqController.abort().then(ok => { }).catch(err => { });
                } catch (error) { }
            }
        };
        //#endregion




        //#region "FUNCTIONS"
        node.on('close', function (removed, done) {
            try {
                if (controller !== null) controller.abort().then(ok => { }).catch(err => { });
            } catch (error) { }
            if (node.timerCheckHeartBeat !== null) clearTimeout(node.timerCheckHeartBeat);
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


    RED.nodes.registerType("Hikvision-config", Hikvisionconfig, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" }
        }
    });
}
