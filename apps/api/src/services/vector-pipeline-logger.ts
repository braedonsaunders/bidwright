// Structured logging for the vector pipeline (DXF + PDF vector extraction).
// One sink so both subsystems emit comparable telemetry — entity / primitive
// counts by type, source-unit detection, fallback paths taken, error codes.
//
// Writes JSONL lines to stdout with a stable `[vector-pipeline]` prefix so
// log aggregators / `grep` / `jq` can fan them out without parsing free-form
// strings. Each record has a `kind` tag identifying the subsystem and the
// event so downstream analysis can pivot cleanly.

export type VectorPipelineEvent =
  | DxfParseEvent
  | DxfConverterEvent
  | DxfBlockExpansionEvent
  | DxfUnitNormalizationEvent
  | PdfVectorExtractEvent
  | PdfArcFitEvent;

interface DxfParseEvent {
  kind: "dxf:parse";
  documentId: string;
  projectId: string;
  fileName: string;
  status: "processed" | "failed" | "converter_required";
  /** Raw counts before block expansion. */
  rawEntityCount: number;
  /** Counts after block expansion (when blocks were referenced via INSERT). */
  finalEntityCount: number;
  /** Per-type entity histogram, both raw and expanded counts. */
  byType: Record<string, { raw: number; expanded: number }>;
  blockCount: number;
  layerCount: number;
  layoutCount: number;
  /** Drawing unit detected from $INSUNITS, or "unitless" when missing. */
  originalUnits: string;
  /** Canonical unit the result is normalized to (always "in" today). */
  canonicalUnits: string;
  /** Multiplier applied to coordinates during unit normalization. */
  unitScaleFactor: number;
  durationMs: number;
  /** When status=failed, the error message. */
  error?: string;
}

interface DxfConverterEvent {
  kind: "dxf:converter";
  documentId: string;
  projectId: string;
  fileName: string;
  /** Result of the DWG→DXF binary conversion attempt. */
  status: "not_required" | "configured" | "missing" | "failed";
  command?: string;
  /** Wall-clock for the converter subprocess invocation. */
  durationMs: number;
  error?: string;
}

interface DxfBlockExpansionEvent {
  kind: "dxf:block_expansion";
  documentId: string;
  projectId: string;
  /** Number of INSERT entities encountered. */
  insertCount: number;
  /** Number of entities that were spawned by expanding INSERTs. */
  expandedEntityCount: number;
  /** Maximum recursion depth seen (block-in-block). */
  maxDepth: number;
  /** Block names referenced but not found in the BLOCKS section. */
  missingBlocks: string[];
}

interface DxfUnitNormalizationEvent {
  kind: "dxf:unit_normalization";
  documentId: string;
  projectId: string;
  originalUnits: string;
  canonicalUnits: string;
  scaleFactor: number;
  /** When the original unit was "unitless", we leave coordinates as-is and
   *  set this true so consumers can warn the user to calibrate manually. */
  passthrough: boolean;
}

interface PdfVectorExtractEvent {
  kind: "pdf:vector_extract";
  pdfPath: string;
  pageNumber: number;
  /** PDF Producer string (e.g. "AutoCAD PDF (General Documentation)"). */
  producer?: string;
  /** PDF Creator string. */
  creator?: string;
  drawingCount: number;
  pathItemCount: number;
  /** Histogram of PyMuPDF path operators we saw. */
  opCounts: Record<string, number>;
  /** Primitives emitted by canonical type (line, arc, circle, ...). */
  primitivesByType: Record<string, number>;
  /** True when get_cdrawings was used to recover arc/circle primitives that
   *  get_drawings would have missed. */
  usedCDrawings: boolean;
  /** Curves successfully fit to arcs by the bezier-fitter. */
  arcsFitFromCubics: number;
  /** Curves left as cubic-bezier primitives because the fitter rejected them. */
  cubicsRetained: number;
  /** Subpaths split off by a moveto operator. */
  subpathBreaks: number;
  /** Total number of primitives with fill="evenodd"|"winding" vs stroke-only. */
  filledPrimitives: number;
  durationMs: number;
  error?: string;
}

interface PdfArcFitEvent {
  kind: "pdf:arc_fit";
  pdfPath: string;
  pageNumber: number;
  attempted: number;
  succeeded: number;
  rejected: number;
  /** Histogram of rejection reasons. */
  rejectReasons: Record<string, number>;
}

/** Emit a single structured log line to stdout. Safe to call from anywhere
 *  in the vector pipeline; no IO besides the one console.log. */
export function logVectorPipeline(event: VectorPipelineEvent): void {
  // Stamp every record with the same epoch so callers don't have to thread
  // it through manually.
  const record = { ts: new Date().toISOString(), ...event };
  console.log("[vector-pipeline]", JSON.stringify(record));
}
