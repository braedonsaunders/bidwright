import { stat } from "node:fs/promises";
import type { CanonicalFileIngestManifest, FileIngestCapability } from "@bidwright/domain";
import { resolveApiPath } from "../../paths.js";
import { findFileIngestAdapter, listFileIngestCapabilities, unsupportedCapability } from "./registry.js";
import type { FileIngestRunResult, FileIngestSettings, FileIngestSource } from "./types.js";
import {
  makeProvenance,
  normalizeIssues,
  persistFileIngestArtifacts,
  sha256File,
  extensionOf,
} from "./utils.js";

function failedResult(args: {
  source: FileIngestSource;
  format: string;
  checksum: string;
  size: number;
  capability: FileIngestCapability;
  code: string;
  message: string;
}): FileIngestRunResult {
  const issue = {
    severity: "error",
    code: args.code,
    message: args.message,
  };
  const provenance = makeProvenance({
    source: args.source,
    format: args.format,
    checksum: args.checksum,
    size: args.size,
    capability: args.capability,
    method: "file_ingest_failed",
    confidence: 0,
  });
  return {
    status: "failed",
    family: args.capability.family,
    checksum: args.checksum,
    size: args.size,
    capability: args.capability,
    manifest: {
      schemaVersion: 1,
      runStatus: "failed",
      family: args.capability.family,
      adapter: args.capability,
      provenance,
      summary: { parser: "failed", error: args.message },
      artifacts: [],
      issues: normalizeIssues([issue]),
    },
    issues: [issue],
  };
}

async function unsupportedResult(args: {
  source: FileIngestSource;
  format: string;
  checksum: string;
  size: number;
  capability: FileIngestCapability;
}): Promise<FileIngestRunResult> {
  const issue = {
    severity: "info",
    code: "file_ingest_unsupported_format",
    message: args.capability.message ?? `No file ingest adapter is registered for .${args.format}.`,
  };
  const provenance = makeProvenance({
    source: args.source,
    format: args.format,
    checksum: args.checksum,
    size: args.size,
    capability: args.capability,
    method: "unsupported_file_shell",
    confidence: 0.1,
  });
  const manifest: CanonicalFileIngestManifest = {
    schemaVersion: 1 as const,
    runStatus: "partial" as const,
    family: "unknown" as const,
    adapter: args.capability,
    provenance,
    summary: {
      parser: "unsupported-file-shell",
      note: "File is stored and checksummed, but no normalized content adapter is registered.",
    },
    artifacts: [],
    issues: normalizeIssues([issue]),
  };
  const artifacts = await persistFileIngestArtifacts({
    projectId: args.source.projectId,
    sourceId: args.source.id,
    checksum: args.checksum,
    manifest,
  });
  return {
    status: "partial",
    family: "unknown",
    checksum: args.checksum,
    size: args.size,
    capability: args.capability,
    manifest: { ...manifest, artifacts },
    issues: [issue],
  };
}

export async function getFileIngestCapabilities(format?: string, settings?: FileIngestSettings) {
  return listFileIngestCapabilities(format, settings);
}

export async function generateFileIngestManifest(source: FileIngestSource, settings?: FileIngestSettings): Promise<FileIngestRunResult> {
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
      message: "Source file has no stored file path.",
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
      message: `Source file was not found on disk: ${source.storagePath}`,
    });
  }

  const checksum = source.checksum || await sha256File(absPath);
  const adapter = findFileIngestAdapter(format);
  if (!adapter) {
    return unsupportedResult({
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
    return {
      ...result,
      checksum,
      size: fileStat.size,
      capability,
    };
  } catch (error) {
    return failedResult({
      source,
      format,
      checksum,
      size: fileStat.size,
      capability,
      code: "file_ingest_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
