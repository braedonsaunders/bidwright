import { mkdir } from "node:fs/promises";
import path from "node:path";
import { runPointCloudIngest } from "@bidwright/vision";
import type { ModelIngestCapability } from "@bidwright/domain";
import { resolveApiPath, sanitizeFileName } from "../../../paths.js";
import type { ModelAdapterIngestResult, ModelIngestAdapter, ModelIngestContext, ModelIngestSource } from "../types.js";
import {
  buildEstimateLens,
  createId,
  makeCanonicalManifest,
  makeProvenance,
} from "../utils.js";

// LiDAR / laser-scan point clouds (iOS scanning apps export PLY/E57/LAS;
// terrestrial scanners add LAZ; XYZ/PTS are the ASCII lowest common
// denominator). The heavy lifting happens in Python
// (packages/vision/python/tools/pointcloud_ingest.py): the source cloud is
// normalized into a shuffled stride-16 binary the web viewer can stream
// progressively, plus stats. Scans carry no authored semantics — quantities
// beyond the whole-cloud stats come later from hand measurements in the
// viewer or from the segmentation pass (segment_pointcloud.py), both of
// which flow through the unified Pickup tables.

const ADAPTER_ID = "embedded-open.pointcloud";
const ADAPTER_VERSION = "1.0.0";
const FORMATS = new Set(["e57", "las", "laz", "ply", "xyz", "pts"]);
const DEFAULT_MAX_POINTS = 8_000_000;

export const SCAN_ROOT_ELEMENT_CLASS = "ScanPointCloud";

/** Mirror of persistIngestArtifacts' directory convention so points.bin can
 *  sit beside manifest.json/elements.json for the same ingest run. */
export function scanArtifactRoot(projectId: string, sourceId: string, checksum: string) {
  return path.join("model-ingest", projectId, `${sanitizeFileName(sourceId)}-${checksum.slice(0, 12)}`);
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

async function ingest(source: ModelIngestSource, context: ModelIngestContext): Promise<ModelAdapterIngestResult> {
  const artifactRoot = scanArtifactRoot(source.projectId, source.id, context.checksum);
  const absOutDir = resolveApiPath(artifactRoot);
  await mkdir(absOutDir, { recursive: true });

  const ingestResult = await runPointCloudIngest({
    inputPath: context.absPath,
    outDir: absOutDir,
    maxPoints: DEFAULT_MAX_POINTS,
  });

  const bbox = ingestResult.bbox;
  const extent = [
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  ];
  const footprintArea = Math.abs(extent[0] * extent[1]);

  const rootElementId = createId("me");
  const elements = [{
    id: rootElementId,
    externalId: "scan-root",
    name: source.fileName.replace(/\.[^.]+$/, ""),
    elementClass: SCAN_ROOT_ELEMENT_CLASS,
    elementType: context.format.toUpperCase(),
    bbox: { min: bbox.min, max: bbox.max },
    geometryRef: "points.bin",
    estimateRelevant: true,
    properties: {
      pointCount: ingestResult.pointCount,
      sourcePointCount: ingestResult.sourcePointCount,
      hasColor: ingestResult.hasColor,
      offset: ingestResult.offset,
      sourceChecksum: context.checksum,
    },
  }];

  const quantities = [
    { id: createId("mq"), elementId: rootElementId, quantityType: "point_count", value: ingestResult.pointCount, unit: "points", method: "pointcloud_ingest", confidence: 1 },
    { id: createId("mq"), elementId: rootElementId, quantityType: "footprint_area", value: footprintArea, unit: "m²", method: "pointcloud_bbox_footprint", confidence: 0.5 },
    { id: createId("mq"), elementId: rootElementId, quantityType: "extent_x", value: extent[0], unit: "m", method: "pointcloud_bbox", confidence: 0.9 },
    { id: createId("mq"), elementId: rootElementId, quantityType: "extent_y", value: extent[1], unit: "m", method: "pointcloud_bbox", confidence: 0.9 },
    { id: createId("mq"), elementId: rootElementId, quantityType: "extent_z", value: extent[2], unit: "m", method: "pointcloud_bbox", confidence: 0.9 },
  ];

  const bomRows = [{
    group: "Scan",
    description: `Point cloud ${source.fileName}`,
    quantity: ingestResult.pointCount,
    unit: "points",
    method: "pointcloud_ingest",
    source: "model-ingest",
  }];

  const cap = capability();
  const provenance = makeProvenance({
    source,
    format: context.format,
    checksum: context.checksum,
    size: context.size,
    capability: cap,
    method: "pointcloud_ingest",
    confidence: 0.9,
  });

  const summary = {
    parser: "pointcloud-ingest",
    pointCount: ingestResult.pointCount,
    sourcePointCount: ingestResult.sourcePointCount,
    hasColor: ingestResult.hasColor,
    bbox: ingestResult.bbox,
    offset: ingestResult.offset,
    units: ingestResult.units,
    stride: ingestResult.stride,
    pointsFile: path.join(artifactRoot, ingestResult.file),
    sourceFileName: source.fileName,
  };

  const elementStats = {
    pointCount: ingestResult.pointCount,
    sourcePointCount: ingestResult.sourcePointCount,
    extent,
    footprintArea,
  };

  const geometryArtifacts = [{
    id: createId("mga"),
    format: "pointcloud" as const,
    path: path.join(artifactRoot, ingestResult.file),
    meshRefs: ["points.bin"],
    bbox: { min: bbox.min, max: bbox.max },
    units: ingestResult.units,
    metadata: {
      stride: ingestResult.stride,
      pointCount: ingestResult.pointCount,
      offset: ingestResult.offset,
      hasColor: ingestResult.hasColor,
    },
  }];

  const estimateLens = buildEstimateLens({
    elements,
    quantities,
    defaultSource: "geometry-derived",
  });

  const canonicalManifest = makeCanonicalManifest({
    status: "indexed",
    units: "m",
    capability: cap,
    provenance,
    summary,
    elementStats,
    geometryArtifacts,
    estimateLens,
    issues: [],
  });

  return {
    status: "indexed",
    units: "m",
    manifest: summary,
    elementStats,
    elements,
    quantities,
    bomRows,
    issues: [],
    canonicalManifest,
    artifacts: [],
  };
}

export const scanAdapter: ModelIngestAdapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,
  formats: FORMATS,
  priority: 90,
  capability: (format) => capability("available", format === "e57" ? "E57 requires the optional pye57 python package; ingest degrades with a clear error when missing." : undefined),
  ingest,
};
