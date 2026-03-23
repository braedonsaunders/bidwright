"use client";

import { useMemo } from "react";
import type { ScheduleTask, ScheduleDependency } from "@/lib/api";
import { getBarPosition, parseDate } from "@/lib/schedule-utils";

interface GanttDependenciesProps {
  dependencies: ScheduleDependency[];
  tasks: ScheduleTask[];
  taskRowPositions: Map<string, number>;
  timelineStartMs: number;
  timelineEndMs: number;
  leftPanelWidth: number;
  rowHeight: number;
  criticalTaskIds: Set<string>;
  showCriticalPath: boolean;
}

export function GanttDependencies({
  dependencies,
  tasks,
  taskRowPositions,
  timelineStartMs,
  timelineEndMs,
  leftPanelWidth,
  rowHeight,
  criticalTaskIds,
  showCriticalPath,
}: GanttDependenciesProps) {
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const lines = useMemo(() => {
    const result: Array<{
      id: string;
      path: string;
      isCritical: boolean;
    }> = [];

    for (const dep of dependencies) {
      const from = taskMap.get(dep.predecessorId);
      const to = taskMap.get(dep.successorId);
      if (!from || !to) continue;

      const fromRow = taskRowPositions.get(dep.predecessorId);
      const toRow = taskRowPositions.get(dep.successorId);
      if (fromRow === undefined || toRow === undefined) continue;

      const fromStart = parseDate(from.startDate);
      const fromEnd = parseDate(from.endDate);
      const toStart = parseDate(to.startDate);
      if (!fromEnd || !toStart) continue;

      // For FS (finish-to-start): line goes from end of predecessor to start of successor
      const span = timelineEndMs - timelineStartMs || 1;

      // X coordinates as percentages of timeline width
      const fromX = ((fromEnd.getTime() - timelineStartMs) / span) * 100;
      const toX = ((toStart.getTime() - timelineStartMs) / span) * 100;

      // Y coordinates based on row positions (center of each row)
      const fromY = fromRow * rowHeight + rowHeight / 2;
      const toY = toRow * rowHeight + rowHeight / 2;

      // Simple polyline path: horizontal from source, then vertical, then horizontal to target
      const midX = fromX + (toX - fromX) * 0.5;

      const path = `M ${fromX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${toX} ${toY}`;

      const isCritical = showCriticalPath && criticalTaskIds.has(dep.predecessorId) && criticalTaskIds.has(dep.successorId);

      result.push({ id: dep.id, path, isCritical });
    }

    return result;
  }, [dependencies, taskMap, taskRowPositions, timelineStartMs, timelineEndMs, rowHeight, criticalTaskIds, showCriticalPath]);

  if (lines.length === 0) return null;

  // Calculate SVG dimensions
  const totalRows = Math.max(...Array.from(taskRowPositions.values()), 0) + 1;
  const svgHeight = totalRows * rowHeight;

  return (
    <svg
      className="absolute top-0 pointer-events-none z-15"
      style={{ left: leftPanelWidth, right: 0, height: svgHeight }}
      viewBox={`0 0 100 ${svgHeight}`}
      preserveAspectRatio="none"
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="6"
          markerHeight="4"
          refX="6"
          refY="2"
          orient="auto"
        >
          <polygon points="0 0, 6 2, 0 4" fill="currentColor" className="text-fg/30" />
        </marker>
        <marker
          id="arrowhead-critical"
          markerWidth="6"
          markerHeight="4"
          refX="6"
          refY="2"
          orient="auto"
        >
          <polygon points="0 0, 6 2, 0 4" fill="currentColor" className="text-red-400" />
        </marker>
      </defs>
      {lines.map((line) => (
        <path
          key={line.id}
          d={line.path}
          fill="none"
          stroke={line.isCritical ? "rgb(248 113 113)" : "rgb(148 163 184 / 0.4)"}
          strokeWidth={line.isCritical ? 0.3 : 0.2}
          markerEnd={`url(#arrowhead${line.isCritical ? "-critical" : ""})`}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
