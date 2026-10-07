import type { PrismaApiStore } from "../prisma-store.js";
import { createLLMAdapter, type TenantAiConfig } from "@bidwright/agent";
import {
  DEFAULT_AZURE_DOCUMENT_INTELLIGENCE_FEATURES,
  createPdfParser,
  normalizeAzureDocumentIntelligenceFeatures,
  parseAzureDocumentIntelligenceQueryFields,
  parseFile,
  type AzureDocumentIntelligenceFeature,
} from "@bidwright/ingestion";
import { createEmbedder, PgVectorStore, type VectorRecord } from "@bidwright/vector";
import { prisma } from "@bidwright/db";
import type { KnowledgeBook, KnowledgeChunk, KnowledgeDocument, KnowledgeDocumentPage, SourceDocument } from "@bidwright/domain";
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

/** Resolve server-owned local embedding infrastructure (not tenant LLM credentials). */
// Cache Ollama detection to avoid repeated HTTP calls
let _ollamaDetected: boolean | null = null;
let _ollamaDetectedAt = 0;

async function detectOllama(): Promise<boolean> {
  // Cache for 60 seconds
  if (_ollamaDetected !== null && Date.now() - _ollamaDetectedAt < 60_000) return _ollamaDetected;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch("http://localhost:11434/api/tags", { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) { _ollamaDetected = false; _ollamaDetectedAt = Date.now(); return false; }
    const data = await res.json() as { models: Array<{ name: string }> };
    const hasEmbed = data.models?.some((m: any) => m.name.includes("embed") || m.name.includes("arctic"));
    _ollamaDetected = !!hasEmbed;
    _ollamaDetectedAt = Date.now();
    return _ollamaDetected;
  } catch {
    _ollamaDetected = false;
    _ollamaDetectedAt = Date.now();
    return false;
  }
}

type HostedEmbeddingProvider = "openai" | "openai-small" | "openrouter" | "cohere" | "voyage" | "gemini";

const HOSTED_EMBEDDING_PROVIDERS: Record<HostedEmbeddingProvider, { adapter: "openai" | "cohere" | "voyage" | "gemini"; envKeys: string[]; model: string; dimensions: number; baseUrl?: string; orgIntegrationKey?: string }> = {
  openai: { adapter: "openai", envKeys: ["EMBEDDING_API_KEY", "OPENAI_API_KEY"], model: "text-embedding-3-large", dimensions: 1024, orgIntegrationKey: "openaiKey" },
  "openai-small": { adapter: "openai", envKeys: ["EMBEDDING_API_KEY", "OPENAI_API_KEY"], model: "text-embedding-3-small", dimensions: 1024, orgIntegrationKey: "openaiKey" },
  // OpenRouter exposes an OpenAI-compatible /embeddings endpoint. This is the
  // option for a deployment whose only provider credential is the org's
  // OpenRouter key (the current prod shape).
  openrouter: { adapter: "openai", envKeys: ["EMBEDDING_API_KEY", "OPENROUTER_API_KEY"], model: "openai/text-embedding-3-small", dimensions: 1024, baseUrl: "https://openrouter.ai/api/v1", orgIntegrationKey: "openrouterKey" },
  cohere: { adapter: "cohere", envKeys: ["EMBEDDING_API_KEY", "COHERE_API_KEY"], model: "embed-v4", dimensions: 1024 },
  voyage: { adapter: "voyage", envKeys: ["EMBEDDING_API_KEY", "VOYAGE_API_KEY"], model: "voyage-3-large", dimensions: 1024 },
  gemini: { adapter: "gemini", envKeys: ["EMBEDDING_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"], model: "text-embedding-004", dimensions: 768, orgIntegrationKey: "geminiKey" },
};

export type ResolvedEmbeddingConfig = { provider: "openai" | "cohere" | "voyage" | "gemini" | "local"; apiKey?: string; baseUrl?: string; model?: string; dimensions?: number; source: "env" | "org_integration" | "local" };

/** Which hosted provider EMBEDDING_PROVIDER names, or null for local/disabled/unset. */
function hostedEmbeddingSelection(): { name: HostedEmbeddingProvider; spec: (typeof HOSTED_EMBEDDING_PROVIDERS)[HostedEmbeddingProvider] } | null {
  const provider = (process.env.EMBEDDING_PROVIDER ?? "").trim() as HostedEmbeddingProvider | "local" | "disabled" | "";
  if (!provider || provider === "local" || provider === "disabled") return null;
  if (!(provider in HOSTED_EMBEDDING_PROVIDERS)) return null;
  return { name: provider as HostedEmbeddingProvider, spec: HOSTED_EMBEDDING_PROVIDERS[provider as HostedEmbeddingProvider] };
}

