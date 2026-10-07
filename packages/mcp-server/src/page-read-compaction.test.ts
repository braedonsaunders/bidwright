import assert from "node:assert/strict";
import test from "node:test";

import { compactPageReadMeta, parseBox } from "./tools/vision-tools.js";

function line(i: number) {
  const bbox = { x: 0.5418 + i / 1000, y: 0.7897, width: 0.0152, height: 0.0102 };
  return { text: `8" Base Plate c/w (1) 1" dia hole ${i}`, bbox, pageBbox: { ...bbox }, size: 4.9, block: 1 };
}

test("page reads keep exact text but drop duplicated coordinates and excess lines", () => {
  const raw = {
    viewId: "view-1",
    rotation: 270,
    textLines: Array.from({ length: 120 }, (_, i) => line(i)),
    textLinesTotal: 120,
    regions: [{ id: "R1", kind: "view", label: "Platform Framing Arrangement", bbox: { x: 0.0328, y: 0.0654, width: 0.3056, height: 0.4853 }, pageBbox: { x: 0.4493, y: 0.0328, width: 0.4853, height: 0.3056 } }],
    grid: { rows: 2, cols: 2, tiles: [{ id: "r1c1", bbox: {} }, { id: "r1c2", bbox: {} }] },
  };

  const compact = compactPageReadMeta(raw, "overview", false);
  assert.equal(compact.textLines.length, 40);
  assert.equal(compact.textLines[0], '8" Base Plate c/w (1) 1" dia hole 0 @0.542,0.79,0.015,0.01');
  assert.equal(compact.textLinesOmitted, 80);
  assert.deepEqual(compact.regions, ['R1 view "Platform Framing Arrangement" @0.033,0.065,0.306,0.485']);
  assert.deepEqual(compact.grid, { rows: 2, cols: 2, tileIds: ["r1c1", "r1c2"] });
  assert.ok(!JSON.stringify(compact).includes("pageBbox"));
  assert.ok(JSON.stringify(compact).length < JSON.stringify(raw).length / 5);

  const full = compactPageReadMeta(raw, "overview", true);
  assert.equal(full.textLines.length, 120);
  assert.equal(full.textLinesOmitted, undefined);
});

test("a region box string round-trips into a tile request", () => {
  assert.deepEqual(parseBox("0.033,0.065,0.306,0.485"), { x: 0.033, y: 0.065, width: 0.306, height: 0.485 });
  assert.deepEqual(parseBox({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }), { x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
});
