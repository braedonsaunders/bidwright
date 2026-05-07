import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import type { CanonicalModelElement, CanonicalModelQuantity, ModelIngestCapability } from "@bidwright/domain";
import type { ModelAdapterIngestResult, ModelIngestAdapter, ModelIngestContext, ModelIngestSource } from "../types.js";
import {
  buildEstimateLens,
  computeTriangulatedMeshMetrics,
  createId,
  emptyBbox,
  finalizeBbox,
  makeCanonicalManifest,
  makeProvenance,
  readTextIfReasonable,
  topCounts,
  triangleArea,
  updateBbox,
} from "../utils.js";

const require = createRequire(import.meta.url);
const ADAPTER_ID = "embedded-open.web-ifc";
const ADAPTER_VERSION = "1.0.0";
const FORMATS = new Set(["ifc"]);
const MAX_IFC_ELEMENTS = 25_000;

const ESTIMATE_CLASS_NAMES = [
  "IFCWALL",
  "IFCWALLSTANDARDCASE",
  "IFCDOOR",
  "IFCWINDOW",
  "IFCSLAB",
  "IFCBEAM",
  "IFCCOLUMN",
  "IFCMEMBER",
  "IFCPLATE",
  "IFCFOOTING",
  "IFCPILE",
  "IFCROOF",
  "IFCSTAIR",
  "IFCRAMP",
  "IFCCOVERING",
  "IFCCURTAINWALL",
  "IFCPIPESEGMENT",
  "IFCDUCTSEGMENT",
  "IFCVALVE",
  "IFCFLOWSEGMENT",
  "IFCFLOWFITTING",
  "IFCFLOWTERMINAL",
  "IFCFLOWCONTROLLER",
  "IFCBUILDINGELEMENTPROXY",
  "IFCFURNISHINGELEMENT",
  "IFCTRANSPORTELEMENT",
  "IFCDISTRIBUTIONELEMENT",
  "IFCELEMENTASSEMBLY",
  "IFCSPACE",
];

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
    metadata: {
      engine: "web-ifc",
      license: "MPL-2.0",
    },
  };
}

async function loadWebIfc(): Promise<any> {
  return import("web-ifc");
}

function vectorToArray(vector: any): number[] {
  const rows: number[] = [];
  const size = typeof vector?.size === "function" ? vector.size() : 0;
  for (let index = 0; index < size; index++) {
    rows.push(Number(vector.get(index)));
  }
  return rows;
}

function scalar(value: any): unknown {
  if (value == null) return undefined;
  if (typeof value !== "object") return value;
  if ("value" in value) return scalar(value.value);
  if ("type" in value && "value" in value) return scalar(value.value);
  return undefined;
}

function textScalar(value: any): string {
  const extracted = scalar(value);
  return extracted == null ? "" : String(extracted);
}

function getIfcClassName(WebIFC: any, api: any, modelID: number, expressID: number, fallbackType?: number) {
  try {
    const typeCode = fallbackType ?? api.GetLineType(modelID, expressID);
    const name = api.GetNameFromTypeCode(typeCode);
    if (name) return String(name).toUpperCase();
  } catch {
    // Keep the fallback below.
  }
  return "IFCUNKNOWN";
}

