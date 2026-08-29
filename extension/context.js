function messageId(message) {
  return typeof message?.id === "string" && message.id ? message.id : "";
}

function parentId(message) {
  return typeof message?.replyTo === "string" && message.replyTo ? message.replyTo : "";
}

function uniqueMessages(messages) {
  const seen = new Set();
  return messages.filter((message) => {
    const id = messageId(message);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function compareMessageTime(left, right) {
  const leftId = messageId(left);
  const rightId = messageId(right);
  const numericId = /^\d+$/;
  if (numericId.test(leftId) && numericId.test(rightId)) {
    if (leftId.length !== rightId.length) return leftId.length - rightId.length;
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  }
  const leftTime = Date.parse(left?.timestamp || "");
  const rightTime = Date.parse(right?.timestamp || "");
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return 0;
}

function sortMessages(messages) {
  return uniqueMessages(messages).sort(compareMessageTime);
}

function mergeMessages(primary, fallback = []) {
  const merged = new Map();
  for (const message of fallback) {
    const id = messageId(message);
    if (id) merged.set(id, { ...message });
  }
  for (const message of primary) {
    const id = messageId(message);
    if (!id) continue;
    const existing = merged.get(id);
    // DOM data wins, while cache-only fields such as message_reference fill
    // in details that Discord did not render for the current virtualized row.
    // Cache attachments carry mimeType/size that the DOM cannot provide.
    const combined = { ...existing, ...message, replyTo: message.replyTo || existing?.replyTo };
    if (existing?.attachments?.length) combined.attachments = existing.attachments;
    merged.set(id, combined);
  }
  return sortMessages([...merged.values()]);
}

function selectReplyChain(sourceId, messages) {
  const available = uniqueMessages(messages);
  const byId = new Map(available.map((message) => [messageId(message), message]));
  const source = byId.get(sourceId);
  if (!source) {
    return { messages: [], missingRanges: [{ direction: "source", messageId: sourceId }], warning: false };
  }

  const ancestors = [];
  const visited = new Set([sourceId]);
  let current = source;
  const missingRanges = [];
  while (parentId(current)) {
    const parent = byId.get(parentId(current));
    if (!parent) {
      missingRanges.push({ direction: "earlier", from: parentId(current), to: "root" });
      break;
    }
    if (visited.has(messageId(parent))) break;
    visited.add(messageId(parent));
    ancestors.push(parent);
    current = parent;
  }

  const selected = [...ancestors.reverse(), source];
  const selectedIds = new Set(selected.map(messageId));
  const descendants = [];
  const queue = [sourceId];
  while (queue.length > 0) {
    const ancestorId = queue.shift();
    for (const message of available) {
      const id = messageId(message);
      if (selectedIds.has(id) || descendants.some((item) => messageId(item) === id)) continue;
      if (parentId(message) !== ancestorId) continue;
      descendants.push(message);
      queue.push(id);
    }
  }

  const chain = [...selected, ...descendants];
  return {
    messages: chain,
    missingRanges,
    warning: chain.length >= 20,
  };
}

function takeNeighborMessages(messages, contextMessages, direction, count = 5, excludeIds = new Set()) {
  const available = uniqueMessages(messages);
  const contextIds = new Set(contextMessages.map(messageId));
  const indexes = available
    .map((message, index) => ({ id: messageId(message), index }))
    .filter(({ id }) => contextIds.has(id))
    .map(({ index }) => index);
  if (indexes.length === 0) return [];
  const start = direction === "earlier" ? Math.min(...indexes) - 1 : Math.max(...indexes) + 1;
  const step = direction === "earlier" ? -1 : 1;
  const result = [];
  for (let index = start; index >= 0 && index < available.length && result.length < count; index += step) {
    const message = available[index];
    if (!contextIds.has(messageId(message)) && !excludeIds.has(messageId(message))) result.push(message);
  }
  if (direction === "earlier") result.reverse();
  return result;
}

function contextWarning(messages) {
  return messages.length >= 20 ? "返信チェーンに" + messages.length + "件のメッセージが含まれています。" : "";
}

globalThis.DceContext = { contextWarning, mergeMessages, selectReplyChain, takeNeighborMessages, sortMessages };
