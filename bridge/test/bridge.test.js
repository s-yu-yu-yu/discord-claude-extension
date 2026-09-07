import { resumeCommand } from "../src/platform.js";
import assert from "node:assert/strict";
import http from "node:http";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { claudeProjectDirectory, normalizeConfig, listProjects, readClaudeSessionMetadata } from "../src/config.js";
import { buildPrompt } from "../src/prompt.js";
import { createBridgeServer, isLoopback } from "../src/server.js";
import { argsForPrompt, createClaudeRunner, createTextDeltaAccumulator, createTitleStreamFilter, normalizeClaudeEvent } from "../src/claude-runner.js";

async function startTestServer(runnerFactory, overrides = {}, serverOptions = {}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "discord-claude-"));
  const config = normalizeConfig({ workspace, actions: [{ id: "research", label: "調査", prompt: "調査する" }], ...overrides });
  const server = createBridgeServer({ config, runnerFactory, ...serverOptions });
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
  assert.match(prompt, /\[DCE_SESSION_TITLE\]タイトル\[\/DCE_SESSION_TITLE\]/);
  assert.equal(prompt.match(/Source Link:/g)?.length, 1);
  assert.doesNotMatch(prompt, /## Message Context/);
  assert.match(prompt, /## 依頼\n調査する\n原因を確認\n/);
  // Only tool-specific content goes into the prompt: no role preamble, no empty placeholders.
  const bare = buildPrompt({ action: { prompt: "" }, sourceMessage: source });
  assert.doesNotMatch(bare, /Claude Code|追加指示なし|User instruction/);
  assert.match(bare, /## 依頼\nSource Message に対応してください。/);
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
  assert.deepEqual(argsForPrompt("follow-up", "123e4567-e89b-12d3-a456-426614174000").slice(-2), ["--resume", "123e4567-e89b-12d3-a456-426614174000"]);
  assert.deepEqual(argsForPrompt("first", undefined, "123e4567-e89b-12d3-a456-426614174000").slice(-2), ["--session-id", "123e4567-e89b-12d3-a456-426614174000"]);
  assert.deepEqual(argsForPrompt("first", undefined, undefined, ["/tmp/att"]).slice(-2), ["--add-dir", "/tmp/att"]);
  assert.deepEqual(argsForPrompt("handoff", "123e4567-e89b-12d3-a456-426614174000", undefined, [], { fork: true }).slice(-3), ["--resume", "123e4567-e89b-12d3-a456-426614174000", "--fork-session"]);
});

test("extracts a Claude-generated title marker and does not filter resume output", () => {
  const titles = [];
  const filter = createTitleStreamFilter((title) => titles.push(title));
  assert.equal(filter.accept("[DCE_SESSION_TITLE]調査タイトル[/DCE_SESSION_TITLE]\n結"), "結");
  assert.deepEqual(titles, ["調査タイトル"]);
  assert.equal(filter.accept("果"), "果");
});

test("Claude session metadata uses the generated title marker", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "discord-claude-data-"));
  const workspace = await mkdtemp(path.join(os.tmpdir(), "discord-claude-workspace-"));
  const sessionId = "123e4567-e89b-12d3-a456-426614174000";
  const directory = claudeProjectDirectory(workspace, dataDir);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${sessionId}.jsonl`), JSON.stringify({
    slug: "古いCLI slug",
    type: "assistant",
    message: { content: [{ type: "text", text: "[DCE_SESSION_TITLE]生成タイトル[/DCE_SESSION_TITLE]\n回答" }] },
  }));
  const metadata = readClaudeSessionMetadata(workspace, sessionId, dataDir);
  assert.equal(metadata.exists, true);
  assert.equal(metadata.sessionId, sessionId);
  assert.equal(metadata.cwd, workspace);
  assert.equal(metadata.title, "生成タイトル");
  assert.ok(metadata.updatedAt > 0);
});

test("ignores non-JSON stdout after the Claude result", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "discord-claude-runner-"));
  const fakeCli = path.join(workspace, "fake-claude.mjs");
  await writeFile(fakeCli, `#!/usr/bin/env node
