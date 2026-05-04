import type { ArchiveEntry, ChunkStore, DocumentClassifier, IngestionReport, PackageSourceKind, SourceDocument, SourceDocumentStructuredData, TextExtractor } from './types.js';

import { HeuristicDocumentClassifier } from './classification.js';
import { chunkDocuments } from './chunking.js';
import { createId, normalizeWhitespace } from './utils.js';
import { extractArchiveEntries } from './zip.js';
import { createPdfParser } from './pdf-parser.js';
import { parseFile } from './file-handlers.js';

// ── Unified text extraction ─────────────────────────────────────────

const PDF_EXTENSIONS = new Set(['pdf']);
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'xml', 'yml', 'yaml', 'log', 'ini', 'toml', 'conf']);
const EXCEL_EXTENSIONS = new Set(['xlsx', 'xls', 'csv', 'tsv']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'tiff', 'bmp', 'svg']);

function tryReadAsciiText(bytes: Uint8Array): string {
  const sample = Buffer.from(bytes).toString('utf8');
  if (sample.includes('\u0000')) {
    return '';
  }
  return sample;
}

/**
 * Extract text from an archive entry using the best available method.
 * Uses the same capabilities as the knowledge service:
 * - PDFs: pdf-parse library
 * - Excel/CSV: xlsx library via file handlers
 * - Images: metadata placeholder
 * - Text: direct read
 */