function hostedConfigFromKey(selection: NonNullable<ReturnType<typeof hostedEmbeddingSelection>>, apiKey: string, source: "env" | "org_integration"): ResolvedEmbeddingConfig {
  return {
    provider: selection.spec.adapter,
    apiKey,
    baseUrl: process.env.EMBEDDING_BASE_URL || selection.spec.baseUrl || undefined,
    model: process.env.EMBEDDING_MODEL || selection.spec.model,
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || String(selection.spec.dimensions), 10),
    source,
  };
}

/**
 * Embedding config that may also draw the API key from the organization's
 * stored integrations (the sealed provider keys in settings). Use this from
 * code paths that have a store; the synchronous getEmbeddingConfig() only
 * sees env and is kept for callers without one.
 */
export async function resolveEmbeddingConfig(store?: { getEffectiveIntegrations: (userId: string | null | undefined) => Promise<Record<string, any>> } | null): Promise<ResolvedEmbeddingConfig | null> {
  const envConfig = getEmbeddingConfig();
  if (envConfig) return { ...envConfig, source: envConfig.provider === "local" ? "local" : "env" };
  const selection = hostedEmbeddingSelection();
  if (!selection || !selection.spec.orgIntegrationKey || !store) return null;
  try {
    const integrations = await store.getEffectiveIntegrations(null);
    const key = String(integrations?.[selection.spec.orgIntegrationKey] ?? "").trim();
    if (!key) return null;
    return hostedConfigFromKey(selection, key, "org_integration");
  } catch {
    return null;
  }
}

/**
 * Embedding configuration for hybrid search.
 *
 * Until 2026-10 only `EMBEDDING_PROVIDER=local` (TEI/Ollama) or an
 * auto-detected local Ollama ever produced a config, so in the Docker/prod
 * shape vector search was silently off and every "hybrid" query was lexical.
 * Hosted providers are now honoured from env; the dimension defaults to 1024
 * to match the `vector(1024)` column (OpenAI models accept a `dimensions`
 * request parameter; override with EMBEDDING_DIMENSIONS only if the column
 * is changed to match).
 */
export function getEmbeddingConfig(): { provider: "openai" | "cohere" | "voyage" | "gemini" | "local"; apiKey?: string; baseUrl?: string; model?: string; dimensions?: number } | null {
  const provider = (process.env.EMBEDDING_PROVIDER ?? "").trim() as HostedEmbeddingProvider | "local" | "disabled" | "";
  if (provider === "disabled") return null;

  const selection = hostedEmbeddingSelection();
  if (selection) {
    const apiKey = selection.spec.envKeys.map((key) => process.env[key]?.trim()).find(Boolean);
    if (!apiKey) {
      return null; // no env key; resolveEmbeddingConfig(store) may still find the org integration key
    }
    const { source: _source, ...config } = hostedConfigFromKey(selection, apiKey, "env");
    return config;
  }

  // Explicit local provider (TEI / Ollama)
  if (provider === "local") {
    return {
      provider: "local",
      baseUrl: process.env.EMBEDDING_BASE_URL || "http://localhost:11434/v1",
      model: process.env.EMBEDDING_MODEL || "snowflake-arctic-embed",
      dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || "1024", 10),
    };
  }

  // Auto-detect: check cached Ollama status (sync check only — async detection runs on startup)
  if (_ollamaDetected) {
    return {
      provider: "local",
      baseUrl: "http://localhost:11434/v1",
      model: "snowflake-arctic-embed",
      dimensions: 1024,
    };
  }

  return null;
}

// Kick off Ollama detection on module load
detectOllama().catch(() => {});

// ── Interfaces ────────────────────────────────────────────────────────

