import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, utimes, writeFile, mkdir, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyAttachment, cleanupAttachments, prepareAttachments } from "../src/attachments.js";

test("classifyAttachment downloads small documents and keeps media as metadata", () => {
  assert.equal(classifyAttachment({ name: "shot.png", mimeType: "image/png", size: 1000 }), "download");
  assert.equal(classifyAttachment({ name: "notes.md", mimeType: "" }), "download");
  assert.equal(classifyAttachment({ name: "clip.mp4", mimeType: "" }), "metadata");
  assert.equal(classifyAttachment({ name: "voice", mimeType: "audio/ogg" }), "metadata");
  assert.equal(classifyAttachment({ name: "blob.bin", mimeType: "" }), "metadata");
  assert.equal(classifyAttachment({ name: "big.pdf", mimeType: "application/pdf", size: 30 }, 20), "metadata");
});

test("prepareAttachments records failures per attachment and cleanup removes stale files", async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === "/ok/notes.txt") res.end("hello attachment");
    else { res.statusCode = 404; res.end("missing"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const root = await mkdtemp(path.join(os.tmpdir(), "dce-attachments-"));
  const directory = path.join(root, "session-1");
  const message = {
    id: "1",
    text: "see files",
    attachments: [
      { id: "10", name: "notes.txt", mimeType: "text/plain", url: `${base}/ok/notes.txt` },
      { id: "11", name: "gone.txt", mimeType: "text/plain", url: `${base}/missing/gone.txt` },
      { id: "12", name: "clip.mp4", mimeType: "video/mp4", size: 5000, url: `${base}/clip.mp4` },
    ],
  };
  const prepared = await prepareAttachments({ messages: [message], directory });
  const [ok, failed, skipped] = prepared.messages[0].attachments;
  assert.equal(ok.localPath, path.join(directory, "10-notes.txt"));
  assert.equal(await readFile(ok.localPath, "utf8"), "hello attachment");
  assert.match(failed.error, /404/);
  assert.equal(skipped.skipped, "large-media");
  assert.deepEqual(prepared.failures, [{ name: "gone.txt", error: "HTTP 404" }]);
  assert.equal(message.attachments[0].localPath, undefined);

  const stale = path.join(root, "session-old");
  await mkdir(stale);
  await writeFile(path.join(stale, "old.txt"), "old");
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await utimes(path.join(stale, "old.txt"), twoDaysAgo, twoDaysAgo);
  cleanupAttachments(root, 24 * 60 * 60 * 1000);
  await assert.rejects(access(stale));
  await access(ok.localPath);
});
