// Registers the Bridge as a macOS LaunchAgent so it runs in the background at login.
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

if (process.platform !== "darwin") {
  console.error("This service helper supports macOS (launchd) only.");
  process.exit(1);
}
if (command === "install") {
  if (!existsSync(configPath)) copyFileSync(path.join(root, "bridge/config.example.json"), configPath);
  mkdirSync(path.dirname(plistPath), { recursive: true });
  launchctl("bootout", `${domain}/${label}`); // restart if already registered
  writeFileSync(plistPath, plist());
  const result = launchctl("bootstrap", domain, plistPath);
  if (result.status !== 0) { console.error(result.stderr.trim()); process.exit(result.status ?? 1); }
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
