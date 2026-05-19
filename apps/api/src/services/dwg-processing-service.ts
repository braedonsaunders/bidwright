import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import DxfParser, {
  type IArcEntity,
  type ICircleEntity,
  type IDimensionEntity,
  type IDxf,
  type IEllipseEntity,
  type IEntity,
  type IInsertEntity,
  type ILineEntity,
  type ILwpolylineEntity,
  type IMtextEntity,
  type IPoint,
  type IPointEntity,
  type IPolylineEntity,
  type ISplineEntity,
  type ITextEntity,
} from "dxf-parser";
import { prisma, type Prisma } from "@bidwright/db";
import { resolveApiPath } from "../paths.js";
import { logVectorPipeline } from "./vector-pipeline-logger.js";
import {
  type Affine,
  type DwgPoint,
  IDENTITY,
  applyToPoint,
  applyTransform,
  dxfHeaderUnitName,
  multiply,
  prettifyLayoutName,
  rotationOffset,
  transformForInsert,
  uniformScaleFactor,
  unitToInchFactor,
} from "./dxf-math.js";
import { HatchEntityHandler, type IHatchEntity } from "./dxf-hatch-handler.js";

const execFileAsync = promisify(execFile);

// Bumped from 1 → 2 with the dxf-parser rewrite. Cached results from the
// hand-rolled parser are silently re-processed on next access.
const PROCESSOR_VERSION = 2;
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
  /** Canonical unit the result's coordinates are in. After the dxf-parser
   *  rewrite this is always "in" (inches); unitless drawings pass through
   *  as-is with `unitScaleFactor === 1`. */
  units: string;
  /** Drawing's source unit detected from $INSUNITS. "unitless" when missing
   *  or unrecognized. Useful for UI display ("converted from mm"). */
  originalUnits: string;
  /** Multiplier applied to every coordinate to land in `units`. */
  unitScaleFactor: number;
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

// ── DXF parsing via dxf-parser (mature library, MIT) ─────────────────────
//
// IDxf shape from dxf-parser:
//   { header: Record<string, IPoint | number>,   // $INSUNITS lives here
//     tables: { layer: { layers: Record<string, ILayer> }, ... },
//     blocks: Record<string, IBlock>,            // block dictionary
//     entities: IEntity[] }                      // modelspace entities
//
// We map IEntity types into the public DwgEntityMetadata shape (unchanged
// public contract) while picking up SPLINE, DIMENSION, MTEXT, ELLIPSE
// rotation, and recursive INSERT block expansion that the old hand-rolled
// parser dropped. Pure math helpers (unit conversion, affine composition,
// INSUNITS mapping) live in dxf-math.ts so they can be tested in isolation.

interface BlockExpansionContext {
  blocks: Record<string, { entities: IEntity[]; name: string }>;
  layerColors: Map<string, string>;
  seen: Set<string>;
  stats: {
    inserts: number;
    expanded: number;
    maxDepth: number;
    missing: Set<string>;
  };
}

function colorForEntity(
  entity: IEntity,
  layerColors: Map<string, string>,
): string {
  if (typeof entity.color === "number" && entity.color !== 0) {
    return aciColor(entity.color);
  }
  if (typeof entity.colorIndex === "number" && entity.colorIndex > 0 && entity.colorIndex !== 256) {
    return aciColor(entity.colorIndex);
  }
  return layerColors.get(entity.layer ?? "0") ?? "#d4d4d8";
}

function entityHandle(entity: IEntity, fallback: string): string {
  if (typeof entity.handle === "string" && entity.handle) return entity.handle as unknown as string;
  if (typeof entity.handle === "number") return String(entity.handle);
  return fallback;
}

/** Sample a SPLINE down to a polyline. Uses fit points when the author
 *  supplied them (they already lie on the curve), otherwise falls back to
 *  the control polygon. Not geometrically perfect for b-splines, but
 *  serviceable for bounds + visual overlay. */
function splineVertices(spline: ISplineEntity, transform: Affine): DwgPoint[] {
  const source = (spline.fitPoints && spline.fitPoints.length > 1
    ? spline.fitPoints
    : spline.controlPoints ?? []);
  return source.map((p) => applyTransform(transform, p.x, p.y));
}

/** Map a single IEntity into DwgEntityMetadata. Returns null for entity
 *  types we don't model (e.g. SOLID-filled regions with no useful
 *  geometry, or entities missing required coords after transformation). */
