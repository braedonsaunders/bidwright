import assert from "node:assert/strict";
import test from "node:test";

import { resolveTenantAiConfig } from "./tenant-config.js";

test("uses the tenant-selected provider and model", () => {
  assert.deepEqual(resolveTenantAiConfig({
    llmProvider: "openrouter",
    llmModel: "openai/gpt-5",
    anthropicKey: "anthropic-tenant-key",
    openrouterKey: "openrouter-tenant-key",
  }), {
    provider: "openrouter",
    apiKey: "openrouter-tenant-key",
    model: "openai/gpt-5",
  });
});

test("falls through to another configured tenant provider", () => {
  assert.deepEqual(resolveTenantAiConfig({
    llmProvider: "anthropic",
    openaiKey: "openai-tenant-key",
  }), {
    provider: "openai",
    apiKey: "openai-tenant-key",
    model: "gpt-4o",
  });
});

test("does not infer credentials from the process environment", () => {
  assert.equal(resolveTenantAiConfig({ llmProvider: "openai" }), null);
});
