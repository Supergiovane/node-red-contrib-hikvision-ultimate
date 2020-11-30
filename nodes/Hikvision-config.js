

module.exports = (RED) => {

    const DigestFetch = require('digest-fetch')
    const AbortController = require('abort-controller');
    const xml2js = require('xml2js').Parser({explicitArray: false}).parseString;

    function Hikvisionconfig(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.host = config.host;
        node.port = config.port;
        node.nodeClients = []; // Stores the registered clients
        node.isConnected = false;
        node.timerCheckHeartBeat = null;
        var controller = null; // AbortController

        node.setAllClientsStatus = ({ fill, shape, text }) => {
            function nextStatus(oClient) {
                oClient.setNodeStatus({ fill: fill, shape: shape, text: text })
            }
            node.nodeClients.map(nextStatus);
        }

        // This function starts the heartbeat timer, to detect the disconnection from the server
        node.startHeartBeatTimer = () => {
            // Reset node.timerCheckHeartBeat
            if (node.timerCheckHeartBeat !== null) clearTimeout(node.timerCheckHeartBeat);
            node.timerCheckHeartBeat = setTimeout(() => {
                try {
                    if (controller !== null) controller.abort();
                } catch (error) { }

                if (node.isConnected) {
                    node.nodeClients.forEach(oClient => {
                        oClient.sendPayload({ topic: oClient.topic || "", payload: null, connected: false });
                    });
                    node.setAllClientsStatus({ fill: "red", shape: "ring", text: "Lost connection...Retry..." });
                }
                node.isConnected = false;
                setTimeout(node.startAlarmStream, 5000); // Reconnect
            }, 25000);
        }

        node.startAlarmStream = () => {
            var controller = new AbortController(); // For aborting the stream request
            var client = new DigestFetch(node.credentials.user, node.credentials.password); // Instantiate the fetch client.
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
                compress: true,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: null         // http(s).Agent instance or function that returns an instance (see below)
            }
            node.startHeartBeatTimer(); // First thing, start the heartbeat timer.
            node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Connecting..." });

            client.fetch("http://" + node.host + "/ISAPI/Event/notification/alertStream", options)
                .then(response => {
                    //console.log(response.status + " " + response.statusText);
                    if (response.statusText === "Unauthorized") {
                        node.setAllClientsStatus({ fill: "red", shape: "ring", text: response.statusText });
                    }
                    if (response.statusText === "Ok") {
                        node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Connected. Waiting for Alarm." });
                    }
                    return response.body;
                })
                .then(body => {
                    body.on('readable', () => {
                        node.isConnected = true;
                        try {
                            let chunk;
                            var sRet = ""
                            while (null !== (chunk = body.read())) {
                                sRet = chunk.toString();
                            }
                            sRet = sRet.replace(/--boundary/g, '');
                            var i = sRet.indexOf("<"); // Get only the XML, starting with "<"
                            if (i > -1) {
                                sRet = sRet.substring(i);
                                // By xml2js
                                xml2js(sRet, function (err, result) {
                                    node.nodeClients.forEach(oClient => {
                                        if (result !== undefined) oClient.sendPayload({ topic: oClient.topic || "", payload: result, connected: true });
                                    })
                                });
                            } else {
                                i = sRet.indexOf("{") // It's a Json
                                if (i > -1) {
                                    sRet = sRet.substring(i);
                                    //sRet = sRet.replace(/(['"])?([a-z0-9A-Z_]+)(['"])?:/g, '"$2": '); // Fix numbers and chars invalid in JSON
                                    //console.log("BANANA : " + sRet);
                                    node.nodeClients.forEach(oClient => {
                                        oClient.sendPayload({ topic: oClient.topic || "", payload: JSON.parse(sRet), connected: true });
                                    })
                                }
                            }

                        } catch (error) { RED.log.error("Hikvision-config: ERRORE CATCHATO " + error); }
                        // All is fine. Reset and restart the hearbeat timer
                        // Hikvision sends an heartbeat alarm (videoloss), depending on firmware, every 300ms or more.
                        // If this HeartBeat isn't received, abort the stream request and restart.
                        node.startHeartBeatTimer();
                    });


                })
                .catch(err => {
                    node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Server unreachable: " + err + " Retry..." });
                    if (node.isConnected) {
                        node.nodeClients.forEach(oClient => {
                            oClient.sendPayload({ topic: oClient.topic || "", payload: null, connected: false });
                        })
                    }
                    node.isConnected = false;
                    return;
                });


        };

        setTimeout(node.startAlarmStream, 5000); // First connection.


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
