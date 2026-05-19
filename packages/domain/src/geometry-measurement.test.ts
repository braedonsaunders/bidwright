// Tests for the geometry-measurement helpers used by both DXF entities
// (DwgEntityMetadata) and PDF primitives (DrawingPrimitive).

import test from "node:test";
import assert from "node:assert/strict";

import {
  arcLength,
  arcLengthFromRadians,
  circleCircumference,
  directedAngularSweep,
  distance,
  ellipsePerimeter,
  isPrimitiveClosed,
  isRasterCircleCoveredByVector,
  measureDxfEntity,
  measurePdfPrimitive,
  polygonArea,
  polygonPerimeter,
  polygonSignedArea,
  polylineLength,
  samplePdfPrimitive,
  shortestAngularSweep,
} from "./geometry-measurement";

test("distance: 3-4-5 triangle", () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test("polylineLength: sum of segment lengths", () => {
  const pts = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 0 }];
  // 5 + 4 = 9
  assert.equal(polylineLength(pts), 9);
});

test("polylineLength: short arrays return 0", () => {
  assert.equal(polylineLength([]), 0);
  assert.equal(polylineLength([{ x: 0, y: 0 }]), 0);
});

test("polygonPerimeter: closes the loop", () => {
  const sq = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  assert.equal(polygonPerimeter(sq), 16);
});

test("polygonSignedArea: CCW positive, CW negative", () => {
  const ccw = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  assert.equal(polygonSignedArea(ccw), 16);
  const cw = [...ccw].reverse();
  assert.equal(polygonSignedArea(cw), -16);
});

test("polygonArea: unit triangle", () => {
  const tri = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
  assert.equal(polygonArea(tri), 0.5);
});

test("directedAngularSweep: CCW wraparound past 0", () => {
  // 350° → 10° is a 20° CCW sweep, not -340° or 340°.
  const sweep = directedAngularSweep((350 * Math.PI) / 180, (10 * Math.PI) / 180);
  assert.ok(Math.abs(sweep - (20 * Math.PI) / 180) < 1e-9);
});

test("shortestAngularSweep: takes the short way around", () => {
  // 350° → 10° is 20° the short way.
  const sweep = shortestAngularSweep((350 * Math.PI) / 180, (10 * Math.PI) / 180);
  assert.ok(Math.abs(sweep - (20 * Math.PI) / 180) < 1e-9);
});

test("arcLength: quarter-circle of radius 4 is 2π", () => {
  const length = arcLength(4, 0, Math.PI / 2);
  assert.ok(Math.abs(length - 2 * Math.PI) < 1e-9);
});

test("arcLengthFromRadians: handles negative sweep as positive length", () => {
  assert.equal(arcLengthFromRadians(2, -Math.PI), 2 * Math.PI);
});

test("circleCircumference: 2πr", () => {
  assert.ok(Math.abs(circleCircumference(5) - 10 * Math.PI) < 1e-9);
});

test("ellipsePerimeter: circle case (rx=ry) matches 2πr within 1e-5", () => {
  const r = 7;
  const approx = ellipsePerimeter(r, r);
  assert.ok(Math.abs(approx - 2 * Math.PI * r) < 1e-5);
});

test("ellipsePerimeter: zero ellipse", () => {
  assert.equal(ellipsePerimeter(0, 0), 0);
});

test("measureDxfEntity: LINE returns its length", () => {
  const m = measureDxfEntity({
    type: "LINE",
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
  });
  assert.equal(m.length, 10);
  assert.equal(m.area, 0);
  assert.equal(m.basis, "line");
});

test("measureDxfEntity: closed LWPOLYLINE returns perimeter + area", () => {
  const m = measureDxfEntity({
    type: "LWPOLYLINE",
    vertices: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ],
    closed: true,
  });
  assert.equal(m.length, 16);
  assert.equal(m.area, 16);
  assert.equal(m.basis, "polygon");
});

test("measureDxfEntity: CIRCLE returns circumference (length) + area", () => {
  const m = measureDxfEntity({ type: "CIRCLE", center: { x: 0, y: 0 }, radius: 1 });
  assert.ok(Math.abs(m.length - 2 * Math.PI) < 1e-9);
  assert.ok(Math.abs(m.area - Math.PI) < 1e-9);
  assert.equal(m.basis, "circle");
});

test("measureDxfEntity: ARC respects start/end angles in degrees", () => {
  const m = measureDxfEntity({
    type: "ARC",
    center: { x: 0, y: 0 },
    radius: 4,
    raw: { startAngle: 0, endAngle: 90 },
  });
  // Quarter-circle of radius 4 is 2π.
  assert.ok(Math.abs(m.length - 2 * Math.PI) < 1e-9);
  assert.equal(m.basis, "arc");
});

test("measureDxfEntity: DIMENSION uses actualMeasurement", () => {
  const m = measureDxfEntity({
    type: "DIMENSION",
    raw: { actualMeasurement: 42.5 },
  });
  assert.equal(m.length, 42.5);
  assert.equal(m.basis, "dimension");
});

