import { createRequire } from "node:module";
import { open, readFile } from "node:fs/promises";
import type { CanonicalModelElement, CanonicalModelQuantity, ModelIngestCapability } from "@bidwright/domain";
import { classificationDefaultsToRecord, defaultClassificationForIfcClass } from "@bidwright/domain";
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

/** Common Pset names that carry an LOD value. The check is loose because
 *  authoring tools name these inconsistently — some shops use "Pset_LOD",
 *  others "Pset_VerificationStatus" with a "LOD" property, others a vendor
 *  Pset like "ePset_LOD". We match any Pset whose name contains "LOD" or
 *  "VerificationStatus", then look for any of LOD/LevelOfDevelopment/
 *  LevelOfDetail properties. */
function lodValueFromProperties(propsByName: Map<string, unknown>): string {
  const candidates = ["LOD", "LevelOfDevelopment", "LevelOfDetail", "Status"];
  for (const key of candidates) {
    const raw = propsByName.get(key);
    if (raw == null) continue;
    const text = typeof raw === "string" ? raw : String(raw);
    const match = text.match(/\b(100|200|300|350|400|500)\b/);
    if (match) return match[1];
  }
  return "";
}

/** web-ifc's GetLine(..., flatten=true) returns nested entities as full
 *  objects with `expressID` (numeric). When flatten is off or for entities
 *  we didn't expand, the same field comes as a ref wrapper `{ type, value }`.
 *  Accept either. */
function refExpressId(ref: any): number | null {
  const expressID =
    typeof ref?.expressID === "number"
      ? ref.expressID
      : typeof ref?.value === "number"
        ? ref.value
        : Number(ref?.value ?? ref?.expressID);
  return Number.isFinite(expressID) ? expressID : null;
}

function refExpressIds(refs: any): number[] {
  if (!Array.isArray(refs)) return [];
  const ids: number[] = [];
  for (const ref of refs) {
    const id = refExpressId(ref);
    if (id != null) ids.push(id);
  }
  return ids;
}

/** Authored quantity-name priority per basis: Net beats Gross beats plain,
 *  matching quantity-surveying convention (openings deducted). An unlisted
 *  name is still usable when nothing better exists. */
const QTY_NAME_PRIORITY: Record<string, string[]> = {
  length: ["NetLength", "GrossLength", "Length"],
  area: ["NetArea", "NetSideArea", "NetFloorArea", "GrossArea", "GrossSideArea", "GrossFloorArea", "Area"],
  volume: ["NetVolume", "GrossVolume", "Volume"],
  weight: ["NetWeight", "GrossWeight", "Weight"],
  count: ["Count"],
};

const QTY_VALUE_FIELDS: Array<[basis: string, field: string]> = [
  ["length", "LengthValue"],
  ["area", "AreaValue"],
  ["volume", "VolumeValue"],
  ["weight", "WeightValue"],
  ["count", "CountValue"],
];

function quantityNameRank(basis: string, name: string): number {
  const list = QTY_NAME_PRIORITY[basis] ?? [];
  const index = list.indexOf(name);
  return index === -1 ? list.length : index;
}

interface IfcDeclaredQuantity {
  basis: string;
  name: string;
  value: number;
  rank: number;
}

interface IfcDefinitionIndex {
  lodByExpressId: Map<number, string>;
  /** expressID → { PsetName: { PropName: value } } */
  psetsByExpressId: Map<number, Record<string, Record<string, unknown>>>;
  /** expressID → basis → best declared quantity */
  declaredByExpressId: Map<number, Map<string, IfcDeclaredQuantity>>;
  truncated: boolean;
}

/** One bounded walk over IFCRELDEFINESBYPROPERTIES collecting, per element:
 *  authored quantity sets (IfcElementQuantity → the DECLARED quantities the
 *  authoring tool computed — always preferred over our mesh approximations),
 *  property sets (raw Psets, nested per set name), and the LOD stamp.
 *  Best-effort: returns what it has on any error so ingest never fails here. */
