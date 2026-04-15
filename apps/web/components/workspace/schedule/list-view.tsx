"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, GripVertical, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type {
  ProjectPhase,
  ScheduleResource,
  ScheduleTask,
  ScheduleTaskAssignment,
  ScheduleTaskPatchInput,
  ScheduleTaskStatus,
} from "@/lib/api";
import type { ScheduleInsights } from "@/lib/schedule-utils";
import {
  STATUS_LABELS,
  STATUS_COLORS,
  buildTaskHierarchyInfo,
  computePhaseDatesFromTasks,
  diffDays,
  formatShortDate,
  getSummaryTaskIds,
  getTaskVariance,
  getVisibleTasks,
  groupTasksByPhase,
  parseDate,
  PHASE_COLORS,
} from "@/lib/schedule-utils";

interface ListViewProps {
  tasks: ScheduleTask[];
  insights: ScheduleInsights;
  phases: ProjectPhase[];
  resources: ScheduleResource[];
  taskAssignmentsByTaskId: Map<string, ScheduleTaskAssignment[]>;
  onUpdateTask: (taskId: string, patch: ScheduleTaskPatchInput) => void | Promise<boolean>;
  onBatchUpdateTasks: (updates: Array<{ id: string } & ScheduleTaskPatchInput>) => void | Promise<boolean>;
  onDeleteTask: (taskId: string) => void | Promise<boolean>;
  onReorderTask: (
    taskId: string,
    targetTaskId: string,
    placement: "before" | "after" | "inside",
    depth?: number
  ) => void | Promise<boolean>;
  onClickTask: (task: ScheduleTask) => void;
  onContextMenu?: (e: React.MouseEvent, task: ScheduleTask) => void;
}

type SortKey =
  | "order"
  | "name"
  | "status"
  | "startDate"
  | "endDate"
  | "progress"
  | "assignee"
  | "variance"
  | "float";
type SortDir = "asc" | "desc";

const TREE_INDENT = 18;
const TREE_DROP_OFFSET = 20;

