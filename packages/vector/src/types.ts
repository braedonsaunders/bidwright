export interface VectorRecord {
  id: string;
  chunkId: string;
  documentId: string;
  projectId: string | null;
  scope: "project" | "library";
  embedding: number[];
  text: string;
  metadata: Record<string, string | number | boolean>;
  createdAt?: string;
}

export interface VectorSearchOptions {
  query: string;
  queryVector?: number[];
  projectId?: string;
  scope?: "project" | "library" | "all";
  documentKinds?: string[];
  limit?: number;
  minScore?: number;
  hybridWeight?: number;  // 0 = pure vector, 1 = pure keyword
}

export interface VectorHit {
  record: VectorRecord;
  score: number;
  vectorScore: number;
  keywordScore: number;
}

export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  search(options: VectorSearchOptions): Promise<VectorHit[]>;
  delete(filter: { projectId?: string; documentId?: string; chunkId?: string }): Promise<number>;
  count(filter?: { projectId?: string; scope?: string }): Promise<number>;
}

export interface EmbeddingRequest {
  texts: string[];
  model?: string;
  dimensions?: number;
}

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  tokenCount: number;
}

export interface Embedder {
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
  embedSingle(text: string): Promise<number[]>;
  embedBatch(texts: string[], batchSize?: number): Promise<number[][]>;
}