const lines = [
  JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "[DCE_SESSION_TITLE]警告除外" } } }),
  JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "[/DCE_SESSION_TITLE]\\nOK" } } }),
  JSON.stringify({ type: "result", result: "[DCE_SESSION_TITLE]警告除外[/DCE_SESSION_TITLE]\\nOK" }),
  "Client.listTools() called but server does not advertise tools capability - returning empty list",
];
for (const line of lines) console.log(line);
`);
  await chmod(fakeCli, 0o755);
  const runner = createClaudeRunner({ claudeCommand: fakeCli });
  const events = [];
  const result = await runner.run({ prompt: "test", cwd: workspace, onEvent: (event) => events.push(event) });
  assert.deepEqual(events.filter((event) => event.type === "delta").map((event) => event.text), ["OK"]);
  assert.deepEqual(events.filter((event) => event.type === "title").map((event) => event.title), ["警告除外"]);
  assert.equal(result.text, "OK");
});

test("passes the configured Claude config directory to the CLI", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "discord-claude-config-dir-"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "discord-claude-data-dir-"));
  const fakeCli = path.join(workspace, "fake-claude.mjs");
  await writeFile(fakeCli, `#!/usr/bin/env node
const text = "[DCE_SESSION_TITLE]設定確認[/DCE_SESSION_TITLE]\\n" + process.env.CLAUDE_CONFIG_DIR;
console.log(JSON.stringify({ type: "result", result: text }));
`);
  await chmod(fakeCli, 0o755);
  const runner = createClaudeRunner({ claudeCommand: fakeCli, claudeConfigDir: dataDir });
  const result = await runner.run({ prompt: "test", cwd: workspace, onEvent: () => {} });
  assert.equal(result.text, dataDir);
});

test("keeps the inherited Claude config environment by default", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "discord-claude-default-config-"));
  const fakeCli = path.join(workspace, "fake-claude.mjs");
  await writeFile(fakeCli, `#!/usr/bin/env node
const inherited = process.env.CLAUDE_CONFIG_DIR || "__UNSET__";
const text = "[DCE_SESSION_TITLE]既存設定確認[/DCE_SESSION_TITLE]\\n" + inherited;
console.log(JSON.stringify({ type: "result", result: text }));
`);
  await chmod(fakeCli, 0o755);
  const runner = createClaudeRunner({ claudeCommand: fakeCli });
  const result = await runner.run({ prompt: "test", cwd: workspace, onEvent: () => {} });
  assert.equal(result.text, process.env.CLAUDE_CONFIG_DIR || "__UNSET__");
  const defaultRoot = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  assert.equal(
    claudeProjectDirectory(workspace),
    path.join(defaultRoot, "projects", workspace.replace(/[^a-zA-Z0-9]/g, "-")),
  );
  assert.equal(normalizeConfig({}).claudeConfigDir, undefined);
});

test("resume output streams before the completion event", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "discord-claude-resume-"));
  const fakeCli = path.join(workspace, "fake-claude.mjs");
  await writeFile(fakeCli, `#!/usr/bin/env node
