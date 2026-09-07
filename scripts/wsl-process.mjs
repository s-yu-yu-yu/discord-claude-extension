import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const wslProcessFile = path.join(os.homedir(), '.local/state/discord-claude-bridge/wsl-process.json');
export function processIdentity(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return { start: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19], command: readFileSync(`/proc/${pid}/cmdline`).toString('base64') };
  } catch { return undefined; }
}
export function registeredProcess(file = wslProcessFile) {
  let saved;
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  if (!Number.isInteger(saved.pid) || saved.pid <= 1) throw new Error('Invalid WSL Bridge process record.');
  const live = processIdentity(saved.pid);
  return live && live.start === saved.start && live.command === saved.command ? saved : undefined;
}
export function registerWslProcess(file = wslProcessFile) {
  if (registeredProcess(file)) throw new Error('A registered WSL Bridge is already running. Reinstall its service first.');
  const identity = processIdentity(process.pid);
  if (!identity) throw new Error('WSL Bridge registration requires Linux /proc.');
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ pid: process.pid, ...identity }), { mode: 0o600 });
  process.once('exit', () => {
    if (registeredProcess(file)?.pid === process.pid) unlinkSync(file);
  });
}
export async function stopWslProcess(file = wslProcessFile) {
  const saved = registeredProcess(file);
  if (!saved) return;
  process.kill(saved.pid, 'SIGTERM');
  for (let i = 0; i < 50; i += 1) {
    if (!registeredProcess(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Recheck identity to avoid killing a reused PID.
  if (registeredProcess(file)?.pid === saved.pid) process.kill(saved.pid, 'SIGKILL');
  for (let i = 0; i < 20; i += 1) {
    if (!registeredProcess(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The registered WSL Bridge did not stop.');
}