function mapEntity(
  entity: IEntity,
  transform: Affine,
  ctx: BlockExpansionContext,
  layoutName: string,
  blockOrigin: string | null,
  indexHint: number,
  /** Disambiguator for INSERT instances. When a user block is inserted
   *  multiple times, each expansion gives the source entity the same
   *  DXF handle — so without a per-instance prefix every expanded entity
   *  would collide on id (50 instances of "valve" symbol = 50 rows with
   *  the same row id). The prefix is the chain of parent INSERT handles
   *  joined by "::". Top-level entities (no INSERT chain) get prefix=""
   *  and keep their bare handle as the id, matching the pre-block-
   *  expansion convention. */
  idPrefix: string,
): DwgEntityMetadata | null {
  const baseId = entityHandle(entity, `${entity.type?.toLowerCase() ?? "ent"}-${indexHint}`);
  const id = idPrefix ? `${idPrefix}${baseId}` : baseId;
  const layer = entity.layer ?? "0";
  const color = colorForEntity(entity, ctx.layerColors);
  const baseRaw: Record<string, unknown> = {
    handle: entity.handle,
    layer,
    color: entity.color,
    colorIndex: entity.colorIndex,
    lineType: entity.lineType,
    lineweight: entity.lineweight,
  };
  if (blockOrigin) baseRaw.blockOrigin = blockOrigin;

  switch (entity.type) {
    case "LINE": {
      const line = entity as ILineEntity & { vertices?: IPoint[] };
      const start = applyToPoint(transform, line.vertices?.[0]);
      const end = applyToPoint(transform, line.vertices?.[1]);
      if (!start || !end) return null;
      const candidate: Omit<DwgEntityMetadata, "bounds"> = {
        id, type: "LINE", layer, layoutName, color, start, end, raw: baseRaw,
      };
      return { ...candidate, bounds: boundsForEntity(candidate) };
    }
    case "LWPOLYLINE":
    case "POLYLINE": {
      const poly = entity as ILwpolylineEntity & IPolylineEntity;
      const verts = (poly.vertices ?? []).map((v: IPoint) => applyToPoint(transform, v)).filter(Boolean) as DwgPoint[];
      if (verts.length === 0) return null;
      const closed = Boolean((poly as { shape?: boolean }).shape ?? false);
      const candidate: Omit<DwgEntityMetadata, "bounds"> = {
        id, type: entity.type, layer, layoutName, color,
        vertices: verts, closed, raw: baseRaw,
      };
      return { ...candidate, bounds: boundsForEntity(candidate) };
    }
    case "CIRCLE": {
      const circle = entity as ICircleEntity & { center?: IPoint; radius?: number };
      const center = applyToPoint(transform, circle.center);
      if (!center || typeof circle.radius !== "number") return null;
      // Uniform scale only — non-uniform INSERTs of circles become ellipses,
      // which we approximate via the radius * sqrt(|det|) heuristic. Good
      // enough for thumbnails / bounds; precise rendering would require
      // emitting an ELLIPSE primitive instead.
      const det = uniformScaleFactor(transform);
      const candidate: Omit<DwgEntityMetadata, "bounds"> = {
        id, type: "CIRCLE", layer, layoutName, color,
        center, radius: circle.radius * det, raw: baseRaw,
      };
      return { ...candidate, bounds: boundsForEntity(candidate) };
    }
    case "ARC": {
      const arc = entity as IArcEntity & { center?: IPoint; radius?: number; startAngle?: number; endAngle?: number };
      const center = applyToPoint(transform, arc.center);
      if (!center || typeof arc.radius !== "number") return null;
      const det = uniformScaleFactor(transform);
      // Rotation: extract from the affine matrix (angle of the local +X).
      const rotationDeg = (rotationOffset(transform) * 180) / Math.PI;
      const candidate: Omit<DwgEntityMetadata, "bounds"> = {
        id, type: "ARC", layer, layoutName, color,
        center, radius: arc.radius * det,
        raw: {
          ...baseRaw,
          startAngle: ((arc.startAngle ?? 0) + rotationDeg) % 360,
          endAngle: ((arc.endAngle ?? 360) + rotationDeg) % 360,
        },
      };
      return { ...candidate, bounds: boundsForEntity(candidate) };
    }
    case "ELLIPSE": {
      const ell = entity as IEllipseEntity;
      const center = applyToPoint(transform, ell.center);
      const tip = applyToPoint(transform, ell.majorAxisEndPoint);
      if (!center || !tip) return null;
      const majorVecX = tip.x - center.x;
      const majorVecY = tip.y - center.y;
      const majorRadius = Math.hypot(majorVecX, majorVecY);
      const rotationDeg = (Math.atan2(majorVecY, majorVecX) * 180) / Math.PI;
      const candidate: Omit<DwgEntityMetadata, "bounds"> = {
        id, type: "ELLIPSE", layer, layoutName, color,
        center, radius: majorRadius,
        raw: {
          ...baseRaw,
          majorRadius,
          minorRadius: majorRadius * (ell.axisRatio ?? 1),
          ratio: ell.axisRatio ?? 1,
          rotationDeg,
          startAngle: ell.startAngle ?? 0,
          endAngle: ell.endAngle ?? Math.PI * 2,
        },
      };
      return { ...candidate, bounds: boundsForEntity(candidate) };
    }
    case "POINT": {
      const point = entity as IPointEntity & { position?: IPoint };
      const center = applyToPoint(transform, point.position);
      if (!center) return null;
      const candidate: Omit<DwgEntityMetadata, "bounds"> = {
        id, type: "POINT", layer, layoutName, color, center, raw: baseRaw,
      };
      return { ...candidate, bounds: boundsForEntity(candidate) };
    }
    case "TEXT":
    case "MTEXT": {
      const text = entity as (ITextEntity | IMtextEntity) & {
        startPoint?: IPoint;
        position?: IPoint;
        text?: string;
        height?: number;
        rotation?: number;
      };
      const start = applyToPoint(transform, text.startPoint ?? text.position);
      if (!start) return null;
      const candidate: Omit<DwgEntityMetadata, "bounds"> = {
        id, type: entity.type, layer, layoutName, color,
        start,
        text: text.text ?? "",
        raw: { ...baseRaw, height: text.height, rotation: text.rotation },
      };
      return { ...candidate, bounds: boundsForEntity(candidate) };
    }
    case "DIMENSION": {
      // Dimensions render a measurement; we capture the anchor + middle of
      // text so the UI can offer click-to-link, plus the linear endpoints
      // for downstream geometric extraction.
      const dim = entity as IDimensionEntity;
      const anchor = applyToPoint(transform, dim.anchorPoint);
      const middle = applyToPoint(transform, dim.middleOfText);
      const p1 = applyToPoint(transform, dim.linearOrAngularPoint1);
      const p2 = applyToPoint(transform, dim.linearOrAngularPoint2);
      const start = anchor ?? middle ?? p1;
      if (!start) return null;
      const candidate: Omit<DwgEntityMetadata, "bounds"> = {
        id, type: "DIMENSION", layer, layoutName, color,
        start, end: p2 ?? undefined, text: dim.text ?? "",
        raw: {
          ...baseRaw,
          dimensionType: dim.dimensionType,
          actualMeasurement: dim.actualMeasurement,
          angle: dim.angle,
          linearPoint1: p1,
          linearPoint2: p2,
          middleOfText: middle,
          block: dim.block,
        },
      };
      return { ...candidate, bounds: boundsForEntity(candidate) };
    }
    case "SPLINE": {
      const spline = entity as ISplineEntity;
      const verts = splineVertices(spline, transform);
      if (verts.length === 0) return null;
      const candidate: Omit<DwgEntityMetadata, "bounds"> = {
        id, type: "SPLINE", layer, layoutName, color,
        vertices: verts, closed: spline.closed === true,
        raw: {
          ...baseRaw,
          degree: spline.degreeOfSplineCurve,
          controlPointCount: spline.numberOfControlPoints,
          fitPointCount: spline.numberOfFitPoints,
          sampled: spline.fitPoints && spline.fitPoints.length > 1 ? "fitPoints" : "controlPolygon",
        },
      };
      return { ...candidate, bounds: boundsForEntity(candidate) };
    }
    case "INSERT": {
      // INSERTs are not emitted as their own entity in the modelspace —
      // they're replaced by their block expansion. We still keep a
      // breadcrumb for tooling that wants to know "this geometry came from
      // a USED block".
      // Block expansion happens in expandEntities, not here.
      return null;
    }
    case "HATCH": {
      // Hatch boundaries are the takeoff-meaningful geometry. We take the
      // FIRST polyline boundary (the outer outline in typical author
      // convention) and emit it as a closed polyline. Composite-edge
      // boundaries (arcs / splines / lines) aren't sampled in V1 — they're
      // flagged via raw.compositeBoundaryCount so estimators can see when
      // a hatch's curved boundary needs manual review.
      const hatch = entity as IHatchEntity;
      const polylineBoundary = hatch.polylineBoundaries?.[0];
      const transformedVerts = (polylineBoundary?.vertices ?? [])
        .map((p) => applyToPoint(transform, p))
        .filter((p): p is DwgPoint => Boolean(p));
      if (transformedVerts.length === 0) {
        // Either no boundaries at all OR boundaries that are all
        // composite-edge form (line / arc / spline edges) — we don't
        // sample those in V1. Skip the row entirely; without vertices
        // we can't anchor a meaningful candidate. The dxf-parser log
        // line surfaces the count of composite-only HATCHes so the
        // miss is auditable.
        return null;
      }
      const candidate: Omit<DwgEntityMetadata, "bounds"> = {
        id, type: "HATCH", layer, layoutName, color,
        vertices: transformedVerts,
        closed: polylineBoundary?.closed !== false,
        raw: {
          ...baseRaw,
          patternName: hatch.patternName,
          solidFill: hatch.solidFill,
          patternAngle: hatch.patternAngle,
          patternScale: hatch.patternScale,
          associativity: hatch.associativity,
          boundaryPathCount: hatch.boundaryPathCount,
          polylineBoundaryCount: hatch.polylineBoundaries.length,
          compositeBoundaryCount: hatch.compositeBoundaryCount,
        },
      };
      return { ...candidate, bounds: boundsForEntity(candidate) };
    }
    case "3DFACE":
    case "SOLID":
    case "ATTDEF":
      // Captured as a thin metadata row for completeness; geometry is
      // emitted via vertices when present, otherwise we just retain the
      // entity id so consumers can still link to it.
      // dxf-parser exposes vertices for 3DFACE/SOLID.
      const facelike = entity as IEntity & { vertices?: IPoint[] };
      const verts = (facelike.vertices ?? [])
        .map((p) => applyToPoint(transform, p))
        .filter((p): p is DwgPoint => Boolean(p));
      if (verts.length === 0) return null;
      const candidate: Omit<DwgEntityMetadata, "bounds"> = {
        id, type: entity.type, layer, layoutName, color,
        vertices: verts, closed: verts.length >= 3, raw: baseRaw,
      };
      return { ...candidate, bounds: boundsForEntity(candidate) };
    default:
      return null;
  }
}

