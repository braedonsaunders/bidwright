import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLLMAdapter, type ChatContentBlock, type ChatMessage } from "@bidwright/agent";
import { runPointCloudSegmentation, type PointCloudSegment } from "@bidwright/vision";
import { prisma } from "@bidwright/db";
import { resolveApiPath } from "../paths.js";
import { createId } from "./model-ingest/utils.js";
import { SCAN_ROOT_ELEMENT_CLASS } from "./model-ingest/adapters/scan-adapter.js";

/**
 * Scan Takeoff Service — Phase 2 of the LiDAR scan surface.
 *
 * A scan ModelAsset starts as a bare point cloud (one ScanPointCloud root
 * element from the ingest adapter). This service runs the Python
 * segmentation pipeline (RANSAC planes + DBSCAN clusters + cylinder fits)
 * and persists the detections as ModelElements + ModelQuantities, which
 * makes a raw field scan behave like a BIM document downstream: the takeoff
 * UI, unified Pickup links, and worksheet recalc all work unchanged.
 */

export const SCAN_SEGMENT_ELEMENT_CLASSES: Record<string, string> = {
  "pipe-run": "ScanPipeRun",
  plane: "ScanPlane",
  cluster: "ScanCluster",
};

const SEGMENTS_FILE = "segments.json";

export interface ScanCloudInfo {
  modelId: string;
  pointsPath: string;
  /** Relative (apiDataRoot) path of points.bin — served by the pointcloud route. */
  pointsRelPath: string;
  pointCount: number;
  stride: number;
  bbox: { min: number[]; max: number[] };
  offset: number[];
  hasColor: boolean;
  units: string;
}

function isScanFormat(format: string) {
  return ["e57", "las", "laz", "ply", "xyz", "pts"].includes(format.toLowerCase());
}

export async function getScanCloudInfo(projectId: string, modelId: string): Promise<ScanCloudInfo> {
  const model = await prisma.modelAsset.findFirst({ where: { id: modelId, projectId } });
  if (!model) throw new Error(`Model ${modelId} not found`);
  if (!isScanFormat(model.format)) throw new Error(`Model ${modelId} is not a point-cloud scan (.${model.format})`);

  const manifest = (model.manifest ?? {}) as Record<string, unknown>;
  const pointsRelPath = typeof manifest.pointsFile === "string" ? manifest.pointsFile : "";
  if (!pointsRelPath) {
    throw new Error(`Scan ${modelId} has no ingested point data — rescan the project's model assets first.`);
  }
  const bbox = (manifest.bbox ?? { min: [0, 0, 0], max: [0, 0, 0] }) as ScanCloudInfo["bbox"];
  return {
    modelId,
    pointsPath: resolveApiPath(pointsRelPath),
    pointsRelPath,
    pointCount: Number(manifest.pointCount ?? 0),
    stride: Number(manifest.stride ?? 16),
    bbox,
    offset: Array.isArray(manifest.offset) ? (manifest.offset as number[]) : [0, 0, 0],
    hasColor: Boolean(manifest.hasColor),
    units: typeof manifest.units === "string" ? manifest.units : "m",
  };
}

function segmentsFilePath(info: ScanCloudInfo) {
  return path.join(path.dirname(info.pointsPath), SEGMENTS_FILE);
}

export async function readScanSegments(projectId: string, modelId: string): Promise<{ segments: PointCloudSegment[]; stats?: Record<string, unknown> }> {
  const info = await getScanCloudInfo(projectId, modelId);
  try {
    const raw = await readFile(segmentsFilePath(info), "utf8");
    const parsed = JSON.parse(raw) as { segments?: PointCloudSegment[]; stats?: Record<string, unknown> };
    return { segments: parsed.segments ?? [], stats: parsed.stats };
  } catch {
    return { segments: [] };
  }
}

function segmentQuantities(segment: PointCloudSegment, elementId: string) {
  const quantities: Array<{ id: string; elementId: string; quantityType: string; value: number; unit: string; method: string; confidence: number; metadata: Record<string, unknown> }> = [];
  const meta = { segmentId: segment.id };
  if (segment.kind === "pipe-run") {
    quantities.push({
      id: createId("mq"), elementId, quantityType: "length",
      value: segment.length ?? 0, unit: "m", method: "scan_cylinder_fit",
      confidence: segment.confidence, metadata: { ...meta, radius: segment.radius },
    });
    quantities.push({
      id: createId("mq"), elementId, quantityType: "count",
      value: 1, unit: "EA", method: "scan_cylinder_fit", confidence: segment.confidence, metadata: meta,
    });
  } else if (segment.kind === "plane") {
    quantities.push({
      id: createId("mq"), elementId, quantityType: "area",
      value: segment.area ?? 0, unit: "m²", method: "scan_plane_fit",
      confidence: segment.confidence, metadata: { ...meta, kindDetail: segment.kindDetail },
    });
  } else {
    const bbox = segment.bbox;
    const volume = bbox
      ? Math.abs((bbox.max[0] - bbox.min[0]) * (bbox.max[1] - bbox.min[1]) * (bbox.max[2] - bbox.min[2]))
      : 0;
    quantities.push({
      id: createId("mq"), elementId, quantityType: "count",
      value: 1, unit: "EA", method: "scan_cluster", confidence: segment.confidence, metadata: meta,
    });
    if (volume > 0) {
      quantities.push({
        id: createId("mq"), elementId, quantityType: "volume",
        value: volume, unit: "m³", method: "scan_cluster_bbox", confidence: Math.min(segment.confidence, 0.4), metadata: meta,
      });
    }
  }
  return quantities;
}

