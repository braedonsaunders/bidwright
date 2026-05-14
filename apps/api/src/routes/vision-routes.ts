import type { FastifyInstance } from "fastify";
import { resolveApiPath } from "../paths.js";
import { access, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { prisma } from "@bidwright/db";
import { emitSessionEvent, interruptAndResumeSession } from "../services/cli-runtime.js";
import { getDwgProcessingResult } from "../services/dwg-processing-service.js";

/** Helper: resolve a document's absolute PDF path from its storagePath. */
async function resolveDocPdf(store: any, projectId: string, documentId: string): Promise<{ absPath: string; doc: any } | { error: string; status: number }> {
  const doc = await store.getDocument(projectId, documentId);
  if (doc) {
    if (!doc.storagePath) return { error: "Document has no file on disk", status: 400 };
    const absPath = resolveApiPath(doc.storagePath);
    try { await access(absPath); } catch { return { error: `PDF not on disk: ${doc.storagePath}`, status: 404 }; }
    return { absPath, doc };
  }

  const fileNodeId = documentId.startsWith("file-") ? documentId.slice(5) : documentId;
  if (typeof store.getFileNode === "function") {
    const node = await store.getFileNode(fileNodeId);
    if (node?.projectId === projectId && node.type !== "directory") {
      if (node.documentId) {
        const nodeDoc = await store.getDocument(projectId, node.documentId);
        if (nodeDoc?.storagePath) {
          const absPath = resolveApiPath(nodeDoc.storagePath);
          try { await access(absPath); } catch { return { error: `PDF not on disk: ${nodeDoc.storagePath}`, status: 404 }; }
          return { absPath, doc: nodeDoc };
        }
      }
      if (node.storagePath) {
        const absPath = resolveApiPath(node.storagePath);
        try { await access(absPath); } catch { return { error: `PDF not on disk: ${node.storagePath}`, status: 404 }; }
        return { absPath, doc: { id: node.id, fileName: node.name, storagePath: node.storagePath, metadata: node.metadata ?? {}, source: "file_node" } };
      }
    }
  }

  if (typeof store.getKnowledgeBook === "function") {
    const book = await store.getKnowledgeBook(documentId);
    if (book?.storagePath && (!book.projectId || book.projectId === projectId)) {
      const absPath = resolveApiPath(book.storagePath);
      try { await access(absPath); } catch { return { error: `PDF not on disk: ${book.storagePath}`, status: 404 }; }
      return { absPath, doc: { id: book.id, fileName: book.sourceFileName ?? book.name, storagePath: book.storagePath, metadata: book.metadata ?? {}, source: "knowledge_book" } };
    }
  }

  return { error: "Document not found", status: 404 };
}

async function repairStoredNativePdfPageCount(doc: any, nativePageCount: unknown) {
  const pageCount = Number(nativePageCount);
  if (!doc?.id || !Number.isFinite(pageCount) || pageCount <= 0) return;
  const normalizedPageCount = Math.floor(pageCount);
  const currentPageCount = Number(doc.pageCount ?? 0);
  if (currentPageCount === normalizedPageCount) return;
  const structuredData = doc.structuredData && typeof doc.structuredData === "object" && !Array.isArray(doc.structuredData)
    ? doc.structuredData
    : {};
  const nativePdf = structuredData.nativePdf && typeof structuredData.nativePdf === "object" && !Array.isArray(structuredData.nativePdf)
    ? structuredData.nativePdf
    : {};
  await prisma.sourceDocument.update({
    where: { id: String(doc.id) },
    data: {
      pageCount: normalizedPageCount,
      structuredData: sanitizeJsonForPostgres({
        ...structuredData,
        nativePdf: {
          ...nativePdf,
          pageCount: normalizedPageCount,
          pageCountSource: "pdf-native",
          extractionPageCount: currentPageCount > 0 ? currentPageCount : undefined,
        },
      }) as any,
    },
  }).catch(() => {});
}

function classifyPdfLayerName(name: string) {
  const lower = name.toLowerCase();
  if (/text|anno|note|dim|tag|label|callout|title|tb_/.test(lower)) return "annotation_text";
  if (/hardware|anchor|bolt|lug|embed|base|plate/.test(lower)) return "hardware";
  if (/pipe|piping|valve|pump|tank|mechanical|process/.test(lower)) return "mechanical";
  if (/beam|column|steel|struct|foundation|footing|crane|runway|bar|rebar/.test(lower)) return "structural";
  if (/hidden|center|cen\b|phantom|dash/.test(lower)) return "linework_reference";
  if (/border|bord|title/.test(lower)) return "sheet_border_title";
  if (/geometry|model|detail|trdetail|trmodel|pdf_geometry/.test(lower)) return "geometry";
  if (/electrical|power|lighting|panel|conduit|cable/.test(lower)) return "electrical";
  return "other";
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function countPdfOperators(fnArray: number[], ops: Record<string, number>) {
  const byNumber = new Map(Object.entries(ops).map(([name, code]) => [code, name]));
  return fnArray.reduce<Record<string, number>>((acc, code) => {
    const name = byNumber.get(code) ?? `op_${code}`;
    acc[name] = (acc[name] ?? 0) + 1;
    return acc;
  }, {});
}

function summarizeVectorSignals(operatorCounts: Record<string, number>) {
  const count = (names: string[]) => names.reduce((sum, name) => sum + Number(operatorCounts[name] ?? 0), 0);
  const pathOps = count(["constructPath", "stroke", "fill", "eoFill", "fillStroke", "eoFillStroke", "closeStroke", "closeFillStroke"]);
  const textOps = count(["showText", "showSpacedText", "nextLineShowText", "nextLineSetSpacingShowText", "beginText", "endText"]);
  const imageOps = count(["paintImageXObject", "paintInlineImageXObject", "paintJpegXObject", "paintImageMaskXObject"]);
  return {
    pathOps,
    textOps,
    imageOps,
    vectorHeavy: pathOps > imageOps * 4 && pathOps > 200,
    scannedOrImageHeavy: imageOps > 0 && pathOps < 100,
  };
}

function normalizeDrawingGeometrySource(value: unknown) {
  const normalized = String(value ?? "auto").trim().toLowerCase().replace(/-/g, "_");
  if (["pdf", "vector", "pdf_native", "pdf_vector"].includes(normalized)) return "pdf_vector";
  if (["raster", "cv", "opencv", "raster_cv"].includes(normalized)) return "raster_cv";
  return "auto";
}

function normalizedDocText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isPdfDocument(doc: any) {
  const fileType = normalizedDocText(doc?.fileType);
  const fileName = normalizedDocText(doc?.fileName);
  return fileType === "application/pdf" || fileType === "pdf" || fileName.endsWith(".pdf");
}

function isIgnoredDocArtifact(doc: any) {
  const fileName = normalizedDocText(doc?.fileName);
  const storagePath = normalizedDocText(doc?.storagePath);
  return [fileName, storagePath].some((name) => /(^|\/)__macosx(\/|$)|(^|\/)\._|(^|\/)\.ds_store$|(^|\/)thumbs\.db$/.test(name));
}

function isDrawingPdfDocument(doc: any) {
  if (isIgnoredDocArtifact(doc)) return false;
  if (!isPdfDocument(doc)) return false;
  return normalizedDocText(doc?.documentType) === "drawing";
}

function endpointBase(value: unknown) {
  const text = String(value ?? "").trim() || "https://api.va.landing.ai";
  return text.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function sanitizeJsonForPostgres(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.replace(/\u0000/g, "").replace(/\\u0000/gi, "");
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeJsonForPostgres(entry, seen));
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return null;
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = sanitizeJsonForPostgres(entry, seen);
  }
  seen.delete(value);
  return output;
}

function normalizeDetectionPoint(value: unknown): { x: number; y: number } | null {
  const point = asRecord(value);
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function normalizeDetectionPoints(detection: Record<string, unknown>): { x: number; y: number }[] {
  const rawPoints = Array.isArray(detection.points) ? detection.points : null;
  if (rawPoints) {
    return rawPoints
      .map(normalizeDetectionPoint)
      .filter((point): point is { x: number; y: number } => Boolean(point));
  }

  const x1 = Number(detection.x1);
  const y1 = Number(detection.y1);
  const x2 = Number(detection.x2);
  const y2 = Number(detection.y2);
  if ([x1, y1, x2, y2].every(Number.isFinite)) {
    return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  }

  const cx = Number(detection.cx ?? detection.x);
  const cy = Number(detection.cy ?? detection.y);
  if (Number.isFinite(cx) && Number.isFinite(cy)) {
    return [{ x: cx, y: cy }];
  }

  const rect = asRecord(detection.rect ?? detection.bbox);
  const rx = Number(rect.x);
  const ry = Number(rect.y);
  const width = Number(rect.width ?? rect.w ?? 0);
  const height = Number(rect.height ?? rect.h ?? 0);
  if (Number.isFinite(rx) && Number.isFinite(ry)) {
    return [{ x: rx + (Number.isFinite(width) ? width / 2 : 0), y: ry + (Number.isFinite(height) ? height / 2 : 0) }];
  }

  return [];
}

function distanceBetweenPoints(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function normalizeDetectionMeasurement(
  detection: Record<string, unknown>,
  annotationType: string,
  points: { x: number; y: number }[],
) {
  const provided = asRecord(detection.measurement);
  if (Object.keys(provided).length > 0) return sanitizeJsonForPostgres(provided);
  if (annotationType === "count" || points.length === 1) {
    return { value: Number(detection.count ?? 1) || 1, unit: "count" };
  }
  const length = points.slice(1).reduce((sum, point, index) => sum + distanceBetweenPoints(points[index]!, point), 0);
  return {
    value: 0,
    unit: "",
    lengthPx: Math.round(length * 100) / 100,
    requiresCalibration: true,
  };
}

const DRAWING_ANALYSES_KEY = "drawingAnalyses";

function analysisRunSource(doc: any): "source_document" | "file_node" | "knowledge_book" {
  if (doc?.source === "file_node") return "file_node";
  if (doc?.source === "knowledge_book") return "knowledge_book";
  return "source_document";
}

function currentAnalysisRuns(doc: any): any[] {
  const source = analysisRunSource(doc);
  const root = source === "source_document" ? asRecord(doc?.structuredData) : asRecord(doc?.metadata);
  const runs = root[DRAWING_ANALYSES_KEY];
  return Array.isArray(runs) ? runs.map(asRecord) : [];
}

function compactAnalysisDetections(result: any) {
  return {
    lines: (Array.isArray(result.lines) ? result.lines : []).map((line: any) => ({
      id: line.id,
      kind: "line",
      x1: line.x1,
      y1: line.y1,
      x2: line.x2,
      y2: line.y2,
      lengthPx: line.lengthPx,
      bbox: line.bbox,
      entityId: line.entityId,
      layer: line.layer,
      confidence: line.confidence,
    })),
    polylines: (Array.isArray(result.polylines) ? result.polylines : []).map((polyline: any) => ({
      id: polyline.id,
      kind: "polyline",
      systemId: polyline.systemId,
      label: polyline.label,
      pointCount: polyline.pointCount,
      lengthPx: polyline.lengthPx,
      bbox: polyline.bbox,
      closed: polyline.closed,
      entityId: polyline.entityId,
      layer: polyline.layer,
      confidence: polyline.confidence,
    })),
    circles: (Array.isArray(result.circles) ? result.circles : []).map((circle: any) => ({
      id: circle.id,
      kind: "circle",
      cx: circle.cx,
      cy: circle.cy,
      radius: circle.radius,
      bbox: circle.bbox,
      entityId: circle.entityId,
      layer: circle.layer,
      confidence: circle.confidence,
    })),
    contours: (Array.isArray(result.contours) ? result.contours : []).map((contour: any) => ({
      id: contour.id,
      kind: "contour",
      bbox: contour.bbox,
      area: contour.area,
      perimeter: contour.perimeter,
      pointCount: contour.pointCount,
      entityId: contour.entityId,
      layer: contour.layer,
      confidence: contour.confidence,
    })),
    symbolCandidates: (Array.isArray(result.symbolCandidates) ? result.symbolCandidates : []).map((symbol: any) => ({
      id: symbol.id,
      kind: "symbol_candidate",
      x: symbol.x,
      y: symbol.y,
      w: symbol.w,
      h: symbol.h,
      cx: symbol.cx,
      cy: symbol.cy,
      bbox: { x: symbol.x, y: symbol.y, width: symbol.w, height: symbol.h },
      entityId: symbol.entityId,
      blockName: symbol.blockName,
      layer: symbol.layer,
      confidence: symbol.confidence,
    })),
    textRegions: (Array.isArray(result.textRegions) ? result.textRegions : []).map((region: any) => ({
      id: region.id,
      kind: "text_region",
      x: region.x ?? region.bbox?.x,
      y: region.y ?? region.bbox?.y,
      w: region.w ?? region.bbox?.width,
      h: region.h ?? region.bbox?.height,
      bbox: region.bbox ?? { x: region.x, y: region.y, width: region.w, height: region.h },
      entityId: region.entityId,
      layer: region.layer,
      text: region.text,
      confidence: region.confidence,
    })),
    systems: (Array.isArray(result.systems) ? result.systems : []).map((system: any) => ({
      id: system.id,
      kind: "system",
      label: system.label,
      segmentCount: system.segmentCount,
      nodeCount: system.nodeCount,
      lengthPx: system.lengthPx,
      bbox: system.bbox,
      layer: system.layer,
      entityIds: system.entityIds,
      counts: system.counts,
      confidence: system.confidence,
    })),
  };
}

function detectionRefsFromRun(run: any) {
  const detections = asRecord(run.detections);
  return [
    ...((Array.isArray(detections.lines) ? detections.lines : []) as any[]),
    ...((Array.isArray(detections.polylines) ? detections.polylines : []) as any[]),
    ...((Array.isArray(detections.circles) ? detections.circles : []) as any[]),
    ...((Array.isArray(detections.contours) ? detections.contours : []) as any[]),
    ...((Array.isArray(detections.symbolCandidates) ? detections.symbolCandidates : []) as any[]),
    ...((Array.isArray(detections.textRegions) ? detections.textRegions : []) as any[]),
    ...((Array.isArray(detections.systems) ? detections.systems : []) as any[]),
  ].map(asRecord).filter((entry) => entry.id);
}

async function persistAnalysisRuns(projectId: string, doc: any, runs: any[]) {
  const source = analysisRunSource(doc);
  const capped = runs.slice(0, 25).map((run) => sanitizeJsonForPostgres(run));
  if (source === "file_node") {
    const metadata = { ...asRecord(doc.metadata), [DRAWING_ANALYSES_KEY]: capped };
    await prisma.fileNode.update({ where: { id: String(doc.id) }, data: { metadata: metadata as any } });
    return;
  }
  if (source === "knowledge_book") {
    const metadata = { ...asRecord(doc.metadata), [DRAWING_ANALYSES_KEY]: capped };
    await prisma.knowledgeBook.update({ where: { id: String(doc.id) }, data: { metadata: metadata as any } });
    return;
  }
  const structuredData = { ...asRecord(doc.structuredData), [DRAWING_ANALYSES_KEY]: capped };
  await prisma.sourceDocument.update({ where: { id: String(doc.id) }, data: { structuredData: structuredData as any } });
}

async function recordDrawingAnalysisRun(projectId: string, doc: any, result: any, parameters: Record<string, unknown>, tool: string) {
  const analysisId = `dai_${randomUUID()}`;
  const run = {
    id: analysisId,
    status: "completed",
    tool,
    createdAt: new Date().toISOString(),
    projectId,
    documentId: doc.id,
    fileName: doc.fileName,
    pageNumber: result.pageNumber,
    preset: result.preset,
    parameters: sanitizeJsonForPostgres(parameters),
    imageWidth: result.imageWidth,
    imageHeight: result.imageHeight,
    scaleMetadata: result.scaleMetadata ?? null,
    summary: result.summary ?? {},
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    detections: compactAnalysisDetections(result),
    acceptedCount: 0,
    rejectedCount: 0,
    savedAnnotationIds: [],
  };
  const runs = [run, ...currentAnalysisRuns(doc)];
  await persistAnalysisRuns(projectId, doc, runs).catch(() => null);
  return analysisId;
}

async function updateDrawingAnalysisAcceptance(projectId: string, doc: any, analysisId: string, annotationIds: string[]) {
  if (!analysisId || annotationIds.length === 0) return;
  const runs = currentAnalysisRuns(doc);
  const nextRuns = runs.map((run) => {
    if (String(run.id) !== analysisId) return run;
    const saved = new Set([...(Array.isArray(run.savedAnnotationIds) ? run.savedAnnotationIds.map(String) : []), ...annotationIds]);
    return {
      ...run,
      acceptedCount: saved.size,
      savedAnnotationIds: Array.from(saved),
      updatedAt: new Date().toISOString(),
    };
  });
  await persistAnalysisRuns(projectId, doc, nextRuns).catch(() => null);
}

function findAnalysisRun(doc: any, analysisId?: string, pageNumber?: number) {
  const runs = currentAnalysisRuns(doc);
  if (analysisId) return runs.find((run) => String(run.id) === analysisId) ?? null;
  if (pageNumber) return runs.find((run) => Number(run.pageNumber) === Number(pageNumber)) ?? null;
  return runs[0] ?? null;
}

function classifyCadLayerName(nameValue: unknown) {
  const name = String(nameValue ?? "").toLowerCase();
  if (/pipe|piping|valve|pump|mech|process|steam|gas|hydronic|chw|hw|cw|san|vent|storm/.test(name)) return "mechanical_piping";
  if (/plumb|domestic|waste|drain/.test(name)) return "plumbing";
  if (/fire|sprinkler|fp[-_ ]?/.test(name)) return "fire_protection";
  if (/duct|hvac|air|supply|return|exhaust/.test(name)) return "ductwork";
  if (/elec|power|light|conduit|cable|panel|device/.test(name)) return "electrical";
  if (/struct|steel|beam|column|foundation|rebar|anchor|plate/.test(name)) return "structural";
  if (/civil|site|utility|road|grade|sewer|water/.test(name)) return "civil_linear";
  if (/text|anno|note|dim|tag|label|title|callout/.test(name)) return "annotation_text";
  if (/border|sheet|grid|datum/.test(name)) return "sheet_border_title";
  return "unknown";
}

function cadLayerMatchesPreset(layerName: unknown, preset: string) {
  const discipline = classifyCadLayerName(layerName);
  if (discipline === "annotation_text" || discipline === "sheet_border_title") return false;
  if (preset === "generic") return true;
  if (preset === "mechanical_piping") return discipline === "mechanical_piping" || discipline === "plumbing" || discipline === "unknown";
  return discipline === preset || discipline === "unknown";
}

function cadBbox(boundsValue: unknown) {
  const bounds = asRecord(boundsValue);
  const minX = Number(bounds.minX);
  const minY = Number(bounds.minY);
  const maxX = Number(bounds.maxX);
  const maxY = Number(bounds.maxY);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: Math.round(minX * 1000) / 1000,
    y: Math.round(minY * 1000) / 1000,
    width: Math.round(Math.max(0, maxX - minX) * 1000) / 1000,
    height: Math.round(Math.max(0, maxY - minY) * 1000) / 1000,
  };
}

function cadPoint(value: unknown): { x: number; y: number } | null {
  const point = asRecord(value);
  const x = Number(point.x);
  const y = Number(point.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function cadDistance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function cadPolylineLength(points: { x: number; y: number }[], closed = false) {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += cadDistance(points[index - 1]!, points[index]!);
  }
  if (closed && points.length > 2) length += cadDistance(points[points.length - 1]!, points[0]!);
  return length;
}

type CadTraceSegment = {
  id: string;
  layer: string;
  color?: string;
  entityId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
};

function cadSegmentsFromEntities(entities: any[], preset: string): CadTraceSegment[] {
  const segments: CadTraceSegment[] = [];
  for (const entity of entities) {
    const layer = String(entity.layer ?? "0");
    if (!cadLayerMatchesPreset(layer, preset)) continue;
    const type = String(entity.type).toUpperCase();
    if (type === "LINE") {
      const start = cadPoint(entity.start);
      const end = cadPoint(entity.end);
      if (!start || !end) continue;
      const length = cadDistance(start, end);
      if (length <= 0) continue;
      segments.push({ id: `cad-ln-${segments.length + 1}`, layer, color: entity.color, entityId: String(entity.id ?? ""), x1: start.x, y1: start.y, x2: end.x, y2: end.y, length });
    } else if (type === "LWPOLYLINE" || type === "POLYLINE") {
      const vertices = (Array.isArray(entity.vertices) ? entity.vertices : []).map(cadPoint).filter(Boolean) as { x: number; y: number }[];
      const pairs = entity.closed === true && vertices.length > 2 ? [...vertices, vertices[0]!] : vertices;
      for (let index = 1; index < pairs.length; index++) {
        const start = pairs[index - 1]!;
        const end = pairs[index]!;
        const length = cadDistance(start, end);
        if (length <= 0) continue;
        segments.push({ id: `cad-ln-${segments.length + 1}`, layer, color: entity.color, entityId: String(entity.id ?? ""), x1: start.x, y1: start.y, x2: end.x, y2: end.y, length });
      }
    }
  }
  return segments;
}

function presetLabelForApi(preset: string) {
  const labels: Record<string, string> = {
    mechanical_piping: "Mechanical piping",
    plumbing: "Plumbing",
    fire_protection: "Fire protection",
    ductwork: "Ductwork",
    electrical: "Electrical",
    civil_linear: "Civil",
    structural: "Structural",
  };
  return labels[preset] ?? "Detected";
}

function cadTraceSystemsFromSegments(segments: CadTraceSegment[], extentsValue: unknown, preset: string) {
  if (segments.length === 0) return [];
  const extents = asRecord(extentsValue);
  const width = Math.abs(Number(extents.maxX ?? 0) - Number(extents.minX ?? 0));
  const height = Math.abs(Number(extents.maxY ?? 0) - Number(extents.minY ?? 0));
  const tolerance = Math.max(0.01, Math.max(width, height) * 0.0015);
  const nodeIds = new Map<string, number>();
  const nodeDegree = new Map<number, number>();
  const segmentNodes = new Map<string, [number, number]>();
  const adjacency = new Map<number, CadTraceSegment[]>();
  const nodeKey = (layer: string, point: { x: number; y: number }) => `${layer}:${Math.round(point.x / tolerance)}:${Math.round(point.y / tolerance)}`;
  const nodeFor = (layer: string, point: { x: number; y: number }) => {
    const key = nodeKey(layer, point);
    let id = nodeIds.get(key);
    if (id === undefined) {
      id = nodeIds.size + 1;
      nodeIds.set(key, id);
    }
    return id;
  };

  for (const segment of segments) {
    const a = nodeFor(segment.layer, { x: segment.x1, y: segment.y1 });
    const b = nodeFor(segment.layer, { x: segment.x2, y: segment.y2 });
    if (a === b) continue;
    segmentNodes.set(segment.id, [a, b]);
    nodeDegree.set(a, (nodeDegree.get(a) ?? 0) + 1);
    nodeDegree.set(b, (nodeDegree.get(b) ?? 0) + 1);
    adjacency.set(a, [...(adjacency.get(a) ?? []), segment]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), segment]);
  }

  const seen = new Set<string>();
  const systems: any[] = [];
  for (const segment of segments) {
    if (seen.has(segment.id) || !segmentNodes.has(segment.id)) continue;
    const queue = [segment];
    const component: CadTraceSegment[] = [];
    const nodes = new Set<number>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current.id)) continue;
      seen.add(current.id);
      component.push(current);
      const pair = segmentNodes.get(current.id);
      if (!pair) continue;
      for (const node of pair) {
        nodes.add(node);
        for (const neighbor of adjacency.get(node) ?? []) {
          if (!seen.has(neighbor.id)) queue.push(neighbor);
        }
      }
    }
    if (component.length === 0) continue;
    const length = component.reduce((sum, item) => sum + item.length, 0);
    if (length < Math.max(0.5, Math.max(width, height) * 0.01) && component.length < 3) continue;
    const xs = component.flatMap((item) => [item.x1, item.x2]);
    const ys = component.flatMap((item) => [item.y1, item.y2]);
    const counts = {
      openEnds: Array.from(nodes).filter((node) => (nodeDegree.get(node) ?? 0) <= 1).length,
      elbows45: 0,
      elbows90: 0,
      bends: Array.from(nodes).filter((node) => (nodeDegree.get(node) ?? 0) === 2).length,
      tees: Array.from(nodes).filter((node) => (nodeDegree.get(node) ?? 0) === 3).length,
      crosses: Array.from(nodes).filter((node) => (nodeDegree.get(node) ?? 0) > 3).length,
      transitions: 0,
    };
    const layer = component[0]?.layer ?? "0";
    systems.push({
      id: `cad-sys-${systems.length + 1}`,
      label: `${presetLabelForApi(preset)} CAD run ${systems.length + 1}`,
      preset,
      layer,
      layerDiscipline: classifyCadLayerName(layer),
      source: "cad-topology",
      segmentIds: component.map((item) => item.id),
      entityIds: Array.from(new Set(component.map((item) => item.entityId).filter(Boolean))).slice(0, 200),
      segmentCount: component.length,
      nodeCount: nodes.size,
      lengthPx: Math.round(length * 1000) / 1000,
      lengthCadUnits: Math.round(length * 1000) / 1000,
      bbox: {
        x: Math.round(Math.min(...xs) * 1000) / 1000,
        y: Math.round(Math.min(...ys) * 1000) / 1000,
        width: Math.round((Math.max(...xs) - Math.min(...xs)) * 1000) / 1000,
        height: Math.round((Math.max(...ys) - Math.min(...ys)) * 1000) / 1000,
      },
      counts,
      confidence: 0.92,
      warnings: counts.openEnds > 2 ? ["multiple_open_ends"] : [],
    });
  }
  return systems.sort((left, right) => Number(right.lengthCadUnits) - Number(left.lengthCadUnits)).slice(0, 120);
}

