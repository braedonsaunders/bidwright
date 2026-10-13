import { derivePagesForIndexing } from "./page-provenance.js";
import { referenceBookPages } from "./reference-book-pages.js";

export function parseDocumentPages(value: string, pageCount?: number) {
  const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(value.trim());
  const start = Number(match?.[1]), end = Number(match?.[2] ?? match?.[1]);
  if (!match || !Number.isSafeInteger(end) || end - start >= 1000 || start < 1 || end < start || (pageCount && end > pageCount)) {
    throw Object.assign(new Error(`Invalid physical PDF page range (up to 1,000 pages per request) '${value}'${pageCount ? `; document has ${pageCount} pages` : ""}.`), { statusCode: 400 });
  }
  return { start, end };
}

/** Page numbers come from extraction metadata or PDF bytes, never guessed from flat text offsets. */
export async function documentPageText(doc: any, requested: string, pdfPath?: string,
  extract: (path: string) => Promise<string[]> = referenceBookPages) {
  const { start, end } = parseDocumentPages(requested, doc.pageCount);
  const structured = doc.structuredData?.pages ?? doc.structuredData?.nativePdf?.pages ?? [];
  const indexed = new Map<number, string>();
  for (const page of Array.isArray(structured) ? structured : []) {
    const number = Number(page.pageNumber ?? page.page);
    const text = page.text ?? page.content ?? page.lines?.map((line: any) => line.content ?? line.text ?? "").join("\n");
    if (number > 0 && typeof text === "string") indexed.set(number, text);
  }
  for (const page of derivePagesForIndexing(doc.extractedText, doc.structuredData) ?? []) {
    if (page.pageNumber !== null) indexed.set(page.pageNumber, page.text);
  }
  if (![...Array(end - start + 1)].every((_, i) => indexed.has(start + i))) {
    if (pdfPath && !/^https?:/i.test(pdfPath) && /\.pdf$/i.test(doc.fileName ?? pdfPath)) {
      const pages = await extract(pdfPath);
      parseDocumentPages(requested, pages.length);
      pages.forEach((text, i) => indexed.set(i + 1, text));
    }
  }
  const missing = Array.from({ length: end - start + 1 }, (_, i) => start + i).filter(page => !indexed.has(page));
  if (missing.length) return { content: "", pageTextStatus: "unavailable", fact: `Page-indexed text is unavailable for pages ${missing.join(", ")}; this does not mean the document has no text. readDrawingPage can inspect these pages.` };
  let content = "";
  const pageRanges: Array<{ page: number; start: number; end: number }> = [];
  for (let page = start; page <= end; page++) {
    content += `${content ? "\n\n" : ""}--- Page ${page} ---\n`;
    const offset = content.length;
    const text = indexed.get(page) ?? "";
    content += text || "[No text layer on this page; readDrawingPage can inspect it.]";
    if (text.trim()) pageRanges.push({ page, start: offset, end: content.length });
  }
  return { textPages: pageRanges.map(r => r.page), pageRanges, content, pageTextStatus: "available" };
}

/** Locate known physical page text in the exact full-text response, without guessed boundaries. */
export function fullDocumentText(doc: any) {
  const content = String(doc.extractedText ?? "");
  let cursor = 0;
  const stored = doc.structuredData?.pages ?? doc.structuredData?.nativePdf?.pages ?? [];
  const pages = derivePagesForIndexing(content, doc.structuredData) ?? (Array.isArray(stored) ? stored.map((page: any) => ({ pageNumber: Number(page.pageNumber ?? page.page) || null, text: page.text ?? page.content ?? "" })) : []);
  const pageRanges = pages.flatMap(page => {
    if (page.pageNumber === null || !page.text) return [];
    const start = content.indexOf(page.text, cursor);
    if (start < 0) return [];
    cursor = start + page.text.length;
    return [{ page: page.pageNumber, start, end: cursor }];
  });
  if (!pageRanges.length && doc.pageCount === 1 && content.trim()) pageRanges.push({ page: 1, start: 0, end: content.length });
  return { content, pageRanges };
}
