import test from "node:test";
import assert from "node:assert/strict";
import {
  SpatialPointIndex,
  choosePickHit,
  dedupeConsecutivePoints,
  distance3,
  fitPlaneToPoints,
  formatMeasureValue,
  gridCellSize,
  planarPolygonArea,
  planeBasis,
  polylineLength,
  subsampleStride,
  type PcVec3,
} from "./pointcloud-viewer-utils";

test("subsampleStride keeps the index under the entry cap", () => {
  assert.equal(subsampleStride(0), 1);
  assert.equal(subsampleStride(1000, 600_000), 1);
  assert.equal(subsampleStride(600_000, 600_000), 1);
  assert.equal(subsampleStride(600_001, 600_000), 2);
  assert.equal(subsampleStride(6_000_000, 600_000), 10);
  assert.ok(Math.ceil(6_123_456 / subsampleStride(6_123_456)) <= 600_000);
});

test("gridCellSize derives from the max bbox extent with a floor", () => {
  assert.equal(gridCellSize([0, 0, 0], [96, 48, 24]), 1);
  assert.equal(gridCellSize([-10, 0, 0], [10, 5, 5], 10), 2);
  // Degenerate bbox falls back to a usable cell size.
  assert.equal(gridCellSize([1, 1, 1], [1, 1, 1]), 0.05);
});

test("SpatialPointIndex picks the point nearest the ray within the radius", () => {
  const index = new SpatialPointIndex(0.5);
  index.insert(0, 0, 5);
  index.insert(0.2, 0, 5); // slightly off-axis at the same depth
  index.insert(0, 0, 9); // on-axis but farther away
  assert.equal(index.size, 3);

  const hit = index.pickAlongRay(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { maxT: 20, radiusPerUnitDepth: 0.05, minRadius: 0.01 },
  );
  assert.ok(hit);
  // The on-axis point at depth 5 wins: closer than depth 9, tighter than the offset point.
  assert.deepEqual(hit.point, { x: 0, y: 0, z: 5 });
  assert.ok(Math.abs(hit.t - 5) < 1e-9);
  assert.ok(hit.distance < 1e-9);
});

test("SpatialPointIndex prefers the closest point along the ray", () => {
  const index = new SpatialPointIndex(0.5);
  index.insert(0.1, 0, 3);
  index.insert(0, 0, 12);
  const hit = index.pickAlongRay(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { maxT: 20, radiusPerUnitDepth: 0.1 },
  );
  assert.ok(hit);
  assert.equal(hit.point.z, 3);
});

test("SpatialPointIndex returns null when nothing is near the ray", () => {
  const index = new SpatialPointIndex(0.5);
  index.insert(5, 5, 5);
  const hit = index.pickAlongRay(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { maxT: 20, radiusPerUnitDepth: 0.01 },
  );
  assert.equal(hit, null);
  const empty = new SpatialPointIndex(0.5);
  assert.equal(
    empty.pickAlongRay({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { maxT: 20, radiusPerUnitDepth: 1 }),
    null,
  );
});

test("SpatialPointIndex respects maxT", () => {
  const index = new SpatialPointIndex(0.5);
  index.insert(0, 0, 15);
  const hit = index.pickAlongRay(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { maxT: 10, radiusPerUnitDepth: 0.5 },
  );
  assert.equal(hit, null);
});

test("polylineLength and distance3 accumulate segment lengths", () => {
  const pts: PcVec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 3, y: 0, z: 0 },
    { x: 3, y: 4, z: 0 },
  ];
  assert.equal(distance3(pts[0], pts[1]), 3);
  assert.equal(polylineLength(pts), 7);
  assert.equal(polylineLength([pts[0]]), 0);
  assert.equal(polylineLength([]), 0);
});

test("dedupeConsecutivePoints drops the double-click duplicate", () => {
  const pts: PcVec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ];
  const deduped = dedupeConsecutivePoints(pts);
  assert.equal(deduped.length, 3);
  assert.deepEqual(deduped[2], { x: 2, y: 0, z: 0 });
});

test("fitPlaneToPoints recovers an axis-aligned plane", () => {
  const plane = fitPlaneToPoints([
    { x: 0, y: 0, z: 2 },
    { x: 1, y: 0, z: 2 },
    { x: 1, y: 1, z: 2 },
    { x: 0, y: 1, z: 2 },
  ]);
  assert.ok(plane);
  assert.ok(Math.abs(Math.abs(plane.normal.z) - 1) < 1e-9);
  assert.ok(Math.abs(plane.centroid.z - 2) < 1e-9);
});

