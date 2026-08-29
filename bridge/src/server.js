import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { isConfiguredCwd, listProjects, readClaudeSessionMetadata } from "./config.js";
import { createClaudeRunner } from "./claude-runner.js";
import { buildContextAppendPrompt, buildHandoffPrompt, buildHandoffRequestPrompt, buildPrompt, validateSessionRequest } from "./prompt.js";
import { prepareAttachments } from "./attachments.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function sseHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
}

function sendSse(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function resolveCwd(config, projectId) {
  if (!projectId) return config.workspace;
  const projects = listProjects(config);
  const selected = projects.find((project) => project.id === projectId || project.path === projectId);
  if (!selected) throw new Error("The selected Project is not configured in the Bridge.");
  return selected.path;
}

function resolveStoredCwd(config, cwd) {
  if (typeof cwd !== "string" || !isConfiguredCwd(config, cwd)) {
    throw new Error("The stored cwd is not configured in the Bridge.");
  }
  return cwd;
}

// Claude Code stores sessions per project directory, so the terminal must cd
// into the session's cwd before `claude --resume` can find it.
// ponytail: double quotes so the default osascript template (single-quoted
// for /bin/sh) still delivers paths with spaces; a cwd containing ' breaks launch only.
function resumeCommand(cwd, sessionId) {
  return `cd "${cwd.replace(/(["\\$`])/g, "\\$1")}" && claude --resume ${sessionId}`;
}

export function isLoopback(req) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket?.remoteAddress);
}

function defaultLaunchTerminal(commandLine) {
  spawn("/bin/sh", ["-c", commandLine], { detached: true, stdio: "ignore" }).unref();
}

function sameMessage(left, right) {
  return left === right || (left?.id && left.id === right?.id) || (left?.sourceLink && left.sourceLink === right?.sourceLink);
}

// Downloads supported attachments of the Message Context into the session's
// directory and reports each result as a tool event before Claude starts.
// `messages` defaults to the whole Message Context; a context append passes
// only the newly selected messages and receives them back prepared.
export async function attachSessionFiles({ config, session, res, messages }) {
  const sourceIncluded = session.messageContext.some((message) => sameMessage(message, session.sourceMessage));
  const initial = sourceIncluded ? session.messageContext : [session.sourceMessage, ...session.messageContext];
  const prepared = await prepareAttachments({
    messages: messages || initial,
    directory: path.join(config.attachmentsDir, session.id),
    maxBytes: config.attachmentMaxBytes,
  });
  for (const failure of prepared.failures) sendSse(res, "tool", { name: `添付ファイル取得失敗: ${failure.name}`, detail: failure.error });
  for (const file of prepared.downloaded) sendSse(res, "tool", { name: `添付ファイル取得: ${file.name}`, detail: file.localPath });
  if (prepared.downloaded.length > 0) session.attachmentsDir = prepared.directory;
  if (messages) {
    session.messageContext = [...session.messageContext, ...prepared.messages];
    return prepared.messages;
  }
  session.sourceMessage = prepared.messages.find((message) => sameMessage(message, session.sourceMessage)) || session.sourceMessage;
  session.messageContext = sourceIncluded ? prepared.messages : prepared.messages.slice(1);
  return prepared.messages;
}

function actionFor(config, actionId) {
  if (!actionId) return undefined;
  return config.actions.find((action) => action.id === actionId);
}

function publicConfig(config) {
  return {
    actions: config.actions.map(({ id, label }) => ({ id, label })),
    projects: listProjects(config).map(({ id, label, path }) => ({ id, label, path })),
    workspace: config.workspace,
  };
}

