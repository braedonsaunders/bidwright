/**
 * OpenCode adapter (sst/opencode).
 *
 * EXPERIMENTAL: validate end-to-end against your installed `opencode`
 * version before relying on this in production. Hooks into the same
 * project-folder + MCP-server architecture as Claude Code.
 *
 * Wire-up assumptions (kept easy to tweak in one place):
 *   - Binary: `opencode`
 *   - Headless: `opencode run [flags] "<prompt>"` (prompt as last positional)
 *   - JSONL output: `--print-logs` emits structured event lines
 *   - Auto-approval: `--auto-approve`
 *   - Resume: `opencode run --continue` or `--session <id>`
 *   - Config: `<projectDir>/opencode.json` is read when cwd matches the project
 *   - MCP servers: registered under the top-level `mcp` key in `opencode.json`
 *   - Models: `<provider>/<model-id>` (e.g. `anthropic/claude-sonnet-4-5`)
 */

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  CliAdapter,
  CliAuthStatus,
  CliDetectResult,
  CliModelOption,
  ParserState,
  PrepareWorkspaceCtx,
  ResumeCtx,
  SSEEventData,
  SpawnCtx,
  SpawnPlan,
} from "./types.js";
import { getCliVersion, homeDir, resolveCliCommand } from "./shared.js";

const ADAPTER_ID = "opencode";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-5";

function getWindowsBinaryExtras(): string[] {
  if (process.platform !== "win32") return [];
  const appData =
    process.env.APPDATA || join(process.env.USERPROFILE || "", "AppData", "Roaming");
  const npmShim = join(appData, "npm", "opencode.cmd");
  return existsSync(npmShim) ? [npmShim] : [];
}

const STATIC_MODELS: CliModelOption[] = [
  {
    id: DEFAULT_MODEL,
    name: "Claude Sonnet 4.5 (via Anthropic)",
    description: "Default — strong general-purpose coding agent",
    isDefault: true,
  },
  {
    id: "anthropic/claude-opus-4-5",
    name: "Claude Opus 4.5 (via Anthropic)",
    description: "Most capable Anthropic model for complex reasoning",
  },
  {
    id: "openai/gpt-5",
    name: "GPT-5 (via OpenAI)",
    description: "Frontier OpenAI model",
  },
  {
    id: "openai/gpt-5-codex",
    name: "GPT-5 Codex (via OpenAI)",
    description: "OpenAI's coding-focused frontier model",
  },
  {
    id: "google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro (via Google)",
    description: "Google's frontier model",
  },
];

function isOpencodeModelId(model: string): boolean {
  // OpenCode models are <provider>/<model-id>; allow that or a bare known id.
  if (!model.trim()) return false;
  if (model.includes("/")) return true;
  return false;
}

async function writeOpencodeConfig(ctx: PrepareWorkspaceCtx): Promise<void> {
  const configPath = join(ctx.projectDir, "opencode.json");
  // Only write if missing — let users hand-customize without overwriting on resume.
  if (existsSync(configPath)) return;

  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      bidwright: {
        type: "local",
        command: [ctx.mcpRunner, ...ctx.mcpArgs],
        environment: ctx.mcpEnv,
      },
    },
  };

  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

function parseEvent(msg: any, state: ParserState): SSEEventData[] {
  const events: SSEEventData[] = [];

  // OpenCode's JSONL schema is provider-agnostic but commonly uses these tags.
  // The parser tries each shape in turn — unknown lines fall through silently.
  if (msg?.type === "session.started" || msg?.type === "session_started") {
    const sessionId = msg.session_id || msg.sessionId || msg.id;
    if (sessionId) {
      events.push({ type: "status", data: { status: "running", sessionId } });
    }
  } else if (msg?.type === "message" && msg.role === "assistant") {
    const content = typeof msg.content === "string" ? msg.content : msg.text;
    if (content) events.push({ type: "message", data: { role: "assistant", content } });
  } else if (msg?.type === "text" || msg?.role === "assistant") {
    const content = msg.content || msg.text;
    if (typeof content === "string") {
      events.push({ type: "message", data: { role: "assistant", content } });
    }
  } else if (msg?.type === "thinking" || msg?.type === "reasoning") {
    const content = msg.content || msg.text || msg.thinking;
    if (content) events.push({ type: "thinking", data: { content } });
  } else if (msg?.type === "tool_call" || msg?.type === "tool_use" || msg?.type === "tool.call") {
    const id = msg.id || msg.tool_use_id || msg.call_id;
    if (id) state.toolStartTimes.set(id, Date.now());
    events.push({
      type: "tool_call",
      data: {
        toolId: msg.name || msg.tool || msg.function,
        toolUseId: id,
        input: msg.input || msg.arguments || msg.parameters,
      },
    });
  } else if (msg?.type === "tool_result" || msg?.type === "tool.result") {
    const toolUseId = msg.tool_use_id || msg.id || msg.call_id;
    let duration_ms = 0;
    if (toolUseId && state.toolStartTimes.has(toolUseId)) {
      duration_ms = Date.now() - state.toolStartTimes.get(toolUseId)!;
      state.toolStartTimes.delete(toolUseId);
    }
    events.push({
      type: "tool_result",
      data: {
        toolUseId,
        duration_ms,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? msg.output ?? msg.result),
      },
    });
  } else if (msg?.type === "turn.completed" || msg?.type === "turn_completed") {
    events.push({ type: "progress", data: { phase: "Turn complete", detail: "OpenCode turn completed" } });
  } else if (msg?.type === "error") {
    const message = typeof msg.message === "string" ? msg.message : JSON.stringify(msg);
    events.push({ type: "error", data: { message } });
  }
  // Lines that don't match any known pattern are ignored; the runtime layer
  // will fall back to forwarding raw stdout if parsing fails outright.

  return events;
}

