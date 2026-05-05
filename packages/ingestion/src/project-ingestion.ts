import type {
  ArchiveEntry,
  AzureDocumentIntelligenceModel,
  ChunkStore,
  DocumentClassifier,
  DocumentExtractionProvider,
  IngestionReport,
  PackageSourceKind,
  SourceDocument,
  SourceDocumentStructuredData,
  TextExtractor,
} from './types.js';
import type { ParsedDocument } from './pdf-types.js';

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
const LOCAL_HANDLER_EXTENSIONS = new Set([
  'xlsx', 'xls', 'csv', 'tsv',
  'docx', 'doc', 'rtf',
  'pptx',
  'html', 'htm', 'mhtml', 'mht',
]);
const AZURE_DOCUMENT_EXTENSIONS = new Set([
  'pdf',
  'png', 'jpg', 'jpeg', 'tiff', 'tif', 'bmp',
  'docx', 'xlsx', 'pptx',
  'html', 'htm',
]);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'tiff', 'tif', 'bmp', 'svg']);

type AzureExtractionConfig = {
  endpoint?: string;
  key?: string;
  model?: AzureDocumentIntelligenceModel;
};

type ExtractionResult = {
  text: string;
  pageCount: number;
  notes: string[];
  structuredData?: SourceDocumentStructuredData;
};

function tryReadAsciiText(bytes: Uint8Array): string {
  const sample = Buffer.from(bytes).toString('utf8');
  if (sample.includes('\u0000')) {
    return '';
  }
  return sample;
}

function structuredDataFromParsedDocument(doc: ParsedDocument): SourceDocumentStructuredData | undefined {
  const structuredData: SourceDocumentStructuredData = {};
  if (doc.tables.length > 0) {
    structuredData.tables = doc.tables.map((table) => ({
      pageNumber: table.pageNumber,
      headers: table.headers,
      rows: table.rows,
      rawMarkdown: table.rawMarkdown,
    }));
  }
  if (doc.metadata.keyValuePairs && doc.metadata.keyValuePairs.length > 0) {
    structuredData.keyValuePairs = doc.metadata.keyValuePairs;
  }
  if (doc.metadata.documentFields && doc.metadata.documentFields.length > 0) {
    structuredData.documentFields = doc.metadata.documentFields;
  }
  if (doc.metadata.selectionMarks && doc.metadata.selectionMarks.length > 0) {
    structuredData.selectionMarks = doc.metadata.selectionMarks;
  }

  const hasStructuredData = Boolean(
    structuredData.tables ||
    structuredData.keyValuePairs ||
    structuredData.documentFields ||
    structuredData.selectionMarks,
  );
  return hasStructuredData ? structuredData : undefined;
}

function extractionFromParsedDocument(doc: ParsedDocument, notes: string[]): ExtractionResult {
  const text = doc.pages.map((p) => p.content).filter(Boolean).join('\n\n--- Page Break ---\n\n') || doc.content;
  return {
    text,
    pageCount: doc.metadata.pageCount || doc.pages.length || 1,
    notes,
    structuredData: structuredDataFromParsedDocument(doc),
  };
}

function parsedDocumentHasContent(doc: ParsedDocument): boolean {
  return Boolean(
    doc.content.trim() ||
    doc.pages.some((page) => page.content.trim()) ||
    doc.tables.length > 0 ||
    doc.metadata.keyValuePairs?.length ||
    doc.metadata.documentFields?.length ||
    doc.metadata.selectionMarks?.length,
  );
}

/**
 * Extract text from an archive entry using the best available method.
 * Uses the same capabilities as the knowledge service:
 * - PDFs: pdf-parse library
 * - Office documents: DOCX + Excel/CSV via file handlers
 * - Images: metadata placeholder
 * - Text: direct read
 */