/** Recursively expand a stream of entities, walking through INSERTs into
 *  their block definitions. Each layer of nesting composes its transform
 *  with the parent's transform; cycles are detected via the `seen` set so
 *  a malformed file with circular block references can't blow the stack.
 *
 *  Entity-id uniqueness: when a user block is inserted multiple times,
 *  every expansion sees the SAME source-entity handle from inside the
 *  block definition. Without disambiguation, all 50 instances of a
 *  "valve" symbol's lines collapse onto the same DwgEntityMetadata.id —
 *  the takeoff system would render one row with 50 phantom links.
 *  `idPrefix` carries the chain of parent INSERT handles (joined by
 *  "::") so each instance's expanded entities land at unique ids:
 *
 *      MODELSPACE.LINE(handle=X)              → id = "X"
 *      INSERT(handle=A) → BLOCK.LINE(X)       → id = "A::X"
 *      INSERT(handle=B) → BLOCK.LINE(X)       → id = "B::X"
 *      OUTER(A) → INNER(B) → BLOCK.LINE(X)    → id = "A::B::X"
 *
 *  Top-level entities pass idPrefix="" — they keep their bare handle as
 *  the id, matching the pre-block-expansion convention so any tests or
 *  fixtures that referenced those ids stay valid. */
function expandEntities(
  entities: IEntity[],
  transform: Affine,
  ctx: BlockExpansionContext,
  layoutName: string,
  blockOrigin: string | null,
  depth: number,
  idPrefix: string = "",
): DwgEntityMetadata[] {
  if (depth > ctx.stats.maxDepth) ctx.stats.maxDepth = depth;
  const out: DwgEntityMetadata[] = [];
  for (let index = 0; index < entities.length; index++) {
    const entity = entities[index]!;
    if (entity.type === "INSERT") {
      ctx.stats.inserts += 1;
      const insert = entity as IInsertEntity;
      const block = ctx.blocks[insert.name];
      if (!block) {
        ctx.stats.missing.add(insert.name);
        continue;
      }
      if (ctx.seen.has(insert.name)) {
        // Cycle — break out, log via missing tracker so it shows up in
        // the audit.
        ctx.stats.missing.add(`${insert.name}#cycle`);
        continue;
      }
      ctx.seen.add(insert.name);
      const composed = multiply(transform, transformForInsert(insert));
      const childOrigin = blockOrigin ? `${blockOrigin}>${insert.name}` : insert.name;
      // Per-instance prefix: use the INSERT's handle when present, else
      // synthesize a stable fallback from its name + position in the
      // parent stream so two anonymous-handle inserts of the same block
      // still get distinct ids.
      const insertId = entityHandle(insert, `${insert.name}#${index + 1}`);
      const childPrefix = `${idPrefix}${insertId}::`;
      const before = out.length;
      out.push(
        ...expandEntities(block.entities ?? [], composed, ctx, layoutName, childOrigin, depth + 1, childPrefix),
      );
      ctx.stats.expanded += out.length - before;
      ctx.seen.delete(insert.name);
      continue;
    }
    const mapped = mapEntity(entity, transform, ctx, layoutName, blockOrigin, index + 1, idPrefix);
    if (mapped) out.push(mapped);
  }
  return out;
}

