import type { FastifyInstance } from "fastify";
import { getSourceOverview } from "../services/source-overview-service.js";

export async function sourceOverviewRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/source-overview", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!await request.store!.getProject(projectId)) return reply.code(404).send({ message: "Project not found" });
    return getSourceOverview(projectId);
  });
}
