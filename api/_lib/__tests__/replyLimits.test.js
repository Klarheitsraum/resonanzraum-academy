import { test } from "node:test";
import assert from "node:assert/strict";
import { replyTokenLimit, replyCompletion } from "../replyLimits.js";

test("Alte oder fehlende Grenzen geben einer Antwort 4096 Tokens Spielraum", () => {
  for (const value of [undefined, null, "", 800, "900", 1200, 0, -1, NaN, Infinity, "abc", 4096.5]) {
    assert.equal(replyTokenLimit(value), 4096, String(value));
  }
});
test("Ausdrücklich grössere Grenzen bleiben innerhalb eines begrenzten Kostenrahmens", () => {
  assert.equal(replyTokenLimit(4096), 4096);
  assert.equal(replyTokenLimit("6000"), 6000);
  assert.equal(replyTokenLimit(8192), 8192);
  assert.equal(replyTokenLimit(100000000), 8192);
});
test("Anbieter-Längenabbrüche sind von regulärem Ende und anderen Gründen unterscheidbar", () => {
  assert.deepEqual(replyCompletion("claude", { stop_reason: "max_tokens" }), { stopReason: "max_tokens", truncated: true });
  assert.deepEqual(replyCompletion("openai", { choices: [{ finish_reason: "length" }] }), { stopReason: "length", truncated: true });
  for (const reason of ["end_turn", "stop_sequence", "refusal"]) assert.equal(replyCompletion("claude", { stop_reason: reason }).truncated, false);
  for (const reason of ["stop", "content_filter", "tool_calls"]) assert.equal(replyCompletion("openai", { choices: [{ finish_reason: reason }] }).truncated, false);
  assert.deepEqual(replyCompletion("claude", {}), { stopReason: null, truncated: false });
});
