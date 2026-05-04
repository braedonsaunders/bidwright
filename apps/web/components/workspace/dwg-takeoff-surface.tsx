"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  AlertTriangle,
  Check,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  Hand,
  Layers,
  Link2,
  Loader2,
  Maximize2,
  MousePointer2,
  PanelRightOpen,
  PenTool,
  RefreshCw,
  Ruler,
  Search,
  Square,
  Tally5,
  Trash2,
  Type,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  Separator,
} from "@/components/ui";
import {
  createTakeoffAnnotation,
  createTakeoffLink,
  createWorksheetItem,
  deleteTakeoffAnnotation,
  getDwgTakeoffMetadata,
  listTakeoffAnnotations,
  processDwgTakeoffMetadata,
  type DwgTakeoffMetadata,
  type ProjectWorkspaceData,
} from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

type DwgTool = "select" | "pan" | "distance" | "area" | "rectangle" | "count" | "text" | "calibrate";

type DwgPoint = { x: number; y: number };

type DwgDocument = {
  id: string;
  label: string;
  fileName: string;
  fileUrl: string;
};

type DwgEntity = {
  id: string;
  type: string;
  layer: string;
  layoutName?: string;
  color: string;
  start?: DwgPoint;
  end?: DwgPoint;
  center?: DwgPoint;
  radius?: number;
  vertices?: DwgPoint[];
  closed?: boolean;
  text?: string;
  bounds: Bounds;
  raw: Record<string, unknown>;
};

type DwgLayer = {
  name: string;
  color: string;
  count: number;
  frozen?: boolean;
  locked?: boolean;
};

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type Viewport = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

type DwgMeasurementAnnotation = {
  id: string;
  annotationType: string;
  label: string;
  color: string;
  groupName?: string;
  points: DwgPoint[];
  measurement?: {
    value?: number;
    unit?: string;
    rawValue?: number;
    rawUnit?: string;
  };
  metadata?: Record<string, unknown>;
};

type SnapCandidate = {
  point: DwgPoint;
  kind: "endpoint" | "midpoint" | "center" | "vertex" | "quadrant";
  entityId?: string;
  distancePx: number;
};

type DwgHistoryCommand = {
  kind: "create" | "delete";
  annotation: DwgMeasurementAnnotation;
};

type CalibrationState = {
  unitsPerWorld: number;
  unit: "ft" | "in" | "m" | "mm";
  pointA: DwgPoint;
  pointB: DwgPoint;
  actualLength: number;
};

type EstimateCategory = {
  id?: string | null;
  name: string;
  entityType: string;
};

const TOOL_OPTIONS: Array<{ id: DwgTool; label: string; icon: typeof MousePointer2; shortcut?: string }> = [
  { id: "select", label: "Select", icon: MousePointer2, shortcut: "V" },
  { id: "pan", label: "Pan", icon: Hand, shortcut: "H" },
  { id: "distance", label: "Distance", icon: Ruler, shortcut: "D" },
  { id: "area", label: "Area", icon: PenTool, shortcut: "A" },
  { id: "rectangle", label: "Rectangle", icon: Square, shortcut: "R" },
  { id: "count", label: "Count", icon: Tally5, shortcut: "C" },
  { id: "text", label: "Text", icon: Type, shortcut: "T" },
  { id: "calibrate", label: "Calibrate", icon: Crosshair, shortcut: "K" },
];

const PRESET_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"];

const ACI_COLORS: Record<number, string> = {
  0: "#d4d4d8",
  1: "#ef4444",
  2: "#facc15",
  3: "#22c55e",
  4: "#06b6d4",
  5: "#3b82f6",
  6: "#ec4899",
  7: "#f8fafc",
  8: "#94a3b8",
  9: "#cbd5e1",
};

function toPoint(value: unknown): DwgPoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { x?: unknown; y?: unknown };
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

function getRawPoint(raw: Record<string, unknown>, keys: string[]): DwgPoint | undefined {
  for (const key of keys) {
    const point = toPoint(raw[key]);
    if (point) return point;
  }
  return undefined;
}

function resolveColor(raw: Record<string, unknown>, layerColor?: string): string {
  const rawColor = raw.color ?? raw.colorNumber;
  if (typeof rawColor === "string" && rawColor.startsWith("#")) return rawColor;
  if (typeof rawColor === "number" && ACI_COLORS[rawColor]) return ACI_COLORS[rawColor];
  return layerColor ?? "#d4d4d8";
}

function emptyBounds(): Bounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function includePoint(bounds: Bounds, point?: DwgPoint) {
  if (!point) return;
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.maxY = Math.max(bounds.maxY, point.y);
}

function normalizeBounds(bounds: Bounds): Bounds {
  if (!Number.isFinite(bounds.minX)) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  }
  if (bounds.minX === bounds.maxX) {
    bounds.minX -= 1;
    bounds.maxX += 1;
  }
  if (bounds.minY === bounds.maxY) {
    bounds.minY -= 1;
    bounds.maxY += 1;
  }
  return bounds;
}

function entityBounds(entity: Omit<DwgEntity, "bounds">): Bounds {
  const bounds = emptyBounds();
  includePoint(bounds, entity.start);
  includePoint(bounds, entity.end);
  includePoint(bounds, entity.center);
  entity.vertices?.forEach((point) => includePoint(bounds, point));
  if (entity.center && Number.isFinite(entity.radius)) {
    const r = entity.radius ?? 0;
    includePoint(bounds, { x: entity.center.x - r, y: entity.center.y - r });
    includePoint(bounds, { x: entity.center.x + r, y: entity.center.y + r });
  }
  return normalizeBounds(bounds);
}

function allBounds(entities: DwgEntity[]): Bounds {
  const bounds = emptyBounds();
  entities.forEach((entity) => {
    includePoint(bounds, { x: entity.bounds.minX, y: entity.bounds.minY });
    includePoint(bounds, { x: entity.bounds.maxX, y: entity.bounds.maxY });
  });
  return normalizeBounds(bounds);
}

