'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { DEVICE_TYPES, deviceReferenceKey, selectedDevices } = require('../nodes/utils/deviceReachability');
const html = fs.readFileSync(require.resolve('../nodes/hikvisionUltimateDeviceStatus.html'), 'utf8');
const script = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];

function editor(devices, selected = [], scope) {
    const elements = new Map();
    let definition;
    const create = (tag, attrs = {}) => ({ tag, attrs, data: {}, children: [], handlers: {}, value: '', text: '' });
    const inputs = element => element.children.flatMap(child => child.tag === 'input' ? [child] : inputs(child));
    class Query {
        constructor(items) { this.items = items; }
        get length() { return this.items.length; }
        empty() { this.items.forEach(item => { item.children = []; }); return this; }
        css() { return this; }
        text(value) {
            if (!arguments.length) return this.items[0]?.text;
            this.items.forEach(item => { item.text = String(value); }); return this;
        }
        val(value) {
            if (!arguments.length) return this.items[0]?.value;
            this.items.forEach(item => { item.value = String(value); }); return this;
        }
        prop(key, value) { this.items.forEach(item => { item[key] = value; }); return this; }
        data(key, value) {
            if (arguments.length === 1) return this.items[0]?.data[key];
            this.items.forEach(item => { item.data[key] = value; }); return this;
        }
        find(selector) {
            assert.ok(['input', 'input:checked'].includes(selector));
            return new Query(this.items.flatMap(inputs).filter(input => selector === 'input' || input.checked));
        }
        each(fn) { this.items.forEach((item, i) => fn.call(item, i, item)); return this; }
        map(fn) { return { get: () => this.items.map((item, i) => fn.call(item, i, item)) }; }
        appendTo(target) { target.items[0].children.push(...this.items); return this; }
        on(event, fn) { this.items.forEach(item => { item.handlers[event] = fn; }); return this; }
    }
    function $(selector, attrs) {
        if (typeof selector === 'object') return new Query([selector]);
        if (selector.startsWith('<')) return new Query([create(selector.match(/^<(\w+)/)[1], attrs)]);
        const [id, rest] = selector.split(' ');
        if (!elements.has(id)) elements.set(id, create('div'));
        const query = new Query([elements.get(id)]);
        return rest ? query.find(rest) : query;
    }
    const RED = { events: { emit() {} }, nodes: {
        eachConfig(fn) { devices.forEach(fn); },
        node(id) { return devices.find(device => device.id === id); },
        registerType(name, def) { assert.equal(name, 'hikvisionUltimateDeviceStatus'); definition = def; }
    } };
    vm.runInNewContext(script, { RED, $ });
    function selectionConfig(ids) {
        const config = { deviceCount: Array.isArray(ids) ? ids.length : 0, z: scope };
        const counts = {};
        if (Array.isArray(ids)) ids.forEach(id => {
            const type = devices.find(device => device.id === id)?.type || 'Hikvision-config';
            const index = counts[type] || 0;
            counts[type] = index + 1;
            config[deviceReferenceKey(type, index)] = id;
        });
        return config;
    }
    const node = selectionConfig(selected);
    devices.forEach(device => { device.users = selected.includes(device.id) ? [node] : []; });
    definition.oneditprepare.call(node);
    return {
        node, definition, elements,
        choices: () => $('#node-device-status-list').find('input').items,
        toggle(id, checked) {
            const input = this.choices().find(item => item.value === id);
            assert.ok(input, 'Expected device choice ' + id);
            assert.equal(!!input.disabled, false, 'Choice must be available');
            input.checked = checked;
            input.handlers.change();
        },
        save() { definition.oneditsave.call(node); },
        selection: () => selectedDevices(node) || [],
        validate(ids) { const config = selectionConfig(ids); return definition.defaults.deviceCount.validate.call(config, config.deviceCount); }
    };
}
const device = (id, extra = {}) => ({ id, name: 'Camera ' + id, host: '192.0.2.' + id, type: 'Hikvision-config', ...extra });

test('Editor lists all six Hikvision config families and saves only chosen configuration IDs', () => {
    const devices = DEVICE_TYPES.map((type, i) => device(String(i), { type }));
    devices.push(device('mqtt', { type: 'mqtt-broker' }), device('scoped', { z: 'flow' }));
    const app = editor(devices, ['0', '2']);
    assert.equal(app.choices().length, 6);
    app.toggle('2', false);
    app.toggle('5', true);
    app.save();
    assert.deepEqual(app.selection(), ['0', '5']);
    assert.equal(app.validate(app.selection()), true);
    assert.equal(app.validate(['mqtt']), false);
    assert.equal(app.validate(['scoped']), false);
    assert.equal(app.validate(['0', '0']), false);
    assert.equal(app.validate([]), false);
    assert.equal(app.validate('0'), false);
    for (const type of DEVICE_TYPES) assert.equal(app.definition.defaults[deviceReferenceKey(type, 0)].type, type);
    assert.equal(app.node.device_Hikvision_0, '0');
    assert.equal(app.node.device_AccessControl_0, '5');
    assert.equal(Object.keys(JSON.parse(JSON.stringify(app.node))).length, 3, 'Only the count and selected scalar references are persisted');
});

