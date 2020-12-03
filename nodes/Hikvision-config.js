

module.exports = (RED) => {

    const DigestFetch = require('digest-fetch')
    const AbortController = require('abort-controller');
    const xml2js = require('xml2js').Parser({ explicitArray: false }).parseString;
    const util = require('util');

    function Hikvisionconfig(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.host = config.host;
        node.port = config.port;
        node.nodeClients = []; // Stores the registered clients
        node.isConnected = true; // Assumes, that is already connected.
        node.timerCheckHeartBeat = null;
        node.errorDescription = ""; // Contains the error description in case of connection error.
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
                    if (controller !== null) controller.abort();
                } catch (error) { }
                node.isConnected = false;
                setTimeout(startAlarmStream, 2000); // Reconnect
            }, 50000);
        }

        async function startAlarmStream() {

            node.resetHeartBeatTimer(); // First thing, start the heartbeat timer.
            node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Connecting..." });


            const client = new DigestFetch(node.credentials.user, node.credentials.password); // Instantiate the fetch client.
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
                agent: null         // http(s).Agent instance or function that returns an instance (see below)
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
                            // Gotta --boundary, process the message
                            if (result.toString().indexOf("--boundary") > -1) {
                                // console.log("BANANA FOUND BOUNDARY: PROCESSO: " + result);
                                var sRet = result.toString();
                                result = ""; // Reset the result
                                // console.log("BANANA PROCESSING" + sRet);
                                try {
                                    sRet = sRet.replace(/--boundary/g, '');
                                    var i = sRet.indexOf("<"); // Get only the XML, starting with "<"
                                    if (i > -1) {
                                        sRet = sRet.substring(i);
                                        // console.log("BANANA SBANANATO " + sRet);
                                        // By xml2js
                                        xml2js(sRet, function (err, result) {
                                            node.nodeClients.forEach(oClient => {
                                                if (result !== undefined) oClient.sendPayload({ topic: oClient.topic || "", payload: result.EventNotificationAlert });
                                            })
                                        });
                                    } else {
                                        i = sRet.indexOf("{") // It's a Json
                                        if (i > -1) {
                                            sRet = sRet.substring(i);
                                            //sRet = sRet.replace(/(['"])?([a-z0-9A-Z_]+)(['"])?:/g, '"$2": '); // Fix numbers and chars invalid in JSON
                                            // console.log("BANANA JSONATO: " + sRet);
                                            node.nodeClients.forEach(oClient => {
                                                oClient.sendPayload({ topic: oClient.topic || "", payload: JSON.parse(sRet) });
                                            })
                                        } else {
                                            // Invalid body
                                            RED.log.info("Hikvision-config: DecodingBody: Invalid Json " + sRet);
                                        }
                                    }
                                    // All is fine. Reset and restart the hearbeat timer
                                    // Hikvision sends an heartbeat alarm (videoloss), depending on firmware, every 300ms or more.
                                    // If this HeartBeat isn't received, abort the stream request and restart.
                                    node.resetHeartBeatTimer();
                                } catch (error) {
                                    // console.log("BANANA startAlarmStream decodifica body: " + error);
                                    RED.log.warn("Hikvision-config: DecodingBody error: " + (error.message || " unknown error"));
                                    throw (error);
                                }
                            }
                        }
                    } catch (error) {
                        RED.log.info("Hikvision-config: readStream error: " + (error.message || " unknown error"));
                        node.errorDescription = "readStream error " + (error.message || " unknown error");
                        throw (error);

                    }
                }
                // ###################################
                //#endregion

                const response = await client.fetch("http://" + node.host + "/ISAPI/Event/notification/alertStream", options);

                if (response.status >= 200 && response.status <= 300) {
                    node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Waiting for Alarm." });
                } else {
                    node.setAllClientsStatus({ fill: "red", shape: "ring", text: response.statusText || " unknown response code" });
                    // console.log("BANANA Error response " + response.statusText);
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
                RED.log.error("Hikvision-config: FETCH ERROR: " + (error.message || " unknown error"));
            };

        };

        setTimeout(startAlarmStream, 10000); // First connection.


        //#region "FUNCTIONS"
        node.on('close', function (removed, done) {
            try {
                controller.abort();
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
            //RED.log.info( "BEFORE Node " + _Node.id + " has been unsubscribed from receiving KNX messages. " + node.nodeClients.length);
            try {
                node.nodeClients = node.nodeClients.filter(x => x.id !== _Node.id)
            } catch (error) { }
            //RED.log.info("AFTER Node " + _Node.id + " has been unsubscribed from receiving KNX messages. " + node.nodeClients.length);

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
