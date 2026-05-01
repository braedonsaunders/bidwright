/**
 * Gemini CLI adapter (Google's official `gemini` CLI).
 *
 * EXPERIMENTAL: validate end-to-end against your installed `gemini`
 * version before relying on this in production.
 *
 * Wire-up assumptions (kept easy to tweak in one place):
 *   - Binary: `gemini`
 *   - Headless: `gemini --prompt "<prompt>"` (or piped via stdin)
 *   - JSONL output: `--output-format json` (line-delimited stream)
 *   - Auto-approval: `--yolo` (skip permission prompts)
 *   - Resume: `gemini --resume <session-id>` (writes session ids to settings)
 *   - Config: `<projectDir>/.gemini/settings.json` is auto-discovered
 *   - MCP servers: registered under `mcpServers` (matches Claude Code shape)
 *   - Models: bare model id (e.g. `gemini-2.5-pro`)
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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

const ADAPTER_ID = "gemini";

const DEFAULT_MODEL = "gemini-2.5-pro";

function getWindowsBinaryExtras(): string[] {
  if (process.platform !== "win32") return [];
  const appData =
    process.env.APPDATA || join(process.env.USERPROFILE || "", "AppData", "Roaming");
  const npmShim = join(appData, "npm", "gemini.cmd");
  return existsSync(npmShim) ? [npmShim] : [];
}

const STATIC_MODELS: CliModelOption[] = [
  {
    id: DEFAULT_MODEL,
    name: "Gemini 2.5 Pro",
    description: "Default — Google's frontier reasoning model",
    isDefault: true,
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    description: "Faster, cheaper variant of 2.5 Pro",
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    description: "Previous-gen fast model",
  },
];

function isGeminiModelId(model: string): boolean {
  if (!model.trim()) return false;
  return model.startsWith("gemini-") || model.startsWith("models/gemini-");
}

async function writeGeminiSettings(ctx: PrepareWorkspaceCtx): Promise<void> {
  const settingsDir = join(ctx.projectDir, ".gemini");
  await mkdir(settingsDir, { recursive: true });

  const settings = {
    mcpServers: {
      bidwright: {
        command: ctx.mcpRunner,
        args: ctx.mcpArgs,
        env: ctx.mcpEnv,
      },
    },
    // Future-proof — Gemini honors a tools allowlist similar to Claude Code.
    permissions: {
      allow: ctx.permissions,
    },
  };

  await writeFile(
    join(settingsDir, "settings.json"),
    JSON.stringify(settings, null, 2),
    "utf-8",
  );
}

function parseEvent(msg: any, state: ParserState): SSEEventData[] {
  const events: SSEEventData[] = [];

  // Gemini's JSON event schema is still stabilizing — handle the most likely
  // shapes plus a generic fallback.
  if (msg?.type === "session_start" || msg?.event === "session_start") {
    const sessionId = msg.session_id || msg.sessionId;
    if (sessionId) events.push({ type: "status", data: { status: "running", sessionId } });
  } else if (msg?.type === "model_response" || msg?.role === "model") {
    const content = msg.content || msg.text;
    if (typeof content === "string" && content.trim()) {
      events.push({ type: "message", data: { role: "assistant", content } });
    }
  } else if (msg?.type === "thought" || msg?.type === "thinking") {
    const content = msg.content || msg.text;
    if (content) events.push({ type: "thinking", data: { content } });
  } else if (msg?.type === "tool_call" || msg?.type === "function_call") {
    const id = msg.id || msg.call_id;
    if (id) state.toolStartTimes.set(id, Date.now());
    events.push({
      type: "tool_call",
      data: {
        toolId: msg.name || msg.function,
        toolUseId: id,
        input: msg.args || msg.arguments || msg.input,
      },
    });
  } else if (msg?.type === "tool_response" || msg?.type === "function_response") {
    const toolUseId = msg.id || msg.call_id;
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
        content:
          typeof msg.response === "string"
            ? msg.response
            : JSON.stringify(msg.response ?? msg.output ?? msg.result),
      },
    });
  } else if (msg?.type === "error") {
    const message = typeof msg.message === "string" ? msg.message : JSON.stringify(msg);
    events.push({ type: "error", data: { message } });
  } else if (typeof msg?.text === "string" && msg.text.trim()) {
    events.push({ type: "message", data: { role: "assistant", content: msg.text } });
  }

  return events;
}

export const geminiAdapter: CliAdapter = {
  id: ADAPTER_ID,
  displayName: "Gemini CLI",
  installHint: "Not installed — run: npm i -g @google/gemini-cli",
  pathSettingKey: "geminiPath",
  defaultModel: DEFAULT_MODEL,
  primaryInstructionFile: "GEMINI.md",
  instructionFiles: ["GEMINI.md"],
  experimental: true,

  binaryNames() {
    return ["gemini"];
  },

  detect(customPath) {
    const path = resolveCliCommand(["gemini"], customPath, getWindowsBinaryExtras());
    if (!path) return { available: false, path: "" };
    return { available: true, path, version: getCliVersion(path) } satisfies CliDetectResult;
  },

  checkAuth({ apiKeys }): CliAuthStatus {
    if (
      apiKeys.google ||
      process.env.GOOGLE_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY
    ) {
      return { authenticated: true, method: "api_key" };
    }
    const home = homeDir();
    const candidates = [
      join(home, ".gemini", "credentials.json"),
      join(home, ".gemini", "auth.json"),
      join(home, ".config", "gcloud", "application_default_credentials.json"),
    ];
    if (candidates.some(existsSync)) {
      return { authenticated: true, method: "oauth" };
    }
    return { authenticated: false, method: "none" };
  },

  isCompatibleModel(modelId) {
    return isGeminiModelId(modelId);
  },

  normalizeModel(modelId) {
    return modelId && isGeminiModelId(modelId) ? modelId : DEFAULT_MODEL;
  },

  async listModels() {
    return STATIC_MODELS;
  },

  async prepareWorkspace(ctx) {
    await writeGeminiSettings(ctx);
    return {};
  },

  async buildSpawnPlan(ctx: SpawnCtx): Promise<SpawnPlan> {
    const cliCmd = resolveCliCommand(["gemini"], ctx.customCliPath, getWindowsBinaryExtras());
    if (!cliCmd) throw new Error("Gemini CLI not found");

    const args: string[] = [
      "--yolo",
      "--output-format",
      "json",
    ];
    if (ctx.model) args.push("--model", ctx.model);
    args.push("--prompt", ctx.prompt);

    const extraEnv: Record<string, string> = {};
    if (ctx.apiKeys.google) extraEnv.GOOGLE_API_KEY = ctx.apiKeys.google;

    const promptIndex = args.indexOf("--prompt") + 1;
    return {
      cliCmd,
      args,
      extraEnv,
      promptHandling: { kind: "flag", flag: "--prompt", index: promptIndex },
    };
  },

  async buildResumePlan(ctx: ResumeCtx): Promise<SpawnPlan> {
    const cliCmd = resolveCliCommand(["gemini"], ctx.customCliPath, getWindowsBinaryExtras());
    if (!cliCmd) throw new Error("Gemini CLI not found");

    const args: string[] = [
      "--yolo",
      "--output-format",
      "json",
      "--resume",
      ctx.sessionId,
    ];
    if (ctx.model) args.push("--model", ctx.model);
    args.push("--prompt", ctx.prompt);

    const extraEnv: Record<string, string> = {};
    if (ctx.apiKeys.google) extraEnv.GOOGLE_API_KEY = ctx.apiKeys.google;

    const promptIndex = args.indexOf("--prompt") + 1;
    return {
      cliCmd,
      args,
      extraEnv,
      promptHandling: { kind: "flag", flag: "--prompt", index: promptIndex },
    };
  },

  defaultResumePrompt() {
    return "Resume the previous estimate session. Read GEMINI.md, check the current state with getWorkspace and getEstimateStrategy, then continue from where you left off. Do not re-create phases, worksheets, or items that already exist.";
  },

  parseEvent,

  extractSessionId(parsed) {
    if (!parsed) return null;
    if (parsed.session_id) return String(parsed.session_id);
    if (parsed.sessionId) return String(parsed.sessionId);
    if ((parsed.type === "session_start" || parsed.event === "session_start") && parsed.id) {
      return String(parsed.id);
    }
    return null;
  },

  isBenignStderr() {
    return false;
  },
};
