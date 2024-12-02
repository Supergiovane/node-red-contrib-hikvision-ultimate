

module.exports = (RED) => {

    const DigestFetch = require('digest-fetch')
    // const AbortController = require('abort-controller');
    const { XMLParser } = require("fast-xml-parser");
    const https = require('https');

    function ANPRconfig(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.port = config.port || 80;
        node.debug = config.host.toString().toLowerCase().indexOf("banana") > -1;
        node.host = config.host.toString().toLowerCase().replace("banana", "") + ":" + node.port;
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

        // 14/07/2021 custom agent as global variable, to avoid issue with self signed certificates
        const customHttpsAgent = new https.Agent({
            rejectUnauthorized: false
        });

        // 14/12/2020 Get the infos from the camera
        RED.httpAdmin.get("/hikvisionUltimateGetInfoCamANPR", RED.auth.needsPermission('ANPRconfig.read'), function (req, res) {
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
                agent: jParams.protocol === "https" ? customHttpsAgent : null          // http(s).Agent instance or function that returns an instance (see below)
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
                        RED.log.error("Errore  hikvisionUltimateGetInfoCamANPR " + error.message);
                        res.json(error);
                    }

                })();

            } catch (err) {
                res.json(err);
            }
        });

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

            controller = new globalThis.AbortController(); // For aborting the stream request
            var options = {
                // These properties are part of the Fetch Standard
                method: 'POST',
                headers: {},        // request headers. format is the identical to that accepted by the Headers constructor (see below)
                body: "<AfterTime><picTime>" + _lastPicName + "</picTime></AfterTime>",         // request body. can be null, a string, a Buffer, a Blob, or a Node.js Readable stream
                redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                signal: controller.signal,       // pass an instance of AbortSignal to optionally abort requests

                // The following properties are node-fetch extensions
                follow: 20,         // maximum redirect count. 0 to not follow redirect
                timeout: 5000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: node.protocol === "https" ? customHttpsAgent : null        // http(s).Agent instance or function that returns an instance (see below)
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
                            const parser = new XMLParser();
                            try {
                                let result = parser.parse(sRet);
                                try {
                                    // 21/05/2023 The result must always be an array
                                    if (!Array.isArray(result.Plates.Plate) && result.Plates.hasOwnProperty("Plate")) {
                                        // There is 1 element, that i must transform in an array
                                        let a = new Array(1);
                                        a[0] = result.Plates.Plate;
                                        delete result.Plates.Plate;
                                        result.Plates.Plate = a;
                                    }
                                } catch (error) {
                                    oPlates = result;
                                }
                                oPlates = result;
                            } catch (error) {
                                oPlates = null;
                            }

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
                node.setAllClientsStatus({ fill: "grey", shape: "ring", text: node.errorDescription + " Retry..." });
                if (node.isConnected) {
                    node.nodeClients.forEach(oClient => {
                        oClient.sendPayload({ topic: oClient.topic || "", errorDescription: node.errorDescription, payload: true });
                    })
                }
                // Abort request
                if (controller !== null) {
                    try {
                        controller.abort();
                    } catch (error) { }
                }
                node.isConnected = false;
                return null;
            };

        };

        // 30/01/2021 From a list of plates, returns the most recent picname
        async function returnMostRecentPicnameFromList(_PlatesObject, _updateNodeStatusText) {

            // Sets the default to be returned in case of error
            let d = new Date();
            let sRet = (d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2) + ("0" + d.getHours()).slice(-2) + ("0" + d.getMinutes()).slice(-2) + ("0" + d.getSeconds()).slice(-2) + "0000").toString();

            // Is there plates? 
            if (!_PlatesObject.Plates.hasOwnProperty("Plate")) {
                // No plate list
                // No previously plates found, set a default datetime
                if (_updateNodeStatusText) node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "No previously plates found." });
                return sRet;
            };

            if (Array.isArray(_PlatesObject.Plates.Plate) && _PlatesObject.Plates.Plate.length > 0) {

                // 31/01/2021 reliability check: oggi ho scoperto che al passaggio di una macchina, la telecamera la registrato
                // il passaggio e mi ha aggiunto come ultimo item, anche il primo item della sua lista (quindi duplicandolo, uguale uguale), quindi
                // con stessa targa, stesso orario vecchio, ecc..
                // Ovviamente il picname è diventato quello vecchio lì, quindi, visto che appena 2 targhe prima c'era la mia, mi ha aperto il cancello
                // Pick up the last plate by the most recent datetime instead of by the last item in the list (format 202001010101010000)
                if (_updateNodeStatusText) node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Found " + _PlatesObject.Plates.Plate.length + " old plates." });

                try {
                    let nMostRecent = 0;
                    let nCurPicName = 0;
                    for (let index = 0; index < _PlatesObject.Plates.Plate.length; index++) {
                        const element = _PlatesObject.Plates.Plate[index];
                        if (node.debug) RED.log.info("BANANA nMostRecent:" + nMostRecent + " nCurPicName:" + nCurPicName);
                        try {
                            if (element.hasOwnProperty("picName")) {
                                if (typeof element.picName === 'string') {
                                    nCurPicName = BigInt(element.picName);
                                } else {
                                    nCurPicName = element.picName;
                                }

                                if (nCurPicName > nMostRecent) nMostRecent = nCurPicName;
                            }
                        } catch (error) {
                            console.log(error);
                        }
                    }
                    sRet = nMostRecent.toString();
                } catch (error) {
                    // Error, return default current datetime
                    sRet = (d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2) + ("0" + d.getHours()).slice(-2) + ("0" + d.getMinutes()).slice(-2) + ("0" + d.getSeconds()).slice(-2) + "0000").toString();
                }
            } else {
                // It's a single plate
                try {
                    sRet = _PlatesObject.Plates.Plate.picName.toString();
                    if (_updateNodeStatusText) node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Found 1 ignored plates. It's " + sRet });
                } catch (error) {
                    // Some sort of error, set the lastpicname with the current dateteim
                    sRet = (d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2) + ("0" + d.getHours()).slice(-2) + ("0" + d.getMinutes()).slice(-2) + ("0" + d.getSeconds()).slice(-2) + "0000").toString();
                    if (_updateNodeStatusText) node.setAllClientsStatus({ fill: "red", shape: "ring", text: "Error in initplates. Set lastPicName to " + sRet });
                    RED.log.error("Hikvision-Ultimate: ANPR-config: initPlateReader: Error in initplates. Set lastPicName to " + sRet + ". " + error.message);
                }
            }
            return sRet;
        }

        // At start, reads the last recognized plate and starts listening from the time last plate was recognized.
        // This avoid output all the previoulsy plate list, stored by the camera.
        node.initPlateReader = () => {

            (async () => {

                var oPlates = null;
                try {
                    // Get current time in format 202101301301320000
                    oPlates = await getPlates("202001301301320000");
                } catch (error) {
                    oPlates = null;
                }

                if (oPlates === null) {
                    setTimeout(node.initPlateReader, 10000); // Restart initPlateReader
                } else {
                    // console.log("BANANA STRIGONE " + JSON.stringify(oPlates))
                    try {
                        node.lastPicName = await returnMostRecentPicnameFromList(oPlates, true);
                        //console.log("lastPicName:" + node.lastPicName);
                    } catch (error) {
                        setTimeout(node.initPlateReader, 10000); // Restart initPlateReader
                        return;
                    }
                    setTimeout(() => node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Waiting for vehicle..." }), 2000);
                    setTimeout(node.queryForPlates, 3000); // Start main polling thread
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
                    var oPlates = null;
                    try {
                        oPlates = await getPlates(node.lastPicName);
                    } catch (error) {
                        oPlates = null;
                    }

                    if (oPlates === null) {
                        // An error was occurred.
                        setTimeout(node.initPlateReader, 2000); // Restart initPlateReader from scratch
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
                                // Set the picname of the most recent plate in this filtered list
                                node.lastPicName = await returnMostRecentPicnameFromList(oPlates, false);
                            } // else {
                            //     // It's a single plate
                            //     try {
                            //         node.lastPicName = oPlates.Plates.Plate.picName;
                            //         var oPlate = oPlates.Plates.Plate;
                            //         node.nodeClients.forEach(oClient => {
                            //             oClient.sendPayload({ topic: oClient.topic || "", plate: oPlate, payload: oPlate.plateNumber, connected: true });
                            //         })
                            //     } catch (error) {
                            //         let d = new Date();
                            //         let sRet = (d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2) + ("0" + d.getHours()).slice(-2) + ("0" + d.getMinutes()).slice(-2) + ("0" + d.getSeconds()).slice(-2) + "0000").toString();
                            //         node.lastPicName = sRet;
                            //         RED.log.error("Hikvision-Ultimate: ANPR-config: queryForPlates: Error in It's a single plate. Set lastPicName to " + node.lastPicName + ". " + error.message);
                            //     }

                            //     //console.log("BANANA SINGOLA PLATE: " + oPlate.plateNumber);
                            // }
                        } else {
                            // No new plates found
                        }
                        setTimeout(node.queryForPlates, 3000); // Call the cunction again.
                    }
                })();
            }
        };

        // Start!
        setTimeout(node.initPlateReader, 10000); // First connection.
        //#endregion

        //#region "FUNCTIONS"
        node.on('close', function (removed, done) {
            if (controller !== null) {
                try {
                    controller.abort();
                } catch (error) { }
            }
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
