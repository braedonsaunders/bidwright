// Symbol Library service — orchestrates the few-shot legend-to-template
// pipeline. Bridges three subsystems:
//
//   1. symbol-legend-service (Azure DI extraction with cell bboxes)
//   2. @bidwright/vision (PDF rendering + OpenCV template matching)
//   3. prisma-store (SymbolTemplate CRUD, Pickup persistence)
//
// The PNG bytes for each template live on disk under
//   <apiDataRoot>/projects/<projectId>/symbol-templates/<templateId>.png
// and the relative path is stored in DB. The on-disk file is the source of
// truth for the matcher; the DB row is metadata + config.

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SymbolTemplate } from "@bidwright/domain";
import { renderPdfPage, runCountLibrary } from "@bidwright/vision";

import { resolveApiPath } from "../paths.js";
import { createId } from "../calc-utils.js";
import type { PrismaApiStore, SymbolTemplatePatchInput } from "../prisma-store.js";
import type { LegendCellBbox, LegendEntry } from "./symbol-legend-service.js";
import { bboxInchesToPaddedPixels } from "./symbol-template-coords.js";

export { bboxInchesToPaddedPixels } from "./symbol-template-coords.js";

/** Default render DPI for templates and target pages. Validated by the
 *  count_symbols autoresearch — single-scale TM_CCOEFF_NORMED is optimal at
 *  this resolution across construction packages. Override only if you also
 *  re-crop templates at the new DPI; mixing template DPIs and target DPIs
 *  breaks scale-sensitive template matching unless crossScale is on. */
const DEFAULT_RENDER_DPI = 150;

export interface ResolvedDocument {
  absPath: string;
  storagePath: string;
  fileName: string;
}

/**
 * Resolve a document id (SourceDocument or KnowledgeBook) to an absolute
 * PDF path on disk. Mirrors the precedence used by vision-routes
 * `resolveDocPdf` — kept here so the service is independent of routes.
 */
async function resolveDocumentPdf(
  store: PrismaApiStore,
  projectId: string,
  documentId: string,
): Promise<ResolvedDocument | { error: string; status: number }> {
  const doc = await store.getDocument(projectId, documentId).catch(() => null);
  if (doc?.storagePath) {
    return { absPath: resolveApiPath(doc.storagePath), storagePath: doc.storagePath, fileName: doc.fileName };
  }
  if (typeof store.getKnowledgeBook === "function") {
    const book = await store.getKnowledgeBook(documentId).catch(() => null);
    if (book?.storagePath && (!book.projectId || book.projectId === projectId)) {
      return {
        absPath: resolveApiPath(book.storagePath),
        storagePath: book.storagePath,
        fileName: book.sourceFileName ?? book.name ?? "drawing.pdf",
      };
    }
  }
  return { error: "Document not found", status: 404 };
}

function templateStorageRelativePath(projectId: string, templateId: string): string {
  return path.join("projects", projectId, "symbol-templates", `${templateId}.png`);
}

export interface CreateTemplateFromLegendInput {
  /** ID of the SourceDocument or KnowledgeBook the legend was extracted from. */
  documentId: string;
  /** 1-based page number of the legend within the source document. */
  pageNumber: number;
  /** The legend entry as returned by extractLegendFromPage. Must include
   *  symbolBbox — entries without bboxes (text-fallback path) cannot be
   *  promoted to templates until the user draws one manually. */
  entry: LegendEntry;
  /** Whose action this is, for audit. */
  createdBy?: string;
  /** Per-template defaults. Defaults to (0.75, false). */
  threshold?: number;
  crossScale?: boolean;
  /** Optional override of the rendering DPI. Most callers should not set
   *  this — the value must match the run-time render DPI. */
  dpi?: number;
}

