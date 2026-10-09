import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePythonJson, spawnPythonCommand } from "./python-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_DIR = path.resolve(__dirname, "..", "python");
const READER_SCRIPT = path.join(PYTHON_DIR, "tools", "page_reader.py");

/** Normalized 0..1 box in the page's upright display frame. */
export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReadPdfPageRequest {
  pdfPath: string;
  pageNumber: number;
  mode: "overview" | "tile";
  /** Tile id from the overview grid, e.g. "r2c3". */
  tile?: string;
  bbox?: NormalizedBox;
  /** Longest image edge in pixels; size it to what the model sees natively. */
  maxEdge?: number;
  /** Upper bound on render resolution. */
  dpi?: number;
  /** Override auto-orientation (degrees clockwise). */
  rotation?: number;
}

export interface PageTextLine {
  text: string;
  bbox: NormalizedBox;
  size: number;
  block: number;
}

export interface PageRegion {
  id: string;
  kind: "view" | "table" | "note";
  bbox?: NormalizedBox;
  label?: string;
  error?: string;
}

export interface ReadPdfPageResult {
  success: boolean;
  mode?: "overview" | "tile";
  pageNumber?: number;
  pageCount?: number;
  rotation?: number;
  pageSizeInches?: { width: number; height: number };
  bbox?: NormalizedBox;
  image?: string;
  imageHash?: string;
  width?: number;
  height?: number;
  dpi?: number;
  textLines?: PageTextLine[];
  textLinesTotal?: number;
  textLinesTruncated?: boolean;
  grid?: { rows: number; cols: number; tiles: Array<{ id: string; bbox: NormalizedBox }> };
  regions?: PageRegion[];
  wordCount?: number;
  drawingCount?: number;
  vectorTextLikely?: boolean;
  analysisWarnings?: string[];
  code?: string;
  error?: string;
  duration_ms: number;
}

export async function readPdfPage(request: ReadPdfPageRequest): Promise<ReadPdfPageResult> {
  const start = Date.now();
  const { stdout, stderr, code, timedOut } = await spawnPythonCommand({
    scriptArgs: [READER_SCRIPT],
    cwd: PYTHON_DIR,
    timeoutMs: 60_000,
    env: { ...process.env },
    stdin: JSON.stringify(request),
  });
  const duration_ms = Date.now() - start;
  if (timedOut) {
    return { success: false, code: "page_read_timeout", error: stderr, duration_ms };
  }
  if (code !== 0) {
    return { success: false, error: stderr || `exit code ${code}`, duration_ms };
  }
  const parsed = parsePythonJson<Record<string, unknown>>(stdout);
  if (!parsed.ok) {
    return { success: false, error: parsed.error, duration_ms };
  }
  return { ...(parsed.value as object), duration_ms } as ReadPdfPageResult;
}
