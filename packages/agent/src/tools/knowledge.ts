import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";
import { apiFetch } from "./api-fetch.js";

type KnowledgeOperationResult = { success: boolean; data?: unknown; error?: string; citations?: ToolResult["citations"]; sideEffects?: string[]; duration_ms?: number };
type KnowledgeOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<KnowledgeOperationResult>;

function createKnowledgeTool(def: {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodType;
  requiresConfirmation?: boolean;
  mutates?: boolean;
  tags: string[];
}, operation: KnowledgeOperation): Tool {
  return {
    definition: {
      id: def.id,
      name: def.name,
      category: "knowledge",
      description: def.description,
      parameters: [],
      inputSchema: def.inputSchema,
      requiresConfirmation: def.requiresConfirmation ?? false,
      mutates: def.mutates ?? false,
      tags: def.tags,
    },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext) {
      const start = Date.now();
      try {
        const result = await operation(context, input);
        return { ...result, duration_ms: Date.now() - start };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), duration_ms: Date.now() - start };
      }
    },
  };
}

// ──────────────────────────────────────────────────────────────
// 1. knowledge.queryKnowledge
// ──────────────────────────────────────────────────────────────
export const queryKnowledgeTool = createKnowledgeTool({
  id: "knowledge.queryKnowledge",
  name: "Query Knowledge Base",
  description: "Search across all indexed documents using semantic search. Optionally scope to a project, the global library, or both.",
  inputSchema: z.object({
    query: z.string().describe("Natural language search query"),
    projectId: z.string().optional().describe("Limit search to a specific project's documents"),
    scope: z.enum(["project", "library", "all"]).optional().default("all").describe("Search scope: project docs, global library, or all"),
    limit: z.number().optional().default(10).describe("Maximum number of results to return"),
  }),
  tags: ["knowledge", "search", "read"],
}, async (ctx, input) => {
  const scope = (input.scope as string) || "all";
  const query = String(input.query);
  const limit = input.limit ? String(input.limit) : "10";
  const projectId = input.projectId ? String(input.projectId) : ctx.projectId;

  const results: Record<string, unknown> = { query, scope };

  if (scope === "project" || scope === "all") {
    const params = new URLSearchParams({ q: query, projectId, limit, includeProjectDocs: "true" });
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/search/enhanced?${params.toString()}`);
    if (!res.ok) return { success: false, error: `Project search failed: ${res.status} ${res.statusText}` };
    results.projectResults = await res.json();
  }

  if (scope === "library" || scope === "all") {
    const params = new URLSearchParams({ q: query, limit });
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/search/enhanced?${params.toString()}`);
    if (!res.ok) return { success: false, error: `Library search failed: ${res.status} ${res.statusText}` };
    results.libraryResults = await res.json();
  }

  return { success: true, data: results };
});

// ──────────────────────────────────────────────────────────────
// 2. knowledge.queryProjectDocs
// ──────────────────────────────────────────────────────────────
export const queryProjectDocsTool = createKnowledgeTool({
  id: "knowledge.queryProjectDocs",
  name: "Query Project Documents",
  description: "Search only within a specific project's indexed documents.",
  inputSchema: z.object({
    query: z.string().describe("Natural language search query"),
    projectId: z.string().describe("Project ID to search within"),
    limit: z.number().optional().default(10).describe("Maximum number of results to return"),
  }),
  tags: ["knowledge", "project", "search", "read"],
}, async (ctx, input) => {
  const params = new URLSearchParams({
    q: String(input.query),
    projectId: String(input.projectId),
    includeProjectDocs: "true",
  });
  if (input.limit) params.set("limit", String(input.limit));
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/search/enhanced?${params.toString()}`);
  if (!res.ok) return { success: false, error: `Query project docs failed: ${res.status} ${res.statusText}` };
  const data = await res.json();
  return { success: true, data };
});

// ──────────────────────────────────────────────────────────────
// 3. knowledge.queryGlobalLibrary
// ──────────────────────────────────────────────────────────────
export const queryGlobalLibraryTool = createKnowledgeTool({
  id: "knowledge.queryGlobalLibrary",
  name: "Query Global Library",
  description: "Search only within the global document library shared across all projects.",
  inputSchema: z.object({
    query: z.string().describe("Natural language search query"),
    limit: z.number().optional().default(10).describe("Maximum number of results to return"),
  }),
  tags: ["knowledge", "library", "search", "read"],
}, async (ctx, input) => {
  const params = new URLSearchParams({ q: String(input.query) });
  if (input.limit) params.set("limit", String(input.limit));
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/search/enhanced?${params.toString()}`);
  if (!res.ok) return { success: false, error: `Query global library failed: ${res.status} ${res.statusText}` };
  const data = await res.json();
  return { success: true, data };
});

