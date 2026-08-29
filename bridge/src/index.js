import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { startBridge } from "./server.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const configIndex = process.argv.indexOf("--config");
const configPath = configIndex >= 0 ? process.argv[configIndex + 1] : path.resolve(directory, "../config.json");
const config = loadConfig(configPath);
const server = await startBridge(config);

console.log(`Claude Bridge listening on http://${config.host}:${config.port}`);
console.log(`General Workspace: ${config.workspace}`);
if (configPath.endsWith("config.json")) console.log(`Config: ${configPath}`);

const shutdown = () => server.close(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
