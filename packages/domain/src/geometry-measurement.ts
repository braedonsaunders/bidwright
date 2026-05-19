// Pure geometry-measurement helpers shared by the DXF and PDF vector
// pipelines. Computes length, arc-length, perimeter, and polygon area for
// the canonical primitives the vector pipeline emits.
//
// Lives in @bidwright/domain because both the API server (run-time
// quantification) and the web client (live UI overlay measurements) need
// the same answers — putting it here avoids two divergent implementations.

/** A 2D point in the primitive's native coordinate space. The caller is
 *  responsible for unit consistency (don't mix inch coords with point
 *  coords when summing lengths). */
export interface Point2D {
  x: number;
  y: number;
}

/** Distance between two points. */
export function distance(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Total length of a polyline through `points` (open). For closed polygons
 *  use `polygonPerimeter`. Returns 0 for fewer than 2 points. */
export function polylineLength(points: ReadonlyArray<Point2D>): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1]!, points[i]!);
  }
  return total;
}

/** Perimeter of a closed polygon defined by its vertices (does not need
 *  the first vertex repeated at the end). */
export function polygonPerimeter(vertices: ReadonlyArray<Point2D>): number {
  if (vertices.length < 2) return 0;
  let total = polylineLength(vertices);
  // Close the loop: distance from last back to first.
  total += distance(vertices[vertices.length - 1]!, vertices[0]!);
  return total;
}

/** Signed area of a simple polygon via the shoelace formula. Positive when
 *  vertices wind counter-clockwise. The absolute value is the geometric
 *  area; the sign reveals winding direction (useful for hole detection in
 *  multi-loop polygons). */
