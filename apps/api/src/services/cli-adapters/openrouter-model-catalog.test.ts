import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CODEX_FALLBACK_CONTEXT_WINDOW,
  CODEX_FALLBACK_TRUNCATION,
  OPENROUTER_MODEL_CATALOG_PATH,
  buildOpenRouterCatalogEntry,
  catalogForSession,
  catalogHasSlug,
  expectedCodexLimits,
  loadOpenRouterCatalogTemplate,
  loadOpenRouterModelCatalog,
  validateCodexModelInfo,
} from "./openrouter-model-catalog.js";

/**
 * Guards the catalog against the two production defects measured on the
 * 2026-10-07 matrix (rust-v0.160.1): unknown OpenRouter slugs fell back to a
 * 272k window (258,400 effective) and 10,000-BYTE tool-result truncation, and
 * `-c model_context_window` could not raise the window because Codex clamps it
 * to the catalog entry's max_context_window.
 */

const ROUTED_SLUGS = [
  "anthropic/claude-opus-5.5",
  "anthropic/claude-sonnet-5.5",
  "moonshotai/kimi-k3",
  "google/gemini-3.1-pro-preview",
  "openai/gpt-6.1-sol",
];

// Fallback flags from model_info_from_slug(); non-OpenAI entries must keep ALL of them.
const FALLBACK_CAPABILITY_FLAGS: Record<string, unknown> = {
  shell_type: "unified_exec",
  visibility: "none",
  supported_in_api: true,
  priority: 99,
  include_skills_usage_instructions: false,
  include_plugin_usage_instructions: false,
  include_apps_usage_instructions: false,
  supports_reasoning_summary_parameter: true,
  default_reasoning_summary: "auto",
  support_verbosity: false,
  default_verbosity: null,
  apply_patch_tool_type: null,
  web_search_tool_type: "text",
  supports_image_detail_original: false,
  effective_context_window_percent: 95,
  supports_search_tool: false,
  supports_experimental_context: false,
  use_responses_lite: false,
  supports_reasoning_effort_updates: false,
  node_repl_auto_review_required: false,
  node_repl_disabled: false,
};

test("the checked-in catalog parses as a ModelsResponse and covers every routed slug", () => {
  const catalog = loadOpenRouterModelCatalog();
  assert.ok(Array.isArray(catalog.models) && catalog.models.length >= 1, "Codex requires at least one model");
  for (const slug of ROUTED_SLUGS) assert.ok(catalogHasSlug(slug, catalog), `missing ${slug}`);
  const raw = JSON.parse(readFileSync(OPENROUTER_MODEL_CATALOG_PATH, "utf8"));
  assert.deepEqual(Object.keys(raw), ["models"], "top level is exactly {models}");
});

test("every entry satisfies serde's required keys and enum values", () => {
  for (const entry of loadOpenRouterModelCatalog().models) {
    assert.deepEqual(validateCodexModelInfo(entry), [], `${entry.slug}: ${validateCodexModelInfo(entry).join("; ")}`);
  }
});

test("windows are real and above the fallback; nothing is left to the 272k default", () => {
  const expected: Record<string, number> = {
    "anthropic/claude-opus-5.5": 1_000_000,
    "anthropic/claude-sonnet-5.5": 1_000_000,
    "moonshotai/kimi-k3": 1_048_576,
    "google/gemini-3.1-pro-preview": 1_048_576,
    "openai/gpt-6.1-sol": 872_000, // the bundled gpt-6.1-sol entry's own max_context_window at rust-v0.160.1
  };
  for (const entry of loadOpenRouterModelCatalog().models) {
    assert.equal(entry.context_window, expected[entry.slug], `${entry.slug} context_window`);
    assert.equal(entry.max_context_window, expected[entry.slug], `${entry.slug} max_context_window must equal context_window so -c cannot be clamped below it`);
    assert.ok(Number(entry.context_window) > CODEX_FALLBACK_CONTEXT_WINDOW);
    assert.equal(entry.auto_compact_token_limit, null, "derive 90% of the window");
  }
});

test("truncation is explicit and no longer the fallback's 10,000 bytes", () => {
  for (const entry of loadOpenRouterModelCatalog().models) {
    assert.deepEqual(entry.truncation_policy, { mode: "tokens", limit: 50_000 }, entry.slug);
    assert.notDeepEqual(entry.truncation_policy, CODEX_FALLBACK_TRUNCATION);
  }
});

test("non-OpenAI entries keep the unknown-slug fallback capabilities and base instructions", () => {
  const template = loadOpenRouterCatalogTemplate();
  for (const entry of loadOpenRouterModelCatalog().models.filter((model) => !model.slug.startsWith("openai/"))) {
    for (const [key, value] of Object.entries(FALLBACK_CAPABILITY_FLAGS)) {
      assert.deepEqual(entry[key], value, `${entry.slug}.${key}`);
    }
    assert.equal(entry.tool_mode ?? null, null, `${entry.slug}: no code mode`);
    assert.equal(entry.multi_agent_version ?? null, null);
    assert.deepEqual(entry.experimental_supported_tools, []);
    assert.deepEqual(entry.supported_reasoning_levels, []);
    const instructions = String(entry.model_messages?.instructions_template ?? "");
    assert.ok(instructions.startsWith("You are a coding agent running in the Codex CLI"), `${entry.slug}: base prompt.md instructions retained`);
    assert.equal(instructions, template.model_messages?.instructions_template, "identical to the template's fallback instructions");
  }
});

