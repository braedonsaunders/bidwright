/**
 * OpenRouter adapter backed by Codex App Server.
 *
 * OpenRouter exposes an OpenAI-compatible Responses API and documents Codex
 * CLI as a supported client. Keeping this as a separate runtime makes the
 * provider choice explicit in settings while reusing Codex's proven agent
 * loop, MCP support, session/resume protocol, and AppKit process sandbox.
 *
 * The provider key is passed only through the child environment. The Codex
 * config overrides contain the environment variable name, never its value.
 */

import type {
  CliAdapter,
  CliAuthStatus,
  CliModelOption,
  ResumeCtx,
  SpawnCtx,
  SpawnPlan,
} from "./types.js";
import { codexAdapter } from "./codex.js";
import { createRuntimeBrokerPlan } from "../runtime-broker.js";

const DEFAULT_MODEL = "~openai/gpt-latest";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const MODEL_METADATA_TIMEOUT_MS = 5_000;

interface OpenRouterModelMetadata {
  contextWindow: number;
}

const OPENROUTER_ALIAS_MODELS: CliModelOption[] = [
  {
    id: DEFAULT_MODEL,
    name: "OpenAI GPT Latest",
    description: "OpenRouter's current GPT agent alias",
    isDefault: true,
  },
  {
    id: "~openai/gpt-mini-latest",
    name: "OpenAI GPT Mini Latest",
    description: "Lower-cost OpenRouter GPT agent alias",
  },
  {
    id: "~anthropic/claude-sonnet-latest",
    name: "Claude Sonnet Latest",
    description: "OpenRouter's current Claude Sonnet alias",
  },
  {
    id: "~anthropic/claude-opus-latest",
    name: "Claude Opus Latest",
    description: "OpenRouter's current Claude Opus alias",
  },
  {
    id: "~google/gemini-pro-latest",
    name: "Gemini Pro Latest",
    description: "OpenRouter's current Gemini Pro alias",
  },
  {
    id: "~moonshotai/kimi-latest",
    name: "Kimi Latest",
    description: "OpenRouter's current Kimi agent alias",
  },
];

function isOpenRouterModelId(model: string): boolean {
  const value = model.trim();
  return value.startsWith("~") || value.includes("/");
}

function buildMcpConfigArgs(ctx: SpawnCtx): string[] {
  const envNames = Object.keys(ctx.mcpEnv);
  return [
    "-c",
    `mcp_servers.bidwright.command=${JSON.stringify(ctx.mcpRunner)}`,
    "-c",
    `mcp_servers.bidwright.args=${JSON.stringify(ctx.mcpArgs)}`,
    "-c",
    `mcp_servers.bidwright.env_vars=${JSON.stringify(envNames)}`,
  ];
}

function buildOpenRouterProviderArgs(metadata?: OpenRouterModelMetadata): string[] {
  const args = [
    "-c",
    'model_provider="openrouter"',
    "-c",
    'model_providers.openrouter.name="OpenRouter"',
    "-c",
    'model_providers.openrouter.base_url="https://openrouter.ai/api/v1"',
    "-c",
    'model_providers.openrouter.env_key="OPENROUTER_API_KEY"',
    "-c",
    'model_providers.openrouter.wire_api="responses"',
  ];
  if (metadata) {
    args.push(
      "-c",
      `model_context_window=${metadata.contextWindow}`,
      "-c",
      `model_auto_compact_token_limit=${Math.floor(metadata.contextWindow * 0.8)}`,
    );
  }
  return args;
}

