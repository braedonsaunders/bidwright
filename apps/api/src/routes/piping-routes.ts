import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPipingMto, savePipingTakeoff } from "../services/piping/piping-service.js";
import { getRevisionImpact } from "../services/revision-impact-service.js";

export const projectSourceSchema = z.object({ sourceId: z.string().min(1), sourceKind: z.enum(["source_document", "file_node"]) });
export async function pipingRoutes(app: FastifyInstance) {
  app.get("/api/takeoff/:projectId/piping/mto", async (request, reply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      if (!(await request.store!.getProject(projectId))) return reply.code(404).send({ message: "Project not found" });
      return await getPipingMto(projectId, projectSourceSchema.parse(request.query));
    } catch (error) { return reply.code(400).send({ message: error instanceof Error ? error.message : "Piping source read failed" }); }
  });
  app.post("/api/takeoff/:projectId/piping/pickups", async (request, reply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const input = projectSourceSchema.extend({ sourceChecksum: z.string().optional(), lines: z.array(z.object({ lineId: z.string(), worksheetItemId: z.string().optional(), unit: z.enum(["m", "mm", "ft", "in", "EA"]).optional() })).min(1) }).parse(request.body);
      if (!(await request.store!.getProject(projectId))) return reply.code(404).send({ message: "Project not found" });
      return await savePipingTakeoff(request.store!, projectId, input);
    } catch (error) { return reply.code(400).send({ message: error instanceof Error ? error.message : "Piping takeoff save failed" }); }
  });
  app.get("/api/takeoff/:projectId/revision-impact", async (request, reply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const input = z.object({ documentId: z.string().optional(), priorDocumentId: z.string().optional(), priorChecksum: z.string().optional(), diffId: z.string().optional(), pageNumbers: z.string().optional() }).parse(request.query);
      const pageNumbers = input.pageNumbers === undefined ? undefined : z.array(z.coerce.number().int().positive()).parse(input.pageNumbers.split(","));
      if (!(await request.store!.getProject(projectId))) return reply.code(404).send({ message: "Project not found" });
      return await getRevisionImpact(projectId, { ...input, pageNumbers });
    } catch (error) { return reply.code(400).send({ message: error instanceof Error ? error.message : "Revision impact read failed" }); }
  });
}
