"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  GitBranch,
  Hand,
  Layers,
  Loader2,
  MousePointer2,
  PanelRightOpen,
  PenTool,
  RefreshCw,
  Ruler,
  Scan,
  Square,
  Tally5,
  Type,
  Undo2,
  Redo2,
  Scaling,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import {
  Button,
  EmptyState,
  Input,
} from "@/components/ui";
import {
  createTakeoffAnnotation,
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
  sourceKind?: "source_document" | "file_node";
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

type DwgToolGroupKey = "measure" | "count" | "markup";

type DwgToolDef = {
  id: DwgTool;
  label: string;
  icon: typeof MousePointer2;
  shortcut?: string;
  group?: DwgToolGroupKey;
  section?: string;
};

type DwgInspectEntityRow = {
  id: string;
  type: string;
  layer: string;
  layoutName: string;
  label: string;
  color: string;
  measurementLabel: string;
  quantity: number;
  uom: string;
  sourceEntityIds: string[];
  isLinked: boolean;
  linkCount: number;
};

type DwgInspectAutoCountRow = {
  id: string;
  label: string;
  type: string;
  layer: string;
  count: number;
  sourceEntityIds: string[];
  isLinked: boolean;
  linkCount: number;
};

type DwgInspectSystemRow = {
  id: string;
  label: string;
  layer: string;
  segmentCount: number;
  quantity: number;
  uom: string;
  sourceEntityIds: string[];
  isLinked: boolean;
  linkCount: number;
};

const TOOL_OPTIONS: DwgToolDef[] = [
  { id: "select", label: "Select", icon: MousePointer2, shortcut: "V" },
  { id: "pan", label: "Pan", icon: Hand, shortcut: "H" },
  { id: "calibrate", label: "Set Scale", icon: Scaling, shortcut: "K", group: "measure", section: "Scale" },
  { id: "distance", label: "Distance", icon: Ruler, shortcut: "D", group: "measure", section: "Length" },
  { id: "area", label: "Polygon Area", icon: PenTool, shortcut: "A", group: "measure", section: "Area" },
  { id: "rectangle", label: "Rectangle Area", icon: Square, shortcut: "R", group: "measure", section: "Area" },
  { id: "count", label: "Count", icon: Tally5, shortcut: "C", group: "count", section: "Manual" },
  { id: "text", label: "Text", icon: Type, shortcut: "T", group: "markup", section: "Text" },
];

const DWG_TOOL_MENU_GROUPS: ReadonlyArray<{ key: DwgToolGroupKey; label: string; icon: typeof Ruler }> = [
  { key: "measure", label: "Measure", icon: Ruler },
  { key: "count", label: "Count", icon: Tally5 },
  { key: "markup", label: "Markup", icon: Type },
];

function DwgToolGroupMenus({
  activeTool,
  onSelect,
}: {
  activeTool: DwgTool;
  onSelect: (tool: DwgTool) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      {DWG_TOOL_MENU_GROUPS.map((group) => {
        const tools = TOOL_OPTIONS.filter((tool) => tool.group === group.key);
        const active = tools.find((tool) => tool.id === activeTool);
        const Icon = active?.icon ?? group.icon;
        return (
          <Popover.Root key={group.key}>
            <Popover.Trigger asChild>
              <Button
                variant={active ? "secondary" : "ghost"}
                size="xs"
                className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
                title={`${group.label} tools`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{group.label}</span>
                <ChevronDown className="h-3 w-3 text-fg/40" />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="start"
                sideOffset={6}
                className="z-[1000] max-h-[min(70vh,28rem)] w-60 overflow-y-auto rounded-lg border border-line bg-panel p-1.5 shadow-xl outline-none"
              >
                {tools.map((tool, index) => {
                  const ToolIcon = tool.icon;
                  const previousSection = index > 0 ? tools[index - 1]?.section : undefined;
                  const showSection = Boolean(tool.section && tool.section !== previousSection);
                  return (
                    <div key={tool.id}>
                      {showSection && (
                        <p className={cn("px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-fg/35", index > 0 && "pt-2")}>
                          {tool.section}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => onSelect(tool.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                          activeTool === tool.id ? "bg-accent/10 text-accent" : "text-fg/70 hover:bg-panel2 hover:text-fg",
                        )}
                      >
                        <ToolIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{tool.label}</span>
                        {tool.shortcut && <span className="font-mono text-[10px] text-fg/35">{tool.shortcut}</span>}
                      </button>
                    </div>
                  );
                })}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        );
      })}
    </div>
  );
}

function DwgAiMenu({
  entityCount,
  layerCount,
  autoCountGroupCount,
  systemCount,
  onOpenDrawingIntelligence,
}: {
  entityCount: number;
  layerCount: number;
  autoCountGroupCount: number;
  systemCount: number;
  onOpenDrawingIntelligence?: () => void;
}) {
  const rows = [
    {
      label: "Drawing Intelligence",
      description: `${entityCount.toLocaleString()} entities · ${layerCount.toLocaleString()} layers`,
      icon: GitBranch,
      color: "text-sky-500",
    },
    {
      label: "Auto Count",
      description: `${autoCountGroupCount.toLocaleString()} symbol groups`,
      icon: Tally5,
      color: "text-emerald-500",
    },
    {
      label: "Trace Systems",
      description: `${systemCount.toLocaleString()} traced runs`,
      icon: Sparkles,
      color: "text-violet-500",
    },
  ];

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
          title="AI tools"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>AI</span>
          <ChevronDown className="h-3 w-3 text-fg/40" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-[1000] max-h-[min(70vh,28rem)] w-72 overflow-y-auto rounded-lg border border-line bg-panel p-1.5 shadow-xl outline-none"
        >
          {rows.map((row) => {
            const Icon = row.icon;
            return (
              <Popover.Close key={row.label} asChild>
                <button
                  type="button"
                  onClick={onOpenDrawingIntelligence}
                  disabled={!onOpenDrawingIntelligence}
                  className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-fg/70 transition-colors hover:bg-panel2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
                  title={`${row.label} results in the Entities panel`}
                >
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", row.color)} />
                  <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
                  <span className="shrink-0 text-[10px] text-fg/45">{row.description}</span>
                </button>
              </Popover.Close>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

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

function rawString(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function compactEntityLabel(entity: DwgEntity): string {
  const text = entity.text?.replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 96);
  const symbolName = rawString(entity.raw, [
    "name",
    "blockName",
    "block",
    "symbolName",
    "insertName",
    "xref",
  ]);
  if (symbolName) return symbolName.slice(0, 96);
  return `${entity.type} on ${entity.layer}`;
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^a-z0-9_.:-]+/gi, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "item";
}

function formatDwgQuantity(value: number, uom: string): string {
  const digits = Math.abs(value) >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${formatNumber(value, digits)} ${uom}`;
}

function dwgEntityTakeoffQuantity(entity: DwgEntity, calibration: CalibrationState | null): {
  measurementLabel: string;
  quantity: number;
  uom: string;
} {
  const measurement = measureEntity(entity, calibration);
  if (!measurement || !Number.isFinite(measurement.value) || measurement.value <= 0) {
    return { measurementLabel: "1 EA", quantity: 1, uom: "EA" };
  }
  const uom = mapUom(measurement.unit);
  return {
    measurementLabel: formatDwgQuantity(measurement.value, uom),
    quantity: measurement.value,
    uom,
  };
}

function buildDwgEntityRows(entities: DwgEntity[], calibration: CalibrationState | null): DwgInspectEntityRow[] {
  return entities.map((entity) => {
    const quantity = dwgEntityTakeoffQuantity(entity, calibration);
    return {
      id: entity.id,
      type: entity.type,
      layer: entity.layer,
      layoutName: entity.layoutName || "Model",
      label: compactEntityLabel(entity),
      color: entity.color,
      measurementLabel: quantity.measurementLabel,
      quantity: quantity.quantity,
      uom: quantity.uom,
      sourceEntityIds: [entity.id],
      isLinked: false,
      linkCount: 0,
    };
  });
}

function countGroupKey(entity: DwgEntity): string | null {
  if (entity.type === "INSERT") {
    return ["INSERT", entity.layer, rawString(entity.raw, ["name", "blockName", "block", "symbolName", "insertName"]) ?? "Block"].join("|");
  }
  if (entity.type === "CIRCLE") {
    const radius = Number.isFinite(entity.radius) ? Number(entity.radius).toFixed(3) : "unknown";
    return ["CIRCLE", entity.layer, radius].join("|");
  }
  if (entity.type === "ARC") {
    const radius = Number.isFinite(entity.radius) ? Number(entity.radius).toFixed(3) : "unknown";
    return ["ARC", entity.layer, radius].join("|");
  }
  if (entity.type === "POINT") {
    return ["POINT", entity.layer, "Point"].join("|");
  }
  if (entity.type === "TEXT" || entity.type === "MTEXT") {
    const text = entity.text?.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!text) return null;
    return [entity.type, entity.layer, text].join("|");
  }
  return null;
}

function countGroupLabel(type: string, layer: string, token: string): string {
  if (type === "INSERT") return token;
  if (type === "CIRCLE") return `Circle symbol r ${token}`;
  if (type === "ARC") return `Arc symbol r ${token}`;
  if (type === "POINT") return `Point mark on ${layer}`;
  if (type === "TEXT" || type === "MTEXT") return `Text: ${token}`;
  return `${type} on ${layer}`;
}

function buildDwgAutoCountRows(entities: DwgEntity[]): DwgInspectAutoCountRow[] {
  const groups = new Map<string, { type: string; layer: string; token: string; ids: string[] }>();
  for (const entity of entities) {
    const key = countGroupKey(entity);
    if (!key) continue;
    const parts = key.split("|");
    const type = parts[0] ?? entity.type;
    const layer = parts[1] ?? entity.layer;
    const token = parts.slice(2).join("|") || compactEntityLabel(entity);
    const group = groups.get(key);
    if (group) {
      group.ids.push(entity.id);
    } else {
      groups.set(key, { type, layer, token, ids: [entity.id] });
    }
  }
  return Array.from(groups.entries())
    .map(([key, group]) => ({
      id: `count:${sanitizeIdPart(key)}`,
      label: countGroupLabel(group.type, group.layer, group.token),
      type: group.type,
      layer: group.layer,
      count: group.ids.length,
      sourceEntityIds: group.ids,
      isLinked: false,
      linkCount: 0,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function isLinearDwgEntity(entity: DwgEntity): boolean {
  if (entity.type === "LINE") return Boolean(entity.start && entity.end);
  if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
    return Boolean(entity.vertices && entity.vertices.length >= 2 && !entity.closed);
  }
  return false;
}

function linearEndpointKeys(entity: DwgEntity): string[] {
  const points: DwgPoint[] = [];
  if (entity.type === "LINE" && entity.start && entity.end) {
    points.push(entity.start, entity.end);
  } else if ((entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") && entity.vertices?.length) {
    points.push(entity.vertices[0], entity.vertices[entity.vertices.length - 1]);
  }
  return points.map((point) => `${Math.round(point.x * 100) / 100}:${Math.round(point.y * 100) / 100}`);
}

function likelySystemLayer(layer: string): boolean {
  const value = layer.toLowerCase();
  return [
    "pipe",
    "piping",
    "plumb",
    "water",
    "gas",
    "san",
    "storm",
    "drain",
    "fire",
    "sprink",
    "duct",
    "conduit",
    "elec",
    "main",
    "system",
  ].some((needle) => value.includes(needle));
}

function buildDwgSystemRows(entities: DwgEntity[], calibration: CalibrationState | null): DwgInspectSystemRow[] {
  const byLayer = new Map<string, DwgEntity[]>();
  for (const entity of entities) {
    if (!isLinearDwgEntity(entity)) continue;
    const current = byLayer.get(entity.layer);
    if (current) current.push(entity);
    else byLayer.set(entity.layer, [entity]);
  }

  const rows: DwgInspectSystemRow[] = [];
  for (const [layer, layerEntities] of byLayer.entries()) {
    const adjacency = new Map<string, Set<string>>();
    const pointIndex = new Map<string, string[]>();
    for (const entity of layerEntities) {
      adjacency.set(entity.id, new Set());
      for (const key of linearEndpointKeys(entity)) {
        const list = pointIndex.get(key);
        if (list) list.push(entity.id);
        else pointIndex.set(key, [entity.id]);
      }
    }

    for (const ids of pointIndex.values()) {
      if (ids.length < 2) continue;
      for (let index = 1; index < ids.length; index += 1) {
        adjacency.get(ids[0])?.add(ids[index]);
        adjacency.get(ids[index])?.add(ids[0]);
      }
    }

    const entityLookup = new Map(layerEntities.map((entity) => [entity.id, entity]));
    const visited = new Set<string>();
    let componentIndex = 0;
    for (const entity of layerEntities) {
      if (visited.has(entity.id)) continue;
      const stack = [entity.id];
      const componentIds: string[] = [];
      visited.add(entity.id);
      while (stack.length) {
        const id = stack.pop();
        if (!id) continue;
        componentIds.push(id);
        for (const neighbor of adjacency.get(id) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
      if (componentIds.length < 2 && !likelySystemLayer(layer)) continue;
      let total = 0;
      let uom = "EA";
      for (const id of componentIds) {
        const target = entityLookup.get(id);
        if (!target) continue;
        const measured = dwgEntityTakeoffQuantity(target, calibration);
        if (measured.uom !== "EA") {
          total += measured.quantity;
          uom = measured.uom;
        }
      }
      if (total <= 0) {
        total = componentIds.length;
        uom = "EA";
      }
      componentIndex += 1;
      rows.push({
        id: `system:${sanitizeIdPart(layer)}:${componentIndex}`,
        label: `${likelySystemLayer(layer) ? "System" : "Linear run"} ${componentIndex} · ${layer}`,
        layer,
        segmentCount: componentIds.length,
        quantity: total,
        uom,
        sourceEntityIds: componentIds,
        isLinked: false,
        linkCount: 0,
      });
    }
  }

  return rows.sort((a, b) => b.segmentCount - a.segmentCount || a.label.localeCompare(b.label));
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

/** Minimal annotation shape compatible with TakeoffAnnotation, published up
 *  so the unified side-panel link UI can look annotations up by id. */
export interface DwgPublishedAnnotation {
  id: string;
  type: string;
  label: string;
  color: string;
  thickness: number;
  points: { x: number; y: number }[];
  visible: boolean;
  groupName?: string;
  measurement?: { value: number; unit: string; area?: number; volume?: number };
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
  /** Notifies the parent when the user selects/deselects a CAD entity, so a
   * shared link panel can drive linking workflows. */
  onSelectedEntityChange?: (
    selection: {
      documentId: string;
      entityId: string;
      entityType?: string;
      layer?: string;
      label?: string;
      summary?: string;
    } | null,
  ) => void;
  /** Notifies the parent when the user selects/deselects a DWG measurement
   *  annotation. Selection ids match the underlying TakeoffAnnotation rows so
   *  the unified link panel can look them up just like PDF annotations. */
  onSelectedAnnotationChange?: (annotationId: string | null) => void;
  /** Mirror of the current DWG annotation array (in TakeoffAnnotation shape)
   *  so a parent can merge with PDF annotations and feed the side-panel cache. */
  onAnnotationsChange?: (annotations: DwgPublishedAnnotation[]) => void;
  /** A ref the parent populates so it can dispatch annotation actions
   *  (delete, etc.) to this surface from the unified Inspect view. */
  actionsRef?: React.MutableRefObject<{
    deleteAnnotation: (id: string) => Promise<void> | void;
    selectEntity: (id: string | null) => void;
    selectEntities: (ids: string[]) => void;
  } | null>;
  /** Slots from the parent takeoff shell so DWG uses one unified header. */
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
  onOpenDrawingIntelligence?: () => void;
  onIntelligenceChange?: (snapshot: {
    documentId: string;
    fileName: string;
    selectedLayout: string;
    entityCount: number;
    visibleEntityCount: number;
    layerCount: number;
    annotationCount: number;
    layouts: { name: string; entityCount: number }[];
    layers: { name: string; color: string; count: number; visible: boolean }[];
    status: string | null;
    processedAt: string | null;
    selectedEntityId: string | null;
    savingEntityId: string | null;
    entities: DwgInspectEntityRow[];
    autoCounts: DwgInspectAutoCountRow[];
    systems: DwgInspectSystemRow[];
  } | null) => void;
}

export function DwgTakeoffSurface({
  projectId,
  documents,
  selectedDocumentId,
  onSelectedDocumentChange,
  onSelectedEntityChange,
  onSelectedAnnotationChange,
  onAnnotationsChange,
  actionsRef,
  toolbarStart,
  toolbarEnd,
  onOpenDrawingIntelligence,
  onIntelligenceChange,
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
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(() => new Set());
  const [selectedLayout, setSelectedLayout] = useState<string>("__all__");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [highlightedEntityIds, setHighlightedEntityIds] = useState<Set<string>>(() => new Set());

  // Publish entity selection to parent so the shared link panel can render it.
  // Effect lives further down so it can read `selectedEntity` once that memo is set up.

  const [activeTool, setActiveTool] = useState<DwgTool>("select");
  const [activeColor, setActiveColor] = useState(PRESET_COLORS[0]);
  const [drawPoints, setDrawPoints] = useState<DwgPoint[]>([]);
  const [cursorWorld, setCursorWorld] = useState<DwgPoint | null>(null);
  const [snapCandidate, setSnapCandidate] = useState<SnapCandidate | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [layerSearch, setLayerSearch] = useState("");
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const [status, setStatus] = useState<{ tone: "success" | "danger" | "info"; message: string } | null>(null);

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

  // Publish DWG annotations to the parent in a TakeoffAnnotation-compatible shape so the
  // unified annotation link UI can look them up identically to PDF annotations.
  useEffect(() => {
    if (!onAnnotationsChange) return;
    onAnnotationsChange(
      annotations.map((a) => ({
        id: a.id,
        type: a.annotationType,
        label: a.label,
        color: a.color,
        thickness: 2,
        points: a.points.map((p) => ({ x: p.x, y: p.y })),
        visible: true,
        groupName: a.groupName,
        measurement: a.measurement && a.measurement.value !== undefined && a.measurement.unit
          ? { value: a.measurement.value, unit: a.measurement.unit }
          : undefined,
      })),
    );
  }, [annotations, onAnnotationsChange]);

  // Publish DWG annotation selection to the parent.
  useEffect(() => {
    onSelectedAnnotationChange?.(selectedAnnotationId);
  }, [selectedAnnotationId, onSelectedAnnotationChange]);

  // Publish action dispatchers to the parent each render so the Inspect tab
  // can drive deletions (and future actions) on DWG annotations.
  useEffect(() => {
    if (actionsRef) {
      actionsRef.current = {
        deleteAnnotation,
        selectEntity: selectEntityById,
        selectEntities: selectEntitiesByIds,
      };
    }
  });

  // External annotation selection (from the side-panel inspector list) →
  // mirror into the local selectedAnnotationId so the in-canvas highlight stays
  // in sync.

  // Publish entity selection to parent so the shared link panel can render it.
  //
  // Dedup via a JSON-signature ref so the publish only runs when the payload
  // actually changes. Without this, the parent's takeoff-tab inlines
  // `onSelectedEntityChange` in its JSX, so its callback identity churns on
  // every render — and that re-fired this effect, which dispatched a fresh
  // object literal back upstream, which re-rendered, which produced a fresh
  // callback identity again. Clicking any DWG entity blew up the React update
  // depth instantly.
  const lastEntitySelectionSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!onSelectedEntityChange) return;
    if (selectedEntity && selectedDocumentId) {
      const measurement = measureEntity(selectedEntity, calibration);
      const summary = measurement
        ? `${measurement.value.toFixed(2)} ${measurement.unit}`
        : selectedEntity.text || undefined;
      const signature = JSON.stringify({
        documentId: selectedDocumentId,
        entityId: selectedEntity.id,
        entityType: selectedEntity.type,
        layer: selectedEntity.layer,
        summary,
      });
      if (signature === lastEntitySelectionSignatureRef.current) return;
      lastEntitySelectionSignatureRef.current = signature;
      onSelectedEntityChange({
        documentId: selectedDocumentId,
        entityId: selectedEntity.id,
        entityType: selectedEntity.type,
        layer: selectedEntity.layer,
        label: selectedEntity.text || `${selectedEntity.type} on ${selectedEntity.layer}`,
        summary,
      });
    } else if (lastEntitySelectionSignatureRef.current !== null) {
      lastEntitySelectionSignatureRef.current = null;
      onSelectedEntityChange(null);
    }
  }, [selectedEntity, selectedDocumentId, calibration, onSelectedEntityChange]);

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
    return layoutEntities.filter((entity) => visibleLayers.has(entity.layer));
  }, [layoutEntities, visibleLayers]);
  const inspectEntityRows = useMemo(
    () => buildDwgEntityRows(filteredEntities, calibration),
    [filteredEntities, calibration],
  );
  const inspectAutoCountRows = useMemo(
    () => buildDwgAutoCountRows(filteredEntities),
    [filteredEntities],
  );
  const inspectSystemRows = useMemo(
    () => buildDwgSystemRows(filteredEntities, calibration),
    [filteredEntities, calibration],
  );
  const canUndo = historyVersion >= 0 && undoStackRef.current.length > 0;
  const canRedo = historyVersion >= 0 && redoStackRef.current.length > 0;
  const lastIntelligenceSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!onIntelligenceChange) return;
    if (!activeDocument) {
      if (lastIntelligenceSignatureRef.current !== null) {
        lastIntelligenceSignatureRef.current = null;
        onIntelligenceChange(null);
      }
      return;
    }
    const snapshot = {
      documentId: activeDocument.id,
      fileName: activeDocument.fileName,
      selectedLayout,
      entityCount: layoutEntities.length,
      visibleEntityCount: filteredEntities.length,
      layerCount: layers.length,
      annotationCount: annotations.length,
      layouts: (metadata?.layouts ?? []).map((layout) => ({
        name: layout.name || "Model",
        entityCount: layout.entityCount ?? 0,
      })),
      layers: layers.map((layer) => ({
        name: layer.name,
        color: layer.color,
        count: layer.count,
        visible: visibleLayers.has(layer.name),
      })),
      status: metadata?.status ?? null,
      processedAt: metadata?.processedAt ?? null,
      selectedEntityId,
      savingEntityId: null,
      entities: inspectEntityRows,
      autoCounts: inspectAutoCountRows,
      systems: inspectSystemRows,
    };
    const signature = JSON.stringify({
      documentId: snapshot.documentId,
      selectedLayout,
      selectedEntityId,
      entityCount: snapshot.entityCount,
      visibleEntityCount: snapshot.visibleEntityCount,
      layerState: snapshot.layers.map((layer) => `${layer.name}:${layer.visible}:${layer.count}`).join(","),
      annotationCount: snapshot.annotationCount,
      autoCountGroupCount: inspectAutoCountRows.length,
      systemCount: inspectSystemRows.length,
      calibration: calibration ? `${calibration.unitsPerWorld}:${calibration.unit}` : "none",
      status: snapshot.status,
      processedAt: snapshot.processedAt,
    });
    if (signature === lastIntelligenceSignatureRef.current) return;
    lastIntelligenceSignatureRef.current = signature;
    onIntelligenceChange(snapshot);
  }, [
    activeDocument?.fileName,
    activeDocument?.id,
    annotations.length,
    calibration,
    filteredEntities.length,
    inspectAutoCountRows,
    inspectEntityRows,
    inspectSystemRows,
    layers,
    layoutEntities.length,
    metadata?.layouts,
    metadata?.processedAt,
    metadata?.status,
    onIntelligenceChange,
    selectedEntityId,
    selectedLayout,
    visibleLayers,
  ]);

  function selectDwgTool(tool: DwgTool) {
    setActiveTool(tool);
    setDrawPoints([]);
  }

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

  function selectEntityById(id: string | null) {
    if (!id) {
      setSelectedEntityId(null);
      setHighlightedEntityIds(new Set());
      return;
    }
    const entity = entities.find((candidate) => candidate.id === id);
    if (!entity) return;
    if (!visibleLayers.has(entity.layer)) {
      setVisibleLayers((current) => new Set(current).add(entity.layer));
    }
    const entityLayout = entity.layoutName || "Model";
    if (selectedLayout !== "__all__" && selectedLayout !== entityLayout) {
      setSelectedLayout(entityLayout);
    }
    setSelectedEntityId(id);
    setHighlightedEntityIds(new Set([id]));
    window.requestAnimationFrame(() => fitToEntities([entity]));
  }

  function selectEntitiesByIds(ids: string[]) {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) {
      selectEntityById(null);
      return;
    }
    const targets = uniqueIds
      .map((id) => entities.find((candidate) => candidate.id === id))
      .filter((entity): entity is DwgEntity => Boolean(entity));
    if (targets.length === 0) return;
    setSelectedEntityId(targets[0].id);
    setHighlightedEntityIds(new Set(targets.map((entity) => entity.id)));
    setVisibleLayers((current) => {
      const next = new Set(current);
      targets.forEach((entity) => next.add(entity.layer));
      return next;
    });
    const layouts = new Set(targets.map((entity) => entity.layoutName || "Model"));
    if (selectedLayout !== "__all__") {
      if (layouts.size === 1 && !layouts.has(selectedLayout)) {
        setSelectedLayout(Array.from(layouts)[0]);
      } else if (layouts.size > 1) {
        setSelectedLayout("__all__");
      }
    }
    window.requestAnimationFrame(() => fitToEntities(targets));
  }

  // Track id + sourceKind as primitives so callback identity is stable when
  // the parent re-maps the `documents` prop on every render (which it does —
  // takeoff-tab .map()s into a fresh array each time). Using `activeDocument`
  // itself in the deps array previously caused these callbacks (and the
  // loading effect that depends on them) to re-fire every render, looping
  // "Loading…" → flash error → "Loading…" forever.
  const activeDocumentId = activeDocument?.id;
  const activeDocumentSourceKind = activeDocument?.sourceKind;

  const reloadAnnotations = useCallback(async () => {
    if (!activeDocumentId) {
      setAnnotations([]);
      return;
    }
    const rows = await listTakeoffAnnotations(projectId, activeDocumentId, 1);
    setAnnotations(rows.map(apiAnnotationToDwg).filter((annotation) => annotation.metadata?.surface === "dwg-takeoff" || annotation.metadata?.source === "dwg-takeoff"));
  }, [activeDocumentId, projectId]);

  const loadDrawingMetadata = useCallback(async (refresh = false) => {
    if (!activeDocumentId) return;
    setLoading(true);
    setError(null);
    setSelectedEntityId(null);
    setHighlightedEntityIds(new Set());
    setDrawPoints([]);
    setSnapCandidate(null);
    try {
      const result = refresh
        ? await processDwgTakeoffMetadata(projectId, activeDocumentId, activeDocumentSourceKind)
        : await getDwgTakeoffMetadata(projectId, activeDocumentId, false, activeDocumentSourceKind);
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
  }, [activeDocumentId, activeDocumentSourceKind, fitToEntities, projectId]);

  useEffect(() => {
    if (!activeDocumentId) return;
    const stored = window.localStorage.getItem(calibrationStorageKey(projectId, activeDocumentId));
    setCalibration(stored ? JSON.parse(stored) as CalibrationState : null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    updateHistoryVersion();
    void loadDrawingMetadata();
    void reloadAnnotations().catch(() => setAnnotations([]));
  }, [activeDocumentId, loadDrawingMetadata, projectId, reloadAnnotations]);

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
      const highlighted = entity.id === selectedEntityId || highlightedEntityIds.has(entity.id);
      ctx.strokeStyle = highlighted ? "#38bdf8" : entity.color;
      ctx.fillStyle = highlighted ? "#38bdf8" : entity.color;
      ctx.lineWidth = highlighted ? 2.5 : 1;
      ctx.shadowColor = highlighted ? "rgba(56, 189, 248, 0.35)" : "transparent";
      ctx.shadowBlur = highlighted ? 9 : 0;

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
  }, [activeColor, activeTool, annotations, cursorWorld, drawPoints, filteredEntities, highlightedEntityIds, selectedEntityId, snapCandidate, viewportVersion]);

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
      const hit = hitTest(event);
      setSelectedEntityId(hit?.id ?? null);
      setHighlightedEntityIds(hit ? new Set([hit.id]) : new Set());
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
    <div className="flex h-full w-full min-h-0 flex-col bg-panel">
      <div className="grid min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 overflow-hidden border-b border-line bg-panel px-1.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1">
          {toolbarStart}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => updateViewport({ ...viewportRef.current, scale: viewportRef.current.scale * 0.8 })}
            title="Zoom out"
            aria-label="Zoom out"
            className="h-7 w-7 shrink-0 px-0"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => updateViewport({ ...viewportRef.current, scale: viewportRef.current.scale * 1.2 })}
            title="Zoom in"
            aria-label="Zoom in"
            className="h-7 w-7 shrink-0 px-0"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => fitToEntities()}
            title="Fit drawing"
            aria-label="Fit drawing"
            className="h-7 w-7 shrink-0 px-0"
          >
            <Scan className="h-3.5 w-3.5" />
          </Button>
          <span className="hidden min-w-0 truncate px-1 text-[11px] font-medium text-fg/45 md:block">
            {activeDocument?.fileName ?? "DWG/DXF"}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-1 rounded-md border border-line bg-bg/35 p-0.5">
          <DwgToolGroupMenus activeTool={activeTool} onSelect={selectDwgTool} />
          <DwgAiMenu
            entityCount={layoutEntities.length}
            layerCount={layers.length}
            autoCountGroupCount={inspectAutoCountRows.length}
            systemCount={inspectSystemRows.length}
            onOpenDrawingIntelligence={onOpenDrawingIntelligence}
          />
        </div>

        <div className="flex min-w-0 items-center justify-end gap-1">
          {status && (
            <span
              className={cn(
                "hidden max-w-56 truncate rounded-md border px-2 py-1 text-[10px] font-medium lg:inline-flex",
                status.tone === "danger"
                  ? "border-danger/25 bg-danger/10 text-danger"
                  : status.tone === "success"
                    ? "border-success/25 bg-success/10 text-success"
                    : "border-accent/25 bg-accent/10 text-accent",
              )}
              title={status.message}
            >
              {status.message}
            </span>
          )}
          {calibration && (
            <span className="hidden shrink-0 rounded-md border border-line bg-bg/35 px-2 py-1 text-[10px] font-medium text-fg/50 md:inline-flex">
              Scale {formatNumber(calibration.unitsPerWorld, 4)} {calibration.unit}/du
            </span>
          )}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void undoLastAction()}
            disabled={!canUndo}
            title="Undo takeoff edit"
            aria-label="Undo takeoff edit"
            className="h-7 w-7 shrink-0 px-0"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void redoLastAction()}
            disabled={!canRedo}
            title="Redo takeoff edit"
            aria-label="Redo takeoff edit"
            className="h-7 w-7 shrink-0 px-0"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void reloadAnnotations()}
            title="Reload annotations"
            aria-label="Reload annotations"
            className="h-7 w-7 shrink-0 px-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => exportAnnotationsCsv(activeDocument?.fileName ?? "dwg", annotations)}
            disabled={annotations.length === 0}
            title="Export measurements CSV"
            aria-label="Export measurements CSV"
            className="h-7 w-7 shrink-0 px-0"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          {toolbarEnd}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-9 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-line bg-panel p-0.5">
          {TOOL_OPTIONS.filter((tool) => tool.id === "select" || tool.id === "pan").map(({ id, label, icon: Icon, shortcut }) => (
            <button
              key={id}
              type="button"
              onClick={() => selectDwgTool(id)}
              title={shortcut ? `${label} (${shortcut})` : label}
              aria-label={label}
              className={cn(
                "flex h-7 w-full items-center justify-center rounded-md transition-colors",
                activeTool === id ? "bg-accent/15 text-accent" : "text-fg/40 hover:bg-panel2 hover:text-fg/70",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}

          <div className="my-px h-px w-full bg-line/60" />

          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                type="button"
                title="Annotation color"
                aria-label="Annotation color"
                className="flex h-7 w-full items-center justify-center rounded-md text-fg/50 transition-colors hover:bg-panel2 hover:text-fg/75"
              >
                <span className="h-3.5 w-3.5 rounded-full border border-white/60" style={{ backgroundColor: activeColor }} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="start" sideOffset={6} className="z-[100] rounded-lg border border-line bg-panel p-2 shadow-xl outline-none">
                <div className="grid grid-cols-6 gap-1">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setActiveColor(color)}
                      className={cn("h-6 w-6 rounded-full border-2", activeColor === color ? "border-fg scale-110" : "border-transparent")}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          {layoutOptions.length > 1 && (
            <Popover.Root>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  title="Layout"
                  aria-label="Layout"
                  className="flex h-7 w-full items-center justify-center rounded-md text-fg/40 transition-colors hover:bg-panel2 hover:text-fg/70"
                >
                  <PanelRightOpen className="h-3.5 w-3.5" />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content align="start" sideOffset={6} className="z-[100] w-52 rounded-lg border border-line bg-panel p-2 shadow-xl outline-none">
                  <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wider text-fg/40">Layout</p>
                  {[
                    { value: "__all__", label: "All layouts" },
                    ...layoutOptions.map((name) => ({ value: name, label: name })),
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setSelectedLayout(option.value);
                        const nextEntities = option.value === "__all__"
                          ? entities
                          : entities.filter((entity) => (entity.layoutName || "Model") === option.value);
                        setVisibleLayers(new Set(buildLayers(nextEntities).map((layer) => layer.name)));
                        window.requestAnimationFrame(() => fitToEntities(nextEntities));
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-panel2",
                        selectedLayout === option.value ? "text-accent" : "text-fg/65",
                      )}
                    >
                      {selectedLayout === option.value && <Check className="h-3 w-3" />}
                      <span className="truncate">{option.label}</span>
                    </button>
                  ))}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}

          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                type="button"
                title={`Layers ${visibleLayers.size}/${layers.length}`}
                aria-label="Layer visibility"
                className="flex h-7 w-full items-center justify-center rounded-md text-fg/40 transition-colors hover:bg-panel2 hover:text-fg/70"
              >
                <Layers className="h-3.5 w-3.5" />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="start"
                sideOffset={6}
                className="z-[100] w-72 rounded-lg border border-line bg-panel p-3 shadow-xl outline-none"
              >
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
                  className="mt-2 h-7 text-xs"
                />
                <div className="mt-2 max-h-64 space-y-1 overflow-auto">
                  {filteredLayers.length === 0 ? (
                    <p className="rounded-md border border-line bg-bg/30 px-2 py-3 text-center text-[11px] text-fg/40">
                      No layers match.
                    </p>
                  ) : filteredLayers.map((layer) => {
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
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          <div className="my-px h-px w-full bg-line/60" />

          <button
            type="button"
            onClick={() => void loadDrawingMetadata(true)}
            title="Reprocess DWG/DXF metadata"
            aria-label="Reprocess DWG/DXF metadata"
            className="flex h-7 w-full items-center justify-center rounded-md text-fg/40 transition-colors hover:bg-panel2 hover:text-fg/70"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setSnapEnabled((value) => !value)}
            title="Toggle entity snap"
            aria-label="Toggle entity snap"
            className={cn(
              "flex h-7 w-full items-center justify-center rounded-md transition-colors",
              snapEnabled ? "bg-accent/15 text-accent" : "text-fg/40 hover:bg-panel2 hover:text-fg/70",
            )}
          >
            <Crosshair className="h-3.5 w-3.5" />
          </button>
        </div>

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
                {metadata?.status === "converter_required" && (
                  <p className="mt-3 text-[11px] leading-relaxed text-fg/45">
                    Binary DWG files need a converter to be parsed.
                    Export the drawing as <span className="font-semibold text-fg/65">DXF</span> from your CAD tool, or set
                    <span className="font-mono text-[10px] text-fg/55"> BIDWRIGHT_DWG_CONVERTER_CMD</span> on the API.
                  </p>
                )}
                <div className="mt-3 flex justify-center">
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => void loadDrawingMetadata(true)}
                    title="Reprocess this drawing"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                </div>
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
      </div>

    </div>
  );
}