export function polygonSignedArea(vertices: ReadonlyArray<Point2D>): number {
  if (vertices.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonArea(vertices: ReadonlyArray<Point2D>): number {
  return Math.abs(polygonSignedArea(vertices));
}

/** Arc length given a radius and an angular sweep in radians. Negative
 *  sweeps are treated as their absolute value — direction doesn't change
 *  the physical length. */
export function arcLengthFromRadians(radius: number, sweepRad: number): number {
  return Math.abs(radius) * Math.abs(sweepRad);
}

/** Compute the geodesic distance between two angles, in radians, in the
 *  shorter direction. Always in [0, π]. */
export function shortestAngularSweep(startRad: number, endRad: number): number {
  const twoPi = Math.PI * 2;
  let diff = (endRad - startRad) % twoPi;
  if (diff < 0) diff += twoPi;
  // Use the shorter way around.
  return diff <= Math.PI ? diff : twoPi - diff;
}

/** Compute the directed sweep (start → end, CCW) — always non-negative. */
export function directedAngularSweep(startRad: number, endRad: number): number {
  const twoPi = Math.PI * 2;
  let diff = (endRad - startRad) % twoPi;
  if (diff < 0) diff += twoPi;
  return diff;
}

/** Arc length of an arc defined by its start and end angles (radians) and
 *  radius. Uses the DIRECTED sweep — arcs in CAD files have an implied
 *  start→end direction. */
export function arcLength(radius: number, startRad: number, endRad: number): number {
  return arcLengthFromRadians(radius, directedAngularSweep(startRad, endRad));
}

/** Circumference of a full circle. Convenience wrapper. */
export function circleCircumference(radius: number): number {
  return 2 * Math.PI * Math.abs(radius);
}

/** Ramanujan's approximation of an ellipse perimeter. Accurate to better
 *  than 1e-5 for axisRatio in [0.05, 1.0]. */
export function ellipsePerimeter(majorRadius: number, minorRadius: number): number {
  const a = Math.abs(majorRadius);
  const b = Math.abs(minorRadius);
  if (a === 0 && b === 0) return 0;
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

// ── DXF entity wrappers ──────────────────────────────────────────────────
// Mirrors the public DwgEntityMetadata shape from dwg-processing-service
// without importing it (keeps @bidwright/domain free of API-server deps).
// The fields below are the union of "things the geometry measurement
// helpers need to do their work."

export interface MeasurableDxfEntity {
  type: string;
  start?: Point2D;
  end?: Point2D;
  center?: Point2D;
  radius?: number;
  vertices?: ReadonlyArray<Point2D>;
  closed?: boolean;
  raw?: Record<string, unknown>;
}

/** Quantitative measurement for a single DXF entity. Returns the closest
 *  meaningful number for each entity type and a unit hint so the caller
 *  can label it.
 *
 *  - LINE → length
 *  - LWPOLYLINE / POLYLINE / SPLINE → polyline length (or perimeter when closed)
 *  - CIRCLE → circumference (length value) and area
 *  - ARC → arc length
 *  - ELLIPSE → ellipse perimeter (length) and area
 *  - DIMENSION → actualMeasurement when the dimension reported one
 *  - 3DFACE / SOLID → polygon perimeter and area
 *  - others (POINT, TEXT, MTEXT, INSERT) → zero length / area
 */
export interface DxfEntityMeasurement {
  length: number;
  area: number;
  /** Empty when the entity has neither length nor area (POINT, TEXT, ...). */
  basis: "line" | "polyline" | "arc" | "circle" | "ellipse" | "polygon" | "dimension" | "none";
}

export function measureDxfEntity(entity: MeasurableDxfEntity): DxfEntityMeasurement {
  switch (entity.type) {
    case "LINE": {
      if (!entity.start || !entity.end) return zeroMeasurement();
      return { length: distance(entity.start, entity.end), area: 0, basis: "line" };
    }
    case "LWPOLYLINE":
    case "POLYLINE":
    case "SPLINE": {
      const vertices = entity.vertices ?? [];
      if (vertices.length < 2) return zeroMeasurement();
      if (entity.closed) {
        return {
          length: polygonPerimeter(vertices),
          area: polygonArea(vertices),
          basis: "polygon",
        };
      }
      return { length: polylineLength(vertices), area: 0, basis: "polyline" };
    }
    case "CIRCLE": {
      if (!entity.center || typeof entity.radius !== "number") return zeroMeasurement();
      return {
        length: circleCircumference(entity.radius),
        area: Math.PI * entity.radius ** 2,
        basis: "circle",
      };
    }
    case "ARC": {
      if (!entity.center || typeof entity.radius !== "number") return zeroMeasurement();
      const startDeg = Number(entity.raw?.startAngle ?? 0);
      const endDeg = Number(entity.raw?.endAngle ?? 360);
      const startRad = (startDeg * Math.PI) / 180;
      const endRad = (endDeg * Math.PI) / 180;
      return {
        length: arcLength(entity.radius, startRad, endRad),
        area: 0,
        basis: "arc",
      };
    }
    case "ELLIPSE": {
      const majorRadius = Number(entity.raw?.majorRadius ?? entity.radius ?? 0);
      const minorRadius = Number(entity.raw?.minorRadius ?? majorRadius);
      if (majorRadius <= 0) return zeroMeasurement();
      return {
        length: ellipsePerimeter(majorRadius, minorRadius),
        area: Math.PI * majorRadius * minorRadius,
        basis: "ellipse",
      };
    }
    case "DIMENSION": {
      const measurement = Number(entity.raw?.actualMeasurement);
      if (!Number.isFinite(measurement) || measurement === 0) return zeroMeasurement();
      return { length: measurement, area: 0, basis: "dimension" };
    }
    case "3DFACE":
    case "SOLID": {
      const vertices = entity.vertices ?? [];
      if (vertices.length < 3) return zeroMeasurement();
      return {
        length: polygonPerimeter(vertices),
        area: polygonArea(vertices),
        basis: "polygon",
      };
    }
    case "HATCH": {
      // HATCH carries the area-meaningful boundary in `vertices` (set
      // by our HatchEntityHandler from the first polyline boundary).
      // Hatches are closed by convention — they enclose a filled region —
      // so the polygon-area + polygon-perimeter answer is correct.
      const vertices = entity.vertices ?? [];
      if (vertices.length < 3) return zeroMeasurement();
      return {
        length: polygonPerimeter(vertices),
        area: polygonArea(vertices),
        basis: "polygon",
      };
    }
    default:
      return zeroMeasurement();
  }
}

function zeroMeasurement(): DxfEntityMeasurement {
  return { length: 0, area: 0, basis: "none" };
}

// ── PDF primitive wrappers ───────────────────────────────────────────────

/** Mirror of DrawingPrimitive from @bidwright/vision but type-only — keeps
 *  the dep cycle out. */
export interface MeasurablePdfPrimitive {
  kind: string;
  params: Record<string, number | number[]>;
}

/** Measure a single PDF primitive in its native (PDF-point) coordinate
 *  space. Multiply by `pointsPerInch` (or whatever the caller is
 *  calibrating to) to get real-world quantities. */
export function measurePdfPrimitive(primitive: MeasurablePdfPrimitive): DxfEntityMeasurement {
  const params = primitive.params;
  switch (primitive.kind) {
    case "line": {
      const x1 = num(params.x1), y1 = num(params.y1);
      const x2 = num(params.x2), y2 = num(params.y2);
      return { length: distance({ x: x1, y: y1 }, { x: x2, y: y2 }), area: 0, basis: "line" };
    }
    case "rect": {
      const w = num(params.width), h = num(params.height);
      return { length: 2 * (w + h), area: w * h, basis: "polygon" };
    }
    case "circle": {
      const r = num(params.r);
      return { length: circleCircumference(r), area: Math.PI * r * r, basis: "circle" };
    }
    case "arc": {
      const r = num(params.r);
      const start = num(params.startAngleRad);
      const end = num(params.endAngleRad);
      return { length: arcLength(r, start, end), area: 0, basis: "arc" };
    }
    case "ellipse": {
      const rx = num(params.rx);
      const ry = num(params.ry);
      return { length: ellipsePerimeter(rx, ry), area: Math.PI * rx * ry, basis: "ellipse" };
    }
    case "cubic_bezier":
    case "quad_bezier": {
      // Length of a bezier curve via chord+control approximation: average
      // of (chord length) and (sum of control-segment lengths). For most
      // CAD-exported curves the error is well under 1%.
      const pts = numArray(params.points);
      if (pts.length < 4) return zeroMeasurement();
      let chord = 0;
      let controls = 0;
      const points: Point2D[] = [];
      for (let i = 0; i + 1 < pts.length; i += 2) {
        points.push({ x: pts[i]!, y: pts[i + 1]! });
      }
      if (points.length < 2) return zeroMeasurement();
      chord = distance(points[0]!, points[points.length - 1]!);
      controls = polylineLength(points);
      return {
        length: (chord + controls) / 2,
        area: 0,
        basis: "polyline",
      };
    }
    default:
      return zeroMeasurement();
  }
}

function num(value: number | number[] | undefined): number {
  return typeof value === "number" ? value : 0;
}

function numArray(value: number | number[] | undefined): number[] {
  return Array.isArray(value) ? value : [];
}

// ── Primitive → polyline sampling ────────────────────────────────────────
// The annotation system stores geometry as a polyline-of-points. Saving a
// primitive as a takeoff annotation requires sampling it to a finite
// vertex list. The polyline length / area we sample to is geometrically
// close (within ~1% for the sample densities used below) so downstream
// measurement using the polyline matches the analytic primitive
// measurement within rendering tolerance.

/** Total number of polyline vertices to emit for each primitive kind.
 *  Tuned empirically: enough that the sampled polyline measurement is
 *  within ~1% of the analytic measurement, low enough that a page with
 *  thousands of primitives doesn't bloat the annotations table. */
const DEFAULT_SAMPLE_STEPS: Record<string, number> = {
  arc: 16,
  circle: 32,
  ellipse: 32,
  cubic_bezier: 12,
  quad_bezier: 8,
  line: 1,
  rect: 4,
};

/** Sample a PDF primitive to a polyline in its native coordinate space.
 *  Coordinates come out in PDF points — multiply by
 *  `coordinateSpace.imagePixelPerPdfPoint{X,Y}` to project onto the
 *  rendered canvas before writing the result as a Pickup. */
export function samplePdfPrimitive(
  primitive: MeasurablePdfPrimitive,
  steps: number = DEFAULT_SAMPLE_STEPS[primitive.kind] ?? 12,
): Point2D[] {
  const params = primitive.params;
  switch (primitive.kind) {
    case "line": {
      const x1 = num(params.x1), y1 = num(params.y1);
      const x2 = num(params.x2), y2 = num(params.y2);
      return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
    }
    case "rect": {
      const x = num(params.x), y = num(params.y);
      const w = num(params.width), h = num(params.height);
      // Closed rectangle as 4 corners; the takeoff annotation system can
      // treat this as `area-polygon`.
      return [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ];
    }
    case "arc": {
      const cx = num(params.cx);
      const cy = num(params.cy);
      const r = num(params.r);
      const start = num(params.startAngleRad);
      const end = num(params.endAngleRad);
      const twoPi = Math.PI * 2;
      let sweep = (end - start) % twoPi;
      if (sweep < 0) sweep += twoPi;
      // Guarantee at least 2 points so the polyline has a measurable length.
      const n = Math.max(2, steps);
      const out: Point2D[] = [];
      for (let i = 0; i <= n; i++) {
        const t = start + (sweep * i) / n;
        out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
      }
      return out;
    }
    case "circle": {
      const cx = num(params.cx);
      const cy = num(params.cy);
      const r = num(params.r);
      const n = Math.max(8, steps);
      const out: Point2D[] = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
      }
      return out;
    }
    case "ellipse": {
      const cx = num(params.cx);
      const cy = num(params.cy);
      const rx = num(params.rx);
      const ry = num(params.ry);
      const rot = num(params.rotationRad);
      const cosRot = Math.cos(rot);
      const sinRot = Math.sin(rot);
      const n = Math.max(8, steps);
      const out: Point2D[] = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        // Parametric ellipse: rotate by `rot` about (cx, cy).
        const lx = rx * Math.cos(t);
        const ly = ry * Math.sin(t);
        out.push({
          x: cx + lx * cosRot - ly * sinRot,
          y: cy + lx * sinRot + ly * cosRot,
        });
      }
      return out;
    }
    case "cubic_bezier": {
      const pts = numArray(params.points);
      if (pts.length < 8) return [];
      const [x0, y0, x1, y1, x2, y2, x3, y3] = pts;
      const n = Math.max(2, steps);
      const out: Point2D[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const mt = 1 - t;
        out.push({
          x: mt ** 3 * x0! + 3 * mt ** 2 * t * x1! + 3 * mt * t ** 2 * x2! + t ** 3 * x3!,
          y: mt ** 3 * y0! + 3 * mt ** 2 * t * y1! + 3 * mt * t ** 2 * y2! + t ** 3 * y3!,
        });
      }
      return out;
    }
    case "quad_bezier": {
      const pts = numArray(params.points);
      if (pts.length < 6) return [];
      const [x0, y0, x1, y1, x2, y2] = pts;
      const n = Math.max(2, steps);
      const out: Point2D[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const mt = 1 - t;
        out.push({
          x: mt ** 2 * x0! + 2 * mt * t * x1! + t ** 2 * x2!,
          y: mt ** 2 * y0! + 2 * mt * t * y1! + t ** 2 * y2!,
        });
      }
      return out;
    }
    default:
      return [];
  }
}

// ── Raster ↔ Vector dedup ────────────────────────────────────────────────
// PDFs that originated from CAD tools yield BOTH a raster Hough-circle
// detection and a canonical vector circle primitive for the same drawn
// shape. The two share the same geometry but the vector primitive is
// higher confidence (it came from the source PDF's path operators). At
// row-build time we drop any raster circle that's also represented by a
// vector primitive so the estimator doesn't see duplicate candidates.

/** A circle in image-pixel coordinates — the projection a vector circle
 *  primitive lands in after multiplying by `coordinateSpace.imagePixelPerPdfPoint{X,Y}`,
 *  i.e. the same coord system the raster Hough output uses. */
export interface PixelCircle {
  cxPx: number;
  cyPx: number;
  rPx: number;
}

/** True when `(rasterCx, rasterCy, rasterR)` is geometrically covered by
 *  any of `vectorCircles` within `tolerancePx` of center and 10% of
 *  radius. Both inputs MUST be in the same coordinate system (image
 *  pixels — the raster-detector's native space). */
export function isRasterCircleCoveredByVector(
  rasterCx: number,
  rasterCy: number,
  rasterR: number,
  vectorCircles: ReadonlyArray<PixelCircle>,
  tolerancePx: number = 5,
): boolean {
  if (vectorCircles.length === 0) return false;
  const centerTol = Math.max(tolerancePx, rasterR * 0.1);
  const centerTolSq = centerTol * centerTol;
  for (const vec of vectorCircles) {
    const dx = rasterCx - vec.cxPx;
    const dy = rasterCy - vec.cyPx;
    if (dx * dx + dy * dy > centerTolSq) continue;
    const denom = Math.max(rasterR, vec.rPx, 1e-9);
    const radiusErr = Math.abs(rasterR - vec.rPx) / denom;
    if (radiusErr < 0.1) return true;
  }
  return false;
}

/** True when a primitive is a closed shape — its sampled polyline should
 *  be persisted as `area-polygon` rather than `linear-polyline`. */
export function isPrimitiveClosed(primitive: MeasurablePdfPrimitive): boolean {
  switch (primitive.kind) {
    case "circle":
    case "ellipse":
    case "rect":
      return true;
    case "arc": {
      // 360° arcs close on themselves — same shape as a circle. Use the
      // raw |end - start| rather than mod-2π so the exact 2π case (which
      // would mod to 0) is still treated as a full sweep.
      const start = num(primitive.params.startAngleRad);
      const end = num(primitive.params.endAngleRad);
      const sweep = Math.abs(end - start);
      return sweep >= Math.PI * 1.99;
    }
    default:
      return false;
  }
}
