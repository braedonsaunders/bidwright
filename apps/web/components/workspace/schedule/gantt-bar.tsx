"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { getBarPosition, snapToDay, formatShortDate, MS_PER_DAY } from "@/lib/schedule-utils";

interface GanttBarProps {
  startDate: Date;
  endDate: Date;
  progress: number;
  color: { bg: string; hex: string };
  isCritical: boolean;
  taskName: string;
  timelineStartMs: number;
  timelineEndMs: number;
  onDragEnd: (newStart: Date, newEnd: Date) => void;
  onClick: () => void;
}

type DragMode = "move" | "resize-start" | "resize-end" | null;

export function GanttBar({
  startDate,
  endDate,
  progress,
  color,
  isCritical,
  taskName,
  timelineStartMs,
  timelineEndMs,
  onDragEnd,
  onClick,
}: GanttBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragOffset, setDragOffset] = useState({ startMs: 0, endMs: 0 });
  const dragStartX = useRef(0);
  const containerWidth = useRef(0);
  const didDrag = useRef(false);

  const msPerPixel = useRef(0);

  const currentStart = dragMode ? new Date(startDate.getTime() + dragOffset.startMs) : startDate;
  const currentEnd = dragMode ? new Date(endDate.getTime() + dragOffset.endMs) : endDate;

  const { left, width } = getBarPosition(currentStart, currentEnd, timelineStartMs, timelineEndMs);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, mode: DragMode) => {
      e.preventDefault();
      e.stopPropagation();
      didDrag.current = false;

      const container = barRef.current?.parentElement;
      if (!container) return;

      containerWidth.current = container.getBoundingClientRect().width;
      msPerPixel.current = (timelineEndMs - timelineStartMs) / containerWidth.current;
      dragStartX.current = e.clientX;
      setDragMode(mode);
      setDragOffset({ startMs: 0, endMs: 0 });

      const handleMove = (ev: PointerEvent) => {
        const dx = ev.clientX - dragStartX.current;
        if (Math.abs(dx) > 3) didDrag.current = true;
        const deltaMs = dx * msPerPixel.current;

        if (mode === "move") {
          setDragOffset({ startMs: deltaMs, endMs: deltaMs });
        } else if (mode === "resize-start") {
          const snapped = snapToDay(startDate.getTime() + deltaMs);
          const clampedMs = Math.min(snapped.getTime() - startDate.getTime(), endDate.getTime() - startDate.getTime() - MS_PER_DAY);
          setDragOffset({ startMs: clampedMs, endMs: 0 });
        } else if (mode === "resize-end") {
          const snapped = snapToDay(endDate.getTime() + deltaMs);
          const clampedMs = Math.max(snapped.getTime() - endDate.getTime(), startDate.getTime() - endDate.getTime() + MS_PER_DAY);
          setDragOffset({ startMs: 0, endMs: clampedMs });
        }
      };

      const handleUp = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);

        setDragMode(null);

        if (didDrag.current) {
          const finalStart = snapToDay(startDate.getTime() + (mode === "move" || mode === "resize-start" ? dragStartX.current !== 0 ? (dragStartX.current - dragStartX.current) : 0 : 0));
          // We need to use the last offset values - get them from state
          // Since state updates are async, compute final values directly
          const lastDx = 0; // Will be handled by the move handler
          setDragOffset((prev) => {
            const newStart = snapToDay(startDate.getTime() + prev.startMs);
            const newEnd = snapToDay(endDate.getTime() + prev.endMs);
            onDragEnd(newStart, newEnd);
            return { startMs: 0, endMs: 0 };
          });
        }
      };

      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp);
    },
    [startDate, endDate, timelineStartMs, timelineEndMs, onDragEnd]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!didDrag.current) {
        onClick();
      }
    },
    [onClick]
  );

  return (
    <div
      ref={barRef}
      className={cn(
        "absolute top-2 h-5 rounded-md z-20 group/bar",
        dragMode ? "cursor-grabbing" : "cursor-grab",
        isCritical && "ring-2 ring-red-400/60"
      )}
      style={{
        left: `${(left * 100).toFixed(2)}%`,
        width: `${(width * 100).toFixed(2)}%`,
      }}
      onClick={handleClick}
    >
      {/* Background */}
      <div className={cn("absolute inset-0 rounded-md opacity-80 hover:opacity-100 transition-opacity", color.bg)} />

      {/* Progress fill */}
      {progress > 0 && (
        <div
          className="absolute inset-y-0 left-0 rounded-l-md bg-white/20"
          style={{ width: `${(progress * 100).toFixed(0)}%` }}
        />
      )}

      {/* Label */}
      <div className="absolute inset-0 flex items-center px-2 overflow-hidden">
        <span className="truncate text-[10px] font-medium text-white drop-shadow-sm">
          {taskName}
        </span>
      </div>

      {/* Resize handles */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-30 hover:bg-white/20 rounded-l-md"
        onPointerDown={(e) => handlePointerDown(e, "resize-start")}
      />
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-30 hover:bg-white/20 rounded-r-md"
        onPointerDown={(e) => handlePointerDown(e, "resize-end")}
      />

      {/* Move handle (center) */}
      <div
        className="absolute inset-0 cursor-grab z-20"
        onPointerDown={(e) => handlePointerDown(e, "move")}
      />

      {/* Tooltip */}
      <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover/bar:block bg-fg text-panel text-[10px] px-2 py-0.5 rounded whitespace-nowrap z-40 pointer-events-none">
        {taskName}: {formatShortDate(currentStart)} – {formatShortDate(currentEnd)}
      </div>
    </div>
  );
}
