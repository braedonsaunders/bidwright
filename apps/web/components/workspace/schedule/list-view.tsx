"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ScheduleTask, ScheduleTaskPatchInput, ProjectPhase } from "@/lib/api";
import {
  STATUS_LABELS,
  STATUS_COLORS,
  formatShortDate,
  parseDate,
  diffDays,
  groupTasksByPhase,
  computePhaseDatesFromTasks,
  PHASE_COLORS,
} from "@/lib/schedule-utils";
import type { ScheduleTaskStatus } from "@/lib/api";

interface ListViewProps {
  tasks: ScheduleTask[];
  phases: ProjectPhase[];
  onUpdateTask: (taskId: string, patch: ScheduleTaskPatchInput) => void;
  onDeleteTask: (taskId: string) => void;
  onClickTask: (task: ScheduleTask) => void;
  onContextMenu?: (e: React.MouseEvent, task: ScheduleTask) => void;
}

type SortKey = "name" | "status" | "startDate" | "endDate" | "progress" | "assignee";
type SortDir = "asc" | "desc";

export function ListView({ tasks, phases, onUpdateTask, onDeleteTask, onClickTask, onContextMenu }: ListViewProps) {
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("startDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const phaseDates = useMemo(() => computePhaseDatesFromTasks(tasks, phases), [tasks, phases]);
  const groups = useMemo(() => groupTasksByPhase(tasks, phases, phaseDates), [tasks, phases, phaseDates]);

  const sortedGroups = useMemo(() => {
    return groups.map((g) => ({
      ...g,
      tasks: [...g.tasks].sort((a, b) => {
        let cmp = 0;
        if (sortKey === "name") cmp = a.name.localeCompare(b.name);
        else if (sortKey === "status") cmp = a.status.localeCompare(b.status);
        else if (sortKey === "startDate") cmp = (a.startDate ?? "").localeCompare(b.startDate ?? "");
        else if (sortKey === "endDate") cmp = (a.endDate ?? "").localeCompare(b.endDate ?? "");
        else if (sortKey === "progress") cmp = a.progress - b.progress;
        else if (sortKey === "assignee") cmp = a.assignee.localeCompare(b.assignee);
        return sortDir === "asc" ? cmp : -cmp;
      }),
    }));
  }, [groups, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const togglePhase = (id: string) => {
    setCollapsedPhases((prev) => {
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

  const handleBulkStatusChange = (status: ScheduleTaskStatus) => {
    for (const id of selectedIds) {
      onUpdateTask(id, { status });
    }
    setSelectedIds(new Set());
  };

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-fg/50 cursor-pointer hover:text-fg/70 transition-colors select-none"
      onClick={() => toggleSort(field)}
    >
      {label}
      {sortKey === field && (
        <span className="ml-1">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>
      )}
    </th>
  );

  return (
    <div className="rounded-lg border border-line bg-panel overflow-hidden">
      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-accent/5 border-b border-line">
          <span className="text-xs text-fg/60">{selectedIds.size} selected</span>
          <Button variant="ghost" size="xs" onClick={() => handleBulkStatusChange("in_progress")}>
            Mark In Progress
          </Button>
          <Button variant="ghost" size="xs" onClick={() => handleBulkStatusChange("complete")}>
            Mark Complete
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <table className="w-full">
        <thead>
          <tr className="border-b border-line bg-panel2/30">
            <th className="w-8 px-3 py-2">
              <input
                type="checkbox"
                checked={selectedIds.size === tasks.length && tasks.length > 0}
                onChange={() => {
                  if (selectedIds.size === tasks.length) setSelectedIds(new Set());
                  else setSelectedIds(new Set(tasks.map((t) => t.id)));
                }}
                className="rounded border-line"
              />
            </th>
            <SortHeader label="Name" field="name" />
            <th className="px-3 py-2 text-left text-xs font-medium text-fg/50">Phase</th>
            <SortHeader label="Status" field="status" />
            <SortHeader label="Start" field="startDate" />
            <SortHeader label="End" field="endDate" />
            <th className="px-3 py-2 text-left text-xs font-medium text-fg/50">Duration</th>
            <SortHeader label="Progress" field="progress" />
            <SortHeader label="Assignee" field="assignee" />
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {sortedGroups.map((group, gIdx) => {
            const isCollapsed = group.phase ? collapsedPhases.has(group.phase.id) : false;
            const color = PHASE_COLORS[gIdx % PHASE_COLORS.length];

            return (
              <Fragment key={group.phase?.id ?? "standalone"}>
                {/* Phase header */}
                {group.phase && (
                  <tr
                    className="bg-panel2/20 border-b border-line/50 cursor-pointer hover:bg-panel2/30 transition-colors"
                    onClick={() => togglePhase(group.phase!.id)}
                  >
                    <td colSpan={10} className="px-3 py-2">
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
                        <span className="text-[11px] text-fg/30 ml-2">
                          {group.tasks.length} task{group.tasks.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Tasks */}
                {!isCollapsed &&
                  group.tasks.map((task) => {
                    const start = parseDate(task.startDate);
                    const end = parseDate(task.endDate);
                    const dur = start && end ? diffDays(end, start) : task.duration;

                    return (
                      <tr
                        key={task.id}
                        className="border-b border-line/30 hover:bg-panel2/10 transition-colors"
                        onContextMenu={onContextMenu ? (e) => onContextMenu(e, task) : undefined}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(task.id)}
                            onChange={() => toggleSelect(task.id)}
                            className="rounded border-line"
                          />
                        </td>
                        <td
                          className="px-3 py-2 text-xs text-fg/80 cursor-pointer hover:text-accent transition-colors"
                          onClick={() => onClickTask(task)}
                        >
                          {task.name || "Untitled"}
                        </td>
                        <td className="px-3 py-2">
                          {group.phase && (
                            <div className="flex items-center gap-1.5">
                              <div className={cn("h-2 w-2 rounded-full", color.bg)} />
                              <span className="text-[11px] text-fg/40 truncate max-w-24">
                                {group.phase.name}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={STATUS_COLORS[task.status] as any}>
                            {STATUS_LABELS[task.status]}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-xs text-fg/60">
                          {start ? formatShortDate(start) : "\u2014"}
                        </td>
                        <td className="px-3 py-2 text-xs text-fg/60">
                          {end ? formatShortDate(end) : "\u2014"}
                        </td>
                        <td className="px-3 py-2 text-xs text-fg/60">
                          {dur > 0 ? `${dur}d` : "\u2014"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 rounded-full bg-line overflow-hidden">
                              <div
                                className="h-full rounded-full bg-accent"
                                style={{ width: `${task.progress * 100}%` }}
                              />
                            </div>
                            <span className="text-[11px] text-fg/40">{Math.round(task.progress * 100)}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-fg/60 truncate max-w-24">
                          {task.assignee || "\u2014"}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => onDeleteTask(task.id)}
                            className="text-fg/20 hover:text-danger transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {tasks.length === 0 && (
        <div className="py-12 text-center text-sm text-fg/30">
          No schedule tasks yet. Add a task to get started.
        </div>
      )}
    </div>
  );
}

// Need Fragment import
import { Fragment } from "react";
