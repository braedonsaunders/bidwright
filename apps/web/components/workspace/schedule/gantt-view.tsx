"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScheduleTask, ScheduleDependency, ProjectPhase, WorkspaceResponse } from "@/lib/api";
import type { ZoomLevel, TaskGroup, TimelineColumn } from "@/lib/schedule-utils";
import {
  generateColumns,
  getTodayPosition,
  getBarPosition,
  groupTasksByPhase,
  computePhaseDatesFromTasks,
  parseDate,
  formatShortDate,
  addDays,
  diffDays,
  formatISODate,
  PHASE_COLORS,
  MS_PER_DAY,
} from "@/lib/schedule-utils";
import { GanttBar } from "./gantt-bar";
import { GanttDependencies } from "./gantt-dependencies";
import { MilestoneMarker } from "./milestone-marker";
import type { ScheduleTaskPatchInput } from "@/lib/api";

interface GanttViewProps {
  tasks: ScheduleTask[];
  dependencies: ScheduleDependency[];
  phases: ProjectPhase[];
  zoomLevel: ZoomLevel;
  scrollOffset: number;
  dateWorkStart: string | null;
  dateWorkEnd: string | null;
  criticalTaskIds: Set<string>;
  showCriticalPath: boolean;
  showBaseline: boolean;
  onUpdateTask: (taskId: string, patch: ScheduleTaskPatchInput) => void;
  onClickTask: (task: ScheduleTask) => void;
  onContextMenu?: (e: React.MouseEvent, task: ScheduleTask) => void;
}

const COL_MIN_WIDTH: Record<ZoomLevel, number> = { day: 40, week: 80, month: 100 };
const LEFT_PANEL_WIDTH = 280;

