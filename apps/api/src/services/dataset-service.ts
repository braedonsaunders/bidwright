import type { PrismaApiStore } from "../prisma-store.js";
import { createLLMAdapter } from "@bidwright/agent";
import type { Dataset, DatasetColumn, DatasetRow } from "@bidwright/domain";

// ── LLM helper ────────────────────────────────────────────────────────

/**
 * Call an LLM with a system prompt and user prompt.
 */
async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  const provider = process.env.LLM_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai");
  const model = process.env.LLM_MODEL ?? (provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o");

  if (!apiKey) {
    return "[]";
  }

  const adapter = createLLMAdapter({
    provider: provider as "anthropic" | "openai",
    apiKey,
    model,
  });

  const response = await adapter.chat({
    model,
    systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 4096,
    temperature: 0,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text ?? "";
}

// ── CSV parser ────────────────────────────────────────────────────────

/**
 * Parse CSV data handling quoted fields with commas and newlines.
 */
function parseCsv(data: string, skipHeader: boolean): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuote = false;
  let row: string[] = [];

  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    const next = data[i + 1];

    if (inQuote) {
      if (ch === '"' && next === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ",") {
        row.push(current.trim());
        current = "";
      } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
        row.push(current.trim());
        current = "";
        if (row.some((cell) => cell !== "")) {
          rows.push(row);
        }
        row = [];
        if (ch === "\r") i++; // skip \n in \r\n
      } else {
        current += ch;
      }
    }
  }

  // Flush last field/row
  if (current || row.length > 0) {
    row.push(current.trim());
    if (row.some((cell) => cell !== "")) {
      rows.push(row);
    }
  }

  if (skipHeader && rows.length > 0) {
    rows.shift();
  }

  return rows;
}

/**
 * Coerce a string value to the expected column type.
 */
function coerceValue(value: string, type: DatasetColumn["type"]): unknown {
  if (value === "" || value === null || value === undefined) return null;
  switch (type) {
    case "number":
    case "currency":
    case "percentage": {
      const cleaned = value.replace(/[$%,]/g, "").trim();
      const num = Number(cleaned);
      return Number.isNaN(num) ? null : num;
    }
    case "boolean": {
      const lower = value.toLowerCase();
      if (["true", "yes", "1", "y"].includes(lower)) return true;
      if (["false", "no", "0", "n"].includes(lower)) return false;
      return null;
    }
    default:
      return value;
  }
}

// ── DatasetService ────────────────────────────────────────────────────

