const { XMLParser, XMLValidator } = require('fast-xml-parser');

// Capability responses describe support, not whether a rule is enabled. Only
// documented event flags are mapped: e.g. isSupportROI is an encoding capability.
const EVENT_FLAGS = {
    isSupportMotionDetection: 'vmd', isSupportVMD: 'vmd',
    isSupportVideoLoss: 'videoloss', isSupportShelterAlarm: 'shelteralarm',
    isSupportIO: 'io', isSupportFaceDetect: 'facedetection',
    isSupportIntelliTrace: 'intelliTrace', isSupportFieldDetection: 'fielddetection',
    isSupportDefocusDetection: 'defocusDetection', isSupportAudioDetection: 'audioDetection',
    isSupportSceneChangeDetection: 'scenechangedetection', isSupportLineDetection: 'linedetection',
    isSupportRegionEntrance: 'regionEntrance', isSupportRegionExiting: 'regionExiting',
    isSupportLoitering: 'loitering', isSupportGroup: 'group',
    isSupportRapidMove: 'rapidMove', isSupportParking: 'parking',
    isSupportUnattendedBaggage: 'unattendedBaggage', isSupportAttendedBaggage: 'attendedBaggage',
    isSupportFaceCapture: 'faceCapture', isSupportFaceSnap: 'faceSnap',
    isSupportFireDetection: 'fireDetection', isSupportSmokeDetection: 'smokeDetection',
    isSupportSmokeAndFireDetection: 'smokeAndFireDetection',
    isSupportDiskFull: 'diskfull', isSupportDiskError: 'diskerror',
    isSupportNicBroken: 'nicbroken', isSupportIPConflict: 'ipconflict',
    isSupportIllAccess: 'illaccess', isSupportCertificateRevocation: 'certificateRevocation'
};
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 1024;
const BASE_PATHS = [
    '/ISAPI/System/capabilities',
    '/ISAPI/Event/capabilities',
    '/ISAPI/Smart/capabilities',
    '/ISAPI/Event/channels/capabilities'
];
const CHANNEL_PATHS = [
    '/ISAPI/System/Video/inputs/channels',
    '/ISAPI/ContentMgmt/InputProxy/channels'
];

function channelKey(value, allowAll = true) {
    if (!['string', 'number'].includes(typeof value)) return null;
    if (!/^(0|[1-9]\d{0,5})$/.test(String(value))) return null;
    const id = Number(value);
    return id <= 999999 && (allowAll || id > 0) ? String(id) : null;
}

function eventID(value) {
    if (typeof value !== 'string') return null;
    const id = value.trim();
    return /^[a-z\d][a-z\d_.:-]{0,127}$/i.test(id) ? id : null;
}

function scalar(value) {
    if (value && typeof value === 'object') return value['#text'];
    return value;
}

function parseDocument(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BODY_BYTES) throw new Error('Invalid capability response size');
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
    if (!trimmed.startsWith('<') || /<!DOCTYPE|<!ENTITY/i.test(trimmed) || XMLValidator.validate(trimmed) !== true) {
        throw new Error('Invalid capability response');
    }
    return new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: false }).parse(trimmed);
}

