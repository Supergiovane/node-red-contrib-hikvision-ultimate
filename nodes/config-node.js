

module.exports = (RED) => {



    function confignode(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.host = config.host
        node.port = config.port
        node.nodeClients = [] // Stores the registered clients

        var options = {
            "digestAuth": node.credentials.user + ":" + node.credentials.password,
            "streaming": true,
            "timeout": 5000
        };
        urllib.request("http://" + node.host + "/ISAPI/Event/notification/alertStream", options, function (err, data, res) {
            if (err) {
                console.log("ERROR: " + err);
            }
            try {
                console.log("STATUS: " + res.statusCode);
            } catch (error) {
            }
            try {
                console.log("HEADERS: " + res.headers);
            } catch (error) {
            }
            try {
                console.log("DATA: " + data.toString());
                node.nodeClients
                    .forEach(oClient => {
                        oClient.send({ topic:oClient.topic || "", payload: chunk.toString() });
                    })
                
            } catch (error) {

            }
            res.on('data', function (chunk) {
                console.log("chunk: " + chunk.toString());
                setNodeStatus({ fill: "green", shape: "ring", text: "Rx chunk" });
                
            });
            res.on('end', function () {
                console.log("END");
                done();
            });

        });


        this.on('input', function (msg) {

            setNodeStatus({ fill: "green", shape: "ring", text: "banana" });
        });

        this.on('close', function (removed, done) {

            done();
        });



        node.on("close", function () {
            if (node.timerSendTelegramFromQueue !== undefined) clearInterval(node.timerSendTelegramFromQueue); // 02/01/2020 Stop queue timer
            node.Disconnect();
        })



        node.addClient = (_Node) => {
            // Check if node already exists
            if (node.nodeClients.filter(x => x.id === _Node.id).length === 0) {
                // Check if the node has a valid topic and dpt
                if (_Node.listenallga == false) {
                    if (typeof _Node.topic == "undefined" || typeof _Node.dpt == "undefined") {
                        _Node.setNodeStatus({ fill: "red", shape: "dot", text: "Empty Group Addr. or datapoint.", payload: "", GA: "", dpt: "", devicename: "" })
                        return;
                    } else {
                        // topic must be in formar x/x/x
                        if (_Node.topic.split("\/").length < 3) {
                            _Node.setNodeStatus({ fill: "red", shape: "dot", text: "Wrong group address (topic: " + _Node.topic + ") format.", payload: "", GA: "", dpt: "", devicename: "" })
                            return;
                        }
                    }
                }
                // Add _Node to the clients array
                node.nodeClients.push(_Node)
            }
            // At first node client connection, this node connects to the bus
            if (node.nodeClients.length === 1) {
                // 14/08/2018 Initialize the connection
                try {
                    node.initKNXConnection();
                } catch (error) {

                }
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
                node.Disconnect();
            }
        }

    }



    RED.nodes.registerType("config-node", confignode, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" }
        }
    });
}
