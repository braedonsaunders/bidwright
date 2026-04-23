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
      env: args.env ?? process.env,
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
