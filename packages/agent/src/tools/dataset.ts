import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";
import { apiFetch } from "./api-fetch.js";

type DatasetGenOperationResult = { success: boolean; data?: unknown; error?: string; citations?: ToolResult["citations"]; sideEffects?: string[]; duration_ms?: number };
type DatasetGenOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<DatasetGenOperationResult>;

/**
 * Factory for dataset generation tools. These tools use LLM capabilities to
 * extract structured data from knowledge books and import external data into datasets.
 */
function createDatasetGenTool(def: {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodType;
  requiresConfirmation?: boolean;
  mutates?: boolean;
  tags: string[];
}, operation: DatasetGenOperation): Tool {
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
// 1. dataset.generateFromBook
// ──────────────────────────────────────────────────────────────
export const generateFromBookTool = createDatasetGenTool({
  id: "dataset.generateFromBook",
  name: "Generate Dataset from Knowledge Book",
  description: "Extract structured data from a knowledge book's content using AI. Define the column schema and the LLM will read through the book's chunks and populate rows. Great for converting rate books, labor tables, equipment lists into queryable datasets.",
  inputSchema: z.object({
    bookId: z.string().describe("Source knowledge book ID"),
    datasetName: z.string().describe("Name for the new dataset"),
    description: z.string().optional().describe("Description of the dataset"),
    category: z.enum(["labour_units", "equipment_rates", "material_prices", "productivity", "burden_rates", "custom"]).default("custom").describe("Dataset category"),
    columns: z.array(z.object({
      key: z.string().describe("Column key (used in queries)"),
      name: z.string().describe("Human-readable column name"),
      type: z.enum(["text", "number", "currency", "percentage", "boolean", "select"]).describe("Column data type"),
      unit: z.string().optional().describe("Unit of measure (e.g. 'hrs', '$', '%')"),
      description: z.string().optional().describe("Help the AI understand what this column should contain"),
    })).describe("Column definitions for the dataset"),
    scope: z.enum(["global", "project"]).default("global").describe("Whether the dataset is global or project-scoped"),
    sampleRows: z.number().optional().default(5).describe("Number of sample rows to generate first for review"),
  }),
  mutates: true,
  tags: ["dataset", "knowledge", "ai", "write"],
}, async (ctx, input) => {
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/datasets/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: input.bookId,
        datasetName: input.datasetName,
        description: input.description ?? null,
        category: input.category,
        columns: input.columns,
        scope: input.scope,
        sampleRows: input.sampleRows,
        projectId: ctx.projectId,
      }),
    });
    const data = await res.json();
    return { success: true, data, sideEffects: ["dataset_created"] };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 2. dataset.importCsv
// ──────────────────────────────────────────────────────────────
export const importCsvTool = createDatasetGenTool({
  id: "dataset.importCsv",
  name: "Import Data into Dataset",
  description: "Import structured data (CSV format or JSON array) into an existing dataset. The data should match the dataset's column schema.",
  inputSchema: z.object({
    datasetId: z.string().describe("Target dataset ID"),
    format: z.enum(["csv", "json"]).describe("Data format: 'csv' for CSV string with headers, 'json' for JSON array of objects"),
    data: z.string().describe("CSV string with headers, or JSON array of objects"),
    skipHeader: z.boolean().optional().default(true).describe("For CSV: skip the first row (headers)"),
  }),
  mutates: true,
  tags: ["dataset", "import", "write"],
}, async (ctx, input) => {
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/datasets/${input.datasetId}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: input.format,
        data: input.data,
        skipHeader: input.skipHeader,
      }),
    });
    const data = await res.json();
    return { success: true, data, sideEffects: ["dataset_rows_imported"] };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 3. dataset.suggestSchema
