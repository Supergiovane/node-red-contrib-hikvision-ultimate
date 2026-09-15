'use strict';

const { createDeviceProbe, selectedDevices, DEVICE_TYPES, MAX_DEVICES } = require('./utils/deviceReachability');

module.exports = function (RED) {
    function DeviceStatus(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const configuredIDs = selectedDevices(config);
        const ids = Array.isArray(configuredIDs) ? [...new Set(configuredIDs.filter(id => typeof id === 'string' && id))] : [];
        const setting = (value, fallback) => value === undefined ? fallback
            : typeof value === 'number' || typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
        const interval = setting(config.interval, 30);
        const timeout = setting(config.timeout, 5);
        const failureThreshold = setting(config.failureThreshold, 2);
        const changesOnly = config.changesOnly !== false;
        const topic = config.topic || config.name || '';
        let closed = false, running = null, timer = null;
        const states = new Map(ids.map(id => [id, { id, available: null, failures: 0, lastSuccess: null, nextCheck: 0, result: null, instance: null }]));

        const valid = ids.length > 0 && ids.length <= MAX_DEVICES && ids.length === configuredIDs?.length
            && (config.deviceCount === undefined || Number(config.deviceCount) === ids.length)
            && Number.isInteger(interval) && (interval === 0 || interval >= 5 && interval <= 86400)
            && Number.isInteger(timeout) && timeout >= 1 && timeout <= 60
            && Number.isInteger(failureThreshold) && failureThreshold >= 1 && failureThreshold <= 10;
        const probe = createDeviceProbe({ timeoutMs: timeout * 1000 });

        function snapshot(result) {
            return { ...result, device: { ...result.device }, error: result.error ? { ...result.error } : null };
        }

        function describeDevice(id, device) {
            return { id, name: device?.name || id, host: device?.host || '', type: DEVICE_TYPES.includes(device?.type) ? device.type : '' };
        }

        function configuredIP(device, port) {
            let host = typeof device.host === 'string' ? device.host.trim() : '';
            // Legacy config nodes append their port, including to IPv6 hosts.
            const suffix = port == null ? '' : ':' + port;
            if (device.type !== 'Hikvision-config' && suffix && host.endsWith(suffix)) host = host.slice(0, -suffix.length);
            const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(host);
            return bracketed ? bracketed[1] : host.replace(/^([^:]+):\d+$/, '$1');
        }

        function updateStatus() {
            const values = [...states.values()];
            const online = values.filter(state => state.available === true).length;
            const offline = values.filter(state => state.available === false).length;
            const pending = values.length - online - offline;
            node.status({ fill: offline ? 'red' : pending ? 'yellow' : 'green', shape: offline || pending ? 'ring' : 'dot', text: online + '/' + values.length + ' available' + (pending ? ' (' + pending + ' pending)' : '') });
        }

        async function checkOne(state) {
            const device = RED.nodes.getNode(state.id);
            // Config nodes may have been replaced during a partial deploy.
            if (state.instance !== device) {
                state.instance = device;
                state.available = null;
                state.failures = 0;
                state.lastSuccess = null;
                state.nextCheck = 0;
                state.result = null;
            }
            if (Date.now() < state.nextCheck) return;
            const wasClosing = !!device?.isClosing;
            const checked = await probe.check(device);
            if (closed) return;
            if (RED.nodes.getNode(state.id) !== device || !wasClosing && device?.isClosing) {
                state.instance = null;
                state.available = null;
                state.result = null;
                return;
            }
            const previous = state.available;
            state.failures = checked.reachable ? 0 : Math.min(state.failures + 1, failureThreshold);
            if (checked.reachable) { state.available = true; state.lastSuccess = checked.checkedAt; }
            else if (state.failures >= failureThreshold) state.available = false;
            // Input bursts cannot repeatedly authenticate or hammer a busy device.
            state.nextCheck = Date.now() + ([401, 403, 429, 503].includes(checked.httpStatus) ? 30000 : 5000);
            state.result = {
                device: describeDevice(state.id, device),
                ...checked, available: state.available, consecutiveFailures: state.failures,
                lastSuccess: state.lastSuccess, changed: previous !== state.available
            };
            updateStatus();
            if (state.available !== null && (!changesOnly || previous !== state.available)) {
                node.send([null, { topic, payload: state.available, ...snapshot(state.result) }]);
            }
        }

        async function cycle() {
            const pending = [...states.values()];
            let index = 0;
            await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
                while (!closed && index < pending.length) await checkOne(pending[index++]);
            }));
            if (closed) return;
            const devices = [...states.values()].map(state => {
                const instance = state.result ? state.instance : RED.nodes.getNode(state.id);
                const result = state.result ? snapshot(state.result)
                    : { device: describeDevice(state.id, instance), available: null, reachable: null, checkedAt: null };
                return { ...result, ip: configuredIP(result.device, instance?.port), name: result.device.name };
            });
            const available = devices.filter(device => device.available === true).length;
            const unavailable = devices.filter(device => device.available === false).length;
            const unknown = devices.length - available - unavailable;
            node.send([{ topic, payload: unavailable ? false : unknown ? null : true, devices, total: devices.length, available, unavailable, unknown, checkedAt: new Date().toISOString() }, null]);
            updateStatus();
        }

        function run() {
            if (closed || !valid || running) return running || Promise.resolve();
            clearTimeout(timer);
            timer = null;
            running = cycle().catch(() => {
                if (!closed) { node.status({ fill: 'red', shape: 'ring', text: 'Device check failed' }); node.error('Unable to complete device checks'); }
            }).finally(() => {
                running = null;
                if (!closed && interval > 0) timer = setTimeout(run, interval * 1000);
            });
            return running;
        }

        node.on('input', (msg, send, done) => {
            if (running) { if (done) done(); return; }
            run().then(() => { if (done) done(); });
        });
        node.on('close', (removed, done) => {
            if (typeof removed === 'function') done = removed;
            closed = true;
            clearTimeout(timer);
            probe.close();
            Promise.resolve(running).finally(() => { if (done) done(); });
        });
        if (!valid) {
            node.status({ fill: 'red', shape: 'ring', text: 'Invalid device monitor configuration' });
            node.warn('Select 1–64 devices and valid interval, timeout and failure threshold values');
        } else {
            node.status({ fill: 'grey', shape: 'ring', text: 'Waiting to check devices' });
            if (interval > 0) timer = setTimeout(run, 1000);
        }
    }

    RED.nodes.registerType('hikvisionUltimateDeviceStatus', DeviceStatus);
};
