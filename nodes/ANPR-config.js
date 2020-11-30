

module.exports = (RED) => {

    const DigestFetch = require('digest-fetch')
    const AbortController = require('abort-controller');
    const xml2js = require('xml2js').Parser({explicitArray: false}).parseString;

    function ANPRconfig(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.host = config.host;
        node.port = config.port;
        node.nodeClients = []; // Stores the registered clients
        node.isConnected = false;
        node.lastPicName = "";

        node.setAllClientsStatus = ({ fill, shape, text }) => {
            function nextStatus(oClient) {
                oClient.setNodeStatus({ fill: fill, shape: shape, text: text })
            }
            node.nodeClients.map(nextStatus);
        }

        // At start, reads the last recognized plate and starts listening from the time last plate was recognized.
        // This avoid output all the previoulsy plate list, stored by the camera.
        node.initPlateReader = () => {

            node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Connecting..." });
            var client = new DigestFetch(node.credentials.user, node.credentials.password); // Instantiate the fetch client.
            var controller = new AbortController(); // For aborting the stream request
            var options = {
                // These properties are part of the Fetch Standard
                method: 'POST',
                headers: { 'content-type': 'application/xml' },        // request headers. format is the identical to that accepted by the Headers constructor (see below)
                body: "<AfterTime><picTime>202001010101010000</picTime></AfterTime>",         // request body. can be null, a string, a Buffer, a Blob, or a Node.js Readable stream
                redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                signal: controller.signal,       // pass an instance of AbortSignal to optionally abort requests

                // The following properties are node-fetch extensions
                follow: 20,         // maximum redirect count. 0 to not follow redirect
                timeout: 5000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: true,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: null         // http(s).Agent instance or function that returns an instance (see below)
            }
            client.fetch("http://" + node.host + "/ISAPI/Traffic/channels/1/vehicleDetect/plates", options)
                .then(response => {
                    //RED.log.error(response.status + " " + response.statusText);
                    if (response.statusText === "Unauthorized") {
                        node.setAllClientsStatus({ fill: "red", shape: "ring", text: response.statusText });
                    }
                    if (response.statusText === "Ok") {
                        node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Connected." });
                    }
                    return response.body;
                }).then(body => {
                    body.on('readable', () => {
                        let chunk;
                        var sRet = "";
                        node.lastPicName = "";
                        while (null !== (chunk = body.read())) {
                            sRet = chunk.toString();
                        }
                        //console.log ("BANANA " + sRet)
                        var oPlates = null;
                        try {
                            var i = sRet.indexOf("<"); // Get only the XML, starting with "<"
                            if (i > -1) {
                                sRet = sRet.substring(i);
                                // By xml2js
                                xml2js(sRet, function (err, result) {
                                    oPlates = result;
                                });
                            } else {
                                i = sRet.indexOf("{") // It's a Json
                                if (i > -1) {
                                    sRet = sRet.substring(i);
                                    oPlates = JSON.parse(result);
                                } else {
                                    // Invalid body
                                    RED.log.error("ANPR-config: DecodingBody:" + error);
                                    node.lastPicName = ""; // This raises an error, below.
                                    oPlates = null; // Set null
                                }
                            }

                        } catch (error) {
                            RED.log.error("ANPR-config: ERRORE CATCHATO initPlateReader:" + error);
                            node.lastPicName = ""; // This raises an error, below.
                        }

                        // Working the plates. Must be sure, that no error occurs, before acknolwedging the plate last picName
                        try {
                            if (oPlates !== null) {
                                if (oPlates.Plates !== null) {
                                    if (oPlates.Plates.hasOwnProperty("Plate") && oPlates.Plates.Plate.length > 0) {
                                        node.lastPicName = oPlates.Plates.Plate[oPlates.Plates.Plate.length - 1].picName;
                                        //node.lastPicName = "202001010101010000"; // BANANA SIMULAZIONE CON LETTURA DI TUTTE LE TARGHE
                                        node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Found " + oPlates.Plates.Plate.length + " ignored plates. Last was " + node.lastPicName });
                                    } else {
                                        // No previously plates found, set a default datetime
                                        node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "No previously plates found." });
                                        node.lastPicName = "202001010101010000";
                                    }
                                }
                            }
                        } catch (error) {
                            node.setAllClientsStatus({ fill: "red", shape: "ring", text: "Ahi lasso Error: " + error });
                            node.lastPicName = ""; // This raises an error, below.
                        }

                        if (node.lastPicName === "") {
                            // Some errors occurred
                            // Abort request
                            try {
                                if (controller !== null) controller.abort();
                            } catch (error) { }
                            node.setAllClientsStatus({ fill: "red", shape: "ring", text: "Error occurred in init plates list." });
                            node.isConnected = false;
                            setTimeout(node.initPlateReader, 5000); // Reconnect
                        } else {
                            node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Waiting for vehicle..." });
                            if (!node.isConnected) {
                                node.nodeClients.forEach(oClient => {
                                    oClient.sendPayload({ topic: oClient.topic || "", payload: null, connected: true });
                                })
                            }
                            node.isConnected = true;
                            setTimeout(node.queryForPlates, 2000); // Start main polling thread
                        }
                    });
                })
                .catch(err => {
                    // Abort request
                    try {
                        if (controller !== null) controller.abort();
                    } catch (error) { }
                    node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Server unreachable: " + err + " Retry..." });
                    if (node.isConnected) {
                        node.nodeClients.forEach(oClient => {
                            oClient.sendPayload({ topic: oClient.topic || "", payload: null, connected: false });
                        })
                    }
                    node.isConnected = false;
                    setTimeout(node.initPlateReader, 5000); // Reconnect
                    return;
                });

        };



        node.queryForPlates = () => {
            if (node.lastPicName === "") {
                // Should not be here!
                node.setAllClientsStatus({ fill: "red", shape: "ring", text: "Cacchio, non dovrei essere qui." });
                if (node.isConnected) {
                    node.nodeClients.forEach(oClient => {
                        oClient.sendPayload({ topic: oClient.topic || "", payload: null, connected: false });
                    })
                }
                node.isConnected = false;
                setTimeout(node.initPlateReader, 10000); // Restart whole process.
                return;
            }
            var controller = new AbortController(); // For aborting the stream request
            var client = new DigestFetch(node.credentials.user, node.credentials.password); // Instantiate the fetch client.
            var options = {
                // These properties are part of the Fetch Standard
                method: 'POST',
                headers: { 'content-type': 'application/xml' },        // request headers. format is the identical to that accepted by the Headers constructor (see below)
                body: "<AfterTime><picTime>" + node.lastPicName + "</picTime></AfterTime>",        // request body. can be null, a string, a Buffer, a Blob, or a Node.js Readable stream
                redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                signal: controller.signal,       // pass an instance of AbortSignal to optionally abort requests

                // The following properties are node-fetch extensions
                follow: 20,         // maximum redirect count. 0 to not follow redirect
                timeout: 5000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: true,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: null         // http(s).Agent instance or function that returns an instance (see below)
            }

            client.fetch("http://" + node.host + "/ISAPI/Traffic/channels/1/vehicleDetect/plates", options)
                .then(response => {
                    //RED.log.error(response.status + " " + response.statusText);
                    if (response.statusText === "Unauthorized") {
                        node.setAllClientsStatus({ fill: "red", shape: "ring", text: response.statusText });
                    }
                    if (response.statusText === "Ok") {
                        node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Connected." });
                    }
                    return response.body;
                }).then(body => {
                    let chunk;
                    var oRet = "";
                    while (null !== (chunk = body.read())) {
                        sRet = chunk.toString();
                    }
                    node.isConnected = true;
                    try {
                        var i = sRet.indexOf("<"); // Get only the XML, starting with "<"
                        if (i > -1) {
                            sRet = sRet.substring(i);
                            // By xml2js
                            xml2js(sRet, function (err, result) {
                                oRet = result;

                            });
                        } else {
                            i = sRet.indexOf("{") // It's a Json
                            if (i > -1) {
                                sRet = sRet.substring(i);
                                oRet = JSON.parse(sRet);
                            }
                        }

                    } catch (error) { RED.log.error("ANPR-config: ERRORE CATCHATO vehicleDetect/plates:" + error); }

                    // Send the message to the child nodes
                    if (oRet !== null && oRet.Plates !== null && oRet.Plates.hasOwnProperty("Plate")) {
                        if (oRet.Plates.Plate.length > 0) {
                            oRet.Plates.Plate.forEach(oPlate => {
                                node.nodeClients.forEach(oClient => {
                                    oClient.sendPayload({ topic: oClient.topic || "", plate: oPlate, payload: oPlate.plateNumber, connected: true });
                                })
                            })
                        }
                    }

                    setTimeout(node.queryForPlates, 1000); // Call the cunction again.
                })
                .catch(err => {
                    node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Server unreachable. Retry..." });
                    if (node.isConnected) {
                        node.nodeClients.forEach(oClient => {
                            oClient.sendPayload({ topic: oClient.topic || "", payload: null, connected: false });
                        })
                    }
                    node.isConnected = false;
                    setTimeout(node.initPlateReader, 10000); // Restart whole process.
                    return;
                });
        };

        // Start!
        setTimeout(node.initPlateReader, 5000); // First connection.


        //#region "FUNCTIONS"
        node.on('close', function (removed, done) {
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


    RED.nodes.registerType("ANPR-config", ANPRconfig, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" }
        }
    });
}
