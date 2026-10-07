import { isAgentToolMutating, normalizeAgentToolId } from "@bidwright/domain";

const REVIEW_WRITES = new Set([
  "saveReviewCoverage", "saveReviewFindings", "saveReviewCompetitiveness",
  "saveReviewRecommendation", "saveReviewSummary",
]);

/** Review may write its report, never the quote being reviewed. */
export function isToolAllowed(name: string, mode?: string, reviewOnly = false): boolean {
  const tool = normalizeAgentToolId(name);
  if (reviewOnly && REVIEW_WRITES.has(tool)) return true;
  if (mode === "qa" || reviewOnly) return !isAgentToolMutating(tool);
  return true;
}
