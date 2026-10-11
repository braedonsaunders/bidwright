import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parsePythonJsonOrThrow,
  spawnPythonCommand,
} from "./python-runtime.js";

export async function runPdfTakeoff(
  request: Record<string, unknown>,
): Promise<any> {
  const cwd = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "python",
  );
  const result = await spawnPythonCommand({
    scriptArgs: [path.join(cwd, "tools/pdf_takeoff.py")],
    cwd,
    timeoutMs: 60_000,
    env: { ...process.env },
    stdin: JSON.stringify(request),
  });
  if (result.timedOut || result.code !== 0)
    throw new Error(result.stderr || "PDF takeoff failed");
  return parsePythonJsonOrThrow(result.stdout);
}
