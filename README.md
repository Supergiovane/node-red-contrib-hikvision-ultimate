# node-red-contrib-hikvision-ultimate

A native set of node for Hikvision Cameras, Alarms, Radars, NVR etc.

[![NPM version][npm-version-image]][npm-url]
[![NPM downloads per month][npm-downloads-month-image]][npm-url]
[![NPM downloads total][npm-downloads-total-image]][npm-url]
[![MIT License][license-image]][license-url]
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![Donate via PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=flat-square)](https://www.paypal.me/techtoday) 



## DESCRIPTION
This is a set of nodes to handle ISAPI Hikvision messages. It works exclusively with ***HIKVISION*** devices.<br/>
Works with cameras, NVR and also with specialized devices, like Radar (for example DS-PR1-60, DS-PR1-100 and DS-PR1-120).<br/>
Digest authentication is the default, so it should work with all gears!<br/>
All nodes are capable of auto reconnect if the connection is lost and are able to actively monitor the connection.<br/>
The node uses pipelines to handle streams, so you need at least **Node V.10.0.0**, or newer, installed. To check Node version, type **node -v** in a command prompt.<br/>

***THIS NODE IS IN BETA***<br/>
I'll add helps, docs and samples in this README page. Please have some patience...<br/>

## CHANGELOG
* See <a href="https://github.com/Supergiovane/node-red-contrib-hikvision-ultimate/blob/master/CHANGELOG.md">here the changelog</a>

<br/>

## - RAW Alarm Node
The RAW alarm node connects to ***NVR, Camera, Alarm system, Radars etc...*** and outputs the alarm received. <br/>

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/RawAlarm.png' width="80%">

**Output message**

The node outputs a payload on **PIN 1** that can vary, depending on the alarm type sent by the connected device.</br>
The node outputs a payload on **PIN 2**, representing a connection error. ***TRUE*** if error, otherwise ***FALSE***</br>
This below is an example of msg output (in this case, a movement detected from a radar)</br>


**Output PIN 1**
```javascript
msg.payload = {
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

## - ANPR (License Plate) Node
This node works with Hikvision ANPR cameras.<br/>

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/ANPR.png' width="80%">

**Output message**

The payload contains the license plate number and the property "plate" contains other useful informations.</br>

**Output PIN 1**
```javascript
msg.payload = {
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

## - Radar Alarm Node
This node works with Hikvision Radars.<br/>

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/Radar.png' width="80%">

**Output message**

The node outputs a message whenever an alarm starts or ends. It uses CID codes to identify the alarm type.</br>
The payload is TRUE whenever alarm occurs, otherwise FALSE whenever alarm ends.</br>
The complete alarm event is stored in the "alarm" property of the payload.</br>
In an **unknown CID event** arrives from the Radar, the node will output a message containing the CID code, the full alarm and a null payload.</br>

**Output PIN 1**
```javascript
msg.payload = {
{
    "zone": 1, // This is the zone number that fired the alarm
    "payload": true, // true if alarm, otherwise false if alarm ended.
    "alarm": {
        "ipAddress": "192.168.1.25",
        "ipv6Address": "",
        "portNo": 80,
        "protocol": "HTTP",
        "macAddress": "9banana",
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








[license-image]: https://img.shields.io/badge/license-MIT-blue.svg
[license-url]: https://github.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/LICENSE
[npm-url]: https://npmjs.org/package/node-red-contrib-hikvision-ultimate
[npm-version-image]: https://img.shields.io/npm/v/node-red-contrib-hikvision-ultimate.svg
[npm-downloads-month-image]: https://img.shields.io/npm/dm/node-red-contrib-hikvision-ultimate.svg
[npm-downloads-total-image]: https://img.shields.io/npm/dt/node-red-contrib-hikvision-ultimate.svg
