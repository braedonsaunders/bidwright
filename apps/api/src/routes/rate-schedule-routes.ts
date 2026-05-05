import type { FastifyInstance } from "fastify";
import { buildWorkspaceResponse } from "../server.js";

export async function rateScheduleRoutes(app: FastifyInstance): Promise<void> {
  // ── Rate Book Assignments ──────────────────────────────────────────────

  app.get("/api/rate-book-assignments", async (request, reply) => {
    try {
      const query = request.query as {
        customerId?: string;
        projectId?: string;
        category?: string;
        active?: string;
      };
      return await request.store!.listRateBookAssignments({
        customerId: query.customerId,
        projectId: query.projectId,
        category: query.category,
        active: query.active === undefined ? undefined : query.active !== "false",
      });
    } catch (e: any) {
      reply.code(500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.post("/api/rate-book-assignments", async (request, reply) => {
    try {
      const created = await request.store!.createRateBookAssignment(request.body as any);
      reply.code(201);
      return created;
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.patch("/api/rate-book-assignments/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await request.store!.updateRateBookAssignment(id, request.body as Record<string, unknown>);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.delete("/api/rate-book-assignments/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await request.store!.deleteRateBookAssignment(id);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  // ── Resources ─────────────────────────────────────────────────────────

  app.get("/api/resources", async (request, reply) => {
    try {
      const query = request.query as {
        q?: string;
        resourceType?: string;
        category?: string;
        active?: string;
        limit?: string;
      };
      return await request.store!.listResources({
        q: query.q,
        resourceType: query.resourceType,
        category: query.category,
        active: query.active === undefined ? true : query.active !== "false",
        limit: query.limit ? Number(query.limit) : undefined,
      });
    } catch (e: any) {
      reply.code(500);
      return { error: e.message ?? "Internal error" };
    }
  });

  // ── Org-Level Master CRUD ──────────────────────────────────────────────

  app.get("/api/rate-schedules", async (request) => {
    const { scope } = request.query as { scope?: string };
    return request.store!.listRateSchedules(scope ?? "global");
  });

  app.post("/api/rate-schedules", async (request, reply) => {
    try {
      const body = request.body as {
        name: string; description?: string; category?: string;
        defaultMarkup?: number; autoCalculate?: boolean;
        effectiveDate?: string | null; expiryDate?: string | null;
        metadata?: Record<string, unknown>;
      };
      const created = await request.store!.createRateSchedule(body);
      reply.code(201);
      return created;
    } catch (e: any) {
      reply.code(500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.get("/api/rate-schedules/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await request.store!.getRateSchedule(id);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.patch("/api/rate-schedules/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const patch = request.body as Record<string, unknown>;
      return await request.store!.updateRateSchedule(id, patch);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.delete("/api/rate-schedules/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await request.store!.deleteRateSchedule(id);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  // ── Tier Management ────────────────────────────────────────────────────

  app.post("/api/rate-schedules/:id/tiers", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { name: string; multiplier?: number; sortOrder?: number; uom?: string | null };
      return await request.store!.createRateScheduleTier(id, body);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.patch("/api/rate-schedules/:id/tiers/:tierId", async (request, reply) => {
    try {
      const { tierId } = request.params as { id: string; tierId: string };
      const patch = request.body as Record<string, unknown>;
      return await request.store!.updateRateScheduleTier(tierId, patch);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.delete("/api/rate-schedules/:id/tiers/:tierId", async (request, reply) => {
    try {
      const { tierId } = request.params as { id: string; tierId: string };
      return await request.store!.deleteRateScheduleTier(tierId);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  // ── Item Management ────────────────────────────────────────────────────

  app.post("/api/rate-schedules/:id/items", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        resourceId?: string | null;
        catalogItemId?: string;
        rates?: Record<string, number>; costRates?: Record<string, number>;
        burden?: number; perDiem?: number; metadata?: Record<string, unknown>; sortOrder?: number;
      };
      if (!body.resourceId && !body.catalogItemId) {
        reply.code(400);
        return { error: "resourceId or catalogItemId is required." };
      }
      return await request.store!.createRateScheduleItem(id, {
        resourceId: body.resourceId ?? null,
        catalogItemId: body.catalogItemId,
        rates: body.rates,
        costRates: body.costRates,
        burden: body.burden,
        perDiem: body.perDiem,
        metadata: body.metadata,
        sortOrder: body.sortOrder,
      });
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.patch("/api/rate-schedules/:id/items/:itemId", async (request, reply) => {
    try {
      const { itemId } = request.params as { id: string; itemId: string };
      const patch = request.body as Record<string, unknown>;
      return await request.store!.updateRateScheduleItem(itemId, patch);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.delete("/api/rate-schedules/:id/items/:itemId", async (request, reply) => {
    try {
      const { itemId } = request.params as { id: string; itemId: string };
      return await request.store!.deleteRateScheduleItem(itemId);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  // ── Auto-Calculate ─────────────────────────────────────────────────────

  app.post("/api/rate-schedules/:id/auto-calculate", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await request.store!.autoCalculateRateSchedule(id);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  // ── Project-Level (Revision Snapshots) ─────────────────────────────────

  app.get("/projects/:projectId/rate-schedules", async (request, reply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      return await request.store!.listRevisionRateSchedules(projectId);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.post("/projects/:projectId/rate-schedules/import", async (request, reply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const body = request.body as { scheduleId?: string; sourceScheduleId?: string };
      const scheduleId = body.scheduleId || body.sourceScheduleId;
      if (!scheduleId) {
        reply.code(400);
        return { error: "scheduleId is required" };
      }
      await request.store!.importRateScheduleToRevision(projectId, scheduleId);
      const payload = await buildWorkspaceResponse(request.store!, projectId);
      if (!payload) {
        reply.code(404);
        return { error: "Project workspace not found" };
      }
      reply.code(201);
      return payload;
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.post("/projects/:projectId/rate-schedules/import-assigned", async (request, reply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      await request.store!.importAssignedRateSchedulesToRevision(projectId);
      const payload = await buildWorkspaceResponse(request.store!, projectId);
      if (!payload) {
        reply.code(404);
        return { error: "Project workspace not found" };
      }
      reply.code(201);
      return payload;
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.patch("/projects/:projectId/rate-schedules/:id", async (request, reply) => {
    try {
      const { projectId, id } = request.params as { projectId: string; id: string };
      const patch = request.body as Record<string, unknown>;
      await request.store!.updateRateSchedule(id, patch);
      const payload = await buildWorkspaceResponse(request.store!, projectId);
      if (!payload) {
        reply.code(404);
        return { error: "Project workspace not found" };
      }
      return payload;
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.delete("/projects/:projectId/rate-schedules/:id", async (request, reply) => {
    try {
      const { projectId, id } = request.params as { projectId: string; id: string };
      await request.store!.deleteRateSchedule(id);
      const payload = await buildWorkspaceResponse(request.store!, projectId);
      if (!payload) {
        reply.code(404);
        return { error: "Project workspace not found" };
      }
      return payload;
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.patch("/projects/:projectId/rate-schedules/:scheduleId/items/:itemId", async (request, reply) => {
    try {
      const { projectId, itemId } = request.params as { projectId: string; scheduleId: string; itemId: string };
      const patch = request.body as Record<string, unknown>;
      await request.store!.updateRateScheduleItem(itemId, patch);
      const payload = await buildWorkspaceResponse(request.store!, projectId);
      if (!payload) {
        reply.code(404);
        return { error: "Project workspace not found" };
      }
      return payload;
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.post("/projects/:projectId/rate-schedules/:id/auto-calculate", async (request, reply) => {
    try {
      const { projectId, id } = request.params as { projectId: string; id: string };
      await request.store!.autoCalculateRateSchedule(id);
      const payload = await buildWorkspaceResponse(request.store!, projectId);
      if (!payload) {
        reply.code(404);
        return { error: "Project workspace not found" };
      }
      return payload;
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });
}