function makeSession(config, body, bridgeId, runnerFactory, { resume = false } = {}) {
  const cwd = body.cwd ? resolveStoredCwd(config, body.cwd) : resolveCwd(config, body.projectId);
  mkdirSync(cwd, { recursive: true });
  return {
    id: bridgeId,
    cwd,
    sourceMessage: body.sourceMessage,
    messageContext: body.messageContext || [body.sourceMessage],
    actionId: body.actionId,
    projectId: body.projectId || null,
    claudeSessionId: resume ? bridgeId : null,
    title: body.title || body.instruction?.trim().slice(0, 48) || "Discord Source Message",
    wasResumed: resume,
    runner: runnerFactory(config),
    // Attachments downloaded by an earlier Bridge process stay readable after a restart.
    attachmentsDir: existsSync(path.join(config.attachmentsDir, bridgeId)) ? path.join(config.attachmentsDir, bridgeId) : undefined,
    status: "running",
    text: "",
  };
}

async function runAndStream({ config, session, prompt, res, closeWhenDone = true }) {
  // `session` survives across follow-up turns. Keep the response accumulator
  // scoped to this turn so a stopped turn cannot leak its partial text into
  // the next completion.
  session.text = "";
  session.tools = [];
  let didComplete = false;
  let didEmitTitle = false;
  const emit = (event) => {
    if (event.type === "session") {
      session.claudeSessionId = event.sessionId;
      sendSse(res, "session", { sessionId: session.id, claudeSessionId: event.sessionId, cwd: session.cwd });
      return;
    }
    if (event.type === "title") {
      if (event.title) {
        didEmitTitle = true;
        session.title = event.title;
        sendSse(res, "title", { title: event.title });
      }
      return;
    }
    if (event.type === "delta") {
      session.text += event.text;
      sendSse(res, "delta", { text: event.text });
      return;
    }
    if (event.type === "tool") {
      sendSse(res, "tool", { name: event.name, detail: event.detail });
      return;
    }
    if (event.type === "complete") {
      didComplete = true;
      if (event.text && !session.text) session.text = event.text;
      sendSse(res, "complete", { text: event.text || session.text, isError: Boolean(event.isError) });
    }
  };

  try {
    const result = await session.runner.run({
      prompt,
      cwd: session.cwd,
      resumeId: session.claudeSessionId,
      sessionId: session.claudeSessionId ? undefined : session.id,
      addDirs: session.attachmentsDir ? [session.attachmentsDir] : [],
      onEvent: emit,
    });
    session.status = result.stopped ? "stopped" : "complete";
    const metadata = readClaudeSessionMetadata(session.cwd, session.claudeSessionId || session.id, config.claudeConfigDir);
    if (!didEmitTitle && metadata.exists && metadata.title) {
      session.title = metadata.title;
      sendSse(res, "title", { title: metadata.title });
    }
    if (!didComplete) sendSse(res, "complete", { text: session.text || result.text || "", stopped: Boolean(result.stopped) });
    sendSse(res, "done", { status: session.status, sessionId: session.id });
  } catch (error) {
    session.status = "error";
    sendSse(res, "error", { message: error instanceof Error ? error.message : String(error) });
    sendSse(res, "done", { status: session.status, sessionId: session.id });
  } finally {
    if (closeWhenDone && !res.writableEnded) res.end();
  }
}