function applyMatrix(point: number[], matrix?: ArrayLike<number>) {
  if (!matrix || matrix.length < 16) return point;
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function geometryMetricsFromWebIfc(WebIFC: any, api: any, modelID: number) {
  const byExpressId = new Map<number, {
    bbox: { min: number[]; max: number[] };
    surfaceArea: number;
    volume: number;
    triangleCount: number;
    vertexCount: number;
    meshRefs: string[];
  }>();

  try {
    api.StreamAllMeshes(modelID, (mesh: any) => {
      const expressID = Number(mesh.expressID ?? mesh.expressId ?? mesh.productID ?? mesh.productId ?? 0);
      if (!expressID) return;
      const current = byExpressId.get(expressID) ?? {
        bbox: emptyBbox(),
        surfaceArea: 0,
        volume: 0,
        triangleCount: 0,
        vertexCount: 0,
        meshRefs: [],
      };
      const placedGeometries = mesh.geometries;
      const placedCount = typeof placedGeometries?.size === "function" ? placedGeometries.size() : 0;
      for (let index = 0; index < placedCount; index++) {
        const placed = placedGeometries.get(index);
        const ifcGeo = api.GetGeometry(modelID, placed.geometryExpressID);
        try {
          const verts = api.GetVertexArray(ifcGeo.GetVertexData(), ifcGeo.GetVertexDataSize());
          const indices = api.GetIndexArray(ifcGeo.GetIndexData(), ifcGeo.GetIndexDataSize());
          const positions: number[] = [];
          for (let offset = 0; offset < verts.length; offset += 6) {
            const transformed = applyMatrix([verts[offset], verts[offset + 1], verts[offset + 2]], placed.flatTransformation);
            positions.push(transformed[0], transformed[1], transformed[2]);
            updateBbox(current.bbox, transformed);
          }
          const metrics = computeTriangulatedMeshMetrics(positions, indices);
          current.surfaceArea += metrics.surfaceArea;
          current.volume += metrics.volume;
          current.triangleCount += metrics.triangleCount;
          current.vertexCount += metrics.vertexCount;
          current.meshRefs.push(`ifc-${expressID}-${placed.geometryExpressID}-${index}`);
        } finally {
          ifcGeo.delete?.();
        }
      }
      byExpressId.set(expressID, current);
    });
  } catch {
    return byExpressId;
  }

  return byExpressId;
}

function makeIfcQuantityRows(args: {
  elementId: string;
  geometry?: ReturnType<typeof geometryMetricsFromWebIfc> extends Map<number, infer T> ? T : never;
  checksum: string;
}) {
  const rows: CanonicalModelQuantity[] = [];
  if (!args.geometry) return rows;
  if (args.geometry.surfaceArea > 0) {
    rows.push({
      id: createId("mq"),
      elementId: args.elementId,
      quantityType: "surface_area",
      value: args.geometry.surfaceArea,
      unit: "model^2",
      method: "web_ifc_mesh_surface_area",
      confidence: 0.72,
      metadata: { provenanceChecksum: args.checksum },
    });
  }
  if (args.geometry.volume > 0) {
    rows.push({
      id: createId("mq"),
      elementId: args.elementId,
      quantityType: "volume",
      value: args.geometry.volume,
      unit: "model^3",
      method: "web_ifc_closed_mesh_volume",
      confidence: 0.65,
      metadata: { provenanceChecksum: args.checksum },
    });
  }
  if (args.geometry.triangleCount > 0) {
    rows.push({
      id: createId("mq"),
      elementId: args.elementId,
      quantityType: "triangle_count",
      value: args.geometry.triangleCount,
      unit: "triangles",
      method: "web_ifc_mesh",
      confidence: 1,
      metadata: { provenanceChecksum: args.checksum },
    });
  }
  return rows;
}

function getQuotedValues(args: string) {
  const values: string[] = [];
  const re = /'((?:[^']|'')*)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(args))) {
    values.push(match[1].replace(/''/g, "'"));
  }
  return values;
}

