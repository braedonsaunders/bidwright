import assert from "node:assert/strict";
import test from "node:test";

import { buildWatchdogRecoveryOptions, type SpawnSessionOpts } from "./cli-runtime.js";

test("watchdog recovery preserves tenant identity, credentials, mode, and runtime context", () => {
  const original: SpawnSessionOpts = {
    projectId: "project-test",
    projectDir: "/data/projects/project-test",
    prompt: "original prompt",
    runtime: "openrouter",
    model: "moonshotai/kimi-k3",
    authToken: "session-token",
    apiBaseUrl: "http://localhost:4001",
    revisionId: "revision-test",
    quoteId: "quote-test",
    userId: "user-test",
    organizationId: "organization-test",
    openrouterApiKey: "tenant-openrouter-key",
    reasoningEffort: "extra_high",
    agentMode: "build_estimate",
    emitCompletionMessage: false,
  };

  const recovered = buildWatchdogRecoveryOptions(original);

  assert.equal(recovered.userId, original.userId);
  assert.equal(recovered.organizationId, original.organizationId);
  assert.equal(recovered.openrouterApiKey, original.openrouterApiKey);
  assert.equal(recovered.agentMode, original.agentMode);
  assert.equal(recovered.authToken, original.authToken);
  assert.equal(recovered.revisionId, original.revisionId);
  assert.equal(recovered.quoteId, original.quoteId);
  assert.match(String(recovered.prompt), /continue where you left off/i);
});
