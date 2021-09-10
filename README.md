
<p align="center"><img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/logo.png' width="60%"></p>

A native set of nodes for Hikvision (and compatible) Cameras, Alarms, Radars, NVR, Doorbells etc.

[![NPM version][npm-version-image]][npm-url]
[![NPM downloads per month][npm-downloads-month-image]][npm-url]
[![NPM downloads total][npm-downloads-total-image]][npm-url]
[![MIT License][license-image]][license-url]
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![Donate via PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=flat-square)](https://www.paypal.me/techtoday) 
[![Facebook][facebook-image]][facebook-url]


## DESCRIPTION
This is a set of nodes to handle ISAPI Hikvision messages. It works exclusively with ***HIKVISION*** and Hikvision based compatible devices.<br/>
Works with cameras, NVR, Security Systems, Doorbells and also with specialized devices, like Radar (for example DS-PR1-60, DS-PR1-100 and DS-PR1-120).<br/>
Digest authentication: it should work with all devices.<br/>
All nodes are capable of auto reconnect if the connection is lost and are able to actively monitor the connection.<br/>
Be sure to have installed **Node.js v12.3.0** or newer (issue a node -v command in a console, to check it out).<br/>

**Note:** for NVR/DVR, pleas remember to select "Notify Alarm Center" in the event window, otherwise the NVR won't emit any alarm event.<br/>
<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/NotifyCenter.png' width="30%">

## CHANGELOG
* See <a href="https://github.com/Supergiovane/node-red-contrib-hikvision-ultimate/blob/master/CHANGELOG.md">here the changelog</a>

<br/>

---

## ALARM NODE
The alarm node connects to ***NVR, Camera, Alarm system, Radars, etc..*** and outputs true/false in case of an alarm. <br/>
The node can be configured as **Camera/NVR** (with standard and smart events) or as **Security System** and **Radar** (with specific CID events, designed for these type of security devices)<br/>
You can optionally filter the alarms by CHANNEL, EVENT and ZONE. <br/>
For NVR/DVR, the ***Channel*** property is the CAMERA number, while for Cameras, is the image sensor number (normally 1).<br/>
The ***Zone*** property is the alarm zone (RADARS AND SECURITY SYSTEM), or the alert region number (CAMERAS AND NVR/DVR).<br/>
For RADAR and SECURITY SYSTEM device types, you can filter improper/false alams as well.<br/>

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/GenericAlarm.png' width="80%">

You can choose from many different alarms, including: <br/>
- Video Motion Alarm (When motion is detected)
- Local alarm input (it's the device's IO pigtail connector)
- Line crossing (when someone crosses a line)
- CID alarms
- Many more.....



**Flow Messages**

The node outputs a payload on **PIN 1** (***TRUE*** on alarm start, ***FALSE*** on alarm end). Some alarm types only support the alarm start event.</br>
The node outputs a payload on **PIN 2**, representing a connection error. ***TRUE*** if error, otherwise ***FALSE***</br>
This below is an example of msg output:</br>


**Output PIN 1**
```javascript
// Example of an event from NVR/Camera
msg = {
  "payload": true,
  "topic": "",
  "channelid": "13", // This is the camera number for NVR, or the channel ID for cameras
  "zone": 0, // Zone or Region, see above, the explained difference
  "description": "Motion alarm",
  "_msgid": "386a613.89f259e"
}
```

```javascript
// Example of an event from Security System or Radar
msg = {
{
    "zone": 1, // This is the zone number that fired the alarm
    "payload": true, // true if alarm, otherwise false if alarm ended.
    "alarm": {
        "ipAddress": "192.168.1.25",
        "ipv6Address": "",
        "portNo": 80,
        "protocol": "HTTP",
        "macAddress": "BananaRama",
        "channelID": 1,
        "dateTime": "2012-01-13T03:58:19+01:00",
        "activePostCount": 1,
        "eventType": "cidEvent",
        "eventState": "active",
        "eventDescription": "CID event",
        "CIDEvent": {
            "code": 3103,
            "standardCIDcode": 3130,
            "type": "zoneAlarm",
            "trigger": "2012-01-13T03:58:19+01:00",
            "upload": "2012-01-13T03:58:19+01:00",
            "CameraList": [],
            "NVRList": [
                {
                    "id": 1,
                    "ip": "192.168.1.32",
                    "port": 8000,
                    "channel": 1
                }
            ],
            "zone": 1
        }
    }
    "_msgid": "b07e50f6.86a72"
}
```

**Output PIN 2 (connection error)**
```javascript
msg = {
    "topic": "",
    "errorDescription": "", // This will contain the error rescription, in case of errors.
    "payload": false, // Or TRUE if error
    "_msgid": "dd5b3622.884a78"
}
```
<br/>
<br/>

---

## ANPR (License Plate) NODE
This node works with Hikvision ANPR cameras.<br/>

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/ANPR.png' width="80%">

**Flow Messages**

The payload contains the license plate number and the property *plate* contains other useful informations.</br>

**Output PIN 1**
```javascript
msg = {
    "topic":"",
    "payload":"AB123CD", // This is the license plate
    "plate":{
        "captureTime":"20201130T114200+0100",
        "plateNumber":"AB123CD",
        "picName":"202011301142008600", // This is the picture's name of the license plate.
        "country":"ITA",
        "laneNo":"1",
        "direction":"forward",
        "matchingResult":"otherlist"
        }
    }
```

**Output PIN 2 (connection error)**
```javascript
msg = {
    "topic": "",
    "errorDescription": "", // This will contain the error rescription, in case of errors.
    "payload": false, // Or TRUE if error
    "_msgid": "dd5b3622.884a78"
}
```
<br/>
<br/>

---

## PTZ NODE
Recalls a PTZ pre-recorded preset.<br/>
Just select the preset in the configuration window and recall it by passing ***true*** as payload.<br/>

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/PTZ.png' width="80%">

**Flow Messages**

The node outputs ***true*** on PIN 1 if the command is executed, otherwise an error on PIN 2.</br>

**Input**
```javascript
msg.payload = true; // Recalls the preset
```

**Output PIN 1**
```javascript
msg = {
{
    "payload": true, // true after the camera has reached the PTZ preset position
    "_msgid": "b07e50f6.86a72"
}
```

**Output PIN 2 (connection error)**
```javascript
msg = {
    "topic": "",
    "errorDescription": "", // This will contain the error rescription, in case of errors.
    "payload": false, // Or TRUE if error
    "_msgid": "dd5b3622.884a78"
}
```
<br/>
<br/>

---


## PICTURE NODE
This node gets a picture from the camera/NVR, ready to be shown in the dashboard UI.<br/>
You can rotate, resize, crop, overlay with text, zoom the image.<br/>
The ***overlay text*** is applied directly after the picture's manipulation. This behaves differently than the **text overlay node** (that uses the overlay functionality onboard the camera).<br/> 
Pass **true** as payload to obtain the image.<br/>
You can, for example, link the ***Alarm node*** to the ***Picture node*** to get an image whenever an alarm occurs.<br/>
**CAUTION**: image handling is a very CPU/GPU consuming job. Use only if you have enough computational resources.<br/>

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/picture.png' width="80%">

<br/>
For the picture to show up directly into the flow, you can use this node developed by @riku 

[node-red-contrib-image-output](https://flows.nodered.org/node/node-red-contrib-image-output) 

<br/>
<br/>

**Copy this code and paste it into your flow**

<details><summary>View code</summary>

> Adjust the nodes according to your setup

<code>

```javascript
[{"id":"bd6acbb81c4f9eaf","type":"change","z":"48095c5671f0ab16","name":"Setup msg","rules":[{"t":"set","p":"cid","pt":"msg","to":"","tot":"date"},{"t":"set","p":"attachments","pt":"msg","to":"[{\t \"filename\": 'image_' & $replace($now(),\":\",\"_\") & '.jpg', \t \"content\": $$.forEmail,\t \"cid\": \"\" & cid & \"\"\t}]","tot":"jsonata"},{"t":"set","p":"topic","pt":"msg","to":"See attached image","tot":"str"},{"t":"set","p":"payload","pt":"msg","to":"''","tot":"jsonata"},{"t":"set","p":"from","pt":"msg","to":"info@mysupersmarthome.it","tot":"str"}],"action":"","property":"","from":"","to":"","reg":false,"x":410,"y":200,"wires":[["3e0ca3cc7c0d2e22"]]},{"id":"0b82f010bd682a0d","type":"hikvisionUltimatePicture","z":"48095c5671f0ab16","name":"Ovest","topic":"","server":"eb73371b.af5208","channelID":"7","rotateimage":"0","heightimage":"","widthimage":"","qualityimage":"100","cropimage":"","textoverlay":"","textoverlayXY":"","textoverlayWH":"","textoverlayFont":"FONT_SANS_64_WHITE","x":230,"y":200,"wires":[["bd6acbb81c4f9eaf","7ff4f0c75ef4d486"],[]]},{"id":"478fee35ffd435b5","type":"inject","z":"48095c5671f0ab16","name":"","props":[{"p":"payload"},{"p":"topic","vt":"str"}],"repeat":"","crontab":"","once":false,"onceDelay":0.1,"topic":"","payload":"true","payloadType":"bool","x":110,"y":200,"wires":[["0b82f010bd682a0d"]]},{"id":"facefd92c70af183","type":"comment","z":"48095c5671f0ab16","name":"Send an Email with image attachment and show it in the web UI","info":"","x":290,"y":160,"wires":[]},{"id":"7ff4f0c75ef4d486","type":"template","z":"48095c5671f0ab16","name":"","field":"payload","fieldType":"msg","format":"handlebars","syntax":"mustache","template":"<img width=\"320px\" height=\"240px\" src=\"{{{payload}}}\">","output":"str","x":400,"y":260,"wires":[["121759fa66219f53"]]},{"id":"121759fa66219f53","type":"ui_template","z":"48095c5671f0ab16","group":"e2be830cd2d143a0","name":"","order":0,"width":"6","height":"4","format":"<div ng-bind-html=\"msg.payload\"></div>","storeOutMessages":true,"fwdInMessages":true,"resendOnRefresh":true,"templateScope":"local","x":560,"y":260,"wires":[[]]},{"id":"3e0ca3cc7c0d2e22","type":"function","z":"48095c5671f0ab16","name":"Email","func":"// Replace this function node with an email node","outputs":1,"noerr":0,"initialize":"","finalize":"","libs":[],"x":550,"y":200,"wires":[[]]},{"id":"eb73371b.af5208","type":"Hikvision-config","host":"192.168.1.32","port":"80","name":"NVR","authentication":"digest","protocol":"http","heartbeattimerdisconnectionlimit":"1","deviceinfo":"[object Object]"},{"id":"e2be830cd2d143a0","type":"ui_group","name":"Default","tab":"e0f42233.22428","order":2,"disp":true,"width":"6","collapse":false},{"id":"e0f42233.22428","type":"ui_tab","name":"NVR","icon":"dashboard","order":13}]
```

</code>
</details>

<br/>
<br/>

**PROPERTY WINDOW**

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/pictureproperties.png' width="30%">

**Flow Messages**

The node outputs the image in in mamy formats  on PIN 1, otherwise an error on PIN 2. On PIN 1 you'll have:<br/>
*base64 JPG string format*, ready for the UI Dashboard.</br>
*JPG Buffer*, ready to be sent as email attachment.</br>
*pure base64 format*, for many other uses.</br>

**Input**
```javascript
// To get the image
msg.payload = true; 
return msg;
```

```javascript
// Dinamically set the overlay text
node.textoverlay = "Hello new overlay";
msg.payload = true; 
return msg;
```


**Output PIN 1**
```javascript
msg = {
{
    "payload": "data:image/jpg;base64,/9j/4AAQSk...", // FOR THE DASHBOARD UI: Image as string in base64 format with JPG DATA header already there.
    "forEmail": "<buffer>", // FOR EMAIL: Image as buffer format, ready to be attached to an email as JPG attachment.
    "base64": "/9j/4AAQSk...", // FOR FURTHER MANIPULATION: Image as pure base64 string.
    "_msgid": "b07e50f6.86a72"
}
return msg;
```

**Output PIN 2 (connection error)**
```javascript
msg = {
    "topic": "",
    "errorDescription": "", // This will contain the error rescription, in case of errors.
    "payload": false, // Or TRUE if error
    "_msgid": "dd5b3622.884a78"
}
return msg;
```
<br/>
<br/>

---

## TEXT OVERLAY NODE
You can set the camera's text overlay. This node uses the camera's onboard text overlaying capabilities.<br/>
There are 4 rows avaiable, to be set from the configuration window or dinamically via msg input from flow.<br/>
Please note that not all cameras nor NVR/DVR (especially with old firmware) suppor setting the overlay text.<br/>

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/Text.png' width="80%">

**Copy this code and paste it into your flow**

<details><summary>View code</summary>

> Adjust the nodes according to your setup

<code>

```javascript
[{"id":"7e79800b.afb8a8","type":"hikvisionUltimateText","z":"3f22f0c6.ff1328","name":"Overlay Text","server":"eb73371b.af5208","row1":"","row1XY":"","row2":"","row2XY":"","row3":"","row3XY":"","row4":"","row5XY":"","channelID":"1","x":510,"y":120,"wires":[]},{"id":"3aa8a40f.9a0964","type":"inject","z":"3f22f0c6.ff1328","name":"Go","props":[{"p":"payload"},{"p":"topic","vt":"str"}],"repeat":"","crontab":"","once":false,"onceDelay":0.1,"topic":"","payload":"","payloadType":"date","x":170,"y":120,"wires":[["7e79800b.afb8a8"]]},{"id":"2b4d9297.75ee46","type":"comment","z":"3f22f0c6.ff1328","name":"Set the overlay text","info":"","x":190,"y":80,"wires":[]},{"id":"22dc37f9.b3b86","type":"function","z":"3f22f0c6.ff1328","name":"MSG Override","func":"// Override one or more rows\n// You can use from row1 to row4 to set the text\n// and from row1XY to row4XY to set the position in the format x,y (for example: 100,200)\n\n// Optionally set the channel. On NVR, this indicates the camera number\nmsg.channelid = 1;\n\n// Row 1\nmsg.row1 = \"Temperature: \" + msg.payload;\nmsg.row1XY = \"100,200\"; // Optionallly set the position\n\n// Row 2 (here we leave the position previosly set via the camera menu)\nmsg.row2 = \"Sun\";\n\nreturn msg;","outputs":1,"noerr":0,"initialize":"","finalize":"","x":320,"y":180,"wires":[["7e79800b.afb8a8"]]},{"id":"a91e43a0.ccbb2","type":"inject","z":"3f22f0c6.ff1328","name":"Go","props":[{"p":"payload"},{"p":"topic","vt":"str"}],"repeat":"","crontab":"","once":false,"onceDelay":0.1,"topic":"","payload":"22°c","payloadType":"str","x":170,"y":180,"wires":[["22dc37f9.b3b86"]]},{"id":"eb73371b.af5208","type":"Hikvision-config","host":"192.168.1.32","port":"80","name":"Server","authentication":"digest","protocol":"http","heartbeattimerdisconnectionlimit":"1","deviceinfo":"[object Object]"}]
```

</code>
</details>
<br/>
<br/>

**Flow Messages**

Pass anything you like as input msg, to set the text overlay.</br>
You can override texts by passing some msg inputs. See samples below</br>

**Input**
```javascript
// Simply overlay the text set in the config window
msg.payload = true;
return msg;
```

```javascript
// Override one or more rows
// You can use from row1 to row4 to set the text
// and from row1XY to row4XY to set the position in the format x,y (for example: 100,200)

// Optionally set the channel. On NVR, this indicates the camera number
msg.channelid = 1;

// Row 1
msg.row1 = "Temperature: " + msg.payload;
msg.row1XY = "100,200"; // Optionallly set the position

// Row 2 (here we leave the position previosly set via the camera menu)
msg.row2 = "Sun";

return msg;
```

```javascript
// Delete all 4 rows
msg.row1 = "";
msg.row2 = "";
msg.row3 = "";
msg.row4 = "";
return msg;
```


<br/>
<br/>

---

## XML NODE
This node allow you to send any XML you want to your devices.<br/>
Every device has own firmware, capabilities etc. so i decided to allow you to cover all your needs by adding this universal node.<br/>
Please read the ISAPI Hikvision documentation or dig into the Internet to learn what XML you can send. The limit is only your fantasy.<br/>

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/XML.png' width="80%">

**Copy this code and paste it into your flow**

<details><summary>View code</summary>

> Adjust the nodes according to your setup

<code>

```javascript
[{"id":"3aa8a40f.9a0964","type":"inject","z":"3f22f0c6.ff1328","name":"Go","props":[{"p":"payload"},{"p":"topic","vt":"str"}],"repeat":"","crontab":"","once":false,"onceDelay":0.1,"topic":"","payload":"","payloadType":"date","x":170,"y":120,"wires":[["49fbbee3.1cc7e"]]},{"id":"2b4d9297.75ee46","type":"comment","z":"3f22f0c6.ff1328","name":"Send your own XML","info":"","x":190,"y":80,"wires":[]},{"id":"49fbbee3.1cc7e","type":"hikvisionUltimateXML","z":"3f22f0c6.ff1328","name":"XML","server":"fb0c2de0.8a3da","XML":"<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\n<VideoOverlay version=\"1.0\" xmlns=\"http://www.hikvision.com/ver20/XMLSchema\">\n<fontSize>1</fontSize>\n<TextOverlayList size=\"6\">\n\n<TextOverlay version=\"1.0\" xmlns=\"http://www.hikvision.com/ver20/XMLSchema\">\n<id>1</id>\n<enabled>true</enabled>\n<positionX>464</positionX>\n<positionY>96</positionY>\n<displayText>HELLO WORLD</displayText>\n</TextOverlay>\n\n\n\n</TextOverlayList>\n</VideoOverlay>","path":"/ISAPI/System/Video/inputs/channels/1/overlays/text","method":"PUT","x":470,"y":120,"wires":[]},{"id":"fb0c2de0.8a3da","type":"Hikvision-config","host":"192.168.1.25","port":"80","name":"Radar Est","authentication":"digest","protocol":"http","heartbeattimerdisconnectionlimit":"1","deviceinfo":"{\"DeviceInfo\":{\"$\":{\"version\":\"1.0\",\"xmlns\":\"http://www.hikvision.com/ver20/XMLSchema\"},\"deviceName\":\"Net Module\",\"deviceID\":\"48443138-3031-3233-3932-988b0a858e51\",\"model\":\"CAM\",\"serialNumber\":\"20190509AARRD18012392\",\"macAddress\":\"BANANARAMA\",\"firmwareVersion\":\"V1.0.2\",\"firmwareReleasedDate\":\"build 191222\",\"hardwareVersion\":\"0x1001\",\"encoderVersion\":\"V5.0\",\"encoderReleasedDate\":\"build 000000\",\"deviceType\":\"Radar\",\"telecontrolID\":\"255\",\"localZoneNum\":\"8\",\"alarmOutNum\":\"4\",\"distanceResolution\":\"5.00\",\"detectDistance\":\"60.00\"}}"}]
```

</code>
</details>
<br/>
<br/>

**Flow Messages**

You can override all properties configured in the node, by passing some msg inputs. See samples below</br>

**Input**
```javascript
// Send your own XML to the device
// You can override the default config, with all these optional properties
// msg.method must be PUT, POST or GET (all uppercase)

msg.XML = ``; // Here goes your XML. These strange chars after the = allow you to do multiline text
msg.path = ""; // For example /ISAPI/System/Video/inputs/channels/1/overlays
msg.method = "PUT"; // This must be PUT, POST or GET (uppercase)

return msg;
```

<br/>
<br/>

---

## RAW ALARM NODE
The RAW alarm node reacts to every message sent by the device. You can use this node when the other nodes doesn't fit your needs. It connects to ***NVR, Camera, Alarm system, Radars etc...*** and outputs the alarm received. <br/>

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/RawAlarm.png' width="80%">

**Flow Messages**

The node outputs a payload on **PIN 1** that can vary, depending on the alarm type sent by the connected device.</br>
The node outputs a payload on **PIN 2**, representing a connection error. ***TRUE*** if error, otherwise ***FALSE***</br>
This below is an example of msg output (in this case, a movement detected from a radar)</br>


**Output PIN 1**
```javascript
msg = {
    "topic": "",
    "payload": {
        "ipAddress": "192.168.1.25",
        "ipv6Address": "",
        "portNo": 80,
        "protocol": "HTTP",
        "macAddress": "banana",
        "channelID": 1,
        "dateTime": "2012-01-13T04:32:47+01:00",
        "activePostCount": 1,
        "eventType": "MultiRadarTargetEvent",
        "eventState": "active",
        "eventDescription": "MultiRadar Target Event",
        "MultiRadarTargetEventList": [
            {
                "targetID": 25,
                "isTargetDisappear": false,
                "targetType": "people",
                "Coordinate": {
                    "angle": 101.49,
                    "distance": 24.59
                },
                "speed": -0.2,
                "signalStrength": "strong",
                "TrackedInfoList": [],
                "trackedByIPC": false
            }
        ]
    },
    "_msgid": "dba1850a.2dc5e8"
}
```

**Output PIN 2 (connection error)**
```javascript
msg = {
    "topic": "",
    "errorDescription": "", // This will contain the error rescription, in case of errors.
    "payload": false, // Or TRUE if error
    "_msgid": "dd5b3622.884a78"
}
```
<br/>
<br/>

---

## DOORBELL NODE
The doorbell node allow you to receive ring/call progress events, open the doors, hangup calls and other things from hikvision and hik compatible doorbells. <br/>
Everytime ad intercom sends a message to the node, this message is validated using the filters you selected in the configuration window. In case of a match, it emits a msg to the flow. 
<br/>There are many filters you can apply (ringStatus (ring or on call), floor number, unit number, building number and so on.).

**Flow Messages**

**Input**

The node accepts messages from the flow.<br/>
See these messages you can pass to it:<br/>

*OPEN THE DOOR LATCHES*
```javascript
// Open the door. 
msg.openDoor = 1; // Pass the door number to open as value, in this case, 1.
return msg;
```

*HANG UP THE CURRENT CALL*
```javascript
// Hangup the current call and stop ringing 
msg.hangUp = true; 
return msg;
```
<br/>
<br/>

**Output**

The node outputs a payload on **PIN 1** that can vary, depending on the event type sent by the connected intercom.<br/>
Anyway, it emits always a payload = ***true** as soon as an intercom message matching filters you configured in the configuration window, arrives. You can use that payload to trigger events.
The node outputs a payload on **PIN 2**, representing a connection error. ***TRUE*** if error, otherwise ***FALSE***</br>
This below is an example of msg output</br>


**Output PIN 1**
```javascript
msg = {
   "CallerInfo":{
      "buildingNo":1,
      "floorNo":1,
      "zoneNo":1,
      "unitNo":1,
      "devNo":88,
      "devType":1,
      "lockNum":1,
      "status":"idle"
   },
   "topic":"",
   "payload":true
}
```

**Output PIN 2 (connection error)**
```javascript
msg = {
    "topic": "",
    "errorDescription": "", // This will contain the error rescription, in case of errors.
    "payload": false // Or TRUE if error
}
```

<br/>
<br/>

# HIKVISION AND OTHER HIK BASED DEVICES, TESTED WITH THE NODE
This is a list of Hikvision (and hik compatible) models the users own and decided to share because it checked working with Hikvision-Ultimate. <br/>
This is only a partial model list. Hikvision-Ultimate should work with basically ALL Hikvision devices.<br/>
[Click HERE to view the list of tested devices](http://80.211.147.27:8080/?read=true&md=noCD&fw=no) 

<br/>
<br/>

![Logo](https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/madeinitaly.png)

[license-image]: https://img.shields.io/badge/license-MIT-blue.svg
[license-url]: https://github.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/LICENSE
[npm-url]: https://npmjs.org/package/node-red-contrib-hikvision-ultimate
[npm-version-image]: https://img.shields.io/npm/v/node-red-contrib-hikvision-ultimate.svg
[npm-downloads-month-image]: https://img.shields.io/npm/dm/node-red-contrib-hikvision-ultimate.svg
[npm-downloads-total-image]: https://img.shields.io/npm/dt/node-red-contrib-hikvision-ultimate.svg
[facebook-image]: https://img.shields.io/badge/Visit%20me-Facebook-blue
[facebook-url]: https://www.facebook.com/supergiovaneDev