function extractCapabilities(document, path, selectedChannel = '0') {
    const events = new Map();
    const channels = new Map();
    const isChannelList = CHANNEL_PATHS.includes(path);
    const eventRoots = new Set(['EventCap', 'SmartCap', 'ChannelEventCap', 'ChannelEventCapList']);
    let recognized = false;
    let visits = 0;

    function addEvent(value, channel) {
        const id = eventID(value);
        if (!id || events.size >= MAX_RECORDS) return;
        const key = id.toLowerCase() + ':' + (channel || '0');
        events.set(key, { id, channels: channel ? [channel] : [], sources: ['capability'] });
    }
    function addChannel(id, name) {
        const key = channelKey(scalar(id), false);
        if (!key || channels.size >= MAX_RECORDS) return null;
        channels.set(key, { id: key, name: typeof scalar(name) === 'string' ? scalar(name).slice(0, 128) : '', sources: ['capability'] });
        return key;
    }
    function eventValues(value, channel) {
        if (Array.isArray(value)) return value.forEach(entry => eventValues(entry, channel));
        if (value && typeof value === 'object') {
            // Both XML attribute notation and Hikvision's JSON capability notation.
            ['@_opt', '@opt', 'opt', '#text'].forEach(key => {
                if (Object.prototype.hasOwnProperty.call(value, key)) eventValues(value[key], channel);
            });
        } else if (typeof value === 'string') {
            value.split(',').slice(0, MAX_RECORDS).forEach(id => addEvent(id, channel));
        }
    }
    function walk(value, key = '', channel = selectedChannel === '0' ? null : selectedChannel, inEventRoot = false, depth = 0) {
        if (key === 'DeviceCap' || eventRoots.has(key) || (isChannelList && /^(VideoInputChannelList|InputProxyChannelList)$/.test(key))) recognized = true;
        if (++visits > 20000 || depth > 24 || !value || typeof value !== 'object') return;
        if (Array.isArray(value)) return value.slice(0, MAX_RECORDS).forEach(entry => walk(entry, key, channel, inEventRoot, depth + 1));
        const eventScope = inEventRoot || eventRoots.has(key);
        if (key === 'ChannelEventCap') {
            channel = addChannel(value.id ?? value.channelID ?? channel, value.name ?? value.channelName) || channel;
        }
        if (isChannelList && /^(VideoInputChannel|InputProxyChannel)$/.test(key)) {
            addChannel(value.id ?? value.channelID, value.name ?? value.channelName);
        }
        Object.entries(value).forEach(([childKey, child]) => {
            if (eventScope && Object.prototype.hasOwnProperty.call(EVENT_FLAGS, childKey) && /^(true|1)$/i.test(String(scalar(child)))) {
                addEvent(EVENT_FLAGS[childKey], channel);
            }
            if (eventScope && childKey === 'eventType') eventValues(child, channel);
            walk(child, childKey, channel, eventScope, depth + 1);
        });
    }
    walk(document);
    if (!recognized) throw new Error('Device returned no recognized capability data');
    return { events: [...events.values()], channels: [...channels.values()] };
}

