import type { FastifyInstance } from "fastify";

export async function travelPolicyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/travel-policies", async (request) => {
    return request.store!.listTravelPolicies();
  });

  app.post("/api/travel-policies", async (request, reply) => {
    try {
      const body = request.body as {
        name: string; description?: string;
        perDiemRate?: number; perDiemEmbedMode?: string; hoursPerDay?: number;
        travelTimeHours?: number; travelTimeTrips?: number;
        kmToDestination?: number; mileageRate?: number;
        fuelSurchargePercent?: number; fuelSurchargeAppliesTo?: string;
        accommodationRate?: number; accommodationNights?: number;
        showAsSeparateLine?: boolean; breakoutLabel?: string;
      };
      const created = await request.store!.createTravelPolicy(body);
      reply.code(201);
      return created;
    } catch (e: any) {
      reply.code(500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.get("/api/travel-policies/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await request.store!.getTravelPolicy(id);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.patch("/api/travel-policies/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const patch = request.body as Record<string, unknown>;
      return await request.store!.updateTravelPolicy(id, patch);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.delete("/api/travel-policies/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await request.store!.deleteTravelPolicy(id);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });
}
