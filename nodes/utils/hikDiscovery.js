// Search all devicees on the lan
// <?xml version="1.0" encoding="utf-8"?><Probe><Types>inquiry</Types></Probe>
// 239.255.255.250
// Port 37020
// Protocol: UDP
const ipAddress = require('./ipAddressHelper')
const { XMLParser } = require("fast-xml-parser");
const parser = new XMLParser();


//Multicast Client receiving sent messages
exports.Discover = async function getAllHikvisionDevicesDescriptors(timeoutMs = 2500) {
    return new Promise(function (resolve, reject) {
        const MCAST_PORT = 37020;
        const MCAST_ADDR = "239.255.255.250"; //same mcast address as Server
        let HOST = ''; //this is your own IP
        const discoMSG = '<?xml version="1.0" encoding="utf-8"?><Probe><Types>inquiry</Types></Probe>';
        const aDevices = [];
        let client = null;
        let completed = false;

        function finish(devices) {
            if (completed) return;
            completed = true;
            try {
                if (client) {
                    try {
                        client.dropMembership(MCAST_ADDR);
                    } catch (error) {
                    }
                    client.close();
                }
            } catch (error) {
            }
            resolve(devices);
        }

        try {
            HOST = ipAddress.getLocalAddress();
        } catch (error) {

        }
        try {
            const dgram = require('dgram');
            client = dgram.createSocket({ type: 'udp4', reuseAddr: true });

            client.on('listening', function () {
                let currentAddress = client.address();
                //console.log('UDP Client listening on ' + currentAddress.address + ":" + currentAddress.port);
                try {
                    client.setBroadcast(true)
                    client.setMulticastTTL(128);
                    client.addMembership(MCAST_ADDR, HOST || undefined);
                } catch (error) {
                    try {
                        client.addMembership(MCAST_ADDR);
                    } catch (error) {
                    }
                }

                let b = Buffer.from(discoMSG);
                client.send(b, 0, b.length, MCAST_PORT, MCAST_ADDR, function () {
                    //console.log("Sent " + b);
                });
            });

            client.on('message', function (message, remote) {

                try {

                    let jObj = parser.parse(message.toString());
                    if (jObj.hasOwnProperty("ProbeMatch")) {
                        const deviceKey = (jObj.ProbeMatch.IPv4Address || "") + "|" + (jObj.ProbeMatch.MAC || jObj.ProbeMatch.MACAddress || "");
                        if (aDevices.find(a => ((a.IPv4Address || "") + "|" + (a.MAC || a.MACAddress || "")) === deviceKey) === undefined) {
                            aDevices.push(jObj.ProbeMatch);
                        }
                    }

                } catch (error) {
                    console.log('getAllHikvisionDevicesDescriptors: From: ' + remote.address + ':' + remote.port + ' - ' + error.message);
                }

            });

            client.on('error', function () {
                finish(aDevices);
            });

            client.bind(MCAST_PORT);

            // Set timeout timer
            setTimeout(() => {
                finish(aDevices);
            }, timeoutMs);
        } catch (error) {
            resolve(aDevices);
        }

    })

}