export class DatasetService {
  /**
   * Generate a dataset from a knowledge book using LLM extraction.
   *
   * Reads chunks from the book, sends them to the LLM with the column schema,
   * and creates structured rows.
   */
  async generateFromBook(params: {
    bookId: string;
    datasetName: string;
    description?: string;
    category: Dataset["category"];
    columns: Array<{ key: string; name: string; type: string; unit?: string; description?: string }>;
    scope: Dataset["scope"];
    projectId?: string;
    sampleOnly?: boolean;
    sampleRows?: number;
  }, store: PrismaApiStore): Promise<{
    datasetId: string;
    rowCount: number;
    sampleRows?: Array<Record<string, unknown>>;
    status: "completed" | "processing";
  }> {
    // 1. Get book and its chunks
    const book = await store!.getKnowledgeBook(params.bookId);
    if (!book) throw new Error(`Knowledge book ${params.bookId} not found`);

    const chunks = await store!.listKnowledgeChunks(params.bookId);
    if (chunks.length === 0) {
      throw new Error(`Knowledge book ${params.bookId} has no chunks`);
    }

    // 2. Create the dataset
    const columns: DatasetColumn[] = params.columns.map((c) => ({
      key: c.key,
      name: c.name,
      type: c.type as DatasetColumn["type"],
      required: false,
      unit: c.unit,
    }));

    const dataset = await store!.createDataset({
      name: params.datasetName,
      description: params.description ?? `Generated from ${book.name}`,
      category: params.category,
      scope: params.scope,
      projectId: params.projectId ?? null,
      columns,
      source: "ai_generated",
      sourceDescription: `Extracted from knowledge book: ${book.name}`,
    });

    // 3. Process chunks in batches
    const batchSize = 5;
    const allRows: Array<Record<string, unknown>> = [];
    const columnSchema = params.columns
      .map((c) => `${c.key} (${c.name}, type: ${c.type}${c.unit ? `, unit: ${c.unit}` : ""}${c.description ? `, ${c.description}` : ""})`)
      .join("\n  ");

    const maxChunks = params.sampleOnly ? Math.min(chunks.length, batchSize) : chunks.length;

    for (let i = 0; i < maxChunks; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const chunkTexts = batch.map((c, idx) => `--- Chunk ${i + idx + 1} ---\n${c.text}`).join("\n\n");

      const systemPrompt = `You are a data extraction assistant for construction estimating. Extract structured data from text into a JSON array. Only extract data that is explicitly stated. Do not infer or guess values. Return ONLY a valid JSON array, no other text.`;
      const userPrompt = `Extract structured data from these text chunks into rows matching this schema:
  ${columnSchema}

Return a JSON array of objects. Each object should have keys matching: ${params.columns.map((c) => c.key).join(", ")}.
Only extract data that is explicitly stated. Do not infer or guess values.
If a chunk contains no relevant data, skip it.

Text chunks:
${chunkTexts}`;

      try {
        const response = await callLLM(systemPrompt, userPrompt);
        // Extract JSON array from the response
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>;
          // Validate and coerce each row
          for (const row of parsed) {
            const validated: Record<string, unknown> = {};
            for (const col of params.columns) {
              const raw = row[col.key];
              if (raw !== undefined && raw !== null) {
                validated[col.key] = typeof raw === "string"
                  ? coerceValue(raw, col.type as DatasetColumn["type"])
                  : raw;
              }
            }
            if (Object.keys(validated).length > 0) {
              allRows.push(validated);
            }
          }
        }
      } catch {
        // Continue with next batch on LLM/parse error
      }

      // For sample mode, stop after collecting enough rows
      if (params.sampleOnly && allRows.length >= (params.sampleRows ?? 10)) {
        break;
      }
    }

    // 4. If sample only, return without storing
    if (params.sampleOnly) {
      const sampleLimit = params.sampleRows ?? 10;
      // Clean up the empty dataset we created
      await store!.deleteDataset(dataset.id);
      return {
        datasetId: "",
        rowCount: allRows.length,
        sampleRows: allRows.slice(0, sampleLimit),
        status: "completed",
      };
    }

    // 5. Batch insert rows
    if (allRows.length > 0) {
      await store!.createDatasetRowsBatch(dataset.id, allRows);
    }

