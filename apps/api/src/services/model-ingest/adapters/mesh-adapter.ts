import { readFile } from "node:fs/promises";
import type { ModelIngestCapability } from "@bidwright/domain";
import type { ModelAdapterIngestResult, ModelIngestAdapter, ModelIngestContext, ModelIngestSource } from "../types.js";
import {
  buildEstimateLens,
  createId,
  emptyBbox,
  finalizeBbox,
  makeCanonicalManifest,
  makeProvenance,
  MAX_GEOMETRY_BYTES,
  MAX_METRIC_TRIANGLES,
  MAX_METRIC_VERTICES,
  MAX_MESH_METRIC_BYTES,
  meshMetricsUnavailable,
  readTextIfReasonable,
  computeTriangulatedMeshMetrics,
  triangleArea,
  updateBbox,
  topCounts,
} from "../utils.js";

const ADAPTER_ID = "embedded-open.mesh";
const ADAPTER_VERSION = "1.1.0";
const FORMATS = new Set(["stl", "obj", "gltf", "glb", "dae", "fbx", "3ds"]);

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

class MeshPositions {
  private buffer = new Float64Array(9);
  private length = 0;
  push(...values: number[]) {
    if (this.length + values.length > this.buffer.length) {
      const next = new Float64Array(Math.min(MAX_METRIC_VERTICES * 3, Math.max(this.buffer.length * 2, this.length + values.length)));
      next.set(this.buffer); this.buffer = next;
    }
    this.buffer.set(values, this.length); this.length += values.length;
  }
  values() { return this.buffer.subarray(0, this.length); }
}

