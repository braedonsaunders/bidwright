/**
 * CLI Runtime Service
 *
 * Manages Claude Code / Codex CLI processes — one per project.
 * Spawns CLI, parses stream-json output, emits normalized SSE events.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";

export type AgentRuntime = "claude-code" | "codex";

export interface CliSession {
  projectId: string;
  runtime: AgentRuntime;
  process: ChildProcess;
  sessionId: string; // CLI session ID (for resume)
  status: "running" | "completed" | "stopped" | "failed";
  events: EventEmitter;
  startedAt: string;
  pid: number;
  /** Stashed spawn options for watchdog recovery */
  _spawnOpts?: Record<string, unknown>;
  /** How many times the watchdog has restarted this session */
  _recoveryCount?: number;
}

export interface SSEEventData {
  type: "thinking" | "tool_call" | "tool_result" | "message" | "progress" | "error" | "status" | "file_read";
  data: unknown;
}

// Active sessions: one per project
const sessions = new Map<string, CliSession>();

/** Cross-platform process kill — on Windows, child.kill() doesn't kill the process tree */
function killProcess(child: ChildProcess, signal: "SIGINT" | "SIGKILL" = "SIGINT"): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      // taskkill /T /F kills the entire process tree forcefully
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "pipe" });
    } catch (err: any) {
      console.error(`[cli:kill] taskkill failed for PID ${child.pid}:`, err.stderr?.toString().trim() || err.message);
      // Fallback: try Node's built-in kill
      try { child.kill(); } catch {}
    }
  } else {
    child.kill(signal);
  }
}

/**
 * Check if a CLI is authenticated (has valid credentials)
 */
export function checkCliAuth(runtime: AgentRuntime, apiKey?: string): { authenticated: boolean; method: string } {
  if (runtime === "claude-code") {
    // Check if API key is set (either passed or in env)
    if (apiKey || process.env.ANTHROPIC_API_KEY) {
      return { authenticated: true, method: "api_key" };
    }
    // Check if OAuth credentials exist on disk (Linux/Windows)
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const configDir = process.env.CLAUDE_CONFIG_DIR || join(homeDir, ".claude");
    const credPath = join(configDir, ".credentials.json");
    if (existsSync(credPath)) {
      return { authenticated: true, method: "oauth" };
    }
    // Check macOS Keychain (Claude Code stores OAuth tokens there)
    if (process.platform === "darwin") {
      try {
        execSync('security find-generic-password -s "Claude Code-credentials" 2>/dev/null', { stdio: "pipe" });
        return { authenticated: true, method: "keychain" };
      } catch {}
    }
    return { authenticated: false, method: "none" };
  } else {
    // Codex
    if (apiKey || process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY) {
      return { authenticated: true, method: "api_key" };
    }
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const codexAuth = join(homeDir, ".codex", "auth.json");
    if (existsSync(codexAuth)) {
      return { authenticated: true, method: "oauth" };
    }
    return { authenticated: false, method: "none" };
  }
}

/**
 * Check if a CLI is available on the system
 */
export function detectCli(runtime: AgentRuntime): { available: boolean; path: string; version?: string } {
  const cmd = runtime === "claude-code" ? "claude" : "codex";
  const whichCmd = process.platform === "win32" ? "where" : "which";
  try {
    const path = execSync(`${whichCmd} ${cmd}`, { encoding: "utf-8" }).trim().split(/\r?\n/)[0];
    let version: string | undefined;
    try {
      version = execSync(`${cmd} --version`, { encoding: "utf-8" }).trim();
    } catch {}
    return { available: true, path, version };
  } catch {
    return { available: false, path: "" };
  }
}

/**
 * Get the MCP server binary path
 */
