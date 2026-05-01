/**
 * CLI Runtime Service
 *
 * Orchestrates per-project CLI sessions: workspace setup, process spawn,
 * stdout/stderr piping, watchdog recovery, and session persistence. The
 * CLI-specific bits (binary discovery, native config files, JSONL parsing,
 * model lookup) live in `./cli-adapters/` — this module wires them
 * together via the adapter registry.
 *
 * Public API is preserved 1:1 with the previous implementation:
 *   detectCli, checkCliAuth, listCliModels,
 *   spawnSession, resumeSession, stopSession,
 *   getSession, listSessions
 *
 * The runtime is now extensible — register a new adapter in
 * `cli-adapters/index.ts` and it shows up here automatically.
 */

import { spawn, type ChildProcess, execSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createInterface } from "node:readline";

// Side-effect import: registers all known adapters into the registry.
import "./cli-adapters/index.js";
import {
  getAdapter,
  isRegisteredRuntime,
  listAdapters,
  tryGetAdapter,
} from "./cli-adapters/registry.js";
import { BIDWRIGHT_PERMISSIONS, quoteWindowsArg } from "./cli-adapters/shared.js";
import type {
  AgentReasoningEffort,
  ApiKeys,
  CliAuthStatus,
  CliDetectResult,
  CliModelOption,
  McpEnv,
  ParserState,
  RegisteredCliAdapter,
  SpawnPlan,
} from "./cli-adapters/types.js";

// ── Public types ──────────────────────────────────────────────────

/**
 * Identifier of any registered CLI runtime. Type-checked as a plain
 * string so new adapters don't require a TS union update on the call
 * sites; use `isRegisteredRuntime` to validate at runtime.
 */
export type AgentRuntime = string;

export type { CliModelOption, SSEEventData } from "./cli-adapters/types.js";
export { listAdapters, tryGetAdapter, getAdapter, isRegisteredRuntime };

export interface CliSession {
  projectId: string;
  runtime: AgentRuntime;
  process: ChildProcess;
  /** CLI-supplied id used by `--resume` (e.g. Claude session_id, Codex thread_id). */
  sessionId: string;
  status: "running" | "completed" | "stopped" | "failed";
  events: EventEmitter;
  startedAt: string;
  pid: number;
  /** Stashed spawn options for watchdog recovery. */
  _spawnOpts?: Record<string, unknown>;
  /** How many times the watchdog has restarted this session. */
  _recoveryCount?: number;
}

// ── Module state ──────────────────────────────────────────────────

const sessions = new Map<string, CliSession>();
/**
 * Tool-call timing state shared across sessions (preserves prior behavior
 * where the original `toolStartTimes` was a module-level Map).
 */
const parserState: ParserState = { toolStartTimes: new Map() };

// ── Helpers ───────────────────────────────────────────────────────

function normalizeAgentReasoningEffort(value: unknown): AgentReasoningEffort {
  if (
    value === "auto" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "extra_high" ||
    value === "max"
  ) {
    return value;
  }
  return "extra_high";
}

/** Cross-platform process kill — on Windows, child.kill() doesn't kill the tree. */
function killProcess(child: ChildProcess, signal: "SIGINT" | "SIGKILL" = "SIGINT"): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "pipe" });
    } catch (err: any) {
      console.error(
        `[cli:kill] taskkill failed for PID ${child.pid}:`,
        err.stderr?.toString().trim() || err.message,
      );
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
  } else {
    child.kill(signal);
  }
}

async function persistSessionState(
  session: CliSession,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const projectDir =
    typeof session._spawnOpts?.projectDir === "string"
      ? (session._spawnOpts.projectDir as string)
      : null;
  if (!projectDir) return;

  const sessionJsonDir = join(projectDir, ".bidwright");
  await mkdir(sessionJsonDir, { recursive: true });
  await writeFile(
    join(sessionJsonDir, "session.json"),
    JSON.stringify({
      pid: session.process.pid,
      runtime: session.runtime,
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      status: session.status,
      ...extra,
    }),
  );
}

