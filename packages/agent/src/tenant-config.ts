import type { ProviderConfig } from "./types.js";

export type TenantAiProvider = "anthropic" | "openai" | "openrouter" | "gemini" | "lmstudio";

export interface TenantAiConfig extends ProviderConfig {
  provider: TenantAiProvider;
  apiKey: string;
}

const PROVIDERS: Array<{
  provider: TenantAiProvider;
  key: string;
  defaultModel: string;
}> = [
  { provider: "anthropic", key: "anthropicKey", defaultModel: "claude-sonnet-4-20250514" },
  { provider: "openai", key: "openaiKey", defaultModel: "gpt-4o" },
  { provider: "openrouter", key: "openrouterKey", defaultModel: "anthropic/claude-sonnet-4" },
  { provider: "gemini", key: "geminiKey", defaultModel: "gemini-2.5-pro" },
];

/**
 * Resolve a provider from the already-unsealed effective tenant integrations.
 * This deliberately has no environment-variable fallback: server credentials
 * belong to the tenant and are selected in Settings → AI Providers.
 */
export function resolveTenantAiConfig(
  integrations: Record<string, unknown> | null | undefined,
): TenantAiConfig | null {
  if (!integrations) return null;

  const preferred = typeof integrations.llmProvider === "string"
    ? integrations.llmProvider.trim().toLowerCase()
    : "";
  const candidates = [
    ...PROVIDERS.filter((entry) => entry.provider === preferred),
    ...PROVIDERS.filter((entry) => entry.provider !== preferred),
  ];

  for (const candidate of candidates) {
    const apiKey = readString(integrations[candidate.key]);
    if (!apiKey) continue;
    return {
      provider: candidate.provider,
      apiKey,
      model: readString(integrations.llmModel) || candidate.defaultModel,
    };
  }

  if (preferred === "lmstudio") {
    return {
      provider: "lmstudio",
      apiKey: readString(integrations.lmstudioApiKey) || "local",
      model: readString(integrations.llmModel) || "local-model",
      baseUrl: readString(integrations.lmstudioBaseUrl) || "http://host.docker.internal:1234/v1",
    };
  }

  return null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
