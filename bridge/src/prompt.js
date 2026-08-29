function valueOrUnknown(value) {
  return value === undefined || value === null || value === "" ? "（不明）" : String(value);
}

function formatAttachment(attachment) {
  const fields = [attachment.name, attachment.mimeType, attachment.size ? `${attachment.size} bytes` : null, attachment.url]
    .filter(Boolean);
  return fields.join(" | ");
}

export function formatMessage(message, index) {
  const lines = [
    `### ${index + 1}. ${valueOrUnknown(message.author)} (${valueOrUnknown(message.timestamp)})`,
    `Channel: ${valueOrUnknown(message.channel?.name || message.channel)}`,
    `Source Link: ${valueOrUnknown(message.sourceLink)}`,
    "",
    valueOrUnknown(message.text),
  ];
  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    lines.push("", "Attachments:", ...message.attachments.map((attachment) => `- ${formatAttachment(attachment)}`));
  }
  return lines.join("\n");
}

export function buildPrompt({ action, instruction = "", sourceMessage, messageContext = [] }) {
  const context = messageContext.length > 0 ? messageContext : [sourceMessage];
  const source = sourceMessage || context[0];
  const actionPrompt = action?.prompt?.trim() || "DiscordのSource Messageについて、依頼内容に対応してください。";
  const instructionText = instruction.trim() || "（追加指示なし）";
  return [
    "あなたは Claude Code です。以下の Discord Source Message と Message Context を作業コンテキストとして扱ってください。",
    "各メッセージの Source Link は原文へ戻るためのリンクです。必要に応じて回答や作成物へ記載してください。",
    "",
    "## Action Preset",
    actionPrompt,
    "",
    "## User instruction",
    instructionText,
    "",
    "## Source Message",
    formatMessage(source, 0),
    "",
    "## Message Context",
    ...context.map((message, index) => formatMessage(message, index)),
  ].join("\n");
}

export function validateSessionRequest(body) {
  if (!body || typeof body !== "object") return "Request body must be an object.";
  if (!body.sourceMessage || typeof body.sourceMessage !== "object") return "sourceMessage is required.";
  if (typeof body.sourceMessage.text !== "string") return "sourceMessage.text is required.";
  if (!body.sourceMessage.sourceLink) return "sourceMessage.sourceLink is required.";
  if (body.instruction !== undefined && typeof body.instruction !== "string") return "instruction must be a string.";
  if (body.messageContext !== undefined && !Array.isArray(body.messageContext)) return "messageContext must be an array.";
  return null;
}
