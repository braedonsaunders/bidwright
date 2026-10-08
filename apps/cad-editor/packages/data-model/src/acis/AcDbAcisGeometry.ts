// ACIS B-rep geometry extraction.
//
// Turns the resolved record graph (./AcDbAcisEntities.ts AcDbAcisModel) into usable geometry:
// vertices (3D points), edges (segments between resolved vertex points + curve
// type/params), and faces (surface type/params + loop structure). It reads each
// record's analytic parameters by SAB token TAG-TYPE in wire order (a TokenCursor
// that skips pointer/int noise) — NOT by positional field schema, which is the
// exact assumption that breaks ezdxf's typed loader on newer ASM streams.
//
// Field-order sources (see DEFERRED note for intcurve):
//   point / straight-curve / plane-surface — ezdxf ezdxf/acis/entities.py
//     (Point.restore_data, StraightCurve.restore_data, Plane.restore_common) — oracle-backed.
//   ellipse-curve / cone-surface / torus-surface — spec-confirmed against the
//     ACIS 7.0 SAT save-file reference (ellipse/cone restore_data field order)
//     and empirically cross-checked vs corpus records + an annotated .sat. There
//     is no automated runtime oracle (ezdxf has no Ellipse/Cone/Torus types).

import type { AcDbAcisModel, AcDbAcisNode } from './AcDbAcisEntities'
import type { AcDbAcisSabToken, AcDbAcisSabVector } from './AcDbAcisSab'
import { AcDbAcisSabTag } from './AcDbAcisSab'
import {
  type AcDbAcisAffineTransform,
  acdbAcisBuildNodeTransforms,
  acdbAcisIdentityTransform,
  acdbAcisTransformDirection,
  acdbAcisTransformIsIdentity,
  acdbAcisTransformPoint,
} from './AcDbAcisTransform'

/** 3D position or direction vector `[x, y, z]`. */
export type AcDbAcisVec3 = AcDbAcisSabVector

/** Known analytic curve kinds extracted from ACIS edge geometry. */
export type AcDbAcisCurveKind = 'straight' | 'ellipse' | 'intcurve' | 'unknown';

/** Known analytic surface kinds extracted from ACIS face geometry. */
export type AcDbAcisSurfaceKind = 'plane' | 'cone' | 'torus' | 'sphere' | 'spline' | 'unknown';

/** Parameters for a straight (line) ACIS curve. */
export interface AcDbAcisStraightCurveParams {
  readonly kind: 'straight';
  /** Line origin in model space. */
  readonly origin: AcDbAcisVec3;
  /** Unit direction vector along the line. */
  readonly direction: AcDbAcisVec3;
}

/** Parameters for an ellipse (or circular arc) ACIS curve. */
export interface AcDbAcisEllipseCurveParams {
  readonly kind: 'ellipse';
  /** Ellipse center in model space. */
  readonly center: AcDbAcisVec3;
  /** Plane normal of the ellipse. */
  readonly normal: AcDbAcisVec3;
  /** Major-axis vector (length defines semi-major axis). */
  readonly majorAxis: AcDbAcisVec3;
  /** Ratio of minor to major axis length. */
  readonly ratio: number;
}

/**
 * An interpolated/intersection spline curve. `controlPoints` is the `nubs`/`nurbs`
 * B-spline control polygon extracted from the record's subtype block — a usable
 * polyline approximation of the curve (the first/last control point coincide with
 * the edge's start/end vertices). Empty when the subtype is a `nullbs` placeholder
 * or the control polygon could not be read. Full NURBS evaluation is out of scope.
 */
export interface AcDbAcisIntCurveParams {
  readonly kind: 'intcurve';
  /** B-spline control polygon used as a polyline wireframe approximation. */
  readonly controlPoints: readonly AcDbAcisVec3[];
}

/** Discriminated union of parsed ACIS curve parameters. */
export type AcDbAcisCurveParams =
  | AcDbAcisStraightCurveParams
  | AcDbAcisEllipseCurveParams
  | AcDbAcisIntCurveParams
  | { readonly kind: 'unknown' };

