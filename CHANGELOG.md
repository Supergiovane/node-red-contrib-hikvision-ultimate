<p align="center"><img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/logo.png' width="40%"></p>


[![Donate via PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=flat-square)](https://www.paypal.me/techtoday) 

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
