import type { CanonicalFileIngestManifest, CanonicalModelIngestManifest, FileIngestCapability, ModelIngestCapability } from "@bidwright/domain";
import { generateModelIngestManifest, getModelIngestCapabilities } from "../../model-ingest/orchestrator.js";
import { MODEL_INGEST_FORMATS } from "../../model-ingest/registry.js";
import type { ModelIngestSource } from "../../model-ingest/types.js";
import type { FileAdapterIngestResult, FileIngestAdapter, FileIngestContext, FileIngestSettings, FileIngestSource } from "../types.js";
import {
  makeProvenance,
  normalizeIssues,
  persistFileIngestArtifacts,
} from "../utils.js";

const ADAPTER_ID = "bidwright-model.wrapper";
const ADAPTER_VERSION = "1.0.0";

function modelSourceFromFileSource(source: FileIngestSource): ModelIngestSource {
  return {
    ...source,
    source: source.source === "source_document" ? "source_document" : "file_node",
  };
}

function aggregateStatus(children: ModelIngestCapability[]): FileIngestCapability["status"] {
  if (children.length === 0) return "unsupported";
  if (children.every((child) => child.status === "failed")) return "failed";
  if (children.every((child) => child.status === "unsupported")) return "unsupported";
  if (children.some((child) => child.status === "missing" || child.status === "degraded" || child.status === "failed")) return "degraded";
  return "available";
}

function mapCapability(child: ModelIngestCapability | undefined, format?: string): FileIngestCapability {
  if (!child) {
    return {
      adapterId: ADAPTER_ID,
      adapterVersion: ADAPTER_VERSION,
      provider: "none",
      family: "model",
      formats: format ? [format] : Array.from(MODEL_INGEST_FORMATS),
      status: "unsupported",
      message: format ? `No model adapter is registered for .${format}.` : "No model adapter is registered.",
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

  return {
    adapterId: ADAPTER_ID,
    adapterVersion: ADAPTER_VERSION,
    provider: child.provider === "autodesk-aps" ? "autodesk-aps" : child.provider === "none" ? "none" : "bidwright-model",
    family: "model",
    formats: child.formats,
    status: child.status,
    message: child.message,
    missingConfigKeys: child.missingConfigKeys,
    features: {
      text: false,
      structuredData: child.features.properties,
      geometry: child.features.geometry,
      quantities: child.features.quantities,
      preview: child.features.geometry,
      rawArtifacts: child.features.rawArtifacts,
      requiresCloud: child.features.requiresCloud,
    },
    metadata: {
      childAdapterId: child.adapterId,
      childAdapterVersion: child.adapterVersion,
      childProvider: child.provider,
      childMetadata: child.metadata ?? {},
    },
  };
}

function mapAggregateCapability(children: ModelIngestCapability[]): FileIngestCapability {
  const statuses = children.reduce<Record<string, number>>((acc, child) => {
    acc[child.status] = (acc[child.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    adapterId: ADAPTER_ID,
    adapterVersion: ADAPTER_VERSION,
    provider: "bidwright-model",
    family: "model",
    formats: Array.from(MODEL_INGEST_FORMATS),
    status: aggregateStatus(children),
    message: "Model files are delegated to the CAD/BIM/model ingest substrate. Format-specific capability states are included in metadata.",
    missingConfigKeys: Array.from(new Set(children.flatMap((child) => child.missingConfigKeys ?? []))),
    features: {
      text: false,
      structuredData: children.some((child) => child.features.properties),
      geometry: children.some((child) => child.features.geometry),
      quantities: children.some((child) => child.features.quantities),
      preview: children.some((child) => child.features.geometry),
      rawArtifacts: true,
      requiresCloud: children.some((child) => child.features.requiresCloud),
    },
    metadata: {
      childStatusCounts: statuses,
      childCapabilities: children.map((child) => ({
        adapterId: child.adapterId,
        provider: child.provider,
        formats: child.formats,
        status: child.status,
        missingConfigKeys: child.missingConfigKeys ?? [],
      })),
    },
  };
}

export const modelFileAdapter: FileIngestAdapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,
  family: "model",
  formats: MODEL_INGEST_FORMATS,
  priority: 80,
  async capability(format?: string, settings?: FileIngestSettings) {
    if (!format) {
      return mapAggregateCapability(await getModelIngestCapabilities(undefined, settings));
    }
    const [child] = await getModelIngestCapabilities(format, settings);
    return mapCapability(child, format);
  },
  async ingest(source: FileIngestSource, context: FileIngestContext): Promise<FileAdapterIngestResult> {
    const modelRun = await generateModelIngestManifest(modelSourceFromFileSource(source), context.settings);
    const activeCapability = mapCapability(modelRun.capability, context.format);
    const issues = modelRun.issues.map((issue) => ({
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      metadata: issue.metadata,
    }));
    const provenance = makeProvenance({
      source,
      format: context.format,
      checksum: context.checksum,
      size: context.size,
      capability: activeCapability,
      method: "model_ingest_adapter",
      confidence: modelRun.status === "indexed" ? 0.85 : modelRun.status === "partial" ? 0.45 : 0.1,
    });
    const modelManifest = modelRun.manifest.modelIngest as CanonicalModelIngestManifest | undefined;
    const manifest: CanonicalFileIngestManifest = {
      schemaVersion: 1 as const,
      runStatus: modelRun.status,
      family: "model" as const,
      adapter: activeCapability,
      provenance,
      summary: {
        parser: modelRun.manifest.parser,
        adapterId: modelRun.manifest.adapterId,
        adapterStatus: modelRun.manifest.adapterStatus,
        provider: modelRun.manifest.provider,
        elementCount: modelRun.elements.length,
        quantityCount: modelRun.quantities.length,
        bomRowCount: modelRun.bomRows.length,
        issueCount: modelRun.issues.length,
      },
      artifacts: [],
      model: modelManifest,
      issues: normalizeIssues(issues),
    };
    const artifacts = await persistFileIngestArtifacts({
      projectId: source.projectId,
      sourceId: source.id,
      checksum: context.checksum,
      manifest,
      extraArtifacts: [
        {
          kind: "model-manifest",
          fileName: "model-manifest.json",
          payload: modelManifest ?? modelRun.manifest,
          description: "Child canonical model ingest manifest",
        },
      ],
    });
    const finalManifest = { ...manifest, artifacts };
    return {
      status: finalManifest.runStatus,
      family: "model",
      manifest: finalManifest,
      issues,
    };
  },
};
