import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiDelete, apiGet, apiPost, getProjectId } from "../api-client.js";

function modelEditorPath(asset: any) {
  const sourcePath = asset.sourceDocumentId
    ? `/projects/${asset.projectId}/documents/${asset.sourceDocumentId}/download?inline=1`
    : asset.fileNodeId
      ? `/projects/${asset.projectId}/files/${asset.fileNodeId}/download?inline=1`
      : "";
  const params = new URLSearchParams({ embedded: "1", bidwright: "1" });
  if (sourcePath) params.set("url", sourcePath);
  if (asset.fileName) params.set("fileName", asset.fileName);
  return `/model-editor/index.html?${params.toString()}`;
}

function normalizedAsset(asset: any) {
  const manifest = asset.manifest ?? {};
  return {
    id: asset.id,
    projectId: asset.projectId,
    fileName: asset.fileName,
    format: asset.format,
    status: asset.status,
    units: asset.units,
    checksum: asset.checksum,
    source: manifest.source ?? (asset.sourceDocumentId ? "source_document" : "file_node"),
    sourceDocumentId: asset.sourceDocumentId ?? null,
    fileNodeId: asset.fileNodeId ?? null,
    editableInBidWrightModelEditor: Boolean(manifest.editableInBidWrightModelEditor),
    bidwrightEditorPath: modelEditorPath(asset),
    counts: asset._count ?? null,
    updatedAt: asset.updatedAt ?? null,
  };
}

export function registerModelTools(server: McpServer) {
  server.tool(
    "listModels",
    `Scan and list model/CAD/BIM assets in the current project.

Use this before model takeoff, model QA, model/BOM inspection, or when choosing a 3D file to open in BidWright's model editor.`,
    {},
    async () => {
      const projectId = getProjectId();
      const result = await apiGet<any>(`/api/models/${projectId}/assets?refresh=1`);
      const assets = result.assets ?? [];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                count: assets.length,
                syncedIds: result.syncedIds ?? [],
                sourceCount: result.sourceCount ?? assets.length,
                models: assets.map(normalizedAsset),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "getModelManifest",
    `Return a persisted BidWright model manifest.

The manifest includes parser status, source lineage, native file metadata, element/quantity counts, model issues, and any extracted model tree data.`,
    {
      modelId: z.string().describe("Model asset id returned by listModels"),
    },
    async ({ modelId }) => {
      const projectId = getProjectId();
      const result = await apiGet<any>(`/api/models/${projectId}/assets/${modelId}`);
      const asset = result.asset;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                model: normalizedAsset(asset),
                manifest: asset.manifest,
                elementStats: asset.elementStats,
                bom: asset.bom,
                elements: asset.elements ?? [],
                quantities: asset.quantities ?? [],
                issues: asset.issues ?? [],
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "queryModelElements",
    `Query persisted model elements by class/type/material/level/system/name/text.

This tool returns only extracted data. It does not infer or fabricate model elements.`,
    {
      modelId: z.string().describe("Model asset id returned by listModels"),
      query: z
        .object({
          text: z.string().optional(),
          class: z.string().optional(),
          type: z.string().optional(),
          material: z.string().optional(),
          level: z.string().optional(),
          system: z.string().optional(),
          name: z.string().optional(),
          limit: z.number().min(1).max(1000).default(100),
        })
        .default({ limit: 100 }),
    },
    async ({ modelId, query }) => {
      const projectId = getProjectId();
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== "") params.set(key, String(value));
      }
      const result = await apiGet<any>(`/api/models/${projectId}/assets/${modelId}/elements?${params.toString()}`);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                modelId,
                count: result.count ?? result.elements?.length ?? 0,
                elements: result.elements ?? [],
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "extractModelBom",
    `Return the persisted model BOM/quantity rows for estimating.

The BOM is conservative: unsupported formats return a clear status and empty rows instead of guessed quantities.`,
    {
      modelId: z.string().describe("Model asset id returned by listModels"),
      grouping: z.string().optional().describe("Requested grouping note, such as material, class, system, level, or assembly"),
    },
    async ({ modelId, grouping }) => {
      const projectId = getProjectId();
      const result = await apiGet<any>(`/api/models/${projectId}/assets/${modelId}/bom`);
      const rows = result.rows ?? [];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                model: normalizedAsset(result.model),
                grouping: grouping ?? "native",
                status: rows.length > 0 ? "bom_available" : "no_bom_rows_available",
                rows,
                rowCount: result.rowCount ?? rows.length,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "getModelTakeoffLinks",
    `Return the live 5D links between a model asset and quote worksheet line items.

Use this to understand which model elements/quantities already drive estimate rows before creating, editing, or deleting line items.`,
    {
      modelId: z.string().describe("Model asset id returned by listModels"),
    },
    async ({ modelId }) => {
      const projectId = getProjectId();
      const result = await apiGet<any>(`/api/models/${projectId}/assets/${modelId}/takeoff-links`);
      const links = result.links ?? [];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                modelId,
                count: links.length,
                links,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "linkModelElementToWorksheetItem",
    `Create a 5D takeoff link from a model element or model quantity to an existing worksheet line item.

Call createWorksheetItem first when a new estimate row is needed, then call this tool with the returned worksheetItemId and the modelElementId/modelQuantityId from queryModelElements or getModelManifest.`,
    {
      modelId: z.string().describe("Model asset id returned by listModels"),
      worksheetItemId: z.string().describe("Worksheet item id to connect to model geometry"),
      modelElementId: z.string().optional().describe("Model element id, when the line item comes from a specific object/assembly"),
      modelQuantityId: z.string().optional().describe("Persisted model quantity id, when the line item should track a specific extracted quantity"),
      quantityField: z.string().default("quantity").describe("Worksheet item field driven by the model quantity"),
      multiplier: z.number().default(1).describe("Multiplier applied to the model quantity before writing/recording derivedQuantity"),
      derivedQuantity: z.number().optional().describe("Resolved quantity used for the worksheet item if already known"),
      selection: z.record(z.unknown()).optional().describe("Optional UI/model selection payload for traceability"),
    },
    async ({ modelId, ...input }) => {
      const projectId = getProjectId();
      const result = await apiPost<any>(`/api/models/${projectId}/assets/${modelId}/takeoff-links`, input);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                created: true,
                modelId,
                link: result.link ?? result,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "deleteModelTakeoffLink",
    "Delete a 5D takeoff link between a model asset and a worksheet line item. This does not delete the worksheet item itself.",
    {
      modelId: z.string().describe("Model asset id returned by listModels"),
      linkId: z.string().describe("Model takeoff link id returned by getModelTakeoffLinks"),
    },
    async ({ modelId, linkId }) => {
      const projectId = getProjectId();
      const result = await apiDelete<any>(`/api/models/${projectId}/assets/${modelId}/takeoff-links/${linkId}`);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result ?? { deleted: true, linkId }, null, 2),
          },
        ],
      };
    },
  );
}
