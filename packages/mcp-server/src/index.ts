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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerQuoteTools } from "./tools/quote-tools.js";
import { registerKnowledgeTools } from "./tools/knowledge-tools.js";
import { registerSystemTools } from "./tools/system-tools.js";
import { registerVisionTools } from "./tools/vision-tools.js";
import { registerReviewTools } from "./tools/review-tools.js";
import { registerEstimateTools } from "./tools/estimate-tools.js";
import { registerModelTools } from "./tools/model-tools.js";

const server = new McpServer({
  name: "bidwright",
  version: "0.1.0",
});

// Register all tool groups
registerQuoteTools(server);
registerKnowledgeTools(server);
registerSystemTools(server);
registerVisionTools(server);
registerModelTools(server);
registerReviewTools(server);
registerEstimateTools(server);

// Start stdio transport (Claude Code / Codex communicate via stdin/stdout)
const transport = new StdioServerTransport();
await server.connect(transport);
