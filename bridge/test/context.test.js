import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const contextSource = readFileSync(new URL("../../extension/context.js", import.meta.url), "utf8");
const contextGlobal = {};
vm.runInNewContext(contextSource, contextGlobal);
const { contextWarning, mergeMessages, selectReplyChain, takeNeighborMessages } = contextGlobal.DceContext;

const message = (id, replyTo = "", extra = {}) => ({ id, replyTo, text: id, ...extra });
const ids = (messages) => Array.from(messages, (item) => item.id);
const plain = (value) => JSON.parse(JSON.stringify(value));

test("selectReplyChain includes root ancestors and Source descendants, not sibling branches", () => {
  const messages = [
    message("A"),
    message("B", "A"),
    message("C", "B"),
    message("D", "B"),
    message("E", "C"),
  ];
  const selected = selectReplyChain("C", messages);
  assert.deepEqual(ids(selected.messages), ["A", "B", "C", "E"]);
  assert.deepEqual(plain(selected.missingRanges), []);
  assert.equal(selected.warning, false);
});

test("non-reply Source Message stays a single-message context", () => {
  const selected = selectReplyChain("A", [message("A"), message("B")]);
  assert.deepEqual(ids(selected.messages), ["A"]);
  assert.deepEqual(plain(selected.missingRanges), []);
});

test("missing ancestors are reported while the available Source remains usable", () => {
  const selected = selectReplyChain("C", [message("C", "B")]);
  assert.deepEqual(ids(selected.messages), ["C"]);
  assert.deepEqual(plain(selected.missingRanges), [{ direction: "earlier", from: "B", to: "root" }]);
});

test("neighbor expansion returns five earlier or later messages", () => {
  const messages = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((id) => message(id));
  assert.deepEqual(ids(takeNeighborMessages(messages, [messages[5]], "earlier")), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(ids(takeNeighborMessages(messages, [messages[5]], "later")), ["7", "8", "9", "10"]);
  assert.deepEqual(plain(takeNeighborMessages(messages, [messages[5]], "later", 5)), ["7", "8", "9", "10"].map((id) => message(id)));
});

test("neighbor expansion sorts source into its chronological position", () => {
  const source = message("105");
  const domOrder = ["105", "106", "107", "108", "109", "110", "100", "101", "102", "103", "104"]
    .map((id) => message(id));
  const available = mergeMessages(domOrder, [source]);
  assert.deepEqual(ids(available), ["100", "101", "102", "103", "104", "105", "106", "107", "108", "109", "110"]);
  assert.deepEqual(ids(takeNeighborMessages(available, [source], "earlier")), ["100", "101", "102", "103", "104"]);
  assert.deepEqual(ids(takeNeighborMessages(available, [source], "later")), ["106", "107", "108", "109", "110"]);
});

test("short neighbor ranges remain distinguishable from a complete five-message range", () => {
  const source = message("105");
  const available = ["101", "102", "103", "104", "105", "106", "107"].map((id) => message(id));
  assert.equal(takeNeighborMessages(available, [source], "earlier").length, 4);
  assert.equal(takeNeighborMessages(available, [source], "later").length, 2);
});

test("long Reply Chain produces a warning but remains sendable", () => {
  const messages = Array.from({ length: 20 }, (_, index) => message(String(index + 1), index ? String(index) : ""));
  const selected = selectReplyChain("20", messages);
  assert.equal(selected.messages.length, 20);
  assert.equal(selected.warning, true);
  assert.equal(contextWarning(selected.messages), "返信チェーンに20件のメッセージが含まれています。");
});

test("DOM records take precedence while cache fills missing message metadata", () => {
  const merged = mergeMessages(
    [{ id: "C", text: "DOM text", author: "DOM" }],
    [{ id: "C", text: "cache text", replyTo: "B" }, { id: "B", text: "parent" }],
  );
  assert.deepEqual(plain(merged), [
    { id: "C", text: "DOM text", author: "DOM", replyTo: "B" },
    { id: "B", text: "parent" },
  ]);
});
