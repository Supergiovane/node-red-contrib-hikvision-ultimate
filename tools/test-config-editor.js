"use strict";
/* Run with node tools/test-config-editor.js. No camera/network calls or extra dependencies. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../nodes/Hikvision-config.html"), "utf8").match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
function editor(config = {}) {
    const elements = new Map();
    const requests = [];
    const notifications = [];
    let definition;
    function element(tag) { return { tag, value: "", text: "", children: [], attrs: {}, handlers: new Map() }; }
    class Query {
        constructor(item) { this.item = item; }
        val(value) { if (!arguments.length) return this.item.value; this.item.value = String(value); return this; }
        text(value) { this.item.text = String(value); return this; }
        empty() { this.item.children = []; this.item.text = ""; return this; }
        append(child) { this.item.children.push(typeof child === "string" ? { trustedHtml: child } : child.item); return this; }
        attr(key, value) { this.item.attrs[key] = value; return this; }
        prop(key, value) { return this.attr(key, value); }
        on(event, fn) { this.item.handlers.set(event, fn); return this; }
        off(namespace) { for (const key of this.item.handlers.keys()) if (key.endsWith(namespace)) this.item.handlers.delete(key); return this; }
        trigger(event) { for (const [name, fn] of this.item.handlers) if (name.split(".")[0] === event) fn.call(this.item); return this; }
    }
    function $(selector) {
        if (typeof selector === "object") return new Query(selector);
        if (selector.startsWith("<")) return new Query(element(selector.match(/^<(\w+)/)[1]));
        assert.match(selector, /^#[\w-]+$/);
        if (!elements.has(selector)) elements.set(selector, element("input"));
        return new Query(elements.get(selector));
    }
    $.ajax = settings => {
        const callbacks = {};
        const request = {
            settings, aborted: false,
            done(fn) { callbacks.done = fn; return this; },
            fail(fn) { callbacks.fail = fn; return this; },
            always(fn) { callbacks.always = fn; return this; },
            resolve(data) { callbacks.done?.(data); callbacks.always?.(); },
            reject(reason = "error") { callbacks.fail?.({ status: 502 }, reason); callbacks.always?.(); },
            abort() { this.aborted = true; this.reject("abort"); }
        };
        requests.push(request);
        return request;
    };
    $.getJSON = url => $.ajax({ url, type: "GET" });
    vm.runInNewContext(source, {
        $, RED: { validators: { number() { return () => true; } }, nodes: { registerType(name, value) { definition = value; } }, notify(message) { notifications.push(message); } }
    });
    const node = { id: "config-123", deviceinfo: {}, streamtimeout: 3, ...config };
    for (const [key, value] of Object.entries({ host: "192.0.2.1", port: "80", protocol: "http", user: "test-user", password: "__PWRD__", authentication: "digest", name: "Server", deviceinfo: "saved" })) $("#node-config-input-" + key).val(value);
    definition.oneditprepare.call(node);
    return { $, elements, requests, notifications, node, save() { definition.oneditsave.call(node); }, cancel() { definition.oneditcancel.call(node); } };
}
const data = { DeviceInfo: { deviceName: '<img src=x onerror="bad()">', model: "<script>bad()</script>", firmwareVersion: "v1 & <b>2</b>" } };
{
    const ui = editor();
    ui.requests[0].resolve([]);
    ui.$("#getinfocam").trigger("click");
    const request = ui.requests.at(-1);
    assert.equal(request.settings.type, "POST");
    assert.equal(request.settings.url, "hikvisionUltimateGetInfoCam");
    assert.equal(request.settings.contentType, "application/json; charset=utf-8");
    assert.equal(request.settings.dataType, "json");
    assert.deepEqual(JSON.parse(request.settings.data), { nodeID: "config-123", host: "192.0.2.1", port: "80", protocol: "http", user: "test-user", password: "__PWRD__", authentication: "digest" });
    assert.equal(ui.elements.get("#getinfocam").attrs.disabled, true);
    request.resolve(data);
    assert.equal(ui.elements.get("#getinfocam").attrs.disabled, false);
    assert.equal(ui.$("#getinfocam").val(), "Connect");
    assert.equal(ui.$("#node-config-input-name").val(), data.DeviceInfo.deviceName);
    assert.deepEqual(JSON.parse(ui.$("#node-config-input-deviceinfo").val()), data);
    const rendered = ui.elements.get("#labeldeviceinfo").children;
    assert.ok(rendered.some(item => item.text === data.DeviceInfo.deviceName));
    assert.ok(rendered.some(item => item.text === data.DeviceInfo.model));
    assert.ok(rendered.every(item => !item.trustedHtml), "Camera values must only be inserted as text nodes");
    ui.cancel();
}
for (const deviceinfo of [{}, "", "{broken", null, data, JSON.stringify(data)]) {
    const ui = editor({ deviceinfo });
    if (deviceinfo === data || deviceinfo === JSON.stringify(data)) {
        assert.ok(ui.elements.get("#labeldeviceinfo").children.some(item => item.text === data.DeviceInfo.model));
    }
    ui.cancel();
}
for (const failure of ["network", "malformed", "changed"]) {
    const ui = editor();
    ui.requests[0].reject();
    assert.equal(ui.elements.get("#node-config-input-discover-devices").attrs.disabled, false);
    ui.$("#getinfocam").trigger("click");
    const pending = ui.requests.at(-1);
    if (failure === "network") pending.reject();
    if (failure === "malformed") pending.resolve({ error: "<img src=x onerror=bad()>" });
    if (failure === "changed") { ui.$("#node-config-input-host").val("192.0.2.2"); pending.resolve(data); }
    assert.equal(ui.elements.get("#getinfocam").attrs.disabled, false);
    assert.equal(ui.$("#node-config-input-deviceinfo").val(), "saved");
    assert.equal(ui.$("#node-config-input-name").val(), "Server");
    assert.ok(ui.notifications.length > 0);
    assert.ok(ui.notifications.every(message => !message.includes("<img")), "Notifications cannot contain device-supplied HTML");
    ui.cancel();
}
for (const action of ["save", "cancel"]) {
    const ui = editor();
    ui.$("#getinfocam").trigger("click");
    const pending = ui.requests.at(-1);
    ui[action]();
    assert.ok(pending.aborted);
    assert.ok(ui.requests[0].aborted);
    pending.resolve(data);
    assert.equal(ui.$("#node-config-input-deviceinfo").val(), "saved");
    ui.$("#getinfocam").trigger("click");
    assert.equal(ui.requests.length, 2);
    assert.equal(ui.node._hikvisionConfigCleanup, undefined);
}
console.log("Hikvision config editor tests PASSED.");
