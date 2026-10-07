import assert from "node:assert/strict";
import { test } from "node:test";
import { bidwrightMcpApprovalArgs } from "./mcp-approval-policy.js";
import type { McpEnv } from "./types.js";

const env = { BIDWRIGHT_AGENT_MODE: "qa" } as McpEnv;
test("QA approves image and evidence reads without approving estimating writes", () => {
  const args = bidwrightMcpApprovalArgs(env);
  assert.ok(args.includes('mcp_servers.bidwright.default_tools_approval_mode="prompt"'));
  for (const tool of ["listProjectImages", "inspectProjectImage", "readDrawingPage", "readDrawingTile", "getLineDerivation", "askUser"]) {
    assert.ok(args.includes(`mcp_servers.bidwright.tools.${tool}.approval_mode="approve"`), tool);
  }
  for (const tool of ["createWorksheetItem", "updateWorksheetItem", "deleteWorksheetItem", "writeMemory", "invokeIntegrationAction", "saveReviewSummary", "unknownFutureTool"]) {
    assert.ok(!args.some((arg) => arg.includes(`tools.${tool}.`)), tool);
  }
});
test("review permits its report writes only; build behavior is unchanged", () => {
  const args = bidwrightMcpApprovalArgs({ ...env, BIDWRIGHT_REVIEW_ONLY: "true" });
  assert.ok(args.includes('mcp_servers.bidwright.tools.saveReviewSummary.approval_mode="approve"'));
  assert.ok(!args.some((arg) => arg.includes("tools.updateWorksheetItem.")));
  assert.deepEqual(bidwrightMcpApprovalArgs({ ...env, BIDWRIGHT_AGENT_MODE: "build_estimate" }), []);
});
