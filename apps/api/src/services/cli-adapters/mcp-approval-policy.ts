import { AGENT_TOOL_REGISTRY, isAgentToolMutating } from "@bidwright/domain";
import type { McpEnv } from "./types.js";

const DRAWING_AND_TRACE_READS = ["readDrawingPage", "readDrawingTile", "getLineDerivation", "listCalibrationLessons"];
const REVIEW_REPORT_WRITES = ["saveReviewCoverage", "saveReviewFindings", "saveReviewCompetitiveness", "saveReviewRecommendation", "saveReviewSummary"];

/**
 * Codex read-only mode otherwise requires approval for unannotated MCP tools.
 * Approve only the trusted Bidwright operations available in the current mode.
 * Rendering may persist evidence and review tools write the review report, so
 * describing every allowed operation as readOnlyHint=true would be misleading.
 * Native shell/filesystem restrictions and the MCP server's mode filter remain.
 */
export function bidwrightMcpApprovalArgs(env: McpEnv): string[] {
  const review = env.BIDWRIGHT_REVIEW_ONLY === "true";
  if (env.BIDWRIGHT_AGENT_MODE !== "qa" && !review) return [];
  const allowed = new Set([
    ...Object.keys(AGENT_TOOL_REGISTRY).filter((name) => !isAgentToolMutating(name)),
    ...DRAWING_AND_TRACE_READS,
    ...(review ? REVIEW_REPORT_WRITES : []),
  ]);
  return [
    "-c", 'mcp_servers.bidwright.default_tools_approval_mode="prompt"',
    ...[...allowed].sort().flatMap((name) => ["-c", `mcp_servers.bidwright.tools.${name}.approval_mode="approve"`]),
  ];
}
