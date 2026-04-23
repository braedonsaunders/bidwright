import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnPythonCommand } from "./python-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_DIR = path.resolve(__dirname, "..", "python");

// Old script kept for backwards compatibility.
const AUTO_COUNT_SCRIPT = path.join(PYTHON_DIR, "auto_count.py");

// New optimized counter (threshold=0.75, single-scale TM_CCOEFF_NORMED).
const COUNT_SYMBOLS_SCRIPT = path.join(PYTHON_DIR, "tools", "count_symbols.py");

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}

export interface SymbolCountRequest {
  pdfPath: string;
  templateImagePath?: string;
  pageNumber?: number;
  boundingBox?: BoundingBox;
  threshold?: number;
  methods?: ("template" | "ocr" | "visual" | "text" | "autostitch")[];
  crossScale?: boolean;
  documentId?: string;
}

export interface SymbolMatch {
  rect: { x: number; y: number; width: number; height: number };
  confidence: number;
  image?: string;
  text?: string;
  detection_method: string;
  vector_count?: number;
}

export interface SymbolCountResult {
  matches: SymbolMatch[];
  totalCount: number;
  pagesSearched: number;
  duration_ms: number;
  snippetImage?: string;
  imageWidth?: number;
  imageHeight?: number;
  errors: string[];
}

function buildPythonEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PDF_BASE_PATH: process.env.DATA_DIR ?? "",
  };
}

export async function runCountSymbols(request: SymbolCountRequest): Promise<SymbolCountResult> {
  const start = Date.now();

  const payload = JSON.stringify({
    pdfPath: request.pdfPath,
    pageNumber: request.pageNumber ?? 1,
    boundingBox: request.boundingBox ?? null,
    threshold: request.threshold ?? 0.75,
    dpi: 150,
    crossScale: request.crossScale ?? false,
  });

  const { stdout, stderr, code } = await spawnPythonCommand({
    scriptArgs: [COUNT_SYMBOLS_SCRIPT],
    cwd: PYTHON_DIR,
    timeoutMs: 120_000,
    env: buildPythonEnv(),
    stdin: payload,
  });
  const duration_ms = Date.now() - start;

  if (code !== 0) {
    return {
      matches: [],
      totalCount: 0,
      pagesSearched: 1,
      duration_ms,
      errors: [stderr || `Process exited with code ${code}`],
    };
  }

  try {
    const result = JSON.parse(stdout);

    if (result.error) {
      return {
        matches: [],
        totalCount: 0,
        pagesSearched: 1,
        duration_ms,
        errors: [result.error],
      };
    }

    const matches: SymbolMatch[] = (result.matches ?? []).map((match: any) => ({
      rect: { x: match.x ?? 0, y: match.y ?? 0, width: match.w ?? 0, height: match.h ?? 0 },
      confidence: match.confidence ?? 0,
      image: match.image ?? undefined,
      detection_method: "template",
    }));

    return {
      matches,
      totalCount: result.totalCount ?? matches.length,
      pagesSearched: 1,
      duration_ms,
      snippetImage: result.templateImage ?? undefined,
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight,
      errors: [],
    };
  } catch {
    return {
      matches: [],
      totalCount: 0,
      pagesSearched: 1,
      duration_ms,
      errors: [`Failed to parse Python output: ${stdout.slice(0, 500)}`],
    };
  }
}

export async function runAutoCount(request: SymbolCountRequest): Promise<SymbolCountResult> {
  const start = Date.now();

  const payload = JSON.stringify({
    pdfPath: request.pdfPath,
    templateImagePath: request.templateImagePath ?? null,
    pageNumber: request.pageNumber ?? 1,
    boundingBox: request.boundingBox ?? null,
    threshold: request.threshold ?? 0.65,
    methods: request.methods ?? [],
    documentId: request.documentId ?? null,
  });

  const { stdout, stderr, code } = await spawnPythonCommand({
    scriptArgs: [AUTO_COUNT_SCRIPT, "--json"],
    cwd: PYTHON_DIR,
    timeoutMs: 120_000,
    env: buildPythonEnv(),
    stdin: payload,
  });
  const duration_ms = Date.now() - start;

  if (code !== 0) {
    return {
      matches: [],
      totalCount: 0,
      pagesSearched: 1,
      duration_ms,
      errors: [stderr || `Process exited with code ${code}`],
    };
  }

  try {
    const parsed = JSON.parse(stdout);
    const result = parsed.result ?? parsed;

    if (result.error) {
      return {
        matches: [],
        totalCount: 0,
        pagesSearched: 1,
        duration_ms,
        errors: [result.error],
      };
    }

    const matches: SymbolMatch[] = (result.final_matches ?? result.matches ?? []).map((match: any) => ({
      rect: match.rect ?? { x: match.x ?? 0, y: match.y ?? 0, width: match.width ?? 0, height: match.height ?? 0 },
      confidence: match.confidence ?? 0,
      image: match.image ?? undefined,
      text: match.text ?? undefined,
      detection_method: match.detection_method ?? match.method ?? "unknown",
      vector_count: match.vector_count ?? 0,
    }));

    return {
      matches,
      totalCount: matches.length,
      pagesSearched: 1,
      duration_ms,
      snippetImage: result.pdf_snippet_image ?? undefined,
      errors: [],
    };
  } catch {
    return {
      matches: [],
      totalCount: 0,
      pagesSearched: 1,
      duration_ms,
      errors: [`Failed to parse Python output: ${stdout.slice(0, 500)}`],
    };
  }
}