function normalizeEntities(parsed: unknown): DwgEntity[] {
  const data = parsed as {
    entities?: Array<Record<string, unknown>>;
    tables?: { layer?: { layers?: Record<string, { color?: number | string }> } };
  };
  const layerColors = data.tables?.layer?.layers ?? {};

  return (data.entities ?? []).map((raw, index) => {
    const type = String(raw.type ?? raw.entityType ?? "UNKNOWN").toUpperCase();
    const layer = String(raw.layer ?? "0");
    const layerColor = resolveColor({ color: layerColors[layer]?.color ?? undefined });
    const vertices = Array.isArray(raw.vertices)
      ? raw.vertices.map(toPoint).filter((point): point is DwgPoint => Boolean(point))
      : undefined;
    const center = getRawPoint(raw, ["center", "centerPoint", "position", "start"]);
    const candidate: Omit<DwgEntity, "bounds"> = {
      id: String(raw.handle ?? raw.id ?? `entity-${index}`),
      type,
      layer,
      layoutName: typeof raw.layoutName === "string" ? raw.layoutName : "Model",
      color: resolveColor(raw, layerColor),
      start: getRawPoint(raw, ["start", "startPoint"]),
      end: getRawPoint(raw, ["end", "endPoint"]),
      center,
      radius: typeof raw.radius === "number" ? raw.radius : undefined,
      vertices,
      closed: Boolean(raw.closed ?? raw.shape),
      text: typeof raw.text === "string" ? raw.text : undefined,
      raw,
    };
    return { ...candidate, bounds: entityBounds(candidate) };
  });
}

function buildLayers(entities: DwgEntity[]): DwgLayer[] {
  const map = new Map<string, { color: string; count: number }>();
  entities.forEach((entity) => {
    const current = map.get(entity.layer);
    if (current) {
      current.count += 1;
    } else {
      map.set(entity.layer, { color: entity.color, count: 1 });
    }
  });
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, color: value.color, count: value.count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : digits });
}

function distance(a: DwgPoint, b: DwgPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function polylineLength(points: DwgPoint[], closed = false): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index]);
  }
  if (closed && points.length > 2) total += distance(points[points.length - 1], points[0]);
  return total;
}