function mapLayers(layers: Record<string, { name?: string; color?: number; colorIndex?: number; frozen?: boolean; visible?: boolean }> | undefined): {
  layers: DwgLayerMetadata[];
  layerColors: Map<string, string>;
} {
  const out: DwgLayerMetadata[] = [];
  const colors = new Map<string, string>();
  if (!layers) {
    out.push({ name: "0", color: "#d4d4d8", count: 0 });
    colors.set("0", "#d4d4d8");
    return { layers: out, layerColors: colors };
  }
  for (const [name, layer] of Object.entries(layers)) {
    const resolvedColor = aciColor(typeof layer.color === "number" ? Math.abs(layer.color) : layer.colorIndex);
    out.push({
      name: layer.name ?? name,
      color: resolvedColor,
      count: 0,
      frozen: layer.frozen === true,
      locked: false,
      lineType: undefined,
    });
    colors.set(layer.name ?? name, resolvedColor);
  }
  if (out.length === 0) {
    out.push({ name: "0", color: "#d4d4d8", count: 0 });
    colors.set("0", "#d4d4d8");
  }
  return { layers: out, layerColors: colors };
}

/** Multiply every coordinate on every entity by the inch-conversion factor
 *  and rewrite the bounds. Idempotent: passing factor=1 returns the input
 *  unchanged. */
