"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle, Layers, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

interface DxfViewerProps {
  url: string;
  fileName: string;
}

interface DxfEntity {
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
  color?: number;
}

interface DxfData {
  entities: DxfEntity[];
  tables?: {
    layer?: {
      layers?: Record<string, { color?: number }>;
    };
  };
}

// AutoCAD color index to hex (simplified subset)
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

function getEntityColor(entity: DxfEntity, layerColors: Record<string, string>): string {
  if (entity.color && ACI_COLORS[entity.color]) return ACI_COLORS[entity.color];
  if (entity.layer && layerColors[entity.layer]) return layerColors[entity.layer];
  return "#e0e0e0";
}

function computeBounds(entities: DxfEntity[]): { minX: number; minY: number; maxX: number; maxY: number } {
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

export function DxfViewer({ url, fileName }: DxfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dxf, setDxf] = useState<DxfData | null>(null);
  const [layerCount, setLayerCount] = useState(0);

  // Pan/zoom state
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    let cancelled = false;

    async function loadDxf() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);

        const text = await response.text();
        if (cancelled) return;

        const DxfParser = (await import("dxf-parser")).default;
        const parser = new DxfParser();
        const parsed = parser.parseSync(text);
        if (cancelled) return;

        if (!parsed) throw new Error("Failed to parse DXF file");

        setDxf(parsed as unknown as DxfData);

        const layers = parsed.tables?.layer?.layers;
        setLayerCount(layers ? Object.keys(layers).length : 0);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load DXF file");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDxf();
    return () => { cancelled = true; };
  }, [url]);

  const drawCanvas = useCallback(() => {
    if (!dxf || !canvasRef.current || !containerRef.current) return;

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

    // Background
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, width, height);

    const bounds = computeBounds(dxf.entities);
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

    // Build layer color map
    const layerColors: Record<string, string> = {};
    if (dxf.tables?.layer?.layers) {
      for (const [name, layer] of Object.entries(dxf.tables.layer.layers)) {
        if (layer.color && ACI_COLORS[layer.color]) {
          layerColors[name] = ACI_COLORS[layer.color];
        }
      }
    }

    function toScreen(x: number, y: number): [number, number] {
      return [
        cx + (x - midX) * totalScale,
        cy - (y - midY) * totalScale, // flip Y
      ];
    }

    ctx.lineWidth = 1;

    for (const entity of dxf.entities) {
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
          // Y is flipped, so negate angles
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
          if (fontSize < 4) break; // too small to read
          ctx.font = `${Math.min(fontSize, 24)}px monospace`;
          ctx.fillText(entity.text, tx, ty);
          break;
        }
      }
    }
  }, [dxf, zoom, offset]);

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
        <span className="ml-2 text-sm text-text-secondary">Loading DXF drawing...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-line bg-panel px-4 py-2">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-text-secondary" />
          <span className="text-sm font-medium text-text-primary truncate">{fileName}</span>
          <span className="text-xs text-text-secondary">
            {layerCount} layer{layerCount !== 1 ? "s" : ""}
            {dxf ? ` | ${dxf.entities.length} entities` : ""}
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

      {/* Canvas */}
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
