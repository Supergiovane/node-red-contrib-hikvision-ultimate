const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { canonicalEventType } = require('./alarmEventAliases');

const VIDEO_CHANNELS = '/ISAPI/System/Video/inputs/channels';
const PROXY_CHANNELS = '/ISAPI/ContentMgmt/InputProxy/channels';
const MAX_BODY = 2 * 1024 * 1024;
const MAX_RECORDS = 1024;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const array = value => Array.isArray(value) ? value : value == null ? [] : [value];

function id(value, allowAll = false) {
    if (!['string', 'number'].includes(typeof value)) return null;
    return (allowAll ? /^(0|[1-9]\d{0,5})$/ : /^[1-9]\d{0,5}$/).test(String(value)) ? String(value) : null;
}

function name(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) value = value['#text'];
    return typeof value === 'string' ? value.trim().slice(0, 128) : '';
}

function eventTypes(value) {
    if (typeof value !== 'string' || value.length > 512) throw new Error('Invalid event type');
    if (!value) return [];
    const values = value.split(',').map(part => canonicalEventType(part.trim()));
    if (values.length > 16 || values.some(part => !/^[a-z\d][a-z\d_.:-]{0,127}$/i.test(part))) throw new Error('Invalid event type');
    return [...new Set(values)].sort();
}

function parseMetadataDocument(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BODY) throw new Error('Invalid metadata response size');
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
    if (!trimmed.startsWith('<') || /<!DOCTYPE|<!ENTITY/i.test(trimmed) || XMLValidator.validate(trimmed) !== true) throw new Error('Invalid metadata response');
    // Names can be numeric ("001") or contain escaped XML text. DTDs are rejected
    // above; predefined XML entities are decoded and the editor renders text only.
    return new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(trimmed);
}

function extractChannels(document, path) {
    const proxy = path === PROXY_CHANNELS;
    const root = proxy ? 'InputProxyChannelList' : 'VideoInputChannelList';
    const item = proxy ? 'InputProxyChannel' : 'VideoInputChannel';
    if (!document || !hasOwn(document, root)) throw new Error('Unrecognized channel list');
    const channels = new Map();
    for (const entry of array(document[root] && document[root][item]).slice(0, MAX_RECORDS)) {
        if (!entry || typeof entry !== 'object') continue;
        const channelID = id(entry.id);
        if (channelID) channels.set(channelID, { id: channelID, name: name(entry.name ?? entry.channelName) });
    }
    return { channels: [...channels.values()] };
}

// Only documented region resources are queried. Event names from the camera or
// editor are never interpolated into paths. A channel ID is always a video input
// ID, never a streaming channel such as 101.
const SMART_RULES = {
    fielddetection: ['FieldDetection', 'FieldDetectionRegionList', 'FieldDetectionRegion', 'FieldDetection'],
    linedetection: ['LineDetection', 'LineItemList', 'LineItem', 'LineDetection'],
    regionentrance: ['RegionEntrance', 'RegionEntranceRegionList', 'RegionEntranceRegion', 'regionEntrance'],
    regionexiting: ['RegionExiting', 'RegionExitingRegionList', 'RegionExitingRegion', 'regionExiting']
};

function rulePlan(channel, types, documents) {
    if (!channel || !types.length) return null;
    const thermal = types.every(type => ['thermometry', 'tma', 'tmpa'].includes(type));
    if (thermal) return { path: '/ISAPI/Thermal/channels/' + channel + '/thermometry/1', kind: 'thermal', sceneID: '1' };
    if (types.length !== 1) return null;
    const type = types[0];
    const spec = SMART_RULES[type];
    if (!spec) return null;
    const capPath = '/ISAPI/Intelligent/channels/' + channel + '/capabilities';
    if (documents.get(capPath)?.value?.behavior) return { path: '/ISAPI/Intelligent/channels/' + channel + '/behaviorRule/1', kind: 'behavior', sceneID: '1', capPath };
    return { path: '/ISAPI/Smart/' + spec[3] + '/' + channel, spec, capPath, kind: 'smart' };
}