function scaleEntitiesToCanonicalUnits(entities: DwgEntityMetadata[], factor: number): DwgEntityMetadata[] {
  if (factor === 1) return entities;
  return entities.map((entity) => {
    const scaled: Omit<DwgEntityMetadata, "bounds"> = {
      ...entity,
      start: entity.start ? { x: entity.start.x * factor, y: entity.start.y * factor } : undefined,
      end: entity.end ? { x: entity.end.x * factor, y: entity.end.y * factor } : undefined,
      center: entity.center ? { x: entity.center.x * factor, y: entity.center.y * factor } : undefined,
      radius: typeof entity.radius === "number" ? entity.radius * factor : undefined,
      vertices: entity.vertices?.map((v) => ({ x: v.x * factor, y: v.y * factor })),
    };
    return { ...scaled, bounds: boundsForEntity(scaled) };
  });
}

export interface ParseContext {
  documentId: string;
  projectId: string;
  fileName: string;
}

export interface ParsedDrawing {
  units: string;
  originalUnits: string;
  unitScaleFactor: number;
  extents: DwgBounds;
  layers: DwgLayerMetadata[];
  layouts: DwgLayoutMetadata[];
  entities: DwgEntityMetadata[];
  entityStats: { total: number; byType: Record<string, number>; byLayer: Record<string, number> };
  thumbnailSvg: string;
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

/** Exposed for tests. Production callers should go through
 *  `getDwgProcessingResult` which handles caching + persistence. */
export function parseDxfDrawing(input: string, ctx: ParseContext): ParsedDrawing {
  const parser = new DxfParser();
  // Register our HATCH handler before parsing — dxf-parser 1.x doesn't
  // ship a HATCH handler, and without this, every architectural wall
  // hatch, floor pattern, and solid fill silently disappears from the
  // entity list.
  parser.registerEntityHandler(HatchEntityHandler);
  let parsed: IDxf | null;
  try {
    parsed = parser.parseSync(input);
  } catch (err) {
    throw new Error(`DXF parse error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed) {
    throw new Error("dxf-parser returned null — input does not look like a valid DXF file.");
  }

  // Unit detection happens BEFORE entity mapping so we can apply the scale
  // factor at the end of the pipeline in one pass.
  const originalUnits = dxfHeaderUnitName(parsed.header as Record<string, unknown>);
  const unitScaleFactor = unitToInchFactor(originalUnits);
  const canonicalUnits = "in";

  logVectorPipeline({
    kind: "dxf:unit_normalization",
    documentId: ctx.documentId,
    projectId: ctx.projectId,
    originalUnits,
    canonicalUnits,
    scaleFactor: unitScaleFactor,
    passthrough: originalUnits === "unitless",
  });

  const { layers: rawLayers, layerColors } = mapLayers(parsed.tables?.layer?.layers);

  // Build the block context up front so INSERTs encountered while iterating
  // modelspace can resolve their referenced block by name.
  const blockCtx: BlockExpansionContext = {
    blocks: parsed.blocks ?? {},
    layerColors,
    seen: new Set(),
    stats: { inserts: 0, expanded: 0, maxDepth: 0, missing: new Set() },
  };

  const rawEntities = parsed.entities ?? [];
  const rawByType: Record<string, number> = {};
  for (const entity of rawEntities) {
    const type = entity.type ?? "UNKNOWN";
    rawByType[type] = (rawByType[type] ?? 0) + 1;
  }

  // ── Layout assignment ──────────────────────────────────────────────────
  // The hand-rolled parser we replaced read DXF group 410 (layout name)
  // directly off each entity. dxf-parser instead exposes `inPaperSpace:
  // boolean` per entity, plus paperspace blocks in `parsed.blocks` where
  // `paperSpace=true`. Reconstruct the layout split as follows:
  //
  //   1. Split `parsed.entities` by inPaperSpace. Modelspace half lands
  //      under "Model"; the active paperspace half lands under "Paper
  //      Space" (the layout that's currently displayed in CAD).
  //   2. Iterate `parsed.blocks` for paperspace blocks NOT covered by
  //      step 1's active paperspace. These are inactive layouts
  //      (e.g. `*Paper_Space0`, `*Paper_Space1`) whose entities live
  //      entirely inside the block definition. Each one becomes its
  //      own layout in the output, named after the block (prettified).
  //
  // Entity handles are tracked across both passes so any overlap between
  // `parsed.entities` and `parsed.blocks["*Paper_Space"].entities`
  // doesn't produce duplicates.
  const seenHandles = new Set<string>();
  const recordHandle = (handle: IEntity["handle"] | undefined) => {
    if (typeof handle === "string" && handle) seenHandles.add(handle);
    else if (typeof handle === "number" && Number.isFinite(handle)) seenHandles.add(String(handle));
  };
  const modelEntitiesRaw: IEntity[] = [];
  const activePaperEntitiesRaw: IEntity[] = [];
  for (const e of rawEntities) {
    recordHandle(e.handle);
    if (e.inPaperSpace) activePaperEntitiesRaw.push(e);
    else modelEntitiesRaw.push(e);
  }
  const hasActivePaper = activePaperEntitiesRaw.length > 0;

  let entities: DwgEntityMetadata[] = [];
  entities.push(...expandEntities(modelEntitiesRaw, IDENTITY, blockCtx, "Model", null, 0));
  if (hasActivePaper) {
    entities.push(...expandEntities(activePaperEntitiesRaw, IDENTITY, blockCtx, "Paper Space", null, 0));
  }

  // Inactive paperspace layouts: iterate paperspace blocks, skip the
  // active one (covered above) and the modelspace block (its entities
  // are in parsed.entities already).
  for (const [blockKey, block] of Object.entries(parsed.blocks ?? {})) {
    if (!block.paperSpace) continue;
    const blockName = block.name ?? blockKey;
    const upper = blockName.toUpperCase();
    if (upper === "*MODEL_SPACE") continue;
    // The "active paperspace" block is the one whose contents already
    // appeared in parsed.entities. Heuristic: it's named `*Paper_Space`
    // (no trailing digits) and parsed.entities had paperspace content.
    if (hasActivePaper && upper === "*PAPER_SPACE") continue;
    const blockEntities = (block.entities ?? []).filter((e: IEntity) => {
      const handle = typeof e.handle === "string"
        ? e.handle
        : typeof e.handle === "number" && Number.isFinite(e.handle) ? String(e.handle) : "";
      if (!handle) return true; // accept entities with no handle (rare)
      if (seenHandles.has(handle)) return false;
      seenHandles.add(handle);
      return true;
    });
    if (blockEntities.length === 0) continue;
    const layoutName = prettifyLayoutName(blockName);
    entities.push(...expandEntities(blockEntities, IDENTITY, blockCtx, layoutName, null, 0));
  }

  logVectorPipeline({
    kind: "dxf:block_expansion",
    documentId: ctx.documentId,
    projectId: ctx.projectId,
    insertCount: blockCtx.stats.inserts,
    expandedEntityCount: blockCtx.stats.expanded,
    maxDepth: blockCtx.stats.maxDepth,
    missingBlocks: Array.from(blockCtx.stats.missing),
  });

  // Apply unit scaling AFTER expansion so the scale factor doesn't compound
  // through block transforms.
  entities = scaleEntitiesToCanonicalUnits(entities, unitScaleFactor);

  const extents = unionBounds(entities.map((entity) => entity.bounds));
  const finalLayers = finalizeLayers(rawLayers, entities);
  const layouts = buildLayouts(entities);

  return {
    units: canonicalUnits,
    originalUnits,
    unitScaleFactor,
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
  const envCommand = process.env.BIDWRIGHT_DWG_CONVERTER_CMD?.trim();
  const commands = envCommand
    ? [envCommand]
    : [
        "dwg2dxf {input} -o {output} -y",
        `${process.env.HOME ?? "/root"}/.local/bin/dwg2dxf {input} -o {output} -y`,
        "/usr/local/bin/dwg2dxf {input} -o {output} -y",
        "ODAFileConverter {input} {output} ACAD2018 DXF",
      ];

  const tempDir = await mkdtemp(join(tmpdir(), "bidwright-dwg-"));
  const outputPath = join(tempDir, "converted.dxf");
  try {
    for (const command of commands) {
      const parsed = parseConverterCommand(command, inputPath, outputPath);
      if (!parsed) continue;
      try {
        await execFileAsync(parsed.file, parsed.args, { timeout: 120_000, maxBuffer: 1024 * 1024 * 8 });
        const dxfText = await readFile(outputPath, "utf-8");
        if (dxfText && dxfText.length > 0) {
          return { dxfText, converter: { status: "configured", command } };
        }
      } catch {
        continue;
      }
    }
    return {
      converter: {
        status: "missing",
        message: "No DWG converter found. Install LibreDWG (dwg2dxf) or set BIDWRIGHT_DWG_CONVERTER_CMD.",
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

async function persistResult(documentId: string, result: DwgProcessingResult, currentStructuredData: unknown, sourceKind?: "source_document" | "file_node") {
  if (sourceKind === "file_node") {
    const current = currentStructuredData && typeof currentStructuredData === "object" ? currentStructuredData as Record<string, unknown> : {};
    await prisma.fileNode.update({
      where: { id: documentId },
      data: { metadata: { ...current, dwgTakeoff: result } as unknown as Prisma.InputJsonValue },
    });
  } else {
    const nextStructuredData = {
      ...(currentStructuredData && typeof currentStructuredData === "object" ? currentStructuredData as Record<string, unknown> : {}),
      dwgTakeoff: result,
    };
    await prisma.sourceDocument.update({
      where: { id: documentId },
      data: { structuredData: nextStructuredData as unknown as Prisma.InputJsonValue },
    });
  }
}

export async function getDwgProcessingResult(
  projectId: string,
  documentId: string,
  options: { refresh?: boolean; sourceKind?: "source_document" | "file_node" } = {},
): Promise<DwgProcessingResult> {
  const sourceKind = options.sourceKind ?? "source_document";

  let storagePath: string | null;
  let fileName: string;
  let structuredData: unknown;
  let fileId: string;

  if (sourceKind === "file_node") {
    const fileNode = await prisma.fileNode.findFirst({ where: { id: documentId, projectId } });
    if (!fileNode) throw Object.assign(new Error("Drawing file not found."), { statusCode: 404 });
    if (fileNode.type !== "file") throw Object.assign(new Error("Selected item is not a file."), { statusCode: 400 });
    storagePath = fileNode.storagePath;
    fileName = fileNode.name;
    structuredData = fileNode.metadata;
    fileId = fileNode.id;
  } else {
    const document = await prisma.sourceDocument.findFirst({ where: { id: documentId, projectId } });
    if (!document) throw Object.assign(new Error("Drawing document not found."), { statusCode: 404 });
    storagePath = document.storagePath;
    fileName = document.fileName;
    structuredData = document.structuredData;
    fileId = document.id;
  }

  const cached = (structuredData as { dwgTakeoff?: DwgProcessingResult } | null)?.dwgTakeoff;
  if (!options.refresh && cached?.schemaVersion === 1 && cached.processorVersion === PROCESSOR_VERSION) {
    return cached;
  }

  if (!storagePath) {
    throw Object.assign(new Error("Drawing file is not available on disk."), { statusCode: 404 });
  }

  const sourcePath = resolveApiPath(storagePath);
  const bytes = await readFile(sourcePath);
  const sourceHash = hashBytes(bytes);
  const ext = extensionOf(fileName);
  const fileSourceKind = ext === "dxf" ? "dxf" : ext === "dwg" ? "dwg" : "unknown";
  const processedAt = new Date().toISOString();
  const versionId = randomUUID();
  let dxfText: string | undefined;
  let converter: DwgProcessingResult["converter"] = { status: "not_required" };

  if (fileSourceKind === "dxf" || bytes.toString("utf-8", 0, Math.min(bytes.byteLength, 5000)).includes("SECTION")) {
    dxfText = bytes.toString("utf-8");
  } else if (fileSourceKind === "dwg") {
    const converterStart = Date.now();
    const converted = await convertDwgToDxf(sourcePath);
    dxfText = converted.dxfText;
    converter = converted.converter;
    logVectorPipeline({
      kind: "dxf:converter",
      documentId: fileId,
      projectId,
      fileName,
      status: converter.status,
      command: converter.command,
      durationMs: Date.now() - converterStart,
      error: converter.message,
    });
  }

  const ctx: ParseContext = { documentId: fileId, projectId, fileName };
  const parseStart = Date.now();

  if (!dxfText) {
    const result: DwgProcessingResult = {
      schemaVersion: 1,
      processorVersion: PROCESSOR_VERSION,
      documentId: fileId,
      projectId,
      fileName,
      sourceHash,
      processedAt,
      status: "converter_required",
      sourceKind: fileSourceKind,
      converter,
      units: "unitless",
      originalUnits: "unitless",
      unitScaleFactor: 1,
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
          sourceKind: fileSourceKind,
          entityCount: 0,
          layerCount: 0,
          layoutCount: 0,
          converterStatus: converter.status,
        }),
        ...priorVersions(structuredData),
      ].slice(0, MAX_STORED_VERSIONS),
    };
    logVectorPipeline({
      kind: "dxf:parse",
      documentId: fileId,
      projectId,
      fileName,
      status: "converter_required",
      rawEntityCount: 0,
      finalEntityCount: 0,
      byType: {},
      blockCount: 0,
      layerCount: 0,
      layoutCount: 0,
      originalUnits: "unitless",
      canonicalUnits: "in",
      unitScaleFactor: 1,
      durationMs: Date.now() - parseStart,
    });
    await persistResult(fileId, result, structuredData, sourceKind);
    return result;
  }

  try {
    const parsed = parseDxfDrawing(dxfText, ctx);
    const result: DwgProcessingResult = {
      schemaVersion: 1,
      processorVersion: PROCESSOR_VERSION,
      documentId: fileId,
      projectId,
      fileName,
      sourceHash,
      processedAt,
      status: "processed",
      sourceKind: fileSourceKind,
      converter,
      ...parsed,
      activeVersionId: versionId,
      versions: [
        makeVersion({
          id: versionId,
          processedAt,
          sourceHash,
          status: "processed",
          sourceKind: fileSourceKind,
          entityCount: parsed.entities.length,
          layerCount: parsed.layers.length,
          layoutCount: parsed.layouts.length,
          converterStatus: converter.status,
        }),
        ...priorVersions(structuredData),
      ].slice(0, MAX_STORED_VERSIONS),
    };
    logVectorPipeline({
      kind: "dxf:parse",
      documentId: fileId,
      projectId,
      fileName,
      status: "processed",
      rawEntityCount: parsed.entityStats.total,
      finalEntityCount: parsed.entities.length,
      byType: Object.fromEntries(
        Object.entries(parsed.entityStats.byType).map(([type, count]) => [type, { raw: count, expanded: count }]),
      ),
      blockCount: parsed.layouts.length,
      layerCount: parsed.layers.length,
      layoutCount: parsed.layouts.length,
      originalUnits: parsed.originalUnits,
      canonicalUnits: parsed.units,
      unitScaleFactor: parsed.unitScaleFactor,
      durationMs: Date.now() - parseStart,
    });
    await persistResult(fileId, result, structuredData, sourceKind);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not parse DXF entities.";
    const result: DwgProcessingResult = {
      schemaVersion: 1,
      processorVersion: PROCESSOR_VERSION,
      documentId: fileId,
      projectId,
      fileName,
      sourceHash,
      processedAt,
      status: "failed",
      sourceKind: fileSourceKind,
      converter,
      units: "unitless",
      originalUnits: "unitless",
      unitScaleFactor: 1,
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
          sourceKind: fileSourceKind,
          entityCount: 0,
          layerCount: 0,
          layoutCount: 0,
          converterStatus: converter.status,
        }),
        ...priorVersions(structuredData),
      ].slice(0, MAX_STORED_VERSIONS),
    };
    logVectorPipeline({
      kind: "dxf:parse",
      documentId: fileId,
      projectId,
      fileName,
      status: "failed",
      rawEntityCount: 0,
      finalEntityCount: 0,
      byType: {},
      blockCount: 0,
      layerCount: 0,
      layoutCount: 0,
      originalUnits: "unitless",
      canonicalUnits: "in",
      unitScaleFactor: 1,
      durationMs: Date.now() - parseStart,
      error: message,
    });
    await persistResult(fileId, result, structuredData, sourceKind);
    throw Object.assign(new Error(message), { statusCode: 400, result });
  }
}
