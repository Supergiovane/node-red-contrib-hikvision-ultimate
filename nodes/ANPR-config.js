

module.exports = (RED) => {

    const urllib = require('urllib');
    var Agent = require('agentkeepalive');
    const xml2js = require('xml2js').parseString;


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
            var options = {
                "digestAuth": node.credentials.user + ":" + node.credentials.password,
                "streaming": false,
                "timeout": 5000,
                "method": "POST",
                'followRedirect': true,
                'followAllRedirects': true,
                "data": "<AfterTime><picTime>202001010101010000</picTime></AfterTime>",
                "headers": {
                    'content-type': 'application/xml',
                }
            };

            node.urllibRequest = urllib.request("http://" + node.host + "/ISAPI/Traffic/channels/1/vehicleDetect/plates", options, function (err, data, res) {

                if (err) {
                    //console.log("MAIN ERROR: " + JSON.stringify(err));
                    node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Server unreachable. Retry..." });
                    if (node.isConnected) {
                        node.nodeClients.forEach(oClient => {
                            oClient.sendPayload({ topic: oClient.topic || "", payload: null, connected: false });
                        })
                    }
                    node.isConnected = false;
                    setTimeout(node.initPlateReader, 10000); // Reconnect
                    return;
                }

                if (data) {
                    node.isConnected = true;
                    node.lastPicName = "";
                    var oPlates = null;
                    try {

                        var sRet = data.toString();
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
                            }
                        }

                    } catch (error) { console.log("ERRORE CATCHATO initPlateReader" + error); }

                };
                // Must be sure, that no error occurs, before acknolwedging the plate last picName
                try {
                    if (oPlates !== null) {
                        if (oPlates.Plates !== null && oPlates.Plates.hasOwnProperty("Plate")) {
                            if (oPlates.Plates.Plate.length > 0) {
                                node.lastPicName = oPlates.Plates.Plate[oPlates.Plates.Plate.length - 1].picName;
                                //node.lastPicName = "202001010101010000"; // BANANA
                                node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Found " + oPlates.Plates.Plate.length + " ignored plates. Last was " + node.lastPicName });
                            } else {
                                // No previously plates found, set a default datetime
                                node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "No previously plates found." });
                                node.lastPicName = "202001010101010000";
                            }
                        }
                    }
                } catch (error) {
                    node.setAllClientsStatus({ fill: "red", shape: "ring", text: "Ahi lasso: " + error });
                }
                if (node.lastPicName === "") {
                    // Some errors occurred
                    node.setAllClientsStatus({ fill: "red", shape: "ring", text: "Error occurred in init plates list." });
                    node.isConnected = false;
                    setTimeout(node.initPlateReader, 10000); // Reconnect
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

            var options = {
                "digestAuth": node.credentials.user + ":" + node.credentials.password,
                "streaming": false,
                "timeout": 5000,
                "method": "POST",
                'followRedirect': true,
                'followAllRedirects': true,
                "data": "<AfterTime><picTime>" + node.lastPicName + "</picTime></AfterTime>",
                "headers": {
                    'content-type': 'application/xml',
                }
            };

            node.urllibRequest = urllib.request("http://" + node.host + "/ISAPI/Traffic/channels/1/vehicleDetect/plates", options, function (err, data, res) {

                if (err) {
                    //console.log("MAIN ERROR: " + JSON.stringify(err));
                    node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Server unreachable. Retry..." });
                    if (node.isConnected) {
                        node.nodeClients.forEach(oClient => {
                            oClient.sendPayload({ topic: oClient.topic || "", payload: null, connected: false });
                        })
                    }
                    node.isConnected = false;
                    setTimeout(node.initPlateReader, 10000); // Restart whole process.
                    return;
                }

                if (data) {
                    node.isConnected = true;
                    var oRet = null;
                    try {

                        var sRet = data.toString();
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

                    } catch (error) { console.log("ERRORE CATCHATO " + error); }

                    // Send the message to the child nodes
                    if (oRet !== null && oRet.Plates !== null && oRet.Plates.hasOwnProperty("Plate")) {
                        if (oRet.Plates.Plate.length > 0) {
                            oRet.Plates.Plate.forEach(oPlate => {
                                node.nodeClients.forEach(oClient => {
                                    oClient.sendPayload({ topic: oClient.topic || "", payload: oPlate, connected: true });
                                })
                            })
                        }
                    }
                };

                setTimeout(node.queryForPlates, 1000); // Call the cunction again.

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
