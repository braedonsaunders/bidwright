import type { ChunkStore, DocumentChunk, DocumentKind, RetrievalHit, RetrievalQuery } from './types.js';
import { normalizeWhitespace, safeLower } from './utils.js';

function queryTerms(query: string): string[] {
  return normalizeWhitespace(query)
    .split(/\s+/)
    .map((term) => safeLower(term))
    .filter((term) => term.length > 2);
}

function chunkScore(query: RetrievalQuery, chunk: DocumentChunk): number {
  const terms = queryTerms(query.query);
  if (terms.length === 0) {
    return 0;
  }

  const haystack = safeLower(chunk.text);
  let score = 0;

  for (const term of terms) {
    if (haystack.includes(term)) {
      score += term.length > 6 ? 2 : 1;
    }
  }

  const kind = query.kinds?.includes(chunk.metadata.kind as unknown as DocumentKind);
  if (kind) {
    score += 1;
  }

  return score;
}

export class InMemoryChunkStore implements ChunkStore {
  private readonly chunks: DocumentChunk[] = [];

  async upsert(chunks: DocumentChunk[]): Promise<void> {
    this.chunks.push(...chunks);
  }

  async query(query: RetrievalQuery): Promise<RetrievalHit[]> {
    const kinds = query.kinds ?? [];

    const scored = this.chunks
      .filter((chunk) => {
        if (query.sourceKind && chunk.metadata.sourceKind !== query.sourceKind) {
          return false;
        }

        const chunkKind = chunk.metadata.kind as unknown as DocumentKind;
        if (kinds.length > 0 && !kinds.includes(chunkKind)) {
          return false;
        }

        return true;
      })
      .map((chunk) => ({
        ...chunk,
        score: chunkScore(query, chunk),
      }))
      .filter((chunk) => chunk.score > 0)
      .sort((left, right) => right.score - left.score || left.order - right.order);

    return scored.slice(0, query.limit ?? 12);
  }

  async clear(): Promise<void> {
    this.chunks.length = 0;
  }
}

export interface RetrievalAdapter {
  store: ChunkStore;
  retrieve(query: RetrievalQuery): Promise<RetrievalHit[]>;
}

export function createRetrievalAdapter(store: ChunkStore): RetrievalAdapter {
  return {
    store,
    async retrieve(query: RetrievalQuery): Promise<RetrievalHit[]> {
      return store.query(query);
    },
  };
}
