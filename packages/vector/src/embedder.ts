import type { Embedder, EmbeddingConfig, EmbeddingProvider, EmbeddingRequest, EmbeddingResult } from "./types.js";

// ---------------------------------------------------------------------------
// Legacy OpenAI embedder (preserved for backward compatibility)
// ---------------------------------------------------------------------------

interface OpenAIClient {
  embeddings: {
    create(params: { model: string; input: string[]; dimensions: number }): Promise<{
      data: Array<{ embedding: number[] }>;
      model: string;
      usage: { total_tokens: number };
    }>;
  };
}

export class OpenAIEmbedder implements Embedder {
  private defaultModel: string;
  private defaultDimensions: number;

  constructor(
    private client: OpenAIClient,
    options?: { model?: string; dimensions?: number }
  ) {
    this.defaultModel = options?.model ?? "text-embedding-3-large";
    this.defaultDimensions = options?.dimensions ?? 1536;
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const model = request.model ?? this.defaultModel;
    const dimensions = request.dimensions ?? this.defaultDimensions;

    const response = await this.client.embeddings.create({
      model,
      input: request.texts,
      dimensions,
    });

    return {
      vectors: response.data.map((d) => d.embedding),
      model: response.model,
      tokenCount: response.usage.total_tokens,
    };
  }

  async embedSingle(text: string): Promise<number[]> {
    const result = await this.embed({ texts: [text] });
    return result.vectors[0];
  }

  async embedBatch(texts: string[], batchSize = 512): Promise<number[][]> {
    const allVectors: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const result = await this.embed({ texts: batch });
      allVectors.push(...result.vectors);
    }

    return allVectors;
  }
}

// ---------------------------------------------------------------------------
// Multi-provider embedding adapter
// ---------------------------------------------------------------------------

const RETRY_DELAYS = [1000, 2000, 4000];

/** Provider-specific defaults. */
const PROVIDER_DEFAULTS: Record<string, { model: string; dimensions: number; maxBatchSize: number; maxTokens: number }> = {
  openai: { model: "text-embedding-3-large", dimensions: 3072, maxBatchSize: 2048, maxTokens: 8191 },
  "openai-small": { model: "text-embedding-3-small", dimensions: 1536, maxBatchSize: 2048, maxTokens: 8191 },
  cohere: { model: "embed-v4", dimensions: 1024, maxBatchSize: 96, maxTokens: 512 },
  voyage: { model: "voyage-3-large", dimensions: 1024, maxBatchSize: 128, maxTokens: 32000 },
  gemini: { model: "text-embedding-004", dimensions: 768, maxBatchSize: 100, maxTokens: 2048 },
  local: { model: "default", dimensions: 1024, maxBatchSize: 16, maxTokens: 512 },
};

/**
 * Normalize a vector to unit length (L2 norm = 1).
 * Returns the original array mutated in-place for efficiency.
 */
function normalize(vec: number[]): number[] {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }
  return vec;
}

/** Sleep for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with exponential backoff retry on 429 / 5xx.
 * Retries up to 3 times with delays of 1s, 2s, 4s.
 */
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
 * Fetch helper that throws on non-OK responses with the status attached.
 */
async function apiFetch(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Embedding API error ${res.status}: ${body}`);
    (err as unknown as Record<string, unknown>).status = res.status;
    throw err;
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

function createOpenAIProvider(config: EmbeddingConfig): EmbeddingProvider {
  const isSmall = config.model?.includes("small");
  const defaults = isSmall ? PROVIDER_DEFAULTS["openai-small"] : PROVIDER_DEFAULTS.openai;
  const model = config.model ?? defaults.model;
  const dimensions = config.dimensions ?? defaults.dimensions;
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";

  return {
    id: "openai",
    dimensions,
    maxBatchSize: defaults.maxBatchSize,
    maxTokens: defaults.maxTokens,

    async embed(texts: string[]): Promise<number[][]> {
      const allVectors: number[][] = [];
      for (let i = 0; i < texts.length; i += defaults.maxBatchSize) {
        const batch = texts.slice(i, i + defaults.maxBatchSize);
        const data = await withRetry(() =>
          apiFetch(`${baseUrl}/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model, input: batch, dimensions }),
          })
        ) as { data: Array<{ embedding: number[] }>; usage?: { total_tokens?: number } };

        for (const item of data.data) {
          allVectors.push(normalize(item.embedding));
        }
        if (data.usage?.total_tokens) {
          console.debug(`[embedder:openai] ${batch.length} texts, ${data.usage.total_tokens} tokens`);
        }
      }
      return allVectors;
    },

    async embedQuery(query: string): Promise<number[]> {
      const vecs = await this.embed([query]);
      return vecs[0];
    },
  };
}

