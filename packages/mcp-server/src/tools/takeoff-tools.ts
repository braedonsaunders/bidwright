import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiPost, getProjectId } from "../api-client.js";

const point = z.object({ x: z.number(), y: z.number() });
const box = point.extend({
  width: z.number().positive(),
  height: z.number().positive(),
});
const source = {
  documentId: z.string().optional(),
  pageNumber: z.number().int().positive().optional(),
  viewId: z.string().optional(),
  coordinateSpace: z
    .enum(["view-normalized", "pdf-points"])
    .optional()
    .describe(
      "viewId defaults to 0..1 in its returned image; otherwise top-left PDF points, including page rotation.",
    ),
};
const geometry = {
  ...source,
  type: z.enum(["linear", "polyline", "area", "count"]),
  points: z.array(point).min(1),
  snap: z.boolean().optional(),
  tolerance: z
    .number()
    .positive()
    .max(72)
    .optional()
    .describe("Snap distance in PDF points; default 3."),
};

export function registerTakeoffTools(server: McpServer) {
  server.tool("saveSourceQuantityTakeoff", "Save an authored BOM, schedule or document-table quantity as a visible pickup with source references; optionally link it to a worksheet item. Returns the saved pickup and any linkError.", {
    documentId: z.string().describe("Source document id, or file-<nodeId> for a FileNode"),
    quantity: z.number().nonnegative(), unit: z.string(), label: z.string(), description: z.string().optional(),
    sourceRefs: z.array(z.object({ sheet: z.string().optional(), row: z.number().int().positive().optional(), page: z.number().int().positive().optional(), cell: z.string().optional(), text: z.string().optional() })).min(1),
    linkToItemId: z.string().optional(), quantityField: z.enum(["value", "area", "volume", "count"]).default("value"), multiplier: z.number().positive().optional(),
  }, async input => ({ content: [{ type: "text" as const, text: JSON.stringify(await apiPost(`/api/takeoff/${getProjectId()}/source-quantities`, input)) }] }));
  const call = async (operation: string, input: unknown) => {
    const result = await apiPost<Record<string, unknown>>(
      `/api/takeoff/${getProjectId()}/pdf/${operation}`,
      operation === "overlay"
        ? {
            ...(input as object),
            recordView: {
              runId: process.env.BIDWRIGHT_RUN_ID,
              sessionId: process.env.BIDWRIGHT_SESSION_ID,
            },
          }
        : input,
    );
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; data: string; mimeType: string }
    > = [];
    for (const key of ["nativeImage", "overlayImage"]) {
      const value = result[key];
      if (
        typeof value === "string" &&
        value.startsWith("data:image/png;base64,")
      ) {
        content.push({
          type: "text",
          text:
            key === "nativeImage"
              ? "Native page (unmarked)"
              : "Saved pickup overlay",
        });
        content.push({
          type: "image",
          data: value.slice(value.indexOf(",") + 1),
          mimeType: "image/png",
        });
        delete result[key];
      }
    }
    content.push({ type: "text", text: JSON.stringify(result) });
    return { content };
  };
  server.tool(
    "getTakeoffCalibration",
    "Read shared page and detail-region takeoff calibrations.",
    source,
    (input) => call("get-calibration", input),
  );
  server.tool(
    "setTakeoffCalibration",
    "Save a scale from two points and a known distance. Region uses the same coordinate space as points. Existing human scales require explicit replaceHuman.",
    {
      ...source,
      points: z.array(point).length(2),
      knownDistance: z.number().positive(),
      unit: z.enum(["mm", "cm", "m", "in", "ft"]),
      source: z.enum(["title-block", "dimension", "manual-points"]),
      region: box.optional(),
      regionId: z.string().optional(),
      replaceHuman: z.boolean().optional(),
    },
    (input) => call("set-calibration", input),
  );
  server.tool(
    "measureTakeoff",
    "Compute calibrated length, polygon area or count, with optional vector snapping. Returns PDF-point geometry; saves nothing.",
    geometry,
    (input) => call("measure", input),
  );
  server.tool(
    "saveTakeoffMeasurement",
    "Save measured geometry as an editable Pickup. comparisonGroup remains unlinked unless linkToItemId is supplied. Points use the declared input space.",
    {
      ...geometry,
      label: z.string().optional(),
      color: z.string().optional(),
      comparisonGroup: z.string().optional(),
      linkToItemId: z.string().optional(),
      quantityField: z.enum(["value", "area"]).optional(),
      multiplier: z
        .number()
        .positive()
        .optional()
        .describe("Explicit multiplier for a linked worksheet quantity."),
    },
    (input) => call("save", input),
  );
  server.tool(
    "updateTakeoffMeasurement",
    "Edit saved PDF geometry or labels and recompute linked quantities. Human pickups require explicit editHuman.",
    {
      pickupId: z.string(),
      points: z.array(point).min(1).optional(),
      viewId: source.viewId,
      coordinateSpace: source.coordinateSpace,
      label: z.string().optional(),
      color: z.string().optional(),
      editHuman: z.boolean().optional(),
      snap: z.boolean().optional(),
      tolerance: geometry.tolerance,
    },
    (input) => call("update", input),
  );
  server.tool(
    "traceDrawingRun",
    "Trace connected PDF vector linework from a seed. Returns PDF-point paths, lengths, branches and stop reasons; saves nothing.",
    {
      ...source,
      seed: point,
      tolerance: geometry.tolerance,
      maxSegments: z.number().int().positive().max(5000).optional(),
    },
    (input) => call("trace", input),
  );
  server.tool(
    "detectDrawingScale",
    "Read title-block OCR scales and explicit dimension-line ratios. Returns separate candidates and conflicts; saves no calibration.",
    source,
    (input) => call("detect-scale", input),
  );
  server.tool(
    "extractDrawingLegend",
    "Extract legend symbols, descriptions and PDF-inch crop boxes from a drawing page.",
    source,
    (input) => call("extract-legend", input),
  );
  server.tool(
    "createSymbolTemplateFromRegion",
    "Save a drawing crop as a project SymbolTemplate. Region uses view-normalized coordinates with viewId, otherwise PDF points. Alternatively pass an extracted legendEntry unchanged.",
    {
      ...source,
      region: box.optional(),
      legendEntry: z
        .object({
          symbol: z.string(),
          label: z.string(),
          pageNumber: z.number().int().positive(),
          confidence: z.number().min(0).max(1),
          symbolBbox: box,
        })
        .optional(),
      symbol: z.string().optional(),
      label: z.string().optional(),
      threshold: z.number().min(0.3).max(0.95).optional(),
    },
    (input) => call("create-template", input),
  );
  server.tool(
    "renderTakeoffOverlay",
    "Render the native PDF and saved pickup overlay as two images, with pickup ids, quantities and source references. Region uses the declared input coordinate space.",
    {
      ...source,
      region: box.optional(),
      pickupIds: z.array(z.string()).optional(),
    },
    (input) => call("overlay", input),
  );
}
