import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const directory = fileURLToPath(new URL("../bridge/test/", import.meta.url));
const files = readdirSync(directory).filter((name) => name.endsWith(".test.js")).sort();
if (!files.length) throw new Error("No test files found.");
const result = spawnSync(process.execPath, ["--test", ...files], { cwd: directory, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
