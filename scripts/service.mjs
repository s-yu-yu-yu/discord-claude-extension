// Registers the Bridge for the current login account.
import { runtimeEnvironment } from "../bridge/src/platform.js";
import { runWslService } from "./service-wsl.mjs";
import { copyFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const label = "com.discord-claude-extension.bridge";
const plistPath = path.join(os.homedir(), "Library/LaunchAgents", `${label}.plist`);
const logPath = path.join(os.homedir(), "Library/Logs/claude-bridge.log");
const configPath = path.join(root, "bridge/config.json");
const domain = `gui/${os.userInfo().uid}`;
const command = process.argv[2];

const escapeXml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const plist = () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(path.join(root, "bridge/src/index.js"))}</string>
    <string>--config</string>
    <string>${escapeXml(configPath)}</string>
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(root)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${escapeXml(process.env.PATH)}</string>
    <key>HOME</key><string>${escapeXml(os.homedir())}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(logPath)}</string>
</dict></plist>
`;

const launchctl = (...args) => spawnSync("launchctl", args, { encoding: "utf8" });

if (runtimeEnvironment() === "wsl2") {
  process.exit(await runWslService(command, root));
}
if (process.platform === "win32") {
  if (!["install", "uninstall", "status"].includes(command)) {
    console.error("usage: node scripts/service.mjs install|uninstall|status");
    process.exit(1);
  }
  if (command === "install" && !existsSync(configPath)) {
    console.error("Run node scripts/setup.mjs first, then configure bridge/config.json.");
    process.exit(1);
  }
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", path.join(root, "scripts/service-windows.ps1"), "-Action", command, "-Root", root, "-NodePath", process.execPath], { stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
if (process.platform !== "darwin") {
  console.error("This service helper supports macOS, native Windows, and WSL2 only.");
  process.exit(1);
}
if (command === "install") {
  if (!existsSync(configPath)) copyFileSync(path.join(root, "bridge/config.example.json"), configPath);
  mkdirSync(path.dirname(logPath), { recursive: true });
  mkdirSync(path.dirname(plistPath), { recursive: true });
  launchctl("bootout", `${domain}/${label}`); // restart if already registered
  writeFileSync(plistPath, plist());
  // bootout finishes asynchronously; a bootstrap issued right after it can fail.
  let result;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    result = launchctl("bootstrap", domain, plistPath);
    if (result.status === 0) break;
    spawnSync("sleep", ["0.5"]);
  }
  if (result.status !== 0) { console.error(result.stderr.trim() || `launchctl bootstrap exited with ${result.status}`); process.exit(result.status ?? 1); }
  console.log(`Registered ${label} (log: ${logPath})`);
} else if (command === "uninstall") {
  launchctl("bootout", `${domain}/${label}`);
  if (existsSync(plistPath)) unlinkSync(plistPath);
  console.log(`Removed ${label}`);
} else if (command === "status") {
  const result = launchctl("print", `${domain}/${label}`);
  if (result.status !== 0) { console.log("not registered"); process.exit(0); }
  const line = (key) => result.stdout.split("\n").find((item) => item.trim().startsWith(key))?.trim();
  console.log([line("state"), line("pid"), line("last exit code")].filter(Boolean).join("\n") || result.stdout.slice(0, 400));
} else {
  console.log("usage: node scripts/service.mjs install|uninstall|status");
  process.exit(1);
}
