#!/usr/bin/env node
/**
 * Bidwright MCP Server
 *
 * Exposes Bidwright estimating tools to Claude Code / Codex CLI via the
 * Model Context Protocol. Communicates with the Bidwright API over HTTP.
 *
 * Environment variables (set by Bidwright API when spawning):
 *   BIDWRIGHT_API_URL      - API base URL (default: http://localhost:4001)
 *   BIDWRIGHT_AUTH_TOKEN    - Bearer token for API auth
 *   BIDWRIGHT_PROJECT_ID   - Current project ID
 *   BIDWRIGHT_REVISION_ID  - Current revision ID
 *   BIDWRIGHT_QUOTE_ID     - Current quote ID
 */

import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isToolAllowed } from "./tool-access.js";
import { registerQuoteTools } from "./tools/quote-tools.js";
import { registerKnowledgeTools } from "./tools/knowledge-tools.js";
import { registerSystemTools } from "./tools/system-tools.js";
import { registerVisionTools } from "./tools/vision-tools.js";
import { registerDrawingEvidenceTools } from "./tools/drawing-evidence-tools.js";
import { registerReviewTools } from "./tools/review-tools.js";
import { registerEstimateTools } from "./tools/estimate-tools.js";
import { registerModelTools } from "./tools/model-tools.js";
import { registerFileIngestTools } from "./tools/file-ingest-tools.js";
import { registerIntegrationTools } from "./tools/integration-tools.js";
import { registerResourceTools } from "./tools/resource-tools.js";
import { registerCalculatorTools } from "./tools/calculator-tools.js";
import { registerWebTools } from "./tools/web-tools.js";

export async function registerTools(server: McpServer, options: { mode?: string; reviewOnly?: boolean } = {}) {
  const { mode, reviewOnly = false } = options;
  const readOnlyMode = mode === "qa" || reviewOnly;
  if (readOnlyMode) {
    const rawTool = (server as any).tool.bind(server);
    (server as any).tool = (name: string, ...args: unknown[]) => {
      if (!isToolAllowed(name, mode, reviewOnly)) return undefined;
      return rawTool(name, ...args);
    };
    const rawRegisterTool = (server as any).registerTool.bind(server);
    (server as any).registerTool = (name: string, ...args: unknown[]) => {
      if (!isToolAllowed(name, mode, reviewOnly)) return undefined;
      return rawRegisterTool(name, ...args);
    };
  }
  // Register all tool groups
  registerQuoteTools(server);
  registerKnowledgeTools(server);
  registerSystemTools(server);
  registerVisionTools(server);
  registerDrawingEvidenceTools(server);
  registerModelTools(server);
  registerFileIngestTools(server);
  registerReviewTools(server);
  registerEstimateTools(server);
  registerResourceTools(server);
  registerCalculatorTools(server);
  registerWebTools(server);
  if (!readOnlyMode) {
    await registerIntegrationTools(server);
  }

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = new McpServer({ name: "bidwright", version: "0.1.0" });
  await registerTools(server, {
    mode: process.env.BIDWRIGHT_AGENT_MODE,
    reviewOnly: process.env.BIDWRIGHT_REVIEW_ONLY === "true",
  });
  await server.connect(new StdioServerTransport());
}
