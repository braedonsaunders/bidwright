// AI-assisted bulk import of catalog items from a CSV / XLSX / PDF.
//
// The pipeline is:
//   1) Parse the uploaded file into a flat { headers, rows } table.
//   2) Ask the LLM to map each header onto a CatalogItem field
//      (name, code, unit, unitCost, unitPrice, category) and to detect what
//      kind of sheet this is (catalog | labour_rate | price_list | unknown).
//   3) Hand the suggested mapping back to the UI so the user can confirm
//      or override before any rows hit the database.
//   4) On commit, materialise rows through the existing CatalogItem create
//      path so the items show up in the org's catalog instantly.
//
// Azure Document Intelligence is used opportunistically for PDFs that contain
// scanned tables — falls back gracefully to local parsing when no Azure key
// is configured.

import * as XLSX from "xlsx";
import { createPdfParser } from "@bidwright/ingestion";
import { createLLMAdapter } from "@bidwright/agent";

export interface SpreadsheetTable {
  sheetName: string;
  headers: string[];
  rows: string[][];
}

export type CatalogItemField = "name" | "code" | "unit" | "unitCost" | "unitPrice" | "category" | "ignore";

export interface ColumnMapping {
  // Header text -> target field
  byHeader: Record<string, CatalogItemField>;
}

export interface ImportAnalysis {
  tables: SpreadsheetTable[];
  selectedTableIndex: number;
  detectedKind: "catalog" | "labour_rate" | "price_list" | "unknown";
  confidence: number;
  mapping: ColumnMapping;
  notes: string;
  warnings: string[];
}

export interface AnalyzeOptions {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  azureConfig?: { endpoint?: string; key?: string };
  aiConfig?: { provider: string; apiKey: string; model: string };
}

// ── Parsing ───────────────────────────────────────────────────────────────

function parseCsv(buffer: Buffer): SpreadsheetTable[] {
  const text = buffer.toString("utf-8");
  const wb = XLSX.read(text, { type: "string" });
  return parseWorkbook(wb);
}

function parseXlsx(buffer: Buffer): SpreadsheetTable[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  return parseWorkbook(wb);
}

function parseWorkbook(wb: XLSX.WorkBook): SpreadsheetTable[] {
  const out: SpreadsheetTable[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
    if (data.length === 0) continue;
    const headerRowIndex = findHeaderRow(data);
    const headers = (data[headerRowIndex] ?? []).map((c) => String(c ?? "").trim());
    const rows = data
      .slice(headerRowIndex + 1)
      .map((r) => r.map((c) => String(c ?? "").trim()))
      .filter((r) => r.some((c) => c.length > 0));
    if (headers.length === 0 || rows.length === 0) continue;
    out.push({ sheetName, headers, rows });
  }
  return out;
}

// Many real-world rate sheets have a title row above the headers. Pick the
// first row whose cells are mostly non-empty short labels.
function findHeaderRow(data: string[][]): number {
  for (let i = 0; i < Math.min(data.length, 8); i++) {
    const row = data[i] ?? [];
    const filled = row.filter((c) => String(c ?? "").trim().length > 0).length;
    if (filled >= 2 && row.length >= 2) return i;
  }
  return 0;
}

async function parsePdfTables(buffer: Buffer, filename: string, azureConfig?: { endpoint?: string; key?: string }): Promise<SpreadsheetTable[]> {
  const hasAzure =
    !!(azureConfig?.endpoint && azureConfig?.key) || !!(process.env.AZURE_DI_ENDPOINT && process.env.AZURE_DI_KEY);
  const parser = createPdfParser({
    provider: hasAzure ? "azure" : "local",
    azureEndpoint: azureConfig?.endpoint || process.env.AZURE_DI_ENDPOINT,
    azureKey: azureConfig?.key || process.env.AZURE_DI_KEY,
    azureModel: "prebuilt-layout",
    options: { tableExtractionEnabled: true },
  });
  const doc = await parser.parse(buffer, filename);

  const tables: SpreadsheetTable[] = [];
  for (const t of doc.tables ?? []) {
    if (!t.headers || !t.rows) continue;
    tables.push({
      sheetName: t.title || `Page ${t.pageNumber ?? ""}`.trim(),
      headers: t.headers.map((h) => String(h ?? "").trim()),
      rows: t.rows.map((r) => r.map((c) => String(c ?? "").trim())),
    });
  }
  return tables;
}