console.log(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "R" } } }));
setTimeout(() => console.log(JSON.stringify({ type: "result", result: "R" })), 500);
`);
  await chmod(fakeCli, 0o755);
  const runner = createClaudeRunner({ claudeCommand: fakeCli });
  const events = [];
  let resolveDelta;
  const deltaReady = new Promise((resolve) => { resolveDelta = resolve; });
  const completion = runner.run({
    prompt: "follow-up",
    cwd: workspace,
    resumeId: "123e4567-e89b-12d3-a456-426614174000",
    onEvent: (event) => {
      events.push(event);
      if (event.type === "delta") resolveDelta();
    },
  });
  await deltaReady;
  assert.deepEqual(events.filter((event) => event.type === "delta").map((event) => event.text), ["R"]);
  assert.equal(events.some((event) => event.type === "complete"), false);
  runner.stop();
  await completion;
});

test("configured project roots expose only git directories", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "discord-projects-"));
  const project = path.join(root, "project");
  const nested = path.join(root, "group", "nested");
  await mkdir(path.join(project, ".git"), { recursive: true });
  await mkdir(path.join(nested, ".git"), { recursive: true });
  await mkdir(path.join(root, "a", "b", "too-deep", ".git"), { recursive: true });
  await mkdir(path.join(root, "not-a-project"), { recursive: true });
  const config = normalizeConfig({ projectRoots: [{ path: root }] });
  assert.deepEqual(listProjects(config).map((item) => item.path).sort(), [nested, project]);
  assert.deepEqual(normalizeConfig({}).actions.map((action) => action.id), ["jira", "github-issue", "summarize", "research", "critique", "freeform"]);
  const { server, base, config: served } = await startTestServer(() => ({ run: async () => ({}), stop() {} }), { projectRoots: [{ path: root, depth: 1 }] });
  t.after(() => server.close());
  const body = await (await fetch(`${base}/config`)).json();
  assert.equal(body.workspace, served.workspace);
  assert.deepEqual(body.projects, [{ id: project, label: "project", path: project }]);
  assert.deepEqual(body.actions, [{ id: "research", label: "調査" }]);
});

test("Bridge starts a Project Session in the selected Project", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "discord-project-session-"));
  const project = path.join(root, "repo");
  await mkdir(path.join(project, ".git"), { recursive: true });
  let receivedCwd;
  const runnerFactory = () => ({
    async run({ cwd, onEvent }) {
      receivedCwd = cwd;
      onEvent({ type: "complete", text: "done" });
      return { text: "done" };
    },
    stop() { return true; },
  });
  const { server, base } = await startTestServer(runnerFactory, { projectRoots: [{ path: root }] });
  t.after(() => server.close());
  const response = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: project, instruction: "直す", sourceMessage: { text: "bug", sourceLink: "https://discord.com/channels/1/2/3" } }),
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(receivedCwd, project);
  const first = JSON.parse(body.split("\n\n")[0].replace(/^event: session\ndata: /, ""));
  assert.equal(first.projectId, project);
  assert.equal(first.cwd, project);
});

test("Bridge streams session, delta, tool and completion events over SSE", async (t) => {
  const runnerFactory = () => ({
    async run({ onEvent }) {
      onEvent({ type: "session", sessionId: "claude-session-1" });
      onEvent({ type: "title", title: "生成されたタイトル" });
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
  assert.match(body, /生成されたタイトル/);
  assert.match(body, /event: delta/);
  assert.match(body, /# Done/);
  assert.match(body, /event: done/);
});

test("Bridge delivers the adjusted Message Context without re-adding Source", async (t) => {
  let receivedPrompt = "";
  const runnerFactory = () => ({
    async run({ prompt, onEvent }) {
      receivedPrompt = prompt;
      onEvent({ type: "complete", text: "done" });
      return { text: "done" };
    },
    stop() { return true; },
  });
  const { server, base } = await startTestServer(runnerFactory);
  t.after(() => server.close());
  const makeSource = (id, text) => ({
    id,
    text,
    author: "Author " + id,
    timestamp: "2026-08-30T01:02:03Z",
    channel: { id: "channel", name: "#engineering" },
    sourceLink: "https://discord.com/channels/1/2/" + id,
  });
  const source = makeSource("C", "source");
  const response = await fetch(base + "/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instruction: "確認",
      sourceMessage: source,
      messageContext: [makeSource("A", "ancestor A"), makeSource("B", "ancestor B"), source, makeSource("E", "descendant E")],
    }),
  });
  await response.text();
  assert.equal(response.status, 200);
  assert.match(receivedPrompt, /ancestor A/);
  assert.match(receivedPrompt, /ancestor B/);
  assert.match(receivedPrompt, /source/);
  assert.match(receivedPrompt, /descendant E/);
  assert.doesNotMatch(receivedPrompt, /sibling D/);
  assert.equal(receivedPrompt.match(/Source Link:/g)?.length, 4);
});

test("Bridge resumes a stateless session using its Claude session ID", async (t) => {
  const sessionId = "123e4567-e89b-12d3-a456-426614174000";
  let receivedResumeId;
  let receivedCwd;
  let receivedPrompt;
  const runnerFactory = () => ({
    async run({ resumeId, cwd, prompt, onEvent }) {
      receivedResumeId = resumeId;
      receivedCwd = cwd;
      receivedPrompt = prompt;
      onEvent({ type: "delta", text: "続き" });
      onEvent({ type: "complete", text: "続き" });
      return { text: "続き" };
    },
    stop() { return true; },
  });
  const { server, base, config } = await startTestServer(runnerFactory);
  t.after(() => server.close());
  const response = await fetch(`${base}/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cwd: config.workspace,
      instruction: "続けて",
      sourceMessage: { id: "1", text: "source", sourceLink: "https://discord.com/channels/1/2/1" },
      messageContext: [{ id: "1", text: "source", sourceLink: "https://discord.com/channels/1/2/1" }],
    }),
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(receivedResumeId, sessionId);
  assert.equal(receivedCwd, config.workspace);
  // A plain follow-up never re-sends the Message Context.
  assert.equal(receivedPrompt, "続けて");
  assert.match(body, /続き/);
});

