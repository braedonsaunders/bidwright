import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CanonicalModelElement,
  CanonicalModelIngestManifest,
  CanonicalModelQuantity,
  EstimateLensGroup,
  ModelIngestArtifact,
  ModelIngestCapability,
  ModelIngestSourceProvenance,
} from "@bidwright/domain";
import { resolveApiPath, sanitizeFileName } from "../../paths.js";
import type { GeneratedIssue, ModelIngestSource } from "./types.js";

export const MAX_TEXT_BYTES = 12 * 1024 * 1024;
export const MAX_GEOMETRY_BYTES = 80 * 1024 * 1024;

export function createId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

export function extensionOf(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export async function sha256File(absPath: string) {
  return createHash("sha256").update(await readFile(absPath)).digest("hex");
}

export function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function fileSize(absPath: string) {
  return (await stat(absPath)).size;
}

export async function readTextIfReasonable(absPath: string, size: number) {
  if (size > MAX_TEXT_BYTES) return null;
  return readFile(absPath, "utf8");
}

export function topCounts(counts: Map<string, number>, limit = 40) {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

export function emptyBbox() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

export function updateBbox(bbox: { min: number[]; max: number[] }, point: number[]) {
  for (let axis = 0; axis < 3; axis++) {
    bbox.min[axis] = Math.min(bbox.min[axis], point[axis] ?? 0);
    bbox.max[axis] = Math.max(bbox.max[axis], point[axis] ?? 0);
  }
}

export function finalizeBbox(bbox: { min: number[]; max: number[] }) {
  return bbox.min.every(Number.isFinite) && bbox.max.every(Number.isFinite)
    ? { min: bbox.min, max: bbox.max }
    : null;
}

export function vectorSub(a: number[], b: number[]) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vectorCross(a: number[], b: number[]) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vectorLength(a: number[]) {
  return Math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2);
}

export function triangleArea(a: number[], b: number[], c: number[]) {
  return vectorLength(vectorCross(vectorSub(b, a), vectorSub(c, a))) / 2;
}

export function signedTetraVolume(a: number[], b: number[], c: number[]) {
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  ) / 6;
}

export function computeTriangulatedMeshMetrics(position?: ArrayLike<number>, index?: ArrayLike<number>) {
  const bbox = emptyBbox();
  let surfaceArea = 0;
  let volume = 0;
  let triangleCount = 0;
  const vertexCount = position ? Math.floor(position.length / 3) : 0;
  if (!position || vertexCount === 0) {
    return { surfaceArea, volume, triangleCount, vertexCount, bbox: null };
  }

  for (let offset = 0; offset + 2 < vertexCount; offset++) {
    updateBbox(bbox, [
      Number(position[offset * 3] ?? 0),
      Number(position[offset * 3 + 1] ?? 0),
      Number(position[offset * 3 + 2] ?? 0),
    ]);
  }

  const readPoint = (vertexIndex: number) => [
    Number(position[vertexIndex * 3] ?? 0),
    Number(position[vertexIndex * 3 + 1] ?? 0),
    Number(position[vertexIndex * 3 + 2] ?? 0),
  ];

  if (index && index.length >= 3) {
    for (let offset = 0; offset + 2 < index.length; offset += 3) {
      const a = readPoint(Number(index[offset]));
      const b = readPoint(Number(index[offset + 1]));
      const c = readPoint(Number(index[offset + 2]));
      surfaceArea += triangleArea(a, b, c);
      volume += signedTetraVolume(a, b, c);
      triangleCount++;
    }
  } else {
    for (let offset = 0; offset + 2 < vertexCount; offset += 3) {
      const a = readPoint(offset);
      const b = readPoint(offset + 1);
      const c = readPoint(offset + 2);
      surfaceArea += triangleArea(a, b, c);
      volume += signedTetraVolume(a, b, c);
      triangleCount++;
    }
  }

  return {
    surfaceArea,
    volume: Math.abs(volume),
    triangleCount,
    vertexCount,
    bbox: finalizeBbox(bbox),
  };
}

