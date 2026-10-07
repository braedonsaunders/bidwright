/**
 * Estimate strategy stage machine shared by the single-section and atomic
 * multi-section saves. Pure so it can be unit-tested without a database.
 */

export const ESTIMATE_STRATEGY_STAGE_ORDER: Record<string, number> = {
  scope: 1,
  execution: 2,
  packaging: 3,
  benchmark: 4,
  reconcile: 5,
  complete: 6,
};

export const ESTIMATE_STRATEGY_SECTIONS = [
  "scopeGraph",
  "executionPlan",
  "assumptions",
  "packagePlan",
  "adjustmentPlan",
  "reconcileReport",
  "summary",
] as const;

export type EstimateStrategySectionName = (typeof ESTIMATE_STRATEGY_SECTIONS)[number];

/** Stage each section advances the strategy to. `summary` never advances. */
export const ESTIMATE_STRATEGY_STAGE_BY_SECTION: Record<Exclude<EstimateStrategySectionName, "summary">, string> = {
  scopeGraph: "scope",
  executionPlan: "execution",
  assumptions: "execution",
  packagePlan: "packaging",
  adjustmentPlan: "benchmark",
  reconcileReport: "reconcile",
};

/** Never moves backwards: the later of the current and requested stage. */
export function advanceEstimateStrategyStage(currentStage: string | null | undefined, nextStage: string): string {
  const current = currentStage && ESTIMATE_STRATEGY_STAGE_ORDER[currentStage] ? currentStage : "scope";
  const next = ESTIMATE_STRATEGY_STAGE_ORDER[nextStage] ? nextStage : current;
  return ESTIMATE_STRATEGY_STAGE_ORDER[next] > ESTIMATE_STRATEGY_STAGE_ORDER[current] ? next : current;
}

/** Stage reached after saving several sections at once. */
export function stageAfterSavingSections(currentStage: string | null | undefined, sections: EstimateStrategySectionName[]): string {
  let stage = currentStage && ESTIMATE_STRATEGY_STAGE_ORDER[currentStage] ? currentStage : "scope";
  for (const section of sections) {
    if (section === "summary") continue;
    stage = advanceEstimateStrategyStage(stage, ESTIMATE_STRATEGY_STAGE_BY_SECTION[section]);
  }
  return stage;
}

// ── Batch worksheet operations ─────────────────────────────────────────────

export type BatchWorksheetOperation =
  | { op: "create"; worksheetId: string; item: Record<string, unknown>; ref?: string }
  | { op: "update"; itemId: string; patch: Record<string, unknown>; ref?: string }
  | { op: "delete"; itemId: string; ref?: string };

export interface BatchOperationProblem {
  index: number;
  ref?: string;
  op: BatchWorksheetOperation["op"];
  error: string;
}

/**
 * Validate every operation with the supplied per-op gate before anything is
 * applied. Returns all problems, not just the first, so the caller can fix
 * the whole batch in one pass. An empty result means the batch may proceed.
 */
export async function collectBatchOperationProblems<T extends { op: BatchWorksheetOperation["op"]; ref?: string }>(
  operations: T[],
  gate: (operation: T, index: number) => Promise<string | null> | string | null,
): Promise<BatchOperationProblem[]> {
  const problems: BatchOperationProblem[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    let error: string | null;
    try {
      error = await gate(operation, index);
    } catch (caught) {
      error = (caught as Error)?.message ?? String(caught);
    }
    if (error) problems.push({ index, ref: operation.ref, op: operation.op, error });
  }
  return problems;
}

// ── Calibration lessons ────────────────────────────────────────────────────

export type CalibrationReviewStatus = "pending" | "approved" | "rejected";

export interface CalibrationLesson {
  /** Short imperative statement the agent can apply, e.g. "Count base plates from the plan view; the note gives anchors per plate." */
  lesson: string;
  /** Optional trade/scope tags for retrieval. */
  tags?: string[];
  /** What went wrong, in one sentence. */
  context?: string | null;
  /** Numeric or textual delta backing the lesson. */
  evidence?: string | null;
}

export interface ApprovedCalibrationLesson extends CalibrationLesson {
  feedbackId: string;
  projectId: string;
  projectName?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
}

export function normalizeCalibrationLessons(value: unknown): CalibrationLesson[] {
  if (!Array.isArray(value)) return [];
  const lessons: CalibrationLesson[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const lesson = entry.trim();
      if (lesson) lessons.push({ lesson });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const lesson = String(raw.lesson ?? raw.text ?? raw.statement ?? "").trim();
    if (!lesson) continue;
    lessons.push({
      lesson,
      tags: Array.isArray(raw.tags) ? raw.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean) : [],
      context: raw.context === undefined ? null : String(raw.context ?? "").trim() || null,
      evidence: raw.evidence === undefined ? null : String(raw.evidence ?? "").trim() || null,
    });
  }
  return lessons;
}

/** Simple relevance: tag overlap first, then term overlap with the lesson text. */
export function scoreCalibrationLesson(lesson: CalibrationLesson, query: string, tags: string[] = []): number {
  const wantedTags = new Set(tags.map((tag) => tag.toLowerCase()));
  const tagHits = (lesson.tags ?? []).filter((tag) => wantedTags.has(tag)).length;
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 3);
  const haystack = `${lesson.lesson} ${lesson.context ?? ""} ${(lesson.tags ?? []).join(" ")}`.toLowerCase();
  const termHits = terms.filter((term) => haystack.includes(term)).length;
  return tagHits * 2 + termHits;
}
