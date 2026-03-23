import type { EmbeddingProvider, HybridSearchOptions, SearchResult } from "./types.js";

/** Minimal pg Pool interface so we don't need to import the full pg package as a type dep. */
interface PgPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Hybrid search engine combining pgvector cosine similarity with PostgreSQL
 * full-text (BM25-like) keyword search, merged via Reciprocal Rank Fusion.
 *
 * Expects the `vector_records` table to exist with:
 * - `embedding vector(N)` column with an HNSW index
 * - A generated `tsvector` column or the ability to call `to_tsvector('english', content)`
 *   on the `text` column at query time.
 *
 * @example
 * ```ts
 * const engine = new HybridSearchEngine(pool, embedder);
 * const results = await engine.search({ query: "concrete mix ratio", limit: 10 });
 * ```
 */
export class HybridSearchEngine {
  private defaultKeywordWeight: number;

  constructor(
    private pool: PgPool,
    private embedder: EmbeddingProvider,
    private config?: { defaultKeywordWeight?: number }
  ) {
    this.defaultKeywordWeight = config?.defaultKeywordWeight ?? 0.3;
  }

  /**
   * Perform a hybrid search combining vector similarity and keyword matching.
   * Results are fused using Reciprocal Rank Fusion (RRF).
   */
  async search(options: HybridSearchOptions): Promise<SearchResult[]> {
    const limit = options.limit ?? 10;
    const keywordWeight = options.keywordWeight ?? this.defaultKeywordWeight;
    // Fetch more candidates than the final limit so RRF has better coverage
    const candidateLimit = Math.max(limit * 3, 30);

    const queryEmbedding = await this.embedder.embedQuery(options.query);

    const [vectorResults, keywordResults] = await Promise.all([
      this.vectorSearch(queryEmbedding, candidateLimit, options),
      this.keywordSearch(options.query, candidateLimit, options),
    ]);

    const fused = this.rrfFusion(vectorResults, keywordResults, keywordWeight);
    return fused.slice(0, limit);
  }

  /**
   * Vector-only search using pgvector cosine distance.
   */
  async vectorSearch(
    embedding: number[],
    limit: number,
    filters?: Pick<HybridSearchOptions, "filters" | "organizationId" | "projectId" | "scope">
  ): Promise<SearchResult[]> {
    const vectorStr = `[${embedding.join(",")}]`;
    const conditions: string[] = [];
    const params: unknown[] = [vectorStr, limit];
    let idx = 3;

    if (filters?.organizationId) {
      conditions.push(`organization_id = $${idx++}`);
      params.push(filters.organizationId);
    }
    if (filters?.projectId) {
      conditions.push(`project_id = $${idx++}`);
      params.push(filters.projectId);
    }
    if (filters?.scope && filters.scope !== "all") {
      conditions.push(`scope = $${idx++}`);
      params.push(filters.scope);
    }

    // Apply arbitrary metadata filters
    if (filters?.filters) {
      for (const [key, value] of Object.entries(filters.filters)) {
        conditions.push(`metadata->>$${idx} = $${idx + 1}`);
        params.push(key, String(value));
        idx += 2;
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await this.pool.query(
      `SELECT id, text, metadata, (embedding <=> $1::vector) AS cosine_distance
       FROM vector_records
       ${whereClause}
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      params
    );

    return rows.map((row) => ({
      id: String(row.id),
      text: String(row.text),
      score: 1 - Number(row.cosine_distance),
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      source: "vector" as const,
    }));
  }

  /**
   * Keyword search using PostgreSQL full-text search (tsvector / tsquery).
   * Ranks results by `ts_rank_cd` which approximates BM25.
   */
  async keywordSearch(
    query: string,
    limit: number,
    filters?: Pick<HybridSearchOptions, "filters" | "organizationId" | "projectId" | "scope">
  ): Promise<SearchResult[]> {
    const conditions: string[] = ["to_tsvector('english', text) @@ plainto_tsquery('english', $1)"];
    const params: unknown[] = [query, limit];
    let idx = 3;

    if (filters?.organizationId) {
      conditions.push(`organization_id = $${idx++}`);
      params.push(filters.organizationId);
    }
    if (filters?.projectId) {
      conditions.push(`project_id = $${idx++}`);
      params.push(filters.projectId);
    }
    if (filters?.scope && filters.scope !== "all") {
      conditions.push(`scope = $${idx++}`);
      params.push(filters.scope);
    }

    if (filters?.filters) {
      for (const [key, value] of Object.entries(filters.filters)) {
        conditions.push(`metadata->>$${idx} = $${idx + 1}`);
        params.push(key, String(value));
        idx += 2;
      }
    }

    const whereClause = conditions.join(" AND ");

    const { rows } = await this.pool.query(
      `SELECT id, text, metadata,
              ts_rank_cd(to_tsvector('english', text), plainto_tsquery('english', $1)) AS rank
       FROM vector_records
       WHERE ${whereClause}
       ORDER BY rank DESC
       LIMIT $2`,
      params
    );

    return rows.map((row) => ({
      id: String(row.id),
      text: String(row.text),
      score: Number(row.rank),
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      source: "keyword" as const,
    }));
  }

  /**
   * Reciprocal Rank Fusion (RRF) to merge vector and keyword result lists.
   *
   * Formula: `score = (1 - w) * (1 / (k + vectorRank)) + w * (1 / (k + keywordRank))`
   * where k = 60 (standard RRF constant).
   */
  private rrfFusion(
    vectorResults: SearchResult[],
    keywordResults: SearchResult[],
    keywordWeight: number
  ): SearchResult[] {
    const k = 60;
    const vectorWeight = 1 - keywordWeight;

    const scoreMap = new Map<string, { result: SearchResult; score: number }>();

    // Score vector results by rank position
    for (let rank = 0; rank < vectorResults.length; rank++) {
      const r = vectorResults[rank];
      const rrfScore = vectorWeight * (1 / (k + rank + 1));
      scoreMap.set(r.id, { result: { ...r, source: "hybrid" }, score: rrfScore });
    }

    // Add keyword results
    for (let rank = 0; rank < keywordResults.length; rank++) {
      const r = keywordResults[rank];
      const rrfScore = keywordWeight * (1 / (k + rank + 1));
      const existing = scoreMap.get(r.id);
      if (existing) {
        existing.score += rrfScore;
        existing.result.source = "hybrid";
      } else {
        scoreMap.set(r.id, { result: { ...r, source: "hybrid" }, score: rrfScore });
      }
    }

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .map(({ result, score }) => ({ ...result, score }));
  }
}
