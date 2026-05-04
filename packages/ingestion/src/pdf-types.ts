/**
 * Core types for the PDF parsing and document ingestion pipeline (Phase 2).
 *
 * These types are intentionally separate from the existing `types.ts` which
 * covers the ZIP-based ingestion flow. The two systems will converge once
 * the Postgres migration is complete.
 */

// ---------------------------------------------------------------------------
// PDF Parser
// ---------------------------------------------------------------------------

/** Configuration for the multi-provider PDF parser factory. */
export interface PdfParserConfig {
  provider: 'llamaparse' | 'docling' | 'local' | 'vision' | 'azure' | 'hybrid';
  apiKey?: string;
  /** Base URL for self-hosted parser endpoints. */
  baseUrl?: string;
  options?: {
    ocrEnabled?: boolean;
    tableExtractionEnabled?: boolean;
    outputFormat?: 'markdown' | 'text' | 'json';
    language?: string;
    maxPages?: number;
  };
  /**
   * Required for the "vision" provider.
   * Caller supplies a function that sends an image to a vision-capable LLM.
   */
  visionLlm?: (imageBase64: string, prompt: string) => Promise<string>;
  /** Azure Document Intelligence endpoint URL. Required for "azure" and "hybrid" providers. */
  azureEndpoint?: string;
  /** Azure Document Intelligence API key. Required for "azure" and "hybrid" providers. */
  azureKey?: string;
  /** Azure model to use. @default 'prebuilt-layout' */
  azureModel?: 'prebuilt-layout' | 'prebuilt-document' | 'prebuilt-invoice' | 'prebuilt-read';
}

/** The result of parsing a complete document. */
export interface ParsedDocument {
  title: string;
  /** Full text / markdown content. */
  content: string;
  pages: ParsedPage[];
  tables: ExtractedTable[];
  metadata: {
    pageCount: number;
    language?: string;
    author?: string;
    createdDate?: string;
    fileSize: number;
    mimeType: string;
    hasImages: boolean;
    hasOcr: boolean;
    /** Key-value pairs extracted by Azure Document Intelligence. */
    keyValuePairs?: Array<{ key: string; value: string; confidence: number }>;
    /** Normalized fields extracted by Azure's prebuilt document models. */
    documentFields?: Array<{
      documentType: string;
      fieldName: string;
      value: string;
      confidence: number;
      pageNumber?: number;
      currencyCode?: string;
    }>;
    /** Selection marks (checkboxes, radio buttons) extracted by Azure Document Intelligence. */
    selectionMarks?: Array<{ state: string; pageNumber: number; confidence: number }>;
  };
  /** Non-fatal warnings encountered during parsing. */
  warnings: string[];
}

/** A single parsed page. */
export interface ParsedPage {
  pageNumber: number;
  content: string;
  sections: PageSection[];
  images?: PageImage[];
}

/** A heading-delimited section within a page. */
export interface PageSection {
  title?: string;
  content: string;
  /** Heading level 1-6. */
  level: number;
  pageNumber: number;
}

/** An image reference extracted from a page. */
export interface PageImage {
  pageNumber: number;
  description?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  base64?: string;
}

/** A table extracted from a document. */
export interface ExtractedTable {
  pageNumber: number;
  title?: string;
  headers: string[];
  rows: string[][];
  rawMarkdown: string;
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/** Configuration for the smart chunking engine. */
export interface SmartChunkingConfig {
  strategy: 'recursive' | 'section-aware' | 'page' | 'semantic';
  /** Target chunk size in tokens. @default 512 */
  chunkSize?: number;
  /** Overlap between adjacent chunks in tokens. @default 100 */
  chunkOverlap?: number;
  /** Keep tables as atomic chunks. @default true */
  preserveTables?: boolean;
  /** Minimum chunk size in tokens. @default 50 */
  minChunkSize?: number;
  /** Maximum chunk size in tokens. @default 1024 */
  maxChunkSize?: number;
}

/** A single chunk produced by the smart chunker. */
export interface SmartDocumentChunk {
  text: string;
  metadata: {
    pageNumber?: number;
    sectionTitle?: string;
    chunkIndex: number;
    totalChunks: number;
    isTable?: boolean;
    tokenCount: number;
    source: string;
  };
}

/** A chunk that has been enriched with LLM-generated context. */
export interface ContextualChunk extends SmartDocumentChunk {
  /** Short LLM-generated summary situating this chunk in the document. */
  contextSummary: string;
  /** contextSummary + "\n\n" + text */
  enrichedText: string;
}

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------

/** Configuration for the contextual enrichment step. */
export interface EnrichmentConfig {
  /** Function that calls an LLM with the given prompt. */
  llmFunction: (prompt: string) => Promise<string>;
  /** Max number of concurrent LLM calls. @default 5 */
  concurrency?: number;
  documentTitle: string;
  documentSummary?: string;
}

// ---------------------------------------------------------------------------
// File Handlers
// ---------------------------------------------------------------------------

/** Generic file handler interface for non-PDF files. */
export interface FileHandler {
  canHandle(mimeType: string, filename: string): boolean;
  parse(input: Buffer, filename: string): Promise<ParsedDocument>;
}

/** Parser interface returned by the PDF parser factory. */
export interface PdfParser {
  parse(input: Buffer | string, filename: string): Promise<ParsedDocument>;
  parsePages(input: Buffer | string, filename: string, pageRange?: [number, number]): Promise<ParsedPage[]>;
}
