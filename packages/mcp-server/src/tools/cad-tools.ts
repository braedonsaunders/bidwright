import { savedPickupFacts } from "../takeoff-hints.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiPost, getProjectId } from "../api-client.js";

const source = {
  sourceId: z.string().describe("SourceDocument or FileNode id"),
  sourceKind: z.enum(["source_document", "file_node"]).default("source_document"),
};
const selection = {
  ...source,
  layout: z.string().default("Model"),
  layers: z.array(z.string()).optional(),
  viewId: z.string().optional(),
  bbox: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).optional()
    .describe("View-normalized rectangle (0..1), x right/y down, in renderCadDrawing's image; paired with viewId"),
};
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });

export function registerCadTools(server: McpServer) {
  server.tool("queryCadEntities", "Query CAD handles, block INSERTs, text and geometry; aggregate complete selection in native drawing units.", {
    ...selection, blockName: z.string().optional(), entityTypes: z.array(z.string()).optional(),
    groupBy: z.enum(["layer", "block", "type", "attributes"]).default("layer"), limit: z.number().int().min(1).max(500).default(100), offset: z.number().int().min(0).default(0), groupOffset: z.number().int().min(0).default(0), groupLimit: z.number().int().min(1).max(500).default(100),
  }, async (input) => json(await apiPost(`/api/models/${getProjectId()}/cad/query`, input)));

  server.tool("renderCadDrawing", "Render CAD lines, arcs, polylines and text as a PNG with a viewId and drawing-coordinate transform.", selection, async (input) => {
    const result = await apiPost<any>(`/api/models/${getProjectId()}/cad/render`, { ...input, recordView: { runId: process.env.BIDWRIGHT_RUN_ID, sessionId: process.env.BIDWRIGHT_SESSION_ID } });
    const { image, ...metadata } = result;
    return { content: [{ type: "image" as const, data: image, mimeType: "image/png" }, { type: "text" as const, text: JSON.stringify(metadata) }] };
  });

  server.tool("saveCadEntityTakeoff", "Save selected CAD handles as pickups; reuse existing pickups unchanged and optionally link them to a worksheet item.", {
    ...source, handles: z.array(z.string()).min(1).max(500), measurement: z.enum(["count", "length", "area"]),
    worksheetItemId: z.string().optional(), multiplier: z.number().finite().positive().optional().describe("Explicit quantity multiplier for a new worksheet link"),
  }, async (input) => json(savedPickupFacts(await apiPost(`/api/models/${getProjectId()}/cad/takeoff`, input))));
}
