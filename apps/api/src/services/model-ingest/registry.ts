import type { ModelIngestCapability } from "@bidwright/domain";
import { autodeskApsAdapter } from "./adapters/autodesk-aps-adapter.js";
import { dxfAdapter } from "./adapters/dxf-adapter.js";
import { ifcAdapter } from "./adapters/ifc-adapter.js";
import { meshAdapter } from "./adapters/mesh-adapter.js";
import { occtAdapter } from "./adapters/occt-adapter.js";
import type { ModelIngestAdapter, ModelIngestSettings } from "./types.js";

export const MODEL_INGEST_FORMATS = new Set([
  "step",
  "stp",
  "iges",
  "igs",
  "brep",
  "stl",
  "obj",
  "fbx",
  "gltf",
  "glb",
  "3ds",
  "dae",
  "ifc",
  "dwg",
  "dxf",
  "rvt",
]);

const ADAPTERS: ModelIngestAdapter[] = [
  ifcAdapter,
  occtAdapter,
  dxfAdapter,
  meshAdapter,
  autodeskApsAdapter,
].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

export function listModelIngestAdapters() {
  return ADAPTERS;
}

export function findModelIngestAdapter(format: string) {
  const normalized = format.trim().toLowerCase();
  return ADAPTERS.find((adapter) => adapter.formats.has(normalized));
}

export function isModelIngestFileName(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MODEL_INGEST_FORMATS.has(ext);
}

export async function listModelIngestCapabilities(format?: string, settings?: ModelIngestSettings): Promise<ModelIngestCapability[]> {
  const normalized = format?.trim().toLowerCase();
  const adapters = normalized
    ? ADAPTERS.filter((adapter) => adapter.formats.has(normalized))
    : ADAPTERS;
  return Promise.all(adapters.map((adapter) => adapter.capability(normalized, settings)));
}

export function unsupportedCapability(format: string): ModelIngestCapability {
  return {
    adapterId: "none.unsupported",
    adapterVersion: "1.0.0",
    provider: "none",
    formats: [format],
    status: "unsupported",
    message: `No model ingest adapter is registered for .${format}.`,
    features: {
      geometry: false,
      properties: false,
      quantities: false,
      estimateLens: false,
      rawArtifacts: true,
    },
  };
}