function createCohereProvider(config: EmbeddingConfig): EmbeddingProvider {
  const defaults = PROVIDER_DEFAULTS.cohere;
  const model = config.model ?? defaults.model;
  const dimensions = config.dimensions ?? defaults.dimensions;
  const apiKey = config.apiKey ?? process.env.COHERE_API_KEY ?? "";
  const baseUrl = config.baseUrl ?? "https://api.cohere.ai/v2";

  return {
    id: "cohere",
    dimensions,
    maxBatchSize: defaults.maxBatchSize,
    maxTokens: defaults.maxTokens,
    supportsMultimodal: model === "embed-v4",

    async embed(texts: string[]): Promise<number[][]> {
      const allVectors: number[][] = [];
      for (let i = 0; i < texts.length; i += defaults.maxBatchSize) {
        const batch = texts.slice(i, i + defaults.maxBatchSize);
        const data = await withRetry(() =>
          apiFetch(`${baseUrl}/embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model,
              texts: batch,
              input_type: "search_document",
              embedding_types: ["float"],
              truncate: "END",
            }),
          })
        ) as { embeddings: { float: number[][] }; meta?: { billed_units?: { input_tokens?: number } } };

        for (const vec of data.embeddings.float) {
          allVectors.push(normalize(vec));
        }
        if (data.meta?.billed_units?.input_tokens) {
          console.debug(`[embedder:cohere] ${batch.length} texts, ${data.meta.billed_units.input_tokens} tokens`);
        }
      }
      return allVectors;
    },

    async embedQuery(query: string): Promise<number[]> {
      const data = await withRetry(() =>
        apiFetch(`${baseUrl}/embed`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            texts: [query],
            input_type: "search_query",
            embedding_types: ["float"],
            truncate: "END",
          }),
        })
      ) as { embeddings: { float: number[][] } };
      return normalize(data.embeddings.float[0]);
    },
  };
}

function createVoyageProvider(config: EmbeddingConfig): EmbeddingProvider {
  const defaults = PROVIDER_DEFAULTS.voyage;
  const model = config.model ?? defaults.model;
  const dimensions = config.dimensions ?? defaults.dimensions;
  const apiKey = config.apiKey ?? process.env.VOYAGE_API_KEY ?? "";
  const baseUrl = config.baseUrl ?? "https://api.voyageai.com/v1";

  return {
    id: "voyage",
    dimensions,
    maxBatchSize: defaults.maxBatchSize,
    maxTokens: defaults.maxTokens,

    async embed(texts: string[]): Promise<number[][]> {
      const allVectors: number[][] = [];
      for (let i = 0; i < texts.length; i += defaults.maxBatchSize) {
        const batch = texts.slice(i, i + defaults.maxBatchSize);
        const data = await withRetry(() =>
          apiFetch(`${baseUrl}/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model, input: batch, output_dimension: dimensions }),
          })
        ) as { data: Array<{ embedding: number[] }>; usage?: { total_tokens?: number } };

        for (const item of data.data) {
          allVectors.push(normalize(item.embedding));
        }
        if (data.usage?.total_tokens) {
          console.debug(`[embedder:voyage] ${batch.length} texts, ${data.usage.total_tokens} tokens`);
        }
      }
      return allVectors;
    },

    async embedQuery(query: string): Promise<number[]> {
      const vecs = await this.embed([query]);
      return vecs[0];
    },
  };
}