/** Parameters for a plane ACIS surface. */
export interface AcDbAcisPlaneParams {
  readonly kind: 'plane';
  /** Point on the plane. */
  readonly origin: AcDbAcisVec3;
  /** Outward plane normal. */
  readonly normal: AcDbAcisVec3;
  /** Optional in-plane U direction. */
  readonly uDir?: AcDbAcisVec3;
}

/** Parameters for a cone (or cylinder) ACIS surface. */
export interface AcDbAcisConeParams {
  readonly kind: 'cone';
  /** Apex or base reference point. */
  readonly origin: AcDbAcisVec3;
  /** Axis direction. */
  readonly axis: AcDbAcisVec3;
  /** Major-axis vector in the base plane. */
  readonly majorAxis: AcDbAcisVec3;
  /** Ratio of minor to major axis in the base ellipse. */
  readonly ratio: number;
  /** Sine of the half-angle between axis and surface generator. */
  readonly sineAngle: number;
  /** Cosine of the half-angle between axis and surface generator. */
  readonly cosineAngle: number;
}

/** Parameters for a torus ACIS surface. */
export interface AcDbAcisTorusParams {
  readonly kind: 'torus';
  /** Torus center in model space. */
  readonly center: AcDbAcisVec3;
  /** Revolution axis direction. */
  readonly axis: AcDbAcisVec3;
  /** Distance from center to tube centerline. */
  readonly majorRadius: number;
  /** Tube radius. */
  readonly minorRadius: number;
}

/** Parameters for a sphere ACIS surface. */
export interface AcDbAcisSphereParams {
  readonly kind: 'sphere';
  /** Sphere center in model space. */
  readonly center: AcDbAcisVec3;
  /** Sphere radius. */
  readonly radius: number;
  /** Reference U direction on the sphere. */
  readonly uDir: AcDbAcisVec3;
  /** Pole axis direction. */
  readonly poleAxis: AcDbAcisVec3;
}

/** Discriminated union of parsed ACIS surface parameters. */
export type AcDbAcisSurfaceParams =
  | AcDbAcisPlaneParams
  | AcDbAcisConeParams
  | AcDbAcisTorusParams
  | AcDbAcisSphereParams
  | { readonly kind: 'unknown' };

/**
 * A B-rep vertex with its resolved 3D point location.
 */
export interface AcDbAcisVertex {
  /** Index of the source `vertex` node in the model graph. */
  readonly nodeIndex: number;
  /** Resolved 3D point location, or `null` when the pointer chain is broken. */
  readonly point: AcDbAcisVec3 | null;
}

/**
 * A B-rep edge with resolved endpoint locations and optional curve parameters.
 */
export interface AcDbAcisEdge {
  /** Index of the source `edge` node in the model graph. */
  readonly nodeIndex: number;
  /** Resolved start vertex location. */
  readonly start: AcDbAcisVec3 | null;
  /** Resolved end vertex location. */
  readonly end: AcDbAcisVec3 | null;
  /** Parsed analytic curve kind. */
  readonly curveType: AcDbAcisCurveKind;
  /** Parsed curve parameters when the subtype is recognized. */
  readonly curve?: AcDbAcisCurveParams;
}

/**
 * One boundary loop on a B-rep face.
 */
export interface AcDbAcisFaceLoop {
  /** Index of the source `loop` node in the model graph. */
  readonly nodeIndex: number;
  /** Number of coedges in the loop ring. */
  readonly coedgeCount: number;
}

/**
 * A B-rep face with surface type/parameters and boundary loop structure.
 */
export interface AcDbAcisFace {
  /** Index of the source `face` node in the model graph. */
  readonly nodeIndex: number;
  /** Parsed analytic surface kind. */
  readonly surfaceType: AcDbAcisSurfaceKind;
  /** Parsed surface parameters when the subtype is recognized. */
  readonly surface?: AcDbAcisSurfaceParams;
  /** Ordered boundary loops on this face. */
  readonly loops: readonly AcDbAcisFaceLoop[];
}