function getMcpServerPath(): string {
  // Resolve from this file's location (apps/api/src/services/ → 4 levels up to repo root)
  const thisUrl = new URL(".", import.meta.url);
  const thisDir = process.platform === "win32" ? fileURLToPath(thisUrl) : thisUrl.pathname;
  const repoRoot = join(thisDir, "../../../..");

  // In dev: use tsx to run the TypeScript source directly
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

/**
 * Spawn a CLI session for a project
 */
export async function spawnSession(opts: {
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
}): Promise<CliSession> {
  const { projectId, projectDir, prompt, runtime, model, authToken, apiBaseUrl, revisionId, quoteId, customCliPath, anthropicApiKey, openaiApiKey } = opts;

  // Check for existing session
  const existing = sessions.get(projectId);
  if (existing && existing.status === "running") {
    throw new Error(`Session already running for project ${projectId}`);
  }

  const mcpServerPath = getMcpServerPath();
  // On Windows, Claude CLI spawns MCP servers without shell:true,
  // so we must use the .cmd wrapper for npx/node to be executable
  const isWin = process.platform === "win32";
  const npxCmd = isWin ? "npx.cmd" : "npx";
  const nodeCmd = isWin ? "node.exe" : "node";
  const mcpRunner = existsSync(mcpServerPath) && mcpServerPath.endsWith(".ts") ? npxCmd : nodeCmd;
  const mcpArgs = mcpServerPath.endsWith(".ts") ? ["tsx", mcpServerPath] : [mcpServerPath];

  // Environment for MCP server
  const mcpEnv: Record<string, string> = {
    BIDWRIGHT_API_URL: apiBaseUrl || "http://localhost:4001",
    BIDWRIGHT_AUTH_TOKEN: authToken || "",
    BIDWRIGHT_PROJECT_ID: projectId,
    BIDWRIGHT_REVISION_ID: revisionId || "",
    BIDWRIGHT_QUOTE_ID: quoteId || "",
  };

  // Clear stale Claude session data, then write fresh .claude/settings.json
  const claudeSettingsDir = join(projectDir, ".claude");
  try {
    const { rm } = await import("node:fs/promises");
    await rm(claudeSettingsDir, { recursive: true, force: true });
  } catch {
    // Ignore — directory may not exist
  }
  await mkdir(claudeSettingsDir, { recursive: true });
  await writeFile(join(claudeSettingsDir, "settings.json"), JSON.stringify({
    permissions: {
      "allow": [
        "mcp__bidwright__*",
        "Bash(*)",
        "Read(*)",
        "Write(*)",
        "Edit(*)",
        "Glob(*)",
        "Grep(*)",
        "Agent(*)",
        "TodoWrite",
        "WebSearch(*)",
        "WebFetch(*)",
      ]
    },
    mcpServers: {
      bidwright: {
        command: mcpRunner,
        args: mcpArgs,
        env: mcpEnv,
      },
    },
  }, null, 2));

  // Build CLI command and environment
  let cliCmd: string;
  let cliArgs: string[];
  const cliEnv: Record<string, string> = { ...mcpEnv };

  if (runtime === "claude-code") {
    cliCmd = customCliPath || "claude";

    // Build MCP config — write to a temp file to avoid shell escaping issues on Windows
    const mcpConfigObj = {
      mcpServers: {
        bidwright: {
          command: mcpRunner,
          args: mcpArgs,
          env: mcpEnv,
        },
      },
    };
    const mcpConfigPath = join(projectDir, ".bidwright-mcp-config.json");
    await writeFile(mcpConfigPath, JSON.stringify(mcpConfigObj, null, 2));

    cliArgs = [
      "-p", prompt,
      "--output-format", "stream-json",
      "--dangerously-skip-permissions", // Non-interactive, no permission prompts
      "--verbose",
      "--max-turns", "200", // Prevent infinite loops
      "--mcp-config", mcpConfigPath, // Pass MCP config file path
    ];
    if (model) cliArgs.push("--model", model);
    // Auth: pass API key if provided. On bare metal (dev), the CLI uses
    // macOS Keychain / OAuth credentials automatically — no key needed.
    if (anthropicApiKey) {
      cliEnv.ANTHROPIC_API_KEY = anthropicApiKey;
    }
  } else {
    // Codex CLI
    cliCmd = customCliPath || "codex";
    cliArgs = [
      "exec", // Non-interactive mode
      "--model", model || "gpt-5.4",
      "--json", // Structured output
      prompt,
    ];
    // Auth: pass API key if provided
    if (openaiApiKey) {
      cliEnv.CODEX_API_KEY = openaiApiKey;
    }
  }

  // Note: .claude/ directory was already cleaned and recreated with settings.json above

  // Spawn the CLI process — use "ignore" for stdin since we pass prompt via -p flag
  // On Windows, shell:true is required to execute .cmd wrappers (e.g. claude.cmd)
  // MCP config is passed as a file path (not inline JSON) so shell escaping is safe
  console.log(`[cli:spawn] cmd=${cliCmd} cwd=${projectDir} args=${JSON.stringify(cliArgs.slice(0, 6))}...`);
  const child = spawn(cliCmd, cliArgs, {
    cwd: projectDir,
    env: { ...process.env, ...cliEnv },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  console.log(`[cli:spawn] pid=${child.pid} killed=${child.killed}`);

  const events = new EventEmitter();
  const session: CliSession = {
    projectId,
    runtime,
    process: child,
    sessionId: "",
    status: "running",
    events,
    startedAt: new Date().toISOString(),
    pid: child.pid || 0,
  };

  // Stash spawn opts for recovery
  session._spawnOpts = { projectId, projectDir, prompt, runtime, model, authToken, apiBaseUrl, revisionId, quoteId, customCliPath, anthropicApiKey, openaiApiKey };
  session._recoveryCount = 0;

  sessions.set(projectId, session);

  // Inactivity watchdog — recover session if no output for 5 minutes
  const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
  const MAX_RECOVERIES = 2;
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  const resetInactivityTimer = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(async () => {
      if (session.status !== "running") return;
      const recoveries = session._recoveryCount || 0;

      if (recoveries >= MAX_RECOVERIES) {
        // Give up after max retries
        console.warn(`[cli] Inactivity timeout for project ${projectId} — max recoveries (${MAX_RECOVERIES}) reached, terminating`);
        events.emit("event", { type: "error", data: { message: `Session terminated: no activity for 5 minutes (${MAX_RECOVERIES} recovery attempts exhausted)` } });
        killProcess(child, "SIGINT");
        return;
      }

      // Attempt recovery via --resume
      const savedSessionId = session.sessionId;
      if (!savedSessionId) {
        console.warn(`[cli] Inactivity timeout for project ${projectId} — no session ID for recovery, terminating`);
        events.emit("event", { type: "error", data: { message: "Session terminated: no activity for 5 minutes (no session ID for recovery)" } });
        killProcess(child, "SIGINT");
        return;
      }

      console.warn(`[cli] Inactivity timeout for project ${projectId} — attempting recovery #${recoveries + 1} via --resume`);
      events.emit("event", { type: "progress", data: { phase: "Recovery", detail: `No activity for 5 minutes — restarting session (attempt ${recoveries + 1}/${MAX_RECOVERIES})` } });

      // Kill the stuck process and mark it so spawnSession doesn't reject
      session.status = "stopped";
      killProcess(child, "SIGKILL");

      // Small delay for process cleanup
      await new Promise(r => setTimeout(r, 2000));

      // Resume session
      try {
        const newSession = await resumeSession({
          projectId,
          projectDir,
          prompt: "You were interrupted due to inactivity. Check the current state with getWorkspace, then continue where you left off. Do NOT re-create items that already exist.",
          model: model as string | undefined,
          customCliPath: customCliPath as string | undefined,
          authToken: authToken as string | undefined,
          apiBaseUrl: apiBaseUrl as string | undefined,
          anthropicApiKey: anthropicApiKey as string | undefined,
        });
        newSession._spawnOpts = session._spawnOpts;
        newSession._recoveryCount = recoveries + 1;
        // The new session replaces the old one in the sessions map (done by spawnSession)
        // Forward events from the new session to existing listeners
        newSession.events.on("event", (evt: any) => events.emit("event", evt));
        newSession.events.on("done", (status: string) => events.emit("done", status));
      } catch (err) {
        console.error(`[cli] Recovery failed for project ${projectId}:`, err);
        events.emit("event", { type: "error", data: { message: `Recovery failed: ${err instanceof Error ? err.message : "unknown error"}` } });
        events.emit("done", "failed");
      }
    }, INACTIVITY_TIMEOUT_MS);
  };
  resetInactivityTimer();

  // Wire up stdout/stderr/exit handlers (shared helper)
  wireChildProcess(child, session, runtime, events, {
    onStdoutLine: resetInactivityTimer,
  });

  // Clear inactivity timer on process exit/error
  child.on("exit", () => { if (inactivityTimer) clearTimeout(inactivityTimer); });
  child.on("error", () => { if (inactivityTimer) clearTimeout(inactivityTimer); });

  // Save session state to disk for recovery
  const sessionJsonDir = join(projectDir, ".bidwright");
  await mkdir(sessionJsonDir, { recursive: true });
  await writeFile(join(sessionJsonDir, "session.json"), JSON.stringify({
    pid: child.pid,
    runtime,
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    status: "running",
  }));

  return session;
}

/**
 * Wire up stdout/stderr/exit handlers for a CLI child process.
 * Shared between spawnSession and spawnResumedSession to avoid duplication.
 */
function wireChildProcess(
  child: ChildProcess,
  session: CliSession,
  runtime: AgentRuntime,
  events: EventEmitter,
  opts?: { onStdoutLine?: () => void },
) {
  if (child.stdout) {
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      opts?.onStdoutLine?.();
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);
        const sseEvents = parseCliOutput(parsed, runtime);
        for (const evt of sseEvents) {
          events.emit("event", evt);
          if (parsed.type === "system" && parsed.subtype === "init" && parsed.session_id) {
            session.sessionId = parsed.session_id;
          }
        }
      } catch {
        if (line.trim()) {
          events.emit("event", { type: "message", data: { role: "system", content: line.trim() } });
        }
      }
    });
  }

  if (child.stderr) {
    const rl = createInterface({ input: child.stderr });
    rl.on("line", (line) => {
      if (line.trim()) {
        console.error(`[cli:stderr:${projectId}]`, line.trim());
        events.emit("event", { type: "error", data: { message: line.trim() } });
      }
    });
  }

  child.on("exit", (code, signal) => {
    console.log(`[cli:exit:${session.projectId}] code=${code} signal=${signal}`);
    session.status = signal === "SIGINT" ? "stopped" : code === 0 ? "completed" : "failed";
    // Emit a final summary message so the user sees closure in the chat
    const completionMsg = session.status === "completed"
      ? "Intake complete. Review the estimate worksheets and adjust pricing as needed."
      : session.status === "stopped"
        ? "Intake stopped."
        : `Intake failed (exit code ${code}).`;
    events.emit("event", { type: "message", data: { role: "assistant", content: completionMsg } });
    events.emit("event", { type: "status", data: { status: session.status, exitCode: code, signal } });
    events.emit("done", session.status);
    setTimeout(() => { sessions.delete(session.projectId); }, 5 * 60 * 1000);
  });

  child.on("error", (err) => {
    console.error(`[cli:error:${session.projectId}]`, err.message);
    session.status = "failed";
    events.emit("event", { type: "error", data: { message: err.message } });
    events.emit("done", "failed");
    setTimeout(() => { sessions.delete(session.projectId); }, 5 * 60 * 1000);
  });
}

