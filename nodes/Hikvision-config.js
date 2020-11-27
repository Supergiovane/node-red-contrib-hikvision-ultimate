

module.exports = (RED) => {

    const urllib = require('urllib');
    var Agent = require('agentkeepalive');
    const xml2js = require('xml2js').parseString;


    function Hikvisionconfig(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.host = config.host;
        node.port = config.port;
        node.nodeClients = []; // Stores the registered clients
        node.isConnected = false;

        node.startAlarmStream = () => {

            node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Connecting..." });

            var keepaliveAgent = new Agent({
                keepAlive: true
            });
            var options = {
                "digestAuth": node.credentials.user + ":" + node.credentials.password,
                "streaming": true,
                "agent": keepaliveAgent
            };
            node.urllibRequest = urllib.request("http://" + node.host + "/ISAPI/Event/notification/alertStream", options, function (err, data, res) {
                if (err) {
                    console.log("MAIN ERROR: " + err);
                    node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Server unreachable. Retry..." });
                    if (node.isConnected) {
                        node.nodeClients.forEach(oClient => {
                            oClient.sendPayload({ topic: oClient.topic || "", payload: null, connected: false });
                        })
                    }
                    node.isConnected = false;
                    setTimeout(node.startAlarmStream, 10000); // Reconnect
                    return;
                }
                
                res.on('data', function (chunk) {
                    node.isConnected = true;
                    try {
                        var sRet = chunk.toString();
                        sRet = sRet.substring(sRet.indexOf("<")); // Get only the XML, starting with "<"
                        // By xml2js
                        xml2js(sRet, function (err, result) {
                            node.nodeClients.forEach(oClient => {
                                if (result !== undefined) oClient.sendPayload({ topic: oClient.topic || "", payload: result, connected: true });
                            })
                        });
                    } catch (error) { console.log("ERRORE CATCHATO " + error); }

                });
                res.on('end', function () {
                    console.log("END");
                });
                res.on('close', function () {
                    console.log("CLOSE");
                    node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Disconnected. Retry..." });
                    if (node.isConnected) {
                        node.nodeClients.forEach(oClient => {
                            oClient.sendPayload({ topic: oClient.topic || "", payload: null, connected: false });
                        });
                    }
                    node.isConnected = false;
                    setTimeout(node.startAlarmStream, 10000); // Reconnect
                });
                res.on('error', function (err) {
                    console.log("ERROR: " + err);
                });


            });
        };

        setTimeout(node.startAlarmStream, 5000); // First connection.


        //#region "FUNCTIONS"
        node.on('close', function (removed, done) {
            done();
        });

        node.setAllClientsStatus = ({ fill, shape, text }) => {
            function nextStatus(oClient) {
                oClient.setNodeStatus({ fill: fill, shape: shape, text: text })
            }
            node.nodeClients.map(nextStatus);
        }

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
