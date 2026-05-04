export type EstimateRunStageStatus = "blocked" | "ready" | "in_progress" | "complete" | "skipped";
export type EstimateApprovalState = "not_required" | "pending" | "approved" | "rejected";
export type EstimateProposalState = "none" | "draft" | "proposed" | "committed" | "discarded";

export interface EstimateRunGate {
  id: string;
  label: string;
  requiresStageIds?: string[];
  requiredEvidenceTypes?: string[];
  requiredToolIds?: string[];
  blockingFindingIds?: string[];
}

export interface EstimateRunStage {
  id: string;
  title: string;
  description: string;
  order: number;
  status: EstimateRunStageStatus;
  gates: EstimateRunGate[];
  expectedToolIds: string[];
  requiredEvidenceTypes: string[];
  approvalState: EstimateApprovalState;
  proposalState: EstimateProposalState;
  progress: {
    completed: number;
    total: number;
  };
}

export interface EstimateRunPlan {
  id: string;
  revisionId?: string;
  stages: EstimateRunStage[];
  activeStageId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EstimateRunPlanProgress {
  completedStages: number;
  totalStages: number;
  blockedStages: number;
  progressPct: number;
  activeStageId?: string;
  nextStageId?: string;
  blockingGateIds: string[];
}

const defaultStages: Array<Omit<EstimateRunStage, "status" | "approvalState" | "proposalState" | "progress">> = [
  {
    id: "intake",
    title: "Intake",
    description: "Read source documents and workspace state before mutating the estimate.",
    order: 10,
    gates: [],
    expectedToolIds: ["getWorkspace", "getEstimateStrategy", "readDocumentText"],
    requiredEvidenceTypes: ["document"],
  },
  {
    id: "quote_metadata",
    title: "Quote Metadata",
    description: "Set project name, client, scope description, and internal notes.",
    order: 20,
    gates: [{ id: "intake_complete", label: "Intake complete", requiresStageIds: ["intake"] }],
    expectedToolIds: ["updateQuote"],
    requiredEvidenceTypes: ["document"],
  },
  {
    id: "knowledge_gate",
    title: "Knowledge Gate",
    description: "Read knowledge books, query datasets, and collect pricing context.",
    order: 30,
    gates: [{ id: "metadata_complete", label: "Quote metadata complete", requiresStageIds: ["quote_metadata"] }],
    expectedToolIds: ["listKnowledgeBooks", "readDocumentText", "listDatasets", "queryDataset", "WebSearch"],
    requiredEvidenceTypes: ["knowledge", "dataset"],
  },
  {
    id: "rate_setup",
    title: "Rate Setup",
    description: "Import and verify rate schedules for configured rate-backed categories.",
    order: 40,
    gates: [{ id: "knowledge_ready", label: "Knowledge gate complete", requiresStageIds: ["knowledge_gate"] }],
    expectedToolIds: ["quote.getItemConfig", "listRateSchedules", "importRateSchedule"],
    requiredEvidenceTypes: ["rate_schedule"],
  },
  {
    id: "scope_graph",
    title: "Scope Graph",
    description: "Persist included, excluded, alternate, and unclear scope before detailed pricing.",
    order: 50,
    gates: [{ id: "rate_setup_ready", label: "Rate setup complete", requiresStageIds: ["rate_setup"] }],
    expectedToolIds: ["saveEstimateScopeGraph"],
    requiredEvidenceTypes: ["document"],
  },
  {
    id: "execution_plan",
    title: "Execution Plan",
    description: "Persist labour strategy, subcontract choices, access, procurement, and production basis.",
    order: 60,
    gates: [{ id: "scope_graph_ready", label: "Scope graph saved", requiresStageIds: ["scope_graph"] }],
    expectedToolIds: ["saveEstimateExecutionPlan"],
    requiredEvidenceTypes: ["knowledge", "dataset"],
  },
  {
    id: "assumptions",
    title: "Assumptions",
    description: "Persist explicit assumptions with impact and evidence.",
    order: 70,
    gates: [{ id: "execution_plan_ready", label: "Execution plan saved", requiresStageIds: ["execution_plan"] }],
    expectedToolIds: ["saveEstimateAssumptions"],
    requiredEvidenceTypes: ["assumption"],
  },
  {
    id: "package_plan",
    title: "Package Plan",
    description: "Bind commercial packages to worksheets, categories, or text matchers.",
    order: 80,
    gates: [{ id: "assumptions_ready", label: "Assumptions saved", requiresStageIds: ["assumptions"] }],
    expectedToolIds: ["saveEstimatePackagePlan"],
    requiredEvidenceTypes: ["document"],
  },
  {
    id: "benchmarks",
    title: "Benchmarks",
    description: "Compute benchmarks and adjustment plan before detailed item creation.",
    order: 90,
    gates: [{ id: "package_plan_ready", label: "Package plan saved", requiresStageIds: ["package_plan"] }],
    expectedToolIds: ["recomputeEstimateBenchmarks", "saveEstimateAdjustments"],
    requiredEvidenceTypes: ["benchmark"],
  },
  {
    id: "worksheets_items",
    title: "Worksheets & Items",
    description: "Create phases, worksheets, and granular source-backed line items.",
    order: 100,
    gates: [{ id: "benchmarks_ready", label: "Benchmarks complete", requiresStageIds: ["benchmarks"] }],
    expectedToolIds: ["createPhase", "createWorksheet", "createWorksheetItem"],
    requiredEvidenceTypes: ["document", "knowledge", "dataset"],
  },
  {
    id: "conditions",
    title: "Conditions",
    description: "Capture inclusions, exclusions, and clarifications as structured conditions.",
    order: 110,
    gates: [{ id: "items_exist", label: "Worksheets and items created", requiresStageIds: ["worksheets_items"] }],
    expectedToolIds: ["createCondition"],
    requiredEvidenceTypes: ["document", "assumption"],
  },
  {
    id: "qa_reconcile",
    title: "QA & Reconcile",
    description: "Run completeness, duplicate, pricing, source, and benchmark checks.",
    order: 120,
    gates: [{ id: "conditions_ready", label: "Conditions captured", requiresStageIds: ["conditions"] }],
    expectedToolIds: ["getWorkspace", "saveEstimateReconcile"],
    requiredEvidenceTypes: ["validation"],
  },
  {
    id: "finalize",
    title: "Finalize",
    description: "Finalize the estimate strategy after blockers are resolved.",
    order: 130,
    gates: [{ id: "reconcile_ready", label: "Reconcile complete", requiresStageIds: ["qa_reconcile"] }],
    expectedToolIds: ["finalizeEstimateStrategy"],
    requiredEvidenceTypes: ["validation"],
  },
];

function normalizeStageProgress(progress: EstimateRunStage["progress"]): EstimateRunStage["progress"] {
  const total = Number.isFinite(progress.total) && progress.total > 0 ? progress.total : 1;
  const completed = Number.isFinite(progress.completed) ? Math.max(0, Math.min(progress.completed, total)) : 0;
  return { completed, total };
}

function getStageProgressRatio(stage: EstimateRunStage): number {
  if (stage.status === "complete" || stage.status === "skipped") return 1;
  const progress = normalizeStageProgress(stage.progress);
  return progress.completed / progress.total;
}

function getEstimateRunStage(plan: EstimateRunPlan, stageId: string): EstimateRunStage {
  const stage = plan.stages.find((candidate) => candidate.id === stageId);
  if (!stage) throw new Error(`Estimate run stage "${stageId}" not found.`);
  return stage;
}

function buildInitialStage(stage: Omit<EstimateRunStage, "status" | "approvalState" | "proposalState" | "progress">): EstimateRunStage {
  return {
    ...stage,
    status: stage.order === 10 ? "ready" : "blocked",
    approvalState: "not_required",
    proposalState: "none",
    progress: { completed: 0, total: Math.max(1, stage.expectedToolIds.length) },
  };
}

export function createDefaultEstimateRunPlan(id: string, revisionId?: string): EstimateRunPlan {
  return {
    id,
    revisionId,
    activeStageId: "intake",
    stages: defaultStages.map(buildInitialStage),
  };
}

export function getBlockingGateIds(stage: EstimateRunStage, plan: EstimateRunPlan): string[] {
  const completed = new Set(plan.stages.filter((candidate) => candidate.status === "complete" || candidate.status === "skipped").map((candidate) => candidate.id));
  const blocked: string[] = [];
  for (const gate of stage.gates) {
    const stageRequirements = gate.requiresStageIds ?? [];
    if (stageRequirements.some((stageId) => !completed.has(stageId))) blocked.push(gate.id);
    if ((gate.blockingFindingIds ?? []).length > 0) blocked.push(gate.id);
  }
  return Array.from(new Set(blocked));
}

export function refreshEstimateRunPlan(plan: EstimateRunPlan): EstimateRunPlan {
  const stages = plan.stages
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((stage) => {
      if (stage.status === "complete" || stage.status === "skipped" || stage.status === "in_progress") return stage;
      const blocked = getBlockingGateIds(stage, { ...plan, stages: plan.stages });
      return { ...stage, status: blocked.length > 0 ? "blocked" as const : "ready" as const };
    });
  const active = stages.find((stage) => stage.status === "in_progress")
    ?? stages.find((stage) => stage.status === "ready")
    ?? stages.find((stage) => stage.status === "blocked");
  return { ...plan, stages, activeStageId: active?.id };
}

export function markEstimateRunStage(
  plan: EstimateRunPlan,
  stageId: string,
  patch: Partial<Pick<EstimateRunStage, "status" | "approvalState" | "proposalState" | "progress">>,
): EstimateRunPlan {
  getEstimateRunStage(plan, stageId);
  const next = {
    ...plan,
    stages: plan.stages.map((stage) => {
      if (stage.id !== stageId) return stage;
      return {
        ...stage,
        ...patch,
        progress: patch.progress ? normalizeStageProgress(patch.progress) : stage.progress,
      };
    }),
  };
  return refreshEstimateRunPlan(next);
}

export function summarizeEstimateRunPlan(plan: EstimateRunPlan): EstimateRunPlanProgress {
  const refreshed = refreshEstimateRunPlan(plan);
  const totalStages = refreshed.stages.length;
  const completedStages = refreshed.stages.filter((stage) => stage.status === "complete" || stage.status === "skipped").length;
  const blockedStages = refreshed.stages.filter((stage) => stage.status === "blocked").length;
  const completedStageEquivalent = refreshed.stages.reduce((sum, stage) => sum + getStageProgressRatio(stage), 0);
  const activeStageId = refreshed.activeStageId;
  const activeIndex = refreshed.stages.findIndex((stage) => stage.id === activeStageId);
  const nextStageId = activeIndex >= 0 ? refreshed.stages.slice(activeIndex + 1).find((stage) => stage.status !== "complete" && stage.status !== "skipped")?.id : undefined;
  const blockingGateIds = refreshed.stages.flatMap((stage) => getBlockingGateIds(stage, refreshed));

  return {
    completedStages,
    totalStages,
    blockedStages,
    progressPct: totalStages > 0 ? Number((completedStageEquivalent / totalStages).toFixed(4)) : 0,
    activeStageId,
    nextStageId,
    blockingGateIds: Array.from(new Set(blockingGateIds)),
  };
}

export function proposeEstimateRunStage(plan: EstimateRunPlan, stageId: string): EstimateRunPlan {
  return markEstimateRunStage(plan, stageId, { proposalState: "proposed", approvalState: "pending" });
}

export function commitEstimateRunStage(plan: EstimateRunPlan, stageId: string): EstimateRunPlan {
  const progress = normalizeStageProgress(getEstimateRunStage(plan, stageId).progress);
  return markEstimateRunStage(plan, stageId, {
    status: "complete",
    proposalState: "committed",
    approvalState: "approved",
    progress: { completed: progress.total, total: progress.total },
  });
}
