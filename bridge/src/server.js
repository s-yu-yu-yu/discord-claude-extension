import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { listProjects } from "./config.js";
import { createClaudeRunner } from "./claude-runner.js";
import { buildPrompt, validateSessionRequest } from "./prompt.js";

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

function actionFor(config, actionId) {
  if (!actionId) return undefined;
  return config.actions.find((action) => action.id === actionId);
}

function publicConfig(config) {
  return {
    actions: config.actions.map(({ id, label }) => ({ id, label })),
    projects: listProjects(config).map(({ id, label }) => ({ id, label })),
  };
}

function makeSession(config, body, bridgeId, runnerFactory) {
  const cwd = resolveCwd(config, body.projectId);
  mkdirSync(cwd, { recursive: true });
  return {
    id: bridgeId,
    cwd,
    sourceMessage: body.sourceMessage,
    messageContext: body.messageContext || [body.sourceMessage],
    actionId: body.actionId,
    projectId: body.projectId || null,
    claudeSessionId: null,
    runner: runnerFactory(config),
    status: "running",
    text: "",
  };
}

async function runAndStream({ config, session, prompt, res, closeWhenDone = true }) {
  let didComplete = false;
  const emit = (event) => {
    if (event.type === "session") {
      session.claudeSessionId = event.sessionId;
      sendSse(res, "session", { sessionId: session.id, claudeSessionId: event.sessionId });
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
      onEvent: emit,
    });
    session.status = result.stopped ? "stopped" : "complete";
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

    const continuationMatch = pathname.match(/^\/sessions\/([^/]+)\/messages$/);
    if (req.method === "POST" && continuationMatch) {
      const session = sessions.get(decodeURIComponent(continuationMatch[1]));
      if (!session) {
        json(res, 404, { error: "Claude Session not found in this Bridge process." });
        return;
      }
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
      sseHeaders(res);
      const prompt = buildPrompt({
        action: actionFor(config, session.actionId),
        instruction: body.instruction,
        sourceMessage: session.sourceMessage,
        messageContext: session.messageContext,
      });
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
      sendSse(res, "session", { sessionId: session.id });
      const prompt = buildPrompt({
        action: actionFor(config, body.actionId),
        instruction: body.instruction,
        sourceMessage: body.sourceMessage,
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
