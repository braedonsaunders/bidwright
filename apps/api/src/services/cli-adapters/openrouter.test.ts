import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openRouterAdapter } from "./openrouter.js";
import type { SpawnCtx } from "./types.js";

test("OpenRouter uses Codex App Server config without putting the API key in argv", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "bidwright-openrouter-adapter-"));
  const fakeCodex = join(projectDir, "codex");
  await writeFile(fakeCodex, "#!/bin/sh\nexit 0\n", { mode: 0o700 });

  const ctx: SpawnCtx = {
    projectDir,
    prompt: "verify OpenRouter transport",
    model: "~openai/gpt-latest",
    reasoningEffort: "high",
    customCliPath: fakeCodex,
    apiKeys: { openrouter: "sk-or-test-secret" },
    mcpRunner: "node",
    mcpArgs: ["/app/mcp-server.js"],
    mcpEnv: {
      BIDWRIGHT_API_URL: "http://localhost:4001",
      BIDWRIGHT_AUTH_TOKEN: "test-mcp-token",
      BIDWRIGHT_PROJECT_ID: "project-test",
      BIDWRIGHT_REVISION_ID: "revision-test",
      BIDWRIGHT_QUOTE_ID: "quote-test",
      BIDWRIGHT_AGENT_MODE: "build_estimate",
    },
    isWin: false,
    mcpConfigPath: join(projectDir, ".bidwright-mcp-config.json"),
    agentHomeDir: null,
  };

  try {
    const plan = await openRouterAdapter.buildSpawnPlan(ctx);
    assert.equal(plan.extraEnv.OPENROUTER_API_KEY, "sk-or-test-secret");
    assert.equal(JSON.stringify(plan.args).includes("sk-or-test-secret"), false);
    assert.equal(JSON.stringify(plan.args).includes("test-mcp-token"), false);

    assert.equal(plan.promptHandling.kind, "positional");
    if (plan.promptHandling.kind !== "positional") {
      throw new Error("Unexpected broker prompt handling.");
    }
    const requestPath = plan.args[plan.promptHandling.index];
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    assert.equal(request.transport, "codex-app-server");
    assert.equal(request.model, "~openai/gpt-latest");
    assert.equal(request.appServerArgs.includes('model_provider="openrouter"'), true);
    assert.equal(
      request.appServerArgs.includes(
        'model_providers.openrouter.base_url="https://openrouter.ai/api/v1"',
      ),
      true,
    );
    assert.equal(
      request.appServerArgs.includes(
        'model_providers.openrouter.env_key="OPENROUTER_API_KEY"',
      ),
      true,
    );
    assert.equal(
      request.appServerArgs.includes('model_providers.openrouter.wire_api="responses"'),
      true,
    );
    assert.equal(JSON.stringify(request).includes("sk-or-test-secret"), false);
    assert.equal(JSON.stringify(request).includes("test-mcp-token"), false);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("OpenRouter runtime accepts only OpenRouter-style model ids and API-key auth", () => {
  assert.equal(openRouterAdapter.normalizeModel("anthropic/claude-sonnet-4.6"), "anthropic/claude-sonnet-4.6");
  assert.equal(openRouterAdapter.normalizeModel("~openai/gpt-latest"), "~openai/gpt-latest");
  assert.equal(openRouterAdapter.normalizeModel("gpt-5.4"), "~openai/gpt-latest");
  assert.deepEqual(
    openRouterAdapter.checkAuth({ apiKeys: { openrouter: "sk-or-test" } }),
    { authenticated: true, method: "api_key" },
  );
});
