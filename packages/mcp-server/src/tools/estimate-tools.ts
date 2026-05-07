import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { apiGet, apiPost, getProjectId } from "../api-client.js";

const ESTIMATE_STRATEGY_SECTIONS = [
  "scopeGraph",
  "executionPlan",
  "assumptions",
  "packagePlan",
  "benchmarkProfile",
  "benchmarkComparables",
  "adjustmentPlan",
  "reconcileReport",
  "confidenceSummary",
  "summary",
] as const;

type EstimateStrategySection = typeof ESTIMATE_STRATEGY_SECTIONS[number];

function truncateText(value: string, maxLength = 500) {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}

function asToolObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function asToolArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function compactForStrategyTool(value: unknown, options: { depth?: number; maxArray?: number; maxString?: number } = {}): unknown {
  const depth = options.depth ?? 0;
  const maxArray = options.maxArray ?? 8;
  const maxString = options.maxString ?? 500;
  if (typeof value === "string") return truncateText(value, maxString);
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) {
    const entries = value.slice(0, maxArray).map((entry) => compactForStrategyTool(entry, {
      depth: depth + 1,
      maxArray,
      maxString: Math.max(140, Math.floor(maxString * 0.8)),
    }));
    if (value.length > maxArray) entries.push({ omittedCount: value.length - maxArray });
    return entries;
  }
  if (depth >= 4) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 12).map(([key, child]) => [
      key,
      typeof child === "string" ? truncateText(child, 180) : Array.isArray(child) ? { count: child.length } : child,
    ]));
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 24).map(([key, child]) => [
    key,
    compactForStrategyTool(child, {
      depth: depth + 1,
      maxArray,
      maxString: Math.max(140, Math.floor(maxString * 0.9)),
    }),
  ]));
}

function summarizeScopeGraph(scopeGraphValue: unknown) {
  const scopeGraph = asToolObject(scopeGraphValue);
  const scopeItems = asToolArray(scopeGraph.scopeItems);
  const constraints = asToolArray(scopeGraph.constraints);
  const alternates = asToolArray(scopeGraph.alternates);
  const visualAudit = asToolObject(scopeGraph.visualTakeoffAudit);
  const drawingDrivenPackages = asToolArray(visualAudit.drawingDrivenPackages);

  return {
    scopeItemCount: scopeItems.length,
    scopeItems: scopeItems.slice(0, 16).map((itemValue) => {
      const item = asToolObject(itemValue);
      return {
        id: item.id,
        name: truncateText(String(item.name ?? ""), 140),
        kind: item.kind,
        confidence: item.confidence,
        sourceRefs: asToolArray(item.sourceRefs).slice(0, 8),
        quantityBasis: item.quantityBasis ? truncateText(String(item.quantityBasis), 220) : undefined,
        quantities: compactForStrategyTool(item.quantities, { maxString: 160, maxArray: 10 }),
      };
    }),
    constraintCount: constraints.length,
    alternateCount: alternates.length,
    visualTakeoffAudit: Object.keys(visualAudit).length === 0 ? null : {
      completedBeforePricing: visualAudit.completedBeforePricing === true,
      drawingDrivenPackageCount: drawingDrivenPackages.length,
      drawingDrivenPackages: drawingDrivenPackages.map((entryValue) => {
        const entry = asToolObject(entryValue);
        return {
          packageId: entry.packageId,
          packageName: entry.packageName,
          documentIds: asToolArray(entry.documentIds),
          renderedPages: asToolArray(entry.renderedPages).map((pageValue) => {
            const page = asToolObject(pageValue);
            return { documentId: page.documentId, pageNumber: page.pageNumber, observation: truncateText(String(page.observation ?? ""), 140) };
          }),
          zoomEvidence: asToolArray(entry.zoomEvidence).map((zoomValue) => {
            const zoom = asToolObject(zoomValue);
            return {
              documentId: zoom.documentId,
              pageNumber: zoom.pageNumber,
              region: zoom.region,
              observation: truncateText(String(zoom.observation ?? ""), 140),
            };
          }),
          tableEvidence: asToolArray(entry.tableEvidence).map((tableValue) => {
            const table = asToolObject(tableValue);
            return {
              documentId: table.documentId,
              pageNumber: table.pageNumber,
              regionId: table.regionId,
              tableName: table.tableName,
              rowRef: table.rowRef,
              observation: truncateText(String(table.observation ?? table.sourceText ?? ""), 140),
            };
          }),
          quantitiesValidated: asToolArray(entry.quantitiesValidated).slice(0, 12),
          unresolvedVisualRisks: asToolArray(entry.unresolvedVisualRisks).slice(0, 8),
        };
      }),
      notDrawingDrivenReason: visualAudit.notDrawingDrivenReason ? truncateText(String(visualAudit.notDrawingDrivenReason), 220) : undefined,
    },
  };
}

