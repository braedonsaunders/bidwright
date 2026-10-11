import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@bidwright/db";
import { PdfTakeoffService } from "../services/pdf-takeoff-service.js";
import {
  detectTitleBlockScale,
  parseScalesFromText,
} from "../services/titleblock-scale-service.js";
import { extractLegendFromPage } from "../services/symbol-legend-service.js";
import { createTemplateFromLegendEntry } from "../services/symbol-template-service.js";
import { recordEvidenceView } from "./vision-routes.js";

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const box = point.extend({
  width: z.number().positive(),
  height: z.number().positive(),
});
const source = z.object({
  documentId: z.string().min(1).optional(),
  pageNumber: z.number().int().positive().optional(),
  viewId: z.string().min(1).optional(),
  coordinateSpace: z.enum(["view-normalized", "pdf-points"]).optional(),
});
const geometry = source.extend({
  type: z.enum(["linear", "polyline", "area", "count"]),
  points: z.array(point).min(1).max(10000),
  snap: z.boolean().optional(),
  tolerance: z.number().positive().max(72).optional(),
});
const legendEntry = z.object({
  symbol: z.string(),
  label: z.string(),
  pageNumber: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
  symbolBbox: box,
});
const calibration = source.extend({
  points: z.array(point).length(2),
  knownDistance: z.number().positive(),
  unit: z.enum(["mm", "cm", "m", "in", "ft"]),
  source: z.enum(["title-block", "dimension", "manual-points"]),
  region: box.optional(),
  regionId: z.string().optional(),
  replaceHuman: z.boolean().optional(),
});
const save = geometry.extend({
  label: z.string().optional(),
  color: z.string().optional(),
  comparisonGroup: z.string().optional(),
  linkToItemId: z.string().optional(),
  quantityField: z.enum(["value", "area"]).optional(),
  multiplier: z.number().finite().positive().optional(),
});
const update = z.object({
  pickupId: z.string(),
  points: z.array(point).min(1).max(10000).optional(),
  viewId: z.string().optional(),
  coordinateSpace: z.enum(["view-normalized", "pdf-points"]).optional(),
  label: z.string().optional(),
  color: z.string().optional(),
  editHuman: z.boolean().optional(),
  snap: z.boolean().optional(),
  tolerance: z.number().positive().max(72).optional(),
});

