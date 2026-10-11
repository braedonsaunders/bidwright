import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@bidwright/db";
import { getDwgProcessingResult } from "../services/dwg-processing-service.js";
import { cadDrawingSvg, prepareCadEntityTakeoff, queryCadDrawing, renderCadPng, type CadBounds } from "../services/cad-takeoff-service.js";
import { recordEvidenceView } from "./vision-routes.js";

const source = z.object({ sourceId: z.string().min(1), sourceKind: z.enum(["source_document", "file_node"]).default("source_document") });
const box = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).refine((b) => b.x + b.width <= 1 && b.y + b.height <= 1, "Box exceeds view");
const querySchema = source.extend({ layers: z.array(z.string()).optional(), blockName: z.string().optional(), entityTypes: z.array(z.string()).optional(), layout: z.string().default("Model"),
  viewId: z.string().optional(), bbox: box.optional(), groupBy: z.enum(["layer", "block", "type", "attributes"]).optional(), limit: z.number().int().min(1).max(500).default(100), offset: z.number().int().min(0).default(0), groupOffset: z.number().int().min(0).default(0), groupLimit: z.number().int().min(1).max(500).default(100),
  recordView: z.object({ runId: z.string().optional(), sessionId: z.string().optional() }).optional() });
const saveSchema = source.extend({ handles: z.array(z.string()).min(1).max(500), measurement: z.enum(["count", "length", "area"]), worksheetItemId: z.string().optional(), multiplier: z.number().finite().positive().optional() });

async function viewBounds(projectId: string, input: z.infer<typeof querySchema>, checksum: string): Promise<CadBounds | undefined> {
  if (!input.bbox) return undefined;
  if (!input.viewId) throw new Error("viewId is required with a view-normalized bbox");
  const view = await prisma.evidenceView.findFirst({ where: { id: input.viewId, projectId, tool: "renderCadDrawing",
    ...(input.sourceKind === "file_node" ? { fileNodeId: input.sourceId } : { documentId: input.sourceId }) } });
  if (!view) throw new Error("CAD view not found for this source");
  if (view.sourceChecksum !== checksum) throw new Error("CAD view source checksum differs from current source");
  const data = JSON.parse(view.textSnippet ?? "{}");
  if (data.layout !== input.layout) throw new Error("CAD view layout differs from requested layout");
  const t = data.transform, b = input.bbox;
  if (!t) throw new Error("CAD view transform not found");
  return { minX: t.originX + b.x * t.xPerNormalized, maxX: t.originX + (b.x + b.width) * t.xPerNormalized,
    maxY: t.originY + b.y * t.yPerNormalized, minY: t.originY + (b.y + b.height) * t.yPerNormalized };
}

export async function cadTakeoffRoutes(app: FastifyInstance) {
  for (const action of ["query", "render"] as const) {
    app.post(`/api/models/:projectId/cad/${action}`, async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      if (!await request.store!.getProject(projectId)) return reply.code(404).send({ message: "Project not found" });
      const parsed = querySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ message: parsed.error.message });
      try {
        const input = parsed.data;
        const drawing = await getDwgProcessingResult(projectId, input.sourceId, { sourceKind: input.sourceKind, persist: false });
        const query = { ...input, bounds: await viewBounds(projectId, input, drawing.sourceHash) };
        if (action === "query") return { ...queryCadDrawing(drawing, query), status: drawing.status, converter: drawing.converter, sourceHash: drawing.sourceHash };
        const rendered = cadDrawingSvg(drawing, query);
        const image = await renderCadPng(rendered.svg);
        const viewId = await recordEvidenceView({ projectId, documentId: input.sourceId,
          doc: { id: input.sourceId, source: input.sourceKind, checksum: drawing.sourceHash }, recordView: input.recordView,
          defaultTool: "renderCadDrawing", image, pageNumber: 0, bbox: null, rotation: 0, dpi: 72,
          width: rendered.width, height: rendered.height, textSnippet: JSON.stringify({ transform: rendered.transform, layout: input.layout, units: drawing.units }) });
        return { image, mimeType: "image/png", viewId, sourceHash: drawing.sourceHash, status: drawing.status, converter: drawing.converter,
          width: rendered.width, height: rendered.height, entityCount: rendered.entityCount, layout: input.layout,
          coordinateSpace: "view-normalized x right, y down (0..1)", transform: rendered.transform, transformUnits: drawing.units, facts: rendered.facts };
      } catch (error) { return reply.code(400).send({ message: error instanceof Error ? error.message : String(error) }); }
    });
  }
  app.post("/api/models/:projectId/cad/takeoff", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!await request.store!.getProject(projectId)) return reply.code(404).send({ message: "Project not found" });
    const parsed = saveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.message });
    try {
      const input = parsed.data;
      const drawing = await getDwgProcessingResult(projectId, input.sourceId, { sourceKind: input.sourceKind, persist: false });
      const entities = prepareCadEntityTakeoff(drawing, input);
      const result = await request.store!.saveCadEntityPickups(projectId, {
        documentId: input.sourceKind === "file_node" ? `file-${input.sourceId}` : input.sourceId,
        entities, worksheetItemId: input.worksheetItemId, multiplier: input.multiplier,
      });
      return reply.code(result.saved ? 200 : 409).send({ ...result, duplicateHandles: input.handles.length - entities.length });
    } catch (error) { return reply.code(400).send({ message: error instanceof Error ? error.message : String(error) }); }
  });
}