/** Axis-aligned bounding box over a set of 3D points. */
export interface AcDbAcisBBox {
  /** Minimum corner `[x, y, z]`. */
  readonly min: AcDbAcisVec3;
  /** Maximum corner `[x, y, z]`. */
  readonly max: AcDbAcisVec3;
}

/** An indexed triangle mesh for one face: shared `positions` + `triangles` (index triples). */
export interface AcDbAcisTriangleMesh {
  /** Source surface kind for this mesh. */
  readonly surfaceType: AcDbAcisSurfaceKind;
  /** Shared vertex positions referenced by `triangles`. */
  readonly positions: readonly AcDbAcisVec3[];
  /** Triangle index triples into `positions`. */
  readonly triangles: readonly (readonly [number, number, number])[];
}

/**
 * Tessellation of a body's faces.
 *
 * - `faces`: legacy flat-polygon rings — one ordered ring per plane-surface face
 *   bounded entirely by straight edges (kept for existing consumers).
 * - `triangles`: indexed triangle meshes covering plane faces (fan-triangulated)
 *   **and** the analytic curved faces — `cone` (incl. cylinders) and `torus`,
 *   meshed as full surfaces of revolution with the v-range taken from each
 *   face's loops. Correct for full-revolution faces (the common case);
 *   u-partial curved faces are approximated (flagged in `diagnostics`).
 *   sphere/spline surfaces are not meshed.
 */
export interface AcDbAcisMesh {
  /** Legacy flat polygon rings for plane faces bounded by straight edges. */
  readonly faces: readonly (readonly AcDbAcisVec3[])[];
  /** Indexed triangle meshes for plane and selected curved faces. */
  readonly triangles: readonly AcDbAcisTriangleMesh[];
  /** Best-effort tessellation notes and approximations. */
  readonly diagnostics: readonly string[];
}

/** Options for {@link tessellateAcDbAcisGeometry}. */
export interface AcDbAcisTessellationOptions {
  /** Samples per full revolution for curved faces (≥3). Default 32. */
  readonly segments?: number;
}

/**
 * Extracted B-rep geometry from a decoded ACIS model.
 */
export interface AcDbAcisGeometry {
  /** Resolved B-rep vertices. */
  readonly vertices: readonly AcDbAcisVertex[];
  /** Resolved B-rep edges with optional curve parameters. */
  readonly edges: readonly AcDbAcisEdge[];
  /** Resolved B-rep faces with optional surface parameters. */
  readonly faces: readonly AcDbAcisFace[];
  /** Wireframe bounding box over resolved vertex points, or null when none resolve. */
  readonly bbox: AcDbAcisBBox | null;
  /** Best-effort notes: dangling pointers, degenerate edges, unhandled subtypes. */
  readonly diagnostics: readonly string[];
}

/**
 * Summary statistics over extracted ACIS geometry.
 */
export interface AcDbAcisGeometrySummary {
  /** Number of resolved vertices. */
  readonly vertexCount: number;
  /** Number of resolved edges. */
  readonly edgeCount: number;
  /** Number of resolved faces. */
  readonly faceCount: number;
  /** Total boundary loops across all faces. */
  readonly loopCount: number;
  /** Histogram of parsed curve kinds. */
  readonly curveTypes: Readonly<Record<AcDbAcisCurveKind, number>>;
  /** Histogram of parsed surface kinds. */
  readonly surfaceTypes: Readonly<Record<AcDbAcisSurfaceKind, number>>;
  /** Bounding box over resolved vertices, if any. */
  readonly bbox: AcDbAcisBBox | null;
  /** Number of diagnostic messages. */
  readonly diagnosticCount: number;
  /** Diagnostic messages from geometry extraction. */
  readonly diagnostics: readonly string[];
}

