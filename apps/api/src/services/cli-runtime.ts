/**
 * CLI Runtime Service
 *
 * Manages Claude Code / Codex CLI processes — one per project.
 * Spawns CLI, parses stream-json output, emits normalized SSE events.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile, mkdir } from "node:fs/promises";
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

function buildDefaultResumePrompt(runtime: AgentRuntime): string {
  if (runtime === "codex") {
    return "Resume the previous estimate session. Read AGENTS.md, check the current state with getWorkspace and getEstimateStrategy, then continue from where you left off. Do not re-create phases, worksheets, or items that already exist.";
  }
  return "Resume the previous estimate session. Read CLAUDE.md, check the current state with getWorkspace and getEstimateStrategy, then continue from where you left off. Do not re-create phases, worksheets, or items that already exist.";
}

// Active sessions: one per project
const sessions = new Map<string, CliSession>();
const BENIGN_CODEX_STDERR_PATTERNS = [
  /codex_core::plugins::startup_sync:/,
  /codex_core::plugins::manager: failed to warm featured plugin ids cache/,
  /codex_core::plugins::manifest: ignoring interface\.defaultPrompt/,
  /codex_core::shell_snapshot: Failed to create shell snapshot for powershell/,
  /^Reading additional input from stdin\.\.\.$/,
];

function getCliCandidates(runtime: AgentRuntime, customCliPath?: string): string[] {
  const candidates: string[] = [];
  if (customCliPath?.trim()) candidates.push(customCliPath.trim());

  const isWin = process.platform === "win32";
  if (runtime === "codex" && isWin) {
    const appData = process.env.APPDATA || join(process.env.USERPROFILE || "", "AppData", "Roaming");
    const npmShim = join(appData, "npm", "codex.cmd");
    if (existsSync(npmShim)) candidates.push(npmShim);
  }

  candidates.push(runtime === "claude-code" ? "claude" : "codex");
  return [...new Set(candidates)];
}

function resolveCliCommand(runtime: AgentRuntime, customCliPath?: string): string {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  for (const candidate of getCliCandidates(runtime, customCliPath)) {
    if (candidate.includes("\\") || candidate.includes("/") || /^[A-Za-z]:/.test(candidate)) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    try {
      const resolved = execSync(`${whichCmd} ${candidate}`, { encoding: "utf-8" }).trim().split(/\r?\n/)[0];
      if (resolved) return resolved;
    } catch {
      // Try next candidate
    }
  }
  return runtime === "claude-code" ? "claude" : "codex";
}

function getCliVersion(command: string): string | undefined {
  try {
    const executable = command.includes(" ") ? `"${command}"` : command;
    return execSync(`${executable} --version`, { encoding: "utf-8" }).trim();
  } catch {
    return undefined;
  }
}

function quoteWindowsArg(arg: string): string {
  if (arg.includes(" ") || arg.includes("\\") || arg.includes('"')) return `"${arg}"`;
  return arg;
}

async function prepareCodexHome(
  projectDir: string,
  mcpRunner: string,
  mcpArgs: string[],
  mcpEnv: Record<string, string>,
): Promise<string> {
  const codexHome = join(projectDir, ".codex");
  await mkdir(codexHome, { recursive: true });

  const defaultHome = process.env.HOME || process.env.USERPROFILE || "";
  const sourceCodexHome = process.env.CODEX_HOME || join(defaultHome, ".codex");

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

async function persistSessionState(session: CliSession, extra: Record<string, unknown> = {}) {
  const projectDir = typeof session._spawnOpts?.projectDir === "string"
    ? session._spawnOpts.projectDir
    : null;
  if (!projectDir) return;

  const sessionJsonDir = join(projectDir, ".bidwright");
  await mkdir(sessionJsonDir, { recursive: true });
  await writeFile(join(sessionJsonDir, "session.json"), JSON.stringify({
    pid: session.process.pid,
    runtime: session.runtime,
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    status: session.status,
    ...extra,
  }));
}

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
export function detectCli(runtime: AgentRuntime, customCliPath?: string): { available: boolean; path: string; version?: string } {
  try {
    const path = resolveCliCommand(runtime, customCliPath);
    if (!path) return { available: false, path: "" };
    return { available: true, path, version: getCliVersion(path) };
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
    cliCmd = resolveCliCommand(runtime, customCliPath);

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

    // On Windows with shell:true, newlines in args break cmd.exe (it treats \n as command separator).
    // Replace newlines with spaces to keep the prompt on one line.
    const safePrompt = isWin ? prompt.replace(/\r?\n/g, " ") : prompt;

    cliArgs = [
      "-p", safePrompt,
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
    cliCmd = resolveCliCommand(runtime, customCliPath);
    cliEnv.CODEX_HOME = await prepareCodexHome(projectDir, mcpRunner, mcpArgs, mcpEnv);
    cliArgs = [
      "exec", // Non-interactive mode
      "--dangerously-bypass-approvals-and-sandbox",
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

  const events = new EventEmitter();

  // On Windows, .cmd files require cmd.exe to run.
  // We write a .bat launcher script to avoid all cmd.exe quoting hell.
  if (isWin) {
    // Resolve full path to the .cmd file
    let resolvedCmd = cliCmd;
    try {
      const candidates = execSync(`where ${cliCmd}`, { encoding: "utf-8" }).trim().split(/\r?\n/);
      resolvedCmd = candidates.find(c => /\.(cmd|bat|exe)$/i.test(c)) || candidates[0];
    } catch {}

    // Write prompt to a file (avoids quoting issues with special chars)
    const promptFile = join(projectDir, ".bidwright-prompt.txt");
    let usePromptStdin = false;
    const promptIdx = cliArgs.indexOf("-p");
    if (promptIdx >= 0 && promptIdx + 1 < cliArgs.length) {
      await writeFile(promptFile, cliArgs[promptIdx + 1]);
      // Replace the prompt in args with a short reference
      cliArgs[promptIdx + 1] = "Execute the instructions in .bidwright-prompt.txt";
    } else if (runtime === "codex" && cliArgs.length > 0) {
      await writeFile(promptFile, prompt, "utf-8");
      cliArgs[cliArgs.length - 1] = "-";
      usePromptStdin = true;
    }

    // Write a .bat file that calls the CLI with all args properly quoted
    const batLines = ["@echo off"];
    const quotedArgs = cliArgs.map(quoteWindowsArg);
    if (usePromptStdin) {
      batLines.push(`type "${promptFile}" | call "${resolvedCmd}" ${quotedArgs.join(" ")}`);
    } else {
      batLines.push(`call "${resolvedCmd}" ${quotedArgs.join(" ")}`);
    }
    const batFile = join(projectDir, ".bidwright-run.bat");
    await writeFile(batFile, batLines.join("\r\n") + "\r\n");

    console.log(`[cli:spawn:win] bat=${batFile} cmd=${resolvedCmd}`);

    const child = spawn("cmd.exe", ["/c", batFile], {
      cwd: projectDir,
      env: { ...process.env, ...cliEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(`[cli:spawn:win] pid=${child.pid}`);

    const session: CliSession = {
      projectId, runtime, process: child, sessionId: "", status: "running",
      events, startedAt: new Date().toISOString(), pid: child.pid || 0,
    };
    session._spawnOpts = opts;
    session._recoveryCount = 0;
    sessions.set(projectId, session);
    wireChildProcess(child, session, runtime, events);
    await persistSessionState(session);
    return session;
  }

  console.log(`[cli:spawn] cmd=${cliCmd} cwd=${projectDir} argCount=${cliArgs.length}`);

  const child = spawn(cliCmd, cliArgs, {
    cwd: projectDir,
    env: { ...process.env, ...cliEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log(`[cli:spawn] pid=${child.pid}`);

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
  await persistSessionState(session);

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
  let suppressCodexHtmlWarning = false;

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
            persistSessionState(session).catch(() => {});
          }
          if (runtime === "codex" && parsed.type === "thread.started" && parsed.thread_id) {
            session.sessionId = parsed.thread_id;
            persistSessionState(session).catch(() => {});
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
        if (runtime === "codex") {
          const trimmed = line.trim();
          if (suppressCodexHtmlWarning) {
            if (trimmed.includes("</html>")) suppressCodexHtmlWarning = false;
            return;
          }
          if (BENIGN_CODEX_STDERR_PATTERNS.some((pattern) => pattern.test(trimmed))) {
            if (trimmed.includes("<html>")) suppressCodexHtmlWarning = true;
            return;
          }
          if (trimmed.startsWith("<html>") || trimmed.startsWith("<head>") || trimmed.startsWith("<body>") || trimmed.startsWith("<div") || trimmed.startsWith("<meta") || trimmed.startsWith("<style") || trimmed.startsWith("<script") || trimmed.startsWith("</")) {
            return;
          }
        }
        console.error(`[cli:stderr:${session.projectId}]`, line.trim());
        events.emit("event", { type: "error", data: { message: line.trim() } });
      }
    });
  }

  child.on("exit", (code, signal) => {
    console.log(`[cli:exit:${session.projectId}] code=${code} signal=${signal}`);
    session.status = signal === "SIGINT" ? "stopped" : code === 0 ? "completed" : "failed";
    persistSessionState(session).catch(() => {});
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
  const events: SSEEventData[] = [];

  if (msg.type === "thread.started") {
    events.push({ type: "status", data: { status: "running", sessionId: msg.thread_id } });
  } else if (msg.type === "turn.started") {
    events.push({ type: "progress", data: { phase: "Running", detail: "Turn started" } });
  } else if (msg.type === "item.started" && msg.item?.type === "command_execution") {
    if (msg.item?.id) toolStartTimes.set(msg.item.id, Date.now());
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
    if (toolUseId && toolStartTimes.has(toolUseId)) {
      duration_ms = Date.now() - toolStartTimes.get(toolUseId)!;
      toolStartTimes.delete(toolUseId);
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
  } else if (msg.type === "item.completed" && (msg.item?.type === "tool_call" || msg.item?.type === "function_call")) {
    if (msg.item?.id) toolStartTimes.set(msg.item.id, Date.now());
    events.push({ type: "tool_call", data: { toolId: msg.item.name || msg.item.function, toolUseId: msg.item.id, input: msg.item.arguments || msg.item.input } });
  } else if (msg.type === "item.completed" && (msg.item?.type === "tool_result" || msg.item?.type === "function_result")) {
    const toolUseId = msg.item?.id || msg.item?.call_id;
    let duration_ms = 0;
    if (toolUseId && toolStartTimes.has(toolUseId)) {
      duration_ms = Date.now() - toolStartTimes.get(toolUseId)!;
      toolStartTimes.delete(toolUseId);
    }
    events.push({ type: "tool_result", data: { toolUseId, duration_ms, content: msg.item.output || msg.item.result } });
  } else if (msg.type === "turn.completed") {
    events.push({ type: "progress", data: { phase: "Turn complete", detail: "Codex turn completed" } });
  } else if (msg.type === "item.started" && msg.item?.type === "reasoning") {
    events.push({ type: "thinking", data: { content: msg.item.text || msg.item.summary || "Thinking..." } });
  } else if (msg.type === "message" || msg.type === "response") {
    events.push({ type: "message", data: { role: "assistant", content: msg.content || msg.text || JSON.stringify(msg) } });
  } else if (msg.type === "function_call" || msg.type === "tool_call") {
    if (msg.id) toolStartTimes.set(msg.id, Date.now());
    events.push({ type: "tool_call", data: { toolId: msg.name || msg.function, toolUseId: msg.id, input: msg.arguments || msg.input } });
  } else if (msg.type === "function_result" || msg.type === "tool_result") {
    const toolUseId = msg.id || msg.call_id;
    let duration_ms = 0;
    if (toolUseId && toolStartTimes.has(toolUseId)) {
      duration_ms = Date.now() - toolStartTimes.get(toolUseId)!;
      toolStartTimes.delete(toolUseId);
    }
    events.push({ type: "tool_result", data: { toolUseId, duration_ms, content: msg.output || msg.result } });
  } else {
    if (msg.type === "item.started" || msg.type === "item.completed") {
      return events;
    }
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
 * Resume a stopped session
 */
