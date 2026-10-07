import assert from "node:assert/strict";
import { test } from "node:test";
import { bidwrightMcpApprovalArgs } from "./mcp-approval-policy.js";

test("Bidwright MCP tools are auto-approved without a per-tool approval list", () => {
  assert.deepEqual(bidwrightMcpApprovalArgs(), ["-c", 'mcp_servers.bidwright.default_tools_approval_mode="approve"']);
});
