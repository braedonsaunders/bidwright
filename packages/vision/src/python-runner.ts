import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_DIR = path.resolve(__dirname, "..", "python");
const AUTO_COUNT_SCRIPT = path.join(PYTHON_DIR, "auto_count.py");

/* ── Request / Response types ────────────────────────────────── */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}

export interface SymbolCountRequest {
  /** Absolute path to the PDF on disk */
  pdfPath: string;
  /** Optional: absolute path to a template image (PNG/JPG) to match against */
  templateImagePath?: string;
  /** 1-based page number (converted to 0-based internally for Python) */
  pageNumber?: number;
  /** Bounding box of the selection region on the canvas */
  boundingBox?: BoundingBox;
  /** Matching confidence threshold 0-1 (default 0.65) */
  threshold?: number;
  /** Which methods to enable (default: all) */
  methods?: ("template" | "ocr" | "visual" | "text" | "autostitch")[];
  /** Passed through to result */
  documentId?: string;
}

export interface SymbolMatch {
  rect: { x: number; y: number; width: number; height: number };
  confidence: number;
  image?: string;       // data URL of the matched region
  text?: string;        // OCR text found in the match
  detection_method: string;
  vector_count?: number;
}

export interface SymbolCountResult {
  matches: SymbolMatch[];
  totalCount: number;
  pagesSearched: number;
  duration_ms: number;
  snippetImage?: string; // data URL of the template/selection snippet
  errors: string[];
}

/* ── Run the Python auto_count pipeline ────────────────────── */

export async function runAutoCount(request: SymbolCountRequest): Promise<SymbolCountResult> {
  const start = Date.now();

  // Build JSON payload matching what auto_count.py --json expects
  const payload = JSON.stringify({
    pdfPath: request.pdfPath,
    templateImagePath: request.templateImagePath ?? null,
    pageNumber: request.pageNumber ?? 1,
    boundingBox: request.boundingBox ?? null,
    threshold: request.threshold ?? 0.65,
    methods: request.methods ?? [],
    documentId: request.documentId ?? null,
  });

  return new Promise((resolve) => {
    const pythonPath = process.env.PYTHON_PATH ?? "python3";
    const proc = spawn(pythonPath, [AUTO_COUNT_SCRIPT, "--json"], {
      cwd: PYTHON_DIR,
      timeout: 120_000,
      env: {
        ...process.env,
        // Pass the base data dir so Python can resolve relative paths if needed
        PDF_BASE_PATH: process.env.DATA_DIR ?? "",
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdin.write(payload);
    proc.stdin.end();

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      const duration_ms = Date.now() - start;
      if (code !== 0) {
        resolve({
          matches: [],
          totalCount: 0,
          pagesSearched: 1,
          duration_ms,
          errors: [stderr || `Process exited with code ${code}`],
        });
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        // auto_count.py wraps its output in { "result": { ... } }
        const result = parsed.result ?? parsed;

        if (result.error) {
          resolve({
            matches: [],
            totalCount: 0,
            pagesSearched: 1,
            duration_ms,
            errors: [result.error],
          });
          return;
        }

        const matches: SymbolMatch[] = (result.final_matches ?? result.matches ?? []).map((m: any) => ({
          rect: m.rect ?? { x: m.x ?? 0, y: m.y ?? 0, width: m.width ?? 0, height: m.height ?? 0 },
          confidence: m.confidence ?? 0,
          image: m.image ?? undefined,
          text: m.text ?? undefined,
          detection_method: m.detection_method ?? m.method ?? "unknown",
          vector_count: m.vector_count ?? 0,
        }));

        resolve({
          matches,
          totalCount: matches.length,
          pagesSearched: 1,
          duration_ms,
          snippetImage: result.pdf_snippet_image ?? undefined,
          errors: [],
        });
      } catch {
        resolve({
          matches: [],
          totalCount: 0,
          pagesSearched: 1,
          duration_ms,
          errors: [`Failed to parse Python output: ${stdout.slice(0, 500)}`],
        });
      }
    });

    proc.on("error", (err) => {
      resolve({
        matches: [],
        totalCount: 0,
        pagesSearched: 1,
        duration_ms: Date.now() - start,
        errors: [err.message],
      });
    });
  });
}
