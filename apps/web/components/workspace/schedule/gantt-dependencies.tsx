"use client";

import { useMemo } from "react";
import type { ScheduleTask, ScheduleDependency } from "@/lib/api";
import { resolveDependencyAnchorDates } from "@/lib/schedule-utils";

interface GanttDependenciesProps {
  dependencies: ScheduleDependency[];
  tasks: ScheduleTask[];
  taskRowCenters: Map<string, number>;
  timelineStartMs: number;
  timelineEndMs: number;
  svgHeight: number;
  criticalTaskIds: Set<string>;
  violatingDependencyIds: Set<string>;
  showCriticalPath: boolean;
}

export function GanttDependencies({
  dependencies,
  tasks,
  taskRowCenters,
  timelineStartMs,
  timelineEndMs,
  svgHeight,
  criticalTaskIds,
  violatingDependencyIds,
  showCriticalPath,
}: GanttDependenciesProps) {
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const lines = useMemo(() => {
    const result: Array<{
      id: string;
      path: string;
      isCritical: boolean;
      hasViolation: boolean;
    }> = [];

    for (const dep of dependencies) {
      const from = taskMap.get(dep.predecessorId);
      const to = taskMap.get(dep.successorId);
      if (!from || !to) continue;

      const fromY = taskRowCenters.get(dep.predecessorId);
      const toY = taskRowCenters.get(dep.successorId);
      if (fromY === undefined || toY === undefined) continue;

      const anchorDates = resolveDependencyAnchorDates(dep, from, to);
      if (!anchorDates) continue;

      const span = timelineEndMs - timelineStartMs || 1;
      const fromX = ((anchorDates.from.getTime() - timelineStartMs) / span) * 100;
      const toX = ((anchorDates.to.getTime() - timelineStartMs) / span) * 100;
      const midX = fromX + (toX - fromX) * 0.5;

      const path = `M ${fromX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${toX} ${toY}`;

      const isCritical = showCriticalPath && criticalTaskIds.has(dep.predecessorId) && criticalTaskIds.has(dep.successorId);
      const hasViolation = violatingDependencyIds.has(dep.id);

      result.push({ id: dep.id, path, isCritical, hasViolation });
    }

    return result;
  }, [
    dependencies,
    taskMap,
    taskRowCenters,
    timelineStartMs,
    timelineEndMs,
    criticalTaskIds,
    violatingDependencyIds,
    showCriticalPath,
  ]);

  if (lines.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10"
      style={{ height: svgHeight }}
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
        <marker
          id="arrowhead-warning"
          markerWidth="6"
          markerHeight="4"
          refX="6"
          refY="2"
          orient="auto"
        >
          <polygon points="0 0, 6 2, 0 4" fill="currentColor" className="text-amber-400" />
        </marker>
      </defs>
      {lines.map((line) => (
        <path
          key={line.id}
          d={line.path}
          fill="none"
          stroke={
            line.isCritical
              ? "rgb(248 113 113)"
              : line.hasViolation
                ? "rgb(245 158 11 / 0.8)"
                : "rgb(148 163 184 / 0.4)"
          }
          strokeWidth={line.isCritical ? 0.3 : 0.2}
          strokeDasharray={line.hasViolation && !line.isCritical ? "1 0.6" : undefined}
          markerEnd={`url(#arrowhead${line.isCritical ? "-critical" : line.hasViolation ? "-warning" : ""})`}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
