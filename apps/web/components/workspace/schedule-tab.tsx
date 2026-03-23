"use client";

import { useMemo, useRef, useState, useTransition, useCallback } from "react";
import { Calendar, Plus } from "lucide-react";
import type { ProjectWorkspaceData, WorkspaceResponse, ScheduleTask, ScheduleTaskPatchInput, CreateScheduleTaskInput } from "@/lib/api";
import {
  createScheduleTask,
  updateScheduleTask,
  deleteScheduleTask,
  createScheduleDependency,
  deleteScheduleDependency,
  saveScheduleBaseline,
  clearScheduleBaseline,
  getSchedulePdfUrl,
} from "@/lib/api";
import { Button, EmptyState } from "@/components/ui";
import {
  computeCriticalPath,
  filterTasks,
  emptyFilters,
  addDays,
  formatISODate,
} from "@/lib/schedule-utils";
import type { ScheduleFilters, ZoomLevel } from "@/lib/schedule-utils";
import { ScheduleToolbar, type ScheduleView } from "./schedule/schedule-toolbar";
import { ScheduleFiltersBar } from "./schedule/schedule-filters";
import { GanttView } from "./schedule/gantt-view";
import { ListView } from "./schedule/list-view";
import { BoardView } from "./schedule/board-view";
import { TaskEditPopover } from "./schedule/task-edit-popover";
import { ScheduleContextMenu, useContextMenu } from "./schedule/schedule-context-menu";

/* ─── Component ─── */