function extractSmartZones(document, spec, channelID) {
    if (!document || !hasOwn(document, spec[0])) throw new Error('Unrecognized rule configuration');
    const root = document[spec[0]];
    if (channelID && root && hasOwn(root, 'id') && id(root.id) !== channelID) throw new Error('Unexpected rule channel');
    const entries = root && root[spec[1]] && root[spec[1]][spec[2]];
    const zones = new Map();
    for (const entry of array(entries).slice(0, MAX_RECORDS)) {
        if (!entry || typeof entry !== 'object') continue;
        // The root id is the channel, and coordinate ids are not alarm regions.
        const regionID = id(entry.id);
        if (regionID) zones.set(regionID, { id: regionID, name: name(entry.name ?? entry.regionName ?? entry.ruleName) });
    }
    return { zones: [...zones.values()] };
}

// Manufacturer schemas: Intelligent §1.12 (BehaviorRule), Thermal §22
// (ThermometryScene), at https://open.hikvision.com/hardware/v2/ . Scene 1 is
// explicitly labelled in the editor; it is not assumed to be the active scene.
// IDs are used verbatim, with no rule/region offset or new alarm filtering.
function extractSceneZones(document, kind, sceneID) {
    const root = kind === 'behavior' ? document?.BehaviorRule : document?.ThermometryScene;
    if (!root || typeof root !== 'object' || id(kind === 'behavior' ? root.sid : root.id, true) !== sceneID) throw new Error('Unrecognized rule scene');
    const entries = kind === 'behavior' ? root.RuleInfoList?.RuleInfo : root.ThermometryRegionList?.ThermometryRegion;
    const zones = [];
    for (const entry of array(entries).slice(0, MAX_RECORDS)) {
        if (!entry || typeof entry !== 'object') continue;
        const regionID = id(kind === 'behavior' ? entry.ruleId : entry.id);
        if (!regionID) continue;
        let type = '';
        if (kind === 'behavior') {
            try {
                const types = eventTypes(entry.eventType);
                if (types.length !== 1) continue;
                type = types[0];
            } catch (_) { continue; }
        }
        zones.push({ id: regionID, name: name(kind === 'behavior' ? entry.ruleName : entry.name), sceneID, ...(type ? { eventType: type } : {}) });
    }
    return { zones };
}