export async function parseImportFile(opts: { buffer: Buffer; filename: string; mimeType?: string; azureConfig?: { endpoint?: string; key?: string } }): Promise<SpreadsheetTable[]> {
  const lower = opts.filename.toLowerCase();
  if (lower.endsWith(".csv")) return parseCsv(opts.buffer);
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm")) return parseXlsx(opts.buffer);
  if (lower.endsWith(".pdf") || opts.mimeType === "application/pdf") return parsePdfTables(opts.buffer, opts.filename, opts.azureConfig);
  // Fall back to text → assume CSV-ish.
  return parseCsv(opts.buffer);
}

// ── AI mapping ────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<CatalogItemField, string> = {
  name: "Item name / description",
  code: "SKU / part number / code",
  unit: "Unit of measure (EA, FT, BX, …)",
  unitCost: "Unit cost (what you pay)",
  unitPrice: "Unit price (what you charge)",
  category: "Category / group / trade",
  ignore: "Ignore this column",
};

function fallbackMapping(headers: string[]): ColumnMapping {
  const byHeader: Record<string, CatalogItemField> = {};
  for (const h of headers) {
    const k = h.toLowerCase();
    if (/(^|[^a-z])name([^a-z]|$)|description|item|product/.test(k)) byHeader[h] = "name";
    else if (/code|sku|part|catalog\s*#|number/.test(k)) byHeader[h] = "code";
    else if (/^uom$|unit of measure|unit\b|^um$/.test(k)) byHeader[h] = "unit";
    else if (/cost\s*(\$|each|per|\/)|unit\s*cost|our\s*cost/.test(k)) byHeader[h] = "unitCost";
    else if (/price|sell|retail|list/.test(k)) byHeader[h] = "unitPrice";
    else if (/category|group|trade|class/.test(k)) byHeader[h] = "category";
    else byHeader[h] = "ignore";
  }
  return { byHeader };
}

async function aiSuggestMapping(
  table: SpreadsheetTable,
  config: { provider: string; apiKey: string; model: string },
): Promise<{ detectedKind: ImportAnalysis["detectedKind"]; confidence: number; mapping: ColumnMapping; notes: string }> {
  const adapter = createLLMAdapter({ provider: config.provider as any, apiKey: config.apiKey, model: config.model });
  const sample = table.rows.slice(0, 6);

  const response = await adapter.chat({
    model: config.model,
    systemPrompt:
      "You map columns of a construction-industry rate sheet, supplier price list, or catalog into a normalized schema. Only return JSON.",
    messages: [
      {
        role: "user",
        content:
          `Sheet: "${table.sheetName}"\n` +
          `Headers: ${JSON.stringify(table.headers)}\n` +
          `Sample rows: ${JSON.stringify(sample)}\n\n` +
          `Classify the sheet kind as one of: "catalog" (product catalog), "labour_rate" (hourly trade labour rates), "price_list" (supplier list), "unknown".\n` +
          `For each header, choose the best target field from: ${Object.keys(FIELD_LABELS).join(", ")}.\n` +
          `Field meanings: ${JSON.stringify(FIELD_LABELS)}\n\n` +
          `Return ONLY a JSON object of shape:\n` +
          `{ "detectedKind": "catalog"|"labour_rate"|"price_list"|"unknown",\n` +
          `  "confidence": 0..1,\n` +
          `  "mapping": { "<headerExactString>": "name"|"code"|"unit"|"unitCost"|"unitPrice"|"category"|"ignore" },\n` +
          `  "notes": "1-2 sentences describing what you saw" }`,
      },
    ],
    maxTokens: 1500,
    temperature: 0.2,
  });

  const block = response.content[0];
  const text = typeof block === "string" ? block : (block as { text?: string }).text ?? "";
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();
  const parsed = JSON.parse(jsonText);

  const byHeader: Record<string, CatalogItemField> = {};
  for (const h of table.headers) {
    const m = parsed.mapping?.[h];
    byHeader[h] = (m as CatalogItemField) ?? "ignore";
  }

  return {
    detectedKind: (parsed.detectedKind as ImportAnalysis["detectedKind"]) ?? "unknown",
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    mapping: { byHeader },
    notes: typeof parsed.notes === "string" ? parsed.notes : "",
  };
}

export async function analyzeImport(opts: AnalyzeOptions): Promise<ImportAnalysis> {
  const tables = await parseImportFile(opts);
  if (tables.length === 0) {
    return {
      tables: [],
      selectedTableIndex: 0,
      detectedKind: "unknown",
      confidence: 0,
      mapping: { byHeader: {} },
      notes: "No tables found in the file.",
      warnings: ["File contained no readable tabular data."],
    };
  }

  // Pick the largest table by row count as the default selection.
  let bestIdx = 0;
  for (let i = 1; i < tables.length; i++) {
    if ((tables[i]!.rows.length ?? 0) > (tables[bestIdx]!.rows.length ?? 0)) bestIdx = i;
  }
  const target = tables[bestIdx]!;

  const warnings: string[] = [];
  let detectedKind: ImportAnalysis["detectedKind"] = "unknown";
  let confidence = 0.4;
  let mapping = fallbackMapping(target.headers);
  let notes = "Heuristic mapping (no AI available).";

  if (opts.aiConfig?.apiKey) {
    try {
      const ai = await aiSuggestMapping(target, opts.aiConfig);
      detectedKind = ai.detectedKind;
      confidence = ai.confidence;
      mapping = ai.mapping;
      notes = ai.notes;
    } catch (err) {
      warnings.push(`AI mapping failed: ${(err as Error).message}; falling back to heuristic.`);
    }
  } else {
    warnings.push("No AI key configured; using heuristic column mapping.");
  }

  return { tables, selectedTableIndex: bestIdx, detectedKind, confidence, mapping, notes, warnings };
}

// ── Materialisation ───────────────────────────────────────────────────────

export interface RowMaterialisationResult {
  candidates: Array<{
    name: string;
    code: string;
    unit: string;
    unitCost: number;
    unitPrice: number;
    category: string;
  }>;
  skipped: number;
}

export function materialiseRows(table: SpreadsheetTable, mapping: ColumnMapping): RowMaterialisationResult {
  const headerToIndex = new Map<string, number>();
  table.headers.forEach((h, i) => headerToIndex.set(h, i));
  const colFor = (field: CatalogItemField): number | null => {
    for (const [h, target] of Object.entries(mapping.byHeader)) {
      if (target === field) {
        const idx = headerToIndex.get(h);
        if (idx !== undefined) return idx;
      }
    }
    return null;
  };

  const nameCol = colFor("name");
  const codeCol = colFor("code");
  const unitCol = colFor("unit");
  const costCol = colFor("unitCost");
  const priceCol = colFor("unitPrice");
  const catCol = colFor("category");

  const parseNumber = (v: string): number => {
    if (!v) return 0;
    const cleaned = v.replace(/[$,\s]/g, "");
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  };

  const candidates: RowMaterialisationResult["candidates"] = [];
  let skipped = 0;
  for (const row of table.rows) {
    const name = nameCol !== null ? row[nameCol] ?? "" : "";
    if (!name.trim()) {
      skipped++;
      continue;
    }
    candidates.push({
      name: name.trim(),
      code: codeCol !== null ? (row[codeCol] ?? "").trim() : "",
      unit: unitCol !== null ? (row[unitCol] ?? "EA").trim() || "EA" : "EA",
      unitCost: costCol !== null ? parseNumber(row[costCol] ?? "") : 0,
      unitPrice: priceCol !== null ? parseNumber(row[priceCol] ?? "") : 0,
      category: catCol !== null ? (row[catCol] ?? "").trim() : "",
    });
  }
  return { candidates, skipped };
}
