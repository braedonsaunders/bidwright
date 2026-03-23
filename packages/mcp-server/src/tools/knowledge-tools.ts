import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, projectPath, getProjectId } from "../api-client.js";

export function registerKnowledgeTools(server: McpServer) {

  // ── queryKnowledge ────────────────────────────────────────
  server.tool(
    "queryKnowledge",
    `Search the knowledge base for information. Searches both project documents and the global library (estimating manuals, rate books, standards). Use this to find man-hour estimates, material specs, labour productivity data, pricing references, and any domain knowledge. Returns text snippets with source, page number, and section title.`,
    {
      query: z.string().describe("Search query — be specific about what you need"),
      scope: z.enum(["project", "library", "all"]).default("all").describe("Search scope: project docs only, global library only, or all"),
      limit: z.number().default(10).describe("Max results to return"),
    },
    async ({ query, scope, limit }) => {
      // Use the text-based search which outperforms vector search for this use case
      const params = new URLSearchParams({ q: query, limit: String(limit), scope });
      const data = await apiGet(`/knowledge/search?${params}`);
      const results = Array.isArray(data) ? data : (data.results || []);
      const hits = results.map((h: any) => ({
        text: h.text?.substring(0, 600),
        source: h.source || h.bookName,
        bookName: h.bookName,
        sectionTitle: h.sectionTitle,
        pageNumber: h.pageNumber,
        score: h.score,
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ query, scope, resultCount: hits.length, hits }, null, 2) }],
      };
    }
  );

  // ── queryGlobalLibrary ────────────────────────────────────
  server.tool(
    "queryGlobalLibrary",
    "Search the global knowledge library only — estimating manuals, labour productivity data, rate books, material specs, industry standards. Use this for domain knowledge like pipe installation hours per foot, equipment rental rates, etc. Returns text snippets with source, page, and section.",
    {
      query: z.string().describe("What to search for — e.g. 'carbon steel butt weld pipe fittings labor hours'"),
      limit: z.number().default(10),
    },
    async ({ query, limit }) => {
      const params = new URLSearchParams({ q: query, scope: "global", limit: String(limit) });
      const data = await apiGet(`/knowledge/search?${params}`);
      const results = Array.isArray(data) ? data : (data.results || []);
      const hits = results.map((h: any) => ({
        text: h.text?.substring(0, 600),
        source: h.source || h.bookName,
        bookName: h.bookName,
        sectionTitle: h.sectionTitle,
        pageNumber: h.pageNumber,
        score: h.score,
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ query, resultCount: hits.length, hits }, null, 2) }],
      };
    }
  );

  // ── queryDatasets ─────────────────────────────────────────
  server.tool(
    "queryDatasets",
    "Search structured datasets — material lists, labour rate tables, equipment catalogs, historical project data. Returns matching rows with all columns.",
    {
      query: z.string().describe("Search query"),
      datasetId: z.string().optional().describe("Specific dataset ID to search within"),
    },
    async ({ query, datasetId }) => {
      const params = new URLSearchParams({ q: query });
      if (datasetId) params.set("datasetId", datasetId);
      const data = await apiGet(`/datasets/search?${params}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── getDocumentStructured ─────────────────────────────────
  server.tool(
    "getDocumentStructured",
    "Get the Azure Document Intelligence structured extraction for a project document — tables (as markdown), key-value pairs, section headings, page-by-page text. Use this when you need parsed table data or form fields from a PDF.",
    {
      documentId: z.string().describe("SourceDocument ID"),
    },
    async ({ documentId }) => {
      const data = await apiGet(`/knowledge/documents/${getProjectId()}/${documentId}`);
      // Return structured data if available
      const doc = data.document || data;
      const result: any = {
        fileName: doc.fileName,
        pageCount: doc.pageCount,
        documentType: doc.documentType,
      };
      if (doc.structuredData) {
        result.tables = doc.structuredData.tables;
        result.keyValuePairs = doc.structuredData.keyValuePairs;
      }
      // Include section headings from chunks if available
      if (doc.chunks) {
        result.sections = [...new Set(doc.chunks.map((c: any) => c.sectionTitle).filter(Boolean))];
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── searchCatalogs ────────────────────────────────────────
  server.tool(
    "searchCatalogs",
    "Search the equipment and material catalogs for items with pricing. Returns catalog items with name, code, unit, unitCost, unitPrice.",
    {
      query: z.string().describe("Search query — e.g. 'fork truck' or 'welder'"),
    },
    async ({ query }) => {
      const params = new URLSearchParams({ q: query });
      const data = await apiGet(`/catalogs/search?${params}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── listDocuments ─────────────────────────────────────────
  server.tool(
    "listDocuments",
    "List all project documents with their metadata — fileName, fileType, documentType, pageCount, whether structured data is available. Use this to understand what documents you have before reading them.",
    {},
    async () => {
      const data = await apiGet(`/knowledge/documents/${getProjectId()}/enhanced`);
      const docs = (data.documents || data || []).map((d: any) => ({
        id: d.id,
        fileName: d.fileName,
        fileType: d.fileType,
        documentType: d.documentType,
        pageCount: d.pageCount,
        hasStructuredData: !!d.structuredData,
        indexingStatus: d.indexingStatus,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify(docs, null, 2) }] };
    }
  );
}
