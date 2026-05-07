export type ModelIngestProviderKind = "embedded-open" | "autodesk-aps" | "none";

export type ModelIngestCapabilityStatus =
  | "available"
  | "missing"
  | "unsupported"
  | "degraded"
  | "failed";

export type ModelIngestRunStatus =
  | "indexed"
  | "partial"
  | "failed";

export type ModelIngestArtifactKind =
  | "manifest"
  | "raw-elements"
  | "raw-quantities"
  | "raw-bom"
  | "geometry-manifest"
  | "adapter-log";

export interface ModelIngestFeatureSet {
  geometry: boolean;
  properties: boolean;
  quantities: boolean;
  estimateLens: boolean;
  rawArtifacts: boolean;
  requiresCloud?: boolean;
}

export interface ModelIngestCapability {
  adapterId: string;
  adapterVersion: string;
  provider: ModelIngestProviderKind;
  formats: string[];
  status: ModelIngestCapabilityStatus;
  features: ModelIngestFeatureSet;
  message?: string;
  missingConfigKeys?: string[];
  metadata?: Record<string, unknown>;
}

export interface ModelIngestSourceProvenance {
  sourceKind: "source_document" | "file_node";
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
  provider: ModelIngestProviderKind;
  generatedAt: string;
  method: string;
  confidence: number;
}

export interface ModelIngestArtifact {
  id: string;
  kind: ModelIngestArtifactKind;
  path: string;
  mediaType: string;
  checksum?: string;
  size?: number;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ModelGeometryArtifact {
  id: string;
  format: "native" | "dae" | "glb" | "gltf" | "obj" | "stl" | "mesh-json";
  path?: string;
  checksum?: string;
  meshRefs: string[];
  bbox?: unknown;
  units?: string;
  metadata?: Record<string, unknown>;
}

export interface CanonicalModelElement {
  id: string;
  externalId: string;
  name: string;
  elementClass: string;
  elementType?: string;
  system?: string;
  level?: string;
  material?: string;
  bbox?: unknown;
  geometryRef?: string;
  estimateRelevant?: boolean;
  properties?: Record<string, unknown>;
}

export interface CanonicalModelQuantity {
  id: string;
  elementId?: string | null;
  quantityType: string;
  value: number;
  unit: string;
  method: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface EstimateLensGroup {
  id: string;
  groupKey: string;
  label: string;
  elementClass: string;
  elementType?: string;
  system?: string;
  level?: string;
  material?: string;
  elementIds: string[];
  quantityIds: string[];
  quantities: Array<{
    quantityType: string;
    value: number;
    unit: string;
    confidence: number;
  }>;
  confidence: number;
  source: "native-schedule" | "native-quantity" | "geometry-derived" | "entity-index" | "adapter-fallback";
  metadata?: Record<string, unknown>;
}

export interface CanonicalModelIngestManifest {
  schemaVersion: 1;
  runStatus: ModelIngestRunStatus;
  adapter: ModelIngestCapability;
  provenance: ModelIngestSourceProvenance;
  units: string;
  summary: Record<string, unknown>;
  elementStats: Record<string, unknown>;
  artifacts: ModelIngestArtifact[];
  geometryArtifacts: ModelGeometryArtifact[];
  estimateLens: EstimateLensGroup[];
  issues: Array<{
    severity: "info" | "warning" | "error";
    code: string;
    message: string;
    elementId?: string | null;
    metadata?: Record<string, unknown>;
  }>;
}