function summarizeDrawingEvidenceEngine(engineValue: unknown) {
  const engine = asToolObject(engineValue);
  const atlas = asToolObject(engine.atlas);
  const regions = asToolArray(atlas.regions);
  const pages = asToolArray(atlas.pages);
  const claims = asToolArray(engine.claims);
  const verifications = asToolArray(engine.verifications);
  const contradictions = asToolArray(engine.contradictions);
  const atlasDocumentRequests = asToolArray(engine.atlasDocumentRequests);
  const asyncEvidenceNotifications = asToolArray(engine.asyncEvidenceNotifications);

  return {
    atlas: Object.keys(atlas).length === 0 ? null : {
      status: atlas.status,
      builtAt: atlas.builtAt,
      documentCount: atlas.documentCount,
      pageCount: atlas.pageCount,
      regionCount: atlas.regionCount ?? regions.length,
      providerRegionCount: regions.filter((regionValue) => String(asToolObject(regionValue).regionType ?? "").startsWith("provider_")).length,
      cadRegionCount: regions.filter((regionValue) => String(asToolObject(regionValue).regionType ?? "").startsWith("cad_")).length,
      modelRegionCount: regions.filter((regionValue) => String(asToolObject(regionValue).regionType ?? "").startsWith("model_")).length,
      pages: pages.slice(0, 12).map((pageValue) => {
        const page = asToolObject(pageValue);
        return {
          documentId: page.documentId,
          pageNumber: page.pageNumber,
          sheetNumber: page.sheetNumber,
          sheetTitle: truncateText(String(page.sheetTitle ?? ""), 120),
          regionCount: page.regionCount,
        };
      }),
    },
    atlasDocumentRequestCount: atlasDocumentRequests.length,
    atlasDocumentRequests: atlasDocumentRequests.slice(0, 8).map((requestValue) => {
      const request = asToolObject(requestValue);
      return {
        id: request.id,
        documentId: request.documentId,
        sourceRole: request.sourceRole,
        status: request.status,
        reason: truncateText(String(request.reason ?? ""), 180),
      };
    }),
    claimCount: claims.length,
    claims: claims.slice(0, 12).map((claimValue) => {
      const claim = asToolObject(claimValue);
      const evidence = asToolArray(claim.evidence);
      return {
        id: claim.id,
        packageId: claim.packageId,
        quantityName: truncateText(String(claim.quantityName ?? claim.claim ?? ""), 160),
        method: claim.method,
        confidence: claim.confidence,
        evidenceCount: evidence.length,
        evidenceRefs: evidence.slice(0, 4).map((entryValue) => {
          const entry = asToolObject(entryValue);
          return {
            tool: entry.tool,
            documentId: entry.documentId,
            pageNumber: entry.pageNumber,
            regionId: entry.regionId,
            imageHash: entry.imageHash,
            sourceText: entry.sourceText ? truncateText(String(entry.sourceText), 160) : undefined,
          };
        }),
      };
    }),
    verificationCount: verifications.length,
    latestVerification: verifications.length > 0 ? compactForStrategyTool(verifications[0], { maxArray: 8, maxString: 220 }) : null,
    unresolvedContradictionCount: contradictions.filter((entryValue) =>
      !["resolved", "carried_assumption"].includes(String(asToolObject(entryValue).status ?? "").toLowerCase())
    ).length,
    asyncEvidenceNotificationCount: asyncEvidenceNotifications.length,
    latestAsyncEvidenceNotifications: asyncEvidenceNotifications.slice(0, 8).map((notificationValue) =>
      compactForStrategyTool(notificationValue, { maxArray: 4, maxString: 180 }),
    ),
  };
}

function summarizeStrategySummary(summaryValue: unknown) {
  const summary = asToolObject(summaryValue);
  const drawingEvidence = summarizeDrawingEvidenceEngine(summary.drawingEvidenceEngine);
  return {
    ...compactForStrategyTool(
      Object.fromEntries(Object.entries(summary).filter(([key]) => key !== "drawingEvidenceEngine")),
      { maxArray: 8, maxString: 260 },
    ) as Record<string, unknown>,
    drawingEvidenceEngine: drawingEvidence,
  };
}