export function GanttView({
  tasks,
  dependencies,
  phases,
  zoomLevel,
  scrollOffset,
  dateWorkStart,
  dateWorkEnd,
  criticalTaskIds,
  showCriticalPath,
  showBaseline,
  onUpdateTask,
  onClickTask,
  onContextMenu,
}: GanttViewProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());

  // Timeline range
  const timelineRange = useMemo(() => {
    const rawStart = dateWorkStart ? new Date(dateWorkStart) : new Date();
    const rawEnd = dateWorkEnd ? new Date(dateWorkEnd) : addDays(rawStart, 90);
    const start = addDays(rawStart, -7 + scrollOffset);
    const end = addDays(rawEnd, 14 + scrollOffset);
    return { start, end, rawStart, rawEnd };
  }, [dateWorkStart, dateWorkEnd, scrollOffset]);

  // Columns
  const columns = useMemo(
    () => generateColumns(timelineRange.start, timelineRange.end, zoomLevel),
    [timelineRange, zoomLevel]
  );

  // Phase dates
  const phaseDates = useMemo(
    () => computePhaseDatesFromTasks(tasks, phases),
    [tasks, phases]
  );

  // Groups
  const groups = useMemo(
    () => groupTasksByPhase(tasks, phases, phaseDates),
    [tasks, phases, phaseDates]
  );

  // Today
  const todayPos = useMemo(() => getTodayPosition(columns), [columns]);

  // Timeline bounds
  const timelineStartMs = columns.length > 0 ? columns[0].date.getTime() : 0;
  const timelineEndMs = columns.length > 0 ? columns[columns.length - 1].date.getTime() : 1;

  const togglePhase = (phaseId: string) => {
    setCollapsedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  };

  // Bar position helper
  const barStyle = useCallback(
    (startDate: Date, endDate: Date) => {
      const { left, width } = getBarPosition(startDate, endDate, timelineStartMs, timelineEndMs);
      return { left: `${(left * 100).toFixed(2)}%`, width: `${(width * 100).toFixed(2)}%` };
    },
    [timelineStartMs, timelineEndMs]
  );

  // Task row positions for dependency drawing
  const taskRowPositions = useMemo(() => {
    const positions = new Map<string, number>();
    let row = 0;
    for (const group of groups) {
      if (group.phase) row++; // phase header row
      const isCollapsed = group.phase ? collapsedPhases.has(group.phase.id) : false;
      if (!isCollapsed) {
        for (const task of group.tasks) {
          positions.set(task.id, row);
          row++;
        }
      }
    }
    return positions;
  }, [groups, collapsedPhases]);

  const minColWidth = COL_MIN_WIDTH[zoomLevel];

  const handleDragEnd = useCallback(
    (taskId: string, newStart: Date, newEnd: Date) => {
      onUpdateTask(taskId, {
        startDate: formatISODate(newStart),
        endDate: formatISODate(newEnd),
        duration: diffDays(newEnd, newStart),
      });
    },
    [onUpdateTask]
  );

  return (
    <div className="rounded-lg border border-line bg-panel overflow-hidden">
      <div className="overflow-x-auto">
        <div style={{ minWidth: LEFT_PANEL_WIDTH + columns.length * minColWidth }}>
          {/* Header */}
          <div className="flex border-b border-line bg-panel2/30 sticky top-0 z-30">
            <div
              className="shrink-0 border-r border-line px-4 py-2 bg-panel2/30"
              style={{ width: LEFT_PANEL_WIDTH }}
            >
              <span className="text-xs font-medium text-fg/50">Task</span>
            </div>
            <div className="relative flex flex-1">
              {columns.map((col, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex-1 border-r border-line/50 px-1 py-2 text-center",
                    col.isToday && "bg-accent/5"
                  )}
                  style={{ minWidth: minColWidth }}
                >
                  <span className={cn("text-[11px]", col.isToday ? "font-medium text-accent" : "text-fg/40")}>
                    {col.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Rows */}
          <div className="relative" ref={timelineRef}>
            {groups.map((group, gIdx) => {
              const isCollapsed = group.phase ? collapsedPhases.has(group.phase.id) : false;
              const phaseColor = PHASE_COLORS[gIdx % PHASE_COLORS.length];
              const dates = group.phaseDates;

              return (
                <div key={group.phase?.id ?? "standalone"}>
                  {/* Phase header row */}
                  {group.phase && (
                    <div className="flex border-b border-line/50 bg-panel2/20">
                      <div
                        className="shrink-0 border-r border-line px-2 py-2 flex items-center gap-2 cursor-pointer hover:bg-panel2/40 transition-colors"
                        style={{ width: LEFT_PANEL_WIDTH }}
                        onClick={() => togglePhase(group.phase!.id)}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-3.5 w-3.5 text-fg/40 shrink-0" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-fg/40 shrink-0" />
                        )}
                        <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", phaseColor.bg)} />
                        <span className="text-xs font-semibold text-fg/70 truncate">
                          {group.phase.number ? `${group.phase.number}. ` : ""}
                          {group.phase.name}
                        </span>
                        <span className="text-[11px] text-fg/30 ml-auto shrink-0">
                          {group.tasks.length} task{group.tasks.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      {/* Phase bar area */}
                      <div className="relative flex-1 py-1.5" style={{ minHeight: 36 }}>
                        <GridLines columns={columns} minColWidth={minColWidth} />
                        {todayPos && <TodayMarker left={todayPos} />}
                        {dates && (
                          <div
                            className={cn("absolute top-1.5 h-4 rounded opacity-30", phaseColor.bg)}
                            style={barStyle(dates.startDate, dates.endDate)}
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Task rows */}
                  {!isCollapsed &&
                    group.tasks.map((task) => {
                      const start = parseDate(task.startDate);
                      const end = parseDate(task.endDate);
                      const isCritical = showCriticalPath && criticalTaskIds.has(task.id);
                      const baseStart = parseDate(task.baselineStart);
                      const baseEnd = parseDate(task.baselineEnd);

                      return (
                        <div
                          key={task.id}
                          className="flex border-b border-line/30 hover:bg-panel2/10 transition-colors group/row"
                          onContextMenu={onContextMenu ? (e) => onContextMenu(e, task) : undefined}
                        >
                          {/* Task name */}
                          <div
                            className="shrink-0 border-r border-line px-4 py-2 flex items-center gap-2 cursor-pointer"
                            style={{ width: LEFT_PANEL_WIDTH, paddingLeft: group.phase ? 36 : 16 }}
                            onClick={() => onClickTask(task)}
                          >
                            {task.taskType === "milestone" ? (
                              <MilestoneMarker color={phaseColor.bg} size={8} />
                            ) : (
                              <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", phaseColor.bg)} />
                            )}
                            <span className="text-xs text-fg/70 truncate">{task.name || "Untitled"}</span>
                            {task.assignee && (
                              <span className="text-[10px] text-fg/30 ml-auto shrink-0 truncate max-w-20">
                                {task.assignee}
                              </span>
                            )}
                          </div>
                          {/* Bar area */}
                          <div className="relative flex-1 py-2" style={{ minHeight: 40 }}>
                            <GridLines columns={columns} minColWidth={minColWidth} />
                            {todayPos && <TodayMarker left={todayPos} />}

                            {/* Baseline ghost bar */}
                            {showBaseline && baseStart && baseEnd && (
                              <div
                                className="absolute top-1 h-3 rounded border border-dashed border-fg/20 bg-fg/5"
                                style={barStyle(baseStart, baseEnd)}
                              />
                            )}

                            {/* Task bar */}
                            {start && end && task.taskType === "task" && (
                              <GanttBar
                                startDate={start}
                                endDate={end}
                                progress={task.progress}
                                color={phaseColor}
                                isCritical={isCritical}
                                taskName={task.name}
                                timelineStartMs={timelineStartMs}
                                timelineEndMs={timelineEndMs}
                                onDragEnd={(newStart, newEnd) => handleDragEnd(task.id, newStart, newEnd)}
                                onClick={() => onClickTask(task)}
                              />
                            )}

                            {/* Milestone marker */}
                            {start && task.taskType === "milestone" && (
                              <div
                                className="absolute top-2 z-20"
                                style={{
                                  left: `${(((start.getTime() - timelineStartMs) / (timelineEndMs - timelineStartMs || 1)) * 100).toFixed(2)}%`,
                                  transform: "translateX(-50%)",
                                }}
                              >
                                <MilestoneMarker
                                  color={isCritical ? "bg-red-500" : phaseColor.bg}
                                  size={14}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })}

            {/* Dependency lines SVG overlay */}
            <GanttDependencies
              dependencies={dependencies}
              tasks={tasks}
              taskRowPositions={taskRowPositions}
              timelineStartMs={timelineStartMs}
              timelineEndMs={timelineEndMs}
              leftPanelWidth={LEFT_PANEL_WIDTH}
              rowHeight={40}
              criticalTaskIds={criticalTaskIds}
              showCriticalPath={showCriticalPath}
            />
          </div>

          {/* Summary row */}
          <div className="flex bg-panel2/20 border-t border-line">
            <div
              className="shrink-0 border-r border-line px-4 py-2.5"
              style={{ width: LEFT_PANEL_WIDTH }}
            >
              <span className="text-xs font-medium text-fg/50">
                {tasks.length} task{tasks.length !== 1 ? "s" : ""}
                {" \u00B7 "}
                {phases.length} phase{phases.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="relative flex-1 py-2.5">
              <GridLines columns={columns} minColWidth={minColWidth} />
              {todayPos && <TodayMarker left={todayPos} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Small sub-components ─── */

function GridLines({ columns, minColWidth }: { columns: TimelineColumn[]; minColWidth: number }) {
  return (
    <div className="absolute inset-0 flex pointer-events-none">
      {columns.map((col, idx) => (
        <div
          key={idx}
          className={cn("flex-1 border-r border-line/30", col.isToday && "bg-accent/5")}
          style={{ minWidth: minColWidth }}
        />
      ))}
    </div>
  );
}

function TodayMarker({ left }: { left: string }) {
  return <div className="absolute top-0 bottom-0 w-0.5 bg-accent/60 z-10 pointer-events-none" style={{ left }} />;
}
