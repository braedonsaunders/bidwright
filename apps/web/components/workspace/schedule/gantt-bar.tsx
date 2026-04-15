"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { applyDragDelta, formatShortDate, getBarPosition } from "@/lib/schedule-utils";

interface GanttBarProps {
  taskId: string;
  startDate: Date;
  endDate: Date;
  progress: number;
  color: { bg: string; hex: string };
  isCritical: boolean;
  taskName: string;
  timelineStartMs: number;
  timelineEndMs: number;
  variant?: "task" | "summary";
  isDraggable?: boolean;
  onDragEnd: (newStart: Date, newEnd: Date) => void | boolean | Promise<boolean | void>;
  onClick: () => void;
}

type DragMode = "move" | "resize-start" | "resize-end" | null;

export function GanttBar({
  taskId,
  startDate,
  endDate,
  progress,
  color,
  isCritical,
  taskName,
  timelineStartMs,
  timelineEndMs,
  variant = "task",
  isDraggable = true,
  onDragEnd,
  onClick,
}: GanttBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [previewDates, setPreviewDates] = useState<{ startDate: Date; endDate: Date } | null>(null);

  const dragStartX = useRef(0);
  const containerWidth = useRef(0);
  const msPerPixel = useRef(0);
  const suppressClick = useRef(false);
  const latestDates = useRef<{ startDate: Date; endDate: Date } | null>(null);

  const currentStart = previewDates?.startDate ?? startDate;
  const currentEnd = previewDates?.endDate ?? endDate;
  const { left, width } = getBarPosition(currentStart, currentEnd, timelineStartMs, timelineEndMs);
  const summaryFill = isCritical ? "#3b82f6" : "#60a5fa";
  const summaryTopEdge = isCritical ? "#1d4ed8" : "#3b82f6";
  const summaryShadow = isCritical ? "rgba(29, 78, 216, 0.24)" : "rgba(59, 130, 246, 0.22)";

  useEffect(() => {
    if (!previewDates) return;
    if (
      previewDates.startDate.getTime() === startDate.getTime() &&
      previewDates.endDate.getTime() === endDate.getTime()
    ) {
      setPreviewDates(null);
    }
  }, [endDate, previewDates, startDate]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, mode: DragMode) => {
      if (!isDraggable) return;
      e.preventDefault();
      e.stopPropagation();

      const container = barRef.current?.parentElement;
      if (!container) return;

      containerWidth.current = container.getBoundingClientRect().width;
      msPerPixel.current = (timelineEndMs - timelineStartMs) / Math.max(containerWidth.current, 1);
      dragStartX.current = e.clientX;
      suppressClick.current = false;
      latestDates.current = { startDate, endDate };
      setDragMode(mode);
      setPreviewDates({ startDate, endDate });

      const handleMove = (ev: PointerEvent) => {
        const dx = ev.clientX - dragStartX.current;
        if (Math.abs(dx) > 3) {
          suppressClick.current = true;
        }

        const deltaMs = dx * msPerPixel.current;
        const nextDates = applyDragDelta(
          startDate,
          endDate,
          deltaMs,
          mode === "move" ? "move" : mode === "resize-start" ? "start" : "end"
        );

        latestDates.current = nextDates;
        setPreviewDates(nextDates);
      };

      const handleUp = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);

        const finalDates = latestDates.current;
        latestDates.current = null;
        setDragMode(null);

        if (!suppressClick.current || !finalDates) {
          setPreviewDates(null);
          return;
        }

        Promise.resolve(onDragEnd(finalDates.startDate, finalDates.endDate))
          .then((result) => {
            if (result === false) {
              setPreviewDates(null);
            }
          })
          .catch(() => {
            setPreviewDates(null);
          });
      };

      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp, { once: true });
    },
    [endDate, isDraggable, onDragEnd, startDate, timelineEndMs, timelineStartMs]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      onClick();
    },
    [onClick]
  );

  return (
    <div
      ref={barRef}
      data-testid={`gantt-bar-${taskId}`}
      className={cn(
        "absolute top-1/2 z-20 -translate-y-1/2 group/bar",
        variant === "summary" ? "h-8 overflow-visible" : "h-5 rounded-md",
        isDraggable ? (dragMode ? "cursor-grabbing" : "cursor-grab") : "cursor-pointer",
        isCritical && "ring-2 ring-red-400/60"
      )}
      style={{
        left: `${(left * 100).toFixed(2)}%`,
        width: `${(width * 100).toFixed(2)}%`,
      }}
      onClick={handleClick}
    >
      {variant === "summary" ? (
        <div
          className="absolute inset-0"
          style={{
            filter: `drop-shadow(0 1px 1px ${summaryShadow})`,
          }}
        >
          <svg
            className="h-full w-full overflow-visible"
            viewBox="0 0 100 32"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <rect x="0" y="5" width="100" height="20" rx="0.8" fill={summaryFill} />
            <path d="M 0 5 L 0 25 L 12 5" fill="none" stroke={summaryTopEdge} strokeWidth="1.8" strokeLinecap="butt" strokeLinejoin="miter" />
            <path d="M 0 5 H 100" fill="none" stroke={summaryTopEdge} strokeWidth="1.8" strokeLinecap="butt" />
            <path d="M 100 5 L 100 25 L 88 5" fill="none" stroke={summaryTopEdge} strokeWidth="1.8" strokeLinecap="butt" strokeLinejoin="miter" />
          </svg>
          <div className="absolute inset-0 flex items-center overflow-hidden px-3">
            <span className="truncate text-[10px] font-medium text-white drop-shadow-sm">
              {taskName}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className={cn("absolute inset-0 rounded-md opacity-80 hover:opacity-100 transition-opacity", color.bg)} />

          {progress > 0 && (
            <div
              className="absolute inset-y-0 left-0 rounded-l-md bg-white/20"
              style={{ width: `${(progress * 100).toFixed(0)}%` }}
            />
          )}

          <div className="absolute inset-0 flex items-center px-2 overflow-hidden">
            <span className="truncate text-[10px] font-medium text-white drop-shadow-sm">
              {taskName}
            </span>
          </div>

          {isDraggable ? (
            <>
              <div
                data-testid={`gantt-bar-start-${taskId}`}
                className="absolute left-0 top-0 bottom-0 z-30 w-2 cursor-col-resize rounded-l-md hover:bg-white/20"
                onPointerDown={(e) => handlePointerDown(e, "resize-start")}
              />
              <div
                data-testid={`gantt-bar-end-${taskId}`}
                className="absolute right-0 top-0 bottom-0 z-30 w-2 cursor-col-resize rounded-r-md hover:bg-white/20"
                onPointerDown={(e) => handlePointerDown(e, "resize-end")}
              />
              <div
                data-testid={`gantt-bar-move-${taskId}`}
                className="absolute inset-0 z-20 cursor-grab"
                onPointerDown={(e) => handlePointerDown(e, "move")}
              />
            </>
          ) : null}
        </>
      )}

      <div className="absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-fg px-2 py-0.5 text-[10px] text-panel pointer-events-none z-40 group-hover/bar:block">
        {taskName}: {formatShortDate(currentStart)} - {formatShortDate(currentEnd)}
      </div>
    </div>
  );
}