    return {
      datasetId: dataset.id,
      rowCount: allRows.length,
      status: "completed",
    };
  }

  /**
   * Suggest a dataset schema based on book content.
   *
   * Sends sample chunks to an LLM and asks it to propose column definitions.
   */
  async suggestSchema(
    bookId: string,
    purpose?: string,
    store?: PrismaApiStore,
  ): Promise<{
    suggestedName: string;
    suggestedCategory: string;
    columns: Array<{ key: string; name: string; type: string; unit?: string; description: string }>;
    rationale: string;
  }> {
    const book = await store!.getKnowledgeBook(bookId);
    if (!book) throw new Error(`Knowledge book ${bookId} not found`);

    const chunks = await store!.listKnowledgeChunks(bookId);
    const sampleChunks = chunks.slice(0, 10);
    const sampleText = sampleChunks.map((c, i) => `--- Chunk ${i + 1} ---\n${c.text}`).join("\n\n");

    const systemPrompt = `You are a construction estimating data analyst. Analyze document content and suggest a structured dataset schema for extracting tabular data. Return ONLY valid JSON, no other text.`;
    const userPrompt = `Analyze this content from "${book.name}" and suggest a dataset schema for extracting structured data.
${purpose ? `Purpose: ${purpose}` : ""}

Content:
${sampleText}

Return JSON in this exact format:
{
  "suggestedName": "string",
  "suggestedCategory": "one of: labour_units, equipment_rates, material_prices, productivity, burden_rates, custom",
  "columns": [
    { "key": "snake_case_key", "name": "Display Name", "type": "text|number|currency|percentage|boolean", "unit": "optional unit", "description": "what this column contains" }
  ],
  "rationale": "why this schema was chosen"
}`;

    const response = await callLLM(systemPrompt, userPrompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        suggestedName: book.name + " Data",
        suggestedCategory: "custom",
        columns: [
          { key: "item", name: "Item", type: "text", description: "Item description" },
          { key: "value", name: "Value", type: "number", description: "Numeric value" },
        ],
        rationale: "Default schema — LLM response could not be parsed.",
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        suggestedName: parsed.suggestedName ?? book.name + " Data",
        suggestedCategory: parsed.suggestedCategory ?? "custom",
        columns: Array.isArray(parsed.columns) ? parsed.columns : [],
        rationale: parsed.rationale ?? "",
      };
    } catch {
      return {
        suggestedName: book.name + " Data",
        suggestedCategory: "custom",
        columns: [
          { key: "item", name: "Item", type: "text", description: "Item description" },
          { key: "value", name: "Value", type: "number", description: "Numeric value" },
        ],
        rationale: "Default schema — LLM response could not be parsed.",
      };
    }
  }

  /**
   * Import CSV or JSON data into an existing dataset.
   */
  async importData(
    datasetId: string,
    format: "csv" | "json",
    data: string,
    skipHeader?: boolean,
    store?: PrismaApiStore,
  ): Promise<{ rowsImported: number; errors: string[] }> {
    const dataset = await store!.getDataset(datasetId);
    if (!dataset) throw new Error(`Dataset ${datasetId} not found`);

    const errors: string[] = [];
    const validRows: Array<Record<string, unknown>> = [];

    if (format === "json") {
      // Parse JSON array
      let parsed: unknown[];
      try {
        parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) throw new Error("Expected JSON array");
      } catch (err) {
        return { rowsImported: 0, errors: [`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`] };
      }

      for (let i = 0; i < parsed.length; i++) {
        const raw = parsed[i];
        if (typeof raw !== "object" || raw === null) {
          errors.push(`Row ${i + 1}: not an object`);
          continue;
        }
        const rowData: Record<string, unknown> = {};
        for (const col of dataset.columns) {
          const val = (raw as Record<string, unknown>)[col.key];
          if (val !== undefined && val !== null) {
            rowData[col.key] = typeof val === "string" ? coerceValue(val, col.type) : val;
          }
        }
        if (Object.keys(rowData).length > 0) {
          validRows.push(rowData);
        } else {
          errors.push(`Row ${i + 1}: no matching columns`);
        }
      }
    } else {
      // Parse CSV
      const csvRows = parseCsv(data, skipHeader ?? false);

      // If we didn't skip header, use first row as column key mapping
      let columnKeys: string[];
      if (!skipHeader && csvRows.length > 0) {
        // Use first row as headers, try to match to column keys
        const headerRow = csvRows.shift()!;
        columnKeys = headerRow.map((h) => {
          const lower = h.toLowerCase().replace(/\s+/g, "_");
          const exactMatch = dataset.columns.find((c) => c.key === lower || c.name.toLowerCase() === h.toLowerCase());
          return exactMatch?.key ?? lower;
        });
      } else {
        // Use column keys in order
        columnKeys = dataset.columns.map((c) => c.key);
      }

      for (let i = 0; i < csvRows.length; i++) {
        const cells = csvRows[i];
        const rowData: Record<string, unknown> = {};
        for (let j = 0; j < Math.min(cells.length, columnKeys.length); j++) {
          const key = columnKeys[j];
          const col = dataset.columns.find((c) => c.key === key);
          if (col && cells[j] !== "") {
            rowData[key] = coerceValue(cells[j], col.type);
          }
        }
        if (Object.keys(rowData).length > 0) {
          validRows.push(rowData);
        } else {
          errors.push(`Row ${i + 1}: no valid data`);
        }
      }
    }

    // Batch insert valid rows
    if (validRows.length > 0) {
      await store!.createDatasetRowsBatch(datasetId, validRows);
    }

    return { rowsImported: validRows.length, errors };
  }
}

export const datasetService = new DatasetService();
