import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const name = `discord-claude-extension-${pkg.version}`;
const output = path.join(root, "dist", name);
const archive = path.join(root, "dist", `${name}.zip`);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
// An allowlist keeps config.json, credentials, session history, and local files out.
const files = ["package.json", "README.md", "bridge/config.example.json",
  "docs/setup-wsl2.md", "docs/setup.md", "docs/ai-setup.md", "docs/distribution.md", "docs/usage.md",
  "scripts/setup.mjs", "scripts/doctor.mjs", "scripts/service.mjs",
  "scripts/wsl-process.mjs", "scripts/wsl-bridge.mjs", "scripts/service-wsl.mjs", "scripts/service-wsl.ps1", "scripts/run-wsl-bridge.ps1",
  "scripts/service-windows.ps1", "scripts/run-bridge.ps1"];
for (const directory of ["bridge/src", "extension"]) {
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    if (entry.isFile() && /\.(js|json|html|css|svg)$/.test(entry.name)) files.push(`${directory}/${entry.name}`);
  }
}
for (const file of files) {
  mkdirSync(path.dirname(path.join(output, file)), { recursive: true });
  cpSync(path.join(root, file), path.join(output, file));
}
// Distribution has runtime commands only; development commands require the checkout.
const runtime = { ...pkg, scripts: Object.fromEntries(Object.entries(pkg.scripts).filter(([key]) => key.startsWith("bridge:"))) };
writeFileSync(path.join(output, "package.json"), JSON.stringify(runtime, null, 2) + "\n");
const hashes = files.sort().map((file) => `${createHash("sha256").update(readFileSync(path.join(output, file))).digest("hex")}  ${file}`);
writeFileSync(path.join(output, "SHA256SUMS.txt"), hashes.join("\n") + "\n");
rmSync(archive, { force: true });
const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;
const script = `Compress-Archive -LiteralPath ${psQuote(output)} -DestinationPath ${psQuote(archive)} -Force`;
const result = process.platform === "win32"
  ? spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { stdio: "inherit" })
  : spawnSync("zip", ["-q", "-r", archive, name], { cwd: path.dirname(output), stdio: "inherit" });
if (result.status !== 0) throw result.error || new Error(`Archive creation failed (${result.status}). macOS/Linux requires zip.`);
const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(`${archive}.sha256`, `${digest}  ${path.basename(archive)}\n`);
console.log(`Distribution: ${archive}\nSHA256: ${digest}`);
