import type { FastifyInstance } from "fastify";
import { detectTitleBlockScale } from "../services/titleblock-scale-service.js";
import { extractLegendFromPage } from "../services/symbol-legend-service.js";
import { suggestLineItemsForAnnotation } from "../services/auto-takeoff-service.js";

export async function takeoffRoutes(app: FastifyInstance) {
  // ── POST /api/takeoff/:projectId/documents/:documentId/detect-scale ──
  // OCRs the page via Azure Document Intelligence and parses the text for
  // standard scale notations like "1:50" or "1/4\" = 1'-0\"".
  app.post("/api/takeoff/:projectId/documents/:documentId/detect-scale", async (request, reply) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };
    const body = (request.body ?? {}) as { pageNumber?: number };
    const pageNumber = body.pageNumber ?? 1;
    try {
      const result = await detectTitleBlockScale(projectId, documentId, pageNumber);
      return result;
    } catch (err) {
      return reply.code(500).send({ message: err instanceof Error ? err.message : "Detect failed" });
    }
  });

  // ── POST /api/takeoff/:projectId/documents/:documentId/extract-legend ──
  // Runs Azure DI prebuilt-layout on the page, then heuristically pairs
  // short-token cells with description cells to recover the drawing's
  // legend / symbol schedule.
  app.post("/api/takeoff/:projectId/documents/:documentId/extract-legend", async (request, reply) => {
    const { projectId, documentId } = request.params as { projectId: string; documentId: string };
    const body = (request.body ?? {}) as { pageNumber?: number };
    const pageNumber = body.pageNumber ?? 1;
    try {
      const result = await extractLegendFromPage(projectId, documentId, pageNumber);
      return result;
    } catch (err) {
      return reply.code(500).send({ message: err instanceof Error ? err.message : "Legend extraction failed" });
    }
  });

  // ── POST /api/takeoff/:projectId/annotations/:annotationId/suggest-line-items ──
  // Asks the LLM to match a takeoff annotation against the org's catalog
  // and rate-schedule items. Returns ranked line-item suggestions the user
  // can drop into a worksheet with one click.
  app.post(
    "/api/takeoff/:projectId/annotations/:annotationId/suggest-line-items",
    async (request, reply) => {
      const { projectId, annotationId } = request.params as {
        projectId: string;
        annotationId: string;
      };
      try {
        const result = await suggestLineItemsForAnnotation(projectId, annotationId);
        return result;
      } catch (err) {
        return reply.code(500).send({
          message: err instanceof Error ? err.message : "Suggestion failed",
        });
      }
    },
  );

  // ── GET /api/takeoff/:projectId/annotations ───────────────────────────
  app.get("/api/takeoff/:projectId/annotations", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as { documentId?: string; page?: string };
    try {
      const annotations = await request.store!.listTakeoffAnnotations(
        projectId,
        query.documentId,
        query.page !== undefined ? parseInt(query.page, 10) : undefined,
      );
      return annotations;
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Not found" });
    }
  });

  // ── POST /api/takeoff/:projectId/annotations ──────────────────────────
  app.post("/api/takeoff/:projectId/annotations", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as Record<string, unknown>;
    try {
      const annotation = await request.store!.createTakeoffAnnotation(projectId, body as any);
      reply.code(201);
      return annotation;
    } catch (error) {
      console.error("[takeoff:create] Failed:", error instanceof Error ? error.message : error);
      console.error("[takeoff:create] Body:", JSON.stringify(body, null, 2));
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Bad request" });
    }
  });

  // ── PATCH /api/takeoff/:projectId/annotations/:annotationId ───────────
  app.patch("/api/takeoff/:projectId/annotations/:annotationId", async (request, reply) => {
    const { annotationId } = request.params as { projectId: string; annotationId: string };
    const body = request.body as Record<string, unknown>;
    try {
      const annotation = await request.store!.updateTakeoffAnnotation(annotationId, body as any);
      return annotation;
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Not found" });
    }
  });

  // ── DELETE /api/takeoff/:projectId/annotations/:annotationId ──────────
  app.delete("/api/takeoff/:projectId/annotations/:annotationId", async (request, reply) => {
    const { annotationId } = request.params as { projectId: string; annotationId: string };
    try {
      await request.store!.deleteTakeoffAnnotation(annotationId);
      return { deleted: true };
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Not found" });
    }
  });

  // ── Takeoff Links (Annotation ↔ Line Item) ────────────────────────────

  // ── GET /api/takeoff/:projectId/links ─────────────────────────────────
  app.get("/api/takeoff/:projectId/links", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as { annotationId?: string; worksheetItemId?: string };
    try {
      return await request.store!.listTakeoffLinks(projectId, query.annotationId, query.worksheetItemId);
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Not found" });
    }
  });

  // ── POST /api/takeoff/:projectId/links ────────────────────────────────
  app.post("/api/takeoff/:projectId/links", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as Record<string, unknown>;
    try {
      const link = await request.store!.createTakeoffLink(projectId, body as any);
      reply.code(201);
      return link;
    } catch (error) {
      console.error("[takeoff-link:create] Failed:", error instanceof Error ? error.message : error);
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Bad request" });
    }
  });

  // ── PATCH /api/takeoff/:projectId/links/:linkId ───────────────────────
  app.patch("/api/takeoff/:projectId/links/:linkId", async (request, reply) => {
    const { linkId } = request.params as { projectId: string; linkId: string };
    const body = request.body as Record<string, unknown>;
    try {
      return await request.store!.updateTakeoffLink(linkId, body as any);
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Not found" });
    }
  });

  // ── DELETE /api/takeoff/:projectId/links/:linkId ──────────────────────
  app.delete("/api/takeoff/:projectId/links/:linkId", async (request, reply) => {
    const { linkId } = request.params as { projectId: string; linkId: string };
    try {
      await request.store!.deleteTakeoffLink(linkId);
      return { deleted: true };
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Not found" });
    }
  });
}
