

module.exports = (RED) => {

    const DigestFetch = require('digest-fetch')
    // const AbortController = require('abort-controller');
    const https = require('https');
    const fs = require('fs');
    const hikvisionDate = require('./utils/dateManagement');
    const { XMLParser } = require("fast-xml-parser");

    function AccessControlConfig(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.port = config.port || 80;
        node.debug = config.host.toString().toLowerCase().indexOf("banana") > -1;
        node.host = config.host.toString().toLowerCase().replace("banana", "") + ":" + node.port;
        node.protocol = config.protocol || "http";
        node.nodeClients = []; // Stores the registered clients
        node.isConnected = true; // Assume it's connected, to signal the disconnection on start
        node.lastACTEventSerialNo = 0; // This contains the evend number. It's an unique counter, that the device gives to the event, to didentify it and check for missing events.
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

        // Read the filters
        const MAJOR_ALARM01 = require('./utils/AccessControlEvents/MAJOR_ALARM-0x1.json');
        const MAJOR_EXCEPTION02 = require('./utils/AccessControlEvents/MAJOR_EXCEPTION-0x2.json');
        const MAJOR_OPERATION03 = require('./utils/AccessControlEvents/MAJOR_OPERATION-0x3.json');
        const MAJOR_EVENT05 = require('./utils/AccessControlEvents/MAJOR_EVENT-0x5.json');


        // Get the infos from the device
        RED.httpAdmin.get("/hikvisionUltimateAccessControlTerminal", RED.auth.needsPermission('AccessControlConfig.read'), function (req, res) {
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
                        RED.log.error("Errore  hikvisionUltimateAccessControlTerminal " + error.message);
                        res.json(error);
                    }

                })();

            } catch (err) {
                res.json(err);
            }
        });

        // Get the infos from the device
        RED.httpAdmin.get("/hikvisionUltimateAccessControlTerminalGetEvents", RED.auth.needsPermission('AccessControlConfig.read'), function (req, res) {
            let majorEvent = Number(req.query.majorevent);// Retrieve major event id
            if (majorEvent === 1) res.json(JSON.stringify(MAJOR_ALARM01));
            if (majorEvent === 2) res.json(JSON.stringify(MAJOR_EXCEPTION02));
            if (majorEvent === 3) res.json(JSON.stringify(MAJOR_OPERATION03));
            if (majorEvent === 5) res.json(JSON.stringify(MAJOR_EVENT05));
        });


        // Function to get the plate list from the camera
        async function getACTEvents() {

            var client;
            if (node.authentication === "digest") client = new DigestFetch(node.credentials.user, node.credentials.password); // Instantiate the fetch client.
            if (node.authentication === "basic") client = new DigestFetch(node.credentials.user, node.credentials.password, { basic: true }); // Instantiate the fetch client.

            // // Add 1 second to the last date
            // var dt = new Date(_lastDateTime);
            // dt.setUTCSeconds(dt.getUTCSeconds() + 1);
            // _lastDateTime = hikvisionDate.toHikvisionISODateString(dt);


            var jSonSearch = {
                "AcsEventCond": {
                    "searchID": node.id.toString() + new Date().toISOString(),
                    "searchResultPosition": 0,
                    "maxResults": 15,
                    "major": 0,
                    "minor": 0,
                    //"startTime": _lastDateTime,
                    //"endTime": "2023-03-18T23:59:59",
                    "timeReverseOrder": true
                }
            };

            controller = new globalThis.AbortController(); // For aborting the stream request
            var options = {
                // These properties are part of the Fetch Standard
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },      // request headers. format is the identical to that accepted by the Headers constructor (see below)
                body: JSON.stringify(jSonSearch),
                redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                signal: controller.signal,       // pass an instance of AbortSignal to optionally abort requests

                // The following properties are node-fetch extensions
                follow: 20,         // maximum redirect count. 0 to not follow redirect
                timeout: 10000,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: node.protocol === "https" ? customHttpsAgent : null        // http(s).Agent instance or function that returns an instance (see below)
            };
            try {
                const response = await client.fetch(node.protocol + "://" + node.host + "/ISAPI/AccessControl/AcsEvent?format=json", options);
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
                    var oEvents = JSON.parse(body.toString());
                    // 31/03/2023 Order by serialNo (because the events are not really ordered by the device)
                    oEvents.AcsEvent.InfoList = oEvents.AcsEvent.InfoList.sort((a, b) => b.serialNo - a.serialNo); // Reverse order
                    // console.log("BANANA AccessControlTerminal: " + sRet);
                    try {

                        // console.log("BANANA GIASONE " + JSON.stringify(oEvents));
                        // Working the plates. Must be sure, that no error occurs, before acknolwedging the plate last picName
                        if (oEvents.AcsEvent !== null && oEvents.AcsEvent !== undefined) {

                            // Send connection OK
                            if (!node.isConnected) {
                                node.nodeClients.forEach(oClient => {
                                    oClient.sendPayload({ topic: oClient.topic || "", errorDescription: "", payload: false });
                                })
                            }
                            node.errorDescription = ""; // Reset the error message
                            node.isConnected = true;

                            return oEvents;


                        } else {
                            // Error in parsing 
                            if (node.debug) RED.log.info("AccessControl-config: Error: oEvents.AcsEvent is null");
                            throw new Error("Error: oEvents.AcsEvent is null");
                        }

                    } catch (error) {
                        if (node.debug) RED.log.warn("AccessControl-config: ERRORE CATCHATO getEvent:" + (error.message || ""));
                        throw new Error("Error getEvent: " + (error.message || ""));
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
                if (controller !== null) {
                    try {
                        controller.abort();
                    } catch (error) { }
                }
                node.isConnected = false;
                return null;
            };

        };

        // 29/03/2023 Return the last serialNo (serialNo is the unique event counter received from the device)
        async function returnMostRecentEventSerialNoFromList(_ACTEvents) {
            // Is there events? 
            try {
                let iRet = Number(_ACTEvents.AcsEvent.InfoList[0].serialNo || 0);
                setTimeout(() => {
                    node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Last event number: " + iRet });
                }, 1000);
                return iRet;
            } catch (error) {
                // Return default
                return 0;
            }
        }



        // At start, reads the last recognized event and starts listening from the time last event was fired.
        node.initACTEventReader = () => {
            (async () => {

                var oEvents = null;
                try {
                    oEvents = await getACTEvents();
                } catch (error) {
                    oEvents = null;
                }

                if (oEvents === null) {
                    setTimeout(node.initACTEventReader, 10000); // Restart initPlateReader
                } else {
                    try {
                        node.lastACTEventSerialNo = await returnMostRecentEventSerialNoFromList(oEvents);
                    } catch (error) {
                        setTimeout(node.initACTEventReader, 10000); // Restart initPlateReader
                        return;
                    }
                    setTimeout(() => node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Waiting for Access events..." }), 2000);
                    setTimeout(node.queryForACTEvents, 2000); // Start main polling thread
                }
            })();
        };

        node.queryForACTEvents = () => {
            (async () => {
                var oEvents = null;
                try {
                    oEvents = await getACTEvents();
                } catch (error) {
                    oEvents = null;
                }

                if (oEvents === null) {
                    // An error was occurred.
                    setTimeout(node.initACTEventReader, 10000); // Restart initPlateReader from scratch
                } else {
                    if (oEvents.AcsEvent.hasOwnProperty("InfoList")) {
                        if (Array.isArray(oEvents.AcsEvent.InfoList) && oEvents.AcsEvent.InfoList.length > 0) {
                            // Send the message to the child nodes
                            for (let index = oEvents.AcsEvent.InfoList.length - 1; index >= 0; index--) {
                                let oACTCurrentEvent = oEvents.AcsEvent.InfoList[index];
                                if (node.lastACTEventSerialNo < Number(oACTCurrentEvent.serialNo || 0)) { // Get only events past the last
                                    // Set the last serialNo (serialNo is the unique event counter received from the device)
                                    node.lastACTEventSerialNo = Number(oACTCurrentEvent.serialNo || 0);

                                    // 29/03/2023 Add event descriptor
                                    try {
                                        let majorEvent = Number(oACTCurrentEvent.major);// Retrieve major event id
                                        let minorEvent = parseInt(oACTCurrentEvent.minor).toString(16);// Retrieve major event id
                                        let jDesc = {};
                                        let descMajor = "";
                                        let descMinor = "";
                                        if (majorEvent === 1) jDesc = MAJOR_ALARM01; descMajor = "ALARM";
                                        if (majorEvent === 2) jDesc = MAJOR_EXCEPTION02; descMajor = "EXCEPTION";
                                        if (majorEvent === 3) jDesc = MAJOR_OPERATION03; descMajor = "OPERATION";
                                        if (majorEvent === 5) jDesc = MAJOR_EVENT05; descMajor = "EVENT";
                                        descMinor = jDesc.find(a => a.Value === '0x' + minorEvent).Description;
                                        oACTCurrentEvent.eventDescription = '(' + descMajor + ') ' + descMinor;
                                    } catch (error) {
                                        oACTCurrentEvent.eventDescription = "unknown event: " + error.message;
                                    }
                                    node.nodeClients.forEach(oClient => {
                                        oClient.sendPayload({ topic: oClient.topic || "", payload: oACTCurrentEvent, connected: true });
                                    })
                                } else {
                                    if (node.debug) RED.log.info("AccessControl-config: Discarded old event in oEvents.AcsEvent.InfoList:" + JSON.stringify(oACTCurrentEvent));
                                }
                            }
                        }
                    } else {
                        // No new events found
                    }
                    setTimeout(node.queryForACTEvents, 2000); // Call the function again.
                }
            })();

        };

        // Start!
        setTimeout(node.initACTEventReader, 10000); // First connection.
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


    RED.nodes.registerType("AccessControl-config", AccessControlConfig, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" }
        }
    });
}
