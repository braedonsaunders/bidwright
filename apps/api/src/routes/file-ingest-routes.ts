import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getProjectFileIngestCapabilities, ingestProjectFileSource } from "../services/file-ingest-service.js";

const ingestBodySchema = z.object({
  sourceKind: z.enum(["source_document", "file_node"]),
  sourceId: z.string().min(1),
});

function routeError(reply: any, error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  const status = message.includes("not found") ? 404 : 400;
  return reply.code(status).send({ message });
}

export async function fileIngestRoutes(app: FastifyInstance) {
  app.get("/api/files/:projectId/ingest-capabilities", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as { format?: string };
    try {
      return await getProjectFileIngestCapabilities(projectId, query.format);
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post("/api/files/:projectId/ingest", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = ingestBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.message });
    }
    try {
      return await ingestProjectFileSource({
        projectId,
        sourceKind: parsed.data.sourceKind,
        sourceId: parsed.data.sourceId,
      });
    } catch (error) {
      return routeError(reply, error);
    }
  });
}
