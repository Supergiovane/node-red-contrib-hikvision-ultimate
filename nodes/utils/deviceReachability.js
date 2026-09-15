'use strict';

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { createHttpClient } = require('./httpClient');

const DEVICE_TYPES = ['Hikvision-config', 'AXPro-config', 'Doorbell-config', 'ANPR-config', 'Speaker-config', 'AccessControl-config'];
const DEVICE_INFO_PATH = '/ISAPI/System/deviceInfo';
const MAX_DEVICES = 64;
const MAX_BODY_BYTES = 1024 * 1024;

function deviceReferenceKey(type, index) {
    return 'device_' + type.replace('-config', '') + '_' + index;
}

function selectedDevices(config) {
    const references = [];
    for (const type of DEVICE_TYPES) {
        for (let index = 0; index < MAX_DEVICES; index++) {
            const id = config[deviceReferenceKey(type, index)];
            if (id !== undefined && id !== '') references.push(id);
        }
    }
    // Scalar config references are remapped by Node-RED inside subflows and
    // tracked during partial deploys. Accept a plain list for hand-written flows.
    return references.length ? references : config.devices;
}

function failure(code, message) {
    return Object.assign(new Error(message), { code });
}

// Older config nodes store host:port in .host; Hikvision-config stores just host.
// Validate the authority before giving any credentials to the HTTP client.
function deviceURL(device) {
    const protocol = device.protocol || 'http';
    let host = typeof device.host === 'string' ? device.host.trim() : '';
    const port = Number(device.port === undefined || device.port === null || device.port === '' ? (protocol === 'https' ? 443 : 80) : device.port);
    if (!['http', 'https'].includes(protocol) || !host || /[\s\/@?#\\]/.test(host)
        || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw failure('INVALID_CONFIG', 'Invalid device address, protocol or port');
    }
    const suffix = ':' + port;
    if (device.type !== 'Hikvision-config' && host.endsWith(suffix)) host = host.slice(0, -suffix.length);
    if (net.isIP(host) === 6) host = '[' + host + ']';
    const url = new URL(protocol + '://' + host + ':' + port + DEVICE_INFO_PATH);
    if (url.username || url.password || url.pathname !== DEVICE_INFO_PATH) throw failure('INVALID_CONFIG', 'Invalid device address');
    return url.toString();
}

function parseDeviceInfo(body) {
    const text = body.trim();
    if (!text) throw failure('EMPTY_RESPONSE', 'Device returned an empty response');
    let parsed;
    try {
        if (text.startsWith('{')) parsed = JSON.parse(text);
        else {
            if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(text) || XMLValidator.validate(text) !== true) throw new Error('Invalid XML');
            parsed = new XMLParser({ removeNSPrefix: true, parseTagValue: false, processEntities: false }).parse(text);
        }
    } catch (_) {
        throw failure('INVALID_RESPONSE', 'Device returned malformed information');
    }
    const roots = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? Object.keys(parsed).filter(key => !key.startsWith('?')) : [];
    const info = roots.length === 1 && roots[0] === 'DeviceInfo' ? parsed.DeviceInfo : null;
    if (!info || typeof info !== 'object' || Array.isArray(info)
        || !['deviceName', 'deviceID', 'model', 'serialNumber'].some(key => typeof info[key] === 'string' && info[key].trim())) {
        throw failure('INVALID_RESPONSE', 'Response does not contain valid DeviceInfo');
    }
    // Do not return the response, serial numbers, credentials or session cookies.
    return true;
}

function createDeviceProbe({ timeoutMs = 5000 } = {}) {
    const active = new Set();
    let closed = false;

    async function check(device) {
        const started = Date.now();
        let url, response, agent, deadline, timedOut = false;
        const controller = new AbortController();
        active.add(controller);
        try {
            if (closed) throw failure('CLOSED', 'Monitor is closing');
            if (!device || !DEVICE_TYPES.includes(device.type) || device.isClosing) throw failure('MISSING_CONFIG', 'Device configuration is missing or disabled');
            url = deviceURL(device);
            const credentials = device.credentials || {};
            const mode = String(device.authentication || 'digest').toLowerCase();
            const headers = { Accept: 'application/xml, application/json', 'Cache-Control': 'no-cache', Pragma: 'no-cache' };
            if (mode === 'sha256-salted') {
                if (!device.authCookie) throw failure('AUTH_SESSION_UNAVAILABLE', 'Device has no active authenticated session');
                headers.Cookie = device.authCookie;
            } else if (!['basic', 'digest'].includes(mode)) {
                throw failure('INVALID_CONFIG', 'Unsupported device authentication');
            }
            agent = device.protocol === 'https'
                ? new https.Agent({ rejectUnauthorized: false, maxSockets: 1 })
                : new http.Agent({ maxSockets: 1 });
            const client = createHttpClient({ username: credentials.user, password: credentials.password, authentication: mode === 'sha256-salted' ? 'none' : mode });
            // Covers the entire exchange, including Digest challenges and a body
            // that keeps trickling bytes fast enough to evade a socket timeout.
            deadline = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
            response = await client.fetch(url, { method: 'GET', headers, agent, signal: controller.signal, timeout: timeoutMs, size: MAX_BODY_BYTES });
            if (!response.ok) throw failure('HTTP_' + response.status, 'Device returned HTTP ' + response.status);
            parseDeviceInfo(await response.text());
            if (closed || controller.signal.aborted) throw failure('CLOSED', 'Monitor is closing');
            return { reachable: true, httpStatus: response.status, responseTime: Date.now() - started, checkedAt: new Date().toISOString(), error: null };
        } catch (error) {
            const code = timedOut || error.code === 'ETIMEDOUT' ? 'TIMEOUT' : error.code || 'REQUEST_FAILED';
            // Raw transport errors can contain addresses, headers or credentials.
            const known = ['INVALID_CONFIG', 'MISSING_CONFIG', 'AUTH_SESSION_UNAVAILABLE', 'EMPTY_RESPONSE', 'INVALID_RESPONSE', 'CLOSED'];
            const message = code === 'TIMEOUT' ? 'Timed out reading device information'
                : code === 'ERR_RESPONSE_TOO_LARGE' ? 'Device response exceeded the size limit'
                    : /^HTTP_\d+$/.test(code) || known.includes(code) ? error.message : 'Unable to read device information';
            return { reachable: false, httpStatus: response ? response.status : null, responseTime: Date.now() - started, checkedAt: new Date().toISOString(), error: { code, message } };
        } finally {
            clearTimeout(deadline);
            response?.body?.destroy();
            agent?.destroy();
            active.delete(controller);
        }
    }

    return { check, close() { closed = true; for (const controller of active) controller.abort(); } };
}

module.exports = { createDeviceProbe, parseDeviceInfo, deviceURL, selectedDevices, deviceReferenceKey, DEVICE_TYPES, DEVICE_INFO_PATH, MAX_DEVICES };
