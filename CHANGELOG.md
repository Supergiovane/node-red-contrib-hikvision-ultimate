<p align="center"><img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/logo.png' width="40%"></p>


[![Donate via PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=flat-square)](https://www.paypal.me/techtoday) 

<p>
<b>Version 1.2.6</b> January 2025<br/>
- AX Pro: fixed msg.clearAllAlarmAreas input property, that was clearing only the area number 1.<br/>
- AX Pro: fixed msg.disarmAllAreas input property, that was disarming only the area number 1.<br/>
</p>
<p>
<b>Version 1.2.5</b> December 2024<br/>
- Doorbell: Disabled some XML parser error logs.<br/>
</p>
<p>
<b>Version 1.2.4</b> December 2024<br/>
- Doorbell: fixed an issue introduced with 1.2.3, preventing the door to be open.<br/>
</p>
<p>
<b>Version 1.2.1</b> September 2024<br/>
- AX Pro: fixed an issue where occasionally, when malformed multipart data is sent from the AX Pro, there would be no NAK.<br/>
</p>
<p>
<b>Version 1.2.0</b> September 2024<br/>
- RAW Event Node: on the third pin, outputs the IMAGE related to the event (if any). The node will now filter the heartbeat signals.<br/>
- Event Node: on the third pin, outputs the IMAGE related to the event (if any).<br/>
</p>
<p>
<b>Version 1.1.22</b> August 2024<br/>
- IP Speaker node: added help.<br/>
</p>
<p>
<b>Version 1.1.21</b> August 2024<br/>
- NEW: IP Speaker node: play preloaded audio files from an IP Speaker.<br/>
</p>
<p>
<b>Version 1.1.20</b> Mai 2024<br/>
- AX Pro node: added msg.disarmAllAreas, msg.clearAlarmArea and msg.clearAllAlarmAreas. See the help tab in node-red for fuhrter infos<br/>
</p>
<p>
<b>Version 1.1.19</b> April 2024<br/>
- ANPR: fixed an issue it the plate's list parser in cameras having ISAPI protocol 1.0.<br/>
</p>
<p>
<b>Version 1.1.17</b> April 2024<br/>
- ANPR: fixed an issue it the plate's list parser. Thanks @jpgnz.<br/>
- Fixed the node icons not showing up.<br/>
</p>
<p>
<b>Version 1.1.16</b> April 2024<br/>
- Fixed somme try-catch functions.<br/>
</p>
<p>
<b>Version 1.1.15</b> April 2024<br/>
- Doorbel node: fixed a crash if you send msg.hangUp = true, when the doorbell cannot be reached.<br/>
</p>
<p>
<b>Version 1.1.14</b> January 2024<br/>
- Fixed sintax errors in some dropdown list. Thanks to @pmattia90<br/>
</p>
<p>
<b>Version 1.1.13</b> October 2023<br/>
- Refined some function and start to write the help TAB of Node-Red.<br/>
- Added the debug level option.<br/>
</p>
<p>
<b>Version 1.1.12</b> October 2023<br/>
- Silenced the log error, while error occurs fetching the http socket.<br/>
</p>
<p>
<b>Version 1.1.11</b> August 2023<br/>
- Bump Jimp.<br/>
</p>
<p>
<b>Version 1.1.9</b> April 2023<br/>
- FIX: Access Control Node: workarounded bug in some hik firmwares, not correctly sorting the events received.<br/>
</p>
<p>
<b>Version 1.1.8</b> March 2023<br/>
- Access Control Node: added eventdescription in the payload message.<br/>
</p>
<p>
<b>Version 1.1.6</b> March 2023<br/>
- Optimization/bugfix to Access Control Terminal, node event handling after NTP time set.<br/>
</p>
<p>
<b>Version 1.1.5</b> March 2023<br/>
- NEW: Added the Access Control Terminal node.<br/>
</p>
<p>
<b>Version 1.1.2</b> January 2023<br/>
- FIX: trying to fix the "reject" and "hangUp" function, sent to Door Station using the new V2 protocol.<br/>
</p>
<p>
<b>Version 1.1.1</b> January 2023<br/>
- NEW: added an online device list in the camera/nvr configuration node, to visually help the user.<br/>
</p>
<p>
<b>Version 1.1.0</b> January 2023<br/>
- Removed xml2js package and replaced it with fast-xml-parser.<br/>
- Fixed other memory issues when there are a lot of cameras in the flow.<br/>
</p>
<p>
<b>Version 1.0.71</b> January 2023<br/>
- FIX: fixed error MaxEventListener, occurring in case of sudden Camera LAN disconnection. This was due to the xml2js function.<br/>
- AX Pro node is out of the beta phase and has been released.<br/>
</p>
<p>
<b>Version 1.0.70</b> December 2022<br/>
- NEW: AX Pro node: you can now filter by Alarm events, Zone status changes, or have both as output.<br/>
- Begin standardizing help in the "help" panel of node-red, starting with AX Pro node.<br/>
</p>
<p>
<b>Version 1.0.69</b> December 2022<br/>
- Some bugfixes.<br/>
</p>
<p>
<p>
<b>Version 1.0.67</b> December 2022<br/>
- NEW: AX Pro node now outputs alarm events and also zone status (even if the alarm is disarmed).<br/>
- Updated Ajax Pro Wiki.<br/>
</p>
<p>
<b>Version 1.0.66</b> December 2022<br/>
- NEW: new AX Pro and AX Pro Hybrid node. These panels require a totally different authentication and handling, so i made another node just for that. You can receive events and also control your security system<br/>
- EDIT: changed the node name from "Alarm" and "RAW Alarm" to "Event" and "RAW Event" to avoid confusion with the new AX Pro node.<br/>
- Fixed stability issue with the new AX Pro node.<br/>
</p>
<p>
<b>Version 1.0.64</b> September 2022<br/>
- Not all Hikvision door intercom does have the proper APIs to connect to. Added warning.<br/>
- Add: The Picture Node now passes through the input message, in the property msg.previousInputMessage<br/>
</p>
<p>
<b>Version 1.0.63</b> August 2022<br/>
- Maintenance release. Optimized the scope of some variables.<br/>
- Aded a Warning on the README page.<br/>
</p>
<p>
<b>Version 1.0.62</b> Juni 2022<br/>
- Maintenance release. Fixed an issue with node-fetch v3 incompatibility.<br/>
</p>
<p>
<b>Version 1.0.61</b> April 2022<br/>
- Maintenance release. Bumped required depencencies.<br/>
</p>
<p>
<b>Version 1.0.60</b> January 2022<br/>
- Maintenance release. Removed the device compatiblility list from the bottom of the readme page, because with the new Doorbell Hik devices (that i haven't and i cannot test with), this list isn't realistic anymore.<br/>
</p>
<p>
<b>Version 1.0.59</b> January 2022<br/>
- FIX for some couple NVR/firmware, not behaving standard with the heartbeat.<br/>
</p>
<p>
<b>Version 1.0.58</b> December 2021<br/>
- FIX a possible error in wrong XML returned by the node, if node-red runs under IOBroker, having an old XML parser version.<br/>
</p>
<p>
<b>Version 1.0.57</b> November 2021<br/>
- NEW: PTZ Node: you can now pass the channelID and PTZ preset number by msg.payload. <br/>
</p>
<p>
<b>Version 1.0.56</b> November 2021<br/>
- Workaround for an issue in a js library used by hikvision-ultimate. <br/>
</p>
<p>
<b>Version 1.0.54</b> October 2021<br/>
- NEW: the XML Node can now emit a message containing the response from the camera. You can now ask a camera for anything (for example if the motion detect is enabled) and get the response in JSON format. See the gitHub README on how to do that.<br/>
</p>
<p>
<b>Version 1.0.53</b> September 2021<br/>
- FIX: Doorbell node now correctly emits error on the second PIN instead of the first output PIN.<br/>
</p>
<p>
<b>Version 1.0.52</b> September 2021<br/>
- NEW: Doorbell node (you can be notified on ringing, on call and even open the door). Thanks @ur5zeb for help in testing.<br/>
</p>
<p>
<b>Version 1.0.51</b> August 2021<br/>
- FIX: XML Node do not retain the XML text.<br/>
</p>
<p>
<b>Version 1.0.50</b> Juli 2021<br/>
- You can now connect to devices using HTTPS with a self signed certificate. Preiouusly, the node was given an SSL warning and refuse to connect.<br/>
</p>
<p>
<b>Version 1.0.49</b> Juli 2021<br/>
- NVR: fixed an issue causing the node not detecting the channel ID on some NVR type "NX..".<br/>
</p>
<p>
<b>Version 1.0.48</b> June 2021<br/>
- Minor fix.<br/>
</p>
<p>
<b>Version 1.0.47</b> April 2021<br/>
- Alarm node: fixed an issue where the camera won't emit the intrusion detection event start, but only the end. Workaround for that.<br/>
</p>
<p>
<b>Version 1.0.43</b> April 2021<br/>
- ANPR: Fixed the authentication type (digest/basic) not retained.<br/>
- ANPR: Fixed the error message visible if you have one and only ANPR camera in your flow.<br/>
</p>
<p>
<b>Version 1.0.42</b> April 2021<br/>
- Server node: the port config was totally ignored. Fixed, now you can set the port as well and it works. Thanks to @Mateiuc.<br/>
</p>
<p>
<b>Version 1.0.41</b> April 2021<br/>
- Picture Image: Better handling of automatic URLs selection.<br/>
- Picture Image: fixed a false status whenever an alarm node receives an alarm.<br/>
</p>
<p>
<b>Version 1.0.38</b> April 2021<br/>
- Fidex a syntax error checking an url.<br/>
</p>
<p>
<b>Version 1.0.37</b> April 2021<br/>
- Fidex an issue in the new function of picture node.<br/>
</p>
<p>
<b>Version 1.0.35</b> April 2021<br/>
- PICTURE node is now compatible with hybrid NVR both for analog and for IP cameras. Thanks to smcgann99 for raising the issue.<br/>
</p>
<p>
<b>Version 1.0.33</b> February 2021<br/>
- Filter null payloads in picture node, in case the device you're connecting to, is an hybrid DVR/NVR.<br/>
- Fixed some glitches it the sample code on the README page.<br/>
</p>
<p>
<b>Version 1.0.31</b> February 2021<br/>
- FIX: sometime, the IMAGE node fails to show the text overlay.<br/>
- NEW: the IMAGE outputs a pure base64 image format as well as image buffer ready to be attached to an email.<br/>
</p>
<p>
<b>Version 1.0.30</b> January 2021<br/>
- Nasty ANPR camera fix: it has happened to me, that the cam's plate list had some odd item order. This caused me some problem. The ANPR node has been changed to overcome any sort of oddness in the camera plate list returnet by the camera itself.<br/>
- NEW: XML Node. You can now send what you want to your device. See the README in gitHub.<br/>
</p>
<p>
<b>Version 1.0.29</b> January 2021<br/>
- Text overlay node: you can now use it with NVR. Channel selection is also avaiable now.<br/>
</p>
<p>
<b>Version 1.0.28</b> January 2021<br/>
- BREAKING CHANGE: the Radar node is now part of the Alarm node. The Radar node has been deleted.<br/>
- NEW: the Alarm node can now filter for channels and zones as well. SOME ADJUSTMENT TO YOUR FLOW MAY BE NEEDED.<br/>
- NEW: Text overlay node: you can set the camera's 4 rows overlay text.<br/>
</p>
<p>
<b>Version 1.0.27</b> January 2021<br/>
- NEW: Text overlay in the picture node. You can also set the position and font. The text can be set with msg.textoverlay as well.<br/>
</p>
<p>
<b>Version 1.0.26</b> January 2021<br/>
- Fixed an unwanted LOG in case you have a picture node asking for an image to an unconnected camera.<br/>
</p>
<p>
<b>Version 1.0.25</b> January 2021<br/>
- Minor fixes in alarm filter.<br/>
</p>
<p>
<b>Version 1.0.24</b> January 2021<br/>
- FIX: all nodes won't emit a topic property. Has been fixed.<br/>
- NEW: you can now filter false alarms in the radar node.<br/>
</p>
<p>
<b>Version 1.0.22</b> December 2020<br/>
- NEW: you can now choose how much times the node server should try to reconnect to the Hik device, before emitting the connection error on PIN 2. This is useful in case of problematic LANs, like VPN or very slow Wireless 3G connections.<br/>
</p>
<p>
<b>Version 1.0.20</b> December 2020<br/>
- NEW: you can now choose to tell Supergiovane (the developer) that your camera model works with the node. You'll help other users. The list will be shown here https://github.com/Supergiovane/node-red-contrib-hikvision-ultimate/blob/master/TESTEDWITH.md<br/>
</p>
<p>
<b>Version 1.0.18</b> December 2020<br/>
- FIX: node topic wasn't retent on all nodes.<br/>
</p>
<p>
<b>Version 1.0.16</b> December 2020<br/>
- CHANGE: the node should now work with node version below 10.0.0, but it's recommended anyway to update.<br/>
- FIX: on some setups, the alarm stream wasn't received. Thanks @oliveres for signalling this issue.<br/>
</p>
<p>
<b>Version 1.0.15</b> December 2020<br/>
- FIX: getting rid of promise rejection error log in the hikconfig-node, whenever a conneciton error occurs.<br/>
</p>
<p>
<b>Version 1.0.14</b> December 2020<br/>
- Picture Node: support for NVR with max 32 channels.<br/>
- Radar Node: support for max 16 alarm zones.<br/>
- FIX: the "connect" button in the config node doesn't work if this is the first node ever. A message will show, to tell you to save, deploy and re-enter the config node again.<br/>
</p>
<p>
<b>Version 1.0.12</b> December 2020<br/>
- NEW: You can now get info from the camera by pressing CONNECT button in the config window, even if the server node is new and it hasn't been saved.<br/>
- CHANGE: The Picture Node has now a button to reload the image, so you can view the changes in size etc.. just in time.
</p>
<p>
<b>Version 1.0.10</b> December 2020<br/>
- NEW: You can now get info from the camera by pressing CONNECT button in the config window.<br/>
</p>
<p>
<b>Version 1.0.9</b> December 2020<br/>
- NEW: Picture node, you can now CROP the image, to obtain a zoomed portion, for example, of a door or things like this.<br/>
- NEW: Picture node, the config window shows the actual picture you see, including all image manipulation you've done through settings.<br/>
</p>
<p>
<b>Version 1.0.7</b> December 2020<br/>
- NEW: Picture node, you can now set the output quality, from 10 to 100.<br/>
</p>
<p>
<b>Version 1.0.6</b> December 2020<br/>
- Increased timeout for situation where the connection is via VPN or very slow. Thanks @Georg for suggesting this thing.<br/>
</p>
<p>
<b>Version 1.0.5</b> December 2020<br/>
- NEW: Picture node. This node get a picture from camera, ready to be shown in the dashboard UI. The image can be rotated and resized.<br/>
</p>
<p>
<b>Version 1.0.4</b> December 2020<br/>
- Getting rid of old debug logs. Thanks @oliveres for advice.<br/>
</p>
<p>
<b>Version 1.0.3</b> December 2020<br/>
- NEW: Added help links to the config windows.<br/>
</p>
<p>
<b>Version 1.0.2</b> December 2020<br/>
- NEW: PTZ preset recall node, for PTZ cameras. Just pass payload TRUE to the node to recall the preset.<br/>
</p>
<p>
<b>Version 1.0.1</b> December 2020<br/>
- NEW: added more events to the alarm node.<br/>
- Changed icon of alarm node.<br/>
</p>
<p>
<b>Version 1.0.0 FIRST OFFICIAL VERSION</b> December 2020<br/>
- NEW: added Generic Alarm node.<br/>
- NEW: added warning in the node-red log, specify that the node requires Node V.10.0.0 or newer.<br/>
</p>
<p>
<b>Version 0.0.25 GA VERSION WITH STABLE BEHAVOUR</b> December 2020<br/>
- Fine tuning some msg handlers.<br/>
- Debug mode avaiable. Just type banana after the server ip, for example 192.168.1.5banana<br/>
</p>
<p>
<b>Version 0.0.24 GA VERSION WITH STABLE BEHAVOUR</b> December 2020<br/>
- Better handling of malformed alert messages.<br/>
</p>
<p>
<b>Version 0.0.23 GA VERSION WITH STABLE BEHAVOUR</b> December 2020<br/>
- NEW: added "http" and "https" protocol selection.<br/>
</p>
<p>
<b>Version 0.0.22 GA VERSION WITH STABLE BEHAVOUR</b> December 2020<br/>
- NEW: added "basic" authentication as well.<br/>
</p>
<p>
<b>Version 0.0.21 GA VERSION WITH STABLE BEHAVOUR</b> December 2020<br/>
- Changed timeout in hearthbeat. More relaxed, to avoid false disconnections messages.<br/>
</p>
<p>
<b>Version 0.0.20 GA VERSION WITH STABLE BEHAVOUR</b> December 2020<br/>
- NEW: added the PIN 2 for signalling errors.<br/>
</p>
<p>
<b>Version 0.0.19 LAST BETA BEFORE STABLE RELEASE</b> December 2020<br/>
- Better handling of status messages.<br/>
</p>
<p>
<b>Version 0.0.18 BETA</b> December 2020<br/>
- BUGFIX: fixed a vaccata in handling boundary of stream pipeline.<br/>
- BUGFIX: fixed a minchiata in ANPR node, where if the alarmed zone was 0, the node outputs "unknown zone".<br/>
- Fixed Radar alarm zone. Zone number in ISAPI is base 0, while in the UI is base 1.<br/>
- BUGFIX: ANPR - fixed array handling when returning a single plate.<br/>
</p>
<p>
<b>Version 0.0.16 BETA</b> December 2020<br/>
- NEW: added Radar Node for trapping radar zone's alarms.<br/>
- Radar Node allow for alarm filter (all zone or specific zone)<br/>
</p>
<p>
<b>Version 0.0.15 BETA</b> December 2020<br/>
- Moved RAW node code into async functions.<br/>
- Fixed BUG in ANPR module, where the last plate was sent every second..<br/>
- Added icons.<br/>
</p>
<p>
<b>Version 0.0.14 BETA</b> December 2020<br/>
- Moved ANPR code into async functions, do help very slow PC's to correctly handle the data.<br/>
</p>
<p>
<b>Version 0.0.13 BETA</b> December 2020<br/>
- Moved ANPR code into async functions, do help very slow PC's to correctly handle the data.<br/>
</p>
<p>
<b>Version 0.0.12 BETA</b> November 2020<br/>
- Added support for devices sending XML as well as for devices sending JSON.<br/>
</p>
<p>
<b>Version 0.0.11 BETA</b> November 2020<br/>
- Added an option to the ANPR node, to filter repeating plates in a timeframe.<br/>
</p>
<p>
<b>Version 0.0.9 BETA</b> November 2020<br/>
- Replaced the node urllib with node-fetch.<br/>
- Alert node now filters heartbeath without sending unuseful payloads.
</p>
<p>
<b>Version 0.0.8 BETA</b> November 2020<br/>
- ANPR node now emits connect and disconnect messages. 
- Fixes and improvements.
</p>
<p>
<b>Version 0.0.7 BETA</b> November 2020<br/>
- ANPR node now works and correclty handles the plates queue by disregarding old plates.
- Fixes and improvements.
</p>
<p>
<b>Version 0.0.6 BETA</b> November 2020<br/>
- Automatic reconnection and error handling. Resilency is done.
</p>
<p>
<b>Version 0.0.4 BETA</b> November 2020<br/>
- Added ANPR License Plate Node.
</p>
<p>
<b>Version 0.0.3 BETA</b> November 2020<br/>
- Added connection checks and reconnection.
</p>
<p>
<b>Version 0.0.1 BETA</b> November 2020<br/>
- First BETA
</p>
