import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPipingMto, savePipingTakeoff } from "../services/piping/piping-service.js";
import { getRevisionImpact } from "../services/revision-impact-service.js";

export const projectSourceSchema = z.object({ sourceId: z.string().min(1), sourceKind: z.enum(["source_document", "file_node"]) });
// A Spoolyard piping specification as its spec library keeps it; unknown keys are kept as sent.
export const pipingSpecSchema = z.object({
  id: z.string().min(1).max(100), // Fastify's default maxParamLength: the id is also the path key
  name: z.string(),
  material: z.string(),
  rating: z.string(),
  service: z.string().nullish(),
  revision: z.string().nullish(),
  sizes: z.array(z.unknown()),
  fittings: z.array(z.unknown()),
}).passthrough();
// A full catalogue is ~1 MB of JSON; the server-wide 64 MB limit is for inline images.
export const PIPING_SPEC_BODY_LIMIT = 16 * 1024 * 1024;
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
  // The organisation's piping specification library, kept for Spoolyard. Like the factor library, any member may edit it.
  app.get("/api/piping/spec-library", async request => await request.store!.listPipingSpecLibrary());
  app.get("/api/piping/spec-library/:specId", async (request, reply) => {
    const { specId } = request.params as { specId: string };
    const entry = await request.store!.getPipingSpecLibraryEntry(specId);
    if (!entry) return reply.code(404).send({ message: "Piping specification not found" });
    return entry;
  });
  app.put("/api/piping/spec-library/:specId", { bodyLimit: PIPING_SPEC_BODY_LIMIT }, async (request, reply) => {
    const { specId } = request.params as { specId: string };
    const parsed = z.object({ spec: pipingSpecSchema }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: "Invalid piping specification", issues: parsed.error.flatten() });
    if (parsed.data.spec.id !== specId) return reply.code(400).send({ message: `Specification id "${parsed.data.spec.id}" does not match "${specId}"` });
    return await request.store!.putPipingSpecLibraryEntry(parsed.data.spec);
  });
  app.delete("/api/piping/spec-library/:specId", async request => {
    const { specId } = request.params as { specId: string };
    return { deleted: await request.store!.deletePipingSpecLibraryEntry(specId) };
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
