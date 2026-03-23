import type { PrismaApiStore } from "../prisma-store.js";
import { createLLMAdapter } from "@bidwright/agent";
import { createPdfParser } from "@bidwright/ingestion";
import { createEmbedder, PgVectorStore, type VectorRecord } from "@bidwright/vector";
import { prisma } from "@bidwright/db";
import type { KnowledgeBook, KnowledgeChunk, SourceDocument } from "@bidwright/domain";
import { relativeKnowledgeBookPath, resolveApiPath } from "../paths.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Lazy-initialized vector infrastructure (keyed by orgId)
const _vectorStores = new Map<string, PgVectorStore>();
function getVectorStore(organizationId: string): PgVectorStore {
  let store = _vectorStores.get(organizationId);
  if (!store) {
    store = new PgVectorStore(
      async <T>(sql: string, params?: unknown[]) => {
        return prisma.$queryRawUnsafe<T[]>(sql, ...(params ?? [])).then((r) => r as T[]);
      },
      organizationId,
    );
    _vectorStores.set(organizationId, store);
  }
  return store;
}

/** Resolve embedding configuration from environment variables. */
function getEmbeddingConfig(): { provider: "openai" | "local"; apiKey?: string; baseUrl?: string; model?: string; dimensions?: number } | null {
  const provider = process.env.EMBEDDING_PROVIDER as "openai" | "local" | undefined;

  // Explicit local provider (TEI / Ollama)
  if (provider === "local") {
    return {
      provider: "local",
      baseUrl: process.env.EMBEDDING_BASE_URL || "http://localhost:11434/v1",
      model: process.env.EMBEDDING_MODEL || "snowflake-arctic-embed",
      dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || "1024", 10),
    };
  }

  // OpenAI provider (needs API key)
  if (process.env.OPENAI_API_KEY) {
    return { provider: "openai", apiKey: process.env.OPENAI_API_KEY };
  }

  return null;
}

// ── Interfaces ────────────────────────────────────────────────────────

export interface IngestionRequest {
  file?: { buffer: Buffer; filename: string; mimeType: string };
  content?: string;
  title: string;
  category: KnowledgeBook["category"];
  scope: KnowledgeBook["scope"];
  projectId?: string;
  organizationId?: string;
  options?: {
    chunkStrategy?: "recursive" | "section-aware" | "page";
    chunkSize?: number;
    enableContextualEnrichment?: boolean;
    enableEmbeddings?: boolean;
    pdfProvider?: "llamaparse" | "local" | "vision";
  };
}

export interface IngestionResult {
  bookId: string;
  status: "completed" | "processing" | "failed";
  chunkCount: number;
  pageCount: number;
  embeddingsGenerated: boolean;
  processingTimeMs: number;
  errors?: string[];
}

export interface SearchResult {
  id: string;
  text: string;
  score: number;
  source: string;
  bookId?: string;
  bookName?: string;
  sectionTitle?: string;
  pageNumber?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  organizationId?: string;
  projectId?: string;
  bookId?: string;
  scope?: "global" | "project" | "all";
  limit?: number;
  includeProjectDocs?: boolean;
}

// ── Chunking utilities ────────────────────────────────────────────────

interface ChunkResult {
  text: string;
  sectionTitle?: string;
  pageNumber?: number;
}

/**
 * Detect whether a line is a heading (markdown # or ALL-CAPS line).
 */
function isHeading(line: string): boolean {
  if (line.startsWith("#")) return true;
  const trimmed = line.trim();
  return trimmed.length > 3 && trimmed.length < 120 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
}

/**
 * Check if a chunk of text contains a markdown table.
 */
function isTableBlock(text: string): boolean {
  const lines = text.split("\n");
  return lines.some((l) => /\|[-:]+\|/.test(l));
}

/**
 * Split text into chunks using configurable strategies.
 */
