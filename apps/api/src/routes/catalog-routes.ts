import type { FastifyInstance } from "fastify";
import { catalogLibrary } from "../prisma-store.js";

export async function catalogRoutes(app: FastifyInstance) {
  // ── Catalog Library (browse + adopt) ────────────────────────────────

  // GET /catalogs/library — list available template catalogs
  app.get("/catalogs/library", async (request, reply) => {
    try {
      return await catalogLibrary.listTemplates();
    } catch (err) {
      request.log.error(err, "Failed to list catalog library");
      return reply.code(500).send({ error: "Failed to list catalog library" });
    }
  });

  // GET /catalogs/library/:templateId — preview template with sample items
  app.get("/catalogs/library/:templateId", async (request, reply) => {
    const { templateId } = request.params as { templateId: string };
    const query = request.query as { limit?: string; offset?: string; filter?: string };
    const limit = parseInt(query.limit || "100", 10);
    const offset = parseInt(query.offset || "0", 10);
    try {
      const template = await catalogLibrary.getTemplate(templateId);
      if (!template) return reply.code(404).send({ error: "Catalog template not found" });
      const { items, total } = await catalogLibrary.getTemplateItems(templateId, limit, offset, query.filter);
      return { ...template, items, total };
    } catch (err) {
      request.log.error(err, "Failed to get catalog template");
      return reply.code(500).send({ error: "Failed to get catalog template" });
    }
  });

  // POST /catalogs/library/:templateId/adopt — clone template into org
  app.post("/catalogs/library/:templateId/adopt", async (request, reply) => {
    const { templateId } = request.params as { templateId: string };
    const organizationId = request.user?.organizationId;
    if (!organizationId) return reply.code(401).send({ error: "Not authenticated" });

    try {
      const catalog = await catalogLibrary.adoptTemplate(templateId, organizationId);
      reply.code(201);
      return catalog;
    } catch (err: any) {
      if (err.message?.includes("not found")) return reply.code(404).send({ error: err.message });
      request.log.error(err, "Failed to adopt catalog template");
      return reply.code(500).send({ error: "Failed to adopt catalog template" });
    }
  });
}
