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

export type DrawingGeometrySource = "auto" | "pdf_vector" | "raster_cv";

export interface AnalyzeDrawingGeometryRequest {
  pdfPath: string;
  pageNumber?: number;
  dpi?: number;
  preset?: DrawingAnalysisPreset | string;
  geometrySource?: DrawingGeometrySource | string;
  includeSymbols?: boolean;
  includeTextRegions?: boolean;
  includeCircles?: boolean;
  traceSystems?: boolean;
  minLineLength?: number;
  snapTolerance?: number;
  maxLines?: number | null;
  maxRegions?: number;
  lineSensitivity?: number;
  noiseRejection?: number;
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
  layer?: string | null;
  strokeWidth?: number | null;
  color?: string | null;
  qualityFlags?: string[];
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

export interface DrawingPolylineDetection {
  id: string;
  source: string;
  systemId?: string | null;
  label?: string | null;
  segmentIds: string[];
  pointCount: number;
  points: Array<{ x: number; y: number }>;
  pointLimitApplied?: boolean;
  lengthPx: number;
  bbox: DrawingGeometryBounds;
  closed: boolean;
  confidence: number;
}

export interface DrawingContourDetection {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
  perimeter: number;
  pointCount: number;
  points: Array<{ x: number; y: number }>;
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
  layers?: string[];
  junctions?: Record<string, number>;
  qualityFlags?: string[];
}

/** Canonical primitive kind emitted by the PDF vector pipeline. Coordinates
 *  in `params` are PDF page points (1pt = 1/72in); use
 *  `AnalyzeDrawingGeometryResult.coordinateSpace` to convert. */
export type DrawingPrimitiveKind =
  | "line"
  | "arc"
  | "circle"
  | "ellipse"
  | "cubic_bezier"
  | "quad_bezier"
  | "rect";

export interface DrawingPrimitive {
  id: string;
  kind: DrawingPrimitiveKind;
  /** Shape parameters in PDF-point coords. Schema depends on `kind`:
   *   line     → { x1, y1, x2, y2 }
   *   rect     → { x, y, width, height }
   *   arc      → { cx, cy, r, startAngleRad, endAngleRad }
   *   circle   → { cx, cy, r }
   *   ellipse  → { cx, cy, rx, ry, rotationRad }
   *   cubic_bezier → { points: [x0,y0,x1,y1,x2,y2,x3,y3] }
   *   quad_bezier  → { points: [x0,y0,x1,y1,x2,y2] } */
  params: Record<string, number | number[]>;
  layer: string | null;
  strokeWidth: number | null;
  color: string | null;
  /** Painting mode: "stroke" (boundary), "fill" (region), or
   *  "stroke+fill" (both). null when the source didn't apply either. */
  paint: "stroke" | "fill" | "stroke+fill" | null;
  /** Subpath index — primitives sharing the same value were joined by
   *  `m`-less continuation in the source PDF path. */
  subpath: number;
  /** Density-based classification of this primitive:
   *   - "drawing": real geometry the candidate list should surface (pipes,
   *     equipment outlines, instrument bubbles).
   *   - "text": short stroke sitting in a text-dense cluster (glyph outline,
   *     decorative tick, label artwork). Kept in the output so the canvas
   *     overlay can show them as faint hints, but the candidate list /
   *     review queue filter them out — without this split, a single
   *     text-heavy P&ID surfaces 150k+ "candidates" that are all glyph
   *     strokes.
   *  Defaults to "drawing" when omitted (back-compat with older payloads). */
  category?: "drawing" | "text";
}

/** Coordinate-space metadata for the primitives. Use these factors to
 *  convert PDF points → image pixels or real-world units. */
export interface DrawingCoordinateSpace {
  unit: "pdf-point";
  pointsPerInch: number;
  pageWidthPt: number;
  pageHeightPt: number;
  imageWidthPx: number;
  imageHeightPx: number;
  imagePixelPerPdfPointX: number;
  imagePixelPerPdfPointY: number;
}

export interface AnalyzeDrawingGeometryResult {
  success: boolean;
  schemaVersion: number;
  preset?: string;
  geometrySource?: string;
  geometrySourceRequested?: string;
  sourceConfidence?: number;
  qualityFlags?: string[];
  pageNumber?: number;
  dpi?: number;
  imageWidth: number;
  imageHeight: number;
  pageWidth?: number;
  pageHeight?: number;
  scaleMetadata?: Record<string, unknown>;
  preprocessing?: Record<string, unknown>;
  summary: {
    lineCount: number;
    polylineCount: number;
    circleCount: number;
    contourCount: number;
    symbolCandidateCount: number;
    textRegionCount: number;
    systemCount: number;
    totalSystemLengthPx: number;
  };
  lines: DrawingLineSegment[];
  polylines: DrawingPolylineDetection[];
  circles: DrawingCircleDetection[];
  contours: DrawingContourDetection[];
  symbolCandidates: DrawingSymbolCandidate[];
  textRegions: DrawingTextRegion[];
  systems: DrawingTracedSystem[];
  /** Canonical primitive list from the PDF vector pipeline (Phase 2).
   *  Empty for raster-CV sources. Coordinates in PDF points. */
  primitives: DrawingPrimitive[];
  /** Histogram of primitive kinds for quick UI counters. */
  primitivesByKind: Record<string, number>;
  /** Number of primitives whose `category === "drawing"`. This is the
   *  count the candidate list / review queue should display — it excludes
   *  text-cluster glyph strokes. */
  drawingPrimitiveCount?: number;
  /** Number of primitives whose `category === "text"`. Rendered on the
   *  canvas overlay (so the user can see them as faint hints) but not in
   *  the candidate list. */
  textPrimitiveCount?: number;
  /** Conversion factors between PDF points and image pixels. Present only
   *  when primitives were emitted (vector source). */
  coordinateSpace?: DrawingCoordinateSpace;
  warnings: string[];
  duration_ms: number;
  error?: string;
}

/** Strip every `[vector-pipeline] {json}` line out of a stderr blob and
 *  echo each one to console.log on the host process. The Python pipeline
 *  emits structured telemetry on stderr (so it doesn't contaminate the
 *  stdout JSON); without this forwarder the telemetry is silently dropped
 *  on the success path. Non-tagged stderr lines (e.g. Python warnings,
 *  exception tracebacks) are NOT forwarded — those still surface via the
 *  emptyResult error string on failure. */
function forwardVectorPipelineLogs(stderr: string): void {
  if (!stderr) return;
  for (const line of stderr.split("\n")) {
    if (line.startsWith("[vector-pipeline]")) {
      // Same prefix the TS-side vector-pipeline-logger uses, so log
      // aggregation grep filters catch both sources uniformly.
      console.log(line);
    }
  }
}

function emptyResult(duration_ms: number, error?: string): AnalyzeDrawingGeometryResult {
  return {
    success: false,
    schemaVersion: 2,
    imageWidth: 0,
    imageHeight: 0,
    summary: {
      lineCount: 0,
      polylineCount: 0,
      circleCount: 0,
      contourCount: 0,
      symbolCandidateCount: 0,
      textRegionCount: 0,
      systemCount: 0,
      totalSystemLengthPx: 0,
    },
    lines: [],
    polylines: [],
    circles: [],
    contours: [],
    symbolCandidates: [],
    textRegions: [],
    systems: [],
    primitives: [],
    primitivesByKind: {},
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
    geometrySource: request.geometrySource ?? "auto",
    includeSymbols: request.includeSymbols ?? true,
    includeTextRegions: request.includeTextRegions ?? true,
    includeCircles: request.includeCircles ?? true,
    traceSystems: request.traceSystems ?? true,
    minLineLength: request.minLineLength,
    snapTolerance: request.snapTolerance,
    maxLines: request.maxLines ?? 0,
    maxRegions: request.maxRegions ?? 500,
    lineSensitivity: request.lineSensitivity ?? 0.62,
    noiseRejection: request.noiseRejection ?? 0.42,
  });

