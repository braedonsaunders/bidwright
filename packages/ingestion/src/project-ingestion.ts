import type { ArchiveEntry, ChunkStore, DocumentClassifier, IngestionReport, PackageSourceKind, SourceDocument, TextExtractor } from './types.js';

import { classifyDocument, HeuristicDocumentClassifier } from './classification.js';
import { chunkDocuments } from './chunking.js';
import { createId, normalizeWhitespace } from './utils.js';
import { extractArchiveEntries } from './zip.js';

function tryReadAsciiText(bytes: Uint8Array): string {
  const sample = Buffer.from(bytes).toString('utf8');
  if (sample.includes('\u0000')) {
    return '';
  }

  return sample;
}

function defaultTextExtractor(entry: ArchiveEntry): string {
  if (['txt', 'md', 'csv', 'json', 'xml', 'yml', 'yaml'].includes(entry.extension)) {
    return tryReadAsciiText(entry.bytes);
  }

  return '';
}

export interface IngestionPipelineDependencies {
  classifier?: DocumentClassifier;
  extractors?: TextExtractor[];
  chunkStore?: ChunkStore;
  chunkSize?: number;
  chunkOverlap?: number;
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
    const extractionNotes: string[] = [];
    const textExtractor = dependencies.extractors?.find((extractor) => extractor.canHandle(entry));

    if (textExtractor) {
      const result = await textExtractor.extract(entry);
      if (result) {
        extractedText = result.text;
        extractionNotes.push(`custom-extractor:${result.confidence.toFixed(2)}`);
      }
    } else {
      extractedText = defaultTextExtractor(entry);
      if (extractedText) {
        extractionNotes.push('default-text-extractor');
      }
    }

    const trimmedText = normalizeWhitespace(extractedText);
    const kind = classifyDocument(entry, trimmedText);

    if (kind === 'unknown') {
      unknownFiles.push(entry.path);
    }

    const title = entry.name.replace(/\.[^.]+$/, '');
    documents.push({
      id: createId('doc'),
      sourcePath: entry.path,
      title,
      kind: classifier.classify(entry, trimmedText),
      sourceKind: input.sourceKind ?? 'project',
      text: trimmedText || `[${title}] awaiting a richer extractor`,
      metadata: {
        extension: entry.extension,
        size: entry.size,
        mimeType: entry.mimeType ?? '',
      },
      citations: [],
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
