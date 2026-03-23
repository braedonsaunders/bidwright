// ---------------------------------------------------------------------------
// Existing vector store types (preserved for backward compatibility)
// ---------------------------------------------------------------------------

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
  hybridWeight?: number; // 0 = pure vector, 1 = pure keyword
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

// ---------------------------------------------------------------------------
// New embedding provider types (multi-provider)
// ---------------------------------------------------------------------------

/** Unified embedding provider interface for all embedding backends. */
export interface EmbeddingProvider {
  /** Unique provider identifier (e.g. "openai", "cohere"). */
  id: string;
  /** Embed a batch of texts, returning one vector per text. */
  embed(texts: string[]): Promise<number[][]>;
  /** Embed a single query string. */
  embedQuery(query: string): Promise<number[]>;
  /** Output dimensionality of the embedding model. */
  dimensions: number;
  /** Maximum texts per single API call. */
  maxBatchSize: number;
  /** Maximum input tokens the model supports. */
  maxTokens: number;
  /** Whether the provider supports image + text embeddings. */
  supportsMultimodal?: boolean;
}

/** Configuration for creating an embedding provider via `createEmbedder`. */
export interface EmbeddingConfig {
  provider: "openai" | "cohere" | "voyage" | "local" | "gemini";
  model?: string;
  apiKey?: string;
  /** Base URL for self-hosted / local providers. */
  baseUrl?: string;
  dimensions?: number;
}

// ---------------------------------------------------------------------------
// Hybrid search types
// ---------------------------------------------------------------------------

/** A single search result from vector, keyword, or hybrid search. */
export interface SearchResult {
  id: string;
  text: string;
  score: number;
  metadata: Record<string, unknown>;
  source: "vector" | "keyword" | "hybrid";
}

/** Options for the hybrid search engine. */
export interface HybridSearchOptions {
  query: string;
  limit?: number;
  /** Weight given to keyword results in RRF fusion (0-1, default 0.3). */
  keywordWeight?: number;
  filters?: Record<string, unknown>;
  organizationId?: string;
  projectId?: string;
  scope?: "global" | "project" | "all";
  /** Whether to apply reranking to the fused results. */
  rerank?: boolean;
}

/** Configuration for a reranking provider. */
export interface RerankerConfig {
  provider: "cohere" | "local" | "none";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  topK?: number;
}

/** A chunk record stored in the vector database. */
export interface ChunkRecord {
  id: string;
  text: string;
  embedding?: number[];
  metadata: {
    bookId?: string;
    documentId?: string;
    sectionTitle?: string;
    pageNumber?: number;
    chunkIndex?: number;
    source?: string;
    /** Contextual retrieval summary. */
    context?: string;
    [key: string]: unknown;
  };
  organizationId: string;
  scope: "global" | "project";
  projectId?: string;
}
