import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_DIR = path.resolve(__dirname, "..", "python");
const AUTO_COUNT_SCRIPT = path.join(PYTHON_DIR, "auto_count.py");

export interface SymbolCountRequest {
  pdfPath: string;
  templateImagePath: string;
  pageNumbers?: number[];
  threshold?: number;
  methods?: ("template" | "ocr" | "visual" | "text" | "autostitch")[];
}

export interface SymbolMatch {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  method: string;
}

export interface SymbolCountResult {
  matches: SymbolMatch[];
  totalCount: number;
  pagesSearched: number;
  duration_ms: number;
  errors: string[];
}

export async function runAutoCount(request: SymbolCountRequest): Promise<SymbolCountResult> {
  const start = Date.now();
  const payload = JSON.stringify(request);

  return new Promise((resolve, reject) => {
    const pythonPath = process.env.PYTHON_PATH ?? "python3";
    const proc = spawn(pythonPath, [AUTO_COUNT_SCRIPT, "--json"], {
      cwd: PYTHON_DIR,
      timeout: 120000,
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
          pagesSearched: 0,
          duration_ms,
          errors: [stderr || `Process exited with code ${code}`],
        });
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve({
          matches: result.matches ?? [],
          totalCount: result.totalCount ?? result.matches?.length ?? 0,
          pagesSearched: result.pagesSearched ?? 0,
          duration_ms,
          errors: [],
        });
      } catch {
        resolve({
          matches: [],
          totalCount: 0,
          pagesSearched: 0,
          duration_ms,
          errors: [`Failed to parse output: ${stdout.slice(0, 500)}`],
        });
      }
    });

    proc.on("error", (err) => {
      resolve({
        matches: [],
        totalCount: 0,
        pagesSearched: 0,
        duration_ms: Date.now() - start,
        errors: [err.message],
      });
    });
  });
}
