"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertCircle, Calendar, FileText, Loader2, Plus, Upload, X } from "lucide-react";
import type {
  CreateScheduleBaselineInput,
  CreateDependencyInput,
  CreateScheduleCalendarInput,
  CreateScheduleResourceInput,
  CreateScheduleTaskInput,
  ProjectWorkspaceData,
  ScheduleBaseline,
  ScheduleCalendarPatchInput,
  ScheduleResourcePatchInput,
  ScheduleTaskAssignment,
  ScheduleTask,
  ScheduleTaskPatchInput,
  ScheduleImportCandidate,
  WorkspaceResponse,
} from "@/lib/api";
import {
  batchUpdateScheduleTasks,
  clearScheduleBaseline,
  createScheduleBaseline,
  createScheduleCalendar,
  createScheduleDependency,
  createScheduleResource,
  createScheduleTask,
  deleteScheduleBaseline,
  deleteScheduleCalendar,
  deleteScheduleDependency,
  deleteScheduleResource,
  deleteScheduleTask,
  getProjectWorkspace,
  getScheduleImportCandidates,
  getSchedulePdfUrl,
  importProjectSchedule,
  saveScheduleBaseline,
  updateScheduleCalendar,
  updateScheduleResource,
  updateScheduleTask,
} from "@/lib/api";
import { Badge, Button, EmptyState, ModalBackdrop } from "@/components/ui";
import {
  addDays,
  buildIndentTaskUpdates,
  buildOutdentTaskUpdates,
  buildReorderTaskUpdates,
  applyQuickFilter,
  buildScheduleInsights,
  diffDays,
  emptyFilters,
  filterTasks,
  formatISODate,
  getTaskSubtreeIds,
  parseDate,
  rollupScheduleTasks,
  sortTasksByOrder,
  todayDate,
} from "@/lib/schedule-utils";
import type { ScheduleFilters, ScheduleQuickFilter, ZoomLevel } from "@/lib/schedule-utils";
import { BoardView } from "./schedule/board-view";
import { GanttView } from "./schedule/gantt-view";
import { ListView } from "./schedule/list-view";
import { ScheduleContextMenu, useContextMenu } from "./schedule/schedule-context-menu";
import { ScheduleFiltersBar } from "./schedule/schedule-filters";
import { ScheduleToolbar, type ScheduleView } from "./schedule/schedule-toolbar";
import { ScheduleManagementModal } from "./schedule/schedule-management-modal";
import { TaskEditPopover } from "./schedule/task-edit-popover";

const ZOOM_LEVELS: ZoomLevel[] = ["month", "week", "day"];

interface ScheduleTabApi {
  batchUpdateScheduleTasks: typeof batchUpdateScheduleTasks;
  clearScheduleBaseline: typeof clearScheduleBaseline;
  createScheduleBaseline: typeof createScheduleBaseline;
  createScheduleCalendar: typeof createScheduleCalendar;
  createScheduleDependency: typeof createScheduleDependency;
  createScheduleResource: typeof createScheduleResource;
  createScheduleTask: typeof createScheduleTask;
  deleteScheduleBaseline: typeof deleteScheduleBaseline;
  deleteScheduleCalendar: typeof deleteScheduleCalendar;
  deleteScheduleDependency: typeof deleteScheduleDependency;
  deleteScheduleResource: typeof deleteScheduleResource;
  deleteScheduleTask: typeof deleteScheduleTask;
  getProjectWorkspace: typeof getProjectWorkspace;
  getScheduleImportCandidates: typeof getScheduleImportCandidates;
  importProjectSchedule: typeof importProjectSchedule;
  saveScheduleBaseline: typeof saveScheduleBaseline;
  updateScheduleCalendar: typeof updateScheduleCalendar;
  updateScheduleResource: typeof updateScheduleResource;
  updateScheduleTask: typeof updateScheduleTask;
}

const DEFAULT_SCHEDULE_API: ScheduleTabApi = {
  batchUpdateScheduleTasks,
  clearScheduleBaseline,
  createScheduleBaseline,
  createScheduleCalendar,
  createScheduleDependency,
  createScheduleResource,
  createScheduleTask,
  deleteScheduleBaseline,
  deleteScheduleCalendar,
  deleteScheduleDependency,
  deleteScheduleResource,
  deleteScheduleTask,
  getProjectWorkspace,
  getScheduleImportCandidates,
  importProjectSchedule,
  saveScheduleBaseline,
  updateScheduleCalendar,
  updateScheduleResource,
  updateScheduleTask,
};

function getScheduleErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Schedule update failed. Please try again.";
}

function ScheduleImportModal({
  open,
  candidates,
  loading,
  importingId,
  error,
  onClose,
  onImport,
}: {
  open: boolean;
  candidates: ScheduleImportCandidate[];
  loading: boolean;
  importingId: string | null;
  error: string | null;
  onClose: () => void;
  onImport: (candidate: ScheduleImportCandidate) => void;
}) {
  if (!open) return null;

  return (
    <ModalBackdrop open={open} onClose={onClose} size="xl">
      <div
        className="flex max-h-[72vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-fg">Import Schedule</h3>
            <p className="mt-0.5 text-xs text-fg/45">Already-uploaded Microsoft Project and Primavera P6 files.</p>
          </div>
          <Button variant="ghost" size="xs" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-fg/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking uploaded files...
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Upload className="h-9 w-9 text-fg/15" />
              <p className="text-sm font-medium text-fg/55">No schedule files found</p>
              <p className="max-w-sm text-xs text-fg/40">Upload an MPP, MPX, Microsoft Project XML, XER, or P6 XML file in Documents / Files first.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {candidates.map((candidate) => {
                const key = `${candidate.sourceKind}:${candidate.sourceId}`;
                const disabled = candidate.status !== "available";
                return (
                  <div key={key} className="flex items-center gap-3 rounded-md border border-line bg-bg/35 px-3 py-2">
                    <FileText className="h-4 w-4 shrink-0 text-fg/40" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium text-fg">{candidate.fileName}</span>
                        <Badge tone={candidate.status === "available" ? "success" : "warning"}>{candidate.format.toUpperCase()}</Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-fg/40">{candidate.message}</p>
                    </div>
                    <Button
                      variant={disabled ? "secondary" : "accent"}
                      size="xs"
                      disabled={disabled || importingId !== null}
                      onClick={() => onImport(candidate)}
                    >
                      {importingId === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      Import
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <div className="border-t border-danger/20 bg-danger/5 px-4 py-2 text-xs text-danger">
            {error}
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

export function ScheduleTab({
  workspace,
  apply,
  api = DEFAULT_SCHEDULE_API,
}: {
  workspace: ProjectWorkspaceData;
  apply: (data: WorkspaceResponse) => void;
  api?: ScheduleTabApi;
}) {
  const [isApplying, startTransition] = useTransition();
  const [view, setView] = useState<ScheduleView>("gantt");
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("week");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [filters, setFilters] = useState<ScheduleFilters>(emptyFilters);
  const [quickFilter, setQuickFilter] = useState<ScheduleQuickFilter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const [showBaseline, setShowBaseline] = useState(false);
  const [showManagement, setShowManagement] = useState(false);
  const [activeBaselineId, setActiveBaselineId] = useState<string>("");
  const [editingTask, setEditingTask] = useState<ScheduleTask | null>(null);
  const [pendingMutations, setPendingMutations] = useState(0);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importCandidates, setImportCandidates] = useState<ScheduleImportCandidate[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const projectId = workspace.project.id;
  const phases = workspace.phases ?? [];
  const revision = workspace.currentRevision;
  const allTasks: ScheduleTask[] = workspace.scheduleTasks ?? [];
  const allDependencies = workspace.scheduleDependencies ?? [];
  const calendars = workspace.scheduleCalendars ?? [];
  const baselines = workspace.scheduleBaselines ?? [];
  const baselineTasks = workspace.scheduleBaselineTasks ?? [];
  const resources = workspace.scheduleResources ?? [];
  const taskAssignments = workspace.scheduleTaskAssignments ?? [];
  const defaultCalendar = calendars.find((calendar) => calendar.isDefault) ?? calendars[0] ?? null;
  const taskAssignmentsByTaskId = useMemo(() => {
    const grouped = new Map<string, ScheduleTaskAssignment[]>();
    for (const assignment of taskAssignments) {
      if (!grouped.has(assignment.taskId)) grouped.set(assignment.taskId, []);
      grouped.get(assignment.taskId)!.push(assignment);
    }
    return grouped;
  }, [taskAssignments]);
  const primaryBaseline = baselines.find((baseline) => baseline.isPrimary) ?? baselines[0] ?? null;
  const activeBaseline = baselines.find((baseline) => baseline.id === activeBaselineId) ?? primaryBaseline ?? null;
  const tasksWithActiveBaseline = useMemo(() => {
    if (!activeBaseline) return allTasks;
    const itemByTaskId = new Map(
      baselineTasks
        .filter((item) => item.baselineId === activeBaseline.id)
        .map((item) => [item.taskId, item] as const)
    );
    return allTasks.map((task) => {
      const snapshot = itemByTaskId.get(task.id);
      return {
        ...task,
        baselineStart: snapshot?.startDate ?? null,
        baselineEnd: snapshot?.endDate ?? null,
      };
    });
  }, [activeBaseline, allTasks, baselineTasks]);
  const rolledTasksWithActiveBaseline = useMemo(
    () => rollupScheduleTasks(tasksWithActiveBaseline),
    [tasksWithActiveBaseline]
  );
  const hasBaseline = useMemo(
    () => baselines.length > 0 || tasksWithActiveBaseline.some((task) => !!task.baselineStart || !!task.baselineEnd),
    [baselines.length, tasksWithActiveBaseline]
  );
  const scheduleInsights = useMemo(
    () =>
      buildScheduleInsights(rolledTasksWithActiveBaseline, allDependencies, todayDate(), {
        calendars,
        resources,
        taskAssignments,
      }),
    [allDependencies, calendars, resources, rolledTasksWithActiveBaseline, taskAssignments]
  );
  const criticalTaskIds = scheduleInsights.criticalTaskIds;

  const tasks = useMemo(
    () => applyQuickFilter(filterTasks(rolledTasksWithActiveBaseline, filters), quickFilter, scheduleInsights),
    [filters, quickFilter, rolledTasksWithActiveBaseline, scheduleInsights]
  );
  const assignees = useMemo(() => {
    const values = new Set<string>();
    for (const task of rolledTasksWithActiveBaseline) {
      if (task.assignee) values.add(task.assignee);
    }
    return Array.from(values).sort();
  }, [rolledTasksWithActiveBaseline]);

  const filtersActive =
    filters.phaseIds.length > 0 ||
    filters.statuses.length > 0 ||
    filters.assignees.length > 0 ||
    !!filters.dateFrom ||
    !!filters.dateTo;
  const quickFilterActive = quickFilter !== "all";

  const isPending = isApplying || pendingMutations > 0;
  const addingRef = useRef(false);

  useEffect(() => {
    if (!editingTask) return;
    const freshTask = rolledTasksWithActiveBaseline.find((task) => task.id === editingTask.id) ?? null;
    if (!freshTask) {
      setEditingTask(null);
      return;
    }
    if (freshTask !== editingTask) {
      setEditingTask(freshTask);
    }
  }, [editingTask, rolledTasksWithActiveBaseline]);

  useEffect(() => {
    if (!hasBaseline && showBaseline) {
      setShowBaseline(false);
    }
  }, [hasBaseline, showBaseline]);

  useEffect(() => {
    if (!hasBaseline && quickFilter === "variance") {
      setQuickFilter("all");
    }
  }, [hasBaseline, quickFilter]);

  useEffect(() => {
    if (activeBaselineId && baselines.some((baseline) => baseline.id === activeBaselineId)) {
      return;
    }
    setActiveBaselineId(primaryBaseline?.id ?? "");
  }, [activeBaselineId, baselines, primaryBaseline?.id]);

  const runWorkspaceMutation = useCallback(
    async (
      mutation: () => Promise<WorkspaceResponse>,
      options?: { onSuccess?: () => void }
    ) => {
      setPendingMutations((count) => count + 1);
      try {
        const response = await mutation();
        setMutationError(null);
        startTransition(() => {
          apply(response);
        });
        options?.onSuccess?.();
        return true;
      } catch (error) {
        setMutationError(getScheduleErrorMessage(error));
        return false;
      } finally {
        setPendingMutations((count) => Math.max(0, count - 1));
      }
    },
    [apply, startTransition]
  );

  const handleAddTask = useCallback(() => {
    if (addingRef.current || isPending) return;
    addingRef.current = true;

    const startDate = revision.dateWorkStart ?? formatISODate(todayDate());
    const parsedStartDate = parseDate(startDate) ?? todayDate();
    const parsedEndDate = addDays(parsedStartDate, 7);
    const endDate = formatISODate(parsedEndDate);
    const input: CreateScheduleTaskInput = {
      calendarId: defaultCalendar?.id ?? null,
      name: "New Task",
      startDate,
      endDate,
      duration: diffDays(parsedEndDate, parsedStartDate),
    };

    void (async () => {
      try {
        await runWorkspaceMutation(() => api.createScheduleTask(projectId, input));
      } finally {
        addingRef.current = false;
      }
    })();
  }, [api, isPending, projectId, revision.dateWorkStart, runWorkspaceMutation]);

  const handleUpdateTask = useCallback(
    async (taskId: string, patch: ScheduleTaskPatchInput) => {
      return runWorkspaceMutation(() => api.updateScheduleTask(projectId, taskId, patch));
    },
    [api, projectId, runWorkspaceMutation]
  );

  const handleBatchUpdateTasks = useCallback(
    async (updates: Array<{ id: string } & ScheduleTaskPatchInput>) => {
      if (updates.length === 0) return true;
      return runWorkspaceMutation(() => api.batchUpdateScheduleTasks(projectId, updates));
    },
    [api, projectId, runWorkspaceMutation]
  );

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      return runWorkspaceMutation(() => api.deleteScheduleTask(projectId, taskId), {
        onSuccess: () => {
          if (editingTask?.id === taskId) {
            setEditingTask(null);
          }
        },
      });
    },
    [api, editingTask?.id, projectId, runWorkspaceMutation]
  );

  const handleCreateDependency = useCallback(
    async (input: CreateDependencyInput) => {
      return runWorkspaceMutation(() => api.createScheduleDependency(projectId, input));
    },
    [api, projectId, runWorkspaceMutation]
  );

  const handleDeleteDependency = useCallback(
    async (dependencyId: string) => {
      return runWorkspaceMutation(() => api.deleteScheduleDependency(projectId, dependencyId));
    },
    [api, projectId, runWorkspaceMutation]
  );

  const handleSaveBaseline = useCallback(() => {
    void runWorkspaceMutation(() => api.saveScheduleBaseline(projectId), {
      onSuccess: () => setShowBaseline(true),
    });
  }, [api, projectId, runWorkspaceMutation]);

  const handleClearBaseline = useCallback(() => {
    void runWorkspaceMutation(() => api.clearScheduleBaseline(projectId), {
      onSuccess: () => setShowBaseline(false),
    });
  }, [api, projectId, runWorkspaceMutation]);

  const handleExportPdf = useCallback(() => {
    window.open(getSchedulePdfUrl(projectId), "_blank", "noopener,noreferrer");
  }, [projectId]);

  const handleOpenImport = useCallback(() => {
    setShowImportModal(true);
    setImportLoading(true);
    setImportError(null);
    void api.getScheduleImportCandidates(projectId)
      .then((result) => setImportCandidates(result.candidates))
      .catch((error) => setImportError(getScheduleErrorMessage(error)))
      .finally(() => setImportLoading(false));
  }, [api, projectId]);

  const handleImportSchedule = useCallback((candidate: ScheduleImportCandidate) => {
    const key = `${candidate.sourceKind}:${candidate.sourceId}`;
    setImportingId(key);
    setImportError(null);
    void api.importProjectSchedule(projectId, {
      sourceKind: candidate.sourceKind,
      sourceId: candidate.sourceId,
      mode: "replace",
    })
      .then(() => api.getProjectWorkspace(projectId))
      .then((response) => {
        startTransition(() => apply(response));
        setShowImportModal(false);
      })
      .catch((error) => setImportError(getScheduleErrorMessage(error)))
      .finally(() => setImportingId(null));
  }, [api, apply, projectId, startTransition]);

  const handleClickTask = useCallback(
    (task: ScheduleTask) => {
      setEditingTask(rolledTasksWithActiveBaseline.find((item) => item.id === task.id) ?? task);
    },
    [rolledTasksWithActiveBaseline]
  );

  const handleDuplicateTask = useCallback(
    async (task: ScheduleTask) => {
      const input: CreateScheduleTaskInput = {
        phaseId: task.phaseId,
        calendarId: task.calendarId,
        parentTaskId: task.parentTaskId,
        outlineLevel: task.outlineLevel,
        name: `${task.name} (copy)`,
        description: task.description,
        taskType: task.taskType,
        status: "not_started",
        startDate: task.startDate,
        endDate: task.taskType === "milestone" ? task.startDate : task.endDate,
        duration: task.taskType === "milestone" ? 0 : task.duration,
        assignee: task.assignee,
        constraintType: task.constraintType,
        constraintDate: task.constraintDate,
        deadlineDate: task.deadlineDate,
        resourceAssignments: (taskAssignmentsByTaskId.get(task.id) ?? []).map((assignment) => ({
          resourceId: assignment.resourceId,
          units: assignment.units,
          role: assignment.role,
        })),
      };
      return runWorkspaceMutation(() => api.createScheduleTask(projectId, input));
    },
    [api, projectId, runWorkspaceMutation, taskAssignmentsByTaskId]
  );

  const handleCreateChildTask = useCallback(
    async (parentTaskId: string) => {
      const parentTask = allTasks.find((task) => task.id === parentTaskId);
      if (!parentTask) return false;

      const phaseTasks = sortTasksByOrder(allTasks.filter((task) => task.phaseId === parentTask.phaseId));
      const subtreeIds = new Set(getTaskSubtreeIds(phaseTasks, parentTaskId));
      const lastTaskInSubtree = [...phaseTasks].reverse().find((task) => subtreeIds.has(task.id));
      const insertOrder = (lastTaskInSubtree?.order ?? parentTask.order) + 1;
      const reorderUpdates = phaseTasks
        .filter((task) => task.order >= insertOrder)
        .map((task) => ({ id: task.id, order: task.order + 1 }));

      if (reorderUpdates.length > 0) {
        const didShift = await handleBatchUpdateTasks(reorderUpdates);
        if (didShift === false) return false;
      }

      return runWorkspaceMutation(() =>
        api.createScheduleTask(projectId, {
          phaseId: parentTask.phaseId,
          calendarId: parentTask.calendarId,
          parentTaskId: parentTask.id,
          outlineLevel: (parentTask.outlineLevel ?? 0) + 1,
          name: "New Child Task",
          startDate: parentTask.startDate,
          endDate: parentTask.taskType === "milestone" ? parentTask.startDate : parentTask.endDate,
          duration: parentTask.taskType === "milestone" ? 0 : parentTask.duration,
          order: insertOrder,
        })
      );
    },
    [allTasks, api, handleBatchUpdateTasks, projectId, runWorkspaceMutation]
  );

  const handleCreateSiblingTask = useCallback(
    async (taskId: string) => {
      const sourceTask = allTasks.find((task) => task.id === taskId);
      if (!sourceTask) return false;

      const phaseTasks = sortTasksByOrder(allTasks.filter((task) => task.phaseId === sourceTask.phaseId));
      const subtreeIds = new Set(getTaskSubtreeIds(phaseTasks, taskId));
      const lastTaskInSubtree = [...phaseTasks].reverse().find((task) => subtreeIds.has(task.id));
      const insertOrder = (lastTaskInSubtree?.order ?? sourceTask.order) + 1;
      const reorderUpdates = phaseTasks
        .filter((task) => task.order >= insertOrder)
        .map((task) => ({ id: task.id, order: task.order + 1 }));

      if (reorderUpdates.length > 0) {
        const didShift = await handleBatchUpdateTasks(reorderUpdates);
        if (didShift === false) return false;
      }

      return runWorkspaceMutation(() =>
        api.createScheduleTask(projectId, {
          phaseId: sourceTask.phaseId,
          calendarId: sourceTask.calendarId,
          parentTaskId: sourceTask.parentTaskId ?? null,
          outlineLevel: sourceTask.outlineLevel ?? 0,
          name: "New Sibling Task",
          startDate: sourceTask.startDate,
          endDate: sourceTask.taskType === "milestone" ? sourceTask.startDate : sourceTask.endDate,
          duration: sourceTask.taskType === "milestone" ? 0 : sourceTask.duration,
          order: insertOrder,
        })
      );
    },
    [allTasks, api, handleBatchUpdateTasks, projectId, runWorkspaceMutation]
  );

  const handleIndentTask = useCallback(
    async (taskId: string) => {
      const task = allTasks.find((item) => item.id === taskId);
      if (!task) return false;

      const phaseTasks = sortTasksByOrder(allTasks.filter((item) => item.phaseId === task.phaseId));
      const updates = buildIndentTaskUpdates(phaseTasks, taskId);
      return updates.length > 0 ? handleBatchUpdateTasks(updates) : false;
    },
    [allTasks, handleBatchUpdateTasks]
  );

  const handleOutdentTask = useCallback(
    async (taskId: string) => {
      const task = allTasks.find((item) => item.id === taskId);
      if (!task || !task.parentTaskId) return false;

      const phaseTasks = sortTasksByOrder(allTasks.filter((item) => item.phaseId === task.phaseId));
      const updates = buildOutdentTaskUpdates(phaseTasks, taskId);
      return updates.length > 0 ? handleBatchUpdateTasks(updates) : false;
    },
    [allTasks, handleBatchUpdateTasks]
  );

  const handleReorderTask = useCallback(
    async (
      taskId: string,
      targetTaskId: string,
      placement: "before" | "after" | "inside",
      depth?: number
    ) => {
      if (taskId === targetTaskId) return true;

      const task = allTasks.find((item) => item.id === taskId);
      const targetTask = allTasks.find((item) => item.id === targetTaskId);
      if (!task || !targetTask || task.phaseId !== targetTask.phaseId) return false;

      const phaseTasks = sortTasksByOrder(allTasks.filter((item) => item.phaseId === task.phaseId));
      const updates = buildReorderTaskUpdates(phaseTasks, taskId, targetTaskId, placement, depth);
      return updates.length > 0 ? handleBatchUpdateTasks(updates) : true;
    },
    [allTasks, handleBatchUpdateTasks]
  );

  const handleMoveTask = useCallback(
    async (taskId: string, direction: "up" | "down") => {
      const task = allTasks.find((item) => item.id === taskId);
      if (!task) return false;

      const phaseTasks = sortTasksByOrder(allTasks.filter((item) => item.phaseId === task.phaseId));
      const siblingTasks = phaseTasks.filter((item) => (item.parentTaskId ?? null) === (task.parentTaskId ?? null));
      const siblingIndex = siblingTasks.findIndex((item) => item.id === taskId);
      if (siblingIndex < 0) return false;

      if (direction === "up" && siblingIndex > 0) {
        return handleReorderTask(taskId, siblingTasks[siblingIndex - 1].id, "before");
      }
      if (direction === "down" && siblingIndex < siblingTasks.length - 1) {
        return handleReorderTask(taskId, siblingTasks[siblingIndex + 1].id, "after");
      }
      return false;
    },
    [allTasks, handleReorderTask]
  );

  const handleCreateBaseline = useCallback(
    async (input: CreateScheduleBaselineInput) => {
      return runWorkspaceMutation(() => api.createScheduleBaseline(projectId, input));
    },
    [api, projectId, runWorkspaceMutation]
  );

  const handleDeleteBaseline = useCallback(
    async (baselineId: string) => {
      return runWorkspaceMutation(() => api.deleteScheduleBaseline(projectId, baselineId), {
        onSuccess: () => {
          if (activeBaselineId === baselineId) {
            setActiveBaselineId(primaryBaseline?.id ?? "");
          }
        },
      });
    },
    [activeBaselineId, api, primaryBaseline?.id, projectId, runWorkspaceMutation]
  );

  const handleCreateCalendar = useCallback(
    async (input: CreateScheduleCalendarInput) => {
      return runWorkspaceMutation(() => api.createScheduleCalendar(projectId, input));
    },
    [api, projectId, runWorkspaceMutation]
  );

  const handleUpdateCalendar = useCallback(
    async (calendarId: string, patch: ScheduleCalendarPatchInput) => {
      return runWorkspaceMutation(() => api.updateScheduleCalendar(projectId, calendarId, patch));
    },
    [api, projectId, runWorkspaceMutation]
  );

  const handleDeleteCalendar = useCallback(
    async (calendarId: string) => {
      return runWorkspaceMutation(() => api.deleteScheduleCalendar(projectId, calendarId));
    },
    [api, projectId, runWorkspaceMutation]
  );

  const handleCreateResource = useCallback(
    async (input: CreateScheduleResourceInput) => {
      return runWorkspaceMutation(() => api.createScheduleResource(projectId, input));
    },
    [api, projectId, runWorkspaceMutation]
  );

  const handleUpdateResource = useCallback(
    async (resourceId: string, patch: ScheduleResourcePatchInput) => {
      return runWorkspaceMutation(() => api.updateScheduleResource(projectId, resourceId, patch));
    },
    [api, projectId, runWorkspaceMutation]
  );

  const handleDeleteResource = useCallback(
    async (resourceId: string) => {
      return runWorkspaceMutation(() => api.deleteScheduleResource(projectId, resourceId));
    },
    [api, projectId, runWorkspaceMutation]
  );

  const { menu: contextMenu, handleContextMenu, closeMenu: closeContextMenu } = useContextMenu();
  const handleScheduleContextMenu = useCallback(
    (event: React.MouseEvent, task: ScheduleTask) => {
      handleContextMenu(event, rolledTasksWithActiveBaseline.find((item) => item.id === task.id) ?? task);
    },
    [handleContextMenu, rolledTasksWithActiveBaseline]
  );

  const rawStartDate = parseDate(revision.dateWorkStart) ?? todayDate();
  const scrollStep = zoomLevel === "month" ? 30 : zoomLevel === "week" ? 7 : 1;
  const zoomIndex = ZOOM_LEVELS.indexOf(zoomLevel);
  const canZoomIn = zoomIndex < ZOOM_LEVELS.length - 1;
  const canZoomOut = zoomIndex > 0;

  const handleScrollToday = useCallback(() => {
    const today = todayDate();
    setScrollOffset(diffDays(today, rawStartDate));
  }, [rawStartDate]);

  return (
    <div className="space-y-0" data-testid="schedule-tab">
      <ScheduleToolbar
        view={view}
        onViewChange={setView}
        zoomLevel={zoomLevel}
        onZoomChange={setZoomLevel}
        onZoomIn={() => canZoomIn && setZoomLevel(ZOOM_LEVELS[zoomIndex + 1])}
        onZoomOut={() => canZoomOut && setZoomLevel(ZOOM_LEVELS[zoomIndex - 1])}
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        onScrollPrev={() => setScrollOffset((offset) => offset - scrollStep)}
        onScrollToday={handleScrollToday}
        onScrollNext={() => setScrollOffset((offset) => offset + scrollStep)}
        onAddTask={handleAddTask}
        onOpenImport={handleOpenImport}
        onToggleFilters={() => setShowFilters((current) => !current)}
        filtersActive={filtersActive}
        insights={scheduleInsights}
        quickFilter={quickFilter}
        onQuickFilterChange={setQuickFilter}
        showCriticalPath={showCriticalPath}
        onToggleCriticalPath={() => setShowCriticalPath((current) => !current)}
        showBaseline={showBaseline}
        onToggleBaseline={() => setShowBaseline((current) => !current)}
        hasBaseline={hasBaseline}
        onSaveBaseline={handleSaveBaseline}
        onClearBaseline={handleClearBaseline}
        baselines={baselines}
        activeBaselineId={activeBaselineId}
        onActiveBaselineChange={setActiveBaselineId}
        onOpenManage={() => setShowManagement(true)}
        calendarCount={calendars.length}
        resourceCount={resources.length}
        onExportPdf={handleExportPdf}
        dateStart={revision.dateWorkStart}
        dateEnd={revision.dateWorkEnd}
      />

      {mutationError && (
        <div className="flex items-start gap-3 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-danger">Schedule action failed</p>
            <p className="mt-0.5 text-xs text-fg/60">{mutationError}</p>
          </div>
          <button
            onClick={() => setMutationError(null)}
            className="text-fg/30 transition-colors hover:text-fg/60"
            aria-label="Dismiss schedule error"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {showFilters && (
        <ScheduleFiltersBar
          filters={filters}
          onChange={setFilters}
          phases={phases}
          assignees={assignees}
        />
      )}

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
          insights={scheduleInsights}
          phases={phases}
          calendar={defaultCalendar}
          zoomLevel={zoomLevel}
          scrollOffset={scrollOffset}
          dateWorkStart={revision.dateWorkStart}
          dateWorkEnd={revision.dateWorkEnd}
          criticalTaskIds={criticalTaskIds}
          showCriticalPath={showCriticalPath}
          showBaseline={showBaseline}
          onUpdateTask={handleUpdateTask}
          onReorderTask={handleReorderTask}
          onClickTask={handleClickTask}
          onContextMenu={handleScheduleContextMenu}
        />
      ) : view === "list" ? (
        <ListView
          tasks={tasks}
          insights={scheduleInsights}
          phases={phases}
          resources={resources}
          taskAssignmentsByTaskId={taskAssignmentsByTaskId}
          onUpdateTask={handleUpdateTask}
          onBatchUpdateTasks={handleBatchUpdateTasks}
          onDeleteTask={handleDeleteTask}
          onReorderTask={handleReorderTask}
          onClickTask={handleClickTask}
          onContextMenu={handleScheduleContextMenu}
        />
      ) : (
        <div className="rounded-b-lg border border-line border-t-0 bg-panel p-3">
          <BoardView
            tasks={tasks}
            insights={scheduleInsights}
            phases={phases}
            resources={resources}
            taskAssignmentsByTaskId={taskAssignmentsByTaskId}
            onUpdateTask={handleUpdateTask}
            onClickTask={handleClickTask}
            onContextMenu={handleScheduleContextMenu}
          />
        </div>
      )}

      <ScheduleContextMenu
        menu={contextMenu}
        onClose={closeContextMenu}
        onEdit={handleClickTask}
        onDelete={(taskId) => {
          void handleDeleteTask(taskId);
        }}
        onUpdate={(taskId, patch) => {
          void handleUpdateTask(taskId, patch);
        }}
        onDuplicate={(task) => {
          void handleDuplicateTask(task);
        }}
        onCreateSibling={(task) => {
          void handleCreateSiblingTask(task.id);
        }}
        onCreateChild={(task) => {
          void handleCreateChildTask(task.id);
        }}
        onIndent={(taskId) => {
          void handleIndentTask(taskId);
        }}
        onOutdent={(taskId) => {
          void handleOutdentTask(taskId);
        }}
        onMove={(taskId, direction) => {
          void handleMoveTask(taskId, direction);
        }}
      />

      {editingTask && (
        <TaskEditPopover
          task={editingTask}
          phases={phases}
          allTasks={rolledTasksWithActiveBaseline}
          dependencies={allDependencies}
          insights={scheduleInsights}
          onSave={handleUpdateTask}
          onDelete={handleDeleteTask}
          onCreateDependency={handleCreateDependency}
          onDeleteDependency={handleDeleteDependency}
          onClose={() => setEditingTask(null)}
          calendars={calendars}
          resources={resources}
          taskAssignments={taskAssignmentsByTaskId.get(editingTask.id) ?? []}
        />
      )}

      <ScheduleManagementModal
        open={showManagement}
        onClose={() => setShowManagement(false)}
        calendars={calendars}
        resources={resources}
        baselines={baselines}
        activeBaselineId={activeBaselineId}
        onActiveBaselineChange={setActiveBaselineId}
        onCreateBaseline={handleCreateBaseline}
        onDeleteBaseline={handleDeleteBaseline}
        onCreateCalendar={handleCreateCalendar}
        onUpdateCalendar={handleUpdateCalendar}
        onDeleteCalendar={handleDeleteCalendar}
        onCreateResource={handleCreateResource}
        onUpdateResource={handleUpdateResource}
        onDeleteResource={handleDeleteResource}
      />

      <ScheduleImportModal
        open={showImportModal}
        candidates={importCandidates}
        loading={importLoading}
        importingId={importingId}
        error={importError}
        onClose={() => setShowImportModal(false)}
        onImport={handleImportSchedule}
      />

      {isPending && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-line bg-panel px-3 py-2 shadow-lg">
          <span className="text-xs text-fg/60">Saving...</span>
        </div>
      )}

      {filtersActive || quickFilterActive ? (
        <div className="text-[11px] text-fg/40">
          Showing {tasks.length} of {allTasks.length} tasks.
        </div>
      ) : null}
    </div>
  );
}
