

module.exports = function (RED) {
	function hikvisionUltimateText(config) {
		RED.nodes.createNode(this, config);
		var node = this;
		node.server = RED.nodes.getNode(config.server)
		node.row1 = config.row1 === undefined ? "" : config.row1;
		node.row1XY = config.row1XY === undefined ? "" : config.row1XY;
		node.row2 = config.row2 === undefined ? "" : config.row2;
		node.row2XY = config.row2XY === undefined ? "" : config.row2XY;
		node.row3 = config.row3 === undefined ? "" : config.row3;
		node.row3XY = config.row3XY === undefined ? "" : config.row3XY;
		node.row4 = config.row4 === undefined ? "" : config.row4;
		node.row4XY = config.row4XY === undefined ? "" : config.row4XY;


		node.setNodeStatus = ({ fill, shape, text }) => {
			var dDate = new Date();
			node.status({ fill: fill, shape: shape, text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")" })
		}



		this.on('input', function (msg) {

			// Overrides
			if (msg.hasOwnProperty("row1")) node.row1 = msg.row1;
			if (msg.hasOwnProperty("row1XY")) node.row1XY = msg.row1XY;
			if (msg.hasOwnProperty("row2")) node.row2 = msg.row2;
			if (msg.hasOwnProperty("row2XY")) node.row2XY = msg.row2XY;
			if (msg.hasOwnProperty("row3")) node.row3 = msg.row3;
			if (msg.hasOwnProperty("row3XY")) node.row3XY = msg.row3XY;
			if (msg.hasOwnProperty("row4")) node.row4 = msg.row4;
			if (msg.hasOwnProperty("row4XY")) node.row4XY = msg.row4XY;


			let sRows = `<?xml version="1.0" encoding="UTF-8" ?>
<VideoOverlay version="1.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<fontSize>1</fontSize>
<TextOverlayList size="6">

<TextOverlay version="1.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<id>1</id>
<enabled>` + (node.row1.trim() === "" ? "false" : "true") + `</enabled>
<positionX>` + (node.row1XY.trim() === "" ? "" : node.row1XY.split(",")[0]) + `</positionX>
<positionY>` + (node.row1XY.trim() === "" ? "" : node.row1XY.split(",")[1]) + `</positionY>
<displayText>` + node.row1 + `</displayText>
</TextOverlay>

<TextOverlay version="1.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<id>2</id>
<enabled>` + (node.row2.trim() === "" ? "false" : "true") + `</enabled>
<positionX>` + (node.row2XY.trim() === "" ? "" : node.row2XY.split(",")[0]) + `</positionX>
<positionY>` + (node.row2XY.trim() === "" ? "" : node.row2XY.split(",")[1]) + `</positionY>
<displayText>` + node.row2 + `</displayText>
</TextOverlay>

<TextOverlay version="1.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<id>3</id>
<enabled>` + (node.row3.trim() === "" ? "false" : "true") + `</enabled>
<positionX>` + (node.row3XY.trim() === "" ? "" : node.row3XY.split(",")[0]) + `</positionX>
<positionY>` + (node.row3XY.trim() === "" ? "" : node.row3XY.split(",")[1]) + `</positionY>
<displayText>` + node.row3 + `</displayText>
</TextOverlay>

<TextOverlay version="1.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<id>4</id>
<enabled>` + (node.row4.trim() === "" ? "false" : "true") + `</enabled>
<positionX>` + (node.row4XY.trim() === "" ? "" : node.row4XY.split(",")[0]) + `</positionX>
<positionY>` + (node.row4XY.trim() === "" ? "" : node.row4XY.split(",")[1]) + `</positionY>
<displayText>` + node.row4 + `</displayText>
</TextOverlay>

</TextOverlayList>
</VideoOverlay>`;



			node.setNodeStatus({ fill: "green", shape: "ring", text: "OK" });
			try {
				// Params: _callerNode, _method, _URL, _body
				node.server.request(node, "PUT", "/ISAPI/System/Video/inputs/channels/1/overlays/text", sRows);
			} catch (error) {

			}

		});

		// Called from config node, to send output to the flow
		node.sendPayload = (_msg) => {

		};


		node.on("close", function (done) {
			done();
		});

	}

	RED.nodes.registerType("hikvisionUltimateText", hikvisionUltimateText);
}