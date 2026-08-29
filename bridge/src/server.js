import http from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { isConfiguredCwd, listProjects, readClaudeSessionMetadata } from "./config.js";
import { createClaudeRunner } from "./claude-runner.js";
import { buildPrompt, validateSessionRequest } from "./prompt.js";
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

function sameMessage(left, right) {
  return left === right || (left?.id && left.id === right?.id) || (left?.sourceLink && left.sourceLink === right?.sourceLink);
}

// Downloads supported attachments of the Message Context into the session's
// directory and reports each result as a tool event before Claude starts.
export async function attachSessionFiles({ config, session, res }) {
  const sourceIncluded = session.messageContext.some((message) => sameMessage(message, session.sourceMessage));
  const messages = sourceIncluded ? session.messageContext : [session.sourceMessage, ...session.messageContext];
  const prepared = await prepareAttachments({
    messages,
    directory: path.join(config.attachmentsDir, session.id),
    maxBytes: config.attachmentMaxBytes,
  });
  for (const failure of prepared.failures) sendSse(res, "tool", { name: `添付ファイル取得失敗: ${failure.name}`, detail: failure.error });
  for (const file of prepared.downloaded) sendSse(res, "tool", { name: `添付ファイル取得: ${file.name}`, detail: file.localPath });
  session.sourceMessage = prepared.messages.find((message) => sameMessage(message, session.sourceMessage)) || session.sourceMessage;
  session.messageContext = sourceIncluded ? prepared.messages : prepared.messages.slice(1);
  if (prepared.downloaded.length > 0) session.attachmentsDir = prepared.directory;
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

export function createBridgeServer({ config, runnerFactory = createClaudeRunner } = {}) {
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
      if (typeof body.instruction !== "string" || !body.instruction.trim()) {
        json(res, 400, { error: "instruction is required." });
        return;
      }
      let session = sessions.get(sessionId);
      if (!session) {
        try {
          session = makeSession(config, { ...body, cwd: body.cwd }, sessionId, runnerFactory, { resume: true });
          sessions.set(session.id, session);
        } catch (error) {
          json(res, 404, { error: "Claude Session not found or its cwd is not configured." });
          return;
        }
      }
      sseHeaders(res);
      // Claude already owns the conversation context when resuming. Sending
      // only the follow-up instruction avoids duplicating the Source Message.
      const prompt = body.instruction.trim();
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
