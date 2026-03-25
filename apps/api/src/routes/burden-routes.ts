import type { FastifyInstance } from "fastify";

export async function burdenRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/burden-periods", async (request) => {
    const { group } = request.query as { group?: string };
    return request.store!.listBurdenPeriods(group);
  });

  app.post("/api/burden-periods", async (request, reply) => {
    try {
      const body = request.body as {
        name?: string; group?: string;
        percentage: number; startDate: string; endDate: string;
      };
      const created = await request.store!.createBurdenPeriod(body);
      reply.code(201);
      return created;
    } catch (e: any) {
      reply.code(500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.patch("/api/burden-periods/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const patch = request.body as Record<string, unknown>;
      return await request.store!.updateBurdenPeriod(id, patch);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.delete("/api/burden-periods/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await request.store!.deleteBurdenPeriod(id);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });
}
