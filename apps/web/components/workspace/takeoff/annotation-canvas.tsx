"use client";

import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import type { Point, Calibration } from "@/lib/takeoff-math";
import { computeMeasurement } from "@/lib/takeoff-math";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

export interface TakeoffAnnotation {
  id: string;
  type: string;
  label: string;
  color: string;
  thickness: number;
  points: Point[];
  visible: boolean;
  groupName?: string;
  /** Canvas dimensions when this annotation was created — used to scale points on zoom */
  canvasWidth?: number;
  canvasHeight?: number;
  opts?: {
    dropDistance?: number;
    wallHeight?: number;
    height?: number;
    spacing?: number;
  };
  measurement?: { value: number; unit: string; area?: number; volume?: number };
}

interface AnnotationCanvasProps {
  width: number;
  height: number;
  annotations: TakeoffAnnotation[];
  activeTool: string | null;
  /** Calibration's pixelsPerUnit is normalised to zoom 1 (paper-pixels per unit). */
  calibration: Calibration | null;
  /** Current zoom level — multiplied into calibration so measurements stay correct at any zoom. */
  zoom: number;
  activeColor: string;
  activeThickness: number;
  onAnnotationComplete: (data: Partial<TakeoffAnnotation>) => void;
  onCalibrationRequest?: (points: [Point, Point]) => void;
  /** Source canvas the loupe samples from when calibrating. */
  pdfCanvas?: HTMLCanvasElement | null;
  snapEnabled?: boolean;
}

/* ─── Drawing Helpers ─── */

function drawLine(ctx: CanvasRenderingContext2D, a: Point, b: Point) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawPolyline(ctx: CanvasRenderingContext2D, points: Point[]) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

function drawPolygon(ctx: CanvasRenderingContext2D, points: Point[], fill: boolean) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  if (fill) ctx.fill();
  ctx.stroke();
}

function drawRect(ctx: CanvasRenderingContext2D, a: Point, b: Point, fill: boolean) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (fill) ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
}

function drawEllipse(ctx: CanvasRenderingContext2D, a: Point, b: Point, fill: boolean) {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
  if (fill) ctx.fill();
  ctx.stroke();
}

function drawArrow(ctx: CanvasRenderingContext2D, a: Point, b: Point) {
  const headLen = 12;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  /* Arrowhead */
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - headLen * Math.cos(angle - Math.PI / 6), b.y - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(b.x - headLen * Math.cos(angle + Math.PI / 6), b.y - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawHighlight(ctx: CanvasRenderingContext2D, a: Point, b: Point) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  ctx.fillRect(x, y, w, h);
}

function drawNotePin(ctx: CanvasRenderingContext2D, p: Point, color: string) {
  /* Small filled circle with a dot */
  ctx.beginPath();
  ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  /* Inner dot */
  ctx.beginPath();
  ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
}

function drawCloudPolygon(ctx: CanvasRenderingContext2D, points: Point[]) {
  if (points.length < 3) {
    drawPolyline(ctx, points);
    return;
  }
  /* Draw bumpy/cloud-like border using arcs between midpoints */
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    const mx = (curr.x + next.x) / 2;
    const my = (curr.y + next.y) / 2;
    const dx = next.x - curr.x;
    const dy = next.y - curr.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    /* Bump outward perpendicular to segment */
    const bumpSize = Math.min(dist * 0.3, 15);
    const nx = -dy / dist * bumpSize;
    const ny = dx / dist * bumpSize;
    if (i === 0) ctx.moveTo(curr.x, curr.y);
    ctx.quadraticCurveTo(mx + nx, my + ny, next.x, next.y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// Reusable diagonal-hatch pattern keyed by color so area annotations are
// visually distinguishable from solid markup highlights at a glance.
const hatchPatternCache = new Map<string, CanvasPattern>();

function getHatchPattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | string {
  const cached = hatchPatternCache.get(color);
  if (cached) return cached;
  const tile = document.createElement("canvas");
  tile.width = 10;
  tile.height = 10;
  const tctx = tile.getContext("2d");
  if (!tctx) return color + "40";
  tctx.fillStyle = color + "18";
  tctx.fillRect(0, 0, 10, 10);
  tctx.strokeStyle = color + "70";
  tctx.lineWidth = 1.25;
  tctx.lineCap = "square";
  tctx.beginPath();
  tctx.moveTo(-2, 12);
  tctx.lineTo(12, -2);
  tctx.moveTo(-2, 22);
  tctx.lineTo(22, -2);
  tctx.stroke();
  const pattern = ctx.createPattern(tile, "repeat");
  if (pattern) hatchPatternCache.set(color, pattern);
  return pattern ?? color + "40";
}

function drawCountMarker(ctx: CanvasRenderingContext2D, p: Point, color: string, radius: number) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  /* Crosshair */
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x - radius * 0.5, p.y);
  ctx.lineTo(p.x + radius * 0.5, p.y);
  ctx.moveTo(p.x, p.y - radius * 0.5);
  ctx.lineTo(p.x, p.y + radius * 0.5);
  ctx.stroke();
}

function drawMeasurementLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  position: Point,
  color: string
) {
  ctx.font = "11px Inter, system-ui, sans-serif";
  const metrics = ctx.measureText(text);
  const pad = 4;
  const bw = metrics.width + pad * 2;
  const bh = 16;
  const bx = position.x - bw / 2;
  const by = position.y - bh - 6;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 3);
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, position.x, by + bh / 2);
}

