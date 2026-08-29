(() => {
  const BUTTON_CLASS = "dce-claude-button";
  const CACHE_REQUEST_TYPE = "dce-message-cache-request";
  const CACHE_RESPONSE_TYPE = "dce-message-cache-response";
  const contextTools = globalThis.DceContext;
  let composer;
  let pageContextReady;

  const sendMessage = (message) => new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(response || { ok: false, error: "拡張機能から応答がありません。" });
    });
  });

  // Discord renders rows as <li id="chat-messages-<channelId>-<messageId>">.
  function messageIdFromRoot(root) {
    const rowMatch = (root.id || root.getAttribute("data-list-item-id") || "").match(/chat-messages-\d+-(\d+)/);
    if (rowMatch) return rowMatch[1];
    return root.getAttribute("data-message-id") || root.id?.match(/(\d{10,})/)?.[1] || "";
  }

  function messageRoot(node) {
    if (!(node instanceof Element)) return null;
    return node.closest('li[id^="chat-messages-"], li[data-list-item-id^="chat-messages-"], [data-message-id]');
  }

  function currentChannel() {
    const parts = location.pathname.split("/").filter(Boolean);
    return {
      guildId: parts[1] || "",
      channelId: parts[2] || "",
      // Discord's tab title is `• Discord | "channel" | guild`; the header has no stable h1.
      name: document.title.match(/"([^"]+)"/)?.[1] || document.title.replace(/^[•\s]*Discord\s*\|\s*/, "").split("|")[0].trim() || "",
    };
  }

  function permalinkFor(id) {
    if (!id) return location.href;
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts[0] === "channels" && parts[1] && parts[2]) {
      return `${location.origin}/channels/${parts[1]}/${parts[2]}/${id}`;
    }
    return location.href;
  }

  const ATTACHMENT_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"];
  const ATTACHMENT_SELECTOR = ATTACHMENT_HOSTS.flatMap((host) => [
    `a[href*="${host}/attachments/"]`,
    `img[src*="${host}/attachments/"]`,
    `video[src*="${host}/attachments/"]`,
    `video source[src*="${host}/attachments/"]`,
    `audio[src*="${host}/attachments/"]`,
  ]).join(", ");

  function extractAttachments(root) {
    const byId = new Map();
    for (const node of root.querySelectorAll(ATTACHMENT_SELECTOR)) {
      const url = node.href || node.src || "";
      const match = url.match(/\/attachments\/\d+\/(\d+)\/([^/?#]+)/);
      if (!match || byId.has(match[1])) continue;
      byId.set(match[1], { id: match[1], name: decodeURIComponent(match[2]), url, mimeType: "", size: undefined });
    }
    return [...byId.values()];
  }

  function extractMessage(root) {
    const id = messageIdFromRoot(root);
    // The reply preview also contains a message-content-<parentId> node, so prefer the exact id.
    const content = root.querySelector(`#message-content-${id}`) ||
      [...root.querySelectorAll('[id^="message-content-"], [class*="messageContent"]')].find((node) => !node.closest('[id^="message-reply-context-"]'));
    const author = root.querySelector(`#message-username-${id}`) || root.querySelector('[id^="message-username-"], [class*="username"]');
    const time = root.querySelector("time[datetime]");
    return {
      id,
      text: content?.textContent?.trim() || root.innerText?.trim() || "",
      author: author?.textContent?.trim() || "（不明）",
      timestamp: time?.getAttribute("datetime") || time?.textContent?.trim() || "",
      channel: currentChannel(),
      sourceLink: permalinkFor(id),
      attachments: extractAttachments(root),
      replyTo: replyParentId(root),
    };
  }

  function replyParentId(root) {
    const references = root.querySelectorAll('[class*="repliedMessage"], [class*="replying"], [id^="message-reply-context-"], [aria-label*="reply" i]');
    for (const reference of references) {
      // message-reply-context-<ownId> wraps message-content-<parentId>.
      const previewId = reference.querySelector('[id^="message-content-"]')?.id.match(/(\d{10,})/)?.[1];
      if (previewId) return previewId;
      const directId = reference.getAttribute("data-message-id") || (!reference.id?.startsWith("message-reply-context-") && reference.id?.match(/(\d{10,})/)?.[1]);
      if (directId) return directId;
      for (const anchor of reference.querySelectorAll("a[href]")) {
        const id = anchor.href.match(/\/(\d{10,})(?:[?#].*)?$/)?.[1];
        if (id) return id;
      }
    }
    return "";
  }

  function domMessages() {
    const roots = new Set();
    for (const node of document.querySelectorAll('li[id^="chat-messages-"], li[data-list-item-id^="chat-messages-"], [data-message-id]')) {
      const root = messageRoot(node);
      if (root) roots.add(root);
    }
    return [...roots].map(extractMessage);
  }

  function ensurePageContext() {
    if (!pageContextReady) pageContextReady = Promise.resolve();
    return pageContextReady;
  }

  function requestCachedMessages(request) {
    return ensurePageContext().then(() => new Promise((resolve) => {
      const requestId = "dce-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      const timeout = setTimeout(() => {
        window.removeEventListener("message", receive);
        resolve([]);
      }, 800);
      function receive(event) {
        if (event.source !== window || event.data?.source !== "discord-claude-extension" ||
            event.data.type !== CACHE_RESPONSE_TYPE || event.data.requestId !== requestId) return;
        clearTimeout(timeout);
        window.removeEventListener("message", receive);
        resolve(Array.isArray(event.data.messages) ? event.data.messages : []);
      }
      window.addEventListener("message", receive);
      window.postMessage({ type: CACHE_REQUEST_TYPE, requestId, ...request }, "*");
    }));
  }

  async function collectMessageContext(sourceRoot, source) {
    const dom = domMessages();
    let available = contextTools.mergeMessages(dom, [source]);
    if (source.id) {
      const cached = await requestCachedMessages({
        sourceId: source.id,
        ...currentChannel(),
      });
      available = contextTools.mergeMessages(dom, cached);
      if (!available.some((message) => message.id === source.id)) available.push(source);
    }
    const selected = contextTools.selectReplyChain(source.id, available);
    const resolvedSource = available.find((message) => message.id === source.id) || source;
    return {
      source: resolvedSource,
      messages: selected.messages.length > 0 ? selected.messages : [resolvedSource],
      allMessages: available,
      missingRanges: selected.missingRanges,
      warning: selected.warning,
      reply: Boolean(resolvedSource.replyTo || (sourceRoot && replyParentId(sourceRoot))),
    };
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // options.mode "append" adds the selection to the Current Session instead of
  // starting a new Claude Session. sourceRoot may be null when the Source
  // Message is scrolled out of the DOM during a context refresh.
  function createComposer(sourceRoot, options = {}) {
    if (composer) composer.remove();
    let source = sourceRoot ? extractMessage(sourceRoot) : options.sourceMessage;
    let mode = options.mode || "new";
    let session = options.session || null;
    let submitting = false;
    const sentIds = new Set(options.sentMessageIds || []);
    const visibleMessages = () => mode === "append" ? contextState.messages.filter((message) => !sentIds.has(message.id)) : contextState.messages;
    const selectedMessages = () => visibleMessages().filter((message) => contextState.includedIds.has(message.id));
    let contextState = {
      messages: [source],
      allMessages: [source],
      includedIds: new Set([source.id]),
      missingRanges: [],
      warning: false,
      loading: true,
    };
    const backdrop = element("div", "dce-composer");
    const dialog = element("section", "dce-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const title = element("h2", "dce-title", "Claudeへ送る");
    const close = element("button", "dce-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "閉じる");
    close.addEventListener("click", () => backdrop.remove());
    const header = element("div", "dce-dialog-header");
    header.append(title, close);
    dialog.append(header);

    const preview = element("div", "dce-source-preview");
    preview.append(element("div", "dce-label", "Source Message"));
    const sourceAuthor = element("div", "dce-source-author", source.author + " · " + source.timestamp);
    const sourceText = element("p", "dce-source-text", source.text || "（本文なし）");
    preview.append(sourceAuthor, sourceText);
    const link = element("a", "dce-source-link", "Discordで開く");
    link.href = source.sourceLink;
    link.target = "_blank";
    link.rel = "noreferrer";
    preview.append(link);
    dialog.append(preview);

    const contextPanel = element("section", "dce-context-panel");
    contextPanel.append(element("h3", "dce-context-title", "Message Context"));
    const contextStatus = element("div", "dce-context-status", "返信コンテキストを確認しています…");
    contextPanel.append(contextStatus);
    const contextList = element("div", "dce-context-list");
    contextPanel.append(contextList);
    const contextActions = element("div", "dce-context-actions");
    const earlier = element("button", "dce-context-add", "前5件を追加");
    const later = element("button", "dce-context-add", "後5件を追加");
    earlier.type = "button";
    later.type = "button";
    contextActions.append(earlier, later);
    contextPanel.append(contextActions);
    dialog.append(contextPanel);

    function renderContext() {
      contextList.replaceChildren();
      for (const message of visibleMessages()) {
        const row = element("label", "dce-context-item");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = contextState.includedIds.has(message.id);
        checkbox.disabled = message.id === source.id;
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) contextState.includedIds.add(message.id);
          else contextState.includedIds.delete(message.id);
          updateSubmit();
        });
        const details = element("span", "dce-context-details");
        details.append(
          element("span", "dce-context-meta", message.author + " · " + message.timestamp + " · " + (message.channel?.name || "") +
            (message.attachments?.length ? " · 📎" + message.attachments.length : "")),
          element("span", "dce-context-message", message.text || "（本文なし）"),
        );
        row.append(checkbox, details);
        contextList.append(row);
      }
      const notices = [];
      if (contextState.loading) {
        notices.push("返信コンテキストを確認しています…");
      } else {
        if (mode === "append" && visibleMessages().length === 0) notices.push("前回送信以降の新しいメッセージはありません。前後5件の追加で候補を探せます。");
        if (contextState.warning) notices.push(contextTools.contextWarning(contextState.messages));
        for (const missing of contextState.missingRanges) {
          if (missing.direction === "earlier") notices.push("親方向の返信チェーンを一部取得できませんでした。");
          else if (missing.direction === "later") notices.push("後方のメッセージを取得できませんでした。");
          else if (missing.direction === "source") notices.push("Source Messageを取得できませんでした。");
        }
      }
      contextStatus.textContent = notices.join("\n");
      contextStatus.hidden = !contextState.loading && notices.length === 0;
      contextStatus.className = contextState.loading || notices.length > 0 ? "dce-context-status warning" : "dce-context-status";
      earlier.disabled = contextState.loading || contextState.allMessages.length === 0;
      later.disabled = contextState.loading || contextState.allMessages.length === 0;
      updateSubmit();
    }

    function updateSubmit() {
      submit.disabled = submitting || contextState.loading || (mode === "append" && selectedMessages().length === 0);
    }

    function addNeighbors(direction) {
      const candidates = contextTools.takeNeighborMessages(
        contextState.allMessages,
        contextState.messages,
        direction,
        5,
        mode === "append" ? sentIds : new Set(),
      );
      if (candidates.length === 0) {
        if (!contextState.missingRanges.some((missing) => missing.direction === direction)) {
          contextState.missingRanges.push({ direction });
        }
        renderContext();
        return;
      }
      if (candidates.length < 5 && !contextState.missingRanges.some((missing) => missing.direction === direction)) {
        contextState.missingRanges.push({ direction });
      }
      contextState.messages = direction === "earlier"
        ? [...candidates, ...contextState.messages]
        : [...contextState.messages, ...candidates];
      for (const message of candidates) contextState.includedIds.add(message.id);
      contextState.warning = contextState.messages.length >= 20;
      renderContext();
    }
    earlier.addEventListener("click", () => addNeighbors("earlier"));
    later.addEventListener("click", () => addNeighbors("later"));
    let contextReady = Promise.resolve();

    const modeRow = element("div", "dce-mode-row");
    modeRow.hidden = true;
    dialog.append(modeRow);
    // Offered when a Current Session can receive this Source Message. Starting
    // a new Claude Session stays the default.
    function offerAppend(current) {
      session = current;
      for (const id of current.sentMessageIds || []) sentIds.add(id);
      modeRow.replaceChildren(...[["new", "新しいセッションを開始"], ["append", "現在のセッションに追加: " + current.title]].map(([value, label]) => {
        const option = element("label", "dce-mode-option");
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "dce-mode";
        radio.checked = value === mode;
        radio.addEventListener("change", () => { mode = value; applyMode(); renderContext(); });
        option.append(radio, document.createTextNode(label));
        return option;
      }));
      modeRow.hidden = false;
    }

    const actionLabel = element("label", "dce-field-label", "Action Preset");
    const action = document.createElement("select");
    action.className = "dce-select";
    action.disabled = true;
    actionLabel.append(action);
    dialog.append(actionLabel);
    const actionStatus = element("div", "dce-muted", "Bridge の Action Preset を読み込んでいます…");
    dialog.append(actionStatus);

    const projectRow = element("div", "dce-muted dce-project-row");
    const projectLabel = element("span", null, "作業先: 一般 (General Workspace)");
    projectRow.append(projectLabel);
    const projectToggle = element("button", "dce-link-button", "Projectを選択");
    projectToggle.type = "button";
    projectRow.append(projectToggle);
    const projectSelect = document.createElement("select");
    projectSelect.className = "dce-select";
    projectSelect.hidden = true;
    projectSelect.append(new Option("一般（General Workspace）", ""));
    projectToggle.addEventListener("click", () => {
      projectSelect.hidden = false;
      projectToggle.hidden = true;
      projectLabel.textContent = "作業先:";
    });
    dialog.append(projectRow, projectSelect);

    const instructionLabel = element("label", "dce-field-label", "追加指示");
    const instruction = document.createElement("textarea");
    instruction.className = "dce-textarea";
    instruction.placeholder = "Claude Code に依頼する内容を入力してください";
    instruction.rows = 4;
    instructionLabel.append(instruction);
    dialog.append(instructionLabel);

    const error = element("div", "dce-error");
    error.hidden = true;
    const settings = element("a", "dce-settings-link", "接続設定を開く");
    settings.href = chrome.runtime.getURL("options.html");
    settings.target = "_blank";
    settings.rel = "noreferrer";
    settings.addEventListener("click", (event) => {
      event.preventDefault();
      chrome.runtime.sendMessage({ type: "open-options" });
    });
    error.append(element("span", "dce-error-text"), settings);
    dialog.append(error);

    const footer = element("div", "dce-dialog-footer");
    const cancel = element("button", "dce-secondary", "キャンセル");
    cancel.type = "button";
    cancel.addEventListener("click", () => backdrop.remove());
    const submit = element("button", "dce-primary", "Claudeへ送信");
    submit.type = "button";
    function applyMode() {
      const append = mode === "append";
      title.textContent = append ? "Current Session に追加: " + session.title : "Claudeへ送る";
      submit.textContent = append ? "Current Session に追加" : "Claudeへ送信";
      projectRow.hidden = append;
      projectSelect.hidden = append || !projectToggle.hidden;
    }
    submit.addEventListener("click", async () => {
      submitting = true;
      updateSubmit();
      submit.textContent = "送信中…";
      error.hidden = true;
      await contextReady;
      const payload = { sourceMessage: source, messageContext: selectedMessages(), actionId: action.value, instruction: instruction.value };
      const result = mode === "append"
        ? await sendMessage({ type: "append-context", sessionId: session.sessionId, payload })
        : await sendMessage({ type: "start-session", payload: { ...payload, projectId: projectSelect.value || undefined } });
      if (result?.ok) {
        backdrop.remove();
      } else {
        submitting = false;
        applyMode();
        updateSubmit();
        error.hidden = false;
        error.querySelector(".dce-error-text").textContent = result?.error || "Claude Bridgeに接続できません。";
      }
    });
    footer.append(cancel, submit);
    dialog.append(footer);
    applyMode();
    renderContext();
    backdrop.append(dialog);
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) backdrop.remove(); });
    document.body.append(backdrop);
    composer = backdrop;
    instruction.focus();

    contextReady = collectMessageContext(sourceRoot, source).catch(() => ({
      source,
      messages: [source],
      allMessages: [source],
      missingRanges: [{ direction: "earlier" }],
      warning: false,
    })).then((result) => {
      if (!backdrop.isConnected) return;
      source = result.source;
      contextState = {
        ...result,
        loading: false,
        includedIds: new Set(result.messages.map((message) => message.id)),
      };
      sourceAuthor.textContent = source.author + " · " + source.timestamp;
      sourceText.textContent = source.text || "（本文なし）";
      link.href = source.sourceLink;
      renderContext();
    });
    if (mode === "new") {
      sendMessage({ type: "current-session" }).then((result) => {
        if (result?.ok && result.session && backdrop.isConnected) offerAppend(result.session);
      });
    }

    sendMessage({ type: "bridge-config" }).then((config) => {
      if (!config?.ok) {
        actionStatus.textContent = "Bridge に接続できません。送信前に接続設定を確認してください。";
        return;
      }
      actionStatus.textContent = "Bridge の設定から読み込みました";
      for (const preset of config.actions || []) action.append(new Option(preset.label, preset.id));
      action.disabled = false;
      projectSelect.options[0].title = config.workspace || "";
      for (const project of config.projects || []) {
        const option = new Option(project.label, project.id);
        option.title = project.path;
        projectSelect.append(option);
      }
    });
  }

  function addClaudeButton(root) {
    if (!root) return;
    // Discord's hover actions live in div[role="group"].buttons_* > .buttonsInner_*.
    const toolbar = root.querySelector('[class*="buttonsInner"]') || root.querySelector('[role="toolbar"], [role="group"][class*="buttons"]');
    const existing = root.querySelector(`.${BUTTON_CLASS}`);
    if (existing) {
      // Discord creates its hover toolbar lazily. Move the fallback button into
      // that toolbar as soon as it appears, keeping the action beside Discord's
      // native hover actions.
      if (toolbar && existing.parentElement !== toolbar) toolbar.append(existing);
      return;
    }
    const button = element("button", BUTTON_CLASS, "Claude");
    button.type = "button";
    button.title = "この Source Message を Claude Code に送る";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      createComposer(root);
    });
    if (toolbar) toolbar.append(button);
    else {
      root.classList.add("dce-message-root");
      root.append(button);
    }
  }

  // Side Panel「Discordコンテキストを更新」: re-read this channel and offer only
  // the messages not yet sent to that Claude Session.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "dce-refresh-context") return false;
    const channel = message.sourceMessage?.channel;
    if ((channel?.channelId || channel?.id || "") !== currentChannel().channelId) {
      sendResponse({ ok: false, reason: "channel-mismatch" });
      return false;
    }
    const id = message.sourceMessage?.id;
    const root = id ? document.querySelector(`li[id$="-${id}"], [data-list-item-id$="-${id}"], [data-message-id="${id}"]`) : null;
    createComposer(root, {
      mode: "append",
      session: { sessionId: message.sessionId, title: message.sessionTitle },
      sentMessageIds: message.sentMessageIds,
      sourceMessage: message.sourceMessage,
    });
    sendResponse({ ok: true });
    return false;
  });

  function inspect(node) {
    const root = messageRoot(node);
    if (root) addClaudeButton(root);
  }

  document.addEventListener("mouseover", (event) => inspect(event.target), true);
  const observer = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(inspect)));
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