function parseObj(text: string, source: ModelIngestSource, context: ModelIngestContext): Omit<ModelAdapterIngestResult, "canonicalManifest" | "artifacts"> {
  let capacity = 0;
  for (const _match of text.matchAll(/^\s*v\s+/gm)) {
    if (++capacity > MAX_METRIC_VERTICES) return meshMetricsUnavailable("OBJ metrics not computed: vertex budget exceeded");
  }
  const vertices = new Float64Array(capacity * 3);
  let vertexCount = 0, triangleCount = 0;
  const groups = new Map<string, number>();
  const groupPositions = new Map<string, MeshPositions>();
  const materials = new Map<string, number>();
  const bbox = emptyBbox();
  let currentGroup = "default";
  let currentMaterial = "";
  let faceCount = 0;
  let surfaceArea = 0;

  for (const [line] of text.matchAll(/[^\r\n]+/g)) {
    if (line.length > 65536) return meshMetricsUnavailable("OBJ metrics not computed: record exceeds parse budget");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [kind, ...parts] = trimmed.split(/\s+/);
    if (kind === "v" && parts.length >= 3) {
      const point = parts.slice(0, 3).map(Number);
      if (point.every(Number.isFinite)) {
        vertices.set(point, vertexCount++ * 3);
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
      const points = indices.map((index) => index > 0 ? index - 1 : vertexCount + index)
        .filter((index) => Number.isInteger(index) && index >= 0 && index < vertexCount)
        .map((index) => [vertices[index * 3], vertices[index * 3 + 1], vertices[index * 3 + 2]]);
      for (let i = 1; i < points.length - 1; i++) {
        if (++triangleCount > MAX_METRIC_TRIANGLES) return meshMetricsUnavailable("OBJ metrics not computed: triangle budget exceeded");
        surfaceArea += triangleArea(points[0], points[i], points[i + 1]);
        const positions = groupPositions.get(currentGroup) ?? new MeshPositions();
        positions.push(...points[0], ...points[i], ...points[i + 1]);
        groupPositions.set(currentGroup, positions);
      }
    }
  }

  const elements = [...groups].map(([name, count]) => {
    const metrics = computeTriangulatedMeshMetrics(groupPositions.get(name)?.values());
    return {
      id: createId("me"), externalId: name, name, elementClass: "OBJ_GROUP", elementType: "OBJ",
      bbox: metrics.bbox ?? undefined, geometryRef: name, estimateRelevant: true,
      properties: { faceCount: count, sourceChecksum: context.checksum, closed: metrics.closed, volumeStatus: metrics.volumeStatus,
        surfaceArea: metrics.surfaceArea, volume: metrics.volume },
    };
  });
  const quantities = [
    ...elements.flatMap((element) => [
      { id: createId("mq"), elementId: element.id, quantityType: "surface_area", value: element.properties.surfaceArea, unit: "model^2", method: "obj_mesh_surface_area", confidence: 0.72 },
      ...(element.properties.closed ? [{ id: createId("mq"), elementId: element.id, quantityType: "volume", value: element.properties.volume, unit: "model^3", method: "obj_closed_mesh_volume", confidence: 0.7 }] : []),
    ]),
    { id: createId("mq"), quantityType: "face_count", value: faceCount, unit: "faces", method: "obj_parser", confidence: 1 },
    { id: createId("mq"), quantityType: "surface_area", value: surfaceArea, unit: "model^2", method: "obj_parser", confidence: 0.72 },
  ];
  const bomRows = topCounts(groups, 100).map((row) => ({
    group: row.name,
    description: `OBJ group ${row.name}`,
    quantity: row.count,
    unit: "faces",
    method: "obj_group_face_count",
    source: "model-ingest",
  }));
  return {
    status: "indexed",
    units: "model",
    manifest: {
      parser: "obj-index",
      vertexCount,
      faceCount,
      groupCount: groups.size,
      materialCount: materials.size,
      bbox: finalizeBbox(bbox),
      sourceFileName: source.fileName,
    },
    elementStats: { vertexCount, faceCount, groups: topCounts(groups), materials: topCounts(materials) },
    elements,
    quantities,
    bomRows,
    issues: [],
  };
}

function parseStl(buffer: Buffer): Omit<ModelAdapterIngestResult, "canonicalManifest" | "artifacts"> {
  if (buffer.length > MAX_MESH_METRIC_BYTES) return meshMetricsUnavailable("STL metrics not computed: input byte budget exceeded");
  const binaryTriangleCount = buffer.length >= 84 ? buffer.readUInt32LE(80) : 0;
  const looksBinary = binaryTriangleCount > 0 && 84 + binaryTriangleCount * 50 === buffer.length;
  let positions: Float64Array;
  if (looksBinary) {
    if (binaryTriangleCount > MAX_METRIC_TRIANGLES) return meshMetricsUnavailable("STL metrics not computed: triangle budget exceeded");
    positions = new Float64Array(binaryTriangleCount * 9);
    for (let triangle = 0; triangle < binaryTriangleCount; triangle++) {
      for (let axis = 0; axis < 9; axis++) positions[triangle * 9 + axis] = buffer.readFloatLE(84 + triangle * 50 + 12 + axis * 4);
    }
  } else {
    const text = buffer.toString("utf8");
    const pattern = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
    let count = 0;
    for (const _match of text.matchAll(pattern)) {
      if (++count > MAX_METRIC_VERTICES) return meshMetricsUnavailable("STL metrics not computed: vertex budget exceeded");
    }
    positions = new Float64Array(count * 3);
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      positions[offset++] = Number(match[1]); positions[offset++] = Number(match[2]); positions[offset++] = Number(match[3]);
    }
  }
  const metrics = computeTriangulatedMeshMetrics(positions);
  if (metrics.skipped) return meshMetricsUnavailable(metrics.facts.join("; "));
  const { volume, surfaceArea, triangleCount } = metrics;
  const elementId = createId("me");
  return {
    status: "indexed",
    units: "model",
    manifest: {
      parser: looksBinary ? "binary-stl" : "ascii-stl",
      triangleCount,
      surfaceArea,
      volume: Math.abs(volume),
      bbox: metrics.bbox,
    },
    elementStats: { triangleCount, surfaceArea, volume: Math.abs(volume) },
    elements: [{
      id: elementId,
      externalId: "STL_MESH",
      name: "STL mesh",
      elementClass: "STL_MESH",
      elementType: "STL",
      bbox: metrics.bbox ?? undefined,
      geometryRef: "STL_MESH",
      estimateRelevant: true,
      properties: { triangleCount, closed: metrics.closed, volumeStatus: metrics.volumeStatus },
    }],
    quantities: [
      { id: createId("mq"), elementId, quantityType: "triangle_count", value: triangleCount, unit: "triangles", method: "stl_parser", confidence: 1 },
      { id: createId("mq"), elementId, quantityType: "surface_area", value: surfaceArea, unit: "model^2", method: "stl_parser", confidence: 0.78 },
      ...(metrics.closed ? [{ id: createId("mq"), elementId, quantityType: "volume", value: volume, unit: "model^3", method: "stl_closed_mesh_volume", confidence: 0.7 }] : []),
    ],
    bomRows: [{
      group: "STL_MESH",
      description: "STL mesh",
      quantity: triangleCount,
      unit: "triangles",
      method: looksBinary ? "binary_stl_parser" : "ascii_stl_parser",
      source: "model-ingest",
    }],
    issues: [],
  };
}

