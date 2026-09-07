import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { registeredProcess, stopWslProcess } from '../../scripts/wsl-process.mjs';

test('WSL service stops its recorded Linux Bridge without a distribution shutdown', { skip: process.platform !== 'linux', timeout: 10000 }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wsl service '));
  const file = path.join(directory, 'process.json');
  const module = new URL('../../scripts/wsl-process.mjs', import.meta.url).href;
  const code = `import { registerWslProcess } from ${JSON.stringify(module)}; registerWslProcess(${JSON.stringify(file)}); console.log('ready'); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await rm(directory, { recursive: true, force: true }); });
  await once(child.stdout, 'data');
  assert.equal(registeredProcess(file).pid, child.pid);
  await stopWslProcess(file);
  const [, signal] = await exit;
  assert.equal(signal, 'SIGTERM');
  assert.equal(registeredProcess(file), undefined);
});

test('stale WSL process records cannot stop a different process with the same PID', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wsl stale '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'process.json');
  await writeFile(file, JSON.stringify({ pid: process.pid, start: 'old', command: 'old' }));
  assert.equal(registeredProcess(file), undefined);
  await stopWslProcess(file);
});
