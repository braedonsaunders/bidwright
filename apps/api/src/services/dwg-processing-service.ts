import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { prisma, type Prisma } from "@bidwright/db";
import { resolveApiPath } from "../paths.js";

const execFileAsync = promisify(execFile);

const PROCESSOR_VERSION = 1;
const MAX_STORED_VERSIONS = 12;

const ACI_COLORS: Record<number, string> = {
  0: "#d4d4d8",
  1: "#ef4444",
  2: "#facc15",
  3: "#22c55e",
  4: "#06b6d4",
  5: "#3b82f6",
  6: "#ec4899",
  7: "#f8fafc",
  8: "#94a3b8",
  9: "#cbd5e1",
};

type DwgPoint = { x: number; y: number };
type DwgBounds = { minX: number; minY: number; maxX: number; maxY: number };

export interface DwgLayerMetadata {
  name: string;
  color: string;
  count: number;
  frozen?: boolean;
  locked?: boolean;
  lineType?: string;
}

export interface DwgLayoutMetadata {
  id: string;
  name: string;
  kind: "model" | "paper";
  entityCount: number;
  bounds: DwgBounds;
}

export interface DwgEntityMetadata {
  id: string;
  type: string;
  layer: string;
  layoutName: string;
  color: string;
  start?: DwgPoint;
  end?: DwgPoint;
  center?: DwgPoint;
  radius?: number;
  vertices?: DwgPoint[];
  closed?: boolean;
  text?: string;
  bounds: DwgBounds;
  raw: Record<string, unknown>;
}

export interface DwgProcessingResult {
  schemaVersion: 1;
  processorVersion: number;
  documentId: string;
  projectId: string;
  fileName: string;
  sourceHash: string;
  processedAt: string;
  status: "processed" | "converter_required" | "failed";
  sourceKind: "dxf" | "dwg" | "unknown";
  converter: {
    status: "not_required" | "configured" | "missing" | "failed";
    command?: string;
    message?: string;
  };
  units: string;
  extents: DwgBounds;
  layers: DwgLayerMetadata[];
  layouts: DwgLayoutMetadata[];
  entities: DwgEntityMetadata[];
  entityStats: {
    total: number;
    byType: Record<string, number>;
    byLayer: Record<string, number>;
  };
  thumbnailSvg: string;
  activeVersionId: string;
  versions: DwgProcessingVersion[];
}

type DxfPair = { code: number; value: string };
type DwgProcessingVersion = {
  id: string;
  processedAt: string;
  sourceHash: string;
  status: DwgProcessingResult["status"];
  sourceKind: DwgProcessingResult["sourceKind"];
  entityCount: number;
  layerCount: number;
  layoutCount: number;
  converterStatus: DwgProcessingResult["converter"]["status"];
};