/** Run segmentation and persist detections as ModelElements/Quantities.
 *  Re-runs replace previous segment elements; pickups that referenced the
 *  replaced elements keep their quantities (refs are nulled, matching the
 *  re-ingest behavior in replaceModelChildren). */
export async function runScanSegmentation(projectId: string, modelId: string, opts?: { voxel?: number }) {
  const info = await getScanCloudInfo(projectId, modelId);

  const result = await runPointCloudSegmentation({
    pointsPath: info.pointsPath,
    pointCount: info.pointCount,
    voxel: opts?.voxel,
  });

  const root = await prisma.modelElement.findFirst({
    where: { modelId, elementClass: SCAN_ROOT_ELEMENT_CLASS },
  });

  const segmentClasses = Object.values(SCAN_SEGMENT_ELEMENT_CLASSES);
  const elements = result.segments.map((segment) => ({
    id: createId("me"),
    modelId,
    externalId: segment.id,
    parentId: root?.id ?? null,
    name: segment.label,
    elementClass: SCAN_SEGMENT_ELEMENT_CLASSES[segment.kind] ?? "ScanCluster",
    elementType: segment.kindDetail || segment.kind,
    system: "",
    level: "",
    material: "",
    bbox: (segment.bbox ?? {}) as any,
    geometryRef: segment.id,
    classification: {} as any,
    lod: "",
    lodSource: "",
    properties: {
      segmentId: segment.id,
      confidence: segment.confidence,
      pointCount: segment.pointCount,
      radius: segment.radius,
      diameterMm: segment.radius ? Math.round(segment.radius * 2000) : undefined,
      length: segment.length,
      area: segment.area,
      kindDetail: segment.kindDetail,
      centroid: segment.centroid,
      polyline: segment.polyline,
      estimateRelevant: segment.kind !== "plane" || (segment.area ?? 0) > 0.5,
    } as any,
  }));

  await prisma.$transaction([
    // Null pickup refs to the segment elements being replaced (keep root refs).
    prisma.pickup.updateMany({
      where: {
        modelId,
        modelElementId: {
          in: (
            await prisma.modelElement.findMany({
              where: { modelId, elementClass: { in: segmentClasses } },
              select: { id: true },
            })
          ).map((e) => e.id),
        },
      },
      data: { modelElementId: null, modelQuantityId: null },
    }),
    prisma.modelQuantity.deleteMany({
      where: { modelId, element: { elementClass: { in: segmentClasses } } },
    }),
    prisma.modelElement.deleteMany({ where: { modelId, elementClass: { in: segmentClasses } } }),
  ]);

  if (elements.length > 0) {
    await prisma.modelElement.createMany({ data: elements });
    const quantities = elements.flatMap((element, index) =>
      segmentQuantities(result.segments[index], element.id).map((q) => ({ ...q, modelId, metadata: q.metadata as any })),
    );
    if (quantities.length > 0) await prisma.modelQuantity.createMany({ data: quantities as any });
  }

  const payload = {
    segments: result.segments,
    stats: { ...result.stats, segmentedAt: new Date().toISOString() },
  };
  await writeFile(segmentsFilePath(info), JSON.stringify(payload), "utf8");

  await prisma.modelAsset.update({
    where: { id: modelId },
    data: {
      metadata: {
        ...((await prisma.modelAsset.findFirst({ where: { id: modelId } }))?.metadata as Record<string, unknown> ?? {}),
        scanSegmentation: {
          at: new Date().toISOString(),
          segmentCount: result.segments.length,
          pipeRuns: result.segments.filter((s) => s.kind === "pipe-run").length,
          planes: result.segments.filter((s) => s.kind === "plane").length,
          clusters: result.segments.filter((s) => s.kind === "cluster").length,
        },
      } as any,
      updatedAt: new Date(),
    },
  });

  // Return elements alongside segments so the client can link without refetching.
  const persisted = await prisma.modelElement.findMany({
    where: { modelId, elementClass: { in: segmentClasses } },
    include: { quantities: true },
  });
  return { segments: result.segments, stats: payload.stats, elements: persisted };
}

// ── Photo identification (fusion) ─────────────────────────────────────────
//
// The scan gives accurate geometry but no identity — phone LiDAR cannot
// resolve small-bore diameters or materials. Site photos of the same space
// can. This sends segment stats + photos to the tenant's vision LLM and
// writes identification (material / service / size hints) back onto the
// segment elements' properties.

