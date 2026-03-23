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
  // Runs the OpenCV symbol matching pipeline on a PDF page.
  // Body: {
  //   projectId, documentId, pageNumber (1-based),
  //   boundingBox: { x, y, width, height, imageWidth, imageHeight },
  //   threshold?: number, methods?: string[]
  // }
  app.post("/api/vision/count-symbols", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const projectId = body.projectId as string;
    const documentId = body.documentId as string;
    const pageNumber = (body.pageNumber as number) ?? 1;
    const boundingBox = body.boundingBox as Record<string, number> | undefined;
    const threshold = (body.threshold as number) ?? 0.65;
    const methods = (body.methods as string[]) ?? [];

    if (!projectId || !documentId) {
      return reply.code(400).send({ message: "projectId and documentId are required" });
    }

    // Resolve the PDF file path from the document's storagePath
    const doc = await request.store!.getDocument(projectId, documentId);
    if (!doc) {
      return reply.code(404).send({ message: "Document not found" });
    }

    if (!doc.storagePath) {
      return reply.code(400).send({ message: "Document has no file on disk (storagePath is empty)" });
    }

    const absPath = resolveApiPath(doc.storagePath);
    try {
      await access(absPath);
    } catch {
      return reply.code(404).send({ message: `PDF file not found on disk: ${doc.storagePath}` });
    }

    // Dynamically import the vision package runner
    let runAutoCount: typeof import("@bidwright/vision")["runAutoCount"];
    try {
      const vision = await import("@bidwright/vision");
      runAutoCount = vision.runAutoCount;
    } catch (err) {
      return reply.code(500).send({
        message: "Vision package not available",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const result = await runAutoCount({
        pdfPath: absPath,
        pageNumber,
        boundingBox: boundingBox ? {
          x: boundingBox.x ?? 0,
          y: boundingBox.y ?? 0,
          width: boundingBox.width ?? 0,
          height: boundingBox.height ?? 0,
          imageWidth: boundingBox.imageWidth ?? 0,
          imageHeight: boundingBox.imageHeight ?? 0,
        } : undefined,
        threshold,
        methods: methods as any[],
        documentId,
      });

      return {
        success: true,
        documentId,
        pageNumber,
        totalCount: result.totalCount,
        matches: result.matches,
        snippetImage: result.snippetImage,
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

    // Use the Python pipeline just for the crop
    let runAutoCount: typeof import("@bidwright/vision")["runAutoCount"];
    try {
      const vision = await import("@bidwright/vision");
      runAutoCount = vision.runAutoCount;
    } catch {
      return reply.code(500).send({ message: "Vision package not available" });
    }

    // We run auto_count with a very high threshold (effectively disabling matching)
    // to just get the snippet image back
    try {
      const result = await runAutoCount({
        pdfPath: absPath,
        pageNumber,
        boundingBox: {
          x: boundingBox.x ?? 0,
          y: boundingBox.y ?? 0,
          width: boundingBox.width ?? 0,
          height: boundingBox.height ?? 0,
          imageWidth: boundingBox.imageWidth ?? 0,
          imageHeight: boundingBox.imageHeight ?? 0,
        },
        threshold: 1.1, // Effectively disable matching – we just want the crop
        methods: [],
        documentId,
      });

      return {
        success: true,
        image: result.snippetImage ?? null,
        duration_ms: result.duration_ms,
      };
    } catch (err) {
      return reply.code(500).send({
        message: "Crop failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