function extensionOf(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

function hashBytes(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

function emptyBounds(): DwgBounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function includePoint(bounds: DwgBounds, point?: DwgPoint) {
  if (!point) return;
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.maxY = Math.max(bounds.maxY, point.y);
}

function normalizeBounds(bounds: DwgBounds): DwgBounds {
  if (!Number.isFinite(bounds.minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  if (bounds.minX === bounds.maxX) {
    bounds.minX -= 1;
    bounds.maxX += 1;
  }
  if (bounds.minY === bounds.maxY) {
    bounds.minY -= 1;
    bounds.maxY += 1;
  }
  return bounds;
}

function unionBounds(boundsList: DwgBounds[]): DwgBounds {
  const bounds = emptyBounds();
  for (const item of boundsList) {
    includePoint(bounds, { x: item.minX, y: item.minY });
    includePoint(bounds, { x: item.maxX, y: item.maxY });
  }
  return normalizeBounds(bounds);
}

function boundsForEntity(entity: Omit<DwgEntityMetadata, "bounds">): DwgBounds {
  const bounds = emptyBounds();
  includePoint(bounds, entity.start);
  includePoint(bounds, entity.end);
  includePoint(bounds, entity.center);
  entity.vertices?.forEach((point) => includePoint(bounds, point));
  if (entity.center && typeof entity.radius === "number") {
    includePoint(bounds, { x: entity.center.x - entity.radius, y: entity.center.y - entity.radius });
    includePoint(bounds, { x: entity.center.x + entity.radius, y: entity.center.y + entity.radius });
  }
  return normalizeBounds(bounds);
}

function aciColor(value: number | undefined, fallback = "#d4d4d8") {
  if (value === undefined) return fallback;
  return ACI_COLORS[Math.abs(value)] ?? fallback;
}

function colorFromLayer(layerColors: Map<string, string>, layerName: string, colorNumber?: number) {
  if (colorNumber !== undefined && colorNumber !== 256) return aciColor(colorNumber);
  return layerColors.get(layerName) ?? "#d4d4d8";
}

function sectionRanges(pairs: DxfPair[]) {
  const ranges: Array<{ name: string; start: number; end: number }> = [];
  for (let index = 0; index < pairs.length; index++) {
    if (pairs[index]?.code !== 0 || pairs[index]?.value !== "SECTION") continue;
    const sectionName = pairs[index + 1]?.code === 2 ? pairs[index + 1]?.value.toUpperCase() : "";
    let end = pairs.length;
    for (let cursor = index + 2; cursor < pairs.length; cursor++) {
      if (pairs[cursor]?.code === 0 && pairs[cursor]?.value === "ENDSEC") {
        end = cursor;
        break;
      }
    }
    ranges.push({ name: sectionName, start: index + 2, end });
    index = end;
  }
  return ranges;
}

function parseHeaderUnits(pairs: DxfPair[]) {
  for (let index = 0; index < pairs.length; index++) {
    if (pairs[index]?.code === 9 && pairs[index]?.value === "$INSUNITS") {
      const unitCode = parseNumber(pairs[index + 1]?.value) ?? 0;
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

function parseLayers(pairs: DxfPair[]): DwgLayerMetadata[] {
  const layers: DwgLayerMetadata[] = [];
  for (let index = 0; index < pairs.length; index++) {
    if (pairs[index]?.code !== 0 || pairs[index]?.value !== "LAYER") continue;
    let name = "0";
    let colorNumber: number | undefined;
    let flags = 0;
    let lineType = "";
    for (let cursor = index + 1; cursor < pairs.length && pairs[cursor]?.code !== 0; cursor++) {
      const pair = pairs[cursor]!;
      if (pair.code === 2) name = pair.value || "0";
      else if (pair.code === 62) colorNumber = parseNumber(pair.value);
      else if (pair.code === 70) flags = parseNumber(pair.value) ?? 0;
      else if (pair.code === 6) lineType = pair.value;
    }
    layers.push({
      name,
      color: aciColor(colorNumber),
      count: 0,
      frozen: (flags & 1) === 1,
      locked: (flags & 4) === 4,
      lineType: lineType || undefined,
    });
  }
  return layers.length > 0 ? layers : [{ name: "0", color: "#d4d4d8", count: 0 }];
}

function collectEntityPairs(pairs: DxfPair[], start: number): { type: string; pairs: DxfPair[]; next: number } {
  const type = pairs[start]?.value.toUpperCase() ?? "UNKNOWN";
  let next = start + 1;
  while (next < pairs.length && pairs[next]?.code !== 0) next++;
  return { type, pairs: pairs.slice(start + 1, next), next };
}

function firstNumber(entityPairs: DxfPair[], code: number): number | undefined {
  return parseNumber(entityPairs.find((pair) => pair.code === code)?.value);
}

function firstString(entityPairs: DxfPair[], code: number): string | undefined {
  return entityPairs.find((pair) => pair.code === code)?.value;
}

function pointFromCodes(entityPairs: DxfPair[], xCode: number, yCode: number): DwgPoint | undefined {
  const x = firstNumber(entityPairs, xCode);
  const y = firstNumber(entityPairs, yCode);
  return x !== undefined && y !== undefined ? { x, y } : undefined;
}

function parsePolylineVertices(entityPairs: DxfPair[]): Array<DwgPoint & { bulge?: number }> {
  const vertices: Array<DwgPoint & { bulge?: number }> = [];
  let pending: Partial<DwgPoint & { bulge?: number }> | null = null;
  for (const pair of entityPairs) {
    if (pair.code === 10) {
      if (pending?.x !== undefined && pending.y !== undefined) vertices.push(pending as DwgPoint);
      pending = { x: parseNumber(pair.value) ?? 0 };
    } else if (pair.code === 20 && pending) {
      pending.y = parseNumber(pair.value) ?? 0;
    } else if (pair.code === 42 && pending) {
      pending.bulge = parseNumber(pair.value);
    }
  }
  if (pending?.x !== undefined && pending.y !== undefined) vertices.push(pending as DwgPoint);
  return vertices;
}

function parseEntities(pairs: DxfPair[], layerColors: Map<string, string>): DwgEntityMetadata[] {
  const entities: DwgEntityMetadata[] = [];
  let pendingPolyline: {
    id: string;
    layer: string;
    layoutName: string;
    color: string;
    closed: boolean;
    vertices: DwgPoint[];
    raw: Record<string, unknown>;
  } | null = null;

  for (let index = 0; index < pairs.length;) {
    if (pairs[index]?.code !== 0) {
      index++;
      continue;
    }
    const collected = collectEntityPairs(pairs, index);
    index = collected.next;
    const entityPairs = collected.pairs;
    const type = collected.type;

    if (type === "SEQEND") {
      if (pendingPolyline) {
        const candidate: Omit<DwgEntityMetadata, "bounds"> = {
          id: pendingPolyline.id,
          type: "POLYLINE",
          layer: pendingPolyline.layer,
          layoutName: pendingPolyline.layoutName,
          color: pendingPolyline.color,
          vertices: pendingPolyline.vertices,
          closed: pendingPolyline.closed,
          raw: pendingPolyline.raw,
        };
        entities.push({ ...candidate, bounds: boundsForEntity(candidate) });
        pendingPolyline = null;
      }
      continue;
    }

    if (type === "VERTEX" && pendingPolyline) {
      const vertex = pointFromCodes(entityPairs, 10, 20);
      if (vertex) pendingPolyline.vertices.push(vertex);
      continue;
    }

    const id = firstString(entityPairs, 5) || `${type.toLowerCase()}-${entities.length + 1}`;
    const layer = firstString(entityPairs, 8) || "0";
    const layoutName = firstString(entityPairs, 410) || "Model";
    const colorNumber = firstNumber(entityPairs, 62);
    const color = colorFromLayer(layerColors, layer, colorNumber);
    const baseRaw = Object.fromEntries(
      entityPairs
        .filter((pair) => [5, 6, 8, 39, 48, 62, 67, 100, 330, 410].includes(pair.code))
        .map((pair) => [String(pair.code), pair.value]),
    );

    if (type === "POLYLINE") {
      pendingPolyline = {
        id,
        layer,
        layoutName,
        color,
        closed: ((firstNumber(entityPairs, 70) ?? 0) & 1) === 1,
        vertices: [],
        raw: { ...baseRaw, flags: firstNumber(entityPairs, 70) ?? 0 },
      };
      continue;
    }

    const candidate: Omit<DwgEntityMetadata, "bounds"> = {
      id,
      type,
      layer,
      layoutName,
      color,
      raw: baseRaw,
    };

    if (type === "LINE") {
      candidate.start = pointFromCodes(entityPairs, 10, 20);
      candidate.end = pointFromCodes(entityPairs, 11, 21);
    } else if (type === "LWPOLYLINE") {
      candidate.vertices = parsePolylineVertices(entityPairs);
      candidate.closed = ((firstNumber(entityPairs, 70) ?? 0) & 1) === 1;
    } else if (type === "CIRCLE" || type === "ARC") {
      candidate.center = pointFromCodes(entityPairs, 10, 20);
      candidate.radius = firstNumber(entityPairs, 40);
      if (type === "ARC") {
        candidate.raw = {
          ...candidate.raw,
          startAngle: firstNumber(entityPairs, 50) ?? 0,
          endAngle: firstNumber(entityPairs, 51) ?? 360,
        };
      }
    } else if (type === "POINT") {
      candidate.center = pointFromCodes(entityPairs, 10, 20);
    } else if (type === "TEXT" || type === "MTEXT") {
      candidate.start = pointFromCodes(entityPairs, 10, 20);
      candidate.text = firstString(entityPairs, type === "MTEXT" ? 1 : 1) || "";
      candidate.raw = { ...candidate.raw, height: firstNumber(entityPairs, 40) ?? undefined };
    } else if (type === "INSERT") {
      candidate.start = pointFromCodes(entityPairs, 10, 20);
      candidate.text = firstString(entityPairs, 2) || "";
      candidate.raw = {
        ...candidate.raw,
        blockName: firstString(entityPairs, 2) || "",
        rotation: firstNumber(entityPairs, 50) ?? 0,
      };
    } else if (type === "ELLIPSE") {
      const center = pointFromCodes(entityPairs, 10, 20);
      const major = pointFromCodes(entityPairs, 11, 21);
      const ratio = firstNumber(entityPairs, 40) ?? 1;
      if (center && major) {
        const majorRadius = Math.hypot(major.x, major.y);
        candidate.center = center;
        candidate.radius = majorRadius;
        candidate.raw = { ...candidate.raw, majorRadius, minorRadius: majorRadius * ratio, ratio };
      }
    }

    if (
      candidate.start ||
      candidate.end ||
      candidate.center ||
      (candidate.vertices && candidate.vertices.length > 0)
    ) {
      entities.push({ ...candidate, bounds: boundsForEntity(candidate) });
    }
  }

  return entities;
}

function buildStats(entities: DwgEntityMetadata[]) {
  const byType: Record<string, number> = {};
  const byLayer: Record<string, number> = {};
  for (const entity of entities) {
    byType[entity.type] = (byType[entity.type] ?? 0) + 1;
    byLayer[entity.layer] = (byLayer[entity.layer] ?? 0) + 1;
  }
  return { total: entities.length, byType, byLayer };
}

function finalizeLayers(layers: DwgLayerMetadata[], entities: DwgEntityMetadata[]) {
  const byName = new Map(layers.map((layer) => [layer.name, { ...layer, count: 0 }]));
  for (const entity of entities) {
    const layer = byName.get(entity.layer) ?? { name: entity.layer, color: entity.color, count: 0 };
    layer.count += 1;
    byName.set(entity.layer, layer);
  }
  return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function buildLayouts(entities: DwgEntityMetadata[]) {
  const byName = new Map<string, DwgEntityMetadata[]>();
  for (const entity of entities) {
    const name = entity.layoutName || "Model";
    byName.set(name, [...(byName.get(name) ?? []), entity]);
  }
  if (byName.size === 0) byName.set("Model", []);
  return Array.from(byName.entries()).map(([name, items]) => ({
    id: name,
    name,
    kind: name.toLowerCase() === "model" ? "model" as const : "paper" as const,
    entityCount: items.length,
    bounds: unionBounds(items.map((item) => item.bounds)),
  }));
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateThumbnailSvg(entities: DwgEntityMetadata[], extents: DwgBounds) {
  const width = 420;
  const height = 280;
  const pad = 18;
  const dx = Math.max(1, extents.maxX - extents.minX);
  const dy = Math.max(1, extents.maxY - extents.minY);
  const scale = Math.min((width - pad * 2) / dx, (height - pad * 2) / dy);
  const toSvg = (point: DwgPoint) => ({
    x: pad + (point.x - extents.minX) * scale,
    y: height - pad - (point.y - extents.minY) * scale,
  });
  const body = entities.slice(0, 900).map((entity) => {
    const color = escapeXml(entity.color || "#94a3b8");
    if (entity.type === "LINE" && entity.start && entity.end) {
      const a = toSvg(entity.start);
      const b = toSvg(entity.end);
      return `<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="${color}" stroke-width="1"/>`;
    }
    if ((entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") && entity.vertices?.length) {
      const points = entity.vertices.map(toSvg).map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
      return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1"/>`;
    }
    if ((entity.type === "CIRCLE" || entity.type === "ARC") && entity.center && entity.radius) {
      const center = toSvg(entity.center);
      return `<circle cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" r="${Math.max(0.5, entity.radius * scale).toFixed(2)}" fill="none" stroke="${color}" stroke-width="1"/>`;
    }
    return "";
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#101522"/><g opacity="0.92">${body}</g></svg>`;
}

function parseDxfDrawing(input: string) {
  const pairs = parseTextDxf(input);
  const ranges = sectionRanges(pairs);
  const header = ranges.find((range) => range.name === "HEADER");
  const tables = ranges.find((range) => range.name === "TABLES");
  const entitiesSection = ranges.find((range) => range.name === "ENTITIES");
  const layers = parseLayers(tables ? pairs.slice(tables.start, tables.end) : []);
  const layerColors = new Map(layers.map((layer) => [layer.name, layer.color]));
  const entities = parseEntities(entitiesSection ? pairs.slice(entitiesSection.start, entitiesSection.end) : [], layerColors);
  const extents = unionBounds(entities.map((entity) => entity.bounds));
  const finalLayers = finalizeLayers(layers, entities);
  const layouts = buildLayouts(entities);
  return {
    units: parseHeaderUnits(header ? pairs.slice(header.start, header.end) : []),
    extents,
    layers: finalLayers,
    layouts,
    entities,
    entityStats: buildStats(entities),
    thumbnailSvg: generateThumbnailSvg(entities, extents),
  };
}

function parseConverterCommand(command: string, inputPath: string, outputPath: string) {
  const tokens = command.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((token) => token.replace(/^"|"$/g, "")) ?? [];
  if (tokens.length === 0) return null;
  const [file, ...rawArgs] = tokens;
  const args = rawArgs.length > 0 ? rawArgs : ["{input}", "{output}"];
  return {
    file,
    args: args.map((arg) => arg.replaceAll("{input}", inputPath).replaceAll("{output}", outputPath)),
  };
}

async function convertDwgToDxf(inputPath: string): Promise<{ dxfText?: string; converter: DwgProcessingResult["converter"] }> {
  const command = process.env.BIDWRIGHT_DWG_CONVERTER_CMD?.trim();
  if (!command) {
    return {
      converter: {
        status: "missing",
        message: "Set BIDWRIGHT_DWG_CONVERTER_CMD with {input} and {output} placeholders to enable binary DWG processing.",
      },
    };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "bidwright-dwg-"));
  const outputPath = join(tempDir, "converted.dxf");
  try {
    const parsed = parseConverterCommand(command, inputPath, outputPath);
    if (!parsed) {
      return { converter: { status: "failed", command, message: "Converter command could not be parsed." } };
    }
    await execFileAsync(parsed.file, parsed.args, { timeout: 120_000, maxBuffer: 1024 * 1024 * 8 });
    const dxfText = await readFile(outputPath, "utf-8");
    return { dxfText, converter: { status: "configured", command } };
  } catch (error) {
    return {
      converter: {
        status: "failed",
        command,
        message: error instanceof Error ? error.message : "DWG converter failed.",
      },
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function priorVersions(structuredData: unknown): DwgProcessingResult["versions"] {
  if (!structuredData || typeof structuredData !== "object") return [];
  const existing = (structuredData as { dwgTakeoff?: { versions?: unknown } }).dwgTakeoff?.versions;
  return Array.isArray(existing) ? existing as DwgProcessingResult["versions"] : [];
}

function makeVersion(input: DwgProcessingVersion): DwgProcessingVersion {
  return input;
}

async function persistResult(documentId: string, result: DwgProcessingResult, currentStructuredData: unknown) {
  const nextStructuredData = {
    ...(currentStructuredData && typeof currentStructuredData === "object" ? currentStructuredData as Record<string, unknown> : {}),
    dwgTakeoff: result,
  };
  await prisma.sourceDocument.update({
    where: { id: documentId },
    data: { structuredData: nextStructuredData as unknown as Prisma.InputJsonValue },
  });
}

export async function getDwgProcessingResult(
  projectId: string,
  documentId: string,
  options: { refresh?: boolean } = {},
): Promise<DwgProcessingResult> {
  const document = await prisma.sourceDocument.findFirst({ where: { id: documentId, projectId } });
  if (!document) throw Object.assign(new Error("Drawing document not found."), { statusCode: 404 });

  const cached = (document.structuredData as { dwgTakeoff?: DwgProcessingResult } | null)?.dwgTakeoff;
  if (!options.refresh && cached?.schemaVersion === 1 && cached.processorVersion === PROCESSOR_VERSION) {
    return cached;
  }

  if (!document.storagePath) {
    throw Object.assign(new Error("Drawing file is not available on disk."), { statusCode: 404 });
  }

  const sourcePath = resolveApiPath(document.storagePath);
  const bytes = await readFile(sourcePath);
  const sourceHash = hashBytes(bytes);
  const ext = extensionOf(document.fileName || document.fileType);
  const sourceKind = ext === "dxf" ? "dxf" : ext === "dwg" ? "dwg" : "unknown";
  const processedAt = new Date().toISOString();
  const versionId = randomUUID();
  let dxfText: string | undefined;
  let converter: DwgProcessingResult["converter"] = { status: "not_required" };

  if (sourceKind === "dxf" || bytes.toString("utf-8", 0, Math.min(bytes.byteLength, 5000)).includes("SECTION")) {
    dxfText = bytes.toString("utf-8");
  } else if (sourceKind === "dwg") {
    const converted = await convertDwgToDxf(sourcePath);
    dxfText = converted.dxfText;
    converter = converted.converter;
  }

  if (!dxfText) {
    const result: DwgProcessingResult = {
      schemaVersion: 1,
      processorVersion: PROCESSOR_VERSION,
      documentId,
      projectId,
      fileName: document.fileName,
      sourceHash,
      processedAt,
      status: "converter_required",
      sourceKind,
      converter,
      units: "unitless",
      extents: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      layers: [],
      layouts: [],
      entities: [],
      entityStats: { total: 0, byType: {}, byLayer: {} },
      thumbnailSvg: generateThumbnailSvg([], { minX: 0, minY: 0, maxX: 100, maxY: 100 }),
      activeVersionId: versionId,
      versions: [
        makeVersion({
          id: versionId,
          processedAt,
          sourceHash,
          status: "converter_required",
          sourceKind,
          entityCount: 0,
          layerCount: 0,
          layoutCount: 0,
          converterStatus: converter.status,
        }),
        ...priorVersions(document.structuredData),
      ].slice(0, MAX_STORED_VERSIONS),
    };
    await persistResult(documentId, result, document.structuredData);
    return result;
  }

  try {
    const parsed = parseDxfDrawing(dxfText);
    const result: DwgProcessingResult = {
      schemaVersion: 1,
      processorVersion: PROCESSOR_VERSION,
      documentId,
      projectId,
      fileName: document.fileName,
      sourceHash,
      processedAt,
      status: "processed",
      sourceKind,
      converter,
      ...parsed,
      activeVersionId: versionId,
      versions: [
        makeVersion({
          id: versionId,
          processedAt,
          sourceHash,
          status: "processed",
          sourceKind,
          entityCount: parsed.entities.length,
          layerCount: parsed.layers.length,
          layoutCount: parsed.layouts.length,
          converterStatus: converter.status,
        }),
        ...priorVersions(document.structuredData),
      ].slice(0, MAX_STORED_VERSIONS),
    };
    await persistResult(documentId, result, document.structuredData);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not parse DXF entities.";
    const result: DwgProcessingResult = {
      schemaVersion: 1,
      processorVersion: PROCESSOR_VERSION,
      documentId,
      projectId,
      fileName: document.fileName,
      sourceHash,
      processedAt,
      status: "failed",
      sourceKind,
      converter,
      units: "unitless",
      extents: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      layers: [],
      layouts: [],
      entities: [],
      entityStats: { total: 0, byType: {}, byLayer: {} },
      thumbnailSvg: generateThumbnailSvg([], { minX: 0, minY: 0, maxX: 100, maxY: 100 }),
      activeVersionId: versionId,
      versions: [
        makeVersion({
          id: versionId,
          processedAt,
          sourceHash,
          status: "failed",
          sourceKind,
          entityCount: 0,
          layerCount: 0,
          layoutCount: 0,
          converterStatus: converter.status,
        }),
        ...priorVersions(document.structuredData),
      ].slice(0, MAX_STORED_VERSIONS),
    };
    await persistResult(documentId, result, document.structuredData);
    throw Object.assign(new Error(message), { statusCode: 400, result });
  }
}
