import { spawn } from "node:child_process";
import { extractSessionTitle, stripSessionTitle } from "./prompt.js";

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && (block.type === "text" || typeof block.text === "string"))
    .map((block) => block.text || "")
    .join("");
}

export function normalizeClaudeEvent(event) {
  if (!event || typeof event !== "object") return [];
  const result = [];
  const sessionId = event.session_id || event.sessionId;
  if (sessionId) result.push({ type: "session", sessionId });

  // With --include-partial-messages the CLI wraps Anthropic streaming events in
  // { type: "stream_event", event: { ... } }.
  const streamEvent = event.type === "stream_event" && event.event ? event.event : event;

  if (streamEvent.type === "content_block_delta" && streamEvent.delta?.text) {
    result.push({ type: "delta", text: streamEvent.delta.text, partial: true });
  } else if (event.type === "assistant") {
    const text = textFromContent(event.message?.content ?? event.content);
    // assistant is the complete message emitted after its partial stream. The
    // runner uses `full` to append only any suffix not already streamed.
    if (text) result.push({ type: "delta", text, full: true });
    for (const block of event.message?.content || []) {
      if (block?.type === "tool_use" || block?.type === "tool_result") {
        result.push({ type: "tool", name: block.name || block.type, detail: block.input || block.content || "" });
      }
    }
  } else if (event.type === "tool_use" || event.type === "tool_result") {
    result.push({ type: "tool", name: event.name || event.tool_name || event.type, detail: event.input || event.content || "" });
  }

  if (event.type === "result" || event.subtype === "result") {
    const text = typeof event.result === "string" ? event.result : textFromContent(event.content);
    result.push({ type: "complete", text: text || undefined, isError: Boolean(event.is_error) });
  }
  return result;
}

export function argsForPrompt(prompt, resumeId, sessionId, addDirs = [], { fork = false } = {}) {
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  if (resumeId) {
    args.push("--resume", resumeId);
    // A fork reads the resumed conversation but writes to a new Claude Session.
    if (fork) args.push("--fork-session");
  } else if (sessionId) args.push("--session-id", sessionId);
  for (const dir of addDirs) args.push("--add-dir", dir);
  return args;
}

export function createTextDeltaAccumulator() {
  let partialText = "";
  let text = "";
  return {
    accept(event) {
      if (event.type !== "delta" || !event.text) return "";
      if (event.partial) {
        partialText += event.text;
        text += event.text;
        return event.text;
      }
      if (event.full && partialText) {
        const suffix = event.text.startsWith(partialText) ? event.text.slice(partialText.length) : event.text;
        partialText = "";
        text += suffix;
        return suffix;
      }
      partialText = "";
      text += event.text;
      return event.text;
    },
    getText() { return text; },
  };
}

export function createTitleStreamFilter(onTitle) {
  let buffer = "";
  let titleSeen = false;
  const publishTitle = (text) => {
    const extracted = extractSessionTitle(text);
    if (!extracted) return false;
    titleSeen = true;
    onTitle(extracted.title);
    return true;
  };
  return {
    accept(text) {
      if (!text) return "";
      if (titleSeen) return text;
      buffer += text;
      if (publishTitle(buffer)) {
        const visible = stripSessionTitle(buffer);
        buffer = "";
        return visible;
      }
      // The title is requested as the first line. If a non-conforming CLI
      // exceeds this small prefix, release it rather than holding the stream.
      if (buffer.length > 512 && !buffer.includes("[DCE_SESSION_TITLE]")) {
        titleSeen = true;
        const visible = buffer;
        buffer = "";
        return visible;
      }
      return "";
    },
    finish(finalText = "") {
      if (titleSeen) return "";
      if (finalText && publishTitle(finalText)) {
        buffer = "";
        return stripSessionTitle(finalText);
      }
      titleSeen = true;
      const visible = buffer;
      buffer = "";
      return visible;
    },
  };
}

export function createClaudeRunner(config) {
  let child;
  let stopped = false;

  return {
    run({ prompt, cwd, resumeId, sessionId, addDirs = [], fork = false, onEvent }) {
      return new Promise((resolve, reject) => {
        stopped = false;
        child = spawn(config.claudeCommand, argsForPrompt(prompt, resumeId, sessionId, addDirs, { fork }), {
          cwd,
          env: config.claudeConfigDir
            ? { ...process.env, CLAUDE_CONFIG_DIR: config.claudeConfigDir }
            : process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdoutBuffer = "";
        let stderr = "";
        let visibleText = "";
        const textAccumulator = createTextDeltaAccumulator();
        const titleFilter = resumeId
          ? null
          : createTitleStreamFilter((title) => onEvent({ type: "title", title }));

        const processLine = (line) => {
          if (!line.trim()) return;
          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch {
            // stream-json reserves stdout for JSONL events. Claude Code and MCP
            // clients can still print diagnostic lines there; never present such
            // lines as part of the user's answer.
            return;
          }
          for (const event of normalizeClaudeEvent(parsed)) {
            if (event.type === "delta") {
              const deltaText = textAccumulator.accept(event);
              const filteredText = titleFilter ? titleFilter.accept(deltaText) : deltaText;
              if (filteredText) {
                visibleText += filteredText;
                onEvent({ type: "delta", text: filteredText });
              }
            } else if (event.type === "complete") {
              if (titleFilter) {
                const finalText = titleFilter.finish(event.text || "");
                if (finalText) {
                  visibleText += finalText;
                  onEvent({ type: "delta", text: finalText });
                }
                onEvent({ ...event, text: event.text ? stripSessionTitle(event.text) : event.text });
              } else onEvent(event);
            } else onEvent(event);
          }
        };

        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdoutBuffer += chunk;
          const lines = stdoutBuffer.split("\n");
          stdoutBuffer = lines.pop() || "";
          lines.forEach(processLine);
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", (code, signal) => {
          if (stdoutBuffer) processLine(stdoutBuffer);
          child = undefined;
          if (stopped) {
            resolve({ stopped: true, text: visibleText });
          } else if (code === 0) {
            resolve({ text: visibleText });
          } else {
            const suffix = stderr.trim() || `Claude Code exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`;
            reject(new Error(suffix));
          }
        });
      });
    },
    stop() {
      if (!child) return false;
      stopped = true;
      child.kill("SIGTERM");
      return true;
    },
  };
}
