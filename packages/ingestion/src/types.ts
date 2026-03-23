export type DocumentKind =
  | 'spec'
  | 'rfq'
  | 'drawing'
  | 'addendum'
  | 'schedule'
  | 'estimate_book'
  | 'email'
  | 'unknown';

export type PackageSourceKind = 'project' | 'library';

export interface ArchiveEntry {
  path: string;
  name: string;
  extension: string;
  size: number;
  bytes: Uint8Array;
  mimeType?: string;
}

export interface DocumentCitation {
  documentId: string;
  sourcePath: string;
  page?: number;
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  excerpt?: string;
}

export interface SourceDocumentStructuredData {
  tables?: Array<{
    pageNumber: number;
    headers: string[];
    rows: string[][];
    rawMarkdown: string;
  }>;
  keyValuePairs?: Array<{ key: string; value: string; confidence: number }>;
  selectionMarks?: Array<{ state: string; pageNumber: number; confidence: number }>;
}

export interface SourceDocument {
  id: string;
  sourcePath: string;
  title: string;
  kind: DocumentKind;
  sourceKind: PackageSourceKind;
  text: string;
  metadata: Record<string, string | number | boolean>;
  citations: DocumentCitation[];
  structuredData?: SourceDocumentStructuredData;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  sourcePath: string;
  text: string;
  order: number;
  startOffset: number;
  endOffset: number;
  tokensEstimate: number;
  metadata: Record<string, string | number | boolean>;
  citations: DocumentCitation[];
}

export interface ChunkingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface RetrievalQuery {
  query: string;
  projectId?: string;
  sourceKind?: PackageSourceKind;
  kinds?: DocumentKind[];
  limit?: number;
}

export interface RetrievalHit extends DocumentChunk {
  score: number;
}

export interface IngestionReport {
  packageId: string;
  packageName: string;
  sourceKind: PackageSourceKind;
  totalBytes: number;
  documents: SourceDocument[];
  chunks: DocumentChunk[];
  unknownFiles: string[];
}

export interface ExtractedText {
  text: string;
  confidence: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface TextExtractor {
  canHandle(entry: ArchiveEntry): boolean;
  extract(entry: ArchiveEntry): Promise<ExtractedText | null>;
}

export interface DocumentClassifier {
  classify(entry: ArchiveEntry, extractedText?: string): DocumentKind;
}

export interface ChunkStore {
  upsert(chunks: DocumentChunk[]): Promise<void> | void;
  query(query: RetrievalQuery): Promise<RetrievalHit[]> | RetrievalHit[];
  clear?(): Promise<void> | void;
}
