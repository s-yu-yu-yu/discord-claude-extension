import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(root, "../extension");
const output = path.join(root, "../dist/extension");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(source, output, { recursive: true });
console.log(`Built Chrome extension at ${path.relative(path.join(root, ".."), output)}`);