test("measureDxfEntity: POINT returns zero measurement", () => {
  const m = measureDxfEntity({ type: "POINT", center: { x: 0, y: 0 } });
  assert.equal(m.length, 0);
  assert.equal(m.basis, "none");
});

test("measureDxfEntity: HATCH returns perimeter + area (treated as closed polygon)", () => {
  // Hatch boundary as a 4-vertex unit square. Boundary is always closed
  // for a hatch — the polygon helpers don't need an explicit closed flag.
  const m = measureDxfEntity({
    type: "HATCH",
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    closed: true,
  });
  assert.equal(m.length, 4); // perimeter
  assert.equal(m.area, 1);   // area
  assert.equal(m.basis, "polygon");
});

test("measureDxfEntity: HATCH with <3 vertices yields zero (no usable boundary)", () => {
  const m = measureDxfEntity({
    type: "HATCH",
    vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    closed: true,
  });
  assert.equal(m.basis, "none");
});

test("measurePdfPrimitive: line in PDF points", () => {
  const m = measurePdfPrimitive({
    kind: "line",
    params: { x1: 0, y1: 0, x2: 72, y2: 0 },
  });
  assert.equal(m.length, 72);
});

test("measurePdfPrimitive: rect returns perimeter and area", () => {
  const m = measurePdfPrimitive({
    kind: "rect",
    params: { x: 10, y: 10, width: 4, height: 6 },
  });
  assert.equal(m.length, 20);
  assert.equal(m.area, 24);
});

test("measurePdfPrimitive: arc primitive uses radians", () => {
  const m = measurePdfPrimitive({
    kind: "arc",
    params: { cx: 0, cy: 0, r: 1, startAngleRad: 0, endAngleRad: Math.PI },
  });
  // Half-circle of radius 1 has length π.
  assert.ok(Math.abs(m.length - Math.PI) < 1e-9);
});

test("measurePdfPrimitive: cubic_bezier averages chord and control polygon", () => {
  // p0=(0,0), p1=(0,10), p2=(10,10), p3=(10,0). Control polygon length:
  // 10 + 10 + 10 = 30. Chord: distance (0,0)→(10,0) = 10. Average = 20.
  const m = measurePdfPrimitive({
    kind: "cubic_bezier",
    params: { points: [0, 0, 0, 10, 10, 10, 10, 0] },
  });
  assert.equal(m.length, 20);
});

// ── samplePdfPrimitive ──────────────────────────────────────────────────

test("samplePdfPrimitive: line yields its two endpoints", () => {
  const pts = samplePdfPrimitive({
    kind: "line",
    params: { x1: 0, y1: 0, x2: 5, y2: 0 },
  });
  assert.equal(pts.length, 2);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[1], { x: 5, y: 0 });
});

test("samplePdfPrimitive: rect yields four corner points", () => {
  const pts = samplePdfPrimitive({
    kind: "rect",
    params: { x: 1, y: 2, width: 4, height: 3 },
  });
  assert.equal(pts.length, 4);
  assert.deepEqual(pts[0], { x: 1, y: 2 });
  assert.deepEqual(pts[2], { x: 5, y: 5 });
});

test("samplePdfPrimitive: quarter-arc lands the endpoints on (r,0) and (0,r)", () => {
  const pts = samplePdfPrimitive({
    kind: "arc",
    params: { cx: 0, cy: 0, r: 1, startAngleRad: 0, endAngleRad: Math.PI / 2 },
  });
  // First sample is at angle 0 → (1, 0); last is at angle π/2 → (0, 1).
  assert.ok(Math.abs(pts[0]!.x - 1) < 1e-9);
  assert.ok(Math.abs(pts[0]!.y) < 1e-9);
  assert.ok(Math.abs(pts[pts.length - 1]!.x) < 1e-9);
  assert.ok(Math.abs(pts[pts.length - 1]!.y - 1) < 1e-9);
});

test("samplePdfPrimitive: sampled circle length is within 0.4% of analytic 2πr", () => {
  // 32-step polygon approximation of a unit circle.
  const pts = samplePdfPrimitive({ kind: "circle", params: { cx: 0, cy: 0, r: 1 } });
  const analytic = 2 * Math.PI;
  // Close the loop for perimeter calculation (samplePdfPrimitive omits the
  // duplicate first vertex by design).
  const sampledPerimeter = polygonPerimeter(pts);
  const err = Math.abs(sampledPerimeter - analytic) / analytic;
  assert.ok(err < 0.004, `error was ${err}`);
});

test("samplePdfPrimitive: sampled ellipse perimeter is within 1% of Ramanujan approximation", () => {
  const pts = samplePdfPrimitive({
    kind: "ellipse",
    params: { cx: 0, cy: 0, rx: 2, ry: 1, rotationRad: 0 },
  });
  const sampled = polygonPerimeter(pts);
  const analytic = ellipsePerimeter(2, 1);
  const err = Math.abs(sampled - analytic) / analytic;
  assert.ok(err < 0.01, `error was ${err}`);
});

