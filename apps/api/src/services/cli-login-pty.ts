/**
 * CLI OAuth login PTY service.
 *
 * Spawns a CLI runtime's interactive OAuth flow (e.g. `claude` then `/login`,
 * `codex login`, `opencode auth login`, `gemini auth`) inside a real
 * pseudo-terminal so the WebSocket bridge can stream the dialogue to an
 * xterm.js modal in the browser.
 *
 * Why a PTY and not plain pipes:
 *   • Several of the CLIs detect non-TTY stdout and fall back to non-
 *     interactive output that hides the OAuth URL or the device code.
 *   • Some flows poll for input (Enter to continue, arrow-key provider
 *     pickers); we need to forward keystrokes byte-perfect.
 *   • Carriage-return and ANSI escape sequences are part of the auth UX
 *     and a plain stdio pipe mangles them.
 *
 * The login process runs **inside the user's per-user agent-home namespace**
 * so the OAuth credential it produces lands at the right path
 * (`<agentHomeDir>/.claude/.credentials.json` etc.) and is picked up on
 * subsequent CLI spawns for the same user. In desktop mode the namespace
 * resolves to null and the login writes to the host's `~/.claude` etc. as
 * before.
 *
 * Sessions live in an in-memory map keyed by an opaque `sessionId`. The
 * route layer creates a session, returns the id, and the browser opens a
 * WebSocket at `/api/cli/login/<id>/stream` to attach. Sessions auto-expire
 * after `MAX_SESSION_LIFETIME_MS` (default 10 min) so a forgotten browser
 * tab can't keep a CLI running indefinitely.
 */

import { randomUUID } from "node:crypto";
import { spawn as ptySpawn, type IPty } from "node-pty";

import type { AgentRuntime } from "./cli-runtime.js";
import { getUserAgentHome, ensureUserAgentHome } from "./agent-home.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface LoginSession {
  id: string;
  userId: string;
  runtime: AgentRuntime;
  pty: IPty;
  /** Bytes the PTY has emitted since spawn — replayed to a late attacher. */
  buffer: string;
  /** Listeners attached via `attach`. The PTY can be split-streamed if
   *  e.g. the user reloads the modal mid-flow. */
  listeners: Set<(chunk: string) => void>;
  exited: boolean;
  exitCode: number | null;
  startedAt: number;
  /** Set when the OAuth dance has finished and a fresh credentials file is
   *  on disk; the browser polls /status to detect this and close the modal. */
  authenticatedAt: number | null;
  expireTimer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, LoginSession>();
const MAX_SESSION_LIFETIME_MS = 10 * 60 * 1000; // 10 min hard cap
const MAX_BUFFER_BYTES = 256 * 1024; // 256 KiB scrollback per session

interface LoginCommand {
  bin: string;
  args: string[];
  /** Sent to the PTY's stdin once after spawn — used for `claude` where the
   *  REPL needs to receive the slash command rather than start with it. */
  initialInput?: string;
}

/**
 * Map a runtime to the actual command + initial input that drives its OAuth
 * flow. Kept out of the adapter interface for now because the four CLIs
 * differ enough that a single signature would fight the implementations.
 */
function getLoginCommand(runtime: AgentRuntime): LoginCommand | null {
  switch (runtime) {
    case "claude-code":
      // Claude Code has no `claude login` subcommand — the OAuth flow is the
      // `/login` slash command inside the interactive REPL. We spawn the
      // REPL and immediately type `/login\r`.
      return { bin: "claude", args: [], initialInput: "/login\r" };
    case "codex":
      return { bin: "codex", args: ["login"] };
    case "opencode":
      return { bin: "opencode", args: ["auth", "login"] };
    case "gemini":
      // Gemini CLI's login is interactive: `gemini` then a menu choice.
      // The CLI prints a URL and polls for a callback. Different gemini
      // distributions expose different commands; `auth` is the most common.
      return { bin: "gemini", args: ["auth"] };
    default:
      return null;
  }
}

/**
 * Compute the env overrides each CLI needs so it writes its OAuth credential
 * into the per-user namespace dir rather than the host's home. Mirrors the
 * spawn-time overrides in each adapter's `prepareWorkspace`.
 */
