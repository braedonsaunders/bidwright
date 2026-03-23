/**
 * Smart chunking engine for parsed documents.
 *
 * Supports four strategies:
 * - **recursive** — Split on paragraphs, then sentences, then characters
 * - **section-aware** — Use document headings as natural chunk boundaries
 * - **page** — One chunk per page
 * - **semantic** — Alias for section-aware (true semantic chunking requires embeddings)
 *
 * All strategies respect table preservation: tables are emitted as atomic
 * chunks and never split across boundaries.
 */

import type {
  ExtractedTable,
  ParsedDocument,
  SmartChunkingConfig,
  SmartDocumentChunk,
} from './pdf-types.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP = 100;
const DEFAULT_MIN_CHUNK_SIZE = 50;
const DEFAULT_MAX_CHUNK_SIZE = 1024;

interface ResolvedConfig {
  strategy: SmartChunkingConfig['strategy'];
  chunkSize: number;
  chunkOverlap: number;
  preserveTables: boolean;
  minChunkSize: number;
  maxChunkSize: number;
}

function resolveConfig(config: SmartChunkingConfig): ResolvedConfig {
  return {
    strategy: config.strategy,
    chunkSize: config.chunkSize ?? DEFAULT_CHUNK_SIZE,
    chunkOverlap: config.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
    preserveTables: config.preserveTables ?? true,
    minChunkSize: config.minChunkSize ?? DEFAULT_MIN_CHUNK_SIZE,
    maxChunkSize: config.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE,
  };
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Approximate token count (chars / 4). Avoids tiktoken dependency. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Approximate character count from tokens. */
function tokensToChars(tokens: number): number {
  return tokens * 4;
}

// ---------------------------------------------------------------------------
// Text splitting helpers
// ---------------------------------------------------------------------------

/** Split text into paragraphs. */
function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
}

/** Split text into sentences (basic heuristic). */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace
  const parts = text.split(/(?<=[.!?])\s+/);
  return parts.filter((s) => s.trim().length > 0);
}

/**
 * Recursively split text to fit within the target size.
 *
 * Tries paragraph splits first, then sentence splits, then falls back
 * to character-level splitting. Adds overlap between adjacent chunks.
 */
function recursiveSplit(
  text: string,
  targetChars: number,
  overlapChars: number,
  minChars: number,
): string[] {
  if (text.length <= targetChars) {
    return text.trim() ? [text.trim()] : [];
  }

  // Try paragraph-level splits
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length > 1) {
    return mergeWithOverlap(paragraphs, targetChars, overlapChars, minChars);
  }

  // Try sentence-level splits
  const sentences = splitSentences(text);
  if (sentences.length > 1) {
    return mergeWithOverlap(sentences, targetChars, overlapChars, minChars);
  }

  // Hard character-level split (last resort)
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + targetChars);
    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end >= text.length) break;
    start = Math.max(0, end - overlapChars);
  }
  return chunks;
}

/**
 * Merge text segments into chunks of roughly targetChars, adding overlap.
 */
