const ports = new Set();
const states = new Map();
let activeSessionId = null;

function extensionUrl(file) {
  return chrome.runtime.getURL(file);
}

async function getBridgeUrl() {
  const { bridgeUrl = "http://127.0.0.1:3456" } = await chrome.storage.local.get("bridgeUrl");
  return String(bridgeUrl).replace(/\/+$/, "");
}

async function bridgeFetch(path, options = {}) {
  const base = await getBridgeUrl();
  return fetch(`${base}${path}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
  });
}

function settingsError(message) {
  return {
    ok: false,
    error: message || "Claude Bridgeに接続できません。",
    settingsUrl: extensionUrl("options.html"),
  };
}

function sendToPanels(message) {
  for (const port of ports) {
    try { port.postMessage(message); } catch { ports.delete(port); }
  }
}

function applyStreamEvent(state, event, data) {
  if (event === "session") {
    if (data.sessionId && data.sessionId !== state.sessionId) {
      states.delete(state.sessionId);
      state.sessionId = data.sessionId;
      states.set(state.sessionId, state);
      activeSessionId = state.sessionId;
    }
  } else if (event === "delta") {
    state.text += data.text || "";
  } else if (event === "tool") {
    state.tools.push({ name: data.name || "Claude Code", detail: data.detail || "" });
  } else if (event === "complete") {
    state.status = data.stopped ? "stopped" : (data.isError ? "error" : "complete");
    if (data.text && !state.text) state.text = data.text;
  } else if (event === "error") {
    state.status = "error";
    state.error = data.message || "Claude Codeでエラーが発生しました。";
  } else if (event === "done" && data.status) {
    state.status = data.status;
  }
  sendToPanels({ type: "stream-event", sessionId: state.sessionId, event, data, state: serializeState(state) });
}

function serializeState(state) {
  return {
    sessionId: state.sessionId,
    title: state.title,
    sourceMessage: state.sourceMessage,
    instruction: state.instruction,
    actionId: state.actionId,
    text: state.text,
    tools: state.tools,
    status: state.status,
    error: state.error,
    createdAt: state.createdAt,
  };
}

async function consumeSse(response, state) {
  if (!response.ok || !response.body) {
    let message = `Bridge request failed (${response.status}).`;
    try { message = (await response.json()).error || message; } catch { /* response may not be JSON */ }
    applyStreamEvent(state, "error", { message });
    applyStreamEvent(state, "done", { status: "error" });
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines = [];
  const flush = () => {
    if (dataLines.length === 0) return;
    let data;
    try { data = JSON.parse(dataLines.join("\n")); } catch { data = { message: dataLines.join("\n") }; }
    applyStreamEvent(state, eventName, data);
    eventName = "message";
    dataLines = [];
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line === "") flush();
      else if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (done) break;
  }
  if (buffer) {
    if (buffer.startsWith("data:")) dataLines.push(buffer.slice(5).trim());
  }
  flush();
}

async function startStream(state, requestPath, body) {
  try {
    const response = await bridgeFetch(requestPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await consumeSse(response, state);
  } catch (error) {
    applyStreamEvent(state, "error", { message: "Claude Bridgeに接続できません。接続設定を確認してください。" });
    applyStreamEvent(state, "done", { status: "error" });
  }
}

async function openPanel(windowId) {
  try {
    await chrome.sidePanel.open({ windowId });
  } catch {
    // Chrome may reject an open outside a user gesture; the action remains available.
  }
}

async function startSession(message, sender, sendResponse) {
  const state = {
    sessionId: `pending-${crypto.randomUUID()}`,
    title: message.payload.instruction?.trim().slice(0, 48) || "Discord Source Message",
    sourceMessage: message.payload.sourceMessage,
    instruction: message.payload.instruction || "",
    actionId: message.payload.actionId,
    text: "",
    tools: [],
    status: "running",
    createdAt: Date.now(),
    error: "",
  };
  states.set(state.sessionId, state);
  activeSessionId = state.sessionId;
  // Keep this call directly in the user-triggered message path. Chrome can
  // reject a delayed sidePanel.open after an asynchronous health check.
  const panelPromise = openPanel(sender.tab?.windowId);
  try {
    const health = await bridgeFetch("/health");
    if (!health.ok) throw new Error("Bridge health check failed.");
  } catch {
    states.delete(state.sessionId);
    sendResponse(settingsError("Claude Bridgeに接続できません。接続設定を確認してください。"));
    return;
  }
  await panelPromise;
  sendResponse({ ok: true, sessionId: state.sessionId });
  // The panel can render from the in-memory state while this request is streaming.
  startStream(state, "/sessions", message.payload);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "claude-sidepanel") return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener(async (message) => {
    if (message.type === "get-state") {
      const state = states.get(message.sessionId || activeSessionId);
      if (state) port.postMessage({ type: "state", state: serializeState(state) });
      else port.postMessage({ type: "state", state: null });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "bridge-config") {
    bridgeFetch("/config")
      .then(async (response) => response.ok ? { ok: true, ...(await response.json()) } : settingsError())
      .catch(() => settingsError())
      .then(sendResponse);
    return true;
  }
  if (message.type === "start-session") {
    startSession(message, sender, sendResponse);
    return true;
  }
  if (message.type === "open-options") {
    chrome.tabs.create({ url: extensionUrl("options.html") });
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
});
