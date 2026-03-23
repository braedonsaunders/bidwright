export interface Point { x: number; y: number; }
export interface Calibration { pixelsPerUnit: number; unit: string; }

function dist(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function toReal(pixelDist: number, cal: Calibration): number {
  return cal.pixelsPerUnit > 0 ? pixelDist / cal.pixelsPerUnit : pixelDist;
}

export function linearDistance(points: Point[], cal: Calibration): number {
  if (points.length < 2) return 0;
  return toReal(dist(points[0], points[1]), cal);
}

export function polylineDistance(points: Point[], cal: Calibration): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return toReal(total, cal);
}

export function linearDropDistance(points: Point[], cal: Calibration, dropDistance: number): number {
  const base = polylineDistance(points, cal);
  const drops = Math.max(0, points.length - 1);
  return base + drops * dropDistance;
}

export function polygonArea(points: Point[], cal: Calibration): number {
  // Shoelace formula
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  area = Math.abs(area) / 2;
  const scale = cal.pixelsPerUnit > 0 ? cal.pixelsPerUnit * cal.pixelsPerUnit : 1;
  return area / scale;
}

export function rectangleArea(points: Point[], cal: Calibration): number {
  if (points.length < 2) return 0;
  const w = toReal(Math.abs(points[1].x - points[0].x), cal);
  const h = toReal(Math.abs(points[1].y - points[0].y), cal);
  return w * h;
}

export function triangleArea(points: Point[], cal: Calibration): number {
  if (points.length < 3) return 0;
  return polygonArea(points.slice(0, 3), cal);
}

export function ellipseArea(points: Point[], cal: Calibration): number {
  if (points.length < 2) return 0;
  const rx = toReal(Math.abs(points[1].x - points[0].x) / 2, cal);
  const ry = toReal(Math.abs(points[1].y - points[0].y) / 2, cal);
  return Math.PI * rx * ry;
}

export function verticalWallArea(points: Point[], wallHeight: number, cal: Calibration): number {
  const perimeter = polylineDistance([...points, points[0]], cal);
  return perimeter * wallHeight;
}

export function volume(area: number, height: number): number {
  return area * height;
}

export function countByDistance(points: Point[], spacing: number, cal: Calibration): number {
  if (spacing <= 0) return 0;
  const totalDist = polylineDistance(points, cal);
  return Math.max(1, Math.floor(totalDist / spacing) + 1);
}

export function computeMeasurement(
  annotationType: string,
  points: Point[],
  cal: Calibration,
  opts: { dropDistance?: number; wallHeight?: number; height?: number; spacing?: number } = {}
): { value: number; unit: string; area?: number; volume?: number } {
  switch (annotationType) {
    case "linear":
      return { value: linearDistance(points, cal), unit: cal.unit };
    case "linear-polyline":
      return { value: polylineDistance(points, cal), unit: cal.unit };
    case "linear-drop":
      return { value: linearDropDistance(points, cal, opts.dropDistance ?? 0), unit: cal.unit };
    case "count":
      return { value: points.length, unit: "count" };
    case "count-by-distance":
      return { value: countByDistance(points, opts.spacing ?? 1, cal), unit: "count" };
    case "area-vertical-wall": {
      const a = verticalWallArea(points, opts.wallHeight ?? 8, cal);
      return { value: a, unit: `${cal.unit}\u00B2`, area: a };
    }
    case "area-rectangle": {
      const a = rectangleArea(points, cal);
      const v = opts.height ? volume(a, opts.height) : undefined;
      return { value: a, unit: `${cal.unit}\u00B2`, area: a, volume: v };
    }
    case "area-triangle": {
      const a = triangleArea(points, cal);
      const v = opts.height ? volume(a, opts.height) : undefined;
      return { value: a, unit: `${cal.unit}\u00B2`, area: a, volume: v };
    }
    case "area-ellipse": {
      const a = ellipseArea(points, cal);
      const v = opts.height ? volume(a, opts.height) : undefined;
      return { value: a, unit: `${cal.unit}\u00B2`, area: a, volume: v };
    }
    case "area-polygon": {
      const a = polygonArea(points, cal);
      const v = opts.height ? volume(a, opts.height) : undefined;
      return { value: a, unit: `${cal.unit}\u00B2`, area: a, volume: v };
    }
    default:
      return { value: 0, unit: "" };
  }
}
