// File-tree DXF/DWG preview. This viewer is intentionally read-only — the
// takeoff workflow lives in dwg-takeoff-surface.tsx, where entities turn
// into worksheet candidates via the right-hand inspect panel. Adding
// click-to-link here would compete with that surface.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle, Layers, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { getDwgTakeoffMetadata, processDwgTakeoffMetadata, type DwgTakeoffEntity } from "@/lib/api";

interface DxfViewerProps {
  url: string;
  fileName: string;
  projectId?: string;
  sourceKind?: "source_document" | "file_node";
  sourceId?: string;
}

interface NormalizedEntity {
  type: string;
  vertices?: Array<{ x: number; y: number }>;
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
  center?: { x: number; y: number };
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  position?: { x: number; y: number };
  text?: string;
  height?: number;
  layer?: string;
  color?: string | number;
}

interface DxfData {
  entities: NormalizedEntity[];
  layerCount: number;
}

const ACI_COLORS: Record<number, string> = {
  1: "#ff0000",
  2: "#ffff00",
  3: "#00ff00",
  4: "#00ffff",
  5: "#0000ff",
  6: "#ff00ff",
  7: "#ffffff",
  8: "#808080",
  9: "#c0c0c0",
};

function resolveColor(color: string | number | undefined): string {
  if (color == null) return "#e0e0e0";
  if (typeof color === "string") {
    if (color.startsWith("#")) return color;
    const n = Number(color);
    return ACI_COLORS[n] ?? color;
  }
  return ACI_COLORS[color] ?? "#e0e0e0";
}

function getEntityColor(entity: NormalizedEntity, layerColors: Record<string, string>): string {
  if (entity.color != null) {
    const resolved = resolveColor(entity.color);
    if (resolved !== "#e0e0e0") return resolved;
  }
  if (entity.layer && layerColors[entity.layer]) return layerColors[entity.layer];
  return "#e0e0e0";
}

function computeBounds(entities: NormalizedEntity[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  function update(x: number, y: number) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  for (const e of entities) {
    if (e.startPoint) update(e.startPoint.x, e.startPoint.y);
    if (e.endPoint) update(e.endPoint.x, e.endPoint.y);
    if (e.center && e.radius != null) {
      update(e.center.x - e.radius, e.center.y - e.radius);
      update(e.center.x + e.radius, e.center.y + e.radius);
    }
    if (e.center && e.radius == null) update(e.center.x, e.center.y);
    if (e.position) update(e.position.x, e.position.y);
    if (e.vertices) {
      for (const v of e.vertices) update(v.x, v.y);
    }
  }

  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 100; maxY = 100; }
  return { minX, minY, maxX, maxY };
}

function normalizeApiEntities(apiEntities: DwgTakeoffEntity[]): NormalizedEntity[] {
  return apiEntities.map((e) => {
    const base: NormalizedEntity = {
      type: e.type,
      layer: e.layer,
      color: e.color,
    };
    if (e.start) base.startPoint = e.start;
    if (e.end) base.endPoint = e.end;
    if (e.center) base.center = e.center;
    if (e.radius != null) base.radius = e.radius;
    if (e.vertices) base.vertices = e.vertices;
    if (e.text != null) {
      base.position = e.start ?? e.center ?? e.vertices?.[0];
      base.text = e.text;
    }
    return base;
  });
}

