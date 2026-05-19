// Unit tests for the pure DXF math helpers. Pulls no IO and no dxf-parser
// runtime; just exercises the conversion + affine algebra in isolation.

import test from "node:test";
import assert from "node:assert/strict";
import type { IInsertEntity } from "dxf-parser";

import {
  applyTransform,
  applyToPoint,
  dxfHeaderUnitName,
  IDENTITY,
  multiply,
  rotationOffset,
  transformForInsert,
  uniformScaleFactor,
  unitToInchFactor,
} from "./dxf-math";

test("unitToInchFactor: identity for inches", () => {
  assert.equal(unitToInchFactor("in"), 1);
});

test("unitToInchFactor: 1 ft = 12 in", () => {
  assert.equal(unitToInchFactor("ft"), 12);
});

test("unitToInchFactor: 1 mm = 1/25.4 in (exact)", () => {
  assert.equal(unitToInchFactor("mm"), 1 / 25.4);
});

test("unitToInchFactor: 1 m = 1/0.0254 in (~39.37)", () => {
  // 1 m = 100 cm = 1000 mm, so 1m = 1000/25.4 in.
  assert.ok(Math.abs(unitToInchFactor("m") - 1000 / 25.4) < 1e-9);
});

test("unitToInchFactor: unitless and unknown pass through as 1", () => {
  assert.equal(unitToInchFactor("unitless"), 1);
  assert.equal(unitToInchFactor("insunits-99"), 1);
});

test("dxfHeaderUnitName: maps known INSUNITS codes", () => {
  assert.equal(dxfHeaderUnitName({ $INSUNITS: 1 }), "in");
  assert.equal(dxfHeaderUnitName({ $INSUNITS: 4 }), "mm");
  assert.equal(dxfHeaderUnitName({ $INSUNITS: 6 }), "m");
});

test("dxfHeaderUnitName: missing or non-numeric header returns unitless", () => {
  assert.equal(dxfHeaderUnitName(undefined), "unitless");
  assert.equal(dxfHeaderUnitName({}), "unitless");
  assert.equal(dxfHeaderUnitName({ $INSUNITS: "1" as unknown as number }), "unitless");
});

test("dxfHeaderUnitName: unknown numeric code returns insunits-N sentinel", () => {
  assert.equal(dxfHeaderUnitName({ $INSUNITS: 999 }), "insunits-999");
});

test("multiply: identity is left and right identity", () => {
  const t: ReturnType<typeof multiply> = [2, 0, 0, 3, 5, 7];
  assert.deepEqual(multiply(IDENTITY, t), t);
  assert.deepEqual(multiply(t, IDENTITY), t);
});

test("multiply: composes a translate-then-scale correctly", () => {
  // First scale by 2x in X, then translate by (10, 0).
  const scale: ReturnType<typeof multiply> = [2, 0, 0, 1, 0, 0];
  const translate: ReturnType<typeof multiply> = [1, 0, 0, 1, 10, 0];
  // We're "applying scale first" → translate * scale.
  const composed = multiply(translate, scale);
  const out = applyTransform(composed, 5, 0);
  // (5,0) scaled to (10,0), then translated to (20,0).
  assert.equal(out.x, 20);
  // 0 and -0 are both acceptable origins on the Y axis.
  assert.ok(Math.abs(out.y) < 1e-12);
});

test("applyToPoint: undefined input returns undefined", () => {
  assert.equal(applyToPoint(IDENTITY, undefined), undefined);
});

test("applyToPoint: non-finite x rejected", () => {
  assert.equal(applyToPoint(IDENTITY, { x: Number.NaN, y: 0, z: 0 }), undefined);
});

test("transformForInsert: pure translation produces the identity rotation+scale", () => {
  const insert = {
    type: "INSERT",
    name: "B1",
    position: { x: 10, y: -3, z: 0 },
    xScale: 1, yScale: 1, zScale: 1, rotation: 0,
    columnCount: 1, rowCount: 1, columnSpacing: 0, rowSpacing: 0,
    extrusionDirection: { x: 0, y: 0, z: 1 },
  } as unknown as IInsertEntity;
  const t = transformForInsert(insert);
  // Identity rotation+scale means top-left submatrix is [1,0,0,1] and the
  // translation column is [10,-3]. Use abs-tolerance comparisons because
  // -sin(0) evaluates to -0 in JS, which fails strictEqual against +0.
  assert.equal(t[0], 1);
  assert.ok(Math.abs(t[1]) < 1e-12);
  assert.ok(Math.abs(t[2]) < 1e-12);
  assert.equal(t[3], 1);
  assert.equal(t[4], 10);
  assert.equal(t[5], -3);
});

test("transformForInsert: 90° rotation rotates a local +X vector into modelspace +Y", () => {
  const insert = {
    type: "INSERT",
    name: "B1",
    position: { x: 0, y: 0, z: 0 },
    xScale: 1, yScale: 1, zScale: 1, rotation: 90,
    columnCount: 1, rowCount: 1, columnSpacing: 0, rowSpacing: 0,
    extrusionDirection: { x: 0, y: 0, z: 1 },
  } as unknown as IInsertEntity;
  const t = transformForInsert(insert);
  const out = applyTransform(t, 1, 0);
  // Rotation 90° around the origin sends (1,0) → (0,1).
  assert.ok(Math.abs(out.x - 0) < 1e-9);
  assert.ok(Math.abs(out.y - 1) < 1e-9);
});

test("transformForInsert: 2x scale + (5,0) translation, applied to (1,0), is (7,0)", () => {
  const insert = {
    type: "INSERT",
    name: "B1",
    position: { x: 5, y: 0, z: 0 },
    xScale: 2, yScale: 2, zScale: 1, rotation: 0,
    columnCount: 1, rowCount: 1, columnSpacing: 0, rowSpacing: 0,
    extrusionDirection: { x: 0, y: 0, z: 1 },
  } as unknown as IInsertEntity;
  const t = transformForInsert(insert);
  const out = applyTransform(t, 1, 0);
  assert.equal(out.x, 7);
  assert.ok(Math.abs(out.y) < 1e-12);
});

test("uniformScaleFactor: 2x uniform scale yields 2", () => {
  const t: ReturnType<typeof multiply> = [2, 0, 0, 2, 0, 0];
  assert.equal(uniformScaleFactor(t), 2);
});

test("uniformScaleFactor: 1x scale + arbitrary rotation+translation still yields 1", () => {
  const cos = Math.cos(0.7);
  const sin = Math.sin(0.7);
  const t: ReturnType<typeof multiply> = [cos, sin, -sin, cos, 11, -3];
  assert.ok(Math.abs(uniformScaleFactor(t) - 1) < 1e-9);
});

test("rotationOffset: identity has rotation 0", () => {
  assert.equal(rotationOffset(IDENTITY), 0);
});

test("rotationOffset: 90° rotated affine yields π/2", () => {
  const cos = Math.cos(Math.PI / 2);
  const sin = Math.sin(Math.PI / 2);
  const t: ReturnType<typeof multiply> = [cos, sin, -sin, cos, 0, 0];
  assert.ok(Math.abs(rotationOffset(t) - Math.PI / 2) < 1e-9);
});
