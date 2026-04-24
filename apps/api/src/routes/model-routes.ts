import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createModelTakeoffLink,
  deleteModelTakeoffLink,
  getModelBom,
  getProjectModelAsset,
  listModelTakeoffLinks,
  listProjectModelAssets,
  queryModelElements,
  syncProjectModelAssets,
} from "../services/model-service.js";

const elementQuerySchema = z.object({
  text: z.string().optional(),
  class: z.string().optional(),
  type: z.string().optional(),
  elementClass: z.string().optional(),
  elementType: z.string().optional(),
  system: z.string().optional(),
  level: z.string().optional(),
  material: z.string().optional(),
  name: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

const createModelTakeoffLinkSchema = z.object({
  worksheetItemId: z.string().min(1),
  modelElementId: z.string().min(1).nullable().optional(),
  modelQuantityId: z.string().min(1).nullable().optional(),
  quantityField: z.string().min(1).optional(),
  multiplier: z.coerce.number().finite().optional(),
  derivedQuantity: z.coerce.number().finite().optional(),
  selection: z.unknown().optional(),
});

function routeError(reply: any, error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  const status = message.includes("not found") ? 404 : 400;
  return reply.code(status).send({ message });
}

export async function modelRoutes(app: FastifyInstance) {
  app.get("/api/models/:projectId/assets", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as { refresh?: string };
    try {
      if (query.refresh === "1" || query.refresh === "true") {
        return await syncProjectModelAssets(projectId);
      }
      return { assets: await listProjectModelAssets(projectId) };
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post("/api/models/:projectId/assets/scan", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    try {
      return await syncProjectModelAssets(projectId);
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.get("/api/models/:projectId/assets/:modelId", async (request, reply) => {
    const { projectId, modelId } = request.params as { projectId: string; modelId: string };
    try {
      const asset = await getProjectModelAsset(projectId, modelId);
      if (!asset) return reply.code(404).send({ message: "Model not found" });
      return { asset };
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.get("/api/models/:projectId/assets/:modelId/elements", async (request, reply) => {
    const { projectId, modelId } = request.params as { projectId: string; modelId: string };
    const parsed = elementQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.message });
    }
    try {
      const filters = {
        ...parsed.data,
        elementClass: parsed.data.elementClass ?? parsed.data.class,
        elementType: parsed.data.elementType ?? parsed.data.type,
      };
      const elements = await queryModelElements(projectId, modelId, filters);
      return { elements, count: elements.length };
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.get("/api/models/:projectId/assets/:modelId/bom", async (request, reply) => {
    const { projectId, modelId } = request.params as { projectId: string; modelId: string };
    try {
      const bom = await getModelBom(projectId, modelId);
      return { ...bom, rowCount: bom.rows.length };
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.get("/api/models/:projectId/assets/:modelId/takeoff-links", async (request, reply) => {
    const { projectId, modelId } = request.params as { projectId: string; modelId: string };
    try {
      return { links: await listModelTakeoffLinks(projectId, modelId) };
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post("/api/models/:projectId/assets/:modelId/takeoff-links", async (request, reply) => {
    const { projectId, modelId } = request.params as { projectId: string; modelId: string };
    const parsed = createModelTakeoffLinkSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.message });
    }
    try {
      const link = await createModelTakeoffLink(projectId, { ...parsed.data, modelId });
      reply.code(201);
      return { link };
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.delete("/api/models/:projectId/assets/:modelId/takeoff-links/:linkId", async (request, reply) => {
    const { projectId, modelId, linkId } = request.params as { projectId: string; modelId: string; linkId: string };
    try {
      return await deleteModelTakeoffLink(projectId, modelId, linkId);
    } catch (error) {
      return routeError(reply, error);
    }
  });
}