/**
 * Parse CLI output into normalized SSE events
 */
function parseCliOutput(parsed: any, runtime: AgentRuntime): SSEEventData[] {
  const events: SSEEventData[] = [];

  if (runtime === "claude-code") {
    return parseClaudeCodeOutput(parsed);
  } else {
    return parseCodexOutput(parsed);
  }
}

// Track tool_use start timestamps to compute duration on tool_result
const toolStartTimes = new Map<string, number>();

function parseClaudeCodeOutput(msg: any): SSEEventData[] {
  const events: SSEEventData[] = [];

  if (msg.type === "assistant") {
    const content = msg.content || msg.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "thinking" || block.type === "reasoning") {
          events.push({ type: "thinking", data: { content: block.thinking || block.text } });
        } else if (block.type === "tool_use") {
          if (block.id) toolStartTimes.set(block.id, Date.now());
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
    // Tool result — compute duration from matched tool_use start time
    const content = msg.content || msg.message?.content;
    const toolUseId = msg.tool_use_id || msg.message?.tool_use_id;
    let duration_ms = 0;
    if (toolUseId && toolStartTimes.has(toolUseId)) {
      duration_ms = Date.now() - toolStartTimes.get(toolUseId)!;
      toolStartTimes.delete(toolUseId);
    } else if (toolStartTimes.size > 0) {
      // Fallback: match against the most recent unresolved tool start
      const lastKey = [...toolStartTimes.keys()].pop()!;
      duration_ms = Date.now() - toolStartTimes.get(lastKey)!;
      toolStartTimes.delete(lastKey);
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
    // "result" fires at end of each conversation turn, NOT when the session exits.
    // Don't emit "completed" here — the child "exit" handler does that.
    events.push({ type: "progress", data: { phase: "Turn complete", detail: typeof msg.result === "string" ? msg.result.substring(0, 200) : "Processing..." } });
  } else if (msg.type === "system") {
    if (msg.subtype === "init") {
      events.push({ type: "status", data: { status: "running", sessionId: msg.session_id } });
    }
  }

  return events;
}

function parseCodexOutput(msg: any): SSEEventData[] {
  // Codex output format differs — adapt as needed
  const events: SSEEventData[] = [];

  if (msg.type === "message" || msg.type === "response") {
    events.push({ type: "message", data: { role: "assistant", content: msg.content || msg.text || JSON.stringify(msg) } });
  } else if (msg.type === "function_call" || msg.type === "tool_call") {
    events.push({ type: "tool_call", data: { toolId: msg.name || msg.function, input: msg.arguments || msg.input } });
  } else if (msg.type === "function_result" || msg.type === "tool_result") {
    events.push({ type: "tool_result", data: { content: msg.output || msg.result } });
  } else {
    // Unknown event type — forward as message
    events.push({ type: "message", data: { role: "system", content: JSON.stringify(msg) } });
  }

  return events;
}

/**
 * Stop a running session
 */
export function stopSession(projectId: string): boolean {
  const session = sessions.get(projectId);
  if (!session || session.status !== "running") return false;

  console.log(`[cli:stop:${projectId}] Killing process pid=${session.process.pid}`);
  killProcess(session.process, "SIGINT");

  // If the process doesn't exit within 3s, force kill and emit done
  setTimeout(() => {
    if (session.status === "running") {
      console.log(`[cli:stop:${projectId}] Force killing after timeout`);
      killProcess(session.process, "SIGKILL");
      session.status = "stopped";
      session.events.emit("event", { type: "status", data: { status: "stopped", exitCode: null, signal: "SIGINT" } });
      session.events.emit("done", "stopped");
    }
  }, 3000);

  return true;
}

/**
 * Resume a stopped session (Claude Code only)
 */
export async function resumeSession(opts: {
  projectId: string;
  projectDir: string;
  prompt?: string;
  authToken?: string;
  apiBaseUrl?: string;
  model?: string;
  customCliPath?: string;
  anthropicApiKey?: string;
}): Promise<CliSession> {
  const session = sessions.get(opts.projectId);
  const sessionId = session?.sessionId;

  if (!sessionId) {
    // No session to resume — try reading from disk
    const sessionJsonPath = join(opts.projectDir, ".bidwright", "session.json");
    if (existsSync(sessionJsonPath)) {
      const saved = JSON.parse(await readFile(sessionJsonPath, "utf-8"));
      if (saved.sessionId) {
        return spawnResumedSession(opts, saved.sessionId);
      }
    }
    throw new Error("No session to resume for this project");
  }

  return spawnResumedSession(opts, sessionId);
}

async function spawnResumedSession(opts: any, sessionId: string): Promise<CliSession> {
  const { projectId, projectDir, model, customCliPath, anthropicApiKey } = opts;
  const runtime: AgentRuntime = "claude-code";
  const cliCmd = customCliPath || "claude";

  // Build args with --resume to continue the existing session
  const cliArgs = [
    "--resume", sessionId,
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
    "--verbose",
    "--max-turns", "200",
  ];
  if (opts.prompt) cliArgs.push("-p", opts.prompt);
  if (model) cliArgs.push("--model", model);

  const cliEnv: Record<string, string> = {};
  if (anthropicApiKey) cliEnv.ANTHROPIC_API_KEY = anthropicApiKey;

  const child = spawn(cliCmd, cliArgs, {
    cwd: projectDir,
    env: { ...process.env, ...cliEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const events = new EventEmitter();
  const session: CliSession = {
    projectId,
    runtime,
    process: child,
    sessionId,
    status: "running",
    events,
    startedAt: new Date().toISOString(),
    pid: child.pid || 0,
  };

  sessions.set(projectId, session);

  // Wire up stdout/stderr/exit handlers (shared helper)
  wireChildProcess(child, session, runtime, events);

  // Update session.json on disk
  const sessionJsonDir = join(projectDir, ".bidwright");
  await mkdir(sessionJsonDir, { recursive: true });
  await writeFile(join(sessionJsonDir, "session.json"), JSON.stringify({
    pid: child.pid,
    runtime,
    sessionId,
    startedAt: session.startedAt,
    status: "running",
    resumed: true,
  }));

  return session;
}

/**
 * Get the current session for a project
 */
export function getSession(projectId: string): CliSession | undefined {
  return sessions.get(projectId);
}

/**
 * Get all active sessions
 */
export function listSessions(): Array<{ projectId: string; status: string; runtime: string; startedAt: string }> {
  return Array.from(sessions.entries()).map(([pid, s]) => ({
    projectId: pid,
    status: s.status,
    runtime: s.runtime,
    startedAt: s.startedAt,
  }));
}
