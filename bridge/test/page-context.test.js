import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const pageContextSource = readFileSync(new URL("../../extension/page-context.js", import.meta.url), "utf8");

test("page-world cache bridge discovers exported message stores and normalizes Discord message shapes", () => {
  const listeners = new Map();
  const responses = [];
  const store = {
    getMessages() {
      return {
        _array: [
          {
            id: "legacy",
            content: "legacy message",
            author: { username: "Legacy" },
            timestamp: "2026-08-30T01:02:03Z",
            channel_id: "legacy-channel",
            message_reference: { message_id: "legacy-parent" },
            attachments: [{ filename: "file.txt", content_type: "text/plain", url: "https://cdn.discordapp.com/file" }],
          },
          {
            id: "modern",
            content: "modern message",
            author: { globalName: "Modern" },
            timestamp: "2026-08-30T01:02:04Z",
            channelId: "modern-channel",
            messageReference: { message_id: "modern-parent" },
          },
        ],
      };
    },
    getMessage() {
      return null;
    },
  };
  const chunks = [];
  chunks.push = (chunk) => {
    chunk[2]({ c: { messageModule: { exports: { ZP: store } } } });
    return chunks.length;
  };
  const pageWindow = {
    webpackChunkdiscord_app: chunks,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    postMessage(message) {
      responses.push(message);
    },
  };
  const context = {
    window: pageWindow,
    location: { origin: "https://discord.com", pathname: "/channels/guild/channel/source" },
  };
  vm.runInNewContext(pageContextSource, context);

  listeners.get("message")({
    source: pageWindow,
    data: {
      type: "dce-message-cache-request",
      requestId: "request-1",
      sourceId: "legacy",
      guildId: "guild",
      channelId: "channel",
    },
  });

  assert.equal(responses.length, 1);
  assert.equal(responses[0].type, "dce-message-cache-response");
  assert.deepEqual(JSON.parse(JSON.stringify(responses[0].messages)), [
    {
      id: "legacy",
      text: "legacy message",
      author: "Legacy",
      timestamp: "2026-08-30T01:02:03Z",
      channel: { id: "legacy-channel", name: "" },
      sourceLink: "https://discord.com/channels/guild/legacy-channel/legacy",
      attachments: [{ name: "file.txt", mimeType: "text/plain", url: "https://cdn.discordapp.com/file" }],
      replyTo: "legacy-parent",
    },
    {
      id: "modern",
      text: "modern message",
      author: "Modern",
      timestamp: "2026-08-30T01:02:04Z",
      channel: { id: "modern-channel", name: "" },
      sourceLink: "https://discord.com/channels/guild/modern-channel/modern",
      attachments: [],
      replyTo: "modern-parent",
    },
  ]);
});
