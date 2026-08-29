(() => {
  const BUTTON_CLASS = "dce-claude-button";
  let composer;

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
    const source = extractMessage(sourceRoot);
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
    preview.append(element("div", "dce-source-author", `${source.author} · ${source.timestamp}`));
    preview.append(element("p", "dce-source-text", source.text || "（本文なし）"));
    const link = element("a", "dce-source-link", "Discordで開く");
    link.href = source.sourceLink;
    link.target = "_blank";
    link.rel = "noreferrer";
    preview.append(link);
    dialog.append(preview);

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
    submit.addEventListener("click", async () => {
      submit.disabled = true;
      submit.textContent = "送信中…";
      error.hidden = true;
      const result = await sendMessage({
        type: "start-session",
        payload: {
          sourceMessage: source,
          messageContext: [source],
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
