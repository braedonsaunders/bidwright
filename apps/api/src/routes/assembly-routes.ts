import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildWorkspaceResponse } from "../server.js";

const componentTypeSchema = z.enum(["catalog_item", "rate_schedule_item", "labor_unit", "cost_intelligence", "sub_assembly"]);

const createAssemblySchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const patchAssemblySchema = createAssemblySchema.partial();

const parameterCreateSchema = z.object({
  key: z.string().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Parameter key must be a valid identifier"),
  label: z.string().optional(),
  description: z.string().optional(),
  paramType: z.string().optional(),
  defaultValue: z.string().optional(),
  unit: z.string().optional(),
  sortOrder: z.number().optional(),
});

const parameterPatchSchema = parameterCreateSchema.partial();

const componentCreateSchema = z.object({
  componentType: componentTypeSchema,
  catalogItemId: z.string().nullable().optional(),
  rateScheduleItemId: z.string().nullable().optional(),
  laborUnitId: z.string().nullable().optional(),
  laborDifficulty: z.enum(["normal", "difficult", "very_difficult"]).optional(),
  costResourceId: z.string().nullable().optional(),
  effectiveCostId: z.string().nullable().optional(),
  subAssemblyId: z.string().nullable().optional(),
  quantityExpr: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  uomOverride: z.string().nullable().optional(),
  costOverride: z.number().nullable().optional(),
  markupOverride: z.number().nullable().optional(),
  parameterBindings: z.record(z.string()).optional(),
  notes: z.string().optional(),
  sortOrder: z.number().optional(),
});

const componentPatchSchema = componentCreateSchema.partial();

const insertAssemblySchema = z.object({
  assemblyId: z.string().min(1),
  quantity: z.number().refine((n) => Number.isFinite(n), "quantity must be finite"),
  parameterValues: z.record(z.union([z.number(), z.string()])).optional(),
  phaseId: z.string().nullable().optional(),
});

const previewAssemblySchema = z.object({
  assemblyId: z.string().min(1),
  quantity: z.number().refine((n) => Number.isFinite(n), "quantity must be finite"),
  parameterValues: z.record(z.union([z.number(), z.string()])).optional(),
});

const saveSelectionSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().optional(),
  worksheetItemIds: z.array(z.string()).min(1),
});

const resyncInstanceSchema = z.object({
  quantity: z.number().optional(),
  parameterValues: z.record(z.union([z.number(), z.string()])).optional(),
  phaseId: z.string().nullable().optional(),
});

function statusForError(message: string): number {
  if (!message) return 500;
  if (message.includes("not found")) return 404;
  if (message.includes("Cycle") || message.includes("required") || message.includes("cannot") || message.includes("does not match")) return 400;
  return 500;
}

