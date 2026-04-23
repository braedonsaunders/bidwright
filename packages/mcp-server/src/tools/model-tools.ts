import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, getProjectId } from "../api-client.js";

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
}
