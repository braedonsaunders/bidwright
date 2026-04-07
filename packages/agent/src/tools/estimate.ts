import { z } from "zod";

import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";
import { apiFetch } from "./api-fetch.js";

type EstimateOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<ToolResult>;

function createEstimateTool(def: {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodType;
  tags: string[];
  mutates?: boolean;
}, operation: EstimateOperation): Tool {
  return {
    definition: {
      id: def.id,
      name: def.name,
      category: "quote",
      description: def.description,
      parameters: [],
      inputSchema: def.inputSchema,
      requiresConfirmation: false,
      mutates: def.mutates ?? false,
      tags: def.tags,
    },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext) {
      const start = Date.now();
      try {
        const result = await operation(context, input);
        return { ...result, duration_ms: Date.now() - start };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), duration_ms: Date.now() - start };
      }
    },
  };
}

function authHeaders(ctx: ToolExecutionContext): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ctx.authToken) headers.Authorization = `Bearer ${ctx.authToken}`;
  return headers;
}

async function estimateApiGet(ctx: ToolExecutionContext, path: string): Promise<ToolResult> {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/estimate/${ctx.projectId}${path}`, {
    method: "GET",
    headers: authHeaders(ctx),
  });
  if (!res.ok) {
    return { success: false, error: `API error: ${res.status} ${res.statusText}`, duration_ms: 0 };
  }
  const data = await res.json() as Record<string, unknown>;
  return { success: true, data, duration_ms: 0 };
}

async function estimateApiPost(
  ctx: ToolExecutionContext,
  path: string,
  body: Record<string, unknown>,
  sideEffect: string,
): Promise<ToolResult> {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/estimate/${ctx.projectId}${path}`, {
    method: "POST",
    headers: authHeaders(ctx),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    return {
      success: false,
      error: errorText || `API error: ${res.status} ${res.statusText}`,
      duration_ms: 0,
    };
  }
  const data = await res.json() as Record<string, unknown>;
  return { success: true, data, sideEffects: [sideEffect], duration_ms: 0 };
}

export const getEstimateStrategyTool = createEstimateTool({
  id: "quote.getEstimateStrategy",
  name: "Get Estimate Strategy",
  description: "Retrieve the persisted estimate strategy, benchmark state, and calibration feedback for the current revision.",
  inputSchema: z.object({}),
  tags: ["estimate", "strategy", "read"],
}, async (ctx) => {
  return estimateApiGet(ctx, "/strategy");
});

export const saveEstimateScopeGraphTool = createEstimateTool({
  id: "quote.saveEstimateScopeGraph",
  name: "Save Estimate Scope Graph",
  description: "Persist the structured scope graph before pricing work begins.",
  inputSchema: z.object({
    scopeGraph: z.record(z.unknown()).describe("Structured scope graph with systems, packages, quantities, and evidence."),
  }),
  tags: ["estimate", "strategy", "write"],
  mutates: true,
}, async (ctx, input) => {
  return estimateApiPost(ctx, "/strategy/section", {
    section: "scopeGraph",
    data: input.scopeGraph,
  }, "Saved estimate scope graph");
});

export const saveEstimateExecutionPlanTool = createEstimateTool({
  id: "quote.saveEstimateExecutionPlan",
  name: "Save Estimate Execution Plan",
  description: "Lock the execution model before assigning hours or costs.",
  inputSchema: z.object({
    executionPlan: z.record(z.unknown()).describe("Execution model covering self-perform/subcontract, crews, duration, access, and procurement."),
  }),
  tags: ["estimate", "strategy", "write"],
  mutates: true,
}, async (ctx, input) => {
  return estimateApiPost(ctx, "/strategy/section", {
    section: "executionPlan",
    data: input.executionPlan,
  }, "Saved estimate execution plan");
});

