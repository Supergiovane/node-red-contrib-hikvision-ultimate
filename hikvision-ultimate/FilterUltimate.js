module.exports = function(RED) {
    function FilterUltimate(config) {
        RED.nodes.createNode(this,config);
		this.config = config;
		var node = this;
		setNodeStatus( {fill:  "grey" ,shape: "dot" ,text: "Waiting"});
		this.on('input', function (msg) {
			var sTopic = node.config.name;
			if (msg.hasOwnProperty("topic")){
				sTopic = (msg.topic === "" ? sTopic : msg.topic);
			}
			
			if (typeof msg.payload !== "undefined") {
				var bRes = ToBoolean(msg.payload);
				if (typeof bRes === "undefined") return;
				
				// 24/01/2020 Clone input message and replace only relevant topics
				var msgTrue = RED.util.cloneMessage(msg);	
				msgTrue.topic = sTopic;
				msgTrue.payload = true;
				var msgFalse = RED.util.cloneMessage(msg);	
				msgFalse.topic = sTopic;
				msgFalse.payload = false;
				
				if (bRes === true) {
					setNodeStatus({ fill: "green", shape: "dot", text: "(Send) true" });
					node.send([msgTrue, null]);
				} else
				{
					setNodeStatus( {fill:  "green" ,shape: "dot" ,text: "(Send) false"});
					node.send([null, msgFalse]);
				}
				return;
			}
        });
		
		function setNodeStatus({fill, shape, text})
		{
			var dDate = new Date();
			node.status({fill: fill,shape: shape,text: text + " (" + dDate.getDate() + ", " + dDate.toLocaleTimeString() + ")"})
		}
			

		function ToBoolean( value ) {
			var res = false;
	
			if (typeof value === 'boolean') {
				res = value;
			} 
			else if( typeof value === 'number' || typeof value === 'string' ) {
				// Is it formated as a decimal number?
				if( decimal.test( value ) ) {
					var v = parseFloat( value );
					res = v != 0;
				}
				else {
					res = value.toLowerCase() === "true";
				}
			}
			
			return res;
		};
    }	
	

    RED.nodes.registerType("FilterUltimate",FilterUltimate);
}