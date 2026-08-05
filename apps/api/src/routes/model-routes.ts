import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createModelTakeoffLink,
  createModelTakeoffLinks,
  createModelTakeoffOverride,
  createProjectFederation,
  deleteModelTakeoffLink,
  deleteModelTakeoffOverride,
  deleteModelTakeoffRecipe,
  deleteProjectFederation,
  getModelBom,
  getModelTakeoffTopology,
  getProjectFederation,
  getProjectModelAsset,
  getProjectModelIngestCapabilities,
  listModelTakeoffLinks,
  listProjectFederations,
  listProjectModelAssets,
  prepareProjectModelViewer,
  queryModelElements,
  rebuildPersistedModelTopology,
  saveModelTakeoffRecipe,
  removeFederationMember,
  syncProjectModelAssets,
  updateModelElement,
  updateProjectFederation,
  upsertFederationMember,
} from "../services/model-service.js";
import {
  applyRevisionRetakeoff,
  computeRevisionDiff,
  getLatestRevisionImpactByItem,
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

const createModelTakeoffLinksSchema = z.object({
  worksheetItemId: z.string().min(1),
  links: z.array(z.object({
    modelElementId: z.string().min(1),
    modelQuantityId: z.string().min(1).nullable().optional(),
    quantityField: z.string().min(1).optional(),
    multiplier: z.coerce.number().finite().optional(),
    derivedQuantity: z.coerce.number().finite(),
    selection: z.unknown().optional(),
  })).min(1).max(500),
});

const takeoffRecipeAxisSchema = z.enum(["trade", "role", "specification", "material", "size", "system", "level", "elementClass", "elementType"]);

const takeoffRecipeSchema = z.object({
  id: z.string().min(1).optional(),
  modelId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(160),
  trade: z.string().trim().min(1).max(80).optional(),
  isDefault: z.boolean().optional(),
  rules: z.object({
    groupBy: z.array(takeoffRecipeAxisSchema).min(1).max(9).optional(),
    defaultView: z.enum(["estimate", "system", "run"]).optional(),
    hierarchy: z.array(z.enum(["system", "network", "run", "estimate"])).optional(),
    authoredSystemsFirst: z.boolean().optional(),
    inferCompatibleEndpoints: z.boolean().optional(),
  }).passthrough().optional(),
});

const takeoffOverrideSchema = z.object({
  kind: z.enum(["rename", "exclude", "merge", "split"]),
  targetSignature: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
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

const prepareViewerSchema = z.object({
  sourceKind: z.enum(["source_document", "file_node"]),
  sourceId: z.string().min(1),
  force: z.boolean().optional(),
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
      if (!await request.store!.getProject(projectId)) return reply.code(404).send({ message: "Project not found" });
      if (query.refresh === "1" || query.refresh === "true") {
        const settings = await request.store!.getSettings();
        return await syncProjectModelAssets(projectId, { integrations: settings.integrations });
      }
      return { assets: await listProjectModelAssets(projectId) };
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post("/api/models/:projectId/assets/scan", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    try {
      if (!await request.store!.getProject(projectId)) return reply.code(404).send({ message: "Project not found" });
      const settings = await request.store!.getSettings();
      return await syncProjectModelAssets(projectId, { integrations: settings.integrations });
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post("/api/models/:projectId/viewer", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = prepareViewerSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.message });
    try {
      if (!await request.store!.getProject(projectId)) return reply.code(404).send({ message: "Project not found" });
      const settings = await request.store!.getSettings();
      const result = await prepareProjectModelViewer(
        projectId,
        parsed.data,
        { integrations: settings.integrations },
      );
      return reply.code(result.status === "processing" ? 202 : 200).send(result);
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

  app.get("/api/models/:projectId/assets/:modelId/topology", async (request, reply) => {
    const { projectId, modelId } = request.params as { projectId: string; modelId: string };
    const query = request.query as { includeConnections?: string };
    try {
      return await getModelTakeoffTopology(projectId, modelId, { includeConnections: query.includeConnections === "1" || query.includeConnections === "true" });
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post("/api/models/:projectId/assets/:modelId/topology/rebuild", async (request, reply) => {
    const { projectId, modelId } = request.params as { projectId: string; modelId: string };
    try {
      return await rebuildPersistedModelTopology(projectId, modelId);
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post("/api/models/:projectId/takeoff-recipes", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = takeoffRecipeSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.message });
    try {
      const recipe = await saveModelTakeoffRecipe(projectId, parsed.data);
      return reply.code(parsed.data.id ? 200 : 201).send({ recipe });
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.delete("/api/models/:projectId/takeoff-recipes/:recipeId", async (request, reply) => {
    const { projectId, recipeId } = request.params as { projectId: string; recipeId: string };
    try {
      return await deleteModelTakeoffRecipe(projectId, recipeId);
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post("/api/models/:projectId/assets/:modelId/topology/overrides", async (request, reply) => {
    const { projectId, modelId } = request.params as { projectId: string; modelId: string };
    const parsed = takeoffOverrideSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.message });
    try {
      return reply.code(201).send(await createModelTakeoffOverride(projectId, modelId, parsed.data));
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.delete("/api/models/:projectId/assets/:modelId/topology/overrides/:overrideId", async (request, reply) => {
    const { projectId, modelId, overrideId } = request.params as { projectId: string; modelId: string; overrideId: string };
    try {
      return await deleteModelTakeoffOverride(projectId, modelId, overrideId);
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

  app.post("/api/models/:projectId/assets/:modelId/takeoff-links/bulk", async (request, reply) => {
    const { projectId, modelId } = request.params as { projectId: string; modelId: string };
    const parsed = createModelTakeoffLinksSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.message });
    }
    try {
      const result = await createModelTakeoffLinks(projectId, { ...parsed.data, modelId });
      reply.code(201);
      return result;
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

  /** Rollup of the most recent revision diff's per-item impact, used by the
   *  estimate grid to badge BIM-linked rows with their pending change-order
   *  delta. Returns `{ diffId: null, items: {} }` when no diff exists. */
  app.get("/api/models/:projectId/revision-impact/latest", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    try {
      return await getLatestRevisionImpactByItem(projectId);
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
