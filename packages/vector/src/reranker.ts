import type { RerankerConfig, SearchResult } from "./types.js";

const RETRY_DELAYS = [1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiFetch(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Reranker API error ${res.status}: ${body}`);
    (err as unknown as Record<string, unknown>).status = res.status;
    throw err;
  }
  return res.json();
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const status = (err as { status?: number }).status ?? (err as { statusCode?: number }).statusCode;
      const isRetryable = status === 429 || (status !== undefined && status >= 500);
      if (!isRetryable || attempt >= RETRY_DELAYS.length) throw err;
      await sleep(RETRY_DELAYS[attempt]);
    }
  }
  throw lastError;
}

/**
 * Reranker that re-scores search results using a cross-encoder model.
 * Supports Cohere, local (TEI-compatible), or passthrough (none).
 *
 * @example
 * ```ts
 * const reranker = new Reranker({ provider: "cohere", apiKey: "..." });
 * const reranked = await reranker.rerank("concrete mix ratio", results, 5);
 * ```
 */
export class Reranker {
  constructor(private config: RerankerConfig) {}

  /**
   * Rerank search results for the given query.
   * Returns a new array sorted by relevance score, truncated to `topK`.
   */
  async rerank(query: string, documents: SearchResult[], topK?: number): Promise<SearchResult[]> {
    const limit = topK ?? this.config.topK ?? documents.length;

    switch (this.config.provider) {
      case "cohere":
        return this.rerankCohere(query, documents, limit);
      case "local":
        return this.rerankLocal(query, documents, limit);
      case "none":
        return documents.slice(0, limit);
      default:
        throw new Error(`Unknown reranker provider: ${this.config.provider}`);
    }
  }

  private async rerankCohere(query: string, documents: SearchResult[], topK: number): Promise<SearchResult[]> {
    const apiKey = this.config.apiKey ?? process.env.COHERE_API_KEY ?? "";
    const model = this.config.model ?? "rerank-v3.5";

    const data = await withRetry(() =>
      apiFetch("https://api.cohere.ai/v2/rerank", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          query,
          documents: documents.map((d) => d.text),
          top_n: topK,
          return_documents: false,
        }),
      })
    ) as { results: Array<{ index: number; relevance_score: number }> };

    return data.results.map((r) => ({
      ...documents[r.index],
      score: r.relevance_score,
    }));
  }

  private async rerankLocal(query: string, documents: SearchResult[], topK: number): Promise<SearchResult[]> {
    const baseUrl = this.config.baseUrl ?? "http://localhost:8080";

    const data = await withRetry(() =>
      apiFetch(`${baseUrl}/rerank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          texts: documents.map((d) => d.text),
          truncate: true,
        }),
      })
    ) as Array<{ index: number; score: number }>;

    const ranked = data
      .map((r) => ({ ...documents[r.index], score: r.score }))
      .sort((a, b) => b.score - a.score);

    return ranked.slice(0, topK);
  }
}