test("fitPlaneToPoints recovers a tilted plane", () => {
  // Plane x + y + z = 0 → normal (1,1,1)/√3.
  const plane = fitPlaneToPoints([
    { x: 1, y: -1, z: 0 },
    { x: 0, y: 1, z: -1 },
    { x: -1, y: 0, z: 1 },
    { x: 2, y: -1, z: -1 },
  ]);
  assert.ok(plane);
  const s = 1 / Math.sqrt(3);
  const dot = Math.abs(plane.normal.x * s + plane.normal.y * s + plane.normal.z * s);
  assert.ok(Math.abs(dot - 1) < 1e-6);
});

test("fitPlaneToPoints rejects degenerate input", () => {
  assert.equal(fitPlaneToPoints([{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }]), null);
  // Collinear points have no unique plane.
  assert.equal(
    fitPlaneToPoints([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      { x: 2, y: 2, z: 2 },
    ]),
    null,
  );
});

test("planeBasis returns an orthonormal frame", () => {
  const n: PcVec3 = { x: 0, y: 0, z: 1 };
  const { u, v } = planeBasis(n);
  const dotUN = u.x * n.x + u.y * n.y + u.z * n.z;
  const dotUV = u.x * v.x + u.y * v.y + u.z * v.z;
  assert.ok(Math.abs(dotUN) < 1e-9);
  assert.ok(Math.abs(dotUV) < 1e-9);
  assert.ok(Math.abs(Math.hypot(u.x, u.y, u.z) - 1) < 1e-9);
  assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-9);
});

test("planarPolygonArea measures a flat unit square", () => {
  const area = planarPolygonArea([
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 0, y: 1, z: 0 },
  ]);
  assert.ok(Math.abs(area - 1) < 1e-9);
});

test("planarPolygonArea measures a tilted square", () => {
  // 2×2 square lying in the plane z = y (45° tilt about the x axis).
  const s = Math.SQRT1_2;
  const area = planarPolygonArea([
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 2 * s, z: 2 * s },
    { x: 0, y: 2 * s, z: 2 * s },
  ]);
  assert.ok(Math.abs(area - 4) < 1e-6);
});

test("planarPolygonArea returns 0 for degenerate polygons", () => {
  assert.equal(planarPolygonArea([]), 0);
  assert.equal(planarPolygonArea([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]), 0);
  assert.equal(
    planarPolygonArea([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      { x: 2, y: 2, z: 2 },
    ]),
    0,
  );
});

test("choosePickHit lets a pipe behind a plane win within tolerance", () => {
  // Translucent wall patch at 4.0 m in front of the pipe at 4.6 m — the pipe
  // is what the user aimed at, so it wins.
  const winner = choosePickHit([
    { distance: 4.0, kind: "plane" },
    { distance: 4.6, kind: "pipe-run" },
  ]);
  assert.equal(winner, 1);
});

test("choosePickHit lets a cluster behind a plane win within tolerance", () => {
  const winner = choosePickHit([
    { distance: 3.0, kind: "plane" },
    { distance: 3.4, kind: "cluster" },
  ]);
  assert.equal(winner, 1);
});

test("choosePickHit selects a lone plane", () => {
  assert.equal(choosePickHit([{ distance: 5.0, kind: "plane" }]), 0);
});

test("choosePickHit prefers a measurement over a nearer pipe", () => {
  const winner = choosePickHit([
    { distance: 5.0, kind: "pipe-run" },
    { distance: 5.5, kind: "measurement" },
  ]);
  assert.equal(winner, 1);
});

test("choosePickHit falls back to the plane when the pipe is beyond tolerance", () => {
  // Nearest hit at 2.0 m → tolerance max(5.0, 2.75) = 5.0 m; a pipe way back
  // at 8.0 m is not what was clicked.
  const winner = choosePickHit([
    { distance: 2.0, kind: "plane" },
    { distance: 8.0, kind: "pipe-run" },
  ]);
  assert.equal(winner, 0);
});

test("choosePickHit uses the absolute slack floor close to the camera", () => {
  // Nearest at 0.2 m → 2.5× is only 0.5 m, but the +0.75 m slack keeps a pipe
  // at 0.9 m selectable.
  const winner = choosePickHit([
    { distance: 0.2, kind: "plane" },
    { distance: 0.9, kind: "pipe-run" },
  ]);
  assert.equal(winner, 1);
});

test("choosePickHit picks the nearest hit within each class", () => {
  const winner = choosePickHit([
    { distance: 4.0, kind: "plane" },
    { distance: 4.8, kind: "pipe-run" },
    { distance: 4.2, kind: "pipe-run" },
  ]);
  assert.equal(winner, 2);
});

test("choosePickHit returns -1 for an empty hit list", () => {
  assert.equal(choosePickHit([]), -1);
});

test("formatMeasureValue picks precision by magnitude and unit", () => {
  assert.equal(formatMeasureValue(1.23456, "m"), "1.235 m");
  assert.equal(formatMeasureValue(12.3456, "m"), "12.35 m");
  assert.equal(formatMeasureValue(123.456, "m2"), "123.5 m²");
  assert.equal(formatMeasureValue(3.0001, "count"), "3");
});
