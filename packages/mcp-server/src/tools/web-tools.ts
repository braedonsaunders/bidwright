import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiPost, getProjectId } from "../api-client.js";

/**
 * Read-only web search available in every agent mode and runtime. The actual
 * search runs in the Bidwright API process with the organization's provider
 * key, so sandboxed CLI runtimes without a native web tool (OpenRouter,
 * Codex, Gemini) can still answer market-pricing and general questions.
 */
export function registerWebTools(server: McpServer) {
  server.tool(
    "webSearch",
    "Search the public web for current, real-world information: material and component prices, vendor availability, product specs, codes/standards, industry news. Use when the project documents, knowledge base, and rate schedules cannot answer — e.g. casual questions like 'what does a 3\" pipe U-bolt cost'. Returns a concise, sourced answer with URLs. Read-only.",
    {
      query: z.string().describe("What to search for — a plain-language question or search phrase"),
      maxResults: z.number().optional().describe("Maximum web results to consult (1-10, default 5)"),
    },
    async ({ query, maxResults }) => {
      const projectId = getProjectId();
      if (!projectId) {
        return { content: [{ type: "text" as const, text: "Error: No project ID configured" }] };
      }
      try {
        const result = await apiPost<{ answer: string; citations: Array<{ title: string; url: string }>; model: string }>(
          `/api/cli/${projectId}/web-search`,
          { query, maxResults },
        );
        const lines = [result.answer?.trim() || "No answer returned."];
        if (result.citations?.length) {
          lines.push("", "Sources:");
          for (const citation of result.citations) {
            lines.push(`- ${citation.title ? `${citation.title} — ` : ""}${citation.url}`);
          }
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Web search failed: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
