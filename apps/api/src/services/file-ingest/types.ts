import type {
  CanonicalFileIngestManifest,
  FileIngestCapability,
  FileIngestFamily,
  FileIngestRunStatus,
} from "@bidwright/domain";

export type FileIngestSourceKind = "source_document" | "file_node" | "raw_file";

export interface FileIngestSource {
  id: string;
  source: FileIngestSourceKind;
  projectId: string;
  fileName: string;
  fileType?: string | null;
  storagePath?: string | null;
  checksum?: string | null;
  size?: number | null;
  metadata?: unknown;
}

export interface FileIngestSettings {
  integrations?: Record<string, unknown> | null;
}

export interface FileIngestContext {
  absPath: string;
  checksum: string;
  size: number;
  format: string;
  settings?: FileIngestSettings;
}

export interface FileIngestIssue {
  severity: "info" | "warning" | "error" | string;
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface FileAdapterIngestResult {
  status: FileIngestRunStatus;
  family: FileIngestFamily;
  manifest: CanonicalFileIngestManifest;
  issues: FileIngestIssue[];
}

export interface FileIngestRunResult extends FileAdapterIngestResult {
  checksum: string;
  size: number;
  capability: FileIngestCapability;
}

export interface FileIngestAdapter {
  id: string;
  version: string;
  family: FileIngestFamily;
  formats: Set<string>;
  priority: number;
  capability(format?: string, settings?: FileIngestSettings): Promise<FileIngestCapability> | FileIngestCapability;
  ingest(source: FileIngestSource, context: FileIngestContext): Promise<FileAdapterIngestResult>;
}
