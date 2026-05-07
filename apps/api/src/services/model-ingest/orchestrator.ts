import { stat } from "node:fs/promises";
import type { ModelIngestCapability } from "@bidwright/domain";
import { resolveApiPath } from "../../paths.js";
import { findModelIngestAdapter, listModelIngestCapabilities, unsupportedCapability } from "./registry.js";
import type { GeneratedManifest, ModelIngestRunResult, ModelIngestSettings, ModelIngestSource } from "./types.js";
import {
  createId,
  extensionOf,
  makeCanonicalManifest,
  makeProvenance,
  persistIngestArtifacts,
  readTextIfReasonable,
  sha256File,
  topCounts,
} from "./utils.js";

function failedResult(args: {
  source: ModelIngestSource;
  format: string;
  checksum: string;
  size: number;
  capability: ModelIngestCapability;
  code: string;
  message: string;
}): ModelIngestRunResult {
  const provenance = makeProvenance({
    source: args.source,
    format: args.format,
    checksum: args.checksum,
    size: args.size,
    capability: args.capability,
    method: "model_ingest_failed",
    confidence: 0,
  });
  const issue = {
    severity: "error",
    code: args.code,
    message: args.message,
  };
  const canonicalManifest = makeCanonicalManifest({
    status: "failed",
    units: "",
    capability: args.capability,
    provenance,
    summary: { parser: "failed", error: args.message },
    elementStats: {},
    issues: [issue],
  });
  return {
    status: "failed",
    units: "",
    checksum: args.checksum,
    size: args.size,
    capability: args.capability,
    manifest: {
      parser: "failed",
      error: args.message,
      modelIngest: canonicalManifest,
    },
    elementStats: {},
    elements: [],
    quantities: [],
    bomRows: [],
    issues: [issue],
  };
}

function partialUnsupportedResult(args: {
  source: ModelIngestSource;
  format: string;
  checksum: string;
  size: number;
  capability: ModelIngestCapability;
}): ModelIngestRunResult {
  const provenance = makeProvenance({
    source: args.source,
    format: args.format,
    checksum: args.checksum,
    size: args.size,
    capability: args.capability,
    method: "unsupported_format_shell",
    confidence: 0.2,
  });
  const issue = {
    severity: "info",
    code: "server_extractor_not_available",
    message: args.capability.message ?? `Server-side model extraction is not implemented for .${args.format} yet.`,
  };
  const canonicalManifest = makeCanonicalManifest({
    status: "partial",
    units: "",
    capability: args.capability,
    provenance,
    summary: {
      parser: "file-manifest",
      note: "Format is stored and tracked, but no server-side quantity extraction is available.",
    },
    elementStats: {},
    issues: [issue],
  });
  return {
    status: "partial",
    units: "",
    checksum: args.checksum,
    size: args.size,
    capability: args.capability,
    manifest: {
      parser: "file-manifest",
      note: "Format is stored and tracked, but no server-side quantity extraction is available.",
      modelIngest: canonicalManifest,
    },
    elementStats: {},
    elements: [],
    quantities: [],
    bomRows: [],
    issues: [issue],
  };
}