export function createBridgeServer({ config, runnerFactory = createClaudeRunner, launchTerminal = defaultLaunchTerminal } = {}) {
  if (!config) throw new Error("config is required");
  const sessions = new Map();

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = requestUrl.pathname;
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }
    if (req.method === "GET" && pathname === "/health") {
      json(res, 200, { ok: true, service: "claude-bridge" });
      return;
    }
    if (req.method === "GET" && pathname === "/config") {
      try {
        json(res, 200, publicConfig(config));
      } catch (error) {
        json(res, 500, { error: error.message });
      }
      return;
    }

    if (req.method === "POST" && pathname === "/sessions/reconcile") {
      let body;
      try {
        body = await readJson(req);
      } catch (error) {
        json(res, 400, { error: error.message });
        return;
      }
      if (!Array.isArray(body.sessions)) {
        json(res, 400, { error: "sessions must be an array." });
        return;
      }
      const reconciled = body.sessions
        .filter((item) => item && typeof item.sessionId === "string" && typeof item.cwd === "string")
        .map((item) => {
          if (!isConfiguredCwd(config, item.cwd)) return { sessionId: item.sessionId, cwd: item.cwd, exists: false };
          const metadata = readClaudeSessionMetadata(item.cwd, item.sessionId, config.claudeConfigDir);
          return metadata.exists ? metadata : { sessionId: item.sessionId, cwd: item.cwd, exists: false };
        });
      json(res, 200, { sessions: reconciled });
      return;
    }

    const continuationMatch = pathname.match(/^\/sessions\/([^/]+)\/messages$/);
    if (req.method === "POST" && continuationMatch) {
      const sessionId = decodeURIComponent(continuationMatch[1]);
      let body;
      try {
        body = await readJson(req);
      } catch (error) {
        json(res, 400, { error: error.message });
        return;
      }
      const appendContext = body.appendContext === true && Array.isArray(body.messageContext) && body.messageContext.length > 0;
      if (!appendContext && (typeof body.instruction !== "string" || !body.instruction.trim())) {
        json(res, 400, { error: "instruction is required." });
        return;
      }
      let session = sessions.get(sessionId);
      if (!session) {
        try {
          // New messages of a context append are stored by attachSessionFiles.
          session = makeSession(config, { ...body, messageContext: appendContext ? [] : body.messageContext }, sessionId, runnerFactory, { resume: true });
          sessions.set(session.id, session);
        } catch (error) {
          json(res, 404, { error: "Claude Session not found or its cwd is not configured." });
          return;
        }
      }
      sseHeaders(res);
      if (appendContext) {
        // Context Expansion: only the newly selected messages are prepared and
        // sent; Claude already holds everything from earlier turns.
        const messages = await attachSessionFiles({ config, session, res, messages: body.messageContext });
        const prompt = buildContextAppendPrompt({
          action: actionFor(config, body.actionId),
          instruction: body.instruction || "",
          messages,
          sourceMessage: body.sourceMessage,
        });
        await runAndStream({ config, session, prompt, res });
        return;
      }
      // Claude already owns the conversation context when resuming. Sending
      // only the follow-up instruction avoids duplicating the Source Message.
      const prompt = body.instruction.trim();
      await runAndStream({ config, session, prompt, res });
      return;
    }

    const terminalMatch = pathname.match(/^\/sessions\/([^/]+)\/terminal$/);
    if ((req.method === "GET" || req.method === "POST") && terminalMatch) {
      const sessionId = decodeURIComponent(terminalMatch[1]);
      let cwd;
      try {
        cwd = resolveStoredCwd(config, req.method === "GET" ? requestUrl.searchParams.get("cwd") : (await readJson(req)).cwd);
      } catch (error) {
        json(res, 400, { error: error.message });
        return;
      }
      // readClaudeSessionMetadata also rejects malformed session IDs, which
      // keeps shell metacharacters out of the resume command.
      if (!readClaudeSessionMetadata(cwd, sessionId, config.claudeConfigDir).exists) {
        json(res, 404, { error: "Claude Session not found." });
        return;
      }
      const command = resumeCommand(cwd, sessionId);
      const local = isLoopback(req);
      if (req.method === "GET") {
        json(res, 200, { command, local, canOpenTerminal: local && Boolean(config.terminalCommand) });
        return;
      }
      if (!local) {
        json(res, 403, { error: "Bridge が別のマシンで動作しています。コマンドをコピーして実行してください。", command });
        return;
      }
      if (!config.terminalCommand) {
        json(res, 501, { error: "この Bridge ではターミナルを起動できません。コマンドをコピーして実行してください。", command });
        return;
      }
      // {command} lands inside an AppleScript string literal in the default template.
      launchTerminal(config.terminalCommand.replace("{command}", command.replace(/\\/g, "\\\\").replace(/"/g, '\\"')));
      json(res, 200, { ok: true, command });
      return;
    }

    const promoteMatch = pathname.match(/^\/sessions\/([^/]+)\/promote$/);
    if (req.method === "POST" && promoteMatch) {
      const originalId = decodeURIComponent(promoteMatch[1]);
      let body;
      try {
        body = await readJson(req);
      } catch (error) {
        json(res, 400, { error: error.message });
        return;
      }
      if (sessions.get(originalId)?.status === "running") {
        json(res, 400, { error: "この Claude Session は実行中です。" });
        return;
      }
      let original = sessions.get(originalId);
      let projectPath;
      try {
        if (!body.projectId) throw new Error("projectId is required.");
        projectPath = resolveCwd(config, body.projectId);
        if (!original) {
          original = makeSession(config, { ...body, projectId: undefined }, originalId, runnerFactory, { resume: true });
          // Nothing is in flight for a session known only from its JSONL.
          original.status = "complete";
          sessions.set(original.id, original);
        }
      } catch (error) {
        json(res, 400, { error: error.message });
        return;
      }
      sseHeaders(res);
      // Fork the General Session so the Handoff is written by Claude with the
      // full conversation, while the original Claude Session stays untouched.
      let handoff = "";
      try {
        const result = await runnerFactory(config).run({
          prompt: buildHandoffRequestPrompt({ instruction: body.instruction, projectPath }),
          cwd: original.cwd,
          resumeId: original.claudeSessionId || original.id,
          fork: true,
          addDirs: original.attachmentsDir ? [original.attachmentsDir] : [],
          onEvent: (event) => {
            if (event.type === "delta") {
              handoff += event.text;
              sendSse(res, "handoff-delta", { text: event.text });
            }
          },
        });
        handoff = handoff || result.text || "";
      } catch (error) {
        sendSse(res, "error", { message: error instanceof Error ? error.message : String(error) });
        sendSse(res, "done", { status: "error", sessionId: originalId });
        res.end();
        return;
      }
      sendSse(res, "handoff", { text: handoff });
      const session = makeSession(config, {
        projectId: body.projectId,
        sourceMessage: original.sourceMessage,
        messageContext: original.messageContext,
        title: original.title,
      }, randomUUID(), runnerFactory);
      session.derivedFrom = original.id;
      session.attachmentsDir = original.attachmentsDir;
      sessions.set(session.id, session);
      sendSse(res, "session", {
        sessionId: session.id,
        claudeSessionId: session.id,
        cwd: session.cwd,
        projectId: session.projectId,
        derivedFrom: original.id,
        derivedFromTitle: original.title,
      });
      const prompt = buildHandoffPrompt({ handoff, instruction: body.instruction, originalSessionId: original.id, projectPath });
      await runAndStream({ config, session, prompt, res });
      return;
    }

    if (req.method === "DELETE" && pathname.startsWith("/sessions/")) {
      const id = decodeURIComponent(pathname.slice("/sessions/".length));
      const session = sessions.get(id);
      if (!session) {
        json(res, 404, { error: "Claude Session not found." });
        return;
      }
      session.runner.stop();
      session.status = "stopped";
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && pathname === "/sessions") {
      let body;
      try {
        body = await readJson(req);
      } catch (error) {
        json(res, 400, { error: error.message });
        return;
      }
      const validationError = validateSessionRequest(body);
      if (validationError) {
        json(res, 400, { error: validationError });
        return;
      }
      let session;
      try {
        session = makeSession(config, body, randomUUID(), runnerFactory);
      } catch (error) {
        json(res, 400, { error: error.message });
        return;
      }
      sessions.set(session.id, session);
      sseHeaders(res);
      sendSse(res, "session", { sessionId: session.id, claudeSessionId: session.id, cwd: session.cwd, projectId: session.projectId });
      await attachSessionFiles({ config, session, res });
      const prompt = buildPrompt({
        action: actionFor(config, body.actionId),
        instruction: body.instruction,
        sourceMessage: session.sourceMessage,
        messageContext: session.messageContext,
      });
      await runAndStream({ config, session, prompt, res });
      return;
    }

    json(res, 404, { error: "Not found" });
  });
  server.sessions = sessions;
  return server;
}

export function startBridge(config, options = {}) {
  const server = createBridgeServer({ config, ...options });
  return new Promise((resolve) => server.listen(config.port, config.host, () => resolve(server)));
}
