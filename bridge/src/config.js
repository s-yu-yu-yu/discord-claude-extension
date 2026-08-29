import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_ACTIONS = [
  {
    id: "research",
    label: "調査",
    prompt: "Discordの内容について必要な調査を行い、根拠と次のアクションを整理してください。",
  },
  {
    id: "summarize",
    label: "要約",
    prompt: "Discordの内容を要約し、重要な論点と未決事項を整理してください。",
  },
  {
    id: "critique",
    label: "批評",
    prompt: "Discordの提案や議論を批評し、前提、リスク、改善案を整理してください。",
  },
];

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

  return {
    host: typeof input.host === "string" && input.host ? input.host : "127.0.0.1",
    port: Number.isInteger(input.port) && input.port > 0 ? input.port : 3456,
    workspace: expandHome(input.workspace) || path.join(os.homedir(), "claude-discord-workspace"),
    claudeCommand: typeof input.claudeCommand === "string" && input.claudeCommand ? input.claudeCommand : "claude",
    projectRoots: Array.isArray(input.projectRoots)
      ? input.projectRoots
          .filter((root) => root && typeof root.path === "string")
          .map((root) => ({ path: expandHome(root.path), depth: Number.isInteger(root.depth) ? root.depth : undefined }))
      : [],
    projectDepth: Number.isInteger(input.projectDepth) && input.projectDepth >= 0 ? input.projectDepth : 2,
    actions,
  };
}

export function loadConfig(filePath) {
  if (!filePath || !existsSync(filePath)) return normalizeConfig();
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
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