function buildIfcDefinitionIndex(WebIFC: any, api: any, modelID: number): IfcDefinitionIndex {
  const result: IfcDefinitionIndex = {
    lodByExpressId: new Map(),
    psetsByExpressId: new Map(),
    declaredByExpressId: new Map(),
    truncated: false,
  };
  const MAX_REL_LINES = 50000;
  const MAX_PROPS_PER_ELEMENT = 120;
  const propCountByExpressId = new Map<number, number>();
  try {
    const relType = WebIFC.IFCRELDEFINESBYPROPERTIES;
    if (typeof relType !== "number") return result;
    const relIds = vectorToArray(api.GetLineIDsWithType(modelID, relType, false));
    if (relIds.length > MAX_REL_LINES) result.truncated = true;
    let processed = 0;
    for (const relId of relIds) {
      if (processed >= MAX_REL_LINES) break;
      processed += 1;
      let rel: any;
      try {
        rel = api.GetLine(modelID, relId, true);
      } catch {
        continue;
      }
      const def = rel?.RelatingPropertyDefinition;
      if (!def) continue;
      const defName = textScalar(def.Name);
      const relatedIds = refExpressIds(rel.RelatedObjects);
      if (relatedIds.length === 0) continue;

      if (Array.isArray(def.Quantities)) {
        // IfcElementQuantity — authored quantities (Qto_*).
        for (const quantity of def.Quantities) {
          const qName = textScalar(quantity?.Name);
          for (const [basis, field] of QTY_VALUE_FIELDS) {
            const raw = scalar(quantity?.[field]);
            if (raw == null) continue;
            const value = Number(raw);
            if (!Number.isFinite(value) || value <= 0) break;
            const rank = quantityNameRank(basis, qName);
            for (const expressID of relatedIds) {
              let byBasis = result.declaredByExpressId.get(expressID);
              if (!byBasis) {
                byBasis = new Map();
                result.declaredByExpressId.set(expressID, byBasis);
              }
              const existing = byBasis.get(basis);
              if (!existing || rank < existing.rank) {
                byBasis.set(basis, { basis, name: qName, value, rank });
              }
            }
            break; // an IfcPhysicalSimpleQuantity carries exactly one value field
          }
        }
        continue;
      }

      const props = Array.isArray(def.HasProperties) ? def.HasProperties : [];
      if (props.length === 0) continue;
      const propsByName = new Map<string, unknown>();
      for (const prop of props) {
        const name = textScalar(prop?.Name);
        if (!name) continue;
        // IFC single-value: NominalValue.value; enumeration: EnumerationValues; numeric: just .value.
        const value =
          scalar(prop?.NominalValue) ??
          scalar(prop?.EnumerationValues?.[0]) ??
          scalar(prop?.LengthValues?.[0]) ??
          scalar(prop?.value);
        if (value == null) continue;
        propsByName.set(name, value);
      }
      if (propsByName.size === 0) continue;

      // LOD detection on plausible Pset names only (cheap pre-filter).
      const upper = defName.toUpperCase();
      if (upper.includes("LOD") || upper.includes("VERIFICATIONSTATUS") || upper.includes("DEVELOPMENT")) {
        const lod = lodValueFromProperties(propsByName);
        if (lod) {
          for (const expressID of relatedIds) result.lodByExpressId.set(expressID, lod);
        }
      }

      // Raw Pset capture, budgeted per element so a property-heavy export
      // can't balloon every ModelElement row.
      if (!defName) continue;
      for (const expressID of relatedIds) {
        const used = propCountByExpressId.get(expressID) ?? 0;
        if (used >= MAX_PROPS_PER_ELEMENT) {
          result.truncated = true;
          continue;
        }
        const budgetLeft = MAX_PROPS_PER_ELEMENT - used;
        const entries = Array.from(propsByName.entries()).slice(0, budgetLeft);
        if (entries.length < propsByName.size) result.truncated = true;
        let psets = result.psetsByExpressId.get(expressID);
        if (!psets) {
          psets = {};
          result.psetsByExpressId.set(expressID, psets);
        }
        psets[defName] = { ...(psets[defName] ?? {}), ...Object.fromEntries(entries) };
        propCountByExpressId.set(expressID, used + entries.length);
      }
    }
  } catch {
    // Definition index is best-effort; ingest must not fail because it blew up.
  }
  return result;
}