export async function createTemplateFromLegendEntry(
  store: PrismaApiStore,
  projectId: string,
  input: CreateTemplateFromLegendInput,
): Promise<SymbolTemplate> {
  if (!input.entry.symbolBbox) {
    throw new Error("Legend entry has no symbolBbox; cannot crop a template");
  }
  if (input.threshold !== undefined) {
    if (input.threshold < 0.3 || input.threshold > 0.95) {
      throw new Error("threshold must be between 0.3 and 0.95");
    }
  }

  const resolved = await resolveDocumentPdf(store, projectId, input.documentId);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }

  const dpi = input.dpi ?? DEFAULT_RENDER_DPI;

  // First call: render the whole page so we know its pixel dimensions and
  // can lay out the bbox padding without crossing the page edge. We could
  // skip this if Azure gave us page width/height, but the parser doesn't
  // currently surface them past `ExtractedPage.content`.
  const probe = await renderPdfPage({
    pdfPath: resolved.absPath,
    pageNumber: input.pageNumber,
    dpi,
  });
  if (!probe.success || !probe.pageWidth || !probe.pageHeight) {
    throw new Error(probe.error ?? "Failed to render legend page");
  }

  const { xPx, yPx, wPx, hPx, imageWidth, imageHeight } = bboxInchesToPaddedPixels(
    input.entry.symbolBbox,
    probe.pageWidth / 72, // PDF points → inches
    probe.pageHeight / 72,
    dpi,
  );
  if (wPx < 5 || hPx < 5) {
    throw new Error(`Cropped bbox is too small (${wPx}x${hPx}px); the OCR may have mis-tagged the cell`);
  }

  // Second call: render just the clipped region at the same DPI.
  const crop = await renderPdfPage({
    pdfPath: resolved.absPath,
    pageNumber: input.pageNumber,
    dpi,
    region: { x: xPx, y: yPx, width: wPx, height: hPx, imageWidth, imageHeight },
  });
  if (!crop.success || !crop.image) {
    throw new Error(crop.error ?? "Failed to render glyph region");
  }

  // Strip "data:image/png;base64," prefix and write the PNG to disk before
  // inserting the DB row so we never persist a row that points at a
  // missing file. Cleanup on insert failure happens in the catch block.
  const commaIdx = crop.image.indexOf(",");
  const pngBytes = Buffer.from(commaIdx > 0 ? crop.image.slice(commaIdx + 1) : crop.image, "base64");

  const templateId = createId("symtpl");
  const relativePath = templateStorageRelativePath(projectId, templateId);
  const absolutePath = resolveApiPath(relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, pngBytes);

  try {
    const row = await store.createSymbolTemplate(projectId, {
      id: templateId,
      symbol: input.entry.symbol,
      label: input.entry.label,
      storagePath: relativePath,
      width: crop.width ?? wPx,
      height: crop.height ?? hPx,
      dpi,
      sourceDocumentId: input.documentId,
      sourcePage: input.pageNumber,
      sourceBbox: {
        x: xPx,
        y: yPx,
        width: wPx,
        height: hPx,
        imageWidth,
        imageHeight,
      },
      threshold: input.threshold ?? 0.75,
      crossScale: input.crossScale ?? false,
      enabled: true,
      metadata: {
        legendConfidence: input.entry.confidence,
      },
      createdBy: input.createdBy,
    });
    return row;
  } catch (err) {
    // Roll back the on-disk PNG when the DB insert fails so we don't leak
    // orphaned files. The error is propagated to the caller.
    await rm(absolutePath, { force: true }).catch(() => {});
    throw err;
  }
}

export async function listSymbolTemplates(
  store: PrismaApiStore,
  projectId: string,
  opts?: { enabledOnly?: boolean },
): Promise<SymbolTemplate[]> {
  return store.listSymbolTemplates(projectId, opts);
}

export async function updateSymbolTemplate(
  store: PrismaApiStore,
  projectId: string,
  templateId: string,
  patch: SymbolTemplatePatchInput,
): Promise<SymbolTemplate> {
  return store.updateSymbolTemplate(projectId, templateId, patch);
}

export async function deleteSymbolTemplate(
  store: PrismaApiStore,
  projectId: string,
  templateId: string,
): Promise<{ deleted: true }> {
  const { storagePath } = await store.deleteSymbolTemplate(projectId, templateId);
  if (storagePath) {
    await rm(resolveApiPath(storagePath), { force: true }).catch(() => {});
  }
  return { deleted: true };
}

