// Search all devicees on the lan
// <?xml version="1.0" encoding="utf-8"?><Probe><Types>inquiry</Types></Probe>
// 239.255.255.250
// Port 37020
// Protocol: UDP
const ipAddress = require('./ipAddressHelper')
const { XMLParser } = require("fast-xml-parser");
const parser = new XMLParser();
var aDevices = new Array(); // Devices to return


//Multicast Client receiving sent messages
exports.Discover = async function getAllHikvisionDevicesDescriptors() {
    return new Promise(function (resolve, reject) {
        const MCAST_PORT = 37020;
        const MCAST_ADDR = "239.255.255.250"; //same mcast address as Server
        let HOST = ''; //this is your own IP
        const discoMSG = '<?xml version="1.0" encoding="utf-8"?><Probe><Types>inquiry</Types></Probe>';
        try {
            HOST = ipAddress.getLocalAddress();
        } catch (error) {

        }
        try {
            const dgram = require('dgram');
            const client = dgram.createSocket({ type: 'udp4', reuseAddr: true });

            client.on('listening', function () {
                let currentAddress = client.address();
                //console.log('UDP Client listening on ' + currentAddress.address + ":" + currentAddress.port);
                client.setBroadcast(true)
                client.setMulticastTTL(128);
                client.addMembership(MCAST_ADDR);
            });

            client.on('message', function (message, remote) {

                try {

                    let jObj = parser.parse(message.toString());
                    if (jObj.hasOwnProperty("ProbeMatch")) {
                        if (aDevices.find(a => a.IPv4Address === jObj.ProbeMatch.IPv4Address) === undefined) {
                            aDevices.push(jObj.ProbeMatch);
                        }
                    }

                } catch (error) {
                    reject([]);
                    console.log('getAllHikvisionDevicesDescriptors: From: ' + remote.address + ':' + remote.port + ' - ' + error.message);
                }

            });

            client.bind(MCAST_PORT);

            // Send query message
            setTimeout(() => {
                let b = Buffer.from(discoMSG);
                client.send(b, 0, b.length, MCAST_PORT, MCAST_ADDR, function () {
                    //console.log("Sent " + b);
                });
            }, 10);

            // Set timeout timer
            setTimeout(() => {
                try {
                    client.dropMembership(MCAST_ADDR);
                    client.close();
                    client.disconnect();
                } catch (error) {
                }
                resolve(aDevices);
            }, 2000);
        } catch (error) {

        }

    })

}