export async function assemblyRoutes(app: FastifyInstance): Promise<void> {
  // ── Master CRUD ────────────────────────────────────────────────────────

  app.get("/api/assemblies", async (request) => {
    return request.store!.listAssemblies();
  });

  app.post("/api/assemblies", async (request, reply) => {
    const parsed = createAssemblySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid payload", issues: parsed.error.flatten() };
    }
    try {
      const created = await request.store!.createAssembly(parsed.data);
      reply.code(201);
      return created;
    } catch (e: any) {
      reply.code(statusForError(e?.message ?? ""));
      return { error: e?.message ?? "Internal error" };
    }
  });

  app.get("/api/assemblies/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const assembly = await request.store!.getAssembly(id);
    if (!assembly) {
      reply.code(404);
      return { error: `Assembly ${id} not found` };
    }
    return assembly;
  });

  app.patch("/api/assemblies/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = patchAssemblySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid payload", issues: parsed.error.flatten() };
    }
    try {
      return await request.store!.updateAssembly(id, parsed.data);
    } catch (e: any) {
      reply.code(statusForError(e?.message ?? ""));
      return { error: e?.message ?? "Internal error" };
    }
  });

  app.delete("/api/assemblies/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await request.store!.deleteAssembly(id);
    } catch (e: any) {
      reply.code(statusForError(e?.message ?? ""));
      return { error: e?.message ?? "Internal error" };
    }
  });

  // ── Parameters ─────────────────────────────────────────────────────────

  app.post("/api/assemblies/:id/parameters", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = parameterCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid payload", issues: parsed.error.flatten() };
    }
    try {
      const created = await request.store!.createAssemblyParameter(id, parsed.data);
      reply.code(201);
      return created;
    } catch (e: any) {
      reply.code(statusForError(e?.message ?? ""));
      return { error: e?.message ?? "Internal error" };
    }
  });

  app.patch("/api/assemblies/:id/parameters/:parameterId", async (request, reply) => {
    const { id, parameterId } = request.params as { id: string; parameterId: string };
    const parsed = parameterPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid payload", issues: parsed.error.flatten() };
    }
    try {
      return await request.store!.updateAssemblyParameter(id, parameterId, parsed.data);
    } catch (e: any) {
      reply.code(statusForError(e?.message ?? ""));
      return { error: e?.message ?? "Internal error" };
    }
  });

  app.delete("/api/assemblies/:id/parameters/:parameterId", async (request, reply) => {
    const { id, parameterId } = request.params as { id: string; parameterId: string };
    try {
      return await request.store!.deleteAssemblyParameter(id, parameterId);
    } catch (e: any) {
      reply.code(statusForError(e?.message ?? ""));
      return { error: e?.message ?? "Internal error" };
    }
  });

  // ── Components ─────────────────────────────────────────────────────────

  app.post("/api/assemblies/:id/components", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = componentCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid payload", issues: parsed.error.flatten() };
    }
    try {
      const created = await request.store!.createAssemblyComponent(id, parsed.data);
      reply.code(201);
      return created;
    } catch (e: any) {
      reply.code(statusForError(e?.message ?? ""));
      return { error: e?.message ?? "Internal error" };
    }
  });

  app.patch("/api/assemblies/:id/components/:componentId", async (request, reply) => {
    const { id, componentId } = request.params as { id: string; componentId: string };
    const parsed = componentPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid payload", issues: parsed.error.flatten() };
    }
    try {
      return await request.store!.updateAssemblyComponent(id, componentId, parsed.data);
    } catch (e: any) {
      reply.code(statusForError(e?.message ?? ""));
      return { error: e?.message ?? "Internal error" };
    }
  });

  app.delete("/api/assemblies/:id/components/:componentId", async (request, reply) => {
    const { id, componentId } = request.params as { id: string; componentId: string };
    try {
      return await request.store!.deleteAssemblyComponent(id, componentId);
    } catch (e: any) {
      reply.code(statusForError(e?.message ?? ""));
      return { error: e?.message ?? "Internal error" };
    }
  });

  // ── Insert Into Worksheet ──────────────────────────────────────────────

  // ── Preview / Dry-run ──────────────────────────────────────────────────

  app.post("/api/assemblies/preview", async (request, reply) => {
    const parsed = previewAssemblySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid payload", issues: parsed.error.flatten() };
    }
    try {
      return await request.store!.previewAssemblyExpansion(
        parsed.data.assemblyId,
        parsed.data.quantity,
        parsed.data.parameterValues ?? {},
      );
    } catch (e: any) {
      reply.code(statusForError(e?.message ?? ""));
      return { error: e?.message ?? "Internal error" };
    }
  });

  // ── Save selection from worksheet ──────────────────────────────────────

  app.post("/projects/:projectId/worksheets/:worksheetId/assemblies/save-selection", async (request, reply) => {
    const { projectId, worksheetId } = request.params as { projectId: string; worksheetId: string };
    const parsed = saveSelectionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid payload", issues: parsed.error.flatten() };
    }
    try {
      const result = await request.store!.saveSelectionAsAssembly(projectId, worksheetId, parsed.data);
      reply.code(201);
      return result;
    } catch (e: any) {
      reply.code(statusForError(e?.message ?? ""));
      return { error: e?.message ?? "Internal error" };
    }
  });

  // ── Instance Operations ────────────────────────────────────────────────

  app.get("/projects/:projectId/worksheets/:worksheetId/assemblies/instances", async (request, reply) => {
    const { projectId, worksheetId } = request.params as { projectId: string; worksheetId: string };
    try {
      return await request.store!.listAssemblyInstancesForWorksheet(projectId, worksheetId);
    } catch (e: any) {
      reply.code(statusForError(e?.message ?? ""));
      return { error: e?.message ?? "Internal error" };
    }
  });

  app.delete("/projects/:projectId/assemblies/instances/:instanceId", async (request, reply) => {
    const { projectId, instanceId } = request.params as { projectId: string; instanceId: string };
    try {
      const result = await request.store!.deleteAssemblyInstance(projectId, instanceId);
      const workspace = await buildWorkspaceResponse(request.store!, projectId);
      if (!workspace) {
        reply.code(404);
        return { error: "Project workspace not found" };
      }
      return { workspace, deleted: result };
    } catch (e: any) {
      reply.code(statusForError(e?.message ?? ""));
      return { error: e?.message ?? "Internal error" };
    }
  });

  app.post("/projects/:projectId/assemblies/instances/:instanceId/resync", async (request, reply) => {
    const { projectId, instanceId } = request.params as { projectId: string; instanceId: string };
    const parsed = resyncInstanceSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid payload", issues: parsed.error.flatten() };
    }
    try {
      const result = await request.store!.resyncAssemblyInstance(projectId, instanceId, {
        quantity: parsed.data.quantity,
        parameterValues: parsed.data.parameterValues,
        phaseId: parsed.data.phaseId,
      });
      const workspace = await buildWorkspaceResponse(request.store!, projectId);
      if (!workspace) {
        reply.code(404);
        return { error: "Project workspace not found" };
      }
      return {
        workspace,
        resync: { itemIds: result.items.map((i) => i.id), instanceId, warnings: result.warnings, itemCount: result.itemCount },
      };
    } catch (e: any) {
      reply.code(statusForError(e?.message ?? ""));
      return { error: e?.message ?? "Internal error" };
    }
  });

  app.post("/projects/:projectId/worksheets/:worksheetId/assemblies/insert", async (request, reply) => {
    const { projectId, worksheetId } = request.params as { projectId: string; worksheetId: string };
    const parsed = insertAssemblySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid payload", issues: parsed.error.flatten() };
    }
    try {
      const result = await request.store!.insertAssemblyIntoWorksheet(projectId, worksheetId, parsed.data);
      const workspace = await buildWorkspaceResponse(request.store!, projectId);
      if (!workspace) {
        reply.code(404);
        return { error: "Project workspace not found" };
      }
      reply.code(201);
      return {
        workspace,
        insertion: {
          itemIds: result.items.map((i) => i.id),
          instanceId: result.instanceId,
          warnings: result.warnings,
        },
      };
    } catch (e: any) {
      reply.code(statusForError(e?.message ?? ""));
      return { error: e?.message ?? "Internal error" };
    }
  });
}