function createAlarmMetadata({ fetch, getCapabilities = () => ({ channels: [] }), now = Date.now, requestTimeoutMs = 4000, cacheTtlMs = 300000, failureTtlMs = 30000, backoff = { until: 0, warning: '' } }) {
    const documents = new Map();
    const inFlight = new Map();
    const controllers = new Set();
    const observedChannels = new Map();
    const observedZones = new Map();
    let queue = Promise.resolve();
    let closed = false;

    function boundedSet(map, key, value, limit = MAX_RECORDS) {
        map.delete(key);
        if (map.size >= limit) map.delete(map.keys().next().value);
        map.set(key, value);
    }

    function observe(entry, depth = 0) {
        if (closed || depth > 24 || !entry || typeof entry !== 'object') return;
        if (Array.isArray(entry)) return entry.slice(0, MAX_RECORDS).forEach(value => observe(value, depth + 1));
        if (entry.EventNotificationAlert) return observe(entry.EventNotificationAlert, depth + 1);
        const channel = id(entry.channelID ?? entry.dynChannelID);
        if (!channel) return;
        const channelName = name(entry.channelName);
        boundedSet(observedChannels, channel, { id: channel, name: channelName || observedChannels.get(channel)?.name || '' });
        let types;
        try { types = eventTypes(entry.eventType); } catch (_) { return; }
        if (types.length !== 1 || types[0] === 'duration') return;
        const regions = entry.DetectionRegionList && entry.DetectionRegionList.DetectionRegionEntry;
        for (const region of array(regions).slice(0, MAX_RECORDS)) {
            if (!region || typeof region !== 'object') continue;
            const regionID = id(region.regionID);
            if (!regionID) continue;
            const key = channel + ':' + types[0] + ':' + regionID;
            const previous = observedZones.get(key);
            boundedSet(observedZones, key, { id: regionID, channelID: channel, eventType: types[0], name: name(region.regionName ?? region.ruleName ?? region.name) || (previous && previous.name) || '' });
        }
    }

    function channelSnapshot() {
        const channels = new Map(observedChannels);
        const capabilities = getCapabilities() || {};
        for (const channel of array(capabilities.channels).slice(0, MAX_RECORDS)) {
            if (channel && id(channel.id)) channels.set(String(channel.id), { id: String(channel.id), name: name(channel.name) || channels.get(String(channel.id))?.name || '' });
        }
        for (const path of [VIDEO_CHANNELS, PROXY_CHANNELS]) {
            const record = documents.get(path);
            if (record && record.value) for (const channel of record.value.channels) {
                channels.set(channel.id, { ...channel, name: channel.name || channels.get(channel.id)?.name || '' });
            }
        }
        return [...channels.values()].sort((a, b) => Number(a.id) - Number(b.id));
    }

    function selectedChannel(channel, channels) {
        return channel !== '0' ? channel : channels.length === 1 ? channels[0].id : null;
    }

    function snapshot(channelID = '0', eventType = '') {
        const channel = id(channelID, true);
        if (channel === null) throw new Error('Invalid channel ID');
        const types = eventTypes(eventType);
        if (closed) return { channels: [], zones: [], status: 'unavailable', warnings: ['Configuration has been closed'], updatedAt: null };
        const channels = channelSnapshot();
        const selected = selectedChannel(channel, channels);
        const plan = rulePlan(selected, types, documents);
        const zones = new Map();
        if (selected && types.length === 1) observedZones.forEach(record => {
            if (record.channelID === selected && record.eventType === types[0]) zones.set(record.id, { ...record });
        });
        const ruleRecord = plan && documents.get(plan.path);
        const capRecord = plan?.capPath && documents.get(plan.capPath);
        const relevant = [documents.get(VIDEO_CHANNELS), documents.get(PROXY_CHANNELS), ruleRecord,
            // Unsupported optional Intelligent capabilities are harmless if the
            // ordinary Smart resource returned a valid configuration.
            capRecord && (!ruleRecord?.value || capRecord.blocked) ? capRecord : null].filter(Boolean);
        const configured = plan && documents.get(plan.path);
        if (configured && configured.value) for (const region of configured.value.zones) {
            if (region.eventType && !types.includes(region.eventType)) continue;
            zones.set(region.id, { ...region, channelID: selected, eventType: types[0] });
        }
        const warnings = [...new Set(relevant.map(record => record.warning).filter(Boolean))];
        if (now() < backoff.until && !warnings.includes(backoff.warning)) warnings.push(backoff.warning);
        if (!selected && channel === '0') warnings.push('Select a channel to read its zone/rule names.');
        else if (types.length > 1 && !plan) warnings.push('Select one event type to read its zone/rule names.');
        else if (!plan && !zones.size) warnings.push('This event does not expose known zone names. The current zone selection is preserved.');
        if (plan?.sceneID && configured?.value) warnings.push('Rule names are from scene ' + plan.sceneID + '. The alarm filter still uses the zone ID across scenes.');
        const hasData = channels.length > 0 || zones.size > 0;
        const failed = relevant.some(record => record.warning);
        return {
            channels,
            zones: [...zones.values()].sort((a, b) => Number(a.id) - Number(b.id)),
            status: failed || now() < backoff.until ? hasData ? 'partial' : 'unavailable' : relevant.length ? 'ok' : hasData ? 'cached' : 'unavailable',
            warnings, updatedAt: Math.max(0, ...relevant.map(record => record.updatedAt || 0)) || null
        };
    }

    async function read(path, parser, force) {
        const previous = documents.get(path);
        if (closed || now() < backoff.until) return previous?.value;
        if (!force && previous && now() - previous.attemptedAt < (previous.warning ? failureTtlMs : cacheTtlMs)) return previous.value;
        const controller = new AbortController();
        controllers.add(controller);
        let timer;
        const abortPromise = new Promise((resolve, reject) => {
            controller.signal.addEventListener('abort', () => reject(new Error('Metadata request aborted')), { once: true });
            timer = setTimeout(() => controller.abort(), requestTimeoutMs);
        });
        try {
            const operation = (async () => {
                const response = await fetch(path, { method: 'GET', signal: controller.signal, timeout: requestTimeoutMs, size: MAX_BODY });
                if (!response.ok) {
                    response.body?.destroy?.();
                    const error = new Error('Metadata request failed');
                    error.status = response.status;
                    throw error;
                }
                return parser(parseMetadataDocument(await response.text()));
            })();
            const value = await Promise.race([operation, abortPromise]);
            if (!closed) boundedSet(documents, path, { value, attemptedAt: now(), updatedAt: now(), warning: '' }, 128);
            return value;
        } catch (error) {
            const warning = path + ': ' + (error.status ? 'HTTP ' + error.status : 'unavailable or invalid response');
            if (!closed) {
                boundedSet(documents, path, { value: previous?.value, attemptedAt: now(), updatedAt: previous?.updatedAt, warning, blocked: [401, 403, 429, 503].includes(error.status) }, 128);
                if ([401, 403, 429, 503].includes(error.status)) {
                    backoff.until = now() + failureTtlMs;
                    backoff.warning = 'Name discovery paused after HTTP ' + error.status;
                }
            }
            return previous?.value;
        } finally {
            clearTimeout(timer);
            controllers.delete(controller);
        }
    }

    return {
        observe, snapshot,
        async refresh(channelID = '0', eventType = '', force = false) {
            const channel = id(channelID, true);
            if (channel === null) throw new Error('Invalid channel ID');
            const types = eventTypes(eventType);
            const key = channel + ':' + types.join(',');
            if (closed || now() < backoff.until) return snapshot(channel, eventType);
            if (!inFlight.has(key)) {
                if (inFlight.size >= 8) throw new Error('Name discovery is busy; retry shortly');
                const operation = queue.then(async () => {
                    if (closed || now() < backoff.until) return;
                    const video = await read(VIDEO_CHANNELS, doc => extractChannels(doc, VIDEO_CHANNELS), force);
                    const known = array((getCapabilities() || {}).channels).filter(record => record && id(record.id));
                    if (channel !== '0') known.push({ id: channel });
                    // A camera already returned its complete input list. Do not
                    // query an NVR-only resource, often rejected with HTTP 403.
                    if (!video || !video.channels.length || known.some(record => !video.channels.some(candidate => candidate.id === String(record.id)))) {
                        await read(PROXY_CHANNELS, doc => extractChannels(doc, PROXY_CHANNELS), force);
                    } else documents.delete(PROXY_CHANNELS);
                    const selected = selectedChannel(channel, channelSnapshot());
                    let plan = rulePlan(selected, types, documents);
                    if (plan?.capPath) {
                        await read(plan.capPath, doc => {
                            if (!doc || !hasOwn(doc, 'IntelliCap')) throw new Error('Unrecognized Intelligent capabilities');
                            const value = doc.IntelliCap?.isBehaviorSupport;
                            return { behavior: value === true || value === 1 || (typeof value === 'string' && /^(true|1)$/i.test(value)) };
                        }, force);
                        plan = rulePlan(selected, types, documents);
                    }
                    if (plan) await read(plan.path, doc => plan.kind === 'smart' ? extractSmartZones(doc, plan.spec, selected) : extractSceneZones(doc, plan.kind, plan.sceneID), force);
                });
                inFlight.set(key, operation);
                queue = operation.catch(() => {});
                operation.finally(() => inFlight.delete(key)).catch(() => {});
            }
            await inFlight.get(key);
            return snapshot(channel, eventType);
        },
        close() {
            closed = true;
            controllers.forEach(controller => controller.abort());
            documents.clear();
            observedChannels.clear();
            observedZones.clear();
        }
    };
}

module.exports = { createAlarmMetadata, parseMetadataDocument, extractChannels, extractSmartZones, extractSceneZones, eventTypes };
