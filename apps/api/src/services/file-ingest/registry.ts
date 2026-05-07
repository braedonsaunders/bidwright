import type { FileIngestCapability } from "@bidwright/domain";
import { archiveFileAdapter } from "./adapters/archive-adapter.js";
import { documentFileAdapter } from "./adapters/document-adapter.js";
import { emailFileAdapter } from "./adapters/email-adapter.js";
import { modelFileAdapter } from "./adapters/model-adapter.js";
import type { FileIngestAdapter, FileIngestSettings } from "./types.js";

const ADAPTERS: FileIngestAdapter[] = [
  modelFileAdapter,
  emailFileAdapter,
  archiveFileAdapter,
  documentFileAdapter,
].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

export function listFileIngestAdapters() {
  return ADAPTERS;
}

export function findFileIngestAdapter(format: string) {
  const normalized = format.trim().toLowerCase();
  return ADAPTERS.find((adapter) => adapter.formats.has(normalized));
}

export function isFileIngestFileName(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return Boolean(findFileIngestAdapter(ext));
}

export async function listFileIngestCapabilities(format?: string, settings?: FileIngestSettings): Promise<FileIngestCapability[]> {
  const normalized = format?.trim().toLowerCase();
  const adapters = normalized
    ? ADAPTERS.filter((adapter) => adapter.formats.has(normalized))
    : ADAPTERS;
  return Promise.all(adapters.map((adapter) => adapter.capability(normalized, settings)));
}

export function unsupportedCapability(format: string): FileIngestCapability {
  return {
    adapterId: "none.unsupported",
    adapterVersion: "1.0.0",
    provider: "none",
    family: "unknown",
    formats: [format],
    status: "unsupported",
    message: `No file ingest adapter is registered for .${format}.`,
    features: {
      text: false,
      structuredData: false,
      geometry: false,
      quantities: false,
      preview: false,
      rawArtifacts: true,
    },
  };
}