export interface IdentifySegmentsRequest {
  images: Array<{ data: string; mimeType: string; caption?: string }>;
  segmentIds?: string[];
  focusPrompt?: string;
  llm: { provider: string; apiKey: string; model: string };
}

function parseIdentifyJson(raw: string): Array<Record<string, unknown>> {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const first = text.indexOf("[");
  const last = text.lastIndexOf("]");
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("Identification response was not a JSON array.");
  return parsed.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
}

export async function identifyScanSegments(projectId: string, modelId: string, input: IdentifySegmentsRequest) {
  if (!input.images.length) throw new Error("At least one photo is required.");
  const { segments } = await readScanSegments(projectId, modelId);
  const targets = input.segmentIds?.length
    ? segments.filter((s) => input.segmentIds!.includes(s.id))
    : segments;
  if (!targets.length) throw new Error("No segments to identify — run segmentation first.");

  const segmentLines = targets.map((s) => {
    const dims = s.kind === "pipe-run"
      ? `Ø${Math.round((s.radius ?? 0) * 2000)}mm, length ${(s.length ?? 0).toFixed(2)}m`
      : s.kind === "plane"
        ? `${s.kindDetail || "plane"}, area ${(s.area ?? 0).toFixed(1)}m²`
        : `bbox ${s.bbox ? (s.bbox.max[0] - s.bbox.min[0]).toFixed(1) + "×" + (s.bbox.max[1] - s.bbox.min[1]).toFixed(1) + "×" + (s.bbox.max[2] - s.bbox.min[2]).toFixed(1) + "m" : "?"}`;
    return `  - { "id": "${s.id}", "kind": "${s.kind}", "geometry": "${dims}" }`;
  }).join("\n");

  const systemPrompt = `You are a senior industrial construction estimator. A LiDAR scan of a space was segmented into geometric detections; the photos show the same space. Match what you SEE in the photos to the geometric segments and identify them.

Segments (geometry is measured and trustworthy — do not second-guess dimensions):
${segmentLines}

For each segment you can identify from the photos, output: {"id": "<segment id>", "material": "<e.g. carbon steel, copper, PVC, ductwork-galvanized>", "service": "<e.g. chilled water supply, sanitary, compressed air, unknown>", "insulated": true|false, "nominalSize": "<trade size if inferable, e.g. 2\\" NPS, 24x12 duct>", "notes": "<what in the photos backs this>", "confidence": 0.0-1.0}.
Only include segments you can genuinely ground in the photos. Output ONLY a JSON array, no fences, no prose.`;

  const content: ChatContentBlock[] = [];
  input.images.forEach((image, index) => {
    content.push({ type: "image", imageData: image.data, imageMimeType: image.mimeType });
    content.push({ type: "text", text: [`Photo ${index}.`, image.caption ? `Caption: ${image.caption}` : ""].filter(Boolean).join(" ") });
  });
  content.push({ type: "text", text: input.focusPrompt?.trim() ? `Hints: ${input.focusPrompt.trim()}\n\nIdentify the segments now.` : "Identify the segments now." });

  const adapter = createLLMAdapter({ provider: input.llm.provider as any, apiKey: input.llm.apiKey, model: input.llm.model });
  const response = await adapter.chat({
    model: input.llm.model,
    systemPrompt,
    messages: [{ role: "user", content }] as ChatMessage[],
    maxTokens: 4096,
    temperature: 0.2,
  });
  const block = response.content[0];
  const rawText = typeof block === "string" ? block : (block as { text?: string })?.text ?? "";
  const rows = parseIdentifyJson(rawText);

  const validIds = new Set(targets.map((s) => s.id));
  const identifications = rows
    .filter((row) => typeof row.id === "string" && validIds.has(row.id))
    .map((row) => ({
      id: row.id as string,
      material: typeof row.material === "string" ? row.material : "",
      service: typeof row.service === "string" ? row.service : "",
      insulated: Boolean(row.insulated),
      nominalSize: typeof row.nominalSize === "string" ? row.nominalSize : "",
      notes: typeof row.notes === "string" ? row.notes : "",
      confidence: Math.max(0, Math.min(1, Number(row.confidence ?? 0.5) || 0.5)),
    }));

  // Persist onto the segment elements + segments.json so both surfaces agree.
  const info = await getScanCloudInfo(projectId, modelId);
  for (const ident of identifications) {
    const element = await prisma.modelElement.findFirst({ where: { modelId, externalId: ident.id } });
    if (!element) continue;
    await prisma.modelElement.update({
      where: { id: element.id },
      data: {
        material: ident.material || element.material,
        system: ident.service || element.system,
        properties: { ...((element.properties as Record<string, unknown>) ?? {}), identification: ident } as any,
        updatedAt: new Date(),
      },
    });
  }
  const updatedSegments = segments.map((s) => {
    const ident = identifications.find((i) => i.id === s.id);
    return ident ? { ...s, identification: ident } : s;
  });
  await writeFile(segmentsFilePath(info), JSON.stringify({ segments: updatedSegments, stats: { identifiedAt: new Date().toISOString() } }), "utf8");

  return { identifications, matchedCount: identifications.length, segmentCount: targets.length };
}
