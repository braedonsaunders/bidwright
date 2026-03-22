import type { ChunkingOptions, DocumentChunk, SourceDocument } from './types.js';
import { createId, estimateTokenCount, normalizeWhitespace } from './utils.js';

const DEFAULT_CHUNK_SIZE = 1800;
const DEFAULT_CHUNK_OVERLAP = 240;

function resolveOptions(options: ChunkingOptions = {}): Required<ChunkingOptions> {
  return {
    chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
    chunkOverlap: options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
  };
}

export function chunkText(text: string, options?: ChunkingOptions): Array<{ text: string; startOffset: number; endOffset: number }> {
  const { chunkSize, chunkOverlap } = resolveOptions(options);
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return [];
  }

  const chunks: Array<{ text: string; startOffset: number; endOffset: number }> = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + chunkSize);
    const value = normalized.slice(start, end).trim();

    if (value) {
      chunks.push({
        text: value,
        startOffset: start,
        endOffset: end,
      });
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(0, end - chunkOverlap);
  }

  return chunks;
}

export function chunkDocument(document: SourceDocument, options?: ChunkingOptions): DocumentChunk[] {
  return chunkText(document.text, options).map((chunk, index) => ({
    id: createId('chunk'),
    documentId: document.id,
    sourcePath: document.sourcePath,
    text: chunk.text,
    order: index,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    tokensEstimate: estimateTokenCount(chunk.text),
    metadata: {
      ...document.metadata,
      kind: document.kind,
      sourceKind: document.sourceKind,
    },
    citations: document.citations,
  }));
}

export function chunkDocuments(documents: SourceDocument[], options?: ChunkingOptions): DocumentChunk[] {
  return documents.flatMap((document) => chunkDocument(document, options));
}
