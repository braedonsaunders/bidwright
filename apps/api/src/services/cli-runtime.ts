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
}

export interface SSEEventData {
  type: "thinking" | "tool_call" | "tool_result" | "message" | "progress" | "error" | "status" | "file_read";
  data: unknown;
}

// Active sessions: one per project
const sessions = new Map<string, CliSession>();

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
  try {
    const path = execSync(`which ${cmd}`, { encoding: "utf-8" }).trim();
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
  const thisDir = new URL(".", import.meta.url).pathname;
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
  const mcpRunner = existsSync(mcpServerPath) && mcpServerPath.endsWith(".ts") ? "npx" : "node";
  const mcpArgs = mcpServerPath.endsWith(".ts") ? ["tsx", mcpServerPath] : [mcpServerPath];

  // Environment for MCP server
  const mcpEnv: Record<string, string> = {
    BIDWRIGHT_API_URL: apiBaseUrl || "http://localhost:4001",
    BIDWRIGHT_AUTH_TOKEN: authToken || "",
    BIDWRIGHT_PROJECT_ID: projectId,
    BIDWRIGHT_REVISION_ID: revisionId || "",
    BIDWRIGHT_QUOTE_ID: quoteId || "",
  };

  // Write .claude/settings.json for Claude Code MCP discovery
  const claudeSettingsDir = join(projectDir, ".claude");
  await mkdir(claudeSettingsDir, { recursive: true });
  await writeFile(join(claudeSettingsDir, "settings.json"), JSON.stringify({
    permissions: {
      "allow": [
        "mcp__bidwright__*",
        "Read(*)",
        "Glob(*)",
        "Grep(*)",
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

    // Build MCP config JSON to pass directly via CLI flag
    const mcpConfig = JSON.stringify({
      mcpServers: {
        bidwright: {
          command: mcpRunner,
          args: mcpArgs,
          env: mcpEnv,
        },
      },
    });

    cliArgs = [
      "-p", prompt,
      "--output-format", "stream-json",
      "--dangerously-skip-permissions", // Non-interactive, no permission prompts
      "--verbose",
      "--mcp-config", mcpConfig, // Pass MCP server config directly
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

  // Spawn the CLI process
  const child = spawn(cliCmd, cliArgs, {
    cwd: projectDir,
    env: { ...process.env, ...cliEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });

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

  sessions.set(projectId, session);

  // Parse stdout line by line
  if (child.stdout) {
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);
        const sseEvents = parseCliOutput(parsed, runtime);
        for (const evt of sseEvents) {
          events.emit("event", evt);

          // Capture session ID from Claude Code init message
          if (parsed.type === "system" && parsed.subtype === "init" && parsed.session_id) {
            session.sessionId = parsed.session_id;
          }
        }
      } catch {
        // Non-JSON line (e.g. progress indicator) — emit as message
        if (line.trim()) {
          events.emit("event", { type: "message", data: { role: "system", content: line.trim() } });
        }
      }
    });
  }

  // Capture stderr for errors
  if (child.stderr) {
    const rl = createInterface({ input: child.stderr });
    rl.on("line", (line) => {
      if (line.trim()) {
        events.emit("event", { type: "error", data: { message: line.trim() } });
      }
    });
  }

  // Handle process exit
  child.on("exit", (code, signal) => {
    session.status = signal === "SIGINT" ? "stopped" : code === 0 ? "completed" : "failed";
    events.emit("event", {
      type: "status",
      data: { status: session.status, exitCode: code, signal },
    });
    events.emit("done", session.status);
  });

  child.on("error", (err) => {
    session.status = "failed";
    events.emit("event", { type: "error", data: { message: err.message } });
    events.emit("done", "failed");
  });

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

function parseClaudeCodeOutput(msg: any): SSEEventData[] {
  const events: SSEEventData[] = [];

  if (msg.type === "assistant") {
    const content = msg.content || msg.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "thinking" || block.type === "reasoning") {
          events.push({ type: "thinking", data: { content: block.thinking || block.text } });
        } else if (block.type === "tool_use") {
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
  } else if (msg.type === "tool") {
    // Tool result
    const content = msg.content || msg.message?.content;
    events.push({
      type: "tool_result",
      data: {
        toolUseId: msg.tool_use_id || msg.message?.tool_use_id,
        content: typeof content === "string" ? content : JSON.stringify(content),
      },
    });
  } else if (msg.type === "result") {
    events.push({ type: "status", data: { status: "completed", result: msg.result } });
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

  session.process.kill("SIGINT"); // Graceful shutdown
  session.status = "stopped";
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
  const cliCmd = opts.customCliPath || "claude";
  const args = [
    "--resume", sessionId,
    "--output-format", "stream-json",
    "--verbose",
  ];
  if (opts.prompt) args.push("-p", opts.prompt);

  return spawnSession({
    ...opts,
    prompt: opts.prompt || "Continue where you left off.",
    runtime: "claude-code",
  });
}

/**
 * Send a message to a running session
 */
export function sendMessage(projectId: string, message: string): boolean {
  const session = sessions.get(projectId);
  if (!session || session.status !== "running" || !session.process.stdin) return false;

  session.process.stdin.write(message + "\n");
  return true;
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
