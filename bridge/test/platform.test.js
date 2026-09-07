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
  const command = resumeCommand("/Users/O'Brien/$work", "id", "claude", "darwin");
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

test("WSL2 detection does not enable Windows interop on WSL1 or ordinary Linux", async () => {
  const { runtimeEnvironment } = await import('../src/platform.js');
  assert.equal(runtimeEnvironment('linux', '6.6.87.2-microsoft-standard-WSL2', { WSL_DISTRO_NAME: 'Ubuntu' }), 'wsl2');
  assert.equal(runtimeEnvironment('linux', '4.4.0-Microsoft', { WSL_DISTRO_NAME: 'Ubuntu' }), 'linux');
  assert.equal(runtimeEnvironment('linux', '6.8.0-generic', {}), 'linux');
  assert.equal(runtimeEnvironment('darwin', '24.0.0', {}), 'darwin');
  assert.equal(runtimeEnvironment('win32', '10.0.0', {}), 'win32');
  assert.throws(() => cliInvocation('C:/Users/me/claude.exe', [], 'wsl2'), /Linux Claude Code/);
});

test("WSL2 resume pins distribution and user and protects the Linux command", async () => {
  const { windowsArgument, psQuote } = await import('../src/platform.js');
  const command = resumeCommand('/home/dev/日本語 "quoted" & $work', 'session-id', '/home/dev/.local/bin/claude', 'linux');
  const invocation = terminalInvocation('auto', command, 'wsl2', { WSL_DISTRO_NAME: "Ubuntu Work's" }, 'dev');
  assert.equal(invocation.executable, 'powershell.exe');
  const outer = Buffer.from(invocation.args.at(-1), 'base64').toString('utf16le');
  const encoded = outer.match(/'([A-Za-z0-9+/=]+)'$/)[1];
  const inner = Buffer.from(encoded, 'base64').toString('utf16le');
  const args = ['--distribution', "Ubuntu Work's", '--user', 'dev', '--exec', '/bin/sh', '-lc', command];
  assert.equal(inner, `Start-Process wsl.exe -ArgumentList ${psQuote(args.map(windowsArgument).join(' '))} -NoNewWindow -Wait`);
  assert.equal(windowsArgument('a"b'), '"a\\"b"');
  assert.equal(windowsArgument('C:\\end\\'), '"C:\\end\\\\"');
  assert.throws(() => terminalInvocation('auto', command, 'wsl2', {}, 'dev'), /WSL_DISTRO_NAME/);
});

test("WSL service registration quotes installation paths without shell interpolation", async () => {
  const { wslServiceScript } = await import('../../scripts/service-wsl.mjs');
  const script = wslServiceScript({ script: "\\\\wsl.localhost\\Ubuntu\\home\\dev\\service.ps1", action: 'install', root: "/home/dev/O'Brien 日本語", node: '/home/dev/.nvm/bin/node', distro: 'Ubuntu', user: 'dev', searchPath: '/bin:/path with space' });
  assert.ok(script.includes("-Root '/home/dev/O''Brien 日本語'"));
  assert.ok(script.includes("-Distro 'Ubuntu' -LinuxUser 'dev'"));
  assert.ok(script.includes("-SearchPath '/bin:/path with space'"));
});

test("terminal resume retains the configured Claude settings root", () => {
  assert.ok(resumeCommand('/work', 'id', 'claude', 'linux', "/home/dev/config's").includes("CLAUDE_CONFIG_DIR='/home/dev/config'\\''s'"));
  assert.ok(resumeCommand('C:/work', 'id', 'claude', 'win32', "C:/config's").includes("$env:CLAUDE_CONFIG_DIR='C:/config''s';"));
});

test("Windows native argument quoting round-trips Linux shell syntax", { skip: process.platform !== 'win32' }, async (t) => {
  const { spawnSync } = await import('node:child_process');
  const { windowsArgument, psQuote, psEncoded } = await import('../src/platform.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wsl argv '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'args.mjs');
  await writeFile(script, 'console.log(JSON.stringify(process.argv.slice(2)))');
  const values = ['Ubuntu Work', '/home/dev/日本語', `cd "/home/O'Brien/space  & $x" && claude --resume id`, 'C:\\trailing\\'];
  const ps = `Start-Process -FilePath ${psQuote(process.execPath)} -ArgumentList ${psQuote([script, ...values].map(windowsArgument).join(' '))} -NoNewWindow -Wait`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-EncodedCommand', psEncoded(ps)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), values);
});
