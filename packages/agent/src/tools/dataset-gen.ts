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
// Export all dataset generation tools as array
// ──────────────────────────────────────────────────────────────
export const datasetGenTools: Tool[] = [
  generateFromBookTool,
  importCsvTool,
  suggestSchemaTool,
];
