export type CadDrawingUnit =
  | "unitless"
  | "inch"
  | "foot"
  | "millimeter"
  | "centimeter"
  | "meter";

export type CadEntityKind =
  | "line"
  | "polyline"
  | "circle"
  | "arc"
  | "ellipse"
  | "hatch"
  | "point"
  | "text"
  | "block_reference";

export type CadLayoutKind = "model" | "paper";

export type CadMeasurementIntent = "count" | "length" | "area" | "perimeter";

export interface CadPoint2 {
  x: number;
  y: number;
}

export interface CadBounds2 {
  min: CadPoint2;
  max: CadPoint2;
}

export interface CadTransform2D {
  translate?: CadPoint2;
  scale?: CadPoint2;
  rotationRadians?: number;
}

export interface CadSourceReference {
  fileId?: string;
  fileName?: string;
  handle?: string;
  ownerHandle?: string;
  layoutName?: string;
  blockPath?: string[];
}

export interface CadLayer {
  id: string;
  name: string;
  visible: boolean;
  locked?: boolean;
  frozen?: boolean;
  color?: string;
  lineType?: string;
  lineWeight?: number;
  source?: CadSourceReference;
  metadata?: Record<string, unknown>;
}

export interface CadLayout {
  id: string;
  name: string;
  kind: CadLayoutKind;
  scale?: number;
  paperSize?: { width: number; height: number; unit: CadDrawingUnit };
  source?: CadSourceReference;
}

export interface CadBlockDefinition {
  id: string;
  name: string;
  basePoint: CadPoint2;
  entityIds: string[];
  source?: CadSourceReference;
  metadata?: Record<string, unknown>;
}

