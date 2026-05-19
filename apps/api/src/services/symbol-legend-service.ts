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
//     auto-count" — see symbol-template-service.ts
//
// When the legend was OCR'd from a table (the common case), each entry
// includes the page-inch bounding box of the symbol cell. The Symbol
// Library uses that bbox to crop the glyph image and persist it as a
// reusable template.

import { readFile } from "node:fs/promises";
import { prisma } from "@bidwright/db";
import { createPdfParser } from "@bidwright/ingestion";
import { resolveApiPath } from "../paths.js";

/** Axis-aligned bbox of a legend cell on its page, in PDF inches. */
export interface LegendCellBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LegendEntry {
  /** The short symbol token from the drawing — e.g. "$", "A1", "GFI". */
  symbol: string;
  /** Human-readable description — e.g. "Standard duplex receptacle". */
  label: string;
  /** Page (1-indexed) the entry was found on. */
  pageNumber: number;
  /** Confidence the row is a real legend entry (0..1). */
  confidence: number;
  /**
   * Bbox of the symbol cell in PDF inches (Azure DI v4 unit). Absent when
   * the entry came from the text-pattern fallback path, which has no
   * cell geometry — those entries cannot be promoted to SymbolTemplates
   * until the user supplies a bbox manually.
   */
  symbolBbox?: LegendCellBbox;
  /** Bbox of the description cell, same coordinate system. */
  labelBbox?: LegendCellBbox;
}

export interface ExtractLegendResult {
  entries: LegendEntry[];
  warnings: string[];
}

const LEGEND_KEYWORDS = /\b(legend|symbols?|schedule|key)\b/i;

// Tokens that almost always live in title blocks / parts lists / revision
// blocks — never in a real symbol legend. Used to reject rows where the
// description cell starts with one of these words (German variants
// included because the user hit "Tel bzw Variante" trash from a German
// title block). Match against lowercased, trimmed left-edge of the cell;
// false positives on a real legend that legitimately starts with these
// would be very unusual.
const TITLE_BLOCK_TOKEN_BLOCKLIST = new Set([
  // English
  "tel", "fax", "phone", "email", "rev", "revision", "drawn", "drawn by",
  "chk", "checked", "checked by", "date", "sheet", "sheets", "scale",
  "page", "pages", "part", "parts", "qty", "quantity", "no", "no.",
  "project", "drawing", "client", "title", "approved", "issued",
  "section", "detail", "view", "elevation", "address", "phone:", "fax:",
  // German (user's drawing was German-language)
  "tel.", "telefon", "datum", "blatt", "massstab", "geprüft", "gepruft",
  "gezeichnet", "ausgabe", "anschrift", "auftrag", "projekt", "kunde",
  "teil", "stück", "stuck", "menge", "bzw", "bzw.", "variante",
]);

