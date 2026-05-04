import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { access, readFile, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { costIntelligenceService } from "../services/cost-intelligence-service.js";
import { isRegisteredRuntime, spawnSession, tryGetAdapter, type AgentRuntime } from "../services/cli-runtime.js";
import { getSessionCookieToken } from "../services/session-cookie.js";
import { resolveApiPath } from "../paths.js";

const listQuerySchema = z.object({
  q: z.string().optional(),
  resourceId: z.string().optional(),
  projectId: z.string().optional(),
  sourceDocumentId: z.string().optional(),
  vendorName: z.string().optional(),
  scope: z.enum(["aggregate", "per_vendor", "all"]).optional(),
  limit: z.coerce.number().int().positive().max(50000).optional(),
});

const resourceSchema = z.object({
  catalogItemId: z.string().nullable().optional(),
  resourceType: z.string().trim().min(1).optional(),
  category: z.string().optional(),
  code: z.string().optional(),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  manufacturer: z.string().optional(),
  manufacturerPartNumber: z.string().optional(),
  defaultUom: z.string().trim().min(1).optional(),
  aliases: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
});

const observationSchema = z.object({
  resourceId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  sourceDocumentId: z.string().nullable().optional(),
  vendorName: z.string().optional(),
  vendorSku: z.string().optional(),
  documentType: z.string().optional(),
  observedAt: z.string().datetime().nullable().optional(),
  effectiveDate: z.string().nullable().optional(),
  quantity: z.coerce.number().finite().positive().optional(),
  observedUom: z.string().min(1).optional(),
  unitCost: z.coerce.number().finite().nonnegative(),
  unitPrice: z.coerce.number().finite().nonnegative().nullable().optional(),
  currency: z.string().min(3).max(3).optional(),
  freight: z.coerce.number().finite().nonnegative().optional(),
  tax: z.coerce.number().finite().nonnegative().optional(),
  discount: z.coerce.number().finite().nonnegative().optional(),
  confidence: z.coerce.number().finite().min(0).max(1).optional(),
  fingerprint: z.string().optional(),
  sourceRef: z.record(z.unknown()).optional(),
  rawText: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const recomputeSchema = z.object({
  resourceId: z.string().min(1),
  projectId: z.string().nullable().optional(),
  vendorName: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  targetUom: z.string().nullable().optional(),
  currency: z.string().min(3).max(3).nullable().optional(),
  method: z.enum(["latest_observation", "weighted_average"]).optional(),
  asOf: z.string().datetime().nullable().optional(),
  lookbackDays: z.coerce.number().int().positive().nullable().optional(),
  minConfidence: z.coerce.number().finite().min(0).max(1).nullable().optional(),
});

const effectiveCostManualSchema = z.object({
  resourceId: z.string().nullable().optional(),
  resourceName: z.string().trim().min(1).optional(),
  resourceType: z.string().trim().min(1).optional(),
  category: z.string().optional(),
  code: z.string().optional(),
  defaultUom: z.string().trim().min(1).optional(),
  projectId: z.string().nullable().optional(),
  vendorName: z.string().optional(),
  region: z.string().optional(),
  uom: z.string().trim().min(1).optional(),
  unitCost: z.coerce.number().finite().nonnegative(),
  unitPrice: z.coerce.number().finite().nonnegative().nullable().optional(),
  currency: z.string().min(3).max(3).optional(),
  effectiveDate: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  method: z.enum(["manual", "contract"]).optional(),
  sampleSize: z.coerce.number().int().nonnegative().optional(),
  confidence: z.coerce.number().finite().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const effectiveCostPatchSchema = effectiveCostManualSchema
  .omit({ unitCost: true, method: true })
  .extend({
    unitCost: z.coerce.number().finite().nonnegative().optional(),
    method: z.enum(["latest_observation", "weighted_average", "manual", "contract"]).optional(),
  })
  .partial();

const effectiveCostBulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

const candidateApprovalSchema = z.object({
  batchId: z.string().min(1),
  entrySurface: z.string().optional(),
  candidates: z.array(z.record(z.unknown())),
});

const agentReviewSchema = z.object({
  batchId: z.string().min(1),
  force: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean().optional()),
});

const reviewRunListSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const reviewRunParamsSchema = z.object({
  batchId: z.string().regex(/^pcana-[A-Za-z0-9-]+$/),
});

export async function costIntelligenceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/cost-intelligence/vendor-pdfs/review-runs", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const parsed = reviewRunListSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return costIntelligenceService.listVendorPdfReviewRuns(organizationId, {
        limit: parsed.data.limit,
      });
    } catch (err: any) {
      request.log.error(err, "Cost evidence review history failed");
      return sendServiceError(reply, err);
    }
  });

  app.get("/api/cost-intelligence/vendor-pdfs/review-runs/:batchId", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const parsed = reviewRunParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return costIntelligenceService.getVendorPdfReviewRun(organizationId, parsed.data.batchId);
    } catch (err: any) {
      request.log.error(err, "Cost evidence review run restore failed");
      return sendServiceError(reply, err);
    }
  });

  app.delete("/api/cost-intelligence/vendor-pdfs/review-runs/:batchId", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const parsed = reviewRunParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return costIntelligenceService.deleteVendorPdfReviewRun(organizationId, parsed.data.batchId);
    } catch (err: any) {
      request.log.error(err, "Cost evidence review run delete failed");
      return sendServiceError(reply, err);
    }
  });

  app.post("/api/cost-intelligence/vendor-pdfs/analyze", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;

    try {
      const parts = request.parts();
      const files: Array<{ buffer: Buffer; filename: string; mimeType?: string }> = [];
      const fields: Record<string, string> = {};

      for await (const part of parts) {
        if (part.type === "file") {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk);
          files.push({
            buffer: Buffer.concat(chunks),
            filename: part.filename ?? "vendor-evidence.pdf",
            mimeType: part.mimetype,
          });
        } else {
          fields[part.fieldname] = String((part as unknown as { value?: unknown }).value ?? "");
        }
      }

      if (files.length === 0) {
        return reply.code(400).send({ error: "At least one vendor PDF file is required" });
      }

      const settings = await request.store?.getSettings().catch(() => null);
      const integrations = (settings as any)?.integrations ?? {};
      const defaultCurrency = String((settings as any)?.defaults?.currency ?? "USD").trim().toUpperCase().slice(0, 3) || "USD";
      const azureConfig = {
        endpoint: process.env.AZURE_DI_ENDPOINT ?? integrations.azureDiEndpoint ?? "",
        key: process.env.AZURE_DI_KEY ?? integrations.azureDiKey ?? "",
      };

      return costIntelligenceService.analyzeVendorPdfEvidence(organizationId, files, {
        azureConfig,
        defaultCurrency,
        entrySurface: fields.entrySurface || "library.cost_intelligence.vendor_pdf_review",
      });
    } catch (err: any) {
      request.log.error(err, "Cost evidence analysis failed");
      return reply.code(500).send({ error: err?.message ?? "Cost evidence analysis failed" });
    }
  });

  app.post("/api/cost-intelligence/spreadsheets/analyze", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;

    try {
      const parts = request.parts();
      const files: Array<{ buffer: Buffer; filename: string; mimeType?: string }> = [];
      const fields: Record<string, string> = {};

      for await (const part of parts) {
        if (part.type === "file") {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk);
          files.push({
            buffer: Buffer.concat(chunks),
            filename: part.filename ?? "cost-evidence.xlsx",
            mimeType: part.mimetype,
          });
        } else {
          fields[part.fieldname] = String((part as unknown as { value?: unknown }).value ?? "");
        }
      }

      if (files.length === 0) {
        return reply.code(400).send({ error: "At least one CSV or Excel file is required" });
      }

      const settings = await request.store?.getSettings().catch(() => null);
      const defaultCurrency = String((settings as any)?.defaults?.currency ?? "USD").trim().toUpperCase().slice(0, 3) || "USD";

      return costIntelligenceService.analyzeSpreadsheetEvidence(organizationId, files, {
        defaultCurrency,
        entrySurface: fields.entrySurface || "library.cost_intelligence.spreadsheet_review",
      });
    } catch (err: any) {
      request.log.error(err, "Cost spreadsheet analysis failed");
      return reply.code(500).send({ error: err?.message ?? "Cost spreadsheet analysis failed" });
    }
  });

  app.post("/api/cost-intelligence/vendor-pdfs/approve", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const parsed = candidateApprovalSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return costIntelligenceService.approveVendorPdfCandidates(
        organizationId,
        parsed.data.batchId,
        parsed.data.candidates as any,
        { entrySurface: parsed.data.entrySurface },
      );
    } catch (err: any) {
      request.log.error(err, "Cost evidence approval failed");
      return sendServiceError(reply, err);
    }
  });

  app.post("/api/cost-intelligence/vendor-pdfs/agent-review", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const parsed = agentReviewSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const batchId = parsed.data.batchId;
    const reviewFolder = resolveApiPath("cost-intelligence", "review-runs", batchId);
    try {
      await access(resolve(reviewFolder, "candidate-review.json"));
      if (parsed.data.force) {
        await rm(resolve(reviewFolder, "agent-reviewed-candidates.json"), { force: true });
      }
      const settings = await request.store?.getSettings().catch(() => null);
      const integrations = ((settings as any)?.integrations ?? {}) as Record<string, unknown>;
      const runtime = resolveCostAgentRuntime(integrations);
      const adapter = tryGetAdapter(runtime);
      if (!adapter) return reply.code(400).send({ error: `No CLI runtime is registered for ${runtime}` });

      const prompt = [
        `Read ${adapter.primaryInstructionFile} now.`,
        "Use this folder as the complete cost-intelligence review workspace.",
        "Inspect `candidate-review.json`, `extractions/`, and the uploaded source files under `originals/`.",
        "Write `agent-reviewed-candidates.json` with grouped, deduped, generalized candidate decisions.",
        "Approve only candidates with a human-readable product/service name; leave UPC/SKU/barcode/part-number-only rows discarded or pending.",
        "Never approve subtotal, total, tax, freight, shipping, payment, balance, account-code, or document-metadata rows.",
        "Do not write database rows or call approval APIs. The UI approval step is the commit gate.",
      ].join("\n");
      const sessionProjectId = `cost-intelligence-${batchId}`;
      const session = await spawnSession({
        projectId: sessionProjectId,
        projectDir: reviewFolder,
        prompt,
        runtime,
        model: adapter.normalizeModel(typeof integrations.agentModel === "string" ? integrations.agentModel : undefined),
        reasoningEffort: typeof integrations.agentReasoningEffort === "string" ? integrations.agentReasoningEffort : "extra_high",
        authToken: extractAuthToken(request),
        apiBaseUrl: `http://localhost:${process.env.API_PORT || 4001}`,
        customCliPath: resolveCostAgentCliPath(runtime, integrations),
        ...buildCostAgentApiKeys(integrations),
      });

      return {
        batchId,
        organizationId,
        runtime,
        sessionProjectId,
        sessionId: session.sessionId,
        status: session.status,
        reviewFolder,
        outputFile: resolve(reviewFolder, "agent-reviewed-candidates.json"),
      };
    } catch (err: any) {
      request.log.error(err, "Cost evidence agent review failed to start");
      return reply.code(500).send({ error: err?.message ?? "Cost evidence agent review failed to start" });
    }
  });

  app.get("/api/cost-intelligence/vendor-pdfs/agent-review-output", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const parsed = agentReviewSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const batchId = parsed.data.batchId;
    const outputFile = resolveApiPath("cost-intelligence", "review-runs", batchId, "agent-reviewed-candidates.json");
    try {
      const [fileStat, raw] = await Promise.all([stat(outputFile), readFile(outputFile, "utf-8")]);
      const parsedOutput = JSON.parse(raw);
      const candidates = Array.isArray(parsedOutput) ? parsedOutput : parsedOutput?.candidates;
      if (!Array.isArray(candidates)) {
        return reply.code(422).send({ error: "agent-reviewed-candidates.json must contain a candidates array" });
      }
      return {
        batchId,
        found: true,
        updatedAt: fileStat.mtime.toISOString(),
        candidates: costIntelligenceService.sanitizeVendorPdfReviewCandidates(candidates as any),
      };
    } catch (err: any) {
      if (err?.code === "ENOENT") return { batchId, found: false, candidates: [] };
      request.log.error(err, "Cost evidence agent review output read failed");
      return reply.code(500).send({ error: err?.message ?? "Cost evidence agent review output read failed" });
    }
  });

  app.post("/api/cost-intelligence/vendor-pdfs/ingest", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;

    try {
      const parts = request.parts();
      const files: Array<{ buffer: Buffer; filename: string; mimeType?: string }> = [];
      const fields: Record<string, string> = {};

      for await (const part of parts) {
        if (part.type === "file") {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk);
          files.push({
            buffer: Buffer.concat(chunks),
            filename: part.filename ?? "vendor-evidence.pdf",
            mimeType: part.mimetype,
          });
        } else {
          fields[part.fieldname] = String((part as unknown as { value?: unknown }).value ?? "");
        }
      }

      if (files.length === 0) {
        return reply.code(400).send({ error: "At least one vendor PDF file is required" });
      }

      const settings = await request.store?.getSettings().catch(() => null);
      const integrations = (settings as any)?.integrations ?? {};
      const defaultCurrency = String((settings as any)?.defaults?.currency ?? "USD").trim().toUpperCase().slice(0, 3) || "USD";
      const azureConfig = {
        endpoint: process.env.AZURE_DI_ENDPOINT ?? integrations.azureDiEndpoint ?? "",
        key: process.env.AZURE_DI_KEY ?? integrations.azureDiKey ?? "",
      };

      // Legacy endpoint kept for older clients, but it no longer writes rows.
      // PDF evidence must be staged as candidates and explicitly approved.
      return costIntelligenceService.analyzeVendorPdfEvidence(organizationId, files, {
        azureConfig,
        defaultCurrency,
        entrySurface: fields.entrySurface || "library.cost_intelligence.vendor_pdf_review",
      });
    } catch (err: any) {
      request.log.error(err, "Cost evidence ingestion failed");
      return reply.code(500).send({ error: err?.message ?? "Cost evidence ingestion failed" });
    }
  });

  app.get("/api/cost-intelligence/vendors", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return costIntelligenceService.listVendors(organizationId, {
      query: parsed.data.q,
      vendorName: parsed.data.vendorName,
      limit: parsed.data.limit,
    });
  });

  app.get("/api/cost-intelligence/summary", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    return costIntelligenceService.getSummary(organizationId);
  });

  app.get("/api/cost-intelligence/resources", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return costIntelligenceService.listResources(organizationId, {
      query: parsed.data.q,
      limit: parsed.data.limit,
    });
  });

  app.post("/api/cost-intelligence/resources", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const parsed = resourceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const created = await costIntelligenceService.createResource(organizationId, parsed.data);
      reply.code(201);
      return created;
    } catch (err: any) {
      return sendServiceError(reply, err);
    }
  });

  app.get("/api/cost-intelligence/resources/:resourceId", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const { resourceId } = request.params as { resourceId: string };
    const resource = await costIntelligenceService.getResource(organizationId, resourceId);
    if (!resource) return reply.code(404).send({ error: `Resource ${resourceId} not found` });
    return resource;
  });

  app.get("/api/cost-intelligence/observations", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return costIntelligenceService.listObservations(organizationId, {
      resourceId: parsed.data.resourceId,
      projectId: parsed.data.projectId,
      sourceDocumentId: parsed.data.sourceDocumentId,
      vendorName: parsed.data.vendorName,
      limit: parsed.data.limit,
    });
  });

  app.post("/api/cost-intelligence/observations", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const parsed = observationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const created = await costIntelligenceService.createObservation(organizationId, parsed.data);
      reply.code(201);
      return created;
    } catch (err: any) {
      return sendServiceError(reply, err);
    }
  });

  app.get("/api/cost-intelligence/effective-costs", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return costIntelligenceService.listEffectiveCosts(organizationId, {
      query: parsed.data.q,
      resourceId: parsed.data.resourceId,
      projectId: parsed.data.projectId,
      vendorName: parsed.data.vendorName,
      scope: parsed.data.scope,
      limit: parsed.data.limit,
    });
  });

  app.post("/api/cost-intelligence/effective-costs", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const parsed = effectiveCostManualSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const created = await costIntelligenceService.createEffectiveCost(organizationId, parsed.data);
      reply.code(201);
      return created;
    } catch (err: any) {
      return sendServiceError(reply, err);
    }
  });

  app.post("/api/cost-intelligence/effective-costs/recompute", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const parsed = recomputeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const effectiveCost = await costIntelligenceService.recomputeEffectiveCost(organizationId, parsed.data);
      if (!effectiveCost) return reply.code(404).send({ error: "No matching cost observations found" });
      return effectiveCost;
    } catch (err: any) {
      return sendServiceError(reply, err);
    }
  });

  app.patch("/api/cost-intelligence/effective-costs/:effectiveCostId", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const { effectiveCostId } = request.params as { effectiveCostId: string };
    const parsed = effectiveCostPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return await costIntelligenceService.updateEffectiveCost(organizationId, effectiveCostId, parsed.data);
    } catch (err: any) {
      return sendServiceError(reply, err);
    }
  });

  app.delete("/api/cost-intelligence/effective-costs/bulk", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const parsed = effectiveCostBulkDeleteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return await costIntelligenceService.deleteEffectiveCosts(organizationId, parsed.data.ids);
    } catch (err: any) {
      return sendServiceError(reply, err);
    }
  });

  app.delete("/api/cost-intelligence/effective-costs/:effectiveCostId", async (request, reply) => {
    const organizationId = requireOrganization(request, reply);
    if (!organizationId) return;
    const { effectiveCostId } = request.params as { effectiveCostId: string };
    try {
      return await costIntelligenceService.deleteEffectiveCost(organizationId, effectiveCostId);
    } catch (err: any) {
      return sendServiceError(reply, err);
    }
  });
}