test("Bridge appends newly selected Message Context to a resumed session", async (t) => {
  const sessionId = "123e4567-e89b-12d3-a456-426614174001";
  let received;
  const runnerFactory = () => ({
    async run({ prompt, resumeId, onEvent }) {
      received = { prompt, resumeId };
      onEvent({ type: "complete", text: "追加済み" });
      return { text: "追加済み" };
    },
    stop() { return true; },
  });
  const { server, base, config } = await startTestServer(runnerFactory);
  t.after(() => server.close());
  const makeMessage = (id, text) => ({ id, text, author: "Author " + id, timestamp: "2026-08-30T01:02:03Z", channel: { id: "2", name: "#eng" }, sourceLink: "https://discord.com/channels/1/2/" + id });
  const response = await fetch(`${base}/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cwd: config.workspace,
      appendContext: true,
      actionId: "research",
      sourceMessage: makeMessage("10", "source"),
      messageContext: [makeMessage("11", "new one"), makeMessage("12", "new two")],
    }),
  });
  await response.text();
  assert.equal(response.status, 200);
  assert.equal(received.resumeId, sessionId);
  assert.match(received.prompt, /## 追加 Message Context/);
  assert.match(received.prompt, /## 依頼\n調査する/);
  assert.match(received.prompt, /https:\/\/discord\.com\/channels\/1\/2\/11/);
  assert.match(received.prompt, /https:\/\/discord\.com\/channels\/1\/2\/12/);
  assert.equal(received.prompt.match(/Source Link:/g)?.length, 2);
  assert.doesNotMatch(received.prompt, /DCE_SESSION_TITLE/);
  assert.deepEqual(server.sessions.get(sessionId).messageContext.map((message) => message.id), ["11", "12"]);
});

test("Bridge resets the turn accumulator after stop before resuming", async (t) => {
  let runCount = 0;
  let resolveStopped;
  const resumeIds = [];
  const runCwds = [];
  const claudeSessionId = "123e4567-e89b-12d3-a456-426614174000";
  let firstRunStarted;
  const firstRunReady = new Promise((resolve) => { firstRunStarted = resolve; });
  const runnerFactory = () => ({
    run({ resumeId, cwd, onEvent }) {
      runCount += 1;
      resumeIds.push(resumeId);
      runCwds.push(cwd);
      if (runCount === 1) {
        onEvent({ type: "session", sessionId: claudeSessionId });
        onEvent({ type: "delta", text: "old partial" });
        firstRunStarted();
        return new Promise((resolve) => { resolveStopped = () => resolve({ stopped: true, text: "old partial" }); });
      }
      onEvent({ type: "delta", text: "new partial" });
      onEvent({ type: "complete", text: "new answer" });
      return Promise.resolve({ text: "new answer" });
    },
    stop() { resolveStopped?.(); return true; },
  });
  const { server, base } = await startTestServer(runnerFactory);
  t.after(() => server.close());
  const initialResponsePromise = fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction: "最初の指示", sourceMessage: { text: "hello", sourceLink: "https://discord.com/channels/1/2/3" } }),
  });
  await firstRunReady;
  const sessionId = [...server.sessions.keys()][0];
  const stopped = await fetch(`${base}/sessions/${sessionId}`, { method: "DELETE" });
  assert.equal(stopped.status, 200);
  await (await initialResponsePromise).text();

  const followResponse = await fetch(`${base}/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction: "続き", cwd: server.sessions.get(sessionId).cwd }),
  });
  const body = await followResponse.text();
  assert.equal(followResponse.status, 200);
  assert.match(body, /new partial/);
  assert.match(body, /new answer/);
  assert.doesNotMatch(body, /old partial/);
  assert.deepEqual(resumeIds, [null, claudeSessionId]);
  assert.equal(runCwds[0], runCwds[1]);
});