// ──────────────────────────────────────────────────────────────
export const suggestSchemaTool = createDatasetGenTool({
  id: "dataset.suggestSchema",
  name: "Suggest Dataset Schema",
  description: "Analyze a knowledge book and suggest an appropriate dataset schema (columns, types, units) for extracting structured data from it. Use this before generateFromBook to let the AI propose a schema.",
  inputSchema: z.object({
    bookId: z.string().describe("Knowledge book to analyze"),
    purpose: z.string().optional().describe("What you want to use the dataset for (helps the AI tailor the schema)"),
  }),
  tags: ["dataset", "knowledge", "ai", "read"],
}, async (ctx, input) => {
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/datasets/suggest-schema`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: input.bookId,
        purpose: input.purpose ?? null,
      }),
    });
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 4. dataset.list
// ──────────────────────────────────────────────────────────────
export const listDatasetsTool = createDatasetGenTool({
  id: "dataset.list",
  name: "List Datasets",
  description: "List all available datasets in the organization. Optionally filter by project. Returns dataset metadata including id, name, category, column schema, and row count. Use this to discover what structured data is available before querying.",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Filter to datasets available in this project (includes global datasets)"),
    category: z.string().optional().describe("Filter by category: labour_units, equipment_rates, material_prices, productivity, burden_rates, custom"),
  }),
  tags: ["dataset", "list", "read", "discovery"],
}, async (ctx, input) => {
  const params = new URLSearchParams();
  if (input.projectId) params.set("projectId", String(input.projectId));
  const qs = params.toString();
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/datasets${qs ? `?${qs}` : ""}`);
  if (!res.ok) return { success: false, error: `Failed to list datasets: ${res.status}` };
  let datasets = await res.json() as any[];
  if (input.category) {
    datasets = datasets.filter((d: any) => d.category === input.category);
  }
  return {
    success: true,
    data: datasets.map((d: any) => ({
      id: d.id, name: d.name, description: d.description, category: d.category,
      scope: d.scope, columns: d.columns, rowCount: d.rowCount, tags: d.tags,
    })),
  };
});

// ──────────────────────────────────────────────────────────────
// 5. dataset.queryRows
// ──────────────────────────────────────────────────────────────
export const queryRowsTool = createDatasetGenTool({
  id: "dataset.queryRows",
  name: "Query Dataset Rows",
  description: "Query rows from a dataset using typed filters. Supports operators: eq (equals), gt (greater than), lt (less than), gte (>=), lte (<=), contains (text search). Combine multiple filters for AND logic. Use dataset.list first to find the dataset ID and column names.",
  inputSchema: z.object({
    datasetId: z.string().describe("Dataset ID to query"),
    filters: z.array(z.object({
      column: z.string().describe("Column key to filter on"),
      op: z.enum(["eq", "gt", "lt", "gte", "lte", "contains"]).describe("Filter operator"),
      value: z.union([z.string(), z.number(), z.boolean()]).describe("Value to compare against"),
    })).describe("Array of filter conditions (AND logic)"),
    limit: z.number().optional().default(50).describe("Max rows to return"),
  }),
  tags: ["dataset", "query", "read"],
}, async (ctx, input) => {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/datasets/${input.datasetId}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filters: input.filters }),
  });
  if (!res.ok) return { success: false, error: `Query failed: ${res.status}` };
  let rows = await res.json() as any[];
  const limit = (input.limit as number) || 50;
  if (rows.length > limit) rows = rows.slice(0, limit);
  return { success: true, data: { rows: rows.map((r: any) => r.data ?? r), total: rows.length } };
});

// ──────────────────────────────────────────────────────────────
// 6. dataset.searchRows
// ──────────────────────────────────────────────────────────────
export const searchRowsTool = createDatasetGenTool({
  id: "dataset.searchRows",
  name: "Search Dataset Rows",
  description: "Full-text search across all columns in a dataset. Returns rows where any column value contains the search query. Useful for finding items by name, description, or any text content. Use dataset.list first to find the dataset ID.",
  inputSchema: z.object({
    datasetId: z.string().describe("Dataset ID to search"),
    query: z.string().describe("Search text — matches against all column values"),
    limit: z.number().optional().default(20).describe("Max rows to return"),
  }),
  tags: ["dataset", "search", "read"],
}, async (ctx, input) => {
  const params = new URLSearchParams({ q: String(input.query) });
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/datasets/${input.datasetId}/search?${params.toString()}`);
  if (!res.ok) return { success: false, error: `Search failed: ${res.status}` };
  let rows = await res.json() as any[];
  const limit = (input.limit as number) || 20;
  if (rows.length > limit) rows = rows.slice(0, limit);
  return { success: true, data: { rows: rows.map((r: any) => r.data ?? r), total: rows.length } };
});

// ──────────────────────────────────────────────────────────────
// Export all dataset tools as array
// ──────────────────────────────────────────────────────────────
export const datasetGenTools: Tool[] = [
  generateFromBookTool,
  importCsvTool,
  suggestSchemaTool,
  listDatasetsTool,
  queryRowsTool,
  searchRowsTool,
];
