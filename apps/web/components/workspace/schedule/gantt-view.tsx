"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectPhase, ScheduleCalendar, ScheduleDependency, ScheduleTask, ScheduleTaskPatchInput } from "@/lib/api";
import type { ScheduleInsights, TimelineColumn, ZoomLevel } from "@/lib/schedule-utils";
import {
  PHASE_COLORS,
  addDays,
  buildTaskHierarchyInfo,
  buildTimelineHeaderBands,
  computePhaseDatesFromTasks,
  diffDays,
  formatShortDate,
  formatISODate,
  generateColumns,
  getBarPosition,
  getSummaryTaskIds,
  getTaskVariance,
  getTimelineBounds,
  getTodayPosition,
  getVisibleTasks,
  groupTasksByPhase,
  parseDate,
  startOfMonth,
  todayDate,
} from "@/lib/schedule-utils";
import { GanttBar } from "./gantt-bar";
import { GanttDependencies } from "./gantt-dependencies";
import { MilestoneMarker } from "./milestone-marker";

interface GanttViewProps {
  tasks: ScheduleTask[];
  dependencies: ScheduleDependency[];
  insights: ScheduleInsights;
  phases: ProjectPhase[];
  calendar: ScheduleCalendar | null;
  zoomLevel: ZoomLevel;
  scrollOffset: number;
  dateWorkStart: string | null;
  dateWorkEnd: string | null;
  criticalTaskIds: Set<string>;
  showCriticalPath: boolean;
  showBaseline: boolean;
  onUpdateTask: (taskId: string, patch: ScheduleTaskPatchInput) => void | Promise<boolean>;
  onReorderTask: (
    taskId: string,
    targetTaskId: string,
    placement: "before" | "after" | "inside",
    depth?: number
  ) => void | Promise<boolean>;
  onClickTask: (task: ScheduleTask) => void;
  onContextMenu?: (e: React.MouseEvent, task: ScheduleTask) => void;
}

const COL_MIN_WIDTH: Record<ZoomLevel, number> = { day: 56, week: 88, month: 120 };
const DEFAULT_LEFT_PANEL_WIDTH = 620;
const MIN_LEFT_PANEL_WIDTH = 360;
const MAX_LEFT_PANEL_WIDTH = 860;
const SPLITTER_WIDTH = 4;
const HEADER_BAND_HEIGHT = 34;
const HEADER_ROW_HEIGHT = 40;
const PHASE_ROW_HEIGHT = 40;
const TASK_ROW_HEIGHT = 56;
const FOOTER_HEIGHT = 44;
const TREE_INDENT = 18;
const TREE_DROP_OFFSET = 20;

