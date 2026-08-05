import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { prisma } from "@bidwright/db";
import {
  buildModelTopology,
  DEFAULT_MODEL_TOPOLOGY_ESTIMATE_AXES,
  type ModelTopologyEstimateAxis,
  type ModelTopologyGroupResult,
} from "@bidwright/domain";
import { ApsClient } from "./model-ingest/aps-client.js";
import { generateModelIngestManifest, getModelIngestCapabilities } from "./model-ingest/orchestrator.js";
import { MODEL_INGEST_FORMATS, isModelIngestFileName } from "./model-ingest/registry.js";
import type { ModelIngestSettings } from "./model-ingest/types.js";

const MODEL_EXTENSIONS = MODEL_INGEST_FORMATS;
const MODEL_EDITOR_EDITABLE_EXTENSIONS = new Set(["step", "stp", "iges", "igs", "brep", "stl"]);
const MAX_TEXT_BYTES = 12 * 1024 * 1024;
const MAX_GEOMETRY_BYTES = 80 * 1024 * 1024;
const CAD_GEOMETRY_EXTENSIONS = new Set(["step", "stp", "iges", "igs", "brep"]);
const OCCT_LINEAR_UNIT = "foot";
const require = createRequire(import.meta.url);
const APS_VIEWER_EXTENSIONS = new Set(["nwd", "nwf", "nwc"]);
const activeViewerPreparations = new Map<string, Promise<void>>();

type ModelSourceKind = "source_document" | "file_node";

export interface ProjectModelViewerInput {
  sourceKind: ModelSourceKind;
  sourceId: string;
  force?: boolean;
}

export type ProjectModelViewerResult =
  | { status: "processing"; modelId: string; message: string }
  | { status: "failed"; modelId: string; message: string }
  | {
      status: "ready";
      modelId: string;
      urn: string;
      accessToken: string;
      expiresIn: number;
      api: "streamingV2" | "streamingV2_EU";
      region: string;
    };

interface ModelSource {
  id: string;
  source: ModelSourceKind;
  projectId: string;
  fileName: string;
  fileType?: string | null;
  storagePath?: string | null;
  checksum?: string | null;
  size?: number | null;
  metadata?: unknown;
}

interface GeneratedElement {
  id: string;
  externalId: string;
  name: string;
  elementClass: string;
  elementType?: string;
  system?: string;
  level?: string;
  material?: string;
  bbox?: unknown;
  geometryRef?: string;
  estimateRelevant?: boolean;
  /** Construction classification keyed by standard (mirrors WorksheetItem). */
  classification?: Record<string, string>;
  /** Level of Development extracted from a Pset or set manually. */
  lod?: string;
  /** "pset" | "manual" | "" — provenance of the LOD value. */
  lodSource?: "pset" | "manual" | "";
  properties?: Record<string, unknown>;
}