function mergeWithOverlap(
  segments: string[],
  targetChars: number,
  overlapChars: number,
  minChars: number,
): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const segment of segments) {
    const combined = current ? `${current}\n\n${segment}` : segment;

    if (combined.length > targetChars && current) {
      // Emit current chunk
      chunks.push(current.trim());

      // Start new chunk with overlap from end of previous
      if (overlapChars > 0 && current.length > overlapChars) {
        const overlap = current.slice(-overlapChars);
        current = `${overlap}\n\n${segment}`;
      } else {
        current = segment;
      }
    } else {
      current = combined;
    }
  }

  // Emit final chunk
  if (current.trim()) {
    // If final chunk is too small, merge it with the previous one
    if (current.trim().length < minChars && chunks.length > 0) {
      const prev = chunks.pop()!;
      chunks.push(`${prev}\n\n${current.trim()}`);
    } else {
      chunks.push(current.trim());
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Table chunk extraction
// ---------------------------------------------------------------------------

/**
 * Extract tables as standalone chunks and return the remaining text with
 * table markdown removed.
 */
function extractTableChunks(
  doc: ParsedDocument,
  source: string,
): { tableChunks: SmartDocumentChunk[]; textByPage: Map<number, string> } {
  const tableChunks: SmartDocumentChunk[] = [];
  const textByPage = new Map<number, string>();

  // Index original page content
  for (const page of doc.pages) {
    textByPage.set(page.pageNumber, page.content);
  }

  // Create table chunks and remove table markdown from page text
  for (const table of doc.tables) {
    tableChunks.push({
      text: table.rawMarkdown,
      metadata: {
        pageNumber: table.pageNumber,
        sectionTitle: table.title,
        chunkIndex: -1, // will be reassigned
        totalChunks: -1,
        isTable: true,
        tokenCount: estimateTokens(table.rawMarkdown),
        source,
      },
    });

    // Remove table from page text to avoid double-counting
    const pageText = textByPage.get(table.pageNumber);
    if (pageText) {
      textByPage.set(table.pageNumber, pageText.replace(table.rawMarkdown, '').trim());
    }
  }

  return { tableChunks, textByPage };
}

// ---------------------------------------------------------------------------
// Strategy: Recursive
// ---------------------------------------------------------------------------

function chunkRecursive(doc: ParsedDocument, cfg: ResolvedConfig): SmartDocumentChunk[] {
  const source = doc.title;
  const results: SmartDocumentChunk[] = [];

  if (cfg.preserveTables && doc.tables.length > 0) {
    const { tableChunks, textByPage } = extractTableChunks(doc, source);
    results.push(...tableChunks);

    // Chunk remaining text across all pages
    const remainingText = Array.from(textByPage.values()).join('\n\n');
    const textChunks = recursiveSplit(
      remainingText,
      tokensToChars(cfg.chunkSize),
      tokensToChars(cfg.chunkOverlap),
      tokensToChars(cfg.minChunkSize),
    );

    for (const text of textChunks) {
      results.push({
        text,
        metadata: {
          chunkIndex: -1,
          totalChunks: -1,
          tokenCount: estimateTokens(text),
          source,
        },
      });
    }
  } else {
    const textChunks = recursiveSplit(
      doc.content,
      tokensToChars(cfg.chunkSize),
      tokensToChars(cfg.chunkOverlap),
      tokensToChars(cfg.minChunkSize),
    );

    for (const text of textChunks) {
      results.push({
        text,
        metadata: {
          chunkIndex: -1,
          totalChunks: -1,
          tokenCount: estimateTokens(text),
          source,
        },
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Strategy: Section-aware
// ---------------------------------------------------------------------------

function chunkSectionAware(doc: ParsedDocument, cfg: ResolvedConfig): SmartDocumentChunk[] {
  const source = doc.title;
  const results: SmartDocumentChunk[] = [];

  // Collect table chunks first
  if (cfg.preserveTables && doc.tables.length > 0) {
    const { tableChunks } = extractTableChunks(doc, source);
    results.push(...tableChunks);
  }

  // Process sections
  for (const page of doc.pages) {
    for (const section of page.sections) {
      const sectionTokens = estimateTokens(section.content);

      if (sectionTokens <= cfg.maxChunkSize) {
        // Section fits in one chunk
        if (sectionTokens >= cfg.minChunkSize) {
          results.push({
            text: section.content,
            metadata: {
              pageNumber: section.pageNumber,
              sectionTitle: section.title,
              chunkIndex: -1,
              totalChunks: -1,
              tokenCount: sectionTokens,
              source,
            },
          });
        }
      } else {
        // Section too large — apply recursive splitting within it
        const subChunks = recursiveSplit(
          section.content,
          tokensToChars(cfg.chunkSize),
          tokensToChars(cfg.chunkOverlap),
          tokensToChars(cfg.minChunkSize),
        );

        for (const text of subChunks) {
          results.push({
            text,
            metadata: {
              pageNumber: section.pageNumber,
              sectionTitle: section.title,
              chunkIndex: -1,
              totalChunks: -1,
              tokenCount: estimateTokens(text),
              source,
            },
          });
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Strategy: Page
// ---------------------------------------------------------------------------

function chunkByPage(doc: ParsedDocument, cfg: ResolvedConfig): SmartDocumentChunk[] {
  const source = doc.title;
  const results: SmartDocumentChunk[] = [];

  // Table chunks
  if (cfg.preserveTables && doc.tables.length > 0) {
    const { tableChunks } = extractTableChunks(doc, source);
    results.push(...tableChunks);
  }

  for (const page of doc.pages) {
    const pageTokens = estimateTokens(page.content);

    if (pageTokens <= cfg.maxChunkSize) {
      if (pageTokens >= cfg.minChunkSize) {
        results.push({
          text: page.content,
          metadata: {
            pageNumber: page.pageNumber,
            chunkIndex: -1,
            totalChunks: -1,
            tokenCount: pageTokens,
            source,
          },
        });
      }
    } else {
      // Page too large — split with overlap
      const subChunks = recursiveSplit(
        page.content,
        tokensToChars(cfg.chunkSize),
        tokensToChars(cfg.chunkOverlap),
        tokensToChars(cfg.minChunkSize),
      );

      for (const text of subChunks) {
        results.push({
          text,
          metadata: {
            pageNumber: page.pageNumber,
            chunkIndex: -1,
            totalChunks: -1,
            tokenCount: estimateTokens(text),
            source,
          },
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Chunk a parsed document using the specified strategy.
 *
 * @example
 * ```ts
 * const chunks = smartChunkDocument(parsedDoc, {
 *   strategy: 'section-aware',
 *   chunkSize: 512,
 *   chunkOverlap: 100,
 * });
 * ```
 */
export function smartChunkDocument(
  doc: ParsedDocument,
  config: SmartChunkingConfig,
): SmartDocumentChunk[] {
  const cfg = resolveConfig(config);

  let chunks: SmartDocumentChunk[];

  switch (cfg.strategy) {
    case 'recursive':
      chunks = chunkRecursive(doc, cfg);
      break;
    case 'section-aware':
    case 'semantic':
      chunks = chunkSectionAware(doc, cfg);
      break;
    case 'page':
      chunks = chunkByPage(doc, cfg);
      break;
    default:
      throw new Error(`Unknown chunking strategy: ${cfg.strategy}`);
  }

  // Assign final indices
  for (let i = 0; i < chunks.length; i++) {
    chunks[i].metadata.chunkIndex = i;
    chunks[i].metadata.totalChunks = chunks.length;
  }

  return chunks;
}