async function fetchOpenRouterModelMetadata(
  apiKey: string,
  model: string,
): Promise<OpenRouterModelMetadata | undefined> {
  // OpenRouter aliases are intentionally dynamic, so Codex's own fallback
  // metadata remains the safer choice for those. Exact provider/model slugs
  // can be resolved against OpenRouter's current model catalog.
  if (model.startsWith("~")) return undefined;

  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(MODEL_METADATA_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const data = await response.json() as {
      data?: Array<{
        id?: string;
        context_length?: number;
        top_provider?: { context_length?: number };
      }>;
    };
    const selected = data.data?.find((candidate) => candidate.id === model);
    const contextWindow = selected?.top_provider?.context_length ?? selected?.context_length;
    if (!Number.isSafeInteger(contextWindow) || Number(contextWindow) <= 0) return undefined;
    return { contextWindow: Number(contextWindow) };
  } catch {
    return undefined;
  }
}

function codexCommand(customPath?: string): string {
  const detected = codexAdapter.detect(customPath);
  if (!detected.available || !detected.path) {
    throw new Error("Codex CLI is required for the OpenRouter runtime.");
  }
  return detected.path;
}

async function buildPlan(ctx: SpawnCtx, resumeSessionId?: string): Promise<SpawnPlan> {
  const apiKey = ctx.apiKeys.openrouter;
  if (!apiKey) {
    throw new Error("The OpenRouter runtime requires an OpenRouter API key.");
  }
  const model = ctx.model || DEFAULT_MODEL;
  const modelMetadata = await fetchOpenRouterModelMetadata(apiKey, model);

  return createRuntimeBrokerPlan(
    {
      transport: "codex-app-server",
      projectDir: ctx.projectDir,
      prompt: ctx.prompt,
      model,
      reasoningEffort: ctx.reasoningEffort,
      resumeSessionId,
      codexCommand: codexCommand(ctx.customCliPath),
      appServerArgs: [
        ...buildOpenRouterProviderArgs(modelMetadata),
        ...buildMcpConfigArgs(ctx),
      ],
      suppressUnknownModelMetadataWarning: Boolean(modelMetadata),
    },
    { OPENROUTER_API_KEY: apiKey },
  );
}

export const openRouterAdapter: CliAdapter = {
  id: "openrouter",
  displayName: "OpenRouter (Codex)",
  installHint: "Codex CLI is required and is bundled in the Bidwright server image.",
  pathSettingKey: "codexPath",
  defaultModel: DEFAULT_MODEL,
  primaryInstructionFile: "AGENTS.md",
  instructionFiles: ["AGENTS.md", "codex.md"],
  // OpenRouter's Responses API is currently documented as beta.
  experimental: true,

  binaryNames(opts) {
    return codexAdapter.binaryNames(opts);
  },

  detect(customPath) {
    return codexAdapter.detect(customPath);
  },

  checkAuth({ apiKeys }): CliAuthStatus {
    if (apiKeys.openrouter) {
      return { authenticated: true, method: "api_key" };
    }
    return { authenticated: false, method: "none" };
  },

  isCompatibleModel(modelId) {
    return isOpenRouterModelId(modelId);
  },

  normalizeModel(modelId) {
    return modelId && isOpenRouterModelId(modelId) ? modelId : DEFAULT_MODEL;
  },

  async listModels() {
    return OPENROUTER_ALIAS_MODELS;
  },

  prepareWorkspace(ctx) {
    return codexAdapter.prepareWorkspace(ctx);
  },

  buildSpawnPlan(ctx) {
    return buildPlan(ctx);
  },

  buildResumePlan(ctx: ResumeCtx) {
    return buildPlan(ctx, ctx.sessionId);
  },

  defaultResumePrompt() {
    return codexAdapter.defaultResumePrompt();
  },

  parseEvent(parsed, state) {
    return codexAdapter.parseEvent(parsed, state);
  },

  extractSessionId(parsed) {
    return codexAdapter.extractSessionId(parsed);
  },

  isBenignStderr(line) {
    return codexAdapter.isBenignStderr(line);
  },

  shouldSuppressStderrLine(line, state) {
    return codexAdapter.shouldSuppressStderrLine?.(line, state) ?? {
      suppress: false,
      nextSuppressing: false,
    };
  },
};
