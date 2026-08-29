const port = chrome.runtime.connect({ name: "claude-sidepanel" });
let currentState = null;
let sessions = [];

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
    button.addEventListener("click", () => port.postMessage({ type: "view-session", sessionId: session.sessionId }));
    list.append(button);
  }
}

function renderState(state) {
  currentState = state;
  $("#empty").hidden = Boolean(state);
  $("#conversation").hidden = !state;
  if (!state) { renderSessions(); return; }
  upsertSession(state);
  $("#session-source").textContent = state.title || state.sourceMessage?.sourceLink || "Current Session";
  const status = $("#status");
  status.className = `status ${state.status || "running"}`;
  status.textContent = state.error || ({ running: "実行中", complete: "完了", stopped: "停止", error: "エラー" }[state.status] || state.status || "実行中");
  const turns = (state.turns || []).map((turn) => `<div class="turn ${turn.role === "user" ? "user" : "assistant"}"><div class="turn-label">${turn.role === "user" ? "指示" : "Claude"}</div>${markdownToHtml(turn.text)}</div>`).join("");
  const current = `<div class="turn assistant current"><div class="turn-label">Claude</div>${markdownToHtml(state.text)}</div>`;
  $("#response").innerHTML = turns + current;
  $("#tools").replaceChildren(...(state.tools || []).map((tool) => {
    const item = document.createElement("div");
    item.className = "tool";
    item.textContent = `● ${tool.name || "Claude Code"}`;
    return item;
  }));
  $("#stop").disabled = state.status !== "running";
  $("#instruction").disabled = state.status === "running";
  $("#continue-form button").disabled = state.status === "running";
  renderSessions();
}

port.onMessage.addListener((message) => {
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
  } else if (message.type === "command-error") {
    $("#status").textContent = message.error;
  }
});

$("#continue-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const instruction = $("#instruction").value.trim();
  if (!instruction || !currentState || currentState.status === "running") return;
  port.postMessage({ type: "continue-session", sessionId: currentState.sessionId, instruction });
  $("#instruction").value = "";
});
$("#copy").addEventListener("click", async () => {
  if (!currentState?.text) return;
  await navigator.clipboard.writeText(currentState.text);
  $("#copy").textContent = "コピーしました";
  setTimeout(() => { $("#copy").textContent = "最終回答をコピー"; }, 1500);
});
$("#stop").addEventListener("click", () => {
  if (currentState?.status === "running") port.postMessage({ type: "stop-session", sessionId: currentState.sessionId });
});
$("#settings").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.sendMessage({ type: "open-options" });
});

port.postMessage({ type: "get-sessions" });
port.postMessage({ type: "get-state" });