export async function resumeSession(opts: {
  projectId: string;
  projectDir: string;
  runtime?: AgentRuntime;
  prompt?: string;
  authToken?: string;
  apiBaseUrl?: string;
  revisionId?: string;
  quoteId?: string;
  model?: string;
  customCliPath?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
}): Promise<CliSession> {
  const session = sessions.get(opts.projectId);
  const sessionId = session?.sessionId;
  const runtime = opts.runtime || session?.runtime;

  if (!sessionId) {
    // No session to resume — try reading from disk
    const sessionJsonPath = join(opts.projectDir, ".bidwright", "session.json");
    if (existsSync(sessionJsonPath)) {
      const saved = JSON.parse(await readFile(sessionJsonPath, "utf-8"));
      if (saved.sessionId) {
        return spawnResumedSession({ ...opts, runtime: saved.runtime || runtime || "claude-code" }, saved.sessionId);
      }
    }
    throw new Error("No session to resume for this project");
  }

  return spawnResumedSession({ ...opts, runtime: runtime || "claude-code" }, sessionId);
}

async function spawnResumedSession(opts: any, sessionId: string): Promise<CliSession> {
  const {
    projectId,
    projectDir,
    model,
    customCliPath,
    anthropicApiKey,
    openaiApiKey,
    authToken,
    apiBaseUrl,
    revisionId,
    quoteId,
  } = opts;
  const runtime: AgentRuntime = opts.runtime === "codex" ? "codex" : "claude-code";
  const resumePrompt = typeof opts.prompt === "string" && opts.prompt.trim()
    ? opts.prompt.trim()
    : buildDefaultResumePrompt(runtime);
  const cliCmd = resolveCliCommand(runtime, customCliPath);
  const isWin = process.platform === "win32";
  const mcpServerPath = getMcpServerPath();
  const npxCmd = isWin ? "npx.cmd" : "npx";
  const nodeCmd = isWin ? "node.exe" : "node";
  const mcpRunner = existsSync(mcpServerPath) && mcpServerPath.endsWith(".ts") ? npxCmd : nodeCmd;
  const mcpArgs = mcpServerPath.endsWith(".ts") ? ["tsx", mcpServerPath] : [mcpServerPath];
  const mcpEnv: Record<string, string> = {
    BIDWRIGHT_API_URL: apiBaseUrl || "http://localhost:4001",
    BIDWRIGHT_AUTH_TOKEN: authToken || "",
    BIDWRIGHT_PROJECT_ID: projectId,
    BIDWRIGHT_REVISION_ID: revisionId || "",
    BIDWRIGHT_QUOTE_ID: quoteId || "",
  };
  const cliEnv: Record<string, string> = { ...mcpEnv };

  let cliArgs: string[];
  if (runtime === "claude-code") {
    cliArgs = [
      "--resume", sessionId,
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
      "--verbose",
      "--max-turns", "200",
    ];
    if (resumePrompt) cliArgs.push("-p", resumePrompt);
    if (model) cliArgs.push("--model", model);
    if (anthropicApiKey) cliEnv.ANTHROPIC_API_KEY = anthropicApiKey;
  } else {
    cliEnv.CODEX_HOME = await prepareCodexHome(projectDir, mcpRunner, mcpArgs, mcpEnv);
    cliArgs = [
      "exec",
      "resume",
      "--dangerously-bypass-approvals-and-sandbox",
    ];
    if (model) cliArgs.push("--model", model);
    cliArgs.push("--json");
    cliArgs.push(sessionId);
    cliArgs.push(resumePrompt);
    if (openaiApiKey) cliEnv.CODEX_API_KEY = openaiApiKey;
  }

  let child: ChildProcess;
  if (isWin) {
    const promptFile = join(projectDir, ".bidwright-prompt.txt");
    let usePromptStdin = false;
    if (runtime === "codex") {
      await writeFile(promptFile, resumePrompt, "utf-8");
      cliArgs[cliArgs.length - 1] = "-";
      usePromptStdin = true;
    } else if (runtime === "claude-code") {
      const promptIdx = cliArgs.indexOf("-p");
      if (promptIdx >= 0 && promptIdx + 1 < cliArgs.length) {
        await writeFile(promptFile, cliArgs[promptIdx + 1], "utf-8");
        cliArgs[promptIdx + 1] = "Execute the instructions in .bidwright-prompt.txt";
      }
    }
    const batLines = ["@echo off"];
    const quotedArgs = cliArgs.map(quoteWindowsArg);
    const batFile = join(projectDir, ".bidwright-resume.bat");
    if (usePromptStdin) {
      batLines.push(`type "${promptFile}" | call "${cliCmd}" ${quotedArgs.join(" ")}`);
    } else {
      batLines.push(`call "${cliCmd}" ${quotedArgs.join(" ")}`);
    }
    await writeFile(batFile, batLines.join("\r\n") + "\r\n");
    child = spawn("cmd.exe", ["/c", batFile], {
      cwd: projectDir,
      env: { ...process.env, ...cliEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    child = spawn(cliCmd, cliArgs, {
      cwd: projectDir,
      env: { ...process.env, ...cliEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

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
  session._spawnOpts = { ...opts, projectDir, runtime, customCliPath, anthropicApiKey, openaiApiKey };

  sessions.set(projectId, session);

  // Wire up stdout/stderr/exit handlers (shared helper)
  wireChildProcess(child, session, runtime, events);

  await persistSessionState(session, { resumed: true });

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