/** Walks a record's tokens in wire order, yielding the next token of a wanted tag. */
class AcDbAcisTokenCursor {
  private i = 0;
  constructor(private readonly tokens: readonly AcDbAcisSabToken[]) {}
  private next(...tags: number[]): AcDbAcisSabToken | undefined {
    while (this.i < this.tokens.length) {
      const token = this.tokens[this.i++];
      if (token !== undefined && tags.includes(token.tag)) return token;
    }
    return undefined;
  }
  nextVec(): AcDbAcisVec3 | undefined {
    return this.next(AcDbAcisSabTag.LocationVec, AcDbAcisSabTag.DirectionVec)?.value as AcDbAcisVec3 | undefined;
  }
  nextDouble(): number | undefined {
    return this.next(AcDbAcisSabTag.Double)?.value as number | undefined;
  }
}

const refOfType = (node: AcDbAcisNode, suffix: string): AcDbAcisNode | null =>
  node.refs.find(r => r !== null && (r.type === suffix || r.type.endsWith(suffix))) ?? null;
const refsOfType = (node: AcDbAcisNode, type: string): AcDbAcisNode[] =>
  node.refs.filter((r): r is AcDbAcisNode => r !== null && r.type === type);

function vertexPoint(vertex: AcDbAcisNode | null): AcDbAcisVec3 | null {
  if (vertex === null) return null;
  const point = refOfType(vertex, 'point');
  if (point === null) return null;
  const vec = point.record.tokens.find(t => t.tag === AcDbAcisSabTag.LocationVec);
  return vec ? (vec.value as AcDbAcisVec3) : null;
}

function curveParams(curve: AcDbAcisNode): AcDbAcisCurveParams {
  const c = new AcDbAcisTokenCursor(curve.record.tokens);
  if (curve.type === 'straight-curve') {
    const origin = c.nextVec(); const direction = c.nextVec();
    if (origin && direction) return { kind: 'straight', origin, direction };
  } else if (curve.type === 'ellipse-curve') {
    const center = c.nextVec(); const normal = c.nextVec(); const majorAxis = c.nextVec();
    const ratio = c.nextDouble();
    if (center && normal && majorAxis && ratio !== undefined) {
      return { kind: 'ellipse', center, normal, majorAxis, ratio };
    }
  } else if (curve.type === 'intcurve-curve') {
    return { kind: 'intcurve', controlPoints: intcurveControlPoints(curve.record.tokens) };
  }
  return { kind: 'unknown' };
}

/**
 * Extract the `nubs`/`nurbs` B-spline control polygon from an intcurve-curve's
 * subtype tokens. Layout (ACIS .sat): after the `nubs` entity-type come
 * `degree`, a flag enum, `numDistinctKnots`, then `numDistinctKnots × (knot
 * Double, multiplicity Int)`, then a run of control-point coordinate Doubles
 * (grouped into x/y/z triples; any trailing fit-tolerance scalar is dropped).
 */
function intcurveControlPoints(tokens: readonly AcDbAcisSabToken[]): AcDbAcisVec3[] {
  const nubs = tokens.findIndex(t => t.tag === AcDbAcisSabTag.EntityType && (t.value === 'nubs' || t.value === 'nurbs'));
  if (nubs < 0) return [];
  // numKnots is the last Int before the first Double after `nubs` (skips degree/flag).
  let i = nubs + 1;
  let numKnots = -1;
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === undefined) break;
    if (t.tag === AcDbAcisSabTag.Double) break;
    if (t.tag === AcDbAcisSabTag.Int) numKnots = t.value as number;
    if (t.tag === AcDbAcisSabTag.EntityType || t.tag === AcDbAcisSabTag.SubtypeEnd) return [];
  }
  if (numKnots < 0) return [];
  for (let k = 0; k < numKnots; k++) {
    if (tokens[i]?.tag !== AcDbAcisSabTag.Double) return []; // knot value
    i += 1;
    if (tokens[i]?.tag === AcDbAcisSabTag.Int) i += 1;       // multiplicity (optional)
  }
  const coords: number[] = [];
  while (tokens[i]?.tag === AcDbAcisSabTag.Double) {
    const token = tokens[i];
    if (token === undefined) break;
    coords.push(token.value as number);
    i += 1;
  }
  const points: AcDbAcisVec3[] = [];
  for (let k = 0; k + 3 <= coords.length; k += 3) {
    const x = coords[k];
    const y = coords[k + 1];
    const z = coords[k + 2];
    if (x === undefined || y === undefined || z === undefined) break;
    points.push([x, y, z]);
  }
  return points;
}