export function colorToHex(color?: number[]) {
  if (!color || color.length < 3) return "";
  const normalized = color.slice(0, 3).map((value) => Math.max(0, Math.min(255, Math.round(value * 255))));
  return `#${normalized.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function quantityBucketKey(quantity: CanonicalModelQuantity) {
  return `${quantity.quantityType}::${quantity.unit}`;
}

export function buildEstimateLens(args: {
  elements: CanonicalModelElement[];
  quantities: CanonicalModelQuantity[];
  defaultSource: EstimateLensGroup["source"];
  maxGroups?: number;
}) {
  const quantityByElement = new Map<string, CanonicalModelQuantity[]>();
  for (const quantity of args.quantities) {
    if (!quantity.elementId) continue;
    const rows = quantityByElement.get(quantity.elementId) ?? [];
    rows.push(quantity);
    quantityByElement.set(quantity.elementId, rows);
  }

  const groups = new Map<string, {
    elements: CanonicalModelElement[];
    quantities: CanonicalModelQuantity[];
  }>();

  for (const element of args.elements) {
    const groupKey = [
      element.elementClass,
      element.elementType ?? "",
      element.system ?? "",
      element.level ?? "",
      element.material ?? "",
    ].map((value) => String(value).trim().toLowerCase()).join("|");
    const group = groups.get(groupKey) ?? { elements: [], quantities: [] };
    group.elements.push(element);
    group.quantities.push(...(quantityByElement.get(element.id) ?? []));
    groups.set(groupKey, group);
  }

  return Array.from(groups.entries())
    .sort((a, b) => b[1].elements.length - a[1].elements.length || a[0].localeCompare(b[0]))
    .slice(0, args.maxGroups ?? 250)
    .map(([groupKey, group]): EstimateLensGroup => {
      const sample = group.elements[0]!;
      const buckets = new Map<string, { value: number; unit: string; quantityType: string; confidence: number; count: number; ids: string[] }>();
      for (const quantity of group.quantities) {
        const key = quantityBucketKey(quantity);
        const bucket = buckets.get(key) ?? {
          value: 0,
          unit: quantity.unit,
          quantityType: quantity.quantityType,
          confidence: 0,
          count: 0,
          ids: [],
        };
        bucket.value += quantity.value;
        bucket.confidence += quantity.confidence ?? 1;
        bucket.count += 1;
        bucket.ids.push(quantity.id);
        buckets.set(key, bucket);
      }
      const bucketRows = Array.from(buckets.values()).map((bucket) => ({
        quantityType: bucket.quantityType,
        value: Number(bucket.value.toFixed(6)),
        unit: bucket.unit,
        confidence: bucket.count ? Number((bucket.confidence / bucket.count).toFixed(4)) : 1,
      }));
      const quantityIds = Array.from(new Set(Array.from(buckets.values()).flatMap((bucket) => bucket.ids)));
      const confidence = bucketRows.length
        ? bucketRows.reduce((sum, row) => sum + row.confidence, 0) / bucketRows.length
        : 0.7;

      return {
        id: createId("mlg"),
        groupKey,
        label: [
          sample.elementClass,
          sample.elementType,
          sample.level,
          sample.material,
        ].filter(Boolean).join(" / ") || sample.elementClass || "Model group",
        elementClass: sample.elementClass,
        elementType: sample.elementType,
        system: sample.system,
        level: sample.level,
        material: sample.material,
        elementIds: group.elements.map((element) => element.id),
        quantityIds,
        quantities: bucketRows,
        confidence: Number(confidence.toFixed(4)),
        source: args.defaultSource,
        metadata: {
          elementCount: group.elements.length,
          sampleElementNames: group.elements.slice(0, 5).map((element) => element.name),
        },
      };
    });
}

export function makeProvenance(args: {
  source: ModelIngestSource;
  format: string;
  checksum: string;
  size: number;
  capability: ModelIngestCapability;
  method: string;
  confidence: number;
}): ModelIngestSourceProvenance {
  return {
    sourceKind: args.source.source,
    sourceId: args.source.id,
    projectId: args.source.projectId,
    fileName: args.source.fileName,
    fileType: args.source.fileType,
    format: args.format,
    storagePath: args.source.storagePath,
    sourceChecksum: args.checksum,
    sourceSize: args.size,
    adapterId: args.capability.adapterId,
    adapterVersion: args.capability.adapterVersion,
    provider: args.capability.provider,
    generatedAt: new Date().toISOString(),
    method: args.method,
    confidence: args.confidence,
  };
}

export function makeCanonicalManifest(args: {
  status: "indexed" | "partial" | "failed";
  units: string;
  capability: ModelIngestCapability;
  provenance: ModelIngestSourceProvenance;
  summary: Record<string, unknown>;
  elementStats: Record<string, unknown>;
  artifacts?: ModelIngestArtifact[];
  geometryArtifacts?: CanonicalModelIngestManifest["geometryArtifacts"];
  estimateLens?: EstimateLensGroup[];
  issues?: GeneratedIssue[];
}): CanonicalModelIngestManifest {
  return {
    schemaVersion: 1,
    runStatus: args.status,
    adapter: args.capability,
    provenance: args.provenance,
    units: args.units,
    summary: args.summary,
    elementStats: args.elementStats,
    artifacts: args.artifacts ?? [],
    geometryArtifacts: args.geometryArtifacts ?? [],
    estimateLens: args.estimateLens ?? [],
    issues: (args.issues ?? []).map((issue) => ({
      severity: issue.severity === "error" || issue.severity === "warning" ? issue.severity : "info",
      code: issue.code,
      message: issue.message,
      elementId: issue.elementId,
      metadata: issue.metadata,
    })),
  };
}

export async function persistIngestArtifacts(args: {
  projectId: string;
  sourceId: string;
  checksum: string;
  manifest: CanonicalModelIngestManifest;
  elements: CanonicalModelElement[];
  quantities: CanonicalModelQuantity[];
  bomRows: Array<Record<string, unknown>>;
}) {
  const safeSource = sanitizeFileName(args.sourceId);
  const root = path.join("model-ingest", args.projectId, `${safeSource}-${args.checksum.slice(0, 12)}`);
  const absRoot = resolveApiPath(root);
  await mkdir(absRoot, { recursive: true });

  const writeJsonArtifact = async (
    kind: ModelIngestArtifact["kind"],
    fileName: string,
    payload: unknown,
    description: string,
  ): Promise<ModelIngestArtifact> => {
    const relativePath = path.join(root, fileName);
    const text = JSON.stringify(payload, null, 2);
    await writeFile(resolveApiPath(relativePath), text, "utf8");
    return {
      id: createId("mia"),
      kind,
      path: relativePath,
      mediaType: "application/json",
      checksum: sha256Text(text),
      size: Buffer.byteLength(text),
      description,
    };
  };

  const rawArtifacts = [
    await writeJsonArtifact("raw-elements", "elements.json", args.elements, "Normalized model elements"),
    await writeJsonArtifact("raw-quantities", "quantities.json", args.quantities, "Normalized model quantities"),
    await writeJsonArtifact("raw-bom", "bom.json", args.bomRows, "Estimator-facing BOM rows"),
  ];
  const finalManifest = {
    ...args.manifest,
    artifacts: rawArtifacts,
  };
  const manifestArtifact = await writeJsonArtifact("manifest", "manifest.json", finalManifest, "Canonical model ingest manifest");

  return [manifestArtifact, ...rawArtifacts];
}
