function valueOrUnknown(value) {
  return value === undefined || value === null || value === "" ? "（不明）" : String(value);
}

export const SESSION_TITLE_START = "[DCE_SESSION_TITLE]";
export const SESSION_TITLE_END = "[/DCE_SESSION_TITLE]";
// The Bridge strips this marker from the stream and uses it as the Side Panel title.
const TITLE_INSTRUCTION = `回答の1行目に、この作業の短いタイトル（80文字以内）を ${SESSION_TITLE_START}タイトル${SESSION_TITLE_END} の形式で出力してください。`;

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
  if (attachment.localPath) fields.push(`Local file: ${attachment.localPath}`);
  else if (attachment.skipped) fields.push("未取得（大容量メディア）");
  else if (attachment.error) fields.push(`取得失敗: ${attachment.error}`);
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

// "## 依頼" = Action Preset prompt + free-form instruction; only what the user actually provided.
function requestSection(action, instruction, fallback) {
  const parts = [action?.prompt?.trim(), instruction.trim()].filter(Boolean);
  return ["## 依頼", ...(parts.length > 0 ? parts : [fallback])];
}

export function buildPrompt({ action, instruction = "", sourceMessage, messageContext = [] }) {
  const context = messageContext.length > 0 ? messageContext : [sourceMessage];
  const source = sourceMessage || context[0];
  const additionalContext = context.filter((message) => {
    if (!source || !message) return true;
    return message === source || (message.id && source.id && message.id === source.id) ||
      (message.sourceLink && source.sourceLink && message.sourceLink === source.sourceLink) ? false : true;
  });
  return [
    TITLE_INSTRUCTION,
    "",
    ...requestSection(action, instruction, "Source Message に対応してください。"),
    "",
    "## Source Message",
    formatMessage(source, 0),
    ...(additionalContext.length > 0 ? ["", "## Message Context", ...additionalContext.map((message, index) => formatMessage(message, index))] : []),
  ].join("\n");
}

// Follow-up turn that appends newly selected Discord messages to a resumed session.
export function buildContextAppendPrompt({ action, instruction = "", messages = [], sourceMessage }) {
  const context = messages.length > 0 ? messages : [sourceMessage];
  return [
    ...requestSection(action, instruction, "追加分を踏まえて作業を続けてください。"),
    "",
    "## 追加 Message Context",
    ...context.map((message, index) => formatMessage(message, index)),
  ].join("\n");
}

const HANDOFF_HEADINGS = ["## 調査結果", "## 決定事項", "## Source Link", "## 関連リンク (Jira / GitHub など)", "## 現在判明している問題", "## 次に実行すべき作業"];

// Asked of the General Session (as a fork) to produce the Handoff itself.
export function buildHandoffRequestPrompt({ instruction = "", projectPath }) {
  return [
    `この作業を Project \`${projectPath}\` の新しいセッションへ引き継ぎます。これまでの会話から Handoff を Markdown で作成してください。出力は Handoff 本体のみ。`,
    `先頭に \`対象 Project: ${projectPath}\` の1行、続けて次の見出しをこの順で使ってください。`,
    ...HANDOFF_HEADINGS,
    "Source Link には関連する Discord permalink、関連リンクには判明している Jira / GitHub の URL を書き、不明な項目は「（なし）」とします。",
    ...(instruction.trim() ? ["", "## 移行時の追加指示", instruction.trim()] : []),
  ].join("\n");
}

// Initial prompt of the new Project Session.
export function buildHandoffPrompt({ handoff, instruction = "", originalSessionId }) {
  return [
    TITLE_INSTRUCTION,
    "",
    `General Session からの Handoff を受けて、この Project で作業を続けてください。元セッション: \`claude --resume ${originalSessionId}\``,
    "",
    "## Handoff",
    handoff,
    ...(instruction.trim() ? ["", "## 追加指示", instruction.trim()] : []),
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
