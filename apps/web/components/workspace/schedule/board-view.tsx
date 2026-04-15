"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui";
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
import { formatShortDate, getTaskVariance, parseDate, PHASE_COLORS, STATUS_LABELS } from "@/lib/schedule-utils";

interface BoardViewProps {
  tasks: ScheduleTask[];
  insights: ScheduleInsights;
  phases: ProjectPhase[];
  resources: ScheduleResource[];
  taskAssignmentsByTaskId: Map<string, ScheduleTaskAssignment[]>;
  onUpdateTask: (taskId: string, patch: ScheduleTaskPatchInput) => void | Promise<boolean>;
  onClickTask: (task: ScheduleTask) => void;
  onContextMenu?: (e: React.MouseEvent, task: ScheduleTask) => void;
}

const COLUMNS: ScheduleTaskStatus[] = ["not_started", "in_progress", "on_hold", "complete"];

const COLUMN_COLORS: Record<ScheduleTaskStatus, string> = {
  not_started: "border-t-fg/20",
  in_progress: "border-t-blue-400",
  on_hold: "border-t-amber-400",
  complete: "border-t-emerald-400",
};

export function BoardView({
  tasks,
  insights,
  phases,
  resources,
  taskAssignmentsByTaskId,
  onUpdateTask,
  onClickTask,
  onContextMenu,
}: BoardViewProps) {
  const phaseMap = useMemo(() => new Map(phases.map((phase) => [phase.id, phase])), [phases]);
  const phaseIndexById = useMemo(() => new Map(phases.map((phase, index) => [phase.id, index])), [phases]);
  const resourceById = useMemo(() => new Map(resources.map((resource) => [resource.id, resource])), [resources]);
  const childCountByTaskId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      if (!task.parentTaskId) continue;
      counts.set(task.parentTaskId, (counts.get(task.parentTaskId) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const tasksByStatus = useMemo(() => {
    const result: Record<ScheduleTaskStatus, ScheduleTask[]> = {
      not_started: [],
      in_progress: [],
      on_hold: [],
      complete: [],
    };

    for (const task of tasks) {
      result[task.status]?.push(task);
    }

    for (const status of COLUMNS) {
      result[status].sort((a, b) => {
        const aPhase = a.phaseId ? phaseIndexById.get(a.phaseId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        const bPhase = b.phaseId ? phaseIndexById.get(b.phaseId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        if (aPhase !== bPhase) return aPhase - bPhase;
        return (a.startDate ?? "").localeCompare(b.startDate ?? "");
      });
    }

    return result;
  }, [phaseIndexById, tasks]);

  const groupedTasksByStatus = useMemo(() => {
    const result = new Map<
      ScheduleTaskStatus,
      Array<{ key: string; phase: ProjectPhase | null; tasks: ScheduleTask[] }>
    >();

    for (const status of COLUMNS) {
      const groups = new Map<string, { key: string; phase: ProjectPhase | null; tasks: ScheduleTask[] }>();
      for (const task of tasksByStatus[status]) {
        const phase = task.phaseId ? phaseMap.get(task.phaseId) ?? null : null;
        const key = phase?.id ?? "unassigned";
        if (!groups.has(key)) {
          groups.set(key, { key, phase, tasks: [] });
        }
        groups.get(key)!.tasks.push(task);
      }

      result.set(
        status,
        Array.from(groups.values()).sort((a, b) => {
          const aIndex = a.phase ? phaseIndexById.get(a.phase.id) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
          const bIndex = b.phase ? phaseIndexById.get(b.phase.id) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
          return aIndex - bIndex;
        })
      );
    }

    return result;
  }, [phaseIndexById, phaseMap, tasksByStatus]);

  const handleDragStart = (event: React.DragEvent, taskId: string) => {
    event.dataTransfer.setData("text/plain", taskId);
    setDraggingId(taskId);
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (event: React.DragEvent, nextStatus: ScheduleTaskStatus) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain");
    if (!taskId) {
      setDraggingId(null);
      return;
    }

    const task = tasks.find((item) => item.id === taskId);
    if (task && task.status !== nextStatus) {
      const nextProgress =
        nextStatus === "complete"
          ? 1
          : nextStatus === "not_started"
            ? 0
            : task.progress >= 1
              ? 0.85
              : Math.max(task.progress, 0.1);
      void onUpdateTask(taskId, {
        status: nextStatus,
        progress: nextProgress,
      });
    }

    setDraggingId(null);
  };

  return (
    <div className="grid gap-3 xl:grid-cols-4" data-testid="schedule-board">
      {COLUMNS.map((status) => (
        <div
          key={status}
          data-testid={`schedule-board-column-${status}`}
          className={cn(
            "min-h-[300px] rounded-lg border border-line border-t-4 bg-panel2/20",
            COLUMN_COLORS[status]
          )}
          onDragOver={handleDragOver}
          onDrop={(event) => handleDrop(event, status)}
        >
          <div className="border-b border-line/50 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-fg/70">{STATUS_LABELS[status]}</span>
              <span className="rounded-full bg-bg/50 px-1.5 py-0.5 text-[11px] text-fg/30">
                {tasksByStatus[status].length}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-fg/35">
              <span className="rounded-full bg-bg/40 px-2 py-0.5">
                {tasksByStatus[status].filter((task) => insights.criticalTaskIds.has(task.id)).length} critical
              </span>
              <span className="rounded-full bg-bg/40 px-2 py-0.5">
                {tasksByStatus[status].filter((task) => insights.overdueTaskIds.has(task.id)).length} overdue
              </span>
              <span className="rounded-full bg-bg/40 px-2 py-0.5">
                {tasksByStatus[status].filter((task) => insights.attentionTaskIds.has(task.id)).length} issues
              </span>
            </div>
          </div>

          <div className="space-y-2 p-2">
            {(groupedTasksByStatus.get(status) ?? []).map((group) => (
              <div key={`${status}-${group.key}`} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-1.5">
                    {group.phase ? (
                      <>
                        <div
                          className={cn(
                            "h-2 w-2 rounded-full",
                            PHASE_COLORS[(phaseIndexById.get(group.phase.id) ?? 0) % PHASE_COLORS.length].bg
                          )}
                        />
                        <span className="text-[10px] font-medium text-fg/45">{group.phase.name}</span>
                      </>
                    ) : (
                      <span className="text-[10px] font-medium text-fg/35">Unassigned phase</span>
                    )}
                  </div>
                  <span className="text-[10px] text-fg/25">{group.tasks.length}</span>
                </div>

                {group.tasks.map((task) => {
                  const phase = task.phaseId ? phaseMap.get(task.phaseId) : null;
                  const phaseIndex = phase ? phaseIndexById.get(phase.id) ?? -1 : -1;
                  const color = phaseIndex >= 0 ? PHASE_COLORS[phaseIndex % PHASE_COLORS.length] : null;
                  const childCount = childCountByTaskId.get(task.id) ?? 0;
                  const isSummaryTask = task.taskType === "summary" || childCount > 0;
                  const isRollupSummary = childCount > 0;
                  const startDate = parseDate(task.startDate);
                  const endDate = parseDate(task.endDate);
                  const deadlineDate = parseDate(task.deadlineDate);
                  const variance = getTaskVariance(task);
                  const floatDays = insights.totalFloatByTask.get(task.id);
                  const assignments = taskAssignmentsByTaskId.get(task.id) ?? [];

                  return (
                    <div
                      key={task.id}
                      data-testid={`schedule-board-card-${task.id}`}
                      draggable={!isRollupSummary}
                      onDragStart={(event) => {
                        if (isRollupSummary) return;
                        handleDragStart(event, task.id);
                      }}
                      onDragEnd={() => setDraggingId(null)}
                      onClick={() => onClickTask(task)}
                      onContextMenu={onContextMenu ? (event) => onContextMenu(event, task) : undefined}
                      className={cn(
                        "cursor-pointer rounded-lg border border-line bg-panel p-3 transition-all hover:border-accent/30 hover:shadow-sm",
                        draggingId === task.id && "opacity-50"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        {phase && color ? (
                          <div className="mb-2 flex items-center gap-1.5">
                            <div className={cn("h-2 w-2 rounded-full", color.bg)} />
                            <span className="truncate text-[10px] text-fg/40">{phase.name}</span>
                          </div>
                        ) : (
                          <span />
                        )}
                        <div className="flex flex-wrap justify-end gap-1">
                          {isSummaryTask && <Badge tone="default">Summary</Badge>}
                          {childCount > 0 && <Badge tone="default">{childCount} child{childCount === 1 ? "" : "ren"}</Badge>}
                          {insights.criticalTaskIds.has(task.id) && <Badge tone="info">Critical</Badge>}
                          {assignments.length > 0 && <Badge tone="default">{assignments.length} res</Badge>}
                        </div>
                      </div>

                      <p className="mb-2 line-clamp-2 text-xs font-medium text-fg/80">{task.name || "Untitled"}</p>

                      {(startDate || endDate) && (
                        <p className="mb-2 text-[10px] text-fg/30">
                          {startDate ? formatShortDate(startDate) : "?"} - {endDate ? formatShortDate(endDate) : "?"}
                        </p>
                      )}

                      <div className="mb-2 flex flex-wrap gap-1 text-[10px] text-fg/35">
                        {deadlineDate ? (
                          <span className="rounded-full bg-bg/40 px-2 py-0.5">Due {formatShortDate(deadlineDate)}</span>
                        ) : null}
                        {typeof floatDays === "number" && Number.isFinite(floatDays) ? (
                          <span className="rounded-full bg-bg/40 px-2 py-0.5">{Math.round(floatDays)}d float</span>
                        ) : null}
                        {variance.isBehind ? (
                          <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">
                            +{Math.max(variance.finishDays ?? 0, variance.startDays ?? 0)}d slip
                          </span>
                        ) : null}
                      </div>

                      {assignments.length > 0 ? (
                        <div className="mb-2 flex flex-wrap gap-1">
                          {assignments.slice(0, 3).map((assignment) => (
                            <span
                              key={assignment.id}
                              className="rounded-full bg-panel2 px-2 py-1 text-[10px] text-fg/50"
                            >
                              {resourceById.get(assignment.resourceId)?.name ?? assignment.role ?? "Resource"}
                            </span>
                          ))}
                          {assignments.length > 3 ? (
                            <span className="rounded-full bg-panel2 px-2 py-1 text-[10px] text-fg/40">
                              +{assignments.length - 3}
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      {task.progress > 0 && (
                        <div className="mb-2">
                          <div className="h-1 w-full overflow-hidden rounded-full bg-line">
                            <div
                              className="h-full rounded-full bg-accent"
                              style={{ width: `${task.progress * 100}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-1">
                        {insights.overdueTaskIds.has(task.id) && <Badge tone="danger">Overdue</Badge>}
                        {insights.violatingTaskIds.has(task.id) && <Badge tone="warning">Logic</Badge>}
                        {insights.openEndedTaskIds.has(task.id) && <Badge tone="warning">Open End</Badge>}
                        {insights.deadlineMissTaskIds.has(task.id) && <Badge tone="danger">Deadline</Badge>}
                        {insights.constraintViolationTaskIds.has(task.id) && <Badge tone="warning">Constraint</Badge>}
                        {insights.resourceConflictTaskIds.has(task.id) && <Badge tone="warning">Resource</Badge>}
                        {insights.actualDateGapTaskIds.has(task.id) && <Badge tone="warning">Actuals</Badge>}
                      </div>

                      {task.assignee && (
                        <div className="mt-3 flex items-center gap-1.5">
                          <div className="flex h-4 w-4 items-center justify-center rounded-full bg-panel2">
                            <span className="text-[9px] font-medium text-fg/50">
                              {task.assignee.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <span className="truncate text-[10px] text-fg/40">{task.assignee}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {tasksByStatus[status].length === 0 && (
              <div className="py-8 text-center text-xs text-fg/20">Drop tasks here</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
