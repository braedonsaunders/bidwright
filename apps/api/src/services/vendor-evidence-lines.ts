import type { ExtractedTable, ParsedDocument } from "@bidwright/ingestion";
import { normalizeResourceName } from "@bidwright/domain";

export interface VendorEvidenceLineCandidate {
  description: string;
  vendorSku: string;
  quantity: number;
  uom: string;
  unitCost: number;
  unitPrice: number | null;
  currency: string;
  lineTotal: number | null;
  pageNumber?: number;
  source: "table" | "text" | "spreadsheet";
  rawText: string;
  confidence: number;
  vendorName?: string;
  documentNumber?: string;
  documentDate?: string | null;
  documentType?: string;
  category?: string;
  resourceType?: string;
}

const MONEY = String.raw`(?:C\$|US\$|[$€£])?\s*\d[\d,]*(?:\.\d{2,3})?`;
const QTY = String.raw`\d+(?:\.\d+)?`;
const UOM = String.raw`EA|EACH|FT|LF|SF|SY|CY|HR|DAY|WK|MO|LB|KG|TON|GAL|LOT|LS|PKG|BOX|BX|PAIR|PR|SET`;
const SKU = String.raw`(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}`;
const NON_ITEM_DESCRIPTION = /subtotal|total|tax|freight|shipping|balance|amount due|surtax|tariff|warranty|prior sale|prices firm|iso 9001|also available|catalogue/i;