function buildCadDrawingAnalysis(cad: any, preset: string, traceSystems: boolean, maxEntities: number) {
  const entities = Array.isArray(cad.entities) ? cad.entities : [];
  const takeBudget = <T>(items: T[]) => maxEntities > 0 ? items.slice(0, maxEntities) : items;
  const extents = asRecord(cad.extents);
  const width = Math.max(1, Number(extents.maxX ?? 0) - Number(extents.minX ?? 0));
  const height = Math.max(1, Number(extents.maxY ?? 0) - Number(extents.minY ?? 0));
  const linearSegments = cadSegmentsFromEntities(entities, preset);
  const lines = takeBudget(linearSegments).map((segment, index) => ({
    id: segment.id,
    entityId: segment.entityId,
    x1: Math.round(segment.x1 * 1000) / 1000,
    y1: Math.round(segment.y1 * 1000) / 1000,
    x2: Math.round(segment.x2 * 1000) / 1000,
    y2: Math.round(segment.y2 * 1000) / 1000,
    lengthPx: Math.round(segment.length * 1000) / 1000,
    lengthCadUnits: Math.round(segment.length * 1000) / 1000,
    angleDeg: 0,
    bbox: cadBbox({ minX: Math.min(segment.x1, segment.x2), minY: Math.min(segment.y1, segment.y2), maxX: Math.max(segment.x1, segment.x2), maxY: Math.max(segment.y1, segment.y2) }),
    layer: segment.layer,
    color: segment.color,
    source: "cad-entity-segment",
    confidence: index < entities.length ? 0.98 : 0.96,
  }));
  const polylines = takeBudget(entities
    .filter((entity: any) => ["LWPOLYLINE", "POLYLINE"].includes(String(entity.type).toUpperCase())))
    .map((entity: any, index: number) => {
      const points = (Array.isArray(entity.vertices) ? entity.vertices : []).map(cadPoint).filter(Boolean) as { x: number; y: number }[];
      const length = cadPolylineLength(points, entity.closed === true);
      return {
        id: `cad-pl-${index + 1}`,
        entityId: entity.id,
        source: "cad-polyline",
        layer: entity.layer,
        layerDiscipline: classifyCadLayerName(entity.layer),
        pointCount: points.length,
        points: points.slice(0, 240),
        pointLimitApplied: points.length > 240,
        lengthPx: Math.round(length * 1000) / 1000,
        lengthCadUnits: Math.round(length * 1000) / 1000,
        bbox: cadBbox(entity.bounds),
        closed: entity.closed === true,
        confidence: 0.98,
      };
    });
  const circles = takeBudget(entities
    .filter((entity: any) => ["CIRCLE", "ARC", "ELLIPSE"].includes(String(entity.type).toUpperCase()) && cadPoint(entity.center)))
    .map((entity: any, index: number) => {
      const center = cadPoint(entity.center)!;
      return {
        id: `cad-cir-${index + 1}`,
        entityId: entity.id,
        kind: String(entity.type).toLowerCase(),
        cx: center.x,
        cy: center.y,
        radius: Number(entity.radius ?? 0),
        bbox: cadBbox(entity.bounds),
        layer: entity.layer,
        source: "cad-circle-arc",
        confidence: 0.98,
      };
    });
  const symbolCandidates = takeBudget(entities
    .filter((entity: any) => String(entity.type).toUpperCase() === "INSERT"))
    .map((entity: any, index: number) => {
      const point = cadPoint(entity.start) ?? { x: 0, y: 0 };
      const bbox = cadBbox(entity.bounds);
      return {
        id: `cad-sym-${index + 1}`,
        entityId: entity.id,
        blockName: entity.text || asRecord(entity.raw).blockName || "",
        x: bbox.x || point.x,
        y: bbox.y || point.y,
        w: bbox.width || 1,
        h: bbox.height || 1,
        cx: point.x,
        cy: point.y,
        area: Math.max(1, bbox.width * bbox.height),
        aspect: bbox.height ? bbox.width / bbox.height : 1,
        bbox,
        layer: entity.layer,
        confidence: 0.95,
        source: "cad-insert-block",
        metadata: entity.raw ?? {},
      };
    });
  const textRegions = takeBudget(entities
    .filter((entity: any) => ["TEXT", "MTEXT"].includes(String(entity.type).toUpperCase())))
    .map((entity: any, index: number) => ({
      id: `cad-txt-${index + 1}`,
      entityId: entity.id,
      text: entity.text ?? "",
      bbox: cadBbox(entity.bounds),
      layer: entity.layer,
      confidence: 0.98,
      source: "cad-text",
    }));
  const systems = traceSystems ? cadTraceSystemsFromSegments(linearSegments, extents, preset) : [];
  const contours = takeBudget([
    ...polylines.filter((polyline: any) => polyline.closed),
    ...circles.filter((circle: any) => circle.kind === "circle"),
  ]).map((entry: any, index: number) => ({
    id: `cad-ctr-${index + 1}`,
    entityId: entry.entityId,
    bbox: entry.bbox,
    layer: entry.layer,
    source: "cad-closed-geometry",
    confidence: entry.confidence ?? 0.9,
  }));
  const totalSystemLength = Math.round(systems.reduce((sum, system) => sum + Number(system.lengthCadUnits ?? 0), 0) * 1000) / 1000;
  return {
    success: true,
    schemaVersion: 1,
    geometrySource: "cad-native",
    preset,
    documentId: cad.documentId,
    fileName: cad.fileName,
    pageNumber: 1,
    dpi: null,
    coordinateSpace: "cad-native",
    units: cad.units,
    imageWidth: Math.round(width * 1000) / 1000,
    imageHeight: Math.round(height * 1000) / 1000,
    pageWidth: Math.round(width * 1000) / 1000,
    pageHeight: Math.round(height * 1000) / 1000,
    scaleMetadata: {
      coordinateSpace: "cad-native",
      units: cad.units,
      extents: cad.extents,
      sourceKind: cad.sourceKind,
      converter: cad.converter,
      calibrationRequired: false,
    },
    preprocessing: {
      parser: "bidwright-dwg-processing-service",
      sourceKind: cad.sourceKind,
      converterStatus: cad.converter?.status,
    },
    summary: {
      lineCount: lines.length,
      circleCount: circles.length,
      symbolCandidateCount: symbolCandidates.length,
      textRegionCount: textRegions.length,
      systemCount: systems.length,
      polylineCount: polylines.length,
      contourCount: contours.length,
      totalSystemLengthPx: totalSystemLength,
      totalSystemLengthCadUnits: totalSystemLength,
      entityCount: entities.length,
      layerCount: Array.isArray(cad.layers) ? cad.layers.length : 0,
    },
    layers: Array.isArray(cad.layers) ? cad.layers.map((layer: any) => ({ ...layer, discipline: classifyCadLayerName(layer.name) })) : [],
    layouts: cad.layouts ?? [],
    lines,
    polylines,
    circles,
    contours,
    symbolCandidates,
    textRegions,
    systems,
    thumbnailSvg: cad.thumbnailSvg,
    warnings: cad.status === "converter_required" ? [cad.converter?.message ?? "DWG converter required"] : [],
    duration_ms: 0,
  };
}