function smartChunk(
  text: string,
  config: { strategy: string; chunkSize: number; overlap: number }
): ChunkResult[] {
  const { strategy, chunkSize, overlap } = config;
  const estimateTokens = (t: string) => Math.ceil(t.length / 4);

  if (strategy === "page") {
    // Split on form-feed characters or "--- Page N ---" markers
    const pages = text.split(/\f|---\s*Page\s+\d+\s*---/i).filter((p) => p.trim());
    return pages.map((page, i) => ({
      text: page.trim(),
      pageNumber: i + 1,
    }));
  }

  // Section-aware and recursive strategies both start by splitting on sections
  const lines = text.split("\n");
  const sections: Array<{ title: string; lines: string[] }> = [];
  let currentTitle = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (isHeading(line)) {
      if (currentLines.length > 0) {
        sections.push({ title: currentTitle, lines: currentLines });
      }
      currentTitle = line.replace(/^#+\s*/, "").trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    sections.push({ title: currentTitle, lines: currentLines });
  }

  const chunks: ChunkResult[] = [];

  for (const section of sections) {
    const sectionText = section.lines.join("\n").trim();
    if (!sectionText) continue;

    // If the section fits in one chunk, keep it
    if (estimateTokens(sectionText) <= chunkSize) {
      chunks.push({ text: sectionText, sectionTitle: section.title || undefined });
      continue;
    }

    // Check for table blocks — keep them atomic
    const paragraphs = sectionText.split(/\n\n+/);
    let buffer = "";

    for (const para of paragraphs) {
      const paraText = para.trim();
      if (!paraText) continue;

      // If this paragraph is a table, flush buffer and add table as atomic chunk
      if (isTableBlock(paraText)) {
        if (buffer.trim()) {
          chunks.push({ text: buffer.trim(), sectionTitle: section.title || undefined });
          buffer = "";
        }
        chunks.push({ text: paraText, sectionTitle: section.title || undefined });
        continue;
      }

      const combined = buffer ? `${buffer}\n\n${paraText}` : paraText;
      if (estimateTokens(combined) <= chunkSize) {
        buffer = combined;
      } else {
        // Flush buffer
        if (buffer.trim()) {
          chunks.push({ text: buffer.trim(), sectionTitle: section.title || undefined });
        }
        // If single paragraph is too large, split on sentences
        if (estimateTokens(paraText) > chunkSize) {
          const sentences = paraText.split(/(?<=[.!?])\s+/);
          let sentBuf = "";
          for (const sent of sentences) {
            const sentCombined = sentBuf ? `${sentBuf} ${sent}` : sent;
            if (estimateTokens(sentCombined) <= chunkSize) {
              sentBuf = sentCombined;
            } else {
              if (sentBuf.trim()) {
                chunks.push({ text: sentBuf.trim(), sectionTitle: section.title || undefined });
              }
              sentBuf = sent;
            }
          }
          buffer = sentBuf;
        } else {
          buffer = paraText;
        }
      }
    }
    if (buffer.trim()) {
      chunks.push({ text: buffer.trim(), sectionTitle: section.title || undefined });
    }
  }

  // Apply overlap for recursive strategy
  if (strategy === "recursive" && overlap > 0 && chunks.length > 1) {
    for (let i = 1; i < chunks.length; i++) {
      const prevText = chunks[i - 1].text;
      const overlapChars = overlap * 4; // convert tokens to approximate chars
      if (prevText.length > overlapChars) {
        const overlapText = prevText.slice(-overlapChars);
        chunks[i].text = overlapText + "\n\n" + chunks[i].text;
      }
    }
  }

  return chunks;
}

/**
 * Extract text content from a file buffer based on MIME type.
 * Uses @bidwright/ingestion pdf-parse for PDFs.
 */
async function extractText(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  azureConfig?: { endpoint?: string; key?: string },
): Promise<{ text: string; pageCount: number }> {
  // PDF: use the real pdf-parse based parser from @bidwright/ingestion
  if (mimeType === "application/pdf") {
    const parser = createPdfParser({
      provider: "hybrid",
      azureEndpoint: azureConfig?.endpoint || process.env.AZURE_DI_ENDPOINT,
      azureKey: azureConfig?.key || process.env.AZURE_DI_KEY,
    });
    const doc = await parser.parse(buffer, filename);
    const text = doc.pages.map((p) => p.content).join("\n\n--- Page Break ---\n\n");
    return { text: text || doc.content, pageCount: doc.metadata.pageCount || 1 };
  }

  // Excel/CSV: convert to text table
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "text/csv"
  ) {
    const text = buffer.toString("utf-8");
    return { text, pageCount: 1 };
  }

  // Images: store metadata, mark for vision processing
  if (mimeType.startsWith("image/")) {
    return { text: `[Image file — requires vision processing]`, pageCount: 1 };
  }

  // Default: treat as text
  const text = buffer.toString("utf-8");
  const estimatedPages = Math.max(1, Math.ceil(text.length / 3000));
  return { text, pageCount: estimatedPages };
}

// ── LLM helper ────────────────────────────────────────────────────────

/**
 * Call an LLM with a system prompt and user prompt.
 * Uses the @bidwright/agent adapter, falling back to a no-op if no API key.
 */
