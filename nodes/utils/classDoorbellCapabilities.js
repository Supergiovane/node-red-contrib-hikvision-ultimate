// Declaration
module.exports = class classDoorbellCapabilities {
  /**
   * @param {string} [_model]
   * @param {string} [_firmwareVersion]
   * @param {number} [_port]
   */
  constructor(_model, _firmwareVersion, _port) {
    this.model = _model;
    this.firmwareVersion = _firmwareVersion;
    this.port = _port;
  }
}
  // 13/01/2023 Gather infos
  RED.httpAdmin.get("/hikvisionUltimateGetInfoDoorBell", RED.auth.needsPermission('Doorbellconfig.read'), async function (req, res) {
    let _nodeServer = RED.nodes.getNode(req.query.nodeID);// Retrieve node.id of the config node.
    if (_nodeServer === null) _nodeServer = { server: RED.nodes.getNode(node.id) };
    // Setting default params
    let jParams = {
        protocol: _nodeServer.server.protocol,
        host: _nodeServer.server.host.includes(":") ? _nodeServer.server.host.split(":")[0] : _nodeServer.server.host,
        port: _nodeServer.server.port,
        user: _nodeServer.server.credentials.user,
        password: _nodeServer.server.credentials.password,
        authentication: _nodeServer.server.authentication
    };
    var clientInfo;
    if (req.query.hasOwnProperty("params")) {
        jParams = JSON.parse(decodeURIComponent(req.query.params));// Retrieve node.id of the config node. 
        if (jParams.password === "__PWRD__") {
            jParams.password = _nodeServer.server.credentials.password;
        }
    }

    if (jParams.authentication === "digest") clientInfo = new DigestFetch(jParams.user, jParams.password); // Instantiate the fetch client.
    if (jParams.authentication === "basic") clientInfo = new DigestFetch(jParams.user, jParams.password, { basic: true }); // Instantiate the fetch client.
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
        agent: jParams.protocol === "https" ? customHttpsAgent : null        // http(s).Agent instance or function that returns an instance (see below)
    };
    try {
        let result = {}; // Result to be returned
        async function deviceInfo() {
            try {
                const resInfo = await clientInfo.fetch(jParams.protocol + "://" + jParams.host + ":" + jParams.port + "/ISAPI/System/deviceInfo", opt);
                const body = await resInfo.text();
                const parser = new XMLParser();
                return parser.parse(body).DeviceInfo;

            } catch (error) {
                throw error;
            }
        }
        async function callSignal() {
            try {
                const resInfo = await clientInfo.fetch(jParams.protocol + "://" + jParams.host + ":" + jParams.port + "/ISAPI/VideoIntercom/callSignal/capabilities?format=json", opt);
                const body = await resInfo.text();
                return JSON.parse(body).CallSignal.cmdType["@opt"];

            } catch (error) {
                throw error;
            }
        }
        result.deviceInfo = await deviceInfo();
        result.callSignal = await callSignal();

        res.json(result);


    } catch (err) {
        res.json({ error: err.message });
    }



});