test("Bridge promotes a General Session into a Project Session with a forked Handoff", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "discord-promote-"));
  const project = path.join(root, "repo");
  await mkdir(path.join(project, ".git"), { recursive: true });
  const originalId = "123e4567-e89b-12d3-a456-426614174000";
  const runs = [];
  const runnerFactory = () => ({
    async run({ prompt, cwd, resumeId, sessionId, fork, onEvent }) {
      runs.push({ prompt, cwd, resumeId, sessionId, fork });
      const text = runs.length === 1 ? "## 調査結果\n- 原因は設定漏れ" : "着手します";
      onEvent({ type: "delta", text });
      onEvent({ type: "complete", text });
      return { text };
    },
    stop() { return true; },
  });
  const { server, base, config } = await startTestServer(runnerFactory, { projectRoots: [{ path: root }] });
  t.after(() => server.close());
  const response = await fetch(`${base}/sessions/${originalId}/promote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: project, cwd: config.workspace, instruction: "テストも追加", title: "元の調査" }),
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].resumeId, originalId);
  assert.equal(runs[0].fork, true);
  assert.equal(runs[0].cwd, config.workspace);
  assert.match(runs[0].prompt, /## 次に実行すべき作業/);
  assert.equal(runs[1].cwd, project);
  assert.ok(!runs[1].resumeId);
  assert.ok(runs[1].sessionId && runs[1].sessionId !== originalId);
  assert.match(runs[1].prompt, /## Handoff\n## 調査結果\n- 原因は設定漏れ/);
  assert.match(runs[1].prompt, /テストも追加/);
  assert.match(runs[1].prompt, new RegExp(`claude --resume ${originalId}`));
  assert.match(body, /event: handoff-delta/);
  assert.match(body, /event: handoff\ndata: \{"text":"## 調査結果/);
  assert.match(body, new RegExp(`event: session\ndata: \\{[^\n]*"derivedFrom":"${originalId}","derivedFromTitle":"元の調査"`));
  assert.match(body, /着手します/);
  assert.match(body, /event: done/);
  assert.notEqual(server.sessions.get(originalId).status, "running");
  assert.equal(server.sessions.get(runs[1].sessionId).derivedFrom, originalId);
});

test("Bridge reconciliation reports existing Claude JSONL sessions only", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "discord-claude-reconcile-"));
  const existingId = "123e4567-e89b-12d3-a456-426614174000";
  const missingId = "123e4567-e89b-12d3-a456-426614174001";
  const { server, base, config } = await startTestServer(() => ({ run: async () => ({}), stop() {} }), { claudeConfigDir: dataDir });
  t.after(() => server.close());
  const directory = claudeProjectDirectory(config.workspace, dataDir);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${existingId}.jsonl`), JSON.stringify({ type: "user", message: { content: "存在するセッション" } }) + "\n");
  const response = await fetch(`${base}/sessions/reconcile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessions: [
      { sessionId: existingId, cwd: config.workspace },
      { sessionId: missingId, cwd: config.workspace },
    ] }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.sessions.find((item) => item.sessionId === existingId).exists, true);
  assert.equal(body.sessions.find((item) => item.sessionId === missingId).exists, false);
});

test("Bridge hands a resumable Claude Session off to a local terminal", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "discord-claude-terminal-"));
  const sessionId = "123e4567-e89b-12d3-a456-426614174002";
  const launched = [];
  const { server, base, config } = await startTestServer(
    () => ({ run: async () => ({}), stop() {} }),
    { claudeConfigDir: dataDir, terminalCommand: "echo {command}" },
    { launchTerminal: (template, commandLine) => launched.push(commandLine) },
  );
  t.after(() => server.close());
  const directory = claudeProjectDirectory(config.workspace, dataDir);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${sessionId}.jsonl`), JSON.stringify({ type: "user", message: { content: "再開するセッション" } }) + "\n");
  const query = `?cwd=${encodeURIComponent(config.workspace)}`;
  const info = await (await fetch(`${base}/sessions/${sessionId}/terminal${query}`)).json();
  assert.deepEqual(info, { command: resumeCommand(config.workspace, sessionId), local: true, canOpenTerminal: true });
  const opened = await fetch(`${base}/sessions/${sessionId}/terminal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: config.workspace }),
  });
  assert.equal(opened.status, 200);
  assert.equal((await opened.json()).ok, true);
  assert.equal(launched.length, 1);
  assert.equal(launched[0], info.command);
  const missing = await fetch(`${base}/sessions/123e4567-e89b-12d3-a456-426614174003/terminal${query}`);
  assert.equal(missing.status, 404);
  assert.equal(isLoopback({ socket: { remoteAddress: "192.168.1.5" } }), false);
});

test("Bridge downloads Message Context attachments and exposes them to Claude", async (t) => {
  const files = http.createServer((req, res) => {
    if (req.url === "/a/log.txt") res.end("error at line 3");
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise((resolve) => files.listen(0, "127.0.0.1", resolve));
  t.after(() => files.close());
  const fileBase = `http://127.0.0.1:${files.address().port}`;
  const attachmentsDir = await mkdtemp(path.join(os.tmpdir(), "discord-claude-attachments-"));
  let received;
  const runnerFactory = () => ({
    async run({ prompt, addDirs, onEvent }) {
      received = { prompt, addDirs };
      onEvent({ type: "complete", text: "done" });
      return { text: "done" };
    },
    stop() { return true; },
  });
  const { server, base } = await startTestServer(runnerFactory, { attachmentsDir });
  t.after(() => server.close());
  const source = { id: "S", text: "see the log", sourceLink: "https://discord.com/channels/1/2/S" };
  const response = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instruction: "確認",
      sourceMessage: source,
      messageContext: [{
        ...source,
        attachments: [
          { id: "10", name: "log.txt", mimeType: "text/plain", url: `${fileBase}/a/log.txt` },
          { id: "11", name: "gone.txt", mimeType: "text/plain", url: `${fileBase}/a/gone.txt` },
        ],
      }],
    }),
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  const sessionId = [...server.sessions.keys()][0];
  const localPath = path.join(attachmentsDir, sessionId, "10-log.txt");
  assert.match(received.prompt, new RegExp(`Local file: ${localPath.replace(/[.\\/]/g, "\\$&")}`));
  assert.match(received.prompt, /取得失敗: HTTP 404/);
  assert.deepEqual(received.addDirs, [path.join(attachmentsDir, sessionId)]);
  assert.match(body, /添付ファイル取得: log\.txt/);
  assert.match(body, /添付ファイル取得失敗: gone\.txt/);
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
