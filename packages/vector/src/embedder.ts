import type { OpenAI } from "openai";
import type { Embedder, EmbeddingRequest, EmbeddingResult } from "./types.js";

export class OpenAIEmbedder implements Embedder {
  private defaultModel: string;
  private defaultDimensions: number;

  constructor(
    private client: OpenAI,
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
