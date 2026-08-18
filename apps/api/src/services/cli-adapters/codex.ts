/**
 * Codex CLI adapter.
 *
 * Keeps Codex auth and session state in the user's central CODEX_HOME. The
 * Bidwright MCP server is injected with per-invocation config overrides so
 * OAuth credentials never need to be copied into a project workspace.
 * Model listing goes through `codex app-server` JSON-RPC, and stderr
 * suppresses the well-known noisy patterns plus HTML stack-trace spans.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
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
import { getCliVersion, homeDir, MCP_TOOL_TIMEOUT_SEC, resolveCliCommand } from "./shared.js";
import { getBidwrightMode } from "../agent-home.js";
import { createRuntimeBrokerPlan } from "../runtime-broker.js";

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
  agentHomeDir: string | null | undefined,
): Promise<string> {
  // Server mode gets a tenant-scoped home. Desktop mode deliberately reuses
  // the operator's normal CODEX_HOME so interactive browser login remains a
  // local-only capability and existing desktop sessions continue to work.
  const codexHome = agentHomeDir
    ? join(agentHomeDir, "runtime", "codex")
    : process.env.CODEX_HOME || join(homeDir(), ".codex");
  await mkdir(codexHome, { recursive: true });
  return codexHome;
}

/**
 * Remove credentials left by Bidwright's pre-central-home implementation.
 * Restored workspace snapshots can still contain these files, so cleanup runs
 * on every prepare and is deliberately limited to the known generated paths.
 */
async function removeLegacyProjectCredentials(projectDir: string): Promise<void> {
  const projectCodexHome = join(projectDir, ".codex");
  await Promise.all(
    ["auth.json", "cap_sid"].map((fileName) =>
      unlink(join(projectCodexHome, fileName)).catch(() => {}),
    ),
  );

  const configPath = join(projectCodexHome, "config.toml");
  const config = await readFile(configPath, "utf8").catch(() => "");
  if (
    config.includes("[mcp_servers.bidwright]") &&
    config.includes("BIDWRIGHT_AUTH_TOKEN")
  ) {
    await unlink(configPath).catch(() => {});
  }
}

/**
 * Build ephemeral Codex config overrides for the project-scoped Bidwright MCP
 * server. Secret values stay in the child environment; only the allowlisted
 * variable names appear in argv.
 */
function buildMcpConfigArgs(ctx: SpawnCtx): string[] {
  const envNames = Object.keys(ctx.mcpEnv);
  return [
    "-c",
    `mcp_servers.bidwright.command=${JSON.stringify(ctx.mcpRunner)}`,
    "-c",
    `mcp_servers.bidwright.args=${JSON.stringify(ctx.mcpArgs)}`,
    "-c",
    `mcp_servers.bidwright.env_vars=${JSON.stringify(envNames)}`,
    // askUser blocks on a human. Codex's default tool timeout is 300s, so a
    // question the estimator did not answer within five minutes failed with
    // "timed out awaiting tools/call after 300s" — the run moved on and the
    // rendered question became a dead, read-only form. Server-side work is
    // bounded independently, so this only needs to cover human think time.
    "-c",
    `mcp_servers.bidwright.tool_timeout_sec=${MCP_TOOL_TIMEOUT_SEC}`,
  ];
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

  if (msg.type === "broker.error") {
    events.push({ type: "error", data: { message: msg.message || "Runtime broker failed" } });
  } else if (msg.method === "turn/started") {
    events.push({ type: "progress", data: { phase: "Running", detail: "Turn started" } });
  } else if (msg.method === "turn/completed") {
    const status = msg.params?.turn?.status;
    if (status === "failed") {
      events.push({
        type: "error",
        data: { message: msg.params?.turn?.error?.message || "Codex turn failed" },
      });
    }
    events.push({
      type: "progress",
      data: { phase: "Turn complete", detail: `Codex turn ${status || "completed"}` },
    });
  } else if (msg.method === "item/started" || msg.method === "item/completed") {
    const item = msg.params?.item || {};
    const completed = msg.method === "item/completed";
    if (item.type === "commandExecution") {
      if (!completed) {
        if (item.id) state.toolStartTimes.set(item.id, Date.now());
        events.push({
          type: "tool_call",
          data: {
            toolId: "command_execution",
            toolUseId: item.id,
            input: { command: item.command || "", cwd: item.cwd },
          },
        });
      } else {
        const startedAt = item.id ? state.toolStartTimes.get(item.id) : undefined;
        if (item.id) state.toolStartTimes.delete(item.id);
        events.push({
          type: "tool_result",
          data: {
            toolUseId: item.id,
            success: (item.exitCode ?? 0) === 0 && item.status !== "failed",
            duration_ms: item.durationMs ?? (startedAt ? Date.now() - startedAt : 0),
            content: item.aggregatedOutput || "",
            exitCode: item.exitCode,
          },
        });
      }
    } else if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") {
      if (!completed) {
        if (item.id) state.toolStartTimes.set(item.id, Date.now());
        events.push({
          type: "tool_call",
          data: {
            toolId: item.tool || item.name || item.type,
            toolUseId: item.id,
            input: item.arguments || item.input,
          },
        });
      } else {
        const startedAt = item.id ? state.toolStartTimes.get(item.id) : undefined;
        if (item.id) state.toolStartTimes.delete(item.id);
        events.push({
          type: "tool_result",
          data: {
            toolUseId: item.id,
            success: item.status !== "failed",
            duration_ms: startedAt ? Date.now() - startedAt : 0,
            content: item.result || item.output || item.error?.message || "",
          },
        });
      }
    } else if (item.type === "agentMessage" && completed) {
      events.push({
        type: "message",
        data: { role: "assistant", content: item.text || "" },
      });
    } else if (item.type === "reasoning" && !completed) {
      const content = Array.isArray(item.summary)
        ? item.summary.map((part: any) => part?.text || String(part)).join("\n")
        : item.text || item.summary || "Thinking...";
      events.push({ type: "thinking", data: { content } });
    }
  } else if (msg.method === "item/agentMessage/delta") {
    // The authoritative full message arrives in item/completed. Suppressing
    // deltas avoids persisting duplicate assistant messages in the legacy SSE
    // event stream while still keeping transport activity alive.
  } else if (msg.method === "mcpServer/startupStatus/updated") {
    const status = String(msg.params?.status ?? msg.params?.startupStatus ?? "starting");
    const server = String(msg.params?.server ?? msg.params?.name ?? "tools");
    if (status === "failed") {
      events.push({
        type: "error",
        data: {
          message: msg.params?.error?.message || `${server} tool server failed to start`,
        },
      });
    } else {
      events.push({
        type: "progress",
        data: {
          phase: "Tools",
          detail: `${server} ${status}`,
        },
      });
    }
  } else if (msg.method === "warning") {
    const message = String(msg.params?.message ?? msg.params?.text ?? "").trim();
    if (message) {
      events.push({
        type: "progress",
        data: { phase: "Runtime warning", detail: message },
      });
    }
  } else if (typeof msg.method === "string") {
    // App Server emits high-volume protocol telemetry (token usage, rate
    // limits, thread state, reasoning deltas, remote-control state, etc.).
    // It is transport metadata, not conversation content.
    return events;
  } else if (msg.type === "thread.started") {
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
    // Unknown runtime envelopes must never be rendered as chat messages.
    return events;
  }

  return events;
}

