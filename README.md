# node-red-contrib-hikvision-ultimate

A native set of node for Hikvision Cameras, Alarms, Radars, NVR etc.

[![NPM version][npm-version-image]][npm-url]
[![NPM downloads per month][npm-downloads-month-image]][npm-url]
[![NPM downloads total][npm-downloads-total-image]][npm-url]
[![MIT License][license-image]][license-url]
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![Donate via PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=flat-square)](https://www.paypal.me/techtoday) 



## DESCRIPTION
This is a set of nodes to handle ISAPI Hikvision messages. It works with digest authorization as well.<br/>
Works with cameras, NVR and also with specialized devices, like Radar (for example DS-PR1-60 and 120).<br/>
Digest authehtication is the default, so it should work with all gears!<br/>
All nodes are capable of auto reconnect if the connection is lost and are able to actively monitor the connection.<br/>
There are currently **only two node**, one that traps the alarms, in RAW mode, and outputs a JSON and the other that outputs the ANPR License Plate numbers.<br/>

***THIS NODESET IS IN BETA. E' ancora brutto, ma funziona.***<br/>
I'll add helps, docs and samples in this README page. Please have some patience...<br/>

## CHANGELOG
* See <a href="https://github.com/Supergiovane/node-red-contrib-hikvision-ultimate/blob/master/CHANGELOG.md">here the changelog</a>

<br/>
<br/>
<br/>
<br/>

## - RAW Alarm Node
The RAW alarm node connects to NVR, Camera, Alarm system, Radars etc. and outputs the alarm received. <br/>

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/RawAlarm.png' width="50%">
<br/>
<br/>
<br/>
<br/>

## - ANPR (License Plate) Node

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/ANPR.png' width="50%">
<br/>

**Output message**
The node outputs this msg.</br>
The payload is the license plate number, plus there is another property "plate" where you can find other useful informations.</br>

```javascript
msg = {
    "topic":"",
    "payload":"AB123CD", // This is the license plate
    "connected":true, // true if the connection is OK, otherwise false if the connection is lost.
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

[license-image]: https://img.shields.io/badge/license-MIT-blue.svg
[license-url]: https://github.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/LICENSE
[npm-url]: https://npmjs.org/package/node-red-contrib-hikvision-ultimate
[npm-version-image]: https://img.shields.io/npm/v/node-red-contrib-hikvision-ultimate.svg
[npm-downloads-month-image]: https://img.shields.io/npm/dm/node-red-contrib-hikvision-ultimate.svg
[npm-downloads-total-image]: https://img.shields.io/npm/dt/node-red-contrib-hikvision-ultimate.svg
