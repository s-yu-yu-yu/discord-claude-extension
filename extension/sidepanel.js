const port = chrome.runtime.connect({ name: "claude-sidepanel" });
let currentState = null;

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

function renderState(state) {
  currentState = state;
  $("#empty").hidden = Boolean(state);
  $("#conversation").hidden = !state;
  if (!state) return;
  $("#session-source").textContent = state.sourceMessage?.sourceLink || "Current Session";
  const status = $("#status");
  status.className = `status ${state.status || "running"}`;
  status.textContent = state.error || ({ running: "実行中", complete: "完了", stopped: "停止", error: "エラー" }[state.status] || state.status || "実行中");
  $("#response").innerHTML = markdownToHtml(state.text);
  $("#tools").replaceChildren(...(state.tools || []).map((tool) => {
    const item = document.createElement("div");
    item.className = "tool";
    item.textContent = `● ${tool.name || "Claude Code"}`;
    return item;
  }));
}

port.onMessage.addListener((message) => {
  if (message.type === "state") renderState(message.state);
  if (message.type === "stream-event") {
    const initialSessionEvent = message.event === "session" && currentState?.sessionId?.startsWith("pending-");
    if (!currentState || currentState.sessionId === message.sessionId || initialSessionEvent) renderState(message.state);
  }
});
$("#copy").addEventListener("click", async () => {
  if (!currentState?.text) return;
  await navigator.clipboard.writeText(currentState.text);
  $("#copy").textContent = "コピーしました";
  setTimeout(() => { $("#copy").textContent = "最終回答をコピー"; }, 1500);
});
$("#settings").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.sendMessage({ type: "open-options" });
});

port.postMessage({ type: "get-state" });
