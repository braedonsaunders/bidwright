import { spawn } from "node:child_process";

const CONTAINER_VENV_PYTHON = process.platform === "win32" ? undefined : "/opt/vision-venv/bin/python";

export interface PythonSpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
  command: string;
}

function getPythonCandidates(): string[] {
  const preferred = process.env.PYTHON_PATH;
  const platformDefault = process.platform === "win32" ? "python" : "python3";
  return [preferred, CONTAINER_VENV_PYTHON, platformDefault, "python"]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, list) => list.indexOf(value) === index);
}

function spawnSingleCommand(args: {
  command: string;
  scriptArgs: string[];
  cwd: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  stdin?: string;
}): Promise<PythonSpawnResult & { notFound: boolean }> {
  return new Promise((resolve) => {
    const proc = spawn(args.command, args.scriptArgs, {
      cwd: args.cwd,
      timeout: args.timeoutMs,
      env: {
        ...args.env,
        PYTHONUNBUFFERED: "1",
      },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: PythonSpawnResult & { notFound: boolean }) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      finish({
        stdout,
        stderr,
        code,
        command: args.command,
        notFound: false,
      });
    });

    proc.on("error", (err) => {
      const errno = err as NodeJS.ErrnoException;
      finish({
        stdout: "",
        stderr: err.message,
        code: -1,
        command: args.command,
        notFound: errno.code === "ENOENT",
      });
    });

    try {
      proc.stdin.end(args.stdin ?? "");
    } catch {
      // If the command fails before stdin is writable, the error handler above will report it.
    }
  });
}

/**
 * Every tool here answers with a single JSON document on stdout, so any
 * library that prints a banner there corrupts the reply. PyMuPDF routes its
 * diagnostics (including the "fitz is deprecated" notice) through a message
 * channel that defaults to stdout; `fd:2` moves them to stderr, where they
 * stay visible in logs without breaking the contract.
 */
function withQuietPythonStdout(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    PYMUPDF_MESSAGE: "fd:2",
    PYTHONWARNINGS: "ignore",
    ...env,
  };
}

export async function spawnPythonCommand(args: {
  scriptArgs: string[];
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
}): Promise<PythonSpawnResult> {
  const candidates = getPythonCandidates();
  const missingCommands: string[] = [];

  for (const command of candidates) {
    const result = await spawnSingleCommand({
      command,
      scriptArgs: args.scriptArgs,
      cwd: args.cwd,
      timeoutMs: args.timeoutMs ?? 120_000,
      env: withQuietPythonStdout(args.env ?? process.env),
      stdin: args.stdin,
    });

    if (result.notFound) {
      missingCommands.push(command);
      continue;
    }

    return result;
  }

  return {
    stdout: "",
    stderr: `No Python interpreter found. Tried: ${missingCommands.join(", ")}`,
    code: -1,
    command: missingCommands[0] ?? "python",
  };
}

/**
 * Parse a Python tool's stdout as JSON, tolerating a preamble.
 *
 * The tools promise one JSON document on stdout, but a dependency printing a
 * banner on import (PyMuPDF's deprecated-`fitz` notice is the one that bit us)
 * silently turned every reply into a parse error. Recover the payload by
 * scanning for the outermost JSON value rather than failing the whole call.
 */
export function parsePythonJson<T = unknown>(stdout: string): { ok: true; value: T } | { ok: false; error: string } {
  const text = (stdout ?? "").trim();
  if (!text) return { ok: false, error: "Python tool produced no output" };

  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    // Fall through to recovery.
  }

  for (const opener of ["{", "["] as const) {
    const start = text.indexOf(opener);
    if (start < 0) continue;
    const closer = opener === "{" ? "}" : "]";
    const end = text.lastIndexOf(closer);
    if (end <= start) continue;
    try {
      return { ok: true, value: JSON.parse(text.slice(start, end + 1)) as T };
    } catch {
      // Try the other bracket shape.
    }
  }

  return { ok: false, error: `Bad JSON: ${text.slice(0, 300)}` };
}

/** Throwing form, for call sites that already funnel failures into a catch. */
export function parsePythonJsonOrThrow<T = unknown>(stdout: string): T {
  const parsed = parsePythonJson<T>(stdout);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}
