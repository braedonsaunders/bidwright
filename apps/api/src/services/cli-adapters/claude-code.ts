/**
 * Claude Code adapter.
 *
 * Behavior is byte-for-byte identical to the original cli-runtime.ts logic
 * for Claude Code: same flags, same permission allowlist, same .claude/
 * settings.json, same model-list scraping, same JSONL parser.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
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
import {
  BIDWRIGHT_PERMISSIONS,
  dedupeModels,
  getCliShimTarget,
  getCliVersion,
  homeDir,
  normalizeCliModelDescription,
  resolveCliCommand,
} from "./shared.js";

const ADAPTER_ID = "claude-code";

function shouldUseBypassPermissions() {
  if (process.env.SUDO_USER) return false;
  if (typeof process.geteuid === "function" && process.geteuid() === 0) return false;
  if (typeof process.getuid === "function" && process.getuid() === 0) return false;
  return true;
}

function getPermissionArgs(): string[] {
  return shouldUseBypassPermissions()
    ? ["--dangerously-skip-permissions"]
    : ["--permission-mode", "acceptEdits"];
}

function mapEffort(effort: string): string | null {
  switch (effort) {
    case "low":
    case "medium":
    case "high":
    case "max":
      return effort;
    case "extra_high":
      return "xhigh";
    default:
      return null;
  }
}

function isClaudeModelId(model: string): boolean {
  return (
    [
      "default",
      "best",
      "sonnet",
      "opus",
      "haiku",
      "sonnet[1m]",
      "opus[1m]",
      "opusplan",
    ].includes(model) || model.startsWith("claude-")
  );
}

function buildSettingsJson(
  mcpRunner: string,
  mcpArgs: string[],
  mcpEnv: Record<string, string>,
): string {
  return JSON.stringify(
    {
      permissions: {
        defaultMode: "acceptEdits",
        allow: [...BIDWRIGHT_PERMISSIONS],
      },
      mcpServers: {
        bidwright: {
          command: mcpRunner,
          args: mcpArgs,
          env: mcpEnv,
        },
      },
    },
    null,
    2,
  );
}

async function writeClaudeSettings(ctx: PrepareWorkspaceCtx, freshen: boolean) {
  const claudeSettingsDir = join(ctx.projectDir, ".claude");
  if (freshen) {
    try {
      await rm(claudeSettingsDir, { recursive: true, force: true });
    } catch {
      // ignore — directory may not exist
    }
  }
  await mkdir(claudeSettingsDir, { recursive: true });
  const json = buildSettingsJson(
    ctx.mcpRunner,
    ctx.mcpArgs,
    ctx.mcpEnv as unknown as Record<string, string>,
  );
  await writeFile(join(claudeSettingsDir, "settings.json"), json, "utf-8");
}

function extractBundleModel(
  id: string,
  regex: RegExp,
  text: string,
): CliModelOption | null {
  const match = text.match(regex);
  if (!match) return null;
  const [, name, description] = match;
  return {
    id,
    name,
    description: normalizeCliModelDescription(description),
  };
}

async function listModels(opts: { customPath?: string }): Promise<CliModelOption[]> {
  const cliCommand = resolveCliCommand(["claude"], opts.customPath);
  if (!cliCommand) return [];

  const cliBundlePath = getCliShimTarget(
    cliCommand,
    ["@anthropic-ai", "claude-code"],
    "cli.js",
  );
  if (!cliBundlePath) return [];

  const text = await readFile(cliBundlePath, "utf-8");

  const models: CliModelOption[] = [
    {
      id: "default",
      name: "Default (recommended)",
      description: "Use the Claude Code account default model for the signed-in tier.",
      isDefault: true,
    },
  ];

  const sonnet = extractBundleModel(
    "sonnet",
    /return\{value:[^,]+,label:"(Sonnet)",description:[^,]+,descriptionForModel:"([^"]*best for everyday tasks[^"]*)"\}/,
    text,
  );
  if (sonnet) models.push(sonnet);

  const opus = extractBundleModel(
    "opus",
    /return\{value:[^,]+,label:"(Opus)",description:[^,]+,descriptionForModel:"([^"]*most capable for complex work[^"]*)"\}/,
    text,
  );
  if (opus) models.push(opus);

  const haiku = extractBundleModel(
    "haiku",
    /return\{value:"haiku",label:"(Haiku)",description:[^,]+,descriptionForModel:"([^"]*fastest for quick answers[^"]*)"\}/,
    text,
  );
  if (haiku) models.push(haiku);

  const sonnet1m = extractBundleModel(
    "sonnet[1m]",
    /return\{value:[^,]*"sonnet\[1m\]",label:"(Sonnet \(1M context\))",description:[^,]+,descriptionForModel:"([^"]*1M context[^"]*)"\}/,
    text,
  );
  if (sonnet1m) models.push(sonnet1m);

  const opus1m = extractBundleModel(
    "opus[1m]",
    /return\{value:[^,]*"opus\[1m\]",label:"(Opus \(1M context\))",description:[^,]+,descriptionForModel:"([^"]*1M context[^"]*)"\}/,
    text,
  );
  if (opus1m) models.push(opus1m);

  const opusPlanMatch = text.match(/\{value:"opusplan",label:"([^"]+)",description:"([^"]+)"\}/);
  if (opusPlanMatch) {
    models.push({
      id: "opusplan",
      name: opusPlanMatch[1],
      description: normalizeCliModelDescription(opusPlanMatch[2]),
    });
  }

  return dedupeModels(models);
}

function parseEvent(msg: any, state: ParserState): SSEEventData[] {
  const events: SSEEventData[] = [];

  if (msg.type === "assistant") {
    const content = msg.content || msg.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "thinking" || block.type === "reasoning") {
          events.push({ type: "thinking", data: { content: block.thinking || block.text } });
        } else if (block.type === "tool_use") {
          if (block.id) state.toolStartTimes.set(block.id, Date.now());
          events.push({
            type: "tool_call",
            data: { toolId: block.name, toolUseId: block.id, input: block.input },
          });
        } else if (block.type === "text") {
          events.push({ type: "message", data: { role: "assistant", content: block.text } });
        }
      }
    } else if (typeof content === "string") {
      events.push({ type: "message", data: { role: "assistant", content } });
    }
  } else if (msg.type === "tool" || msg.type === "tool_result") {
    const content = msg.content || msg.message?.content;
    const toolUseId = msg.tool_use_id || msg.message?.tool_use_id;
    let duration_ms = 0;
    if (toolUseId && state.toolStartTimes.has(toolUseId)) {
      duration_ms = Date.now() - state.toolStartTimes.get(toolUseId)!;
      state.toolStartTimes.delete(toolUseId);
    } else if (state.toolStartTimes.size > 0) {
      const lastKey = [...state.toolStartTimes.keys()].pop()!;
      duration_ms = Date.now() - state.toolStartTimes.get(lastKey)!;
      state.toolStartTimes.delete(lastKey);
    }
    events.push({
      type: "tool_result",
      data: {
        toolUseId,
        content: typeof content === "string" ? content : JSON.stringify(content),
        duration_ms,
      },
    });
  } else if (msg.type === "result") {
    events.push({
      type: "progress",
      data: {
        phase: "Turn complete",
        detail:
          typeof msg.result === "string" ? msg.result.substring(0, 200) : "Processing...",
      },
    });
  } else if (msg.type === "system") {
    if (msg.subtype === "init") {
      events.push({ type: "status", data: { status: "running", sessionId: msg.session_id } });
    }
  }

  return events;
}

export const claudeCodeAdapter: CliAdapter = {
  id: ADAPTER_ID,
  displayName: "Claude Code",
  installHint: "Not installed — run: npm i -g @anthropic-ai/claude-code",
  pathSettingKey: "claudeCodePath",
  defaultModel: "sonnet",
  primaryInstructionFile: "CLAUDE.md",
  instructionFiles: ["CLAUDE.md"],

  binaryNames() {
    return ["claude"];
  },

  detect(customPath) {
    const path = resolveCliCommand(["claude"], customPath);
    if (!path) return { available: false, path: "" };
    return { available: true, path, version: getCliVersion(path) } satisfies CliDetectResult;
  },

  checkAuth({ apiKeys }): CliAuthStatus {
    if (apiKeys.anthropic || process.env.ANTHROPIC_API_KEY) {
      return { authenticated: true, method: "api_key" };
    }
    const home = homeDir();
    const configDir = process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
    const credPath = join(configDir, ".credentials.json");
    if (existsSync(credPath)) {
      return { authenticated: true, method: "oauth" };
    }
    if (process.platform === "darwin") {
      try {
        execSync('security find-generic-password -s "Claude Code-credentials" 2>/dev/null', {
          stdio: "pipe",
        });
        return { authenticated: true, method: "keychain" };
      } catch {
        // not in keychain
      }
    }
    return { authenticated: false, method: "none" };
  },

  isCompatibleModel(modelId) {
    return isClaudeModelId(modelId);
  },

  normalizeModel(modelId) {
    return modelId && isClaudeModelId(modelId) ? modelId : "sonnet";
  },

  async listModels(opts) {
    return listModels({ customPath: opts.customPath });
  },

  async prepareWorkspace(ctx) {
    // Freshen `.claude/` only on initial spawn. On resume we just ensure the
    // settings.json is in place without wiping CLI state the running process
    // might still depend on.
    await writeClaudeSettings(ctx, !ctx.isResume);
    return {};
  },

  async buildSpawnPlan(ctx: SpawnCtx): Promise<SpawnPlan> {
    const cliCmd = resolveCliCommand(["claude"], ctx.customCliPath);
    if (!cliCmd) throw new Error("Claude Code CLI not found");

    // The prompt is passed inline as the value of -p; the runtime layer
    // substitutes it onto the Windows .bat via the promptHandling hint.
    const safePrompt = ctx.isWin ? ctx.prompt.replace(/\r?\n/g, " ") : ctx.prompt;

    const args: string[] = [
      "-p",
      safePrompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--max-turns",
      "200",
      "--mcp-config",
      ctx.mcpConfigPath,
    ];
    args.push(...getPermissionArgs());
    if (ctx.model) args.push("--model", ctx.model);
    const effort = mapEffort(ctx.reasoningEffort);
    if (effort) args.push("--effort", effort);

    const extraEnv: Record<string, string> = {};
    if (ctx.apiKeys.anthropic) extraEnv.ANTHROPIC_API_KEY = ctx.apiKeys.anthropic;

    const promptIndex = args.indexOf("-p") + 1;
    return {
      cliCmd,
      args,
      extraEnv,
      promptHandling: { kind: "flag", flag: "-p", index: promptIndex },
    };
  },

  async buildResumePlan(ctx: ResumeCtx): Promise<SpawnPlan> {
    const cliCmd = resolveCliCommand(["claude"], ctx.customCliPath);
    if (!cliCmd) throw new Error("Claude Code CLI not found");

    const safePrompt = ctx.isWin ? ctx.prompt.replace(/\r?\n/g, " ") : ctx.prompt;

    const args: string[] = [
      "--resume",
      ctx.sessionId,
      "--output-format",
      "stream-json",
      "--verbose",
      "--max-turns",
      "200",
      "--mcp-config",
      ctx.mcpConfigPath,
    ];
    args.push(...getPermissionArgs());
    if (safePrompt) args.push("-p", safePrompt);
    if (ctx.model) args.push("--model", ctx.model);
    const effort = mapEffort(ctx.reasoningEffort);
    if (effort) args.push("--effort", effort);

    const extraEnv: Record<string, string> = {};
    if (ctx.apiKeys.anthropic) extraEnv.ANTHROPIC_API_KEY = ctx.apiKeys.anthropic;

    const flagIdx = args.indexOf("-p");
    return {
      cliCmd,
      args,
      extraEnv,
      promptHandling:
        flagIdx >= 0
          ? { kind: "flag", flag: "-p", index: flagIdx + 1 }
          : { kind: "positional", index: args.length - 1 },
    };
  },

  defaultResumePrompt() {
    return "Resume the previous estimate session. Read CLAUDE.md, check the current state with getWorkspace and getEstimateStrategy, then continue from where you left off. Do not re-create phases, worksheets, or items that already exist.";
  },

  parseEvent,

  extractSessionId(parsed) {
    if (parsed?.type === "system" && parsed?.subtype === "init" && parsed.session_id) {
      return String(parsed.session_id);
    }
    return null;
  },

  isBenignStderr() {
    return false;
  },
};
