// The MV3 service worker is terminated when idle, which disconnects this port.
// Reconnect on demand instead of letting later postMessage calls throw.
let port;
function connect() {
  port = chrome.runtime.connect({ name: "claude-sidepanel" });
  port.onMessage.addListener(handleMessage);
  port.onDisconnect.addListener(() => { port = null; });
  // A fresh port has no view registered in the background; restore it.
  if (currentState) port.postMessage({ type: "view-session", sessionId: currentState.sessionId });
}
function send(message) {
  if (!port) connect();
  try {
    port.postMessage(message);
  } catch {
    // onDisconnect fires asynchronously, so a stale port can still be present here.
    connect();
    port.postMessage(message);
  }
}
let currentState = null;
let sessions = [];
// Terminal handoff info per Claude Session: { status, command, canOpenTerminal }.
const terminalInfo = new Map();

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function inlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const output = [];
  let inCode = false;
  let code = [];
  let listType = null;
  const closeList = () => { if (listType) { output.push(`</${listType}>`); listType = null; } };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) { output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`); code = []; inCode = false; }
      else { closeList(); inCode = true; }
      continue;
    }
    if (inCode) { code.push(line); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { closeList(); output.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`); continue; }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { closeList(); output.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`); continue; }
    const list = line.match(/^\s*([-*+] |\d+\. )(.+)$/);
    if (list) {
      const nextType = /^\d/.test(list[1]) ? "ol" : "ul";
      if (listType !== nextType) { closeList(); output.push(`<${nextType}>`); listType = nextType; }
      output.push(`<li>${inlineMarkdown(list[2])}</li>`); continue;
    }
    if (!line.trim()) { closeList(); continue; }
    closeList(); output.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  if (inCode) output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  closeList();
  return output.join("");
}

function relativeTime(timestamp) {
  const delta = Math.max(0, Date.now() - Number(timestamp || Date.now()));
  if (delta < 60_000) return "たった今";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}分前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}時間前`;
  return `${Math.floor(delta / 86_400_000)}日前`;
}

function upsertSession(state) {
  if (!state?.sessionId) return;
  const record = {
    sessionId: state.sessionId,
    title: state.title,
    status: state.status,
    unread: state.unread,
    updatedAt: state.updatedAt,
  };
  const index = sessions.findIndex((item) => item.sessionId === state.sessionId);
  if (index >= 0) sessions[index] = { ...sessions[index], ...record };
  else sessions.unshift(record);
}

function renderSessions() {
  const list = $("#session-list");
  list.replaceChildren();
  for (const session of [...sessions].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))) {
    const button = document.createElement("button");
    button.className = `session-item${currentState?.sessionId === session.sessionId ? " current" : ""}${session.unread ? " unread" : ""}`;
    button.type = "button";
    button.innerHTML = `<span class="session-item-title">${escapeHtml(session.title || "Claude Session")}</span><span class="session-item-meta">${escapeHtml(session.status || "")} · ${escapeHtml(relativeTime(session.updatedAt))}</span>`;
    button.addEventListener("click", () => send({ type: "view-session", sessionId: session.sessionId }));
    list.append(button);
  }
}

function renderTerminal(state) {
  const info = terminalInfo.get(state.sessionId);
  // Fetch once per session, and again when a turn finishes so a session whose
  // JSONL did not exist yet is picked up. Streaming deltas must not refetch.
  if (state.claudeSessionId && state.cwd && !state.sessionId.startsWith("pending-") &&
      (!info || (info.status !== state.status && state.status !== "running"))) {
    terminalInfo.set(state.sessionId, { ...info, status: state.status });
    send({ type: "terminal-info", sessionId: state.sessionId });
  }
  const command = terminalInfo.get(state.sessionId)?.command || "";
  $("#resume-command").hidden = !command;
  $("#resume-command").textContent = command;
  $("#terminal").hidden = !terminalInfo.get(state.sessionId)?.canOpenTerminal;
  // A concurrent CLI on the same Claude Session would conflict with the running turn.
  $("#terminal").disabled = state.status === "running";
  $("#copy-command").disabled = !command;
}

