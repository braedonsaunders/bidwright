// Pure geometry/index helpers for the LiDAR point-cloud viewer. No three.js
// imports here so the math stays unit-testable under `tsx --test`.

export interface PcVec3 {
  x: number;
  y: number;
  z: number;
}

/** Cap on spatial-index entries; the viewer subsamples the cloud to stay under it. */
export const DEFAULT_MAX_INDEX_ENTRIES = 600_000;

/** Every k-th point goes into the pick index so it holds at most `maxEntries`. */
export function subsampleStride(pointCount: number, maxEntries = DEFAULT_MAX_INDEX_ENTRIES): number {
  if (!Number.isFinite(pointCount) || pointCount <= 0) return 1;
  return Math.max(1, Math.ceil(pointCount / Math.max(1, maxEntries)));
}

/** Hash-grid cell size: max bbox extent / divisions, with a sane floor. */
export function gridCellSize(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  divisions = 96,
): number {
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 0);
  const cell = extent / Math.max(1, divisions);
  return cell > 1e-6 ? cell : 0.05;
}

export interface RayPickOptions {
  /** Ignore points farther along the ray than this. */
  maxT: number;
  /** Pick radius grows linearly with depth: threshold(t) = radiusPerUnitDepth * t. */
  radiusPerUnitDepth: number;
  /** Absolute floor on the pick radius (helps very close to the camera). */
  minRadius?: number;
}

export interface RayPickHit {
  point: PcVec3;
  /** Distance along the ray to the picked point's perpendicular foot. */
  t: number;
  /** Perpendicular distance from the ray to the picked point. */
  distance: number;
}

/**
 * Uniform hash grid over a subsampled point set. Built incrementally while the
 * binary stream lands; `pickAlongRay` walks the ray in cell-sized steps and
 * returns the nearest-to-camera point whose perpendicular distance to the ray
 * fits inside a depth-scaled (screen-space) radius.
 */
export class SpatialPointIndex {
  readonly cellSize: number;
  private readonly cells = new Map<string, number[]>();
  private readonly pts: number[] = [];

  constructor(cellSize: number) {
    this.cellSize = cellSize > 1e-9 ? cellSize : 1;
  }

  get size(): number {
    return this.pts.length / 3;
  }

  insert(x: number, y: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const index = this.pts.length;
    this.pts.push(x, y, z);
    const cs = this.cellSize;
    const key = `${Math.floor(x / cs)},${Math.floor(y / cs)},${Math.floor(z / cs)}`;
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(index);
    else this.cells.set(key, [index]);
  }

  pickAlongRay(origin: PcVec3, direction: PcVec3, options: RayPickOptions): RayPickHit | null {
    if (this.pts.length === 0) return null;
    const dirLen = Math.hypot(direction.x, direction.y, direction.z);
    if (dirLen < 1e-12) return null;
    const dx = direction.x / dirLen;
    const dy = direction.y / dirLen;
    const dz = direction.z / dirLen;
    const cs = this.cellSize;
    const minRadius = Math.max(options.minRadius ?? 0, 0);
    const maxT = Math.max(options.maxT, 0);
    const perT = Math.max(options.radiusPerUnitDepth, 0);
    const pts = this.pts;
    const visited = new Set<string>();

    let best: { t: number; perp2: number; index: number } | null = null;

    for (let t = 0; t <= maxT; t += cs) {
      // Nothing behind an accepted candidate can beat it once the walk is
      // comfortably past it (candidates are compared front-first).
      if (best && t > best.t + 2 * cs) break;
      const px = origin.x + dx * t;
      const py = origin.y + dy * t;
      const pz = origin.z + dz * t;
      const threshold = Math.max(perT * t, minRadius);
      const reach = Math.min(2, Math.max(1, Math.ceil(threshold / cs)));
      const cx = Math.floor(px / cs);
      const cy = Math.floor(py / cs);
      const cz = Math.floor(pz / cs);
      for (let ix = cx - reach; ix <= cx + reach; ix += 1) {
        for (let iy = cy - reach; iy <= cy + reach; iy += 1) {
          for (let iz = cz - reach; iz <= cz + reach; iz += 1) {
            const key = `${ix},${iy},${iz}`;
            if (visited.has(key)) continue;
            visited.add(key);
            const bucket = this.cells.get(key);
            if (!bucket) continue;
            for (const index of bucket) {
              const vx = pts[index] - origin.x;
              const vy = pts[index + 1] - origin.y;
              const vz = pts[index + 2] - origin.z;
              const tp = vx * dx + vy * dy + vz * dz;
              if (tp < 0 || tp > maxT) continue;
              const perp2 = Math.max(0, vx * vx + vy * vy + vz * vz - tp * tp);
              const limit = Math.max(perT * tp, minRadius);
              if (perp2 > limit * limit) continue;
              if (
                !best ||
                tp < best.t - cs ||
                (tp <= best.t + cs && perp2 < best.perp2)
              ) {
                best = { t: tp, perp2, index };
              }
            }
          }
        }
      }
    }

    if (!best) return null;
    return {
      point: { x: pts[best.index], y: pts[best.index + 1], z: pts[best.index + 2] },
      t: best.t,
      distance: Math.sqrt(best.perp2),
    };
  }
}

