import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { apiGet, apiPost, getProjectId } from "../api-client.js";

export function registerEstimateTools(server: McpServer) {
  server.tool(
    "getEstimateStrategy",
    "Get the persisted estimate strategy for the current revision, including scope graph, execution plan, benchmarks, reconcile output, and calibration feedback.",
    {},
    async () => {
      const data = await apiGet<{ strategy: Record<string, unknown> | null; feedback: Array<Record<string, unknown>> }>(`/api/estimate/${getProjectId()}/strategy`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "saveEstimateScopeGraph",
    "Persist the structured scope graph after document review. Call before creating worksheets or assigning labour hours.",
    {
      scopeItems: z.array(z.object({
        id: z.string(),
        name: z.string(),
        kind: z.string(),
        sourceRefs: z.array(z.string()).default([]),
        quantityBasis: z.string().optional(),
        quantities: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
        included: z.boolean().default(true),
        uncertainty: z.string().optional(),
        confidence: z.enum(["high", "medium", "low"]).optional(),
      }).passthrough()),
      constraints: z.array(z.object({
        type: z.string(),
        description: z.string(),
        sourceRef: z.string().optional(),
        impact: z.string().optional(),
        confidence: z.enum(["high", "medium", "low"]).optional(),
      }).passthrough()).optional(),
      alternates: z.array(z.object({
        name: z.string(),
        description: z.string(),
        status: z.enum(["included", "excluded", "unclear"]).default("unclear"),
      }).passthrough()).optional(),
    },
    async (data) => {
      await apiPost(`/api/estimate/${getProjectId()}/strategy/section`, { section: "scopeGraph", data });
      return { content: [{ type: "text" as const, text: `Saved scope graph with ${data.scopeItems.length} scope items` }] };
    },
  );

  server.tool(
    "saveEstimateExecutionPlan",
    "Persist the execution model before detailed pricing. Capture self-perform/subcontract choices, access, crew strategy, duration basis, procurement, testing basis, and uncertainty flags.",
    {
      selfPerform: z.array(z.string()).optional(),
      subcontracted: z.array(z.string()).optional(),
      access: z.array(z.string()).optional(),
      crewStrategy: z.object({
        primaryCrew: z.string().optional(),
        concurrency: z.string().optional(),
        durationBasis: z.string().optional(),
        shifts: z.string().optional(),
        schedulePressure: z.string().optional(),
      }).passthrough(),
      procurement: z.object({
        owner: z.string().optional(),
        longLeadRisks: z.array(z.string()).optional(),
        shopFabrication: z.string().optional(),
        fieldInstallation: z.string().optional(),
        testing: z.string().optional(),
      }).passthrough().optional(),
      uncertaintyFlags: z.array(z.string()).optional(),
    },
    async (data) => {
      await apiPost(`/api/estimate/${getProjectId()}/strategy/section`, { section: "executionPlan", data });
      return { content: [{ type: "text" as const, text: "Saved execution plan" }] };
    },
  );

  server.tool(
    "saveEstimateAssumptions",
    "Persist explicit assumptions with confidence, evidence, impact, and confirmation needs.",
    {
      assumptions: z.array(z.object({
        id: z.string(),
        category: z.string(),
        statement: z.string(),
        confidence: z.enum(["high", "medium", "low"]),
        evidence: z.string().default(""),
        impact: z.string().default(""),
        needsUserConfirmation: z.boolean().default(false),
      }).passthrough()),
    },
    async ({ assumptions }) => {
      await apiPost(`/api/estimate/${getProjectId()}/strategy/section`, { section: "assumptions", data: assumptions });
      return { content: [{ type: "text" as const, text: `Saved ${assumptions.length} assumptions` }] };
    },
  );

  server.tool(
    "saveEstimatePackagePlan",
    "Persist the package/commercial structure before detailed pricing. Use this to decide how scope will be grouped and whether each package is detailed, subcontracted, or allowance-based.",
    {
      packages: z.array(z.object({
        id: z.string(),
        name: z.string(),
        rationale: z.string().default(""),
        scopeRefs: z.array(z.string()).default([]),
        pricingMode: z.enum(["detailed", "allowance", "subcontract", "historical_allowance"]),
        confidence: z.enum(["high", "medium", "low"]),
        hoursBasis: z.string().optional(),
      }).passthrough()),
    },
    async ({ packages }) => {
      await apiPost(`/api/estimate/${getProjectId()}/strategy/section`, { section: "packagePlan", data: packages });
      return { content: [{ type: "text" as const, text: `Saved package plan with ${packages.length} packages` }] };
    },
  );

  server.tool(
    "recomputeEstimateBenchmarks",
    "Compute historical benchmark comparisons from prior human quotes in the organization. Call before assigning detailed labour hours.",
    {},
    async () => {
      const data = await apiPost<any>(`/api/estimate/${getProjectId()}/benchmarks/recompute`);
      const strategy = data?.workspace?.estimateStrategy ?? null;
      const candidateCount = strategy?.benchmarkProfile?.candidateCount ?? 0;
      const actions = strategy?.benchmarkProfile?.suggestedActions?.length ?? 0;
      return { content: [{ type: "text" as const, text: `Benchmarks recomputed. Comparable jobs: ${candidateCount}. Suggested actions: ${actions}.` }] };
    },
  );

  server.tool(
    "saveEstimateAdjustments",
    "Record how benchmark findings should adjust the estimate approach. Use this to document which areas to keep, raise, lower, regroup, or convert to allowance/subcontract.",
    {
      adjustments: z.array(z.object({
        id: z.string(),
        area: z.string(),
        action: z.enum(["keep", "raise", "lower", "convert_to_allowance", "convert_to_subcontract", "regroup"]),
        rationale: z.string(),
        benchmarkRef: z.string().optional(),
        impact: z.string().optional(),
      }).passthrough()),
    },
    async ({ adjustments }) => {
      await apiPost(`/api/estimate/${getProjectId()}/strategy/section`, { section: "adjustmentPlan", data: adjustments });
      return { content: [{ type: "text" as const, text: `Saved ${adjustments.length} benchmark adjustments` }] };
    },
  );

  server.tool(
    "saveEstimateReconcile",
    "Persist the mandatory final self-review after all worksheets are populated. Capture omissions, outliers, duplicate scope, and final confidence.",
    {
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
    },
    async (data) => {
      await apiPost(`/api/estimate/${getProjectId()}/strategy/section`, { section: "reconcileReport", data });
      return { content: [{ type: "text" as const, text: `Saved final reconcile report with ${data.outliers.length} outliers` }] };
    },
  );

  server.tool(
    "finalizeEstimateStrategy",
    "Finalize the staged estimate workflow after reconcile is complete. Call this near the end of the estimate session.",
    {
      summary: z.record(z.unknown()),
    },
    async ({ summary }) => {
      await apiPost(`/api/estimate/${getProjectId()}/finalize`, summary);
      return { content: [{ type: "text" as const, text: "Estimate strategy finalized" }] };
    },
  );
}