export const codexAdapter: CliAdapter = {
  id: ADAPTER_ID,
  displayName: "Codex",
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

  checkAuth({ apiKeys, agentHomeDir }): CliAuthStatus {
    if (apiKeys.openai) {
      return { authenticated: true, method: "api_key" };
    }
    if (agentHomeDir) {
      // Server mode is API-key-only. Legacy OAuth caches may still exist on
      // disk after an upgrade but are neither trusted nor mounted.
      return { authenticated: false, method: "none" };
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
    // App Server is the target execution transport, but until the broker owns
    // its lifecycle it must not be spawned outside the server sandbox merely
    // for model discovery. The route falls back to provider/static models.
    if (getBidwrightMode() === "server") return [];
    return listModels({ customPath: opts.customPath });
  },

  async prepareWorkspace(ctx: PrepareWorkspaceCtx) {
    await removeLegacyProjectCredentials(ctx.projectDir);
    const codexHome = await prepareCodexHome(ctx.agentHomeDir ?? null);
    const extraEnv: Record<string, string> = { CODEX_HOME: codexHome };
    if (ctx.agentHomeDir) {
      const userHomeDir = join(ctx.agentHomeDir, "runtime", "codex-home");
      await mkdir(userHomeDir, { recursive: true });
      extraEnv.HOME = userHomeDir;
    }
    return { extraEnv };
  },

  async buildSpawnPlan(ctx: SpawnCtx): Promise<SpawnPlan> {
    const cliCmd = resolveCliCommand(["codex"], ctx.customCliPath, getWindowsBinaryExtras());
    if (!cliCmd) throw new Error("Codex CLI not found");

    const extraEnv: Record<string, string> = {};
    if (ctx.apiKeys.openai) extraEnv.CODEX_API_KEY = ctx.apiKeys.openai;

    return createRuntimeBrokerPlan(
      {
        transport: "codex-app-server",
        projectDir: ctx.projectDir,
        prompt: ctx.prompt,
        model: ctx.model || "gpt-5.4",
        reasoningEffort: ctx.reasoningEffort,
        codexCommand: cliCmd,
        appServerArgs: buildMcpConfigArgs(ctx),
      },
      extraEnv,
    );
  },

  async buildResumePlan(ctx: ResumeCtx): Promise<SpawnPlan> {
    const cliCmd = resolveCliCommand(["codex"], ctx.customCliPath, getWindowsBinaryExtras());
    if (!cliCmd) throw new Error("Codex CLI not found");

    const extraEnv: Record<string, string> = {};
    if (ctx.apiKeys.openai) extraEnv.CODEX_API_KEY = ctx.apiKeys.openai;

    return createRuntimeBrokerPlan(
      {
        transport: "codex-app-server",
        projectDir: ctx.projectDir,
        prompt: ctx.prompt,
        model: ctx.model || "gpt-5.4",
        reasoningEffort: ctx.reasoningEffort,
        resumeSessionId: ctx.sessionId,
        codexCommand: cliCmd,
        appServerArgs: buildMcpConfigArgs(ctx),
      },
      extraEnv,
    );
  },

  defaultResumePrompt() {
    return "Resume the previous estimate session. Read AGENTS.md, check the current state with getWorkspace and getEstimateStrategy, then continue from where you left off. Do not re-create phases, worksheets, or items that already exist.";
  },

  parseEvent,

  extractSessionId(parsed) {
    if (parsed?.type === "thread.started" && parsed?.thread_id) {
      return String(parsed.thread_id);
    }
    if (parsed?.method === "thread/started" && parsed?.params?.thread?.id) {
      return String(parsed.params.thread.id);
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