function stepLikeFallback(text: string, args: {
  source: ModelIngestSource;
  format: string;
  checksum: string;
  size: number;
  capability: ModelIngestCapability;
  errorMessage: string;
}): ModelIngestRunResult {
  const counts = new Map<string, number>();
  const entityRe = /#\d+\s*=\s*([A-Z0-9_]+)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = entityRe.exec(text))) {
    const key = match[1].toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const summary = {
    parser: "step-like-entity-index",
    headerName: text.match(/FILE_NAME\s*\(\s*'([^']*)'/i)?.[1] ?? "",
    productNames: Array.from(text.matchAll(/PRODUCT\s*\(\s*'([^']*)'/gi)).slice(0, 25).map((m) => m[1]),
    entityTypeCount: counts.size,
    topEntities: topCounts(counts),
  };
  const issue = {
    severity: "warning",
    code: "geometry_import_degraded_to_entity_index",
    message: args.errorMessage,
  };
  const degradedCapability = {
    ...args.capability,
    status: "degraded" as const,
    message: args.errorMessage,
  };
  const provenance = makeProvenance({
    source: args.source,
    format: args.format,
    checksum: args.checksum,
    size: args.size,
    capability: degradedCapability,
    method: "step_like_entity_index",
    confidence: 0.4,
  });
  const canonicalManifest = makeCanonicalManifest({
    status: "partial",
    units: "",
    capability: degradedCapability,
    provenance,
    summary,
    elementStats: { entityTypeCount: counts.size, topEntities: topCounts(counts) },
    issues: [issue],
  });
  return {
    status: "partial",
    units: "",
    checksum: args.checksum,
    size: args.size,
    capability: degradedCapability,
    manifest: {
      ...summary,
      modelIngest: canonicalManifest,
    },
    elementStats: { entityTypeCount: counts.size, topEntities: topCounts(counts) },
    elements: [],
    quantities: [],
    bomRows: [],
    issues: [issue],
  };
}

export async function getModelIngestCapabilities(format?: string, settings?: ModelIngestSettings) {
  return listModelIngestCapabilities(format, settings);
}

export async function generateModelIngestManifest(source: ModelIngestSource, settings?: ModelIngestSettings): Promise<ModelIngestRunResult> {
  const format = extensionOf(source.fileName);
  if (!source.storagePath) {
    const capability = unsupportedCapability(format || "unknown");
    return failedResult({
      source,
      format,
      checksum: source.checksum ?? "",
      size: 0,
      capability,
      code: "missing_storage_path",
      message: "Source model has no stored file path.",
    });
  }

  const absPath = resolveApiPath(source.storagePath);
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(absPath);
  } catch {
    const capability = unsupportedCapability(format || "unknown");
    return failedResult({
      source,
      format,
      checksum: source.checksum ?? "",
      size: source.size ?? 0,
      capability,
      code: "missing_source_file",
      message: `Source model file was not found on disk: ${source.storagePath}`,
    });
  }

  const checksum = source.checksum || await sha256File(absPath);
  const adapter = findModelIngestAdapter(format);
  if (!adapter) {
    return partialUnsupportedResult({
      source,
      format,
      checksum,
      size: fileStat.size,
      capability: unsupportedCapability(format),
    });
  }

  const capability = await adapter.capability(format, settings);
  try {
    const result = await adapter.ingest(source, {
      absPath,
      checksum,
      size: fileStat.size,
      format,
      settings,
    });
    const artifacts = await persistIngestArtifacts({
      projectId: source.projectId,
      sourceId: source.id,
      checksum,
      manifest: result.canonicalManifest,
      elements: result.elements,
      quantities: result.quantities,
      bomRows: result.bomRows,
    });
    const canonicalManifest = {
      ...result.canonicalManifest,
      artifacts,
    };
    return {
      status: result.status,
      units: result.units,
      checksum,
      size: fileStat.size,
      capability,
      manifest: {
        ...result.manifest,
        ingestSchemaVersion: 1,
        adapterId: capability.adapterId,
        adapterStatus: capability.status,
        provider: capability.provider,
        artifacts,
        estimateLens: canonicalManifest.estimateLens,
        modelIngest: canonicalManifest,
      },
      elementStats: result.elementStats,
      elements: result.elements,
      quantities: result.quantities,
      bomRows: result.bomRows,
      issues: result.issues,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const textFallback = ["step", "stp", "iges", "igs", "brep"].includes(format)
      ? await readTextIfReasonable(absPath, fileStat.size)
      : null;
    if (textFallback) {
      return stepLikeFallback(textFallback, {
        source,
        format,
        checksum,
        size: fileStat.size,
        capability,
        errorMessage: message,
      });
    }
    return failedResult({
      source,
      format,
      checksum,
      size: fileStat.size,
      capability,
      code: "manifest_generation_failed",
      message,
    });
  }
}
