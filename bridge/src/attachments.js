import { mkdirSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

const DOWNLOAD_MIME_TYPES = ["application/pdf", "application/json", "application/xml", "application/x-yaml", "application/javascript", "application/csv"];
const DOWNLOAD_EXTENSIONS = new Set(("png jpg jpeg gif webp svg pdf txt md log json jsonl csv tsv yaml yml xml html css js mjs ts tsx jsx " +
  "py rb go rs java kt swift c h cpp hpp cs php sh zsh sql toml ini cfg env diff patch").split(" "));
const MEDIA_EXTENSIONS = new Set("mp4 mov webm mkv mp3 wav ogg m4a flac aac".split(" "));

function extensionOf(name) {
  return path.extname(String(name || "")).slice(1).toLowerCase();
}

function isMedia(attachment) {
  const mimeType = String(attachment.mimeType || "").toLowerCase();
  return mimeType.startsWith("video/") || mimeType.startsWith("audio/") || MEDIA_EXTENSIONS.has(extensionOf(attachment.name));
}

// Returns "" when the attachment should be downloaded, otherwise the skip reason.
function skipReason(attachment, maxBytes) {
  if (isMedia(attachment)) return "large-media";
  const mimeType = String(attachment.mimeType || "").toLowerCase();
  const downloadable = mimeType.startsWith("image/") || mimeType.startsWith("text/") ||
    DOWNLOAD_MIME_TYPES.includes(mimeType) || DOWNLOAD_EXTENSIONS.has(extensionOf(attachment.name));
  if (!downloadable) return "unsupported";
  return typeof attachment.size === "number" && attachment.size > maxBytes ? "too-large" : "";
}

export function classifyAttachment(attachment, maxBytes = DEFAULT_MAX_BYTES) {
  return skipReason(attachment, maxBytes) ? "metadata" : "download";
}

async function download(attachment, directory, index, maxBytes, fetchImpl) {
  const response = await fetchImpl(attachment.url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  if (length > maxBytes) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) return null;
  const base = path.basename(String(attachment.name || "file")).replace(/[^A-Za-z0-9._-]/g, "_");
  const localPath = path.join(directory, `${attachment.id || index}-${base}`);
  writeFileSync(localPath, buffer);
  return localPath;
}

export async function prepareAttachments({ messages, directory, maxBytes = DEFAULT_MAX_BYTES, fetchImpl = fetch }) {
  const downloaded = [];
  const failures = [];
  let created = false;
  const result = [];
  for (const message of messages) {
    if (!Array.isArray(message?.attachments) || message.attachments.length === 0) {
      result.push(message);
      continue;
    }
    const attachments = [];
    for (const [index, original] of message.attachments.entries()) {
      const attachment = { ...original };
      const skipped = skipReason(attachment, maxBytes);
      if (skipped) attachment.skipped = skipped;
      else {
        try {
          if (!created) mkdirSync(directory, { recursive: true });
          created = true;
          const localPath = await download(attachment, directory, index, maxBytes, fetchImpl);
          if (localPath) {
            attachment.localPath = localPath;
            downloaded.push({ name: attachment.name, localPath });
          } else attachment.skipped = "too-large";
        } catch (error) {
          attachment.error = error instanceof Error ? error.message : String(error);
          failures.push({ name: attachment.name, error: attachment.error });
        }
      }
      attachments.push(attachment);
    }
    result.push({ ...message, attachments });
  }
  return { messages: result, downloaded, failures, directory };
}

export function cleanupAttachments(rootDirectory, maxAgeMs, now = Date.now()) {
  let entries;
  try {
    entries = readdirSync(rootDirectory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionDirectory = path.join(rootDirectory, entry.name);
    for (const file of readdirSync(sessionDirectory)) {
      const filePath = path.join(sessionDirectory, file);
      if (now - statSync(filePath).mtimeMs > maxAgeMs) unlinkSync(filePath);
    }
    if (readdirSync(sessionDirectory).length === 0) rmdirSync(sessionDirectory);
  }
}

export function startAttachmentCleanup(rootDirectory, { maxAgeMs = 24 * 60 * 60 * 1000, intervalMs = 60 * 60 * 1000 } = {}) {
  cleanupAttachments(rootDirectory, maxAgeMs);
  const timer = setInterval(() => cleanupAttachments(rootDirectory, maxAgeMs), intervalMs);
  timer.unref();
  return timer;
}