function fallbackIfcEntityIndex(text: string, source: ModelIngestSource, context: ModelIngestContext, activeCapability: ModelIngestCapability, fallbackMessage: string): ModelAdapterIngestResult {
  const counts = new Map<string, number>();
  const elements: CanonicalModelElement[] = [];
  const entityRe = /#(\d+)\s*=\s*(IFC[A-Z0-9_]+)\s*\(([\s\S]*?)\);/gi;
  const elementTypeRe = /^IFC(WALL|DOOR|WINDOW|SLAB|BEAM|COLUMN|PIPE|DUCT|VALVE|FLOW|FURNISHING|SPACE|BUILDINGSTOREY|ROOF|STAIR|RAMP|PLATE|MEMBER|COVERING|CURTAINWALL|FOOTING|PILE|RAILING|PROXY|ELEMENTASSEMBLY)/;
  let match: RegExpExecArray | null;

  while ((match = entityRe.exec(text))) {
    const expressId = `#${match[1]}`;
    const entityType = match[2].toUpperCase();
    const args = match[3];
    counts.set(entityType, (counts.get(entityType) ?? 0) + 1);

    if (elements.length < 5000 && elementTypeRe.test(entityType)) {
      const quoted = getQuotedValues(args);
      const globalId = quoted[0] ?? expressId;
      const name = quoted[2] || quoted[1] || entityType;
      elements.push({
        id: createId("me"),
        externalId: globalId || expressId,
        name,
        elementClass: entityType,
        elementType: entityType.replace(/^IFC/, ""),
        estimateRelevant: true,
        properties: { expressId, globalId, rawName: name },
      });
    }
  }

  const bomRows = topCounts(counts, 100)
    .filter((row) => row.name.startsWith("IFC"))
    .map((row) => ({
      group: row.name,
      description: row.name,
      quantity: row.count,
      unit: "EA",
      method: "ifc_entity_count",
      source: "model-ingest",
    }));
  const quantities = bomRows.map((row) => ({
    id: createId("mq"),
    quantityType: "count",
    value: Number(row.quantity),
    unit: "EA",
    method: "ifc_entity_count",
    confidence: 0.45,
    metadata: { group: row.group, provenanceChecksum: context.checksum },
  }));
  const degradedCapability = { ...activeCapability, status: "degraded" as const, message: fallbackMessage };
  const provenance = makeProvenance({
    source,
    format: context.format,
    checksum: context.checksum,
    size: context.size,
    capability: degradedCapability,
    method: "ifc_entity_index_fallback",
    confidence: 0.45,
  });
  const issues = [{
    severity: "warning",
    code: "web_ifc_fallback_entity_index",
    message: fallbackMessage,
  }, ...(elements.length >= 5000 ? [{
    severity: "warning",
    code: "element_index_truncated",
    message: "Only the first 5000 IFC element-like records were persisted for fast querying.",
  }] : [])];
  const summary = {
    parser: "ifc-entity-index",
    schema: text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1] ?? "",
    entityTypeCount: counts.size,
    topEntities: topCounts(counts),
    elementSampleCount: elements.length,
  };
  const elementStats = { totalIndexedElements: elements.length, topEntities: topCounts(counts) };
  const canonicalManifest = makeCanonicalManifest({
    status: "partial",
    units: "",
    capability: degradedCapability,
    provenance,
    summary,
    elementStats,
    estimateLens: buildEstimateLens({ elements, quantities, defaultSource: "entity-index" }),
    issues,
  });
  return {
    status: "partial",
    units: "",
    manifest: summary,
    elementStats,
    elements,
    quantities,
    bomRows,
    issues,
    canonicalManifest,
    artifacts: [],
  };
}

