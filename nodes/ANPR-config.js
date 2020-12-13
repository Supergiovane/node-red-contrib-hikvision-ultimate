

module.exports = (RED) => {

    const DigestFetch = require('digest-fetch')
    const AbortController = require('abort-controller');
    const xml2js = require('xml2js').Parser({ explicitArray: false }).parseString;

    function ANPRconfig(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.debug = config.host.indexOf("banana") > -1;
        node.host = config.host.replace("banana", "");
        node.port = config.port;
        node.protocol = config.protocol || "http";
        node.nodeClients = []; // Stores the registered clients
        node.isConnected = true; // Assume it's connected, to signal the disconnection on start
        node.lastPicName = "";
        node.errorDescription = ""; // Contains the error description in case of connection error.
        node.authentication = config.authentication || "digest";
        var controller = null; // Abortcontroller

        node.setAllClientsStatus = ({ fill, shape, text }) => {
            function nextStatus(oClient) {
                oClient.setNodeStatus({ fill: fill, shape: shape, text: text });
            }
            node.nodeClients.map(nextStatus);
        }

        //#region "PLATES ANPR"
        // Sort the plates, in any case, even if the anpr camera returns a sorted list. It's not always true!
        function sortPlates(a, b) {
            try {
                if (a.Plate.picName < b.Plate.picName) {
                    return -1;
                }
                if (a.Plate.picName > b.Plate.picName) {
                    return 1;
                }
                return 0;
            } catch (error) {
                return 0;
            }

        }


        // Function to get the plate list from the camera
        async function getPlates(_lastPicName) {
            if (_lastPicName == undefined || _lastPicName == null || _lastPicName == "") return null;

            var client;
            if (node.authentication === "digest") client = new DigestFetch(node.credentials.user, node.credentials.password); // Instantiate the fetch client.
            if (node.authentication === "basic") client = new DigestFetch(node.credentials.user, node.credentials.password, { basic: true }); // Instantiate the fetch client.

            controller = new AbortController(); // For aborting the stream request
            var options = {
                // These properties are part of the Fetch Standard
                method: 'POST',
                headers: {},        // request headers. format is the identical to that accepted by the Headers constructor (see below)
                body: "<AfterTime><picTime>" + _lastPicName + "</picTime></AfterTime>",         // request body. can be null, a string, a Buffer, a Blob, or a Node.js Readable stream
                redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                signal: controller.signal,       // pass an instance of AbortSignal to optionally abort requests

                // The following properties are node-fetch extensions
                follow: 20,         // maximum redirect count. 0 to not follow redirect
                timeout: 15000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: null         // http(s).Agent instance or function that returns an instance (see below)
            };
            try {
                const response = await client.fetch(node.protocol + "://" + node.host + "/ISAPI/Traffic/channels/1/vehicleDetect/plates", options);
                if (response.status >= 200 && response.status <= 300) {
                    //node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Connected." });
                } else {
                    node.setAllClientsStatus({ fill: "red", shape: "ring", text: response.statusText || " unknown response code" });
                    //console.log("BANANA Error response " + response.statusText);
                    throw new Error("Error response: " + response.statusText || " unknown response code");
                }
                //#region "BODY"
                if (response.ok) {
                    var body = "";
                    body = await response.text();
                    var sRet = body.toString();
                    // console.log("BANANA ANPR: " + sRet);
                    var oPlates = null;
                    try {
                        var i = sRet.indexOf("<"); // Get only the XML, starting with "<"
                        if (i > -1) {
                            sRet = sRet.substring(i);
                            // By xml2js
                            xml2js(sRet, function (err, result) {
                                if (err) {
                                    oPlates = null;
                                } else {
                                    oPlates = result;
                                }
                            });
                        } else {
                            i = sRet.indexOf("{") // It's a Json
                            if (i > -1) {
                                sRet = sRet.substring(i);
                                try {
                                    oPlates = JSON.parse(result);
                                } catch (error) {
                                    oPlates = null;
                                }
                            } else {
                                // Invalid body
                                if (node.debug) RED.log.info("ANPR-config: DecodingBody: Invalid Json " + sRet);
                                // console.log("BANANA ANPR-config: DecodingBody: Invalid Json " + sRet);
                                throw new Error("Error Invalid Json: " + sRet);
                            }
                        }
                        // console.log("BANANA GIASONE " + JSON.stringify(oPlates));
                        // Working the plates. Must be sure, that no error occurs, before acknolwedging the plate last picName
                        if (oPlates.Plates !== null && oPlates.Plates !== undefined) {

                            // Send connection OK
                            if (!node.isConnected) {
                                node.nodeClients.forEach(oClient => {
                                    oClient.sendPayload({ topic: oClient.topic || "", errorDescription: "", payload: false });
                                })
                            }
                            node.errorDescription = ""; // Reset the error message
                            node.isConnected = true;

                            //console.log("BANANA JSON PLATES: " + JSON.stringify(oPlates));
                            if (oPlates.Plates.hasOwnProperty("Plate")) {
                                // If the plate is an array, returns a sorted list, otherwise a single plate.
                                if (Array.isArray(oPlates.Plates.Plate)) {
                                    oPlates.Plates.Plate = oPlates.Plates.Plate.sort(sortPlates);
                                    //console.log("BANANA LISTA MULTIPLA PLATES ORDINATE:" + JSON.stringify(oPlates));
                                }
                                return oPlates;
                            } else {
                                // Returns the object, empty.
                                return oPlates;
                            }

                        } else {
                            // Error in parsing XML
                            if (node.debug) RED.log.info("ANPR-config: Error: oPlates.Plates is null");
                            throw new Error("Error: oPlates.Plates is null");
                        }

                    } catch (error) {
                        if (node.debug) RED.log.warn("ANPR-config: ERRORE CATCHATO getPlates:" + (error.message || ""));
                        // console.log("BANANA ANPR-config: ERRORE CATCHATO initPlateReader: " + error);
                        throw new Error("Error getPlates: " + (error.message || ""));
                    }
                }
                //#endregion 
            } catch (err) {
                // Main Error
                node.errorDescription = err.message || " unknown error";
                node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Server unreachable: " + node.errorDescription + " Retry..." });
                if (node.isConnected) {
                    node.nodeClients.forEach(oClient => {
                        oClient.sendPayload({ topic: oClient.topic || "", errorDescription: node.errorDescription, payload: true });
                    })
                }
                // Abort request
                try {
                    if (controller !== null) controller.abort().then(ok => { }).catch(err => { });
                } catch (error) { }
                node.isConnected = false;
                return null;
            };

        };


        // At start, reads the last recognized plate and starts listening from the time last plate was recognized.
        // This avoid output all the previoulsy plate list, stored by the camera.
        node.initPlateReader = () => {

            // console.log("BANANA INITPLATEREADER");
            //node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Getting prev list to be ignored..." });
            (async () => {
                var oPlates = await getPlates("202001010101010000");
                if (oPlates === null) {
                    setTimeout(node.initPlateReader, 10000); // Restart initPlateReader
                } else {
                    // console.log("BANANA STRIGONE " + JSON.stringify(oPlates))
                    if (oPlates.Plates.hasOwnProperty("Plate")) {
                        // Check wether is an array of plates or a single plate
                        if (Array.isArray(oPlates.Plates.Plate) && oPlates.Plates.Plate.length > 0) {
                            try {
                                node.lastPicName = oPlates.Plates.Plate[oPlates.Plates.Plate.length - 1].picName;
                                // console.log("BANANA PLATES IGNORATE MULTIPLE: " + oPlates.Plates.Plate.length + " ignored plates. Last was " + node.lastPicName);
                                node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Found " + oPlates.Plates.Plate.length + " ignored plates. Last was " + node.lastPicName });
                            } catch (error) {
                                // console.log("BANANA Error oPlates.Plates.Plate[oPlates.Plates.Plate.length - 1]: " + error);
                                setTimeout(node.initPlateReader, 10000); // Restart initPlateReader
                                return;
                            }
                        } else {
                            // It's a single plate
                            node.lastPicName = oPlates.Plates.Plate.picName;
                            //console.log("BANANA SINGOLA PLATE IGNORATA: it's " + node.lastPicName);
                            node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Found 1 ignored plates. It's " + node.lastPicName });
                        }
                    } else {
                        // No previously plates found, set a default datetime
                        node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "No previously plates found." });
                        node.lastPicName = "202001010101010000";
                    }
                    setTimeout(() => node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Waiting for vehicle..." }), 2000);
                    setTimeout(node.queryForPlates, 2000); // Start main polling thread
                }
            })();
        };



        node.queryForPlates = () => {
            // console.log("BANANA queryForPlates");
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
            } else {
                (async () => {
                    var oPlates = await getPlates(node.lastPicName);
                    if (oPlates === null) {
                        // An error was occurred.
                        setTimeout(node.initPlateReader, 10000); // Restart initPlateReader from scratch
                    } else {
                        if (oPlates.Plates.hasOwnProperty("Plate")) {
                            // Check wether is an array of plates or a single plate
                            if (Array.isArray(oPlates.Plates.Plate) && oPlates.Plates.Plate.length > 0) {
                                // Send the message to the child nodes
                                oPlates.Plates.Plate.forEach(oPlate => {
                                    node.nodeClients.forEach(oClient => {
                                        oClient.sendPayload({ topic: oClient.topic || "", plate: oPlate, payload: oPlate.plateNumber, connected: true });
                                    })
                                })
                                // Set the last plate found, to avoid repeating.
                                node.lastPicName = oPlates.Plates.Plate[oPlates.Plates.Plate.length - 1].picName;
                            } else {
                                // It's a single plate
                                node.lastPicName = oPlates.Plates.Plate.picName;
                                var oPlate = oPlates.Plates.Plate;
                                node.nodeClients.forEach(oClient => {
                                    oClient.sendPayload({ topic: oClient.topic || "", plate: oPlate, payload: oPlate.plateNumber, connected: true });
                                })
                                //console.log("BANANA SINGOLA PLATE: " + oPlate.plateNumber);
                            }
                        } else {
                            // No new plates found
                        }
                        setTimeout(node.queryForPlates, 1000); // Call the cunction again.
                    }
                })();
            }
        };

        // Start!
        setTimeout(node.initPlateReader, 10000); // First connection.
        //#endregion

        //#region "FUNCTIONS"
        node.on('close', function (removed, done) {
            try {
                if (controller !== null) controller.abort().then(ok => { }).catch(err => { });
            } catch (error) { }
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


    RED.nodes.registerType("ANPR-config", ANPRconfig, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" }
        }
    });
}
