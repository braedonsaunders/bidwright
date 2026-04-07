import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { buildWorkspaceResponse } from "../server.js";

const confidenceSchema = z.enum(["high", "medium", "low"]).optional();

const scopeGraphSchema = z.object({
  scopeItems: z.array(z.object({
    id: z.string(),
    name: z.string(),
    kind: z.string(),
    sourceRefs: z.array(z.string()).default([]),
    quantityBasis: z.string().optional(),
    quantities: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    included: z.boolean().default(true),
    uncertainty: z.string().optional(),
    confidence: confidenceSchema,
  }).passthrough()).default([]),
  constraints: z.array(z.object({
    type: z.string(),
    description: z.string(),
    sourceRef: z.string().optional(),
    impact: z.string().optional(),
    confidence: confidenceSchema,
  }).passthrough()).default([]),
  alternates: z.array(z.object({
    name: z.string(),
    description: z.string(),
    status: z.enum(["included", "excluded", "unclear"]).default("unclear"),
  }).passthrough()).default([]),
}).passthrough();

const executionPlanSchema = z.object({
  selfPerform: z.array(z.string()).default([]),
  subcontracted: z.array(z.string()).default([]),
  access: z.array(z.string()).default([]),
  crewStrategy: z.object({
    primaryCrew: z.string().default(""),
    concurrency: z.string().default(""),
    durationBasis: z.string().default(""),
    shifts: z.string().default(""),
    schedulePressure: z.string().default(""),
  }).passthrough().default({}),
  procurement: z.object({
    owner: z.string().optional(),
    longLeadRisks: z.array(z.string()).default([]),
    shopFabrication: z.string().optional(),
    fieldInstallation: z.string().optional(),
    testing: z.string().optional(),
  }).passthrough().default({}),
  uncertaintyFlags: z.array(z.string()).default([]),
}).passthrough();

const assumptionsSchema = z.array(z.object({
  id: z.string(),
  category: z.string(),
  statement: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  evidence: z.string().default(""),
  impact: z.string().default(""),
  needsUserConfirmation: z.boolean().default(false),
}).passthrough());

const packagePlanSchema = z.array(z.object({
  id: z.string(),
  name: z.string(),
  rationale: z.string().default(""),
  scopeRefs: z.array(z.string()).default([]),
  pricingMode: z.enum(["detailed", "allowance", "subcontract", "historical_allowance"]),
  confidence: z.enum(["high", "medium", "low"]),
  hoursBasis: z.string().optional(),
}).passthrough());

const adjustmentPlanSchema = z.array(z.object({
  id: z.string(),
  area: z.string(),
  action: z.enum(["keep", "raise", "lower", "convert_to_allowance", "convert_to_subcontract", "regroup"]),
  rationale: z.string(),
  benchmarkRef: z.string().optional(),
  impact: z.string().optional(),
}).passthrough());

const reconcileReportSchema = z.object({
  coverageChecks: z.array(z.object({
    name: z.string(),
    status: z.enum(["ok", "warning", "missing"]),
    notes: z.string().optional(),
  }).passthrough()).default([]),
  outliers: z.array(z.object({
    area: z.string(),
    metric: z.string(),
    currentValue: z.union([z.string(), z.number(), z.record(z.unknown())]),
    benchmarkValue: z.union([z.string(), z.number(), z.record(z.unknown())]).optional(),
    assessment: z.string(),
    action: z.string(),
  }).passthrough()).default([]),
  duplicates: z.array(z.object({
    area: z.string(),
    description: z.string(),
    action: z.string(),
  }).passthrough()).default([]),
  summary: z.object({
    confidence: z.enum(["high", "medium", "low"]),
    majorRisks: z.array(z.string()).default([]),
    completionNotes: z.string().default(""),
  }).passthrough(),
}).passthrough();

const summarySchema = z.record(z.unknown());

const feedbackSchema = z.object({
  source: z.string().optional(),
  feedbackType: z.string().optional(),
  sourceLabel: z.string().default(""),
  humanSnapshot: z.record(z.unknown()),
  corrections: z.array(z.record(z.unknown())).default([]),
  lessons: z.array(z.record(z.unknown())).default([]),
  notes: z.string().default(""),
  quoteReviewId: z.string().nullable().optional(),
});

export async function estimateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/estimate/:projectId/strategy", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const store = request.store!;
    const [strategy, feedback] = await Promise.all([
      store.getEstimateStrategy(projectId),
      store.listEstimateFeedback(projectId),
    ]);
    return { strategy, feedback };
  });

  app.post("/api/estimate/:projectId/strategy/section", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = z.object({
      section: z.enum(["scopeGraph", "executionPlan", "assumptions", "packagePlan", "adjustmentPlan", "reconcileReport", "summary"]),
      data: z.unknown(),
      aiRunId: z.string().nullable().optional(),
      personaId: z.string().nullable().optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    let sectionData: Record<string, unknown> | Array<Record<string, unknown>>;
    switch (parsed.data.section) {
      case "scopeGraph":
        sectionData = scopeGraphSchema.parse(parsed.data.data) as Record<string, unknown>;
        break;
      case "executionPlan":
        sectionData = executionPlanSchema.parse(parsed.data.data) as Record<string, unknown>;
        break;
      case "assumptions":
        sectionData = assumptionsSchema.parse(parsed.data.data) as Array<Record<string, unknown>>;
        break;
      case "packagePlan":
        sectionData = packagePlanSchema.parse(parsed.data.data) as Array<Record<string, unknown>>;
        break;
      case "adjustmentPlan":
        sectionData = adjustmentPlanSchema.parse(parsed.data.data) as Array<Record<string, unknown>>;
        break;
      case "reconcileReport":
        sectionData = reconcileReportSchema.parse(parsed.data.data) as Record<string, unknown>;
        break;
      case "summary":
        sectionData = summarySchema.parse(parsed.data.data);
        break;
      default:
        return reply.code(400).send({ error: "Unsupported strategy section" });
    }

    const strategy = await request.store!.saveEstimateStrategySection(projectId, {
      section: parsed.data.section,
      data: sectionData,
      aiRunId: parsed.data.aiRunId ?? null,
      personaId: parsed.data.personaId ?? null,
    });
    return {
      ok: true,
      strategyId: strategy.id,
      currentStage: strategy.currentStage,
      status: strategy.status,
    };
  });

  app.post("/api/estimate/:projectId/benchmarks/recompute", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    await request.store!.recomputeEstimateBenchmarks(projectId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) return reply.code(404).send({ error: "Project not found" });
    return payload;
  });

  app.post("/api/estimate/:projectId/finalize", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = summarySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await request.store!.finalizeEstimateStrategy(projectId, parsed.data);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) return reply.code(404).send({ error: "Project not found" });
    return payload;
  });

  app.post("/api/estimate/:projectId/feedback", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = feedbackSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await request.store!.createEstimateFeedback(projectId, parsed.data);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) return reply.code(404).send({ error: "Project not found" });
    return payload;
  });
}
