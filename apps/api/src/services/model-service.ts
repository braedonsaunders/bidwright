import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { prisma } from "@bidwright/db";
import { resolveApiPath } from "../paths.js";

const MODEL_EXTENSIONS = new Set([
  "step", "stp", "iges", "igs", "brep", "stl", "obj", "fbx", "gltf", "glb", "3ds", "dae", "ifc", "dwg", "dxf", "rvt",
]);
const MODEL_EDITOR_EDITABLE_EXTENSIONS = new Set(["step", "stp", "iges", "igs", "brep", "stl"]);
const MAX_TEXT_BYTES = 12 * 1024 * 1024;
const MAX_GEOMETRY_BYTES = 80 * 1024 * 1024;
const CAD_GEOMETRY_EXTENSIONS = new Set(["step", "stp", "iges", "igs", "brep"]);
const OCCT_LINEAR_UNIT = "foot";
const require = createRequire(import.meta.url);

type ModelSourceKind = "source_document" | "file_node";

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
  return MODEL_EXTENSIONS.has(getExt(fileName));
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

async function generateManifest(source: ModelSource): Promise<GeneratedManifest & { checksum: string; size: number }> {
  if (!source.storagePath) {
    return {
      status: "failed",
      units: "",
      checksum: source.checksum ?? "",
      size: 0,
      manifest: { parser: "none", error: "Source has no storagePath" },
      elementStats: {},
      elements: [],
      quantities: [],
      bomRows: [],
      issues: [{ severity: "error", code: "missing_storage_path", message: "Source model has no stored file path." }],
    };
  }

  const absPath = resolveApiPath(source.storagePath);
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(absPath);
  } catch {
    return {
      status: "failed",
      units: "",
      checksum: source.checksum ?? "",
      size: source.size ?? 0,
      manifest: { parser: "none", error: `Source file not found: ${source.storagePath}` },
      elementStats: {},
      elements: [],
      quantities: [],
      bomRows: [],
      issues: [{ severity: "error", code: "missing_source_file", message: "Source model file was not found on disk." }],
    };
  }
  const checksum = source.checksum || await sha256File(absPath);
  const ext = getExt(source.fileName);

  try {
    if (ext === "stl") {
      if (fileStat.size > MAX_GEOMETRY_BYTES) {
        throw new Error(`STL is too large for synchronous geometry indexing (${fileStat.size} bytes)`);
      }
      return { ...parseStl(await readFile(absPath)), checksum, size: fileStat.size };
    }

    if (ext === "obj") {
      const text = await readTextIfReasonable(absPath, fileStat.size);
      if (!text) throw new Error("OBJ is too large for synchronous text indexing");
      return { ...parseObj(text), checksum, size: fileStat.size };
    }

    if (ext === "ifc") {
      const text = await readTextIfReasonable(absPath, fileStat.size);
      if (!text) throw new Error("IFC is too large for synchronous text indexing");
      return { ...parseIfc(text), checksum, size: fileStat.size };
    }

    if (ext === "gltf") {
      const text = await readTextIfReasonable(absPath, fileStat.size);
      if (!text) throw new Error("glTF is too large for synchronous JSON indexing");
      return { ...parseGltf(text), checksum, size: fileStat.size };
    }

    if (ext === "glb") {
      if (fileStat.size > MAX_GEOMETRY_BYTES) {
        throw new Error(`GLB is too large for synchronous manifest indexing (${fileStat.size} bytes)`);
      }
      return { ...parseGlb(await readFile(absPath)), checksum, size: fileStat.size };
    }

    if (CAD_GEOMETRY_EXTENSIONS.has(ext)) {
      if (fileStat.size <= MAX_GEOMETRY_BYTES) {
        try {
          return { ...(await parseCadWithOcct(await readFile(absPath), ext, source.fileName)), checksum, size: fileStat.size };
        } catch (error) {
          const text = await readTextIfReasonable(absPath, fileStat.size);
          if (text) {
            const fallback = parseStepLike(text, ext);
            fallback.issues.unshift({
              severity: "warning",
              code: "occt_import_failed",
              message: error instanceof Error ? error.message : "OpenCascade CAD import failed.",
            });
            return { ...fallback, checksum, size: fileStat.size };
          }
          throw error;
        }
      }
      const text = await readTextIfReasonable(absPath, fileStat.size);
      if (!text) throw new Error(`${ext.toUpperCase()} is too large for synchronous geometry or entity indexing`);
      const fallback = parseStepLike(text, ext);
      fallback.issues.unshift({
        severity: "warning",
        code: "occt_file_too_large",
        message: `${ext.toUpperCase()} is too large for synchronous OpenCascade extraction (${fileStat.size} bytes).`,
      });
      return { ...fallback, checksum, size: fileStat.size };
    }

    return {
      status: "partial",
      units: "",
      checksum,
      size: fileStat.size,
      manifest: {
        parser: "file-manifest",
        note: "Format is viewable in BidWright but does not yet have server-side quantity extraction.",
      },
      elementStats: {},
      elements: [],
      quantities: [],
      bomRows: [],
      issues: [{
        severity: "info",
        code: "server_extractor_not_available",
        message: `Server-side model extraction is not implemented for .${ext} yet.`,
      }],
    };
  } catch (error) {
    return {
      status: "failed",
      units: "",
      checksum,
      size: fileStat.size,
      manifest: { parser: "failed", error: error instanceof Error ? error.message : String(error) },
      elementStats: {},
      elements: [],
      quantities: [],
      bomRows: [],
      issues: [{
        severity: "error",
        code: "manifest_generation_failed",
        message: error instanceof Error ? error.message : "Model manifest generation failed.",
      }],
    };
  }
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
        geometryRef: "",
        properties: (element.properties ?? {}) as any,
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
}