function createGeminiProvider(config: EmbeddingConfig): EmbeddingProvider {
  const defaults = PROVIDER_DEFAULTS.gemini;
  const model = config.model ?? defaults.model;
  const dimensions = config.dimensions ?? defaults.dimensions;
  const apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? "";
  const baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";

  return {
    id: "gemini",
    dimensions,
    maxBatchSize: defaults.maxBatchSize,
    maxTokens: defaults.maxTokens,

    async embed(texts: string[]): Promise<number[][]> {
      const allVectors: number[][] = [];
      for (let i = 0; i < texts.length; i += defaults.maxBatchSize) {
        const batch = texts.slice(i, i + defaults.maxBatchSize);
        // Gemini batchEmbedContents endpoint
        const requests = batch.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          outputDimensionality: dimensions,
        }));

        const data = await withRetry(() =>
          apiFetch(`${baseUrl}/models/${model}:batchEmbedContents?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requests }),
          })
        ) as { embeddings: Array<{ values: number[] }> };

        for (const emb of data.embeddings) {
          allVectors.push(normalize(emb.values));
        }
        console.debug(`[embedder:gemini] ${batch.length} texts embedded`);
      }
      return allVectors;
    },

    async embedQuery(query: string): Promise<number[]> {
      const data = await withRetry(() =>
        apiFetch(`${baseUrl}/models/${model}:embedContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: `models/${model}`,
            content: { parts: [{ text: query }] },
            outputDimensionality: dimensions,
          }),
        })
      ) as { embedding: { values: number[] } };
      return normalize(data.embedding.values);
    },
  };
}

function createLocalProvider(config: EmbeddingConfig): EmbeddingProvider {
  const defaults = PROVIDER_DEFAULTS.local;
  const dimensions = config.dimensions ?? defaults.dimensions;
  const model = config.model ?? defaults.model;
  const baseUrl = config.baseUrl ?? "http://localhost:11434/v1";
  const maxChars = defaults.maxTokens * 4; // approximate char limit from token limit

  return {
    id: "local",
    dimensions,
    maxBatchSize: defaults.maxBatchSize,
    maxTokens: defaults.maxTokens,

    async embed(texts: string[]): Promise<number[][]> {
      // Truncate oversized texts to avoid context length errors
      const truncated = texts.map((t) => (t.length > maxChars ? t.slice(0, maxChars) : t));
      const allVectors: number[][] = [];

      for (let i = 0; i < truncated.length; i += defaults.maxBatchSize) {
        const batch = truncated.slice(i, i + defaults.maxBatchSize);
        try {
          const data = await withRetry(() =>
            apiFetch(`${baseUrl}/embeddings`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model, input: batch }),
            })
          ) as { data: Array<{ embedding: number[] }> };

          for (const item of data.data) {
            allVectors.push(normalize(item.embedding));
          }
        } catch {
          // If batch fails, fall back to one-at-a-time
          for (const text of batch) {
            try {
              const data = await withRetry(() =>
                apiFetch(`${baseUrl}/embeddings`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ model, input: [text] }),
                })
              ) as { data: Array<{ embedding: number[] }> };
              allVectors.push(normalize(data.data[0].embedding));
            } catch {
              // Skip this text — push a zero vector as placeholder
              allVectors.push(new Array(dimensions).fill(0));
            }
          }
        }
      }
      return allVectors;
    },

    async embedQuery(query: string): Promise<number[]> {
      const vecs = await this.embed([query]);
      return vecs[0];
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an embedding provider from the given configuration.
 *
 * @example
 * ```ts
 * const embedder = createEmbedder({ provider: "openai", model: "text-embedding-3-small" });
 * const vectors = await embedder.embed(["hello world"]);
 * ```
 */
export function createEmbedder(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.provider) {
    case "openai":
      return createOpenAIProvider(config);
    case "cohere":
      return createCohereProvider(config);
    case "voyage":
      return createVoyageProvider(config);
    case "gemini":
      return createGeminiProvider(config);
    case "local":
      return createLocalProvider(config);
    default:
      throw new Error(`Unknown embedding provider: ${(config as EmbeddingConfig).provider}`);
  }
}