function getMcpServerPath(): string {
  // Resolve from this file's location (apps/api/src/services/ -> 4 levels up to repo root)
  const thisUrl = new URL(".", import.meta.url);
  const thisDir = process.platform === "win32" ? fileURLToPath(thisUrl) : thisUrl.pathname;
  const repoRoot = join(thisDir, "../../../..");

  const paths = [
    join(repoRoot, "packages/mcp-server/src/index.ts"),
    join(process.cwd(), "packages/mcp-server/src/index.ts"),
    join(repoRoot, "packages/mcp-server/dist/index.js"),
    join(process.cwd(), "packages/mcp-server/dist/index.js"),
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  throw new Error(`MCP server not found. Checked: ${paths.join(", ")}`);
}

interface McpRunnerInfo {
  mcpRunner: string;
  mcpArgs: string[];
  isWin: boolean;
}

function resolveMcpRunner(): McpRunnerInfo {
  const isWin = process.platform === "win32";
  const npxCmd = isWin ? "npx.cmd" : "npx";
  const nodeCmd = isWin ? "node.exe" : "node";
  const mcpServerPath = getMcpServerPath();
  const mcpRunner =
    existsSync(mcpServerPath) && mcpServerPath.endsWith(".ts") ? npxCmd : nodeCmd;
  const mcpArgs = mcpServerPath.endsWith(".ts") ? ["tsx", mcpServerPath] : [mcpServerPath];
  return { mcpRunner, mcpArgs, isWin };
}

function buildMcpEnv(opts: {
  apiBaseUrl?: string;
  authToken?: string;
  projectId: string;
  revisionId?: string;
  quoteId?: string;
}): McpEnv {
  return {
    BIDWRIGHT_API_URL: opts.apiBaseUrl || "http://localhost:4001",
    BIDWRIGHT_AUTH_TOKEN: opts.authToken || "",
    BIDWRIGHT_PROJECT_ID: opts.projectId,
    BIDWRIGHT_REVISION_ID: opts.revisionId || "",
    BIDWRIGHT_QUOTE_ID: opts.quoteId || "",
  };
}

function buildApiKeys(opts: {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  openrouterApiKey?: string;
}): ApiKeys {
  return {
    anthropic: opts.anthropicApiKey,
    openai: opts.openaiApiKey,
    google: opts.googleApiKey,
    openrouter: opts.openrouterApiKey,
  };
}

async function writeMcpConfigFile(
  projectDir: string,
  mcpRunner: string,
  mcpArgs: string[],
  mcpEnv: McpEnv,
): Promise<string> {
  const mcpConfigPath = join(projectDir, ".bidwright-mcp-config.json");
  const mcpConfigObj = {
    mcpServers: {
      bidwright: {
        command: mcpRunner,
        args: mcpArgs,
        env: mcpEnv,
      },
    },
  };
  await writeFile(mcpConfigPath, JSON.stringify(mcpConfigObj, null, 2), "utf-8");
  return mcpConfigPath;
}

/**
 * Map a runtime + single-key API param into the unified ApiKeys shape.
 * Keeps the legacy `checkCliAuth(runtime, apiKey)` signature working for
 * call sites that pass the runtime-specific key inline.
 */
function legacyApiKeysFor(runtime: AgentRuntime, apiKey?: string): ApiKeys {
  if (!apiKey) return {};
  if (runtime === "claude-code" || runtime === "opencode") return { anthropic: apiKey };
  if (runtime === "codex") return { openai: apiKey };
  if (runtime === "gemini") return { google: apiKey };
  return { anthropic: apiKey };
}

// ── Public detection / models / auth ──────────────────────────────

export function detectCli(
  runtime: AgentRuntime,
  customCliPath?: string,
): CliDetectResult {
  const adapter = tryGetAdapter(runtime);
  if (!adapter) return { available: false, path: "" };
  return adapter.detect(customCliPath);
}

export function checkCliAuth(runtime: AgentRuntime, apiKey?: string): CliAuthStatus {
  const adapter = tryGetAdapter(runtime);
  if (!adapter) return { authenticated: false, method: "none" };
  return adapter.checkAuth({ apiKeys: legacyApiKeysFor(runtime, apiKey) });
}

export async function listCliModels(
  runtime: AgentRuntime,
  customCliPath?: string,
): Promise<CliModelOption[]> {
  const adapter = tryGetAdapter(runtime);
  if (!adapter) return [];
  return adapter.listModels({ customPath: customCliPath, apiKeys: {} });
}

// ── Spawn / Resume / Stop ─────────────────────────────────────────

export interface SpawnSessionOpts {
  projectId: string;
  projectDir: string;
  prompt: string;
  runtime: AgentRuntime;
  model?: string;
  authToken?: string;
  apiBaseUrl?: string;
  revisionId?: string;
  quoteId?: string;
  customCliPath?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  openrouterApiKey?: string;
  reasoningEffort?: string;
}

export interface ResumeSessionOpts extends Partial<SpawnSessionOpts> {
  projectId: string;
  projectDir: string;
  prompt?: string;
  runtime?: AgentRuntime;
}

/**
 * Build the per-process child with proper cwd/env, and a Windows .bat
 * shim when needed. The shim is the same trick the old code used to
 * dodge cmd.exe quoting — adapter declares where the prompt lives via
 * `promptHandling`.
 */
async function spawnChild(
  plan: SpawnPlan,
  projectDir: string,
  cliEnv: Record<string, string>,
  isWin: boolean,
  batSuffix: "run" | "resume",
): Promise<ChildProcess> {
  if (!isWin) {
    console.log(
      `[cli:spawn] cmd=${plan.cliCmd} cwd=${projectDir} argCount=${plan.args.length}`,
    );
    const child = spawn(plan.cliCmd, plan.args, {
      cwd: projectDir,
      env: { ...process.env, ...cliEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(`[cli:spawn] pid=${child.pid}`);
    return child;
  }

  // Windows: resolve the .cmd/.bat/.exe behind the binary name and wrap in a
  // launcher .bat so we don't fight cmd.exe over argument quoting.
  let resolvedCmd = plan.cliCmd;
  try {
    const candidates = execSync(`where ${plan.cliCmd}`, { encoding: "utf-8" })
      .trim()
      .split(/\r?\n/);
    resolvedCmd =
      candidates.find((c) => /\.(cmd|bat|exe)$/i.test(c)) || candidates[0] || resolvedCmd;
  } catch {
    // fall back to plan.cliCmd
  }

  const args = [...plan.args];
  const promptFile = join(projectDir, ".bidwright-prompt.txt");
  let usePromptStdin = false;

  if (plan.promptHandling.kind === "flag") {
    const idx = plan.promptHandling.index;
    if (idx >= 0 && idx < args.length) {
      await writeFile(promptFile, args[idx], "utf-8");
      args[idx] = "Execute the instructions in .bidwright-prompt.txt";
    }
  } else if (plan.promptHandling.kind === "positional-stdin") {
    const idx = plan.promptHandling.index;
    if (idx >= 0 && idx < args.length) {
      await writeFile(promptFile, args[idx], "utf-8");
      args[idx] = "-";
      usePromptStdin = true;
    }
  } // "positional" needs no transformation; quoting handles it.

  const batLines = ["@echo off"];
  const quotedArgs = args.map(quoteWindowsArg);
  if (usePromptStdin) {
    batLines.push(`type "${promptFile}" | call "${resolvedCmd}" ${quotedArgs.join(" ")}`);
  } else {
    batLines.push(`call "${resolvedCmd}" ${quotedArgs.join(" ")}`);
  }

  const batFile = join(projectDir, `.bidwright-${batSuffix}.bat`);
  await writeFile(batFile, batLines.join("\r\n") + "\r\n");

  console.log(`[cli:spawn:win] bat=${batFile} cmd=${resolvedCmd}`);
  const child = spawn("cmd.exe", ["/c", batFile], {
    cwd: projectDir,
    env: { ...process.env, ...cliEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log(`[cli:spawn:win] pid=${child.pid}`);
  return child;
}

/**
 * Wire stdout/stderr/exit handlers. Stdout is parsed line-by-line through
 * the adapter; stderr respects per-adapter benign filters and multi-line
 * suppression spans.
 */
function wireChildProcess(
  child: ChildProcess,
  session: CliSession,
  adapter: RegisteredCliAdapter,
  events: EventEmitter,
  opts?: { onActivity?: () => void },
): void {
  let stderrSuppressing = false;

  if (child.stdout) {
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      opts?.onActivity?.();
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);
        const sseEvents = adapter.parseEvent(parsed, parserState);
        for (const evt of sseEvents) {
          events.emit("event", evt);
        }
        const sessionId = adapter.extractSessionId(parsed);
        if (sessionId) {
          session.sessionId = sessionId;
          persistSessionState(session).catch(() => {});
        }
      } catch {
        if (line.trim()) {
          events.emit("event", {
            type: "message",
            data: { role: "system", content: line.trim() },
          });
        }
      }
    });
  }

  if (child.stderr) {
    const rl = createInterface({ input: child.stderr });
    rl.on("line", (line) => {
      opts?.onActivity?.();
      const trimmed = line.trim();
      if (!trimmed) return;

      if (adapter.shouldSuppressStderrLine) {
        const result = adapter.shouldSuppressStderrLine(line, {
          suppressing: stderrSuppressing,
        });
        stderrSuppressing = result.nextSuppressing;
        if (result.suppress) return;
      } else if (adapter.isBenignStderr(trimmed)) {
        return;
      }

      console.error(`[cli:stderr:${session.projectId}]`, trimmed);
      events.emit("event", { type: "error", data: { message: trimmed } });
    });
  }

  child.on("exit", (code, signal) => {
    console.log(`[cli:exit:${session.projectId}] code=${code} signal=${signal}`);
    session.status =
      signal === "SIGINT" ? "stopped" : code === 0 ? "completed" : "failed";
    persistSessionState(session).catch(() => {});

    const completionMsg =
      session.status === "completed"
        ? "Intake complete. Review the estimate worksheets and adjust pricing as needed."
        : session.status === "stopped"
          ? "Intake stopped."
          : `Intake failed (exit code ${code}).`;
    events.emit("event", {
      type: "message",
      data: { role: "assistant", content: completionMsg },
    });
    events.emit("event", {
      type: "status",
      data: { status: session.status, exitCode: code, signal },
    });
    events.emit("done", session.status);
    setTimeout(
      () => {
        sessions.delete(session.projectId);
      },
      5 * 60 * 1000,
    );
  });

  child.on("error", (err) => {
    console.error(`[cli:error:${session.projectId}]`, err.message);
    session.status = "failed";
    events.emit("event", { type: "error", data: { message: err.message } });
    events.emit("done", "failed");
    setTimeout(
      () => {
        sessions.delete(session.projectId);
      },
      5 * 60 * 1000,
    );
  });
}

/**
 * Spawn a fresh CLI session for a project.
 */
export async function spawnSession(opts: SpawnSessionOpts): Promise<CliSession> {
  const adapter = getAdapter(opts.runtime);
  const reasoningEffort = normalizeAgentReasoningEffort(opts.reasoningEffort);

  const existing = sessions.get(opts.projectId);
  if (existing && existing.status === "running") {
    throw new Error(`Session already running for project ${opts.projectId}`);
  }

  const { mcpRunner, mcpArgs, isWin } = resolveMcpRunner();
  const mcpEnv = buildMcpEnv(opts);
  const apiKeys = buildApiKeys(opts);

  // Always materialize the bidwright MCP config file. Adapters that need it
  // (Claude --mcp-config) reference it; others ignore it.
  const mcpConfigPath = await writeMcpConfigFile(
    opts.projectDir,
    mcpRunner,
    mcpArgs,
    mcpEnv,
  );

  const prepResult = await adapter.prepareWorkspace({
    projectDir: opts.projectDir,
    mcpRunner,
    mcpArgs,
    mcpEnv,
    permissions: [...BIDWRIGHT_PERMISSIONS],
    isWin,
    isResume: false,
  });

  const plan = await adapter.buildSpawnPlan({
    projectDir: opts.projectDir,
    prompt: opts.prompt,
    model: opts.model,
    reasoningEffort,
    customCliPath: opts.customCliPath,
    apiKeys,
    mcpRunner,
    mcpArgs,
    mcpEnv,
    isWin,
    mcpConfigPath,
  });

  const cliEnv: Record<string, string> = {
    ...mcpEnv,
    ...(prepResult.extraEnv ?? {}),
    ...plan.extraEnv,
  };

  const child = await spawnChild(plan, opts.projectDir, cliEnv, isWin, "run");

  const events = new EventEmitter();
  const session: CliSession = {
    projectId: opts.projectId,
    runtime: opts.runtime,
    process: child,
    sessionId: "",
    status: "running",
    events,
    startedAt: new Date().toISOString(),
    pid: child.pid || 0,
  };
  session._spawnOpts = { ...opts, reasoningEffort };
  session._recoveryCount = 0;
  sessions.set(opts.projectId, session);

  // ── Inactivity watchdog ─────────────────────────────────────
  const INACTIVITY_TIMEOUT_MINUTES = 15;
  const INACTIVITY_TIMEOUT_MS = INACTIVITY_TIMEOUT_MINUTES * 60 * 1000;
  const MAX_RECOVERIES = 2;
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  const resetInactivityTimer = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(async () => {
      if (session.status !== "running") return;
      const recoveries = session._recoveryCount || 0;

      if (recoveries >= MAX_RECOVERIES) {
        console.warn(
          `[cli] Inactivity timeout for project ${opts.projectId} — max recoveries (${MAX_RECOVERIES}) reached, terminating`,
        );
        events.emit("event", {
          type: "error",
          data: {
            message: `Session terminated: no activity for ${INACTIVITY_TIMEOUT_MINUTES} minutes (${MAX_RECOVERIES} recovery attempts exhausted)`,
          },
        });
        killProcess(child, "SIGINT");
        return;
      }

      const savedSessionId = session.sessionId;
      if (!savedSessionId) {
        console.warn(
          `[cli] Inactivity timeout for project ${opts.projectId} — no session ID for recovery, terminating`,
        );
        events.emit("event", {
          type: "error",
          data: {
            message: `Session terminated: no activity for ${INACTIVITY_TIMEOUT_MINUTES} minutes (no session ID for recovery)`,
          },
        });
        killProcess(child, "SIGINT");
        return;
      }

      console.warn(
        `[cli] Inactivity timeout for project ${opts.projectId} — attempting recovery #${recoveries + 1} via --resume`,
      );
      events.emit("event", {
        type: "progress",
        data: {
          phase: "Recovery",
          detail: `No activity for ${INACTIVITY_TIMEOUT_MINUTES} minutes — restarting session (attempt ${recoveries + 1}/${MAX_RECOVERIES})`,
        },
      });

      session.status = "stopped";
      killProcess(child, "SIGKILL");
      await new Promise((r) => setTimeout(r, 2000));

      try {
        const newSession = await resumeSession({
          projectId: opts.projectId,
          projectDir: opts.projectDir,
          runtime: opts.runtime,
          prompt:
            "You were interrupted due to inactivity. Check the current state with getWorkspace, then continue where you left off. Do NOT re-create items that already exist.",
          model: opts.model,
          customCliPath: opts.customCliPath,
          authToken: opts.authToken,
          apiBaseUrl: opts.apiBaseUrl,
          revisionId: opts.revisionId,
          quoteId: opts.quoteId,
          anthropicApiKey: opts.anthropicApiKey,
          openaiApiKey: opts.openaiApiKey,
          googleApiKey: opts.googleApiKey,
          openrouterApiKey: opts.openrouterApiKey,
          reasoningEffort: opts.reasoningEffort,
        });
        newSession._spawnOpts = session._spawnOpts;
        newSession._recoveryCount = recoveries + 1;
        newSession.events.on("event", (evt: any) => events.emit("event", evt));
        newSession.events.on("done", (status: string) => events.emit("done", status));
      } catch (err) {
        console.error(`[cli] Recovery failed for project ${opts.projectId}:`, err);
        events.emit("event", {
          type: "error",
          data: {
            message: `Recovery failed: ${err instanceof Error ? err.message : "unknown error"}`,
          },
        });
        events.emit("done", "failed");
      }
    }, INACTIVITY_TIMEOUT_MS);
  };
  resetInactivityTimer();

  wireChildProcess(child, session, adapter, events, { onActivity: resetInactivityTimer });
  child.on("exit", () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
  });
  child.on("error", () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
  });

  await persistSessionState(session);
  return session;
}

