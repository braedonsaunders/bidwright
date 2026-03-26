import type { FastifyInstance } from "fastify";

export async function takeoffRoutes(app: FastifyInstance) {
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
}
