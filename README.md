# node-red-contrib-hikvision-ultimate

![Sample Node](img/logo.png) 

[![NPM version][npm-version-image]][npm-url]
[![NPM downloads per month][npm-downloads-month-image]][npm-url]
[![NPM downloads total][npm-downloads-total-image]][npm-url]
[![MIT License][license-image]][license-url]
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![Donate via PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=flat-square)](https://www.paypal.me/techtoday) 

A set of Node-RED enhanced boolean logic, with persisten values after reboot and more.

> Wellcome! First of all thank you for your interest in my nodes. This is a set of logic nodes, to overcome the simplicity of the default node-red boolean logic nodes.
Hope you enjoy that and if you're in trouble, please ask!

## CHANGELOG
* See <a href="https://github.com/Supergiovane/node-red-contrib-hikvision-ultimate/blob/master/CHANGELOG.md">here the changelog</a>

# BOOLEAN LOGIC

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/bl1.png' width='60%'>

<details><summary>CLICK HERE, copy and paste it into your flow</summary>
<code>
[{"id":"1a90a718.5c0409","type":"BooleanLogicUltimate","z":"adb2ee5c.0bf6e","name":"","filtertrue":"both","persist":true,"sInitializeWith":"WaitForPayload","triggertopic":"trigger","outputtriggeredby":"all","inputCount":2,"topic":"result","x":380,"y":160,"wires":[["5f9fbfcc.d2c34"],[],[]]},{"id":"81ef6fec.5d413","type":"inject","z":"adb2ee5c.0bf6e","name":"Night","topic":"Dark","payload":"true","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":170,"y":180,"wires":[["1a90a718.5c0409"]]},{"id":"e0d5d620.966478","type":"inject","z":"adb2ee5c.0bf6e","name":"Daylight","topic":"Dark","payload":"false","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":160,"y":140,"wires":[["1a90a718.5c0409"]]},{"id":"1c2f8e73.2c22ba","type":"inject","z":"adb2ee5c.0bf6e","name":"Motion detect true","topic":"Motion","payload":"true","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":130,"y":240,"wires":[["1a90a718.5c0409"]]},{"id":"5f9fbfcc.d2c34","type":"debug","z":"adb2ee5c.0bf6e","name":"Garden Light","active":true,"tosidebar":true,"console":false,"tostatus":false,"complete":"true","targetType":"full","x":580,"y":160,"wires":[]},{"id":"201baa3d.7c63ae","type":"inject","z":"adb2ee5c.0bf6e","name":"Motion detect false","topic":"Motion","payload":"false","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":130,"y":280,"wires":[["1a90a718.5c0409"]]},{"id":"b65f4ff4.bfe2c8","type":"comment","z":"adb2ee5c.0bf6e","name":"Motion sensor turns on lights, when it's dark. The light turns off itself at day","info":"","x":290,"y":100,"wires":[]}]
</code>
</details>

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/bl2.png' width='60%'>

<details><summary>CLICK HERE, copy and paste it into your flow</summary>
<code>
[{"id":"53a10a7a.cf1894","type":"BooleanLogicUltimate","z":"a76c6a12.37379","name":"","filtertrue":"onlytrue","persist":true,"sInitializeWith":"true","triggertopic":"Pushbutton","outputtriggeredby":"onlyonetopic","inputCount":2,"topic":"result","x":340,"y":220,"wires":[["cd9244ea.471b78"],[],[]]},{"id":"9318320b.670af8","type":"inject","z":"a76c6a12.37379","name":"","topic":"Pushbutton","payload":"true","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":120,"y":220,"wires":[["53a10a7a.cf1894"]]},{"id":"20a981b9.552b4e","type":"inject","z":"a76c6a12.37379","name":"","topic":"IsNight","payload":"true","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":110,"y":320,"wires":[["53a10a7a.cf1894"]]},{"id":"da0dff55.d7888","type":"inject","z":"a76c6a12.37379","name":"","topic":"IsNight","payload":"false","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":110,"y":360,"wires":[["53a10a7a.cf1894"]]},{"id":"7129d101.1fb7d8","type":"comment","z":"a76c6a12.37379","name":"Pushbutton to switch on light stairs, only if it's night.","info":"","x":210,"y":180,"wires":[]},{"id":"cd9244ea.471b78","type":"debug","z":"a76c6a12.37379","name":"Temporized Stairs Lightbulb","active":true,"tosidebar":true,"console":false,"tostatus":false,"complete":"payload","targetType":"msg","x":580,"y":220,"wires":[]},{"id":"ad5a62a1.7ad81","type":"comment","z":"a76c6a12.37379","name":"Brightness sensor","info":"","x":110,"y":280,"wires":[]}]
</code>
</details>

The node performs Boolean logic on the incoming payloads.<br/>
The node expects a fixed number of topics (configured in the settings) on which it will operate. It will only output a value 
when it has seen the expected number of topics. If it ever sees more than the configured number of topics it will log a message then reset its state and start over.<br/>
The input message is preserved and passed to the output pin, changing only the topic and the payload. 

The node performs 3 checks (<b>AND,OR,XOR</b>) on the incoming boolean payloads and outputs the result at the same time, as follow:<br/>
- Output "AND": true or false<br/>
- Output "OR": true or false<br/>
- Output "XOR": true or false<br/>

The node can have a persistent input: the input values are retained after a node-red reboot. That means, that if you reboot your node-red, you don't need to wait all inputs to arrive and initialize the node, before the node can output a payload.<br/>
You can also set the default values of the topic inputs.


### CONFIGURATION


**Number of different topics to evaluate**

Set the number of different topics to be evaluated. The node will output a message to the flow, after this number of different topics arrives.<br/>
*Remember: each input topic must be different. For example, if you set this field to 3, the node expects 3 different topics.*


**Filter output result**

- Output both 'true' and 'false' results: Standard behaviour, the node will output <b>true</b> and <b>false</b> whenever it receives an input and calculate the boolean logics as output.
- Output only 'true' results: whenever the node receives an input, it outputs a payload <b>true</b> only if the result of the logic is true. <b>False</b> results are filtered out.

**Trigger mode**

- All topics: standard behaviour, the node will evaluate each input topic and ouputs the values. At each input change, it will output a msg on the flow.
- Single topic + eval other inputs: the node evaluates all the input topics, but only whenever it receives a msg input with the **specified topic**, it  outputs a msg to the flow.

**If input states are undefined**

Every time you create a node or modify the node, all inputs are set to undefined. This means that the node will wait the arrive of all topics (for example 3 topics, if you've selected 3 topics in the option), before it can output a payload. This can be a problem if your logic must be operative as soon as you deploy the flow. To overcome this problem, you can "initialize" all the undefined inputs with True or False.
- Leave undefined: Standard behaviour, the node will wait all the "undefined" topics to arrive, then starts a flow with the result.
- True or False: The node is immediately operative, by force the initialization of the "undefined" inputs with "true" or "false".

**Remember latest input values after reboot**

If checked, the input values are retained after a node-red reboot. That means, that if you reboot your node-red, you don't need to wait all inputs to arrive and initialize the node, before the node can output a payload.<br/>
Every time you modify the node's config, <b>the retained values are cleared</b>.<br/>


# INTERRUPT FLOWS ULTIMATE

Whenever this node receives a payload = false from a specific topic, it stops output messages to the flow. As soon it receives payload = true from this topic, the output messages start to flow out again.

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/if0.png' width='60%'>

<details><summary>CLICK HERE, copy and paste it into your flow</summary>
<code>
[{"id":"1fd91f1f.c1fae9","type":"InterruptFlowUltimate","z":"a76c6a12.37379","name":"Interrupt Flow","triggertopic":"IsNight","x":360,"y":440,"wires":[["b9844c7f.0f306"]]},{"id":"eaa32462.398808","type":"comment","z":"a76c6a12.37379","name":"Pushbutton to switch on stairs light, only if it's night, using flow interruption","info":"","x":300,"y":400,"wires":[]},{"id":"10787f38.edfe81","type":"inject","z":"a76c6a12.37379","name":"","topic":"IsNight","payload":"true","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":130,"y":540,"wires":[["1fd91f1f.c1fae9"]]},{"id":"a6092a15.1c592","type":"inject","z":"a76c6a12.37379","name":"","topic":"IsNight","payload":"false","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":130,"y":580,"wires":[["1fd91f1f.c1fae9"]]},{"id":"21ba9c30.02abbc","type":"comment","z":"a76c6a12.37379","name":"Brightness sensor","info":"","x":130,"y":500,"wires":[]},{"id":"af131ae5.a1bfb8","type":"inject","z":"a76c6a12.37379","name":"","topic":"Pushbutton","payload":"true","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":120,"y":440,"wires":[["1fd91f1f.c1fae9"]]},{"id":"b9844c7f.0f306","type":"debug","z":"a76c6a12.37379","name":"Temporized Stairs Lightbulb","active":true,"tosidebar":true,"console":false,"tostatus":false,"complete":"payload","targetType":"msg","x":600,"y":440,"wires":[]}]
</code>
</details>

<br/>
In this other example, you can see the property "play" in action. This property allow you to replay the last previously stored message.<br/>
This allow to save the state of a node and then replay it back whenever you want.

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/if1.png' width='60%'>

<details><summary>CLICK HERE, copy and paste it into your flow</summary>
<code>
[{"id":"9839dd47.81b2c8","type":"InterruptFlowUltimate","z":"1b769f85.fba14","name":"Interrupt Flow","triggertopic":"trigger","x":520,"y":260,"wires":[["d371d690.1e2fe8"]]},{"id":"568deb73.394fb4","type":"comment","z":"1b769f85.fba14","name":"1) Push buttons to change values","info":"","x":130,"y":100,"wires":[]},{"id":"e1c9f10a.0ba518","type":"inject","z":"1b769f85.fba14","name":"ALLOW","topic":"trigger","payload":"true","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":70,"y":320,"wires":[["9839dd47.81b2c8"]]},{"id":"82ba24f9.0f0bd8","type":"inject","z":"1b769f85.fba14","name":"INTERRUPT","topic":"trigger","payload":"false","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":90,"y":280,"wires":[["9839dd47.81b2c8"]]},{"id":"23ba4f9c.86de9","type":"comment","z":"1b769f85.fba14","name":"2) Push INTERRUPT, then try again to change value (1)","info":"","x":200,"y":240,"wires":[]},{"id":"24671ef2.4519e2","type":"inject","z":"1b769f85.fba14","name":"","topic":"","payload":"true","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":70,"y":140,"wires":[["9839dd47.81b2c8"]]},{"id":"d371d690.1e2fe8","type":"debug","z":"1b769f85.fba14","name":"Debug","active":true,"tosidebar":true,"console":false,"tostatus":false,"complete":"payload","targetType":"msg","x":690,"y":260,"wires":[]},{"id":"409ec415.735d74","type":"inject","z":"1b769f85.fba14","name":"REPLAY","topic":"trigger","payload":"","payloadType":"str","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":80,"y":420,"wires":[["6653ed0.7186014"]]},{"id":"6653ed0.7186014","type":"change","z":"1b769f85.fba14","name":"Play","rules":[{"t":"set","p":"play","pt":"msg","to":"true","tot":"bool"}],"action":"","property":"","from":"","to":"","reg":false,"x":210,"y":420,"wires":[["9839dd47.81b2c8"]]},{"id":"e957a069.0ac458","type":"inject","z":"1b769f85.fba14","name":"","topic":"","payload":"false","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":70,"y":180,"wires":[["9839dd47.81b2c8"]]},{"id":"8f0af608.8fb45","type":"comment","z":"1b769f85.fba14","name":"3) Replay last message stored by the node","info":"","x":160,"y":380,"wires":[]},{"id":"46e6f455.0023ac","type":"comment","z":"1b769f85.fba14","name":"You can use Interruptflow, to save the state of a node, and then replay the last state as you want.","info":"","x":330,"y":60,"wires":[]}]
</code>
</details>

# INVERT ULTIMATE

Outputs the inverted input. For example true -> false<br />
The input message is preserved and passed to the output pin, changing only the topic and the payload. If the input message has it's own topic, it'll be preserved as well.

# FILTER ULTIMATE

This node has 2 outputs.<br />
If the input payload is true, the node will send <code>true</code> on output 1 and nothing on oputput 2<br />
If the input payload is false, the node will send nothing on output 1, and <code>false</code> on oputput 2<br />
The input message is preserved and passed to the output pin, changing only the topic and the payload. If the input message has it's own topic, it'll be preserved as well.

# BLINKER ULTIMATE

The pourpose of this node is to blink a led or something.<br />
Pass <code>msg.payload = true</code> to start blinking</br>
Pass <code>msg.payload = false</code> to stop blinking</br>
Pass <code>msg.interval = 2000</code> to change the blinking interval</br>

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/blinker.png' width='60%'>

<details><summary>CLICK HERE, copy and paste it into your flow</summary>
<code>
[{"id":"33d76f42.58e088","type":"BlinkerUltimate","z":"c3456bd7.8ee9d8","name":"Blinker","blinkfrequency":"500","x":260,"y":340,"wires":[["ad7488b.2a1d9f8"]]},{"id":"ac0d404f.70cc","type":"inject","z":"c3456bd7.8ee9d8","name":"","topic":"","payload":"true","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":90,"y":320,"wires":[["33d76f42.58e088"]]},{"id":"bfdc64c6.06e2d","type":"inject","z":"c3456bd7.8ee9d8","name":"","topic":"","payload":"false","payloadType":"bool","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":90,"y":360,"wires":[["33d76f42.58e088"]]},{"id":"ad7488b.2a1d9f8","type":"debug","z":"c3456bd7.8ee9d8","name":"Led","active":true,"tosidebar":true,"console":false,"tostatus":false,"complete":"payload","targetType":"msg","x":410,"y":340,"wires":[]},{"id":"865e29f9.4d1e98","type":"comment","z":"c3456bd7.8ee9d8","name":"Blink a signalling led","info":"","x":110,"y":280,"wires":[]}]
</code>
</details>


# SIMPLE OUTPUT ULTIMATE

The pourpose of this node is to send a message with payload TRUE on the first pin and FALSE on second pin, independently from the msg input.<br />
This is useful if you need to simply send a true or false payload.

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/SimpleOutput.png' width='60%'>

<details><summary>CLICK HERE, copy and paste it into your flow</summary>
<code>
[{"id":"e1149e22.c9b298","type":"inject","z":"81a64dae.012c18","name":"","topic":"","payload":"","payloadType":"date","repeat":"","crontab":"","once":false,"onceDelay":0.1,"x":100,"y":820,"wires":[["6a419c72.5a4e7c"]]},{"id":"6a419c72.5a4e7c","type":"SimpleOutputUltimate","z":"81a64dae.012c18","name":"T/F","x":290,"y":820,"wires":[["8ba3f611.26beb8"],["b469193b.950598"]]},{"id":"8ba3f611.26beb8","type":"debug","z":"81a64dae.012c18","name":"","active":true,"tosidebar":true,"console":false,"tostatus":false,"complete":"true","targetType":"full","x":530,"y":800,"wires":[]},{"id":"b469193b.950598","type":"debug","z":"81a64dae.012c18","name":"","active":true,"tosidebar":true,"console":false,"tostatus":false,"complete":"true","targetType":"full","x":530,"y":840,"wires":[]},{"id":"2451f593.04e62a","type":"comment","z":"81a64dae.012c18","name":"Whatever the input is, output msg with payload TRUE on first and FALSE on second pin.","info":"","x":330,"y":760,"wires":[]}]
</code>
</details>


# INJECT ULTIMATE

The pourpose of this node is to send a message with payload TRUE on the first pin, FALSE on second pin and a TOGGLE (true/false) on the third pin, by pressing the pushbutton.<br />
This is useful if you need to simply test your flow. The node is simpler as the default node-red inject node.

<img src='https://raw.githubusercontent.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/img/Inject.png' width='60%'>

<details><summary>CLICK HERE, copy and paste it into your flow</summary>
<code>
[{"id":"13faaec9.cd80b9","type":"InjectUltimate","z":"81a64dae.012c18","name":"True","x":110,"y":1000,"wires":[["6557d19.c71abb"],[],[]]},{"id":"6557d19.c71abb","type":"debug","z":"81a64dae.012c18","name":"","active":true,"tosidebar":true,"console":false,"tostatus":false,"complete":"false","x":370,"y":1080,"wires":[]},{"id":"569b3820.b056e8","type":"InjectUltimate","z":"81a64dae.012c18","name":"False","x":110,"y":1080,"wires":[[],["6557d19.c71abb"],[]]},{"id":"189399f.c384f66","type":"InjectUltimate","z":"81a64dae.012c18","name":"Toggle","x":110,"y":1160,"wires":[[],[],["6557d19.c71abb"]]},{"id":"56119644.8c4bf8","type":"comment","z":"81a64dae.012c18","name":"Inject Ultimate. Simple and efficient.","info":"","x":180,"y":940,"wires":[]}]
</code>
</details>

[license-image]: https://img.shields.io/badge/license-MIT-blue.svg
[license-url]: https://github.com/Supergiovane/node-red-contrib-hikvision-ultimate/master/LICENSE
[npm-url]: https://npmjs.org/package/node-red-contrib-hikvision-ultimate
[npm-version-image]: https://img.shields.io/npm/v/node-red-contrib-hikvision-ultimate.svg
[npm-downloads-month-image]: https://img.shields.io/npm/dm/node-red-contrib-hikvision-ultimate.svg
[npm-downloads-total-image]: https://img.shields.io/npm/dt/node-red-contrib-hikvision-ultimate.svg
