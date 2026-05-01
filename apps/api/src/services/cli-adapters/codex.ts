/**
 * Codex CLI adapter.
 *
 * Mirrors the original cli-runtime.ts logic for Codex byte-for-byte:
 * `prepareCodexHome` copies user's auth.json/cap_sid + appends bidwright
 * MCP server to config.toml, model listing goes through `codex app-server`
 * JSON-RPC, and stderr suppresses the well-known noisy patterns plus HTML
 * stack-trace spans.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
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

const ADAPTER_ID = "codex";

const BENIGN_STDERR_PATTERNS: readonly RegExp[] = [
  /codex_core::plugins::startup_sync:/,
  /codex_core::plugins::manager: failed to warm featured plugin ids cache/,
  /codex_core::plugins::manifest: ignoring interface\.defaultPrompt/,
  /codex_core::shell_snapshot: Failed to create shell snapshot for powershell/,
  /^Reading additional input from stdin\.\.\.$/,
];

function getWindowsBinaryExtras(): string[] {
  const extras: string[] = [];
  if (process.platform !== "win32") return extras;
  const appData =
    process.env.APPDATA || join(process.env.USERPROFILE || "", "AppData", "Roaming");
  const npmShim = join(appData, "npm", "codex.cmd");
  if (existsSync(npmShim)) extras.push(npmShim);
  return extras;
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

function isCodexModelId(model: string): boolean {
  if (!model.trim()) return false;
  // Codex accepts anything that's not a Claude alias.
  const claudeAliases = new Set([
    "default",
    "best",
    "sonnet",
    "opus",
    "haiku",
    "sonnet[1m]",
    "opus[1m]",
    "opusplan",
  ]);
  if (claudeAliases.has(model)) return false;
  if (model.startsWith("claude-")) return false;
  return true;
}

async function prepareCodexHome(
  projectDir: string,
  mcpRunner: string,
  mcpArgs: string[],
  mcpEnv: Record<string, string>,
): Promise<string> {
  const codexHome = join(projectDir, ".codex");
  await mkdir(codexHome, { recursive: true });

  const sourceCodexHome = process.env.CODEX_HOME || join(homeDir(), ".codex");

  for (const fileName of ["auth.json", "cap_sid"]) {
    const sourcePath = join(sourceCodexHome, fileName);
    if (existsSync(sourcePath)) {
      await copyFile(sourcePath, join(codexHome, fileName));
    }
  }

  const sourceConfigPath = join(sourceCodexHome, "config.toml");
  const baseConfig = existsSync(sourceConfigPath)
    ? (await readFile(sourceConfigPath, "utf-8")).trim()
    : "";

  const envSection = Object.entries(mcpEnv)
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .join("\n");
  const bidwrightConfig = [
    "[mcp_servers.bidwright]",
    `command = ${JSON.stringify(mcpRunner)}`,
    `args = ${JSON.stringify(mcpArgs)}`,
    "",
    "[mcp_servers.bidwright.env]",
    envSection,
    "",
  ].join("\n");

  const configContent = [baseConfig, bidwrightConfig].filter(Boolean).join("\n\n");
  await writeFile(join(codexHome, "config.toml"), configContent, "utf-8");

  return codexHome;
}

async function spawnAppServerProcess(
  cliCommand: string,
): Promise<{ child: ChildProcess; cleanup: () => Promise<void> }> {
  if (process.platform !== "win32") {
    return {
      child: spawn(cliCommand, ["app-server"], {
        stdio: ["pipe", "pipe", "pipe"],
      }),
      cleanup: async () => {},
    };
  }

  const batFile = join(
    tmpdir(),
    `bidwright-codex-app-server-${Date.now()}-${Math.random().toString(16).slice(2)}.bat`,
  );
  await writeFile(
    batFile,
    `@echo off\r\ncall "${cliCommand}" app-server\r\n`,
    "utf-8",
  );

  return {
    child: spawn("cmd.exe", ["/c", batFile], {
      stdio: ["pipe", "pipe", "pipe"],
    }),
    cleanup: async () => {
      await unlink(batFile).catch(() => {});
    },
  };
}

function isBenignRpcWarning(line: string): boolean {
  return BENIGN_STDERR_PATTERNS.some((pattern) => pattern.test(line));
}

async function listModels(opts: { customPath?: string }): Promise<CliModelOption[]> {
  const cliCommand = resolveCliCommand(["codex"], opts.customPath, getWindowsBinaryExtras());
  if (!cliCommand) return [];

  const { child, cleanup } = await spawnAppServerProcess(cliCommand);

  return new Promise<CliModelOption[]>((resolve, reject) => {
    let settled = false;
    let stderrSummary = "";
    const stdout = createInterface({ input: child.stdout! });
    const stderr = createInterface({ input: child.stderr! });

    const finish = async (handler: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stdout.close();
      stderr.close();
      child.kill();
      await cleanup();
      handler();
    };

    const timeout = setTimeout(() => {
      void finish(() =>
        reject(
          new Error(
            `Timed out while polling Codex models.${stderrSummary ? ` ${stderrSummary.trim()}` : ""}`,
          ),
        ),
      );
    }, 15000);

    stderr.on("line", (line) => {
      if (isBenignRpcWarning(line)) return;
      stderrSummary += `${line}\n`;
    });

    stdout.on("line", (line) => {
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      if (message.id === 1 && message.result) {
        child.stdin?.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "model/list",
            params: { includeHidden: false, limit: 100 },
          }) + "\n",
        );
        return;
      }

      if (message.id === 2 && message.result) {
        const models = Array.isArray(message.result.data) ? message.result.data : [];
        void finish(() =>
          resolve(
            models.map((model: any) => ({
              id: String(model.id),
              name: String(model.displayName || model.id),
              description: String(model.description || model.displayName || model.id),
              defaultReasoningEffort:
                typeof model.defaultReasoningEffort === "string"
                  ? model.defaultReasoningEffort
                  : null,
              hidden: Boolean(model.hidden),
              isDefault: Boolean(model.isDefault),
              supportedReasoningEfforts: Array.isArray(model.supportedReasoningEfforts)
                ? model.supportedReasoningEfforts
                    .map((entry: any) =>
                      typeof entry?.reasoningEffort === "string"
                        ? entry.reasoningEffort
                        : null,
                    )
                    .filter((entry: string | null): entry is string => !!entry)
                : [],
            })),
          ),
        );
        return;
      }

      if (message.id === 2 && message.error) {
        const reason =
          typeof message.error?.message === "string"
            ? message.error.message
            : "Unknown Codex app-server error";
        void finish(() => reject(new Error(reason)));
      }
    });

    child.once("error", (error) => {
      void finish(() => reject(error));
    });

    child.once("exit", (code) => {
      if (settled) return;
      void finish(() =>
        reject(
          new Error(
            `Codex app-server exited before returning models (code ${code ?? "unknown"}).${stderrSummary ? ` ${stderrSummary.trim()}` : ""}`,
          ),
        ),
      );
    });

    child.stdin?.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "bidwright", version: "1.0.0" },
          capabilities: { experimentalApi: true },
        },
      }) + "\n",
    );
  });
}

function parseEvent(msg: any, state: ParserState): SSEEventData[] {
  const events: SSEEventData[] = [];

  if (msg.type === "thread.started") {
    events.push({ type: "status", data: { status: "running", sessionId: msg.thread_id } });
  } else if (msg.type === "turn.started") {
    events.push({ type: "progress", data: { phase: "Running", detail: "Turn started" } });
  } else if (msg.type === "item.started" && msg.item?.type === "command_execution") {
    if (msg.item?.id) state.toolStartTimes.set(msg.item.id, Date.now());
    events.push({
      type: "tool_call",
      data: {
        toolId: "command_execution",
        toolUseId: msg.item?.id,
        input: { command: msg.item?.command || "" },
      },
    });
  } else if (msg.type === "item.completed" && msg.item?.type === "command_execution") {
    const toolUseId = msg.item?.id;
    let duration_ms = 0;
    if (toolUseId && state.toolStartTimes.has(toolUseId)) {
      duration_ms = Date.now() - state.toolStartTimes.get(toolUseId)!;
      state.toolStartTimes.delete(toolUseId);
    }
    events.push({
      type: "tool_result",
      data: {
        toolUseId,
        success: (msg.item?.exit_code ?? 0) === 0,
        duration_ms,
        content: msg.item?.aggregated_output || "",
        exitCode: msg.item?.exit_code,
      },
    });
  } else if (msg.type === "item.completed" && msg.item?.type === "agent_message") {
    events.push({ type: "message", data: { role: "assistant", content: msg.item.text || "" } });
  } else if (
    msg.type === "item.completed" &&
    (msg.item?.type === "tool_call" || msg.item?.type === "function_call")
  ) {
    if (msg.item?.id) state.toolStartTimes.set(msg.item.id, Date.now());
    events.push({
      type: "tool_call",
      data: {
        toolId: msg.item.name || msg.item.function,
        toolUseId: msg.item.id,
        input: msg.item.arguments || msg.item.input,
      },
    });
  } else if (
    msg.type === "item.completed" &&
    (msg.item?.type === "tool_result" || msg.item?.type === "function_result")
  ) {
    const toolUseId = msg.item?.id || msg.item?.call_id;
    let duration_ms = 0;
    if (toolUseId && state.toolStartTimes.has(toolUseId)) {
      duration_ms = Date.now() - state.toolStartTimes.get(toolUseId)!;
      state.toolStartTimes.delete(toolUseId);
    }
    events.push({
      type: "tool_result",
      data: { toolUseId, duration_ms, content: msg.item.output || msg.item.result },
    });
  } else if (msg.type === "turn.completed") {
    events.push({ type: "progress", data: { phase: "Turn complete", detail: "Codex turn completed" } });
  } else if (msg.type === "item.started" && msg.item?.type === "reasoning") {
    events.push({
      type: "thinking",
      data: { content: msg.item.text || msg.item.summary || "Thinking..." },
    });
  } else if (msg.type === "message" || msg.type === "response") {
    events.push({
      type: "message",
      data: {
        role: "assistant",
        content: msg.content || msg.text || JSON.stringify(msg),
      },
    });
  } else if (msg.type === "function_call" || msg.type === "tool_call") {
    if (msg.id) state.toolStartTimes.set(msg.id, Date.now());
    events.push({
      type: "tool_call",
      data: {
        toolId: msg.name || msg.function,
        toolUseId: msg.id,
        input: msg.arguments || msg.input,
      },
    });
  } else if (msg.type === "function_result" || msg.type === "tool_result") {
    const toolUseId = msg.id || msg.call_id;
    let duration_ms = 0;
    if (toolUseId && state.toolStartTimes.has(toolUseId)) {
      duration_ms = Date.now() - state.toolStartTimes.get(toolUseId)!;
      state.toolStartTimes.delete(toolUseId);
    }
    events.push({
      type: "tool_result",
      data: { toolUseId, duration_ms, content: msg.output || msg.result },
    });
  } else {
    if (msg.type === "item.started" || msg.type === "item.completed") {
      return events;
    }
    events.push({
      type: "message",
      data: { role: "system", content: JSON.stringify(msg) },
    });
  }

  return events;
}

export const codexAdapter: CliAdapter = {
  id: ADAPTER_ID,
  displayName: "Codex CLI",
  installHint: "Not installed — see openai.com/codex",
  pathSettingKey: "codexPath",
  defaultModel: "gpt-5.4",
  primaryInstructionFile: "AGENTS.md",
  instructionFiles: ["AGENTS.md", "codex.md"],

  binaryNames() {
    return ["codex"];
  },

  detect(customPath) {
    const path = resolveCliCommand(["codex"], customPath, getWindowsBinaryExtras());
    if (!path) return { available: false, path: "" };
    return { available: true, path, version: getCliVersion(path) } satisfies CliDetectResult;
  },

  checkAuth({ apiKeys }): CliAuthStatus {
    if (apiKeys.openai || process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY) {
      return { authenticated: true, method: "api_key" };
    }
    const codexAuth = join(homeDir(), ".codex", "auth.json");
    if (existsSync(codexAuth)) {
      return { authenticated: true, method: "oauth" };
    }
    return { authenticated: false, method: "none" };
  },

  isCompatibleModel(modelId) {
    return isCodexModelId(modelId);
  },

  normalizeModel(modelId) {
    return modelId && isCodexModelId(modelId) ? modelId : "gpt-5.4";
  },

  async listModels(opts) {
    return listModels({ customPath: opts.customPath });
  },

  async prepareWorkspace(ctx: PrepareWorkspaceCtx) {
    const codexHome = await prepareCodexHome(
      ctx.projectDir,
      ctx.mcpRunner,
      ctx.mcpArgs,
      ctx.mcpEnv as unknown as Record<string, string>,
    );
    return { extraEnv: { CODEX_HOME: codexHome } };
  },

  async buildSpawnPlan(ctx: SpawnCtx): Promise<SpawnPlan> {
    const cliCmd = resolveCliCommand(["codex"], ctx.customCliPath, getWindowsBinaryExtras());
    if (!cliCmd) throw new Error("Codex CLI not found");

    const args: string[] = [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      ctx.model || "gpt-5.4",
    ];
    const effort = mapEffort(ctx.reasoningEffort);
    if (effort) args.push("-c", `model_reasoning_effort=${effort}`);
    args.push("--json", ctx.prompt);

    const extraEnv: Record<string, string> = {};
    if (ctx.apiKeys.openai) extraEnv.CODEX_API_KEY = ctx.apiKeys.openai;

    return {
      cliCmd,
      args,
      extraEnv,
      promptHandling: { kind: "positional-stdin", index: args.length - 1 },
    };
  },

  async buildResumePlan(ctx: ResumeCtx): Promise<SpawnPlan> {
    const cliCmd = resolveCliCommand(["codex"], ctx.customCliPath, getWindowsBinaryExtras());
    if (!cliCmd) throw new Error("Codex CLI not found");

    const args: string[] = ["exec", "resume", "--dangerously-bypass-approvals-and-sandbox"];
    if (ctx.model) args.push("--model", ctx.model);
    const effort = mapEffort(ctx.reasoningEffort);
    if (effort) args.push("-c", `model_reasoning_effort=${effort}`);
    args.push("--json");
    args.push(ctx.sessionId);
    args.push(ctx.prompt);

    const extraEnv: Record<string, string> = {};
    if (ctx.apiKeys.openai) extraEnv.CODEX_API_KEY = ctx.apiKeys.openai;

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
    if (parsed?.type === "thread.started" && parsed?.thread_id) {
      return String(parsed.thread_id);
    }
    return null;
  },

  isBenignStderr(line) {
    return isBenignRpcWarning(line);
  },

  shouldSuppressStderrLine(line, state) {
    const trimmed = line.trim();
    if (state.suppressing) {
      if (trimmed.includes("</html>")) return { suppress: true, nextSuppressing: false };
      return { suppress: true, nextSuppressing: true };
    }
    if (isBenignRpcWarning(trimmed)) {
      const nextSuppressing = trimmed.includes("<html>");
      return { suppress: true, nextSuppressing };
    }
    if (
      trimmed.startsWith("<html>") ||
      trimmed.startsWith("<head>") ||
      trimmed.startsWith("<body>") ||
      trimmed.startsWith("<div") ||
      trimmed.startsWith("<meta") ||
      trimmed.startsWith("<style") ||
      trimmed.startsWith("<script") ||
      trimmed.startsWith("</")
    ) {
      return { suppress: true, nextSuppressing: false };
    }
    return { suppress: false, nextSuppressing: false };
  },
};
