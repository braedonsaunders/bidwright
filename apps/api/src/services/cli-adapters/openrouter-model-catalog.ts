/**
 * Codex model catalog for OpenRouter-routed runs.
 *
 * Codex (rust-v0.160.1) resolves a model slug against its catalog; slugs it
 * does not know fall back to `model_info_from_slug()`: a 272,000-token window
 * (258,400 effective at 95%), auto-compaction at 90% of that, and tool results
 * truncated to 10,000 BYTES. `-c model_context_window=…` cannot raise the
 * window because `with_config_overrides()` clamps it to the entry's
 * `max_context_window`. The only knob that changes the entry itself is
 * `model_catalog_json`, which REPLACES the bundled catalog for the process.
 *
 * The checked-in catalog (`openrouter-model-catalog.json`) therefore carries
 * one FULL ModelInfo per slug we route. Non-OpenAI entries are the fallback
 * entry with only slug, display name, window, and truncation changed, so no
 * tool-surface or prompting flags change by accident. The known OpenAI entry
 * keeps its bundled capabilities. `buildOpenRouterCatalogEntry()` lets the
 * adapter mint the same shape for a slug that is not checked in.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the checked-in catalog (pass to `-c model_catalog_json=`). */
export const OPENROUTER_MODEL_CATALOG_PATH = path.join(here, "openrouter-model-catalog.json");
/** Absolute path of the single-entry template used for slugs that are not checked in. */
export const OPENROUTER_MODEL_CATALOG_TEMPLATE_PATH = path.join(here, "openrouter-model-catalog.template.json");

/** Codex's unknown-slug fallback window (models-manager/src/model_info.rs::model_info_from_slug). */
export const CODEX_FALLBACK_CONTEXT_WINDOW = 272_000;
/** Codex's unknown-slug fallback truncation: 10,000 bytes. */
export const CODEX_FALLBACK_TRUNCATION = { mode: "bytes", limit: 10_000 } as const;
/** Default truncation for our entries: generous enough for compacted MCP payloads. */
export const DEFAULT_OPENROUTER_TRUNCATION = { mode: "tokens", limit: 50_000 } as const;

export interface CodexTruncationPolicy {
  mode: "bytes" | "tokens";
  limit: number;
}

/** The subset of Codex `ModelInfo` fields this module reads or writes. Other fields pass through untouched. */
export interface CodexModelInfo {
  slug: string;
  display_name: string;
  context_window?: number | null;
  max_context_window?: number | null;
  auto_compact_token_limit?: number | null;
  effective_context_window_percent?: number;
  truncation_policy: CodexTruncationPolicy;
  shell_type: string;
  visibility: string;
  supported_in_api: boolean;
  priority: number;
  supported_reasoning_levels: unknown[];
  support_verbosity: boolean;
  experimental_supported_tools: string[];
  supports_image_detail_original?: boolean;
  tool_mode?: string | null;
  use_responses_lite?: boolean;
  model_messages?: { instructions_template?: string | null } & Record<string, unknown>;
  [key: string]: unknown;
}

export interface CodexModelsResponse {
  models: CodexModelInfo[];
}

/** Keys serde requires on every ModelInfo (no `#[serde(default)]`, not Option). */
export const CODEX_MODEL_INFO_REQUIRED_KEYS = [
  "slug",
  "display_name",
  "supported_reasoning_levels",
  "shell_type",
  "visibility",
  "supported_in_api",
  "priority",
  "support_verbosity",
  "truncation_policy",
  "experimental_supported_tools",
] as const;

let cachedCatalog: CodexModelsResponse | null = null;
let cachedTemplate: CodexModelInfo | null = null;

export function loadOpenRouterModelCatalog(): CodexModelsResponse {
  if (!cachedCatalog) cachedCatalog = JSON.parse(readFileSync(OPENROUTER_MODEL_CATALOG_PATH, "utf8")) as CodexModelsResponse;
  return cachedCatalog;
}

/** The fallback-shaped template entry (slug/window placeholders unfilled). */
export function loadOpenRouterCatalogTemplate(): CodexModelInfo {
  if (!cachedTemplate) {
    const parsed = JSON.parse(readFileSync(OPENROUTER_MODEL_CATALOG_TEMPLATE_PATH, "utf8")) as CodexModelsResponse;
    cachedTemplate = parsed.models[0];
  }
  return cachedTemplate;
}

export function catalogHasSlug(slug: string, catalog: CodexModelsResponse = loadOpenRouterModelCatalog()): boolean {
  return catalog.models.some((model) => model.slug === slug);
}

