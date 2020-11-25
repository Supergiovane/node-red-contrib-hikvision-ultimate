# node-red-contrib-hikvision-ultimate

A native set of node for Hikvision Cameras, Alarms, Radars, NVR etc.

[![NPM version][npm-version-image]][npm-url]
[![NPM downloads per month][npm-downloads-month-image]][npm-url]
[![NPM downloads total][npm-downloads-total-image]][npm-url]
[![MIT License][license-image]][license-url]
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![Donate via PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=flat-square)](https://www.paypal.me/techtoday) 

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/RawAlarm.png' width="80%">


## DESCRIPTION
This is a set of nodes to handle ISAPI Hikvision messages. It works with digest authorization as well.<br/>
Works with cameras, NVR and also with specialized devices, like Radar (for example DS-PR1-60 and 120).<br/>
There is currently **only one node**, that traps the alarms, in RAW mode, and outputs a JSON.<br/>
***THIS NODESET IS IN BETA. E' ancora brutto, ma funziona.***

## RAW Alarm Node

Sample of the config node. <br/>
<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/RawAlarmConfig.png' width="50%">
<br/>

Sample JSON Output.<br/>
<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/Debug.png' width="80%">

[![Donate via PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=flat-square)](https://www.paypal.me/techtoday).

## CHANGELOG
* See <a href="https://github.com/Supergiovane/node-red-contrib-hikvision-ultimate/blob/master/CHANGELOG.md">here the changelog</a>

[license-image]: https://img.shields.io/badge/license-MIT-blue.svg
[license-url]: https://github.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/LICENSE
[npm-url]: https://npmjs.org/package/node-red-contrib-hikvision-ultimate
[npm-version-image]: https://img.shields.io/npm/v/node-red-contrib-hikvision-ultimate.svg
[npm-downloads-month-image]: https://img.shields.io/npm/dm/node-red-contrib-hikvision-ultimate.svg
[npm-downloads-total-image]: https://img.shields.io/npm/dt/node-red-contrib-hikvision-ultimate.svg
