import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { CanonicalArchiveIngestManifest, CanonicalFileIngestManifest, FileIngestCapability } from "@bidwright/domain";
import type { FileAdapterIngestResult, FileIngestAdapter, FileIngestContext, FileIngestSource } from "../types.js";
import {
  makeProvenance,
  normalizeIssues,
  persistFileIngestArtifacts,
} from "../utils.js";

const ADAPTER_ID = "bidwright-archive.manifest";
const ADAPTER_VERSION = "1.0.0";
const FORMATS = new Set(["zip", "7z", "rar", "tar", "gz", "tgz"]);

interface LibarchiveFileEntry {
  path?: string;
  file?: {
    name?: string;
    size?: number;
    lastModified?: number;
  };
}

function extensionOf(value: string) {
  return value.split(".").pop()?.toLowerCase() ?? "";
}

function normalizeArchivePath(entry: LibarchiveFileEntry) {
  const directory = entry.path ?? "";
  const name = entry.file?.name ?? "file";
  return `${directory}${name}`.replace(/^\/+/, "");
}

function modifiedAt(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const millis = value > 1_000_000_000_000 ? value : value * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function capability(format?: string): FileIngestCapability {
  const normalized = (format ?? "").toLowerCase();
  return {
    adapterId: ADAPTER_ID,
    adapterVersion: ADAPTER_VERSION,
    provider: "bidwright-archive",
    family: "archive",
    formats: Array.from(FORMATS),
    status: FORMATS.has(normalized) || !normalized ? "available" : "unsupported",
    message: "Archive manifest parsing is embedded server-side through libarchive WASM.",
    features: {
      text: false,
      structuredData: true,
      geometry: false,
      quantities: false,
      preview: true,
      rawArtifacts: true,
      requiresCloud: false,
    },
    metadata: {
      localHandlers: ["libarchive.js"],
    },
  };
}

function gzipManifest(buffer: Buffer, format: string, sourceFileName: string): CanonicalArchiveIngestManifest {
  const decompressed = gunzipSync(buffer);
  const baseName = path.posix.basename(sourceFileName).replace(/\.gz$/i, "") || "compressed-data";
  return {
    format,
    encrypted: false,
    entryCount: 1,
    totalUncompressedSize: decompressed.byteLength,
    entries: [{
      path: baseName,
      fileName: baseName,
      extension: extensionOf(baseName),
      size: decompressed.byteLength,
      modifiedAt: null,
    }],
  };
}

async function listArchiveEntries(buffer: Buffer, format: string, sourceFileName: string): Promise<CanonicalArchiveIngestManifest> {
  const { Archive } = await import("libarchive.js/dist/libarchive-node.mjs");
  try {
    const archive = await Archive.open(new Blob([toArrayBuffer(buffer)]));
    try {
    const encrypted = await archive.hasEncryptedData();
    const files = await archive.getFilesArray() as LibarchiveFileEntry[];
    const entries = files
      .map((entry) => {
        const fullPath = normalizeArchivePath(entry);
        const fileName = path.posix.basename(fullPath);
        const size = Number(entry.file?.size ?? 0);
        return {
          path: fullPath,
          fileName,
          extension: extensionOf(fileName),
          size: Number.isFinite(size) ? size : 0,
          modifiedAt: modifiedAt(entry.file?.lastModified),
        };
      })
      .filter((entry) => entry.path && !entry.path.endsWith("/"))
      .sort((a, b) => a.path.localeCompare(b.path));

    return {
      format,
      encrypted,
      entryCount: entries.length,
      totalUncompressedSize: entries.reduce((sum, entry) => sum + entry.size, 0),
      entries,
    };
    } finally {
      await archive.close().catch(() => undefined);
    }
  } catch (error) {
    if (format === "gz") return gzipManifest(buffer, format, sourceFileName);
    throw error;
  }
}

export const archiveFileAdapter: FileIngestAdapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,
  family: "archive",
  formats: FORMATS,
  priority: 75,
  capability,
  async ingest(source: FileIngestSource, context: FileIngestContext): Promise<FileAdapterIngestResult> {
    const activeCapability = capability(context.format);
    const buffer = await readFile(context.absPath);
    const archive = await listArchiveEntries(buffer, context.format, source.fileName);
    const provenance = makeProvenance({
      source,
      format: context.format,
      checksum: context.checksum,
      size: context.size,
      capability: activeCapability,
      method: "embedded_archive_manifest_parser",
      confidence: archive.entryCount > 0 ? 0.9 : 0.45,
    });
    const issues = archive.entryCount > 0 ? [] : [{
      severity: "warning",
      code: "archive_no_entries",
      message: "The archive was readable but no file entries were found.",
    }];
    const manifest: CanonicalFileIngestManifest = {
      schemaVersion: 1,
      runStatus: archive.entryCount > 0 ? "indexed" : "partial",
      family: "archive",
      adapter: activeCapability,
      provenance,
      summary: {
        parser: "archive-file-adapter",
        format: archive.format,
        entryCount: archive.entryCount,
        totalUncompressedSize: archive.totalUncompressedSize,
        encrypted: archive.encrypted,
      },
      artifacts: [],
      archive,
      issues: normalizeIssues(issues),
    };
    const artifacts = await persistFileIngestArtifacts({
      projectId: source.projectId,
      sourceId: source.id,
      checksum: context.checksum,
      manifest,
      extraArtifacts: [{
        kind: "archive-manifest",
        fileName: "archive.json",
        payload: archive,
        description: "Parsed archive manifest",
      }],
    });
    const finalManifest = { ...manifest, artifacts };
    return {
      status: finalManifest.runStatus,
      family: "archive",
      manifest: finalManifest,
      issues,
    };
  },
};
