import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAgentProviderKeys,
  resolveRuntimeProviderKey,
} from "./agent-provider-credentials.js";

const environment = {
  ANTHROPIC_API_KEY: "env-anthropic",
  OPENAI_API_KEY: "env-openai",
  CODEX_API_KEY: "env-codex",
  OPENROUTER_API_KEY: "env-openrouter",
  GEMINI_API_KEY: "env-gemini",
  GOOGLE_GENAI_API_KEY: "env-google-genai",
};

test("server agent credentials ignore host environment provider keys", () => {
  assert.deepEqual(
    resolveAgentProviderKeys({}, { deploymentMode: "server", environment }),
    {
      anthropicApiKey: undefined,
      openaiApiKey: undefined,
      googleApiKey: undefined,
      openrouterApiKey: undefined,
    },
  );
});

test("server agent credentials use tenant-configured effective integrations", () => {
  assert.deepEqual(
    resolveAgentProviderKeys(
      {
        anthropicKey: "tenant-anthropic",
        openaiKey: "tenant-openai",
        openrouterKey: "tenant-openrouter",
        geminiKey: "tenant-gemini",
      },
      { deploymentMode: "server", environment },
    ),
    {
      anthropicApiKey: "tenant-anthropic",
      openaiApiKey: "tenant-openai",
      googleApiKey: "tenant-gemini",
      openrouterApiKey: "tenant-openrouter",
    },
  );
});

test("desktop agent credentials retain explicit local environment fallback", () => {
  const keys = resolveAgentProviderKeys({}, { deploymentMode: "desktop", environment });
  assert.equal(keys.anthropicApiKey, "env-anthropic");
  assert.equal(keys.openaiApiKey, "env-openai");
  assert.equal(keys.googleApiKey, "env-gemini");
  assert.equal(keys.openrouterApiKey, "env-openrouter");
});

test("runtime credential selection preserves OpenCode provider priority", () => {
  assert.equal(
    resolveRuntimeProviderKey("opencode", {
      openaiApiKey: "openai",
      openrouterApiKey: "openrouter",
    }),
    "openrouter",
  );
});
