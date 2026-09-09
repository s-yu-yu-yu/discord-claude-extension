import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../extension/background.js", import.meta.url), "utf8");
const PANEL_URL = "chrome-extension://id/sidepanel.html";

// Runs background.js as a sloppy script so top-level functions land on the
// context global; only the window/panel APIs used by openPanel are recorded.
function load({ window, popups = [] }) {
  const calls = [];
  const record = (name) => async (...args) => { calls.push([name, ...args]); return {}; };
  const listener = { addListener() {} };
  const chrome = {
    runtime: { getURL: (file) => `chrome-extension://id/${file}`, onConnect: listener, onMessage: listener, onInstalled: listener },
    storage: { local: { get: async () => ({}) } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    sidePanel: { open: record("sidePanel.open") },
    windows: { get: async () => window, create: record("windows.create"), update: record("windows.update") },
    tabs: { query: async () => popups, update: record("tabs.update") },
  };
  const context = { chrome, crypto: globalThis.crypto, console, fetch: async () => ({ ok: false }), setTimeout, clearTimeout };
  vm.runInNewContext(source, context);
  // Objects cross the vm realm boundary; compare by value, not prototype.
  return { openPanel: context.openPanel, calls: { get value() { return JSON.parse(JSON.stringify(calls)); } } };
}

test("openPanel uses the Side Panel for normal browser windows", async () => {
  const { openPanel, calls } = load({ window: { id: 1, type: "normal" } });
  await openPanel(1);
  assert.deepEqual(calls.value, [["sidePanel.open", { windowId: 1 }]]);
});

test("openPanel focuses an existing popup for installed-app windows instead of creating another", async () => {
  const { openPanel, calls } = load({ window: { id: 2, type: "app", state: "normal" }, popups: [{ url: PANEL_URL, windowId: 9 }] });
  await openPanel(2);
  assert.deepEqual(calls.value, [["windows.update", 9, { focused: true }]]);
});

test("openPanel navigates a popup left on the options page back to the panel", async () => {
  const { openPanel, calls } = load({ window: { id: 2, type: "app", state: "normal" }, popups: [{ id: 5, url: "chrome-extension://id/options.html", windowId: 9 }] });
  await openPanel(2);
  assert.deepEqual(calls.value, [["windows.update", 9, { focused: true }], ["tabs.update", 5, { url: PANEL_URL }]]);
});

test("openPanel creates a popup docked to the app window's right edge", async () => {
  const win = { id: 3, type: "app", state: "normal", top: 40, left: 100, width: 1200, height: 700 };
  const { openPanel, calls } = load({ window: win });
  await openPanel(3);
  assert.deepEqual(calls.value, [["windows.create", { url: PANEL_URL, type: "popup", top: 40, left: 880, width: 420, height: 700 }]]);
});

test("openPanel leaves placement to Chrome for fullscreen app windows", async () => {
  const { openPanel, calls } = load({ window: { id: 4, type: "popup", state: "fullscreen", top: 0, left: 0, width: 1440, height: 900 } });
  await openPanel(4);
  assert.deepEqual(calls.value, [["windows.create", { url: PANEL_URL, type: "popup" }]]);
});
