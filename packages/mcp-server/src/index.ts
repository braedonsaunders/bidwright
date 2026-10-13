#!/usr/bin/env node
import { compactToolSchema, toolDiscoveryPhase } from "./tool-discovery.js";
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
import { z } from "zod";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { getAgentToolDefinition, isAgentToolMutating } from "@bidwright/domain";
import { isToolAllowed } from "./tool-access.js";
import { closestToolNames } from "./tool-suggestions.js";
import { registerQuoteTools } from "./tools/quote-tools.js";
import { registerKnowledgeTools } from "./tools/knowledge-tools.js";
import { registerSystemTools } from "./tools/system-tools.js";
import { registerTakeoffTools } from "./tools/takeoff-tools.js";
import { registerVisionTools } from "./tools/vision-tools.js";
import { registerDrawingEvidenceTools } from "./tools/drawing-evidence-tools.js";
import { registerReviewTools } from "./tools/review-tools.js";
import { registerEstimateTools } from "./tools/estimate-tools.js";
import { registerCadTools } from "./tools/cad-tools.js";
import { registerPipingTools } from "./tools/piping-tools.js";
import { registerModelTools } from "./tools/model-tools.js";
import { registerFileIngestTools } from "./tools/file-ingest-tools.js";
import { registerIntegrationTools } from "./tools/integration-tools.js";
import { registerResourceTools } from "./tools/resource-tools.js";
import { registerCalculatorTools } from "./tools/calculator-tools.js";
import { registerWebTools } from "./tools/web-tools.js";
import { registerSourceTools } from "./tools/source-tools.js";

export async function registerTools(server: McpServer, options: { mode?: string; reviewOnly?: boolean } = {}) {
  const { mode, reviewOnly = false } = options;
  const catalog = new Map<string, {
    description: string;
    schema: z.ZodTypeAny;
    outputSchema?: z.ZodTypeAny;
    handler: (args: any, extra: any) => Promise<any>;
  }>();
  const schemaFor = (schema: any) => schema?.parseAsync ? schema : z.object(schema ?? {});
  const capture = (name: string, description: string, input: any, handler: any, output?: any) => {
    if (catalog.has(name)) throw new Error(`Tool ${name} is already registered`);
    const schema = schemaFor(input);
    const outputSchema = output ? schemaFor(output) : undefined;
    const wrapped = async (args: any, extra: any) => {
      const started = Date.now();
      let failed = false;
      try {
        if (!isToolAllowed(name, mode, reviewOnly)) throw new Error(`Tool ${name} is read-only restricted.`);
        const result = await handler(args, extra);
        failed = result?.isError === true;
        return result;
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        console.error(JSON.stringify({ event: "mcp_tool", tool: name, mutates: isAgentToolMutating(name), failed, durationMs: Date.now() - started }));
      }
    };
    catalog.set(name, { description, schema, outputSchema, handler: wrapped });
    return wrapped;
  };
  // Supported by Claude Agent SDK 0.3.220; other MCP clients ignore this metadata.
  // Keep discovery available without eagerly loading the full estimating catalog.
  const alwaysLoad = new Set(["getSourceOverview", "describeTools", "invokeTool", "listModels", "listPickups"]);
  const rawTool = (server as any).tool.bind(server);
  (server as any).tool = (name: string, ...args: any[]) => {
    if (!isToolAllowed(name, mode, reviewOnly)) return undefined;
    const description = typeof args[0] === "string" ? args.shift() : "";
    const callback = args.pop();
    const shape = args[0] ?? {};
    const wrapped = capture(name, description, shape, callback);
    const registered = rawTool(name, description, ...args, wrapped);
    if (alwaysLoad.has(name)) registered?.update({ _meta: { "anthropic/alwaysLoad": true } });
    return registered;
  };
  const rawRegisterTool = (server as any).registerTool.bind(server);
  (server as any).registerTool = (name: string, config: any, handler: any) => {
    if (!isToolAllowed(name, mode, reviewOnly)) return undefined;
    return rawRegisterTool(name, config, capture(name, config.description ?? "", config.inputSchema, handler, config.outputSchema));
  };
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
  registerSourceTools(server);

  registerTakeoffTools(server);
  registerCadTools(server);
  registerPipingTools(server);
  await registerIntegrationTools(server);

  const unavailableTool = (name: string) => {
    const suggestions = closestToolNames(name, [...catalog.keys()].filter(id => isToolAllowed(id, mode, reviewOnly)));
    return { isError: true, content: [{ type: "text" as const, text: `Unknown or unavailable tool: ${name}.${suggestions.length ? ` Closest registered tools: ${suggestions.join(", ")}. describeTools returns their schemas.` : ""}` }] };
  };

  server.tool(
    "describeTools",
    "Return compact input schemas for a whole work phase: sources, pricing, estimate, reconciliation or system. A named-tool request includes its phase siblings, so one call covers related operations. Existing family names also work. With no filters, return the catalog.",
    { family: z.string().optional(), name: z.string().optional() },
    async ({ family, name }) => {
      if (name && !catalog.has(name)) return unavailableTool(name);
      const phase = name ? toolDiscoveryPhase(getAgentToolDefinition(name)?.category ?? "system") : null;
      const entries = [...catalog.entries()].filter(([id]) => {
        const category = getAgentToolDefinition(id)?.category ?? "system";
        return (!phase || toolDiscoveryPhase(category) === phase) && (!family || category === family || toolDiscoveryPhase(category) === family);
      }).sort(([a], [b]) => Number(b === name) - Number(a === name));
      return { content: [{ type: "text" as const, text: JSON.stringify(entries.map(([id, tool]) => ({
        name: id,
        description: tool.description.split("\n")[0].slice(0, 220),
        phase: toolDiscoveryPhase(getAgentToolDefinition(id)?.category ?? "system"),
        family: getAgentToolDefinition(id)?.category ?? "system",
        mutates: isAgentToolMutating(id),
        ...((name || family) ? { inputSchema: compactToolSchema(toJsonSchemaCompat(tool.schema as any)) } : {}),
      }))) }] };
    },
  );
  server.tool(
    "invokeTool",
    "Call a named tool with its normal input schema and access policy. Returns its normal result, including images.",
    { name: z.string(), args: z.record(z.unknown()).default({}) },
    async ({ name, args }, extra) => {
      const tool = catalog.get(name);
      if (!tool || name === "invokeTool" || !isToolAllowed(name, mode, reviewOnly)) {
        return unavailableTool(name);
      }
      try {
        // Direct MCP calls are parsed by the SDK. Indirect calls use the same
        // captured schema, then the same handler (including scope and logging).
        const parsed = await tool.schema.parseAsync(args);
        const result = await tool.handler(parsed, extra);
        if (tool.outputSchema && !result.isError) await tool.outputSchema.parseAsync(result.structuredContent);
        return result;
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
      }
    },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = new McpServer({ name: "bidwright", version: "0.1.0" });
  await registerTools(server, {
    mode: process.env.BIDWRIGHT_AGENT_MODE,
    reviewOnly: process.env.BIDWRIGHT_REVIEW_ONLY === "true",
  });
  await server.connect(new StdioServerTransport());
}