// ──────────────────────────────────────────────────────────────
// 4. knowledge.listDocuments
// ──────────────────────────────────────────────────────────────
export const listDocumentsTool = createKnowledgeTool({
  id: "knowledge.listDocuments",
  name: "List Documents",
  description: "List all source documents associated with a project, including their indexing status and metadata.",
  inputSchema: z.object({
    projectId: z.string().describe("Project ID to list documents for"),
  }),
  tags: ["knowledge", "document", "list", "read"],
}, async (ctx, input) => {
  const projectId = String(input.projectId);
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/documents/${projectId}`);
  if (!res.ok) return { success: false, error: `List documents failed: ${res.status} ${res.statusText}` };
  const data = await res.json();
  return { success: true, data };
});

// ──────────────────────────────────────────────────────────────
// 5. knowledge.getDocumentChunks
// ──────────────────────────────────────────────────────────────
export const getDocumentChunksTool = createKnowledgeTool({
  id: "knowledge.getDocumentChunks",
  name: "Get Document Chunks",
  description: "Get all text chunks for a specific document, useful for reviewing how a document was split during indexing.",
  inputSchema: z.object({
    documentId: z.string().describe("ID of the document to get chunks for"),
  }),
  tags: ["knowledge", "document", "chunks", "read"],
}, async (ctx, input) => {
  const documentId = String(input.documentId);
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/knowledge/books/${documentId}/chunks`);
  if (!res.ok) return { success: false, error: `Get document chunks failed: ${res.status} ${res.statusText}` };
  const data = await res.json();
  return { success: true, data };
});