/* ─── Render a single annotation ─── */

function renderAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: TakeoffAnnotation,
  calibration: Calibration | null
) {
  if (!ann.visible || ann.points.length === 0) return;

  const color = ann.color;
  const alpha = "40";

  ctx.strokeStyle = color;
  ctx.lineWidth = ann.thickness;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fillStyle = color + alpha;

  const { type, points } = ann;

  switch (type) {
    case "linear":
      if (points.length >= 2) drawLine(ctx, points[0], points[1]);
      break;
    case "linear-polyline":
    case "linear-drop":
      drawPolyline(ctx, points);
      break;
    case "count":
    case "count-by-distance":
      for (const p of points) drawCountMarker(ctx, p, color, ann.thickness + 4);
      break;
    case "area-rectangle":
      if (points.length >= 2) {
        ctx.save();
        ctx.fillStyle = getHatchPattern(ctx, color);
        drawRect(ctx, points[0], points[1], true);
        ctx.restore();
      }
      break;
    case "area-polygon":
    case "area-vertical-wall":
      if (points.length >= 3) {
        ctx.save();
        ctx.fillStyle = getHatchPattern(ctx, color);
        drawPolygon(ctx, points, true);
        ctx.restore();
      }
      break;
    case "area-triangle":
      if (points.length >= 3) {
        ctx.save();
        ctx.fillStyle = getHatchPattern(ctx, color);
        drawPolygon(ctx, points.slice(0, 3), true);
        ctx.restore();
      }
      break;
    case "area-ellipse":
      if (points.length >= 2) {
        ctx.save();
        ctx.fillStyle = getHatchPattern(ctx, color);
        drawEllipse(ctx, points[0], points[1], true);
        ctx.restore();
      }
      break;
    case "calibrate":
      if (points.length >= 2) {
        ctx.setLineDash([6, 4]);
        drawLine(ctx, points[0], points[1]);
        ctx.setLineDash([]);
      }
      break;
    case "markup-note":
      if (points.length >= 1) drawNotePin(ctx, points[0], color);
      break;
    case "markup-cloud":
      if (points.length >= 3) drawCloudPolygon(ctx, points);
      else if (points.length >= 2) drawPolyline(ctx, points);
      break;
    case "markup-arrow":
      if (points.length >= 2) {
        ctx.fillStyle = color;
        drawArrow(ctx, points[0], points[1]);
      }
      break;
    case "markup-highlight":
      if (points.length >= 2) {
        ctx.save();
        ctx.fillStyle = color + "50"; /* semi-transparent */
        ctx.strokeStyle = "transparent";
        drawHighlight(ctx, points[0], points[1]);
        ctx.restore();
      }
      break;
  }

  /* Draw measurement label */
  if (calibration && ann.measurement && points.length >= 2) {
    const midX = points.reduce((s, p) => s + p.x, 0) / points.length;
    const midY = points.reduce((s, p) => s + p.y, 0) / points.length;
    const label =
      ann.measurement.unit === "count"
        ? `${ann.measurement.value}`
        : `${ann.measurement.value.toFixed(2)} ${ann.measurement.unit}`;
    drawMeasurementLabel(ctx, label, { x: midX, y: midY }, color);
  }

  /* Draw vertex dots */
  if (type !== "count" && type !== "count-by-distance") {
    ctx.fillStyle = color;
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* ─── Component ─── */

export function AnnotationCanvas({
  width,
  height,
  annotations,
  activeTool,
  calibration,
  zoom,
  activeColor,
  activeThickness,
  onAnnotationComplete,
  onCalibrationRequest,
  pdfCanvas,
  snapEnabled = true,
}: AnnotationCanvasProps) {
  // Scale the stored (zoom-1) calibration by the current zoom for use in math.
  const effectiveCalibration = useMemo<Calibration | null>(
    () => (calibration ? { ...calibration, pixelsPerUnit: calibration.pixelsPerUnit * zoom } : null),
    [calibration, zoom],
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  const [screenCursor, setScreenCursor] = useState<{ x: number; y: number } | null>(null);
  const [snapPoint, setSnapPoint] = useState<Point | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const snapPointRef = useRef<Point | null>(null);
  useEffect(() => {
    snapPointRef.current = snapPoint;
  }, [snapPoint]);

  // Whenever the active tool changes (or calibrate is exited), clear any
  // stale snap target so it can't be honoured by a later click.
  useEffect(() => {
    if (activeTool !== "calibrate") {
      setSnapPoint(null);
      snapPointRef.current = null;
    }
  }, [activeTool]);

  /* Refs mirror state for drag tools so mouseUp always sees values set by mouseDown,
     even if React hasn't re-rendered yet (stale closure problem). */
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<Point | null>(null);

  /* Full redraw */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    /* Render stored annotations — scale points if created at different canvas size */
    for (const ann of annotations) {
      if (ann.canvasWidth && ann.canvasHeight && (ann.canvasWidth !== width || ann.canvasHeight !== height)) {
        const sx = width / ann.canvasWidth;
        const sy = height / ann.canvasHeight;
        const scaled: TakeoffAnnotation = {
          ...ann,
          points: ann.points.map((p) => ({ x: p.x * sx, y: p.y * sy })),
          thickness: ann.thickness * Math.min(sx, sy),
        };
        renderAnnotation(ctx, scaled, calibration);
      } else {
        renderAnnotation(ctx, ann, calibration);
      }
    }

    /* Render in-progress drawing */
    if (drawingPoints.length > 0 && activeTool) {
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = activeThickness;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.fillStyle = activeColor + "30";

      const allPts = cursorPos ? [...drawingPoints, cursorPos] : drawingPoints;

      switch (activeTool) {
        case "linear":
        case "calibrate":
          if (allPts.length >= 2) {
            if (activeTool === "calibrate") ctx.setLineDash([6, 4]);
            drawLine(ctx, allPts[0], allPts[allPts.length - 1]);
            ctx.setLineDash([]);
          }
          break;
        case "linear-polyline":
        case "linear-drop":
          drawPolyline(ctx, allPts);
          break;
        case "count":
        case "count-by-distance":
          for (const p of drawingPoints) drawCountMarker(ctx, p, activeColor, activeThickness + 4);
          break;
        case "area-rectangle":
          if (allPts.length >= 2) drawRect(ctx, allPts[0], allPts[allPts.length - 1], true);
          break;
        case "area-polygon":
        case "area-vertical-wall":
          if (allPts.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(allPts[0].x, allPts[0].y);
            for (let i = 1; i < allPts.length; i++) ctx.lineTo(allPts[i].x, allPts[i].y);
            ctx.stroke();
            /* Show closing line faintly */
            if (allPts.length >= 3) {
              ctx.globalAlpha = 0.3;
              drawLine(ctx, allPts[allPts.length - 1], allPts[0]);
              ctx.globalAlpha = 1;
            }
          }
          break;
        case "area-triangle":
          if (allPts.length >= 2) {
            drawPolyline(ctx, allPts.slice(0, 3));
            if (allPts.length >= 3) {
              ctx.globalAlpha = 0.3;
              drawLine(ctx, allPts[2], allPts[0]);
              ctx.globalAlpha = 1;
            }
          }
          break;
        case "area-ellipse":
          if (allPts.length >= 2) drawEllipse(ctx, allPts[0], allPts[allPts.length - 1], true);
          break;
        case "markup-cloud":
          if (allPts.length >= 3) {
            drawCloudPolygon(ctx, allPts);
          } else if (allPts.length >= 2) {
            drawPolyline(ctx, allPts);
          }
          break;
        case "markup-arrow":
          if (allPts.length >= 2) {
            ctx.fillStyle = activeColor;
            drawArrow(ctx, allPts[0], allPts[allPts.length - 1]);
          }
          break;
        case "markup-highlight":
          if (allPts.length >= 2) {
            ctx.save();
            ctx.fillStyle = activeColor + "50";
            ctx.strokeStyle = "transparent";
            drawHighlight(ctx, allPts[0], allPts[allPts.length - 1]);
            ctx.restore();
          }
          break;
      }

      /* Live measurement preview */
      if (effectiveCalibration && allPts.length >= 2) {
        const m = computeMeasurement(activeTool, allPts, effectiveCalibration);
        if (m.value > 0) {
          const midX = allPts.reduce((s, p) => s + p.x, 0) / allPts.length;
          const midY = allPts.reduce((s, p) => s + p.y, 0) / allPts.length;
          const label =
            m.unit === "count"
              ? `${m.value}`
              : `${m.value.toFixed(2)} ${m.unit}`;
          drawMeasurementLabel(ctx, label, { x: midX, y: midY }, activeColor);
        }
      }

      /* Vertex dots for in-progress */
      for (const p of drawingPoints) {
        ctx.fillStyle = activeColor;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (snapEnabled && snapPoint && activeTool && activeTool !== "select") {
      ctx.save();
      ctx.strokeStyle = "rgba(34, 197, 94, 0.95)";
      ctx.fillStyle = "rgba(34, 197, 94, 0.18)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(snapPoint.x, snapPoint.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(snapPoint.x - 11, snapPoint.y);
      ctx.lineTo(snapPoint.x + 11, snapPoint.y);
      ctx.moveTo(snapPoint.x, snapPoint.y - 11);
      ctx.lineTo(snapPoint.x, snapPoint.y + 11);
      ctx.stroke();
      ctx.restore();
    }
  }, [
    width,
    height,
    annotations,
    drawingPoints,
    cursorPos,
    activeTool,
    activeColor,
    activeThickness,
    calibration,
    snapEnabled,
    snapPoint,
  ]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  /* Resize canvas */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }, [width, height]);

  /* ─── Mouse Event Helpers ─── */

  function getCanvasPoint(e: React.MouseEvent<HTMLCanvasElement>): Point {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function findPdfSnapPoint(point: Point): Point | null {
    if (!pdfCanvas) return null;
    const searchRadius = 8;
    const darknessThreshold = 112;
    const srcX = Math.max(0, Math.round(point.x - searchRadius));
    const srcY = Math.max(0, Math.round(point.y - searchRadius));
    const size = searchRadius * 2 + 1;
    try {
      const ctx = pdfCanvas.getContext("2d");
      if (!ctx) return null;
      const data = ctx.getImageData(srcX, srcY, size, size).data;
      let bestScore = -Infinity;
      let best: Point | null = null;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = srcX + x - point.x;
          const dy = srcY + y - point.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 > searchRadius * searchRadius) continue;
          const idx = (y * size + x) * 4;
          const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          if (lum > darknessThreshold) continue;
          const score = (255 - lum) * 4 - Math.sqrt(dist2);
          if (score > bestScore) {
            bestScore = score;
            best = { x: srcX + x, y: srcY + y };
          }
        }
      }
      return best;
    } catch {
      return null;
    }
  }

  function findAnnotationSnapPoint(point: Point): Point | null {
    const snapDistance = 10;
    let best: { point: Point; distance: number } | null = null;
    for (const annotation of annotations) {
      for (const candidate of annotation.points) {
        const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
        if (distance <= snapDistance && (!best || distance < best.distance)) {
          best = { point: candidate, distance };
        }
      }
    }
    return best?.point ?? null;
  }

  function findSnapPoint(point: Point): Point | null {
    if (!snapEnabled || !activeTool || activeTool === "select") return null;
    return findAnnotationSnapPoint(point) ?? findPdfSnapPoint(point);
  }

  function commitPoint(point: Point): Point {
    if (!snapEnabled) return point;
    const candidate = snapPointRef.current ?? findSnapPoint(point);
    if (!candidate) return point;
    return Math.hypot(candidate.x - point.x, candidate.y - point.y) <= 14 ? candidate : point;
  }

  /* Determine if the active tool needs multi-click (polyline/polygon) */
  function isMultiClickTool(tool: string | null): boolean {
    return [
      "linear-polyline",
      "linear-drop",
      "area-polygon",
      "area-vertical-wall",
      "count",
      "count-by-distance",
      "markup-cloud",
    ].includes(tool ?? "");
  }

  function isDragTool(tool: string | null): boolean {
    return ["area-rectangle", "area-ellipse", "markup-arrow", "markup-highlight"].includes(tool ?? "");
  }

  function isSingleClickTool(tool: string | null): boolean {
    return tool === "markup-note";
  }

  function isTriangleTool(tool: string | null): boolean {
    return tool === "area-triangle";
  }

  function isTwoPointTool(tool: string | null): boolean {
    return ["linear", "calibrate"].includes(tool ?? "");
  }

  /* ─── Mouse Handlers ─── */

  // Click-and-drag panning when the user is on the Select tool, or any time
  // the middle mouse button is held. We adjust scrollLeft/scrollTop on the
  // nearest scrollable ancestor so the PDF + annotations move together.
  const panStateRef = useRef<{ container: HTMLElement; startX: number; startY: number; startScrollX: number; startScrollY: number } | null>(null);

  function findScrollContainer(el: HTMLElement | null): HTMLElement | null {
    let current = el?.parentElement ?? null;
    while (current) {
      const style = getComputedStyle(current);
      if (/(auto|scroll)/.test(style.overflow + style.overflowX + style.overflowY)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function endPan() {
    panStateRef.current = null;
    if (canvasRef.current) {
      canvasRef.current.style.cursor =
        !activeTool || activeTool === "select" ? "grab" : "crosshair";
    }
    window.removeEventListener("mousemove", handleWindowPanMove);
    window.removeEventListener("mouseup", endPan);
  }

  function handleWindowPanMove(e: MouseEvent) {
    if (!panStateRef.current) return;
    const { container, startX, startY, startScrollX, startScrollY } = panStateRef.current;
    container.scrollLeft = startScrollX - (e.clientX - startX);
    container.scrollTop = startScrollY - (e.clientY - startY);
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const isMiddle = e.button === 1;
    const isSelectLeftDrag = (!activeTool || activeTool === "select") && e.button === 0;
    if (isMiddle || isSelectLeftDrag) {
      const container = findScrollContainer(canvasRef.current);
      if (container) {
        e.preventDefault();
        panStateRef.current = {
          container,
          startX: e.clientX,
          startY: e.clientY,
          startScrollX: container.scrollLeft,
          startScrollY: container.scrollTop,
        };
        if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
        // Track panning at the window level so it keeps working even if the
        // cursor leaves the canvas, and ends cleanly on mouseup anywhere.
        window.addEventListener("mousemove", handleWindowPanMove);
        window.addEventListener("mouseup", endPan);
      }
      return;
    }

    if (!activeTool || activeTool === "select") return;
    const pt = commitPoint(getCanvasPoint(e));

    if (isDragTool(activeTool)) {
      dragStartRef.current = pt;
      isDraggingRef.current = true;
      setDrawingPoints([pt]);
      setIsDragging(true);
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (panStateRef.current) return; // window listener handles it
    if (!activeTool || activeTool === "select") return;
    const pt = getCanvasPoint(e);
    const snap = activeTool === "calibrate" ? snapPointRef.current : findSnapPoint(pt);
    if (activeTool !== "calibrate") setSnapPoint(snap);
    setCursorPos(snap ?? pt);
    if (activeTool === "calibrate") {
      setScreenCursor({ x: e.clientX, y: e.clientY });
    }
  }

  // When the loupe is active, redraw it whenever the cursor moves.
  // We sample a small region of the underlying PDF canvas, blow it up, and
  // (a) render the in-progress line from point 1 to the target,
  // (b) detect the nearest dark feature within a small search radius and
  //     surface it as a snap candidate. Lines are dark on a light background
  //     in virtually every construction PDF, so darkest-pixel-near-cursor is
  //     a robust heuristic for "what the user wants to land on".
  useEffect(() => {
    if (activeTool !== "calibrate" || !cursorPos || !pdfCanvas) return;
    const loupe = loupeCanvasRef.current;
    if (!loupe) return;
    const ctx = loupe.getContext("2d");
    if (!ctx) return;
    const SRC_SIZE = 60;
    const MAGNIFY = 4;
    const DEST_SIZE = SRC_SIZE * MAGNIFY;
    const SEARCH_RADIUS = 10;
    const DARKNESS_THRESHOLD = 110;
    loupe.width = DEST_SIZE;
    loupe.height = DEST_SIZE;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#0b0d10";
    ctx.fillRect(0, 0, DEST_SIZE, DEST_SIZE);
    const srcX = Math.max(0, cursorPos.x - SRC_SIZE / 2);
    const srcY = Math.max(0, cursorPos.y - SRC_SIZE / 2);
    try {
      ctx.drawImage(pdfCanvas, srcX, srcY, SRC_SIZE, SRC_SIZE, 0, 0, DEST_SIZE, DEST_SIZE);
    } catch {
      /* ignore — canvas may not be ready */
    }

    // ── Snap detection ──
    let nextSnap: Point | null = null;
    try {
      const srcCtx = pdfCanvas.getContext("2d");
      if (srcCtx) {
        const data = srcCtx.getImageData(srcX, srcY, SRC_SIZE, SRC_SIZE).data;
        const cx = SRC_SIZE / 2;
        const cy = SRC_SIZE / 2;
        let bestScore = -Infinity;
        let bestPx = -1;
        let bestPy = -1;
        for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
          for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
            const dist2 = dx * dx + dy * dy;
            if (dist2 > SEARCH_RADIUS * SEARCH_RADIUS) continue;
            const px = Math.round(cx + dx);
            const py = Math.round(cy + dy);
            if (px < 0 || px >= SRC_SIZE || py < 0 || py >= SRC_SIZE) continue;
            const idx = (py * SRC_SIZE + px) * 4;
            const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
            if (lum > DARKNESS_THRESHOLD) continue;
            const score = (255 - lum) * 4 - Math.sqrt(dist2);
            if (score > bestScore) {
              bestScore = score;
              bestPx = px;
              bestPy = py;
            }
          }
        }
        if (bestPx >= 0) {
          nextSnap = { x: srcX + bestPx, y: srcY + bestPy };
        }
      }
    } catch {
      /* ignore — cross-origin or other read failure */
    }
    setSnapPoint((prev) => {
      if (!prev && !nextSnap) return prev;
      if (prev && nextSnap && prev.x === nextSnap.x && prev.y === nextSnap.y) return prev;
      return nextSnap;
    });

    const toLoupe = (p: Point) => ({
      x: (p.x - srcX) * MAGNIFY,
      y: (p.y - srcY) * MAGNIFY,
    });

    // In-progress line from point 1 → target (snap or cursor).
    const firstPoint = drawingPoints[0];
    const targetPoint = nextSnap ?? cursorPos;
    if (firstPoint) {
      const a = toLoupe(firstPoint);
      const b = toLoupe(targetPoint);
      ctx.save();
      ctx.strokeStyle = "rgba(245, 158, 11, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = "rgba(245, 158, 11, 0.95)";
      ctx.beginPath();
      ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Crosshair always shown for orientation.
    ctx.strokeStyle = "rgba(245, 158, 11, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(DEST_SIZE / 2, 0);
    ctx.lineTo(DEST_SIZE / 2, DEST_SIZE);
    ctx.moveTo(0, DEST_SIZE / 2);
    ctx.lineTo(DEST_SIZE, DEST_SIZE / 2);
    ctx.stroke();

    if (nextSnap) {
      const s = toLoupe(nextSnap);
      ctx.save();
      ctx.strokeStyle = "rgba(34, 197, 94, 0.95)";
      ctx.fillStyle = "rgba(34, 197, 94, 0.18)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(34, 197, 94, 0.95)";
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = "rgba(245, 158, 11, 0.95)";
      ctx.beginPath();
      ctx.arc(DEST_SIZE / 2, DEST_SIZE / 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [activeTool, cursorPos, pdfCanvas, drawingPoints]);

  // Keyboard nudge: arrow keys move the most recently placed calibrate point
  // by 1 px (5 with Shift) so the user can fine-tune sub-pixel placement
  // without re-clicking. Only active during a calibrate-in-progress session.
  useEffect(() => {
    if (activeTool !== "calibrate") return;
    if (drawingPoints.length === 0) return;
    function onKey(e: KeyboardEvent) {
      const step = e.shiftKey ? 5 : 1;
      let dx = 0;
      let dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = -step;
      else if (e.key === "ArrowDown") dy = step;
      else return;
      e.preventDefault();
      setDrawingPoints((prev) =>
        prev.length === 0 ? prev : [{ x: prev[0]!.x + dx, y: prev[0]!.y + dy }, ...prev.slice(1)],
      );
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTool, drawingPoints.length]);

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (panStateRef.current) {
      endPan();
      return;
    }
    if (!activeTool || activeTool === "select") return;
    const pt = commitPoint(getCanvasPoint(e));

    if (isDraggingRef.current && isDragTool(activeTool) && dragStartRef.current) {
      isDraggingRef.current = false;
      const finalPoints = [dragStartRef.current, pt];
      dragStartRef.current = null;
      setIsDragging(false);
      setDrawingPoints([]);
      finishAnnotation(finalPoints);
      return;
    }

    isDraggingRef.current = false;
    dragStartRef.current = null;
    setIsDragging(false);
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!activeTool || activeTool === "select") return;
    if (isDragging || isDraggingRef.current) return;

    const pt = commitPoint(getCanvasPoint(e));

    /* Count tools: each click = one point, complete on each click */
    if (activeTool === "count") {
      const newPoints = [...drawingPoints, pt];
      setDrawingPoints(newPoints);
      onAnnotationComplete({
        type: activeTool,
        points: newPoints,
        color: activeColor,
        thickness: activeThickness,
      });
      return;
    }

    /* Note: single click placement */
    if (isSingleClickTool(activeTool)) {
      onAnnotationComplete({
        type: activeTool,
        points: [pt],
        color: activeColor,
        thickness: activeThickness,
      });
      return;
    }

    if (activeTool === "count-by-distance") {
      setDrawingPoints((prev) => [...prev, pt]);
      return;
    }

    if (isTwoPointTool(activeTool)) {
      if (drawingPoints.length === 0) {
        setDrawingPoints([pt]);
      } else {
        const finalPoints = [drawingPoints[0], pt];
        if (activeTool === "calibrate") {
          onCalibrationRequest?.(finalPoints as [Point, Point]);
          setDrawingPoints([]);
          setCursorPos(null);
          setSnapPoint(null);
        } else {
          finishAnnotation(finalPoints);
        }
      }
      return;
    }

    if (isTriangleTool(activeTool)) {
      const newPts = [...drawingPoints, pt];
      if (newPts.length >= 3) {
        finishAnnotation(newPts.slice(0, 3));
      } else {
        setDrawingPoints(newPts);
      }
      return;
    }

    if (isMultiClickTool(activeTool)) {
      setDrawingPoints((prev) => [...prev, pt]);
      return;
    }
  }

  function handleDoubleClick() {
    if (!activeTool) return;

    /* Finish multi-click tools on double-click */
    if (isMultiClickTool(activeTool) && drawingPoints.length >= 2) {
      finishAnnotation(drawingPoints);
    }
  }

  function finishAnnotation(points: Point[]) {
    const cal = effectiveCalibration ?? { pixelsPerUnit: 1, unit: "px" };
    const measurement = computeMeasurement(activeTool!, points, cal);

    onAnnotationComplete({
      type: activeTool!,
      points,
      color: activeColor,
      thickness: activeThickness,
      measurement,
    });

    setDrawingPoints([]);
    setCursorPos(null);
    setSnapPoint(null);
  }

  /* Cancel drawing with Escape */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDrawingPoints([]);
        setCursorPos(null);
        setSnapPoint(null);
        setIsDragging(false);
        isDraggingRef.current = false;
        dragStartRef.current = null;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  /* Cursor style based on active tool. Select mode shows grab to hint
     that you can click-and-drag to pan. */
  const cursorStyle =
    !activeTool || activeTool === "select" ? "grab" : "crosshair";

  const showLoupe = activeTool === "calibrate" && screenCursor !== null;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute left-0 top-0"
        style={{ cursor: cursorStyle, width, height }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setScreenCursor(null);
          setSnapPoint(null);
        }}
      />
      {showLoupe && screenCursor && (
        <div
          className="pointer-events-none fixed z-[300] rounded-full border-2 border-amber-500 bg-panel shadow-2xl overflow-hidden"
          style={{
            width: 180,
            height: 180,
            left: screenCursor.x + 24,
            top: screenCursor.y - 200,
            // Flip to the left of the cursor when too close to the right edge
            transform:
              typeof window !== "undefined" && screenCursor.x + 220 > window.innerWidth
                ? "translateX(calc(-100% - 48px))"
                : undefined,
          }}
        >
          <canvas ref={loupeCanvasRef} className="w-full h-full" />
          <div
            className={cn(
              "absolute bottom-0 inset-x-0 text-[10px] font-mono text-center py-0.5 backdrop-blur-sm transition-colors",
              snapPoint
                ? "bg-emerald-900/70 text-emerald-300"
                : "bg-black/60 text-amber-400",
            )}
          >
            {snapPoint ? "snapped · 4× · ↑↓←→ to nudge" : "calibrate · 4× · ↑↓←→ to nudge"}
          </div>
        </div>
      )}
    </>
  );
}