interface IfcSpatialIndex {
  levelByExpressId: Map<number, string>;
  parentByExpressId: Map<number, number>;
  systemByExpressId: Map<number, string>;
}

/** Spatial containment (IfcRelContainedInSpatialStructure → level), assembly
 *  structure (IfcRelAggregates → parent, used to inherit a level when an
 *  element is only reachable through its assembly), and system membership
 *  (IfcRelAssignsToGroup where the group is an IfcSystem/IfcDistributionSystem
 *  → system name, which is what the takeoff topology keys MEP runs on). */
function buildIfcSpatialIndex(WebIFC: any, api: any, modelID: number): IfcSpatialIndex {
  const result: IfcSpatialIndex = {
    levelByExpressId: new Map(),
    parentByExpressId: new Map(),
    systemByExpressId: new Map(),
  };
  const MAX_REL_LINES = 50000;

  const walk = (typeName: string, visit: (rel: any) => void) => {
    try {
      const typeCode = WebIFC[typeName];
      if (typeof typeCode !== "number") return;
      const relIds = vectorToArray(api.GetLineIDsWithType(modelID, typeCode, false));
      let processed = 0;
      for (const relId of relIds) {
        if (processed >= MAX_REL_LINES) break;
        processed += 1;
        try {
          visit(api.GetLine(modelID, relId, true));
        } catch {
          continue;
        }
      }
    } catch {
      // Best-effort — a missing relation type must not fail ingest.
    }
  };

  walk("IFCRELCONTAINEDINSPATIALSTRUCTURE", (rel) => {
    const structure = rel?.RelatingStructure;
    const levelName = textScalar(structure?.Name) || textScalar(structure?.LongName);
    if (!levelName) return;
    for (const expressID of refExpressIds(rel?.RelatedElements)) {
      result.levelByExpressId.set(expressID, levelName);
    }
  });

  walk("IFCRELAGGREGATES", (rel) => {
    const parentId = refExpressId(rel?.RelatingObject);
    if (parentId == null) return;
    for (const expressID of refExpressIds(rel?.RelatedObjects)) {
      result.parentByExpressId.set(expressID, parentId);
    }
  });

  walk("IFCRELASSIGNSTOGROUP", (rel) => {
    const group = rel?.RelatingGroup;
    const groupId = refExpressId(group);
    if (groupId == null) return;
    let groupClass = "";
    try {
      groupClass = getIfcClassName(WebIFC, api, modelID, groupId);
    } catch {
      return;
    }
    if (!groupClass.includes("SYSTEM")) return;
    const systemName = textScalar(group?.Name) || textScalar(group?.LongName);
    if (!systemName) return;
    for (const expressID of refExpressIds(rel?.RelatedObjects)) {
      result.systemByExpressId.set(expressID, systemName);
    }
  });

  return result;
}

/** Level for an element: direct containment first, then up the aggregate
 *  chain (a member of an IfcElementAssembly is usually only contained via
 *  its assembly). Depth-capped — a cyclic aggregate must not hang ingest. */