function createAlarmCapabilities({ fetch, now = Date.now, requestTimeoutMs = 4000, cacheTtlMs = 300000, failureTtlMs = 30000, backoff = { until: 0, warning: '' } }) {
    const documents = new Map();
    const attempts = new Map();
    const inFlight = new Map();
    const controllers = new Set();
    const observed = new Map();
    let closed = false;
    let queue = Promise.resolve();

    function observe(entry, depth = 0) {
        if (closed || depth > 24 || !entry || typeof entry !== 'object') return;
        if (Array.isArray(entry)) return entry.slice(0, MAX_RECORDS).forEach(value => observe(value, depth + 1));
        if (entry.EventNotificationAlert) return observe(entry.EventNotificationAlert, depth + 1);
        let id = eventID(entry.eventType);
        if (!id) return;
        const state = typeof entry.eventState === 'string' ? entry.eventState.toLowerCase() : '';
        if (id.toLowerCase() === 'videoloss' && state === 'inactive' && ['string', 'number'].includes(typeof entry.activePostCount) && [0, 1].includes(Number(entry.activePostCount))) return;
        if (id.toLowerCase() === 'duration') {
            const relations = entry.DurationList && entry.DurationList.Duration;
            (Array.isArray(relations) ? relations : [relations]).filter(Boolean).slice(0, MAX_RECORDS).forEach(relation => {
                const relatedID = eventID(relation.relationEvent);
                if (relatedID && relatedID.toLowerCase() !== 'duration') observe({ ...entry, eventType: relatedID, eventDescription: '' }, depth + 1);
            });
            return;
        }
        const channel = channelKey(entry.channelID ?? entry.dynChannelID, false);
        const key = id.toLowerCase() + ':' + (channel || '0');
        const previous = observed.get(key);
        observed.delete(key);
        if (observed.size >= MAX_RECORDS) observed.delete(observed.keys().next().value);
        observed.set(key, {
            id, label: typeof entry.eventDescription === 'string' && entry.eventDescription ? entry.eventDescription.slice(0, 256) : previous ? previous.label : id,
            channels: channel ? [channel] : [],
            channelName: typeof entry.channelName === 'string' && entry.channelName ? entry.channelName.slice(0, 128) : previous ? previous.channelName : '',
            sources: ['observed'], hasState: Boolean(previous && previous.hasState) || /^(active|inactive)$/.test(state)
        });
    }

    function snapshot(channelID = '0') {
        const channel = channelKey(channelID);
        if (channel === null) throw new Error('Invalid channel ID');
        const events = new Map();
        const channels = new Map();
        const addChannel = record => {
            const existing = channels.get(record.id);
            channels.set(record.id, { ...record, name: record.name || (existing && existing.name) || '', sources: [...new Set([...(existing ? existing.sources : []), ...record.sources])] });
        };
        const addEvent = record => {
            if (channel !== '0' && record.channels.length && !record.channels.includes(channel)) return;
            const key = record.id.toLowerCase();
            const existing = events.get(key);
            const result = existing || { id: record.id, sources: [], channels: [] };
            result.sources = [...new Set([...result.sources, ...record.sources])];
            result.channels = [...new Set([...result.channels, ...record.channels])];
            if (record.label) result.label = record.label;
            if (record.hasState !== undefined) result.hasState = Boolean(result.hasState || record.hasState);
            events.set(key, result);
        };
        // A per-channel response supersedes device-wide support for that channel.
        const channelDocument = documents.get('/ISAPI/Event/channels/' + channel + '/capabilities');
        documents.forEach((document, path) => {
            document.channels.forEach(addChannel);
            if (channelDocument && channel !== '0' && BASE_PATHS.includes(path)) {
                // The direct channel response is the most specific evidence.
            } else {
                document.events.forEach(addEvent);
            }
        });
        observed.forEach(record => {
            record.channels.forEach(id => addChannel({ id, name: record.channelName, sources: ['observed'] }));
            addEvent(record);
        });
        const states = (channel === '0' ? [...attempts.values()] : [attempts.get('0'), attempts.get(channel)]).filter(Boolean);
        const warnings = [...new Set(states.flatMap(state => state.warnings))];
        if (now() < backoff.until && !warnings.includes(backoff.warning)) warnings.push(backoff.warning);
        const successes = states.reduce((total, state) => total + state.successes, 0);
        const hasData = events.size > 0 || channels.size > 0;
        const status = closed || !states.length ? 'unavailable' : warnings.length ? (successes ? 'partial' : hasData ? 'cached' : 'unavailable') : 'ok';
        return {
            events: [...events.values()].sort((a, b) => a.id.localeCompare(b.id)),
            channels: [...channels.values()].sort((a, b) => Number(a.id) - Number(b.id)),
            status, warnings: closed ? ['Configuration has been closed'] : warnings,
            updatedAt: states.length ? Math.max(...states.map(state => state.updatedAt || 0)) || null : null
        };
    }

    async function read(path, channel) {
        const controller = new AbortController();
        controllers.add(controller);
        let timer;
        const abortPromise = new Promise((resolve, reject) => {
            controller.signal.addEventListener('abort', () => reject(new Error(closed ? 'Configuration has been closed' : 'Capability request timed out')), { once: true });
            timer = setTimeout(() => controller.abort(), requestTimeoutMs);
        });
        try {
            const operation = (async () => {
                const response = await fetch(path, { signal: controller.signal, timeout: requestTimeoutMs, size: MAX_BODY_BYTES });
                if (!response.ok) {
                    if (response.body && typeof response.body.destroy === 'function') response.body.destroy();
                    const error = new Error('HTTP ' + response.status);
                    error.status = response.status;
                    throw error;
                }
                const body = await response.text();
                return extractCapabilities(parseDocument(body), path, channel);
            })();
            const document = await Promise.race([operation, abortPromise]);
            if (!closed) documents.set(path, document);
            return document;
        } finally {
            clearTimeout(timer);
            controllers.delete(controller);
        }
    }

    function discover(channel, force) {
        if (closed || now() < backoff.until) return Promise.resolve();
        if (inFlight.has(channel)) return inFlight.get(channel);
        const previous = attempts.get(channel);
        if (!force && previous && now() - previous.attemptedAt < (previous.warnings.length ? failureTtlMs : cacheTtlMs)) return Promise.resolve();
        if (inFlight.size >= 8) return Promise.reject(new Error('Capability discovery is busy; retry shortly'));
        const operation = queue.then(async () => {
            if (closed || now() < backoff.until) return;
            let paths = channel === '0' ? [...BASE_PATHS] : ['/ISAPI/Event/channels/' + channel + '/capabilities'];
            const warnings = [];
            let successes = 0;
            let freshChannelList = null;
            const freshInputLists = new Map();
            const unsupportedInputLists = new Set();
            for (let i = 0; i < paths.length && !closed; i++) {
                const path = paths[i];
                try {
                    const document = await read(path, channel);
                    if (path === '/ISAPI/Event/channels/capabilities') freshChannelList = document.channels;
                    if (CHANNEL_PATHS.includes(path)) freshInputLists.set(path, document.channels);
                    successes++;
                } catch (error) {
                    warnings.push(path + ': ' + (error.status ? 'HTTP ' + error.status : 'unavailable or invalid response'));
                    if (CHANNEL_PATHS.includes(path) && [404, 405, 501].includes(error.status)) unsupportedInputLists.add(path);
                    // Avoid repeatedly authenticating with bad credentials or hammering a busy device.
                    if ([401, 403, 429, 503].includes(error.status)) {
                        backoff.until = now() + failureTtlMs;
                        backoff.warning = 'Capability discovery paused after HTTP ' + error.status;
                        break;
                    }
                }
                if (channel === '0' && i === BASE_PATHS.length - 1 && !(freshChannelList && freshChannelList.length)) paths.push(...CHANNEL_PATHS);
            }
            if (!closed) {
                // A refreshed channel list replaces the previous topology. Old
                // per-channel documents must not reintroduce removed channels.
                const authoritativeChannels = freshChannelList && freshChannelList.length ? freshChannelList : freshInputLists.size > 0 && freshInputLists.size + unsupportedInputLists.size === CHANNEL_PATHS.length ? [...freshInputLists.values()].flat() : null;
                if (authoritativeChannels) {
                    const ids = new Set(authoritativeChannels.map(record => record.id));
                    if (freshChannelList && freshChannelList.length) CHANNEL_PATHS.forEach(path => documents.delete(path));
                    unsupportedInputLists.forEach(path => documents.delete(path));
                    // Stale all-channel capability records cannot restore channels
                    // absent from a fresh complete input list.
                    if (!(freshChannelList && freshChannelList.length)) {
                        const old = documents.get('/ISAPI/Event/channels/capabilities');
                        if (old) documents.set('/ISAPI/Event/channels/capabilities', {
                            channels: old.channels.filter(record => ids.has(record.id)),
                            events: old.events.filter(record => !record.channels.length || record.channels.some(id => ids.has(id)))
                        });
                    }
                    [...documents.keys()].forEach(path => {
                        const match = /^\/ISAPI\/Event\/channels\/(\d+)\/capabilities$/.exec(path);
                        if (match && !ids.has(match[1])) { documents.delete(path); attempts.delete(match[1]); }
                    });
                }
                if (attempts.size >= 128 && !attempts.has(channel)) {
                    const oldest = [...attempts.keys()].find(key => key !== '0');
                    attempts.delete(oldest);
                    documents.delete('/ISAPI/Event/channels/' + oldest + '/capabilities');
                }
                attempts.set(channel, { attemptedAt: now(), updatedAt: successes ? now() : previous && previous.updatedAt, successes, warnings });
            }
        });
        inFlight.set(channel, operation);
        queue = operation.catch(() => {});
        operation.finally(() => inFlight.delete(channel)).catch(() => {});
        return operation;
    }

    return {
        observe, snapshot,
        async refresh(channelID = '0', force = false) {
            const channel = channelKey(channelID);
            if (channel === null) throw new Error('Invalid channel ID');
            await discover('0', force);
            if (channel !== '0') await discover(channel, force);
            else {
                const knownChannels = snapshot().channels;
                if (knownChannels.length === 1) await discover(knownChannels[0].id, force);
            }
            return snapshot(channel);
        },
        close() {
            closed = true;
            controllers.forEach(controller => controller.abort());
            observed.clear();
            documents.clear();
        }
    };
}

module.exports = { createAlarmCapabilities, extractCapabilities, parseDocument };
