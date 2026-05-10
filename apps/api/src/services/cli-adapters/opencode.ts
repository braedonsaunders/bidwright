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

  // OpenCode 1.14+ wraps event payloads in a `part` field with sub-typed
  // content; older shapes used flat top-level fields. Handle both. Unknown
  // lines fall through silently and the runtime layer can forward raw
  // stdout if parsing fails outright.
  const part = (msg && typeof msg === "object" ? msg.part : null) as any;
  const partType = part?.type as string | undefined;

  if (msg?.type === "session.started" || msg?.type === "session_started") {
    const sessionId = msg.session_id || msg.sessionId || msg.id;
    if (sessionId) {
      events.push({ type: "status", data: { status: "running", sessionId } });
    }
  } else if (msg?.type === "step_start" || partType === "step-start") {
    const sessionId = msg.sessionID || msg.sessionId || msg.session_id;
    if (sessionId) events.push({ type: "status", data: { status: "running", sessionId } });
  } else if (msg?.type === "step_finish" || partType === "step-finish") {
    const tokens = part?.tokens || msg.tokens;
    const cost = part?.cost ?? msg.cost;
    events.push({
      type: "progress",
      data: {
        phase: "Step complete",
        detail: `OpenCode step finished${tokens ? ` (in=${tokens.input ?? 0} out=${tokens.output ?? 0} reasoning=${tokens.reasoning ?? 0})` : ""}${typeof cost === "number" ? ` cost=$${cost}` : ""}`,
      },
    });
  } else if (msg?.type === "message" && msg.role === "assistant") {
    const content = typeof msg.content === "string" ? msg.content : msg.text;
    if (content) events.push({ type: "message", data: { role: "assistant", content } });
  } else if (msg?.type === "text" || partType === "text") {
    const content = part?.text ?? msg.content ?? msg.text;
    if (typeof content === "string" && content.length > 0) {
      events.push({ type: "message", data: { role: "assistant", content } });
    }
  } else if (msg?.type === "reasoning" || msg?.type === "thinking" || partType === "reasoning") {
    const content = part?.text ?? part?.thinking ?? msg.content ?? msg.text ?? msg.thinking;
    if (content) events.push({ type: "thinking", data: { content } });
  } else if (
    msg?.type === "tool" || msg?.type === "tool_call" || msg?.type === "tool_use" ||
    msg?.type === "tool.call" || partType === "tool" || partType === "tool-call"
  ) {
    const idSource = part ?? msg;
    const id = idSource.id || idSource.callID || idSource.tool_use_id || idSource.call_id;
    const state2 = part?.state || idSource.state;
    if (id) state.toolStartTimes.set(id, Date.now());
    events.push({
      type: "tool_call",
      data: {
        toolId: part?.tool || idSource.tool || idSource.name || idSource.function,
        toolUseId: id,
        input: state2?.input ?? idSource.input ?? idSource.arguments ?? idSource.parameters,
      },
    });
  } else if (
    msg?.type === "tool_result" || msg?.type === "tool.result" || partType === "tool-result"
  ) {
    const idSource = part ?? msg;
    const toolUseId = idSource.callID || idSource.tool_use_id || idSource.id || idSource.call_id;
    let duration_ms = 0;
    if (toolUseId && state.toolStartTimes.has(toolUseId)) {
      duration_ms = Date.now() - state.toolStartTimes.get(toolUseId)!;
      state.toolStartTimes.delete(toolUseId);
    }
    const content = part?.output ?? part?.result ?? idSource.content ?? idSource.output ?? idSource.result;
    events.push({
      type: "tool_result",
      data: {
        toolUseId,
        duration_ms,
        content: typeof content === "string" ? content : JSON.stringify(content),
      },
    });
  } else if (msg?.type === "turn.completed" || msg?.type === "turn_completed") {
    events.push({ type: "progress", data: { phase: "Turn complete", detail: "OpenCode turn completed" } });
  } else if (msg?.type === "error") {
    const message = typeof msg.message === "string" ? msg.message : JSON.stringify(msg);
    events.push({ type: "error", data: { message } });
  }

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

    // opencode 1.14+ flags:
    //   --format json                       → emit JSONL events to stdout (parsed by parseEvent)
    //   --dangerously-skip-permissions      → auto-approve tool calls (replaces --auto-approve from older versions)
    //   --dir <projectDir>                  → pin workspace to the per-project sandbox; without this,
    //                                          opencode walks up to the nearest .git and treats the repo
    //                                          root as the project, so the agent globs for AGENTS.md in the
    //                                          wrong place and bails out with "no AGENTS.md found".
    //   --thinking                          → surface provider reasoning blocks as `type:"reasoning"` events
    //                                          in the JSONL stream (parser maps these to thinking events).
    //                                          Verified to work for zai/glm-5.1; no harm if the model lacks
    //                                          extended thinking.
    const args: string[] = [
      "run",
      "--format", "json",
      "--dangerously-skip-permissions",
      "--dir", ctx.projectDir,
      "--thinking",
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
      "--format", "json",
      "--dangerously-skip-permissions",
      "--dir", ctx.projectDir,
      "--thinking",
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
