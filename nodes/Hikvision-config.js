

module.exports = (RED) => {

    var urllib = require('urllib');
    var xml2js = require('xml2js').parseString;

    function Hikvisionconfig(config) {
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


            } catch (error) {

            }
            res.on('data', function (chunk) {
                console.log("chunk: " + chunk.toString());
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
                console.log("END");
                done();
            });

        });


        this.on('input', function (msg) {

            node.setNodeStatus({ fill: "green", shape: "ring", text: "banana" });
        });

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

        // Used to call the status update from the config node.
        node.setNodeStatus = ({ fill, shape, text }) => {
            if (node.server == null) { node.status({ fill: "red", shape: "dot", text: "[NO SERVER SELECTED]" }); return; }
            var dDate = new Date();
            node.status({ fill: fill, shape: shape, text: text + "(" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" });
        }



    }



    RED.nodes.registerType("Hikvision-config", Hikvisionconfig, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" }
        }
    });
}
