/**
 * Page provenance for project-document indexing.
 *
 * Project documents are indexed into the knowledge/vector store so the agent
 * can search them semantically. Chunking the whole extracted text in one go
 * loses the page each chunk came from, so semantic hits came back with no
 * page number. These helpers recover real page boundaries from what ingestion
 * already stored, and never invent a page when no mapping exists.
 */

export interface IndexablePage {
  pageNumber: number;
  text: string;
}

export interface PageChunk {
  text: string;
  sectionTitle?: string;
  pageNumber: number;
}

/** Page separators written by the ingestion paths (Azure layout, local pdf parser, form feed, legacy markers). */
export const PAGE_DELIMITER_PATTERN = /\n\n--- Page Break ---\n\n|\n\n---\n\n|\f|---\s*Page\s+\d+\s*---/i;

type StructuredPageText = Array<{
  pageNumber?: number;
  lines?: Array<{ text?: string }>;
  truncated?: boolean;
}>;

/**
 * Derive per-page text for indexing.
 *  1. Positioned per-page text stored by ingestion (`structuredData.pageText`)
 *     is authoritative when present and not truncated; page numbers are kept
 *     exactly as recorded (gaps allowed).
 *  2. Otherwise, extracted text that contains page delimiters is split and
 *     numbered sequentially.
 *  3. Otherwise null: the caller must index without a page rather than guess.
 */
export function derivePagesForIndexing(
  extractedText: string | null | undefined,
  structuredData: unknown,
): IndexablePage[] | null {
  const structured = (structuredData && typeof structuredData === "object" ? (structuredData as Record<string, unknown>) : {});
  const pageText = Array.isArray(structured.pageText) ? (structured.pageText as StructuredPageText) : [];
  if (pageText.length > 0 && !pageText.some((page) => page.truncated === true)) {
    const pages = pageText
      .map((page) => ({
        pageNumber: Number(page.pageNumber),
        text: (page.lines ?? []).map((line) => String(line.text ?? "").trim()).filter(Boolean).join("\n"),
      }))
      .filter((page) => Number.isFinite(page.pageNumber) && page.pageNumber > 0 && page.text.length > 0)
      .sort((a, b) => a.pageNumber - b.pageNumber);
    if (pages.length > 0) return pages;
  }

  const text = String(extractedText ?? "");
  if (!text.trim()) return null;
  const parts = text.split(PAGE_DELIMITER_PATTERN);
  if (parts.length <= 1) return null;
  const pages: IndexablePage[] = [];
  parts.forEach((part, index) => {
    const trimmed = part.trim();
    if (trimmed) pages.push({ pageNumber: index + 1, text: trimmed });
  });
  return pages.length > 0 ? pages : null;
}

/**
 * Chunk each page separately so every chunk carries the page it came from.
 * `chunk` is the caller's chunker (section-aware / recursive); its own
 * pageNumber output is ignored because the page is already known.
 */
export function planPageChunks(
  pages: IndexablePage[],
  chunk: (text: string) => Array<{ text: string; sectionTitle?: string }>,
): PageChunk[] {
  const chunks: PageChunk[] = [];
  for (const page of pages) {
    if (!page.text.trim()) continue;
    for (const result of chunk(page.text)) {
      if (!result.text.trim()) continue;
      chunks.push({ text: result.text, sectionTitle: result.sectionTitle, pageNumber: page.pageNumber });
    }
  }
  return chunks;
}
