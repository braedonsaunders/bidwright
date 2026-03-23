import type { FastifyInstance } from "fastify";
import { datasetService } from "../services/dataset-service.js";
import { datasetLibrary } from "../prisma-store.js";

/**
 * Dataset generation API routes — Fastify plugin.
 *
 * Provides endpoints for AI-powered dataset generation from knowledge books,
 * schema suggestion, and data import.
 */
export async function datasetRoutes(app: FastifyInstance) {
  // ── POST /api/datasets/generate ─────────────────────────────────────
  // Generate a dataset from a knowledge book using LLM extraction.
  app.post("/api/datasets/generate", async (request, reply) => {
    try {
      const body = request.body as {
        bookId: string;
        datasetName: string;
        description?: string;
        category: string;
        columns: Array<{ key: string; name: string; type: string; unit?: string; description?: string }>;
        scope?: string;
        projectId?: string;
        sampleOnly?: boolean;
        sampleRows?: number;
      };

      if (!body.bookId) {
        return reply.code(400).send({ message: "bookId is required" });
      }
      if (!body.datasetName) {
        return reply.code(400).send({ message: "datasetName is required" });
      }
      if (!body.category) {
        return reply.code(400).send({ message: "category is required" });
      }
      if (!body.columns || !Array.isArray(body.columns) || body.columns.length === 0) {
        return reply.code(400).send({ message: "columns array is required and must not be empty" });
      }

      const result = await datasetService.generateFromBook({
        bookId: body.bookId,
        datasetName: body.datasetName,
        description: body.description,
        category: body.category as "labour_units" | "equipment_rates" | "material_prices" | "productivity" | "burden_rates" | "custom",
        columns: body.columns,
        scope: (body.scope as "global" | "project") ?? "global",
        projectId: body.projectId,
        sampleOnly: body.sampleOnly,
        sampleRows: body.sampleRows,
      }, request.store!);

      reply.code(201);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Return 404 for "not found" errors, 500 for everything else
      if (message.includes("not found")) {
        return reply.code(404).send({ message });
      }
      request.log.error(err, "Dataset generation failed");
      return reply.code(500).send({
        message: "Dataset generation failed",
        error: message,
      });
    }
  });

  // ── POST /api/datasets/suggest-schema ───────────────────────────────
  // Suggest a dataset schema based on knowledge book content.
  app.post("/api/datasets/suggest-schema", async (request, reply) => {
    try {
      const body = request.body as {
        bookId: string;
        purpose?: string;
      };

      if (!body.bookId) {
        return reply.code(400).send({ message: "bookId is required" });
      }

      const result = await datasetService.suggestSchema(body.bookId, body.purpose, request.store!);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        return reply.code(404).send({ message });
      }
      request.log.error(err, "Schema suggestion failed");
      return reply.code(500).send({
        message: "Schema suggestion failed",
        error: message,
      });
    }
  });

  // ── POST /api/datasets/:datasetId/import ────────────────────────────
  // Import CSV or JSON data into an existing dataset.
  app.post("/api/datasets/:datasetId/import", async (request, reply) => {
    try {
      const { datasetId } = request.params as { datasetId: string };
      const body = request.body as {
        format: "csv" | "json";
        data: string;
        skipHeader?: boolean;
      };

      if (!body.format || !["csv", "json"].includes(body.format)) {
        return reply.code(400).send({ message: "format must be 'csv' or 'json'" });
      }
      if (!body.data) {
        return reply.code(400).send({ message: "data is required" });
      }

      const result = await datasetService.importData(
        datasetId,
        body.format,
        body.data,
        body.skipHeader,
        request.store!,
      );

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        return reply.code(404).send({ message });
      }
      request.log.error(err, "Dataset import failed");
      return reply.code(500).send({
        message: "Import failed",
        error: message,
      });
    }
  });

  // ── Dataset Library (browse + adopt) ────────────────────────────────

  // GET /datasets/library — list available template datasets
  app.get("/datasets/library", async (request, reply) => {
    try {
      return await datasetLibrary.listTemplates();
    } catch (err) {
      request.log.error(err, "Failed to list dataset library");
      return reply.code(500).send({ error: "Failed to list dataset library" });
    }
  });

  // GET /datasets/library/:templateId — preview template with sample rows
  app.get("/datasets/library/:templateId", async (request, reply) => {
    const { templateId } = request.params as { templateId: string };
    try {
      const template = await datasetLibrary.getTemplate(templateId);
      if (!template) return reply.code(404).send({ error: "Template not found" });
      const { rows, total } = await datasetLibrary.getTemplateRows(templateId, 50, 0);
      return { ...template, rows, total };
    } catch (err) {
      request.log.error(err, "Failed to get dataset template");
      return reply.code(500).send({ error: "Failed to get dataset template" });
    }
  });

  // POST /datasets/library/:templateId/adopt — clone template into org
  app.post("/datasets/library/:templateId/adopt", async (request, reply) => {
    const { templateId } = request.params as { templateId: string };
    const organizationId = request.user?.organizationId;
    if (!organizationId) return reply.code(401).send({ error: "Not authenticated" });

    try {
      const dataset = await datasetLibrary.adoptTemplate(templateId, organizationId);
      reply.code(201);
      return dataset;
    } catch (err: any) {
      if (err.message?.includes("not found")) return reply.code(404).send({ error: err.message });
      request.log.error(err, "Failed to adopt dataset template");
      return reply.code(500).send({ error: "Failed to adopt dataset template" });
    }
  });
}
