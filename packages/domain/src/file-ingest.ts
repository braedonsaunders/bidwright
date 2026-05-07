import type { CanonicalModelIngestManifest, ModelIngestCapabilityStatus } from "./model-ingest.js";

export type FileIngestFamily =
  | "document"
  | "model"
  | "spreadsheet"
  | "image"
  | "email"
  | "archive"
  | "text"
  | "unknown";

export type FileIngestProviderKind =
  | "embedded-open"
  | "bidwright-document"
  | "bidwright-email"
  | "bidwright-archive"
  | "bidwright-bluebeam"
  | "bidwright-model"
  | "autodesk-aps"
  | "none";

export type FileIngestCapabilityStatus = ModelIngestCapabilityStatus;

export type FileIngestRunStatus = "indexed" | "partial" | "failed";

export type FileIngestArtifactKind =
  | "manifest"
  | "document-text"
  | "document-structured-data"
  | "document-pages"
  | "email-manifest"
  | "archive-manifest"
  | "markup-summary"
  | "model-manifest"
  | "raw-output"
  | "adapter-log";

export interface FileIngestFeatureSet {
  text: boolean;
  structuredData: boolean;
  geometry: boolean;
  quantities: boolean;
  preview: boolean;
  rawArtifacts: boolean;
  requiresCloud?: boolean;
}

export interface FileIngestCapability {
  adapterId: string;
  adapterVersion: string;
  provider: FileIngestProviderKind;
  family: FileIngestFamily;
  formats: string[];
  status: FileIngestCapabilityStatus;
  features: FileIngestFeatureSet;
  message?: string;
  missingConfigKeys?: string[];
  metadata?: Record<string, unknown>;
}

export interface FileIngestSourceProvenance {
  sourceKind: "source_document" | "file_node" | "raw_file";
  sourceId: string;
  projectId: string;
  fileName: string;
  fileType?: string | null;
  format: string;
  storagePath?: string | null;
  sourceChecksum: string;
  sourceSize: number;
  adapterId: string;
  adapterVersion: string;
  provider: FileIngestProviderKind;
  generatedAt: string;
  method: string;
  confidence: number;
}

export interface FileIngestArtifact {
  id: string;
  kind: FileIngestArtifactKind;
  path: string;
  mediaType: string;
  checksum?: string;
  size?: number;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface CanonicalDocumentIngestManifest {
  title: string;
  pageCount: number;
  textLength: number;
  tableCount: number;
  sectionCount: number;
  imageCount: number;
  hasOcr: boolean;
  mimeType: string;
  extractionNotes: string[];
  textPreview?: string;
  structuredData?: {
    tables?: Array<{
      pageNumber: number;
      title?: string;
      headers: string[];
      rowCount: number;
      rawMarkdown?: string;
    }>;
    keyValuePairCount?: number;
    documentFieldCount?: number;
    selectionMarkCount?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface CanonicalEmailIngestManifest {
  subject: string;
  from?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string[];
  sentAt?: string | null;
  receivedAt?: string | null;
  messageId?: string | null;
  bodyTextLength: number;
  bodyPreview?: string;
  hasHtml: boolean;
  attachmentCount: number;
  attachments: Array<{
    fileName: string;
    mimeType?: string | null;
    size?: number | null;
    checksum?: string | null;
  }>;
}

export interface CanonicalArchiveIngestManifest {
  format: string;
  encrypted: boolean | null;
  entryCount: number;
  totalUncompressedSize: number;
  entries: Array<{
    path: string;
    fileName: string;
    extension: string;
    size: number;
    modifiedAt?: string | null;
  }>;
}

export interface CanonicalMarkupIngestManifest {
  source: "bluebeam-markups";
  rowCount: number;
  quantityCount: number;
  units: string[];
  subjects: string[];
  pages: string[];
  quantities: Array<{
    id: string;
    pageLabel?: string | null;
    subject?: string | null;
    label?: string | null;
    layer?: string | null;
    space?: string | null;
    measurementType?: string | null;
    quantity: number;
    unit?: string | null;
    comment?: string | null;
    raw: Record<string, string>;
  }>;
}

export interface CanonicalFileIngestManifest {
  schemaVersion: 1;
  runStatus: FileIngestRunStatus;
  family: FileIngestFamily;
  adapter: FileIngestCapability;
  provenance: FileIngestSourceProvenance;
  summary: Record<string, unknown>;
  artifacts: FileIngestArtifact[];
  document?: CanonicalDocumentIngestManifest;
  email?: CanonicalEmailIngestManifest;
  archive?: CanonicalArchiveIngestManifest;
  markups?: CanonicalMarkupIngestManifest;
  model?: CanonicalModelIngestManifest;
  issues: Array<{
    severity: "info" | "warning" | "error";
    code: string;
    message: string;
    metadata?: Record<string, unknown>;
  }>;
}
