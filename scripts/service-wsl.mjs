import { registeredProcess, stopWslProcess } from "./wsl-process.mjs";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { psQuote, psEncoded } from "../bridge/src/platform.js";

export function wslServiceScript({ script, action, root, node, distro, user, searchPath, configDir = "" }) {
  const parameters = { Action: action, Root: root, NodePath: node, Distro: distro, LinuxUser: user, SearchPath: searchPath, ClaudeConfigDir: configDir };
  return `& ${psQuote(script)} ${Object.entries(parameters).map(([key, value]) => `-${key} ${psQuote(value)}`).join(" ")}`;
}

export async function runWslService(action, root) {
  if (!["install", "uninstall", "status", "export-extension"].includes(action)) {
    console.error("usage: node scripts/service.mjs install|uninstall|status|export-extension");
    return 1;
  }
  if (action === "install" && !existsSync(path.join(root, "bridge/config.json"))) {
    console.error("Run node scripts/setup.mjs first.");
    return 1;
  }
  const converted = spawnSync("wslpath", ["-w", path.join(root, "scripts/service-wsl.ps1")], { encoding: "utf8" });
  if (converted.status !== 0) { console.error(converted.error?.message || converted.stderr); return 1; }
  const options = { script: converted.stdout.trim(), root, node: process.execPath,
    distro: process.env.WSL_DISTRO_NAME, user: os.userInfo().username, searchPath: process.env.PATH || "",
    configDir: process.env.CLAUDE_CONFIG_DIR || "" };
  const invoke = (nextAction) => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", psEncoded(wslServiceScript({ ...options, action: nextAction }))], { stdio: "inherit" });
  if (action === "install" || action === "uninstall") {
    const stopped = invoke("stop");
    if (stopped.status !== 0) { console.error(stopped.error?.message || "Could not stop the Windows task."); return stopped.status ?? 1; }
    await stopWslProcess();
  }
  if (action === "status") console.log(`Linux Bridge: ${registeredProcess()?.pid || "not running"}`);
  const result = invoke(action);
  if (result.error) console.error(`Windows interop unavailable: ${result.error.message}`);
  return result.status ?? 1;
}