function requireOrganization(request: FastifyRequest, reply: FastifyReply): string | null {
  const organizationId = request.user?.organizationId;
  if (!organizationId) {
    reply.code(401).send({ error: "Organization context is required" });
    return null;
  }
  return organizationId;
}

function extractAuthToken(request: FastifyRequest): string {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const cookieToken = getSessionCookieToken(request);
  if (cookieToken) return cookieToken;
  return (request.query as any)?.token || "";
}

function resolveCostAgentRuntime(integrations: Record<string, unknown>): AgentRuntime {
  const configured = typeof integrations.agentRuntime === "string" ? integrations.agentRuntime : "";
  if (configured && isRegisteredRuntime(configured)) return configured;
  if (isRegisteredRuntime("codex")) return "codex";
  if (isRegisteredRuntime("claude-code")) return "claude-code";
  return configured || "codex";
}

function resolveCostAgentCliPath(runtime: AgentRuntime, integrations: Record<string, unknown>) {
  const adapter = tryGetAdapter(runtime);
  const value = adapter?.pathSettingKey ? integrations[adapter.pathSettingKey] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildCostAgentApiKeys(integrations: Record<string, unknown>) {
  return {
    anthropicApiKey:
      (integrations.anthropicKey as string) || process.env.ANTHROPIC_API_KEY || undefined,
    openaiApiKey:
      (integrations.openaiKey as string) || process.env.OPENAI_API_KEY || undefined,
    googleApiKey:
      (integrations.geminiKey as string) ||
      process.env.GOOGLE_API_KEY ||
      process.env.GEMINI_API_KEY ||
      undefined,
    openrouterApiKey:
      (integrations.openrouterKey as string) || process.env.OPENROUTER_API_KEY || undefined,
  };
}

function sendServiceError(reply: FastifyReply, err: any) {
  const message = err?.message ?? "Internal error";
  const status = message.includes("not found") ? 404 : 500;
  return reply.code(status).send({ error: message });
}
