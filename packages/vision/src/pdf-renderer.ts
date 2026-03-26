import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_DIR = path.resolve(__dirname, "..", "python");

/** New standalone renderer in tools/ directory */
const RENDER_SCRIPT = path.join(PYTHON_DIR, "tools", "renderer.py");

export interface RenderPageRequest {
  pdfPath: string;
  pageNumber: number;
  dpi?: number;
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  };
}

export interface RenderPageResult {
  success: boolean;
  image?: string;       // data:image/png;base64,...
  width?: number;
  height?: number;
  pageWidth?: number;
  pageHeight?: number;
  pageCount?: number;
  error?: string;
  duration_ms: number;
}

export async function renderPdfPage(request: RenderPageRequest): Promise<RenderPageResult> {
  const start = Date.now();
  const payload = JSON.stringify(request);

  return new Promise((resolve) => {
    const pythonPath = process.env.PYTHON_PATH ?? (process.platform === "win32" ? "python" : "python3");
    const proc = spawn(pythonPath, [RENDER_SCRIPT], {
      cwd: PYTHON_DIR,
      timeout: 30_000,
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
        resolve({ success: false, error: stderr || `exit code ${code}`, duration_ms });
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve({ ...result, duration_ms });
      } catch {
        resolve({ success: false, error: `Bad JSON: ${stdout.slice(0, 300)}`, duration_ms });
      }
    });

    proc.on("error", (err) => {
      resolve({ success: false, error: err.message, duration_ms: Date.now() - start });
    });
  });
}