function renderState(state) {
  currentState = state;
  $("#empty").hidden = Boolean(state);
  $("#conversation").hidden = !state;
  if (!state) { renderSessions(); return; }
  upsertSession(state);
  $("#session-source").textContent = (state.title || state.sourceMessage?.sourceLink || "Current Session") +
    (state.projectId && state.cwd ? " · " + state.cwd.split("/").pop() : " · 一般");
  const status = $("#status");
  status.className = `status ${state.status || "running"}`;
  status.textContent = state.error || ({ running: "実行中", complete: "完了", stopped: "停止", error: "エラー" }[state.status] || state.status || "実行中");
  $("#derived-from").hidden = !state.derivedFrom;
  $("#derived-from-link").textContent = state.derivedFrom?.title || state.derivedFrom?.sessionId || "";
  $("#promote").hidden = Boolean(state.projectId) || state.status === "running";
  const turns = (state.turns || []).map((turn) => `<div class="turn ${turn.role === "user" ? "user" : "assistant"}"><div class="turn-label">${turn.role === "user" ? "指示" : "Claude"}</div>${markdownToHtml(turn.text)}</div>`).join("");
  // The Handoff streams before the Project Session exists; show it until it lands as the first turn.
  const handoffPending = state.handoffText && !(state.turns || []).some((turn) => turn.text.startsWith("## Handoff"))
    ? `<div class="turn user"><div class="turn-label">Handoff 生成中</div>${markdownToHtml(state.handoffText)}</div>`
    : "";
  const current = `<div class="turn assistant current"><div class="turn-label">Claude</div>${markdownToHtml(state.text)}</div>`;
  $("#response").innerHTML = turns + handoffPending + current;
  $("#tools").replaceChildren(...(state.tools || []).map((tool) => {
    const item = document.createElement("div");
    item.className = "tool";
    item.textContent = `● ${tool.name || "Claude Code"}`;
    return item;
  }));
  $("#stop").disabled = state.status !== "running";
  $("#refresh-context").disabled = state.status === "running" || !state.sourceMessage?.sourceLink;
  $("#instruction").disabled = state.status === "running";
  $("#continue-form button").disabled = state.status === "running";
  renderTerminal(state);
  renderSessions();
}

function handleMessage(message) {
  if (message.type === "sessions") {
    sessions = message.sessions || [];
    renderSessions();
  } else if (message.type === "state") {
    renderState(message.state);
  } else if (message.type === "stream-event") {
    if (message.state) {
      // Keep the list current even while another session is open in the
      // conversation view. This also lets a background completion update its
      // unread marker without replacing the current session's transcript.
      upsertSession(message.state);
      renderSessions();
    }
    const initialSessionEvent = message.event === "session" && currentState?.sessionId?.startsWith("pending-");
    if (!currentState || currentState.sessionId === message.sessionId || initialSessionEvent) renderState(message.state);
  } else if (message.type === "terminal-info") {
    terminalInfo.set(message.sessionId, { ...terminalInfo.get(message.sessionId), command: message.command, canOpenTerminal: message.canOpenTerminal });
    if (currentState?.sessionId === message.sessionId) renderTerminal(currentState);
  } else if (message.type === "terminal-opened") {
    $("#terminal").textContent = "開きました";
    setTimeout(() => { $("#terminal").textContent = "ターミナルで開く"; }, 1500);
  } else if (message.type === "command-error") {
    $("#status").textContent = message.error;
    if (message.command && message.sessionId) {
      terminalInfo.set(message.sessionId, { ...terminalInfo.get(message.sessionId), command: message.command, canOpenTerminal: false });
      if (currentState?.sessionId === message.sessionId) renderTerminal(currentState);
    }
  }
}

$("#continue-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const instruction = $("#instruction").value.trim();
  if (!instruction || !currentState || currentState.status === "running") return;
  send({ type: "continue-session", sessionId: currentState.sessionId, instruction });
  $("#instruction").value = "";
});
$("#copy").addEventListener("click", async () => {
  if (!currentState?.text) return;
  await navigator.clipboard.writeText(currentState.text);
  $("#copy").textContent = "コピーしました";
  setTimeout(() => { $("#copy").textContent = "最終回答をコピー"; }, 1500);
});
$("#stop").addEventListener("click", () => {
  if (currentState?.status === "running") send({ type: "stop-session", sessionId: currentState.sessionId });
});
$("#terminal").addEventListener("click", () => {
  if (currentState && currentState.status !== "running") send({ type: "open-terminal", sessionId: currentState.sessionId });
});
$("#copy-command").addEventListener("click", async () => {
  const command = terminalInfo.get(currentState?.sessionId)?.command;
  if (!command) return;
  await navigator.clipboard.writeText(command);
  $("#copy-command").textContent = "コピーしました";
  setTimeout(() => { $("#copy-command").textContent = "resumeコマンドをコピー"; }, 1500);
});
$("#refresh-context").addEventListener("click", () => {
  if (currentState && currentState.status !== "running") send({ type: "refresh-context", sessionId: currentState.sessionId });
});
$("#derived-from-link").addEventListener("click", () => {
  if (currentState?.derivedFrom) send({ type: "view-session", sessionId: currentState.derivedFrom.sessionId });
});
function loadProjects() {
  chrome.runtime.sendMessage({ type: "bridge-config" }, (config) => {
    const select = $("#promote-project");
    select.replaceChildren(...(config?.projects || []).map((project) => new Option(project.label, project.id)));
  });
}
$("#promote").addEventListener("toggle", () => { if ($("#promote").open) loadProjects(); });
$("#promote-submit").addEventListener("click", () => {
  const projectId = $("#promote-project").value;
  if (!projectId || !currentState || currentState.status === "running") return;
  send({ type: "promote-session", sessionId: currentState.sessionId, projectId, instruction: $("#promote-instruction").value.trim() });
  $("#promote-instruction").value = "";
});
$("#settings").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.sendMessage({ type: "open-options" });
});

send({ type: "get-sessions" });
send({ type: "get-state" });
loadProjects();
// ponytail: a periodic message keeps the service worker alive while the panel is open.
setInterval(() => send({ type: "ping" }), 20_000);