function surfaceParams(surface: AcDbAcisNode): AcDbAcisSurfaceParams {
  const c = new AcDbAcisTokenCursor(surface.record.tokens);
  if (surface.type === 'plane-surface') {
    const origin = c.nextVec(); const normal = c.nextVec(); const uDir = c.nextVec();
    if (origin && normal) return uDir ? { kind: 'plane', origin, normal, uDir } : { kind: 'plane', origin, normal };
  } else if (surface.type === 'cone-surface') {
    const origin = c.nextVec(); const axis = c.nextVec(); const majorAxis = c.nextVec();
    const ratio = c.nextDouble(); const sineAngle = c.nextDouble(); const cosineAngle = c.nextDouble();
    if (origin && axis && majorAxis && ratio !== undefined && sineAngle !== undefined && cosineAngle !== undefined) {
      return { kind: 'cone', origin, axis, majorAxis, ratio, sineAngle, cosineAngle };
    }
  } else if (surface.type === 'torus-surface') {
    const center = c.nextVec(); const axis = c.nextVec();
    const majorRadius = c.nextDouble(); const minorRadius = c.nextDouble();
    if (center && axis && majorRadius !== undefined && minorRadius !== undefined) {
      return { kind: 'torus', center, axis, majorRadius, minorRadius };
    }
  } else if (surface.type === 'sphere-surface') {
    const center = c.nextVec();
    const radius = c.nextDouble();
    const uDir = c.nextVec();
    const poleAxis = c.nextVec();
    if (center && radius !== undefined && uDir && poleAxis) {
      return { kind: 'sphere', center, radius, uDir, poleAxis };
    }
  }
  return { kind: 'unknown' };
}

/**
 * Parses analytic surface parameters from a `-surface` ACIS node.
 *
 * @param surface - Resolved surface node from an ACIS model graph.
 * @returns Discriminated surface parameters, or `{ kind: 'unknown' }`.
 */
export function acdbAcisParseSurfaceParams(surface: AcDbAcisNode): AcDbAcisSurfaceParams {
  return surfaceParams(surface);
}

const SURFACE_KIND: Record<string, AcDbAcisSurfaceKind> = {
  'plane-surface': 'plane', 'cone-surface': 'cone', 'torus-surface': 'torus',
  'sphere-surface': 'sphere', 'spline-surface': 'spline',
};
const CURVE_KIND: Record<string, AcDbAcisCurveKind> = {
  'straight-curve': 'straight', 'ellipse-curve': 'ellipse', 'intcurve-curve': 'intcurve',
};

/** Count coedges in a loop's ring (next-coedge in wire order), guarded against cycles. */
function loopCoedgeCount(loop: AcDbAcisNode): number {
  const start = refOfType(loop, 'coedge');
  if (start === null) return 0;
  const seen = new Set<number>();
  let coedge: AcDbAcisNode | null = start;
  while (coedge !== null && !seen.has(coedge.index)) {
    seen.add(coedge.index);
    // next_coedge is the first coedge-typed ref (next, prev, partner follow in wire order).
    coedge = refsOfType(coedge, 'coedge')[0] ?? null;
  }
  return seen.size;
}

/**
 * Applies a body transform to analytic curve parameters.
 *
 * @param curve - Parsed curve parameters in body space.
 * @param transform - Body-to-model transform.
 */