export function GanttView({
  tasks,
  dependencies,
  insights,
  phases,
  calendar,
  zoomLevel,
  scrollOffset,
  dateWorkStart,
  dateWorkEnd,
  criticalTaskIds,
  showCriticalPath,
  showBaseline,
  onUpdateTask,
  onReorderTask,
  onClickTask,
  onContextMenu,
}: GanttViewProps) {
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set());
  const [leftPanelWidth, setLeftPanelWidth] = useState(DEFAULT_LEFT_PANEL_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    taskId: string;
    placement: "before" | "after" | "inside";
    depth: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(DEFAULT_LEFT_PANEL_WIDTH);
  const panStartX = useRef(0);
  const panStartScrollLeft = useRef(0);
  const suppressTimelineClickRef = useRef(false);
  const draggingTaskIdRef = useRef<string | null>(null);

  const clampLeftPanelWidth = useCallback((nextWidth: number) => {
    const containerWidth = containerRef.current?.clientWidth ?? 0;
    const maxFromContainer =
      containerWidth > 0 ? Math.min(MAX_LEFT_PANEL_WIDTH, Math.max(MIN_LEFT_PANEL_WIDTH, containerWidth - 320)) : MAX_LEFT_PANEL_WIDTH;
    return Math.max(MIN_LEFT_PANEL_WIDTH, Math.min(maxFromContainer, nextWidth));
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setLeftPanelWidth((current) => clampLeftPanelWidth(current));
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampLeftPanelWidth]);

  const timelineRange = useMemo(() => {
    const rawStart = parseDate(dateWorkStart) ?? todayDate();
    const rawEnd = parseDate(dateWorkEnd) ?? addDays(rawStart, 90);
    if (zoomLevel === "month") {
      const monthAnchor = startOfMonth(addDays(rawStart, scrollOffset));
      const monthStart = startOfMonth(addDays(monthAnchor, -31));
      const projectEnd = new Date(rawEnd.getFullYear(), rawEnd.getMonth() + 1, 1, 12, 0, 0, 0);
      const todayFutureEnd = new Date(todayDate().getFullYear(), todayDate().getMonth() + 13, 1, 12, 0, 0, 0);
      const minimumFutureEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 18, 1, 12, 0, 0, 0);
      const monthEnd = [projectEnd, todayFutureEnd, minimumFutureEnd].reduce((latest, candidate) =>
        candidate.getTime() > latest.getTime() ? candidate : latest
      );
      return { start: monthStart, end: monthEnd };
    }
    const start = addDays(rawStart, -7 + scrollOffset);
    const end = addDays(rawEnd, 14 + scrollOffset);
    return { start, end };
  }, [dateWorkEnd, dateWorkStart, scrollOffset, zoomLevel]);

  const columns = useMemo(
    () => generateColumns(timelineRange.start, timelineRange.end, zoomLevel, calendar),
    [calendar, timelineRange.end, timelineRange.start, zoomLevel]
  );

  const timelineBounds = useMemo(() => getTimelineBounds(columns, zoomLevel), [columns, zoomLevel]);
  const headerBands = useMemo(() => buildTimelineHeaderBands(columns), [columns]);
  const phaseDates = useMemo(() => computePhaseDatesFromTasks(tasks, phases), [tasks, phases]);
  const groups = useMemo(() => groupTasksByPhase(tasks, phases, phaseDates), [tasks, phases, phaseDates]);
  const displayGroups = useMemo(
    () =>
      groups.map((group) => ({
        ...group,
        hierarchyInfo: buildTaskHierarchyInfo(group.tasks),
        summaryTaskIds: getSummaryTaskIds(group.tasks),
        visibleTasks: getVisibleTasks(group.tasks, collapsedTaskIds),
      })),
    [collapsedTaskIds, groups]
  );
  const todayPos = useMemo(
    () => getTodayPosition(timelineBounds.startMs, timelineBounds.endMs),
    [timelineBounds.endMs, timelineBounds.startMs]
  );

  const togglePhase = useCallback((phaseId: string) => {
    setCollapsedPhases((previous) => {
      const next = new Set(previous);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  }, []);

  const toggleTask = useCallback((taskId: string) => {
    setCollapsedTaskIds((previous) => {
      const next = new Set(previous);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const barStyle = useCallback(
    (startDate: Date, endDate: Date) => {
      const { left, width } = getBarPosition(startDate, endDate, timelineBounds.startMs, timelineBounds.endMs);
      return {
        left: `${(left * 100).toFixed(2)}%`,
        width: `${(width * 100).toFixed(2)}%`,
      };
    },
    [timelineBounds.endMs, timelineBounds.startMs]
  );

  const timelineLayout = useMemo(() => {
    const taskRowCenters = new Map<string, number>();
    let y = 0;

    for (const group of displayGroups) {
      if (group.phase) {
        y += PHASE_ROW_HEIGHT;
      }

      const isCollapsed = group.phase ? collapsedPhases.has(group.phase.id) : false;
      if (!isCollapsed) {
        for (const task of group.visibleTasks) {
          taskRowCenters.set(task.id, y + TASK_ROW_HEIGHT / 2);
          y += TASK_ROW_HEIGHT;
        }
      }
    }

    return { taskRowCenters, bodyHeight: y };
  }, [collapsedPhases, displayGroups]);

  const minColWidth = COL_MIN_WIDTH[zoomLevel];
  const timelineWidth = columns.length * minColWidth;

  const handleDragEnd = useCallback(
    (taskId: string, newStart: Date, newEnd: Date) => {
      return onUpdateTask(taskId, {
        startDate: formatISODate(newStart),
        endDate: formatISODate(newEnd),
        duration: diffDays(newEnd, newStart),
      });
    },
    [onUpdateTask]
  );

  const handleRowDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>, taskId: string, targetDepth: number) => {
      const activeTaskId =
        draggingTaskIdRef.current ?? draggingTaskId ?? event.dataTransfer.getData("text/plain") ?? null;
      if (!activeTaskId || activeTaskId === taskId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const relativeY = event.clientY - rect.top;
      const treeCell = event.currentTarget.querySelector<HTMLElement>("[data-schedule-tree-cell]");
      const treeRect = treeCell?.getBoundingClientRect() ?? rect;
      const relativeTreeX = Math.max(0, event.clientX - treeRect.left);
      const depth = Math.max(0, Math.min(12, Math.round((relativeTreeX - TREE_DROP_OFFSET) / TREE_INDENT)));
      const placement =
        relativeY > rect.height * 0.28 &&
        relativeY < rect.height * 0.72 &&
        relativeTreeX >= TREE_DROP_OFFSET + targetDepth * TREE_INDENT + 12
          ? "inside"
          : relativeY < rect.height / 2
            ? "before"
            : "after";
      setDropTarget({ taskId, placement, depth });
    },
    [draggingTaskId]
  );

  const handleRowDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>, taskId: string) => {
      event.preventDefault();
      event.stopPropagation();
      const activeTaskId =
        draggingTaskIdRef.current ?? draggingTaskId ?? event.dataTransfer.getData("text/plain") ?? null;
      if (!activeTaskId || !dropTarget || dropTarget.taskId !== taskId) return;
      const didMove = await onReorderTask(activeTaskId, taskId, dropTarget.placement, dropTarget.depth);
      if (didMove !== false) {
        setDraggingTaskId(null);
        draggingTaskIdRef.current = null;
        setDropTarget(null);
      }
    },
    [draggingTaskId, dropTarget, onReorderTask]
  );

  const handleSplitPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      resizeStartX.current = event.clientX;
      resizeStartWidth.current = leftPanelWidth;
      setIsResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handleMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - resizeStartX.current;
        setLeftPanelWidth(clampLeftPanelWidth(resizeStartWidth.current + delta));
      };

      const handleUp = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setIsResizing(false);
      };

      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp, { once: true });
    },
    [clampLeftPanelWidth, leftPanelWidth]
  );

  const handleTimelinePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-testid^="gantt-bar-"]')) return;

    const region = scrollRegionRef.current;
    if (!region || region.scrollWidth <= region.clientWidth) return;

    event.preventDefault();
    panStartX.current = event.clientX;
    panStartScrollLeft.current = region.scrollLeft;
    suppressTimelineClickRef.current = false;
    setIsPanning(true);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - panStartX.current;
      if (Math.abs(delta) > 3) {
        suppressTimelineClickRef.current = true;
      }
      region.scrollLeft = panStartScrollLeft.current - delta;
    };

    const handleUp = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsPanning(false);
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp, { once: true });
  }, []);

  const handleTimelinePhaseClick = useCallback(
    (phaseId: string) => {
      if (suppressTimelineClickRef.current) {
        suppressTimelineClickRef.current = false;
        return;
      }
      togglePhase(phaseId);
    },
    [togglePhase]
  );

  return (
    <div className="overflow-hidden rounded-b-lg rounded-t-none border border-line border-t-0 bg-panel">
      <div
        ref={containerRef}
        className="grid min-w-0"
        style={{ gridTemplateColumns: `${leftPanelWidth}px ${SPLITTER_WIDTH}px minmax(0, 1fr)` }}
      >
        <div className="bg-panel" data-testid="gantt-left-panel">
          <div className="sticky top-0 z-30 bg-panel">
            <div
              className="flex items-center border-b border-line bg-panel2/40 px-4"
              style={{ height: HEADER_BAND_HEIGHT }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-fg/45">Schedule</span>
            </div>
            <div
              className="flex items-center border-b border-line bg-panel2/25 px-4"
              style={{ height: HEADER_ROW_HEIGHT }}
            >
              <div
                className="grid w-full items-center gap-3"
                style={{ gridTemplateColumns: "minmax(0,2.3fr) 78px 78px 54px 60px" }}
              >
                <span className="text-xs font-medium text-fg/55">Task</span>
                <span className="text-xs font-medium text-fg/45">Start</span>
                <span className="text-xs font-medium text-fg/45">Finish</span>
                <span className="text-xs font-medium text-fg/45">Dur</span>
                <span className="text-xs font-medium text-fg/45">Float</span>
              </div>
            </div>
          </div>

          <div>
            {displayGroups.map((group, groupIndex) => {
              const phase = group.phase;
              const isCollapsed = phase ? collapsedPhases.has(phase.id) : false;
              const phaseColor = PHASE_COLORS[groupIndex % PHASE_COLORS.length];

              return (
                <div key={phase?.id ?? "standalone"}>
                  {phase ? (
                    <div
                      className="flex cursor-pointer items-center gap-2 border-b border-line/50 bg-panel2/20 px-3 transition-colors hover:bg-panel2/35"
                      style={{ height: PHASE_ROW_HEIGHT }}
                      onClick={() => togglePhase(phase.id)}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg/40" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg/40" />
                      )}
                      <div className={cn("h-2.5 w-2.5 shrink-0 rounded-full", phaseColor.bg)} />
                      <span className="truncate text-xs font-semibold text-fg/70">
                        {phase.number ? `${phase.number}. ` : ""}
                        {phase.name}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-fg/30">
                        {group.tasks.length} task{group.tasks.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  ) : null}

                  {!isCollapsed &&
                    group.visibleTasks.map((task) => {
                      const variance = getTaskVariance(task);
                      const totalFloat = insights.totalFloatByTask.get(task.id);
                      const isOverdue = insights.overdueTaskIds.has(task.id);
                      const hasLogicIssue = insights.violatingTaskIds.has(task.id);
                      const hasDeadlineRisk = insights.deadlineMissTaskIds.has(task.id);
                      const hasConstraintRisk = insights.constraintViolationTaskIds.has(task.id);
                      const hasResourceRisk = insights.resourceConflictTaskIds.has(task.id);
                      const isCriticalTask = insights.criticalTaskIds.has(task.id);
                      const hierarchy = group.hierarchyInfo.get(task.id);
                      const depth = hierarchy?.depth ?? task.outlineLevel ?? 0;
                      const hasChildren = hierarchy?.hasChildren ?? false;
                      const isSummaryTask = group.summaryTaskIds.has(task.id);
                      const isTaskCollapsed = collapsedTaskIds.has(task.id);
                      const isDropBefore = dropTarget?.taskId === task.id && dropTarget.placement === "before";
                      const isDropAfter = dropTarget?.taskId === task.id && dropTarget.placement === "after";
                      const isDropInside = dropTarget?.taskId === task.id && dropTarget.placement === "inside";
                      const start = parseDate(task.startDate);
                      const end = parseDate(task.endDate);
                      const duration = start && end ? diffDays(end, start) : task.duration;

                      return (
                        <div
                          key={task.id}
                          className={cn(
                            "grid cursor-pointer items-center gap-3 border-b border-line/30 bg-panel px-4 py-2 transition-colors hover:bg-panel2/10",
                            draggingTaskId === task.id && "opacity-55",
                            isDropBefore && "border-t-2 border-t-accent",
                            isDropAfter && "border-b-2 border-b-accent",
                            isDropInside && "bg-accent/5 shadow-[inset_3px_0_0_0_theme(colors.accent.DEFAULT)]"
                          )}
                          style={{ height: TASK_ROW_HEIGHT, gridTemplateColumns: "minmax(0,2.3fr) 78px 78px 54px 60px" }}
                          onClick={() => onClickTask(task)}
                          onContextMenu={onContextMenu ? (event) => onContextMenu(event, task) : undefined}
                          onDragOver={(event) => handleRowDragOver(event, task.id, depth)}
                          onDragEnter={(event) => handleRowDragOver(event, task.id, depth)}
                          onDragLeave={() => {
                            if (dropTarget?.taskId === task.id) {
                              setDropTarget(null);
                            }
                          }}
                          onDrop={(event) => void handleRowDrop(event, task.id)}
                        >
                          <div
                            data-schedule-tree-cell="true"
                            className="min-w-0"
                            style={{ paddingLeft: `${depth * TREE_INDENT + (phase ? 6 : 0)}px` }}
                          >
                            <div className="flex items-start gap-2">
                              <button
                                type="button"
                                draggable
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("text/plain", task.id);
                                  setDraggingTaskId(task.id);
                                  draggingTaskIdRef.current = task.id;
                                  setDropTarget(null);
                                }}
                                onDragEnd={() => {
                                  setDraggingTaskId(null);
                                  draggingTaskIdRef.current = null;
                                  setDropTarget(null);
                                }}
                                onClick={(event) => event.stopPropagation()}
                                className="mt-0.5 shrink-0 text-fg/25 transition-colors hover:text-fg/55"
                                aria-label={`Reorder ${task.name || "task"}`}
                                title="Drag to reorder. Move right to nest under a task, or left to pull back out."
                              >
                                <GripVertical className="h-3.5 w-3.5" />
                              </button>

                              {hierarchy?.hasChildren ? (
                                <button
                                  type="button"
                                  className="mt-0.5 shrink-0 text-fg/40 transition-colors hover:text-fg/70"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleTask(task.id);
                                  }}
                                  aria-label={`${isTaskCollapsed ? "Expand" : "Collapse"} ${task.name || "task"}`}
                                >
                                  {isTaskCollapsed ? (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : task.taskType === "milestone" ? (
                                <div className="pt-1">
                                  <MilestoneMarker color={phaseColor.bg} size={8} />
                                </div>
                              ) : (
                                <div className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", phaseColor.bg)} />
                              )}

                              <div className="min-w-0 flex-1">
                                <span className="block truncate text-xs text-fg/70">{task.name || "Untitled"}</span>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-fg/35">
                                  {isSummaryTask ? <span className="rounded-full bg-panel2 px-1.5 py-0.5">Summary</span> : null}
                                  {hierarchy?.hasChildren ? (
                                    <span className="rounded-full bg-panel2 px-1.5 py-0.5">
                                      {hierarchy.childCount} child{hierarchy.childCount === 1 ? "" : "ren"}
                                    </span>
                                  ) : null}
                                  {task.assignee ? <span className="truncate">{task.assignee}</span> : null}
                                  {typeof totalFloat === "number" && Number.isFinite(totalFloat) ? (
                                    <span
                                      className={cn(
                                        "rounded-full px-1.5 py-0.5",
                                        totalFloat <= 0 ? "bg-danger/10 text-danger" : "bg-panel2 text-fg/45"
                                      )}
                                    >
                                      {Math.round(totalFloat)}d float
                                    </span>
                                  ) : null}
                                  {variance.isBehind ? (
                                    <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-warning">
                                      +{Math.max(variance.finishDays ?? 0, variance.startDays ?? 0)}d slip
                                    </span>
                                  ) : null}
                                  {variance.isAhead ? (
                                    <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-success">
                                      {Math.min(variance.finishDays ?? 0, variance.startDays ?? 0)}d ahead
                                    </span>
                                  ) : null}
                                  {isOverdue ? <span className="rounded-full bg-danger/10 px-1.5 py-0.5 text-danger">Overdue</span> : null}
                                  {hasLogicIssue ? <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-warning">Logic</span> : null}
                                  {hasDeadlineRisk ? <span className="rounded-full bg-danger/10 px-1.5 py-0.5 text-danger">Deadline</span> : null}
                                  {hasConstraintRisk ? <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-warning">Constraint</span> : null}
                                  {hasResourceRisk ? <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-warning">Resource</span> : null}
                                  {isCriticalTask ? <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-accent">Critical</span> : null}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="text-xs text-fg/55">{start ? formatShortDate(start) : "\u2014"}</div>
                          <div className="text-xs text-fg/55">{end ? formatShortDate(end) : "\u2014"}</div>
                          <div className="text-xs text-fg/55">{duration > 0 ? `${duration}d` : task.taskType === "milestone" ? "MS" : "\u2014"}</div>
                          <div className="text-xs text-fg/55">
                            {typeof totalFloat === "number" && Number.isFinite(totalFloat) ? `${Math.round(totalFloat)}d` : "\u2014"}
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>

          <div
            className="flex items-center border-t border-line bg-panel2/20 px-4"
            style={{ height: FOOTER_HEIGHT }}
          >
            <span className="text-xs font-medium text-fg/50">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""} · {phases.length} phase{phases.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        <div
          data-testid="gantt-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize schedule split"
          className="group relative self-stretch cursor-col-resize"
          style={{ minHeight: timelineLayout.bodyHeight + HEADER_BAND_HEIGHT + HEADER_ROW_HEIGHT + FOOTER_HEIGHT }}
          onPointerDown={handleSplitPointerDown}
        >
          <div
            className={cn(
              "absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-line/70 transition-colors group-hover:bg-accent/80",
              isResizing && "bg-accent"
            )}
          />
        </div>

        <div
          ref={scrollRegionRef}
          data-testid="gantt-scroll-region"
          className={cn(
            "min-w-0 overflow-x-scroll overflow-y-hidden select-none",
            isPanning ? "cursor-grabbing" : "cursor-grab"
          )}
          onPointerDown={handleTimelinePointerDown}
        >
          <div style={{ width: timelineWidth }}>
            <div className="sticky top-0 z-20 bg-panel">
              <div
                className="flex border-b border-line bg-panel2/40"
                style={{ height: HEADER_BAND_HEIGHT }}
              >
                {headerBands.map((band) => (
                  <div
                    key={band.key}
                    className="flex items-center justify-center border-r border-line/50 px-2 text-center"
                    style={{ width: band.span * minColWidth }}
                  >
                    <span className="text-[11px] font-medium text-fg/55">{band.label}</span>
                  </div>
                ))}
              </div>

              <div
                className="relative flex border-b border-line bg-panel2/25"
                style={{ height: HEADER_ROW_HEIGHT }}
              >
                {columns.map((column, index) => (
                  <HeaderColumn
                    key={`${column.groupKey}-${index}`}
                    column={column}
                    minColWidth={minColWidth}
                    index={index}
                  />
                ))}
                {todayPos ? <TodayMarker left={todayPos} /> : null}
              </div>
            </div>

            <div className="relative" style={{ height: timelineLayout.bodyHeight }}>
              <GridLines columns={columns} minColWidth={minColWidth} />
              {todayPos ? <TodayMarker left={todayPos} /> : null}

              <div className="relative z-10">
                {displayGroups.map((group, groupIndex) => {
                  const phase = group.phase;
                  const isCollapsed = phase ? collapsedPhases.has(phase.id) : false;
                  const phaseColor = PHASE_COLORS[groupIndex % PHASE_COLORS.length];
                  const dates = group.phaseDates;

                  return (
                    <div key={phase?.id ?? "standalone"}>
                      {phase ? (
                        <div
                          className="relative cursor-pointer border-b border-line/50 bg-panel2/10 transition-colors hover:bg-panel2/20"
                          style={{ height: PHASE_ROW_HEIGHT }}
                          onClick={() => handleTimelinePhaseClick(phase.id)}
                        >
                          {dates ? (
                            <div
                              className={cn("absolute left-0 h-4 rounded opacity-30", phaseColor.bg)}
                              style={{
                                ...barStyle(dates.startDate, dates.endDate),
                                top: `calc(50% - 8px)`,
                              }}
                            />
                          ) : null}
                        </div>
                      ) : null}

                      {!isCollapsed &&
                        group.visibleTasks.map((task) => {
                          const start = parseDate(task.startDate);
                          const end = parseDate(task.endDate);
                          const baselineStart = parseDate(task.baselineStart);
                          const baselineEnd = parseDate(task.baselineEnd);
                          const isCritical = showCriticalPath && criticalTaskIds.has(task.id);
                          const hasChildren = group.hierarchyInfo.get(task.id)?.hasChildren ?? false;
                          const isSummaryTask = group.summaryTaskIds.has(task.id);

                          return (
                            <div
                              key={task.id}
                              className="relative border-b border-line/30 transition-colors hover:bg-panel2/10"
                              style={{ height: TASK_ROW_HEIGHT }}
                              onContextMenu={onContextMenu ? (event) => onContextMenu(event, task) : undefined}
                            >
                              {showBaseline && baselineStart && baselineEnd ? (
                                <div
                                  className="absolute h-3 rounded border border-dashed border-fg/20 bg-fg/5"
                                  style={{
                                    ...barStyle(baselineStart, baselineEnd),
                                    top: `calc(50% - 6px)`,
                                  }}
                                />
                              ) : null}

                              {start && end && task.taskType !== "milestone" ? (
                                <GanttBar
                                  taskId={task.id}
                                  startDate={start}
                                  endDate={end}
                                  progress={task.progress}
                                  color={phaseColor}
                                  isCritical={isCritical}
                                  taskName={task.name}
                                  timelineStartMs={timelineBounds.startMs}
                                  timelineEndMs={timelineBounds.endMs}
                                  variant={isSummaryTask ? "summary" : "task"}
                                  isDraggable={!hasChildren}
                                  onDragEnd={(newStart, newEnd) => handleDragEnd(task.id, newStart, newEnd)}
                                  onClick={() => onClickTask(task)}
                                />
                              ) : null}

                              {start && task.taskType === "milestone" ? (
                                <div
                                  className="absolute top-1/2 z-20 -translate-y-1/2"
                                  style={{
                                    left: `${(((start.getTime() - timelineBounds.startMs) / (timelineBounds.endMs - timelineBounds.startMs || 1)) * 100).toFixed(2)}%`,
                                    transform: "translate(-50%, -50%)",
                                  }}
                                >
                                  <MilestoneMarker color={isCritical ? "bg-red-500" : phaseColor.bg} size={14} />
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                    </div>
                  );
                })}
              </div>

              <GanttDependencies
                dependencies={dependencies}
                tasks={tasks}
                taskRowCenters={timelineLayout.taskRowCenters}
                timelineStartMs={timelineBounds.startMs}
                timelineEndMs={timelineBounds.endMs}
                svgHeight={timelineLayout.bodyHeight}
                criticalTaskIds={criticalTaskIds}
                violatingDependencyIds={insights.violatingDependencyIds}
                showCriticalPath={showCriticalPath}
              />
            </div>

            <div
              className="relative border-t border-line bg-panel2/20"
              style={{ height: FOOTER_HEIGHT }}
            >
              <GridLines columns={columns} minColWidth={minColWidth} />
              {todayPos ? <TodayMarker left={todayPos} /> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeaderColumn({
  column,
  minColWidth,
  index,
}: {
  column: TimelineColumn;
  minColWidth: number;
  index: number;
}) {
  return (
    <div
      data-testid={`gantt-header-column-${index}`}
      className={cn(
        "flex shrink-0 flex-col justify-center border-r border-line/50 px-1 py-1.5 text-center",
        column.isToday && "bg-accent/5",
        column.isNonWorking && "bg-panel2/30"
      )}
      style={{ width: minColWidth }}
    >
      <span className={cn("text-[11px] font-medium leading-tight", column.isToday ? "text-accent" : "text-fg/55")}>
        {column.label}
      </span>
      {column.subLabel ? (
        <span className="mt-0.5 text-[10px] leading-tight text-fg/30">{column.subLabel}</span>
      ) : null}
    </div>
  );
}

function GridLines({ columns, minColWidth }: { columns: TimelineColumn[]; minColWidth: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex">
      {columns.map((column, index) => (
        <div
          key={`${column.groupKey}-${index}`}
          className={cn(
            "shrink-0 border-r border-line/30",
            column.isToday && "bg-accent/5",
            column.isNonWorking && "bg-panel2/25"
          )}
          style={{ width: minColWidth }}
        />
      ))}
    </div>
  );
}

function TodayMarker({ left }: { left: string }) {
  return <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 bg-accent/60" style={{ left }} />;
}
