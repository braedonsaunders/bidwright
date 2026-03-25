import type { FastifyInstance } from "fastify";
import { resolveApiPath } from "../paths.js";
import { access } from "node:fs/promises";

/** Helper: resolve a document's absolute PDF path from its storagePath. */
async function resolveDocPdf(store: any, projectId: string, documentId: string): Promise<{ absPath: string; doc: any } | { error: string; status: number }> {
  const doc = await store.getDocument(projectId, documentId);
  if (!doc) return { error: "Document not found", status: 404 };
  if (!doc.storagePath) return { error: "Document has no file on disk", status: 400 };
  const absPath = resolveApiPath(doc.storagePath);
  try { await access(absPath); } catch { return { error: `PDF not on disk: ${doc.storagePath}`, status: 404 }; }
  return { absPath, doc };
}

/**
 * Vision API routes – PDF rendering, region cropping, and the OpenCV
 * symbol-matching pipeline. Used by the takeoff UI and the AI agent.
 */
export async function visionRoutes(app: FastifyInstance) {

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

    if (!result.success) return reply.code(500).send({ message: result.error });
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
