import type {
  CanonicalModelIngestManifest,
  CanonicalModelElement,
  CanonicalModelQuantity,
  ModelIngestArtifact,
  ModelIngestCapability,
} from "@bidwright/domain";

export type ModelSourceKind = "source_document" | "file_node";

export interface ModelIngestSource {
  id: string;
  source: ModelSourceKind;
  projectId: string;
  fileName: string;
  fileType?: string | null;
  storagePath?: string | null;
  checksum?: string | null;
  size?: number | null;
  metadata?: unknown;
}

export interface ModelIngestContext {
  absPath: string;
  checksum: string;
  size: number;
  format: string;
  settings?: ModelIngestSettings;
}

export interface ModelIngestSettings {
  integrations?: Record<string, unknown> | null;
}

export interface GeneratedIssue {
  severity: "info" | "warning" | "error" | string;
  code: string;
  message: string;
  elementId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface GeneratedManifest {
  status: "indexed" | "partial" | "failed";
  units: string;
  manifest: Record<string, unknown>;
  elementStats: Record<string, unknown>;
  elements: CanonicalModelElement[];
  quantities: CanonicalModelQuantity[];
  bomRows: Array<Record<string, unknown>>;
  issues: GeneratedIssue[];
}

export interface ModelAdapterIngestResult extends GeneratedManifest {
  canonicalManifest: CanonicalModelIngestManifest;
  artifacts: ModelIngestArtifact[];
}

export interface ModelIngestAdapter {
  id: string;
  version: string;
  formats: Set<string>;
  priority: number;
  capability(format?: string, settings?: ModelIngestSettings): Promise<ModelIngestCapability> | ModelIngestCapability;
  ingest(source: ModelIngestSource, context: ModelIngestContext): Promise<ModelAdapterIngestResult>;
}

export interface ModelIngestRunResult extends GeneratedManifest {
  checksum: string;
  size: number;
  capability: ModelIngestCapability;
}