async function extractTextFromEntry(
  entry: ArchiveEntry,
  azureConfig?: { endpoint?: string; key?: string },
): Promise<{ text: string; pageCount: number; notes: string[]; structuredData?: SourceDocumentStructuredData }> {
  const ext = entry.extension.toLowerCase();
  const notes: string[] = [];

  // PDF: use hybrid provider (local + Azure DI fallback for scanned PDFs).
  // Azure creds come from org Settings > Integrations via azureConfig.
  if (PDF_EXTENSIONS.has(ext)) {
    try {
      const parser = createPdfParser({
        provider: 'hybrid',
        azureEndpoint: azureConfig?.endpoint,
        azureKey: azureConfig?.key,
      });
      const doc = await parser.parse(Buffer.from(entry.bytes), entry.name);
      const text = doc.pages.map((p) => p.content).join('\n\n--- Page Break ---\n\n');
      notes.push('pdf-parse');

      // Preserve structured data from parsing (tables, KV pairs, selection marks)
      const structuredData: SourceDocumentStructuredData = {};
      if (doc.tables.length > 0) {
        structuredData.tables = doc.tables.map((t) => ({
          pageNumber: t.pageNumber,
          headers: t.headers,
          rows: t.rows,
          rawMarkdown: t.rawMarkdown,
        }));
      }
      if (doc.metadata.keyValuePairs && doc.metadata.keyValuePairs.length > 0) {
        structuredData.keyValuePairs = doc.metadata.keyValuePairs;
      }
      if (doc.metadata.selectionMarks && doc.metadata.selectionMarks.length > 0) {
        structuredData.selectionMarks = doc.metadata.selectionMarks;
      }

      const hasStructured = structuredData.tables || structuredData.keyValuePairs || structuredData.selectionMarks;
      return {
        text: text || doc.content,
        pageCount: doc.metadata.pageCount || 1,
        notes,
        structuredData: hasStructured ? structuredData : undefined,
      };
    } catch (err) {
      notes.push(`pdf-parse-error: ${err instanceof Error ? err.message : String(err)}`);
      return { text: '', pageCount: 1, notes };
    }
  }

  // Excel/CSV: use file handlers
  if (EXCEL_EXTENSIONS.has(ext)) {
    try {
      const result = await parseFile(Buffer.from(entry.bytes), entry.name, entry.mimeType ?? '');
      if (result) {
        const text = result.pages.map((p) => p.content).join('\n\n');
        notes.push('excel-handler');
        return { text, pageCount: result.pages.length || 1, notes };
      }
    } catch (err) {
      notes.push(`excel-error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Images: placeholder for vision processing
  if (IMAGE_EXTENSIONS.has(ext)) {
    notes.push('image-placeholder');
    return { text: `[Image: ${entry.name} — requires vision processing for text extraction]`, pageCount: 1, notes };
  }

  // Text files: direct read
  if (TEXT_EXTENSIONS.has(ext)) {
    const text = tryReadAsciiText(entry.bytes);
    if (text) {
      notes.push('text-reader');
      return { text, pageCount: Math.max(1, Math.ceil(text.length / 3000)), notes };
    }
  }

  // Fallback: try reading as text
  const text = tryReadAsciiText(entry.bytes);
  if (text && text.length > 10) {
    notes.push('fallback-text-reader');
    return { text, pageCount: 1, notes };
  }

  notes.push('no-extractor');
  return { text: '', pageCount: 1, notes };
}

// ── Pipeline ────────────────────────────────────────────────────────

export interface IngestionPipelineDependencies {
  classifier?: DocumentClassifier;
  extractors?: TextExtractor[];
  chunkStore?: ChunkStore;
  chunkSize?: number;
  chunkOverlap?: number;
  /** Azure Document Intelligence credentials (resolved from org settings). */
  azureConfig?: { endpoint?: string; key?: string };
}

export interface CustomerPackageInput {
  packageId?: string;
  packageName: string;
  sourceKind?: PackageSourceKind;
  zipInput: string | Buffer | Uint8Array | ArrayBuffer;
}

export interface ProjectDocumentText extends SourceDocument {
  extractionNotes: string[];
}

export async function ingestCustomerPackage(
  input: CustomerPackageInput,
  dependencies: IngestionPipelineDependencies = {},
): Promise<IngestionReport> {
  const classifier = dependencies.classifier ?? new HeuristicDocumentClassifier();
  const entries = await extractArchiveEntries(input.zipInput);
  const documents: ProjectDocumentText[] = [];
  const unknownFiles: string[] = [];
  let totalBytes = 0;

  for (const entry of entries) {
    totalBytes += entry.size;

    let extractedText = '';
    let pageCount = 1;
    let structuredData: SourceDocumentStructuredData | undefined;
    const extractionNotes: string[] = [];

    // First try custom extractors (if provided)
    const textExtractor = dependencies.extractors?.find((extractor) => extractor.canHandle(entry));
    if (textExtractor) {
      const result = await textExtractor.extract(entry);
      if (result) {
        extractedText = result.text;
        extractionNotes.push(`custom-extractor:${result.confidence.toFixed(2)}`);
      }
    }

    // Fall back to unified extraction
    if (!extractedText) {
      const extracted = await extractTextFromEntry(entry, dependencies.azureConfig);
      extractedText = extracted.text;
      pageCount = extracted.pageCount;
      structuredData = extracted.structuredData;
      extractionNotes.push(...extracted.notes);
    }

    const trimmedText = normalizeWhitespace(extractedText);
    const kind = classifier.classify(entry, trimmedText);

    if (kind === 'unknown') {
      unknownFiles.push(entry.path);
    }

    const title = entry.name.replace(/\.[^.]+$/, '');
    documents.push({
      id: createId('doc'),
      sourcePath: entry.path,
      title,
      kind,
      sourceKind: input.sourceKind ?? 'project',
      text: trimmedText || `[${title}] no text extracted — may require OCR or vision processing`,
      metadata: {
        extension: entry.extension,
        size: entry.size,
        mimeType: entry.mimeType ?? '',
        pageCount,
      },
      citations: [],
      structuredData,
      extractionNotes,
    });
  }

  const chunks = chunkDocuments(documents, {
    chunkSize: dependencies.chunkSize,
    chunkOverlap: dependencies.chunkOverlap,
  });

  if (dependencies.chunkStore) {
    await dependencies.chunkStore.upsert(chunks);
  }

  return {
    packageId: input.packageId ?? createId('pkg'),
    packageName: input.packageName,
    sourceKind: input.sourceKind ?? 'project',
    totalBytes,
    documents,
    chunks,
    unknownFiles,
  };
}