export function DxfViewer({ url, fileName, projectId, sourceKind, sourceId }: DxfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DxfData | null>(null);

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });
  const layerColorsRef = useRef<Record<string, string>>({});

  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const isDwg = ext === "dwg";

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        if (isDwg && projectId && sourceKind && sourceId) {
          let result = await getDwgTakeoffMetadata(projectId, sourceId, false, sourceKind);
          if (result.status !== "processed") {
            result = await processDwgTakeoffMetadata(projectId, sourceId, sourceKind);
          }
          if (cancelled) return;
          if (result.status !== "processed") {
            throw new Error(result.converter.message ?? "DWG file could not be processed. A DWG converter may need to be configured on the server.");
          }
          const entities = normalizeApiEntities(result.entities);
          const lc: Record<string, string> = {};
          for (const layer of result.layers) {
            if (layer.color) lc[layer.name] = layer.color;
          }
          layerColorsRef.current = lc;
          setData({ entities, layerCount: result.layers.length });
        } else {
          const response = await fetch(url, { credentials: "include" });
          if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);

          const text = await response.text();
          if (cancelled) return;

          const DxfParser = (await import("dxf-parser")).default;
          const parser = new DxfParser();
          const parsed = parser.parseSync(text);
          if (cancelled) return;

          if (!parsed) throw new Error("Failed to parse DXF file");

          const lc: Record<string, string> = {};
          const layers = parsed.tables?.layer?.layers;
          if (layers) {
            for (const [name, layer] of Object.entries(layers)) {
              if ((layer as { color?: number }).color && ACI_COLORS[(layer as { color?: number }).color!]) {
                lc[name] = ACI_COLORS[(layer as { color?: number }).color!];
              }
            }
          }
          layerColorsRef.current = lc;

          const rawEntities = (parsed as unknown as { entities: NormalizedEntity[] }).entities ?? [];
          setData({ entities: rawEntities, layerCount: layers ? Object.keys(layers).length : 0 });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load drawing");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [url, isDwg, projectId, sourceKind, sourceId]);

  const drawCanvas = useCallback(() => {
    if (!data || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, width, height);

    const bounds = computeBounds(data.entities);
    const drawWidth = bounds.maxX - bounds.minX || 1;
    const drawHeight = bounds.maxY - bounds.minY || 1;

    const padding = 40;
    const scaleX = (width - padding * 2) / drawWidth;
    const scaleY = (height - padding * 2) / drawHeight;
    const baseScale = Math.min(scaleX, scaleY);

    const totalScale = baseScale * zoom;
    const cx = width / 2 + offset.x;
    const cy = height / 2 + offset.y;
    const midX = (bounds.minX + bounds.maxX) / 2;
    const midY = (bounds.minY + bounds.maxY) / 2;

    const layerColors = layerColorsRef.current;

    function toScreen(x: number, y: number): [number, number] {
      return [
        cx + (x - midX) * totalScale,
        cy - (y - midY) * totalScale,
      ];
    }

    ctx.lineWidth = 1;

    for (const entity of data.entities) {
      const color = getEntityColor(entity, layerColors);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;

      switch (entity.type) {
        case "LINE": {
          if (!entity.startPoint || !entity.endPoint) break;
          const [x1, y1] = toScreen(entity.startPoint.x, entity.startPoint.y);
          const [x2, y2] = toScreen(entity.endPoint.x, entity.endPoint.y);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          break;
        }
        case "CIRCLE": {
          if (!entity.center || entity.radius == null) break;
          const [cx2, cy2] = toScreen(entity.center.x, entity.center.y);
          const r = entity.radius * totalScale;
          ctx.beginPath();
          ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case "ARC": {
          if (!entity.center || entity.radius == null) break;
          const [acx, acy] = toScreen(entity.center.x, entity.center.y);
          const ar = entity.radius * totalScale;
          const startAng = ((entity.startAngle || 0) * Math.PI) / 180;
          const endAng = ((entity.endAngle || 360) * Math.PI) / 180;
          ctx.beginPath();
          ctx.arc(acx, acy, ar, -startAng, -endAng, true);
          ctx.stroke();
          break;
        }
        case "LWPOLYLINE":
        case "POLYLINE": {
          if (!entity.vertices || entity.vertices.length < 2) break;
          ctx.beginPath();
          const [px0, py0] = toScreen(entity.vertices[0].x, entity.vertices[0].y);
          ctx.moveTo(px0, py0);
          for (let i = 1; i < entity.vertices.length; i++) {
            const [px, py] = toScreen(entity.vertices[i].x, entity.vertices[i].y);
            ctx.lineTo(px, py);
          }
          ctx.stroke();
          break;
        }
        case "TEXT":
        case "MTEXT": {
          if (!entity.position || !entity.text) break;
          const [tx, ty] = toScreen(entity.position.x, entity.position.y);
          const fontSize = Math.max(8, (entity.height || 2) * totalScale * 0.7);
          if (fontSize < 4) break;
          ctx.font = `${Math.min(fontSize, 24)}px monospace`;
          ctx.fillText(entity.text, tx, ty);
          break;
        }
      }
    }
  }, [data, zoom, offset]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => drawCanvas());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [drawCanvas]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.1, Math.min(50, z * factor)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    offsetStart.current = { ...offset };
  }, [offset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setOffset({
      x: offsetStart.current.x + (e.clientX - dragStart.current.x),
      y: offsetStart.current.y + (e.clientY - dragStart.current.y),
    });
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <AlertTriangle className="h-10 w-10 text-yellow-500" />
        <p className="text-sm text-text-secondary">{error}</p>
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-secondary" />
        <span className="ml-2 text-sm text-text-secondary">{isDwg ? "Processing DWG drawing..." : "Loading DXF drawing..."}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-line bg-panel px-4 py-2">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-text-secondary" />
          <span className="text-sm font-medium text-text-primary truncate">{fileName}</span>
          <span className="text-xs text-text-secondary">
            {data?.layerCount ?? 0} layer{data?.layerCount !== 1 ? "s" : ""}
            {data ? ` | ${data.entities.length} entities` : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.min(50, z * 1.3))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.max(0.1, z * 0.7))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={resetView}>
            <Maximize className="h-4 w-4" />
          </Button>
          <span className="text-xs text-text-secondary ml-2 w-12 text-right">
            {Math.round(zoom * 100)}%
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        className={cn(
          "flex-1 overflow-hidden",
          dragging ? "cursor-grabbing" : "cursor-grab"
        )}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>
    </div>
  );
}