export interface RunLibraryOptions {
  /** Persist matches as Pickup rows (one per match per template). */
  autoSave?: boolean;
  /** Restrict to specific template ids; otherwise all enabled templates run. */
  templateIds?: string[];
  /** Whose action this is, attached to created annotations. */
  createdBy?: string;
}

export interface RunLibraryOnPageResult {
  documentId: string;
  pageNumber: number;
  imageWidth: number;
  imageHeight: number;
  dpi: number;
  duration_ms: number;
  templateResults: Array<{
    templateId: string;
    symbol: string;
    label: string;
    totalCount: number;
    matches: Array<{
      x: number;
      y: number;
      w: number;
      h: number;
      confidence: number;
      scale?: number;
    }>;
    error?: string;
    savedAnnotationIds?: string[];
  }>;
  errors: string[];
}

/**
 * Match every enabled template (or a caller-specified subset) against one
 * page of one document, optionally persisting matches as
 * Pickup rows. The render is shared across templates so the
 * incremental cost per extra template is just one cv2.matchTemplate pass.
 */
export async function runLibraryOnPage(
  store: PrismaApiStore,
  projectId: string,
  documentId: string,
  pageNumber: number,
  opts?: RunLibraryOptions,
): Promise<RunLibraryOnPageResult> {
  const allTemplates = await store.listSymbolTemplates(projectId, { enabledOnly: true });
  const idFilter = opts?.templateIds ? new Set(opts.templateIds) : null;
  const templates = idFilter
    ? allTemplates.filter((t) => idFilter.has(t.id))
    : allTemplates;

  if (templates.length === 0) {
    return {
      documentId,
      pageNumber,
      imageWidth: 0,
      imageHeight: 0,
      dpi: DEFAULT_RENDER_DPI,
      duration_ms: 0,
      templateResults: [],
      errors: ["No enabled templates in project library"],
    };
  }

  const resolved = await resolveDocumentPdf(store, projectId, documentId);
  if ("error" in resolved) {
    return {
      documentId,
      pageNumber,
      imageWidth: 0,
      imageHeight: 0,
      dpi: DEFAULT_RENDER_DPI,
      duration_ms: 0,
      templateResults: [],
      errors: [resolved.error],
    };
  }

  // All templates SHOULD share the same DPI (we render them at 150 by
  // default), but if a user manually changed one, we group by DPI to keep
  // the matcher honest. Within each group the render cost is amortised.
  const byDpi = new Map<number, SymbolTemplate[]>();
  for (const t of templates) {
    const list = byDpi.get(t.dpi) ?? [];
    list.push(t);
    byDpi.set(t.dpi, list);
  }

  const start = Date.now();
  const templateResults: RunLibraryOnPageResult["templateResults"] = [];
  let imageWidth = 0;
  let imageHeight = 0;
  let renderDpi = DEFAULT_RENDER_DPI;
  const errors: string[] = [];

  for (const [dpi, group] of byDpi.entries()) {
    const run = await runCountLibrary({
      pdfPath: resolved.absPath,
      pageNumber,
      dpi,
      templates: group.map((t) => ({
        id: t.id,
        imagePath: resolveApiPath(t.storagePath),
        threshold: t.threshold,
        crossScale: t.crossScale,
      })),
    });
    if (run.errors.length > 0) errors.push(...run.errors);
    if (run.imageWidth > imageWidth) imageWidth = run.imageWidth;
    if (run.imageHeight > imageHeight) imageHeight = run.imageHeight;
    renderDpi = run.dpi;

    const templatesById = new Map(group.map((t) => [t.id, t] as const));
    for (const result of run.results) {
      const tpl = templatesById.get(result.templateId);
      if (!tpl) continue;
      templateResults.push({
        templateId: tpl.id,
        symbol: tpl.symbol,
        label: tpl.label,
        totalCount: result.totalCount,
        matches: result.matches,
        error: result.error,
      });
    }
  }

  if (opts?.autoSave) {
    for (const tr of templateResults) {
      if (tr.error || tr.matches.length === 0) continue;
      const savedIds: string[] = [];
      for (const m of tr.matches) {
        try {
          const annotation = await store.createPickup(projectId, {
            documentId,
            pageNumber,
            annotationType: "count",
            label: tr.label || tr.symbol || "Library match",
            color: "#22c55e",
            lineThickness: 3,
            visible: true,
            groupName: tr.symbol || tr.label || "Library",
            points: [{ x: m.x + m.w / 2, y: m.y + m.h / 2 }],
            measurement: { value: 1, unit: "count" },
            metadata: {
              source: "symbol-library",
              templateId: tr.templateId,
              symbol: tr.symbol,
              rect: { x: m.x, y: m.y, width: m.w, height: m.h },
              confidence: m.confidence,
              scale: m.scale,
              imageWidth,
              imageHeight,
            },
            createdBy: opts.createdBy ?? "symbol-library",
          });
          savedIds.push(annotation.id);
        } catch (err) {
          errors.push(
            `Save annotation for ${tr.symbol || tr.templateId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      tr.savedAnnotationIds = savedIds;
    }

    await touchLibraryLastRun(store, projectId, templateResults);
  }

  return {
    documentId,
    pageNumber,
    imageWidth,
    imageHeight,
    dpi: renderDpi,
    duration_ms: Date.now() - start,
    templateResults,
    errors,
  };
}

export interface RunLibraryOnDocumentResult {
  documentId: string;
  pageCount: number;
  pages: RunLibraryOnPageResult[];
  /** Sum of totalCount across all pages and templates. */
  grandTotal: number;
  duration_ms: number;
}

/**
 * Match the project library against every page of a single document. Pages
 * run sequentially to avoid swamping the Python subprocess pool; each page
 * still benefits from the single-render-many-templates batching.
 */
export async function runLibraryOnDocument(
  store: PrismaApiStore,
  projectId: string,
  documentId: string,
  opts?: RunLibraryOptions,
): Promise<RunLibraryOnDocumentResult> {
  const resolved = await resolveDocumentPdf(store, projectId, documentId);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }

  // Probe page 1 at low DPI to retrieve the page count cheaply.
  const probe = await renderPdfPage({
    pdfPath: resolved.absPath,
    pageNumber: 1,
    dpi: 72,
  });
  if (!probe.success || !probe.pageCount || probe.pageCount < 1) {
    throw new Error(probe.error ?? "Could not determine page count");
  }
  const pageCount = probe.pageCount;

  const start = Date.now();
  const pages: RunLibraryOnPageResult[] = [];
  let grandTotal = 0;
  for (let pg = 1; pg <= pageCount; pg++) {
    const pageResult = await runLibraryOnPage(store, projectId, documentId, pg, opts);
    pages.push(pageResult);
    for (const tr of pageResult.templateResults) {
      grandTotal += tr.totalCount;
    }
  }

  return {
    documentId,
    pageCount,
    pages,
    grandTotal,
    duration_ms: Date.now() - start,
  };
}

/**
 * Update each template's `lastRun` metadata after a batch run. Best-effort:
 * a failure here doesn't bubble up because the matches are already saved.
 */
async function touchLibraryLastRun(
  store: PrismaApiStore,
  projectId: string,
  templateResults: RunLibraryOnPageResult["templateResults"],
) {
  const now = new Date().toISOString();
  await Promise.allSettled(
    templateResults.map(async (tr) => {
      try {
        const existing = await store.getSymbolTemplate(projectId, tr.templateId);
        if (!existing) return;
        const lastRun = {
          at: now,
          totalMatches: tr.totalCount,
          pagesSearched: 1,
        };
        await store.updateSymbolTemplate(projectId, tr.templateId, {
          metadata: { ...existing.metadata, lastRun },
        });
      } catch {
        // Swallow — observability is nice-to-have, not load-bearing.
      }
    }),
  );
}
