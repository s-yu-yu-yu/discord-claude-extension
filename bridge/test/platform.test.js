import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claudeProjectDirectory } from "../src/config.js";
import { cliInvocation, resumeCommand, terminalInvocation } from "../src/platform.js";
import { createClaudeRunner } from "../src/claude-runner.js";

test("Claude project keys encode Windows drive letters and punctuation", () => {
  assert.equal(path.basename(claudeProjectDirectory('C:\\Users\\Alice Smith\\my_repo', '/data')), 'C--Users-Alice-Smith-my-repo');
  assert.equal(path.basename(claudeProjectDirectory('/Users/me/my.repo', '/data')), '-Users-me-my-repo');
});

test("Windows resume survives spaces, apostrophes, and shell metacharacters", () => {
  const command = resumeCommand("C:\\Users\\O'Brien & $dev", "id", "C:\\Program Files\\Claude\\claude.exe", "win32");
  assert.equal(command, "Set-Location -LiteralPath 'C:\\Users\\O''Brien & $dev'; if ($?) { & 'C:\\Program Files\\Claude\\claude.exe' --resume 'id' }");
  const launch = terminalInvocation("auto", command, "win32");
  assert.equal(launch.executable, 'powershell.exe');
  assert.equal(Buffer.from(launch.args.at(-1), 'base64').toString('utf16le'), command);
  assert.throws(() => cliInvocation('claude.cmd', [], 'win32'), /native Claude/);
});

test("macOS default terminal passes AppleScript directly without a shell", () => {
  const command = resumeCommand("/Users/O'Brien/$work", "id");
  const invocation = terminalInvocation('auto', command, 'darwin');
  assert.equal(invocation.executable, 'osascript');
  assert.match(invocation.args[1], /O'Brien/);
});

test("runner sends large Unicode prompts over stdin without shell interpretation", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bridge stdin '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'fake.mjs');
  await writeFile(file, `let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => input += c); process.stdin.on('end', () => console.log(JSON.stringify({ type: 'assistant', message: { content: input } })));`);
  const prompt = '日本語 & " %PATH% $()\n'.repeat(5000);
  const result = await createClaudeRunner({ claudeCommand: file }).run({ prompt, cwd: dir, resumeId: 'test', onEvent() {} });
  assert.equal(result.text, prompt);
});