async function resolveAnalysisDocForCad(projectId: string, documentId: string, sourceKind: "source_document" | "file_node") {
  if (sourceKind === "file_node") {
    const fileNode = await prisma.fileNode.findFirst({ where: { id: documentId, projectId } });
    return fileNode ? { ...fileNode, fileName: fileNode.name, source: "file_node" } : null;
  }
  return prisma.sourceDocument.findFirst({ where: { id: documentId, projectId } });
}

async function safeJson(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * Drawing-extraction provider helpers.
 *
 * Cache lives at `structuredData.drawingEvidence`. The cache record's `cacheKey`
 * field includes the active provider id and config fingerprint, so changing
 * provider or model invalidates the cache.
 *
 * For LandingAI we additionally support an async lifecycle (start job, return
 * immediately, poll in background) via `landingAiAsyncBound(settings)`.
 */
import {
  resolveActiveProvider,
  landingAiAsyncBound,
  type DrawingProviderId,
  type IntegrationSettingsSnapshot,
  type ParseProviderInput,
  type ProviderResult,
} from "@bidwright/ingestion";

function isTruthySetting(value: unknown) {
  if (value === true) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(text);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
void sleep; // used by future progress-polling helpers; keep available

interface CachedDrawingEvidence {
  schemaVersion: 2;
  provider: DrawingProviderId;
  status: ProviderResult["status"];
  cacheKey: string;
  sourceHash: string;
  cachedAt?: string;
  completedAt?: string;
  failedAt?: string;
  queuedAt?: string;
  job?: ProviderResult["job"] | null;
  parse?: ProviderResult["parse"];
  extract?: ProviderResult["extract"];
  error?: string;
  meta?: ProviderResult["meta"];
  atlasInclusion?: { allowed: boolean; reason: string } | null;
}

function readDrawingEvidenceCache(structuredData: unknown): CachedDrawingEvidence | null {
  const root = asRecord(structuredData);
  const cache = asRecord(root.drawingEvidence);
  if (!cache || cache.schemaVersion !== 2) return null;
  return cache as unknown as CachedDrawingEvidence;
}

function cacheMatches(cache: CachedDrawingEvidence | null, expected: { sourceHash: string; cacheKey: string; provider: DrawingProviderId }) {
  return !!cache
    && cache.schemaVersion === 2
    && cache.sourceHash === expected.sourceHash
    && cache.cacheKey === expected.cacheKey
    && cache.provider === expected.provider;
}

function cacheMatchesSource(cache: CachedDrawingEvidence | null, sourceHash: string) {
  return !!cache && cache.schemaVersion === 2 && cache.sourceHash === sourceHash && !!cache.parse;
}

function evidenceCacheResponse(cache: CachedDrawingEvidence, documentId: string, fileName: string) {
  return {
    success: true,
    skipped: false,
    cached: true,
    provider: cache.provider,
    status: cache.status,
    pending: ["queued", "running"].includes(String(cache.status ?? "").toLowerCase()),
    documentId,
    fileName,
    job: cache.job ?? null,
    parse: cache.parse ?? {},
    extract: cache.extract ?? null,
    meta: cache.meta ?? null,
  };
}

async function persistDrawingEvidence(projectId: string, documentId: string, currentStructuredData: unknown, cache: CachedDrawingEvidence) {
  const current = await prisma.sourceDocument.findFirst({
    where: { id: documentId, projectId },
    select: { structuredData: true },
  }).catch(() => null);
  const structuredData = {
    ...asRecord(current?.structuredData ?? currentStructuredData),
    drawingEvidence: cache,
  };
  await prisma.sourceDocument.updateMany({
    where: { id: documentId, projectId },
    data: { structuredData: sanitizeJsonForPostgres(structuredData) as any },
  });
}

async function recordEvidenceNotification(projectId: string, notification: Record<string, any>) {
  const strategy = await prisma.estimateStrategy.findFirst({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
  }).catch(() => null);
  if (!strategy) return;
  const summary = asRecord(strategy.summary);
  const engine = asRecord(summary.drawingEvidenceEngine);
  const notifications = Array.isArray(engine.asyncEvidenceNotifications)
    ? engine.asyncEvidenceNotifications.map(asRecord)
    : [];
  await prisma.estimateStrategy.update({
    where: { id: strategy.id },
    data: {
      summary: sanitizeJsonForPostgres({
        ...summary,
        drawingEvidenceEngine: {
          ...engine,
          asyncEvidenceNotifications: [
            {
              ...notification,
              id: notification.id ?? `drawing-evidence-${Date.now()}`,
              createdAt: notification.createdAt ?? new Date().toISOString(),
            },
            ...notifications,
          ].slice(0, 80),
        },
      }) as any,
    },
  }).catch(() => null);
}

async function appendEvidenceAgentEvent(projectId: string, event: { type: string; data: Record<string, any> }) {
  const timestamp = new Date().toISOString();
  const persistedEvent = { ...event, timestamp };
  const emittedToLiveSession = emitSessionEvent(projectId, persistedEvent);
  if (emittedToLiveSession) return;
  const run = await prisma.aiRun.findFirst({
    where: { projectId, status: "running" },
    orderBy: { createdAt: "desc" },
  }).catch(() => null);
  if (!run) return;
  const output = asRecord(run.output);
  const events = Array.isArray(output.events) ? output.events : [];
  await prisma.aiRun.update({
    where: { id: run.id },
    data: {
      output: {
        ...output,
        events: [...events, persistedEvent],
      } as any,
    },
  }).catch(() => null);
}

const drawingEvidenceBackgroundTasks = new Map<string, Promise<void>>();

function bgTaskKey(projectId: string, documentId: string, cacheKey: string) {
  return `${projectId}:${documentId}:${cacheKey}`;
}

/** Background completion for LandingAI's async-job lifecycle. */
async function completeLandingAiInBackground(args: {
  projectId: string;
  documentId: string;
  fileName: string;
  jobId: string;
  sourceHash: string;
  cacheKey: string;
  includeExtraction: boolean;
  atlasInclusion: { allowed: boolean; reason: string } | null;
  currentStructuredData: unknown;
  settings: IntegrationSettingsSnapshot;
}) {
  try {
    await appendEvidenceAgentEvent(args.projectId, {
      type: "progress",
      data: {
        phase: "Drawing Evidence",
        detail: `LandingAI enrichment started for ${args.fileName}; continuing with Azure/local evidence while it runs.`,
        source: "drawing-evidence-background",
        provider: "landingAi",
        documentId: args.documentId,
      },
    });
    const handle = landingAiAsyncBound(args.settings);
    const result = await handle.resumeJob({
      jobId: args.jobId,
      sourceHash: args.sourceHash,
      fileName: args.fileName,
      includeExtraction: args.includeExtraction,
      onProgress: (event) => appendEvidenceAgentEvent(args.projectId, {
        type: "progress",
        data: {
          phase: event.phase,
          detail: event.detail,
          source: "drawing-evidence-background",
          provider: "landingAi",
          documentId: args.documentId,
        },
      }),
    });

    await persistDrawingEvidence(args.projectId, args.documentId, args.currentStructuredData, {
      schemaVersion: 2,
      provider: "landingAi",
      status: "completed",
      cacheKey: args.cacheKey,
      sourceHash: args.sourceHash,
      cachedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      job: result.job ?? null,
      parse: result.parse,
      extract: result.extract,
      meta: result.meta,
      atlasInclusion: args.atlasInclusion,
    });
    await recordEvidenceNotification(args.projectId, {
      type: "drawing_evidence_ready",
      provider: "landingAi",
      status: "ready",
      documentId: args.documentId,
      fileName: args.fileName,
      chunkCount: result.parse.chunks.length,
      splitCount: Array.isArray(result.parse.splits) ? result.parse.splits.length : 0,
      message: `LandingAI drawing evidence is ready for ${args.fileName}. Rebuild/search the Drawing Evidence Engine atlas to use it.`,
    });
    await appendEvidenceAgentEvent(args.projectId, {
      type: "message",
      data: {
        role: "system",
        content: `LandingAI drawing evidence is ready for ${args.fileName}. Continue the estimate with Azure/local evidence if you are mid-task, and on your next evidence pass call buildDrawingAtlas/searchDrawingRegions to use the new regions.`,
        source: "drawing-evidence-background",
        provider: "landingAi",
        documentId: args.documentId,
      },
    });
    await interruptAndResumeSession(
      args.projectId,
      [
        "BACKGROUND DRAWING EVIDENCE UPDATE:",
        `LandingAI drawing evidence has completed for ${args.fileName} (${args.documentId}).`,
        "Immediately check the current state with getWorkspace and getEstimateStrategy.",
        "Then call buildDrawingAtlas with force=true, searchDrawingRegions for the relevant current scope/questions, and inspectDrawingRegion for any high-risk drawing quantities that the new regions clarify.",
        "Continue the existing estimating task from the current saved state. Do not recreate worksheets, packages, rows, or claims that already exist; only revise or add evidence where this new source changes the estimate.",
      ].join("\n"),
      `Drawing evidence ready for ${args.fileName}`,
    ).catch(() => null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persistDrawingEvidence(args.projectId, args.documentId, args.currentStructuredData, {
      schemaVersion: 2,
      provider: "landingAi",
      status: "failed",
      cacheKey: args.cacheKey,
      sourceHash: args.sourceHash,
      cachedAt: new Date().toISOString(),
      failedAt: new Date().toISOString(),
      error: message,
      job: { jobId: args.jobId, status: "failed" },
      parse: { markdown: "", chunks: [] },
      extract: null,
      atlasInclusion: args.atlasInclusion,
    }).catch(() => null);
    await recordEvidenceNotification(args.projectId, {
      type: "drawing_evidence_failed",
      provider: "landingAi",
      status: "failed",
      documentId: args.documentId,
      fileName: args.fileName,
      message: `LandingAI drawing evidence failed for ${args.fileName}: ${message}`,
    });
    await appendEvidenceAgentEvent(args.projectId, {
      type: "progress",
      data: {
        phase: "Drawing Evidence",
        detail: `LandingAI enrichment failed for ${args.fileName}: ${message}`,
        source: "drawing-evidence-background",
        provider: "landingAi",
        documentId: args.documentId,
      },
    });
  }
}

function ensureLandingAiBackgroundTask(args: Parameters<typeof completeLandingAiInBackground>[0]) {
  const key = bgTaskKey(args.projectId, args.documentId, args.cacheKey);
  if (drawingEvidenceBackgroundTasks.has(key)) return;
  const task = completeLandingAiInBackground(args).finally(() => {
    drawingEvidenceBackgroundTasks.delete(key);
  });
  drawingEvidenceBackgroundTasks.set(key, task);
}

/**
 * Vision API routes – PDF rendering, region cropping, and the OpenCV
 * symbol-matching pipeline. Used by the takeoff UI and the AI agent.
 */
export async function visionRoutes(app: FastifyInstance) {

  // ── POST /api/vision/pdf-native-summary ────────────────────────────────
  // Extracts PDF-native structure when present: optional-content layers,
  // text geometry, operator counts, and page viewport metadata. This lets
  // the drawing atlas use CAD/PDF structure before falling back to pixels.
  // Body: { projectId, documentId, pageNumber?, maxPages? }
  app.post("/api/vision/pdf-native-summary", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = body.projectId as string;
    const documentId = body.documentId as string;
    const pageNumber = typeof body.pageNumber === "number" ? Math.max(1, Math.floor(body.pageNumber)) : undefined;
    const maxPages = typeof body.maxPages === "number" ? Math.max(1, Math.min(25, Math.floor(body.maxPages))) : 5;
    if (!projectId || !documentId) return reply.code(400).send({ message: "projectId and documentId required" });

    const resolved = await resolveDocPdf(request.store!, projectId, documentId);
    if ("error" in resolved) return reply.code(resolved.status).send({ message: resolved.error });

    let pdfjs: any;
    try {
      pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    } catch (err) {
      return reply.code(500).send({
        message: "pdfjs-dist package not available",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const data = new Uint8Array(await readFile(resolved.absPath));
      const loadingTask = pdfjs.getDocument({
        data,
        disableWorker: true,
        useSystemFonts: true,
      });
      const pdf = await loadingTask.promise;
      await repairStoredNativePdfPageCount(resolved.doc, pdf.numPages);
      if (pageNumber && pageNumber > pdf.numPages) {
        await pdf.destroy?.();
        return reply.code(400).send({
          success: false,
          message: `Page ${pageNumber} out of range (1-${pdf.numPages})`,
          requestedPage: pageNumber,
          pageCount: pdf.numPages,
          documentId,
          fileName: resolved.doc.fileName,
        });
      }
      const optionalContentConfig = await pdf.getOptionalContentConfig().catch(() => null);
      const layerOrder = optionalContentConfig?.getOrder?.() ?? [];
      const layers = Array.isArray(layerOrder)
        ? layerOrder
            .map((id: unknown) => {
              const group = optionalContentConfig?.getGroup?.(id);
              const name = String(group?.name ?? "").trim();
              return {
                id: String(id),
                name,
                classification: classifyPdfLayerName(name),
                intent: group?.intent ?? null,
                usage: group?.usage ?? null,
              };
            })
            .filter((layer: { name: string }) => layer.name)
        : [];

      const targetPages = pageNumber
        ? [pageNumber]
        : Array.from({ length: Math.min(pdf.numPages, maxPages) }, (_, index) => index + 1);
      const pages = [];
      for (const pageNo of targetPages) {
        const page = await pdf.getPage(pageNo);
        const viewport = page.getViewport({ scale: 1 });
        const [textContent, operatorList] = await Promise.all([
          page.getTextContent().catch(() => ({ items: [] })),
          page.getOperatorList().catch(() => ({ fnArray: [] })),
        ]);
        const items = Array.isArray(textContent.items) ? textContent.items as any[] : [];
        const fnArray = Array.isArray(operatorList.fnArray) ? operatorList.fnArray as number[] : [];
        const operatorCounts = countPdfOperators(fnArray, pdfjs.OPS ?? {});
        pages.push({
          pageNumber: pageNo,
          width: viewport.width,
          height: viewport.height,
          rotation: viewport.rotation,
          textItemCount: items.length,
          textItemsSample: items.slice(0, 80).map((item) => {
            const transform = Array.isArray(item.transform) ? item.transform : [];
            return {
              text: String(item.str ?? "").slice(0, 160),
              x: numberOrNull(transform[4]),
              y: numberOrNull(transform[5]),
              width: numberOrNull(item.width),
              height: numberOrNull(item.height),
              fontName: item.fontName ?? null,
            };
          }),
          operatorCount: fnArray.length,
          operatorCounts,
          vectorSignals: summarizeVectorSignals(operatorCounts),
        });
      }

      const responsePayload = {
        success: true,
        documentId,
        fileName: resolved.doc.fileName,
        pageCount: pdf.numPages,
        hasOptionalContentLayers: layers.length > 0,
        layerCount: layers.length,
        layerNames: layers.map((layer: { name: string }) => layer.name),
        layers,
        layerClassCounts: layers.reduce((acc: Record<string, number>, layer: { classification: string }) => {
          acc[layer.classification] = (acc[layer.classification] ?? 0) + 1;
          return acc;
        }, {}),
        pages,
      };
      await pdf.destroy?.();
      return responsePayload;
    } catch (err) {
      return reply.code(500).send({
        message: "PDF-native extraction failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── POST /api/vision/drawing-extraction-summary ──────────────────────
  // Optional Drawing Evidence Engine enrichment for drawing PDFs.
  // Dispatches to the configured provider (LandingAI ADE / Gemini Pro / Gemini Flash).
  // Credentials come from Settings > Integrations and are never returned in this response.
  // Body: { projectId, documentId, includeExtraction?, pollTimeoutMs?, force?, allowNonDrawing?, atlasInclusionReason? }
  // Legacy alias: POST /api/vision/landingai-drawing-summary continues to work.
  const drawingExtractionHandler = async (request: any, reply: any) => {
    const body = request.body as Record<string, unknown>;
    const projectId = body.projectId as string;
    const documentId = body.documentId as string;
    if (!projectId || !documentId) return reply.code(400).send({ message: "projectId and documentId required" });

    const resolved = await resolveDocPdf(request.store!, projectId, documentId);
    if ("error" in resolved) return reply.code(resolved.status).send({ message: resolved.error });
    if (!isPdfDocument(resolved.doc)) {
      return { success: true, skipped: true, reason: "not_pdf", documentId, fileName: resolved.doc.fileName };
    }
    if (isIgnoredDocArtifact(resolved.doc)) {
      return { success: true, skipped: true, reason: "ignored_artifact", documentId, fileName: resolved.doc.fileName };
    }
    const atlasInclusionReason = String(body.atlasInclusionReason ?? body.reason ?? "").trim();
    const allowAtlasInclusion = body.allowNonDrawing === true && atlasInclusionReason.length >= 12;
    if (!isDrawingPdfDocument(resolved.doc) && !allowAtlasInclusion) {
      return { success: true, skipped: true, reason: "not_drawing_pdf", documentId, fileName: resolved.doc.fileName };
    }

    const settings = await request.store!.getSettings();
    const integrations = (settings.integrations ?? {}) as IntegrationSettingsSnapshot;
    const { id: providerId, enabled, provider } = resolveActiveProvider(integrations);
    const includeExtraction = body.includeExtraction !== false;
    const asyncMode = body.async === true || body.background === true || body.mode === "async";
    const pollTimeoutMs = Math.max(10_000, Math.min(180_000, Number(body.pollTimeoutMs) || 120_000));
    const sourceHash = String(resolved.doc.checksum ?? "") || `${resolved.doc.fileName}:${resolved.doc.pageCount ?? ""}`;
    const cacheOnly = isTruthySetting(process.env.LANDINGAI_CACHE_ONLY) || isTruthySetting(process.env.DRAWING_EVIDENCE_CACHE_ONLY);

    if (!provider) {
      return { success: true, skipped: true, reason: "no_provider_configured", documentId, fileName: resolved.doc.fileName };
    }

    const cacheKey = `${sourceHash}:${provider.configFingerprint(integrations)}`;
    const cached = readDrawingEvidenceCache(resolved.doc.structuredData);
    const exactCacheMatch = cacheMatches(cached, { sourceHash, cacheKey, provider: providerId });
    const sourceCacheMatch = cacheOnly && cacheMatchesSource(cached, sourceHash);

    if ((cacheOnly || body.force !== true) && cached && (exactCacheMatch || sourceCacheMatch)) {
      const cachedStatus = String(cached.status ?? "completed").toLowerCase();
      // Resume LandingAI background polling if a queued/running cache entry was discovered.
      if (!cacheOnly && asyncMode && providerId === "landingAi" && provider.isConfigured(integrations)
          && ["queued", "running"].includes(cachedStatus) && cached.job?.jobId) {
        ensureLandingAiBackgroundTask({
          projectId,
          documentId,
          fileName: resolved.doc.fileName,
          jobId: String(cached.job.jobId),
          sourceHash,
          cacheKey,
          includeExtraction,
          atlasInclusion: cached.atlasInclusion ?? null,
          currentStructuredData: resolved.doc.structuredData,
          settings: integrations,
        });
      }
      return {
        ...evidenceCacheResponse(cached, documentId, resolved.doc.fileName),
        cacheOnly,
        cacheMatch: exactCacheMatch ? "exact" : "source_hash",
      };
    }

    if (cacheOnly) {
      return {
        success: true,
        skipped: true,
        cached: false,
        cacheOnly: true,
        reason: "cache_only_miss",
        documentId,
        fileName: resolved.doc.fileName,
        next: "Drawing-evidence network calls are disabled for this server run. Azure/local/PDF-native evidence remains available.",
      };
    }

    if (!enabled) {
      const reason = providerId === "none" ? "disabled" : (provider.isConfigured(integrations) ? "disabled" : "missing_api_key");
      return { success: true, skipped: true, reason, provider: providerId, documentId, fileName: resolved.doc.fileName };
    }

    const pdfBytes = await readFile(resolved.absPath);
    const fileName = resolved.doc.fileName || "drawing.pdf";
    const atlasInclusion = allowAtlasInclusion ? { allowed: true, reason: atlasInclusionReason } : null;
    const onProgress: ParseProviderInput["onProgress"] = (event) => appendEvidenceAgentEvent(projectId, {
      type: "progress",
      data: {
        phase: event.phase,
        detail: event.detail,
        source: "drawing-evidence",
        provider: providerId,
        documentId,
      },
    });

    // LandingAI's async lifecycle: start the job, persist a "running" cache record,
    // optionally return immediately and continue polling in the background.
    if (providerId === "landingAi") {
      try {
        const handle = landingAiAsyncBound(integrations);
        const started = await handle.startJob({
          pdfBytes,
          fileName,
          sourceHash,
          includeExtraction,
          pollTimeoutMs,
          onProgress,
        });
        const runningCache: CachedDrawingEvidence = {
          schemaVersion: 2,
          provider: "landingAi",
          status: "running",
          cacheKey,
          sourceHash,
          queuedAt: new Date().toISOString(),
          job: started.running.job,
          parse: { markdown: "", chunks: [] },
          extract: null,
          meta: started.running.meta,
          atlasInclusion,
        };
        await persistDrawingEvidence(projectId, documentId, resolved.doc.structuredData, runningCache).catch((error) => {
          request.log.warn({ err: error, documentId }, "Drawing evidence running cache persist failed");
        });

        if (asyncMode) {
          ensureLandingAiBackgroundTask({
            projectId,
            documentId,
            fileName,
            jobId: started.jobId,
            sourceHash,
            cacheKey,
            includeExtraction,
            atlasInclusion,
            currentStructuredData: resolved.doc.structuredData,
            settings: integrations,
          });
          return {
            success: true,
            skipped: false,
            cached: false,
            provider: "landingAi" as const,
            status: "running",
            pending: true,
            documentId,
            fileName,
            atlasInclusion,
            job: runningCache.job,
            parse: runningCache.parse,
            extract: null,
            meta: runningCache.meta,
            next: "LandingAI enrichment is running asynchronously. Continue with Azure/local evidence; call buildDrawingAtlas/searchDrawingRegions again later to pick up completed regions.",
          };
        }

        const result = await handle.resumeJob({
          jobId: started.jobId,
          sourceHash,
          fileName,
          includeExtraction,
          timeoutMs: pollTimeoutMs,
          onProgress,
        });
        const completedCache: CachedDrawingEvidence = {
          schemaVersion: 2,
          provider: "landingAi",
          status: result.status,
          cacheKey,
          sourceHash,
          cachedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          job: result.job,
          parse: result.parse,
          extract: result.extract,
          meta: result.meta,
          atlasInclusion,
        };
        await persistDrawingEvidence(projectId, documentId, resolved.doc.structuredData, completedCache).catch((error) => {
          request.log.warn({ err: error, documentId }, "Drawing evidence cache persist failed");
        });
        return {
          success: true,
          skipped: false,
          cached: false,
          provider: result.provider,
          status: result.status,
          pending: false,
          documentId,
          fileName,
          atlasInclusion,
          job: result.job,
          parse: result.parse,
          extract: result.extract,
          meta: result.meta,
        };
      } catch (error) {
        request.log.warn({ err: error, documentId }, "LandingAI drawing extraction failed");
        return reply.code(502).send({
          success: false,
          provider: "landingAi",
          message: "LandingAI drawing extraction failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Synchronous providers (Gemini Pro / Gemini Flash).
    try {
      await onProgress({ phase: "Drawing Evidence", detail: `Starting ${providerId} extraction for ${fileName}` });
      const result = await provider.parse({
        pdfBytes,
        fileName,
        sourceHash,
        includeExtraction,
        pollTimeoutMs,
        onProgress,
      }, integrations);
      const completedCache: CachedDrawingEvidence = {
        schemaVersion: 2,
        provider: providerId,
        status: result.status,
        cacheKey,
        sourceHash,
        cachedAt: new Date().toISOString(),
        completedAt: result.status === "completed" ? new Date().toISOString() : undefined,
        failedAt: result.status === "failed" ? new Date().toISOString() : undefined,
        job: result.job ?? null,
        parse: result.parse,
        extract: result.extract,
        meta: result.meta,
        error: result.error,
        atlasInclusion,
      };
      await persistDrawingEvidence(projectId, documentId, resolved.doc.structuredData, completedCache).catch((error) => {
        request.log.warn({ err: error, documentId }, "Drawing evidence cache persist failed");
      });
      if (result.status !== "completed") {
        return reply.code(502).send({
          success: false,
          provider: result.provider,
          message: `${providerId} drawing extraction did not complete`,
          error: result.error ?? "unknown",
          documentId,
          fileName,
        });
      }
      return {
        success: true,
        skipped: false,
        cached: false,
        provider: result.provider,
        status: result.status,
        pending: false,
        documentId,
        fileName,
        atlasInclusion,
        job: result.job ?? null,
        parse: result.parse,
        extract: result.extract,
        meta: result.meta,
      };
    } catch (error) {
      request.log.warn({ err: error, documentId }, `${providerId} drawing extraction failed`);
      return reply.code(502).send({
        success: false,
        provider: providerId,
        message: `${providerId} drawing extraction failed`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  app.post("/api/vision/drawing-extraction-summary", drawingExtractionHandler);
  // Legacy alias — keep working for any callers already wired to the LandingAI-named route.
  app.post("/api/vision/landingai-drawing-summary", drawingExtractionHandler);

  // ── POST /api/vision/render-page ───────────────────────────────────────
  // Renders a full PDF page (or a region of it) to a PNG image.
  // Returns base64 data URL. This is how the agent "sees" the drawing.
  // Body: { projectId, documentId, pageNumber, dpi?, region? }
  app.post("/api/vision/render-page", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = body.projectId as string;
    const documentId = body.documentId as string;
    if (!projectId || !documentId) return reply.code(400).send({ message: "projectId and documentId required" });

    const resolved = await resolveDocPdf(request.store!, projectId, documentId);
    if ("error" in resolved) return reply.code(resolved.status).send({ message: resolved.error });

    let renderPdfPage: typeof import("@bidwright/vision")["renderPdfPage"];
    try {
      const vision = await import("@bidwright/vision");
      renderPdfPage = vision.renderPdfPage;
    } catch (err) {
      return reply.code(500).send({ message: "Vision package not available", error: String(err) });
    }

    const result = await renderPdfPage({
      pdfPath: resolved.absPath,
      pageNumber: (body.pageNumber as number) ?? 1,
      dpi: (body.dpi as number) ?? 150,
      region: body.region as any ?? undefined,
    });
    await repairStoredNativePdfPageCount(resolved.doc, result.pageCount);

    if (!result.success) {
      const status = result.code === "page_out_of_range" ? 400 : 500;
      return reply.code(status).send({
        success: false,
        message: result.error,
        error: result.error,
        code: result.code,
        requestedPage: result.requestedPage,
        pageCount: result.pageCount,
        documentId,
        fileName: resolved.doc.fileName,
      });
    }
    return result;
  });

  // ── POST /api/vision/count-symbols ─────────────────────────────────────
  // Runs the NEW optimized OpenCV symbol matching pipeline on a PDF page.
  // Body: {
  //   projectId, documentId, pageNumber (1-based),
  //   boundingBox: { x, y, width, height, imageWidth, imageHeight },
  //   threshold?: number
  // }
  app.post("/api/vision/count-symbols", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = body.projectId as string;
    const documentId = body.documentId as string;
    const pageNumber = (body.pageNumber as number) ?? 1;
    const boundingBox = body.boundingBox as Record<string, number> | undefined;
    const threshold = (body.threshold as number) ?? 0.75;
    const crossScale = (body.crossScale as boolean) ?? false;

    if (!projectId || !documentId) {
      return reply.code(400).send({ message: "projectId and documentId are required" });
    }

    const resolved = await resolveDocPdf(request.store!, projectId, documentId);
    if ("error" in resolved) return reply.code(resolved.status).send({ message: resolved.error });

    let runCountSymbols: typeof import("@bidwright/vision")["runCountSymbols"];
    try {
      const vision = await import("@bidwright/vision");
      runCountSymbols = vision.runCountSymbols;
    } catch (err) {
      return reply.code(500).send({
        message: "Vision package not available",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const result = await runCountSymbols({
        pdfPath: resolved.absPath,
        pageNumber,
        crossScale,
        boundingBox: boundingBox ? {
          x: boundingBox.x ?? 0,
          y: boundingBox.y ?? 0,
          width: boundingBox.width ?? 0,
          height: boundingBox.height ?? 0,
          imageWidth: boundingBox.imageWidth ?? 0,
          imageHeight: boundingBox.imageHeight ?? 0,
        } : undefined,
        threshold,
        documentId,
      });

      return {
        success: true,
        documentId,
        pageNumber,
        totalCount: result.totalCount,
        matches: result.matches,
        snippetImage: result.snippetImage,
        imageWidth: result.imageWidth,
        imageHeight: result.imageHeight,
        duration_ms: result.duration_ms,
        errors: result.errors,
      };
    } catch (err) {
      return reply.code(500).send({
        message: "Vision processing failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── POST /api/vision/count-symbols-all-pages ──────────────────────────
  // Runs count_symbols on EVERY page of a document with the same template bbox.
  // Body: { projectId, documentId, boundingBox, threshold?, crossScale? }
  // Returns: { pages: [{ pageNumber, matches, totalCount }], grandTotal }
  app.post("/api/vision/count-symbols-all-pages", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = body.projectId as string;
    const documentId = body.documentId as string;
    const boundingBox = body.boundingBox as Record<string, number> | undefined;
    const threshold = (body.threshold as number) ?? 0.75;
    const crossScale = (body.crossScale as boolean) ?? false;

    if (!projectId || !documentId || !boundingBox) {
      return reply.code(400).send({ message: "projectId, documentId, and boundingBox are required" });
    }

    const resolved = await resolveDocPdf(request.store!, projectId, documentId);
    if ("error" in resolved) return reply.code(resolved.status).send({ message: resolved.error });

    let runCountSymbols: typeof import("@bidwright/vision")["runCountSymbols"];
    let renderPdfPage: typeof import("@bidwright/vision")["renderPdfPage"];
    try {
      const vision = await import("@bidwright/vision");
      runCountSymbols = vision.runCountSymbols;
      renderPdfPage = vision.renderPdfPage;
    } catch (err) {
      return reply.code(500).send({
        message: "Vision package not available",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Get page count by rendering page 1 (returns pageCount in result)
    const probe = await renderPdfPage({ pdfPath: resolved.absPath, pageNumber: 1, dpi: 72 });
    if (!probe.success || !probe.pageCount) {
      return reply.code(500).send({ message: "Could not determine page count", error: probe.error });
    }

    const bbox = {
      x: boundingBox.x ?? 0,
      y: boundingBox.y ?? 0,
      width: boundingBox.width ?? 0,
      height: boundingBox.height ?? 0,
      imageWidth: boundingBox.imageWidth ?? 0,
      imageHeight: boundingBox.imageHeight ?? 0,
    };

    const pages: { pageNumber: number; matches: any[]; totalCount: number; errors: string[] }[] = [];
    let grandTotal = 0;

    // Run count on each page sequentially to avoid overwhelming the system
    for (let pg = 1; pg <= probe.pageCount; pg++) {
      try {
        const result = await runCountSymbols({
          pdfPath: resolved.absPath,
          pageNumber: pg,
          boundingBox: bbox,
          threshold,
          crossScale,
          documentId,
        });
        pages.push({
          pageNumber: pg,
          matches: result.matches,
          totalCount: result.totalCount,
          errors: result.errors,
        });
        grandTotal += result.totalCount;
      } catch (err) {
        pages.push({
          pageNumber: pg,
          matches: [],
          totalCount: 0,
          errors: [err instanceof Error ? err.message : String(err)],
        });
      }
    }

    return { success: true, documentId, pages, grandTotal, pageCount: probe.pageCount };
  });

  // ── POST /api/vision/find-symbols ─────────────────────────────────────
  // Discover symbol candidates on a page using connected component analysis.
  // Body: { projectId, documentId, pageNumber?, minSize?, maxSize? }
  // Returns: { candidates: [{x, y, w, h, area, aspect}], total, imageWidth, imageHeight }
  app.post("/api/vision/find-symbols", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = body.projectId as string;
    const documentId = body.documentId as string;
    const pageNumber = (body.pageNumber as number) ?? 1;
    const minSize = body.minSize as number | undefined;
    const maxSize = body.maxSize as number | undefined;

    if (!projectId || !documentId) {
      return reply.code(400).send({ message: "projectId and documentId are required" });
    }

    const resolved = await resolveDocPdf(request.store!, projectId, documentId);
    if ("error" in resolved) return reply.code(resolved.status).send({ message: resolved.error });

    let runFindSymbols: typeof import("@bidwright/vision")["runFindSymbols"];
    try {
      const vision = await import("@bidwright/vision");
      runFindSymbols = vision.runFindSymbols;
    } catch (err) {
      return reply.code(500).send({
        message: "Vision package not available",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const result = await runFindSymbols({
        pdfPath: resolved.absPath,
        pageNumber,
        minSize,
        maxSize,
      });

      if (result.error) {
        return reply.code(500).send({ message: result.error });
      }

      return {
        success: true,
        candidates: result.candidates,
        total: result.total,
        imageWidth: result.imageWidth,
        imageHeight: result.imageHeight,
        duration_ms: result.duration_ms,
      };
    } catch (err) {
      return reply.code(500).send({
        message: "Find symbols failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── POST /api/vision/analyze-geometry ────────────────────────────────────
  // Generic OpenCV drawing intelligence pass. Detects linework, circles,
  // symbol candidates, text regions, and optional connected linear systems.
  // Body: { projectId, documentId, pageNumber?, preset?, traceSystems?, ... }
  app.post("/api/vision/analyze-geometry", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = body.projectId as string;
    const documentId = body.documentId as string;
    const pageNumber = (body.pageNumber as number) ?? 1;

    if (!projectId || !documentId) {
      return reply.code(400).send({ message: "projectId and documentId are required" });
    }

    const resolved = await resolveDocPdf(request.store!, projectId, documentId);
    if ("error" in resolved) return reply.code(resolved.status).send({ message: resolved.error });

    let runAnalyzeDrawingGeometry: typeof import("@bidwright/vision")["runAnalyzeDrawingGeometry"];
    try {
      const vision = await import("@bidwright/vision");
      runAnalyzeDrawingGeometry = vision.runAnalyzeDrawingGeometry;
    } catch (err) {
      return reply.code(500).send({
        message: "Vision package not available",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const parameters = {
        pageNumber,
        dpi: (body.dpi as number) ?? 150,
        preset: String(body.preset ?? "generic"),
        geometrySource: normalizeDrawingGeometrySource(body.geometrySource),
        includeSymbols: body.includeSymbols !== false,
        includeTextRegions: body.includeTextRegions !== false,
        includeCircles: body.includeCircles !== false,
        traceSystems: body.traceSystems !== false,
        minLineLength: typeof body.minLineLength === "number" ? body.minLineLength : undefined,
        snapTolerance: typeof body.snapTolerance === "number" ? body.snapTolerance : undefined,
        maxLines: typeof body.maxLines === "number" ? body.maxLines : undefined,
        maxRegions: typeof body.maxRegions === "number" ? body.maxRegions : undefined,
        lineSensitivity: typeof body.lineSensitivity === "number" ? body.lineSensitivity : undefined,
        noiseRejection: typeof body.noiseRejection === "number" ? body.noiseRejection : undefined,
      };
      const result = await runAnalyzeDrawingGeometry({
        pdfPath: resolved.absPath,
        ...parameters,
      });

      if (!result.success) {
        return reply.code(500).send({ ...result, success: false, message: result.error ?? "Geometry analysis failed" });
      }
      const analysisId = body.persist === false
        ? undefined
        : await recordDrawingAnalysisRun(projectId, resolved.doc, result, parameters, "analyzeDrawingGeometry");

      return {
        ...result,
        success: true,
        analysisId,
        projectId,
        documentId,
        fileName: resolved.doc.fileName,
        pageNumber,
      };
    } catch (err) {
      return reply.code(500).send({
        message: "Geometry analysis failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── POST /api/vision/trace-systems ────────────────────────────────────────
  // Convenience route for linear-system tracing presets. Uses the same engine
  // as analyze-geometry but returns the topology-focused subset first.
  app.post("/api/vision/trace-systems", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = body.projectId as string;
    const documentId = body.documentId as string;
    const pageNumber = (body.pageNumber as number) ?? 1;
    if (!projectId || !documentId) {
      return reply.code(400).send({ message: "projectId and documentId are required" });
    }
    const resolved = await resolveDocPdf(request.store!, projectId, documentId);
    if ("error" in resolved) return reply.code(resolved.status).send({ message: resolved.error });

    let runAnalyzeDrawingGeometry: typeof import("@bidwright/vision")["runAnalyzeDrawingGeometry"];
    try {
      const vision = await import("@bidwright/vision");
      runAnalyzeDrawingGeometry = vision.runAnalyzeDrawingGeometry;
    } catch (err) {
      return reply.code(500).send({
        message: "Vision package not available",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const parameters = {
        pageNumber,
        dpi: (body.dpi as number) ?? 150,
        preset: String(body.preset ?? "generic"),
        geometrySource: normalizeDrawingGeometrySource(body.geometrySource),
        includeSymbols: body.includeSymbols === true,
        includeTextRegions: body.includeTextRegions === true,
        includeCircles: body.includeCircles === true,
        traceSystems: true,
        minLineLength: typeof body.minLineLength === "number" ? body.minLineLength : undefined,
        snapTolerance: typeof body.snapTolerance === "number" ? body.snapTolerance : undefined,
        maxLines: typeof body.maxLines === "number" ? body.maxLines : undefined,
        maxRegions: typeof body.maxRegions === "number" ? body.maxRegions : undefined,
        lineSensitivity: typeof body.lineSensitivity === "number" ? body.lineSensitivity : undefined,
        noiseRejection: typeof body.noiseRejection === "number" ? body.noiseRejection : undefined,
      };
      const result = await runAnalyzeDrawingGeometry({
        pdfPath: resolved.absPath,
        ...parameters,
      });
      if (!result.success) {
        return reply.code(500).send({ ...result, success: false, message: result.error ?? "Trace systems failed" });
      }
      const analysisId = body.persist === false
        ? undefined
        : await recordDrawingAnalysisRun(projectId, resolved.doc, result, parameters, "traceDrawingSystems");
      return {
        ...result,
        success: true,
        analysisId,
        projectId,
        documentId,
        fileName: resolved.doc.fileName,
        pageNumber,
      };
    } catch (err) {
      return reply.code(500).send({
        message: "Trace systems failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── POST /api/vision/analyze-cad-geometry ─────────────────────────────
  // Native CAD drawing intelligence for DXF/DWG files. Uses the existing
  // DWG processing service for direct DXF parsing and optional DWG->DXF
  // conversion, then normalizes entities into the same broad geometry schema.
  app.post("/api/vision/analyze-cad-geometry", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = String(body.projectId ?? "");
    const documentId = String(body.documentId ?? "");
    const sourceKind = body.sourceKind === "file_node" ? "file_node" as const : "source_document" as const;
    const preset = String(body.preset ?? "generic");
    const traceSystems = body.traceSystems !== false;
    const rawMaxEntities = Number(body.maxEntities ?? body.maxLines ?? 0);
    const maxEntities = Number.isFinite(rawMaxEntities) && rawMaxEntities > 0
      ? Math.max(50, Math.min(50000, rawMaxEntities))
      : 0;
    if (!projectId || !documentId) {
      return reply.code(400).send({ message: "projectId and documentId are required" });
    }

    try {
      const started = Date.now();
      const cad = await getDwgProcessingResult(projectId, documentId, {
        refresh: body.refresh === true,
        sourceKind,
      });
      const result = buildCadDrawingAnalysis(cad, preset, traceSystems, maxEntities);
      result.duration_ms = Date.now() - started;
      const parameters = {
        sourceKind,
        preset,
        traceSystems,
        maxEntities,
        refresh: body.refresh === true,
      };
      const doc = body.persist === false ? null : await resolveAnalysisDocForCad(projectId, documentId, sourceKind).catch(() => null);
      const analysisId = doc
        ? await recordDrawingAnalysisRun(projectId, doc, result, parameters, "analyzeCadGeometry")
        : undefined;
      return {
        ...result,
        success: true,
        analysisId,
        projectId,
        documentId,
        fileName: cad.fileName,
      };
    } catch (err) {
      const statusCode = typeof (err as { statusCode?: unknown }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : 500;
      return reply.code(statusCode).send({
        success: false,
        message: "CAD geometry analysis failed",
        error: err instanceof Error ? err.message : String(err),
        result: (err as { result?: unknown }).result,
      });
    }
  });

  // ── POST /api/vision/save-detections-as-annotations ──────────────────────
  // Persist reviewed geometry/system detections as normal TakeoffAnnotation
  // rows so the rest of Bidwright can link, price, and audit them.
  app.post("/api/vision/save-detections-as-annotations", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = String(body.projectId ?? "");
    const documentId = String(body.documentId ?? "");
    const pageNumber = Number(body.pageNumber ?? 1);
    const imageWidth = Number(body.imageWidth ?? 0);
    const imageHeight = Number(body.imageHeight ?? 0);
    const defaultGroupName = String(body.groupName ?? "Drawing Intelligence");
    const detections = Array.isArray(body.detections) ? body.detections as Record<string, unknown>[] : [];
    const firstDetectionMetadata = asRecord(asRecord(detections[0] ?? {}).metadata);
    const analysisId = String(body.analysisId ?? firstDetectionMetadata.analysisId ?? "");

    if (!projectId || !documentId) {
      return reply.code(400).send({ message: "projectId and documentId are required" });
    }
    if (detections.length === 0) {
      return { success: true, savedCount: 0, annotations: [], errors: [] };
    }

    const annotations: unknown[] = [];
    const errors: string[] = [];
    const resolvedForRun = analysisId ? await resolveDocPdf(request.store!, projectId, documentId).catch(() => null) : null;

    for (const [index, detection] of detections.entries()) {
      try {
        const points = normalizeDetectionPoints(detection);
        if (points.length === 0) {
          errors.push(`Detection ${index + 1} has no valid points.`);
          continue;
        }
        const annotationType = String(
          detection.annotationType ??
            (points.length === 1 ? "count" : points.length > 2 ? "linear-polyline" : "linear"),
        );
        const measurement = normalizeDetectionMeasurement(detection, annotationType, points);
        const label = String(detection.label ?? detection.id ?? `Detection ${index + 1}`);
        const metadata = sanitizeJsonForPostgres({
          ...(asRecord(detection.metadata)),
          analysisId: analysisId || undefined,
          canvasWidth: imageWidth || undefined,
          canvasHeight: imageHeight || undefined,
          detectionId: detection.id,
          detectionKind: detection.kind,
          detectionSource: detection.source,
          confidence: detection.confidence,
          createdBy: "drawing-intelligence",
        });

        const annotation = await request.store!.createTakeoffAnnotation(projectId, {
          documentId,
          pageNumber,
          annotationType,
          label,
          color: String(detection.color ?? body.color ?? "#0ea5e9"),
          lineThickness: Number(detection.lineThickness ?? 3),
          visible: detection.visible !== false,
          groupName: String(detection.groupName ?? defaultGroupName),
          points,
          measurement,
          metadata,
          createdBy: "drawing-intelligence",
        } as any);
        annotations.push(annotation);
      } catch (err) {
        errors.push(`Detection ${index + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (analysisId && resolvedForRun && !("error" in resolvedForRun)) {
      const ids = annotations.map((annotation: any) => String(annotation?.id ?? "")).filter(Boolean);
      await updateDrawingAnalysisAcceptance(projectId, resolvedForRun.doc, analysisId, ids);
    }

    return {
      success: errors.length === 0,
      savedCount: annotations.length,
      annotations,
      errors,
    };
  });

  // ── POST /api/vision/list-analyses ──────────────────────────────────────
  // Lists previous drawing-intelligence runs persisted against the document.
  app.post("/api/vision/list-analyses", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = String(body.projectId ?? "");
    const documentId = String(body.documentId ?? "");
    const pageNumber = body.pageNumber === undefined ? undefined : Number(body.pageNumber);
    const includeDetections = body.includeDetections === true;
    if (!projectId || !documentId) {
      return reply.code(400).send({ message: "projectId and documentId are required" });
    }
    const resolved = await resolveDocPdf(request.store!, projectId, documentId);
    if ("error" in resolved) return reply.code(resolved.status).send({ message: resolved.error });

    const runs = currentAnalysisRuns(resolved.doc)
      .filter((run) => pageNumber === undefined || Number(run.pageNumber) === pageNumber)
      .map((run) => includeDetections ? run : {
        id: run.id,
        status: run.status,
        tool: run.tool,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        documentId,
        fileName: resolved.doc.fileName,
        pageNumber: run.pageNumber,
        preset: run.preset,
        parameters: run.parameters,
        imageWidth: run.imageWidth,
        imageHeight: run.imageHeight,
        scaleMetadata: run.scaleMetadata,
        summary: run.summary,
        warnings: run.warnings,
        acceptedCount: Number(run.acceptedCount ?? 0),
        rejectedCount: Number(run.rejectedCount ?? 0),
        savedAnnotationIds: Array.isArray(run.savedAnnotationIds) ? run.savedAnnotationIds : [],
      });

    return { success: true, documentId, fileName: resolved.doc.fileName, count: runs.length, analyses: runs };
  });

  // ── POST /api/vision/compare-analysis-to-takeoff ───────────────────────
  // Compares a stored detection run against saved annotations and estimate links.
  app.post("/api/vision/compare-analysis-to-takeoff", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = String(body.projectId ?? "");
    const documentId = String(body.documentId ?? "");
    const analysisId = body.analysisId === undefined ? undefined : String(body.analysisId);
    const pageNumber = body.pageNumber === undefined ? undefined : Number(body.pageNumber);
    const limit = Math.max(1, Math.min(500, Number(body.limit ?? 120)));
    if (!projectId || !documentId) {
      return reply.code(400).send({ message: "projectId and documentId are required" });
    }
    const resolved = await resolveDocPdf(request.store!, projectId, documentId);
    if ("error" in resolved) return reply.code(resolved.status).send({ message: resolved.error });
    const run = findAnalysisRun(resolved.doc, analysisId, pageNumber);
    if (!run) {
      return {
        success: true,
        documentId,
        analysisId: analysisId ?? null,
        found: false,
        message: "No stored drawing analysis matched the request.",
        detectedCount: 0,
        savedCount: 0,
        linkedCount: 0,
        unsavedDetections: [],
        savedButUnlinked: [],
      };
    }

    const annotations = await request.store!.listTakeoffAnnotations(projectId, documentId, Number(run.pageNumber)).catch(() => []);
    const links = await request.store!.listTakeoffLinks(projectId).catch(() => []);
    const linkedAnnotationIds = new Set((Array.isArray(links) ? links : []).map((link: any) => String(link.annotationId)));
    const annotationByDetectionId = new Map<string, any>();
    for (const annotation of annotations as any[]) {
      const metadata = asRecord(annotation?.metadata);
      if (String(metadata.analysisId ?? "") !== String(run.id)) continue;
      const detectionId = String(metadata.detectionId ?? "");
      if (detectionId) annotationByDetectionId.set(detectionId, annotation);
    }

    const refs = detectionRefsFromRun(run);
    const saved = refs.filter((ref) => annotationByDetectionId.has(String(ref.id)));
    const unsaved = refs.filter((ref) => !annotationByDetectionId.has(String(ref.id)));
    const savedButUnlinked = saved
      .map((ref) => {
        const annotation = annotationByDetectionId.get(String(ref.id));
        return { detection: ref, annotationId: annotation?.id, label: annotation?.label };
      })
      .filter((entry) => entry.annotationId && !linkedAnnotationIds.has(String(entry.annotationId)));

    return {
      success: true,
      found: true,
      documentId,
      fileName: resolved.doc.fileName,
      analysisId: run.id,
      pageNumber: run.pageNumber,
      preset: run.preset,
      summary: run.summary,
      detectedCount: refs.length,
      savedCount: saved.length,
      linkedCount: saved.length - savedButUnlinked.length,
      unsavedCount: unsaved.length,
      savedButUnlinkedCount: savedButUnlinked.length,
      unsavedDetections: unsaved.slice(0, limit),
      savedButUnlinked: savedButUnlinked.slice(0, limit),
      note: "Unsaved detections are not yet takeoff annotations. Saved-but-unlinked annotations exist on the drawing but have no worksheet takeoff link.",
    };
  });

  // ── POST /api/vision/crop-region ───────────────────────────────────────
  // Extracts a cropped image from a PDF page region.
  // Returns the image as a base64 data URL.
  // Used by the agent and UI to get a template image from a selection.
  app.post("/api/vision/crop-region", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = body.projectId as string;
    const documentId = body.documentId as string;
    const pageNumber = (body.pageNumber as number) ?? 1;
    const boundingBox = body.boundingBox as Record<string, number> | undefined;

    if (!projectId || !documentId || !boundingBox) {
      return reply.code(400).send({ message: "projectId, documentId, and boundingBox are required" });
    }

    const resolved = await resolveDocPdf(request.store!, projectId, documentId);
    if ("error" in resolved) return reply.code(resolved.status).send({ message: resolved.error });

    // Use the render pipeline to crop the region directly
    let renderPdfPage: typeof import("@bidwright/vision")["renderPdfPage"];
    try {
      const vision = await import("@bidwright/vision");
      renderPdfPage = vision.renderPdfPage;
    } catch {
      return reply.code(500).send({ message: "Vision package not available" });
    }

    try {
      const result = await renderPdfPage({
        pdfPath: resolved.absPath,
        pageNumber,
        dpi: 300,
        region: {
          x: boundingBox.x ?? 0,
          y: boundingBox.y ?? 0,
          width: boundingBox.width ?? 0,
          height: boundingBox.height ?? 0,
          imageWidth: boundingBox.imageWidth ?? 0,
          imageHeight: boundingBox.imageHeight ?? 0,
        },
      });

      return {
        success: result.success,
        image: result.image ?? null,
        duration_ms: result.duration_ms,
      };
    } catch (err) {
      return reply.code(500).send({
        message: "Crop failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── POST /api/vision/save-crop ────────────────────────────────────────
  // Saves a base64 crop image to the project directory so the CLI agent
  // can read and analyze it. Returns the absolute file path.
  // Body: { projectId, image (data URL), filename? }
  app.post("/api/vision/save-crop", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = body.projectId as string;
    const image = body.image as string;
    const filename = (body.filename as string) || `ask-ai-crop-${Date.now()}.png`;

    if (!projectId || !image) {
      return reply.code(400).send({ message: "projectId and image are required" });
    }

    const { resolveProjectDir } = await import("../paths.js");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const projectDir = resolveProjectDir(projectId);
    const cropsDir = join(projectDir, ".bidwright", "crops");
    await mkdir(cropsDir, { recursive: true });

    // Strip data URL prefix
    const base64 = image.replace(/^data:image\/\w+;base64,/, "");
    const filePath = join(cropsDir, filename);
    await writeFile(filePath, Buffer.from(base64, "base64"));

    return { success: true, filePath, filename };
  });

  // ── POST /api/vision/scan-drawing ──────────────────────────────────────
  // Proactively scans an entire drawing page: finds all symbol candidates,
  // clusters them by visual similarity, and auto-counts each cluster.
  // Returns a structured symbol inventory the agent can interpret directly.
  // Body: { projectId, documentId, pageNumber? }
  app.post("/api/vision/scan-drawing", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = body.projectId as string;
    const documentId = body.documentId as string;
    const pageNumber = (body.pageNumber as number) ?? 1;

    if (!projectId || !documentId) {
      return reply.code(400).send({ message: "projectId and documentId are required" });
    }

    const resolved = await resolveDocPdf(request.store!, projectId, documentId);
    if ("error" in resolved) return reply.code(resolved.status).send({ message: resolved.error });

    let runScanDrawing: typeof import("@bidwright/vision")["runScanDrawing"];
    try {
      const vision = await import("@bidwright/vision");
      runScanDrawing = vision.runScanDrawing;
    } catch (err) {
      return reply.code(500).send({
        message: "Vision package not available",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const result = await runScanDrawing({
        pdfPath: resolved.absPath,
        pageNumber,
      });

      if (result.error) {
        return reply.code(500).send({ message: result.error });
      }

      return {
        success: true,
        documentId,
        pageNumber,
        clusters: result.clusters,
        imageWidth: result.imageWidth,
        imageHeight: result.imageHeight,
        totalClusters: result.totalClusters,
        totalSymbolsFound: result.totalSymbolsFound,
        scanDuration_ms: result.scanDuration_ms,
      };
    } catch (err) {
      return reply.code(500).send({
        message: "Scan failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
