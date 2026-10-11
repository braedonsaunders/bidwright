import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, getProjectId } from "../api-client.js";

export function registerSourceTools(server: McpServer) {
  server.tool("getSourceOverview", "Read current project sources, persisted capabilities and existing takeoff summaries.", {}, async () => {
    const result = await apiGet(`/api/projects/${encodeURIComponent(getProjectId())}/source-overview`);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });
}
