/**
 * Contextual retrieval enrichment.
 *
 * Implements Anthropic's contextual retrieval approach: for each chunk,
 * an LLM generates a short context summary that situates the chunk within
 * the overall document. This summary is prepended to the chunk text before
 * embedding, dramatically improving retrieval relevance.
 *
 * @see https://www.anthropic.com/news/contextual-retrieval
 */

import type {
  ContextualChunk,
  EnrichmentConfig,
  SmartDocumentChunk,
} from './pdf-types.js';

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------

/**
 * Run async tasks with a concurrency limit.
 * Returns results in the same order as the input.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildContextPrompt(
  chunk: SmartDocumentChunk,
  documentTitle: string,
  documentContext: string,
): string {
  return (
    `Here is the document titled "${documentTitle}":\n` +
    `${documentContext}\n\n` +
    `Here is a chunk from this document:\n` +
    `<chunk>\n${chunk.text}\n</chunk>\n\n` +
    `Give a short (1-2 sentence) context summary that situates this chunk within the overall document. ` +
    `Focus on what topic/section this relates to and any key identifiers ` +
    `(spec numbers, equipment types, material codes) mentioned. Be concise.`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enrich document chunks with LLM-generated context summaries.
 *
 * Calls the provided LLM function for each chunk (with concurrency control)
 * to generate a short context summary. The summary is prepended to the chunk
 * text, producing an `enrichedText` field that should be used for embedding.
 *
 * @example
 * ```ts
 * const enriched = await enrichChunksWithContext(chunks, {
 *   llmFunction: (prompt) => callClaude(prompt),
 *   documentTitle: 'Mechanical Piping Spec',
 *   concurrency: 5,
 * });
 * ```
 */
export async function enrichChunksWithContext(
  chunks: SmartDocumentChunk[],
  config: EnrichmentConfig,
): Promise<ContextualChunk[]> {
  const concurrency = config.concurrency ?? 5;

  // Build document context: use provided summary or first ~2000 chars
  const documentContext =
    config.documentSummary ??
    chunks
      .slice(0, 5)
      .map((c) => c.text)
      .join('\n\n')
      .slice(0, 2000);

  const enriched = await mapWithConcurrency(
    chunks,
    async (chunk, _index) => {
      let contextSummary: string;

      try {
        const prompt = buildContextPrompt(chunk, config.documentTitle, documentContext);
        contextSummary = await config.llmFunction(prompt);
        contextSummary = contextSummary.trim();
      } catch (err) {
        // If the LLM call fails, fall back to a basic context string
        const section = chunk.metadata.sectionTitle ? ` in section "${chunk.metadata.sectionTitle}"` : '';
        const page = chunk.metadata.pageNumber ? ` (page ${chunk.metadata.pageNumber})` : '';
        contextSummary = `From "${config.documentTitle}"${section}${page}.`;
      }

      const enrichedText = `${contextSummary}\n\n${chunk.text}`;

      return {
        ...chunk,
        contextSummary,
        enrichedText,
        metadata: {
          ...chunk.metadata,
          tokenCount: Math.ceil(enrichedText.length / 4),
        },
      } satisfies ContextualChunk;
    },
    concurrency,
  );

  return enriched;
}
