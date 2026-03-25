import type { FastifyInstance } from "fastify";

export async function labourCostRoutes(app: FastifyInstance): Promise<void> {
  // ── Labour Cost Tables ───────────────────────────────────────────────

  app.get("/api/labour-cost-tables", async (request) => {
    return request.store!.listLabourCostTables();
  });

  app.post("/api/labour-cost-tables", async (request, reply) => {
    try {
      const body = request.body as {
        name: string; description?: string;
        effectiveDate?: string; expiryDate?: string;
      };
      const created = await request.store!.createLabourCostTable(body);
      reply.code(201);
      return created;
    } catch (e: any) {
      reply.code(500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.get("/api/labour-cost-tables/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await request.store!.getLabourCostTable(id);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.patch("/api/labour-cost-tables/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const patch = request.body as Record<string, unknown>;
      return await request.store!.updateLabourCostTable(id, patch);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.delete("/api/labour-cost-tables/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await request.store!.deleteLabourCostTable(id);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  // ── Labour Cost Entries ──────────────────────────────────────────────

  app.post("/api/labour-cost-tables/:id/entries", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        code: string; name: string; group?: string;
        costRates?: Record<string, number>; sortOrder?: number;
      };
      const result = await request.store!.createLabourCostEntry(id, body);
      reply.code(201);
      return result;
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.patch("/api/labour-cost-tables/:id/entries/:entryId", async (request, reply) => {
    try {
      const { entryId } = request.params as { id: string; entryId: string };
      const patch = request.body as Record<string, unknown>;
      return await request.store!.updateLabourCostEntry(entryId, patch);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.delete("/api/labour-cost-tables/:id/entries/:entryId", async (request, reply) => {
    try {
      const { entryId } = request.params as { id: string; entryId: string };
      return await request.store!.deleteLabourCostEntry(entryId);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });
}
