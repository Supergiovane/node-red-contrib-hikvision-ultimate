const { default: fetch } = require('node-fetch')
const sha256 = require('./utils/Sha256').sha256
const { XMLParser, XMLBuilder } = require("fast-xml-parser");

module.exports = (RED) => {

    const DigestFetch = require('digest-fetch'); // 04/6/2022 DO NOT UPGRADE TO NODE-FETCH V3, BECAUSE DIGEST-FETCH DOESN'T SUPPORT IT
    const AbortController = require('abort-controller');
    const readableStr = require('stream').Readable;
    const https = require('https');

    function Hikvisionconfig(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.port = config.port || 80;
        node.debug = config.host.toString().toLowerCase().indexOf("banana") > -1;
        node.host = config.host.toString().toLowerCase().replace("banana", "") + ":" + node.port;
        node.protocol = config.protocol || "http";
        node.nodeClients = []; // Stores the registered clients
        node.isConnected = true; // Assumes, that is already connected.
        node.timerCheckHeartBeat = null;
        node.timerReadZonesStatus = null;
        node.errorDescription = ""; // Contains the error description in case of connection error.
        node.authentication = config.authentication || "sha256-salted";
        node.deviceinfo = config.deviceinfo || {};
        node.heartBeatTimerDisconnectionCounter = 0;
        node.heartbeattimerdisconnectionlimit = config.heartbeattimerdisconnectionlimit || 2;
        node.authCookie = '' // Contains the usable cookie for the authenticaded sessione
        node.optionsAlarmStream = {}
        node.clientAlarmStream = undefined

        var controller = null; // AbortController
        var oReadable = new readableStr();
        node.setAllClientsStatus = ({ fill, shape, text }) => {
            function nextStatus(oClient) {
                oClient.setNodeStatus({ fill: fill, shape: shape, text: text })
            }
            node.nodeClients.map(nextStatus);
        }
        // 14/07/2021 custom agent as global variable, to avoid issue with self signed certificates
        const customHttpsAgent = new https.Agent({
            rejectUnauthorized: false
        });


        // This function starts the heartbeat timer, to detect the disconnection from the server
        node.resetHeartBeatTimer = () => {
            // Reset node.timerCheckHeartBeat
            if (node.timerCheckHeartBeat !== null) clearTimeout(node.timerCheckHeartBeat);
            node.timerCheckHeartBeat = setTimeout(() => {
                node.heartBeatTimerDisconnectionCounter += 1;
                if (node.heartBeatTimerDisconnectionCounter < node.heartbeattimerdisconnectionlimit) {
                    // 28/12/2020 Retry again until connection attempt limit reached
                    node.setAllClientsStatus({ fill: "yellow", shape: "ring", text: "Temporary lost connection. Attempt " + node.heartBeatTimerDisconnectionCounter + " of " + node.heartbeattimerdisconnectionlimit });
                    if (controller !== null) {
                        try {
                            controller.abort();
                        } catch (error) { }
                    }
                    setTimeout(startAlarmStream, 1000); // Reconnect
                } else {
                    // 28/12/2020 Connection attempt limit reached
                    node.heartBeatTimerDisconnectionCounter = 0;
                    if (node.isConnected) {
                        if (node.errorDescription === "") node.errorDescription = "Timeout waiting heartbeat"; // In case of timeout of a stream, there is no error throwed.
                        node.nodeClients.forEach(oClient => {
                            oClient.sendPayload({ topic: oClient.topic || "", errorDescription: node.errorDescription, payload: true });
                        });
                        node.setAllClientsStatus({ fill: "red", shape: "ring", text: "Lost connection...Retry... " + node.errorDescription });
                    }
                    if (controller !== null) {
                        try {
                            controller.abort();
                        } catch (error) { }
                    }
                    node.isConnected = false;
                    setTimeout(startAlarmStream, 1000); // Reconnect
                }
            }, 40000);
        }

        // 22/12/2022 sha salt password encoder
        function encodePassword(bodyAuthJsonData, _username, _password) {
            let result = ''
            if (bodyAuthJsonData.isIrreversible) {
                result = sha256(_username + bodyAuthJsonData.salt + _password)
                result = sha256(_username + bodyAuthJsonData.salt2 + result)
                result = sha256(result + bodyAuthJsonData.challenge)

                for (let f = 2; bodyAuthJsonData.iterations > f; f++) {
                    result = sha256(result)
                }
            } else {
                result = sha256(_password) + bodyAuthJsonData.challenge
                for (let f = 1; bodyAuthJsonData.iterations > f; f++) {
                    result = sha256(result)
                }
            }
            return result
        }




        //#region ALARMSTREAM
        async function startAlarmStream() {

            node.resetHeartBeatTimer(); // First thing, start the heartbeat timer.
            node.setAllClientsStatus({ fill: "grey", shape: "ring", text: "Connecting..." });
            if (node.authentication === "sha256-salted") node.clientAlarmStream = new DigestFetch("", "", { basic: true }); // Instantiate the fetch client.

            // 22/12/2022 Start auth process
            // ##################################
            // Getting challenge and salt; something like this
            // <SessionLoginCap xmlns="http://www.hikvision.com/ver20/XMLSchema" version="2.0">
            // <sessionID>
            //  bb1eBANANb536161edf6894e5RAMA
            // </sessionID>
            // <challenge>2348972394Mychallenge</challenge>
            // <iterations>100</iterations>
            // <isSupportRTSPWithSession>true</isSupportRTSPWithSession>
            // <isIrreversible>true</isIrreversible>
            // <sessionIDVersion>2.1</sessionIDVersion>
            // <salt>
            //  234DFSDFS4564DGDFGDFGD456456
            // </salt>
            // <salt2>
            //  234DFSDFS453453453453453453DFGDFGDFG64DGDFGDFGD456456
            // </salt2>
            // </SessionLoginCap>


            controller = new AbortController(); // For aborting the stream request
            node.optionsAlarmStream = {
                // These properties are part of the Fetch Standard
                method: 'GET',
                headers: {},        // request headers. format is the identical to that accepted by the Headers constructor (see below)
                body: null,         // request body. can be null, a string, a Buffer, a Blob, or a Node.js Readable stream
                redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                signal: controller.signal,       // pass an instance of AbortSignal to optionally abort requests

                // The following properties are node-fetch extensions
                follow: 20,         // maximum redirect count. 0 to not follow redirect
                timeout: 0,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                compress: false,     // support gzip/deflate content encoding. false to disable
                size: 0,            // maximum response body size in bytes. 0 to disable
                agent: node.protocol === "https" ? customHttpsAgent : null
            };


            try {


                const responseAuth = await node.clientAlarmStream.fetch(node.protocol + "://" + node.host + "/ISAPI/Security/sessionLogin/capabilities?username=" + node.credentials.user, node.optionsAlarmStream)
                if (responseAuth.status >= 200 && responseAuth.status <= 300) {
                    node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Communication established" });
                } else {
                    node.setAllClientsStatus({ fill: "red", shape: "ring", text: responseAuth.statusText || " unknown response code" });
                    //  if (node.debug)  RED.log.error("BANANA Error response " + response.statusText);
                    node.errorDescription = "StatusResponse problem " + (responseAuth.statusText || " unknown status response code");
                }
                // Get the XML Body of the salt and challenge
                const XMLBody = await responseAuth.text()
                // Transform it into Json
                const parser = new XMLParser();
                let result = parser.parse(XMLBody);
                const jSon = JSON.parse(JSON.stringify(result))
                if (node.debug) RED.log.error("BANANA SBANANATO XMLBoduAuth -> JSON " + JSON.stringify(result));

                // jSon now contains the body in JSON Format. The simple thing is done.
                // Now i need to authenticate
                let bodyAuth = {
                    sessionId: jSon.SessionLoginCap.sessionID,
                    challenge: jSon.SessionLoginCap.challenge,
                    iterations: jSon.SessionLoginCap.iterations,
                    isIrreversible: jSon.SessionLoginCap.isIrreversible,
                    salt: jSon.SessionLoginCap.salt || '',
                    salt2: jSon.SessionLoginCap.salt2 || ''
                }
                // Finally, i've got the encoded salted password
                // Do not put Spaghetti in the cold water. Please be sure that water is warm and it's boiling.
                const encodedPassword = encodePassword(bodyAuth, node.credentials.user, node.credentials.password)
                // Build the XML body to pass to the alarm panel to login.
                // const xml2jsEngine = require('xml2js')
                // const XMLbuilder = new xml2jsEngine.Builder({
                //     headless: true,
                //     renderOpts: {
                //         pretty: false
                //     }
                // })

                // const XMLparser = new xml2jsEngine.Parser({
                //     attrkey: 'attr',
                //     charkey: 'value',
                //     explicitArray: false,
                //     attrValueProcessors: [
                //         parseNumbers, parseBooleans
                //     ],
                //     valueProcessors: [
                //         parseNumbers, parseBooleans
                //     ]
                // })
                const jSonAuthSendBody = {
                    SessionLogin: {
                        userName: node.credentials.user,
                        password: encodedPassword,
                        sessionID: jSon.SessionLoginCap.sessionID,
                        isSessionIDValidLongTerm: false,
                        sessionIDVersion: 2.1
                    }
                }
                // Send the body to the alarm panel.
                //node.optionsAlarmStream.body = XMLbuilder.buildObject(jSonAuthSendBody)
                const XML_Builder = new XMLBuilder({});
                node.optionsAlarmStream.body = XML_Builder.build(jSonAuthSendBody);

                node.optionsAlarmStream.method = 'POST'
                const responseSessionLogin = await node.clientAlarmStream.fetch(node.protocol + '://' + node.host + '/ISAPI/Security/sessionLogin?timeStamp=' + Date.now(), node.optionsAlarmStream)
                if (responseSessionLogin.status !== 200) throw Error('AXPro POST Auth: ' + responseSessionLogin.statusText);
                // Set the coockie session for this authenticated connection
                node.authCookie = responseSessionLogin.headers.get('set-cookie').split(';')[0]

            } catch (error) {
                node.setAllClientsStatus({ fill: "red", shape: "ring", text: error.message });
                node.errorDescription = "Authentication problem " + error.message;
            }


            try {
                //#region "HANDLE STREAM MESSAGE"
                // Handle the complete stream message, enclosed into the --boundary stream string
                // If there is more boundary, process each one separately
                // ###################################
                async function handleChunk(result) {
                    try {
                        // 05/12/2020 process the data
                        var aResults = result.split("--boundary");
                        if (node.debug) RED.log.info("SPLITTATO RESULT COUNT: ####### " + aResults.length + " ###################### FINE SPLITTATO RESULT");
                        aResults.forEach(async sRet => {
                            if (sRet.trim() !== "") {
                                if (node.debug) RED.log.error("BANANA PROCESSING" + sRet);
                                try {
                                    //sRet = sRet.replace(/--boundary/g, '');
                                    var i = sRet.indexOf("<"); // Get only the XML, starting with "<"
                                    if (i > -1) {
                                        sRet = sRet.substring(i);

                                        try {
                                            const parser = new XMLParser();
                                            let result = parser.parse(sRet);
                                            if (node.debug) RED.log.error("BANANA SBANANATO XML -> JSON " + JSON.stringify(result));
                                            if (result !== null && result !== undefined && result.hasOwnProperty("EventNotificationAlert")) {
                                                node.nodeClients.forEach(oClient => {
                                                    if (result !== undefined) oClient.sendPayload({ topic: oClient.topic || "", payload: result.EventNotificationAlert });
                                                });
                                            }
                                        } catch (error) {
                                            sRet = "";
                                            if (node.debug) RED.log.error("BANANA ERRORE fast-xml-parser(sRet, function (err, result) " + error.message || "");
                                        }

                                    } else {
                                        i = sRet.indexOf("{") // It's a Json
                                        if (i > -1) {
                                            if (node.debug) RED.log.error("BANANA SBANANATO JSON " + sRet);
                                            sRet = sRet.substring(i);
                                            try {
                                                sRet = JSON.parse(sRet);
                                                //  if (node.debug)  RED.log.error("BANANA JSONATO: " + sRet);
                                                if (sRet !== null && sRet !== undefined) {
                                                    node.nodeClients.forEach(oClient => {
                                                        oClient.sendPayload({ topic: oClient.topic || "", payload: sRet });
                                                    })
                                                }
                                            } catch (error) {
                                                sRet = "";
                                            }
                                        } else {
                                            // Invalid body
                                            if (node.debug) RED.log.info("AXPro-config: DecodingBody Info only: Invalid Json " + sRet);
                                        }
                                    }
                                    // All is fine. Reset and restart the hearbeat timer
                                    // Hikvision sends an heartbeat alarm (videoloss), depending on firmware, every 300ms or more.
                                    // If this HeartBeat isn't received, abort the stream request and restart.
                                    node.resetHeartBeatTimer();
                                } catch (error) {
                                    //  if (node.debug) RED.log.error("BANANA startAlarmStream decodifica body: " + error);
                                    if (node.debug) RED.log.error("AXPro-config: DecodingBody error: " + (error.message || " unknown error"));
                                    throw (error);
                                }
                            } else {
                                if (node.debug) RED.log.info("SPLITTATO RESULT EMPTY: ####### " + sRet + " ###################### FINE SPLITTATO RESULT");
                            }
                        });


                    } catch (error) {
                        if (node.debug) RED.log.info("AXPro-config: readStream error: " + (error.message || " unknown error"));
                        node.errorDescription = "readStream error " + (error.message || " unknown error");
                        throw (error);
                    }
                }
                // ###################################
                //#endregion


                node.optionsAlarmStream.method = 'GET'
                delete (node.optionsAlarmStream.Authorization)
                delete (node.optionsAlarmStream.body)
                node.optionsAlarmStream.headers = { Cookie: node.authCookie }

                const responseFromAxProAlarmStream = await node.clientAlarmStream.fetch(node.protocol + "://" + node.host + "/ISAPI/Event/notification/alertStream", node.optionsAlarmStream);
                if (responseFromAxProAlarmStream.status >= 200 && responseFromAxProAlarmStream.status <= 300) {
                    node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Waiting for event." });
                } else {
                    node.setAllClientsStatus({ fill: "red", shape: "ring", text: responseFromAxProAlarmStream.statusText || " unknown response code" });
                    //  if (node.debug)  RED.log.error("BANANA Error response " + response.statusText);
                    node.errorDescription = "StatusResponse problem " + (responseFromAxProAlarmStream.statusText || " unknown status response code");
                    throw new Error("StatusResponse " + (responseFromAxProAlarmStream.statusText || " unknown response code"));
                }
                if (responseFromAxProAlarmStream.ok) {
                    if (!node.isConnected) {
                        node.setAllClientsStatus({ fill: "green", shape: "ring", text: "Connected." });
                        node.nodeClients.forEach(oClient => {
                            oClient.sendPayload({ topic: oClient.topic || "", errorDescription: "", payload: false });
                        })
                        node.errorDescription = ""; // Reset the error
                    }
                    node.isConnected = true;
                    try {
                        if (node.debug) RED.log.info("AXPro-config: before Pipelining...");
                        if (oReadable !== null) oReadable.removeAllListeners() // 09/01/2023
                        oReadable = readableStr.from(responseFromAxProAlarmStream.body, { encoding: 'utf8' });
                        var result = "";
                        oReadable.on('data', async (chunk) => {
                            result += chunk;
                            if (result.indexOf("--boundary") > -1) {

                                // 11/01/2022 let's do some other checks on the event stream text
                                let bMessageCanBeHandled = false;
                                if (result.includes("</EventNotificationAlert>")) {
                                    // Is the XML
                                    bMessageCanBeHandled = true;
                                } else if (result.includes("}")) {
                                    // Should be the JSON
                                    bMessageCanBeHandled = true;
                                }

                                if (bMessageCanBeHandled) {
                                    try {
                                        await handleChunk(result);
                                    } catch (error) {
                                        if (node.debug) RED.log.info("AXPro-config: Error handleChunk " + error.message || "");
                                    }
                                    result = "";
                                }
                            }
                        });
                        oReadable.on('end', function () {
                            // For some reason, some NVRs do end the stream. I must restart it.
                            if (node.debug) RED.log.info("AXPro-config: streamPipeline: STREAMING HAS ENDED.");
                            startAlarmStream();
                        });

                        oReadable.on('error', function (error) {
                            if (node.debug) RED.log.error("AXPro-config: streamPipeline: " + (error.message || " unknown error"));
                        });

                        //await streamPipeline(response.body, readStream);
                    } catch (error) {
                        if (node.debug) RED.log.error("AXPro-config: streamPipeline: Please be sure to have the latest Node.JS version installed: " + (error.message || " unknown error"));
                    }

                }

            } catch (error) {
                // Main Error
                // Abort request
                //node.errorDescription = "Fetch error " + JSON.stringify(error, Object.getOwnPropertyNames(error));
                node.errorDescription = "Fetch error " + (error.message || " unknown error");
                if (node.debug) RED.log.error("AXPro-config: FETCH ERROR: " + (error.message || " unknown error"));
            };
            // Starts zone polling
            clearTimeout(node.timerReadZonesStatus)
            node.timerReadZonesStatus = setTimeout(startZonesStatusReading, 2000)
        };
        // Start login and alamrstream
        setTimeout(startAlarmStream, 5000)

        //#endregion

        // Read zones status and outputs only changed ones
        // Wrapping the async function, for peace of mind
        async function startZonesStatusReading() {
            try {

                let optionsZonesStatusReading = {
                    // These properties are part of the Fetch Standard
                    method: 'GET',
                    headers: { Cookie: node.authCookie },        // request headers. format is the identical to that accepted by the Headers constructor (see below)
                    body: null,         // request body. can be null, a string, a Buffer, a Blob, or a Node.js Readable stream
                    redirect: 'follow', // set to `manual` to extract redirect headers, `error` to reject redirect
                    //signal: controller.signal,       // pass an instance of AbortSignal to optionally abort requests

                    // The following properties are node-fetch extensions
                    follow: 20,         // maximum redirect count. 0 to not follow redirect
                    timeout: 0,         // req/res timeout in ms, it resets on redirect. 0 to disable (OS limit applies). Signal is recommended instead.
                    compress: false,     // support gzip/deflate content encoding. false to disable
                    size: 0,            // maximum response body size in bytes. 0 to disable
                    agent: node.protocol === "https" ? customHttpsAgent : null
                };
                try {
                    delete (optionsZonesStatusReading.body)
                    const responseZonesStatus = await node.clientAlarmStream.fetch(node.protocol + "://" + node.host + "/ISAPI/SecurityCP/status/zones?format=json", optionsZonesStatusReading)
                    if (responseZonesStatus.status >= 200 && responseZonesStatus.status <= 300) {
                        // Output only the changed zone
                        // Get the XML Body of the salt and challenge
                        const result = await responseZonesStatus.text()
                        const jSon = JSON.parse(result)
                        node.nodeClients.forEach(oClient => {
                            oClient.sendPayload({ topic: oClient.topic || "", payload: { ZoneList: jSon.ZoneList } });
                        })
                    } else {
                        node.setAllClientsStatus({ fill: "red", shape: "ring", text: responseZonesStatus.statusText || " unknown response code" });
                        //  if (node.debug)  RED.log.error("BANANA Error response " + response.statusText);
                        node.errorDescription = "StatusResponse problem " + (responseZonesStatus.statusText || " unknown status response code");
                    }

                } catch (error) {
                    node.setAllClientsStatus({ fill: "red", shape: "ring", text: "Unable to fetch zone state " + error.message });
                }
                node.timerReadZonesStatus = setTimeout(startZonesStatusReading, 2000)
            } catch (error) { }
        }


        //#region "FUNCTIONS"
        node.on('close', function (removed, done) {
            if (controller !== null) {
                try {
                    controller.abort();
                } catch (error) { }
            }
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
            //if (node.debug) RED.log.info( "BEFORE Node " + _Node.id + " has been unsubscribed from receiving KNX messages. " + node.nodeClients.length);
            try {
                node.nodeClients = node.nodeClients.filter(x => x.id !== _Node.id)
            } catch (error) { }
        };
        //#endregion


        // Disarm Area
        node.disarmArea = async function (_area) {
            try {
                _area = Number(_area)
                let sURL = '/ISAPI/SecurityCP/control/disarm/' + _area + '?format=json'
                node.optionsAlarmStream.method = 'PUT'
                delete (node.optionsAlarmStream.body)
                await node.clientAlarmStream.fetch(node.protocol + "://" + node.host + sURL, node.optionsAlarmStream);
            } catch (error) {
                node.errorDescription = "control/disarm " + (error.message || " unknown error");
                if (node.debug) RED.log.error("AXPro-config: control/disarm: " + (error.message || " unknown error"));
            }
        }
        // Arm Away Area
        node.armAwayArea = async function (_area) {
            try {
                _area = Number(_area)
                let sURL = '/ISAPI/SecurityCP/control/arm/' + _area + '?ways=away&format=json'
                node.optionsAlarmStream.method = 'PUT'
                delete (node.optionsAlarmStream.body)
                await node.clientAlarmStream.fetch(node.protocol + "://" + node.host + sURL, node.optionsAlarmStream);
            } catch (error) {
                node.errorDescription = "control/arm " + (error.message || " unknown error");
                if (node.debug) RED.log.error("AXPro-config: control/arm: " + (error.message || " unknown error"));
            }
        }
        // Arm Stay Area
        node.armStayArea = async function (_area) {
            try {
                _area = Number(_area)
                let sURL = '/ISAPI/SecurityCP/control/arm/' + _area + '?ways=stay&format=json'
                node.optionsAlarmStream.method = 'PUT'
                delete (node.optionsAlarmStream.body)
                await node.clientAlarmStream.fetch(node.protocol + "://" + node.host + sURL, node.optionsAlarmStream);
            } catch (error) {
                node.errorDescription = "control/armStay" + (error.message || " unknown error");
                if (node.debug) RED.log.error("AXPro-config: control/armStay: " + (error.message || " unknown error"));
            }
        }
        // Clear Alarm Area
        node.clearAlarmArea = async function (_area) {
            try {
                _area = Number(_area)
                let sURL = '/ISAPI/SecurityCP/control/clearAlarm/' + _area + '?format=json'
                node.optionsAlarmStream.method = 'PUT'
                delete (node.optionsAlarmStream.body)
                await node.clientAlarmStream.fetch(node.protocol + "://" + node.host + sURL, node.optionsAlarmStream);
            } catch (error) {
                node.errorDescription = "control/clearAlarm" + (error.message || " unknown error");
                if (node.debug) RED.log.error("AXPro-config: control/clearAlarm: " + (error.message || " unknown error"));
            }
        }



    }





    RED.nodes.registerType("AXPro-config", Hikvisionconfig, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" }
        }
    });


}




