import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function claudeExecutable(command = "claude", platform = process.platform) {
  if (platform !== "win32" || command !== "claude") return command;
  const native = path.join(os.homedir(), ".local", "bin", "claude.exe");
  return existsSync(native) ? native : "claude.exe";
}

export function cliInvocation(command, args, platform = process.platform) {
  const executable = claudeExecutable(command, platform);
  if (platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    throw new Error("Windows requires native Claude Code (claude.exe); .cmd/.bat launchers are not supported.");
  }
  // Explicit JS wrappers also make integration fixtures portable without a shell.
  return /\.m?js$/i.test(executable)
    ? { executable: process.execPath, args: [executable, ...args] }
    : { executable, args };
}

const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;
const shQuote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;
export function resumeCommand(cwd, sessionId, command = "claude", platform = process.platform) {
  if (platform === "win32") {
    return `Set-Location -LiteralPath ${psQuote(cwd)}; if ($?) { & ${psQuote(claudeExecutable(command, platform))} --resume ${psQuote(sessionId)} }`;
  }
  return `cd "${cwd.replace(/(["\\$`])/g, "\\$1")}" && ${command === "claude" ? "claude" : shQuote(command)} --resume ${sessionId}`;
}

export function terminalInvocation(template, command, platform = process.platform) {
  if (template === "auto") {
    if (platform === "win32") return {
      executable: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-NoExit", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")],
    };
    if (platform === "darwin") return {
      executable: "osascript",
      args: ["-e", `tell application "Terminal" to do script "${command.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`, "-e", 'tell application "Terminal" to activate'],
    };
    throw new Error("No default terminal on this platform.");
  }
  const expanded = template.replace("{command}", platform === "win32" ? command : command.replace(/\\/g, "\\\\").replace(/"/g, '\\"'));
  return platform === "win32"
    ? { executable: "powershell.exe", args: ["-NoProfile", "-Command", expanded] }
    : { executable: "/bin/sh", args: ["-c", expanded] };
}

export function launchTerminal(template, command) {
  const invocation = terminalInvocation(template, command);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.executable, invocation.args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}