test("the known OpenAI entry retains its bundled capabilities rather than the fallback shape", () => {
  const gpt = loadOpenRouterModelCatalog().models.find((model) => model.slug === "openai/gpt-6.1-sol")!;
  assert.equal(gpt.tool_mode, "code_mode_only");
  assert.equal(gpt.use_responses_lite, true);
  assert.equal(gpt.shell_type, "shell_command");
  assert.equal(gpt.supports_image_detail_original, true);
  assert.ok(!("available_in_plans" in gpt), "plan gating removed off-platform");
});

test("expected Codex limits reproduce the measured production numbers and the new ones", () => {
  // Measured: fallback 272k × 0.95 = 258,400; bundled gpt-6.1-sol max 872k × 0.95 = 828,400.
  assert.deepEqual(expectedCodexLimits({ ...loadOpenRouterCatalogTemplate(), context_window: 272_000, max_context_window: 272_000, auto_compact_token_limit: 800_000 }), { fullWindowLimit: 258_400, autoCompactLimit: 244_800 });
  assert.equal(expectedCodexLimits({ ...loadOpenRouterCatalogTemplate(), context_window: 872_000, max_context_window: 872_000 }).fullWindowLimit, 828_400);
  const opus = loadOpenRouterModelCatalog().models.find((model) => model.slug === "anthropic/claude-opus-5.5")!;
  assert.deepEqual(expectedCodexLimits(opus), { fullWindowLimit: 950_000, autoCompactLimit: 900_000 });
});

test("buildOpenRouterCatalogEntry mints a fallback-shaped entry for an unknown slug and refuses bad input", () => {
  const entry = buildOpenRouterCatalogEntry({ slug: "mistralai/mistral-large-3", contextWindow: 262_144 });
  assert.equal(entry.slug, "mistralai/mistral-large-3");
  assert.equal(entry.display_name, "mistralai/mistral-large-3 (OpenRouter)");
  assert.equal(entry.context_window, 262_144);
  assert.equal(entry.max_context_window, 262_144);
  assert.equal(entry.auto_compact_token_limit, null);
  assert.deepEqual(entry.truncation_policy, { mode: "tokens", limit: 50_000 });
  assert.equal(entry.supports_image_detail_original, false, "vision support alone does not establish image detail original");
  for (const [key, value] of Object.entries(FALLBACK_CAPABILITY_FLAGS)) assert.deepEqual(entry[key], value, key);
  assert.deepEqual(validateCodexModelInfo(entry), []);
  const explicit = buildOpenRouterCatalogEntry({ slug: "x/y", contextWindow: 100_000, supportsImageDetailOriginal: true, truncation: { mode: "bytes", limit: 200_000 }, displayName: "Y" });
  assert.equal(explicit.supports_image_detail_original, true);
  assert.deepEqual(explicit.truncation_policy, { mode: "bytes", limit: 200_000 });
  assert.equal(explicit.display_name, "Y");
  assert.throws(() => buildOpenRouterCatalogEntry({ slug: " ", contextWindow: 100_000 }), /slug is required/);
  assert.throws(() => buildOpenRouterCatalogEntry({ slug: "x/y", contextWindow: 10 }), /contextWindow/);
});

test("catalogForSession appends an unknown slug and leaves known ones alone", () => {
  const known = catalogForSession("moonshotai/kimi-k3", 1_048_576);
  assert.equal(known.models.length, loadOpenRouterModelCatalog().models.length);
  const extended = catalogForSession("deepseek/deepseek-v4-pro", 163_840);
  assert.equal(extended.models.length, loadOpenRouterModelCatalog().models.length + 1);
  assert.ok(catalogHasSlug("deepseek/deepseek-v4-pro", extended));
  const noWindow = catalogForSession("deepseek/deepseek-v4-pro", null);
  assert.ok(!catalogHasSlug("deepseek/deepseek-v4-pro", noWindow), "no truthful window → nothing is minted");
});

test("validateCodexModelInfo catches the clamp traps", () => {
  const template = loadOpenRouterCatalogTemplate();
  assert.ok(validateCodexModelInfo({ ...template, context_window: 1_000_000, max_context_window: 272_000 }).some((p) => /exceeds max_context_window/.test(p)));
  assert.ok(validateCodexModelInfo({ ...template, context_window: 1_000_000, max_context_window: 1_000_000, auto_compact_token_limit: 950_000 }).some((p) => /above 90%/.test(p)));
  const { truncation_policy: _t, ...noTrunc } = template;
  assert.ok(validateCodexModelInfo(noTrunc as any).some((p) => /truncation_policy/.test(p)));
});
