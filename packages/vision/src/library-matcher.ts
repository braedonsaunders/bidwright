import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnPythonCommand } from "./python-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_DIR = path.resolve(__dirname, "..", "python");
const COUNT_LIBRARY_SCRIPT = path.join(PYTHON_DIR, "tools", "count_library.py");

export interface LibraryTemplateInput {
  /** Stable identifier echoed back in the per-template result. */
  id: string;
  /** Absolute path to a PNG on disk. Mutually exclusive with imageBase64. */
  imagePath?: string;
  /** Raw base64 (with or without `data:image/png;base64,` prefix). */
  imageBase64?: string;
  /** Match threshold. 0.75 is the autoresearch optimum. */
  threshold?: number;
  /** Try 0.75x – 1.25x scaling. ~6× slower; needed cross-document. */
  crossScale?: boolean;
  /** Per-template cap on results. Default 500. */
  maxMatches?: number;
}

export interface LibraryTemplateResult {
  templateId: string;
  totalCount: number;
  matches: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    confidence: number;
    scale?: number;
  }>;
  /** Wall-clock spent matching this single template (page render excluded). */
  elapsed_ms: number;
  /** Set when the template image failed to load or the matcher errored. */
  error?: string;
}

export interface RunCountLibraryRequest {
  pdfPath: string;
  pageNumber: number;
  templates: LibraryTemplateInput[];
  /** Render DPI for the target page. Must match the DPI templates were
   *  cropped at — 150 is the project-wide default. */
  dpi?: number;
}

export interface RunCountLibraryResult {
  success: boolean;
  pageNumber: number;
  imageWidth: number;
  imageHeight: number;
  dpi: number;
  /** Per-template results, one entry per input template (in input order
   *  isn't guaranteed — match by templateId). */
  results: LibraryTemplateResult[];
  /** Total wall-clock including page render. */
  duration_ms: number;
  /** Populated when the engine itself failed (PDF unreadable, page out of
   *  range, ...). Per-template errors live on the per-template result. */
  errors: string[];
}

function buildPythonEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PDF_BASE_PATH: process.env.DATA_DIR ?? "",
  };
}

/**
 * Match a batch of pre-cropped templates against a single PDF page. One
 * render, N matches — much cheaper than calling `runCountSymbols` N times
 * because PyMuPDF rendering dominates the per-template cost.
 */
export async function runCountLibrary(
  request: RunCountLibraryRequest,
): Promise<RunCountLibraryResult> {
  const start = Date.now();

  if (!request.templates || request.templates.length === 0) {
    return {
      success: true,
      pageNumber: request.pageNumber,
      imageWidth: 0,
      imageHeight: 0,
      dpi: request.dpi ?? 150,
      results: [],
      duration_ms: 0,
      errors: [],
    };
  }

  const payload = JSON.stringify({
    pdfPath: request.pdfPath,
    pageNumber: request.pageNumber,
    dpi: request.dpi ?? 150,
    templates: request.templates.map((t) => ({
      id: t.id,
      imagePath: t.imagePath,
      imageBase64: t.imageBase64,
      threshold: t.threshold ?? 0.75,
      crossScale: t.crossScale ?? false,
      maxMatches: t.maxMatches ?? 500,
    })),
  });

  const { stdout, stderr, code } = await spawnPythonCommand({
    scriptArgs: [COUNT_LIBRARY_SCRIPT],
    cwd: PYTHON_DIR,
    timeoutMs: 300_000,
    env: buildPythonEnv(),
    stdin: payload,
  });
  const duration_ms = Date.now() - start;

  if (code !== 0) {
    return {
      success: false,
      pageNumber: request.pageNumber,
      imageWidth: 0,
      imageHeight: 0,
      dpi: request.dpi ?? 150,
      results: [],
      duration_ms,
      errors: [stderr || `Process exited with code ${code}`],
    };
  }

  try {
    const result = JSON.parse(stdout);
    if (!result.success) {
      return {
        success: false,
        pageNumber: request.pageNumber,
        imageWidth: 0,
        imageHeight: 0,
        dpi: request.dpi ?? 150,
        results: result.results ?? [],
        duration_ms,
        errors: [result.error ?? "Library matcher failed"],
      };
    }
    return {
      success: true,
      pageNumber: result.pageNumber ?? request.pageNumber,
      imageWidth: result.imageWidth ?? 0,
      imageHeight: result.imageHeight ?? 0,
      dpi: result.dpi ?? (request.dpi ?? 150),
      results: result.results ?? [],
      duration_ms,
      errors: [],
    };
  } catch (err) {
    return {
      success: false,
      pageNumber: request.pageNumber,
      imageWidth: 0,
      imageHeight: 0,
      dpi: request.dpi ?? 150,
      results: [],
      duration_ms,
      errors: [`Failed to parse Python output: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}
