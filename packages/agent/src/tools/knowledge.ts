import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";

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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Knowledge query results would be returned here", query: input }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Project document query results would be returned here", query: input }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Global library query results would be returned here", query: input }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Document list would be returned here", projectId: input.projectId }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Document chunks would be returned here", documentId: input.documentId }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Document summary would be returned here", documentId: input.documentId }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Document comparison would be returned here", documentIdA: input.documentIdA, documentIdB: input.documentIdB }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Catalog search results would be returned here", query: input }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Catalog item added", input }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Catalog item updated", input }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Catalog item removed", itemId: input.itemId }, duration_ms: 0 };
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
}, async () => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Catalog list would be returned here" }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Citation context would be returned here", citationId: input.citationId }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Document ingested", input }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Document indexed", documentId: input.documentId }, duration_ms: 0 };
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
    const res = await fetch(`${ctx.apiBaseUrl}/knowledge/search?${params.toString()}`);
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
    const res = await fetch(`${ctx.apiBaseUrl}/knowledge/books/${input.bookId}/chunks`);
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
    const res = await fetch(`${ctx.apiBaseUrl}/datasets/${input.datasetId}/query`, {
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
    const res = await fetch(`${ctx.apiBaseUrl}/datasets/${input.datasetId}/search?${params.toString()}`);
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
    const res = await fetch(`${ctx.apiBaseUrl}/datasets${params}`);
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
    const res = await fetch(`${ctx.apiBaseUrl}/datasets/${input.datasetId}/rows`, {
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
    const res = await fetch(`${ctx.apiBaseUrl}/knowledge/books/${input.bookId}/chunks`, {
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
];