// ──────────────────────────────────────────────────────────────
// 6. knowledge.summarizeDocument
// ──────────────────────────────────────────────────────────────
export const summarizeDocumentTool = createKnowledgeTool({
  id: "knowledge.summarizeDocument",
  name: "Summarize Document",
  description: "Generate a summary of a full document, including key topics, sections, and relevant estimating information.",
  inputSchema: z.object({
    documentId: z.string().describe("ID of the document to summarize"),
  }),
  tags: ["knowledge", "document", "summarize", "read"],
}, async (ctx, input) => {
  const documentId = String(input.documentId);
  // Fetch the document's chunks to build a summary
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/knowledge/books/${documentId}/chunks`);
  if (!res.ok) return { success: false, error: `Failed to fetch document chunks: ${res.status} ${res.statusText}` };
  const chunksData = await res.json() as Record<string, unknown>;
  const chunks = Array.isArray(chunksData) ? chunksData : (Array.isArray(chunksData.chunks) ? chunksData.chunks : []);
  const totalChunks = chunks.length;
  const sections = chunks.map((c: { sectionTitle?: string }) => c.sectionTitle).filter(Boolean);
  const uniqueSections = [...new Set(sections)];
  const totalCharacters = chunks.reduce((sum: number, c: { text?: string }) => sum + (c.text?.length ?? 0), 0);

  return {
    success: true,
    data: {
      documentId,
      totalChunks,
      totalCharacters,
      sections: uniqueSections,
      chunks,
    },
  };
});

// ──────────────────────────────────────────────────────────────
// 7. knowledge.compareDocuments
// ──────────────────────────────────────────────────────────────
export const compareDocumentsTool = createKnowledgeTool({
  id: "knowledge.compareDocuments",
  name: "Compare Documents",
  description: "Compare two documents and highlight differences, additions, and removals. Useful for comparing spec revisions.",
  inputSchema: z.object({
    documentIdA: z.string().describe("ID of the first document"),
    documentIdB: z.string().describe("ID of the second document"),
  }),
  tags: ["knowledge", "document", "compare", "read"],
}, async (ctx, input) => {
  const docIdA = String(input.documentIdA);
  const docIdB = String(input.documentIdB);

  const [resA, resB] = await Promise.all([
    fetch(`${ctx.apiBaseUrl}/knowledge/books/${docIdA}/chunks`),
    fetch(`${ctx.apiBaseUrl}/knowledge/books/${docIdB}/chunks`),
  ]);

  if (!resA.ok) return { success: false, error: `Failed to fetch document A chunks: ${resA.status} ${resA.statusText}` };
  if (!resB.ok) return { success: false, error: `Failed to fetch document B chunks: ${resB.status} ${resB.statusText}` };

  const dataA = await resA.json() as Record<string, unknown>;
  const dataB = await resB.json() as Record<string, unknown>;
  const chunksA = Array.isArray(dataA) ? dataA : (Array.isArray(dataA.chunks) ? dataA.chunks : []);
  const chunksB = Array.isArray(dataB) ? dataB : (Array.isArray(dataB.chunks) ? dataB.chunks : []);

  const sectionsA = chunksA.map((c: { sectionTitle?: string }) => c.sectionTitle).filter(Boolean);
  const sectionsB = chunksB.map((c: { sectionTitle?: string }) => c.sectionTitle).filter(Boolean);
  const uniqueSectionsA = new Set(sectionsA);
  const uniqueSectionsB = new Set(sectionsB);

  const onlyInA = [...uniqueSectionsA].filter(s => !uniqueSectionsB.has(s));
  const onlyInB = [...uniqueSectionsB].filter(s => !uniqueSectionsA.has(s));
  const common = [...uniqueSectionsA].filter(s => uniqueSectionsB.has(s));

  return {
    success: true,
    data: {
      documentIdA: docIdA,
      documentIdB: docIdB,
      documentA: { totalChunks: chunksA.length, sections: [...uniqueSectionsA], chunks: chunksA },
      documentB: { totalChunks: chunksB.length, sections: [...uniqueSectionsB], chunks: chunksB },
      comparison: {
        sectionsOnlyInA: onlyInA,
        sectionsOnlyInB: onlyInB,
        commonSections: common,
      },
    },
  };
});

// ──────────────────────────────────────────────────────────────
// 8. knowledge.searchCatalogs
// ──────────────────────────────────────────────────────────────
export const searchCatalogsTool = createKnowledgeTool({
  id: "knowledge.searchCatalogs",
  name: "Search Catalogs",
  description: "Search rate and material catalogs for items by keyword. Optionally filter to a specific catalog.",
  inputSchema: z.object({
    query: z.string().describe("Search query for catalog items"),
    catalogId: z.string().optional().describe("Limit search to a specific catalog"),
  }),
  tags: ["knowledge", "catalog", "search", "read"],
}, async (ctx, input) => {
  const params = new URLSearchParams({ q: String(input.query) });
  if (input.catalogId) params.set("catalogId", String(input.catalogId));
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/catalogs/items/search?${params.toString()}`);
  if (!res.ok) return { success: false, error: `Search catalogs failed: ${res.status} ${res.statusText}` };
  const data = await res.json();
  return { success: true, data };
});