function summarizeStrategyForTool(data: { strategy: Record<string, unknown> | null; feedback?: Array<Record<string, unknown>> }) {
  const strategy = data.strategy;
  if (!strategy) return { strategy: null, feedbackCount: data.feedback?.length ?? 0 };

  const sectionStatus = Object.fromEntries(ESTIMATE_STRATEGY_SECTIONS.map((section) => {
    const value = strategy[section];
    const populated = Array.isArray(value) ? value.length > 0 : Boolean(value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0);
    return [section, Array.isArray(value) ? { populated, count: value.length } : { populated }];
  }));

  return {
    strategy: {
      id: strategy.id,
      projectId: strategy.projectId,
      revisionId: strategy.revisionId,
      aiRunId: strategy.aiRunId ?? null,
      status: strategy.status,
      currentStage: strategy.currentStage,
      reviewRequired: strategy.reviewRequired,
      reviewCompleted: strategy.reviewCompleted,
      createdAt: strategy.createdAt,
      updatedAt: strategy.updatedAt,
      sectionStatus,
      scopeGraph: summarizeScopeGraph(strategy.scopeGraph),
      executionPlan: compactForStrategyTool(strategy.executionPlan, { maxArray: 8, maxString: 260 }),
      assumptions: asToolArray(strategy.assumptions).slice(0, 20).map((entry) => compactForStrategyTool(entry, { maxArray: 8, maxString: 220 })),
      packagePlan: asToolArray(strategy.packagePlan).slice(0, 16).map((entry) => compactForStrategyTool(entry, { maxArray: 8, maxString: 220 })),
      reconcileReport: compactForStrategyTool(strategy.reconcileReport, { maxArray: 8, maxString: 260 }),
      summary: summarizeStrategySummary(strategy.summary),
    },
    feedbackCount: data.feedback?.length ?? 0,
    feedbackSample: (data.feedback ?? []).slice(0, 5).map((entry) => compactForStrategyTool(entry, { maxArray: 4, maxString: 220 })),
    note: "Default response is compact to avoid oversized tool output. Request a specific section with {\"section\":\"scopeGraph\"} when you need more detail.",
  };
}

function selectedStrategySectionPayload(
  data: { strategy: Record<string, unknown> | null; feedback?: Array<Record<string, unknown>> },
  section: EstimateStrategySection,
) {
  const strategy = data.strategy;
  if (!strategy) return { strategy: null, feedbackCount: data.feedback?.length ?? 0 };
  const sectionValue = strategy[section];
  return {
    strategy: {
      id: strategy.id,
      projectId: strategy.projectId,
      revisionId: strategy.revisionId,
      status: strategy.status,
      currentStage: strategy.currentStage,
      updatedAt: strategy.updatedAt,
      [section]: section === "scopeGraph"
        ? compactForStrategyTool(sectionValue, { maxArray: 40, maxString: 900 })
        : section === "summary"
          ? summarizeStrategySummary(sectionValue)
        : compactForStrategyTool(sectionValue, { maxArray: 30, maxString: 700 }),
    },
    feedbackCount: data.feedback?.length ?? 0,
    note: "Section response is still compacted if it is very large.",
  };
}