/**
 * Resume a session by id. Falls back to reading `.bidwright/session.json`
 * if no in-memory session is known.
 */
export async function resumeSession(opts: ResumeSessionOpts): Promise<CliSession> {
  const session = sessions.get(opts.projectId);
  let sessionId = session?.sessionId;
  let runtime: AgentRuntime | undefined = opts.runtime || session?.runtime;

  if (!sessionId) {
    const sessionJsonPath = join(opts.projectDir, ".bidwright", "session.json");
    if (existsSync(sessionJsonPath)) {
      const saved = JSON.parse(await readFile(sessionJsonPath, "utf-8"));
      if (saved.sessionId) {
        sessionId = saved.sessionId;
        runtime = (saved.runtime as string) || runtime;
      }
    }
  }

  if (!sessionId) {
    throw new Error("No session to resume for this project");
  }

  return spawnResumedSession(
    {
      ...opts,
      runtime: runtime || "claude-code",
      prompt: opts.prompt ?? "",
    },
    sessionId,
  );
}

async function spawnResumedSession(
  opts: SpawnSessionOpts,
  sessionId: string,
): Promise<CliSession> {
  const adapter = getAdapter(opts.runtime);
  const reasoningEffort = normalizeAgentReasoningEffort(opts.reasoningEffort);
  const resumePrompt =
    typeof opts.prompt === "string" && opts.prompt.trim()
      ? opts.prompt.trim()
      : adapter.defaultResumePrompt();

  const { mcpRunner, mcpArgs, isWin } = resolveMcpRunner();
  const mcpEnv = buildMcpEnv(opts);
  const apiKeys = buildApiKeys(opts);
  const mcpConfigPath = await writeMcpConfigFile(
    opts.projectDir,
    mcpRunner,
    mcpArgs,
    mcpEnv,
  );

  const prepResult = await adapter.prepareWorkspace({
    projectDir: opts.projectDir,
    mcpRunner,
    mcpArgs,
    mcpEnv,
    permissions: [...BIDWRIGHT_PERMISSIONS],
    isWin,
    isResume: true,
  });

  const plan = await adapter.buildResumePlan({
    projectDir: opts.projectDir,
    prompt: resumePrompt,
    model: opts.model,
    reasoningEffort,
    customCliPath: opts.customCliPath,
    apiKeys,
    mcpRunner,
    mcpArgs,
    mcpEnv,
    isWin,
    mcpConfigPath,
    sessionId,
  });

  const cliEnv: Record<string, string> = {
    ...mcpEnv,
    ...(prepResult.extraEnv ?? {}),
    ...plan.extraEnv,
  };

  const child = await spawnChild(plan, opts.projectDir, cliEnv, isWin, "resume");

  const events = new EventEmitter();
  const session: CliSession = {
    projectId: opts.projectId,
    runtime: opts.runtime,
    process: child,
    sessionId,
    status: "running",
    events,
    startedAt: new Date().toISOString(),
    pid: child.pid || 0,
  };
  session._spawnOpts = {
    ...opts,
    projectDir: opts.projectDir,
    runtime: opts.runtime,
    customCliPath: opts.customCliPath,
    anthropicApiKey: opts.anthropicApiKey,
    openaiApiKey: opts.openaiApiKey,
    reasoningEffort,
  };

  sessions.set(opts.projectId, session);
  wireChildProcess(child, session, adapter, events);
  await persistSessionState(session, { resumed: true });
  return session;
}

/** Stop a running session. */
export function stopSession(projectId: string): boolean {
  const session = sessions.get(projectId);
  if (!session || session.status !== "running") return false;

  console.log(`[cli:stop:${projectId}] Killing process pid=${session.process.pid}`);
  killProcess(session.process, "SIGINT");

  // Force-kill if it doesn't exit within 3s.
  setTimeout(() => {
    if (session.status === "running") {
      console.log(`[cli:stop:${projectId}] Force killing after timeout`);
      killProcess(session.process, "SIGKILL");
      session.status = "stopped";
      session.events.emit("event", {
        type: "status",
        data: { status: "stopped", exitCode: null, signal: "SIGINT" },
      });
      session.events.emit("done", "stopped");
    }
  }, 3000);

  return true;
}

export function getSession(projectId: string): CliSession | undefined {
  return sessions.get(projectId);
}

export function listSessions(): Array<{
  projectId: string;
  status: string;
  runtime: string;
  startedAt: string;
}> {
  return Array.from(sessions.entries()).map(([pid, s]) => ({
    projectId: pid,
    status: s.status,
    runtime: s.runtime,
    startedAt: s.startedAt,
  }));
}