export function cleanMoney(value: string | null | undefined): number | null {
  if (!value) return null;
  const negative = /\([\s$€£CADUSD]*[\d,.]+\)/.test(value) || value.trim().startsWith("-");
  const cleaned = value.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

export function cleanQuantity(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeUom(value: string | null | undefined): string {
  const raw = (value ?? "").trim().toUpperCase();
  if (!raw) return "EA";
  const normalized = raw
    .replace(/\bEACH\b/g, "EA")
    .replace(/\bPCS?\b/g, "EA")
    .replace(/\bPIECES?\b/g, "EA")
    .replace(/\bHOURS?\b/g, "HR")
    .replace(/\bFEET\b/g, "FT")
    .replace(/\bFOOT\b/g, "FT")
    .replace(/\bLINEAR\s*FEET\b/g, "LF")
    .replace(/\bPOUNDS?\b/g, "LB")
    .replace(/\bPACKAGES?\b/g, "PKG");
  const token = normalized.match(/[A-Z][A-Z0-9/-]{0,8}/)?.[0];
  return token || "EA";
}

function flattenHeader(header: string) {
  return header.replace(/\s+/g, " ").trim().toLowerCase();
}

function firstColumnIndex(headers: string[], patterns: RegExp[]) {
  const flattened = headers.map(flattenHeader);
  for (const pattern of patterns) {
    const index = flattened.findIndex((header) => pattern.test(header));
    if (index >= 0) return index;
  }
  return -1;
}

function lastNonEmptyLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .at(-1) ?? "";
}

export function parseQtyUom(value: string): { quantity: number | null; uom: string } {
  const last = lastNonEmptyLine(value);
  const stuck = last.match(new RegExp(String.raw`^(${QTY})\s*(${UOM})\b`, "i"));
  if (stuck) {
    return { quantity: cleanQuantity(stuck[1]), uom: normalizeUom(stuck[2]) };
  }
  const spaced = last.match(new RegExp(String.raw`^(${QTY})\s+(${UOM})\b`, "i"));
  if (spaced) {
    return { quantity: cleanQuantity(spaced[1]), uom: normalizeUom(spaced[2]) };
  }
  return { quantity: cleanQuantity(last), uom: "" };
}

export function parseDescriptionSku(value: string): { description: string; vendorSku: string } {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const joined = lines.join(" ").trim();
  const skuMatch = joined.match(new RegExp(String.raw`\b(${SKU})\s*$`, "i"));
  if (!skuMatch) return { description: joined, vendorSku: "" };
  return {
    description: joined.slice(0, -skuMatch[1]!.length).trim(),
    vendorSku: skuMatch[1]!.toUpperCase(),
  };
}

function hasCostColumns(headers: string[]) {
  const unitIdx = firstColumnIndex(headers, [/unit\s*(price|cost|rate)/, /price\s*each/, /cost\s*each/]);
  const totalIdx = firstColumnIndex(headers, [/line\s*total/, /extended/, /\bamount\b/, /\bnet\b/]);
  return unitIdx >= 0 || totalIdx >= 0;
}

export function extractLinesFromTables(
  tables: ExtractedTable[],
  currencyForPage: (pageNumber: number) => string,
): VendorEvidenceLineCandidate[] {
  const lines: VendorEvidenceLineCandidate[] = [];
  for (const table of tables) {
    const headers = table.headers.map((header) => (header ?? "").trim());
    if (!hasCostColumns(headers)) continue;

    const descIdx = firstColumnIndex(headers, [
      /description/,
      /product\s*name/,
      /material/,
      /customer\s*code/,
      /pinacle\s*code/,
      /commodity/,
      /\bitem\b(?!\s*#)/,
      /details?/,
    ]);
    const skuIdx = firstColumnIndex(headers, [
      /pinacle\s*code/,
      /product\s*code/,
      /customer\s*code/,
      /sku/,
      /mfr\s*part/,
      /part\s*(#|no|number)/,
      /item\s*#/,
      /catalog/,
      /\bstock\b/,
      /\bcode\b/,
    ]);
    const qtyIdx = firstColumnIndex(headers, [/qty\s*ord/, /line\s*qty/, /^qty\b/, /quantity/, /\bqnty\b/]);
    const uomIdx = firstColumnIndex(headers, [/^uom$/, /unit of measure/, /\bum\b/]);
    const unitIdx = firstColumnIndex(headers, [/unit\s*(price|cost|rate)/, /price\s*each/, /cost\s*each/]);
    const totalIdx = firstColumnIndex(headers, [/line\s*total/, /extended/, /\btotal\b/, /amount/, /net/]);
    const descriptionIdx = descIdx >= 0 ? descIdx : skuIdx;
    if (descriptionIdx < 0) continue;
    const currency = currencyForPage(table.pageNumber);

    for (const row of table.rows) {
      const rawDescription = (row[descriptionIdx] ?? "").trim();
      if (!rawDescription || NON_ITEM_DESCRIPTION.test(rawDescription)) continue;
      const parsedDescription = parseDescriptionSku(rawDescription);
      const explicitSku = skuIdx >= 0 && skuIdx !== descriptionIdx ? (row[skuIdx] ?? "").trim() : "";
      const vendorSku = (explicitSku.match(new RegExp(SKU, "i"))?.[0] ?? parsedDescription.vendorSku).toUpperCase();
      const qtyUom = parseQtyUom(qtyIdx >= 0 ? row[qtyIdx] ?? "" : "");
      const quantity = qtyUom.quantity ?? 1;
      const unitCostFromColumn = cleanMoney(unitIdx >= 0 ? row[unitIdx] : "");
      const lineTotal = cleanMoney(totalIdx >= 0 ? row[totalIdx] : "");
      const unitCost = unitCostFromColumn ?? (lineTotal != null && quantity > 0 ? lineTotal / quantity : null);
      if (unitCost == null || unitCost < 0) continue;
      const uom = qtyUom.uom || (uomIdx >= 0 ? normalizeUom(row[uomIdx]) : "EA");
      lines.push({
        description: parsedDescription.description || rawDescription,
        vendorSku,
        quantity,
        uom,
        unitCost,
        unitPrice: null,
        currency,
        lineTotal,
        pageNumber: table.pageNumber,
        source: "table",
        rawText: `${headers.join(" | ")}\n${row.join(" | ")}`,
        confidence: 0.86,
      });
    }
  }
  return lines;
}

function collapseSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseJammedSkuQtyLine(line: string) {
  const match = line.match(new RegExp(String.raw`^(${SKU})(${UOM})\s*(.+)$`, "i"));
  if (!match) return null;
  const remainder = match[3]!.trim();
  const spaced = remainder.match(new RegExp(String.raw`^(${QTY})\s+(.+)$`));
  if (spaced && /^(?:\d+-\d+\/\d+|\d+\/\d+|\d+)\s/.test(spaced[2]!)) {
    return {
      vendorSku: match[1]!.toUpperCase(),
      uom: normalizeUom(match[2]),
      quantity: cleanQuantity(spaced[1]) ?? 1,
      sizeText: spaced[2]!.trim(),
    };
  }
  const jammedFraction = remainder.match(new RegExp(String.raw`^(${QTY})(\d-\d+\/\d+)\s+(.+)$`));
  if (jammedFraction) {
    return {
      vendorSku: match[1]!.toUpperCase(),
      uom: normalizeUom(match[2]),
      quantity: cleanQuantity(jammedFraction[1]) ?? 1,
      sizeText: collapseSpaces(`${jammedFraction[2]} ${jammedFraction[3]}`),
    };
  }
  const jammedNps = remainder.match(new RegExp(String.raw`^(${QTY})(\d)\s+(.+)$`));
  if (jammedNps) {
    return {
      vendorSku: match[1]!.toUpperCase(),
      uom: normalizeUom(match[2]),
      quantity: cleanQuantity(jammedNps[1]) ?? 1,
      sizeText: collapseSpaces(`${jammedNps[2]} ${jammedNps[3]}`),
    };
  }
  return null;
}

export function extractLinesFromText(text: string, currency: string, pageNumber?: number): VendorEvidenceLineCandidate[] {
  const lines: VendorEvidenceLineCandidate[] = [];
  const rawLines = text.split(/\r?\n/).map((line) => collapseSpaces(line)).filter(Boolean);
  const generic = new RegExp(
    String.raw`^(.{4,160}?)\s+(${QTY})\s+(${UOM})\s+(${MONEY})\s+(${MONEY})(?:\s|$)`,
    "i",
  );
  const stackedQty = new RegExp(
    String.raw`^(${QTY})\s*(${UOM})\s+(.+?)\s+(${SKU})\s+(${MONEY})\s+(${MONEY})\s*$`,
    "i",
  );
  const stackedLead = /^(\d{1,3})\s+(.+)$/;

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index]!;
    if (NON_ITEM_DESCRIPTION.test(line)) continue;

    const next = rawLines[index + 1] ?? "";
    const lead = line.match(stackedLead);
    const detail = next.match(stackedQty);
    if (lead && detail && !generic.test(line)) {
      const quantity = cleanQuantity(detail[1]) ?? 1;
      const unitCost = cleanMoney(detail[5]);
      const lineTotal = cleanMoney(detail[6]);
      if (unitCost != null && unitCost >= 0) {
        lines.push({
          description: collapseSpaces(`${lead[2]} ${detail[3]}`),
          vendorSku: detail[4]!.toUpperCase(),
          quantity,
          uom: normalizeUom(detail[2]),
          unitCost,
          unitPrice: null,
          currency,
          lineTotal,
          pageNumber,
          source: "text",
          rawText: `${line}\n${next}`,
          confidence: 0.78,
        });
        index += 1;
        continue;
      }
    }

    const jammed = parseJammedSkuQtyLine(line);
    const jammedMoney = next.match(new RegExp(String.raw`^(${MONEY})\s+(${MONEY})\s*$`, "i"));
    if (jammed && jammedMoney) {
      const unitCost = cleanMoney(jammedMoney[1]);
      const lineTotal = cleanMoney(jammedMoney[2]);
      const spec = rawLines[index + 2] && /304\/|316\/|a\/sa-|butt-weld|welded pipe|flange/i.test(rawLines[index + 2]!)
        ? rawLines[index + 2]
        : "";
      if (unitCost != null && unitCost >= 0) {
        lines.push({
          description: collapseSpaces([spec, jammed.sizeText].filter(Boolean).join(" ")),
          vendorSku: jammed.vendorSku,
          quantity: jammed.quantity,
          uom: jammed.uom,
          unitCost,
          unitPrice: null,
          currency,
          lineTotal,
          pageNumber,
          source: "text",
          rawText: [line, next, spec].filter(Boolean).join("\n"),
          confidence: 0.8,
        });
        index += spec ? 2 : 1;
        continue;
      }
    }

    const stuck = line.match(stackedQty);
    if (stuck) {
      const unitCost = cleanMoney(stuck[5]);
      const lineTotal = cleanMoney(stuck[6]);
      if (unitCost != null && unitCost >= 0) {
        lines.push({
          description: stuck[3]!.trim(),
          vendorSku: stuck[4]!.toUpperCase(),
          quantity: cleanQuantity(stuck[1]) ?? 1,
          uom: normalizeUom(stuck[2]),
          unitCost,
          unitPrice: null,
          currency,
          lineTotal,
          pageNumber,
          source: "text",
          rawText: line,
          confidence: 0.74,
        });
        continue;
      }
    }

    const match = line.match(generic);
    if (!match) continue;
    const quantity = cleanQuantity(match[2]) ?? 1;
    const unitCost = cleanMoney(match[4]);
    const lineTotal = cleanMoney(match[5]);
    if (unitCost == null || unitCost < 0) continue;
    const parsed = parseDescriptionSku(match[1]!);
    lines.push({
      description: parsed.description,
      vendorSku: parsed.vendorSku,
      quantity,
      uom: normalizeUom(match[3]),
      unitCost,
      unitPrice: null,
      currency,
      lineTotal,
      pageNumber,
      source: "text",
      rawText: line,
      confidence: 0.62,
    });
  }
  return lines;
}

export function extractVendorEvidenceLines(
  doc: Pick<ParsedDocument, "tables" | "pages" | "content">,
  currencyForPage: (pageNumber: number | null) => string,
): VendorEvidenceLineCandidate[] {
  const tableLines = extractLinesFromTables(doc.tables, (pageNumber) => currencyForPage(pageNumber));
  const textLines = doc.pages.length > 0
    ? doc.pages.flatMap((page) => extractLinesFromText(page.content, currencyForPage(page.pageNumber), page.pageNumber))
    : extractLinesFromText(doc.content, currencyForPage(null));
  return preferSkuBackedLines(dedupeLineCandidates([...tableLines, ...textLines]));
}

export function preferSkuBackedLines(lines: VendorEvidenceLineCandidate[]) {
  const withSku = lines.filter((line) => line.vendorSku.length >= 5);
  if (withSku.length === 0) return lines;
  const covered = new Set(
    withSku.map((line) => `${line.quantity}|${line.uom}|${line.unitCost.toFixed(4)}|${line.lineTotal?.toFixed(2) ?? ""}`),
  );
  return lines.filter((line) => (
    line.vendorSku.length >= 5
    || !covered.has(`${line.quantity}|${line.uom}|${line.unitCost.toFixed(4)}|${line.lineTotal?.toFixed(2) ?? ""}`)
  ));
}

export function dedupeLineCandidates(lines: VendorEvidenceLineCandidate[]) {
  const seen = new Set<string>();
  const deduped: VendorEvidenceLineCandidate[] = [];
  for (const line of lines) {
    const key = [
      normalizeResourceName(line.description),
      line.vendorSku.toLowerCase(),
      line.quantity,
      line.uom,
      line.unitCost.toFixed(4),
      line.lineTotal?.toFixed(2) ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(line);
  }
  return deduped;
}

const FITTING_TYPES = [
  "weldneck",
  "flange",
  "elbow",
  "reducer",
  "tee",
  "pipe",
  "coupling",
  "cap",
  "union",
  "nipple",
] as const;

export function evidenceIdentity(value: string) {
  const text = value.toLowerCase().replace(/["”]/g, " ");
  const sizes = Array.from(text.matchAll(/\b(\d+(?:-\d+\/\d+|\/\d+)?)\s*(?:in\b|inch|10s|40s|80s|std|rf|wn)?/g))
    .map((match) => match[1]!)
    .filter((size, index, all) => all.indexOf(size) === index && !["10", "40", "45", "90", "125", "150", "250", "304", "316"].includes(size));
  const nps = text.match(/\b(\d+(?:-\d+\/\d+|\/\d+)?)\s+(?:10s|40s|80s|rf|wn|sch)\b/)?.[1]
    ?? text.match(/\b(\d+(?:-\d+\/\d+)?)\s*"/)?.[1]
    ?? null;
  const schedule = text.match(/\b(5s|10s|40s|80s|sch\s*10|sch\s*40|sch\s*80|std|xh|xxh)\b/)?.[1]?.replace(/\s+/g, "") ?? null;
  const angle = text.match(/\b(45|90)\s*(?:deg|degree)?\b/)?.[1] ?? null;
  const material = text.match(/\b(304l|316l|304|316|a105|a182|a312|a403)\b/)?.[0] ?? null;
  const fitting = FITTING_TYPES.find((type) => text.includes(type)) ?? (text.includes("conc red") ? "reducer" : null);
  return { sizes, nps, schedule, angle, material, fitting };
}

export function compactSku(value: string | null | undefined) {
  return (value ?? "").replace(/[\s._/-]+/g, "").toUpperCase();
}

export function isCredibleResourceMatch(
  resource: { name?: string | null; code?: string | null; aliases?: string[] | null; manufacturerPartNumber?: string | null },
  line: { description: string; vendorSku: string },
): boolean {
  const sku = compactSku(line.vendorSku);
  const resourceCodes = [resource.code, resource.manufacturerPartNumber, ...(resource.aliases ?? [])]
    .map(compactSku)
    .filter((value) => value.length >= 5);
  if (sku.length >= 5 && resourceCodes.includes(sku)) return true;
  if (sku.length >= 5 && resourceCodes.length > 0) return false;

  const lineId = evidenceIdentity(`${line.description} ${line.vendorSku}`);
  const resourceId = evidenceIdentity(`${resource.name ?? ""} ${resource.code ?? ""}`);
  if (lineId.fitting && resourceId.fitting && lineId.fitting !== resourceId.fitting) return false;
  if (lineId.nps && resourceId.nps && lineId.nps !== resourceId.nps) return false;
  if (lineId.schedule && resourceId.schedule && lineId.schedule.replace(/\s+/g, "") !== resourceId.schedule.replace(/\s+/g, "")) return false;
  if (lineId.angle && resourceId.angle && lineId.angle !== resourceId.angle) return false;
  if (lineId.material && resourceId.material && lineId.material !== resourceId.material) return false;

  const exactName = normalizeResourceName(resource.name) === normalizeResourceName(line.description);
  if (!exactName) return false;
  return Boolean(lineId.nps && lineId.fitting);
}
