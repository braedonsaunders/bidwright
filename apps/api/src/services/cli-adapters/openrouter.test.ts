import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openRouterAdapter } from "./openrouter.js";
import type { SpawnCtx } from "./types.js";
import { buildOpenRouterModelCatalog, writeOpenRouterModelCatalog } from "./openrouter-model-catalog.js";

test("OpenRouter uses Codex App Server config without putting the API key in argv", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "bidwright-openrouter-adapter-"));
  const fakeCodex = join(projectDir, "codex");
  await writeFile(fakeCodex, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{
      id: "openai/gpt-6.1-sol",
      context_length: 1_050_000,
      top_provider: { context_length: 1_050_000 },
    }],
  }));

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
    assert.equal(request.model, "openai/gpt-6.1-sol");
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
    assert.equal(request.appServerArgs.includes("model_context_window=1050000"), true);
    assert.equal(request.suppressUnknownModelMetadataWarning, false);
    const catalogArgument = request.appServerArgs.find((arg: string) => arg.startsWith("model_catalog_json="));
    assert.ok(catalogArgument);
    const catalogPath = JSON.parse(catalogArgument.slice("model_catalog_json=".length));
    const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    const selected = catalog.models.find((entry: { slug: string }) => entry.slug === request.model);
    assert.equal(selected.max_context_window, 1_050_000);
    assert.deepEqual(selected.truncation_policy, { mode: "bytes", limit: 200_000 });
    assert.equal(JSON.stringify(catalog).includes("sk-or-test-secret"), false);
    assert.equal(JSON.stringify(request).includes("sk-or-test-secret"), false);
    assert.equal(JSON.stringify(request).includes("test-mcp-token"), false);

    const qaPlan = await openRouterAdapter.buildSpawnPlan({ ...ctx, mcpEnv: { ...ctx.mcpEnv, BIDWRIGHT_AGENT_MODE: "qa" } });
    const qaRequest = JSON.parse(await readFile(qaPlan.args[qaPlan.promptHandling.index], "utf8"));
    assert.equal(qaRequest.readOnly, undefined);
    assert.ok(qaRequest.appServerArgs.includes('mcp_servers.bidwright.default_tools_approval_mode="approve"'));
    assert.ok(!qaRequest.appServerArgs.some((arg: string) => arg.includes("tools.updateWorksheetItem.")));

    // New/default sessions still start if metadata is temporarily unavailable;
    // the retired alias is translated to an exact model with verified metadata.
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    for (const model of [undefined, "~openai/gpt-latest"]) {
      const defaultPlan = await openRouterAdapter.buildSpawnPlan({ ...ctx, model });
      const defaultRequest = JSON.parse(await readFile(defaultPlan.args[defaultPlan.promptHandling.index], "utf8"));
      assert.equal(defaultRequest.model, "openai/gpt-6.1-sol");
      assert.ok(defaultRequest.appServerArgs.includes("model_context_window=1050000"));
    }

  } finally {
    globalThis.fetch = originalFetch;
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("OpenRouter runtime accepts only OpenRouter-style model ids and API-key auth", () => {
  assert.equal(openRouterAdapter.normalizeModel("anthropic/claude-sonnet-4.6"), "anthropic/claude-sonnet-4.6");
  assert.equal(openRouterAdapter.normalizeModel("~openai/gpt-latest"), "openai/gpt-6.1-sol");
  assert.equal(openRouterAdapter.normalizeModel("gpt-5.4"), "openai/gpt-6.1-sol");
  assert.equal(openRouterAdapter.normalizeModel(undefined), "openai/gpt-6.1-sol");
  assert.equal(openRouterAdapter.defaultModel, "openai/gpt-6.1-sol");
  assert.deepEqual(
    openRouterAdapter.checkAuth({ apiKeys: { openrouter: "sk-or-test" } }),
    { authenticated: true, method: "api_key" },
  );
});

test("OpenRouter supplies catalog metadata for arbitrary exact model ids", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "bidwright-openrouter-metadata-"));
  const fakeCodex = join(projectDir, "codex");
  await writeFile(fakeCodex, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{
      id: "moonshotai/kimi-k3",
      context_length: 1_048_576,
      top_provider: { context_length: 1_048_576 },
    }],
  }));

  try {
    const plan = await openRouterAdapter.buildSpawnPlan({
      projectDir,
      prompt: "verify Kimi metadata",
      model: "moonshotai/kimi-k3",
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
    });
    const requestPath = plan.args[plan.promptHandling.index];
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    assert.equal(request.suppressUnknownModelMetadataWarning, false);
    assert.equal(request.appServerArgs.includes("model_context_window=1048576"), true);
    assert.equal(request.appServerArgs.includes("model_auto_compact_token_limit=838860"), true);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("OpenRouter catalog raises actual maximums without borrowing GPT capabilities", () => {
  for (const model of ["anthropic/claude-opus-5.5", "moonshotai/kimi-k3", "new-provider/new-image-model"]) {
    const { catalog } = buildOpenRouterModelCatalog(model, 1_000_000);
    const selected = catalog.models[0];
    assert.equal(selected.slug, model);
    assert.equal(selected.context_window, 1_000_000);
    assert.equal(selected.max_context_window, 1_000_000);
    assert.equal(selected.effective_context_window_percent, 95);
    assert.equal(selected.auto_compact_token_limit, null);
    assert.equal(selected.shell_type, "unified_exec");
    assert.equal(selected.use_responses_lite, false);
    assert.equal(selected.supports_image_detail_original, false);
    assert.equal(selected.tool_mode, undefined);
    assert.ok(selected.model_messages);
    assert.deepEqual(selected.experimental_supported_tools, []);
  }
  const gpt = buildOpenRouterModelCatalog("openai/gpt-6.1-sol", 1_050_000).catalog.models[0];
  assert.equal(gpt.tool_mode, "code_mode_only");
  assert.equal(gpt.use_responses_lite, true);
  assert.equal(gpt.max_context_window, 1_050_000);
  // Codex only strips a simple provider namespace, never an alias or nested path.
  assert.equal(buildOpenRouterModelCatalog("~openai/gpt-6.1-sol", 1_050_000).catalog.models[0].use_responses_lite, false);
  assert.equal(buildOpenRouterModelCatalog("org/path/gpt-6.1-sol", 1_050_000).catalog.models[0].use_responses_lite, false);
});

test("OpenRouter uses known windows during metadata outages and rejects unknown windows", () => {
  assert.equal(buildOpenRouterModelCatalog("anthropic/claude-opus-5.5").contextWindow, 1_000_000);
  assert.equal(buildOpenRouterModelCatalog("anthropic/claude-opus-5.5", 500_000).contextWindow, 500_000);
  for (const invalid of [0, -1, NaN, 1.2, Infinity]) {
    assert.throws(() => buildOpenRouterModelCatalog("unknown/model", invalid), /Cannot determine/);
  }
  assert.throws(() => buildOpenRouterModelCatalog("unknown/model"), /Cannot determine/);
  assert.equal(buildOpenRouterModelCatalog("~openai/gpt-mini-latest").contextWindow, 400_000);
  assert.equal(buildOpenRouterModelCatalog("~anthropic/claude-opus-latest").contextWindow, 1_000_000);
});

test("OpenRouter catalogs are immutable across models and complete during concurrent starts", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "bidwright-openrouter-catalog-"));
  try {
    const [opus, opusAgain, kimi] = await Promise.all([
      writeOpenRouterModelCatalog(projectDir, "anthropic/claude-opus-5.5"),
      writeOpenRouterModelCatalog(projectDir, "anthropic/claude-opus-5.5"),
      writeOpenRouterModelCatalog(projectDir, "moonshotai/kimi-k3"),
    ]);
    assert.equal(opus.path, opusAgain.path);
    assert.notEqual(opus.path, kimi.path);
    assert.equal(JSON.parse(await readFile(opus.path, "utf8")).models[0].slug, "anthropic/claude-opus-5.5");
    assert.equal(JSON.parse(await readFile(kimi.path, "utf8")).models[0].max_context_window, 1_048_576);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});