// Heuristic: "<short token> <description>" rows in a legend usually have a
// short left cell (1-8 characters) and a longer right cell.
function isShortToken(s: string): boolean {
  const t = s.trim();
  if (t.length === 0 || t.length > 12) return false;
  // Symbol-y characters are common: digits, letters, $, #, /, -, ., parens.
  return /^[A-Z0-9$#/\-._()&%@*\\]+$/i.test(t);
}

/** Reject a candidate row when its left cell or description text matches a
 *  title-block / parts-list / revision-table fingerprint. Without this we
 *  accept rows like "Tel bzw Variante" from a German title block as if it
 *  were a legend entry (the user's TEST E report). */
function looksLikeTitleBlockRow(symbol: string, label: string): boolean {
  const sym = symbol.toLowerCase().trim();
  const lab = label.toLowerCase().trim();
  if (TITLE_BLOCK_TOKEN_BLOCKLIST.has(sym)) return true;
  // First word of the description matches a blocklist token (e.g. "Tel bzw
  // Variante" → first word "tel"). Catches rows where the title-block
  // field name leaked into the description column.
  const firstWord = lab.split(/\s+/)[0] ?? "";
  if (TITLE_BLOCK_TOKEN_BLOCKLIST.has(firstWord)) return true;
  // A row whose description is just digits / dates / page-number markers.
  if (/^(p\.?\s*\d+|\d{1,3}\s*\/\s*\d{1,3}|\d{4}-\d{2}-\d{2})$/i.test(lab)) return true;
  return false;
}

/** Sanity-check the symbol-cell bbox: a real legend symbol cell is bounded
 *  in absolute size and isn't a long narrow strip. The caps are deliberately
 *  loose — a custom block legend can have 2"+ cells, an aspect ratio up to
 *  8:1 is plausible for elongated callouts. We only reject the obvious
 *  full-page-column / single-line-strip pathologies that title-block tables
 *  produce. Returns true when the bbox passes (or is missing — bbox absence
 *  is the text-fallback path and is filtered elsewhere). */
function symbolBboxLooksLikeGlyphCell(bbox: LegendCellBbox | undefined): boolean {
  if (!bbox) return true;
  if (bbox.width <= 0 || bbox.height <= 0) return false;
  // Hard caps in PDF inches. Construction legend glyphs are typically
  // 0.15"-0.6" tall; we cap at 3.5" so the legend can carry oversized
  // assembly icons or descriptive sub-cells without being rejected.
  if (bbox.width > 3.5 || bbox.height > 3.5) return false;
  // Aspect ratio: real glyph cells are roughly square but legends with
  // descriptive sub-cells stretch a bit. 8:1 catches the title-block
  // single-line strip pathology without false-rejecting real legends.
  const aspect = Math.max(bbox.width / bbox.height, bbox.height / bbox.width);
  if (aspect > 8) return false;
  return true;
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
  // Azure DI creds come from org Settings > Integrations.
  const azureEndpoint = azureConfig?.endpoint;
  const azureKey = azureConfig?.key;
  if (!azureEndpoint || !azureKey) {
    warnings.push("Azure Document Intelligence isn't configured — legend extraction needs OCR. Set credentials in Settings > Integrations.");
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
  //
  // Two-stage pass so a parts-list / title-block / revision-block table
  // doesn't get its rows promoted to "legend entries". The first pass
  // builds candidate rows; the second commits them only when the table
  // looks like a real legend (header keyword present, AND enough rows
  // surviving the title-block / glyph-cell filters). Without this we hit
  // the user's TEST E trash: "Page legend2", "Tel bzw Variante", "part" —
  // all of which leaked through from title-block tables on the same page.
  for (const table of parsed.tables ?? []) {
    if (table.pageNumber !== pageNumber) continue;
    const headers = (table.headers ?? []).map((h) => String(h).toLowerCase());
    const headerHasLegendKeyword =
      headers.some((h) => /symbol|legend|key/.test(h)) ||
      headers.some((h) => /description|item|name|note/.test(h));
    // Look at the FULL table text for legend-y keywords. The header row
    // isn't always present and isn't always Azure's `headers` field —
    // sometimes the keyword sits in row 0's first cell. Treat a positive
    // match as the strong "this is a legend" signal that lets a 1-2 row
    // table through.
    const tableTextHasLegendKeyword = (table.rows ?? [])
      .flat()
      .some((cell) => LEGEND_KEYWORDS.test(String(cell ?? "")));
    const isLegendTable = headerHasLegendKeyword || tableTextHasLegendKeyword;
    const symbolCol = headers.findIndex((h) => /symbol|key|mark|sym\.?/.test(h));
    const descCol = headers.findIndex((h) => /description|item|name|note|legend/.test(h));

    // Build a per-row map of (columnIndex -> cell) so we can look up the
    // bbox of the specific symbol/description cell after picking the right
    // columns. Azure cells include both header and data rows.
    const cellsByRow = new Map<number, Map<number, NonNullable<typeof table.cells>[number]>>();
    for (const cell of table.cells ?? []) {
      let rowMap = cellsByRow.get(cell.rowIndex);
      if (!rowMap) {
        rowMap = new Map();
        cellsByRow.set(cell.rowIndex, rowMap);
      }
      rowMap.set(cell.columnIndex, cell);
    }

    const tableCandidates: LegendEntry[] = [];
    for (let dataRowIndex = 0; dataRowIndex < (table.rows ?? []).length; dataRowIndex++) {
      const row = table.rows![dataRowIndex]!;
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
      if (looksLikeTitleBlockRow(sym, right)) continue;

      // Map data row index back to Azure row index. Azure's row 0 is the
      // header (when headers exist); first data row is row 1. When the
      // table has no header row Azure still uses 0-indexed rows and our
      // mapping below treats row 0 as the header — which `rows` already
      // omits, so dataRowIndex + 1 is the right Azure index.
      const azureRowIndex = dataRowIndex + 1;
      const symbolCellCol = symbolCol >= 0 ? symbolCol : 0;
      const symbolBbox = cellsByRow.get(azureRowIndex)?.get(symbolCellCol)?.bbox;
      const labelBbox = cellsByRow.get(azureRowIndex)?.get(rightIdx)?.bbox;

      // When Azure gives us a bbox, the cell must look like a glyph cell
      // (roughly square, not too big) — otherwise we're looking at a wide
      // text column the OCR mis-classified.
      if (!symbolBboxLooksLikeGlyphCell(symbolBbox)) continue;

      tableCandidates.push({
        symbol: sym,
        label: right,
        pageNumber,
        confidence: headerHasLegendKeyword ? 0.95 : 0.7,
        symbolBbox,
        labelBbox,
      });
    }

    // Promotion gate. Tiered so we accept real legends without admitting
    // title-block junk:
    //   - 0 candidates: nothing to promote.
    //   - Legend keyword found in headers OR any cell: promote ALL,
    //     including single-row legends. The keyword is strong signal.
    //   - No keyword but ≥2 surviving rows: promote. The earlier "≥3"
    //     gate rejected legitimate small legends (the user hit "No
    //     legend table or symbol list found on this page" on a real
    //     legend after the previous tightening).
    //   - No keyword AND only 1 row: skip — almost always a title-block
    //     fragment that happened to pass the row-level checks.
    if (tableCandidates.length === 0) continue;
    if (!isLegendTable && tableCandidates.length < 2) continue;
    entries.push(...tableCandidates);
  }

  // Path 2: text-based fallback. If no tables yielded entries, scan the
  // page text for lines near a LEGEND/SYMBOLS keyword that look like
  // "<short token> <description>". Confidence stays low because text
  // pattern matching is noisier than table extraction.
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
        if (looksLikeTitleBlockRow(sym, desc)) continue;
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