function transformCurveParams(
  curve: AcDbAcisCurveParams,
  transform: AcDbAcisAffineTransform,
): AcDbAcisCurveParams {
  if (curve.kind === 'straight') {
    return {
      kind: 'straight',
      origin: acdbAcisTransformPoint(curve.origin, transform),
      direction: acdbAcisTransformDirection(curve.direction, transform),
    }
  }
  if (curve.kind === 'ellipse') {
    return {
      kind: 'ellipse',
      center: acdbAcisTransformPoint(curve.center, transform),
      normal: acdbAcisTransformDirection(curve.normal, transform),
      majorAxis: acdbAcisTransformDirection(curve.majorAxis, transform),
      ratio: curve.ratio,
    }
  }
  if (curve.kind === 'intcurve') {
    return {
      kind: 'intcurve',
      controlPoints: curve.controlPoints.map(p =>
        acdbAcisTransformPoint(p, transform),
      ),
    }
  }
  return curve
}

/**
 * Applies a body transform to analytic surface parameters.
 *
 * @param surface - Parsed surface parameters in body space.
 * @param transform - Body-to-model transform.
 */
function transformSurfaceParams(
  surface: AcDbAcisSurfaceParams,
  transform: AcDbAcisAffineTransform,
): AcDbAcisSurfaceParams {
  if (surface.kind === 'plane') {
    return {
      kind: 'plane',
      origin: acdbAcisTransformPoint(surface.origin, transform),
      normal: acdbAcisTransformDirection(surface.normal, transform),
      ...(surface.uDir
        ? { uDir: acdbAcisTransformDirection(surface.uDir, transform) }
        : {}),
    }
  }
  if (surface.kind === 'cone') {
    return {
      kind: 'cone',
      origin: acdbAcisTransformPoint(surface.origin, transform),
      axis: acdbAcisTransformDirection(surface.axis, transform),
      majorAxis: acdbAcisTransformDirection(surface.majorAxis, transform),
      ratio: surface.ratio,
      sineAngle: surface.sineAngle,
      cosineAngle: surface.cosineAngle,
    }
  }
  if (surface.kind === 'torus') {
    return {
      kind: 'torus',
      center: acdbAcisTransformPoint(surface.center, transform),
      axis: acdbAcisTransformDirection(surface.axis, transform),
      majorRadius: surface.majorRadius * transform.scale,
      minorRadius: surface.minorRadius * transform.scale,
    }
  }
  if (surface.kind === 'sphere') {
    return {
      kind: 'sphere',
      center: acdbAcisTransformPoint(surface.center, transform),
      radius: surface.radius * transform.scale,
      uDir: acdbAcisTransformDirection(surface.uDir, transform),
      poleAxis: acdbAcisTransformDirection(surface.poleAxis, transform),
    }
  }
  return surface
}

/**
 * Extract the B-rep geometry from a decoded ACIS model. Never throws; unresolved
 * topology/geometry is reported via `diagnostics` and `'unknown'` type labels.
 *
 * Coordinates are returned in model space: each entity is mapped by its owning
 * body's `transform` (multi-body models with distinct transforms are supported).
 *
 * @param model - Resolved ACIS model graph.
 * @returns Extracted vertices, edges, faces, bounding box, and diagnostics.
 */
