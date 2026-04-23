import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnPythonCommand } from "./python-runtime.js";

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

  const { stdout, stderr, code } = await spawnPythonCommand({
    scriptArgs: [FIND_SYMBOLS_SCRIPT],
    cwd: PYTHON_DIR,
    timeoutMs: 60_000,
    env: { ...process.env },
    stdin: payload,
  });
  const duration_ms = Date.now() - start;

  if (code !== 0) {
    return {
      candidates: [],
      total: 0,
      imageWidth: 0,
      imageHeight: 0,
      duration_ms,
      error: stderr || `Process exited with code ${code}`,
    };
  }

  try {
    const result = JSON.parse(stdout);
    return {
      candidates: result.candidates ?? [],
      total: result.total ?? 0,
      imageWidth: result.imageWidth ?? 0,
      imageHeight: result.imageHeight ?? 0,
      duration_ms,
    };
  } catch {
    return {
      candidates: [],
      total: 0,
      imageWidth: 0,
      imageHeight: 0,
      duration_ms,
      error: `Failed to parse Python output: ${stdout.slice(0, 500)}`,
    };
  }
}
