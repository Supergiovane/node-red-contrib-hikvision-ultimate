// Hikvision ISAPI General Application Developer Guide, section 16.2.95
// XML_ChannelEventCap, printed pages 554 and 558. Parenthesized legacy names
// describe the same event, and devices may advertise both versions.
// Manufacturer-authored reference (mirror):
// https://support.zabbix.com/secure/attachment/284957/isapi-2.pdf#page=598
const documentedEventGroups = Object.freeze([
    ['vmd', 'motionDetection'],
    ['shelteralarm', 'tamperDetection'],
    ['facedetection', 'faceDetection'],
    ['fielddetection', 'fieldDetection'],
    ['defocus', 'defocusDetection'],
    ['audioexception', 'audioDetection'],
    ['scenechangedetection', 'sceneChangeDetection'],
    ['linedetection', 'lineDetection'],
    ['faceCapture', 'faceSnap'],
    ['ANPR', 'vehicleDetection'],
    ['targetCapture', 'humanRecognition'],
    ['alarmResult', 'faceContrast'],
    ['temperature', 'temperatureDetection']
].map(group => Object.freeze(group)));

// These five historical catalog IDs contained a zero-width space after the
// underscore. Keep compatibility for saved flows without rewriting other IDs.
const legacyCatalogEventIds = Object.freeze({
    'AID_\u200bcongestion': 'AID_congestion',
    'AID_\u200bconstruction': 'AID_construction',
    'AID_\u200btrafficAccident': 'AID_trafficAccident',
    'AID_\u200bfogDetection': 'AID_fogDetection',
    'TFS_\u200bwrongDirection': 'TFS_wrongDirection'
});
const correctedCatalogId = new Map(Object.entries(legacyCatalogEventIds)
    .map(([legacy, corrected]) => [legacy.toLowerCase(), corrected.toLowerCase()]));

const canonicalByAlias = new Map();
for (const group of documentedEventGroups) {
    const canonical = group[0].toLowerCase();
    for (const alias of group) canonicalByAlias.set(alias.toLowerCase(), canonical);
}

function canonicalEventType(value) {
    if (typeof value !== 'string') return '';
    const original = value.toLowerCase();
    const key = correctedCatalogId.get(original) || original;
    return canonicalByAlias.get(key) || key;
}

function isSameEventType(left, right) {
    const canonical = canonicalEventType(left);
    return canonical !== '' && canonical === canonicalEventType(right);
}

module.exports = { documentedEventGroups, legacyCatalogEventIds, canonicalEventType, isSameEventType };
