

module.exports = (RED) => {

    var urllib = require('urllib');
    var urllibCheckConnection = require('urllib');
    var xml2js = require('xml2js').parseString;

    function Hikvisionconfig(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.host = config.host
        node.port = config.port
        node.nodeClients = [] // Stores the registered clients
        node.connectionCheck;
        node.connectionCheck = setTimeout(function () { node.CheckConnection(); }, 2000);
        node.alarmStreamConnected = false;

        // 25/11/2020
        node.CheckConnection = () => {
            // Try to find out, if the server responds.
            var optionsCheck = {
                "digestAuth": node.credentials.user + ":" + node.credentials.password,
                "timeout": 8000
            };
            urllibCheckConnection.request("http://" + node.host + "/ISAPI/Event/notification/alertStream", optionsCheck, function (err, data, res) {
                if (err) {
                    // console.log("ERROR: " + err);
                    // // Error connecting to the server
                    // node.nodeClients.forEach(oClient => {
                    //     try {
                    //         oClient.setNodeStatus({ fill: "red", shape: "shape", text: "Disconnected: " + errr });
                    //     } catch (error) { }
                    // })
                    // node.alarmStreamConnected = false;
                }
                try {
                    console.log("CHECK STATUS: " + res.statusCode);
                    if (res.statusCode !== 200) {
                        node.nodeClients.forEach(oClient => {
                            try {
                                oClient.setNodeStatus({ fill: "red", shape: "shape", text: "Disconnected. Status " + res.statusCode });
                                // Inform clients about disconnections.
                                if (node.alarmStreamConnected === true) {
                                    oClient.send({ topic: oClient.topic || "", payload: "Disconnected" });
                                }
                            } catch (error) { }
                        })
                        node.alarmStreamConnected = false;
                    } else {
                        if (node.alarmStreamConnected === false) {
                            node.alarmStreamConnected = true;
                            node.startAlarmStream();
                            node.nodeClients.forEach(oClient => {
                                try {
                                    oClient.setNodeStatus({ fill: "green", shape: "ring", text: "Connected" });
                                } catch (error) { }
                            })
                        }
                    }
                } catch (error) {
                }
                node.connectionCheck = setTimeout(function () { node.CheckConnection(); }, 5000);

            });

        };

        // Starts alarm stream
        node.startAlarmStream = () => {
            //console.log("START MAIN STREAM");
            var options = {
                "digestAuth": node.credentials.user + ":" + node.credentials.password,
                "streaming": true,
                "timeout": 5000
            };
            urllib.request("http://" + node.host + "/ISAPI/Event/notification/alertStream", options, function (err, data, res) {
                if (err) {
                    console.log("MAIN ERROR: " + err);
                }
                try {
                    //console.log("MAIN STATUS: " + res.statusCode);
                } catch (error) {
                }
                try {
                    //console.log("HEADERS: " + res.headers);
                } catch (error) {
                }
                try {
                    //console.log("DATA: " + data.toString());
                } catch (error) {

                }
                res.on('data', function (chunk) {
                    //console.log("chunk: " + chunk.toString());
                    var sRet = chunk.toString();
                    sRet = sRet.substring(sRet.indexOf("<?xml")); // Remove all before <?xml
                    // By xml2js
                    xml2js(sRet, function (err, result) {
                        node.nodeClients.forEach(oClient => {
                            oClient.send({ topic: oClient.topic || "", payload: result });
                        })
                    });


                });
                res.on('end', function () {
                    //console.log("END");
                });

            });
        };


        this.on('close', function (removed, done) {
            done();
        });



        node.on("close", function () {

        })



        node.addClient = (_Node) => {
            // Check if node already exists
            if (node.nodeClients.filter(x => x.id === _Node.id).length === 0) {
                // Add _Node to the clients array
                node.nodeClients.push(_Node)
            }
            try {
                _Node.setNodeStatus({ fill: "gray", shape: "shape", text: "Waiting for connection" });
            } catch (error) {
            }

        }

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
        }



    }



    RED.nodes.registerType("Hikvision-config", Hikvisionconfig, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" }
        }
    });
}