function polygonArea(points: DwgPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

function screenToWorld(x: number, y: number, viewport: Viewport, height: number): DwgPoint {
  return {
    x: (x - viewport.offsetX) / viewport.scale,
    y: (height - y - viewport.offsetY) / viewport.scale,
  };
}

function worldToScreen(point: DwgPoint, viewport: Viewport, height: number): DwgPoint {
  return {
    x: point.x * viewport.scale + viewport.offsetX,
    y: height - (point.y * viewport.scale + viewport.offsetY),
  };
}

function makeFitViewport(bounds: Bounds, width: number, height: number): Viewport {
  const padding = 44;
  const drawingWidth = Math.max(1, bounds.maxX - bounds.minX);
  const drawingHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.max(0.0001, Math.min((width - padding * 2) / drawingWidth, (height - padding * 2) / drawingHeight));
  const scaledWidth = drawingWidth * scale;
  const scaledHeight = drawingHeight * scale;
  const left = (width - scaledWidth) / 2;
  const top = (height - scaledHeight) / 2;
  return {
    scale,
    offsetX: left - bounds.minX * scale,
    offsetY: height - top - bounds.maxY * scale,
  };
}

function distanceToSegment(point: DwgPoint, a: DwgPoint, b: DwgPoint): number {
  const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (lengthSquared === 0) return distance(point, a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSquared));
  return distance(point, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

function midpoint(a: DwgPoint, b: DwgPoint): DwgPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function snapPointsForEntity(entity: DwgEntity): Array<Omit<SnapCandidate, "distancePx">> {
  const points: Array<Omit<SnapCandidate, "distancePx">> = [];
  if (entity.start) points.push({ point: entity.start, kind: "endpoint", entityId: entity.id });
  if (entity.end) points.push({ point: entity.end, kind: "endpoint", entityId: entity.id });
  if (entity.start && entity.end) points.push({ point: midpoint(entity.start, entity.end), kind: "midpoint", entityId: entity.id });
  if (entity.center) {
    points.push({ point: entity.center, kind: "center", entityId: entity.id });
    if (entity.radius && entity.radius > 0) {
      points.push(
        { point: { x: entity.center.x + entity.radius, y: entity.center.y }, kind: "quadrant", entityId: entity.id },
        { point: { x: entity.center.x - entity.radius, y: entity.center.y }, kind: "quadrant", entityId: entity.id },
        { point: { x: entity.center.x, y: entity.center.y + entity.radius }, kind: "quadrant", entityId: entity.id },
        { point: { x: entity.center.x, y: entity.center.y - entity.radius }, kind: "quadrant", entityId: entity.id },
      );
    }
  }
  entity.vertices?.forEach((point, index, vertices) => {
    points.push({ point, kind: "vertex", entityId: entity.id });
    const next = vertices[index + 1];
    if (next) points.push({ point: midpoint(point, next), kind: "midpoint", entityId: entity.id });
  });
  return points;
}

function findSnapCandidate(
  world: DwgPoint,
  entities: DwgEntity[],
  viewport: Viewport,
  height: number,
  tolerancePx = 11,
): SnapCandidate | null {
  const screen = worldToScreen(world, viewport, height);
  let best: SnapCandidate | null = null;
  for (const entity of entities) {
    for (const candidate of snapPointsForEntity(entity)) {
      const candidateScreen = worldToScreen(candidate.point, viewport, height);
      const distancePx = distance(screen, candidateScreen);
      if (distancePx <= tolerancePx && (!best || distancePx < best.distancePx)) {
        best = { ...candidate, distancePx };
      }
    }
  }
  return best;
}

function measureEntity(entity: DwgEntity, calibration: CalibrationState | null) {
  const unitsPerWorld = calibration?.unitsPerWorld ?? 1;
  const unit = calibration?.unit ?? "du";
  if (entity.type === "LINE" && entity.start && entity.end) {
    return { label: "Length", value: distance(entity.start, entity.end) * unitsPerWorld, unit };
  }
  if ((entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") && entity.vertices?.length) {
    if (entity.closed && entity.vertices.length >= 3) {
      return { label: "Area", value: polygonArea(entity.vertices) * unitsPerWorld * unitsPerWorld, unit: `${unit}2` };
    }
    return { label: "Length", value: polylineLength(entity.vertices, false) * unitsPerWorld, unit };
  }
  if (entity.type === "CIRCLE" && entity.radius) {
    return { label: "Area", value: Math.PI * entity.radius * entity.radius * unitsPerWorld * unitsPerWorld, unit: `${unit}2` };
  }
  return null;
}

function annotationMeasurement(points: DwgPoint[], tool: DwgTool, calibration: CalibrationState | null) {
  const unitsPerWorld = calibration?.unitsPerWorld ?? 1;
  const unit = calibration?.unit ?? "du";
  if (tool === "count") return { value: 1, unit: "EA", rawValue: 1, rawUnit: "count" };
  if (tool === "distance") {
    const raw = polylineLength(points);
    return { value: raw * unitsPerWorld, unit, rawValue: raw, rawUnit: "drawing-unit" };
  }
  if (tool === "area" || tool === "rectangle") {
    const raw = polygonArea(points);
    return { value: raw * unitsPerWorld * unitsPerWorld, unit: `${unit}2`, rawValue: raw, rawUnit: "drawing-unit2" };
  }
  return { value: 0, unit, rawValue: 0, rawUnit: "drawing-unit" };
}

function apiAnnotationToDwg(input: any): DwgMeasurementAnnotation {
  return {
    id: String(input.id),
    annotationType: String(input.annotationType ?? input.type ?? ""),
    label: String(input.label ?? ""),
    color: String(input.color ?? "#3b82f6"),
    groupName: typeof input.groupName === "string" ? input.groupName : undefined,
    points: Array.isArray(input.points) ? input.points.map((point: unknown) => toPoint(point)).filter((point: DwgPoint | undefined): point is DwgPoint => Boolean(point)) : [],
    measurement: input.measurement ?? undefined,
    metadata: input.metadata ?? {},
  };
}

function annotationToCreatePayload(activeDocument: DwgDocument, annotation: DwgMeasurementAnnotation, calibration: CalibrationState | null) {
  return {
    documentId: activeDocument.id,
    pageNumber: 1,
    annotationType: annotation.annotationType,
    label: annotation.label,
    color: annotation.color,
    lineThickness: 2.5,
    visible: true,
    groupName: annotation.groupName || "DWG Takeoff",
    points: annotation.points,
    measurement: annotation.measurement ?? {},
    calibration,
    metadata: {
      ...(annotation.metadata ?? {}),
      source: "dwg-takeoff",
      surface: "dwg-takeoff",
      fileName: activeDocument.fileName,
    },
  };
}

function calibrationStorageKey(projectId: string, documentId: string) {
  return `bidwright:dwg-calibration:${projectId}:${documentId}`;
}

function mapUom(unit: string | undefined): string {
  const normalized = (unit ?? "").toLowerCase();
  if (normalized === "ft") return "LF";
  if (normalized === "ft2") return "SF";
  if (normalized === "m") return "M";
  if (normalized === "m2") return "SM";
  if (normalized === "in") return "IN";
  if (normalized === "mm") return "MM";
  if (normalized === "ea" || normalized === "count") return "EA";
  return unit || "EA";
}

function exportAnnotationsCsv(documentName: string, annotations: DwgMeasurementAnnotation[]) {
  const headers = ["Label", "Type", "Quantity", "Unit", "Points"];
  const rows = annotations.map((annotation) => [
    annotation.label,
    annotation.annotationType,
    annotation.measurement?.value ?? "",
    annotation.measurement?.unit ?? "",
    annotation.points.map((point) => `${formatNumber(point.x)},${formatNumber(point.y)}`).join(" | "),
  ]);
  downloadCsv(
    `${documentName.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "") || "dwg"}-takeoff.csv`,
    headers,
    rows,
  );
}

function aggregateAnnotationGroups(annotations: DwgMeasurementAnnotation[]) {
  const groups = new Map<string, { key: string; label: string; count: number; unitTotals: Map<string, number> }>();
  for (const annotation of annotations) {
    const key = annotation.groupName || annotation.annotationType || "Takeoff";
    const group = groups.get(key) ?? { key, label: key, count: 0, unitTotals: new Map<string, number>() };
    group.count += 1;
    const value = annotation.measurement?.value;
    const unit = annotation.measurement?.unit ?? "";
    if (Number.isFinite(value) && unit) {
      group.unitTotals.set(unit, (group.unitTotals.get(unit) ?? 0) + Number(value));
    }
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    totals: Array.from(group.unitTotals.entries()).map(([unit, value]) => ({ unit, value })),
  }));
}

function aggregateEntityGroups(entities: DwgEntity[], calibration: CalibrationState | null) {
  const groups = new Map<string, { key: string; count: number; length: number; area: number; unit: string }>();
  for (const entity of entities) {
    const measurement = measureEntity(entity, calibration);
    const key = `${entity.layer}:${entity.type}`;
    const group = groups.get(key) ?? {
      key,
      count: 0,
      length: 0,
      area: 0,
      unit: calibration?.unit ?? "du",
    };
    group.count += 1;
    if (measurement) {
      if (measurement.unit.endsWith("2")) group.area += measurement.value;
      else group.length += measurement.value;
    }
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort((left, right) => right.count - left.count).slice(0, 8);
}

interface DwgTakeoffSurfaceProps {
  projectId: string;
  documents: DwgDocument[];
  selectedDocumentId?: string;
  workspace: ProjectWorkspaceData;
  selectedWorksheetId?: string;
  defaultEstimateCategory?: EstimateCategory | null;
  onSelectedDocumentChange?: (documentId: string) => void;
  onWorkspaceMutated?: () => void;
}

export function DwgTakeoffSurface({
  projectId,
  documents,
  selectedDocumentId,
  workspace,
  selectedWorksheetId,
  defaultEstimateCategory,
  onSelectedDocumentChange,
  onWorkspaceMutated,
}: DwgTakeoffSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport>({ scale: 1, offsetX: 0, offsetY: 0 });
  const fitEntitiesRef = useRef<DwgEntity[]>([]);
  const dragRef = useRef<{ mode: "pan" | "rectangle" | null; x: number; y: number; viewport: Viewport; world?: DwgPoint }>({ mode: null, x: 0, y: 0, viewport: viewportRef.current });
  const undoStackRef = useRef<DwgHistoryCommand[]>([]);
  const redoStackRef = useRef<DwgHistoryCommand[]>([]);
  const [documentId, setDocumentId] = useState(selectedDocumentId ?? documents[0]?.id ?? "");
  const activeDocument = documents.find((document) => document.id === documentId) ?? documents[0] ?? null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<DwgTakeoffMetadata | null>(null);
  const [entities, setEntities] = useState<DwgEntity[]>([]);
  const [annotations, setAnnotations] = useState<DwgMeasurementAnnotation[]>([]);
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(() => new Set());
  const [selectedLayout, setSelectedLayout] = useState<string>("__all__");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<DwgTool>("select");
  const [activeColor, setActiveColor] = useState(PRESET_COLORS[0]);
  const [drawPoints, setDrawPoints] = useState<DwgPoint[]>([]);
  const [cursorWorld, setCursorWorld] = useState<DwgPoint | null>(null);
  const [snapCandidate, setSnapCandidate] = useState<SnapCandidate | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [layerSearch, setLayerSearch] = useState("");
  const [entitySearch, setEntitySearch] = useState("");
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const [creatingAnnotationId, setCreatingAnnotationId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "success" | "danger" | "info"; message: string } | null>(null);

  const targetWorksheet = useMemo(
    () => workspace.worksheets.find((worksheet) => worksheet.id === selectedWorksheetId) ?? workspace.worksheets[0] ?? null,
    [selectedWorksheetId, workspace.worksheets],
  );

  const layoutOptions = useMemo(() => {
    const fromMetadata = metadata?.layouts?.filter((layout) => layout.entityCount > 0).map((layout) => layout.name) ?? [];
    const fromEntities = Array.from(new Set(entities.map((entity) => entity.layoutName || "Model")));
    return Array.from(new Set([...fromMetadata, ...fromEntities])).sort((left, right) => left.localeCompare(right));
  }, [entities, metadata]);

  const layoutEntities = useMemo(
    () => selectedLayout === "__all__"
      ? entities
      : entities.filter((entity) => (entity.layoutName || "Model") === selectedLayout),
    [entities, selectedLayout],
  );

  const selectedEntity = useMemo(
    () => layoutEntities.find((entity) => entity.id === selectedEntityId) ?? null,
    [layoutEntities, selectedEntityId],
  );

  const layers = useMemo(() => {
    const computed = buildLayers(layoutEntities);
    if (!metadata?.layers?.length) return computed;
    const counts = new Map(computed.map((layer) => [layer.name, layer.count]));
    return metadata.layers
      .filter((layer) => counts.has(layer.name))
      .map((layer) => ({ ...layer, count: counts.get(layer.name) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [layoutEntities, metadata]);
  const filteredLayers = useMemo(() => {
    const query = layerSearch.trim().toLowerCase();
    if (!query) return layers;
    return layers.filter((layer) => layer.name.toLowerCase().includes(query));
  }, [layerSearch, layers]);
  const filteredEntities = useMemo(() => {
    const query = entitySearch.trim().toLowerCase();
    return layoutEntities.filter((entity) => {
      if (!visibleLayers.has(entity.layer)) return false;
      if (!query) return true;
      return `${entity.type} ${entity.layer} ${entity.text ?? ""} ${entity.id}`.toLowerCase().includes(query);
    });
  }, [layoutEntities, entitySearch, visibleLayers]);

  const annotationGroups = useMemo(() => aggregateAnnotationGroups(annotations), [annotations]);
  const entityGroups = useMemo(() => aggregateEntityGroups(filteredEntities, calibration), [calibration, filteredEntities]);
  const canUndo = historyVersion >= 0 && undoStackRef.current.length > 0;
  const canRedo = historyVersion >= 0 && redoStackRef.current.length > 0;

  useEffect(() => {
    fitEntitiesRef.current = layoutEntities.length > 0 ? layoutEntities : entities;
  }, [entities, layoutEntities]);

  useEffect(() => {
    if (!selectedDocumentId) return;
    setDocumentId(selectedDocumentId);
  }, [selectedDocumentId]);

  function updateViewport(next: Viewport) {
    viewportRef.current = next;
    setViewportVersion((value) => value + 1);
  }

  function updateHistoryVersion() {
    setHistoryVersion((value) => value + 1);
  }

  function pushHistory(command: DwgHistoryCommand) {
    undoStackRef.current = [...undoStackRef.current.slice(-49), command];
    redoStackRef.current = [];
    updateHistoryVersion();
  }

  async function recreateAnnotation(annotation: DwgMeasurementAnnotation): Promise<DwgMeasurementAnnotation | null> {
    if (!activeDocument) return null;
    const created = await createTakeoffAnnotation(projectId, annotationToCreatePayload(activeDocument, annotation, calibration));
    const next = apiAnnotationToDwg(created);
    setAnnotations((current) => [...current, next]);
    return next;
  }

  async function deleteAnnotationInternal(annotationId: string) {
    await deleteTakeoffAnnotation(projectId, annotationId).catch(() => {});
    setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId));
  }

  async function undoLastAction() {
    const command = undoStackRef.current.pop();
    if (!command) return;
    try {
      if (command.kind === "create") {
        await deleteAnnotationInternal(command.annotation.id);
        redoStackRef.current.push(command);
      } else {
        const restored = await recreateAnnotation(command.annotation);
        redoStackRef.current.push({ kind: "delete", annotation: restored ?? command.annotation });
      }
    } finally {
      updateHistoryVersion();
    }
  }

  async function redoLastAction() {
    const command = redoStackRef.current.pop();
    if (!command) return;
    try {
      if (command.kind === "create") {
        const recreated = await recreateAnnotation(command.annotation);
        undoStackRef.current.push({ kind: "create", annotation: recreated ?? command.annotation });
      } else {
        await deleteAnnotationInternal(command.annotation.id);
        undoStackRef.current.push(command);
      }
    } finally {
      updateHistoryVersion();
    }
  }

  const fitToEntities = useCallback((nextEntities = fitEntitiesRef.current) => {
    const container = containerRef.current;
    if (!container || nextEntities.length === 0) return;
    updateViewport(makeFitViewport(allBounds(nextEntities), container.clientWidth || 800, container.clientHeight || 600));
  }, []);

  const reloadAnnotations = useCallback(async () => {
    if (!activeDocument) {
      setAnnotations([]);
      return;
    }
    const rows = await listTakeoffAnnotations(projectId, activeDocument.id, 1);
    setAnnotations(rows.map(apiAnnotationToDwg).filter((annotation) => annotation.metadata?.surface === "dwg-takeoff" || annotation.metadata?.source === "dwg-takeoff"));
  }, [activeDocument, projectId]);

  const loadDrawingMetadata = useCallback(async (refresh = false) => {
    if (!activeDocument) return;
    setLoading(true);
    setError(null);
    setSelectedEntityId(null);
    setDrawPoints([]);
    setSnapCandidate(null);
    try {
      const result = refresh
        ? await processDwgTakeoffMetadata(projectId, activeDocument.id)
        : await getDwgTakeoffMetadata(projectId, activeDocument.id);
      setMetadata(result);
      if (result.status !== "processed") {
        setEntities([]);
        setVisibleLayers(new Set());
        setError(result.converter.message ?? "Binary DWG processing needs a configured converter before takeoff can start.");
        return;
      }
      const nextEntities = result.entities.map((entity) => ({
        ...entity,
        layoutName: entity.layoutName || "Model",
      }));
      setEntities(nextEntities);
      const nextLayout = result.layouts.find((layout) => layout.entityCount > 0)?.name ?? "__all__";
      setSelectedLayout(nextLayout);
      const layoutFiltered = nextLayout === "__all__"
        ? nextEntities
        : nextEntities.filter((entity) => (entity.layoutName || "Model") === nextLayout);
      setVisibleLayers(new Set(buildLayers(layoutFiltered).map((layer) => layer.name)));
      window.requestAnimationFrame(() => fitToEntities(layoutFiltered.length > 0 ? layoutFiltered : nextEntities));
    } catch (err) {
      setMetadata(null);
      setEntities([]);
      setVisibleLayers(new Set());
      const result = (err as { result?: DwgTakeoffMetadata }).result;
      setError(result?.converter?.message ?? (err instanceof Error ? err.message : "Could not process DWG/DXF drawing."));
    } finally {
      setLoading(false);
    }
  }, [activeDocument, fitToEntities, projectId]);

  useEffect(() => {
    if (!activeDocument) return;
    const stored = window.localStorage.getItem(calibrationStorageKey(projectId, activeDocument.id));
    setCalibration(stored ? JSON.parse(stored) as CalibrationState : null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    updateHistoryVersion();
    void loadDrawingMetadata();
    void reloadAnnotations().catch(() => setAnnotations([]));
  }, [activeDocument, loadDrawingMetadata, projectId, reloadAnnotations]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#101522";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(148, 163, 184, 0.09)";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
    for (let x = 0; x < width; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 120) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const viewport = viewportRef.current;
    const drawingContext = ctx;
    const point = (world: DwgPoint) => worldToScreen(world, viewport, height);

    function renderPolyline(points: DwgPoint[], closed = false) {
      if (points.length < 2) return;
      const first = point(points[0]);
      drawingContext.beginPath();
      drawingContext.moveTo(first.x, first.y);
      points.slice(1).forEach((vertex) => {
        const next = point(vertex);
        drawingContext.lineTo(next.x, next.y);
      });
      if (closed) drawingContext.closePath();
      drawingContext.stroke();
    }

    filteredEntities.forEach((entity) => {
      ctx.strokeStyle = entity.id === selectedEntityId ? "#38bdf8" : entity.color;
      ctx.fillStyle = entity.id === selectedEntityId ? "#38bdf8" : entity.color;
      ctx.lineWidth = entity.id === selectedEntityId ? 2.5 : 1;
      ctx.shadowColor = entity.id === selectedEntityId ? "rgba(56, 189, 248, 0.35)" : "transparent";
      ctx.shadowBlur = entity.id === selectedEntityId ? 9 : 0;

      if (entity.type === "LINE" && entity.start && entity.end) {
        renderPolyline([entity.start, entity.end]);
      } else if ((entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") && entity.vertices) {
        renderPolyline(entity.vertices, entity.closed);
      } else if (entity.type === "CIRCLE" && entity.center && entity.radius) {
        const center = point(entity.center);
        ctx.beginPath();
        ctx.arc(center.x, center.y, entity.radius * viewport.scale, 0, Math.PI * 2);
        ctx.stroke();
      } else if (entity.type === "ARC" && entity.center && entity.radius) {
        const center = point(entity.center);
        const start = typeof entity.raw.startAngle === "number" ? entity.raw.startAngle : 0;
        const end = typeof entity.raw.endAngle === "number" ? entity.raw.endAngle : 360;
        ctx.beginPath();
        ctx.arc(center.x, center.y, entity.radius * viewport.scale, (-start * Math.PI) / 180, (-end * Math.PI) / 180, true);
        ctx.stroke();
      } else if ((entity.type === "TEXT" || entity.type === "MTEXT") && entity.start && entity.text) {
        const screen = point(entity.start);
        ctx.font = `${Math.max(8, Math.min(24, 2.5 * viewport.scale))}px monospace`;
        ctx.fillText(entity.text.slice(0, 80), screen.x, screen.y);
      }
    });
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;

    annotations.forEach((annotation) => {
      ctx.strokeStyle = annotation.color;
      ctx.fillStyle = annotation.color;
      ctx.lineWidth = 2.5;
      const points = annotation.points.map(point);
      if (annotation.annotationType === "count" && points[0]) {
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, 5, 0, Math.PI * 2);
        ctx.fill();
      } else if (annotation.annotationType === "area-rectangle" || annotation.annotationType === "area-polygon") {
        if (points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          points.slice(1).forEach((next) => ctx.lineTo(next.x, next.y));
          ctx.closePath();
          ctx.globalAlpha = 0.12;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.stroke();
        }
      } else if (points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach((next) => ctx.lineTo(next.x, next.y));
        ctx.stroke();
      }
      if (points[0] && annotation.measurement?.value !== undefined) {
        ctx.font = "12px sans-serif";
        ctx.fillText(`${formatNumber(annotation.measurement.value)} ${annotation.measurement.unit ?? ""}`, points[0].x + 8, points[0].y - 8);
      }
    });

    const previewPoints = [...drawPoints, ...(cursorWorld && drawPoints.length > 0 ? [cursorWorld] : [])];
    if (previewPoints.length > 0) {
      ctx.strokeStyle = activeColor;
      ctx.fillStyle = activeColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      const points = previewPoints.map(point);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((next) => ctx.lineTo(next.x, next.y));
      if (activeTool === "area" && points.length > 2) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      points.forEach((screen) => {
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    if (snapCandidate) {
      const screen = point(snapCandidate.point);
      ctx.save();
      ctx.strokeStyle = "#22c55e";
      ctx.fillStyle = "rgba(34, 197, 94, 0.18)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(screen.x - 12, screen.y);
      ctx.lineTo(screen.x + 12, screen.y);
      ctx.moveTo(screen.x, screen.y - 12);
      ctx.lineTo(screen.x, screen.y + 12);
      ctx.stroke();
      ctx.font = "10px sans-serif";
      ctx.fillStyle = "#22c55e";
      ctx.fillText(snapCandidate.kind, screen.x + 10, screen.y - 10);
      ctx.restore();
    }
  }, [activeColor, activeTool, annotations, cursorWorld, drawPoints, filteredEntities, selectedEntityId, snapCandidate, viewportVersion]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      fitToEntities();
      draw();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [draw, fitToEntities]);

  function currentWorld(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return screenToWorld(event.clientX - rect.left, event.clientY - rect.top, viewportRef.current, rect.height);
  }

  function snappedWorld(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top, viewportRef.current, rect.height);
    if (!snapEnabled) return world;
    return findSnapCandidate(world, filteredEntities, viewportRef.current, rect.height)?.point ?? world;
  }

  function hitTest(event: ReactMouseEvent<HTMLDivElement>): DwgEntity | null {
    const rect = event.currentTarget.getBoundingClientRect();
    const viewport = viewportRef.current;
    const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    for (const entity of filteredEntities.slice().reverse()) {
      if (entity.type === "LINE" && entity.start && entity.end) {
        const a = worldToScreen(entity.start, viewport, rect.height);
        const b = worldToScreen(entity.end, viewport, rect.height);
        if (distanceToSegment(screenPoint, a, b) <= 8) return entity;
      }
      if ((entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") && entity.vertices) {
        for (let index = 1; index < entity.vertices.length; index += 1) {
          const a = worldToScreen(entity.vertices[index - 1], viewport, rect.height);
          const b = worldToScreen(entity.vertices[index], viewport, rect.height);
          if (distanceToSegment(screenPoint, a, b) <= 8) return entity;
        }
      }
      if (entity.type === "CIRCLE" && entity.center && entity.radius) {
        const center = worldToScreen(entity.center, viewport, rect.height);
        if (Math.abs(distance(screenPoint, center) - entity.radius * viewport.scale) <= 8) return entity;
      }
    }
    return null;
  }

  async function persistAnnotation(tool: DwgTool, points: DwgPoint[], label: string) {
    if (!activeDocument) return;
    const measurement = annotationMeasurement(points, tool, calibration);
    const annotationType = tool === "area" ? "area-polygon" : tool === "rectangle" ? "area-rectangle" : tool;
    const created = await createTakeoffAnnotation(projectId, {
      documentId: activeDocument.id,
      pageNumber: 1,
      annotationType,
      label,
      color: activeColor,
      lineThickness: 2.5,
      visible: true,
      groupName: "DWG Takeoff",
      points,
      measurement,
      calibration,
      metadata: {
        source: "dwg-takeoff",
        surface: "dwg-takeoff",
        fileName: activeDocument.fileName,
        tool,
      },
    });
    const annotation = apiAnnotationToDwg(created);
    setAnnotations((current) => [...current, annotation]);
    pushHistory({ kind: "create", annotation });
  }

  async function finishCalibration(pointA: DwgPoint, pointB: DwgPoint) {
    const rawLength = distance(pointA, pointB);
    if (rawLength <= 0) return;
    const valueText = window.prompt("Actual distance between the two picked points", "10");
    if (!valueText) return;
    const actualLength = Number(valueText);
    if (!Number.isFinite(actualLength) || actualLength <= 0) {
      setStatus({ tone: "danger", message: "Calibration length must be a positive number." });
      return;
    }
    const unitText = window.prompt("Calibration unit: ft, in, m, or mm", "ft")?.toLowerCase() ?? "ft";
    const unit = (["ft", "in", "m", "mm"].includes(unitText) ? unitText : "ft") as CalibrationState["unit"];
    const next = { unitsPerWorld: actualLength / rawLength, unit, pointA, pointB, actualLength };
    setCalibration(next);
    if (activeDocument) {
      window.localStorage.setItem(calibrationStorageKey(projectId, activeDocument.id), JSON.stringify(next));
    }
    setStatus({ tone: "success", message: `Calibrated ${formatNumber(rawLength)} drawing units to ${formatNumber(actualLength)} ${unit}.` });
  }

  async function handleCanvasClick(event: ReactMouseEvent<HTMLDivElement>) {
    const world = snappedWorld(event);
    if (activeTool === "select") {
      setSelectedEntityId(hitTest(event)?.id ?? null);
      return;
    }
    if (activeTool === "pan") return;
    if (activeTool === "count") {
      await persistAnnotation("count", [world], "DWG count");
      return;
    }
    if (activeTool === "text") {
      const text = window.prompt("Text note");
      if (text?.trim()) await persistAnnotation("text", [world], text.trim());
      return;
    }
    if (activeTool === "calibrate") {
      if (drawPoints.length === 0) {
        setDrawPoints([world]);
      } else {
        await finishCalibration(drawPoints[0], world);
        setDrawPoints([]);
      }
      return;
    }
    if (activeTool === "distance") {
      if (drawPoints.length === 0) {
        setDrawPoints([world]);
      } else {
        await persistAnnotation("distance", [drawPoints[0], world], "DWG distance");
        setDrawPoints([]);
      }
      return;
    }
    if (activeTool === "area") {
      setDrawPoints((current) => [...current, world]);
    }
  }

  async function handleCanvasDoubleClick() {
    if (activeTool !== "area" || drawPoints.length < 3) return;
    await persistAnnotation("area", drawPoints, "DWG area");
    setDrawPoints([]);
  }

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (activeTool === "pan" || event.button === 1) {
      dragRef.current = { mode: "pan", x: event.clientX, y: event.clientY, viewport: { ...viewportRef.current } };
      return;
    }
    if (activeTool === "rectangle") {
      const world = snapEnabled
        ? findSnapCandidate(screenToWorld(event.clientX - rect.left, event.clientY - rect.top, viewportRef.current, rect.height), filteredEntities, viewportRef.current, rect.height)?.point
        : null;
      dragRef.current = {
        mode: "rectangle",
        x: event.clientX,
        y: event.clientY,
        viewport: { ...viewportRef.current },
        world: world ?? screenToWorld(event.clientX - rect.left, event.clientY - rect.top, viewportRef.current, rect.height),
      };
    }
  }

  function handleMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top, viewportRef.current, rect.height);
    const snap = snapEnabled ? findSnapCandidate(world, filteredEntities, viewportRef.current, rect.height) : null;
    setSnapCandidate(snap);
    setCursorWorld(snap?.point ?? world);
    const drag = dragRef.current;
    if (drag.mode === "pan") {
      updateViewport({
        ...drag.viewport,
        offsetX: drag.viewport.offsetX + event.clientX - drag.x,
        offsetY: drag.viewport.offsetY - (event.clientY - drag.y),
      });
    }
  }

  async function handleMouseUp(event: ReactMouseEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = { mode: null, x: 0, y: 0, viewport: viewportRef.current };
    if (drag.mode !== "rectangle" || !drag.world) return;
    const end = snappedWorld(event);
    if (distance(drag.world, end) < 0.001) return;
    const points = [
      drag.world,
      { x: end.x, y: drag.world.y },
      end,
      { x: drag.world.x, y: end.y },
    ];
    await persistAnnotation("rectangle", points, "DWG rectangle");
  }

  function handleWheel(event: ReactMouseEvent<HTMLDivElement> & { deltaY?: number }) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const deltaY = event.deltaY ?? 0;
    const current = viewportRef.current;
    const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top, current, rect.height);
    const nextScale = Math.max(0.0001, Math.min(current.scale * (deltaY > 0 ? 0.88 : 1.14), current.scale * 200));
    updateViewport({
      scale: nextScale,
      offsetX: event.clientX - rect.left - world.x * nextScale,
      offsetY: rect.height - (event.clientY - rect.top) - world.y * nextScale,
    });
  }

  async function deleteAnnotation(annotationId: string) {
    const annotation = annotations.find((item) => item.id === annotationId);
    await deleteAnnotationInternal(annotationId);
    if (annotation) pushHistory({ kind: "delete", annotation });
  }

  async function sendAnnotationToEstimate(annotation: DwgMeasurementAnnotation) {
    if (!targetWorksheet) {
      setStatus({ tone: "danger", message: "Create a worksheet before sending DWG measurements to the estimate." });
      return;
    }
    const quantity = annotation.measurement?.value ?? 1;
    const unit = annotation.measurement?.unit ?? "EA";
    const previousItemIds = new Set(workspace.worksheets.flatMap((worksheet) => worksheet.items).map((item) => item.id));
    setCreatingAnnotationId(annotation.id);
    try {
      const category = defaultEstimateCategory ?? { name: "Model Takeoff", entityType: "DWG Measurement" };
      const result = await createWorksheetItem(projectId, targetWorksheet.id, {
        categoryId: category.id ?? null,
        category: category.name,
        entityType: category.entityType || "DWG Measurement",
        entityName: annotation.label || "DWG measurement",
        description: activeDocument?.fileName ?? "",
        quantity,
        uom: mapUom(unit),
        cost: 0,
        markup: workspace.currentRevision.defaultMarkup ?? 0.2,
        price: 0,
        sourceNotes: [
          `From DWG takeoff: ${activeDocument?.fileName ?? "drawing"}`,
          `${formatNumber(quantity)} ${unit}`,
          `Tool: ${annotation.annotationType}`,
        ].join("\n"),
      });
      const createdItem = result.workspace.worksheets
        .flatMap((worksheet) => worksheet.items)
        .find((item) => !previousItemIds.has(item.id));
      if (createdItem) {
        await createTakeoffLink(projectId, {
          annotationId: annotation.id,
          worksheetItemId: createdItem.id,
          quantityField: "quantity",
          multiplier: 1,
        });
      }
      setStatus({ tone: "success", message: `Created estimate line in ${targetWorksheet.name}.` });
      onWorkspaceMutated?.();
    } catch (err) {
      setStatus({ tone: "danger", message: err instanceof Error ? err.message : "Could not create estimate line." });
    } finally {
      setCreatingAnnotationId(null);
    }
  }

  const layerOptions = documents.map((document) => ({ value: document.id, label: document.label }));
  const visibleEntityCount = filteredEntities.length;
  const totalMeasured = annotations.reduce((sum, annotation) => sum + (annotation.measurement?.value ?? 0), 0);
  const selectedMeasurement = selectedEntity ? measureEntity(selectedEntity, calibration) : null;

  if (documents.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-bg/30 p-6">
        <EmptyState className="max-w-xl border-none">
          <Layers className="mx-auto mb-3 h-10 w-10 text-fg/20" />
          <p className="text-sm font-semibold text-fg/70">No DWG or DXF drawings are available</p>
          <p className="mt-1 text-xs text-fg/40">
            Upload DWG/DXF drawings in Documents. DXF renders directly; binary DWG files need conversion before browser takeoff.
          </p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <div className="w-72">
          <Select
            value={activeDocument?.id ?? ""}
            onValueChange={(value) => {
              setDocumentId(value);
              onSelectedDocumentChange?.(value);
            }}
            options={layerOptions}
            size="sm"
          />
        </div>

        {layoutOptions.length > 1 && (
          <div className="w-44">
            <Select
              value={selectedLayout}
              onValueChange={(value) => {
                setSelectedLayout(value);
                const nextEntities = value === "__all__"
                  ? entities
                  : entities.filter((entity) => (entity.layoutName || "Model") === value);
                setVisibleLayers(new Set(buildLayers(nextEntities).map((layer) => layer.name)));
                window.requestAnimationFrame(() => fitToEntities(nextEntities));
              }}
              options={[
                { value: "__all__", label: "All layouts" },
                ...layoutOptions.map((name) => ({ value: name, label: name })),
              ]}
              size="sm"
            />
          </div>
        )}

        <div className="flex items-center rounded-lg border border-line bg-bg/45 p-0.5">
          {TOOL_OPTIONS.map(({ id, label, icon: Icon, shortcut }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setActiveTool(id);
                setDrawPoints([]);
              }}
              title={shortcut ? `${label} (${shortcut})` : label}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                activeTool === id ? "bg-panel2 text-accent shadow-sm" : "text-fg/45 hover:bg-panel2/60 hover:text-fg/75",
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-line bg-bg/45 px-2 py-1">
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setActiveColor(color)}
              className={cn("h-5 w-5 rounded-full border-2", activeColor === color ? "border-fg scale-110" : "border-transparent")}
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>

        <Separator className="!h-6 !w-px" />
        <Button variant="ghost" size="xs" onClick={() => updateViewport({ ...viewportRef.current, scale: viewportRef.current.scale * 1.2 })}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="xs" onClick={() => updateViewport({ ...viewportRef.current, scale: viewportRef.current.scale * 0.8 })}>
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="xs" onClick={() => fitToEntities()}>
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="xs" onClick={() => void loadDrawingMetadata(true)} title="Reprocess DWG/DXF metadata">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button variant={snapEnabled ? "secondary" : "ghost"} size="xs" onClick={() => setSnapEnabled((value) => !value)} title="Toggle entity snap">
          <Crosshair className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="xs" onClick={() => void undoLastAction()} disabled={!canUndo} title="Undo takeoff edit">
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="xs" onClick={() => void redoLastAction()} disabled={!canRedo} title="Redo takeoff edit">
          <Redo2 className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="xs" onClick={() => void reloadAnnotations()} title="Reload annotations">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="secondary" size="xs" onClick={() => exportAnnotationsCsv(activeDocument?.fileName ?? "dwg", annotations)} disabled={annotations.length === 0}>
          <Download className="h-3.5 w-3.5" />
          CSV
        </Button>

        <div className="flex-1" />

        <Badge tone={calibration ? "success" : "warning"} className="text-[10px]">
          {calibration ? `Scale ${formatNumber(calibration.unitsPerWorld, 4)} ${calibration.unit}/du` : "Uncalibrated"}
        </Badge>
        <Badge tone="info" className="text-[10px]">
          {visibleEntityCount} entities
        </Badge>
        <Badge tone={metadata?.status === "processed" ? "success" : "warning"} className="text-[10px]">
          {metadata?.versions?.length ?? 0} versions
        </Badge>
        <Badge tone="default" className="text-[10px]">
          {annotations.length} measurements
        </Badge>
      </div>

      {status && (
        <div className={cn(
          "flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs",
          status.tone === "danger" ? "border-danger/20 bg-danger/5 text-danger" : status.tone === "success" ? "border-success/20 bg-success/5 text-success" : "border-accent/20 bg-accent/5 text-accent",
        )}>
          {status.tone === "success" ? <Check className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
          <span className="truncate">{status.message}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 bg-[#101522]">
          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#101522]/80 text-fg/60">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-accent" />
              Loading DWG/DXF entities...
            </div>
          )}
          {error && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#101522] p-6">
              <div className="max-w-lg rounded-lg border border-warning/25 bg-panel px-5 py-4 text-center">
                <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-warning" />
                <p className="text-sm font-semibold text-fg">DWG/DXF viewer could not open this drawing</p>
                <p className="mt-1 text-xs text-fg/50">{error}</p>
              </div>
            </div>
          )}
          <div
            ref={containerRef}
            className={cn("h-full w-full", activeTool === "pan" ? "cursor-grab" : activeTool === "select" ? "cursor-default" : "cursor-crosshair")}
            onClick={(event) => void handleCanvasClick(event)}
            onDoubleClick={() => void handleCanvasDoubleClick()}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={(event) => void handleMouseUp(event)}
            onMouseLeave={() => {
              setCursorWorld(null);
              setSnapCandidate(null);
            }}
            onWheel={handleWheel as any}
          >
            <canvas ref={canvasRef} className="block h-full w-full" />
          </div>
        </div>

        <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-panel">
          <div className="border-b border-line p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-fg/30" />
              <Input
                value={entitySearch}
                onChange={(event) => setEntitySearch(event.target.value)}
                placeholder="Filter entities, layers, text..."
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-fg">Layers</h3>
                <div className="flex items-center gap-1 text-[11px]">
                  <button className="text-fg/45 hover:text-fg" onClick={() => setVisibleLayers(new Set(layers.map((layer) => layer.name)))}>All on</button>
                  <span className="text-fg/25">/</span>
                  <button className="text-fg/45 hover:text-fg" onClick={() => setVisibleLayers(new Set())}>All off</button>
                </div>
              </div>
              <Input
                value={layerSearch}
                onChange={(event) => setLayerSearch(event.target.value)}
                placeholder="Filter layers"
                className="h-7 text-xs"
              />
              <div className="max-h-52 space-y-1 overflow-auto">
                {filteredLayers.map((layer) => {
                  const visible = visibleLayers.has(layer.name);
                  return (
                    <button
                      key={layer.name}
                      type="button"
                      onClick={() => {
                        setVisibleLayers((current) => {
                          const next = new Set(current);
                          if (next.has(layer.name)) next.delete(layer.name);
                          else next.add(layer.name);
                          return next;
                        });
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-fg/65 hover:bg-panel2"
                    >
                      {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-fg/30" />}
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: layer.color }} />
                      <span className="min-w-0 flex-1 truncate">{layer.name}</span>
                      <span className="font-mono text-[10px] text-fg/35">{layer.count}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <Separator className="my-4" />

            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-fg">Selected Entity</h3>
              {selectedEntity ? (
                <div className="rounded-lg border border-line bg-bg/35 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-fg">{selectedEntity.type}</span>
                    <Badge tone="default" className="text-[10px]">{selectedEntity.layer}</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-fg/55">
                    <span>ID</span>
                    <span className="truncate text-right font-mono">{selectedEntity.id}</span>
                    <span>Layout</span>
                    <span className="truncate text-right font-mono">{selectedEntity.layoutName || "Model"}</span>
                    {selectedMeasurement && (
                      <>
                        <span>{selectedMeasurement.label}</span>
                        <span className="text-right font-mono">
                          {formatNumber(selectedMeasurement.value)} {selectedMeasurement.unit}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-line bg-bg/30 px-3 py-2 text-xs text-fg/40">
                  Use Select to inspect an entity and confirm its layer, type, and computed quantity.
                </p>
              )}
            </section>

            <Separator className="my-4" />

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-fg">Entity Groups</h3>
                <span className="text-[10px] text-fg/35">{entityGroups.length} rollups</span>
              </div>
              <div className="space-y-1">
                {entityGroups.length === 0 ? (
                  <p className="rounded-lg border border-line bg-bg/30 px-3 py-2 text-xs text-fg/40">
                    Turn layers on to aggregate visible CAD entities by layer and type.
                  </p>
                ) : entityGroups.map((group) => (
                  <div key={group.key} className="rounded-md border border-line bg-bg/30 px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-fg/65">{group.key}</span>
                      <span className="font-mono text-[10px] text-fg/35">x{group.count}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 font-mono text-[10px] text-fg/45">
                      {group.length > 0 && <span>{formatNumber(group.length)} {group.unit}</span>}
                      {group.area > 0 && <span>{formatNumber(group.area)} {group.unit}2</span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <Separator className="my-4" />

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-fg">Measurement Ledger</h3>
                <span className="text-[10px] text-fg/35">Total {formatNumber(totalMeasured)}</span>
              </div>
              {annotationGroups.length > 0 && (
                <div className="grid gap-1">
                  {annotationGroups.map((group) => (
                    <div key={group.key} className="flex items-center gap-2 rounded-md bg-panel2/40 px-2 py-1 text-[11px]">
                      <span className="min-w-0 flex-1 truncate text-fg/55">{group.label}</span>
                      <span className="font-mono text-fg/35">x{group.count}</span>
                      <span className="font-mono text-emerald-400/80">
                        {group.totals.length > 0
                          ? group.totals.map((total) => `${formatNumber(total.value)} ${total.unit}`).join(" · ")
                          : "notes"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-1.5">
                {annotations.length === 0 ? (
                  <p className="rounded-lg border border-line bg-bg/30 px-3 py-2 text-xs text-fg/40">
                    Draw a distance, area, rectangle, count, or text note to build the DWG takeoff ledger.
                  </p>
                ) : (
                  annotations.map((annotation) => (
                    <div key={annotation.id} className="rounded-lg border border-line bg-bg/35 p-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-1 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: annotation.color }} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-fg/75">{annotation.label || annotation.annotationType}</p>
                          <p className="font-mono text-[11px] text-fg/45">
                            {formatNumber(annotation.measurement?.value)} {annotation.measurement?.unit ?? ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void sendAnnotationToEstimate(annotation)}
                          disabled={creatingAnnotationId === annotation.id}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-fg/45 hover:bg-accent/10 hover:text-accent disabled:opacity-40"
                          title="Send to estimate"
                        >
                          {creatingAnnotationId === annotation.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteAnnotation(annotation.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-fg/35 hover:bg-danger/10 hover:text-danger"
                          title="Delete measurement"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </aside>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-3 py-1.5 text-[11px] text-fg/40">
        <span>{activeDocument?.fileName}</span>
        <span>•</span>
        <span>{TOOL_OPTIONS.find((tool) => tool.id === activeTool)?.label ?? "Select"} tool</span>
        <span>•</span>
        <span>{Math.round(viewportRef.current.scale * 100) / 100} px/du</span>
        <span>•</span>
        <span>{snapEnabled ? "snap on" : "snap off"}</span>
        {metadata?.processedAt && (
          <>
            <span>•</span>
            <span>processed {new Date(metadata.processedAt).toLocaleString()}</span>
          </>
        )}
        {cursorWorld && (
          <>
            <span>•</span>
            <span className="font-mono">X {formatNumber(cursorWorld.x)} Y {formatNumber(cursorWorld.y)}</span>
          </>
        )}
        {snapCandidate && (
          <>
            <span>•</span>
            <span className="text-emerald-400">snap {snapCandidate.kind}</span>
          </>
        )}
      </div>
    </div>
  );
}
