import { spawn } from "node:child_process";

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

export function argsForPrompt(prompt, resumeId) {
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  if (resumeId) args.push("--resume", resumeId);
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

export function createClaudeRunner(config) {
  let child;
  let stopped = false;

  return {
    run({ prompt, cwd, resumeId, onEvent }) {
      return new Promise((resolve, reject) => {
        stopped = false;
        child = spawn(config.claudeCommand, argsForPrompt(prompt, resumeId), {
          cwd,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdoutBuffer = "";
        let stderr = "";
        const textAccumulator = createTextDeltaAccumulator();

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
              if (deltaText) onEvent({ type: "delta", text: deltaText });
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
            resolve({ stopped: true, text: textAccumulator.getText() });
          } else if (code === 0) {
            resolve({ text: textAccumulator.getText() });
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
