import assert from "node:assert/strict";
import test from "node:test";
import { resolveRunReasoningEffort } from "./cli-reasoning-effort.js";

test("an isolated medium run overrides extra-high tenant configuration", () => {
  assert.equal(resolveRunReasoningEffort("medium", "extra_high"), "medium");
  assert.equal(resolveRunReasoningEffort(undefined, "extra_high"), "extra_high");
});
test("a continuation retains its run effort unless explicitly changed", () => {
  assert.equal(resolveRunReasoningEffort(undefined, "extra_high", "build_estimate", "medium"), "medium");
  assert.equal(resolveRunReasoningEffort("high", "extra_high", "build_estimate", "medium"), "high");
  assert.equal(resolveRunReasoningEffort("auto", "extra_high", "build_estimate", "medium"), "auto");
});
test("invalid request values fail visibly instead of silently running at extra-high", () => {
  for (const requested of [null, "medum", "xhigh", 0, {}]) {
    assert.throws(() => resolveRunReasoningEffort(requested, "extra_high"), { statusCode: 400 });
  }
  assert.equal(resolveRunReasoningEffort(undefined, undefined, "qa"), "medium");
});
