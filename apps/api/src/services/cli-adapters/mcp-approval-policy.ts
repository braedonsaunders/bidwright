/**
 * Bidwright agents are authorized to execute their available tools without
 * runtime approval prompts in every mode. QA/review tool selection is enforced
 * by the MCP server registration filter, independently of native permissions.
 */
export function bidwrightMcpApprovalArgs(): string[] {
  return ["-c", 'mcp_servers.bidwright.default_tools_approval_mode="approve"'];
}
