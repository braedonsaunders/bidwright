import type { FastifyInstance } from "fastify";
import { catalogLibrary } from "../prisma-store.js";
import {
  analyzeImport,
  materialiseRows,
  type ColumnMapping,
  type SpreadsheetTable,
} from "../services/catalog-import-service.js";

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

  // ── AI-assisted bulk import (CSV / XLSX / PDF) ──────────────────────

  // POST /api/catalogs/import/analyze — multipart file upload
  // Returns the parsed tables, AI-suggested column mapping, and detected kind.
  app.post("/api/catalogs/import/analyze", async (request, reply) => {
    try {
      const parts = request.parts();
      let buffer: Buffer | undefined;
      let filename = "";
      let mimeType = "";
      for await (const part of parts) {
        if (part.type === "file") {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk);
          buffer = Buffer.concat(chunks);
          filename = part.filename ?? "upload";
          mimeType = part.mimetype ?? "";
        }
      }
      if (!buffer || buffer.length === 0) {
        return reply.code(400).send({ error: "No file provided" });
      }
      const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
      const provider = process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : "anthropic";
      const model = process.env.LLM_MODEL ?? (provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o");

      const analysis = await analyzeImport({
        buffer,
        filename,
        mimeType,
        aiConfig: apiKey ? { provider, apiKey, model } : undefined,
      });
      return analysis;
    } catch (err: any) {
      request.log.error(err, "Catalog import analyze failed");
      return reply.code(500).send({ error: err?.message ?? "Analyze failed" });
    }
  });

  // POST /api/catalogs/:catalogId/import/commit
  // Body: { table: SpreadsheetTable, mapping: ColumnMapping, defaultCategory?: string }
  app.post("/api/catalogs/:catalogId/import/commit", async (request, reply) => {
    const { catalogId } = request.params as { catalogId: string };
    const body = (request.body ?? {}) as { table?: SpreadsheetTable; mapping?: ColumnMapping; defaultCategory?: string };
    if (!body.table || !body.mapping) {
      return reply.code(400).send({ error: "table and mapping are required" });
    }
    try {
      const { candidates, skipped } = materialiseRows(body.table, body.mapping);
      const final = candidates.map((c) => ({
        ...c,
        category: c.category || body.defaultCategory || "",
      }));
      const result = await request.store!.bulkCreateCatalogItems(catalogId, final);
      reply.code(201);
      return { ...result, skipped, total: candidates.length + skipped };
    } catch (err: any) {
      const status = err?.message?.includes("not found") ? 404 : 500;
      return reply.code(status).send({ error: err?.message ?? "Commit failed" });
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
