import type { ModelIngestCapability } from "@bidwright/domain";
import type { ModelAdapterIngestResult, ModelIngestAdapter, ModelIngestContext, ModelIngestSource } from "../types.js";
import {
  buildEstimateLens,
  createId,
  makeCanonicalManifest,
  makeProvenance,
  readTextIfReasonable,
  topCounts,
} from "../utils.js";

const ADAPTER_ID = "embedded-open.dxf";
const ADAPTER_VERSION = "1.0.0";
const FORMATS = new Set(["dxf"]);

type DxfPair = { code: number; value: string };

function capability(status: ModelIngestCapability["status"] = "available", message?: string): ModelIngestCapability {
  return {
    adapterId: ADAPTER_ID,
    adapterVersion: ADAPTER_VERSION,
    provider: "embedded-open",
    formats: Array.from(FORMATS),
    status,
    message,
    features: {
      geometry: true,
      properties: true,
      quantities: true,
      estimateLens: true,
      rawArtifacts: true,
    },
  };
}

function parseTextDxf(input: string): DxfPair[] {
  const lines = input.replace(/\r/g, "").split("\n");
  const pairs: DxfPair[] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index]?.trim());
    if (!Number.isFinite(code)) continue;
    pairs.push({ code, value: lines[index + 1]?.trimEnd() ?? "" });
  }
  return pairs;
}

function parseHeaderUnits(pairs: DxfPair[]) {
  for (let index = 0; index < pairs.length; index++) {
    if (pairs[index]?.code === 9 && pairs[index]?.value === "$INSUNITS") {
      const unitCode = Number(pairs[index + 1]?.value ?? 0);
      const unitMap: Record<number, string> = {
        0: "unitless",
        1: "in",
        2: "ft",
        4: "mm",
        5: "cm",
        6: "m",
      };
      return unitMap[unitCode] ?? `insunits-${unitCode}`;
    }
  }
  return "unitless";
}

function parseDxfCounts(pairs: DxfPair[]) {
  const entityCounts = new Map<string, number>();
  const layerCounts = new Map<string, number>();
  let inEntities = false;
  let currentEntity = "";
  for (let index = 0; index < pairs.length; index++) {
    const pair = pairs[index]!;
    if (pair.code === 0 && pair.value === "SECTION" && pairs[index + 1]?.value.toUpperCase() === "ENTITIES") {
      inEntities = true;
      continue;
    }
    if (inEntities && pair.code === 0 && pair.value === "ENDSEC") {
      inEntities = false;
      continue;
    }
    if (!inEntities) continue;
    if (pair.code === 0) {
      currentEntity = pair.value.toUpperCase();
      if (currentEntity && currentEntity !== "SEQEND" && currentEntity !== "VERTEX") {
        entityCounts.set(currentEntity, (entityCounts.get(currentEntity) ?? 0) + 1);
      }
      continue;
    }
    if (pair.code === 8 && currentEntity && currentEntity !== "SEQEND" && currentEntity !== "VERTEX") {
      layerCounts.set(pair.value || "0", (layerCounts.get(pair.value || "0") ?? 0) + 1);
    }
  }
  return { entityCounts, layerCounts };
}

export const dxfAdapter: ModelIngestAdapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,
  formats: FORMATS,
  priority: 90,
  capability() {
    return capability();
  },
  async ingest(source: ModelIngestSource, context: ModelIngestContext): Promise<ModelAdapterIngestResult> {
    const text = await readTextIfReasonable(context.absPath, context.size);
    if (!text) throw new Error("DXF is too large for synchronous text indexing.");
    const pairs = parseTextDxf(text);
    const units = parseHeaderUnits(pairs);
    const { entityCounts, layerCounts } = parseDxfCounts(pairs);
    const elements = topCounts(layerCounts, 500).map((row) => ({
      id: createId("me"),
      externalId: `dxf-layer-${row.name}`,
      name: row.name,
      elementClass: "DXF_LAYER",
      elementType: "CAD_LAYER",
      estimateRelevant: true,
      properties: {
        entityCount: row.count,
        sourceChecksum: context.checksum,
      },
    }));
    const quantities = [
      ...topCounts(entityCounts, 200).map((row) => ({
        id: createId("mq"),
        quantityType: "count",
        value: row.count,
        unit: "EA",
        method: "dxf_entity_count",
        confidence: 0.9,
        metadata: { entityType: row.name, provenanceChecksum: context.checksum },
      })),
      ...topCounts(layerCounts, 200).map((row) => ({
        id: createId("mq"),
        quantityType: "layer_entity_count",
        value: row.count,
        unit: "EA",
        method: "dxf_layer_entity_count",
        confidence: 0.9,
        metadata: { layer: row.name, provenanceChecksum: context.checksum },
      })),
    ];
    const bomRows = topCounts(entityCounts, 200).map((row) => ({
      group: row.name,
      description: `DXF ${row.name} entities`,
      quantity: row.count,
      unit: "EA",
      method: "dxf_entity_count",
      source: "model-ingest",
    }));
    const activeCapability = capability();
    const summary = {
      parser: "dxf-entity-index",
      units,
      pairCount: pairs.length,
      entityTypes: topCounts(entityCounts),
      layers: topCounts(layerCounts),
    };
    const elementStats = {
      totalIndexedElements: elements.length,
      entityTypes: topCounts(entityCounts),
      layers: topCounts(layerCounts),
    };
    const provenance = makeProvenance({
      source,
      format: context.format,
      checksum: context.checksum,
      size: context.size,
      capability: activeCapability,
      method: "dxf_entity_layer_index",
      confidence: 0.9,
    });
    const canonicalManifest = makeCanonicalManifest({
      status: "indexed",
      units,
      capability: activeCapability,
      provenance,
      summary,
      elementStats,
      estimateLens: buildEstimateLens({ elements, quantities, defaultSource: "entity-index" }),
      issues: [],
    });
    return {
      status: "indexed",
      units,
      manifest: summary,
      elementStats,
      elements,
      quantities,
      bomRows,
      issues: [],
      canonicalManifest,
      artifacts: [],
    };
  },
};
