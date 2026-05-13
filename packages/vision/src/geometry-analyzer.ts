import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnPythonCommand } from "./python-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_DIR = path.resolve(__dirname, "..", "python");
const ANALYZE_GEOMETRY_SCRIPT = path.join(PYTHON_DIR, "tools", "analyze_geometry.py");

export type DrawingAnalysisPreset =
  | "generic"
  | "mechanical_piping"
  | "plumbing"
  | "fire_protection"
  | "ductwork"
  | "electrical"
  | "civil_linear"
  | "structural";

export interface AnalyzeDrawingGeometryRequest {
  pdfPath: string;
  pageNumber?: number;
  dpi?: number;
  preset?: DrawingAnalysisPreset | string;
  includeSymbols?: boolean;
  includeTextRegions?: boolean;
  includeCircles?: boolean;
  traceSystems?: boolean;
  minLineLength?: number;
  snapTolerance?: number;
  maxLines?: number;
  maxRegions?: number;
}

export interface DrawingGeometryBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawingLineSegment {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthPx: number;
  angleDeg: number;
  bbox: DrawingGeometryBounds;
  source: string;
  confidence: number;
}

export interface DrawingCircleDetection {
  id: string;
  cx: number;
  cy: number;
  radius: number;
  bbox: DrawingGeometryBounds;
  confidence: number;
  source: string;
}

export interface DrawingSymbolCandidate {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
  cx: number;
  cy: number;
  aspect: number;
  confidence: number;
  source: string;
}

export interface DrawingTextRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
  aspect: number;
  confidence: number;
  source: string;
}

export interface DrawingTracedSystem {
  id: string;
  label: string;
  preset: string;
  source: string;
  segmentIds: string[];
  segmentCount: number;
  nodeCount: number;
  lengthPx: number;
  bbox: DrawingGeometryBounds;
  counts: {
    openEnds: number;
    elbows45: number;
    elbows90: number;
    bends: number;
    tees: number;
    crosses: number;
    transitions: number;
  };
  confidence: number;
  warnings: string[];
}

export interface AnalyzeDrawingGeometryResult {
  success: boolean;
  schemaVersion: number;
  preset?: string;
  pageNumber?: number;
  dpi?: number;
  imageWidth: number;
  imageHeight: number;
  pageWidth?: number;
  pageHeight?: number;
  preprocessing?: Record<string, unknown>;
  summary: {
    lineCount: number;
    circleCount: number;
    symbolCandidateCount: number;
    textRegionCount: number;
    systemCount: number;
    totalSystemLengthPx: number;
  };
  lines: DrawingLineSegment[];
  circles: DrawingCircleDetection[];
  symbolCandidates: DrawingSymbolCandidate[];
  textRegions: DrawingTextRegion[];
  systems: DrawingTracedSystem[];
  warnings: string[];
  duration_ms: number;
  error?: string;
}

function emptyResult(duration_ms: number, error?: string): AnalyzeDrawingGeometryResult {
  return {
    success: false,
    schemaVersion: 1,
    imageWidth: 0,
    imageHeight: 0,
    summary: {
      lineCount: 0,
      circleCount: 0,
      symbolCandidateCount: 0,
      textRegionCount: 0,
      systemCount: 0,
      totalSystemLengthPx: 0,
    },
    lines: [],
    circles: [],
    symbolCandidates: [],
    textRegions: [],
    systems: [],
    warnings: [],
    duration_ms,
    error,
  };
}

export async function runAnalyzeDrawingGeometry(
  request: AnalyzeDrawingGeometryRequest,
): Promise<AnalyzeDrawingGeometryResult> {
  const start = Date.now();

  const payload = JSON.stringify({
    pdfPath: request.pdfPath,
    pageNumber: request.pageNumber ?? 1,
    dpi: request.dpi ?? 150,
    preset: request.preset ?? "generic",
    includeSymbols: request.includeSymbols ?? true,
    includeTextRegions: request.includeTextRegions ?? true,
    includeCircles: request.includeCircles ?? true,
    traceSystems: request.traceSystems ?? true,
    minLineLength: request.minLineLength,
    snapTolerance: request.snapTolerance,
    maxLines: request.maxLines ?? 1200,
    maxRegions: request.maxRegions ?? 220,
  });

  const { stdout, stderr, code } = await spawnPythonCommand({
    scriptArgs: [ANALYZE_GEOMETRY_SCRIPT],
    cwd: PYTHON_DIR,
    timeoutMs: 180_000,
    env: { ...process.env },
    stdin: payload,
  });

  const duration_ms = Date.now() - start;
  if (code !== 0) {
    return emptyResult(duration_ms, stderr || `Process exited with code ${code}`);
  }

  try {
    const parsed = JSON.parse(stdout) as Partial<AnalyzeDrawingGeometryResult>;
    return {
      ...emptyResult(duration_ms),
      ...parsed,
      success: parsed.success !== false,
      summary: {
        lineCount: Number(parsed.summary?.lineCount ?? parsed.lines?.length ?? 0),
        circleCount: Number(parsed.summary?.circleCount ?? parsed.circles?.length ?? 0),
        symbolCandidateCount: Number(parsed.summary?.symbolCandidateCount ?? parsed.symbolCandidates?.length ?? 0),
        textRegionCount: Number(parsed.summary?.textRegionCount ?? parsed.textRegions?.length ?? 0),
        systemCount: Number(parsed.summary?.systemCount ?? parsed.systems?.length ?? 0),
        totalSystemLengthPx: Number(parsed.summary?.totalSystemLengthPx ?? 0),
      },
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
      circles: Array.isArray(parsed.circles) ? parsed.circles : [],
      symbolCandidates: Array.isArray(parsed.symbolCandidates) ? parsed.symbolCandidates : [],
      textRegions: Array.isArray(parsed.textRegions) ? parsed.textRegions : [],
      systems: Array.isArray(parsed.systems) ? parsed.systems : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      duration_ms: Number(parsed.duration_ms ?? duration_ms),
    };
  } catch {
    return emptyResult(duration_ms, `Failed to parse Python output: ${stdout.slice(0, 500)}`);
  }
}
