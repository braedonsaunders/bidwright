import type { Embedder, VectorHit, VectorSearchOptions, VectorStore } from "./types.js";

export class HybridSearchEngine {
  constructor(
    private vectorStore: VectorStore,
    private embedder: Embedder
  ) {}

  async search(options: VectorSearchOptions): Promise<VectorHit[]> {
    // Embed the query if no vector provided
    let queryVector = options.queryVector;
    if (!queryVector) {
      queryVector = await this.embedder.embedSingle(options.query);
    }

    return this.vectorStore.search({
      ...options,
      queryVector,
    });
  }
}