async function extractTextFromEntry(
  entry: ArchiveEntry,
  azureConfig?: AzureExtractionConfig,
  extractionProvider: DocumentExtractionProvider = 'azure',
): Promise<ExtractionResult> {
  const ext = entry.extension.toLowerCase();
  const notes: string[] = [];
  const hasAzureConfig = Boolean(azureConfig?.endpoint && azureConfig?.key);
  const canUseAzure = extractionProvider !== 'local' && AZURE_DOCUMENT_EXTENSIONS.has(ext);

  if (canUseAzure && hasAzureConfig) {
    try {
      const parser = createPdfParser({
        provider: 'azure',
        azureEndpoint: azureConfig?.endpoint,
        azureKey: azureConfig?.key,
        azureModel: azureConfig?.model ?? 'prebuilt-layout',
      });
      const doc = await parser.parse(Buffer.from(entry.bytes), entry.name);
      const azureNotes = [...notes, 'azure-di'];
      if (doc.warnings.length > 0) azureNotes.push(...doc.warnings.map((warning) => `azure-di-warning: ${warning}`));
      if (parsedDocumentHasContent(doc)) {
        return extractionFromParsedDocument(doc, azureNotes);
      }
      if (doc.warnings.length > 0) notes.push(...doc.warnings.map((warning) => `azure-di-warning: ${warning}`));
      notes.push('azure-di-empty');
    } catch (err) {
      notes.push(`azure-di-error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (canUseAzure && !hasAzureConfig) {
    notes.push('azure-di-unconfigured');
  }

  // PDF local fallback: direct text extraction without cloud OCR.
  if (PDF_EXTENSIONS.has(ext)) {
    try {
      const parser = createPdfParser({ provider: 'local' });
      const doc = await parser.parse(Buffer.from(entry.bytes), entry.name);
      const localNotes = [...notes, 'pdf-local'];
      if (doc.warnings.length > 0) localNotes.push(...doc.warnings.map((warning) => `pdf-local-warning: ${warning}`));
      return extractionFromParsedDocument(doc, localNotes);
    } catch (err) {
      notes.push(`pdf-local-error: ${err instanceof Error ? err.message : String(err)}`);
      return { text: '', pageCount: 1, notes };
    }
  }

  // Office, web, presentation, and spreadsheet formats: structured local extraction.
  if (LOCAL_HANDLER_EXTENSIONS.has(ext) || EXCEL_EXTENSIONS.has(ext)) {
    try {
      const result = await parseFile(Buffer.from(entry.bytes), entry.name, entry.mimeType ?? '');
      if (result) {
        notes.push(`${ext}-local`);
        if (result.warnings.length > 0) notes.push(...result.warnings.map((warning) => `${ext}-warning: ${warning}`));
        return extractionFromParsedDocument(result, notes);
      }
    } catch (err) {
      notes.push(`${ext}-error: ${err instanceof Error ? err.message : String(err)}`);
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
  azureConfig?: AzureExtractionConfig;
  /** Preferred document extraction provider. Defaults to Azure-first with local fallback. */
  documentExtractionProvider?: DocumentExtractionProvider;
  /** Optional progress sink for UI-facing package ingestion telemetry. */
  onProgress?: (event: IngestionProgressEvent) => void | Promise<void>;
}

export interface IngestionDocumentProgress {
  id: string;
  fileName: string;
  sourcePath: string;
  fileType: string;
  size: number;
  status: 'queued' | 'extracting' | 'classifying' | 'chunking' | 'complete' | 'failed';
  stage: string;
  progress: number;
  documentType?: string;
  pageCount?: number;
  extractionProvider?: string | null;
  error?: string;
  updatedAt: string;
}

export interface IngestionProgressEvent {
  stage: 'archive' | 'document' | 'chunking' | 'complete' | 'failed';
  progress: number;
  currentDocumentId?: string;
  currentDocumentName?: string;
  documents: IngestionDocumentProgress[];
  totalBytes: number;
  processedBytes: number;
  message?: string;
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
  let processedBytes = 0;
  const progressDocs: IngestionDocumentProgress[] = entries.map((entry, index) => ({
    id: `entry-${index}-${entry.path}`,
    fileName: entry.name,
    sourcePath: entry.path,
    fileType: entry.extension,
    size: entry.size,
    status: 'queued',
    stage: 'Queued',
    progress: 0,
    updatedAt: new Date().toISOString(),
  }));

  for (const entry of entries) totalBytes += entry.size;

  const emitProgress = async (
    stage: IngestionProgressEvent['stage'],
    progress: number,
    options: Partial<Omit<IngestionProgressEvent, 'stage' | 'progress' | 'documents' | 'totalBytes' | 'processedBytes'>> = {},
  ) => {
    if (!dependencies.onProgress) return;
    await dependencies.onProgress({
      stage,
      progress,
      documents: progressDocs.map((doc) => ({ ...doc })),
      totalBytes,
      processedBytes,
      ...options,
    });
  };

  await emitProgress('archive', 0.05, { message: `Discovered ${entries.length} files in ${input.packageName}` });

  for (const [index, entry] of entries.entries()) {
    const progressDoc = progressDocs[index];
    const baseProgress = entries.length === 0 ? 0.1 : 0.1 + (index / entries.length) * 0.72;
    const nextProgress = entries.length === 0 ? 0.82 : 0.1 + ((index + 1) / entries.length) * 0.72;

    progressDoc.status = 'extracting';
    progressDoc.stage = 'Extracting text';
    progressDoc.progress = 0.18;
    progressDoc.updatedAt = new Date().toISOString();
    await emitProgress('document', baseProgress, {
      currentDocumentId: progressDoc.id,
      currentDocumentName: progressDoc.fileName,
      message: `Extracting ${progressDoc.fileName}`,
    });

    let extractedText = '';
    let pageCount = 1;
    let structuredData: SourceDocumentStructuredData | undefined;
    const extractionNotes: string[] = [];

    try {
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
        const extracted = await extractTextFromEntry(
          entry,
          dependencies.azureConfig,
          dependencies.documentExtractionProvider ?? 'azure',
        );
        extractedText = extracted.text;
        pageCount = extracted.pageCount;
        structuredData = extracted.structuredData;
        extractionNotes.push(...extracted.notes);
      }

      progressDoc.status = 'classifying';
      progressDoc.stage = 'Classifying document';
      progressDoc.progress = 0.72;
      progressDoc.pageCount = pageCount;
      progressDoc.extractionProvider = extractionNotes.some((note) => note === 'azure-di' || note.startsWith('azure-di-warning'))
        ? 'azure_di'
        : extractionNotes.some((note) => note.includes('image-placeholder'))
          ? 'vision_required'
          : 'local';
      progressDoc.updatedAt = new Date().toISOString();
      await emitProgress('document', Math.min(nextProgress - 0.02, baseProgress + 0.12), {
        currentDocumentId: progressDoc.id,
        currentDocumentName: progressDoc.fileName,
        message: `Classifying ${progressDoc.fileName}`,
      });

      const trimmedText = normalizeWhitespace(extractedText);
      const kind = classifier.classify(entry, trimmedText);

      if (kind === 'unknown') {
        unknownFiles.push(entry.path);
      }

      const title = entry.name.replace(/\.[^.]+$/, '');
      const docId = createId('doc');
      documents.push({
        id: docId,
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

      processedBytes += entry.size;
      progressDoc.id = docId;
      progressDoc.status = 'complete';
      progressDoc.stage = 'Ready';
      progressDoc.progress = 1;
      progressDoc.documentType = kind;
      progressDoc.pageCount = pageCount;
      progressDoc.updatedAt = new Date().toISOString();
      await emitProgress('document', nextProgress, {
        currentDocumentId: progressDoc.id,
        currentDocumentName: progressDoc.fileName,
        message: `Finished ${progressDoc.fileName}`,
      });
    } catch (err) {
      progressDoc.status = 'failed';
      progressDoc.stage = 'Failed';
      progressDoc.progress = 1;
      progressDoc.error = err instanceof Error ? err.message : String(err);
      progressDoc.updatedAt = new Date().toISOString();
      await emitProgress('failed', nextProgress, {
        currentDocumentId: progressDoc.id,
        currentDocumentName: progressDoc.fileName,
        message: `Failed ${progressDoc.fileName}: ${progressDoc.error}`,
      });
      throw err;
    }
  }

  for (const doc of progressDocs) {
    if (doc.status !== 'complete') continue;
    doc.status = 'chunking';
    doc.stage = 'Indexing text';
    doc.progress = 0.95;
    doc.updatedAt = new Date().toISOString();
  }
  await emitProgress('chunking', 0.9, { message: 'Chunking documents for search' });

  const chunks = chunkDocuments(documents, {
    chunkSize: dependencies.chunkSize,
    chunkOverlap: dependencies.chunkOverlap,
  });

  if (dependencies.chunkStore) {
    await dependencies.chunkStore.upsert(chunks);
  }

  for (const doc of progressDocs) {
    if (doc.status === 'chunking') {
      doc.status = 'complete';
      doc.stage = 'Ready';
      doc.progress = 1;
      doc.updatedAt = new Date().toISOString();
    }
  }
  await emitProgress('complete', 0.98, { message: `Prepared ${documents.length} documents for estimating` });

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
