import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, getProjectId } from "../api-client.js";

function compactManifest(manifest: any) {
  return {
    status: manifest.runStatus,
    family: manifest.family,
    fileName: manifest.provenance?.fileName,
    format: manifest.provenance?.format,
    adapter: manifest.adapter?.adapterId,
    provider: manifest.adapter?.provider,
    capabilityStatus: manifest.adapter?.status,
    summary: manifest.summary,
    document: manifest.document
      ? {
          title: manifest.document.title,
          pageCount: manifest.document.pageCount,
          textLength: manifest.document.textLength,
          tableCount: manifest.document.tableCount,
          sectionCount: manifest.document.sectionCount,
          imageCount: manifest.document.imageCount,
          extractionNotes: manifest.document.extractionNotes,
          textPreview: manifest.document.textPreview,
        }
      : undefined,
    email: manifest.email
      ? {
          subject: manifest.email.subject,
          from: manifest.email.from,
          to: manifest.email.to,
          cc: manifest.email.cc,
          sentAt: manifest.email.sentAt,
          receivedAt: manifest.email.receivedAt,
          attachmentCount: manifest.email.attachmentCount,
          bodyPreview: manifest.email.bodyPreview,
        }
      : undefined,
    archive: manifest.archive
      ? {
          format: manifest.archive.format,
          encrypted: manifest.archive.encrypted,
          entryCount: manifest.archive.entryCount,
          totalUncompressedSize: manifest.archive.totalUncompressedSize,
          sampleEntries: Array.isArray(manifest.archive.entries) ? manifest.archive.entries.slice(0, 25) : [],
        }
      : undefined,
    markups: manifest.markups
      ? {
          source: manifest.markups.source,
          rowCount: manifest.markups.rowCount,
          quantityCount: manifest.markups.quantityCount,
          units: manifest.markups.units,
          subjects: manifest.markups.subjects?.slice?.(0, 25) ?? [],
          pages: manifest.markups.pages?.slice?.(0, 25) ?? [],
          sampleQuantities: Array.isArray(manifest.markups.quantities) ? manifest.markups.quantities.slice(0, 25) : [],
        }
      : undefined,
    model: manifest.model
      ? {
          status: manifest.model.runStatus,
          adapter: manifest.model.adapter?.adapterId,
          provider: manifest.model.adapter?.provider,
          elementStats: manifest.model.elementStats,
          estimateLensCount: Array.isArray(manifest.model.estimateLens) ? manifest.model.estimateLens.length : 0,
        }
      : undefined,
    artifacts: Array.isArray(manifest.artifacts)
      ? manifest.artifacts.map((artifact: any) => ({
          kind: artifact.kind,
          path: artifact.path,
          mediaType: artifact.mediaType,
          size: artifact.size,
        }))
      : [],
    issues: manifest.issues ?? [],
  };
}

export function registerFileIngestTools(server: McpServer) {
  server.tool(
    "getFileIngestCapabilities",
    `Report Bidwright's universal file ingest adapter capabilities.

Use this before relying on extraction from PDFs, Word/Office files, spreadsheets, images, CAD/BIM/model files, text, or unsupported file types. Configuration is organization-scoped through Bidwright settings.`,
    {
      format: z.string().optional().describe("Optional extension filter, such as pdf, docx, xlsx, xlsm, ods, eml, msg, zip, 7z, ifc, rvt, dwg, dxf, step, obj, or png."),
    },
    async ({ format }) => {
      const projectId = getProjectId();
      const params = new URLSearchParams();
      if (format) params.set("format", format);
      const result = await apiGet<any>(`/api/files/${projectId}/ingest-capabilities?${params.toString()}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "inspectFileIngest",
    `Run Bidwright's universal file ingest adapter for one stored project source and return the normalized manifest.

Use listProjectDocuments/listModels/file browser context first to find a sourceDocument or fileNode id. This does not change estimating gates; it materializes durable ingest artifacts for inspection.`,
    {
      sourceKind: z.enum(["source_document", "file_node"]).describe("Stored source kind."),
      sourceId: z.string().describe("SourceDocument or FileNode id."),
      includeRaw: z.boolean().default(false).describe("Return the full canonical manifest. Default false returns a compact summary."),
    },
    async ({ sourceKind, sourceId, includeRaw }) => {
      const projectId = getProjectId();
      const result = await apiPost<any>(`/api/files/${projectId}/ingest`, { sourceKind, sourceId });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(includeRaw ? result : compactManifest(result.manifest ?? result), null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "listScheduleImportCandidates",
    `List already-uploaded project files that Bidwright can import into the native project schedule.

This only reports stored project files. It does not upload files and it does not create or price estimate rows.`,
    {},
    async () => {
      const projectId = getProjectId();
      const result = await apiGet<any>(`/projects/${projectId}/schedule/import-candidates`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "importProjectScheduleFile",
    `Import one already-uploaded Microsoft Project or Primavera P6 file into Bidwright's native schedule.

Use listScheduleImportCandidates first. This replaces the current revision schedule with the parsed tasks/dependencies/resources; it does not change estimating worksheets or evidence gates.`,
    {
      sourceKind: z.enum(["source_document", "file_node"]).describe("Stored source kind from listScheduleImportCandidates."),
      sourceId: z.string().describe("SourceDocument or FileNode id from listScheduleImportCandidates."),
    },
    async ({ sourceKind, sourceId }) => {
      const projectId = getProjectId();
      const result = await apiPost<any>(`/projects/${projectId}/schedule/import`, { sourceKind, sourceId, mode: "replace" });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
