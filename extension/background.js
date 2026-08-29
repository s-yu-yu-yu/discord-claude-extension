const ports = new Set();
const panelViews = new Map();
const states = new Map();
let activeSessionId = null;
let storageWrite = Promise.resolve();
const pendingPersists = new Map();

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

function stateKeys(state) {
  return new Set([state.sessionId, state.claudeSessionId, ...(state.previousSessionIds || [])].filter(Boolean));
}

function serializeState(state) {
  return {
    sessionId: state.sessionId,
    claudeSessionId: state.claudeSessionId,
    cwd: state.cwd,
    projectId: state.projectId || null,
    title: state.title,
    sourceMessage: state.sourceMessage,
    instruction: state.instruction,
    actionId: state.actionId,
    text: state.text,
    turns: state.turns,
    tools: state.tools,
    status: state.status,
    unread: Boolean(state.unread),
    error: state.error,
    derivedFrom: state.derivedFrom || null,
    handoffText: state.handoffText || "",
    sentMessageIds: state.sentMessageIds || [],
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

function recordFromState(state) {
  return serializeState(state);
}

async function setBadge(sessions) {
  const unread = sessions.filter((session) => session.status === "complete" && session.unread).length;
  try {
    await chrome.action.setBadgeText({ text: unread ? String(unread) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
  } catch {
    // Badge APIs are unavailable in a few Chrome test shells.
  }
}

function writeState(state) {
  storageWrite = storageWrite.then(async () => {
    const record = recordFromState(state);
    // Do not create an index entry before the Bridge has assigned a real ID.
    if (record.sessionId?.startsWith("pending-")) return;
    const { sessions = [] } = await chrome.storage.local.get({ sessions: [] });
    const keys = stateKeys(state);
    const next = sessions.filter((item) => !keys.has(item.sessionId) && !keys.has(item.claudeSessionId));
    next.push(record);
    await chrome.storage.local.set({ sessions: next });
    await setBadge(next);
  }).catch(() => {});
  return storageWrite;
}

function persistState(state, { immediate = false } = {}) {
  const key = state.sessionId;
  const existing = pendingPersists.get(key);
  if (existing) clearTimeout(existing);
  if (immediate) {
    pendingPersists.delete(key);
    return writeState(state);
  }
  const timer = setTimeout(() => {
    pendingPersists.delete(key);
    writeState(state);
  }, 200);
  pendingPersists.set(key, timer);
  return storageWrite;
}

function stateFromRecord(record) {
  return {
    sessionId: record.sessionId || record.claudeSessionId,
    claudeSessionId: record.claudeSessionId || record.sessionId,
    cwd: record.cwd,
    projectId: record.projectId || null,
    title: record.title || "Claude Session",
    sourceMessage: record.sourceMessage,
    instruction: record.instruction || "",
    actionId: record.actionId,
    text: record.text || "",
    turns: Array.isArray(record.turns) ? record.turns : [],
    tools: record.tools || [],
    status: record.status || "complete",
    unread: Boolean(record.unread),
    error: record.error || "",
    derivedFrom: record.derivedFrom || null,
    handoffText: record.handoffText || "",
    sentMessageIds: Array.isArray(record.sentMessageIds) ? record.sentMessageIds : [],
    createdAt: record.createdAt || Date.now(),
    updatedAt: record.updatedAt || record.createdAt || Date.now(),
    previousSessionIds: [],
  };
}

async function readStoredSessions() {
  const { sessions = [] } = await chrome.storage.local.get({ sessions: [] });
  return Array.isArray(sessions) ? sessions : [];
}

async function reconcileSessions() {
  const stored = await readStoredSessions();
  if (stored.length === 0) {
    await setBadge([]);
    return [];
  }
  try {
    const response = await bridgeFetch("/sessions/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions: stored.map((item) => ({ sessionId: item.claudeSessionId || item.sessionId, cwd: item.cwd })) }),
    });
    if (!response.ok) throw new Error("Session reconciliation failed.");
    const { sessions: checked = [] } = await response.json();
    const byId = new Map(checked.map((item) => [item.sessionId, item]));
    const next = stored
      .map((item) => {
        const id = item.claudeSessionId || item.sessionId;
        const found = byId.get(id);
        if (!found?.exists) return null;
        return {
          ...item,
          sessionId: id,
          claudeSessionId: id,
          cwd: found.cwd || item.cwd,
          // The local index owns the Claude-generated title once the first
          // turn has streamed. Reconciliation should only validate existence
          // and refresh timestamps, not replace that title with a fallback.
          title: item.title || found.title,
          updatedAt: found.updatedAt || item.updatedAt,
        };
      })
      .filter(Boolean);
    const valid = new Set(next.map((item) => item.sessionId));
    for (const [id] of states) if (!valid.has(id)) states.delete(id);
    if (activeSessionId && !valid.has(activeSessionId)) activeSessionId = null;
    await chrome.storage.local.set({ sessions: next });
    await setBadge(next);
    return next;
  } catch {
    // A temporary Bridge outage must not erase the local index. The next open
    // retries reconciliation and removes only confirmed-missing sessions.
    await setBadge(stored);
    return stored;
  }
}

async function stateForId(sessionId) {
  if (!sessionId) return null;
  const inMemory = states.get(sessionId);
  if (inMemory) return inMemory;
  const stored = await readStoredSessions();
  const record = stored.find((item) => item.sessionId === sessionId || item.claudeSessionId === sessionId);
  if (!record) return null;
  const state = stateFromRecord(record);
  states.set(state.sessionId, state);
  return state;
}

function isSessionViewed(sessionId) {
  for (const viewedId of panelViews.values()) if (viewedId === sessionId) return true;
  return false;
}

async function markRead(port, state) {
  panelViews.set(port, state.sessionId);
  if (state.unread) {
    state.unread = false;
    await persistState(state, { immediate: true });
  }
}

function applyStreamEvent(state, event, data) {
  if (event === "session") {
    const previousId = state.sessionId;
    if (data.sessionId && data.sessionId !== state.sessionId) {
      state.previousSessionIds = [...(state.previousSessionIds || []), previousId];
      states.delete(previousId);
      state.sessionId = data.sessionId;
      states.set(state.sessionId, state);
      for (const [port, viewedId] of panelViews) if (viewedId === previousId) panelViews.set(port, state.sessionId);
      if (activeSessionId === previousId) activeSessionId = state.sessionId;
    }
    state.claudeSessionId = data.claudeSessionId || data.sessionId || state.claudeSessionId;
    state.cwd = data.cwd || state.cwd;
    state.projectId = data.projectId ?? state.projectId;
    if (data.derivedFrom) state.derivedFrom = { sessionId: data.derivedFrom, title: data.derivedFromTitle || state.derivedFrom?.title };
  } else if (event === "handoff-delta") {
    state.handoffText = (state.handoffText || "") + (data.text || "");
  } else if (event === "handoff") {
    state.handoffText = data.text || "";
    state.turns.push({ role: "user", text: "## Handoff\n\n" + state.handoffText });
  } else if (event === "title") {
    if (data.title) state.title = data.title;
  } else if (event === "delta") {
    state.text += data.text || "";
  } else if (event === "tool") {
    state.tools.push({ name: data.name || "Claude Code", detail: data.detail || "" });
  } else if (event === "complete") {
    state.status = data.stopped ? "stopped" : (data.isError ? "error" : "complete");
    if (data.text && !state.text) state.text = data.text;
    state.unread = state.status === "complete" && !isSessionViewed(state.sessionId);
  } else if (event === "error") {
    state.status = "error";
    state.error = data.message || "Claude Codeでエラーが発生しました。";
  } else if (event === "done" && data.status) {
    state.status = data.status;
  }
  state.updatedAt = Date.now();
  persistState(state, { immediate: ["session", "title", "complete", "error", "done"].includes(event) });
  sendToPanels({ type: "stream-event", sessionId: state.sessionId, event, data, state: serializeState(state) });
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
  if (buffer.startsWith("data:")) dataLines.push(buffer.slice(5).trim());
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
  } catch {
    applyStreamEvent(state, "error", { message: "Claude Bridgeに接続できません。接続設定を確認してください。" });
    applyStreamEvent(state, "done", { status: "error" });
  }
}

async function openPanel(windowId) {
  try { await chrome.sidePanel.open({ windowId }); } catch { /* Chrome may reject a delayed/invalid window gesture. */ }
}

// A new session before the Bridge has assigned its real ID.
function pendingState(fields) {
  return {
    sessionId: `pending-${crypto.randomUUID()}`,
    claudeSessionId: null,
    cwd: null,
    text: "",
    tools: [],
    status: "running",
    unread: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    error: "",
    previousSessionIds: [],
    ...fields,
  };
}

function messageIds(messages) {
  return [...new Set(messages.map((message) => message?.id).filter(Boolean))];
}

// The Current Session that a Discord composer may append to: the active
// session unless a turn is still running.
async function currentSession() {
  const state = await stateForId(activeSessionId);
  if (!state || state.status === "running") return null;
  return { sessionId: state.sessionId, title: state.title, status: state.status, sentMessageIds: state.sentMessageIds || [] };
}

// Context Expansion: appends newly selected Discord messages to an existing
// Claude Session as one resumed turn.
async function appendContext(message, sender, sendResponse) {
  const panelPromise = openPanel(sender.tab?.windowId);
  const state = await stateForId(message.sessionId);
  if (!state) { sendResponse({ ok: false, error: "Claude Sessionが見つかりません。" }); return; }
  if (state.status === "running") { sendResponse({ ok: false, error: "この Claude Session は実行中です。" }); return; }
  const { sourceMessage, messageContext = [], actionId, instruction = "" } = message.payload;
  const previousStatus = state.status;
  if (state.text) state.turns.push({ role: "assistant", text: state.text, status: previousStatus });
  state.turns.push({
    role: "user",
    text: `Discordコンテキストを追加（${messageContext.length}件）\n` + messageContext.map((item) => `- ${item.sourceLink}`).join("\n") +
      (instruction.trim() ? "\n\n" + instruction.trim() : ""),
  });
  state.status = "running";
  state.error = "";
  state.text = "";
  state.tools = [];
  state.unread = false;
  const previousSentIds = state.sentMessageIds || [];
  state.sentMessageIds = messageIds([...previousSentIds.map((id) => ({ id })), ...messageContext]);
  activeSessionId = state.sessionId;
  await persistState(state, { immediate: true });
  sendToPanels({ type: "state", state: serializeState(state) });
  await panelPromise;
  sendResponse({ ok: true, sessionId: state.sessionId });
  startStream(state, `/sessions/${encodeURIComponent(state.sessionId)}/messages`, {
    appendContext: true,
    instruction,
    messageContext,
    sourceMessage,
    actionId,
    cwd: state.cwd,
    title: state.title,
  }).then(() => {
    // A turn that never reached Claude must not hide its messages from the next refresh.
    if (state.status === "error") {
      state.sentMessageIds = previousSentIds;
      persistState(state, { immediate: true });
    }
  });
}

const DISCORD_URLS = ["https://discord.com/*", "https://canary.discord.com/*", "https://ptb.discord.com/*"];

// Asks the Discord tab to open the composer in append mode. Discord is only
// re-read on this explicit request; nothing is pulled automatically.
async function refreshContext(port, message) {
  const state = await stateForId(message.sessionId);
  if (!state) { port.postMessage({ type: "command-error", error: "Claude Sessionが見つかりません。" }); return; }
  if (state.status === "running") { port.postMessage({ type: "command-error", error: "この Claude Session は実行中です。" }); return; }
  const tabs = await chrome.tabs.query({ url: DISCORD_URLS });
  const channelUrl = String(state.sourceMessage?.sourceLink || "").replace(/\/\d+$/, "");
  const tab = tabs.find((item) => channelUrl && item.url?.startsWith(channelUrl)) || tabs.find((item) => item.active) || tabs[0];
  if (!tab) { port.postMessage({ type: "command-error", error: "Discord Web のタブを開いてください。" }); return; }
  let reply;
  try {
    reply = await chrome.tabs.sendMessage(tab.id, {
      type: "dce-refresh-context",
      sessionId: state.sessionId,
      sessionTitle: state.title,
      sourceMessage: state.sourceMessage,
      sentMessageIds: state.sentMessageIds || [],
    });
  } catch {
    port.postMessage({ type: "command-error", error: "Discord Web のタブを再読み込みしてください。" });
    return;
  }
  if (reply?.ok) {
    chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    return;
  }
  if (reply?.reason === "channel-mismatch") {
    await chrome.tabs.update(tab.id, { url: state.sourceMessage.sourceLink, active: true });
    port.postMessage({ type: "command-error", error: "Source Message のチャンネルを開きました。読み込み後にもう一度「Discordコンテキストを更新」を押してください。" });
    return;
  }
  port.postMessage({ type: "command-error", error: "Discord のコンテキストを更新できませんでした。" });
}

async function startSession(message, sender, sendResponse) {
  const state = pendingState({
    projectId: message.payload.projectId || null,
    title: message.payload.instruction?.trim().slice(0, 48) || "Discord Source Message",
    sourceMessage: message.payload.sourceMessage,
    instruction: message.payload.instruction || "",
    actionId: message.payload.actionId,
    turns: message.payload.instruction?.trim() ? [{ role: "user", text: message.payload.instruction.trim() }] : [],
    sentMessageIds: messageIds([message.payload.sourceMessage, ...(message.payload.messageContext || [])]),
  });
  states.set(state.sessionId, state);
  activeSessionId = state.sessionId;
  sendToPanels({ type: "state", state: serializeState(state) });
  // Start while still in the user-triggered message path; do not wait for a
  // Bridge health request before asking Chrome to open the Side Panel.
  const panelPromise = openPanel(sender.tab?.windowId);
  try {
    const health = await bridgeFetch("/health");
    if (!health.ok) throw new Error("Bridge health check failed.");
  } catch {
    states.delete(state.sessionId);
    sendResponse(settingsError("Claude Bridgeに接続できません。接続設定を確認してください。"));
    sendToPanels({ type: "state", state: null });
    return;
  }
  await panelPromise;
  sendResponse({ ok: true, sessionId: state.sessionId });
  startStream(state, "/sessions", message.payload);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "claude-sidepanel") return;
  ports.add(port);
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    panelViews.delete(port);
  });
  port.onMessage.addListener(async (message) => {
    if (message.type === "get-sessions") {
      port.postMessage({ type: "sessions", sessions: await reconcileSessions() });
    } else if (message.type === "get-state" || message.type === "view-session") {
      const state = await stateForId(message.sessionId || activeSessionId);
      if (state) {
        activeSessionId = state.sessionId;
        await markRead(port, state);
        port.postMessage({ type: "state", state: serializeState(state) });
      } else port.postMessage({ type: "state", state: null });
    } else if (message.type === "continue-session") {
      const state = await stateForId(message.sessionId);
      if (!state) { port.postMessage({ type: "command-error", error: "Claude Sessionが見つかりません。" }); return; }
      if (state.status === "running") { port.postMessage({ type: "command-error", error: "この Claude Session は実行中です。" }); return; }
      const previousStatus = state.status;
      state.status = "running";
      state.error = "";
      if (state.text) state.turns.push({ role: "assistant", text: state.text, status: previousStatus });
      if (message.instruction?.trim()) state.turns.push({ role: "user", text: message.instruction.trim() });
      state.text = "";
      state.tools = [];
      state.unread = false;
      activeSessionId = state.sessionId;
      await persistState(state, { immediate: true });
      sendToPanels({ type: "state", state: serializeState(state) });
      startStream(state, `/sessions/${encodeURIComponent(state.sessionId)}/messages`, {
        instruction: message.instruction,
        cwd: state.cwd,
        sourceMessage: state.sourceMessage,
        messageContext: state.sourceMessage ? [state.sourceMessage] : [],
        actionId: state.actionId,
        title: state.title,
      });
    } else if (message.type === "promote-session") {
      const original = await stateForId(message.sessionId);
      if (!original) { port.postMessage({ type: "command-error", error: "Claude Sessionが見つかりません。" }); return; }
      if (original.status === "running") { port.postMessage({ type: "command-error", error: "この Claude Session は実行中です。" }); return; }
      const state = pendingState({
        projectId: message.projectId,
        title: `${original.title} (Project)`,
        sourceMessage: original.sourceMessage,
        instruction: message.instruction || "",
        actionId: original.actionId,
        turns: [],
        derivedFrom: { sessionId: original.sessionId, title: original.title },
        handoffText: "",
      });
      states.set(state.sessionId, state);
      activeSessionId = state.sessionId;
      sendToPanels({ type: "state", state: serializeState(state) });
      startStream(state, `/sessions/${encodeURIComponent(original.sessionId)}/promote`, {
        projectId: message.projectId,
        instruction: message.instruction,
        cwd: original.cwd,
        sourceMessage: original.sourceMessage,
        title: original.title,
      });
    } else if (message.type === "refresh-context") {
      await refreshContext(port, message);
    } else if (message.type === "stop-session") {
      const state = await stateForId(message.sessionId);
      if (!state) { port.postMessage({ type: "command-error", error: "Claude Sessionが見つかりません。" }); return; }
      try {
        const response = await bridgeFetch(`/sessions/${encodeURIComponent(state.sessionId)}`, { method: "DELETE" });
        if (!response.ok) throw new Error("stop failed");
      } catch {
        port.postMessage({ type: "command-error", error: "実行を停止できませんでした。" });
      }
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
  if (message.type === "append-context") {
    appendContext(message, sender, sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message.type === "current-session") {
    currentSession().then((session) => sendResponse({ ok: true, session })).catch(() => sendResponse({ ok: true, session: null }));
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
  readStoredSessions().then(setBadge).catch(() => {});
});
