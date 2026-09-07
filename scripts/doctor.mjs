import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../bridge/src/config.js";
import { cliInvocation, runtimeEnvironment, psEncoded } from "../bridge/src/platform.js";
let failed = false;
const check = (ok, message) => { console.log(`${ok ? "OK" : "FAIL"}: ${message}`); if (!ok) failed = true; };
const environment = runtimeEnvironment();
console.log(`Environment: ${environment}${environment === "wsl2" ? ` (${process.env.WSL_DISTRO_NAME})` : ""}`);
check(Number(process.versions.node.split(".")[0]) >= 22, `Node ${process.version} (22+)`);
const configPath = fileURLToPath(new URL("../bridge/config.json", import.meta.url));
check(existsSync(configPath), "bridge/config.json (create with node scripts/setup.mjs)");
try {
  const config = loadConfig(configPath);
  check(existsSync(config.workspace), `Workspace: ${config.workspace}`);
  const invocation = cliInvocation(config.claudeCommand, ["--version"]);
  const cli = spawnSync(invocation.executable, invocation.args, { encoding: "utf8", timeout: 15000, windowsHide: true });
  check(cli.status === 0, `Claude CLI: ${(cli.stdout || cli.stderr || cli.error?.message || "not found").trim()}`);
  if (environment === "wsl2") {
    const interop = spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", psEncoded("[Console]::WriteLine('Windows interop OK')")], { encoding: "utf8", timeout: 10000 });
    console.log(`${interop.status === 0 ? "OK" : "INFO"}: Windows interop ${interop.status === 0 ? "available" : "unavailable (automatic setup/terminal opening needs interop)"}`);
    console.log("Verify the Bridge URL from Windows Chrome as well; Linux health alone does not verify localhost forwarding.");
  }
  console.log("Login/tool permissions: check interactively by running claude in the workspace.");
  try {
    const response = await fetch(`http://${config.host}:${config.port}/health`, { signal: AbortSignal.timeout(2000) });
    const body = await response.json();
    check(response.ok && body.service === "claude-bridge", "Bridge health");
  } catch { console.log("INFO: Bridge is not reachable. Start with npm run bridge:start."); }
} catch (error) { check(false, error.message); }
if (failed) process.exitCode = 1;
