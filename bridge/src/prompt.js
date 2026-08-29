function valueOrUnknown(value) {
  return value === undefined || value === null || value === "" ? "（不明）" : String(value);
}

export const SESSION_TITLE_START = "[DCE_SESSION_TITLE]";
export const SESSION_TITLE_END = "[/DCE_SESSION_TITLE]";

export function extractSessionTitle(text) {
  const match = String(text || "").match(/\[DCE_SESSION_TITLE\]\s*([\s\S]*?)\s*\[\/DCE_SESSION_TITLE\]/i);
  if (!match) return null;
  const title = match[1].replace(/\s+/g, " ").trim().slice(0, 80);
  return title ? { title, start: match.index, end: match.index + match[0].length } : null;
}

export function stripSessionTitle(text) {
  return String(text || "").replace(/\[DCE_SESSION_TITLE\]\s*[\s\S]*?\s*\[\/DCE_SESSION_TITLE\]/i, "").replace(/^\s+/, "");
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
  const contextLabel = context.length > 1 ? "Source Message と Message Context" : "Source Message";
  const actionPrompt = action?.prompt?.trim() || "DiscordのSource Messageについて、依頼内容に対応してください。";
  const instructionText = instruction.trim() || "（追加指示なし）";
  return [
    `あなたは Claude Code です。以下の Discord ${contextLabel} を作業コンテキストとして扱ってください。`,
    "各メッセージの Source Link は原文へ戻るためのリンクです。必要に応じて回答や作成物へ記載してください。",
    `最初に、あなたがこの作業に付ける短いタイトルを ${SESSION_TITLE_START}タイトル${SESSION_TITLE_END} の形式で1行だけ出力してください。タイトルは80文字以内にし、その後に通常の回答を続けてください。マーカー自体は通常の回答へ繰り返しません。`,
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
    ...(context.length > 1 ? ["", "## Message Context", ...context.map((message, index) => formatMessage(message, index))] : []),
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
