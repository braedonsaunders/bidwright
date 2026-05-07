import { XMLParser } from "fast-xml-parser";
import type { CanonicalMarkupIngestManifest } from "@bidwright/domain";

type MarkupRow = Record<string, string>;

const QUANTITY_KEYS = [
  "quantity",
  "qty",
  "count",
  "length",
  "area",
  "volume",
  "perimeter",
  "measurement",
];

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/[#()]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getBySynonyms(row: MarkupRow, synonyms: string[]) {
  const wanted = new Set(synonyms.map(normalizeHeader));
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(normalizeHeader(key)) && value.trim()) return value.trim();
  }
  return null;
}

function parseQuantity(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!normalized) return null;
  const parsed = Number(normalized[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferQuantity(row: MarkupRow) {
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeHeader(key);
    if (!QUANTITY_KEYS.some((candidate) => normalized === candidate || normalized.endsWith(` ${candidate}`))) {
      continue;
    }
    const quantity = parseQuantity(value);
    if (quantity !== null) {
      return {
        quantity,
        measurementType: normalized === "qty" ? "quantity" : normalized,
      };
    }
  }
  return null;
}

function rowsLookLikeBluebeam(rows: MarkupRow[]) {
  if (rows.length === 0) return false;
  const headers = new Set(Object.keys(rows[0]).map(normalizeHeader));
  const hasIdentity = headers.has("subject") || headers.has("label") || headers.has("markup") || headers.has("tool set");
  const hasLocation = headers.has("page") || headers.has("page label") || headers.has("space") || headers.has("layer");
  const hasQuantity = [...headers].some((header) => QUANTITY_KEYS.some((key) => header === key || header.endsWith(` ${key}`)));
  const hasBluebeamSpecific = headers.has("status") || headers.has("author") || headers.has("color") || headers.has("comments");
  return hasIdentity && (hasLocation || hasBluebeamSpecific) && hasQuantity;
}

function makeManifest(rows: MarkupRow[]): CanonicalMarkupIngestManifest | null {
  if (!rowsLookLikeBluebeam(rows)) return null;

  const quantities = rows.flatMap((row, index) => {
    const inferred = inferQuantity(row);
    if (!inferred) return [];
    const unit = getBySynonyms(row, ["units", "unit", `${inferred.measurementType} units`]);
    return [{
      id: `bbm-${index + 1}`,
      pageLabel: getBySynonyms(row, ["page label", "page", "page index"]),
      subject: getBySynonyms(row, ["subject"]),
      label: getBySynonyms(row, ["label", "description"]),
      layer: getBySynonyms(row, ["layer"]),
      space: getBySynonyms(row, ["space"]),
      measurementType: getBySynonyms(row, ["measurement type", "measurement"]) ?? inferred.measurementType,
      quantity: inferred.quantity,
      unit,
      comment: getBySynonyms(row, ["comment", "comments", "notes"]),
      raw: row,
    }];
  });

  if (quantities.length === 0) return null;
  const unique = (values: Array<string | null | undefined>) =>
    Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))).sort();

  return {
    source: "bluebeam-markups",
    rowCount: rows.length,
    quantityCount: quantities.length,
    units: unique(quantities.map((item) => item.unit)),
    subjects: unique(quantities.map((item) => item.subject)),
    pages: unique(quantities.map((item) => item.pageLabel)),
    quantities,
  };
}

function rowsFromWorksheet(data: string[][]): MarkupRow[] {
  const headerIndex = data.findIndex((row) => row.some((cell) => String(cell).trim()));
  if (headerIndex < 0) return [];
  const headers = data[headerIndex].map((cell, index) => String(cell || `Column ${index + 1}`).trim());
  return data.slice(headerIndex + 1)
    .filter((row) => row.some((cell) => String(cell).trim()))
    .map((row) => {
      const record: MarkupRow = {};
      headers.forEach((header, index) => {
        record[header] = String(row[index] ?? "").trim();
      });
      return record;
    });
}

async function rowsFromSpreadsheet(buffer: Buffer): Promise<MarkupRow[]> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false }) as string[][];
  return rowsFromWorksheet(data);
}

function flattenXmlObject(value: unknown, rows: MarkupRow[] = []) {
  if (!value || typeof value !== "object") return rows;
  if (Array.isArray(value)) {
    for (const item of value) flattenXmlObject(item, rows);
    return rows;
  }

  const record: MarkupRow = {};
  let scalarCount = 0;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child === null || child === undefined) continue;
    if (typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
      record[key] = String(child);
      scalarCount += 1;
    } else {
      flattenXmlObject(child, rows);
    }
  }
  if (scalarCount >= 3) rows.push(record);
  return rows;
}

function rowsFromXml(buffer: Buffer): MarkupRow[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    textNodeName: "value",
    trimValues: true,
  });
  return flattenXmlObject(parser.parse(buffer.toString("utf8")));
}

export async function parseBluebeamMarkups(buffer: Buffer, format: string): Promise<CanonicalMarkupIngestManifest | null> {
  if (format === "csv" || format === "tsv" || format === "xlsx" || format === "xls" || format === "xlsm" || format === "ods") {
    return makeManifest(await rowsFromSpreadsheet(buffer));
  }
  if (format === "xml") {
    return makeManifest(rowsFromXml(buffer));
  }
  return null;
}