// ──────────────────────────────────────────────────────────────
// 9. knowledge.addCatalogItem
// ──────────────────────────────────────────────────────────────
export const addCatalogItemTool = createKnowledgeTool({
  id: "knowledge.addCatalogItem",
  name: "Add Catalog Item",
  description: "Add a new item to a rate or material catalog.",
  inputSchema: z.object({
    catalogId: z.string().describe("ID of the catalog to add the item to"),
    code: z.string().describe("Item code or SKU"),
    name: z.string().describe("Item name"),
    unit: z.string().describe("Unit of measure (e.g. 'EA', 'LF', 'SF')"),
    unitCost: z.number().describe("Cost per unit"),
    unitPrice: z.number().describe("Price per unit"),
  }),
  mutates: true,
  tags: ["knowledge", "catalog", "create", "write"],
}, async (ctx, input) => {
  const catalogId = String(input.catalogId);
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/catalogs/${catalogId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: input.code,
      name: input.name,
      unit: input.unit,
      unitCost: input.unitCost,
      unitPrice: input.unitPrice,
    }),
  });
  if (!res.ok) return { success: false, error: `Add catalog item failed: ${res.status} ${res.statusText}` };
  const data = await res.json();
  return { success: true, data, sideEffects: [`Created catalog item "${input.name}" in catalog ${catalogId}`] };
});

// ──────────────────────────────────────────────────────────────
// 10. knowledge.updateCatalogItem
// ──────────────────────────────────────────────────────────────
export const updateCatalogItemTool = createKnowledgeTool({
  id: "knowledge.updateCatalogItem",
  name: "Update Catalog Item",
  description: "Update an existing catalog item. Only fields provided will be changed.",
  inputSchema: z.object({
    itemId: z.string().describe("ID of the catalog item to update"),
    code: z.string().optional().describe("New item code"),
    name: z.string().optional().describe("New item name"),
    unit: z.string().optional().describe("New unit of measure"),
    unitCost: z.number().optional().describe("New cost per unit"),
    unitPrice: z.number().optional().describe("New price per unit"),
  }),
  mutates: true,
  tags: ["knowledge", "catalog", "update", "write"],
}, async (ctx, input) => {
  const itemId = String(input.itemId);
  const { itemId: _, ...updates } = input;
  // Only include defined fields
  const body: Record<string, unknown> = {};
  if (updates.code !== undefined) body.code = updates.code;
  if (updates.name !== undefined) body.name = updates.name;
  if (updates.unit !== undefined) body.unit = updates.unit;
  if (updates.unitCost !== undefined) body.unitCost = updates.unitCost;
  if (updates.unitPrice !== undefined) body.unitPrice = updates.unitPrice;

  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/catalog-items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { success: false, error: `Update catalog item failed: ${res.status} ${res.statusText}` };
  const data = await res.json();
  return { success: true, data, sideEffects: [`Updated catalog item ${itemId}`] };
});

// ──────────────────────────────────────────────────────────────
// 11. knowledge.removeCatalogItem
// ──────────────────────────────────────────────────────────────
export const removeCatalogItemTool = createKnowledgeTool({
  id: "knowledge.removeCatalogItem",
  name: "Remove Catalog Item",
  description: "Remove an item from a catalog. This action requires confirmation.",
  inputSchema: z.object({
    itemId: z.string().describe("ID of the catalog item to remove"),
  }),
  requiresConfirmation: true,
  mutates: true,
  tags: ["knowledge", "catalog", "delete", "write"],
}, async (ctx, input) => {
  const itemId = String(input.itemId);
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/catalog-items/${itemId}`, {
    method: "DELETE",
  });
  if (!res.ok) return { success: false, error: `Remove catalog item failed: ${res.status} ${res.statusText}` };
  // DELETE may return empty body
  let data: unknown = { deleted: true, itemId };
  try { data = await res.json(); } catch { /* empty response is fine */ }
  return { success: true, data, sideEffects: [`Removed catalog item ${itemId}`] };
});

// ──────────────────────────────────────────────────────────────
// 12. knowledge.listCatalogs
// ──────────────────────────────────────────────────────────────
export const listCatalogsTool = createKnowledgeTool({
  id: "knowledge.listCatalogs",
  name: "List Catalogs",
  description: "List all available rate and material catalogs with their item counts.",
  inputSchema: z.object({}),
  tags: ["knowledge", "catalog", "list", "read"],
}, async (ctx) => {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/catalogs`);
  if (!res.ok) return { success: false, error: `List catalogs failed: ${res.status} ${res.statusText}` };
  const data = await res.json();
  return { success: true, data };
});

