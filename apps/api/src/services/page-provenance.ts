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
  /** Null when the segment's page is genuinely unknown (text before the first numbered marker). */
  pageNumber: number | null;
  text: string;
}

export interface PageChunk {
  text: string;
  sectionTitle?: string;
  pageNumber: number | null;
}

export interface DerivePagesOptions {
  /**
   * Only set when the caller KNOWS the extractor joined pages with a bare
   * Markdown rule ("\n\n---\n\n"). A horizontal rule in ordinary prose is not a
   * page boundary, so this is never inferred.
   */
  bareRuleIsPageBreak?: boolean;
}

/** Unnumbered separators written by ingestion: Azure layout join and form feed. */
const UNNUMBERED_DELIMITER = /\n\n--- Page Break ---\n\n|\f/;
/** Explicit numbered markers, e.g. "--- Page 4 ---"; the number is authoritative. */
const NUMBERED_MARKER = /---\s*Page\s+(\d+)\s*---/gi;
const BARE_RULE = /\n\n---\n\n/;

type StructuredPageText = Array<{
  pageNumber?: number;
  lines?: Array<{ text?: string }>;
  truncated?: boolean;
}>;

/**
 * Derive per-page text for indexing.
 *  1. Positioned per-page text stored by ingestion (`structuredData.pageText`)
 *     is authoritative when present and not truncated; integer page numbers
 *     are kept exactly as recorded (gaps allowed).
 *  2. Otherwise, explicit numbered markers ("--- Page N ---") assign N to the
 *     text that follows them; text before the first marker has no page.
 *  3. Otherwise, unnumbered ingestion delimiters split sequentially; a bare
 *     Markdown rule counts only when the caller proves the extractor used it.
 *  4. Otherwise null: the caller indexes without a page rather than guessing.
 */
export function derivePagesForIndexing(
  extractedText: string | null | undefined,
  structuredData: unknown,
  options: DerivePagesOptions = {},
): IndexablePage[] | null {
  const text = String(extractedText ?? "");
  const positioned = positionedPages(structuredData);
  const mapped = text.trim() ? pagesFromText(text, options) : null;

  if (positioned) {
    // Positioned text is authoritative only when it actually covers the
    // document. A scan whose cover page has a text layer but whose body is
    // OCR-only would otherwise index just the cover and lose the body.
    const coverage = textCoverage(positioned, text);
    if (coverage >= 0.8 || !text.trim()) return positioned;
    if (mapped && mapped.length >= positioned.length) return mapped; // complete mapping from the extractor wins
    const remainder = removeKnownText(text, positioned);
    return remainder ? [...positioned, { pageNumber: null, text: remainder }] : positioned;
  }

  return mapped;
}

/** Integer-numbered, non-truncated positioned pages, or null when unusable. */
function positionedPages(structuredData: unknown): IndexablePage[] | null {
  const structured = (structuredData && typeof structuredData === "object" ? (structuredData as Record<string, unknown>) : {});
  const pageText = Array.isArray(structured.pageText) ? (structured.pageText as StructuredPageText) : [];
  if (pageText.length === 0 || pageText.some((page) => page.truncated === true)) return null;
  const pages = pageText
    .filter((page) => Number.isInteger(page.pageNumber) && Number(page.pageNumber) > 0)
    .map((page) => ({
      pageNumber: Number(page.pageNumber),
      text: (page.lines ?? []).map((line) => String(line.text ?? "").trim()).filter(Boolean).join("\n"),
    }))
    .filter((page) => page.text.length > 0)
    .sort((a, b) => a.pageNumber! - b.pageNumber!);
  return pages.length > 0 ? pages : null;
}

/** Pages recovered from extracted text: numbered markers first, then ingestion delimiters. */
function pagesFromText(text: string, options: DerivePagesOptions): IndexablePage[] | null {
  // Explicit numbered markers: keep the stated numbers, including a leading
  // marker and gaps. Anything before the first marker is of unknown page.
  const markers = [...text.matchAll(NUMBERED_MARKER)];
  if (markers.length > 0) {
    const pages: IndexablePage[] = [];
    const leading = text.slice(0, markers[0].index ?? 0).trim();
    if (leading) pages.push({ pageNumber: null, text: leading });
    markers.forEach((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = index + 1 < markers.length ? (markers[index + 1].index ?? text.length) : text.length;
      const body = text.slice(start, end).trim();
      if (body) pages.push({ pageNumber: Number(match[1]), text: body });
    });
    return pages.length > 0 ? pages : null;
  }

  const delimiter = options.bareRuleIsPageBreak
    ? new RegExp(`${UNNUMBERED_DELIMITER.source}|${BARE_RULE.source}`)
    : UNNUMBERED_DELIMITER;
  const parts = text.split(delimiter);
  if (parts.length <= 1) return null;
  const pages: IndexablePage[] = [];
  parts.forEach((part, index) => {
    const trimmed = part.trim();
    if (trimmed) pages.push({ pageNumber: index + 1, text: trimmed });
  });
  return pages.length > 0 ? pages : null;
}

const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

/** Fraction of the extracted text's characters that the positioned pages account for. */
function textCoverage(pages: IndexablePage[], fullText: string): number {
  const full = normalize(fullText).length;
  if (full === 0) return 1;
  const known = pages.reduce((sum, page) => sum + normalize(page.text).length, 0);
  return Math.min(1, known / full);
}

/** Extracted text with each known positioned line removed once; what is left has no page. */
function removeKnownText(fullText: string, pages: IndexablePage[]): string {
  let remainder = fullText;
  for (const page of pages) {
    for (const line of page.text.split("\n")) {
      const needle = line.trim();
      if (needle.length < 3) continue;
      const at = remainder.indexOf(needle);
      if (at >= 0) remainder = remainder.slice(0, at) + remainder.slice(at + needle.length);
    }
  }
  remainder = remainder.replace(/\n\n--- Page Break ---\n\n|\f/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return remainder.length >= 20 ? remainder : "";
}

/**
 * Chunk each page separately so every chunk carries the page it came from
 * (or null when that page is unknown). `chunk` is the caller's chunker; its
 * own pageNumber output is ignored because the page is already known.
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