export function ScheduleTab({
  workspace,
  apply,
}: {
  workspace: ProjectWorkspaceData;
  apply: (data: WorkspaceResponse) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [view, setView] = useState<ScheduleView>("gantt");
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("week");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [filters, setFilters] = useState<ScheduleFilters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const [showBaseline, setShowBaseline] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduleTask | null>(null);

  const projectId = workspace.project.id;
  const phases = workspace.phases ?? [];
  const rev = workspace.currentRevision;
  const allTasks: ScheduleTask[] = (workspace as any).scheduleTasks ?? [];
  const allDependencies = (workspace as any).scheduleDependencies ?? [];

  // Filter tasks
  const tasks = useMemo(() => filterTasks(allTasks, filters), [allTasks, filters]);

  // Critical path
  const criticalTaskIds = useMemo(
    () => (showCriticalPath ? computeCriticalPath(allTasks, allDependencies) : new Set<string>()),
    [allTasks, allDependencies, showCriticalPath]
  );

  // Unique assignees for filter dropdown
  const assignees = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTasks) if (t.assignee) set.add(t.assignee);
    return Array.from(set).sort();
  }, [allTasks]);

  // Has any active filters
  const filtersActive =
    filters.phaseIds.length > 0 ||
    filters.statuses.length > 0 ||
    filters.assignees.length > 0 ||
    !!filters.dateFrom ||
    !!filters.dateTo;

  /* ─── Mutations ─── */

  const addingRef = useRef(false);
  const handleAddTask = useCallback(() => {
    if (addingRef.current || isPending) return;
    addingRef.current = true;
    const startDate = rev.dateWorkStart ?? formatISODate(new Date());
    const endDate = formatISODate(addDays(new Date(startDate), 7));

    startTransition(async () => {
      try {
        const input: CreateScheduleTaskInput = {
          name: "New Task",
          startDate,
          endDate,
          duration: 7,
        };
        const res = await createScheduleTask(projectId, input);
        apply(res);
      } finally {
        addingRef.current = false;
      }
    });
  }, [projectId, rev.dateWorkStart, apply, isPending]);

  const handleUpdateTask = useCallback(
    (taskId: string, patch: ScheduleTaskPatchInput) => {
      startTransition(async () => {
        const res = await updateScheduleTask(projectId, taskId, patch);
        apply(res);
      });
    },
    [projectId, apply]
  );

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      startTransition(async () => {
        const res = await deleteScheduleTask(projectId, taskId);
        apply(res);
      });
    },
    [projectId, apply]
  );

  const handleSaveBaseline = useCallback(() => {
    startTransition(async () => {
      const res = await saveScheduleBaseline(projectId);
      apply(res);
    });
  }, [projectId, apply]);

  const handleExportPdf = useCallback(() => {
    window.open(getSchedulePdfUrl(projectId), "_blank");
  }, [projectId]);

  const handleClickTask = useCallback((task: ScheduleTask) => {
    setEditingTask(task);
  }, []);

  const handleDuplicateTask = useCallback(
    (task: ScheduleTask) => {
      startTransition(async () => {
        const input: CreateScheduleTaskInput = {
          phaseId: task.phaseId,
          name: `${task.name} (copy)`,
          description: task.description,
          taskType: task.taskType,
          status: "not_started",
          startDate: task.startDate,
          endDate: task.endDate,
          duration: task.duration,
          assignee: task.assignee,
        };
        const res = await createScheduleTask(projectId, input);
        apply(res);
      });
    },
    [projectId, apply]
  );

  const { menu: contextMenu, handleContextMenu, closeMenu: closeContextMenu } = useContextMenu();

  const scrollStep = zoomLevel === "month" ? 30 : zoomLevel === "week" ? 7 : 1;

  /* ─── Render ─── */

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <ScheduleToolbar
        view={view}
        onViewChange={setView}
        zoomLevel={zoomLevel}
        onZoomChange={setZoomLevel}
        onScrollPrev={() => setScrollOffset((o) => o - scrollStep)}
        onScrollToday={() => setScrollOffset(0)}
        onScrollNext={() => setScrollOffset((o) => o + scrollStep)}
        onAddTask={handleAddTask}
        onToggleFilters={() => setShowFilters((f) => !f)}
        filtersActive={filtersActive}
        showCriticalPath={showCriticalPath}
        onToggleCriticalPath={() => setShowCriticalPath((c) => !c)}
        showBaseline={showBaseline}
        onToggleBaseline={() => setShowBaseline((b) => !b)}
        onSaveBaseline={handleSaveBaseline}
        onExportPdf={handleExportPdf}
        dateStart={rev.dateWorkStart}
        dateEnd={rev.dateWorkEnd}
      />

      {/* Filters */}
      {showFilters && (
        <ScheduleFiltersBar
          filters={filters}
          onChange={setFilters}
          phases={phases}
          assignees={assignees}
        />
      )}

      {/* Views */}
      {allTasks.length === 0 && !isPending ? (
        <EmptyState>
          <Calendar className="mx-auto mb-3 h-10 w-10 text-fg/20" />
          <p className="text-sm font-medium text-fg/50">No schedule tasks</p>
          <p className="mt-1 text-xs text-fg/30">
            Add tasks to build your project schedule.
          </p>
          <Button variant="accent" size="sm" className="mt-4" onClick={handleAddTask}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add First Task
          </Button>
        </EmptyState>
      ) : view === "gantt" ? (
        <GanttView
          tasks={tasks}
          dependencies={allDependencies}
          phases={phases}
          zoomLevel={zoomLevel}
          scrollOffset={scrollOffset}
          dateWorkStart={rev.dateWorkStart}
          dateWorkEnd={rev.dateWorkEnd}
          criticalTaskIds={criticalTaskIds}
          showCriticalPath={showCriticalPath}
          showBaseline={showBaseline}
          onUpdateTask={handleUpdateTask}
          onClickTask={handleClickTask}
          onContextMenu={handleContextMenu}
        />
      ) : view === "list" ? (
        <ListView
          tasks={tasks}
          phases={phases}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={handleDeleteTask}
          onClickTask={handleClickTask}
          onContextMenu={handleContextMenu}
        />
      ) : (
        <BoardView
          tasks={tasks}
          phases={phases}
          onUpdateTask={handleUpdateTask}
          onClickTask={handleClickTask}
          onContextMenu={handleContextMenu}
        />
      )}

      {/* Context menu */}
      <ScheduleContextMenu
        menu={contextMenu}
        onClose={closeContextMenu}
        onEdit={handleClickTask}
        onDelete={handleDeleteTask}
        onUpdate={handleUpdateTask}
        onDuplicate={handleDuplicateTask}
      />

      {/* Task edit popover */}
      {editingTask && (
        <TaskEditPopover
          task={editingTask}
          phases={phases}
          onSave={handleUpdateTask}
          onDelete={handleDeleteTask}
          onClose={() => setEditingTask(null)}
        />
      )}

      {/* Loading overlay */}
      {isPending && (
        <div className="fixed bottom-4 right-4 bg-panel border border-line rounded-lg px-3 py-2 shadow-lg z-50">
          <span className="text-xs text-fg/60">Saving...</span>
        </div>
      )}
    </div>
  );
}