async function buildLoginEnv(
  runtime: AgentRuntime,
  agentHomeDir: string | null,
): Promise<Record<string, string>> {
  if (!agentHomeDir) return {};
  switch (runtime) {
    case "claude-code": {
      const dir = join(agentHomeDir, ".claude");
      await mkdir(dir, { recursive: true });
      return { CLAUDE_CONFIG_DIR: dir };
    }
    case "codex": {
      const dir = join(agentHomeDir, ".codex");
      await mkdir(dir, { recursive: true });
      return { CODEX_HOME: dir };
    }
    case "opencode": {
      const dataDir = join(agentHomeDir, "data");
      const configDir = join(agentHomeDir, "config");
      await mkdir(join(dataDir, "opencode"), { recursive: true });
      await mkdir(join(configDir, "opencode"), { recursive: true });
      return { XDG_DATA_HOME: dataDir, XDG_CONFIG_HOME: configDir };
    }
    case "gemini": {
      await mkdir(join(agentHomeDir, ".gemini"), { recursive: true });
      return { HOME: agentHomeDir };
    }
    default:
      return {};
  }
}

export class LoginNotSupportedError extends Error {
  constructor(runtime: AgentRuntime) {
    super(`No interactive login flow registered for runtime "${runtime}"`);
  }
}

export class LoginCliMissingError extends Error {
  constructor(runtime: AgentRuntime, bin: string) {
    super(`${runtime} CLI ("${bin}") is not installed or not on PATH`);
  }
}

/**
 * Start a new login session for a user. Returns the sessionId; the caller
 * passes that to the WebSocket route to attach. The PTY is alive and
 * buffering output as soon as this returns, so a delayed WS attach replays
 * the scrollback.
 */
export async function startLoginSession(opts: {
  userId: string;
  runtime: AgentRuntime;
}): Promise<{ sessionId: string }> {
  const cmd = getLoginCommand(opts.runtime);
  if (!cmd) throw new LoginNotSupportedError(opts.runtime);

  const agentHomeDir = await ensureUserAgentHome(opts.userId);
  const extraEnv = await buildLoginEnv(opts.runtime, agentHomeDir);

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...extraEnv,
    // Force interactive output even if the CLI peeks at process.stdout.isTTY
    // and we somehow lose the TTY flag through env passthrough.
    TERM: process.env.TERM || "xterm-256color",
  };

  let pty: IPty;
  try {
    pty = ptySpawn(cmd.bin, cmd.args, {
      name: env.TERM,
      cols: 120,
      rows: 30,
      cwd: agentHomeDir || process.cwd(),
      env,
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") throw new LoginCliMissingError(opts.runtime, cmd.bin);
    throw err;
  }

  const id = randomUUID();
  const session: LoginSession = {
    id,
    userId: opts.userId,
    runtime: opts.runtime,
    pty,
    buffer: "",
    listeners: new Set(),
    exited: false,
    exitCode: null,
    startedAt: Date.now(),
    authenticatedAt: null,
    expireTimer: setTimeout(() => {
      // Defensive: any session that hasn't completed in 10 min is killed
      // so a forgotten browser tab can't hold a CLI process open forever.
      void killLoginSession(id, "timeout");
    }, MAX_SESSION_LIFETIME_MS),
  };

  pty.onData((chunk: string) => {
    if (session.buffer.length + chunk.length > MAX_BUFFER_BYTES) {
      // Slide the window so we never grow the buffer without bound on a
      // chatty CLI. Browsers always replay from the start of `buffer` on
      // attach, so this just means earliest-byte truncation under heavy
      // logging — acceptable for a login-flow scrollback.
      session.buffer = session.buffer.slice(
        Math.max(0, session.buffer.length + chunk.length - MAX_BUFFER_BYTES),
      );
    }
    session.buffer += chunk;
    for (const listener of session.listeners) {
      try {
        listener(chunk);
      } catch (err) {
        // A listener crash must not poison the broadcast for the others.
        console.error(`[cli-login] listener error for session ${id}:`, err);
      }
    }
  });

  pty.onExit(({ exitCode, signal }) => {
    session.exited = true;
    session.exitCode = exitCode ?? null;
    const tail = `\r\n[bidwright] login process exited (code ${exitCode}${
      signal !== undefined ? `, signal ${signal}` : ""
    })\r\n`;
    session.buffer += tail;
    for (const listener of session.listeners) {
      try {
        listener(tail);
      } catch {
        // Same defense as above.
      }
    }
    // Keep the session around briefly so a slow browser can fetch the final
    // status; the expire timer will clean it up.
  });

  if (cmd.initialInput) {
    // Defer one tick so the CLI has a chance to draw its prompt before we
    // type into it; some shells discard input that arrives before the
    // initial frame.
    setTimeout(() => {
      try {
        pty.write(cmd.initialInput!);
      } catch {
        // PTY may have already exited; safe to ignore.
      }
    }, 250);
  }

  sessions.set(id, session);
  return { sessionId: id };
}

/** Look up an active or recently-exited session. */
export function getLoginSession(sessionId: string): LoginSession | undefined {
  return sessions.get(sessionId);
}

/**
 * Attach a stream listener to a session. Returns the buffered scrollback so
 * the caller can write it to the new transport before live data starts
 * arriving. The detach function removes the listener; the PTY itself keeps
 * running until the user completes the OAuth flow or the timer fires.
 */
export function attachLoginSession(
  sessionId: string,
  listener: (chunk: string) => void,
): { backlog: string; detach: () => void } | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  session.listeners.add(listener);
  return {
    backlog: session.buffer,
    detach: () => {
      session.listeners.delete(listener);
    },
  };
}