export async function pdfTakeoffRoutes(app: FastifyInstance) {
  app.post("/api/takeoff/:projectId/pdf/:operation", async (request, reply) => {
    const { projectId, operation } = request.params as {
      projectId: string;
      operation: string;
    };
    const service = new PdfTakeoffService(
      request.store!,
      async (projectId, id) =>
        prisma.evidenceView.findFirst({ where: { id, projectId } }),
    );
    const body = request.body ?? {};
    try {
      if (operation === "patch-calibration-keys") {
        const value = z
          .object({
            documentId: z.string().min(1),
            changes: z
              .array(
                z.object({
                  key: z.string().min(1),
                  calibration: z
                    .object({
                      pixelsPerUnit: z.number().positive(),
                      unit: z.string().min(1),
                    })
                    .passthrough()
                    .nullable(),
                  expected: z.record(z.unknown()).nullable().optional(),
                }),
              )
              .max(1000),
          })
          .parse(body);
        if (value.documentId.startsWith("kb-")) {
          const book = await request.store!.getKnowledgeBook(
            value.documentId.slice(3),
          );
          if (!book || book.projectId !== projectId)
            throw new Error("Knowledge book not found in project");
        } else {
          await service.resolve(projectId, { documentId: value.documentId });
        }
        return await request.store!.updateTakeoffCalibrationKeys(
          projectId,
          value.documentId,
          value.changes as any,
        );
      }
      if (operation === "get-calibration")
        return await service.getCalibration(projectId, source.parse(body));
      if (operation === "set-calibration")
        return await service.setCalibration(projectId, calibration.parse(body));
      if (operation === "measure")
        return await service.measure(projectId, geometry.parse(body));
      if (operation === "save")
        return await service.save(projectId, save.parse(body));
      if (operation === "update")
        return await service.update(projectId, update.parse(body));
      if (operation === "trace")
        return await service.trace(
          projectId,
          source
            .extend({
              seed: point,
              tolerance: z.number().positive().max(72).optional(),
              maxSegments: z.number().int().positive().max(5000).optional(),
            })
            .parse(body),
        );
      if (operation === "detect-scale" || operation === "extract-legend") {
        const input = source.parse(body),
          ctx = await service.context(projectId, input, {
            operation: operation === "detect-scale" ? "scale" : "info",
          });
        const integrations = ((await request.store!.getSettings())
          .integrations ?? {}) as {
          azureDiEndpoint?: string;
          azureDiKey?: string;
        };
        const azure = {
          endpoint: integrations.azureDiEndpoint,
          key: integrations.azureDiKey,
        };
        if (operation === "extract-legend")
          return await extractLegendFromPage(
            projectId,
            ctx.documentId,
            ctx.pageNumber,
            azure,
          );
        const native = ctx.geometry;
        const ocr = await detectTitleBlockScale(
          projectId,
          ctx.documentId,
          ctx.pageNumber,
          azure,
        ).catch((error) => ({
          detectedScales: [],
          ocrText: "",
          warnings: [String(error)],
        }));
        const titleBlockCandidates = [
          ...ocr.detectedScales,
          ...parseScalesFromText(native.text),
        ];
        const ratios = [
          ...new Set(
            titleBlockCandidates.map(
              (c) => (c.multiplier * (c.unit === "ft" ? 0.3048 : 1)) / 0.0254,
            ),
          ),
        ];
        const clusters = native.dimensions.clusters as Array<{
          ratio: number;
          spread: number;
          count: number;
        }>;
        const conflicts: string[] = [];
        if (
          /\bN\.?T\.?S\.?\b|not\s+to\s+scale/i.test(
            native.text + "\n" + ocr.ocrText,
          )
        )
          conflicts.push("not_to_scale_text");
        if (ratios.length > 1 || clusters.length > 1)
          conflicts.push("multiple_detail_scales");
        if (
          ratios.length &&
          clusters.some((c) =>
            ratios.every((r) => Math.abs(c.ratio / r - 1) > 0.05),
          )
        )
          conflicts.push("title_block_disagrees_with_dimensions");
        return {
          documentId: ctx.documentId,
          pageNumber: ctx.pageNumber,
          titleBlockCandidates,
          dimensionConsensus: clusters.length === 1 ? clusters[0] : null,
          dimensions: native.dimensions,
          perRegionCandidates: native.dimensions.candidates,
          conflicts,
          facts: [...native.facts, ...ocr.warnings],
          coordinateSpace: "pdf-points",
        };
      }
      if (operation === "create-template") {
        const input = source
          .extend({
            region: box.optional(),
            legendEntry: legendEntry.optional(),
            symbol: z.string().default(""),
            label: z.string().default(""),
            threshold: z.number().min(0.3).max(0.95).optional(),
          })
          .parse(body);
        const ctx = await service.context(projectId, {
          ...input,
          pageNumber: input.pageNumber ?? input.legendEntry?.pageNumber,
        });
        if (input.legendEntry) {
          if (input.legendEntry.pageNumber !== ctx.pageNumber)
            throw new Error("Legend entry belongs to a different page");
          return await createTemplateFromLegendEntry(
            request.store!,
            projectId,
            {
              documentId: ctx.documentId,
              pageNumber: ctx.pageNumber,
              threshold: input.threshold,
              createdBy: request.user?.id,
              entry: input.legendEntry,
            },
          );
        }
        const b = input.region;
        if (!b) throw new Error("region or legendEntry is required");
        const corners = service.points(input, ctx, [
          { x: b.x, y: b.y },
          { x: b.x + b.width, y: b.y },
          { x: b.x + b.width, y: b.y + b.height },
          { x: b.x, y: b.y + b.height },
        ]);
        const x = Math.min(...corners.map((p) => p.x)),
          y = Math.min(...corners.map((p) => p.y));
        return await createTemplateFromLegendEntry(request.store!, projectId, {
          documentId: ctx.documentId,
          pageNumber: ctx.pageNumber,
          threshold: input.threshold,
          createdBy: request.user?.id,
          entry: {
            symbol: input.symbol,
            label: input.label,
            pageNumber: ctx.pageNumber,
            confidence: 1,
            symbolBbox: {
              x: x / 72,
              y: y / 72,
              width: (Math.max(...corners.map((p) => p.x)) - x) / 72,
              height: (Math.max(...corners.map((p) => p.y)) - y) / 72,
            },
          },
        });
      }
      if (operation === "overlay") {
        const input = source
          .extend({
            region: box.optional(),
            pickupIds: z.array(z.string()).optional(),
            recordView: z
              .object({
                runId: z.string().optional(),
                sessionId: z.string().optional(),
              })
              .optional(),
          })
          .parse(body);
        const ctx = await service.resolve(projectId, input);
        const all = await request.store!.listPickups(
          projectId,
          ctx.documentId,
          ctx.pageNumber,
        );
        if (input.pickupIds?.some((id) => !all.some((p) => p.id === id)))
          throw new Error("Pickup not found on this project page");
        const pickups = all.filter(
          (p) =>
            p.sourceKind === "annotation" &&
            (!input.pickupIds || input.pickupIds.includes(p.id)),
        );
        const maxEdge = Math.min(
          4096,
          Math.max(
            512,
            Number(process.env.BIDWRIGHT_AGENT_IMAGE_MAX_EDGE) || 1568,
          ),
        );
        const rendered = await service.engine({
          pdfPath: ctx.pdfPath,
          pageNumber: ctx.pageNumber,
          operation: "overlay",
          region: input.region,
          coordinateSpace:
            input.coordinateSpace ??
            (input.viewId ? "view-normalized" : "pdf-points"),
          view: ctx.view,
          maxEdge,
          pickups,
        });
        const bbox = input.region ? rendered.bbox : null;
        const record = async (image: string, tool: string) =>
          recordEvidenceView({
            projectId,
            doc: ctx.doc,
            documentId: ctx.documentId,
            recordView: { ...input.recordView, tool },
            defaultTool: tool,
            image,
            pageNumber: ctx.pageNumber,
            bbox,
            rotation: 0,
            dpi: rendered.dpi,
            width: rendered.width,
            height: rendered.height,
          });
        const viewId = await record(
          rendered.nativeImage,
          "renderTakeoffOverlay.native",
        );
        const overlayViewId = await record(
          rendered.overlayImage,
          "renderTakeoffOverlay",
        );
        return {
          ...rendered,
          viewId,
          overlayViewId,
          documentId: ctx.documentId,
          pageNumber: ctx.pageNumber,
          pickups: pickups.map((p) => ({
            id: p.id,
            label: p.label,
            ...p.measurement,
            sourceRef: { documentId: p.documentId, pageNumber: p.pageNumber },
            calibration: p.calibration,
          })),
        };
      }
      return reply.code(404).send({ message: "Unknown PDF takeoff operation" });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
