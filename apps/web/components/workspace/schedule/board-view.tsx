"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { ScheduleTask, ScheduleTaskPatchInput, ProjectPhase } from "@/lib/api";
import type { ScheduleTaskStatus } from "@/lib/api";
import { STATUS_LABELS, PHASE_COLORS, parseDate, formatShortDate } from "@/lib/schedule-utils";

interface BoardViewProps {
  tasks: ScheduleTask[];
  phases: ProjectPhase[];
  onUpdateTask: (taskId: string, patch: ScheduleTaskPatchInput) => void;
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

export function BoardView({ tasks, phases, onUpdateTask, onClickTask, onContextMenu }: BoardViewProps) {
  const phaseMap = useMemo(() => new Map(phases.map((p) => [p.id, p])), [phases]);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const tasksByStatus = useMemo(() => {
    const result: Record<ScheduleTaskStatus, ScheduleTask[]> = {
      not_started: [],
      in_progress: [],
      on_hold: [],
      complete: [],
    };
    for (const t of tasks) {
      const col = result[t.status];
      if (col) col.push(t);
    }
    return result;
  }, [tasks]);

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("text/plain", taskId);
    setDraggingId(taskId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, newStatus: ScheduleTaskStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain");
    if (taskId) {
      const task = tasks.find((t) => t.id === taskId);
      if (task && task.status !== newStatus) {
        onUpdateTask(taskId, {
          status: newStatus,
          progress: newStatus === "complete" ? 1 : task.progress,
        });
      }
    }
    setDraggingId(null);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
  };

  return (
    <div className="grid grid-cols-4 gap-3">
      {COLUMNS.map((status) => (
        <div
          key={status}
          className={cn(
            "rounded-lg border border-line bg-panel2/20 min-h-[300px]",
            "border-t-4",
            COLUMN_COLORS[status]
          )}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, status)}
        >
          {/* Column header */}
          <div className="px-3 py-2.5 border-b border-line/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-fg/70">{STATUS_LABELS[status]}</span>
              <span className="text-[11px] text-fg/30 bg-bg/50 px-1.5 py-0.5 rounded-full">
                {tasksByStatus[status].length}
              </span>
            </div>
          </div>

          {/* Cards */}
          <div className="p-2 space-y-2">
            {tasksByStatus[status].map((task) => {
              const phase = task.phaseId ? phaseMap.get(task.phaseId) : null;
              const phaseIdx = phase ? phases.indexOf(phase) : -1;
              const color = phaseIdx >= 0 ? PHASE_COLORS[phaseIdx % PHASE_COLORS.length] : null;
              const start = parseDate(task.startDate);
              const end = parseDate(task.endDate);

              return (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onClickTask(task)}
                  onContextMenu={onContextMenu ? (e) => onContextMenu(e, task) : undefined}
                  className={cn(
                    "rounded-lg border border-line bg-panel p-3 cursor-pointer",
                    "hover:border-accent/30 hover:shadow-sm transition-all",
                    draggingId === task.id && "opacity-50"
                  )}
                >
                  {/* Phase badge */}
                  {phase && color && (
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className={cn("h-2 w-2 rounded-full", color.bg)} />
                      <span className="text-[10px] text-fg/40 truncate">{phase.name}</span>
                    </div>
                  )}

                  {/* Task name */}
                  <p className="text-xs font-medium text-fg/80 mb-2 line-clamp-2">
                    {task.name || "Untitled"}
                  </p>

                  {/* Date range */}
                  {(start || end) && (
                    <p className="text-[10px] text-fg/30 mb-2">
                      {start ? formatShortDate(start) : "?"} – {end ? formatShortDate(end) : "?"}
                    </p>
                  )}

                  {/* Progress bar */}
                  {task.progress > 0 && (
                    <div className="mb-2">
                      <div className="h-1 w-full rounded-full bg-line overflow-hidden">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${task.progress * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Assignee */}
                  {task.assignee && (
                    <div className="flex items-center gap-1.5">
                      <div className="h-4 w-4 rounded-full bg-panel2 flex items-center justify-center">
                        <span className="text-[9px] font-medium text-fg/50">
                          {task.assignee.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="text-[10px] text-fg/40 truncate">{task.assignee}</span>
                    </div>
                  )}
                </div>
              );
            })}

            {tasksByStatus[status].length === 0 && (
              <div className="py-8 text-center text-xs text-fg/20">
                Drop tasks here
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