export function acdbExtractAcisGeometry(model: AcDbAcisModel): AcDbAcisGeometry {
  const diagnostics: string[] = [];
  const transformsByNode = acdbAcisBuildNodeTransforms(model)
  const identity = acdbAcisIdentityTransform()
  const transformFor = (nodeIndex: number): AcDbAcisAffineTransform =>
    transformsByNode.get(nodeIndex) ?? identity
  const mapPoint = (
    p: AcDbAcisVec3 | null,
    nodeIndex: number,
  ): AcDbAcisVec3 | null => {
    if (p === null) return null
    const transform = transformFor(nodeIndex)
    return acdbAcisTransformIsIdentity(transform)
      ? p
      : acdbAcisTransformPoint(p, transform)
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const grow = (p: AcDbAcisVec3): void => {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
  };

  const vertices: AcDbAcisVertex[] = model.nodesOfType('vertex').map(v => {
    const point = mapPoint(vertexPoint(v), v.index);
    if (point === null) diagnostics.push(`vertex#${String(v.index)}: no resolvable point`);
    else grow(point);
    return { nodeIndex: v.index, point };
  });

  const edges: AcDbAcisEdge[] = model.nodesOfType('edge').map(e => {
    const verts = refsOfType(e, 'vertex');
    const start = mapPoint(vertexPoint(verts[0] ?? null), e.index);
    const end = mapPoint(vertexPoint(verts[1] ?? null), e.index);
    const curveNode = refOfType(e, '-curve');
    const curveType: AcDbAcisCurveKind = curveNode ? (CURVE_KIND[curveNode.type] ?? 'unknown') : 'unknown';
    let curve = curveNode ? curveParams(curveNode) : undefined;
    const transform = transformFor(e.index)
    if (
      curve !== undefined &&
      curve.kind !== 'unknown' &&
      !acdbAcisTransformIsIdentity(transform)
    ) {
      curve = transformCurveParams(curve, transform)
    }
    if (start !== null && end !== null && start[0] === end[0] && start[1] === end[1] && start[2] === end[2]) {
      diagnostics.push(`edge#${String(e.index)}: degenerate (coincident endpoints)`);
    }
    return curve === undefined || curve.kind === 'unknown'
      ? { nodeIndex: e.index, start, end, curveType }
      : { nodeIndex: e.index, start, end, curveType, curve };
  });

  const faces: AcDbAcisFace[] = model.nodesOfType('face').map(f => {
    const surfaceNode = refOfType(f, '-surface');
    const surfaceType: AcDbAcisSurfaceKind = surfaceNode ? (SURFACE_KIND[surfaceNode.type] ?? 'unknown') : 'unknown';
    let surface = surfaceNode ? surfaceParams(surfaceNode) : undefined;
    const transform = transformFor(f.index)
    if (
      surface !== undefined &&
      surface.kind !== 'unknown' &&
      !acdbAcisTransformIsIdentity(transform)
    ) {
      surface = transformSurfaceParams(surface, transform)
    }
    // Walk the next-loop chain (loop-typed ref), guarded against cycles.
    const loops: AcDbAcisFaceLoop[] = [];
    const seen = new Set<number>();
    let loop = refOfType(f, 'loop');
    while (loop !== null && !seen.has(loop.index)) {
      seen.add(loop.index);
      loops.push({ nodeIndex: loop.index, coedgeCount: loopCoedgeCount(loop) });
      loop = refOfType(loop, 'loop');
    }
    if (surfaceNode === null) diagnostics.push(`face#${String(f.index)}: no surface`);
    return surface === undefined || surface.kind === 'unknown'
      ? { nodeIndex: f.index, surfaceType, loops }
      : { nodeIndex: f.index, surfaceType, surface, loops };
  });

  const bbox: AcDbAcisBBox | null = minX === Infinity
    ? null
    : { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };

  return { vertices, edges, faces, bbox, diagnostics };
}

const v3add = (a: AcDbAcisVec3, b: AcDbAcisVec3): AcDbAcisVec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const v3mul = (a: AcDbAcisVec3, s: number): AcDbAcisVec3 => [a[0] * s, a[1] * s, a[2] * s]
const v3len = (a: AcDbAcisVec3): number => Math.hypot(a[0], a[1], a[2])
const v3cross = (a: AcDbAcisVec3, b: AcDbAcisVec3): AcDbAcisVec3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const v3norm = (a: AcDbAcisVec3): AcDbAcisVec3 => {
  const length = Math.hypot(a[0], a[1], a[2])
  return length > 0 ? [a[0] / length, a[1] / length, a[2] / length] : [0, 0, 0]
}

/**
 * Reads the curve parameter interval carried on an `edge` record (first two doubles).
 *
 * @param edge - Resolved `edge` node from an ACIS model graph.
 * @returns Parameter interval `[t0, t1]`, or `null` when unavailable.
 */
export function acdbAcisEdgeParamBounds(edge: AcDbAcisNode): [number, number] | null {
  const values: number[] = []
  for (const token of edge.record.tokens) {
    if (token.tag === AcDbAcisSabTag.Double) {
      values.push(token.value as number)
      if (values.length === 2) break
    }
  }
  const start = values[0]
  const end = values[1]
  return start === undefined || end === undefined ? null : [start, end]
}

/**
 * Sample an ellipse-curve arc over its parameter interval.
 *
 * @param params - Parsed ellipse curve parameters.
 * @param t0 - Start parameter in radians.
 * @param t1 - End parameter in radians.
 * @param samples - Number of interior segments (≥1).
 * @returns Sampled points along the arc, including both endpoints.
 */
export function acdbSampleAcisEllipseArc(
  params: AcDbAcisEllipseCurveParams,
  t0: number,
  t1: number,
  samples: number,
): AcDbAcisVec3[] {
  const minor = v3mul(v3cross(v3norm(params.normal), params.majorAxis), params.ratio)
  const steps = Math.max(1, samples)
  const out: AcDbAcisVec3[] = []
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps
    out.push(
      v3add(
        params.center,
        v3add(
          v3mul(params.majorAxis, Math.cos(t)),
          v3mul(minor, Math.sin(t)),
        ),
      ),
    )
  }
  return out
}