function parseGltfJson(parsed: any): Omit<ModelAdapterIngestResult, "canonicalManifest" | "artifacts"> {
  const bomRows = [
    { group: "nodes", description: "glTF nodes", quantity: parsed.nodes?.length ?? 0, unit: "EA", method: "gltf_json", source: "model-ingest" },
    { group: "meshes", description: "glTF meshes", quantity: parsed.meshes?.length ?? 0, unit: "EA", method: "gltf_json", source: "model-ingest" },
    { group: "materials", description: "glTF materials", quantity: parsed.materials?.length ?? 0, unit: "EA", method: "gltf_json", source: "model-ingest" },
  ];
  const elements = (parsed.nodes ?? []).slice(0, 1000).map((node: any, index: number) => ({
    id: createId("me"),
    externalId: `node-${index}`,
    name: node.name ?? `Node ${index + 1}`,
    elementClass: "GLTF_NODE",
    elementType: "GLTF",
    geometryRef: `node-${index}`,
    estimateRelevant: false,
    properties: node,
  }));
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
    elements,
    quantities: bomRows.map((row) => ({
      id: createId("mq"),
      quantityType: "count",
      value: Number(row.quantity),
      unit: "EA",
      method: "gltf_json",
      confidence: 0.85,
      metadata: { group: row.group },
    })),
    bomRows,
    issues: [],
  };
}

function parseGlb(buffer: Buffer) {
  if (buffer.toString("utf8", 0, 4) !== "glTF") {
    throw new Error("Invalid GLB header");
  }
  const jsonLength = buffer.readUInt32LE(12);
  const chunkType = buffer.toString("utf8", 16, 20);
  if (chunkType !== "JSON") {
    throw new Error("First GLB chunk is not JSON");
  }
  return parseGltfJson(JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength)));
}

export const meshAdapter: ModelIngestAdapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,
  formats: FORMATS,
  priority: 80,
  capability() {
    return capability();
  },
  async ingest(source: ModelIngestSource, context: ModelIngestContext): Promise<ModelAdapterIngestResult> {
    let result: Omit<ModelAdapterIngestResult, "canonicalManifest" | "artifacts">;
    if (["stl", "obj"].includes(context.format) && context.size > MAX_MESH_METRIC_BYTES) {
      result = meshMetricsUnavailable(`${context.format.toUpperCase()} metrics not computed: ${MAX_MESH_METRIC_BYTES} byte input budget exceeded`);
    } else if (context.format === "stl") {
      if (context.size > MAX_GEOMETRY_BYTES) throw new Error(`STL is too large for synchronous geometry indexing (${context.size} bytes).`);
      result = parseStl(await readFile(context.absPath));
    } else if (context.format === "obj") {
      const text = await readTextIfReasonable(context.absPath, context.size);
      result = text ? parseObj(text, source, context) : meshMetricsUnavailable("OBJ metrics not computed: text input budget exceeded");
    } else if (context.format === "gltf") {
      const text = await readTextIfReasonable(context.absPath, context.size);
      if (!text) throw new Error("glTF is too large for synchronous JSON indexing.");
      result = parseGltfJson(JSON.parse(text));
    } else if (context.format === "glb") {
      if (context.size > MAX_GEOMETRY_BYTES) throw new Error(`GLB is too large for synchronous manifest indexing (${context.size} bytes).`);
      result = parseGlb(await readFile(context.absPath));
    } else {
      result = {
        status: "partial",
        units: "",
        manifest: {
          parser: "embedded-mesh-file-manifest",
          note: `${context.format.toUpperCase()} is viewable in BidWright but has no server-side quantity extractor yet.`,
        },
        elementStats: {},
        elements: [],
        quantities: [],
        bomRows: [],
        issues: [{
          severity: "info",
          code: "server_mesh_extractor_not_available",
          message: `Server-side model quantity extraction is not implemented for .${context.format} yet.`,
        }],
      };
    }

    const activeCapability = capability();
    const provenance = makeProvenance({
      source,
      format: context.format,
      checksum: context.checksum,
      size: context.size,
      capability: activeCapability,
      method: String(result.manifest.parser ?? "embedded-mesh"),
      confidence: result.status === "indexed" ? 0.8 : 0.45,
    });
    const estimateLens = buildEstimateLens({
      elements: result.elements,
      quantities: result.quantities,
      defaultSource: "geometry-derived",
    });
    const canonicalManifest = makeCanonicalManifest({
      status: result.status,
      units: result.units,
      capability: activeCapability,
      provenance,
      summary: result.manifest,
      elementStats: result.elementStats,
      estimateLens,
      issues: result.issues,
      geometryArtifacts: [{
        id: createId("mga"),
        format: context.format === "gltf" || context.format === "glb" ? "gltf" : context.format === "obj" ? "obj" : context.format === "stl" ? "stl" : "native",
        meshRefs: result.elements.map((element) => element.geometryRef ?? element.externalId),
        units: result.units,
        metadata: { sourceFormat: context.format },
      }],
    });

    return {
      ...result,
      canonicalManifest,
      artifacts: [],
    };
  },
};
