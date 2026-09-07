import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runtimeEnvironment } from "./platform.js";
import { extractSessionTitle } from "./prompt.js";

export const DEFAULT_ACTIONS = [
  {
    id: "jira",
    label: "Jiraに起票",
    prompt: "Discordの会話をもとにJiraチケットを作成してください。元Discord投稿のSource Linkをチケット本文へ記載してください。",
  },
  {
    id: "github-issue",
    label: "GitHub Issue化",
    prompt: "Discordの会話をもとにGitHub Issueを作成してください。元Discord投稿のSource LinkをIssue本文へ記載してください。",
  },
  {
    id: "summarize",
    label: "要約",
    prompt: "Discordの内容を要約し、重要な論点と未決事項を整理してください。",
  },
  {
    id: "research",
    label: "調査",
    prompt: "Discordの内容について必要な調査を行い、根拠と次のアクションを整理してください。",
  },
  {
    id: "critique",
    label: "批評",
    prompt: "Discordの提案や議論を批評し、前提、リスク、改善案を整理してください。",
  },
  {
    id: "freeform",
    label: "自由入力",
    prompt: "",
  },
];

const DEFAULT_TERMINAL_COMMAND = ["darwin", "win32", "wsl2"].includes(runtimeEnvironment()) ? "auto" : "";

function expandHome(value) {
  if (typeof value !== "string") return value;
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

export function normalizeConfig(input = {}) {
  const actions = Array.isArray(input.actions) && input.actions.length > 0
    ? input.actions
        .filter((action) => action && typeof action.id === "string" && typeof action.label === "string")
        .map((action) => ({
          id: action.id,
          label: action.label,
          prompt: typeof action.prompt === "string" ? action.prompt : "",
        }))
    : DEFAULT_ACTIONS;

  const claudeConfigDir = typeof input.claudeConfigDir === "string" && input.claudeConfigDir.trim()
    ? expandHome(input.claudeConfigDir.trim())
    : undefined;

  return {
    host: typeof input.host === "string" && input.host ? input.host : "127.0.0.1",
    port: Number.isInteger(input.port) && input.port > 0 ? input.port : 3456,
    workspace: expandHome(input.workspace) || path.join(os.homedir(), "claude-discord-workspace"),
    claudeConfigDir,
    claudeCommand: typeof input.claudeCommand === "string" && input.claudeCommand ? input.claudeCommand : "claude",
    // "" disables the flag so the CLI falls back to the user's Claude Code default.
    claudeModel: typeof input.claudeModel === "string" ? input.claudeModel : "opus",
    claudeEffort: typeof input.claudeEffort === "string" ? input.claudeEffort : "high",
    // -p cannot show permission prompts; auto mode lets Claude decide like the interactive CLI.
    permissionMode: typeof input.permissionMode === "string" ? input.permissionMode : "auto",
    terminalCommand: typeof input.terminalCommand === "string" ? input.terminalCommand : DEFAULT_TERMINAL_COMMAND,
    projectRoots: Array.isArray(input.projectRoots)
      ? input.projectRoots
          .filter((root) => root && typeof root.path === "string")
          .map((root) => ({ path: expandHome(root.path), depth: Number.isInteger(root.depth) ? root.depth : undefined }))
      : [],
    projectDepth: Number.isInteger(input.projectDepth) && input.projectDepth >= 0 ? input.projectDepth : 2,
    attachmentsDir: expandHome(input.attachmentsDir) || path.join(os.tmpdir(), "claude-bridge-attachments"),
    attachmentMaxBytes: Number.isInteger(input.attachmentMaxBytes) && input.attachmentMaxBytes > 0 ? input.attachmentMaxBytes : 20 * 1024 * 1024,
    actions,
  };
}

export function loadConfig(filePath) {
  if (!filePath || !existsSync(filePath)) return normalizeConfig();
  const raw = JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  return normalizeConfig(raw);
}

function isGitDirectory(directory) {
  return existsSync(path.join(directory, ".git"));
}

function walkProjects(root, maxDepth, currentDepth = 0, result = []) {
  if (isGitDirectory(root)) {
    result.push({ id: root, label: path.basename(root), path: root });
    return result;
  }
  if (currentDepth >= maxDepth || !existsSync(root)) return result;
  let children = [];
  try {
    children = readdirSafe(root);
  } catch {
    return result;
  }
  for (const child of children) {
    if (child.startsWith(".")) continue;
    walkProjects(path.join(root, child), maxDepth, currentDepth + 1, result);
  }
  return result;
}

function readdirSafe(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

export function listProjects(config) {
  return config.projectRoots.flatMap((root) => walkProjects(root.path, root.depth ?? config.projectDepth));
}

function defaultClaudeConfigDir() {
  return expandHome(process.env.CLAUDE_CONFIG_DIR) || path.join(os.homedir(), ".claude");
}

// Claude Code 2.1.251 stores resumable sessions as <session-id>.jsonl under a
// project directory whose name is the cwd with non-alphanumerics replaced by '-'.
export function claudeProjectDirectory(cwd, claudeConfigDir) {
  const configDir = claudeConfigDir || defaultClaudeConfigDir();
  return path.join(configDir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
}

function validSessionId(sessionId) {
  return typeof sessionId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part && typeof part.text === "string").map((part) => part.text).join("");
}

export function readClaudeSessionMetadata(cwd, sessionId, claudeConfigDir) {
  if (!validSessionId(sessionId)) return { exists: false };
  const file = path.join(claudeProjectDirectory(cwd, claudeConfigDir), sessionId + ".jsonl");
  if (!existsSync(file)) return { exists: false };
  let slug;
  let generatedTitle;
  let firstUserText;
  let updatedAt;
  try {
    updatedAt = statSync(file).mtimeMs;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      slug ||= entry.slug;
      const content = contentText(entry.message?.content || entry.message);
      if (!firstUserText && entry.type === "user") firstUserText = content;
      // The initial user prompt contains the marker syntax as an example.
      // Only assistant output is eligible to become a generated title.
      if (entry.type === "assistant") {
        generatedTitle ||= extractSessionTitle(content)?.title;
        generatedTitle ||= extractSessionTitle(contentText(entry.content))?.title;
      }
    }
  } catch {
    return { exists: false };
  }
  return {
    exists: true,
    sessionId,
    cwd,
    // The marker is the Bridge's generated-title contract. Claude's `slug`
    // field is retained only as a compatibility fallback for older sessions.
    title: generatedTitle || slug || firstUserText?.replace(/\s+/g, " ").trim().slice(0, 48) || `Claude Session ${sessionId.slice(0, 8)}`,
    updatedAt,
  };
}

export function isConfiguredCwd(config, cwd) {
  if (cwd === config.workspace) return true;
  return listProjects(config).some((project) => project.path === cwd);
}