/**
 * Sample wireframe circles for a sphere surface (latitude/longitude-style rings).
 *
 * @param params - Parsed sphere surface parameters.
 * @param segments - Approximate number of samples per full ring (default 16).
 * @returns Closed polylines forming a sphere wireframe scaffold.
 */
export function acdbSampleAcisSphereWireframe(
  params: AcDbAcisSphereParams,
  segments = 16,
): AcDbAcisVec3[][] {
  const pole = v3norm(params.poleAxis)
  let u = v3norm(params.uDir)
  let v = v3cross(pole, u)
  if (v3len(v) < 1e-9) {
    u = Math.abs(pole[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    v = v3norm(v3cross(pole, u))
  } else {
    v = v3norm(v)
  }
  u = v3norm(v3cross(v, pole))

  const rings: AcDbAcisVec3[][] = []
  const sampleRing = (axisA: AcDbAcisVec3, axisB: AcDbAcisVec3): void => {
    const pts: AcDbAcisVec3[] = []
    const steps = Math.max(8, segments)
    for (let i = 0; i <= steps; i++) {
      const t = (Math.PI * 2 * i) / steps
      pts.push(
        v3add(
          params.center,
          v3add(
            v3mul(axisA, params.radius * Math.cos(t)),
            v3mul(axisB, params.radius * Math.sin(t)),
          ),
        ),
      )
    }
    rings.push(pts)
  }

  sampleRing(u, v)
  sampleRing(u, pole)
  sampleRing(v, pole)
  for (const lat of [-0.5, 0.5]) {
    const offset = v3mul(pole, params.radius * lat)
    const ringCenter = v3add(params.center, offset)
    const ringRadius = params.radius * Math.sqrt(Math.max(0, 1 - lat * lat))
    if (ringRadius > 1e-6) {
      const pts: AcDbAcisVec3[] = []
      const steps = Math.max(8, segments)
      for (let i = 0; i <= steps; i++) {
        const t = (Math.PI * 2 * i) / steps
        pts.push(
          v3add(
            ringCenter,
            v3add(
              v3mul(u, ringRadius * Math.cos(t)),
              v3mul(v, ringRadius * Math.sin(t)),
            ),
          ),
        )
      }
      rings.push(pts)
    }
  }
  return rings
}
