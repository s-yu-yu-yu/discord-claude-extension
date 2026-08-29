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

  function messageIdFromRoot(root) {
    const listId = root.getAttribute("data-list-item-id") || "";
    const listMatch = listId.match(/chat-messages-(\d+)/);
    if (listMatch) return listMatch[1];
    return root.getAttribute("data-message-id") || root.id?.match(/(\d{10,})/)?.[1] || "";
  }

  function messageRoot(node) {
    if (!(node instanceof Element)) return null;
    return node.closest('li[data-list-item-id^="chat-messages-"], [data-message-id]');
  }

  function currentChannel() {
    const parts = location.pathname.split("/").filter(Boolean);
    return {
      guildId: parts[1] || "",
      channelId: parts[2] || "",
      name: document.querySelector('[class*="title_"] h1, [class*="channelName"], header h1')?.textContent?.trim() || "",
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

  function extractMessage(root) {
    const id = messageIdFromRoot(root);
    const content = root.querySelector('[id^="message-content-"], [class*="messageContent"]');
    const author = root.querySelector('[id^="message-username-"], [class*="username"]');
    const time = root.querySelector("time[datetime]");
    const links = [...root.querySelectorAll("a[href]")]
      .map((anchor) => ({ url: anchor.href, name: anchor.textContent?.trim() || anchor.getAttribute("aria-label") || "" }))
      .filter((attachment) => /download|cdn\.discordapp|media\.discordapp/i.test(attachment.url));
    return {
      id,
      text: content?.textContent?.trim() || root.innerText?.trim() || "",
      author: author?.textContent?.trim() || "（不明）",
      timestamp: time?.getAttribute("datetime") || time?.textContent?.trim() || "",
      channel: currentChannel(),
      sourceLink: permalinkFor(id),
      attachments: links,
      replyTo: replyParentId(root),
    };
  }

  function replyParentId(root) {
    const references = root.querySelectorAll('[class*="repliedMessage"], [class*="replying"], [id^="message-reply-context-"], [aria-label*="reply" i]');
    for (const reference of references) {
      const directId = reference.getAttribute("data-message-id") || reference.id?.match(/(\d{10,})/)?.[1];
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
    for (const node of document.querySelectorAll('li[data-list-item-id^="chat-messages-"], [data-message-id]')) {
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
      reply: Boolean(resolvedSource.replyTo || replyParentId(sourceRoot)),
    };
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createComposer(sourceRoot) {
    if (composer) composer.remove();
    let source = extractMessage(sourceRoot);
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
      for (const message of contextState.messages) {
        const row = element("label", "dce-context-item");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = contextState.includedIds.has(message.id);
        checkbox.disabled = message.id === source.id;
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) contextState.includedIds.add(message.id);
          else contextState.includedIds.delete(message.id);
        });
        const details = element("span", "dce-context-details");
        details.append(
          element("span", "dce-context-meta", message.author + " · " + message.timestamp + " · " + (message.channel?.name || "")),
          element("span", "dce-context-message", message.text || "（本文なし）"),
        );
        row.append(checkbox, details);
        contextList.append(row);
      }
      const notices = [];
      if (contextState.loading) {
        notices.push("返信コンテキストを確認しています…");
      } else {
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
    }

    function addNeighbors(direction) {
      const candidates = contextTools.takeNeighborMessages(
        contextState.allMessages,
        contextState.messages,
        direction,
        5,
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
    renderContext();
    let contextReady = Promise.resolve();

    const actionLabel = element("label", "dce-field-label", "Action Preset");
    const action = document.createElement("select");
    action.className = "dce-select";
    action.append(new Option("自由入力", "freeform"));
    actionLabel.append(action);
    dialog.append(actionLabel);
    const actionStatus = element("div", "dce-muted", "Bridge の Action Preset を読み込んでいます…");
    dialog.append(actionStatus);

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
    submit.disabled = true;
    submit.addEventListener("click", async () => {
      submit.disabled = true;
      submit.textContent = "送信中…";
      error.hidden = true;
      await contextReady;
      const result = await sendMessage({
        type: "start-session",
        payload: {
          sourceMessage: source,
          messageContext: contextState.messages.filter((message) => contextState.includedIds.has(message.id)),
          actionId: action.value,
          instruction: instruction.value,
        },
      });
      if (result?.ok) {
        backdrop.remove();
      } else {
        submit.disabled = false;
        submit.textContent = "Claudeへ送信";
        error.hidden = false;
        error.querySelector(".dce-error-text").textContent = result?.error || "Claude Bridgeに接続できません。";
      }
    });
    footer.append(cancel, submit);
    dialog.append(footer);
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
      submit.disabled = false;
      renderContext();
    });

    sendMessage({ type: "bridge-config" }).then((config) => {
      if (!config?.ok) {
        actionStatus.textContent = "Bridge に接続できません。送信前に接続設定を確認してください。";
        return;
      }
      actionStatus.textContent = "Bridge の設定から読み込みました";
      for (const preset of config.actions || []) action.append(new Option(preset.label, preset.id));
    });
  }

  function addClaudeButton(root) {
    if (!root) return;
    const toolbar = root.querySelector('[role="toolbar"]');
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

  function inspect(node) {
    const root = messageRoot(node);
    if (root) addClaudeButton(root);
  }

  document.addEventListener("mouseover", (event) => inspect(event.target), true);
  const observer = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(inspect)));
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
