import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getScheduleImportCandidates, importProjectSchedule } from "../services/schedule-import-service.js";

const importBodySchema = z.object({
  sourceKind: z.enum(["source_document", "file_node"]),
  sourceId: z.string().min(1),
  mode: z.enum(["replace"]).default("replace"),
});

function routeError(reply: any, error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  const status = message.includes("not found") || message.includes("not available") ? 404 : 400;
  return reply.code(status).send({ message });
}

export async function scheduleImportRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/schedule/import-candidates", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    try {
      return await getScheduleImportCandidates(projectId);
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post("/projects/:projectId/schedule/import", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = importBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid schedule import payload", issues: parsed.error.flatten() });
    }
    try {
      return await importProjectSchedule({ projectId, ...parsed.data });
    } catch (error) {
      return routeError(reply, error);
    }
  });
}