export async function syncProjectModelAssets(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error(`Project ${projectId} not found`);

  const sources = await collectProjectModelSources(projectId);
  const syncedIds: string[] = [];

  for (const source of sources) {
    const generated = await generateManifest(source);
    const payload = modelAssetPayload(source, generated);
    const existing = await prisma.modelAsset.findFirst({
      where: source.source === "source_document"
        ? { projectId, sourceDocumentId: source.id }
        : { projectId, fileNodeId: source.id },
    });

    const asset = existing
      ? await prisma.modelAsset.update({ where: { id: existing.id }, data: payload as any })
      : await prisma.modelAsset.create({ data: payload as any });

    await replaceModelChildren(asset.id, generated);
    syncedIds.push(asset.id);
  }

  return {
    assets: await listProjectModelAssets(projectId),
    syncedIds,
    sourceCount: sources.length,
  };
}

export async function listProjectModelAssets(projectId: string) {
  return prisma.modelAsset.findMany({
    where: { projectId },
    orderBy: [{ updatedAt: "desc" }, { fileName: "asc" }],
    include: {
      _count: {
        select: {
          elements: true,
          quantities: true,
          issues: true,
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
      { material: { contains: text, mode: "insensitive" } },
    ];
  }

  const limit = Math.max(1, Math.min(1000, Number(filters.limit) || 100));
  return prisma.modelElement.findMany({
    where,
    take: limit,
    orderBy: [{ elementClass: "asc" }, { name: "asc" }],
    include: {
      quantities: {
        orderBy: [{ quantityType: "asc" }, { createdAt: "asc" }],
      },
    },
  });
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

export async function deleteModelTakeoffLink(projectId: string, modelId: string, linkId: string) {
  const link = await prisma.modelTakeoffLink.findFirst({ where: { id: linkId, projectId, modelId } });
  if (!link) throw new Error(`Model takeoff link ${linkId} not found`);
  await prisma.modelTakeoffLink.delete({ where: { id: linkId } });
  return { deleted: true };
}