export interface IngestionRequest {
  file?: { buffer: Buffer; filename: string; mimeType: string };
  content?: string;
  title: string;
  category: KnowledgeBook["category"];
  scope: KnowledgeBook["scope"];
  projectId?: string;
  cabinetId?: string;
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
  sourceType?: "book" | "document_page" | "project_document";
  bookId?: string;
  bookName?: string;
  documentId?: string;
  documentTitle?: string;
  pageId?: string;
  pageTitle?: string;
  sectionTitle?: string;
  pageNumber?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  organizationId?: string;
  projectId?: string;
  bookId?: string;
  documentId?: string;
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
  azureConfig?: { endpoint?: string; key?: string; features?: AzureDocumentIntelligenceFeature[]; queryFields?: string[]; outputContentFormat?: "text" | "markdown" },
): Promise<{ text: string; pageCount: number }> {
  // PDF: use Azure DI layout model for table extraction when available,
  // otherwise fall back to local parser
  if (mimeType === "application/pdf") {
    const hasAzure = !!(azureConfig?.endpoint && azureConfig?.key);

    // For knowledge books: ALWAYS prefer Azure layout model because it
    // extracts tables as structured data. Even PDFs with embedded text
    // benefit from Azure's table detection (embedded text loses structure).
    const provider = hasAzure ? "azure" as const : "local" as const;

    const parser = createPdfParser({
      provider,
      azureEndpoint: azureConfig?.endpoint,
      azureKey: azureConfig?.key,
      azureModel: "prebuilt-layout",
      azureFeatures: azureConfig?.features,
      azureQueryFields: azureConfig?.queryFields,
      options: { tableExtractionEnabled: true, outputFormat: azureConfig?.outputContentFormat },
    });
    const doc = await parser.parse(buffer, filename);

    // Build text with table data included as markdown tables
    const parts: string[] = [];
    for (const page of doc.pages) {
      parts.push(page.content);
    }
    // Append structured table data as markdown for better searchability
    if (doc.tables && doc.tables.length > 0) {
      parts.push("\n\n--- EXTRACTED TABLES ---\n");
      for (const table of doc.tables) {
        if (table.rawMarkdown) {
          parts.push(table.rawMarkdown);
        }
      }
    }

    const text = parts.join("\n\n--- Page Break ---\n\n");

    // Store raw Azure table data for dataset extraction
    const extractedTables = (doc.tables || []).map((t: any, i: number) => ({
      index: i,
      rows: t.rows,
      columns: t.columns,
      cells: t.cells?.map((c: any) => ({
        rowIndex: c.rowIndex,
        columnIndex: c.columnIndex,
        content: c.content,
        kind: c.kind, // "columnHeader" | "rowHeader" | "content"
      })),
      pageNumber: t.boundingRegions?.[0]?.pageNumber,
      markdown: t.rawMarkdown,
    }));

    return {
      text: text || doc.content,
      pageCount: doc.metadata.pageCount || 1,
      tables: extractedTables.length > 0 ? extractedTables : undefined,
    } as any;
  }

  const extension = path.extname(filename).slice(1).toLowerCase();
  const fileHandlerExtensions = new Set(["xlsx", "xls", "csv", "tsv", "docx", "doc", "rtf", "pptx", "html", "htm", "mhtml", "mht"]);
  const fileHandlerMimes = new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "text/tab-separated-values",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/rtf",
    "text/rtf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/html",
    "multipart/related",
  ]);

  if (fileHandlerExtensions.has(extension) || fileHandlerMimes.has(mimeType)) {
    const doc = await parseFile(buffer, filename, mimeType);
    const parts = doc.pages.map((page) => page.content).filter(Boolean);
    if (doc.tables.length > 0) {
      parts.push("\n\n--- EXTRACTED TABLES ---\n");
      for (const table of doc.tables) {
        if (table.rawMarkdown) parts.push(table.rawMarkdown);
      }
    }
    const extractedTables = doc.tables.map((table, index) => ({
      index,
      rows: table.rows,
      pageNumber: table.pageNumber,
      markdown: table.rawMarkdown,
    }));

    return {
      text: parts.join("\n\n--- Page Break ---\n\n") || doc.content,
      pageCount: doc.metadata.pageCount || doc.pages.length || 1,
      tables: extractedTables.length > 0 ? extractedTables : undefined,
    } as any;
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
async function callLLM(systemPrompt: string, userPrompt: string, config: TenantAiConfig | null): Promise<string> {
  if (!config) return "[No tenant AI provider configured — LLM analysis unavailable]";
  const adapter = createLLMAdapter(config);

  const response = await adapter.chat({
    model: config.model,
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
   * Create a KnowledgeBook record quickly (file save + DB row) and return it.
   * Call `processBookBackground()` afterwards to do the heavy lifting async.
   */
  async createBookRecord(request: IngestionRequest, store: PrismaApiStore): Promise<{ bookId: string; sourceFileName: string; sourceFileSize: number }> {
    let sourceFileName = "inline-text";
    let sourceFileSize = 0;

    if (request.file) {
      sourceFileName = request.file.filename;
      sourceFileSize = request.file.buffer.length;
    } else if (request.content) {
      sourceFileSize = Buffer.byteLength(request.content, "utf-8");
      sourceFileName = `${request.title}.txt`;
    } else {
      throw new Error("No file or content provided");
    }

    // Save source file to disk
    let storagePath: string | null = null;
    if (request.file) {
      const tempId = `kb-${Date.now()}`;
      const relPath = relativeKnowledgeBookPath(tempId, sourceFileName);
      const absPath = resolveApiPath(relPath);
      await mkdir(path.dirname(absPath), { recursive: true });
      await writeFile(absPath, request.file.buffer);
      storagePath = relPath;
    }

    const book = await store.createKnowledgeBook({
      name: request.title,
      description: `Ingested from ${sourceFileName}`,
      category: request.category,
      scope: request.scope,
      projectId: request.projectId ?? null,
      cabinetId: request.cabinetId ?? null,
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
        const { rmdir } = await import("node:fs/promises");
        await rmdir(path.dirname(oldAbsPath)).catch(() => {});
        storagePath = correctRelPath;
        await store.updateKnowledgeBook(book.id, { metadata: { ...((book.metadata as Record<string, unknown>) ?? {}), storagePath: correctRelPath } });
        await prisma.knowledgeBook.update({ where: { id: book.id }, data: { storagePath: correctRelPath } });
      }
    }

    return { bookId: book.id, sourceFileName, sourceFileSize };
  }

  /**
   * Background processing: text extraction, chunking, embedding.
   * Runs fire-and-forget after the route responds.
   */
  async processBookBackground(bookId: string, request: IngestionRequest, store: PrismaApiStore): Promise<void> {
    try {
      // ── Text extraction ──
      let azureConfig: { endpoint?: string; key?: string; features?: AzureDocumentIntelligenceFeature[]; queryFields?: string[]; outputContentFormat?: "text" | "markdown" } | undefined;
      try {
        const settings = await store.getSettings();
        const integrations = settings.integrations ?? {} as any;
        if (integrations.azureDiEndpoint || integrations.azureDiKey) {
          azureConfig = {
            endpoint: integrations.azureDiEndpoint,
            key: integrations.azureDiKey,
            features: normalizeAzureDocumentIntelligenceFeatures(
              integrations.azureDiFeatures,
              DEFAULT_AZURE_DOCUMENT_INTELLIGENCE_FEATURES,
            ),
            queryFields: parseAzureDocumentIntelligenceQueryFields(integrations.azureDiQueryFields),
            outputContentFormat: integrations.azureDiOutputFormat === "markdown" ? "markdown" : "text",
          };
        }
      } catch { /* ignore — env vars will be used as fallback */ }

      let text = "";
      let pageCount = 1;
      let extractedTableData: any[] | undefined;

      if (request.file) {
        const extracted = await extractText(request.file.buffer, request.file.mimeType, request.file.filename, azureConfig);
        text = extracted.text;
        pageCount = extracted.pageCount;
        if ((extracted as any).tables?.length > 0) {
          extractedTableData = (extracted as any).tables;
        }
      } else if (request.content) {
        text = request.content;
        pageCount = Math.max(1, Math.ceil(text.length / 3000));
      }

      await store.updateKnowledgeBook(bookId, { status: "processing" });

      // ── Chunking ──
      const chunkStrategy = request.options?.chunkStrategy ?? "section-aware";
      const chunkSize = request.options?.chunkSize ?? 512;
      const chunkResults = smartChunk(text, {
        strategy: chunkStrategy,
        chunkSize,
        overlap: chunkStrategy === "recursive" ? Math.floor(chunkSize * 0.1) : 0,
      });

      let chunkCount = 0;
      const errors: string[] = [];
      for (let i = 0; i < chunkResults.length; i++) {
        const cr = chunkResults[i];
        try {
          await store.createKnowledgeChunk(bookId, {
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

      // Mark as "chunked" — text extraction and chunking complete, embeddings still pending
      await store.updateKnowledgeBook(bookId, { pageCount, chunkCount, status: "processing" });

      // ── Embeddings ──
      const embeddingCfg = await resolveEmbeddingConfig(store);
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

          // Process embeddings in batches to avoid timeouts on large books
          const EMBED_BATCH_SIZE = 100;
          const allVectors: number[][] = [];
          for (let batchStart = 0; batchStart < chunkTexts.length; batchStart += EMBED_BATCH_SIZE) {
            const batchTexts = chunkTexts.slice(batchStart, batchStart + EMBED_BATCH_SIZE);
            try {
              const batchVectors = await embedder.embed(batchTexts);
              allVectors.push(...batchVectors);
            } catch (err) {
              errors.push(`Embedding batch ${batchStart}-${batchStart + batchTexts.length} failed: ${err instanceof Error ? err.message : String(err)}`);
              // Push empty vectors so indices stay aligned
              for (let j = 0; j < batchTexts.length; j++) allVectors.push([]);
            }
          }

          const vectorStore = getVectorStore(request.organizationId ?? "default");
          const records: VectorRecord[] = allVectors
            .map((embedding, i) => ({
              id: `vec-${bookId}-${i}`,
              chunkId: `chunk-${i}`,
              documentId: bookId,
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
            }))
            .filter((r) => r.embedding.length > 0); // skip failed batches

          if (records.length > 0) {
            // Upsert vectors in batches too
            const UPSERT_BATCH_SIZE = 200;
            for (let i = 0; i < records.length; i += UPSERT_BATCH_SIZE) {
              try {
                await vectorStore.upsert(records.slice(i, i + UPSERT_BATCH_SIZE));
              } catch (err) {
                errors.push(`Vector upsert batch ${i} failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          }
        } catch (err) {
          errors.push(`Embedding generation failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // ── Finalize — ALWAYS update status even if embeddings partially failed ──
      let finalStatus: "uploading" | "processing" | "indexed" | "failed" = "indexed";
      try {
        const book = await prisma.knowledgeBook.findUnique({ where: { id: bookId } });
        const finalMetadata: Record<string, unknown> = {
          ...((book?.metadata as Record<string, unknown>) ?? {}),
        };
        if (extractedTableData && extractedTableData.length > 0) {
          finalMetadata.tableCount = extractedTableData.length;
          try {
            const tablesPath = book?.storagePath
              ? resolveApiPath(path.join(path.dirname(book.storagePath), "tables.json"))
              : resolveApiPath(path.join("knowledge", bookId, "tables.json"));
            await mkdir(path.dirname(tablesPath), { recursive: true });
            await writeFile(tablesPath, JSON.stringify(extractedTableData, null, 2));
            finalMetadata.tablesFilePath = path.relative(resolveApiPath(""), tablesPath);
          } catch { /* store inline if file write fails */ }
        }
        if (errors.length > 0) {
          finalMetadata.processingErrors = errors;
        }
        finalStatus = errors.length > 0 && chunkCount === 0 ? "failed" : "indexed";

        await store.updateKnowledgeBook(bookId, {
          status: finalStatus,
          pageCount,
          chunkCount,
          metadata: finalMetadata,
        });
      } catch (finalErr) {
        // Last-resort: at minimum set status so it doesn't stay stuck at "processing"
        console.error(`[knowledge] Failed to finalize book ${bookId}, forcing status update:`, finalErr);
        try {
          await store.updateKnowledgeBook(bookId, { status: "indexed", pageCount, chunkCount });
        } catch { /* truly can't update DB */ }
      }
    } catch (err) {
      // Ensure status is always updated on unhandled failure
      console.error(`[knowledge] Background processing failed for book ${bookId}:`, err);
      try {
        await store.updateKnowledgeBook(bookId, { status: "failed" });
      } catch { /* last resort — can't update DB */ }
    }
  }

  /**
   * Ingest a document into the knowledge system (synchronous — waits for full pipeline).
   * Used by ingest-text and other callers that need the full result.
   */
  async ingestDocument(request: IngestionRequest, store?: PrismaApiStore): Promise<IngestionResult> {
    const startTime = Date.now();

    try {
      const { bookId } = await this.createBookRecord(request, store!);
      await this.processBookBackground(bookId, request, store!);

      const book = await prisma.knowledgeBook.findUnique({ where: { id: bookId } });
      return {
        bookId,
        status: book?.status === "failed" ? "failed" : "completed",
        chunkCount: book?.chunkCount ?? 0,
        pageCount: book?.pageCount ?? 0,
        embeddingsGenerated: book?.status === "indexed",
        processingTimeMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        bookId: "",
        status: "failed",
        chunkCount: 0,
        pageCount: 0,
        embeddingsGenerated: false,
        processingTimeMs: Date.now() - startTime,
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
  }

  /**
   * Re-embed an already-chunked book from its stored chunks. Used to build or
   * repair the vector index after an embedder is configured on a deployment
   * that previously ran lexical-only (books ingested then have chunks but no
   * vectors). Idempotent: vector ids are deterministic per book/chunk.
   */
  async reembedKnowledgeBook(bookId: string, store: PrismaApiStore): Promise<{ bookId: string; chunkCount: number; embedded: number; skipped: boolean; errors: string[] }> {
    const errors: string[] = [];
    const book = await store.getKnowledgeBook(bookId);
    if (!book) throw new Error(`Knowledge book ${bookId} not found`);
    const embeddingCfg = await resolveEmbeddingConfig(store);
    if (!embeddingCfg) return { bookId, chunkCount: 0, embedded: 0, skipped: true, errors: ["No embedder configured (EMBEDDING_PROVIDER unset/disabled or no key)."] };
    const chunks = await store.listKnowledgeChunks(bookId);
    if (chunks.length === 0) return { bookId, chunkCount: 0, embedded: 0, skipped: true, errors: ["Book has no chunks to embed."] };

    const embedder = createEmbedder({
      provider: embeddingCfg.provider,
      apiKey: embeddingCfg.apiKey,
      baseUrl: embeddingCfg.baseUrl,
      model: embeddingCfg.model,
      dimensions: embeddingCfg.dimensions,
    });
    const ordered = [...chunks].sort((a, b) => a.order - b.order);
    const vectors: number[][] = [];
    const EMBED_BATCH_SIZE = 100;
    for (let start = 0; start < ordered.length; start += EMBED_BATCH_SIZE) {
      const batch = ordered.slice(start, start + EMBED_BATCH_SIZE);
      try {
        vectors.push(...(await embedder.embed(batch.map((chunk) => chunk.text))));
      } catch (err) {
        errors.push(`Embedding batch ${start}-${start + batch.length} failed: ${err instanceof Error ? err.message : String(err)}`);
        for (let i = 0; i < batch.length; i += 1) vectors.push([]);
      }
    }
    const vectorStore = getVectorStore(store.organizationId ?? "default");
    const records: VectorRecord[] = ordered
      .map((chunk, i) => ({
        id: `vec-${bookId}-${chunk.order ?? i}`,
        chunkId: chunk.id,
        documentId: bookId,
        projectId: book.projectId ?? null,
        scope: (book.scope === "project" ? "project" : "library") as "project" | "library",
        embedding: vectors[i] ?? [],
        text: chunk.text,
        metadata: {
          bookName: book.sourceFileName,
          category: book.category,
          sectionTitle: chunk.sectionTitle ?? "",
          pageNumber: chunk.pageNumber ?? 0,
        },
      }))
      .filter((record) => record.embedding.length > 0);
    const UPSERT_BATCH_SIZE = 200;
    for (let i = 0; i < records.length; i += UPSERT_BATCH_SIZE) {
      try {
        await vectorStore.upsert(records.slice(i, i + UPSERT_BATCH_SIZE));
      } catch (err) {
        errors.push(`Vector upsert batch ${i} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (records.length > 0 && errors.length === 0) {
      await store.updateKnowledgeBook(bookId, { status: "indexed" }).catch(() => {});
    }
    return { bookId, chunkCount: ordered.length, embedded: records.length, skipped: false, errors };
  }

  /** Embedder + index status without exposing any key material. */
  async embeddingStatus(store: PrismaApiStore): Promise<{ enabled: boolean; provider: string | null; model: string | null; dimensions: number | null; baseUrl: string | null; keySource: string | null; vectors: { project: number; library: number } | null; error?: string }> {
    const config = await resolveEmbeddingConfig(store);
    if (!config) {
      return { enabled: false, provider: null, model: null, dimensions: null, baseUrl: null, keySource: null, vectors: null };
    }
    try {
      const vectorStore = getVectorStore(store.organizationId ?? "default");
      const [project, library] = await Promise.all([
        vectorStore.count({ scope: "project" }),
        vectorStore.count({ scope: "library" }),
      ]);
      return { enabled: true, provider: config.provider, model: config.model ?? null, dimensions: config.dimensions ?? null, baseUrl: config.baseUrl ?? null, keySource: config.source, vectors: { project, library } };
    } catch (err) {
      return { enabled: true, provider: config.provider, model: config.model ?? null, dimensions: config.dimensions ?? null, baseUrl: config.baseUrl ?? null, keySource: config.source, vectors: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async indexKnowledgeDocument(
    documentId: string,
    store: PrismaApiStore,
    organizationId?: string,
  ): Promise<{ documentId: string; chunkCount: number; embeddingsGenerated: boolean; errors: string[] }> {
    const errors: string[] = [];
    const document = await store.getKnowledgeDocument(documentId);
    if (!document) {
      throw new Error(`Knowledge document ${documentId} not found`);
    }

    const pages = await store.listKnowledgeDocumentPages(documentId);
    if (pages.length === 0) {
      await store.replaceKnowledgeDocumentChunks(documentId, []);
      await store.updateKnowledgeDocument(documentId, { status: "draft", pageCount: 0, chunkCount: 0 });
      return { documentId, chunkCount: 0, embeddingsGenerated: false, errors };
    }

    await store.updateKnowledgeDocument(documentId, { status: "indexing", pageCount: pages.length });

    const chunkInputs: Array<{
      pageId: string;
      sectionTitle: string;
      text: string;
      tokenCount: number;
      order: number;
      metadata: Record<string, unknown>;
    }> = [];

    for (const page of pages) {
      const content = page.contentMarkdown || page.plainText || "";
      const chunks = smartChunk(content, {
        strategy: "section-aware",
        chunkSize: 512,
        overlap: 0,
      });

      if (chunks.length === 0 && content.trim()) {
        chunks.push({ text: content.trim(), sectionTitle: page.title });
      }

      for (const chunk of chunks) {
        chunkInputs.push({
          pageId: page.id,
          sectionTitle: chunk.sectionTitle ?? page.title,
          text: chunk.text,
          tokenCount: Math.ceil(chunk.text.length / 4),
          order: chunkInputs.length,
          metadata: {
            sourceType: "document_page",
            documentId: document.id,
            documentTitle: document.title,
            pageId: page.id,
            pageTitle: page.title,
            pageOrder: page.order,
            category: document.category,
            tags: document.tags,
          },
        });
      }
    }

    const savedChunks = await store.replaceKnowledgeDocumentChunks(documentId, chunkInputs);

    let embeddingsGenerated = false;
    const vectorStore = getVectorStore(organizationId ?? "default");
    try {
      await vectorStore.delete({ documentId });
    } catch (err) {
      errors.push(`Vector cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const embeddingCfg = await resolveEmbeddingConfig(store);
    if (embeddingCfg && savedChunks.length > 0) {
      try {
        const embedder = createEmbedder({
          provider: embeddingCfg.provider,
          apiKey: embeddingCfg.apiKey,
          baseUrl: embeddingCfg.baseUrl,
          model: embeddingCfg.model,
          dimensions: embeddingCfg.dimensions,
        });

        const EMBED_BATCH_SIZE = 100;
        const allVectors: number[][] = [];
        for (let start = 0; start < savedChunks.length; start += EMBED_BATCH_SIZE) {
          const batch = savedChunks.slice(start, start + EMBED_BATCH_SIZE);
          try {
            const vectors = await embedder.embed(batch.map((chunk) => chunk.text));
            allVectors.push(...vectors);
          } catch (err) {
            errors.push(`Embedding batch ${start}-${start + batch.length} failed: ${err instanceof Error ? err.message : String(err)}`);
            for (let i = 0; i < batch.length; i++) allVectors.push([]);
          }
        }

        const pageMap = new Map(pages.map((page) => [page.id, page]));
        const records: VectorRecord[] = savedChunks
          .map((chunk, index) => {
            const page = chunk.pageId ? pageMap.get(chunk.pageId) : undefined;
            return {
              id: `vec-${documentId}-${chunk.id}`,
              chunkId: chunk.id,
              documentId,
              projectId: document.projectId ?? null,
              scope: (document.scope === "project" ? "project" : "library") as "project" | "library",
              embedding: allVectors[index] ?? [],
              text: chunk.text,
              metadata: {
                sourceType: "document_page",
                documentTitle: document.title,
                documentId,
                pageTitle: page?.title ?? "",
                pageId: page?.id ?? "",
                sectionTitle: chunk.sectionTitle,
                category: document.category,
                tags: document.tags.join(", "),
              },
            };
          })
          .filter((record) => record.embedding.length > 0);

        const UPSERT_BATCH_SIZE = 200;
        for (let start = 0; start < records.length; start += UPSERT_BATCH_SIZE) {
          await vectorStore.upsert(records.slice(start, start + UPSERT_BATCH_SIZE));
        }
        embeddingsGenerated = records.length > 0;
      } catch (err) {
        errors.push(`Embedding generation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await store.updateKnowledgeDocument(documentId, {
      status: errors.length > 0 && savedChunks.length === 0 ? "failed" : "indexed",
      pageCount: pages.length,
      chunkCount: savedChunks.length,
      metadata: {
        lastIndexedAt: new Date().toISOString(),
        embeddingsGenerated,
        indexingErrors: errors,
      },
    });

    return { documentId, chunkCount: savedChunks.length, embeddingsGenerated, errors };
  }

  async deleteKnowledgeDocumentIndex(documentId: string, organizationId?: string): Promise<number> {
    const vectorStore = getVectorStore(organizationId ?? "default");
    return vectorStore.delete({ documentId });
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
    const fetchLimit = limit * 2; // Fetch more for merging

    // ── Parallel: vector search + keyword search ──
    // Hybrid Reciprocal Rank Fusion (RRF) proven optimal in autoresearch at 75% accuracy
    // Any keyword weight 30-82% performs equally; we use 60/40 keyword/vector
    const KEYWORD_WEIGHT = 0.6;
    const VECTOR_WEIGHT = 0.4;

    const vectorResults: SearchResult[] = [];
    const keywordResults: SearchResult[] = [];

    // Vector search (async, non-blocking)
    const embeddingCfg = await resolveEmbeddingConfig(store);
    const vectorPromise = embeddingCfg ? (async () => {
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
          limit: fetchLimit,
          minScore: 0.15,
        });

        for (const hit of hits) {
          const metadata = hit.record.metadata;
          const sourceType = String(metadata.sourceType ?? "book");
          if (sourceType === "document_page") {
            vectorResults.push({
              id: hit.record.chunkId || hit.record.id,
              text: hit.record.text,
              score: hit.score,
              source: String(metadata.documentTitle ?? "Knowledge Page"),
              sourceType: "document_page",
              documentId: String(metadata.documentId ?? hit.record.documentId),
              documentTitle: String(metadata.documentTitle ?? ""),
              pageId: metadata.pageId ? String(metadata.pageId) : undefined,
              pageTitle: String(metadata.pageTitle ?? ""),
              sectionTitle: String(metadata.sectionTitle ?? "") || undefined,
              metadata,
            });
          } else {
            vectorResults.push({
              id: hit.record.id,
              text: hit.record.text,
              score: hit.score,
              source: String(metadata.bookName ?? "unknown"),
              sourceType: "book",
              bookId: hit.record.documentId,
              bookName: String(metadata.bookName ?? ""),
              sectionTitle: String(metadata.sectionTitle ?? "") || undefined,
              pageNumber: metadata.pageNumber ? Number(metadata.pageNumber) : undefined,
              metadata,
            });
          }
        }
      } catch {
        // Vector search failed — keyword results will carry the load
      }
    })() : Promise.resolve();

    // Keyword search (always runs in parallel with vector)
    const keywordPromise = (async () => {
      const [chunks, documentChunks] = await Promise.all([
        options.documentId ? Promise.resolve([]) : store!.searchKnowledgeChunks(query, options.bookId, fetchLimit),
        options.bookId ? Promise.resolve([]) : store!.searchKnowledgeDocumentChunks(query, options.documentId, fetchLimit),
      ]);

      const bookIds = [...new Set(chunks.map((chunk) => chunk.bookId))];
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
        const match = (chunk.metadata as Record<string, any> | undefined)?.searchMatch;
        let score = typeof match?.coverage === "number"
          ? Math.min(1, Math.max(0, match.coverage))
          : 0;
        if (score === 0) {
          const lowerText = chunk.text.toLowerCase();
          for (const term of queryTerms) {
            const occurrences = lowerText.split(term).length - 1;
            score += occurrences;
          }
          score = Math.min(1, score / Math.max(queryTerms.length * 3, 1));
        }
        if (typeof match?.score === "number") score += Math.min(0.25, match.score / 100);

        keywordResults.push({
          id: chunk.id,
          text: chunk.text,
          score,
          source: book?.sourceFileName ?? "unknown",
          sourceType: "book",
          bookId: chunk.bookId,
          bookName: book?.name,
          sectionTitle: chunk.sectionTitle || undefined,
          pageNumber: chunk.pageNumber ?? undefined,
          metadata: chunk.metadata,
        });
      }

      const documentIds = [...new Set(documentChunks.map((chunk) => chunk.documentId))];
      const documentMap = new Map<string, KnowledgeDocument>();
      const pageMap = new Map<string, KnowledgeDocumentPage>();
      for (const did of documentIds) {
        const document = await store!.getKnowledgeDocument(did);
        if (document) {
          documentMap.set(did, document);
          const pages = await store!.listKnowledgeDocumentPages(did);
          for (const page of pages) pageMap.set(page.id, page);
        }
      }

      const filteredDocumentChunks = documentChunks.filter((chunk) => {
        const document = documentMap.get(chunk.documentId);
        if (!document) return false;
        if (options.scope === "global") return document.scope === "global";
        if (options.scope === "project" && options.projectId) return document.projectId === options.projectId;
        if (options.projectId) return document.scope === "global" || document.projectId === options.projectId;
        return true;
      });

      for (const chunk of filteredDocumentChunks) {
        const document = documentMap.get(chunk.documentId);
        const page = chunk.pageId ? pageMap.get(chunk.pageId) : undefined;
        const match = (chunk.metadata as Record<string, any> | undefined)?.searchMatch;
        let score = typeof match?.coverage === "number"
          ? Math.min(1, Math.max(0, match.coverage))
          : 0;
        if (score === 0) {
          const lowerText = chunk.text.toLowerCase();
          for (const term of queryTerms) {
            const occurrences = lowerText.split(term).length - 1;
            score += occurrences;
          }
          score = Math.min(1, score / Math.max(queryTerms.length * 3, 1));
        }
        if (typeof match?.score === "number") score += Math.min(0.25, match.score / 100);

        keywordResults.push({
          id: chunk.id,
          text: chunk.text,
          score,
          source: document?.title ?? "Knowledge Page",
          sourceType: "document_page",
          documentId: chunk.documentId,
          documentTitle: document?.title,
          pageId: chunk.pageId ?? undefined,
          pageTitle: page?.title,
          sectionTitle: chunk.sectionTitle || undefined,
          metadata: chunk.metadata,
        });
      }
    })();

    // Wait for both search paths to complete
    await Promise.all([vectorPromise, keywordPromise]);

    // ── Hybrid Reciprocal Rank Fusion (RRF) ──
    // Merge keyword + vector results using rank-based scoring
    const merged = new Map<string, SearchResult & { hybridScore: number }>();

    // Score keyword results by reciprocal rank
    keywordResults.forEach((r, i) => {
      const key = r.id;
      const rankScore = 1 / (i + 1);
      merged.set(key, { ...r, hybridScore: rankScore * KEYWORD_WEIGHT });
    });

    // Merge vector results — boost if already found by keyword
    vectorResults.forEach((r, i) => {
      const key = r.id;
      const rankScore = 1 / (i + 1);
      const existing = merged.get(key);
      if (existing) {
        existing.hybridScore += rankScore * VECTOR_WEIGHT;
      } else {
        merged.set(key, { ...r, hybridScore: rankScore * VECTOR_WEIGHT });
      }
    });

    // Sort by hybrid score and take top N
    const results: SearchResult[] = [...merged.values()]
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, limit)
      .map(({ hybridScore, ...rest }) => ({ ...rest, score: hybridScore }));

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
            sourceType: "project_document",
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
    aiConfig: TenantAiConfig | null = null,
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

    const analysis = await callLLM(systemPrompt, userPrompt, aiConfig);

    return { analysis };
  }
}

export const knowledgeService = new KnowledgeService();