export const opencodeAdapter: CliAdapter = {
  id: ADAPTER_ID,
  displayName: "OpenCode CLI",
  installHint: "Not installed — see https://opencode.ai (npm i -g opencode-ai or curl install)",
  pathSettingKey: "opencodePath",
  defaultModel: DEFAULT_MODEL,
  primaryInstructionFile: "AGENTS.md",
  instructionFiles: ["AGENTS.md"],
  experimental: true,

  binaryNames() {
    return ["opencode"];
  },

  detect(customPath) {
    const path = resolveCliCommand(["opencode"], customPath, getWindowsBinaryExtras());
    if (!path) return { available: false, path: "" };
    return { available: true, path, version: getCliVersion(path) } satisfies CliDetectResult;
  },

  checkAuth({ apiKeys }): CliAuthStatus {
    if (
      apiKeys.anthropic ||
      apiKeys.openai ||
      apiKeys.google ||
      apiKeys.openrouter ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.OPENROUTER_API_KEY
    ) {
      return { authenticated: true, method: "api_key" };
    }
    // OpenCode persists OAuth tokens under the OS data dir.
    const home = homeDir();
    const candidates = [
      join(home, ".local", "share", "opencode", "auth.json"),
      join(home, "AppData", "Roaming", "opencode", "auth.json"),
      join(home, "Library", "Application Support", "opencode", "auth.json"),
    ];
    if (candidates.some(existsSync)) {
      return { authenticated: true, method: "oauth" };
    }
    return { authenticated: false, method: "none" };
  },

  isCompatibleModel(modelId) {
    return isOpencodeModelId(modelId);
  },

  normalizeModel(modelId) {
    return modelId && isOpencodeModelId(modelId) ? modelId : DEFAULT_MODEL;
  },

  async listModels() {
    return STATIC_MODELS;
  },

  async prepareWorkspace(ctx) {
    await writeOpencodeConfig(ctx);
    return {};
  },

  async buildSpawnPlan(ctx: SpawnCtx): Promise<SpawnPlan> {
    const cliCmd = resolveCliCommand(["opencode"], ctx.customCliPath, getWindowsBinaryExtras());
    if (!cliCmd) throw new Error("OpenCode CLI not found");

    const args: string[] = [
      "run",
      "--print-logs",
      "--auto-approve",
    ];
    if (ctx.model) args.push("--model", ctx.model);
    args.push(ctx.prompt);

    const extraEnv: Record<string, string> = {};
    if (ctx.apiKeys.anthropic) extraEnv.ANTHROPIC_API_KEY = ctx.apiKeys.anthropic;
    if (ctx.apiKeys.openai) extraEnv.OPENAI_API_KEY = ctx.apiKeys.openai;
    if (ctx.apiKeys.google) extraEnv.GOOGLE_API_KEY = ctx.apiKeys.google;
    if (ctx.apiKeys.openrouter) extraEnv.OPENROUTER_API_KEY = ctx.apiKeys.openrouter;

    return {
      cliCmd,
      args,
      extraEnv,
      promptHandling: { kind: "positional-stdin", index: args.length - 1 },
    };
  },

  async buildResumePlan(ctx: ResumeCtx): Promise<SpawnPlan> {
    const cliCmd = resolveCliCommand(["opencode"], ctx.customCliPath, getWindowsBinaryExtras());
    if (!cliCmd) throw new Error("OpenCode CLI not found");

    const args: string[] = [
      "run",
      "--print-logs",
      "--auto-approve",
      "--session",
      ctx.sessionId,
    ];
    if (ctx.model) args.push("--model", ctx.model);
    args.push(ctx.prompt);

    const extraEnv: Record<string, string> = {};
    if (ctx.apiKeys.anthropic) extraEnv.ANTHROPIC_API_KEY = ctx.apiKeys.anthropic;
    if (ctx.apiKeys.openai) extraEnv.OPENAI_API_KEY = ctx.apiKeys.openai;
    if (ctx.apiKeys.google) extraEnv.GOOGLE_API_KEY = ctx.apiKeys.google;
    if (ctx.apiKeys.openrouter) extraEnv.OPENROUTER_API_KEY = ctx.apiKeys.openrouter;

    return {
      cliCmd,
      args,
      extraEnv,
      promptHandling: { kind: "positional-stdin", index: args.length - 1 },
    };
  },

  defaultResumePrompt() {
    return "Resume the previous estimate session. Read AGENTS.md, check the current state with getWorkspace and getEstimateStrategy, then continue from where you left off. Do not re-create phases, worksheets, or items that already exist.";
  },

  parseEvent,

  extractSessionId(parsed) {
    if (!parsed) return null;
    if ((parsed.type === "session.started" || parsed.type === "session_started")) {
      const id = parsed.session_id || parsed.sessionId || parsed.id;
      if (id) return String(id);
    }
    if (parsed.session_id) return String(parsed.session_id);
    return null;
  },

  isBenignStderr() {
    return false;
  },
};
