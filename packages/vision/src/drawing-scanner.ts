import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnPythonCommand } from "./python-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_DIR = path.resolve(__dirname, "..", "python");
const SCAN_DRAWING_SCRIPT = path.join(PYTHON_DIR, "tools", "scan_drawing.py");

/* ── Request / Response types ────────────────────────────────── */

export interface ScanDrawingRequest {
  /** Absolute path to the PDF on disk */
  pdfPath: string;
  /** 1-based page number (default 1) */
  pageNumber?: number;
  /** DPI for rendering (default 150) */
  dpi?: number;
  /** Minimum symbol size in pixels (default 20) */
  minSize?: number;
  /** Maximum symbol size in pixels (default 180) */
  maxSize?: number;
}

export interface SymbolCluster {
  id: number;
  representativeBox: { x: number; y: number; w: number; h: number };
  thumbnail?: string; // data:image/png;base64,...
  sizeCategory: "small" | "medium" | "large";
  avgDimensions: { w: number; h: number };
  candidateCount: number;
  matchCount: number;
  avgConfidence: number;
  topMatches: Array<{ x: number; y: number; w: number; h: number; confidence: number }>;
  countDuration_ms: number;
}

export interface ScanDrawingResult {
  clusters: SymbolCluster[];
  imageWidth: number;
  imageHeight: number;
  totalClusters: number;
  totalSymbolsFound: number;
  scanDuration_ms: number;
  error?: string;
}

/* ── Run the scan_drawing pipeline ───────────────────────────── */

export async function runScanDrawing(request: ScanDrawingRequest): Promise<ScanDrawingResult> {
  const start = Date.now();

  const payload = JSON.stringify({
    pdfPath: request.pdfPath,
    pageNumber: request.pageNumber ?? 1,
    dpi: request.dpi ?? 150,
    minSize: request.minSize ?? 20,
    maxSize: request.maxSize ?? 180,
  });

  const { stdout, stderr, code } = await spawnPythonCommand({
    scriptArgs: [SCAN_DRAWING_SCRIPT],
    cwd: PYTHON_DIR,
    timeoutMs: 120_000,
    env: { ...process.env },
    stdin: payload,
  });
  const duration_ms = Date.now() - start;

  if (code !== 0) {
    return {
      clusters: [],
      imageWidth: 0,
      imageHeight: 0,
      totalClusters: 0,
      totalSymbolsFound: 0,
      scanDuration_ms: duration_ms,
      error: stderr || `Process exited with code ${code}`,
    };
  }

  try {
    const result = JSON.parse(stdout);
    return {
      clusters: result.clusters ?? [],
      imageWidth: result.imageWidth ?? 0,
      imageHeight: result.imageHeight ?? 0,
      totalClusters: result.totalClusters ?? 0,
      totalSymbolsFound: result.totalSymbolsFound ?? 0,
      scanDuration_ms: result.scanDuration_ms ?? duration_ms,
    };
  } catch {
    return {
      clusters: [],
      imageWidth: 0,
      imageHeight: 0,
      totalClusters: 0,
      totalSymbolsFound: 0,
      scanDuration_ms: duration_ms,
      error: `Failed to parse Python output: ${stdout.slice(0, 500)}`,
    };
  }
}