export interface CadEntityBase {
  id: string;
  kind: CadEntityKind;
  layerId: string;
  layoutId?: string;
  visible?: boolean;
  color?: string;
  lineType?: string;
  lineWeight?: number;
  source?: CadSourceReference;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CadLineEntity extends CadEntityBase {
  kind: "line";
  start: CadPoint2;
  end: CadPoint2;
}

export interface CadPolylineVertex extends CadPoint2 {
  bulge?: number;
}

export interface CadPolylineEntity extends CadEntityBase {
  kind: "polyline";
  vertices: CadPolylineVertex[];
  closed?: boolean;
}

export interface CadCircleEntity extends CadEntityBase {
  kind: "circle";
  center: CadPoint2;
  radius: number;
}

export interface CadArcEntity extends CadEntityBase {
  kind: "arc";
  center: CadPoint2;
  radius: number;
  startAngleRadians: number;
  endAngleRadians: number;
  clockwise?: boolean;
}

export interface CadEllipseEntity extends CadEntityBase {
  kind: "ellipse";
  center: CadPoint2;
  majorRadius: number;
  minorRadius: number;
  rotationRadians?: number;
  startAngleRadians?: number;
  endAngleRadians?: number;
  clockwise?: boolean;
}

export interface CadHatchLoop {
  vertices: CadPolylineVertex[];
  closed?: boolean;
}

export interface CadHatchEntity extends CadEntityBase {
  kind: "hatch";
  loops: CadHatchLoop[];
}

export interface CadPointEntity extends CadEntityBase {
  kind: "point";
  point: CadPoint2;
}

export interface CadTextEntity extends CadEntityBase {
  kind: "text";
  text: string;
  insertionPoint: CadPoint2;
  height?: number;
  rotationRadians?: number;
}

export interface CadBlockReferenceEntity extends CadEntityBase {
  kind: "block_reference";
  blockId: string;
  insertionPoint: CadPoint2;
  transform?: CadTransform2D;
  attributes?: Record<string, string>;
}

export type CadEntity =
  | CadLineEntity
  | CadPolylineEntity
  | CadCircleEntity
  | CadArcEntity
  | CadEllipseEntity
  | CadHatchEntity
  | CadPointEntity
  | CadTextEntity
  | CadBlockReferenceEntity;

export interface CadTakeoffGroup {
  id: string;
  name: string;
  entityIds: string[];
  layerIds?: string[];
  intent?: CadMeasurementIntent;
  worksheetItemId?: string;
  tags?: string[];
  source?: CadSourceReference;
  metadata?: Record<string, unknown>;
}

export interface CadMeasurementScale {
  drawingUnitsPerOutputUnit: number;
  outputUnit: string;
}

export interface CanonicalCadDrawing {
  id: string;
  name: string;
  version: 1;
  drawingUnit: CadDrawingUnit;
  source?: CadSourceReference;
  measurementScale?: CadMeasurementScale;
  layers: CadLayer[];
  layouts?: CadLayout[];
  blocks?: CadBlockDefinition[];
  entities: CadEntity[];
  groups?: CadTakeoffGroup[];
  extents?: CadBounds2;
  metadata?: Record<string, unknown>;
}

export interface CadMeasurement {
  count: number;
  length: number;
  area: number;
  perimeter: number;
  unit: string;
  areaUnit: string;
  entityIds: string[];
  layerIds: string[];
  warnings: string[];
}

export interface CadMeasureOptions {
  scale?: CadMeasurementScale;
  includeHidden?: boolean;
  layerIds?: string[];
  entityKinds?: CadEntityKind[];
  groupIds?: string[];
}

const TWO_PI = Math.PI * 2;
const EPSILON = 1e-9;

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function unitLabel(scale?: CadMeasurementScale): string {
  return scale?.outputUnit?.trim() || "drawing-unit";
}

function lengthFactor(scale?: CadMeasurementScale): number {
  if (!scale) return 1;
  return scale.drawingUnitsPerOutputUnit > 0 ? 1 / scale.drawingUnitsPerOutputUnit : 1;
}

function normalizeRadians(angle: number): number {
  const normalized = angle % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

export function cadDistance(a: CadPoint2, b: CadPoint2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function cadTransformPoint(point: CadPoint2, transform: CadTransform2D = {}): CadPoint2 {
  const scale = transform.scale ?? { x: 1, y: 1 };
  const translation = transform.translate ?? { x: 0, y: 0 };
  const rotation = transform.rotationRadians ?? 0;
  const scaledX = point.x * scale.x;
  const scaledY = point.y * scale.y;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return {
    x: scaledX * cos - scaledY * sin + translation.x,
    y: scaledX * sin + scaledY * cos + translation.y,
  };
}

export function cadUnionBounds(bounds: Array<CadBounds2 | null | undefined>): CadBounds2 | null {
  let result: CadBounds2 | null = null;
  for (const bound of bounds) {
    if (!bound) continue;
    if (!result) {
      result = {
        min: { x: bound.min.x, y: bound.min.y },
        max: { x: bound.max.x, y: bound.max.y },
      };
      continue;
    }
    result.min.x = Math.min(result.min.x, bound.min.x);
    result.min.y = Math.min(result.min.y, bound.min.y);
    result.max.x = Math.max(result.max.x, bound.max.x);
    result.max.y = Math.max(result.max.y, bound.max.y);
  }
  return result;
}

export function cadBoundsFromPoints(points: CadPoint2[]): CadBounds2 | null {
  if (points.length === 0) return null;
  return points.reduce<CadBounds2>(
    (bounds, point) => ({
      min: { x: Math.min(bounds.min.x, point.x), y: Math.min(bounds.min.y, point.y) },
      max: { x: Math.max(bounds.max.x, point.x), y: Math.max(bounds.max.y, point.y) },
    }),
    { min: { x: points[0]!.x, y: points[0]!.y }, max: { x: points[0]!.x, y: points[0]!.y } },
  );
}

export function cadSweepRadians(startAngleRadians: number, endAngleRadians: number, clockwise = false): number {
  const start = normalizeRadians(startAngleRadians);
  const end = normalizeRadians(endAngleRadians);
  const sweep = clockwise ? start - end : end - start;
  return normalizeRadians(sweep);
}

export function cadSignedPolygonArea(points: CadPoint2[]): number {
  if (points.length < 3) return 0;

  let twiceArea = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twiceArea += current.x * next.y - next.x * current.y;
  }

  return twiceArea / 2;
}

function segmentArcLength(start: CadPoint2, end: CadPoint2, bulge = 0): number {
  const chord = cadDistance(start, end);
  if (chord <= EPSILON || Math.abs(bulge) <= EPSILON) return chord;

  const theta = 4 * Math.atan(Math.abs(bulge));
  const radius = chord / (2 * Math.sin(theta / 2));
  return radius * theta;
}

function segmentBulgeArea(start: CadPoint2, end: CadPoint2, bulge = 0): number {
  const chord = cadDistance(start, end);
  if (chord <= EPSILON || Math.abs(bulge) <= EPSILON) return 0;

  const theta = 4 * Math.atan(Math.abs(bulge));
  const radius = chord / (2 * Math.sin(theta / 2));
  const segmentArea = (radius * radius * (theta - Math.sin(theta))) / 2;
  return Math.sign(bulge) * segmentArea;
}

export function cadPolylineLength(vertices: CadPolylineVertex[], closed = false): number {
  if (vertices.length < 2) return 0;

  const segmentCount = closed ? vertices.length : vertices.length - 1;
  let length = 0;
  for (let index = 0; index < segmentCount; index++) {
    const start = vertices[index]!;
    const end = vertices[(index + 1) % vertices.length]!;
    length += segmentArcLength(start, end, start.bulge);
  }

  return length;
}

export function cadSignedPolylineArea(vertices: CadPolylineVertex[], closed = false): number {
  if (!closed || vertices.length < 3) return 0;

  const points = vertices.map(({ x, y }) => ({ x, y }));
  let area = cadSignedPolygonArea(points);
  for (let index = 0; index < vertices.length; index++) {
    const start = vertices[index]!;
    const end = vertices[(index + 1) % vertices.length]!;
    area += segmentBulgeArea(start, end, start.bulge);
  }

  return area;
}

export function cadEllipseArcLength(
  majorRadius: number,
  minorRadius: number,
  startAngleRadians = 0,
  endAngleRadians = TWO_PI,
  clockwise = false,
  segments = 96,
): number {
  const major = Math.abs(majorRadius);
  const minor = Math.abs(minorRadius);
  if (major <= EPSILON || minor <= EPSILON) return 0;

  const rawSweep = Math.abs(endAngleRadians - startAngleRadians);
  const sweep = rawSweep >= TWO_PI - EPSILON ? TWO_PI : cadSweepRadians(startAngleRadians, endAngleRadians, clockwise);
  if (sweep <= EPSILON) return 0;

  const steps = Math.max(8, Math.ceil((segments * sweep) / TWO_PI));
  let length = 0;
  let previous = { x: major * Math.cos(startAngleRadians), y: minor * Math.sin(startAngleRadians) };
  const direction = clockwise ? -1 : 1;

  for (let step = 1; step <= steps; step++) {
    const angle = startAngleRadians + direction * (sweep * step) / steps;
    const point = { x: major * Math.cos(angle), y: minor * Math.sin(angle) };
    length += cadDistance(previous, point);
    previous = point;
  }

  return length;
}

export function cadLayerMap(drawing: Pick<CanonicalCadDrawing, "layers">): Map<string, CadLayer> {
  return new Map(drawing.layers.map((layer) => [layer.id, layer]));
}

export function isCadEntityVisible(entity: CadEntity, layers: ReadonlyMap<string, CadLayer>): boolean {
  if (entity.visible === false) return false;
  const layer = layers.get(entity.layerId);
  if (!layer) return true;
  return layer.visible !== false && layer.frozen !== true;
}

export function cadEntityBounds(entity: CadEntity): CadBounds2 | null {
  switch (entity.kind) {
    case "line":
      return cadBoundsFromPoints([entity.start, entity.end]);
    case "polyline":
      return cadBoundsFromPoints(entity.vertices);
    case "circle":
      return {
        min: { x: entity.center.x - entity.radius, y: entity.center.y - entity.radius },
        max: { x: entity.center.x + entity.radius, y: entity.center.y + entity.radius },
      };
    case "arc":
      return {
        min: { x: entity.center.x - entity.radius, y: entity.center.y - entity.radius },
        max: { x: entity.center.x + entity.radius, y: entity.center.y + entity.radius },
      };
    case "ellipse":
      return {
        min: { x: entity.center.x - entity.majorRadius, y: entity.center.y - entity.majorRadius },
        max: { x: entity.center.x + entity.majorRadius, y: entity.center.y + entity.majorRadius },
      };
    case "hatch":
      return cadUnionBounds(entity.loops.map((loop) => cadBoundsFromPoints(loop.vertices)));
    case "point":
      return cadBoundsFromPoints([entity.point]);
    case "text":
      return cadBoundsFromPoints([entity.insertionPoint]);
    case "block_reference":
      return cadBoundsFromPoints([entity.insertionPoint]);
  }
}

function emptyMeasurement(unit: string): CadMeasurement {
  return {
    count: 0,
    length: 0,
    area: 0,
    perimeter: 0,
    unit,
    areaUnit: `${unit}^2`,
    entityIds: [],
    layerIds: [],
    warnings: [],
  };
}

function scaleMeasurement(measurement: CadMeasurement, scale?: CadMeasurementScale): CadMeasurement {
  const factor = lengthFactor(scale);
  const unit = unitLabel(scale);
  return {
    ...measurement,
    length: finiteNumber(measurement.length * factor),
    perimeter: finiteNumber(measurement.perimeter * factor),
    area: finiteNumber(measurement.area * factor * factor),
    unit,
    areaUnit: `${unit}^2`,
  };
}

export function measureCadEntity(entity: CadEntity, options: Pick<CadMeasureOptions, "scale"> = {}): CadMeasurement {
  const raw = emptyMeasurement("drawing-unit");
  raw.count = 1;
  raw.entityIds = [entity.id];
  raw.layerIds = [entity.layerId];

  switch (entity.kind) {
    case "line":
      raw.length = cadDistance(entity.start, entity.end);
      break;
    case "polyline": {
      raw.length = cadPolylineLength(entity.vertices, entity.closed);
      if (entity.closed) {
        raw.area = Math.abs(cadSignedPolylineArea(entity.vertices, true));
        raw.perimeter = raw.length;
      }
      break;
    }
    case "circle":
      raw.length = TWO_PI * entity.radius;
      raw.perimeter = raw.length;
      raw.area = Math.PI * entity.radius * entity.radius;
      break;
    case "arc":
      raw.length = Math.abs(entity.radius) * cadSweepRadians(entity.startAngleRadians, entity.endAngleRadians, entity.clockwise);
      break;
    case "ellipse": {
      const isFull = entity.startAngleRadians === undefined && entity.endAngleRadians === undefined;
      raw.length = cadEllipseArcLength(
        entity.majorRadius,
        entity.minorRadius,
        entity.startAngleRadians ?? 0,
        entity.endAngleRadians ?? TWO_PI,
        entity.clockwise,
      );
      if (isFull) {
        raw.perimeter = raw.length;
        raw.area = Math.PI * Math.abs(entity.majorRadius) * Math.abs(entity.minorRadius);
      }
      break;
    }
    case "hatch": {
      raw.area = Math.abs(
        entity.loops.reduce((sum, loop) => sum + cadSignedPolylineArea(loop.vertices, loop.closed ?? true), 0),
      );
      raw.perimeter = entity.loops.reduce((sum, loop) => sum + cadPolylineLength(loop.vertices, loop.closed ?? true), 0);
      break;
    }
    case "block_reference":
      raw.warnings.push(`Block reference ${entity.id} requires expansion before geometric measurement.`);
      break;
    case "point":
    case "text":
      break;
  }

  return scaleMeasurement(raw, options.scale);
}

function mergeMeasurements(left: CadMeasurement, right: CadMeasurement): CadMeasurement {
  return {
    count: left.count + right.count,
    length: left.length + right.length,
    area: left.area + right.area,
    perimeter: left.perimeter + right.perimeter,
    unit: left.unit,
    areaUnit: left.areaUnit,
    entityIds: uniqueSorted([...left.entityIds, ...right.entityIds]),
    layerIds: uniqueSorted([...left.layerIds, ...right.layerIds]),
    warnings: [...left.warnings, ...right.warnings],
  };
}

export function getCadGroupEntities(drawing: CanonicalCadDrawing, groupId: string): CadEntity[] {
  const group = drawing.groups?.find((candidate) => candidate.id === groupId);
  if (!group) return [];

  const entityIds = new Set(group.entityIds);
  return drawing.entities.filter((entity) => entityIds.has(entity.id));
}

export function filterCadEntities(drawing: CanonicalCadDrawing, options: CadMeasureOptions = {}): CadEntity[] {
  const layerIds = options.layerIds ? new Set(options.layerIds) : null;
  const entityKinds = options.entityKinds ? new Set(options.entityKinds) : null;
  const groupEntityIds = options.groupIds
    ? new Set(options.groupIds.flatMap((groupId) => getCadGroupEntities(drawing, groupId).map((entity) => entity.id)))
    : null;
  const layers = cadLayerMap(drawing);

  return drawing.entities.filter((entity) => {
    if (layerIds && !layerIds.has(entity.layerId)) return false;
    if (entityKinds && !entityKinds.has(entity.kind)) return false;
    if (groupEntityIds && !groupEntityIds.has(entity.id)) return false;
    if (!options.includeHidden && !isCadEntityVisible(entity, layers)) return false;
    return true;
  });
}

export function measureCadDrawing(drawing: CanonicalCadDrawing, options: CadMeasureOptions = {}): CadMeasurement {
  const scale = options.scale ?? drawing.measurementScale;
  const base = emptyMeasurement(unitLabel(scale));

  return filterCadEntities(drawing, options).reduce(
    (measurement, entity) => mergeMeasurements(measurement, measureCadEntity(entity, { scale })),
    base,
  );
}

export function measureCadGroups(
  drawing: CanonicalCadDrawing,
  options: Omit<CadMeasureOptions, "groupIds"> = {},
): Array<CadTakeoffGroup & { measurement: CadMeasurement }> {
  return (drawing.groups ?? []).map((group) => ({
    ...group,
    measurement: measureCadDrawing(drawing, { ...options, groupIds: [group.id] }),
  }));
}

export function createCadTakeoffGroup(input: {
  id: string;
  name: string;
  entities: CadEntity[];
  intent?: CadMeasurementIntent;
  worksheetItemId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}): CadTakeoffGroup {
  return {
    id: input.id,
    name: input.name.trim() || input.id,
    entityIds: uniqueSorted(input.entities.map((entity) => entity.id)),
    layerIds: uniqueSorted(input.entities.map((entity) => entity.layerId)),
    intent: input.intent,
    worksheetItemId: input.worksheetItemId,
    tags: input.tags,
    metadata: input.metadata,
  };
}
