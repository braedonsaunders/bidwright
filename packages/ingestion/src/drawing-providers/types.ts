/**
 * Drawing extraction provider abstraction.
 *
 * Two implementations exist (LandingAI ADE, Gemini 2.5 Pro/Flash). Both produce a
 * `ProviderResult` with the same shape so the downstream cache, atlas builder,
 * and agent tooling are provider-agnostic.
 */

export type DrawingProviderId = "landingAi" | "geminiPro" | "geminiFlash" | "none";

export type DrawingProviderStatus = "queued" | "running" | "completed" | "failed";

export type ProviderChunkType = "text" | "table" | "figure" | "logo" | "attestation" | "marginalia";

export interface ProviderBBox {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface ProviderGrounding {
  page: number;
  box: ProviderBBox;
}

export interface ProviderChunk {
  id: string;
  type: ProviderChunkType | string;
  page?: number;
  markdown: string;
  grounding?: ProviderGrounding[];
  /** Optional verbose visual narrative (Landing.ai style). */
  caption?: string;
  [key: string]: unknown;
}

export interface ProviderParseResult {
  markdown: string;
  chunks: ProviderChunk[];
  splits?: unknown[];
  grounding?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ProviderExtractionFields {
  drawing_title?: string;
  drawing_number?: string;
  revision?: string;
  sheet_number?: string;
  scale?: string;
  customer?: string;
  project?: string;
  discipline?: string;
  drawing_type?: string;
  key_quantities?: Array<{ name?: string; value?: string; unit?: string; evidence_text?: string }>;
  bom_or_parts_rows?: Array<{ item?: string; description?: string; quantity?: string; unit?: string; material?: string }>;
  schedules?: Array<{ name?: string; rows?: unknown[] }>;
  important_notes?: string[];
  open_questions?: string[];
  [key: string]: unknown;
}

export interface ProviderExtractResult {
  extraction: ProviderExtractionFields;
  extractionMetadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ProviderJobInfo {
  jobId?: string;
  status?: string;
  progress?: number | null;
  receivedAt?: number | string | null;
}

export interface ProviderResult {
  /** Provider that produced this result. */
  provider: DrawingProviderId;
  status: DrawingProviderStatus;
  /** Stable cache key incorporating sourceHash + provider config fingerprint. */
  cacheKey: string;
  parse: ProviderParseResult;
  extract: ProviderExtractResult | null;
  job?: ProviderJobInfo;
  error?: string;
  /** Provider-specific metadata (model id, endpoint, etc) used for cache invalidation/UX. */
  meta: ProviderMeta;
}

export interface ProviderMeta {
  provider: DrawingProviderId;
  model?: string;
  endpoint?: string;
  /** Raw provider-specific config snapshot — preserved on cache for debugging. */
  config?: Record<string, unknown>;
}

export interface IntegrationSettingsSnapshot {
  // Drawing extraction provider selection (new fields).
  drawingExtractionProvider?: DrawingProviderId | string;
  drawingExtractionEnabled?: boolean;

  // LandingAI configuration.
  landingAiApiKey?: string;
  landingAiEndpoint?: string;
  landingAiParseModel?: string;
  landingAiExtractModel?: string;

  // Gemini configuration.
  geminiApiKey?: string;
  geminiProModel?: string;
  geminiFlashModel?: string;
  geminiThinkingEnabled?: boolean;

  // Allow forward-compatibility / unknown fields.
  [key: string]: unknown;
}

export interface ParseProviderInput {
  pdfBytes: Uint8Array | Buffer;
  fileName: string;
  /** Stable hash of source bytes; combined with config fingerprint to form cacheKey. */
  sourceHash: string;
  /** Whether to also run schema-driven structured extraction. */
  includeExtraction?: boolean;
  /** Hard timeout for synchronous mode. Async providers may ignore. */
  pollTimeoutMs?: number;
  /** Hook for emitting progress / agent events during long-running extraction. */
  onProgress?: (event: ProviderProgressEvent) => void | Promise<void>;
  /** Abort signal. */
  signal?: AbortSignal;
}

export interface ProviderProgressEvent {
  phase: string;
  detail: string;
  jobId?: string;
}

/** Async-job providers (currently LandingAI) implement this to support background polling. */
export interface ProviderAsyncCapabilities {
  startJob(input: ParseProviderInput): Promise<{ jobId: string; cacheKey: string; running: ProviderResult }>;
  resumeJob(args: { jobId: string; sourceHash: string; fileName: string; includeExtraction?: boolean; onProgress?: ParseProviderInput["onProgress"] }): Promise<ProviderResult>;
}

export interface DrawingProvider {
  readonly id: DrawingProviderId;
  /** Whether the provider is configured (api key present, etc) given current settings. */
  isConfigured(settings: IntegrationSettingsSnapshot): boolean;
  /** Stable string from settings used as part of the cache key — change ⇒ cache invalidation. */
  configFingerprint(settings: IntegrationSettingsSnapshot): string;
  /** Current model identifier (for display / cache). */
  modelLabel(settings: IntegrationSettingsSnapshot): string;
  /** Optional config snapshot persisted on the cache record. */
  configSnapshot(settings: IntegrationSettingsSnapshot): Record<string, unknown>;
  /** Synchronous parse + (optional) extract. */
  parse(input: ParseProviderInput, settings: IntegrationSettingsSnapshot): Promise<ProviderResult>;
  /** If present, provider supports async/queued operation (used by LandingAI). */
  async?: ProviderAsyncCapabilities;
}

export interface CachedProviderRecord extends ProviderResult {
  schemaVersion: 2;
  sourceHash: string;
  cachedAt?: string;
  completedAt?: string;
  failedAt?: string;
  queuedAt?: string;
  atlasInclusion?: { allowed: boolean; reason: string } | null;
}

/** Returns true if the cache record matches the given source + provider fingerprint. */
export function cacheRecordMatches(cache: unknown, expected: { sourceHash: string; cacheKey: string }): boolean {
  if (!cache || typeof cache !== "object") return false;
  const c = cache as Record<string, unknown>;
  return c.schemaVersion === 2 && c.sourceHash === expected.sourceHash && c.cacheKey === expected.cacheKey;
}