export function distance3(a: PcVec3, b: PcVec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

export function polylineLength(points: readonly PcVec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance3(points[i - 1], points[i]);
  }
  return total;
}

/** Drops consecutive duplicates (double-click finish inserts one). */
export function dedupeConsecutivePoints(points: readonly PcVec3[], epsilon = 1e-6): PcVec3[] {
  const out: PcVec3[] = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (prev && distance3(prev, point) <= epsilon) continue;
    out.push(point);
  }
  return out;
}

function newellNormal(points: readonly PcVec3[]): PcVec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  return { x: nx, y: ny, z: nz };
}

/**
 * Least-squares plane through the points (covariance smallest-eigenvector via
 * the max-determinant closed form). Falls back to the Newell polygon normal
 * for near-degenerate covariance; returns null when the points are collinear.
 */
export function fitPlaneToPoints(
  points: readonly PcVec3[],
): { centroid: PcVec3; normal: PcVec3 } | null {
  if (points.length < 3) return null;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
    cz += p.z;
  }
  cx /= points.length;
  cy /= points.length;
  cz /= points.length;

  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (const p of points) {
    const rx = p.x - cx;
    const ry = p.y - cy;
    const rz = p.z - cz;
    xx += rx * rx;
    xy += rx * ry;
    xz += rx * rz;
    yy += ry * ry;
    yz += ry * rz;
    zz += rz * rz;
  }

  const detX = yy * zz - yz * yz;
  const detY = xx * zz - xz * xz;
  const detZ = xx * yy - xy * xy;
  const maxDet = Math.max(detX, detY, detZ);

  let normal: PcVec3;
  if (maxDet <= 1e-12) {
    normal = newellNormal(points);
  } else if (maxDet === detX) {
    normal = { x: detX, y: xz * yz - xy * zz, z: xy * yz - xz * yy };
  } else if (maxDet === detY) {
    normal = { x: xz * yz - xy * zz, y: detY, z: xy * xz - yz * xx };
  } else {
    normal = { x: xy * yz - xz * yy, y: xy * xz - yz * xx, z: detZ };
  }

  const length = Math.hypot(normal.x, normal.y, normal.z);
  if (length < 1e-12) return null;
  return {
    centroid: { x: cx, y: cy, z: cz },
    normal: { x: normal.x / length, y: normal.y / length, z: normal.z / length },
  };
}

/** Orthonormal in-plane basis (u, v) for a unit normal. */
export function planeBasis(normal: PcVec3): { u: PcVec3; v: PcVec3 } {
  const ref: PcVec3 = Math.abs(normal.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const ux = ref.y * normal.z - ref.z * normal.y;
  const uy = ref.z * normal.x - ref.x * normal.z;
  const uz = ref.x * normal.y - ref.y * normal.x;
  const ulen = Math.hypot(ux, uy, uz) || 1;
  const u: PcVec3 = { x: ux / ulen, y: uy / ulen, z: uz / ulen };
  const v: PcVec3 = {
    x: normal.y * u.z - normal.z * u.y,
    y: normal.z * u.x - normal.x * u.z,
    z: normal.x * u.y - normal.y * u.x,
  };
  return { u, v };
}

/**
 * Area of a (roughly planar) 3D polygon: fit the least-squares plane, project
 * the vertices onto it, then shoelace. Returns 0 for degenerate input.
 */
export function planarPolygonArea(points: readonly PcVec3[]): number {
  if (points.length < 3) return 0;
  const plane = fitPlaneToPoints(points);
  if (!plane) return 0;
  const { u, v } = planeBasis(plane.normal);
  const projected = points.map((p) => {
    const rx = p.x - plane.centroid.x;
    const ry = p.y - plane.centroid.y;
    const rz = p.z - plane.centroid.z;
    return {
      x: rx * u.x + ry * u.y + rz * u.z,
      y: rx * v.x + ry * v.y + rz * v.z,
    };
  });
  let twice = 0;
  for (let i = 0; i < projected.length; i += 1) {
    const a = projected[i];
    const b = projected[(i + 1) % projected.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** Human-readable readout for the floating measurement overlay. */
export function formatMeasureValue(value: number, unit: "m" | "m2" | "count"): string {
  if (unit === "count") return `${Math.round(value)}`;
  const digits = value >= 100 ? 1 : value >= 10 ? 2 : 3;
  const suffix = unit === "m2" ? " m²" : " m";
  return `${value.toFixed(digits)}${suffix}`;
}
