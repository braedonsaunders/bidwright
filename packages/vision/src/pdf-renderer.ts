import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnPythonCommand } from "./python-runtime.js";

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
  code?: string;
  requestedPage?: number;
  duration_ms: number;
}

export async function renderPdfPage(request: RenderPageRequest): Promise<RenderPageResult> {
  const start = Date.now();
  const payload = JSON.stringify(request);
  const { stdout, stderr, code } = await spawnPythonCommand({
    scriptArgs: [RENDER_SCRIPT],
    cwd: PYTHON_DIR,
    timeoutMs: 30_000,
    env: { ...process.env },
    stdin: payload,
  });
  const duration_ms = Date.now() - start;

  if (code !== 0) {
    return { success: false, error: stderr || `exit code ${code}`, duration_ms };
  }

  try {
    const result = JSON.parse(stdout);
    return { ...result, duration_ms };
  } catch {
    return { success: false, error: `Bad JSON: ${stdout.slice(0, 300)}`, duration_ms };
  }
}
