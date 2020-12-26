var http = require('http');
var url = require('url');
var fs = require('fs');

console.log("NODE.JS Server started on port 8080 for collectiong things from my node-red nodes");

//create a server object:
http.createServer(function (req, res) {
    // Get the string
    var convertedStartDate = new Date();
    var month = convertedStartDate.getMonth() + 1
    var day = convertedStartDate.getDate();
    var year = convertedStartDate.getFullYear();
    var shortStartDate = day + "/" + month + "/" + year;

    const sFilePath = "c:\\web\\nodejs\\hik.txt";
    if (!fs.existsSync(sFilePath)) fs.writeFileSync(sFilePath, "NEW LIST CREATED ON " + shortStartDate + "<br/><br/>");
    var sFileContent = fs.readFileSync(sFilePath, "utf8");
    var q = url.parse(req.url, true).query;
    console.log(shortStartDate + " Received: " + JSON.stringify(q) + " from: " + req.connection.remoteAddress);
    if (q.md === undefined || q.fw === undefined || q.nodeid === undefined || q.read === undefined) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write("<b>Sorry but... who are you? An Hacker i suppose</b>.<br/>There is nothing here for you, so please go away.<br/>I've already called the FBI, CSI, NCIS and my bad friend.");
        res.end();
        return;
    }
    if (q.read === "true") {
        // Get the file content
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write(sFileContent);
        res.end();
        return;
    } else {
        const sModel = decodeURIComponent(q.md);
        const sFirmware = decodeURIComponent(q.fw);
        const sNodeId = decodeURIComponent(q.nodeid);
        // Controllo che non esista già
        const sArrivato = "<br/>" + sModel + " (Firmware " + sFirmware + ") -- ID: " + sNodeId;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        if (sFileContent.indexOf(sArrivato) === -1) {
            sFileContent += sArrivato + " -- Sent on " + shortStartDate;
            fs.writeFileSync(sFilePath, sFileContent);
            res.write("<b>You sent</b>" + sArrivato + "<br/>No other data nor personal infos have been sent.<br/>Thank you very much."); //write a response to the client
        } else {
            res.write("<b>You've already sent</b>" + sArrivato + "<br/>Thank you anyway");
        }
        res.end(); //end the response
    }

}).listen(8080); //the server object listens on port 8080

// Write
// http://localhost:8080/?md=2CD&fw=2.33&nodeid=12123.44
// Read
// http://localhost:8080/?read=true&md=noCD&fw=no&nodeid=no