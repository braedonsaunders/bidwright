import type { FastifyInstance } from "fastify";
import { resolveApiPath } from "../paths.js";
import { access, readFile } from "node:fs/promises";
import { prisma } from "@bidwright/db";
import { emitSessionEvent, interruptAndResumeSession } from "../services/cli-runtime.js";

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
        return { absPath, doc: { id: node.id, fileName: node.name, storagePath: node.storagePath, source: "file_node" } };
      }
    }
  }

  if (typeof store.getKnowledgeBook === "function") {
    const book = await store.getKnowledgeBook(documentId);
    if (book?.storagePath && (!book.projectId || book.projectId === projectId)) {
      const absPath = resolveApiPath(book.storagePath);
      try { await access(absPath); } catch { return { error: `PDF not on disk: ${book.storagePath}`, status: 404 }; }
      return { absPath, doc: { id: book.id, fileName: book.sourceFileName ?? book.name, storagePath: book.storagePath, source: "knowledge_book" } };
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
  return { value: Math.round(length * 100) / 100, length: Math.round(length * 100) / 100, unit: "px" };
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
  // Body: { projectId, documentId, boundingBox, threshold? }
  // Returns: { pages: [{ pageNumber, matches, totalCount }], grandTotal }
  app.post("/api/vision/count-symbols-all-pages", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = body.projectId as string;
    const documentId = body.documentId as string;
    const boundingBox = body.boundingBox as Record<string, number> | undefined;
    const threshold = (body.threshold as number) ?? 0.75;

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
      const result = await runAnalyzeDrawingGeometry({
        pdfPath: resolved.absPath,
        pageNumber,
        dpi: (body.dpi as number) ?? 150,
        preset: String(body.preset ?? "generic"),
        includeSymbols: body.includeSymbols !== false,
        includeTextRegions: body.includeTextRegions !== false,
        includeCircles: body.includeCircles !== false,
        traceSystems: body.traceSystems !== false,
        minLineLength: typeof body.minLineLength === "number" ? body.minLineLength : undefined,
        snapTolerance: typeof body.snapTolerance === "number" ? body.snapTolerance : undefined,
        maxLines: typeof body.maxLines === "number" ? body.maxLines : undefined,
        maxRegions: typeof body.maxRegions === "number" ? body.maxRegions : undefined,
      });

      if (!result.success) {
        return reply.code(500).send({ ...result, success: false, message: result.error ?? "Geometry analysis failed" });
      }

      return {
        ...result,
        success: true,
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
      const result = await runAnalyzeDrawingGeometry({
        pdfPath: resolved.absPath,
        pageNumber,
        dpi: (body.dpi as number) ?? 150,
        preset: String(body.preset ?? "generic"),
        includeSymbols: body.includeSymbols === true,
        includeTextRegions: body.includeTextRegions === true,
        includeCircles: body.includeCircles === true,
        traceSystems: true,
        minLineLength: typeof body.minLineLength === "number" ? body.minLineLength : undefined,
        snapTolerance: typeof body.snapTolerance === "number" ? body.snapTolerance : undefined,
        maxLines: typeof body.maxLines === "number" ? body.maxLines : undefined,
        maxRegions: typeof body.maxRegions === "number" ? body.maxRegions : undefined,
      });
      if (!result.success) {
        return reply.code(500).send({ ...result, success: false, message: result.error ?? "Trace systems failed" });
      }
      return {
        ...result,
        success: true,
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

    if (!projectId || !documentId) {
      return reply.code(400).send({ message: "projectId and documentId are required" });
    }
    if (detections.length === 0) {
      return { success: true, savedCount: 0, annotations: [], errors: [] };
    }

    const annotations: unknown[] = [];
    const errors: string[] = [];

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

    return {
      success: errors.length === 0,
      savedCount: annotations.length,
      annotations,
      errors,
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

    const doc = await request.store!.getDocument(projectId, documentId);
    if (!doc) {
      return reply.code(404).send({ message: "Document not found" });
    }

    if (!doc.storagePath) {
      return reply.code(400).send({ message: "Document has no file on disk" });
    }

    const absPath = resolveApiPath(doc.storagePath);
    try {
      await access(absPath);
    } catch {
      return reply.code(404).send({ message: "PDF file not found on disk" });
    }

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
        pdfPath: absPath,
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
