(() => {
  const REQUEST_TYPE = "dce-message-cache-request";
  const RESPONSE_TYPE = "dce-message-cache-response";

  function webpackRequire() {
    const chunks = window.webpackChunkdiscord_app;
    if (!Array.isArray(chunks)) return null;
    let runtime;
    try {
      chunks.push([["dce-" + Date.now()], {}, (candidate) => { runtime = candidate; }]);
    } catch {
      return null;
    }
    return runtime;
  }

  function messageStore() {
    const runtime = webpackRequire();
    for (const module of Object.values(runtime?.c || {})) {
      const exported = module?.exports;
      const candidates = [exported, exported?.default, ...(exported && typeof exported === "object" ? Object.values(exported) : [])];
      for (const candidate of candidates) {
        if (candidate && typeof candidate.getMessages === "function" && typeof candidate.getMessage === "function") {
          return candidate;
        }
      }
    }
    return null;
  }

  function collectionValues(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (Array.isArray(collection._array)) return collection._array;
    if (typeof collection.toArray === "function") return collection.toArray();
    if (typeof collection.values === "function") return [...collection.values()];
    if (collection._map && typeof collection._map === "object") return Object.values(collection._map);
    return [];
  }

  function currentLocation() {
    const parts = location.pathname.split("/").filter(Boolean);
    return { guildId: parts[1] || "", channelId: parts[2] || "" };
  }

  function permalink(messageId, guildId, channelId) {
    if (guildId && channelId) return location.origin + "/channels/" + guildId + "/" + channelId + "/" + messageId;
    return location.href;
  }

  function normalizeMessage(raw, request) {
    const locationInfo = currentLocation();
    const id = raw?.id ? String(raw.id) : "";
    const channelId = raw?.channel_id || raw?.channelId
      ? String(raw.channel_id || raw.channelId)
      : request.channelId || locationInfo.channelId;
    if (!id) return null;
    return {
      id,
      text: typeof raw.content === "string" ? raw.content : "",
      author: raw.author?.global_name || raw.author?.globalName || raw.author?.username || "（不明）",
      timestamp: raw.timestamp || "",
      channel: { id: channelId, name: request.channelName || "" },
      sourceLink: permalink(id, locationInfo.guildId || request.guildId, channelId),
      attachments: Array.isArray(raw.attachments)
        ? raw.attachments.map((attachment) => ({
            id: String(attachment.id || ""),
            name: attachment.filename || attachment.name || "",
            mimeType: attachment.content_type || attachment.mimeType || "",
            size: attachment.size,
            url: attachment.url || "",
          }))
        : [],
      replyTo: raw.message_reference?.message_id
        ? String(raw.message_reference.message_id)
        : raw.messageReference?.message_id
          ? String(raw.messageReference.message_id)
        : raw.messageReference?.messageId
          ? String(raw.messageReference.messageId)
          : "",
    };
  }

  function readMessages(request) {
    const store = messageStore();
    if (!store) return [];
    let rawMessages = [];
    try {
      rawMessages = collectionValues(store.getMessages(request.channelId));
      if (rawMessages.length === 0 && request.sourceId) {
        const source = store.getMessage(request.channelId, request.sourceId);
        if (source) rawMessages = [source];
      }
    } catch {
      return [];
    }
    return rawMessages.map((raw) => normalizeMessage(raw, request)).filter(Boolean);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.type !== REQUEST_TYPE) return;
    const request = event.data;
    window.postMessage({
      source: "discord-claude-extension",
      type: RESPONSE_TYPE,
      requestId: request.requestId,
      messages: readMessages(request),
    }, "*");
  });
})();
