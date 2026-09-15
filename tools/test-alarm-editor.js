/* Editor regressions: run with node tools/test-alarm-editor.js.
 * Execute the actual Node-RED editor hooks against a small DOM/jQuery test double,
 * including late responses after abort, server/channel changes and dialog close.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { documentedEventGroups, legacyCatalogEventIds, canonicalEventType } = require("../nodes/utils/alarmEventAliases");

const html = fs.readFileSync(require.resolve("../nodes/hikvisionUltimateAlarm.html"), "utf8");
const script = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
const template = html.match(/data-template-name="hikvisionUltimateAlarm">([\s\S]*?)<\/script>/)[1];
const eventCatalog = [...template.match(/<select id="node-input-reactto">([\s\S]*?)<\/select>/)[1].matchAll(/<option value="([^"]+)">([^<]*)<\/option>/g)]
    .map(match => ({ value: match[1], text: match[2] }));
// Only these identity/object recognition notifications move out of automatic
// Camera Event choices. Ordinary alarms, counters and custom IDs remain available.
const recognitionEventIDs = [
    "facedetection", "faceCapture", "faceSnap", "faceRecognition", "peopleDetection", "humanDetection",
    "humanRecognition", "personDetection", "personRecognition", "targetCapture", "ANPR", "vehicleDetection",
    "vehicleRecognition", "vehicleCapture", "alarmResult", "faceContrast", "mixedTargetDetection", "MTD_face",
    "MTD_human", "MTD_vehicle", "MTD_nonMotor", "faceSnapModeling", "HVTVehicleDetection", "PictureCaptureComparision",
    "faceDetect", "vehicleRcogResult", "vehicleControl", "animalDetection", "animalRecognition", "animalCapture", "zoologyDetection"
];
const recognitionKeys = new Set(recognitionEventIDs.map(id => id.toLowerCase()));
const isRecognition = value => value.split(",").some(id => recognitionKeys.has(id.trim().toLowerCase()));

function createEditor(config = {}) {
    const elements = new Map();
    const requests = [];
    const metadataRequests = [];
    let definition;
    function element(tag, attrs = {}) {
        return { tag, attrs, children: [], text: "", value: null, handlers: new Map(), visible: true };
    }
    function options(target) {
        return target.children.flatMap(child => child.tag === "option" ? [child] : options(child));
    }
    class Query {
        constructor(items) { this.items = items; }
        val(value) {
            if (arguments.length) {
                this.items.forEach(item => { item.value = value == null ? null : String(value); });
                return this;
            }
            const item = this.items[0];
            if (!item) return undefined;
            if (item.tag !== "select") return item.value;
            return options(item).some(option => option.value === item.value) ? item.value : null;
        }
        text(value) {
            if (!arguments.length) return this.items[0]?.text || "";
            this.items.forEach(item => { item.text = String(value); });
            return this;
        }
        attr(key, value) { this.items.forEach(item => { item.attrs[key] = value; }); return this; }
        prop(key, value) { return this.attr(key, value); }
        empty() { this.items.forEach(item => { item.children = []; item.value = null; }); return this; }
        append(query) { this.items.forEach(item => item.children.push(...query.items)); return this; }
        find(selector) { assert.equal(selector, "option"); return new Query(this.items.flatMap(options)); }
        each(fn) { this.items.forEach((item, index) => fn.call(item, index, item)); return this; }
        on(event, fn) { this.items.forEach(item => item.handlers.set(event, fn)); return this; }
        off(namespace) {
            this.items.forEach(item => {
                for (const event of item.handlers.keys()) if (event.endsWith(namespace)) item.handlers.delete(event);
            });
            return this;
        }
        toggle(visible) { this.items.forEach(item => { item.visible = visible; }); return this; }
        trigger(event) {
            this.items.forEach(item => {
                for (const [name, fn] of item.handlers) if (name.split(".")[0] === event) fn.call(item, { preventDefault() {} });
            });
            return this;
        }
    }
    function $(selector) {
        if (typeof selector === "object") return new Query([selector]);
        if (selector.startsWith("<")) return new Query([element(selector.match(/^<(\w+)/)[1])]);
        assert.match(selector, /^#[\w-]+$/);
        const id = selector.slice(1);
        if (!elements.has(id)) elements.set(id, element("div", { id }));
        return new Query([elements.get(id)]);
    }
    $.ajax = settings => {
        const callbacks = {};
        const request = {
            settings,
            aborted: false,
            done(fn) { callbacks.done = fn; return this; },
            fail(fn) { callbacks.fail = fn; return this; },
            always(fn) { callbacks.always = fn; return this; },
            resolve(data) { callbacks.done?.(data); callbacks.always?.(); },
            reject(status = 503, reason = "error") { callbacks.fail?.({ status }, reason); callbacks.always?.(); },
            abort() { this.aborted = true; this.reject(0, "abort"); }
        };
        (settings.url === "hikvisionUltimateAlarmMetadata" ? metadataRequests : requests).push(request);
        return request;
    };
    for (const select of template.matchAll(/<select id="([^"]+)">([\s\S]*?)<\/select>/g)) {
        const target = element("select", { id: select[1] });
        for (const match of select[2].matchAll(/<option value=(?:"([^"]+)"|([^ >]+))>([^<]*)<\/option>/g)) {
            const option = element("option");
            option.value = match[1] || match[2];
            option.text = match[3];
            target.children.push(option);
        }
        elements.set(select[1], target);
    }
    vm.runInNewContext(script, { RED: { nodes: { registerType(name, value) { definition = value; } } }, $ });
    const node = { reactto: "vmd", channelID: "0", filterzone: "0", devicetype: 0, server: "camera-a", alarmfilterduration: 0, ...config };
    for (const [key, value] of Object.entries(node)) $("#node-input-" + key).val(value);
    definition.oneditprepare.call(node);
    return {
        $, requests, metadataRequests, node, elements,
        save() { assertFallbackPolicy(this); definition.oneditsave.call(node); },
        cancel() { assertFallbackPolicy(this); definition.oneditcancel.call(node); },
        ids(id) { return options(elements.get("node-input-" + id)).map(item => item.value); },
        groups(id) {
            return elements.get("node-input-" + id).children.filter(item => item.tag === "optgroup")
                .map(item => ({ label: item.attrs.label, options: options(item).map(option => option.value) }));
        }
    };
}
function result(events = [], channels = [], status = "ok") { return { events, channels, status, warnings: [] }; }
function event(id, sources = ["observed"], channels = [], extra = {}) { return { id, sources, channels, ...extra }; }
function selectCustom(editor) {
    const option = editor.$("#node-input-reactto").find("option").items.find(option => option.text === "CUSTOM EVENT ID");
    assert.ok(option, "The events menu must offer CUSTOM EVENT ID");
    editor.$("#node-input-reactto").val(option.value).trigger("change");
}

function choose(editor, field, value) {
    assert.ok(editor.ids(field).includes(value), "User cannot select an unavailable " + field + " option: " + value);
    editor.$("#node-input-" + field).val(value).trigger("change");
}
function useCustomEvent(editor, value) {
    selectCustom(editor);
    editor.$("#node-alarm-custom-event").val(value);
    editor.$("#node-alarm-use-custom-event").trigger("click");
    assert.equal(editor.$("#node-input-reactto").val(), value);
}
function assertFallbackPolicy(editor) {
    for (const field of ["reactto", "channelID", "filterzone"]) {
        assert.ok(editor.groups(field).every(group => !/manual fallback/i.test(group.label)), "No manual fallback group may be rendered for " + field);
    }
    const configured = editor.groups("filterzone").find(group => group.label === "Configured regions / rules");
    const expected = new Set(["0", ...(configured ? configured.options : [])]);
    const selected = editor.$("#node-input-filterzone").val();
    if (selected !== null) expected.add(selected);
    assert.deepEqual(editor.ids("filterzone").slice().sort(), [...expected].sort(), "Zones contain only All, discovered IDs and one current selection");
}
for (const field of ["channelID", "filterzone"]) {
    const select = template.match(new RegExp('<select id="node-input-' + field + '">([\\s\\S]*?)<\\/select>'));
    assert.ok(select, "Expected select template for " + field);
    const ids = [...select[1].matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(ids, ["0"], "Channel and zone templates must not include static numeric ranges");
}

// The camera advertises VMD and motionDetection together for backwards
// compatibility. They must share one Video motion choice, including saved aliases.
for (const saved of ['vmd', 'motionDetection', 'VMD', 'MotionDetection', 'vmd,motionDetection', 'motionDetection, VMD']) {
    const editor = createEditor({ reactto: saved });
    for (const events of [
        [event('VMD', ['capability']), event('motionDetection', ['capability']), event('motionDetection', ['observed'], [], { hasState: true })],
        [event('motionDetection', ['capability'])],
        []
    ]) {
        editor.requests.at(-1).resolve(result(events));
        const choices = editor.$('#node-input-reactto').find('option').items;
        const motionChoices = choices.filter(option => option.text.startsWith('Video motion'));
        assert.equal(motionChoices.length, 1, 'Video motion must not be duplicated');
        assert.equal(choices.filter(option => /^(vmd|motiondetection)$/i.test(option.value)).length, saved.includes(',') ? 0 : 1);
        assert.equal(motionChoices[0].value, saved);
        assert.equal(editor.$('#node-input-reactto').val(), saved, 'Saved aliases must not change on refresh');
        if (events.length) assert.ok(editor.groups('reactto').some(group => group.label === 'Supported by the device' && group.options.includes(saved)));
    }
    editor.save();
    assert.equal(editor.$('#node-input-reactto').val(), saved);
}

{
    const editor = createEditor({ reactto: 'linedetection' });
    editor.requests[0].resolve(result([event('VMD', ['capability']), event('motionDetection', ['observed'])]));
    assert.equal(editor.ids('reactto').filter(id => /^(vmd|motiondetection)$/i.test(id)).length, 1);
    assert.ok(editor.ids('reactto').includes('vmd'));
    assert.equal(editor.$('#node-input-reactto').val(), 'linedetection');
    selectCustom(editor);
    editor.$('#node-alarm-custom-event').val('motionDetection');
    editor.$('#node-alarm-use-custom-event').trigger('click');
    assert.equal(editor.$('#node-input-reactto').find('option').items.filter(option => option.text.startsWith('Video motion')).length, 1);
    assert.equal(editor.$('#node-input-reactto').val(), 'motionDetection');
    editor.cancel();
}

// Every runtime alias must have exactly one friendly editor choice, including
// saved single names, comma lists and casing. Also cover the five old catalog
// typos without treating arbitrary invisible characters as equivalent.
const editorAliasGroups = [
    ...documentedEventGroups,
    ...Object.entries(legacyCatalogEventIds).map(([legacy, clean]) => [clean, legacy]),
    ['PeopleCounting', 'peopleCounting'], ['io', 'IO']
];
for (const names of editorAliasGroups) {
    const canonical = canonicalEventType(names[0]);
    const matchesGroup = option => option.value.split(',').every(id => canonicalEventType(id.trim()) === canonical);
    const recognitionGroup = names.some(isRecognition);
    const reference = createEditor({ reactto: recognitionGroup ? names[0] : 'videoloss' });
    reference.requests[0].resolve(result(names.map(id => event(id, ['capability']))));
    const catalogChoices = reference.$('#node-input-reactto').find('option').items.filter(matchesGroup);
    assert.equal(catalogChoices.length, 1, 'Discovered aliases must have one friendly choice for ' + names.join('/'));
    const catalogChoice = catalogChoices[0];
    const originalChoices = eventCatalog.filter(matchesGroup);
    assert.equal(originalChoices.length, 1, 'The label dictionary must retain one entry for each alias group');
    assert.equal(catalogChoice.value, recognitionGroup ? names[0] : originalChoices[0].value, 'Recognition selections stay exact; other groups keep their default ID');
    assert.equal(catalogChoice.text, originalChoices[0].text, 'Discovered options retain their friendly label');
    reference.cancel();

    for (const saved of new Set([...names, ...names.map(id => id.toUpperCase()), names.join(','), [...names].reverse().join(', ')])) {
        const editor = createEditor({ reactto: saved });
        const scenarios = [
            { events: [...names.map(id => event(id, ['capability'])), event(names.at(-1), ['observed'], [], { hasState: true })], group: 'Supported by the device' },
            { events: [event(names[0], ['capability'])], group: 'Supported by the device' },
            { events: [event(names.at(-1), ['observed'], [], { hasState: true })], group: 'Observed in the event stream' },
            { events: [], group: 'Current / custom event' }
        ];
        for (const scenario of scenarios) {
            editor.requests[0].resolve(result(scenario.events));
            const choices = editor.$('#node-input-reactto').find('option').items;
            const matching = choices.filter(matchesGroup);
            assert.equal(matching.length, 1, 'Aliases must not produce duplicate options: ' + saved);
            assert.equal(matching[0].text, catalogChoice.text, 'A saved alias keeps the friendly label');
            assert.equal(matching[0].value, saved);
            assert.equal(editor.$('#node-input-reactto').val(), saved, 'Refresh must preserve the exact saved value');
            const expectedGroup = recognitionGroup ? 'Current / custom event' : scenario.group;
            assert.ok(editor.groups('reactto').some(group => group.label === expectedGroup && group.options.includes(saved)));
            assert.equal(editor.groups('reactto').some(group => group.label === 'Current / custom event'), recognitionGroup || scenario.events.length === 0);
            if (recognitionGroup || !scenario.events.length) assert.deepEqual(editor.ids('reactto'), [saved, '#custom-event-id']);
        }
        editor.save();
        assert.equal(editor.$('#node-input-reactto').val(), saved);
    }
}

// Discovery may learn uncataloged IDs with different casing. They still name
// one event, including saved aliases/lists, while different custom IDs stay apart.
for (const saved of ['futurecustom', 'FutureCustom', 'futurecustom, FutureCustom', 'videoloss']) {
    const editor = createEditor({ reactto: saved });
    editor.requests[0].resolve(result([
        event('FutureCustom', ['capability']), event('futurecustom', ['observed'], [], { hasState: true }),
        event('OtherCustom', ['capability']), event('Other\u200bCustom', ['capability'])
    ]));
    const choices = editor.$('#node-input-reactto').find('option').items;
    const matches = choices.filter(option => option.value.split(',').every(id => id.trim().toLowerCase() === 'futurecustom'));
    assert.equal(matches.length, 1);
    assert.equal(matches[0].value, saved === 'videoloss' ? 'FutureCustom' : saved);
    assert.match(matches[0].attrs.title, /also observed/);
    assert.equal(editor.$('#node-input-reactto').val(), saved);
    assert.ok(editor.ids('reactto').includes('OtherCustom'));
    assert.ok(editor.ids('reactto').includes('Other\u200bCustom'));
    editor.save();
    assert.equal(editor.$('#node-input-reactto').val(), saved);
}

// Similar labels do not establish equivalence. A custom list across different
// groups remains its own selection while ordinary alarms stay available and recognition choices are excluded.
{
    const saved = 'tamperDetection,block';
    const editor = createEditor({ reactto: saved });
    const distinct = ['shelteralarm', 'hide', 'block', 'facedetection', 'faceDetect', 'fireDetection',
        'smokeDetection', 'smokeAndFireDetection', 'temperature,temperatureDetection', 'thermometry', 'tma', 'tmpa'];
    const ids = [...distinct.flatMap(id => id.split(',')), 'tamperDetection', 'faceDetection', 'temperatureIntervalMeasurement'];
    editor.requests[0].resolve(result(ids.map(id => event(id, ['capability']))));
    for (const id of distinct) assert.equal(editor.ids('reactto').includes(id), !isRecognition(id), 'Keep only ordinary alarm choice ' + id);
    assert.ok(!editor.ids('reactto').includes('tamperDetection'));
    assert.equal(editor.$('#node-input-reactto').val(), saved);
    assert.ok(editor.groups('reactto').some(group => group.label === 'Current / custom event' && group.options.includes(saved)));
    editor.cancel();
}

// Recognition filtering is exact and applies to capability/observed suggestions alike.
// Intrusion, crossing, thermal alarms, counting and unrelated custom IDs remain offered.
for (const sources of [["capability"], ["observed"], ["capability", "observed"]]) {
    const editor = createEditor();
    const ordinary = ["VMD", "motionDetection", "fieldDetection", "lineDetection", "IO", "tma", "TMPA", "temperatureDetection",
        "thermometry", "group", "PeopleCounting", "humanEnter", "regionEntrance", "regionExiting", "highTempAlarm",
        "faceMaskStatus", "vehicleSpeedAlarm", "animalFenceAlarm", "FutureCustom"];
    editor.requests[0].resolve(result([
        ...ordinary.map(id => event(id, sources, [], { hasState: true, label: id === "FutureCustom" ? "Face recognition status" : id })),
        ...recognitionEventIDs.flatMap(id => [event(id, sources), event(id.toUpperCase(), sources)])
    ]));
    const offered = editor.ids("reactto").filter(id => id !== "#custom-event-id");
    assert.ok(offered.every(id => !isRecognition(id)), "Recognition notifications must not appear as automatic choices");
    assert.deepEqual([...new Set(offered.flatMap(id => id.split(",").map(canonicalEventType)))].sort(),
        [...new Set(ordinary.map(canonicalEventType))].sort(), "Only the requested recognition IDs are excluded");
    assert.equal(editor.ids("reactto").filter(id => canonicalEventType(id) === "vmd").length, 1, "VMD aliases remain deduplicated");
    assert.equal(editor.$("#node-input-reactto").val(), "vmd");
    editor.cancel();
}

// Existing recognized IDs remain usable as exact current selections, regardless of source or casing.
for (const id of recognitionEventIDs) {
    for (const saved of [id, id.toUpperCase()]) {
        const editor = createEditor({ reactto: saved });
        editor.requests[0].resolve(result([event(id, ["capability"]), event(saved, ["observed"])]));
        assert.deepEqual(editor.ids("reactto"), [saved, "#custom-event-id"]);
        assert.ok(editor.groups("reactto").some(group => group.label === "Current / custom event" && group.options.includes(saved)));
        editor.save();
        assert.equal(editor.$("#node-input-reactto").val(), saved);
    }
}
{
    const editor = createEditor();
    editor.requests[0].resolve(result([event("vmd", ["capability"]), event("faceRecognition", ["observed"])]));
    assert.ok(!editor.ids("reactto").includes("faceRecognition"));
    useCustomEvent(editor, "faceRecognition");
    assert.ok(editor.groups("reactto").some(group => group.label === "Current / custom event" && group.options.includes("faceRecognition")));
    editor.save();
    assert.equal(editor.$("#node-input-reactto").val(), "faceRecognition", "An explicit custom selection remains supported");
}

// Real channel capability values from the read-only DS-2TD1228-2/QA check.
// Both channels must collapse the old/new names and case-only variants while
// preserving channel-specific support without showing unreported catalog entries.
{
    const channels = [
        'VMD,motionDetection,shelteralarm,tamperDetection,ROI,audioexception,audioDetection,scenechangedetection,sceneChangeDetection,temperature,temperatureDetection,IO,diskfull,diskerror,nicbroken,ipconflict,illaccess,thermometry',
        'VMD,motionDetection,shelteralarm,tamperDetection,ROI,fielddetection,fieldDetection,scenechangedetection,sceneChangeDetection,linedetection,lineDetection,regionEntrance,regionExiting,temperature,temperatureDetection,IO,diskfull,diskerror,nicbroken,ipconflict,illaccess,thermometry,temperatureIntervalMeasurement'
    ];
    const events = channels.flatMap((ids, i) => ids.split(',').map(id => event(id, ['capability'], [i + 1])));
    for (const channelID of ['0', '1', '2']) {
        const editor = createEditor({ reactto: 'tamperDetection', channelID });
        editor.requests[0].resolve(result(events, [{ id: 1 }, { id: 2 }]));
        const supported = editor.groups('reactto').find(group => group.label === 'Supported by the device').options;
        const relevant = events.filter(entry => channelID === '0' || entry.channels.includes(Number(channelID)));
        assert.equal(supported.length, new Set(relevant.map(entry => canonicalEventType(entry.id))).size);
        assert.equal(supported.filter(id => id === 'tamperDetection').length, 1);
        assert.ok(!editor.ids('reactto').includes('shelteralarm'));
        assert.equal(editor.$('#node-input-reactto').val(), 'tamperDetection');
        assert.ok(!editor.ids('reactto').includes('hide'));
        assert.ok(!editor.ids('reactto').includes('block'));
        assertFallbackPolicy(editor);
        editor.cancel();
    }
}

// Discovery is additive: preserve saved values and aliases, including channels beyond 32.
{
    const editor = createEditor({ reactto: "faceSnap", channelID: "64" });
    assert.equal(editor.$("#node-input-reactto").val(), "faceSnap");
    assert.equal(editor.$("#node-input-channelID").val(), "64");
    assert.deepEqual(JSON.parse(JSON.stringify(editor.requests[0].settings.data)), { nodeID: "camera-a", channelID: "64" });
    editor.requests[0].resolve(result([
        event("faceSnap", ["capability"]), event("faceCapture"), event("FutureAlarm", ["observed"], [64]),
        event("OtherChannel", ["observed"], [3]), event("vmd", ["capability"])
    ], [{ id: 64, name: "Garden" }]));
    assert.equal(editor.$("#node-input-reactto").val(), "faceSnap");
    assert.equal(editor.$("#node-input-channelID").val(), "64");
    assert.ok(editor.ids("reactto").includes("FutureAlarm"));
    assert.ok(!editor.ids("reactto").includes("OtherChannel"));
    assert.ok(!editor.ids("reactto").includes("tmpa"), "Unreported catalog entries must not be selectable");
    assert.equal(editor.ids("reactto").filter(id => id === "faceSnap").length, 1);
    assert.ok(!editor.ids("reactto").includes("faceCapture,faceSnap"));
    assert.ok(editor.groups("reactto").some(group => group.label === "Current / custom event" && group.options.includes("faceSnap")));
    assert.ok(editor.groups("reactto").some(group => group.label === "Observed in the event stream" && group.options.includes("FutureAlarm")));
    choose(editor, "reactto", "FutureAlarm");
    editor.$("#node-alarm-discovery-refresh").trigger("click");
    assert.equal(editor.requests[1].settings.data.refresh, "true");
    editor.requests[1].resolve(result([], [], "unavailable"));
    assert.equal(editor.$("#node-input-reactto").val(), "FutureAlarm");
    assert.equal(editor.$("#node-input-channelID").val(), "64");
    editor.cancel();
}

// Asynchronous responses cannot undo a user edit or leak results from another server/channel.
{
    const editor = createEditor({ channelID: "2" });
    useCustomEvent(editor, "tmpa");
    editor.requests[0].resolve(result([event("vmd")]));
    assert.equal(editor.$("#node-input-reactto").val(), "tmpa");
    editor.$("#node-alarm-discovery-refresh").trigger("click");
    const oldServerRequest = editor.requests.at(-1);
    editor.$("#node-input-server").val("camera-b").trigger("change");
    assert.ok(oldServerRequest.aborted);
    const oldChannelRequest = editor.requests.at(-1);
    choose(editor, "channelID", "0");
    assert.ok(oldChannelRequest.aborted);
    oldServerRequest.resolve(result([event("StaleServer")]));
    oldChannelRequest.resolve(result([event("StaleChannel")]));
    assert.ok(!editor.ids("reactto").includes("StaleServer"));
    assert.ok(!editor.ids("reactto").includes("StaleChannel"));
    editor.requests.at(-1).resolve(result([event("CorrectChannel", ["observed"], [2])]));
    assert.ok(editor.ids("reactto").includes("CorrectChannel"));
    assert.equal(editor.$("#node-input-reactto").val(), "tmpa");
    assert.equal(editor.$("#node-input-channelID").val(), "0");
    editor.cancel();
}

// Save/cancel abort pending work, remove handlers, and ignore even an already queued callback.
for (const action of ["save", "cancel"]) {
    const editor = createEditor();
    const pending = editor.requests[0];
    editor[action]();
    assert.ok(pending.aborted);
    assert.equal(editor.node._alarmDiscoveryCleanup, undefined);
    pending.resolve(result([event("AfterClose")]));
    assert.ok(!editor.ids("reactto").includes("AfterClose"));
    editor.$("#node-input-server").val("camera-b").trigger("change");
    assert.equal(editor.requests.length, 1);
}

// Security/radar selections and filters retain their behavior without discovery requests.
{
    const editor = createEditor({ devicetype: 1, reactto: "CID:1137-3137", alarmfilterduration: 0 });
    assert.equal(editor.requests.length, 0);
    assert.equal(editor.$("#node-input-reactto").val(), "CID:1137-3137");
    assert.ok(editor.ids("reactto").includes("CID:1110-3110"));
    assert.ok(!editor.ids("reactto").includes("vmd"));
    assert.equal(editor.elements.get("ui_alarmfilterperiod").visible, false);
    choose(editor, "alarmfilterduration", "2");
    assert.equal(editor.elements.get("ui_alarmfilterperiod").visible, true);
    choose(editor, "devicetype", "2");
    assert.equal(editor.requests.length, 0);
    assert.equal(editor.$("#node-input-reactto").val(), "CID:1103-3103");
    choose(editor, "devicetype", "1");
    assert.equal(editor.$("#node-input-reactto").val(), "CID:1137-3137");
    editor.cancel();
}

// Manual IDs/aliases are saved verbatim; labels from the camera are treated as text.
{
    const editor = createEditor({ channelID: "01" });
    assert.equal(editor.$("#node-input-channelID").val(), "01");
    assert.equal(editor.elements.get("node-alarm-custom-event-box").visible, false);
    selectCustom(editor);
    assert.equal(editor.elements.get("node-alarm-custom-event-box").visible, true);
    editor.$("#node-alarm-custom-event").val("NewAlarm,NewAlias");
    editor.$("#node-alarm-use-custom-event").trigger("click");
    assert.equal(editor.$("#node-input-reactto").val(), "NewAlarm,NewAlias");
    assert.equal(editor.elements.get("node-alarm-custom-event-box").visible, false);
    editor.requests[0].resolve(result([event("DangerousLabel", ["observed"], [], { label: "<img src=x onerror=alert(1)>" })]));
    assert.equal(editor.$("#node-input-reactto").val(), "NewAlarm,NewAlias");
    const maliciousOption = editor.$("#node-input-reactto").find("option").items.find(option => option.value === "DangerousLabel");
    assert.equal(maliciousOption.text, "<img src=x onerror=alert(1)> [DangerousLabel]");
    assert.equal(maliciousOption.children.length, 0);
    selectCustom(editor);
    assert.equal(editor.$("#node-alarm-custom-event").val(), "NewAlarm,NewAlias");
    editor.$("#node-alarm-custom-event").val("invalid value");
    editor.$("#node-alarm-use-custom-event").trigger("click");
    assert.equal(editor.elements.get("node-alarm-custom-event-box").visible, true);
    editor.save();
    assert.equal(editor.$("#node-input-reactto").val(), "NewAlarm,NewAlias");
}

// The custom entry is only an editor action: asynchronous discovery cannot close
// the box or replace the draft, and saving without Use event keeps the real ID.
{
    const editor = createEditor({ reactto: "SavedUnknown" });
    assert.equal(editor.elements.get("node-alarm-custom-event-box").visible, false);
    selectCustom(editor);
    editor.$("#node-alarm-custom-event").val("DraftAlarm");
    editor.requests[0].resolve(result([event("vmd")]));
    assert.equal(editor.elements.get("node-alarm-custom-event-box").visible, true);
    assert.equal(editor.$("#node-alarm-custom-event").val(), "DraftAlarm");
    choose(editor, "reactto", "vmd");
    assert.equal(editor.elements.get("node-alarm-custom-event-box").visible, false);
    selectCustom(editor);
    editor.save();
    assert.equal(editor.$("#node-input-reactto").val(), "vmd");
}

// Offline, malformed and undeployed responses never clear selections.
for (const response of ["offline", "malformed", "undeployed"]) {
    const editor = createEditor({ reactto: "SavedUnknown", channelID: "99" });
    if (response === "malformed") editor.requests[0].resolve({ status: "ok" });
    else editor.requests[0].reject(response === "undeployed" ? 404 : 503);
    assert.equal(editor.$("#node-input-reactto").val(), "SavedUnknown");
    assert.equal(editor.$("#node-input-channelID").val(), "99");
    assert.deepEqual(editor.ids("reactto"), ["SavedUnknown", "#custom-event-id"]);
    assert.deepEqual(editor.ids("channelID"), ["0", "99"]);
    editor.cancel();
}
function metadataResult(channels = [], zones = [], status = "ok", warnings = []) { return { channels, zones, status, warnings }; }
function zone(id, name, channelID = "1", eventType = "vmd") { return { id, name, channelID, eventType }; }
function optionFor(editor, field, id) { return editor.$("#node-input-" + field).find("option").items.find(option => option.value === id); }

// Names are read after capabilities, override capability labels and never replace numeric IDs.
{
    const editor = createEditor({ channelID: "64", filterzone: "99", reactto: "motionDetection" });
    assert.equal(editor.metadataRequests.length, 0, "Metadata must wait for capabilities to settle");
    assert.equal(editor.$("#node-input-filterzone").val(), "99");
    editor.requests[0].resolve(result([], [{ id: "64", name: "Capability name" }, { id: "65", name: "Other camera" }]));
    assert.equal(editor.metadataRequests.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(editor.metadataRequests[0].settings.data)), { nodeID: "camera-a", channelID: "64", eventType: "motionDetection" });
    editor.metadataRequests[0].resolve(metadataResult(
        [{ id: "64", name: "Configured <camera>" }],
        [zone("99", "<img src=x onerror=bad()>", "64", "vmd"), zone("20", "Wrong camera", "65"), zone("21", "Wrong event", "64", "fielddetection")]
    ));
    assert.equal(optionFor(editor, "channelID", "64").text, "Channel 64 — Configured <camera>");
    assert.equal(optionFor(editor, "channelID", "65").text, "Channel 65 — Other camera");
    assert.equal(optionFor(editor, "filterzone", "99").text, "Zone 99 — <img src=x onerror=bad()>");
    assert.equal(optionFor(editor, "filterzone", "99").children.length, 0, "Names must be text, never parsed HTML");
    assert.ok(!editor.ids("filterzone").includes("20"));
    assert.ok(!editor.ids("filterzone").includes("21"));
    assert.deepEqual(editor.ids("filterzone"), ["0", "99"]);
    assert.deepEqual(editor.ids("channelID"), ["0", "64", "65"]);
    assert.equal(editor.$("#node-input-channelID").val(), "64");
    assert.equal(editor.$("#node-input-filterzone").val(), "99");
    editor.save();
    assert.equal(editor.$("#node-input-filterzone").val(), "99");
}

// Event changes affect only metadata and discard stale names immediately, even during an in-flight refresh.
{
    const editor = createEditor({ channelID: "1", filterzone: "2" });
    useCustomEvent(editor, "fielddetection");
    assert.equal(editor.requests.length, 1);
    assert.equal(editor.metadataRequests.length, 0);
    editor.requests[0].resolve(result([event("linedetection"), event("vmd")]));
    assert.equal(editor.metadataRequests[0].settings.data.eventType, "fielddetection");
    editor.metadataRequests[0].resolve(metadataResult([{ id: "1", name: "Old name" }], [zone("2", "Old zone", "1", "fieldDetection")]));
    assert.equal(optionFor(editor, "filterzone", "2").text, "Zone 2 — Old zone");
    choose(editor, "reactto", "linedetection");
    assert.equal(editor.requests.length, 1, "Changing an event must not requery capabilities");
    assert.equal(optionFor(editor, "filterzone", "2").text, "Zone 2 (current selection)");
    assert.equal(optionFor(editor, "channelID", "1").text, "Channel 1 (current selection)");
    const stale = editor.metadataRequests.at(-1);
    choose(editor, "reactto", "vmd");
    assert.ok(stale.aborted);
    stale.resolve(metadataResult([{ id: "1", name: "Stale" }], [zone("2", "Stale zone", "1", "linedetection")]));
    assert.equal(optionFor(editor, "filterzone", "2").text, "Zone 2 (current selection)");
    choose(editor, "filterzone", "0");
    editor.metadataRequests.at(-1).resolve(metadataResult([], [zone("2", "Current zone")]));
    assert.equal(editor.$("#node-input-filterzone").val(), "0", "A reply cannot undo a zone chosen while loading");
    editor.cancel();
}

// All-channels mode may name zones for a single camera but cannot conflate IDs from multiple channels.
for (const channels of [[{ id: "1" }], [{ id: "1" }, { id: "2" }], []]) {
    const editor = createEditor({ channelID: "0", filterzone: "2" });
    editor.requests[0].resolve(result([], channels));
    const zones = channels.length === 1 ? [zone("2", "Single sensor")] : [zone("2", "Camera one"), zone("2", "Camera two", "2")];
    editor.metadataRequests[0].resolve(metadataResult(channels, zones));
    assert.equal(optionFor(editor, "filterzone", "2").text, channels.length === 1 ? "Zone 2 — Single sensor" : "Zone 2 (current selection)");
    assert.equal(editor.$("#node-input-filterzone").val(), "2");
    if (channels.length !== 1) assert.match(editor.$("#node-alarm-metadata-status").text(), /Select a channel/);
    editor.cancel();
}

// Channel and server transitions cancel old metadata, wait for the new capabilities and reject late responses.
{
    const editor = createEditor({ channelID: "1", filterzone: "77" });
    editor.requests[0].resolve(result([], [{ id: "1" }, { id: "2" }]));
    const oldChannel = editor.metadataRequests[0];
    choose(editor, "channelID", "2");
    assert.ok(oldChannel.aborted);
    assert.equal(editor.metadataRequests.length, 1);
    oldChannel.resolve(metadataResult([{ id: "1", name: "Old channel" }], [zone("77", "Wrong scope")]));
    assert.equal(optionFor(editor, "filterzone", "77").text, "Zone 77 (current selection)");
    editor.requests.at(-1).resolve(result());
    assert.equal(editor.metadataRequests.at(-1).settings.data.channelID, "2");
    const oldServer = editor.metadataRequests.at(-1);
    editor.$("#node-input-server").val("camera-b").trigger("change");
    assert.ok(oldServer.aborted);
    oldServer.resolve(metadataResult([{ id: "2", name: "Wrong server" }], [zone("77", "Wrong server", "2")]));
    assert.equal(optionFor(editor, "filterzone", "77").text, "Zone 77 (current selection)");
    editor.requests.at(-1).reject();
    assert.equal(editor.metadataRequests.at(-1).settings.data.nodeID, "camera-b", "Names can still be tried when capabilities fail");
    editor.metadataRequests.at(-1).resolve(metadataResult([], [zone("77", "Correct scope", "2")]));
    assert.equal(optionFor(editor, "filterzone", "77").text, "Zone 77 — Correct scope");
    editor.cancel();
}

// Refresh forces both sequential requests; event edits while waiting keep the requested refresh.
{
    const editor = createEditor({ channelID: "1" });
    editor.requests[0].resolve(result([event("linedetection")]));
    const pending = editor.metadataRequests[0];
    editor.$("#node-alarm-discovery-refresh").trigger("click");
    assert.ok(pending.aborted);
    assert.equal(editor.requests.at(-1).settings.data.refresh, "true");
    assert.equal(editor.metadataRequests.length, 1);
    choose(editor, "reactto", "linedetection");
    editor.requests.at(-1).resolve(result());
    assert.equal(editor.metadataRequests.at(-1).settings.data.refresh, "true");
    assert.equal(editor.metadataRequests.at(-1).settings.data.eventType, "linedetection");
    editor.cancel();
}

// CUSTOM EVENT ID is never sent to the backend; Use event starts the request for the actual ID.
{
    const editor = createEditor({ channelID: "1", filterzone: "03" });
    selectCustom(editor);
    editor.requests[0].resolve(result());
    assert.equal(editor.metadataRequests.length, 0);
    editor.$("#node-alarm-custom-event").val("FutureCustom");
    editor.$("#node-alarm-use-custom-event").trigger("click");
    assert.equal(editor.requests.length, 1);
    assert.equal(editor.metadataRequests[0].settings.data.eventType, "FutureCustom");
    assert.equal(editor.$("#node-input-filterzone").val(), "03", "Preserve the exact saved zone representation");
    const pending = editor.metadataRequests[0];
    selectCustom(editor);
    assert.ok(pending.aborted);
    pending.resolve(metadataResult([], [zone("3", "Late custom", "1", "FutureCustom")]));
    editor.$("#node-alarm-custom-event").val("bad event");
    editor.$("#node-alarm-use-custom-event").trigger("click");
    assert.equal(editor.metadataRequests.length, 1);
    editor.save();
    assert.equal(editor.$("#node-input-reactto").val(), "FutureCustom");
    assert.equal(editor.$("#node-input-filterzone").val(), "03");
}

// Scene information is display-only; an ambiguous zone ID remains only when already selected.
for (const selected of ["1", "3"]) {
    const editor = createEditor({ channelID: "1", filterzone: selected, reactto: "fielddetection" });
    editor.requests[0].resolve(result());
    editor.metadataRequests[0].resolve(metadataResult([{ id: "1" }], [
        { ...zone("1", "Intrusion area", "1", "fielddetection"), sceneID: "1" },
        { ...zone("2", "Safe text", "1", "fielddetection"), sceneID: "<img src=x onerror=bad()>" },
        { ...zone("3", "Different first name", "1", "fielddetection"), sceneID: "1" },
        { ...zone("3", "Different second name", "1", "fielddetection"), sceneID: "2" },
        { ...zone("3", "Later repeated scene cannot restore it", "1", "fielddetection"), sceneID: "1" },
        { ...zone("4", "Same scene", "1", "fielddetection"), sceneID: 1 },
        { ...zone("4", "Same scene", "1", "fielddetection"), sceneID: "1" }
    ]));
    assert.equal(optionFor(editor, "filterzone", "1").text, "Zone 1 — Intrusion area (scene 1)");
    assert.equal(optionFor(editor, "filterzone", "2").text, "Zone 2 — Safe text (scene <img src=x onerror=bad()>)");
    assert.equal(optionFor(editor, "filterzone", "2").children.length, 0);
    if (selected === "3") assert.equal(optionFor(editor, "filterzone", "3").text, "Zone 3 (current selection)");
    else assert.equal(optionFor(editor, "filterzone", "3"), undefined);
    assert.equal(optionFor(editor, "filterzone", "4").text, "Zone 4 — Same scene (scene 1)");
    assert.match(editor.$("#node-alarm-metadata-status").text(), /across scenes/);
    assert.equal(editor.$("#node-input-filterzone").val(), selected);
    assert.ok(editor.ids("filterzone").every(id => /^\d+$/.test(id)), "Scene IDs must not become saved values");
    editor.save();
    assert.equal(editor.$("#node-input-filterzone").val(), selected);
}

// Offline/malformed metadata and closing the dialog keep all saved selections intact.
for (const state of ["offline", "malformed", "save", "cancel", "security", "radar"]) {
    const editor = createEditor({ channelID: "99", filterzone: "99" });
    editor.requests[0].resolve(result());
    const pending = editor.metadataRequests[0];
    if (state === "offline") pending.reject();
    else if (state === "malformed") pending.resolve({ status: "ok" });
    else if (state === "save" || state === "cancel") editor[state]();
    else choose(editor, "devicetype", state === "security" ? "1" : "2");
    assert.equal(editor.$("#node-input-filterzone").val(), "99");
    assert.equal(editor.$("#node-input-channelID").val(), "99");
    if (!["offline", "malformed"].includes(state)) {
        assert.ok(pending.aborted);
        pending.resolve(metadataResult([{ id: "99", name: "Late camera" }], [zone("99", "Late zone", "99")]));
        assert.equal(optionFor(editor, "filterzone", "99").text, "Zone 99 (current selection)");
        assert.equal(editor.metadataRequests.length, 1);
    }
    if (state !== "save" && state !== "cancel") editor.cancel();
}
for (const devicetype of [1, 2]) {
    const editor = createEditor({ devicetype, filterzone: "42" });
    assert.equal(editor.requests.length, 0);
    assert.equal(editor.metadataRequests.length, 0);
    assert.equal(editor.$("#node-input-filterzone").val(), "42");
    assert.deepEqual(editor.ids("filterzone"), ["0", "42"]);
    assert.deepEqual(editor.ids("channelID"), ["0"]);
    editor.cancel();
}

const unconfigured = createEditor({ server: "" });
assert.equal(unconfigured.requests.length, 0);
assert.equal(unconfigured.metadataRequests.length, 0);
assert.deepEqual(unconfigured.ids("reactto"), ["vmd", "#custom-event-id"]);
assert.deepEqual(unconfigured.ids("channelID"), ["0"]);
assert.deepEqual(unconfigured.ids("filterzone"), ["0"]);
unconfigured.cancel();
console.log("Alarm editor tests PASSED.");
