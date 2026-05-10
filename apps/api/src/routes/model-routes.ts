import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createModelTakeoffLink,
  createProjectFederation,
  deleteModelTakeoffLink,
  deleteProjectFederation,
  getModelBom,
  getProjectFederation,
  getProjectModelAsset,
  getProjectModelIngestCapabilities,
  listModelTakeoffLinks,
  listProjectFederations,
  listProjectModelAssets,
  queryModelElements,
  removeFederationMember,
  syncProjectModelAssets,
  updateModelElement,
  updateProjectFederation,
  upsertFederationMember,
} from "../services/model-service.js";
import {
  applyRevisionRetakeoff,
  computeRevisionDiff,
  getRevisionImpactReport,
  listProjectRevisionDiffs,
} from "../services/revision-diff-service.js";

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
  offset: z.coerce.number().int().min(0).optional(),
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

// ── Element classification/LOD update ──────────────────────────────────
//
// Whitelisted classification standards mirror classification-utils.ts on the
// web side. Anything outside this list is silently dropped to keep the JSON
// blob queryable and prevent accidental schema drift.

const classificationKeySchema = z.enum([
  "masterformat",
  "uniformat",
  "omniclass",
  "uniclass",
  "din276",
  "nrm",
  "icms",
]);

const lodSchema = z.enum(["", "100", "200", "300", "350", "400", "500"]);

const updateModelElementSchema = z.object({
  classification: z.record(classificationKeySchema, z.string()).optional(),
  lod: lodSchema.optional(),
});

// ── Federation schemas ─────────────────────────────────────────────────
//
// Federations group multiple ModelAssets into one logical model for an
// estimate (architectural + structural + MEP federated for takeoff).
// `revisionId` is optional — null/undefined = "loose" federation, set =
// scenario-pinned to that quote revision.

const federationStatusSchema = z.enum(["active", "draft", "archived"]);
const federationDisciplineSchema = z.enum([
  "architecture",
  "structure",
  "mep",
  "civil",
  "landscape",
  "fp",
  "other",
]);
const federationRoleSchema = z.enum(["primary", "reference", "clash"]);

const createFederationSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  revisionId: z.string().min(1).nullable().optional(),
  status: federationStatusSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateFederationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  revisionId: z.string().min(1).nullable().optional(),
  status: federationStatusSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const upsertFederationMemberSchema = z.object({
  modelId: z.string().min(1),
  discipline: federationDisciplineSchema.optional(),
  role: federationRoleSchema.optional(),
  position: z.coerce.number().int().min(0).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const listFederationsQuerySchema = z.object({
  revisionId: z.string().min(1).optional(),
});

function routeError(reply: any, error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  const status = message.includes("not found") ? 404 : 400;
  return reply.code(status).send({ message });
}

export async function modelRoutes(app: FastifyInstance) {
  app.get("/api/models/:projectId/ingest-capabilities", async (request, reply) => {
    const query = request.query as { format?: string };
    try {
      const settings = await request.store!.getSettings();
      return await getProjectModelIngestCapabilities(query.format, { integrations: settings.integrations });
    } catch (error) {
      return routeError(reply, error);
    }
  });

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
      return elements;
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

  // ── Per-element classification / LOD ──────────────────────────────────

  app.patch("/api/models/:projectId/assets/:modelId/elements/:elementId", async (request, reply) => {
    const { projectId, modelId, elementId } = request.params as { projectId: string; modelId: string; elementId: string };
    const parsed = updateModelElementSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.message });
    }
    try {
      const element = await updateModelElement(projectId, modelId, elementId, parsed.data);
      return { element };
    } catch (error) {
      return routeError(reply, error);
    }
  });

  // ── Federations ───────────────────────────────────────────────────────

  app.get("/api/models/:projectId/federations", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = listFederationsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.message });
    }
    try {
      return { federations: await listProjectFederations(projectId, parsed.data) };
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post("/api/models/:projectId/federations", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createFederationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.message });
    }
    try {
      const federation = await createProjectFederation(projectId, parsed.data);
      reply.code(201);
      return { federation };
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.get("/api/models/:projectId/federations/:federationId", async (request, reply) => {
    const { projectId, federationId } = request.params as { projectId: string; federationId: string };
    try {
      return { federation: await getProjectFederation(projectId, federationId) };
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.patch("/api/models/:projectId/federations/:federationId", async (request, reply) => {
    const { projectId, federationId } = request.params as { projectId: string; federationId: string };
    const parsed = updateFederationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.message });
    }
    try {
      const federation = await updateProjectFederation(projectId, federationId, parsed.data);
      return { federation };
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.delete("/api/models/:projectId/federations/:federationId", async (request, reply) => {
    const { projectId, federationId } = request.params as { projectId: string; federationId: string };
    try {
      return await deleteProjectFederation(projectId, federationId);
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post("/api/models/:projectId/federations/:federationId/members", async (request, reply) => {
    const { projectId, federationId } = request.params as { projectId: string; federationId: string };
    const parsed = upsertFederationMemberSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.message });
    }
    try {
      const member = await upsertFederationMember(projectId, federationId, parsed.data);
      reply.code(201);
      return { member };
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.delete("/api/models/:projectId/federations/:federationId/members/:modelId", async (request, reply) => {
    const { projectId, federationId, modelId } = request.params as { projectId: string; federationId: string; modelId: string };
    try {
      return await removeFederationMember(projectId, federationId, modelId);
    } catch (error) {
      return routeError(reply, error);
    }
  });

  // ── Drawing-revision diff + auto re-takeoff ───────────────────────────

  app.get("/api/models/:projectId/diffs", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    try {
      return await listProjectRevisionDiffs(projectId);
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post("/api/models/:projectId/diffs", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = (request.body ?? {}) as { baseModelId?: string; headModelId?: string };
    if (!body.baseModelId || !body.headModelId) {
      return reply.code(400).send({ message: "baseModelId and headModelId are required" });
    }
    if (body.baseModelId === body.headModelId) {
      return reply.code(400).send({ message: "baseModelId and headModelId must be different" });
    }
    try {
      const created = await computeRevisionDiff(projectId, body.baseModelId, body.headModelId);
      const report = await getRevisionImpactReport(projectId, created.diffId);
      reply.code(201);
      return report;
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.get("/api/models/:projectId/diffs/:diffId", async (request, reply) => {
    const { projectId, diffId } = request.params as { projectId: string; diffId: string };
    try {
      return await getRevisionImpactReport(projectId, diffId);
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post("/api/models/:projectId/diffs/:diffId/analyze", async (request, reply) => {
    const { projectId, diffId } = request.params as { projectId: string; diffId: string };
    const body = (request.body ?? {}) as { aiConfig?: { provider: string; apiKey: string; model: string } };
    try {
      return await getRevisionImpactReport(projectId, diffId, {
        withAiNarrative: true,
        aiConfig: body.aiConfig,
      });
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post("/api/models/:projectId/diffs/:diffId/apply", async (request, reply) => {
    const { projectId, diffId } = request.params as { projectId: string; diffId: string };
    const body = (request.body ?? {}) as { onlyLinkIds?: string[] };
    try {
      const result = await applyRevisionRetakeoff(projectId, diffId, { onlyLinkIds: body.onlyLinkIds });
      return result;
    } catch (error) {
      return routeError(reply, error);
    }
  });
}
