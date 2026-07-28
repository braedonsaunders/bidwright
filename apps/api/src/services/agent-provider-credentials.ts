import { getBidwrightMode, type BidwrightMode } from "./agent-home.js";

export interface AgentProviderKeys {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  openrouterApiKey?: string;
}

interface ResolveAgentProviderKeysOptions {
  deploymentMode?: BidwrightMode;
  environment?: NodeJS.ProcessEnv;
}

function configuredString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Resolve credentials for agent runtimes.
 *
 * Server deployments are tenant-configured only: effective integrations have
 * already applied the personal override -> organization default chain. Host
 * environment credentials are deliberately ignored so one deployment secret
 * cannot silently become every tenant's provider identity.
 *
 * Desktop mode retains environment fallback for local developer workflows.
 */
export function resolveAgentProviderKeys(
  integrations: Record<string, unknown>,
  options: ResolveAgentProviderKeysOptions = {},
): AgentProviderKeys {
  const deploymentMode = options.deploymentMode ?? getBidwrightMode();
  const environment = options.environment ?? process.env;
  const allowEnvironmentFallback = deploymentMode === "desktop";

  return {
    anthropicApiKey:
      configuredString(integrations.anthropicKey) ||
      (allowEnvironmentFallback ? configuredString(environment.ANTHROPIC_API_KEY) : undefined),
    openaiApiKey:
      configuredString(integrations.openaiKey) ||
      (allowEnvironmentFallback ? configuredString(environment.OPENAI_API_KEY) : undefined),
    googleApiKey:
      configuredString(integrations.geminiKey) ||
      (allowEnvironmentFallback
        ? configuredString(environment.GOOGLE_API_KEY) ||
          configuredString(environment.GEMINI_API_KEY)
        : undefined),
    openrouterApiKey:
      configuredString(integrations.openrouterKey) ||
      (allowEnvironmentFallback ? configuredString(environment.OPENROUTER_API_KEY) : undefined),
  };
}

export function resolveRuntimeProviderKey(
  runtime: string,
  keys: AgentProviderKeys,
): string | undefined {
  if (runtime === "claude-code") return keys.anthropicApiKey;
  if (runtime === "codex") return keys.openaiApiKey;
  if (runtime === "openrouter") return keys.openrouterApiKey;
  if (runtime === "gemini") return keys.googleApiKey;
  if (runtime === "opencode") {
    return (
      keys.anthropicApiKey ||
      keys.openrouterApiKey ||
      keys.openaiApiKey ||
      keys.googleApiKey
    );
  }
  return undefined;
}
