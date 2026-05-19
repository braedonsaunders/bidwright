// Pure math helpers for the DXF pipeline: INSUNITS table, 2D affine
// transforms for block expansion, and header unit detection. Split into its
// own module so they can be unit-tested without pulling Prisma, dxf-parser,
// or any IO into the test process.

import type { IInsertEntity, IPoint } from "dxf-parser";

export type DwgPoint = { x: number; y: number };

/** DXF $INSUNITS code → short unit name. Construction-relevant entries
 *  cover everything you'd see in real customer files; the rare entries
 *  (microns, nanometers, etc.) are still mapped so we never lose the
 *  drawing's intent. */
export const INSUNITS_NAME: Record<number, string> = {
  0: "unitless",
  1: "in",
  2: "ft",
  3: "mi",
  4: "mm",
  5: "cm",
  6: "m",
  7: "km",
  8: "uin",
  9: "mil",
  10: "yd",
  11: "ang",
  12: "nm",
  13: "mu",
  14: "dm",
  21: "dam",
};

/** Multiplier that converts one unit of `originalUnits` into one inch.
 *  Returns 1 for unknown / unitless inputs so consumers can pass through
 *  raw coordinates and rely on user calibration. */
export function unitToInchFactor(originalUnits: string): number {
  switch (originalUnits) {
    case "in":
      return 1;
    case "ft":
      return 12;
    case "yd":
      return 36;
    case "mi":
      return 63_360;
    case "mil":
      return 0.001;
    case "uin":
      return 0.000_001;
    case "mm":
      return 1 / 25.4;
    case "cm":
      return 1 / 2.54;
    case "dm":
      return 1 / 0.254;
    case "m":
      return 1 / 0.0254;
    case "dam":
      return 10 / 0.0254;
    case "km":
      return 1000 / 0.0254;
    case "nm":
      return 1e-9 / 0.0254;
    case "mu":
      return 1e-6 / 0.0254;
    case "ang":
      return 1e-10 / 0.0254;
    case "unitless":
    default:
      return 1;
  }
}

/** Resolve a DXF header object to a short unit name. The header is a
 *  Record<string, IPoint | number> from dxf-parser; only $INSUNITS is
 *  consulted. */
export function dxfHeaderUnitName(header: Record<string, unknown> | undefined): string {
  if (!header) return "unitless";
  const raw = header.$INSUNITS;
  if (typeof raw !== "number") return "unitless";
  return INSUNITS_NAME[raw] ?? `insunits-${raw}`;
}

/** 2D affine transform stored as [m11, m12, m21, m22, tx, ty]:
 *
 *    | m11  m21  tx |   | x |       | m11*x + m21*y + tx |
 *    | m12  m22  ty | * | y |   =   | m12*x + m22*y + ty |
 *    |  0    0    1 |   | 1 |       | 1                  |
 *
 *  Supports translation + scale + rotation, which covers everything a
 *  standard INSERT entity expresses. */
export type Affine = readonly [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function multiply(a: Affine, b: Affine): Affine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function applyTransform(t: Affine, x: number, y: number): DwgPoint {
  return { x: t[0] * x + t[2] * y + t[4], y: t[1] * x + t[3] * y + t[5] };
}

export function applyToPoint(t: Affine, p: IPoint | undefined): DwgPoint | undefined {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return undefined;
  return applyTransform(t, p.x, p.y);
}

/** Build the affine that takes a point in block-local coordinates to
 *  modelspace, per the INSERT entity's translation + scale + rotation. */
export function transformForInsert(insert: IInsertEntity): Affine {
  const xs = Number.isFinite(insert.xScale) ? insert.xScale : 1;
  const ys = Number.isFinite(insert.yScale) ? insert.yScale : 1;
  const rotation = ((insert.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [cos * xs, sin * xs, -sin * ys, cos * ys, insert.position?.x ?? 0, insert.position?.y ?? 0];
}

/** sqrt(|det|) — used to scale a circle radius under a uniform-ish
 *  transform. For non-uniform scale this is the geometric mean of x/y
 *  scales, which is the closest scalar we can give a circle that should
 *  really become an ellipse. */
export function uniformScaleFactor(t: Affine): number {
  return Math.sqrt(Math.abs(t[0] * t[3] - t[1] * t[2]));
}

/** Recover the rotation angle (radians) baked into an affine, assuming a
 *  pure rotation+scale+translate. Used when re-expressing arc/ellipse
 *  angles after expansion through a rotated INSERT. */
export function rotationOffset(t: Affine): number {
  return Math.atan2(t[1], t[0]);
}

/** Map a DXF block name (the only identifier dxf-parser surfaces for
 *  paperspace layouts) into a UI-friendly layout label.
 *
 *  AutoCAD's convention: the modelspace block is `*Model_Space`, the
 *  first paperspace layout is `*Paper_Space`, additional paperspace
 *  layouts are `*Paper_Space0`, `*Paper_Space1`, etc. The user-facing
 *  layout names (e.g. "Plot Sheet 1") live in the OBJECTS section's
 *  LAYOUT dictionary — dxf-parser doesn't surface that dictionary, so we
 *  emit the cleaned-up block name as the layout label. Downstream
 *  consumers (UI tabs, layout filters) get a stable string they can
 *  render directly.
 *
 *  Lives in dxf-math because it's a pure DXF-naming convention helper —
 *  no Prisma, no Buffer, no IO. Keeps it unit-testable without dragging
 *  the whole service-layer dep graph into a test process. */
export function prettifyLayoutName(blockName: string): string {
  const upper = blockName.toUpperCase();
  if (upper === "*MODEL_SPACE") return "Model";
  if (upper === "*PAPER_SPACE") return "Paper Space";
  // Match `*Paper_Space0`, `*Paper_Space1`, ... — emit "Paper Space N" so
  // the multi-layout case shows distinct labels in the UI.
  const match = /^\*PAPER_SPACE(\d+)$/.exec(upper);
  if (match) return `Paper Space ${match[1]}`;
  // Strip leading "*" and replace underscores for any other layout name
  // we don't recognise. This is a fallback for non-AutoCAD authors.
  return blockName.replace(/^\*/, "").replace(/_/g, " ").trim() || "Layout";
}