test("samplePdfPrimitive: cubic bezier samples both endpoints exactly", () => {
  const pts = samplePdfPrimitive({
    kind: "cubic_bezier",
    params: { points: [0, 0, 1, 5, 5, 5, 6, 0] },
  });
  assert.ok(pts.length >= 4);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 6, y: 0 });
});

test("samplePdfPrimitive: malformed cubic bezier returns empty array", () => {
  // 6 numbers instead of 8 → not a cubic.
  const pts = samplePdfPrimitive({
    kind: "cubic_bezier",
    params: { points: [0, 0, 1, 5, 5, 5] },
  });
  assert.equal(pts.length, 0);
});

test("isPrimitiveClosed: circle, ellipse, rect are closed", () => {
  assert.equal(isPrimitiveClosed({ kind: "circle", params: { cx: 0, cy: 0, r: 1 } }), true);
  assert.equal(isPrimitiveClosed({ kind: "ellipse", params: { cx: 0, cy: 0, rx: 1, ry: 1, rotationRad: 0 } }), true);
  assert.equal(isPrimitiveClosed({ kind: "rect", params: { x: 0, y: 0, width: 2, height: 2 } }), true);
});

test("isPrimitiveClosed: 90° arc is open", () => {
  assert.equal(
    isPrimitiveClosed({
      kind: "arc",
      params: { cx: 0, cy: 0, r: 1, startAngleRad: 0, endAngleRad: Math.PI / 2 },
    }),
    false,
  );
});

test("isPrimitiveClosed: 360° arc collapses to closed (treated like a circle)", () => {
  assert.equal(
    isPrimitiveClosed({
      kind: "arc",
      params: { cx: 0, cy: 0, r: 1, startAngleRad: 0, endAngleRad: Math.PI * 2 },
    }),
    true,
  );
});

test("isPrimitiveClosed: line + bezier kinds are always open", () => {
  assert.equal(isPrimitiveClosed({ kind: "line", params: {} }), false);
  assert.equal(isPrimitiveClosed({ kind: "cubic_bezier", params: { points: [0, 0, 1, 1, 2, 2, 3, 3] } }), false);
  assert.equal(isPrimitiveClosed({ kind: "quad_bezier", params: { points: [0, 0, 1, 1, 2, 2] } }), false);
});

// ── isRasterCircleCoveredByVector ────────────────────────────────────────

test("isRasterCircleCoveredByVector: empty vector set returns false", () => {
  assert.equal(isRasterCircleCoveredByVector(100, 100, 10, []), false);
});

test("isRasterCircleCoveredByVector: identical circles match", () => {
  assert.equal(
    isRasterCircleCoveredByVector(100, 100, 10, [{ cxPx: 100, cyPx: 100, rPx: 10 }]),
    true,
  );
});

test("isRasterCircleCoveredByVector: 3px center offset within default tolerance still matches", () => {
  assert.equal(
    isRasterCircleCoveredByVector(100, 100, 10, [{ cxPx: 102, cyPx: 102, rPx: 10 }]),
    true,
  );
});

test("isRasterCircleCoveredByVector: large center offset rejects", () => {
  assert.equal(
    isRasterCircleCoveredByVector(100, 100, 10, [{ cxPx: 200, cyPx: 200, rPx: 10 }]),
    false,
  );
});

test("isRasterCircleCoveredByVector: 5% radius error still matches", () => {
  assert.equal(
    isRasterCircleCoveredByVector(100, 100, 10, [{ cxPx: 100, cyPx: 100, rPx: 10.5 }]),
    true,
  );
});

test("isRasterCircleCoveredByVector: 15% radius error rejects", () => {
  assert.equal(
    isRasterCircleCoveredByVector(100, 100, 10, [{ cxPx: 100, cyPx: 100, rPx: 11.5 }]),
    false,
  );
});

test("isRasterCircleCoveredByVector: large radii use 10%-of-radius center tolerance", () => {
  // Radius 200 → 10% = 20 px center tolerance (overrides the 5 px floor).
  // 15 px purely on the x axis is well inside that envelope.
  assert.equal(
    isRasterCircleCoveredByVector(500, 500, 200, [{ cxPx: 515, cyPx: 500, rPx: 200 }]),
    true,
  );
  // 30 px Euclidean offset exceeds the 20 px adaptive tolerance → reject.
  assert.equal(
    isRasterCircleCoveredByVector(500, 500, 200, [{ cxPx: 530, cyPx: 500, rPx: 200 }]),
    false,
  );
});

test("isRasterCircleCoveredByVector: covered by ANY match in the candidate set", () => {
  // First candidate is wrong, second matches — should return true.
  assert.equal(
    isRasterCircleCoveredByVector(100, 100, 10, [
      { cxPx: 999, cyPx: 999, rPx: 50 },
      { cxPx: 101, cyPx: 101, rPx: 10 },
    ]),
    true,
  );
});