  const { stdout, stderr, code } = await spawnPythonCommand({
    scriptArgs: [ANALYZE_GEOMETRY_SCRIPT],
    cwd: PYTHON_DIR,
    timeoutMs: 180_000,
    env: { ...process.env },
    stdin: payload,
  });

  // Forward Python-side `[vector-pipeline]` JSONL telemetry to the host
  // process's stdout so the same log aggregator that captures the TS-side
  // vector-pipeline logs sees the Python events too. We do this on BOTH
  // the success and failure paths — failures are usually where these logs
  // matter most.
  forwardVectorPipelineLogs(stderr);

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
        polylineCount: Number(parsed.summary?.polylineCount ?? parsed.polylines?.length ?? 0),
        circleCount: Number(parsed.summary?.circleCount ?? parsed.circles?.length ?? 0),
        contourCount: Number(parsed.summary?.contourCount ?? parsed.contours?.length ?? 0),
        symbolCandidateCount: Number(parsed.summary?.symbolCandidateCount ?? parsed.symbolCandidates?.length ?? 0),
        textRegionCount: Number(parsed.summary?.textRegionCount ?? parsed.textRegions?.length ?? 0),
        systemCount: Number(parsed.summary?.systemCount ?? parsed.systems?.length ?? 0),
        totalSystemLengthPx: Number(parsed.summary?.totalSystemLengthPx ?? 0),
      },
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
      polylines: Array.isArray(parsed.polylines) ? parsed.polylines : [],
      circles: Array.isArray(parsed.circles) ? parsed.circles : [],
      contours: Array.isArray(parsed.contours) ? parsed.contours : [],
      symbolCandidates: Array.isArray(parsed.symbolCandidates) ? parsed.symbolCandidates : [],
      textRegions: Array.isArray(parsed.textRegions) ? parsed.textRegions : [],
      systems: Array.isArray(parsed.systems) ? parsed.systems : [],
      primitives: Array.isArray(parsed.primitives) ? parsed.primitives : [],
      primitivesByKind: (parsed.primitivesByKind ?? {}) as Record<string, number>,
      drawingPrimitiveCount: Number(parsed.drawingPrimitiveCount ?? 0),
      textPrimitiveCount: Number(parsed.textPrimitiveCount ?? 0),
      coordinateSpace: parsed.coordinateSpace,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      duration_ms: Number(parsed.duration_ms ?? duration_ms),
    };
  } catch {
    return emptyResult(duration_ms, `Failed to parse Python output: ${stdout.slice(0, 500)}`);
  }
}