test('Missing or disabled saved selections remain visible and can be removed, never silently dropped', () => {
    const app = editor([device('1'), device('disabled', { d: true })], ['missing', 'disabled']);
    assert.deepEqual(app.selection(), ['missing', 'disabled'], 'Opening the dialog must not mutate saved selections');
    app.save();
    assert.deepEqual(app.selection().slice().sort(), ['disabled', 'missing']);
    assert.equal(app.validate(app.selection()), false);
    app.toggle('missing', false);
    app.toggle('disabled', false);
    assert.ok(app.choices().find(input => input.value === 'disabled').disabled);
    app.toggle('1', true);
    app.save();
    assert.deepEqual(app.selection(), ['1']);
    assert.equal(app.validate(app.selection()), true);
});

test('Cancelling edits leaves the original device list untouched and names are rendered as text', () => {
    const maliciousName = '<img src=x onerror=alert(1)>';
    const app = editor([device('1', { name: maliciousName }), device('2')], ['1']);
    app.toggle('1', false);
    app.toggle('2', true);
    assert.deepEqual(app.selection(), ['1']);
    const all = element => [element, ...element.children.flatMap(all)];
    assert.ok(all(app.elements.get('#node-device-status-list')).some(element => element.text === maliciousName && element.tag === 'span'));
});

test('Selection limit prevents adding more than 64 without trapping existing selections', () => {
    const devices = Array.from({ length: 65 }, (_, i) => device(String(i)));
    const app = editor(devices, devices.slice(0, 64).map(item => item.id));
    assert.equal(app.choices().find(input => input.value === '64').disabled, true);
    app.toggle('0', false);
    assert.equal(app.choices().find(input => input.value === '64').disabled, false);
    app.toggle('64', true);
    app.save();
    assert.equal(app.selection().length, 64);
    assert.equal(app.validate(app.selection()), true);
    assert.equal(app.validate(devices.map(item => item.id)), false);
});

test('Timing validators reject empty, invalid or excessive values', () => {
    const app = editor([]);
    const defs = app.definition.defaults;
    for (const value of [0, '0', 5, 30, 86400]) assert.equal(defs.interval.validate(value), true);
    for (const value of ['', ' ', 1, 4, -1, 86401, 'NaN']) assert.equal(defs.interval.validate(value), false);
    for (const value of [1, '5', 60]) assert.equal(defs.timeout.validate(value), true);
    for (const value of ['', 0, 61, 'x']) assert.equal(defs.timeout.validate(value), false);
    for (const value of [1, '2', 10]) assert.equal(defs.failureThreshold.validate(value), true);
    for (const value of ['', 0, 11, 1.5]) assert.equal(defs.failureThreshold.validate(value), false);
    assert.match(app.elements.get('#node-device-status-list').children[0].text, /No configured devices/);
});

test('Changing selections updates config users without removing another node using that device', () => {
    const devices = [device('1'), device('2', { type: 'Speaker-config' })];
    const app = editor(devices, ['1']);
    const otherUser = { id: 'existing-alarm' };
    devices[0].users.push(otherUser);
    app.toggle('1', false);
    app.toggle('2', true);
    app.save();
    assert.deepEqual(devices[0].users, [otherUser]);
    assert.equal(devices[1].users.length, 1);
    assert.equal(devices[1].users[0], app.node);
    assert.equal(app.node.device_Hikvision_0, undefined);
    assert.equal(app.node.device_Speaker_0, '2');
    app.save();
    assert.equal(devices[1].users.length, 1, 'Saving again must not duplicate a user');
});

test('Flow and subflow configurations are selectable only from the owning scope', () => {
    const devices = [device('global'), device('local', { z: 'subflow-a' }), device('elsewhere', { z: 'subflow-b' })];
    const app = editor(devices, ['local'], 'subflow-a');
    assert.deepEqual(app.choices().map(input => input.value), ['global', 'local']);
    app.save();
    assert.equal(app.validate(['local', 'global']), true);
    assert.equal(app.validate(['elsewhere']), false);
    assert.equal(app.node.device_Hikvision_0, 'local');
});
