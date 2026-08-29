import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const jsFiles = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) jsFiles.push(path);
  }
}

await visit(root);
let failed = false;
for (const path of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`${relative(root, path)}\n${result.stderr}`);
  }
}

const manifestPath = join(root, "extension", "manifest.json");
if (!existsSync(manifestPath)) {
  failed = true;
  process.stderr.write("extension/manifest.json is missing\n");
} else {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const required of ["manifest_version", "background", "content_scripts", "side_panel"]) {
      if (!(required in manifest)) throw new Error(`manifest field missing: ${required}`);
    }
  } catch (error) {
    failed = true;
    process.stderr.write(`Invalid extension manifest: ${error.message}\n`);
  }
}

if (process.argv.includes("--typecheck")) {
  console.log("No TypeScript sources; JavaScript syntax and manifest checks completed.");
} else {
  console.log(`Checked ${jsFiles.length} JavaScript files.`);
}
if (failed) process.exitCode = 1;
