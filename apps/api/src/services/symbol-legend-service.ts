// Symbol legend reader — extract legend / schedule entries from a drawing
// page using Azure Document Intelligence's prebuilt-layout model.
//
// Construction drawings list every symbol they use (receptacles, lights,
// fixtures, fire devices, etc.) in a "LEGEND", "SYMBOLS", or "SCHEDULE"
// block — usually in a 2-column table or as labelled rows. This service
// finds those entries so the rest of the app can:
//   - show the user a key for what's on the drawing
//   - feed each entry's bounding box to the auto-count vision pipeline
//     so "count panel-A receptacles" replaces "click an example then
//     auto-count"
//
// V1: detection + return. Persistence + auto-count integration is the
// next layer.

import { readFile } from "node:fs/promises";
import { prisma } from "@bidwright/db";
import { createPdfParser } from "@bidwright/ingestion";
import { resolveApiPath } from "../paths.js";

export interface LegendEntry {
  /** The short symbol token from the drawing — e.g. "$", "A1", "GFI". */
  symbol: string;
  /** Human-readable description — e.g. "Standard duplex receptacle". */
  label: string;
  /** Page (1-indexed) the entry was found on. */
  pageNumber: number;
  /** Confidence the row is a real legend entry (0..1). */
  confidence: number;
}

export interface ExtractLegendResult {
  entries: LegendEntry[];
  warnings: string[];
}

const LEGEND_KEYWORDS = /\b(legend|symbols?|schedule|key)\b/i;

// Heuristic: "<short token> <description>" rows in a legend usually have a
// short left cell (1-8 characters) and a longer right cell.
function isShortToken(s: string): boolean {
  const t = s.trim();
  if (t.length === 0 || t.length > 12) return false;
  // Symbol-y characters are common: digits, letters, $, #, /, -, ., parens.
  return /^[A-Z0-9$#/\-._()&%@*\\]+$/i.test(t);
}

export async function extractLegendFromPage(
  projectId: string,
  documentId: string,
  pageNumber: number,
  azureConfig?: { endpoint?: string; key?: string },
): Promise<ExtractLegendResult> {
  const warnings: string[] = [];
  let storagePath: string | null = null;
  let fileName = "drawing.pdf";

  const doc = await prisma.sourceDocument.findFirst({
    where: { id: documentId, projectId },
    select: { storagePath: true, fileName: true },
  });
  if (doc?.storagePath) {
    storagePath = doc.storagePath;
    fileName = doc.fileName;
  } else {
    const book = await prisma.knowledgeBook.findUnique({
      where: { id: documentId },
      select: { storagePath: true, sourceFileName: true },
    });
    if (book?.storagePath) {
      storagePath = book.storagePath;
      fileName = book.sourceFileName || fileName;
    }
  }

  if (!storagePath) {
    return { entries: [], warnings: ["Source file not available for OCR"] };
  }

  const buffer = await readFile(resolveApiPath(storagePath));
  // Resolve Azure DI creds: caller-supplied (org settings) wins, then env.
  const azureEndpoint = azureConfig?.endpoint || process.env.AZURE_DI_ENDPOINT;
  const azureKey = azureConfig?.key || process.env.AZURE_DI_KEY;
  if (!azureEndpoint || !azureKey) {
    warnings.push("Azure Document Intelligence isn't configured — legend extraction needs OCR.");
    return { entries: [], warnings };
  }

  const parser = createPdfParser({
    provider: "azure",
    azureEndpoint,
    azureKey,
    azureModel: "prebuilt-layout",
    options: { tableExtractionEnabled: true },
  });

  let parsed: Awaited<ReturnType<typeof parser.parse>>;
  try {
    parsed = await parser.parse(buffer, fileName);
  } catch (err) {
    warnings.push(`OCR failed: ${(err as Error).message}`);
    return { entries: [], warnings };
  }

  const entries: LegendEntry[] = [];

  // Path 1: Azure-extracted tables. We look for tables whose rows have a
  // short-token left cell and a longer description on the right, and whose
  // header (if present) mentions LEGEND / SYMBOL / DESCRIPTION.
  for (const table of parsed.tables ?? []) {
    if (table.pageNumber !== pageNumber) continue;
    const headers = (table.headers ?? []).map((h) => String(h).toLowerCase());
    const headerHasLegendKeyword =
      headers.some((h) => /symbol|legend|key/.test(h)) ||
      headers.some((h) => /description|item|name|note/.test(h));
    const symbolCol = headers.findIndex((h) => /symbol|key|mark|sym\.?/.test(h));
    const descCol = headers.findIndex((h) => /description|item|name|note|legend/.test(h));

    for (const row of table.rows ?? []) {
      if (row.length < 2) continue;
      const left = String(row[0] ?? "").trim();
      // Use the description column whenever OCR found one — even when the
      // symbol header is missing. Falling back to row[length-1] in that case
      // misreads 3+ column schedules where the last column is qty/notes.
      const rightIdx = descCol >= 0 ? descCol : row.length - 1;
      const right = String(row[rightIdx] ?? "").trim();
      const sym = symbolCol >= 0 ? String(row[symbolCol] ?? "").trim() : left;
      if (!sym || !right) continue;
      if (!isShortToken(sym)) continue;
      if (right.length < 3) continue;
      entries.push({
        symbol: sym,
        label: right,
        pageNumber,
        confidence: headerHasLegendKeyword ? 0.95 : 0.7,
      });
    }
  }

  // Path 2: text-based fallback. If no tables yielded entries, scan the
  // page text for lines near a LEGEND/SYMBOLS keyword that look like
  // "<short token> <description>".
  if (entries.length === 0) {
    const targetPage = parsed.pages?.[pageNumber - 1];
    const text = targetPage?.content ?? "";
    if (text) {
      const lines = text.split(/\r?\n/);
      let nearKeyword = false;
      let linesSinceKeyword = 0;
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (LEGEND_KEYWORDS.test(line)) {
          nearKeyword = true;
          linesSinceKeyword = 0;
          continue;
        }
        if (!nearKeyword) continue;
        linesSinceKeyword++;
        if (linesSinceKeyword > 60) {
          nearKeyword = false;
          continue;
        }
        const m = /^([A-Z0-9$#/\-._()&%@*\\]{1,8})\s+(.{3,})$/i.exec(line);
        if (!m) continue;
        const sym = m[1]!.trim();
        const desc = m[2]!.trim();
        if (!isShortToken(sym)) continue;
        entries.push({
          symbol: sym,
          label: desc,
          pageNumber,
          confidence: 0.5,
        });
      }
    }
  }

  // Dedupe by (symbol, label) — Azure sometimes returns the same row twice.
  const seen = new Set<string>();
  const deduped = entries.filter((e) => {
    const key = `${e.symbol}::${e.label.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (deduped.length === 0) {
    warnings.push("No legend table or symbol list found on this page.");
  }
  // Sort by symbol so the panel is alphabetical.
  deduped.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { entries: deduped, warnings };
}
