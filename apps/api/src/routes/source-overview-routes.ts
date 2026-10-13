import { prisma } from "@bidwright/db";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getSourceOverview } from "../services/source-overview-service.js";

export async function sourceOverviewRoutes(app: FastifyInstance) {
  app.post("/api/projects/:projectId/source-reads", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!await request.store!.getProject(projectId)) return reply.code(404).send({ message: "Project not found" });
    const parsed = z.object({ documentId: z.string(), tool: z.enum(["readDocumentText", "getDocumentStructured", "readSpreadsheet", "countComponents"]), pages: z.array(z.number().int().positive()).max(2000).optional(), section: z.string().max(200).optional(), offset: z.number().int().nonnegative(), returnedChars: z.number().int().nonnegative(), totalChars: z.number().int().nonnegative(), truncated: z.boolean(), checksum: z.string().optional(), pageRanges: z.array(z.object({ page: z.number().int().positive(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })).max(2000).optional(), sheetNames: z.array(z.string().max(200)).max(2000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid source read", issues: parsed.error.issues });
    const read = parsed.data;
    const source = await prisma.sourceDocument.findFirst({ where: { projectId, id: read.documentId }, select: { id: true } });
    if (!source) return reply.code(404).send({ message: "Source document not found" });
    await prisma.activity.create({ data: { projectId, type: "source_read", data: read } });
    return { recorded: true };
  });
  app.get("/api/projects/:projectId/source-overview", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!await request.store!.getProject(projectId)) return reply.code(404).send({ message: "Project not found" });
    return getSourceOverview(projectId);
  });
}