function levelForExpressId(spatial: IfcSpatialIndex, expressID: number): string {
  let current: number | undefined = expressID;
  for (let depth = 0; depth < 4 && current != null; depth++) {
    const level = spatial.levelByExpressId.get(current);
    if (level) return level;
    current = spatial.parentByExpressId.get(current);
  }
  return "";
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

/** Plate-like classes whose billable area is a single face (plan or
 *  elevation), NOT the mesh's total surface. Mesh surface area counts both
 *  faces plus the edge band — roughly 2× the quantity an estimator prices —
 *  so for these classes the computed fallback is the product of the two
 *  largest bbox extents (thickness is always the smallest extent, and the
 *  formula is axis-convention-proof: it holds whether the file is Z-up or
 *  the mesh pipeline emitted Y-up). Ducts/pipes/fittings keep true surface
 *  area — honest for wrap/insulation pricing. */
const FACE_AREA_CLASSES = new Set([
  "IFCSLAB", "IFCROOF", "IFCPLATE", "IFCCOVERING", "IFCFOOTING",
  "IFCWALL", "IFCWALLSTANDARDCASE", "IFCCURTAINWALL", "IFCWINDOW", "IFCDOOR",
]);

/** Linear classes get a computed length = longest bbox extent so per-length
 *  pricing and topology runs have something to sum when the file declares no
 *  Qto length. Declared lengths (confidence 0.95) always win over this. */
const LINEAR_LENGTH_CLASSES = new Set([
  "IFCPIPESEGMENT", "IFCDUCTSEGMENT", "IFCFLOWSEGMENT", "IFCBEAM", "IFCMEMBER", "IFCCOLUMN",
]);

function bboxExtents(bbox: { min: number[]; max: number[] }): number[] {
  const extents = [0, 1, 2].map((axis) => Math.max(0, (bbox.max[axis] ?? 0) - (bbox.min[axis] ?? 0)));
  return extents.sort((a, b) => b - a);
}

const DECLARED_QTY_UNITS: Record<string, string> = {
  length: "model",
  area: "model^2",
  volume: "model^3",
  weight: "mass",
  count: "EA",
};

function makeIfcQuantityRows(args: {
  elementId: string;
  elementClass: string;
  geometry?: ReturnType<typeof geometryMetricsFromWebIfc> extends Map<number, infer T> ? T : never;
  declared?: Map<string, IfcDeclaredQuantity>;
  checksum: string;
}) {
  const rows: CanonicalModelQuantity[] = [];

  // Authored quantities first — what the modelling tool declared it drew.
  // Confidence 0.95 so they win selection over every mesh approximation.
  if (args.declared) {
    for (const declared of args.declared.values()) {
      rows.push({
        id: createId("mq"),
        elementId: args.elementId,
        quantityType: declared.basis,
        value: declared.value,
        unit: DECLARED_QTY_UNITS[declared.basis] ?? "model",
        method: "ifc_declared_quantity",
        confidence: 0.95,
        metadata: { quantitySource: "declared", qtoName: declared.name, provenanceChecksum: args.checksum },
      });
    }
  }

  if (!args.geometry) return rows;
  const extents = bboxExtents(args.geometry.bbox);

  if (FACE_AREA_CLASSES.has(args.elementClass) && extents[0] > 0 && extents[1] > 0) {
    rows.push({
      id: createId("mq"),
      elementId: args.elementId,
      quantityType: "surface_area",
      value: extents[0] * extents[1],
      unit: "model^2",
      method: "web_ifc_bbox_face_area",
      confidence: 0.7,
      metadata: { quantitySource: "computed", provenanceChecksum: args.checksum },
    });
  } else if (args.geometry.surfaceArea > 0) {
    rows.push({
      id: createId("mq"),
      elementId: args.elementId,
      quantityType: "surface_area",
      value: args.geometry.surfaceArea,
      unit: "model^2",
      method: "web_ifc_mesh_surface_area",
      confidence: 0.72,
      metadata: { quantitySource: "computed", provenanceChecksum: args.checksum },
    });
  }

  if (LINEAR_LENGTH_CLASSES.has(args.elementClass) && extents[0] > 0) {
    rows.push({
      id: createId("mq"),
      elementId: args.elementId,
      quantityType: "length",
      value: extents[0],
      unit: "model",
      method: "web_ifc_bbox_length",
      confidence: 0.6,
      metadata: { quantitySource: "computed", provenanceChecksum: args.checksum },
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
      metadata: { quantitySource: "computed", provenanceChecksum: args.checksum },
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
      const classification = classificationDefaultsToRecord(
        defaultClassificationForIfcClass(entityType),
      );
      elements.push({
        id: createId("me"),
        externalId: globalId || expressId,
        name,
        elementClass: entityType,
        elementType: entityType.replace(/^IFC/, ""),
        estimateRelevant: true,
        classification,
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

/** First 64 KB of the file — plenty for the STEP header (FILE_SCHEMA lives in
 *  the first few lines) without pulling a multi-hundred-MB model into a string. */
async function readIfcHeader(absPath: string): Promise<string> {
  const handle = await open(absPath, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).toString("latin1");
  } finally {
    await handle.close();
  }
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
    // Full text is only needed for the regex fallback index — web-ifc parses
    // bytes and has no such size limit. Requiring the text up front made
    // every IFC over MAX_TEXT_BYTES fail ingest outright; real plant models
    // are routinely far larger. `text` stays null for big files and the
    // fallback paths handle that explicitly.
    const text = await readTextIfReasonable(context.absPath, context.size);
    if (activeCapability.status !== "available") {
      if (!text) {
        throw new Error("web-ifc is unavailable and the IFC is too large for the text fallback index.");
      }
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
      // Pre-build definition + spatial lookups so each element-build doesn't
      // re-walk relations: declared Qto_* quantities, raw Psets, LOD, storey
      // containment, aggregate parents, and system membership.
      const definitions = buildIfcDefinitionIndex(WebIFC, api, activeModelID);
      const spatial = buildIfcSpatialIndex(WebIFC, api, activeModelID);

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
          const lodFromPset = definitions.lodByExpressId.get(expressID) ?? "";
          const classification = classificationDefaultsToRecord(
            defaultClassificationForIfcClass(classFromApi),
          );
          const psets = definitions.psetsByExpressId.get(expressID);
          elements.push({
            id: elementId,
            externalId: globalId,
            name,
            elementClass: classFromApi,
            elementType,
            system: spatial.systemByExpressId.get(expressID) ?? "",
            level: levelForExpressId(spatial, expressID),
            bbox: geometry ? finalizeBbox(geometry.bbox) ?? undefined : undefined,
            geometryRef: geometry?.meshRefs[0],
            estimateRelevant: true,
            lod: lodFromPset,
            lodSource: lodFromPset ? "pset" : "",
            classification,
            properties: {
              expressId: `#${expressID}`,
              globalId,
              objectType: textScalar(line.ObjectType),
              predefinedType: textScalar(line.PredefinedType),
              tag: textScalar(line.Tag),
              meshRefs: geometry?.meshRefs ?? [],
              parser: "web-ifc",
              ...(psets ? { psets } : {}),
            },
          });
          quantities.push(...makeIfcQuantityRows({
            elementId,
            elementClass: classFromApi,
            geometry,
            declared: definitions.declaredByExpressId.get(expressID),
            checksum: context.checksum,
          }));
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

      const issues = [
        ...(elements.length >= MAX_IFC_ELEMENTS ? [{
          severity: "warning",
          code: "ifc_element_index_truncated",
          message: `Only the first ${MAX_IFC_ELEMENTS} estimate-relevant IFC elements were persisted.`,
        }] : []),
        ...(definitions.truncated ? [{
          severity: "info",
          code: "ifc_property_index_truncated",
          message: "Property/quantity relations exceeded the ingest budget; some Psets were not captured.",
        }] : []),
      ];
      const summary = {
        parser: "web-ifc",
        schema: (text ?? await readIfcHeader(context.absPath)).match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1] ?? "",
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
      if (!text) {
        // Too large for the regex fallback — surface the real web-ifc error
        // rather than a misleading size complaint.
        throw error instanceof Error ? error : new Error(String(error));
      }
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