// ──────────────────────────────────────────────────────────────
// 13. knowledge.getCitationContext
// ──────────────────────────────────────────────────────────────
export const getCitationContextTool = createKnowledgeTool({
  id: "knowledge.getCitationContext",
  name: "Get Citation Context",
  description: "Get the surrounding text for a citation, providing more context around an excerpt referenced in a previous answer.",
  inputSchema: z.object({
    citationId: z.string().describe("ID of the citation to get context for"),
  }),
  tags: ["knowledge", "citation", "context", "read"],
}, async (ctx, input) => {
  const citationId = String(input.citationId);
  // The citationId corresponds to a chunk ID; fetch the chunk and its siblings
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/knowledge/books/${citationId}/chunks`);
  if (!res.ok) return { success: false, error: `Get citation context failed: ${res.status} ${res.statusText}` };
  const data = await res.json();
  return { success: true, data };
});

// ──────────────────────────────────────────────────────────────
// 14. knowledge.ingestDocument
// ──────────────────────────────────────────────────────────────
export const ingestDocumentTool = createKnowledgeTool({
  id: "knowledge.ingestDocument",
  name: "Ingest Document",
  description: "Ingest a document into the knowledge base, parsing and chunking it for later retrieval.",
  inputSchema: z.object({
    documentId: z.string().describe("ID of the uploaded document to ingest"),
    projectId: z.string().describe("Project ID to associate the document with"),
    scope: z.enum(["project", "library"]).describe("Whether to add to project docs or global library"),
  }),
  mutates: true,
  tags: ["knowledge", "document", "ingest", "write"],
}, async (ctx, input) => {
  const endpoint = (input.scope as string) === "library"
    ? `${ctx.apiBaseUrl}/api/knowledge/library`
    : `${ctx.apiBaseUrl}/api/knowledge/ingest`;

  const res = await apiFetch(ctx, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: input.documentId,
      projectId: input.projectId,
    }),
  });
  if (!res.ok) return { success: false, error: `Ingest document failed: ${res.status} ${res.statusText}` };
  const data = await res.json();
  return { success: true, data, sideEffects: [`Queued document ${input.documentId} for ingestion (${input.scope})`] };
});

// ──────────────────────────────────────────────────────────────
// 15. knowledge.indexDocument
// ──────────────────────────────────────────────────────────────
export const indexDocumentTool = createKnowledgeTool({
  id: "knowledge.indexDocument",
  name: "Index Document",
  description: "Index a document for vector search by generating embeddings for all its chunks.",
  inputSchema: z.object({
    documentId: z.string().describe("ID of the document to index"),
  }),
  mutates: true,
  tags: ["knowledge", "document", "index", "write"],
}, async (ctx, input) => {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: input.documentId,
    }),
  });
  if (!res.ok) return { success: false, error: `Index document failed: ${res.status} ${res.statusText}` };
  const data = await res.json();
  return { success: true, data, sideEffects: [`Queued document ${input.documentId} for indexing`] };
});

// ──────────────────────────────────────────────────────────────
// 16. knowledge.searchBooks
// ──────────────────────────────────────────────────────────────
export const searchBooksTool = createKnowledgeTool({
  id: "knowledge.searchBooks",
  name: "Search Knowledge Books",
  description: "Search knowledge books by text query. Returns matching chunks across all indexed books or a specific book.",
  inputSchema: z.object({
    query: z.string().describe("Text search query"),
    bookId: z.string().optional().describe("Limit search to a specific book"),
    limit: z.number().optional().default(20).describe("Maximum results to return"),
  }),
  tags: ["knowledge", "books", "search", "read"],
}, async (ctx, input) => {
  const params = new URLSearchParams({ q: String(input.query) });
  if (input.bookId) params.set("bookId", String(input.bookId));
  if (input.limit) params.set("limit", String(input.limit));
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/search/enhanced?${params.toString()}`);
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 17. knowledge.getBookChunks
// ──────────────────────────────────────────────────────────────
export const getBookChunksTool = createKnowledgeTool({
  id: "knowledge.getBookChunks",
  name: "Get Book Chunks",
  description: "Get all text chunks from a specific knowledge book.",
  inputSchema: z.object({
    bookId: z.string().describe("ID of the knowledge book"),
  }),
  tags: ["knowledge", "books", "chunks", "read"],
}, async (ctx, input) => {
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/knowledge/books/${input.bookId}/chunks`);
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 18. knowledge.queryDataset
// ──────────────────────────────────────────────────────────────
export const queryDatasetTool = createKnowledgeTool({
  id: "knowledge.queryDataset",
  name: "Query Dataset",
  description: "Query a dataset with structured filters. Use this to look up NECA labour hours, equipment rates, material prices, etc.",
  inputSchema: z.object({
    datasetId: z.string().describe("ID of the dataset to query"),
    filters: z.array(z.object({
      column: z.string().describe("Column key to filter on"),
      op: z.enum(["eq", "gt", "lt", "gte", "lte", "contains"]).describe("Comparison operator"),
      value: z.unknown().describe("Value to compare against"),
    })).describe("Array of filter conditions"),
  }),
  tags: ["knowledge", "dataset", "query", "read"],
}, async (ctx, input) => {
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/datasets/${input.datasetId}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters: input.filters }),
    });
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 19. knowledge.searchDataset
// ──────────────────────────────────────────────────────────────
export const searchDatasetTool = createKnowledgeTool({
  id: "knowledge.searchDataset",
  name: "Search Dataset",
  description: "Text search across all rows in a dataset.",
  inputSchema: z.object({
    datasetId: z.string().describe("ID of the dataset to search"),
    query: z.string().describe("Text search query"),
  }),
  tags: ["knowledge", "dataset", "search", "read"],
}, async (ctx, input) => {
  try {
    const params = new URLSearchParams({ q: String(input.query) });
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/datasets/${input.datasetId}/search?${params.toString()}`);
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 20. knowledge.listDatasets
// ──────────────────────────────────────────────────────────────
export const listDatasetsTool = createKnowledgeTool({
  id: "knowledge.listDatasets",
  name: "List Datasets",
  description: "List all available datasets with their column definitions. Helps the agent discover what structured data is available (NECA hours, equipment rates, etc.).",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Optionally filter to datasets for a specific project"),
  }),
  tags: ["knowledge", "dataset", "list", "read"],
}, async (ctx, input) => {
  try {
    const params = input.projectId ? `?projectId=${input.projectId}` : "";
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/datasets${params}`);
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 21. knowledge.addDatasetRow
// ──────────────────────────────────────────────────────────────
export const addDatasetRowTool = createKnowledgeTool({
  id: "knowledge.addDatasetRow",
  name: "Add Dataset Row",
  description: "Add a row to a dataset. The agent can use this to populate data from research, calculations, or external sources.",
  inputSchema: z.object({
    datasetId: z.string().describe("ID of the dataset to add a row to"),
    data: z.record(z.unknown()).describe("Row data keyed by column key"),
  }),
  mutates: true,
  tags: ["knowledge", "dataset", "create", "write"],
}, async (ctx, input) => {
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/datasets/${input.datasetId}/rows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: input.data }),
    });
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 22. knowledge.addKnowledgeChunk
// ──────────────────────────────────────────────────────────────
export const addKnowledgeChunkTool = createKnowledgeTool({
  id: "knowledge.addKnowledgeChunk",
  name: "Add Knowledge Chunk",
  description: "Add a text chunk to a knowledge book. The agent can use this to extract and store knowledge from research or conversations.",
  inputSchema: z.object({
    bookId: z.string().describe("ID of the knowledge book to add the chunk to"),
    sectionTitle: z.string().describe("Title or heading for this chunk"),
    text: z.string().describe("The text content to store"),
    pageNumber: z.number().optional().describe("Page number in the source document"),
  }),
  mutates: true,
  tags: ["knowledge", "books", "create", "write"],
}, async (ctx, input) => {
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/knowledge/books/${input.bookId}/chunks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sectionTitle: input.sectionTitle,
        text: input.text,
        pageNumber: input.pageNumber ?? null,
      }),
    });
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 22. knowledge.viewBook
// ──────────────────────────────────────────────────────────────
export const viewBookTool = createKnowledgeTool({
  id: "knowledge.viewBook",
  name: "View Knowledge Book",
  description: "Read a knowledge book's content by returning its metadata and paginated chunks. Use this to read through a book's content in manageable portions.",
  inputSchema: z.object({
    bookId: z.string().describe("ID of the knowledge book to read"),
    startChunk: z.number().optional().default(0).describe("Starting chunk index (0-based)"),
    maxChunks: z.number().optional().default(50).describe("Maximum number of chunks to return (default 50)"),
  }),
  tags: ["knowledge", "books", "read"],
}, async (ctx, input) => {
  try {
    const bookRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/knowledge/books/${input.bookId}`, {
      headers: ctx.authToken ? { Authorization: `Bearer ${ctx.authToken}` } : {},
    });
    if (!bookRes.ok) return { success: false, error: `Book not found: ${bookRes.status}` };
    const book = await bookRes.json();

    const chunksRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/knowledge/books/${input.bookId}/chunks`, {
      headers: ctx.authToken ? { Authorization: `Bearer ${ctx.authToken}` } : {},
    });
    if (!chunksRes.ok) return { success: false, error: `Failed to fetch chunks: ${chunksRes.status}` };
    const allChunks = await chunksRes.json();

    const start = (input.startChunk as number) ?? 0;
    const max = (input.maxChunks as number) ?? 50;
    const paginatedChunks = allChunks.slice(start, start + max);

    return {
      success: true,
      data: {
        book: {
          id: book.id,
          name: book.name,
          description: book.description,
          category: book.category,
          scope: book.scope,
          pageCount: book.pageCount,
          chunkCount: book.chunkCount,
          status: book.status,
          sourceFileName: book.sourceFileName,
        },
        chunks: paginatedChunks.map((c: any) => ({
          index: c.order,
          sectionTitle: c.sectionTitle,
          pageNumber: c.pageNumber,
          text: c.text,
        })),
        pagination: {
          startChunk: start,
          returnedChunks: paginatedChunks.length,
          totalChunks: allChunks.length,
          hasMore: start + max < allChunks.length,
        },
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 23. knowledge.viewBookPage
// ──────────────────────────────────────────────────────────────
export const viewBookPageTool = createKnowledgeTool({
  id: "knowledge.viewBookPage",
  name: "View Book Page",
  description: "Get chunks from a knowledge book filtered by page number range. Useful for reading specific pages of a book.",
  inputSchema: z.object({
    bookId: z.string().describe("ID of the knowledge book"),
    startPage: z.number().describe("Starting page number"),
    endPage: z.number().optional().describe("Ending page number (defaults to startPage)"),
  }),
  tags: ["knowledge", "books", "read"],
}, async (ctx, input) => {
  try {
    const chunksRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/knowledge/books/${input.bookId}/chunks`, {
      headers: ctx.authToken ? { Authorization: `Bearer ${ctx.authToken}` } : {},
    });
    if (!chunksRes.ok) return { success: false, error: `Failed to fetch chunks: ${chunksRes.status}` };
    const allChunks = await chunksRes.json();

    const startPage = input.startPage as number;
    const endPage = (input.endPage as number) ?? startPage;

    const pageChunks = allChunks.filter((c: any) =>
      c.pageNumber !== null && c.pageNumber >= startPage && c.pageNumber <= endPage
    );

    return {
      success: true,
      data: {
        bookId: input.bookId,
        pageRange: { start: startPage, end: endPage },
        chunks: pageChunks.map((c: any) => ({
          sectionTitle: c.sectionTitle,
          pageNumber: c.pageNumber,
          text: c.text,
        })),
        chunkCount: pageChunks.length,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 24. knowledge.extractStructured
// ──────────────────────────────────────────────────────────────
export const extractStructuredTool = createKnowledgeTool({
  id: "knowledge.extractStructured",
  name: "Extract Structured Data from Document",
  description:
    "Run Azure Document Intelligence on a document to extract structured tables, " +
    "key-value pairs, and OCR text. Use this when you need richer data from a PDF " +
    "than basic text extraction provides — especially for scanned documents, forms, " +
    "or documents with complex tables.",
  inputSchema: z.object({
    documentId: z.string().describe("ID of the document (KnowledgeBook or SourceDocument) to analyze"),
    projectId: z.string().optional().describe("Project ID for context"),
    model: z
      .enum(["prebuilt-layout", "prebuilt-document", "prebuilt-invoice", "prebuilt-read"])
      .optional()
      .default("prebuilt-layout")
      .describe(
        "Azure DI model: prebuilt-layout (tables + text + sections), " +
        "prebuilt-document (key-value pairs + entities), " +
        "prebuilt-invoice (invoice-specific fields), " +
        "prebuilt-read (OCR text only)"
      ),
    updateDocument: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, update the stored document metadata with the richer extraction results"),
  }),
  mutates: true,
  tags: ["knowledge", "document", "extraction", "azure", "ocr", "tables"],
}, async (ctx, input) => {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/extract-structured`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: input.documentId,
      projectId: input.projectId ?? ctx.projectId,
      model: input.model ?? "prebuilt-layout",
      updateDocument: input.updateDocument ?? false,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    return { success: false, error: `Structured extraction failed (${res.status}): ${errBody}` };
  }

  const data = await res.json() as {
    success: boolean;
    data?: {
      content: string;
      pageCount: number;
      tables: Array<{ pageNumber: number; headers: string[]; rows: string[][]; rawMarkdown: string }>;
      keyValuePairs: Array<{ key: string; value: string; confidence: number }>;
      selectionMarks: Array<{ state: string; pageNumber: number; confidence: number }>;
      pages: Array<{ pageNumber: number; content: string; sectionCount: number }>;
      warnings: string[];
    };
  };

  if (!data.success || !data.data) {
    return { success: false, error: "Extraction returned no data" };
  }

  // Build a concise summary for the agent
  const result = data.data;
  const summary: Record<string, unknown> = {
    pageCount: result.pageCount,
    tableCount: result.tables.length,
    keyValuePairCount: result.keyValuePairs.length,
    selectionMarkCount: result.selectionMarks.length,
    warnings: result.warnings,
  };

  // Include tables as markdown for easy consumption
  if (result.tables.length > 0) {
    summary.tables = result.tables.map((t) => ({
      pageNumber: t.pageNumber,
      headers: t.headers,
      rowCount: t.rows.length,
      markdown: t.rawMarkdown,
    }));
  }

  // Include key-value pairs (useful for forms)
  if (result.keyValuePairs.length > 0) {
    summary.keyValuePairs = result.keyValuePairs;
  }

  // Include full text content
  summary.content = result.content;

  return {
    success: true,
    data: summary,
    sideEffects: input.updateDocument
      ? [`Updated document ${input.documentId} with Azure DI extraction results`]
      : undefined,
  };
});

// ──────────────────────────────────────────────────────────────
// Export all tools as array
// ──────────────────────────────────────────────────────────────
export const knowledgeTools: Tool[] = [
  queryKnowledgeTool,
  queryProjectDocsTool,
  queryGlobalLibraryTool,
  listDocumentsTool,
  getDocumentChunksTool,
  summarizeDocumentTool,
  compareDocumentsTool,
  searchCatalogsTool,
  addCatalogItemTool,
  updateCatalogItemTool,
  removeCatalogItemTool,
  listCatalogsTool,
  getCitationContextTool,
  ingestDocumentTool,
  indexDocumentTool,
  searchBooksTool,
  getBookChunksTool,
  queryDatasetTool,
  searchDatasetTool,
  listDatasetsTool,
  addDatasetRowTool,
  addKnowledgeChunkTool,
  viewBookTool,
  viewBookPageTool,
  extractStructuredTool,
];
