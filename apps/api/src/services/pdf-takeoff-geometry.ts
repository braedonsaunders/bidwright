export interface Point {
  x: number;
  y: number;
}
export interface Box extends Point {
  width: number;
  height: number;
}
export interface Calibration {
  pixelsPerUnit: number;
  unit: string;
  measuredBy?: string;
  source?: string;
  region?: Box;
  pageNumber?: number;
  [key: string]: unknown;
}
export type CalibrationCache = Record<string, Calibration>;

// PDF points use the top-left page frame (including the PDF's intrinsic rotation),
// matching the UI canvas at zoom 1. EvidenceView rotation is additional clockwise rotation.
export function viewToPdf(
  p: Point,
  width: number,
  height: number,
  rotation = 0,
  bbox?: Box | null,
): Point {
  if (![p.x, p.y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1))
    throw new Error("View coordinates are outside 0..1");
  const a = (rotation * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  const rotate = (q: Point) => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c });
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map(rotate);
  const minX = Math.min(...corners.map((q) => q.x)),
    minY = Math.min(...corners.map((q) => q.y));
  const w = Math.max(...corners.map((q) => q.x)) - minX,
    h = Math.max(...corners.map((q) => q.y)) - minY;
  const b = bbox ?? { x: 0, y: 0, width: 1, height: 1 };
  const x = minX + (b.x + p.x * b.width) * w,
    y = minY + (b.y + p.y * b.height) * h;
  return { x: x * c + y * s, y: -x * s + y * c };
}
export function pdfToCanvas(
  p: Point,
  page: { width: number; height: number },
  canvas = page,
): Point {
  return {
    x: (p.x * canvas.width) / page.width,
    y: (p.y * canvas.height) / page.height,
  };
}
export function canvasToPdf(
  p: Point,
  page: { width: number; height: number },
  canvas = page,
): Point {
  return {
    x: (p.x * page.width) / canvas.width,
    y: (p.y * page.height) / canvas.height,
  };
}
export function selectCalibration(
  cache: CalibrationCache,
  page: number,
  points: Point[],
) {
  const inside = (b: Box, p: Point) =>
    p.x >= b.x && p.y >= b.y && p.x <= b.x + b.width && p.y <= b.y + b.height;
  const regions = Object.entries(cache).filter(
    ([, cal]) =>
      cal.region &&
      cal.pageNumber === page &&
      points.every((p) => inside(cal.region!, p)),
  );
  const candidates = regions.length
    ? regions
    : Object.entries(cache).filter(
        ([key, cal]) =>
          !cal.region &&
          key === (cache[String(page)] ? String(page) : "__default"),
      );
  const facts: string[] = [];
  if (candidates.length === 0) facts.push("no_calibration");
  const first = candidates[0]?.[1];
  const conflicting = candidates.some(
    ([, c]) =>
      c.unit !== first?.unit ||
      Math.abs(c.pixelsPerUnit - first.pixelsPerUnit) > 1e-6,
  );
  if (conflicting) facts.push("conflicting_calibrations");
  // A path crossing a detail boundary has no single trustworthy scale.
  const crosses = (b: Box, a: Point, end: Point) => {
    let low = 0,
      high = 1;
    for (const [start, delta, min, max] of [
      [a.x, end.x - a.x, b.x, b.x + b.width],
      [a.y, end.y - a.y, b.y, b.y + b.height],
    ]) {
      if (Math.abs(delta) < 1e-9) {
        if (start < min || start > max) return false;
        continue;
      }
      const t1 = (min - start) / delta,
        t2 = (max - start) / delta;
      low = Math.max(low, Math.min(t1, t2));
      high = Math.min(high, Math.max(t1, t2));
    }
    return low < high && high > 0 && low < 1;
  };
  const crossing = Object.values(cache).some(
    (c) =>
      c.region &&
      c.pageNumber === page &&
      !points.every((p) => inside(c.region!, p)) &&
      (points.some((p) => inside(c.region!, p)) ||
        points.slice(1).some((p, i) => crosses(c.region!, points[i], p))),
  );
  if (crossing) facts.push("geometry_crosses_calibration_regions");
  return {
    calibration: conflicting || crossing ? null : (first ?? null),
    calibrationKey:
      conflicting || crossing ? null : (candidates[0]?.[0] ?? null),
    candidates: candidates.map(([key, calibration]) => ({ key, calibration })),
    facts,
  };
}
export function replaceCalibration(
  cache: CalibrationCache,
  key: string,
  calibration: Calibration,
  replaceHuman = false,
): CalibrationCache {
  const prior =
    cache[key] ??
    (key !== "__default" && !key.startsWith("region:")
      ? cache.__default
      : undefined);
  // Older UI calibrations have no provenance; preserve those just like person-made ones.
  if (prior && prior.measuredBy !== "agent" && !replaceHuman)
    throw new Error(
      "Human calibration exists; use replaceHuman:true to replace it",
    );
  return { ...cache, [key]: calibration };
}
export function measureGeometry(
  type: "linear" | "polyline" | "area" | "count",
  points: Point[],
  calibration: Calibration | null,
) {
  const required = type === "count" ? 1 : type === "area" ? 3 : 2;
  if (points.length < required || (type === "linear" && points.length !== 2))
    throw new Error(`Invalid point count for ${type}`);
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error("Non-finite coordinate");
  let raw = type === "count" ? points.length : 0;
  if (type === "area") {
    raw =
      Math.abs(
        points.reduce((sum, p, i) => {
          const q = points[(i + 1) % points.length];
          return sum + p.x * q.y - q.x * p.y;
        }, 0),
      ) / 2;
  } else if (type !== "count") {
    for (let i = 1; i < points.length; i++)
      raw += Math.hypot(
        points[i].x - points[i - 1].x,
        points[i].y - points[i - 1].y,
      );
  }
  const scale = calibration?.pixelsPerUnit ?? 1;
  if (!(scale > 0) || !Number.isFinite(scale))
    throw new Error("Invalid calibration scale");
  const value =
    raw / (type === "count" ? 1 : type === "area" ? scale ** 2 : scale);
  return {
    value,
    unit:
      type === "count"
        ? "count"
        : `${calibration?.unit ?? "px"}${type === "area" ? "²" : ""}`,
    raw,
    rawUnit: type === "count" ? "ea" : type === "area" ? "px2" : "px",
    ...(type === "area" ? { area: value } : {}),
  };
}