export function registerEstimateTools(server: McpServer) {
  const visualPageEvidenceSchema = z.object({
    documentId: z.string(),
    pageNumber: z.coerce.number().int().positive(),
    observation: z.string(),
    toolCallId: z.string().optional(),
  }).passthrough();

  const visualRegionEvidenceSchema = visualPageEvidenceSchema.extend({
    region: z.object({
      x: z.coerce.number(),
      y: z.coerce.number(),
      width: z.coerce.number(),
      height: z.coerce.number(),
      imageWidth: z.coerce.number().optional(),
      imageHeight: z.coerce.number().optional(),
    }).passthrough().optional(),
  }).passthrough();

  const visualSymbolEvidenceSchema = visualPageEvidenceSchema.extend({
    includeImage: z.boolean().default(true),
    countSummary: z.string().optional(),
  }).passthrough();

  const tableEvidenceSchema = visualPageEvidenceSchema.extend({
    sourceText: z.string().optional(),
    tableName: z.string().optional(),
    rowRef: z.string().optional(),
    regionId: z.string().optional(),
    imageHash: z.string().optional(),
    region: z.object({
      x: z.coerce.number(),
      y: z.coerce.number(),
      width: z.coerce.number(),
      height: z.coerce.number(),
      imageWidth: z.coerce.number().optional(),
      imageHeight: z.coerce.number().optional(),
    }).passthrough().optional(),
  }).passthrough();

  server.tool(
    "getEstimateStrategy",
    "Get the persisted estimate strategy for the current revision. Defaults to a compact resume summary to avoid oversized tool output. Pass section to inspect one section in more detail.",
    {
      section: z.enum(ESTIMATE_STRATEGY_SECTIONS).optional().describe("Optional section to inspect in more detail. Omit for compact resume summary."),
    },
    async (input) => {
      const data = await apiGet<{ strategy: Record<string, unknown> | null; feedback: Array<Record<string, unknown>> }>(`/api/estimate/${getProjectId()}/strategy`);
      const section = input.section as EstimateStrategySection | undefined;
      const payload = section ? selectedStrategySectionPayload(data, section) : summarizeStrategyForTool(data);
      return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
    },
  );

  server.tool(
    "saveEstimateScopeGraph",
    [
      "Persist the structured scope graph after document review. Call before creating worksheets or assigning labour hours.",
      "When drawings exist, include visualTakeoffAudit with actual Drawing Evidence Engine evidence.",
      "For drawing-driven packages, atlas pages are overview evidence; include targeted inspectDrawingRegion crop/ledger evidence before pricing. Symbol tools are optional follow-ups after a specific small symbol/region is identified.",
    ].join(" "),
    {
      scopeItems: z.array(z.object({
        id: z.string(),
        name: z.string(),
        kind: z.string(),
        sourceRefs: z.array(z.string()).default([]),
        quantityBasis: z.string().optional(),
        quantities: z.record(z.union([z.string(), z.coerce.number(), z.boolean()])).optional(),
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
      visualTakeoffAudit: z.object({
        drawingDrivenPackages: z.array(z.object({
          packageId: z.string(),
          packageName: z.string().optional(),
          scopeRefs: z.array(z.string()).default([]),
          documentIds: z.array(z.string()).default([]),
          renderedPages: z.array(visualPageEvidenceSchema).default([]),
          zoomEvidence: z.array(visualRegionEvidenceSchema).default([]),
          tableEvidence: z.array(tableEvidenceSchema).default([]).describe("Use for BOM/schedule/table evidence from structured extraction or a table region. Do not put full-page table extraction in zoomEvidence."),
          symbolScanEvidence: z.array(visualSymbolEvidenceSchema).default([]).describe("Optional. Use only after identifying a specific small repeated symbol or cropped region; this is not a substitute for zoomEvidence."),
          quantitiesValidated: z.array(z.string()).default([]),
          unresolvedVisualRisks: z.array(z.string()).default([]),
          confidence: z.enum(["high", "medium", "low"]).default("medium"),
        }).passthrough()).default([]),
        notDrawingDrivenReason: z.string().optional(),
        completedBeforePricing: z.boolean().default(false),
      }).passthrough().default({ drawingDrivenPackages: [], completedBeforePricing: false }).describe("Required visual drawing audit when drawing-style PDFs exist. If a package quantity/scope comes from drawings, record Drawing Evidence Engine atlas/page evidence plus targeted inspectDrawingRegion crop evidence and saved ledger claims before worksheets/items. Put BOM/schedule/table extraction in tableEvidence, not zoomEvidence, unless you inspected a targeted table crop. Symbol scan/count evidence is optional and only for a specific small symbol or cropped region identified from the inspected visual."),
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
    [
      "Persist the package/commercial structure before detailed pricing. Use this to decide how scope will be grouped and whether each package is detailed, subcontracted, or allowance-based.",
      "Every package must include exclusive bindings so finalization can prove which worksheet rows commercialize that package.",
      "Before worksheets exist, bind to the exact planned worksheetNames and/or narrow textMatchers. After worksheets are created, call this again with worksheetIds.",
      "Subcontract/allowance packages must bind only zero-hour subcontractor/allowance/commercial rows. Put self-perform supervision, coordination, or install support in a separate detailed package or General Conditions package.",
    ].join(" "),
    {
      packages: z.array(z.object({
        id: z.string(),
        name: z.string(),
        rationale: z.string().default(""),
        scopeRefs: z.array(z.string()).default([]),
        pricingMode: z.enum(["detailed", "allowance", "subcontract", "historical_allowance"]),
        confidence: z.enum(["high", "medium", "low"]),
        hoursBasis: z.string().optional(),
        bindings: z.object({
          worksheetIds: z.array(z.string()).default([]),
          worksheetNames: z.array(z.string()).default([]),
          categories: z.array(z.string()).default([]),
          categoryTargets: z.array(z.string()).default([]),
          textMatchers: z.array(z.string()).default([]),
          descriptionMatchers: z.array(z.string()).default([]),
          itemMatchers: z.array(z.string()).default([]),
        }).passthrough().default({}),
        commercialModel: z.object({
          executionMode: z.enum(["self_perform", "subcontract", "allowance", "historical_allowance", "mixed"]).optional(),
          supervisionMode: z.enum(["single_source", "embedded", "general_conditions", "hybrid"]).optional(),
          evidencePolicy: z.string().optional(),
        }).passthrough().default({}),
        topDownEnvelope: z.object({
          labourHours: z.coerce.number().nonnegative().optional(),
          subtotal: z.coerce.number().nonnegative().optional(),
        }).passthrough().optional(),
      }).passthrough()),
    },
    async ({ packages }) => {
      await apiPost(`/api/estimate/${getProjectId()}/strategy/section`, { section: "packagePlan", data: packages });
      return { content: [{ type: "text" as const, text: `Saved package plan with ${packages.length} packages` }] };
    },
  );

  server.tool(
    "recomputeEstimateBenchmarks",
    "Compute historical benchmark comparisons from prior human quotes in the organization. Only call this if organization benchmarking is enabled (workspace.meta.benchmarkingEnabled === true); otherwise it is a no-op and you should rely on document/spec/library evidence instead.",
    {},
    async () => {
      const wsResp = await apiGet<any>(`/projects/${getProjectId()}/workspace`);
      const benchmarkingEnabled = wsResp?.workspace?.meta?.benchmarkingEnabled === true;
      if (!benchmarkingEnabled) {
        return {
          content: [{
            type: "text" as const,
            text: "Benchmarking is disabled for this organization. Skip this step. Document your top-down sanity checks in saveEstimateAdjustments using spec, BOM, line-list, knowledge books, and labor units instead of historical comparables.",
          }],
        };
      }
      const data = await apiPost<any>(`/api/estimate/${getProjectId()}/benchmarks/recompute`, {});
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
    "Persist the mandatory final self-review after all worksheets are populated. Capture omissions, outliers, duplicate scope, and final confidence. coverageChecks is the specialty-coverage audit and is enforced at finalize: enumerate every contractor-responsible package identified from the spec/scope-table/RFQ, set status='ok' once it is bound to the plan or carried as an explicit assumption, and provide coveredBy.packageId/coveredBy.worksheetIds (when in the plan) or coveredBy.assumptionId (when carried as a self-perform/out-of-scope assumption). Entries with status='warning' or status='missing' block finalize.",
    {
      coverageChecks: z.array(z.object({
        name: z.string().describe("Specialty package name as identified in the spec/scope-table (e.g. the heading or scope item)."),
        status: z.enum(["ok", "warning", "missing"]).describe("'ok' once resolved; 'warning'/'missing' block finalize and signal unresolved scope coverage."),
        sourceRef: z.string().optional().describe("Where in the source documents this package was identified (document, page/section, table reference)."),
        coveredBy: z.object({
          packageId: z.string().optional().describe("Package plan ID covering this scope item."),
          worksheetIds: z.array(z.string()).default([]).describe("Worksheet IDs covering this scope item."),
          assumptionId: z.string().optional().describe("Saved assumption ID when the package is intentionally not in the plan (self-perform without dedicated line, or explicitly out of scope)."),
        }).passthrough().optional().describe("Required when status='ok': bind to a plan entry via packageId/worksheetIds, or to a saved assumption via assumptionId."),
        notes: z.string().optional().describe("Commercial treatment and rationale for this coverage decision."),
      }).passthrough()).default([]),
      outliers: z.array(z.object({
        area: z.string(),
        metric: z.string(),
        currentValue: z.union([z.string(), z.coerce.number(), z.record(z.unknown())]),
        benchmarkValue: z.union([z.string(), z.coerce.number(), z.record(z.unknown())]).optional(),
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
