import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRunPromptCaching } from "./cli-prompt-caching.js";

test("cache canaries default off, inherit on continuation and accept explicit off", () => {
  assert.equal(resolveRunPromptCaching(undefined), false);
  assert.equal(resolveRunPromptCaching(true), true);
  assert.equal(resolveRunPromptCaching(undefined, true), true);
  assert.equal(resolveRunPromptCaching(false, true), false);
  assert.equal(resolveRunPromptCaching(true, false), true);
  assert.equal(resolveRunPromptCaching(undefined, "true"), false);
});

test("cache canaries reject ambiguous API values", () => {
  for (const value of [null, "true", "false", "on", 0, 1, {}, []]) {
    assert.throws(() => resolveRunPromptCaching(value), { message: "promptCaching must be a boolean", statusCode: 400 });
  }
});
