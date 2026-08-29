function valueOrUnknown(value) {
  return value === undefined || value === null || value === "" ? "（不明）" : String(value);
}

export const SESSION_TITLE_START = "[DCE_SESSION_TITLE]";
export const SESSION_TITLE_END = "[/DCE_SESSION_TITLE]";
const TITLE_INSTRUCTION = `最初に、あなたがこの作業に付ける短いタイトルを ${SESSION_TITLE_START}タイトル${SESSION_TITLE_END} の形式で1行だけ出力してください。タイトルは80文字以内にし、その後に通常の回答を続けてください。マーカー自体は通常の回答へ繰り返しません。`;

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
  else if (attachment.skipped) fields.push("取得しない（動画・音声など大容量メディア）");
  else if (attachment.error) fields.push(`取得失敗: ${attachment.error}`);
  return fields.join(" | ");
}

function hasLocalFile(messages) {
  return messages.some((message) => message?.attachments?.some((attachment) => attachment.localPath));
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
  const additionalContext = context.filter((message) => {
    if (!source || !message) return true;
    return message === source || (message.id && source.id && message.id === source.id) ||
      (message.sourceLink && source.sourceLink && message.sourceLink === source.sourceLink) ? false : true;
  });
  const actionPrompt = action?.prompt?.trim() || "DiscordのSource Messageについて、依頼内容に対応してください。";
  const instructionText = instruction.trim() || "（追加指示なし）";
  return [
    `あなたは Claude Code です。以下の Discord ${contextLabel} を作業コンテキストとして扱ってください。`,
    "各メッセージの Source Link は原文へ戻るためのリンクです。必要に応じて回答や作成物へ記載してください。",
    ...(hasLocalFile([source, ...context])
      ? ["添付ファイルのうち Local file が示されているものは Bridge がダウンロード済みです。Read ツールでそのパスを読んで内容を確認してください。"]
      : []),
    TITLE_INSTRUCTION,
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
    ...(context.length > 1 ? ["", "## Message Context", ...additionalContext.map((message, index) => formatMessage(message, index))] : []),
  ].join("\n");
}

// Follow-up turn that appends newly selected Discord messages to a resumed session.
export function buildContextAppendPrompt({ action, instruction = "", messages = [], sourceMessage }) {
  const context = messages.length > 0 ? messages : [sourceMessage];
  return [
    "以下は同じ Discord 会話から追加で選択された Message Context です。既存の作業コンテキストに加えて扱ってください。各メッセージの Source Link は原文へ戻るためのリンクです。",
    ...(hasLocalFile(context)
      ? ["添付ファイルのうち Local file が示されているものは Bridge がダウンロード済みです。Read ツールでそのパスを読んで内容を確認してください。"]
      : []),
    ...(action?.prompt?.trim() ? ["", "## Action Preset", action.prompt.trim()] : []),
    "",
    "## User instruction",
    instruction.trim() || "（追加指示なし）",
    "",
    "## 追加 Message Context",
    ...context.map((message, index) => formatMessage(message, index)),
  ].join("\n");
}

const HANDOFF_HEADINGS = ["## 調査結果", "## 決定事項", "## Source Link", "## 関連リンク (Jira / GitHub など)", "## 現在判明している問題", "## 次に実行すべき作業"];

// Asked of the General Session (as a fork) to produce the Handoff itself.
export function buildHandoffRequestPrompt({ instruction = "", projectPath }) {
  return [
    `このセッションの作業を、Project \`${projectPath}\` を cwd とする新しい Project Session へ引き継ぎます。`,
    "これまでの会話内容から Handoff を作成してください。出力は Markdown の Handoff のみとし、前置きや補足は書かないでください。",
    `先頭に \`対象 Project: ${projectPath}\` の1行を置き、続けて次の見出しを必ずこの順で使ってください。`,
    ...HANDOFF_HEADINGS,
    "Source Link には Message Context の Discord permalink を、関連リンクには判明している Jira / GitHub の URL を記載し、不明な項目は「（なし）」と書いてください。",
    "",
    "## 移行時の追加指示",
    instruction.trim() || "（なし）",
  ].join("\n");
}

// Initial prompt of the new Project Session.
export function buildHandoffPrompt({ handoff, instruction = "", originalSessionId, projectPath }) {
  return [
    `あなたは Claude Code です。以下は General Session からの Handoff です。この Project（cwd: ${projectPath}）で作業を続けてください。`,
    TITLE_INSTRUCTION,
    "",
    "## Handoff",
    handoff,
    "",
    "## 元セッション",
    `元の General Session は \`claude --resume ${originalSessionId}\` で参照できます。`,
    "",
    "## 移行時の追加指示",
    instruction.trim() || "（なし）",
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
