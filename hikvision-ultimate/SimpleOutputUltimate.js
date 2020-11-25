module.exports = function(RED) {
    function SimpleOutputUltimate(config) {
        RED.nodes.createNode(this,config);
		this.config = config;
		var node = this;
		setNodeStatus( {fill:  "grey" ,shape: "dot" ,text: "Waiting"});
		
		this.on('input', function (msg) {
			var msgTrue = RED.util.cloneMessage(msg);
			var msgFalse = RED.util.cloneMessage(msg);
			msgTrue.payload = true;
			msgFalse.payload = false;
			setNodeStatus({ fill: "green", shape: "dot", text: "Sent true/false" });
			node.send([msgTrue, msgFalse]);
        });
		
		

		function setNodeStatus({fill, shape, text})
		{
			var dDate = new Date();
			node.status({fill: fill,shape: shape,text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")"})
		}
		
	}	
	
	
	
    RED.nodes.registerType("SimpleOutputUltimate",SimpleOutputUltimate);
}