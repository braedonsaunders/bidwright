import { savedPickupFacts } from "../takeoff-hints.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, getProjectId } from "../api-client.js";

const source = { sourceId: z.string().min(1), sourceKind: z.enum(["source_document", "file_node"]) };
const sources = z.array(z.object(source)).min(1).max(8);
const takeoffPath = (suffix: string) => `/api/takeoff/${encodeURIComponent(getProjectId())}/${suffix}`;
function result(value: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(value) }] }; }

export function registerPipingTools(server: McpServer) {
  server.tool("getPipingMto", "Read pipe lengths, components and explicit joints from a project PCF or Spoolyard .piping file. Native XYZ coordinates; quantities in metres or EA. Does not save.", source, async input => {
    return result(await apiGet(`${takeoffPath("piping/mto")}?${new URLSearchParams(input)}`));
  });
  server.tool("savePipingTakeoff", "Save selected piping MTO lines as Pickups, optionally linking worksheet rows. Reads current source quantities; optional checksum detects changed sources. Unit conversion is explicit.", {
    ...source, sourceChecksum: z.string().optional(), lines: z.array(z.object({ lineId: z.string(), worksheetItemId: z.string().optional(), unit: z.enum(["m", "mm", "ft", "in", "EA"]).optional() })).min(1),
  }, async input => result(savedPickupFacts(await apiPost(takeoffPath("piping/pickups"), input))));
  server.tool("runPhotoBom", "Read a proposed bill of materials from project image files or source documents. Does not save pickups or worksheet rows.", {
    sources, focusPrompt: z.string().max(2000).optional(),
  }, async input => result(await apiPost(takeoffPath("photo-bom"), input)));
  server.tool("segmentPointCloud", "Segment a scan into persisted model elements and quantities, or identify existing segments from project photos. Segmentation replaces prior detections and detaches their pickup references.", {
    modelId: z.string(), operation: z.enum(["segment", "identify"]).default("segment"), voxel: z.number().finite().positive().optional(), sources: sources.optional(), segmentIds: z.array(z.string()).max(500).optional(), focusPrompt: z.string().max(2000).optional(),
  }, async ({ modelId, operation, ...input }) => {
    const suffix = operation === "identify" ? "segments/identify" : "segment";
    return result(await apiPost(`/api/models/${encodeURIComponent(getProjectId())}/assets/${encodeURIComponent(modelId)}/${suffix}`, input));
  });
  server.tool("getRevisionImpact", "Read affected pickups, links and worksheet rows for a source document, FileNode (raw id or file-<id>), or saved model revision diff. Reports human and unrecorded provenance; makes no edits.", {
    documentId: z.string().optional(), priorDocumentId: z.string().optional(), priorChecksum: z.string().optional(), pageNumbers: z.array(z.number().int().positive()).optional(), diffId: z.string().optional(),
  }, async input => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) if (value !== undefined) query.set(key, Array.isArray(value) ? value.join(",") : value);
    return result(await apiGet(`${takeoffPath("revision-impact")}?${query}`));
  });
}
