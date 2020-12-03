# node-red-contrib-hikvision-ultimate
[![Donate via PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=flat-square)](https://www.paypal.me/techtoday) 

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