export const saveEstimateAssumptionsTool = createEstimateTool({
  id: "quote.saveEstimateAssumptions",
  name: "Save Estimate Assumptions",
  description: "Persist explicit assumptions with confidence and evidence status.",
  inputSchema: z.object({
    assumptions: z.array(z.record(z.unknown())).describe("List of structured assumptions, one object per assumption."),
  }),
  tags: ["estimate", "assumptions", "write"],
  mutates: true,
}, async (ctx, input) => {
  return estimateApiPost(ctx, "/strategy/section", {
    section: "assumptions",
    data: input.assumptions,
  }, "Saved estimate assumptions");
});

export const saveEstimatePackagePlanTool = createEstimateTool({
  id: "quote.saveEstimatePackagePlan",
  name: "Save Estimate Package Plan",
  description: "Define the commercial package structure before detailed pricing.",
  inputSchema: z.object({
    packagePlan: z.array(z.record(z.unknown())).describe("Commercial/package structure for the estimate."),
  }),
  tags: ["estimate", "packages", "write"],
  mutates: true,
}, async (ctx, input) => {
  return estimateApiPost(ctx, "/strategy/section", {
    section: "packagePlan",
    data: input.packagePlan,
  }, "Saved estimate package plan");
});

export const recomputeEstimateBenchmarksTool = createEstimateTool({
  id: "quote.recomputeEstimateBenchmarks",
  name: "Recompute Estimate Benchmarks",
  description: "Compare the current revision to historical human quotes and refresh benchmark outliers.",
  inputSchema: z.object({}),
  tags: ["estimate", "benchmarks", "write"],
  mutates: true,
}, async (ctx) => {
  return estimateApiPost(ctx, "/benchmarks/recompute", {}, "Recomputed estimate benchmarks");
});

export const saveEstimateAdjustmentsTool = createEstimateTool({
  id: "quote.saveEstimateAdjustments",
  name: "Save Estimate Adjustments",
  description: "Persist benchmark-driven or reviewer-driven adjustment decisions.",
  inputSchema: z.object({
    adjustmentPlan: z.array(z.record(z.unknown())).describe("List of pricing or packaging adjustments after benchmark review."),
  }),
  tags: ["estimate", "benchmarks", "write"],
  mutates: true,
}, async (ctx, input) => {
  return estimateApiPost(ctx, "/strategy/section", {
    section: "adjustmentPlan",
    data: input.adjustmentPlan,
  }, "Saved estimate adjustments");
});

export const saveEstimateReconcileTool = createEstimateTool({
  id: "quote.saveEstimateReconcile",
  name: "Save Estimate Reconcile",
  description: "Persist the final reconcile and review summary before completion.",
  inputSchema: z.object({
    reconcileReport: z.record(z.unknown()).describe("Final reconcile report covering bucket shifts, outliers, and residual risks."),
  }),
  tags: ["estimate", "review", "write"],
  mutates: true,
}, async (ctx, input) => {
  return estimateApiPost(ctx, "/strategy/section", {
    section: "reconcileReport",
    data: input.reconcileReport,
  }, "Saved estimate reconcile report");
});

export const finalizeEstimateStrategyTool = createEstimateTool({
  id: "quote.finalizeEstimateStrategy",
  name: "Finalize Estimate Strategy",
  description: "Mark the estimate strategy complete after reconciliation and review.",
  inputSchema: z.object({
    summary: z.record(z.unknown()).describe("Completion summary for the strategy lifecycle."),
  }),
  tags: ["estimate", "review", "write"],
  mutates: true,
}, async (ctx, input) => {
  return estimateApiPost(ctx, "/finalize", input.summary as Record<string, unknown>, "Finalized estimate strategy");
});

export const estimateTools: Tool[] = [
  getEstimateStrategyTool,
  saveEstimateScopeGraphTool,
  saveEstimateExecutionPlanTool,
  saveEstimateAssumptionsTool,
  saveEstimatePackagePlanTool,
  recomputeEstimateBenchmarksTool,
  saveEstimateAdjustmentsTool,
  saveEstimateReconcileTool,
  finalizeEstimateStrategyTool,
];
