import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_DIR = path.resolve(__dirname, "..", "python");
const FIND_SYMBOLS_SCRIPT = path.join(PYTHON_DIR, "tools", "find_symbols.py");

/* ── Request / Response types ────────────────────────────────── */

export interface FindSymbolsRequest {
  /** Absolute path to the PDF on disk */
  pdfPath: string;
  /** 1-based page number */
  pageNumber?: number;
  /** DPI for rendering (default 150) */
  dpi?: number;
  /** Minimum component size in pixels (default 20) */
  minSize?: number;
  /** Maximum component size in pixels (default 150) */
  maxSize?: number;
}

export interface SymbolCandidate {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
  cx: number;
  cy: number;
  aspect: number;
}

export interface FindSymbolsResult {
  candidates: SymbolCandidate[];
  total: number;
  imageWidth: number;
  imageHeight: number;
  duration_ms: number;
  error?: string;
}

/* ── Run the find_symbols pipeline ───────────────────────────── */

export async function runFindSymbols(request: FindSymbolsRequest): Promise<FindSymbolsResult> {
  const start = Date.now();

  const payload = JSON.stringify({
    pdfPath: request.pdfPath,
    pageNumber: request.pageNumber ?? 1,
    dpi: request.dpi ?? 150,
    minSize: request.minSize ?? 20,
    maxSize: request.maxSize ?? 150,
  });

  return new Promise((resolve) => {
    const pythonPath = process.env.PYTHON_PATH ?? "python3";
    const proc = spawn(pythonPath, [FIND_SYMBOLS_SCRIPT], {
      cwd: PYTHON_DIR,
      timeout: 60_000,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdin.write(payload);
    proc.stdin.end();

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      const duration_ms = Date.now() - start;
      if (code !== 0) {
        resolve({
          candidates: [],
          total: 0,
          imageWidth: 0,
          imageHeight: 0,
          duration_ms,
          error: stderr || `Process exited with code ${code}`,
        });
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve({
          candidates: result.candidates ?? [],
          total: result.total ?? 0,
          imageWidth: result.imageWidth ?? 0,
          imageHeight: result.imageHeight ?? 0,
          duration_ms,
        });
      } catch {
        resolve({
          candidates: [],
          total: 0,
          imageWidth: 0,
          imageHeight: 0,
          duration_ms,
          error: `Failed to parse Python output: ${stdout.slice(0, 500)}`,
        });
      }
    });

    proc.on("error", (err) => {
      resolve({
        candidates: [],
        total: 0,
        imageWidth: 0,
        imageHeight: 0,
        duration_ms: Date.now() - start,
        error: err.message,
      });
    });
  });
}