export const ifcAdapter: ModelIngestAdapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,
  formats: FORMATS,
  priority: 100,
  async capability() {
    try {
      require.resolve("web-ifc");
      return capability();
    } catch {
      return capability("missing", "Install the free embedded web-ifc dependency to enable real IFC parsing.");
    }
  },
  async ingest(source: ModelIngestSource, context: ModelIngestContext): Promise<ModelAdapterIngestResult> {
    const activeCapability = await this.capability(context.format);
    const text = await readTextIfReasonable(context.absPath, context.size);
    if (!text) {
      throw new Error("IFC is too large for synchronous text fallback indexing.");
    }
    if (activeCapability.status !== "available") {
      return fallbackIfcEntityIndex(text, source, context, activeCapability, activeCapability.message ?? "web-ifc is unavailable.");
    }

    let api: any | null = null;
    let modelID: number | null = null;
    try {
      const WebIFC = await loadWebIfc();
      api = new WebIFC.IfcAPI();
      await api.Init();
      const data = new Uint8Array(await readFile(context.absPath));
      modelID = Number(api.OpenModel(data));
      const activeModelID: number = modelID;
      const geometryByExpressId = geometryMetricsFromWebIfc(WebIFC, api, activeModelID);

      const elements: CanonicalModelElement[] = [];
      const quantities: CanonicalModelQuantity[] = [];
      const counts = new Map<string, number>();
      const seenExpressIds = new Set<number>();
      for (const className of ESTIMATE_CLASS_NAMES) {
        const typeCode = WebIFC[className];
        if (typeof typeCode !== "number") continue;
        let ids: number[] = [];
        try {
          ids = vectorToArray(api.GetLineIDsWithType(activeModelID, typeCode, false));
        } catch {
          continue;
        }
        counts.set(className, ids.length);
        for (const expressID of ids) {
          if (seenExpressIds.has(expressID) || elements.length >= MAX_IFC_ELEMENTS) continue;
          seenExpressIds.add(expressID);
          const line = api.GetLine(activeModelID, expressID, true);
          const classFromApi = getIfcClassName(WebIFC, api, activeModelID, expressID, typeCode);
          const geometry = geometryByExpressId.get(expressID);
          const elementId = createId("me");
          const globalId = textScalar(line.GlobalId) || `#${expressID}`;
          const name = textScalar(line.Name) || textScalar(line.ObjectType) || classFromApi;
          const elementType = textScalar(line.PredefinedType) || classFromApi.replace(/^IFC/, "");
          elements.push({
            id: elementId,
            externalId: globalId,
            name,
            elementClass: classFromApi,
            elementType,
            bbox: geometry ? finalizeBbox(geometry.bbox) ?? undefined : undefined,
            geometryRef: geometry?.meshRefs[0],
            estimateRelevant: true,
            properties: {
              expressId: `#${expressID}`,
              globalId,
              objectType: textScalar(line.ObjectType),
              predefinedType: textScalar(line.PredefinedType),
              tag: textScalar(line.Tag),
              meshRefs: geometry?.meshRefs ?? [],
              parser: "web-ifc",
            },
          });
          quantities.push(...makeIfcQuantityRows({ elementId, geometry, checksum: context.checksum }));
        }
      }

      const bomRows = topCounts(counts, 100)
        .filter((row) => row.count > 0)
        .map((row) => ({
          group: row.name,
          description: row.name,
          quantity: row.count,
          unit: "EA",
          method: "web_ifc_element_count",
          source: "model-ingest",
        }));
      quantities.push(...bomRows.map((row) => ({
        id: createId("mq"),
        quantityType: "count",
        value: Number(row.quantity),
        unit: "EA",
        method: "web_ifc_element_count",
        confidence: 0.95,
        metadata: { group: row.group, provenanceChecksum: context.checksum },
      })));

      const issues = elements.length >= MAX_IFC_ELEMENTS ? [{
        severity: "warning",
        code: "ifc_element_index_truncated",
        message: `Only the first ${MAX_IFC_ELEMENTS} estimate-relevant IFC elements were persisted.`,
      }] : [];
      const summary = {
        parser: "web-ifc",
        schema: text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1] ?? "",
        estimateClassCounts: topCounts(counts, 100),
        indexedElementCount: elements.length,
        geometryElementCount: geometryByExpressId.size,
      };
      const elementStats = {
        totalIndexedElements: elements.length,
        estimateClassCounts: topCounts(counts, 100),
        geometryElementCount: geometryByExpressId.size,
      };
      const provenance = makeProvenance({
        source,
        format: context.format,
        checksum: context.checksum,
        size: context.size,
        capability: activeCapability,
        method: "web_ifc_element_and_mesh_extraction",
        confidence: 0.86,
      });
      const canonicalManifest = makeCanonicalManifest({
        status: "indexed",
        units: "model",
        capability: activeCapability,
        provenance,
        summary,
        elementStats,
        estimateLens: buildEstimateLens({ elements, quantities, defaultSource: "geometry-derived" }),
        issues,
        geometryArtifacts: [{
          id: createId("mga"),
          format: "mesh-json",
          meshRefs: elements.map((element) => element.geometryRef).filter(Boolean) as string[],
          units: "model",
          metadata: { source: "web-ifc", geometryElementCount: geometryByExpressId.size },
        }],
      });
      return {
        status: "indexed",
        units: "model",
        manifest: summary,
        elementStats,
        elements,
        quantities,
        bomRows,
        issues,
        canonicalManifest,
        artifacts: [],
      };
    } catch (error) {
      return fallbackIfcEntityIndex(
        text,
        source,
        context,
        activeCapability,
        `web-ifc could not fully parse this IFC, so BidWright used a conservative entity index fallback: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (api && modelID !== null) {
        try { api.CloseModel(modelID); } catch { /* noop */ }
      }
    }
  },
};
