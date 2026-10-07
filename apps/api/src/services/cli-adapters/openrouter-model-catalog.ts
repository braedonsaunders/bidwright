import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import templates from "./openrouter-model-catalog.json" with { type: "json" };

// Pinned to the Codex version in Dockerfile.api. Preserve the bundled tool and
// instruction capabilities: importing a GPT descriptor for Claude/Kimi would
// silently switch them to GPT-specific code mode and Responses Lite.
type ModelInfo = Record<string, unknown> & { slug: string };
const bundled = templates.models as ModelInfo[];
const knownWindows: Record<string, number> = templates.knownContextWindows;
export const OPENROUTER_TOOL_OUTPUT_BYTES = 200_000;

export function buildOpenRouterModelCatalog(model: string, liveContextWindow?: number) {
  const contextWindow = liveContextWindow ?? knownWindows[model];
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) {
    throw new Error(`Cannot determine the context window for OpenRouter model ${model}. Retry the model metadata request or select a known exact model ID.`);
  }
  // Match Codex's longest-prefix, then one-provider-prefix-stripped lookup.
  const match = (slug: string) => bundled
    .filter((entry) => slug.startsWith(entry.slug))
    .sort((a, b) => b.slug.length - a.slug.length)[0];
  const namespaced = /^([A-Za-z0-9_-]+)\/([^/]+)$/.exec(model);
  const base = match(model) ?? (namespaced ? match(namespaced[2]) : undefined) ?? templates.fallback;
  const selected: ModelInfo = {
    ...structuredClone(base),
    slug: model,
    display_name: model,
    context_window: contextWindow,
    max_context_window: contextWindow,
    effective_context_window_percent: 95,
    auto_compact_token_limit: null,
    truncation_policy: { mode: "bytes", limit: OPENROUTER_TOOL_OUTPUT_BYTES },
  };
  return { contextWindow, catalog: { models: [selected, ...bundled.filter((entry) => entry.slug !== model)] } };
}

export async function writeOpenRouterModelCatalog(projectDir: string, model: string, liveContextWindow?: number) {
  const { contextWindow, catalog } = buildOpenRouterModelCatalog(model, liveContextWindow);
  const bytes = JSON.stringify(catalog);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const directory = resolve(projectDir, ".bidwright", "runtime-broker");
  await mkdir(directory, { recursive: true });
  // Immutable content-addressed files avoid concurrent run/resume overwrites.
  // They stay in the project workdir for the lifetime of the app-server.
  const path = resolve(directory, `openrouter-catalog-${digest}.json`);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, bytes, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return { path, contextWindow };
}