/** Forward a chunk of input from the browser into the PTY's stdin. */
export function writeLoginInput(sessionId: string, chunk: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.exited) return false;
  try {
    session.pty.write(chunk);
    return true;
  } catch (err) {
    console.error(`[cli-login] write to ${sessionId} failed:`, err);
    return false;
  }
}

/** Resize the PTY to match the browser xterm dimensions. */
export function resizeLoginSession(sessionId: string, cols: number, rows: number): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.exited) return false;
  try {
    session.pty.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)));
    return true;
  } catch (err) {
    console.error(`[cli-login] resize ${sessionId} failed:`, err);
    return false;
  }
}

/** Kill the PTY and drop the session immediately. */
export async function killLoginSession(
  sessionId: string,
  reason: "user" | "timeout" | "cleanup" = "user",
): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) return false;
  clearTimeout(session.expireTimer);
  if (!session.exited) {
    try {
      session.pty.kill();
    } catch {
      // Already gone.
    }
  }
  if (reason === "user") {
    const tail = `\r\n[bidwright] login session terminated by user\r\n`;
    session.buffer += tail;
    for (const listener of session.listeners) {
      try {
        listener(tail);
      } catch {
        /* ignore */
      }
    }
  }
  sessions.delete(sessionId);
  return true;
}

/**
 * Mark a session as having completed the OAuth handshake. Called by the
 * route layer after re-running `checkCliAuth` and seeing the credentials
 * file appear under the user's namespace; the browser polls /status to
 * pick this up and close the modal cleanly.
 */
export function markSessionAuthenticated(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.authenticatedAt = Date.now();
}

/**
 * Snapshot the runtime state of a session for the polling /status endpoint.
 * Never returns the raw scrollback (the WebSocket is the only path to that)
 * so that an intermediary like a logging proxy can't accidentally capture
 * the OAuth URL/device code from a status poll.
 */
export interface LoginSessionStatus {
  id: string;
  runtime: AgentRuntime;
  exited: boolean;
  exitCode: number | null;
  authenticatedAt: number | null;
  startedAt: number;
}

export function getLoginSessionStatus(sessionId: string): LoginSessionStatus | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return {
    id: session.id,
    runtime: session.runtime,
    exited: session.exited,
    exitCode: session.exitCode,
    authenticatedAt: session.authenticatedAt,
    startedAt: session.startedAt,
  };
}

/** Resolve the per-user agent-home dir for a userId — exported so the route
 *  layer can re-run checkCliAuth post-login against the right namespace. */
export function loginAgentHomeFor(userId: string | null | undefined): string | null {
  return getUserAgentHome(userId ?? null);
}
