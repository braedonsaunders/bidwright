"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import type { Point, Calibration } from "@/lib/takeoff-math";
import { computeMeasurement } from "@/lib/takeoff-math";

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
  calibration: Calibration | null;
  activeColor: string;
  activeThickness: number;
  onAnnotationComplete: (data: Partial<TakeoffAnnotation>) => void;
  onCalibrationRequest?: (points: [Point, Point]) => void;
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
      if (points.length >= 2) drawRect(ctx, points[0], points[1], true);
      break;
    case "area-polygon":
    case "area-vertical-wall":
      if (points.length >= 3) drawPolygon(ctx, points, true);
      break;
    case "area-triangle":
      if (points.length >= 3) drawPolygon(ctx, points.slice(0, 3), true);
      break;
    case "area-ellipse":
      if (points.length >= 2) drawEllipse(ctx, points[0], points[1], true);
      break;
    case "calibrate":
      if (points.length >= 2) {
        ctx.setLineDash([6, 4]);
        drawLine(ctx, points[0], points[1]);
        ctx.setLineDash([]);
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
  activeColor,
  activeThickness,
  onAnnotationComplete,
  onCalibrationRequest,
}: AnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  /* Full redraw */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    /* Render stored annotations */
    for (const ann of annotations) {
      renderAnnotation(ctx, ann, calibration);
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
      }

      /* Live measurement preview */
      if (calibration && allPts.length >= 2) {
        const m = computeMeasurement(activeTool, allPts, calibration);
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

  /* Determine if the active tool needs multi-click (polyline/polygon) */
  function isMultiClickTool(tool: string | null): boolean {
    return [
      "linear-polyline",
      "linear-drop",
      "area-polygon",
      "area-vertical-wall",
      "count",
      "count-by-distance",
    ].includes(tool ?? "");
  }

  function isDragTool(tool: string | null): boolean {
    return ["area-rectangle", "area-ellipse"].includes(tool ?? "");
  }

  function isTriangleTool(tool: string | null): boolean {
    return tool === "area-triangle";
  }

  function isTwoPointTool(tool: string | null): boolean {
    return ["linear", "calibrate"].includes(tool ?? "");
  }

  /* ─── Mouse Handlers ─── */

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!activeTool || activeTool === "select") return;
    const pt = getCanvasPoint(e);

    if (isDragTool(activeTool)) {
      setDrawingPoints([pt]);
      setIsDragging(true);
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!activeTool || activeTool === "select") return;
    const pt = getCanvasPoint(e);
    setCursorPos(pt);

    if (isDragging && isDragTool(activeTool) && drawingPoints.length === 1) {
      /* Live preview for drag tools handled by cursorPos in redraw */
    }
  }

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!activeTool || activeTool === "select") return;
    const pt = getCanvasPoint(e);

    if (isDragging && isDragTool(activeTool) && drawingPoints.length === 1) {
      setIsDragging(false);
      const finalPoints = [drawingPoints[0], pt];
      finishAnnotation(finalPoints);
      return;
    }

    setIsDragging(false);
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!activeTool || activeTool === "select") return;
    if (isDragging) return;

    const pt = getCanvasPoint(e);

    /* Count tools: each click = one point, complete on each click */
    if (activeTool === "count") {
      const newPoints = [...drawingPoints, pt];
      setDrawingPoints(newPoints);
      /* Each click produces one count annotation immediately */
      onAnnotationComplete({
        type: activeTool,
        points: newPoints,
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
    const cal = calibration ?? { pixelsPerUnit: 1, unit: "px" };
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
  }

  /* Cancel drawing with Escape */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDrawingPoints([]);
        setCursorPos(null);
        setIsDragging(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  /* Cursor style based on active tool */
  const cursorStyle =
    !activeTool || activeTool === "select" ? "default" : "crosshair";

  return (
    <canvas
      ref={canvasRef}
      className="absolute left-0 top-0"
      style={{ cursor: cursorStyle, width, height }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    />
  );
}