export interface BuildCatalogEntryInput {
  /** Exact OpenRouter slug Codex will be started with, e.g. "anthropic/claude-opus-5.5". */
  slug: string;
  /** Real context window in tokens (OpenRouter `context_length`). */
  contextWindow: number;
  displayName?: string;
  /** Explicit truncation; defaults to tokens 50,000. */
  truncation?: CodexTruncationPolicy;
  /** Leave unset to let Codex derive 90% of the window; a value above 90% is clamped by Codex anyway. */
  autoCompactTokenLimit?: number | null;
  /**
   * Only set true when the provider is known to accept `detail: "original"`
   * image inputs. Vision support alone does not establish this.
   */
  supportsImageDetailOriginal?: boolean;
}

/**
 * Mint a catalog entry for a slug that is not checked in, preserving the
 * unknown-slug fallback's capabilities and base instructions. Only slug,
 * display name, window, truncation, and (opt-in) image detail change.
 */
export function buildOpenRouterCatalogEntry(input: BuildCatalogEntryInput, template: CodexModelInfo = loadOpenRouterCatalogTemplate()): CodexModelInfo {
  const slug = input.slug.trim();
  if (!slug) throw new Error("buildOpenRouterCatalogEntry: slug is required");
  const window = Math.trunc(Number(input.contextWindow));
  if (!Number.isFinite(window) || window < 1_000) throw new Error(`buildOpenRouterCatalogEntry: contextWindow must be a token count >= 1000 (got ${input.contextWindow})`);
  const entry: CodexModelInfo = JSON.parse(JSON.stringify(template));
  entry.slug = slug;
  entry.display_name = input.displayName?.trim() || `${slug} (OpenRouter)`;
  entry.context_window = window;
  entry.max_context_window = window;
  entry.auto_compact_token_limit = input.autoCompactTokenLimit === undefined ? null : input.autoCompactTokenLimit;
  entry.truncation_policy = { ...(input.truncation ?? DEFAULT_OPENROUTER_TRUNCATION) };
  entry.supports_image_detail_original = input.supportsImageDetailOriginal === true;
  return entry;
}

/**
 * Catalog for one session: the checked-in catalog plus a minted entry when the
 * session's slug is not present. Codex requires at least one model and the
 * exact slug must resolve, otherwise it silently regresses to the fallback.
 */
export function catalogForSession(slug: string, contextWindow: number | null | undefined, options: Omit<BuildCatalogEntryInput, "slug" | "contextWindow"> = {}): CodexModelsResponse {
  const base = loadOpenRouterModelCatalog();
  if (catalogHasSlug(slug, base)) return base;
  if (!contextWindow) return base; // caller must decide; without a window we cannot mint a truthful entry
  return { models: [...base.models, buildOpenRouterCatalogEntry({ slug, contextWindow, ...options })] };
}

/** Effective limits Codex will derive from an entry — for tests and for the token-usage check after deploy. */
export function expectedCodexLimits(entry: CodexModelInfo): { fullWindowLimit: number; autoCompactLimit: number } {
  const window = Number(entry.context_window ?? entry.max_context_window ?? 0);
  const pct = Number(entry.effective_context_window_percent ?? 95);
  const ninety = Math.floor((window * 9) / 10);
  const configured = entry.auto_compact_token_limit;
  return {
    fullWindowLimit: Math.floor((window * pct) / 100),
    autoCompactLimit: configured === null || configured === undefined ? ninety : Math.min(Number(configured), ninety),
  };
}

/** Structural validation mirroring serde's required fields and enum values. */
export function validateCodexModelInfo(entry: CodexModelInfo): string[] {
  const problems: string[] = [];
  for (const key of CODEX_MODEL_INFO_REQUIRED_KEYS) {
    if (!(key in entry)) problems.push(`missing required key '${key}'`);
  }
  if (!["unified_exec", "disabled", "default", "local", "shell_command"].includes(String(entry.shell_type))) problems.push(`shell_type '${entry.shell_type}' is not a ConfigShellToolType`);
  if (!["list", "hide", "none"].includes(String(entry.visibility))) problems.push(`visibility '${entry.visibility}' is not a ModelVisibility`);
  if (!entry.truncation_policy || !["bytes", "tokens"].includes(entry.truncation_policy.mode) || !Number.isFinite(entry.truncation_policy.limit) || entry.truncation_policy.limit <= 0) problems.push("truncation_policy must be {mode: bytes|tokens, limit > 0}");
  const window = entry.context_window ?? entry.max_context_window;
  if (!Number.isFinite(Number(window)) || Number(window) <= 0) problems.push("context_window/max_context_window must be a positive token count");
  if (entry.max_context_window !== undefined && entry.max_context_window !== null && entry.context_window !== undefined && entry.context_window !== null && Number(entry.context_window) > Number(entry.max_context_window)) problems.push("context_window exceeds max_context_window (Codex clamps to max)");
  if (entry.auto_compact_token_limit !== undefined && entry.auto_compact_token_limit !== null && Number(entry.auto_compact_token_limit) > Math.floor((Number(window) * 9) / 10)) problems.push("auto_compact_token_limit above 90% of the window is clamped by Codex; lower it or leave null");
  return problems;
}