interface GeneratedQuantity {
  id: string;
  elementId?: string | null;
  quantityType: string;
  value: number;
  unit: string;
  method: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

interface GeneratedIssue {
  severity: string;
  code: string;
  message: string;
  elementId?: string | null;
  metadata?: Record<string, unknown>;
}

interface GeneratedManifest {
  status: "indexed" | "partial" | "failed";
  units: string;
  manifest: Record<string, unknown>;
  elementStats: Record<string, unknown>;
  elements: GeneratedElement[];
  quantities: GeneratedQuantity[];
  bomRows: Array<Record<string, unknown>>;
  issues: GeneratedIssue[];
}

interface OcctNode {
  name?: string;
  meshes?: number[];
  children?: OcctNode[];
}

interface OcctMesh {
  name?: string;
  color?: number[];
  brep_faces?: Array<{ first?: number; last?: number; color?: number[] | null }>;
  attributes?: {
    position?: { array?: ArrayLike<number> };
    normal?: { array?: ArrayLike<number> };
  };
  index?: { array?: ArrayLike<number> };
}

interface OcctImportResult {
  success: boolean;
  error?: string;
  root?: OcctNode;
  meshes?: OcctMesh[];
}

interface OcctImportApi {
  ReadStepFile(content: Uint8Array, params: Record<string, unknown> | null): OcctImportResult;
  ReadIgesFile(content: Uint8Array, params: Record<string, unknown> | null): OcctImportResult;
  ReadBrepFile(content: Uint8Array, params: Record<string, unknown> | null): OcctImportResult;
}

type OcctImportFactory = () => Promise<OcctImportApi>;

let occtImportPromise: Promise<OcctImportApi> | null = null;

async function loadOcctImport() {
  occtImportPromise ??= (require("occt-import-js") as OcctImportFactory)();
  return occtImportPromise;
}

function createId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function getExt(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function isModelFileName(fileName: string) {
  return isModelIngestFileName(fileName);
}

async function sha256File(absPath: string) {
  const buffer = await readFile(absPath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function readTextIfReasonable(absPath: string, size: number) {
  if (size > MAX_TEXT_BYTES) return null;
  return readFile(absPath, "utf8");
}

function topCounts(counts: Map<string, number>, limit = 40) {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
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

function vectorSub(a: number[], b: number[]) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vectorCross(a: number[], b: number[]) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function vectorLength(a: number[]) {
  return Math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2);
}

function triangleArea(a: number[], b: number[], c: number[]) {
  return vectorLength(vectorCross(vectorSub(b, a), vectorSub(c, a))) / 2;
}

function signedTetraVolume(a: number[], b: number[], c: number[]) {
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  ) / 6;
}

function updateBbox(bbox: { min: number[]; max: number[] }, point: number[]) {
  for (let i = 0; i < 3; i++) {
    bbox.min[i] = Math.min(bbox.min[i], point[i]);
    bbox.max[i] = Math.max(bbox.max[i], point[i]);
  }
}

function emptyBbox() {
  return {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
}

function finalizeBbox(bbox: { min: number[]; max: number[] }) {
  if (!Number.isFinite(bbox.min[0])) return null;
  return {
    min: bbox.min,
    max: bbox.max,
    size: bbox.max.map((v, index) => v - bbox.min[index]),
    center: bbox.max.map((v, index) => (v + bbox.min[index]) / 2),
  };
}

function numericArray(value: ArrayLike<number> | undefined): number[] {
  if (!value) return [];
  return Array.from(value, (item) => Number(item));
}

function meshPointAt(position: number[], vertexIndex: number): number[] | null {
  const offset = vertexIndex * 3;
  const point = [position[offset], position[offset + 1], position[offset + 2]];
  return point.every(Number.isFinite) ? point : null;
}

function computeTriangulatedMeshMetrics(positionLike?: ArrayLike<number>, indexLike?: ArrayLike<number>) {
  const position = numericArray(positionLike);
  const index = numericArray(indexLike).map((value) => Math.trunc(value));
  const vertexCount = Math.floor(position.length / 3);
  const indexed = index.length >= 3;
  const triangleCount = indexed ? Math.floor(index.length / 3) : Math.floor(vertexCount / 3);
  const bbox = emptyBbox();
  let surfaceArea = 0;
  let signedVolume = 0;
  let measuredTriangleCount = 0;

  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const point = meshPointAt(position, vertex);
    if (point) updateBbox(bbox, point);
  }

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const base = triangle * 3;
    const aIndex = indexed ? index[base] : base;
    const bIndex = indexed ? index[base + 1] : base + 1;
    const cIndex = indexed ? index[base + 2] : base + 2;
    const a = meshPointAt(position, aIndex);
    const b = meshPointAt(position, bIndex);
    const c = meshPointAt(position, cIndex);
    if (!a || !b || !c) continue;
    surfaceArea += triangleArea(a, b, c);
    signedVolume += signedTetraVolume(a, b, c);
    measuredTriangleCount++;
  }

  return {
    vertexCount,
    triangleCount: measuredTriangleCount,
    surfaceArea,
    volume: Math.abs(signedVolume),
    bbox: finalizeBbox(bbox),
  };
}

function colorToHex(color: number[] | undefined) {
  if (!color || color.length < 3) return "";
  const normalized = color.slice(0, 3).map((value) => {
    const scaled = value <= 1 ? value * 255 : value;
    return Math.max(0, Math.min(255, Math.round(scaled)));
  });
  return `#${normalized.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function summarizeOcctNode(node: OcctNode | undefined, depth = 0): Record<string, unknown> | null {
  if (!node) return null;
  return {
    name: node.name ?? "",
    meshCount: node.meshes?.length ?? 0,
    childCount: node.children?.length ?? 0,
    children: depth < 3 ? (node.children ?? []).slice(0, 50).map((child) => summarizeOcctNode(child, depth + 1)) : [],
  };
}

async function parseCadWithOcct(buffer: Buffer, ext: string, fileName: string): Promise<GeneratedManifest> {
  const occt = await loadOcctImport();
  const params = ext === "brep"
    ? null
    : {
        linearUnit: OCCT_LINEAR_UNIT,
        linearDeflectionType: "bounding_box_ratio",
        linearDeflection: 0.001,
        angularDeflection: 0.5,
      };
  const result =
    ext === "brep" ? occt.ReadBrepFile(buffer, null) :
    ext === "iges" || ext === "igs" ? occt.ReadIgesFile(buffer, params) :
    occt.ReadStepFile(buffer, params);

  if (!result.success) {
    throw new Error(result.error || `OpenCascade failed to read ${fileName}`);
  }

  const quantityUnits = ext === "brep"
    ? { length: "model", area: "model^2", volume: "model^3" }
    : { length: "ft", area: "SF", volume: "CF" };
  const modelBbox = emptyBbox();
  const elements: GeneratedElement[] = [];
  const quantities: GeneratedQuantity[] = [];
  const bomRows: Array<Record<string, unknown>> = [];
  let totalSurfaceArea = 0;
  let totalVolume = 0;
  let totalTriangles = 0;
  let totalVertices = 0;

  for (const [index, mesh] of (result.meshes ?? []).entries()) {
    const metrics = computeTriangulatedMeshMetrics(mesh.attributes?.position?.array, mesh.index?.array);
    if (metrics.bbox) {
      metrics.bbox.min.forEach((value, axis) => {
        modelBbox.min[axis] = Math.min(modelBbox.min[axis], value);
        modelBbox.max[axis] = Math.max(modelBbox.max[axis], metrics.bbox!.max[axis]);
      });
    }

    const elementId = createId("me");
    const meshName = mesh.name || `${fileName} mesh ${index + 1}`;
    const material = colorToHex(mesh.color);
    totalSurfaceArea += metrics.surfaceArea;
    totalVolume += metrics.volume;
    totalTriangles += metrics.triangleCount;
    totalVertices += metrics.vertexCount;

    elements.push({
      id: elementId,
      externalId: `occt-mesh-${index}`,
      name: meshName,
      elementClass: "CAD_MESH",
      material,
      bbox: metrics.bbox ?? undefined,
      properties: {
        meshIndex: index,
        triangleCount: metrics.triangleCount,
        vertexCount: metrics.vertexCount,
        brepFaceCount: mesh.brep_faces?.length ?? 0,
        sourceColor: mesh.color ?? null,
      },
    });

    quantities.push(
      {
        id: createId("mq"),
        elementId,
        quantityType: "surface_area",
        value: metrics.surfaceArea,
        unit: quantityUnits.area,
        method: "occt_mesh_triangulation",
        confidence: 0.9,
        metadata: { meshIndex: index, source: "OpenCascade" },
      },
      {
        id: createId("mq"),
        elementId,
        quantityType: "triangle_count",
        value: metrics.triangleCount,
        unit: "triangles",
        method: "occt_mesh_triangulation",
        confidence: 1,
        metadata: { meshIndex: index },
      },
    );
    if (metrics.volume > 0) {
      quantities.push({
        id: createId("mq"),
        elementId,
        quantityType: "volume",
        value: metrics.volume,
        unit: quantityUnits.volume,
        method: "occt_closed_mesh_volume",
        confidence: 0.82,
        metadata: { meshIndex: index, source: "OpenCascade" },
      });
    }

    bomRows.push({
      group: "CAD_MESH",
      externalId: `occt-mesh-${index}`,
      description: meshName,
      quantity: metrics.surfaceArea,
      unit: quantityUnits.area,
      method: "occt_mesh_surface_area",
      metadata: {
        meshIndex: index,
        material,
        triangleCount: metrics.triangleCount,
        volume: metrics.volume,
        volumeUnit: quantityUnits.volume,
      },
    });
  }

  quantities.push(
    {
      id: createId("mq"),
      quantityType: "surface_area",
      value: totalSurfaceArea,
      unit: quantityUnits.area,
      method: "occt_mesh_triangulation_total",
      confidence: 0.9,
      metadata: { source: "OpenCascade" },
    },
    {
      id: createId("mq"),
      quantityType: "triangle_count",
      value: totalTriangles,
      unit: "triangles",
      method: "occt_mesh_triangulation_total",
      confidence: 1,
    },
    {
      id: createId("mq"),
      quantityType: "mesh_count",
      value: elements.length,
      unit: "EA",
      method: "occt_import",
      confidence: 1,
    },
  );
  if (totalVolume > 0) {
    quantities.push({
      id: createId("mq"),
      quantityType: "volume",
      value: totalVolume,
      unit: quantityUnits.volume,
      method: "occt_closed_mesh_volume_total",
      confidence: 0.82,
      metadata: { source: "OpenCascade" },
    });
  }

  const issues: GeneratedIssue[] = [];
  if (elements.length === 0) {
    issues.push({
      severity: "warning",
      code: "occt_no_meshes",
      message: "OpenCascade read the file but did not produce triangulated meshes.",
    });
  }
  if (totalVolume === 0 && elements.length > 0) {
    issues.push({
      severity: "info",
      code: "open_shell_or_non_solid_volume_unavailable",
      message: "Surface area was extracted, but no closed solid volume could be derived from the triangulated model.",
    });
  }

  return {
    status: elements.length > 0 ? "indexed" : "partial",
    units: quantityUnits.length,
    manifest: {
      parser: `occt-${ext}`,
      sourceKernel: "OpenCascade",
      linearUnit: quantityUnits.length,
      areaUnit: quantityUnits.area,
      volumeUnit: quantityUnits.volume,
      root: summarizeOcctNode(result.root),
      meshCount: elements.length,
      triangleCount: totalTriangles,
      vertexCount: totalVertices,
      surfaceArea: totalSurfaceArea,
      volume: totalVolume,
      bbox: finalizeBbox(modelBbox),
    },
    elementStats: {
      totalIndexedElements: elements.length,
      meshCount: elements.length,
      triangleCount: totalTriangles,
      vertexCount: totalVertices,
      surfaceArea: totalSurfaceArea,
      volume: totalVolume,
      bbox: finalizeBbox(modelBbox),
    },
    elements,
    quantities,
    bomRows,
    issues,
  };
}

function parseStepLike(text: string, ext: string): GeneratedManifest {
  const counts = new Map<string, number>();
  const entityRe = /#\d+\s*=\s*([A-Z0-9_]+)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = entityRe.exec(text))) {
    const key = match[1].toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const topEntities = topCounts(counts);
  const productNames = Array.from(text.matchAll(/PRODUCT\s*\(\s*'([^']*)'/gi)).slice(0, 25).map((m) => m[1]);
  const headerName = text.match(/FILE_NAME\s*\(\s*'([^']*)'/i)?.[1] ?? "";
  const issues: GeneratedIssue[] = [];
  if (ext === "step" || ext === "stp" || ext === "iges" || ext === "igs" || ext === "brep") {
    issues.push({
      severity: "info",
      code: "occt_fallback_entity_index_only",
      message: "OpenCascade mesh extraction was not available for this file, so BidWright indexed CAD entity counts only.",
    });
  }

  return {
    status: "partial",
    units: "",
    manifest: {
      parser: "step-like-entity-index",
      headerName,
      productNames,
      entityTypeCount: counts.size,
      topEntities,
    },
    elementStats: { entityTypeCount: counts.size, topEntities },
    elements: [],
    quantities: [],
    bomRows: [],
    issues,
  };
}

function parseIfc(text: string): GeneratedManifest {
  const counts = new Map<string, number>();
  const elements: GeneratedElement[] = [];
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
        properties: {
          expressId,
          globalId,
          rawName: name,
        },
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
    }));

  const quantities: GeneratedQuantity[] = bomRows.map((row) => ({
    id: createId("mq"),
    quantityType: "count",
    value: Number(row.quantity),
    unit: "EA",
    method: "ifc_entity_count",
    metadata: { group: row.group },
  }));

  return {
    status: "indexed",
    units: "",
    manifest: {
      parser: "ifc-entity-index",
      schema: text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1] ?? "",
      entityTypeCount: counts.size,
      topEntities: topCounts(counts),
      elementSampleCount: elements.length,
    },
    elementStats: { totalIndexedElements: elements.length, topEntities: topCounts(counts) },
    elements,
    quantities,
    bomRows,
    issues: elements.length >= 5000 ? [{
      severity: "warning",
      code: "element_index_truncated",
      message: "Only the first 5000 IFC element-like records were persisted for fast querying.",
    }] : [],
  };
}

function parseObj(text: string): GeneratedManifest {
  const vertices: number[][] = [];
  const groups = new Map<string, number>();
  const materials = new Map<string, number>();
  const bbox = emptyBbox();
  let currentGroup = "default";
  let currentMaterial = "";
  let faceCount = 0;
  let surfaceArea = 0;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [kind, ...parts] = trimmed.split(/\s+/);
    if (kind === "v" && parts.length >= 3) {
      const point = parts.slice(0, 3).map(Number);
      if (point.every(Number.isFinite)) {
        vertices.push(point);
        updateBbox(bbox, point);
      }
    } else if (kind === "o" || kind === "g") {
      currentGroup = parts.join(" ") || "default";
    } else if (kind === "usemtl") {
      currentMaterial = parts.join(" ");
    } else if (kind === "f" && parts.length >= 3) {
      faceCount++;
      groups.set(currentGroup, (groups.get(currentGroup) ?? 0) + 1);
      if (currentMaterial) materials.set(currentMaterial, (materials.get(currentMaterial) ?? 0) + 1);
      const indices = parts.map((part) => Number(part.split("/")[0])).filter(Number.isFinite);
      const points = indices.map((index) => vertices[index > 0 ? index - 1 : vertices.length + index]).filter(Boolean);
      for (let i = 1; i < points.length - 1; i++) {
        surfaceArea += triangleArea(points[0], points[i], points[i + 1]);
      }
    }
  }

  const bomRows = topCounts(groups, 100).map((row) => ({
    group: row.name,
    description: `OBJ group ${row.name}`,
    quantity: row.count,
    unit: "faces",
    method: "obj_group_face_count",
  }));

  return {
    status: "indexed",
    units: "model",
    manifest: {
      parser: "obj-index",
      vertexCount: vertices.length,
      faceCount,
      groupCount: groups.size,
      materialCount: materials.size,
      bbox: finalizeBbox(bbox),
    },
    elementStats: { vertexCount: vertices.length, faceCount, groups: topCounts(groups), materials: topCounts(materials) },
    elements: topCounts(groups, 500).map((group) => ({
      id: createId("me"),
      externalId: group.name,
      name: group.name,
      elementClass: "OBJ_GROUP",
      properties: { faceCount: group.count },
    })),
    quantities: [
      { id: createId("mq"), quantityType: "face_count", value: faceCount, unit: "faces", method: "obj_parser" },
      { id: createId("mq"), quantityType: "surface_area", value: surfaceArea, unit: "model^2", method: "obj_parser" },
    ],
    bomRows,
    issues: [],
  };
}

function parseStl(buffer: Buffer): GeneratedManifest {
  const bbox = emptyBbox();
  let triangleCount = 0;
  let surfaceArea = 0;
  let volume = 0;

  const binaryTriangleCount = buffer.length >= 84 ? buffer.readUInt32LE(80) : 0;
  const expectedBinarySize = 84 + binaryTriangleCount * 50;
  const looksBinary = binaryTriangleCount > 0 && expectedBinarySize === buffer.length;

  if (looksBinary) {
    triangleCount = binaryTriangleCount;
    for (let offset = 84; offset + 50 <= buffer.length; offset += 50) {
      const a = [buffer.readFloatLE(offset + 12), buffer.readFloatLE(offset + 16), buffer.readFloatLE(offset + 20)];
      const b = [buffer.readFloatLE(offset + 24), buffer.readFloatLE(offset + 28), buffer.readFloatLE(offset + 32)];
      const c = [buffer.readFloatLE(offset + 36), buffer.readFloatLE(offset + 40), buffer.readFloatLE(offset + 44)];
      [a, b, c].forEach((point) => updateBbox(bbox, point));
      surfaceArea += triangleArea(a, b, c);
      volume += signedTetraVolume(a, b, c);
    }
  } else {
    const text = buffer.toString("utf8");
    const vertices: number[][] = [];
    for (const match of text.matchAll(/vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g)) {
      const point = [Number(match[1]), Number(match[2]), Number(match[3])];
      if (point.every(Number.isFinite)) {
        vertices.push(point);
        updateBbox(bbox, point);
      }
    }
    triangleCount = Math.floor(vertices.length / 3);
    for (let i = 0; i + 2 < vertices.length; i += 3) {
      surfaceArea += triangleArea(vertices[i], vertices[i + 1], vertices[i + 2]);
      volume += signedTetraVolume(vertices[i], vertices[i + 1], vertices[i + 2]);
    }
  }

  const bomRows = [{
    group: "STL_MESH",
    description: "STL mesh",
    quantity: triangleCount,
    unit: "triangles",
    method: looksBinary ? "binary_stl_parser" : "ascii_stl_parser",
  }];

  return {
    status: "indexed",
    units: "model",
    manifest: {
      parser: looksBinary ? "binary-stl" : "ascii-stl",
      triangleCount,
      surfaceArea,
      volume: Math.abs(volume),
      bbox: finalizeBbox(bbox),
    },
    elementStats: { triangleCount },
    elements: [{
      id: createId("me"),
      externalId: "STL_MESH",
      name: "STL mesh",
      elementClass: "STL_MESH",
      bbox: finalizeBbox(bbox),
      properties: { triangleCount },
    }],
    quantities: [
      { id: createId("mq"), quantityType: "triangle_count", value: triangleCount, unit: "triangles", method: "stl_parser" },
      { id: createId("mq"), quantityType: "surface_area", value: surfaceArea, unit: "model^2", method: "stl_parser" },
      { id: createId("mq"), quantityType: "volume", value: Math.abs(volume), unit: "model^3", method: "stl_parser" },
    ],
    bomRows,
    issues: [],
  };
}

function parseGltf(text: string): GeneratedManifest {
  const parsed = JSON.parse(text);
  const bomRows = [
    { group: "nodes", description: "glTF nodes", quantity: parsed.nodes?.length ?? 0, unit: "EA", method: "gltf_json" },
    { group: "meshes", description: "glTF meshes", quantity: parsed.meshes?.length ?? 0, unit: "EA", method: "gltf_json" },
    { group: "materials", description: "glTF materials", quantity: parsed.materials?.length ?? 0, unit: "EA", method: "gltf_json" },
  ];
  return {
    status: "indexed",
    units: "",
    manifest: {
      parser: "gltf-json",
      asset: parsed.asset ?? null,
      nodeCount: parsed.nodes?.length ?? 0,
      meshCount: parsed.meshes?.length ?? 0,
      materialCount: parsed.materials?.length ?? 0,
    },
    elementStats: { nodeCount: parsed.nodes?.length ?? 0, meshCount: parsed.meshes?.length ?? 0 },
    elements: (parsed.nodes ?? []).slice(0, 1000).map((node: any, index: number) => ({
      id: createId("me"),
      externalId: `node-${index}`,
      name: node.name ?? `Node ${index + 1}`,
      elementClass: "GLTF_NODE",
      properties: node,
    })),
    quantities: bomRows.map((row) => ({
      id: createId("mq"),
      quantityType: "count",
      value: Number(row.quantity),
      unit: "EA",
      method: "gltf_json",
      metadata: { group: row.group },
    })),
    bomRows,
    issues: [],
  };
}

function parseGlb(buffer: Buffer): GeneratedManifest {
  if (buffer.toString("utf8", 0, 4) !== "glTF") {
    throw new Error("Invalid GLB header");
  }
  const jsonLength = buffer.readUInt32LE(12);
  const chunkType = buffer.toString("utf8", 16, 20);
  if (chunkType !== "JSON") {
    throw new Error("First GLB chunk is not JSON");
  }
  return parseGltf(buffer.toString("utf8", 20, 20 + jsonLength));
}

async function generateManifest(source: ModelSource, settings?: ModelIngestSettings): Promise<GeneratedManifest & { checksum: string; size: number }> {
  return generateModelIngestManifest(source, settings);
}

async function resolveProjectModelSource(
  projectId: string,
  sourceKind: ModelSourceKind,
  sourceId: string,
): Promise<ModelSource> {
  if (sourceKind === "source_document") {
    const document = await prisma.sourceDocument.findFirst({ where: { id: sourceId, projectId } });
    if (!document || !isModelFileName(document.fileName)) throw new Error("Model source not found");
    return {
      id: document.id,
      source: sourceKind,
      projectId,
      fileName: document.fileName,
      fileType: document.fileType,
      storagePath: document.storagePath,
      checksum: document.checksum,
    };
  }

  const node = await prisma.fileNode.findFirst({ where: { id: sourceId, projectId, type: "file" } });
  if (!node || !isModelFileName(node.name)) throw new Error("Model source not found");
  return {
    id: node.id,
    source: sourceKind,
    projectId,
    fileName: node.name,
    fileType: node.fileType,
    storagePath: node.storagePath,
    size: node.size,
    metadata: node.metadata,
  };
}

function modelAssetPayload(source: ModelSource, generated: GeneratedManifest & { checksum: string; size: number }) {
  const ext = getExt(source.fileName);
  return {
    projectId: source.projectId,
    sourceDocumentId: source.source === "source_document" ? source.id : null,
    fileNodeId: source.source === "file_node" ? source.id : null,
    fileName: source.fileName,
    fileType: source.fileType ?? ext,
    format: ext,
    status: generated.status,
    units: generated.units,
    checksum: generated.checksum,
    storagePath: source.storagePath ?? "",
    manifest: {
      ...generated.manifest,
      source: source.source,
      sourceId: source.id,
      size: generated.size,
      extension: ext,
      editableInBidWrightModelEditor: MODEL_EDITOR_EDITABLE_EXTENSIONS.has(ext),
      generatedAt: new Date().toISOString(),
    },
    bom: generated.bomRows,
    elementStats: generated.elementStats,
    metadata: {
      sourceMetadata: source.metadata ?? null,
    },
  };
}

function modelAssetShellPayload(source: ModelSource) {
  const ext = getExt(source.fileName);
  const sourceChecksum = source.checksum || `${source.source}:${source.id}:${source.storagePath ?? ""}:${source.size ?? ""}`;
  return {
    projectId: source.projectId,
    sourceDocumentId: source.source === "source_document" ? source.id : null,
    fileNodeId: source.source === "file_node" ? source.id : null,
    fileName: source.fileName,
    fileType: source.fileType ?? ext,
    format: ext,
    status: "pending",
    units: "",
    checksum: sourceChecksum,
    storagePath: source.storagePath ?? "",
    manifest: {
      parser: "pending",
      source: source.source,
      sourceId: source.id,
      size: source.size ?? null,
      extension: ext,
      editableInBidWrightModelEditor: MODEL_EDITOR_EDITABLE_EXTENSIONS.has(ext),
      discoveredAt: new Date().toISOString(),
    },
    bom: [],
    elementStats: {},
    metadata: {
      sourceMetadata: source.metadata ?? null,
    },
  };
}

async function collectProjectModelSources(projectId: string): Promise<ModelSource[]> {
  const [docs, nodes] = await Promise.all([
    prisma.sourceDocument.findMany({ where: { projectId } }),
    prisma.fileNode.findMany({ where: { projectId, type: "file" } }),
  ]);

  return [
    ...docs.filter((doc) => isModelFileName(doc.fileName)).map((doc): ModelSource => ({
      id: doc.id,
      source: "source_document",
      projectId,
      fileName: doc.fileName,
      fileType: doc.fileType,
      storagePath: doc.storagePath,
      checksum: doc.checksum,
    })),
    ...nodes.filter((node) => isModelFileName(node.name)).map((node): ModelSource => ({
      id: node.id,
      source: "file_node",
      projectId,
      fileName: node.name,
      fileType: node.fileType,
      storagePath: node.storagePath,
      size: node.size,
      metadata: node.metadata,
    })),
  ];
}

async function replaceModelChildren(modelId: string, generated: GeneratedManifest) {
  await prisma.$transaction([
    prisma.modelIssue.deleteMany({ where: { modelId } }),
    prisma.modelBom.deleteMany({ where: { modelId } }),
    prisma.modelElementConnection.deleteMany({ where: { modelId } }),
    prisma.modelTakeoffGroup.deleteMany({ where: { modelId } }),
    prisma.modelQuantity.deleteMany({ where: { modelId } }),
    prisma.modelElement.deleteMany({ where: { modelId } }),
  ]);

  if (generated.elements.length > 0) {
    await prisma.modelElement.createMany({
      data: generated.elements.map((element) => ({
        id: element.id,
        modelId,
        externalId: element.externalId,
        name: element.name,
        elementClass: element.elementClass,
        elementType: element.elementType ?? "",
        system: element.system ?? "",
        level: element.level ?? "",
        material: element.material ?? "",
        bbox: (element.bbox ?? {}) as any,
        geometryRef: element.geometryRef ?? "",
        // Typed BIM fields populated by adapters when available; fall back to
        // empty values so re-ingest doesn't clobber UI-set overrides handled
        // by a separate upsert path elsewhere.
        classification: (element.classification ?? {}) as any,
        lod: element.lod ?? "",
        lodSource: element.lodSource ?? "",
        properties: {
          ...(element.properties ?? {}),
          estimateRelevant: element.estimateRelevant ?? undefined,
        } as any,
      })),
    });
  }

  if (generated.quantities.length > 0) {
    const elementIds = new Set(generated.elements.map((element) => element.id));
    await prisma.modelQuantity.createMany({
      data: generated.quantities.map((quantity) => ({
        id: quantity.id,
        modelId,
        elementId: quantity.elementId && elementIds.has(quantity.elementId) ? quantity.elementId : null,
        quantityType: quantity.quantityType,
        value: quantity.value,
        unit: quantity.unit,
        method: quantity.method,
        confidence: quantity.confidence ?? 1,
        metadata: (quantity.metadata ?? {}) as any,
      })),
    });
  }

  await prisma.modelBom.create({
    data: {
      modelId,
      grouping: "native",
      filters: {},
      rows: generated.bomRows as any,
      createdBy: "model-ingestion",
    },
  });

  if (generated.issues.length > 0) {
    const elementIds = new Set(generated.elements.map((element) => element.id));
    await prisma.modelIssue.createMany({
      data: generated.issues.map((issue) => ({
        id: createId("mi"),
        modelId,
        elementId: issue.elementId && elementIds.has(issue.elementId) ? issue.elementId : null,
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        metadata: (issue.metadata ?? {}) as any,
      })),
    });
  }

  await rebuildModelTakeoffTopology(modelId, generated);
}

function applyTakeoffOverrides(
  sourceGroups: ModelTopologyGroupResult[],
  overrides: Array<{ id: string; kind: string; targetSignature: string; payload: unknown }>,
  elementIdByExternalId: Map<string, string>,
) {
  let groups = sourceGroups.map((group) => ({ ...group, memberElementIds: [...group.memberElementIds] }));
  for (const override of overrides) {
    const payload = override.payload && typeof override.payload === "object" && !Array.isArray(override.payload)
      ? override.payload as Record<string, unknown>
      : {};
    if (override.kind === "rename") {
      const name = typeof payload.name === "string" ? payload.name.trim() : "";
      if (name) groups = groups.map((group) => group.signature === override.targetSignature ? { ...group, name } : group);
      continue;
    }
    if (override.kind === "exclude") {
      const elementIds = Array.isArray(payload.elementExternalIds)
        ? new Set(payload.elementExternalIds.map(String).map((externalId) => elementIdByExternalId.get(externalId)).filter((id): id is string => Boolean(id)))
        : Array.isArray(payload.elementIds) ? new Set(payload.elementIds.map(String)) : null;
      if (!elementIds) groups = groups.filter((group) => group.signature !== override.targetSignature);
      else groups = groups
        .map((group) => group.signature === override.targetSignature
          ? { ...group, memberElementIds: group.memberElementIds.filter((id) => !elementIds.has(id)) }
          : group)
        .filter((group) => group.memberElementIds.length > 0);
      continue;
    }
    if (override.kind === "merge") {
      const sourceSignatures = Array.isArray(payload.sourceSignatures)
        ? new Set(payload.sourceSignatures.map(String))
        : new Set([override.targetSignature]);
      sourceSignatures.add(override.targetSignature);
      const sources = groups.filter((group) => sourceSignatures.has(group.signature));
      if (sources.length < 2) continue;
      const units = new Set(sources.map((group) => group.unit));
      const measurementTypes = new Set(sources.map((group) => group.measurementType));
      if (units.size > 1 || measurementTypes.size > 1) continue;
      const first = sources[0];
      groups = groups.filter((group) => !sourceSignatures.has(group.signature));
      groups.push({
        ...first,
        signature: `override-merge:${override.id}`,
        name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : sources.map((group) => group.name).join(" + "),
        source: "detected",
        confidence: Math.min(...sources.map((group) => group.confidence)),
        quantity: sources.reduce((sum, group) => sum + group.quantity, 0),
        memberElementIds: Array.from(new Set(sources.flatMap((group) => group.memberElementIds))).sort(),
        warnings: Array.from(new Set(sources.flatMap((group) => group.warnings))),
        metadata: { ...first.metadata, override: "merge", sourceSignatures: Array.from(sourceSignatures) },
      });
      continue;
    }
    if (override.kind === "split") {
      const target = groups.find((group) => group.signature === override.targetSignature);
      const parts = Array.isArray(payload.groups) ? payload.groups : [];
      if (!target || parts.length < 2) continue;
      groups = groups.filter((group) => group.signature !== override.targetSignature);
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        if (!part || typeof part !== "object" || Array.isArray(part)) continue;
        const record = part as Record<string, unknown>;
        const elementIds = Array.isArray(record.elementExternalIds)
          ? record.elementExternalIds
              .map(String)
              .map((externalId) => elementIdByExternalId.get(externalId))
              .filter((id): id is string => Boolean(id))
              .filter((id) => target.memberElementIds.includes(id))
          : Array.isArray(record.elementIds)
            ? record.elementIds.map(String).filter((id) => target.memberElementIds.includes(id))
          : [];
        if (elementIds.length === 0) continue;
        const explicitQuantity = typeof record.quantity === "number" && Number.isFinite(record.quantity) ? record.quantity : null;
        const share = elementIds.length / Math.max(1, target.memberElementIds.length);
        groups.push({
          ...target,
          signature: `override-split:${override.id}:${index}`,
          name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : `${target.name} ${index + 1}`,
          quantity: explicitQuantity ?? target.quantity * share,
          memberElementIds: elementIds,
          warnings: explicitQuantity == null
            ? [...target.warnings, "Quantity apportioned by split membership; review measurement"]
            : target.warnings,
          metadata: { ...target.metadata, override: "split", sourceSignature: target.signature },
        });
      }
    }
  }
  return groups;
}

async function rebuildModelTakeoffTopology(modelId: string, generated: GeneratedManifest) {
  const asset = await prisma.modelAsset.findUnique({ where: { id: modelId }, select: { projectId: true, units: true, metadata: true } });
  if (!asset) throw new Error(`Model ${modelId} not found`);
  const recipeCandidates = await prisma.modelTakeoffRecipe.findMany({
    where: { projectId: asset.projectId, isDefault: true, OR: [{ modelId }, { modelId: null }] },
    orderBy: { updatedAt: "desc" },
  });
  const activeRecipe = recipeCandidates.find((recipe) => recipe.modelId === modelId)
    ?? recipeCandidates.find((recipe) => recipe.modelId == null)
    ?? null;
  const recipeRules = activeRecipe?.rules && typeof activeRecipe.rules === "object" && !Array.isArray(activeRecipe.rules)
    ? activeRecipe.rules as Record<string, unknown>
    : {};
  const allowedAxes = new Set<ModelTopologyEstimateAxis>(["trade", "role", "specification", "material", "size", "system", "level", "elementClass", "elementType"]);
  const configuredAxes = Array.isArray(recipeRules.groupBy)
    ? Array.from(new Set(recipeRules.groupBy.map(String).filter((axis): axis is ModelTopologyEstimateAxis => allowedAxes.has(axis as ModelTopologyEstimateAxis))))
    : DEFAULT_MODEL_TOPOLOGY_ESTIMATE_AXES;
  const quantitiesByElement = new Map<string, GeneratedQuantity[]>();
  const elementByExternalId = new Map(generated.elements.map((element) => [element.externalId, element.id]));
  for (const quantity of generated.quantities) {
    const sourceId = quantity.elementId ?? "";
    const elementId = generated.elements.some((element) => element.id === sourceId)
      ? sourceId
      : elementByExternalId.get(sourceId) ?? sourceId;
    const bucket = quantitiesByElement.get(elementId) ?? [];
    bucket.push(quantity);
    quantitiesByElement.set(elementId, bucket);
  }
  const topology = buildModelTopology(generated.elements.map((element) => ({
    ...element,
    quantities: quantitiesByElement.get(element.id) ?? [],
  })), { units: asset.units ?? "", estimateGroupBy: configuredAxes.length > 0 ? configuredAxes : DEFAULT_MODEL_TOPOLOGY_ESTIMATE_AXES });
  const overrides = await prisma.modelTakeoffOverride.findMany({ where: { modelId, active: true }, orderBy: { createdAt: "asc" } });
  const groups = applyTakeoffOverrides(topology.groups, overrides, elementByExternalId);

  const groupIdBySignature = new Map(groups.map((group) => [group.signature, createId("mtg")]));
  const groupData = (group: ModelTopologyGroupResult) => ({
    id: groupIdBySignature.get(group.signature)!,
    modelId,
    parentId: group.parentSignature ? groupIdBySignature.get(group.parentSignature) ?? null : null,
    signature: group.signature,
    kind: group.kind,
    name: group.name,
    trade: group.trade,
    source: group.source,
    confidence: group.confidence,
    measurementType: group.measurementType,
    quantity: group.quantity,
    unit: group.unit,
    warnings: group.warnings as any,
    metadata: group.metadata as any,
  });
  const memberships = groups.flatMap((group) => Array.from(new Set(group.memberElementIds)).map((elementId, ordinal) => ({
    groupId: groupIdBySignature.get(group.signature)!,
    elementId,
    role: group.kind === "estimate" ? "estimating" : group.kind,
    ordinal,
    metadata: {} as any,
  })));

  // Persist the replacement graph atomically. A failed rebuild must leave the
  // last good topology intact rather than exposing a partially rebuilt model.
  await prisma.$transaction(async (tx) => {
    await tx.modelElementConnection.deleteMany({ where: { modelId } });
    await tx.modelTakeoffGroup.deleteMany({ where: { modelId } });

    if (topology.connections.length > 0) {
      await tx.modelElementConnection.createMany({
        data: topology.connections.map((connection) => ({
        modelId,
        fromElementId: connection.fromElementId,
        toElementId: connection.toElementId,
        signature: connection.signature,
        kind: connection.kind,
        source: connection.source,
        confidence: connection.confidence,
        metadata: connection.metadata as any,
        })),
      });
    }

    if (groups.length > 0) {
      const createdSignatures = new Set<string>();
      let pendingGroups = [...groups];
      while (pendingGroups.length > 0) {
        const ready = pendingGroups.filter((group) => !group.parentSignature || createdSignatures.has(group.parentSignature));
        if (ready.length === 0) {
          throw new Error(`Takeoff topology contains an unresolved parent cycle for model ${modelId}`);
        }
        await tx.modelTakeoffGroup.createMany({ data: ready.map(groupData) });
        ready.forEach((group) => createdSignatures.add(group.signature));
        const readySignatures = new Set(ready.map((group) => group.signature));
        pendingGroups = pendingGroups.filter((group) => !readySignatures.has(group.signature));
      }
      for (let offset = 0; offset < memberships.length; offset += 5_000) {
        await tx.modelTakeoffGroupMember.createMany({ data: memberships.slice(offset, offset + 5_000) });
      }
    }

    await tx.modelAsset.update({
      where: { id: modelId },
      data: {
        metadata: {
          ...(asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata) ? asset.metadata as Record<string, unknown> : {}),
          topology: {
            ...topology.diagnostics,
            version: topology.version,
            rebuiltAt: new Date().toISOString(),
            recipeId: activeRecipe?.id ?? null,
            recipeName: activeRecipe?.name ?? "Default estimating rollup",
            estimateGroupBy: configuredAxes,
          },
        } as any,
      },
    });
  }, { timeout: 120_000 });
}

export async function rebuildPersistedModelTopology(projectId: string, modelId: string) {
  const model = await prisma.modelAsset.findFirst({
    where: { id: modelId, projectId },
    include: { elements: { include: { quantities: true } } },
  });
  if (!model) throw new Error(`Model ${modelId} not found`);
  await rebuildModelTakeoffTopology(modelId, {
    status: "indexed",
    units: model.units,
    manifest: model.manifest as Record<string, unknown>,
    elementStats: model.elementStats as Record<string, unknown>,
    elements: model.elements.map((element) => ({
      id: element.id,
      externalId: element.externalId,
      name: element.name,
      elementClass: element.elementClass,
      elementType: element.elementType,
      system: element.system,
      level: element.level,
      material: element.material,
      bbox: element.bbox,
      geometryRef: element.geometryRef,
      classification: element.classification as Record<string, string>,
      lod: element.lod,
      lodSource: element.lodSource as "pset" | "manual" | "",
      properties: element.properties as Record<string, unknown>,
    })),
    quantities: model.elements.flatMap((element) => element.quantities.map((quantity) => ({
      id: quantity.id,
      elementId: element.id,
      quantityType: quantity.quantityType,
      value: quantity.value,
      unit: quantity.unit,
      method: quantity.method,
      confidence: quantity.confidence,
      metadata: quantity.metadata as Record<string, unknown>,
    }))),
    bomRows: [],
    issues: [],
  });
  return getModelTakeoffTopology(projectId, modelId);
}

export async function getModelTakeoffTopology(projectId: string, modelId: string, options: { includeConnections?: boolean } = {}) {
  const model = await prisma.modelAsset.findFirst({ where: { id: modelId, projectId }, select: { id: true, metadata: true } });
  if (!model) throw new Error(`Model ${modelId} not found`);
  const [groups, connections, connectionCount, recipes, overrides] = await Promise.all([
    prisma.modelTakeoffGroup.findMany({
      where: { modelId },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      include: {
        members: { orderBy: { ordinal: "asc" }, select: { elementId: true, role: true, ordinal: true } },
        _count: { select: { children: true } },
      },
    }),
    options.includeConnections
      ? prisma.modelElementConnection.findMany({ where: { modelId }, orderBy: { confidence: "desc" } })
      : Promise.resolve([]),
    prisma.modelElementConnection.count({ where: { modelId } }),
    prisma.modelTakeoffRecipe.findMany({ where: { projectId, OR: [{ modelId }, { modelId: null }] }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    prisma.modelTakeoffOverride.findMany({ where: { modelId, active: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const metadata = model.metadata && typeof model.metadata === "object" && !Array.isArray(model.metadata)
    ? model.metadata as Record<string, unknown>
    : {};
  return {
    version: 1,
    diagnostics: metadata.topology ?? {},
    groups: groups.map((group) => ({
      ...group,
      memberElementIds: group.members.map((member) => member.elementId),
      memberCount: group.members.length,
      childCount: group._count.children,
      members: undefined,
      _count: undefined,
    })),
    connections,
    connectionCount,
    recipes,
    overrides,
  };
}

export async function saveModelTakeoffRecipe(projectId: string, input: {
  id?: string;
  modelId?: string | null;
  name: string;
  trade?: string;
  isDefault?: boolean;
  rules?: Record<string, unknown>;
  createdBy?: string;
}) {
  if (input.modelId) {
    const model = await prisma.modelAsset.findFirst({ where: { id: input.modelId, projectId }, select: { id: true } });
    if (!model) throw new Error(`Model ${input.modelId} not found`);
  }
  const recipe = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.modelTakeoffRecipe.updateMany({
        where: { projectId, modelId: input.modelId ?? null },
        data: { isDefault: false },
      });
    }
    if (input.id) {
      const existing = await tx.modelTakeoffRecipe.findFirst({ where: { id: input.id, projectId } });
      if (!existing) throw new Error(`Takeoff recipe ${input.id} not found`);
      return tx.modelTakeoffRecipe.update({
        where: { id: input.id },
        data: { name: input.name, trade: input.trade ?? existing.trade, isDefault: input.isDefault ?? existing.isDefault, rules: (input.rules ?? existing.rules) as any },
      });
    }
    return tx.modelTakeoffRecipe.create({
      data: {
        projectId,
        modelId: input.modelId ?? null,
        name: input.name,
        trade: input.trade ?? "general",
        isDefault: input.isDefault ?? false,
        rules: (input.rules ?? {}) as any,
        createdBy: input.createdBy ?? "",
      },
    });
  });
  if (recipe.isDefault && recipe.modelId) await rebuildPersistedModelTopology(projectId, recipe.modelId);
  return recipe;
}

export async function deleteModelTakeoffRecipe(projectId: string, recipeId: string) {
  const recipe = await prisma.modelTakeoffRecipe.findFirst({ where: { id: recipeId, projectId } });
  if (!recipe) throw new Error(`Takeoff recipe ${recipeId} not found`);
  await prisma.modelTakeoffRecipe.delete({ where: { id: recipeId } });
  const topology = recipe.isDefault && recipe.modelId
    ? await rebuildPersistedModelTopology(projectId, recipe.modelId)
    : null;
  return { deleted: true, topology };
}

export async function createModelTakeoffOverride(projectId: string, modelId: string, input: {
  kind: "rename" | "exclude" | "merge" | "split";
  targetSignature: string;
  payload?: Record<string, unknown>;
  createdBy?: string;
}) {
  const model = await prisma.modelAsset.findFirst({ where: { id: modelId, projectId }, select: { id: true } });
  if (!model) throw new Error(`Model ${modelId} not found`);
  const override = await prisma.modelTakeoffOverride.create({
    data: { modelId, kind: input.kind, targetSignature: input.targetSignature, payload: (input.payload ?? {}) as any, createdBy: input.createdBy ?? "" },
  });
  const topology = await rebuildPersistedModelTopology(projectId, modelId);
  return { override, topology };
}

export async function deleteModelTakeoffOverride(projectId: string, modelId: string, overrideId: string) {
  const override = await prisma.modelTakeoffOverride.findFirst({ where: { id: overrideId, modelId, model: { projectId } } });
  if (!override) throw new Error(`Takeoff override ${overrideId} not found`);
  await prisma.modelTakeoffOverride.delete({ where: { id: overrideId } });
  const topology = await rebuildPersistedModelTopology(projectId, modelId);
  return { deleted: true, topology };
}

async function discoverProjectModelAssets(projectId: string) {
  const sources = await collectProjectModelSources(projectId);
  const discoveredIds: string[] = [];

  for (const source of sources) {
    const where = source.source === "source_document"
      ? { projectId, sourceDocumentId: source.id }
      : { projectId, fileNodeId: source.id };
    const existing = await prisma.modelAsset.findFirst({ where });

    if (!existing) {
      const created = await prisma.modelAsset.create({ data: modelAssetShellPayload(source) as any });
      discoveredIds.push(created.id);
      continue;
    }

    const ext = getExt(source.fileName);
    const fileType = source.fileType ?? ext;
    const storagePath = source.storagePath ?? "";
    if (
      existing.fileName !== source.fileName ||
      existing.fileType !== fileType ||
      existing.format !== ext ||
      existing.storagePath !== storagePath
    ) {
      const updated = await prisma.modelAsset.update({
        where: { id: existing.id },
        data: {
          fileName: source.fileName,
          fileType,
          format: ext,
          storagePath,
          manifest: {
            ...((existing.manifest ?? {}) as Record<string, unknown>),
            source: source.source,
            sourceId: source.id,
            extension: ext,
            editableInBidWrightModelEditor: MODEL_EDITOR_EDITABLE_EXTENSIONS.has(ext),
          } as any,
          metadata: {
            ...((existing.metadata ?? {}) as Record<string, unknown>),
            sourceMetadata: source.metadata ?? null,
          } as any,
        },
      });
      discoveredIds.push(updated.id);
    }
  }

  return {
    discoveredIds,
    sourceCount: sources.length,
  };
}

async function syncProjectModelSource(source: ModelSource, ingestSettings: ModelIngestSettings) {
  const generated = await generateManifest(source, ingestSettings);
  const payload = modelAssetPayload(source, generated);
  const existing = await prisma.modelAsset.findFirst({
    where: source.source === "source_document"
      ? { projectId: source.projectId, sourceDocumentId: source.id }
      : { projectId: source.projectId, fileNodeId: source.id },
  });
  const asset = existing
    ? await prisma.modelAsset.update({ where: { id: existing.id }, data: payload as any })
    : await prisma.modelAsset.create({ data: payload as any });
  await replaceModelChildren(asset.id, generated);
  return { asset, generated };
}

export async function syncProjectModelAssets(projectId: string, ingestSettings: ModelIngestSettings) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error(`Project ${projectId} not found`);

  const sources = await collectProjectModelSources(projectId);
  const syncedIds: string[] = [];

  for (const source of sources) {
    const { asset } = await syncProjectModelSource(source, ingestSettings);
    syncedIds.push(asset.id);
  }

  return {
    assets: await listProjectModelAssets(projectId, { discover: false }),
    syncedIds,
    sourceCount: sources.length,
  };
}

function integrationString(settings: ModelIngestSettings, key: string): string {
  const value = settings.integrations?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function assetErrorMessage(asset: { manifest: unknown }): string {
  const manifest = recordValue(asset.manifest);
  const direct = manifest.error;
  if (typeof direct === "string" && direct.trim()) return direct;
  const modelIngest = recordValue(manifest.modelIngest);
  const summary = recordValue(modelIngest.summary);
  return typeof summary.error === "string" && summary.error.trim()
    ? summary.error
    : "Autodesk APS could not prepare this model.";
}

async function existingSourceAsset(source: ModelSource) {
  return prisma.modelAsset.findFirst({
    where: source.source === "source_document"
      ? { projectId: source.projectId, sourceDocumentId: source.id }
      : { projectId: source.projectId, fileNodeId: source.id },
  });
}

function startViewerPreparation(source: ModelSource, settings: ModelIngestSettings, modelId: string) {
  const run = (async () => {
    const current = await prisma.modelAsset.findUnique({ where: { id: modelId }, select: { manifest: true } });
    await prisma.modelAsset.update({
      where: { id: modelId },
      data: {
        status: "processing",
        manifest: {
          ...recordValue(current?.manifest),
          parser: "autodesk-aps",
          processingStartedAt: new Date().toISOString(),
        } as any,
      },
    });
    return syncProjectModelSource(source, settings);
  })()
    .then(async ({ asset, generated }) => {
      if (generated.status === "failed") {
        await prisma.modelAsset.update({ where: { id: asset.id }, data: { status: "failed" } });
      }
    })
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : "Autodesk APS preparation failed";
      await prisma.modelAsset.update({
        where: { id: modelId },
        data: {
          status: "failed",
          manifest: { parser: "autodesk-aps", error: message, failedAt: new Date().toISOString() } as any,
        },
      }).catch(() => undefined);
    })
    .finally(() => activeViewerPreparations.delete(modelId));
  activeViewerPreparations.set(modelId, run);
}

export async function prepareProjectModelViewer(
  projectId: string,
  input: ProjectModelViewerInput,
  settings: ModelIngestSettings,
): Promise<ProjectModelViewerResult> {
  const source = await resolveProjectModelSource(projectId, input.sourceKind, input.sourceId);
  const extension = getExt(source.fileName);
  if (!APS_VIEWER_EXTENSIONS.has(extension)) throw new Error(`.${extension || "unknown"} is not an APS viewer source`);

  const clientId = integrationString(settings, "autodeskClientId");
  const clientSecret = integrationString(settings, "autodeskClientSecret");
  if (!clientId || !clientSecret) {
    throw new Error("Configure the Autodesk APS client ID and secret in Organization settings before opening Navisworks files.");
  }

  let asset = await existingSourceAsset(source);
  if (!asset) asset = await prisma.modelAsset.create({ data: modelAssetShellPayload(source) as any });

  const manifest = recordValue(asset.manifest);
  const urn = typeof manifest.urn === "string" ? manifest.urn : "";
  const region = typeof manifest.translationRegion === "string" ? manifest.translationRegion : "US";
  const recordedSize = typeof manifest.size === "number" ? manifest.size : null;
  const sourceChanged = asset.fileName !== source.fileName
    || asset.storagePath !== (source.storagePath ?? "")
    || Boolean(source.checksum && asset.checksum !== source.checksum)
    || Boolean(source.size != null && recordedSize != null && source.size !== recordedSize);
  // A successful APS derivative is durable. Opening or retrying the viewer must
  // never upload/translate an unchanged source again; `force` only recovers a
  // failed first translation. Changed source identity/fingerprint invalidates it.
  if (!sourceChanged && asset.status === "indexed" && urn) {
    const token = await new ApsClient(clientId, clientSecret).createViewerToken();
    return {
      status: "ready",
      modelId: asset.id,
      urn,
      accessToken: token.accessToken,
      expiresIn: token.expiresIn,
      api: region.toUpperCase().includes("EMEA") || region.toUpperCase().includes("EU") ? "streamingV2_EU" : "streamingV2",
      region,
    };
  }

  if (!input.force && asset.status === "failed") {
    return { status: "failed", modelId: asset.id, message: assetErrorMessage(asset) };
  }

  if (!activeViewerPreparations.has(asset.id)) {
    startViewerPreparation(source, settings, asset.id);
  }
  return {
    status: "processing",
    modelId: asset.id,
    message: "Uploading and translating the Navisworks model with Autodesk APS. This can take several minutes.",
  };
}

export async function getProjectModelIngestCapabilities(format?: string, settings?: ModelIngestSettings) {
  return {
    formats: Array.from(MODEL_EXTENSIONS).sort(),
    capabilities: await getModelIngestCapabilities(format, settings),
  };
}

export async function listProjectModelAssets(projectId: string, options: { discover?: boolean } = {}) {
  if (options.discover !== false) {
    await discoverProjectModelAssets(projectId);
  }
  return prisma.modelAsset.findMany({
    where: { projectId },
    orderBy: [{ updatedAt: "desc" }, { fileName: "asc" }],
    include: {
      _count: {
        select: {
          elements: true,
          quantities: true,
          issues: true,
          // ModelAsset's relation field is named `takeoffLinks` because it
          // points at ModelTakeoffLink[], a different model from PickupLink.
          // Do not rename — that join is BIM-element-to-worksheet, distinct
          // from the Pickup-to-worksheet rename we did elsewhere.
          takeoffLinks: true,
        },
      },
    },
  });
}

export async function getProjectModelAsset(projectId: string, modelId: string) {
  return prisma.modelAsset.findFirst({
    where: { id: modelId, projectId },
    include: {
      elements: { take: 250, orderBy: { elementClass: "asc" } },
      quantities: { take: 500, orderBy: { quantityType: "asc" } },
      boms: { orderBy: { createdAt: "desc" } },
      issues: { take: 250, orderBy: [{ severity: "desc" }, { createdAt: "desc" }] },
    },
  });
}

export async function queryModelElements(projectId: string, modelId: string, filters: Record<string, unknown>) {
  const model = await prisma.modelAsset.findFirst({ where: { id: modelId, projectId } });
  if (!model) throw new Error(`Model ${modelId} not found`);

  const where: any = { modelId };
  for (const key of ["elementClass", "elementType", "system", "level", "material", "name"] as const) {
    const value = filters[key];
    if (typeof value === "string" && value.trim()) {
      where[key] = { contains: value.trim(), mode: "insensitive" };
    }
  }

  const text = typeof filters.text === "string" ? filters.text.trim() : "";
  if (text) {
    where.OR = [
      { name: { contains: text, mode: "insensitive" } },
      { externalId: { contains: text, mode: "insensitive" } },
      { elementClass: { contains: text, mode: "insensitive" } },
      { elementType: { contains: text, mode: "insensitive" } },
      { system: { contains: text, mode: "insensitive" } },
      { level: { contains: text, mode: "insensitive" } },
      { material: { contains: text, mode: "insensitive" } },
    ];
  }

  const limit = Math.max(1, Math.min(1000, Number(filters.limit) || 100));
  const offset = Math.max(0, Number(filters.offset) || 0);
  const [count, elements] = await Promise.all([
    prisma.modelElement.count({ where }),
    prisma.modelElement.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: [{ elementClass: "asc" }, { name: "asc" }],
      include: {
        quantities: {
          orderBy: [{ quantityType: "asc" }, { createdAt: "asc" }],
        },
      },
    }),
  ]);
  return { elements, count, offset, limit };
}

export async function getModelBom(projectId: string, modelId: string) {
  const model = await prisma.modelAsset.findFirst({
    where: { id: modelId, projectId },
    include: { boms: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!model) throw new Error(`Model ${modelId} not found`);
  return {
    model,
    rows: (model.boms[0]?.rows ?? model.bom ?? []) as unknown[],
  };
}

function mapModelTakeoffLink(link: any) {
  return {
    id: link.id,
    projectId: link.projectId,
    modelId: link.modelId,
    modelElementId: link.modelElementId ?? null,
    modelQuantityId: link.modelQuantityId ?? null,
    worksheetItemId: link.worksheetItemId,
    quantityField: link.quantityField,
    multiplier: link.multiplier,
    derivedQuantity: link.derivedQuantity,
    selection: link.selection ?? {},
    createdAt: link.createdAt instanceof Date ? link.createdAt.toISOString() : link.createdAt,
    updatedAt: link.updatedAt instanceof Date ? link.updatedAt.toISOString() : link.updatedAt,
    modelElement: link.modelElement ?? null,
    modelQuantity: link.modelQuantity ?? null,
    worksheetItem: link.worksheetItem
      ? {
          ...link.worksheetItem,
          worksheet: link.worksheetItem.worksheet
            ? {
                id: link.worksheetItem.worksheet.id,
                name: link.worksheetItem.worksheet.name,
                order: link.worksheetItem.worksheet.order,
              }
            : null,
        }
      : null,
  };
}

export async function listModelTakeoffLinks(projectId: string, modelId: string) {
  const model = await prisma.modelAsset.findFirst({ where: { id: modelId, projectId } });
  if (!model) throw new Error(`Model ${modelId} not found`);

  const links = await prisma.modelTakeoffLink.findMany({
    where: { projectId, modelId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    include: {
      modelElement: true,
      modelQuantity: true,
      worksheetItem: {
        include: {
          worksheet: {
            select: {
              id: true,
              name: true,
              order: true,
            },
          },
        },
      },
    },
  });

  return links.map(mapModelTakeoffLink);
}

export async function createModelTakeoffLink(projectId: string, input: {
  modelId: string;
  modelElementId?: string | null;
  modelQuantityId?: string | null;
  worksheetItemId: string;
  quantityField?: string;
  multiplier?: number;
  derivedQuantity?: number;
  selection?: unknown;
}) {
  const model = await prisma.modelAsset.findFirst({ where: { id: input.modelId, projectId } });
  if (!model) throw new Error(`Model ${input.modelId} not found`);
  const item = await prisma.worksheetItem.findFirst({
    where: { id: input.worksheetItemId },
    include: { worksheet: { include: { revision: { include: { quote: true } } } } },
  });
  if (!item) throw new Error(`Worksheet item ${input.worksheetItemId} not found`);
  if (item.worksheet.revision.quote.projectId !== projectId) {
    throw new Error(`Worksheet item ${input.worksheetItemId} not found for project ${projectId}`);
  }

  const quantity = input.modelQuantityId
    ? await prisma.modelQuantity.findFirst({ where: { id: input.modelQuantityId, modelId: input.modelId } })
    : null;
  const multiplier = typeof input.multiplier === "number" && Number.isFinite(input.multiplier)
    ? input.multiplier
    : 1;

  return prisma.modelTakeoffLink.create({
    data: {
      projectId,
      modelId: input.modelId,
      modelElementId: input.modelElementId ?? null,
      modelQuantityId: input.modelQuantityId ?? null,
      worksheetItemId: input.worksheetItemId,
      quantityField: input.quantityField ?? "quantity",
      multiplier,
      derivedQuantity: typeof input.derivedQuantity === "number" && Number.isFinite(input.derivedQuantity)
        ? input.derivedQuantity
        : (quantity?.value ?? item.quantity ?? 0) * multiplier,
      selection: (input.selection ?? {}) as any,
    },
  });
}

export async function createModelTakeoffLinks(projectId: string, input: {
  modelId: string;
  worksheetItemId: string;
  links: Array<{
    modelElementId: string;
    modelQuantityId?: string | null;
    quantityField?: string;
    multiplier?: number;
    derivedQuantity: number;
    selection?: unknown;
  }>;
}) {
  const model = await prisma.modelAsset.findFirst({ where: { id: input.modelId, projectId } });
  if (!model) throw new Error(`Model ${input.modelId} not found`);
  const item = await prisma.worksheetItem.findFirst({
    where: { id: input.worksheetItemId },
    include: { worksheet: { include: { revision: { include: { quote: true } } } } },
  });
  if (!item || item.worksheet.revision.quote.projectId !== projectId) {
    throw new Error(`Worksheet item ${input.worksheetItemId} not found for project ${projectId}`);
  }

  const elementIds = Array.from(new Set(input.links.map((link) => link.modelElementId)));
  const quantityIds = Array.from(new Set(input.links.map((link) => link.modelQuantityId).filter((id): id is string => Boolean(id))));
  const [validElements, validQuantities] = await Promise.all([
    prisma.modelElement.findMany({ where: { modelId: input.modelId, id: { in: elementIds } }, select: { id: true } }),
    quantityIds.length > 0
      ? prisma.modelQuantity.findMany({ where: { modelId: input.modelId, id: { in: quantityIds } }, select: { id: true } })
      : Promise.resolve([]),
  ]);
  if (validElements.length !== elementIds.length || validQuantities.length !== quantityIds.length) {
    throw new Error("One or more BIM pickup links do not belong to this model");
  }

  const result = await prisma.modelTakeoffLink.createMany({
    data: input.links.map((link) => ({
      projectId,
      modelId: input.modelId,
      modelElementId: link.modelElementId,
      modelQuantityId: link.modelQuantityId ?? null,
      worksheetItemId: input.worksheetItemId,
      quantityField: link.quantityField ?? "quantity",
      multiplier: typeof link.multiplier === "number" && Number.isFinite(link.multiplier) ? link.multiplier : 1,
      derivedQuantity: link.derivedQuantity,
      selection: (link.selection ?? {}) as any,
    })),
  });
  return { count: result.count };
}

export async function deleteModelTakeoffLink(projectId: string, modelId: string, linkId: string) {
  const link = await prisma.modelTakeoffLink.findFirst({ where: { id: linkId, projectId, modelId } });
  if (!link) throw new Error(`Model takeoff link ${linkId} not found`);
  await prisma.modelTakeoffLink.delete({ where: { id: linkId } });
  return { deleted: true };
}

// ── Per-element classification/LOD updates ────────────────────────────────
//
// The BIM workspace UI calls this when the user tags an element manually.
// `classification` patches merge into the existing JSON blob; passing an empty
// object (or omitting the field) leaves the prior value untouched. Setting an
// individual key to "" deletes that classification standard for the element.
// LOD updates always set lodSource to "manual" so the next ingest doesn't
// clobber the manual override.

const elementUpdateClassificationSchema = {
  // Whitelisted standard keys. Anything else passed in the body is ignored to
  // keep the JSON blob clean and queryable.
  keys: ["masterformat", "uniformat", "omniclass", "uniclass", "din276", "nrm", "icms"] as const,
};

export interface UpdateModelElementInput {
  classification?: Record<string, string>;
  /** "100" | "200" | "300" | "350" | "400" | "500" | "" (clear). */
  lod?: string;
}

export async function updateModelElement(
  projectId: string,
  modelId: string,
  elementId: string,
  input: UpdateModelElementInput,
) {
  const element = await prisma.modelElement.findFirst({
    where: { id: elementId, modelId },
    select: { id: true, classification: true, modelId: true, model: { select: { projectId: true } } },
  });
  if (!element || element.model.projectId !== projectId) {
    throw new Error(`Model element ${elementId} not found`);
  }

  const data: any = {};

  if (input.classification && typeof input.classification === "object") {
    const next: Record<string, string> = { ...((element.classification as Record<string, string>) ?? {}) };
    for (const key of elementUpdateClassificationSchema.keys) {
      const incoming = input.classification[key];
      if (typeof incoming !== "string") continue;
      const trimmed = incoming.trim();
      if (trimmed) next[key] = trimmed;
      else delete next[key];
    }
    data.classification = next as any;
  }

  if (typeof input.lod === "string") {
    const lod = input.lod.trim();
    data.lod = lod;
    // Always tag manual on user edit so re-ingest preserves it.
    data.lodSource = lod ? "manual" : "";
  }

  if (Object.keys(data).length === 0) {
    return prisma.modelElement.findUniqueOrThrow({ where: { id: elementId } });
  }

  return prisma.modelElement.update({
    where: { id: elementId },
    data,
  });
}

// ── Federations ───────────────────────────────────────────────────────────
//
// A federation is a named grouping of one or more ModelAssets driving a single
// estimate. Standalone lifecycle, optionally linked to a QuoteRevision so a
// "scenario" estimate can pin a specific federation snapshot without affecting
// the project-wide working federation.

export interface CreateFederationInput {
  name: string;
  description?: string;
  revisionId?: string | null;
  status?: string;
  metadata?: unknown;
}

export interface UpdateFederationInput {
  name?: string;
  description?: string;
  revisionId?: string | null;
  status?: string;
  metadata?: unknown;
}

export interface UpsertFederationMemberInput {
  modelId: string;
  discipline?: string;
  role?: string;
  position?: number;
  metadata?: unknown;
}

export async function listProjectFederations(projectId: string, opts: { revisionId?: string | null } = {}) {
  const where: any = { projectId };
  if (opts.revisionId !== undefined) where.revisionId = opts.revisionId;
  return prisma.modelFederation.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    include: {
      members: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        include: {
          model: { select: { id: true, fileName: true, format: true, status: true, units: true } },
        },
      },
    },
  });
}

export async function getProjectFederation(projectId: string, federationId: string) {
  const federation = await prisma.modelFederation.findFirst({
    where: { id: federationId, projectId },
    include: {
      members: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        include: {
          model: { select: { id: true, fileName: true, format: true, status: true, units: true } },
        },
      },
    },
  });
  if (!federation) throw new Error(`Federation ${federationId} not found`);
  return federation;
}

export async function createProjectFederation(projectId: string, input: CreateFederationInput) {
  if (!input.name?.trim()) throw new Error("Federation name is required");
  if (input.revisionId) {
    // Validate the revision belongs to this project.
    const revision = await prisma.quoteRevision.findFirst({
      where: { id: input.revisionId, quote: { projectId } },
      select: { id: true },
    });
    if (!revision) throw new Error(`Revision ${input.revisionId} not found in project ${projectId}`);
  }
  return prisma.modelFederation.create({
    data: {
      projectId,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      revisionId: input.revisionId ?? null,
      status: input.status ?? "active",
      metadata: (input.metadata ?? {}) as any,
    },
    include: {
      members: { include: { model: { select: { id: true, fileName: true, format: true, status: true, units: true } } } },
    },
  });
}

export async function updateProjectFederation(
  projectId: string,
  federationId: string,
  input: UpdateFederationInput,
) {
  const existing = await prisma.modelFederation.findFirst({ where: { id: federationId, projectId } });
  if (!existing) throw new Error(`Federation ${federationId} not found`);
  if (input.revisionId !== undefined && input.revisionId !== null) {
    const revision = await prisma.quoteRevision.findFirst({
      where: { id: input.revisionId, quote: { projectId } },
      select: { id: true },
    });
    if (!revision) throw new Error(`Revision ${input.revisionId} not found in project ${projectId}`);
  }
  const data: any = {};
  if (typeof input.name === "string") data.name = input.name.trim();
  if (typeof input.description === "string") data.description = input.description.trim();
  if (input.revisionId !== undefined) data.revisionId = input.revisionId ?? null;
  if (typeof input.status === "string") data.status = input.status;
  if (input.metadata !== undefined) data.metadata = input.metadata as any;
  return prisma.modelFederation.update({
    where: { id: federationId },
    data,
    include: {
      members: { include: { model: { select: { id: true, fileName: true, format: true, status: true, units: true } } } },
    },
  });
}

export async function deleteProjectFederation(projectId: string, federationId: string) {
  const existing = await prisma.modelFederation.findFirst({ where: { id: federationId, projectId } });
  if (!existing) throw new Error(`Federation ${federationId} not found`);
  await prisma.modelFederation.delete({ where: { id: federationId } });
  return { deleted: true };
}

export async function upsertFederationMember(
  projectId: string,
  federationId: string,
  input: UpsertFederationMemberInput,
) {
  const federation = await prisma.modelFederation.findFirst({ where: { id: federationId, projectId } });
  if (!federation) throw new Error(`Federation ${federationId} not found`);
  const model = await prisma.modelAsset.findFirst({ where: { id: input.modelId, projectId } });
  if (!model) throw new Error(`Model ${input.modelId} not found in project`);

  return prisma.modelFederationMember.upsert({
    where: {
      federationId_modelId: { federationId, modelId: input.modelId },
    },
    create: {
      federationId,
      modelId: input.modelId,
      discipline: input.discipline ?? "other",
      role: input.role ?? "primary",
      position: input.position ?? 0,
      metadata: (input.metadata ?? {}) as any,
    },
    update: {
      ...(input.discipline !== undefined ? { discipline: input.discipline } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata as any } : {}),
    },
    include: { model: { select: { id: true, fileName: true, format: true, status: true, units: true } } },
  });
}

export async function removeFederationMember(
  projectId: string,
  federationId: string,
  modelId: string,
) {
  const federation = await prisma.modelFederation.findFirst({ where: { id: federationId, projectId } });
  if (!federation) throw new Error(`Federation ${federationId} not found`);
  await prisma.modelFederationMember.deleteMany({
    where: { federationId, modelId },
  });
  return { deleted: true };
}
