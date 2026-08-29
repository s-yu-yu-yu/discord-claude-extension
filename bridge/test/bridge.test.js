import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeConfig, listProjects } from "../src/config.js";
import { buildPrompt } from "../src/prompt.js";
import { createBridgeServer } from "../src/server.js";
import { argsForPrompt, createClaudeRunner, createTextDeltaAccumulator, normalizeClaudeEvent } from "../src/claude-runner.js";

async function startTestServer(runnerFactory) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "discord-claude-"));
  const config = normalizeConfig({ workspace, actions: [{ id: "research", label: "調査", prompt: "調査する" }] });
  const server = createBridgeServer({ config, runnerFactory });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, base: `http://127.0.0.1:${address.port}`, config };
}

test("buildPrompt preserves Source Message metadata and links", () => {
  const source = {
    text: "Investigate this",
    author: "Aki",
    timestamp: "2026-08-30T01:02:03Z",
    channel: { name: "#engineering" },
    sourceLink: "https://discord.com/channels/1/2/3",
  };
  const prompt = buildPrompt({ action: { prompt: "調査する" }, instruction: "原因を確認", sourceMessage: source, messageContext: [source] });
  assert.match(prompt, /Investigate this/);
  assert.match(prompt, /Aki/);
  assert.match(prompt, /#engineering/);
  assert.match(prompt, /https:\/\/discord\.com\/channels\/1\/2\/3/);
  assert.match(prompt, /原因を確認/);
});

test("normalizes Claude partial stream events and avoids assistant full-text duplication", () => {
  const partial = normalizeClaudeEvent({
    type: "stream_event",
    session_id: "claude-session-1",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
  });
  assert.deepEqual(partial, [
    { type: "session", sessionId: "claude-session-1" },
    { type: "delta", text: "Hel", partial: true },
  ]);
  const full = normalizeClaudeEvent({
    type: "assistant",
    message: { content: [{ type: "text", text: "Hello" }] },
  });
  const accumulator = createTextDeltaAccumulator();
  assert.equal(accumulator.accept(partial[1]), "Hel");
  assert.equal(accumulator.accept(full[0]), "lo");
  assert.equal(accumulator.getText(), "Hello");
  assert.ok(argsForPrompt("prompt").includes("--include-partial-messages"));
});

test("ignores non-JSON stdout after the Claude result", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "discord-claude-runner-"));
  const fakeCli = path.join(workspace, "fake-claude.mjs");
  await writeFile(fakeCli, `#!/usr/bin/env node
const lines = [
  JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "O" } } }),
  JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "K" } } }),
  JSON.stringify({ type: "result", result: "OK" }),
  "Client.listTools() called but server does not advertise tools capability - returning empty list",
];
for (const line of lines) console.log(line);
`);
  await chmod(fakeCli, 0o755);
  const runner = createClaudeRunner({ claudeCommand: fakeCli });
  const events = [];
  const result = await runner.run({ prompt: "test", cwd: workspace, onEvent: (event) => events.push(event) });
  assert.deepEqual(events.filter((event) => event.type === "delta").map((event) => event.text), ["O", "K"]);
  assert.equal(result.text, "OK");
});

test("configured project roots expose only git directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "discord-projects-"));
  const project = path.join(root, "project");
  await mkdir(path.join(project, ".git"), { recursive: true });
  await mkdir(path.join(root, "not-a-project"), { recursive: true });
  const config = normalizeConfig({ projectRoots: [{ path: root, depth: 2 }] });
  assert.deepEqual(listProjects(config).map((item) => item.path), [project]);
});

test("Bridge streams session, delta, tool and completion events over SSE", async (t) => {
  const runnerFactory = () => ({
    async run({ onEvent }) {
      onEvent({ type: "session", sessionId: "claude-session-1" });
      onEvent({ type: "tool", name: "Read", detail: "README.md" });
      onEvent({ type: "delta", text: "# Done" });
      onEvent({ type: "complete" });
      return { text: "# Done" };
    },
    stop() { return true; },
  });
  const { server, base } = await startTestServer(runnerFactory);
  t.after(() => server.close());
  const health = await fetch(`${base}/health`);
  assert.deepEqual(await health.json(), { ok: true, service: "claude-bridge" });
  const response = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      actionId: "research",
      instruction: "調べる",
      sourceMessage: { text: "hello", sourceLink: "https://discord.com/channels/1/2/3", author: "A" },
    }),
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /event: session/);
  assert.match(body, /event: tool/);
  assert.match(body, /event: delta/);
  assert.match(body, /# Done/);
  assert.match(body, /event: done/);
});

test("Bridge rejects a request without a Source Link", async (t) => {
  const { server, base } = await startTestServer(() => ({ run: async () => ({}), stop() {} }));
  t.after(() => server.close());
  const response = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceMessage: { text: "hello" } }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /sourceMessage\.sourceLink/);
});