async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  const provider = process.env.LLM_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai");
  const model = process.env.LLM_MODEL ?? (provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o");

  if (!apiKey) {
    return "[No API key configured — LLM analysis unavailable]";
  }

  const adapter = createLLMAdapter({
    provider: provider as "anthropic" | "openai",
    apiKey,
    model,
  });

  const response = await adapter.chat({
    model,
    systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 4096,
    temperature: 0,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text ?? "";
}

// ── KnowledgeService ──────────────────────────────────────────────────

export class KnowledgeService {
  /**
   * Ingest a document into the knowledge system.
   *
   * 1. Parse the document (PDF, Excel, image, text)
   * 2. Create a KnowledgeBook record
   * 3. Chunk the content smartly
   * 4. Store chunks
   * 5. Update book status
   */
  async ingestDocument(request: IngestionRequest, store?: PrismaApiStore): Promise<IngestionResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    let text = "";
    let pageCount = 1;
    let sourceFileName = "inline-text";
    let sourceFileSize = 0;

    // Step 1: Extract text content
    // Resolve Azure DI credentials from org settings, falling back to env vars
    let azureConfig: { endpoint?: string; key?: string } | undefined;
    if (store) {
      try {
        const settings = await store.getSettings();
        const integrations = settings.integrations ?? {} as any;
        if (integrations.azureDiEndpoint || integrations.azureDiKey) {
          azureConfig = { endpoint: integrations.azureDiEndpoint, key: integrations.azureDiKey };
        }
      } catch { /* ignore — env vars will be used as fallback */ }
    }

    if (request.file) {
      sourceFileName = request.file.filename;
      sourceFileSize = request.file.buffer.length;
      try {
        const extracted = await extractText(request.file.buffer, request.file.mimeType, request.file.filename, azureConfig);
        text = extracted.text;
        pageCount = extracted.pageCount;
      } catch (err) {
        errors.push(`Text extraction failed: ${err instanceof Error ? err.message : String(err)}`);
        return {
          bookId: "",
          status: "failed",
          chunkCount: 0,
          pageCount: 0,
          embeddingsGenerated: false,
          processingTimeMs: Date.now() - startTime,
          errors,
        };
      }
    } else if (request.content) {
      text = request.content;
      sourceFileSize = Buffer.byteLength(text, "utf-8");
      sourceFileName = `${request.title}.txt`;
      pageCount = Math.max(1, Math.ceil(text.length / 3000));
    } else {
      return {
        bookId: "",
        status: "failed",
        chunkCount: 0,
        pageCount: 0,
        embeddingsGenerated: false,
        processingTimeMs: Date.now() - startTime,
        errors: ["No file or content provided"],
      };
    }

    // Step 2: Save source file to disk and create KnowledgeBook record
    let storagePath: string | null = null;
    if (request.file) {
      const tempId = `kb-${Date.now()}`;
      const relPath = relativeKnowledgeBookPath(tempId, sourceFileName);
      const absPath = resolveApiPath(relPath);
      await mkdir(path.dirname(absPath), { recursive: true });
      await writeFile(absPath, request.file.buffer);
      storagePath = relPath;
    }

    const book = await store!.createKnowledgeBook({
      name: request.title,
      description: `Ingested from ${sourceFileName}`,
      category: request.category,
      scope: request.scope,
      projectId: request.projectId ?? null,
      sourceFileName,
      sourceFileSize,
      storagePath,
    });

    // Rename storage dir to use actual book ID
    if (storagePath && request.file) {
      const correctRelPath = relativeKnowledgeBookPath(book.id, sourceFileName);
      const correctAbsPath = resolveApiPath(correctRelPath);
      const oldAbsPath = resolveApiPath(storagePath);
      if (oldAbsPath !== correctAbsPath) {
        const { rename } = await import("node:fs/promises");
        await mkdir(path.dirname(correctAbsPath), { recursive: true });
        await rename(oldAbsPath, correctAbsPath);
        // Clean up temp dir
        const { rmdir } = await import("node:fs/promises");
        await rmdir(path.dirname(oldAbsPath)).catch(() => {});
        storagePath = correctRelPath;
        await store!.updateKnowledgeBook(book.id, { metadata: { ...((book.metadata as Record<string, unknown>) ?? {}), storagePath: correctRelPath } });
        // Update via raw prisma since updateKnowledgeBook doesn't handle storagePath
        await prisma.knowledgeBook.update({ where: { id: book.id }, data: { storagePath: correctRelPath } });
      }
    }

    // Step 3: Chunk the content
    const chunkStrategy = request.options?.chunkStrategy ?? "section-aware";
    const chunkSize = request.options?.chunkSize ?? 512;
    const chunkResults = smartChunk(text, {
      strategy: chunkStrategy,
      chunkSize,
      overlap: chunkStrategy === "recursive" ? Math.floor(chunkSize * 0.1) : 0,
    });

    // Step 4: Create chunks in the store
    let chunkCount = 0;
    for (let i = 0; i < chunkResults.length; i++) {
      const cr = chunkResults[i];
      try {
        await store!.createKnowledgeChunk(book.id, {
          text: cr.text,
          sectionTitle: cr.sectionTitle ?? "",
          pageNumber: cr.pageNumber ?? null,
          tokenCount: Math.ceil(cr.text.length / 4),
          order: i,
        });
        chunkCount++;
      } catch (err) {
        errors.push(`Chunk ${i} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Update page/chunk counts immediately so they're visible even if embeddings time out
    await store!.updateKnowledgeBook(book.id, { pageCount, chunkCount, status: "processing" });

    // Step 5: Generate embeddings if an embedding provider is available
    let embeddingsGenerated = false;
    const embeddingCfg = getEmbeddingConfig();
    if (embeddingCfg && chunkCount > 0 && request.options?.enableEmbeddings !== false) {
      try {
        const embedder = createEmbedder({
          provider: embeddingCfg.provider,
          apiKey: embeddingCfg.apiKey,
          baseUrl: embeddingCfg.baseUrl,
          model: embeddingCfg.model,
          dimensions: embeddingCfg.dimensions,
        });
        const chunkTexts = chunkResults.slice(0, chunkCount).map((cr) => cr.text);
        const vectors = await embedder.embed(chunkTexts);
        const vectorStore = getVectorStore(request.organizationId ?? "default");

        const records: VectorRecord[] = vectors.map((embedding, i) => ({
          id: `vec-${book.id}-${i}`,
          chunkId: `chunk-${i}`,
          documentId: book.id,
          projectId: request.projectId ?? null,
          scope: (request.scope === "project" ? "project" : "library") as "project" | "library",
          embedding,
          text: chunkTexts[i],
          metadata: {
            bookName: request.title,
            category: request.category,
            sectionTitle: chunkResults[i].sectionTitle ?? "",
            pageNumber: chunkResults[i].pageNumber ?? 0,
          },
        }));

        await vectorStore.upsert(records);
        embeddingsGenerated = true;
      } catch (err) {
        errors.push(`Embedding generation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Step 6: Update book status
    await store!.updateKnowledgeBook(book.id, {
      status: errors.length > 0 && chunkCount === 0 ? "failed" : "indexed",
      pageCount,
      chunkCount,
    });

    return {
      bookId: book.id,
      status: errors.length > 0 && chunkCount === 0 ? "failed" : "completed",
      chunkCount,
      pageCount,
      embeddingsGenerated,
      processingTimeMs: Date.now() - startTime,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Search across knowledge sources with hybrid search.
   *
   * When an embedding API key is available and vector_records table exists,
   * uses pgvector hybrid search (vector + keyword). Otherwise falls back to
   * text-based search on knowledge chunks.
   */
  async search(query: string, options: SearchOptions = {}, store?: PrismaApiStore): Promise<SearchResult[]> {
    const limit = options.limit ?? 20;
    const results: SearchResult[] = [];

    // Try vector search first if an embedding provider is available
    const embeddingCfg = getEmbeddingConfig();
    if (embeddingCfg) {
      try {
        const embedder = createEmbedder({
          provider: embeddingCfg.provider,
          apiKey: embeddingCfg.apiKey,
          baseUrl: embeddingCfg.baseUrl,
          model: embeddingCfg.model,
          dimensions: embeddingCfg.dimensions,
        });
        const queryVector = await embedder.embedQuery(query);
        const vectorStore = getVectorStore(options?.organizationId ?? "default");
        const scopeMap: Record<string, "project" | "library" | "all"> = {
          global: "library",
          project: "project",
          all: "all",
        };
        const hits = await vectorStore.search({
          query,
          queryVector,
          projectId: options.projectId,
          scope: options.scope ? scopeMap[options.scope] ?? "all" : "all",
          limit,
          minScore: 0.2,
        });

        for (const hit of hits) {
          results.push({
            id: hit.record.id,
            text: hit.record.text,
            score: hit.score,
            source: String(hit.record.metadata.bookName ?? "unknown"),
            bookId: hit.record.documentId,
            bookName: String(hit.record.metadata.bookName ?? ""),
            sectionTitle: String(hit.record.metadata.sectionTitle ?? "") || undefined,
            pageNumber: hit.record.metadata.pageNumber ? Number(hit.record.metadata.pageNumber) : undefined,
            metadata: hit.record.metadata,
          });
        }
      } catch {
        // Vector search failed (table may not exist yet) — fall through to text search
      }
    }

    // Fall back to text-based search if no vector results
    if (results.length === 0) {
      const chunks = await store!.searchKnowledgeChunks(query, options.bookId, limit);

      const bookIds = [...new Set(chunks.map((c) => c.bookId))];
      const bookMap = new Map<string, KnowledgeBook>();
      for (const bid of bookIds) {
        const book = await store!.getKnowledgeBook(bid);
        if (book) bookMap.set(bid, book);
      }

      const filteredChunks = chunks.filter((chunk) => {
        const book = bookMap.get(chunk.bookId);
        if (!book) return false;
        if (options.scope === "global") return book.scope === "global";
        if (options.scope === "project" && options.projectId) return book.projectId === options.projectId;
        if (options.projectId) return book.scope === "global" || book.projectId === options.projectId;
        return true;
      });

      const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
      for (const chunk of filteredChunks) {
        const book = bookMap.get(chunk.bookId);
        const lowerText = chunk.text.toLowerCase();
        let score = 0;
        for (const term of queryTerms) {
          const occurrences = lowerText.split(term).length - 1;
          score += occurrences;
        }
        score = Math.min(1, score / Math.max(queryTerms.length * 3, 1));

        results.push({
          id: chunk.id,
          text: chunk.text,
          score,
          source: book?.sourceFileName ?? "unknown",
          bookId: chunk.bookId,
          bookName: book?.name,
          sectionTitle: chunk.sectionTitle || undefined,
          pageNumber: chunk.pageNumber ?? undefined,
          metadata: chunk.metadata,
        });
      }
    }

    // Also search project source documents if requested
    if (options.includeProjectDocs && options.projectId) {
      const docs = await store!.listDocuments(options.projectId);
      const lowerQuery = query.toLowerCase();
      for (const doc of docs) {
        const docText = doc.extractedText ?? "";
        if (doc.fileName.toLowerCase().includes(lowerQuery) || docText.toLowerCase().includes(lowerQuery)) {
          results.push({
            id: doc.id,
            text: docText.slice(0, 500),
            score: 0.5,
            source: doc.fileName,
            metadata: { documentType: doc.documentType, fileType: doc.fileType },
          });
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Analyze a document using AI.
   *
   * Fetches document content and sends it to an LLM with analysis instructions.
   */
  async analyzeDocument(
    documentId: string,
    projectId: string,
    analysisType: string,
    focusArea?: string,
    store?: PrismaApiStore,
  ): Promise<{ analysis: string; extractedData?: Record<string, unknown> }> {
    // Try to get the document from source documents first
    const docs = await store!.listDocuments(projectId);
    const doc = docs.find((d: any) => d.id === documentId);

    let content = "";
    let docName = "Unknown document";

    if (doc) {
      content = doc.extractedText ?? "";
      docName = doc.fileName;
    } else {
      // Try knowledge books — maybe it's a bookId
      const book = await store!.getKnowledgeBook(documentId);
      if (book) {
        docName = book.name;
        const chunks = await store!.listKnowledgeChunks(documentId);
        content = chunks.map((c) => c.text).join("\n\n");
      }
    }

    if (!content) {
      return { analysis: "No content found for the given document." };
    }

    // Truncate content if it's very large (keep first ~100k chars)
    const maxContentLength = 100_000;
    const truncatedContent = content.length > maxContentLength
      ? content.slice(0, maxContentLength) + "\n\n[Content truncated]"
      : content;

    const analysisPrompts: Record<string, string> = {
      summary: "Provide a comprehensive summary of this document, highlighting key topics, requirements, and important details.",
      scope: "Extract and describe the scope of work defined in this document. List specific deliverables, requirements, inclusions, and exclusions.",
      risks: "Identify potential risks, issues, and concerns in this document. Categorize them by severity (high/medium/low).",
      quantities: "Extract all quantities, measurements, and numerical specifications from this document. Present them in a structured format.",
      requirements: "List all technical requirements, specifications, and standards referenced in this document.",
      comparison: "Analyze this document and identify areas that may conflict with or differ from standard industry practices.",
    };

    const systemPrompt = `You are a construction estimating expert analyzing project documents for BidWright. Provide detailed, actionable analysis.${focusArea ? ` Focus particularly on: ${focusArea}` : ""}`;
    const userPrompt = `Document: "${docName}"\n\nAnalysis type: ${analysisType}\n\n${analysisPrompts[analysisType] ?? `Perform a ${analysisType} analysis.`}\n\nDocument content:\n${truncatedContent}`;

    const analysis = await callLLM(systemPrompt, userPrompt);

    return { analysis };
  }
}

export const knowledgeService = new KnowledgeService();