export function ListView({
  tasks,
  insights,
  phases,
  resources,
  taskAssignmentsByTaskId,
  onUpdateTask,
  onBatchUpdateTasks,
  onDeleteTask,
  onReorderTask,
  onClickTask,
  onContextMenu,
}: ListViewProps) {
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("order");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set());
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    taskId: string;
    placement: "before" | "after" | "inside";
    depth: number;
  } | null>(null);
  const draggingTaskIdRef = useRef<string | null>(null);

  const phaseDates = useMemo(() => computePhaseDatesFromTasks(tasks, phases), [tasks, phases]);
  const groups = useMemo(() => groupTasksByPhase(tasks, phases, phaseDates), [tasks, phases, phaseDates]);
  const resourceById = useMemo(() => new Map(resources.map((resource) => [resource.id, resource])), [resources]);
  const visibleSummary = useMemo(
    () => ({
      critical: tasks.filter((task) => insights.criticalTaskIds.has(task.id)).length,
      overdue: tasks.filter((task) => insights.overdueTaskIds.has(task.id)).length,
      slip: tasks.filter((task) => insights.behindBaselineTaskIds.has(task.id)).length,
      issues: tasks.filter((task) => insights.attentionTaskIds.has(task.id)).length,
    }),
    [insights.attentionTaskIds, insights.behindBaselineTaskIds, insights.criticalTaskIds, insights.overdueTaskIds, tasks]
  );

  const sortedGroups = useMemo(() => {
    return groups.map((group) => ({
      ...group,
      tasks:
        sortKey === "order"
          ? [...group.tasks]
          : [...group.tasks].sort((a, b) => {
              const aVariance = getTaskVariance(a);
              const bVariance = getTaskVariance(b);
              const aFloat = insights.totalFloatByTask.get(a.id) ?? Number.POSITIVE_INFINITY;
              const bFloat = insights.totalFloatByTask.get(b.id) ?? Number.POSITIVE_INFINITY;

              let cmp = 0;
              if (sortKey === "name") cmp = a.name.localeCompare(b.name);
              else if (sortKey === "status") cmp = a.status.localeCompare(b.status);
              else if (sortKey === "startDate") cmp = (a.startDate ?? "").localeCompare(b.startDate ?? "");
              else if (sortKey === "endDate") cmp = (a.endDate ?? "").localeCompare(b.endDate ?? "");
              else if (sortKey === "progress") cmp = a.progress - b.progress;
              else if (sortKey === "assignee") cmp = a.assignee.localeCompare(b.assignee);
              else if (sortKey === "variance")
                cmp =
                  Math.max(aVariance.finishDays ?? 0, aVariance.startDays ?? 0) -
                  Math.max(bVariance.finishDays ?? 0, bVariance.startDays ?? 0);
              else if (sortKey === "float") cmp = aFloat - bFloat;

              return sortDir === "asc" ? cmp : -cmp;
            }),
      hierarchyInfo: buildTaskHierarchyInfo(group.tasks),
      summaryTaskIds: getSummaryTaskIds(group.tasks),
      visibleTasks: getVisibleTasks(group.tasks, collapsedTaskIds),
    }));
  }, [collapsedTaskIds, groups, insights.totalFloatByTask, sortDir, sortKey]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const togglePhase = (id: string) => {
    setCollapsedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTask = (id: string) => {
    setCollapsedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkStatusChange = async (status: ScheduleTaskStatus) => {
    const didUpdate = await onBatchUpdateTasks(
      Array.from(selectedIds).map((id) => ({
        id,
        status,
        ...(status === "complete" ? { progress: 1 } : {}),
      }))
    );
    if (didUpdate !== false) {
      setSelectedIds(new Set());
    }
  };

  const handleRowDragOver = (event: React.DragEvent<HTMLTableRowElement>, taskId: string, targetDepth: number) => {
    const activeTaskId = draggingTaskIdRef.current ?? draggingTaskId ?? event.dataTransfer.getData("text/plain") ?? null;
    if (!activeTaskId || activeTaskId === taskId || sortKey !== "order") return;
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
  };

  const handleRowDrop = async (event: React.DragEvent<HTMLTableRowElement>, taskId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const activeTaskId = draggingTaskIdRef.current ?? draggingTaskId ?? event.dataTransfer.getData("text/plain") ?? null;
    if (!activeTaskId || !dropTarget || dropTarget.taskId !== taskId || sortKey !== "order") return;
    const didMove = await onReorderTask(activeTaskId, taskId, dropTarget.placement, dropTarget.depth);
    if (didMove !== false) {
      setDraggingTaskId(null);
      draggingTaskIdRef.current = null;
      setDropTarget(null);
    }
  };

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <th
      className="cursor-pointer select-none px-3 py-2 text-left text-xs font-medium text-fg/50 transition-colors hover:text-fg/70"
      onClick={() => toggleSort(field)}
    >
      {label}
      {sortKey === field && <span className="ml-1">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>}
    </th>
  );

  return (
    <div className="overflow-hidden rounded-b-lg rounded-t-none border border-line border-t-0 bg-panel" data-testid="schedule-list">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel2/20 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg/45">
          <span className="rounded-full bg-bg/50 px-2 py-1">{tasks.length} visible</span>
          <span className="rounded-full bg-bg/50 px-2 py-1">{visibleSummary.critical} critical</span>
          <span className="rounded-full bg-bg/50 px-2 py-1">{visibleSummary.overdue} overdue</span>
          <span className="rounded-full bg-bg/50 px-2 py-1">{visibleSummary.slip} slip</span>
          <span className="rounded-full bg-bg/50 px-2 py-1">{visibleSummary.issues} issues</span>
        </div>
        <div className="text-[11px] text-fg/35">
          Bulk actions and row editing stay available in list mode for quick production planning updates.
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 border-b border-line bg-accent/5 px-4 py-2">
          <span className="text-xs text-fg/60">{selectedIds.size} selected</span>
          <Button variant="ghost" size="xs" onClick={() => void handleBulkStatusChange("in_progress")} data-testid="schedule-list-bulk-in-progress">
            Mark In Progress
          </Button>
          <Button variant="ghost" size="xs" onClick={() => void handleBulkStatusChange("complete")} data-testid="schedule-list-bulk-complete">
            Mark Complete
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-line bg-panel2/30">
              <th className="w-8 px-2 py-2" />
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  checked={selectedIds.size === tasks.length && tasks.length > 0}
                  onChange={() => {
                    if (selectedIds.size === tasks.length) setSelectedIds(new Set());
                    else setSelectedIds(new Set(tasks.map((task) => task.id)));
                  }}
                  className="rounded border-line"
                />
              </th>
              <SortHeader label="WBS" field="order" />
              <SortHeader label="Name" field="name" />
              <th className="px-3 py-2 text-left text-xs font-medium text-fg/50">Phase</th>
              <SortHeader label="Status" field="status" />
              <SortHeader label="Start" field="startDate" />
              <SortHeader label="End" field="endDate" />
              <th className="px-3 py-2 text-left text-xs font-medium text-fg/50">Deadline</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-fg/50">Duration</th>
              <SortHeader label="Variance" field="variance" />
              <SortHeader label="Float" field="float" />
              <th className="px-3 py-2 text-left text-xs font-medium text-fg/50">Resources</th>
              <SortHeader label="Progress" field="progress" />
              <SortHeader label="Assignee" field="assignee" />
              <th className="px-3 py-2 text-left text-xs font-medium text-fg/50">Flags</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {sortedGroups.map((group, groupIndex) => {
              const isCollapsed = group.phase ? collapsedPhases.has(group.phase.id) : false;
              const color = PHASE_COLORS[groupIndex % PHASE_COLORS.length];

              return (
                <Fragment key={group.phase?.id ?? "standalone"}>
                  {group.phase && (
                    <tr
                      className="cursor-pointer border-b border-line/50 bg-panel2/20 transition-colors hover:bg-panel2/30"
                      onClick={() => togglePhase(group.phase!.id)}
                    >
                      <td colSpan={17} className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5 text-fg/40" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 text-fg/40" />
                          )}
                          <div className={cn("h-2.5 w-2.5 rounded-full", color.bg)} />
                          <span className="text-xs font-semibold text-fg/70">
                            {group.phase.number ? `${group.phase.number}. ` : ""}
                            {group.phase.name}
                          </span>
                          <span className="ml-2 text-[11px] text-fg/30">
                            {group.tasks.length} task{group.tasks.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}

                  {!isCollapsed &&
                    group.visibleTasks.map((task) => {
                      const start = parseDate(task.startDate);
                      const end = parseDate(task.endDate);
                      const deadline = parseDate(task.deadlineDate);
                      const duration = start && end ? diffDays(end, start) : task.duration;
                      const variance = getTaskVariance(task);
                      const floatDays = insights.totalFloatByTask.get(task.id);
                      const resourceCount = (taskAssignmentsByTaskId.get(task.id) ?? []).length;
                      const hierarchy = group.hierarchyInfo.get(task.id);
                      const depth = hierarchy?.depth ?? task.outlineLevel ?? 0;
                      const isSummaryTask = group.summaryTaskIds.has(task.id);
                      const isTaskCollapsed = collapsedTaskIds.has(task.id);
                      const isDropBefore = dropTarget?.taskId === task.id && dropTarget.placement === "before";
                      const isDropAfter = dropTarget?.taskId === task.id && dropTarget.placement === "after";
                      const isDropInside = dropTarget?.taskId === task.id && dropTarget.placement === "inside";

                      return (
                        <tr
                          key={task.id}
                          data-testid={`schedule-list-row-${task.id}`}
                          className={cn(
                            "border-b border-line/30 transition-colors hover:bg-panel2/10",
                            draggingTaskId === task.id && "opacity-55",
                            isDropBefore && "border-t-2 border-t-accent",
                            isDropAfter && "border-b-2 border-b-accent",
                            isDropInside && "bg-accent/5 shadow-[inset_3px_0_0_0_theme(colors.accent.DEFAULT)]"
                          )}
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
                          <td className="px-2 py-2 text-center">
                            <button
                              type="button"
                              draggable={sortKey === "order"}
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
                              className="text-fg/25 transition-colors hover:text-fg/55"
                              aria-label={`Reorder ${task.name || "task"}`}
                              title={
                                sortKey === "order"
                                  ? "Drag to reorder. Move right to nest under a task, or left to pull back out."
                                  : "Switch back to WBS sort to reorder tasks"
                              }
                            >
                              <GripVertical className="h-3.5 w-3.5" />
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              data-testid={`schedule-list-select-${task.id}`}
                              type="checkbox"
                              checked={selectedIds.has(task.id)}
                              onChange={() => toggleSelect(task.id)}
                              className="rounded border-line"
                            />
                          </td>
                          <td className="px-3 py-2 text-[11px] text-fg/45">
                            {depth === 0 ? `${task.order}` : `${task.order}.L${depth}`}
                          </td>
                          <td
                            className="max-w-[280px] px-3 py-2 text-xs text-fg/80 transition-colors hover:text-accent"
                            onClick={() => onClickTask(task)}
                          >
                            <div
                              data-schedule-tree-cell="true"
                              className="flex cursor-pointer items-start gap-2"
                              style={{ paddingLeft: `${depth * TREE_INDENT}px` }}
                            >
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
                              ) : (
                                <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-fg/25" />
                              )}
                              <div className="min-w-0 flex-1">
                              <span className="line-clamp-2">{task.name || "Untitled"}</span>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-fg/35">
                                {isSummaryTask ? <span className="rounded-full bg-panel2 px-1.5 py-0.5">Summary</span> : null}
                                {hierarchy?.hasChildren ? (
                                  <span className="rounded-full bg-panel2 px-1.5 py-0.5">
                                    {hierarchy.childCount} child{hierarchy.childCount === 1 ? "" : "ren"}
                                  </span>
                                ) : null}
                                <span className="rounded-full bg-panel2 px-1.5 py-0.5">L{depth}</span>
                                {task.description ? <span className="line-clamp-1">{task.description}</span> : null}
                              </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {group.phase && (
                              <div className="flex items-center gap-1.5">
                                <div className={cn("h-2 w-2 rounded-full", color.bg)} />
                                <span className="max-w-24 truncate text-[11px] text-fg/40">{group.phase.name}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={STATUS_COLORS[task.status] as "default" | "success" | "warning" | "info"}>
                              {STATUS_LABELS[task.status]}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-xs text-fg/60">{start ? formatShortDate(start) : "\u2014"}</td>
                          <td className="px-3 py-2 text-xs text-fg/60">{end ? formatShortDate(end) : "\u2014"}</td>
                          <td className="px-3 py-2 text-xs text-fg/60">{deadline ? formatShortDate(deadline) : "\u2014"}</td>
                          <td className="px-3 py-2 text-xs text-fg/60">{duration > 0 ? `${duration}d` : task.taskType === "milestone" ? "MS" : "\u2014"}</td>
                          <td className="px-3 py-2 text-xs text-fg/60">
                            {variance.isBehind ? (
                              <span className="rounded-full bg-warning/10 px-2 py-1 text-warning">
                                +{Math.max(variance.finishDays ?? 0, variance.startDays ?? 0)}d
                              </span>
                            ) : variance.isAhead ? (
                              <span className="rounded-full bg-success/10 px-2 py-1 text-success">
                                {Math.min(variance.finishDays ?? 0, variance.startDays ?? 0)}d
                              </span>
                            ) : variance.hasVariance ? (
                              <span className="rounded-full bg-panel2 px-2 py-1 text-fg/45">On baseline</span>
                            ) : (
                              "\u2014"
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-fg/60">
                            {typeof floatDays === "number" && Number.isFinite(floatDays) ? `${Math.round(floatDays)}d` : "\u2014"}
                          </td>
                          <td className="px-3 py-2 text-xs text-fg/60">
                            {resourceCount > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {(taskAssignmentsByTaskId.get(task.id) ?? []).slice(0, 3).map((assignment) => {
                                  const resource = resourceById.get(assignment.resourceId);
                                  return (
                                    <span
                                      key={assignment.id}
                                      className="rounded-full bg-panel2 px-2 py-1 text-[10px] text-fg/55"
                                    >
                                      {resource?.name ?? assignment.role ?? "Resource"}
                                    </span>
                                  );
                                })}
                                {resourceCount > 3 ? (
                                  <span className="rounded-full bg-panel2 px-2 py-1 text-[10px] text-fg/40">
                                    +{resourceCount - 3}
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              "\u2014"
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
                                <div
                                  className="h-full rounded-full bg-accent"
                                  style={{ width: `${task.progress * 100}%` }}
                                />
                              </div>
                              <span className="text-[11px] text-fg/40">{Math.round(task.progress * 100)}%</span>
                            </div>
                          </td>
                          <td className="max-w-24 truncate px-3 py-2 text-xs text-fg/60">{task.assignee || "\u2014"}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {insights.criticalTaskIds.has(task.id) && <Badge tone="info">Critical</Badge>}
                              {insights.overdueTaskIds.has(task.id) && <Badge tone="danger">Overdue</Badge>}
                              {insights.violatingTaskIds.has(task.id) && <Badge tone="warning">Logic</Badge>}
                              {insights.openEndedTaskIds.has(task.id) && <Badge tone="warning">Open End</Badge>}
                              {insights.deadlineMissTaskIds.has(task.id) && <Badge tone="danger">Deadline</Badge>}
                              {insights.constraintViolationTaskIds.has(task.id) && <Badge tone="warning">Constraint</Badge>}
                              {insights.resourceConflictTaskIds.has(task.id) && <Badge tone="warning">Resource</Badge>}
                              {insights.actualDateGapTaskIds.has(task.id) && <Badge tone="warning">Actuals</Badge>}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1">
                              {task.status !== "in_progress" ? (
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  onClick={() => void onUpdateTask(task.id, { status: "in_progress" })}
                                  className="h-6 px-2 text-[10px]"
                                >
                                  Start
                                </Button>
                              ) : null}
                              {task.status !== "complete" ? (
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  onClick={() => void onUpdateTask(task.id, { status: "complete", progress: 1 })}
                                  className="h-6 px-2 text-[10px]"
                                >
                                  Done
                                </Button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => void onDeleteTask(task.id)}
                                className="text-fg/20 transition-colors hover:text-danger"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {tasks.length === 0 && (
        <div className="py-12 text-center text-sm text-fg/30">No schedule tasks match the current filters.</div>
      )}
    </div>
  );
}
