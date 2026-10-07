import assert from "node:assert/strict";
import { test } from "node:test";
import { compatibleSession } from "./session-continuity.js";

test("resume requires the same provider, model, mode and review authority", () => {
  const saved = { runtime: "codex", model: "kimi-k3", agentMode: "build_estimate" };
  assert.equal(compatibleSession(saved, saved), true);
  for (const change of [{ runtime: "claude-code" }, { model: "gpt-6.1-sol" }, { agentMode: "qa" }, { reviewOnly: true }]) {
    assert.equal(compatibleSession(saved, { ...saved, ...change }), false);
  }
  assert.equal(compatibleSession({}, saved), false, "legacy unscoped sessions are reconstructed, not resumed");
});
