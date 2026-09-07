import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function runtimeEnvironment(platform = process.platform, release = os.release(), env = process.env) {
  if (platform === "linux" && /microsoft-standard|wsl2/i.test(release) && env.WSL_DISTRO_NAME) return "wsl2";
  return platform;
}

export const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;
export const psEncoded = (script) => Buffer.from(script, "utf16le").toString("base64");

export function claudeExecutable(command = "claude", platform = runtimeEnvironment()) {
  if (platform === "wsl2" && command === "claude") {
    const native = path.join(os.homedir(), ".local", "bin", "claude");
    return existsSync(native) ? native : command;
  }
  if (platform !== "win32" || command !== "claude") return command;
  const native = path.join(os.homedir(), ".local", "bin", "claude.exe");
  return existsSync(native) ? native : "claude.exe";
}

export function cliInvocation(command, args, platform = runtimeEnvironment()) {
  const executable = claudeExecutable(command, platform);
  if (platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    throw new Error("Windows requires native Claude Code (claude.exe); .cmd/.bat launchers are not supported.");
  }
  if (platform === "wsl2" && /\.(exe|cmd|bat)$/i.test(executable)) {
    throw new Error("WSL2 requires Linux Claude Code, not a Windows executable.");
  }
  // Explicit JS wrappers also make integration fixtures portable without a shell.
  return /\.m?js$/i.test(executable)
    ? { executable: process.execPath, args: [executable, ...args] }
    : { executable, args };
}

const shQuote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;
export function resumeCommand(cwd, sessionId, command = "claude", platform = process.platform, configDir) {
  if (platform === "win32") {
    return `Set-Location -LiteralPath ${psQuote(cwd)}; if ($?) { ${configDir ? `$env:CLAUDE_CONFIG_DIR=${psQuote(configDir)}; ` : ""}& ${psQuote(claudeExecutable(command, platform))} --resume ${psQuote(sessionId)} }`;
  }
  return `cd "${cwd.replace(/(["\\$`])/g, "\\$1")}" && ${configDir ? `CLAUDE_CONFIG_DIR=${shQuote(configDir)} ` : ""}${command === "claude" ? "claude" : shQuote(command)} --resume ${sessionId}`;
}

// Windows CreateProcess argument quoting, including embedded quotes and trailing slashes.
export function windowsArgument(value) {
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
}

export function terminalInvocation(template, command, platform = runtimeEnvironment(), env = process.env, username = os.userInfo().username) {
  if (template === "auto") {
    if (platform === "wsl2") {
      if (!env.WSL_DISTRO_NAME) throw new Error("WSL_DISTRO_NAME is required to resume in the correct distribution.");
      const args = ["--distribution", env.WSL_DISTRO_NAME, "--user", username, "--exec", "/bin/sh", "-lc", command];
      const resume = `Start-Process wsl.exe -ArgumentList ${psQuote(args.map(windowsArgument).join(" "))} -NoNewWindow -Wait`;
      return {
        executable: "powershell.exe",
        args: ["-NoProfile", "-EncodedCommand", psEncoded(`Start-Process powershell.exe -ArgumentList '-NoLogo','-NoProfile','-NoExit','-EncodedCommand','${psEncoded(resume)}'`)],
      };
    }
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
