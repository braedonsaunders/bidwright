import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { ModelIngestCapability } from "@bidwright/domain";
import type { ModelAdapterIngestResult, ModelIngestAdapter, ModelIngestContext, ModelIngestSource } from "../types.js";
import {
  buildEstimateLens,
  colorToHex,
  computeTriangulatedMeshMetrics,
  createId,
  makeCanonicalManifest,
  makeProvenance,
  MAX_GEOMETRY_BYTES,
} from "../utils.js";

const require = createRequire(import.meta.url);
const ADAPTER_ID = "embedded-open.occt";
const ADAPTER_VERSION = "1.0.0";
const FORMATS = new Set(["step", "stp", "iges", "igs", "brep"]);
const OCCT_LINEAR_UNIT = "foot";

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

function summarizeOcctNode(node: OcctNode | undefined, depth = 0): Record<string, unknown> | null {
  if (!node) return null;
  return {
    name: node.name ?? "",
    meshCount: node.meshes?.length ?? 0,
    childCount: node.children?.length ?? 0,
    children: depth < 3 ? (node.children ?? []).slice(0, 50).map((child) => summarizeOcctNode(child, depth + 1)) : [],
  };
}

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
      properties: false,
      quantities: true,
      estimateLens: true,
      rawArtifacts: true,
    },
  };
}

export const occtAdapter: ModelIngestAdapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,
  formats: FORMATS,
  priority: 100,
  async capability() {
    try {
      await loadOcctImport();
      return capability();
    } catch (error) {
      return capability("failed", error instanceof Error ? error.message : "OpenCascade runtime could not be loaded.");
    }
  },
  async ingest(source: ModelIngestSource, context: ModelIngestContext): Promise<ModelAdapterIngestResult> {
    const activeCapability = await this.capability(context.format);
    if (activeCapability.status !== "available") {
      throw new Error(activeCapability.message ?? "OpenCascade adapter is unavailable.");
    }
    if (context.size > MAX_GEOMETRY_BYTES) {
      throw new Error(`${context.format.toUpperCase()} is too large for synchronous OpenCascade extraction (${context.size} bytes).`);
    }

    const buffer = await readFile(context.absPath);
    const occt = await loadOcctImport();
    const params = context.format === "brep"
      ? null
      : {
          linearUnit: OCCT_LINEAR_UNIT,
          linearDeflectionType: "bounding_box_ratio",
          linearDeflection: 0.001,
          angularDeflection: 0.5,
        };
    const result =
      context.format === "brep" ? occt.ReadBrepFile(buffer, null) :
      context.format === "iges" || context.format === "igs" ? occt.ReadIgesFile(buffer, params) :
      occt.ReadStepFile(buffer, params);

    if (!result.success) {
      throw new Error(result.error || `OpenCascade failed to read ${source.fileName}`);
    }

    const quantityUnits = context.format === "brep"
      ? { length: "model", area: "model^2", volume: "model^3" }
      : { length: "ft", area: "SF", volume: "CF" };
    const elements = [];
    const quantities = [];
    const bomRows: Array<Record<string, unknown>> = [];
    let totalSurfaceArea = 0;
    let totalVolume = 0;
    let totalTriangles = 0;
    let totalVertices = 0;

    for (const [index, mesh] of (result.meshes ?? []).entries()) {
      const metrics = computeTriangulatedMeshMetrics(mesh.attributes?.position?.array, mesh.index?.array);
      const elementId = createId("me");
      const meshName = mesh.name || `${source.fileName} mesh ${index + 1}`;
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
        elementType: context.format.toUpperCase(),
        material,
        bbox: metrics.bbox ?? undefined,
        geometryRef: `occt-mesh-${index}`,
        estimateRelevant: true,
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
          metadata: { meshIndex: index, source: "OpenCascade", provenanceChecksum: context.checksum },
        },
        {
          id: createId("mq"),
          elementId,
          quantityType: "triangle_count",
          value: metrics.triangleCount,
          unit: "triangles",
          method: "occt_mesh_triangulation",
          confidence: 1,
          metadata: { meshIndex: index, provenanceChecksum: context.checksum },
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
          metadata: { meshIndex: index, source: "OpenCascade", provenanceChecksum: context.checksum },
        });
      }

      bomRows.push({
        group: "CAD_MESH",
        externalId: `occt-mesh-${index}`,
        description: meshName,
        quantity: metrics.surfaceArea,
        unit: quantityUnits.area,
        method: "occt_mesh_surface_area",
        source: "model-ingest",
        metadata: {
          meshIndex: index,
          material,
          triangleCount: metrics.triangleCount,
          volume: metrics.volume,
          volumeUnit: quantityUnits.volume,
          provenanceChecksum: context.checksum,
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
        metadata: { source: "OpenCascade", provenanceChecksum: context.checksum },
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
        metadata: { source: "OpenCascade", provenanceChecksum: context.checksum },
      });
    }

    const issues = [];
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

    const summary = {
      parser: `occt-${context.format}`,
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
    };
    const elementStats = {
      totalIndexedElements: elements.length,
      meshCount: elements.length,
      triangleCount: totalTriangles,
      vertexCount: totalVertices,
      surfaceArea: totalSurfaceArea,
      volume: totalVolume,
    };
    const estimateLens = buildEstimateLens({
      elements,
      quantities,
      defaultSource: "geometry-derived",
    });
    const provenance = makeProvenance({
      source,
      format: context.format,
      checksum: context.checksum,
      size: context.size,
      capability: activeCapability,
      method: "occt_mesh_triangulation",
      confidence: elements.length > 0 ? 0.9 : 0.5,
    });
    const canonicalManifest = makeCanonicalManifest({
      status: elements.length > 0 ? "indexed" : "partial",
      units: quantityUnits.length,
      capability: activeCapability,
      provenance,
      summary,
      elementStats,
      estimateLens,
      issues,
      geometryArtifacts: [{
        id: createId("mga"),
        format: "mesh-json",
        meshRefs: elements.map((element) => element.geometryRef ?? element.externalId),
        units: quantityUnits.length,
        metadata: { source: "occt-import-js", meshCount: elements.length },
      }],
    });

    return {
      status: elements.length > 0 ? "indexed" : "partial",
      units: quantityUnits.length,
      manifest: summary,
      elementStats,
      elements,
      quantities,
      bomRows,
      issues,
      canonicalManifest,
      artifacts: [],
    };
  },
};
