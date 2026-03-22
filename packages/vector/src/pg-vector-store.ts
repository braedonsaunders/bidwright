import type { VectorHit, VectorRecord, VectorSearchOptions, VectorStore } from "./types.js";

/**
 * PostgreSQL pgvector implementation.
 * Requires a Postgres database with the pgvector extension and a vector_records table.
 *
 * Table DDL:
 * CREATE EXTENSION IF NOT EXISTS vector;
 * CREATE TABLE vector_records (
 *   id TEXT PRIMARY KEY,
 *   chunk_id TEXT NOT NULL,
 *   document_id TEXT NOT NULL,
 *   project_id TEXT,
 *   scope TEXT NOT NULL DEFAULT 'project',
 *   embedding vector(1536) NOT NULL,
 *   text TEXT NOT NULL,
 *   metadata JSONB DEFAULT '{}',
 *   created_at TIMESTAMPTZ DEFAULT now()
 * );
 * CREATE INDEX ON vector_records USING hnsw (embedding vector_cosine_ops);
 * CREATE INDEX ON vector_records (project_id);
 * CREATE INDEX ON vector_records (scope);
 */
export class PgVectorStore implements VectorStore {
  constructor(private queryFn: <T>(sql: string, params?: unknown[]) => Promise<T[]>) {}

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) {
      const vectorStr = `[${record.embedding.join(",")}]`;
      await this.queryFn(
        `INSERT INTO vector_records (id, chunk_id, document_id, project_id, scope, embedding, text, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           embedding = EXCLUDED.embedding,
           text = EXCLUDED.text,
           metadata = EXCLUDED.metadata`,
        [record.id, record.chunkId, record.documentId, record.projectId, record.scope, vectorStr, record.text, JSON.stringify(record.metadata)]
      );
    }
  }

  async search(options: VectorSearchOptions): Promise<VectorHit[]> {
    if (!options.queryVector) {
      throw new Error("queryVector is required for pgvector search. Embed the query first.");
    }

    const vectorStr = `[${options.queryVector.join(",")}]`;
    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0.3;

    const conditions: string[] = [];
    const params: unknown[] = [vectorStr, limit];
    let paramIdx = 3;

    if (options.projectId) {
      conditions.push(`project_id = $${paramIdx}`);
      params.push(options.projectId);
      paramIdx++;
    }

    if (options.scope && options.scope !== "all") {
      conditions.push(`scope = $${paramIdx}`);
      params.push(options.scope);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await this.queryFn<{
      id: string;
      chunk_id: string;
      document_id: string;
      project_id: string | null;
      scope: string;
      text: string;
      metadata: Record<string, string | number | boolean>;
      cosine_distance: number;
    }>(
      `SELECT id, chunk_id, document_id, project_id, scope, text, metadata,
              (embedding <=> $1::vector) as cosine_distance
       FROM vector_records
       ${whereClause}
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      params
    );

    return rows
      .map((row) => {
        const vectorScore = 1 - row.cosine_distance; // Convert distance to similarity
        const keywordScore = computeKeywordScore(options.query, row.text);
        const hybridWeight = options.hybridWeight ?? 0.3;
        const score = (1 - hybridWeight) * vectorScore + hybridWeight * keywordScore;

        return {
          record: {
            id: row.id,
            chunkId: row.chunk_id,
            documentId: row.document_id,
            projectId: row.project_id,
            scope: row.scope as "project" | "library",
            embedding: [], // Don't return embeddings in search results
            text: row.text,
            metadata: row.metadata,
          },
          score,
          vectorScore,
          keywordScore,
        };
      })
      .filter((hit) => hit.score >= minScore)
      .sort((a, b) => b.score - a.score);
  }

  async delete(filter: { projectId?: string; documentId?: string; chunkId?: string }): Promise<number> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter.projectId) { conditions.push(`project_id = $${idx++}`); params.push(filter.projectId); }
    if (filter.documentId) { conditions.push(`document_id = $${idx++}`); params.push(filter.documentId); }
    if (filter.chunkId) { conditions.push(`chunk_id = $${idx++}`); params.push(filter.chunkId); }

    if (conditions.length === 0) return 0;

    const result = await this.queryFn<{ count: number }>(
      `WITH deleted AS (DELETE FROM vector_records WHERE ${conditions.join(" AND ")} RETURNING 1)
       SELECT count(*)::int as count FROM deleted`,
      params
    );
    return result[0]?.count ?? 0;
  }

  async count(filter?: { projectId?: string; scope?: string }): Promise<number> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter?.projectId) { conditions.push(`project_id = $${idx++}`); params.push(filter.projectId); }
    if (filter?.scope) { conditions.push(`scope = $${idx++}`); params.push(filter.scope); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.queryFn<{ count: number }>(
      `SELECT count(*)::int as count FROM vector_records ${whereClause}`,
      params
    );
    return result[0]?.count ?? 0;
  }
}

/** Simple keyword scoring for hybrid search */
function computeKeywordScore(query: string, text: string): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (queryTerms.length === 0) return 0;

  const textLower = text.toLowerCase();
  let matches = 0;
  for (const term of queryTerms) {
    if (textLower.includes(term)) {
      matches += term.length > 5 ? 2 : 1;
    }
  }

  return Math.min(1, matches / (queryTerms.length * 1.5));
}
