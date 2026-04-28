"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button, Input, Label, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from "@/components/ui";
import type {
  CreateDependencyInput,
  DependencyType,
  ProjectPhase,
  ScheduleCalendar,
  ScheduleConstraintType,
  ScheduleDependency,
  ScheduleResource,
  ScheduleTask,
  ScheduleTaskAssignment,
  ScheduleTaskPatchInput,
  ScheduleTaskStatus,
  ScheduleTaskType,
} from "@/lib/api";
import type { ScheduleInsights } from "@/lib/schedule-utils";
import {
  STATUS_LABELS,
  buildTaskHierarchyInfo,
  diffDays,
  getTaskDescendantIds,
  getTaskVariance,
  parseDate,
  sortTasksByOrder,
  wouldCreateDependencyCycle,
} from "@/lib/schedule-utils";

interface TaskEditPopoverProps {
  task: ScheduleTask;
  phases: ProjectPhase[];
  allTasks: ScheduleTask[];
  dependencies: ScheduleDependency[];
  insights: ScheduleInsights;
  calendars: ScheduleCalendar[];
  resources: ScheduleResource[];
  taskAssignments: ScheduleTaskAssignment[];
  onSave: (taskId: string, patch: ScheduleTaskPatchInput) => Promise<boolean>;
  onDelete: (taskId: string) => Promise<boolean>;
  onCreateDependency: (input: CreateDependencyInput) => Promise<boolean>;
  onDeleteDependency: (depId: string) => Promise<boolean>;
  onClose: () => void;
}

const DEPENDENCY_TYPE_LABELS: Record<DependencyType, string> = {
  FS: "Finish to Start",
  SS: "Start to Start",
  FF: "Finish to Finish",
  SF: "Start to Finish",
};

const CONSTRAINT_LABELS: Record<ScheduleConstraintType, string> = {
  asap: "As Soon As Possible",
  alap: "As Late As Possible",
  snet: "Start No Earlier Than",
  snlt: "Start No Later Than",
  fnet: "Finish No Earlier Than",
  fnlt: "Finish No Later Than",
  mso: "Must Start On",
  mfo: "Must Finish On",
};

export function TaskEditPopover({
  task,
  phases,
  allTasks,
  dependencies,
  insights,
  calendars,
  resources,
  taskAssignments,
  onSave,
  onDelete,
  onCreateDependency,
  onDeleteDependency,
  onClose,
}: TaskEditPopoverProps) {
  const [activeTab, setActiveTab] = useState("task");
  const [taskSubtab, setTaskSubtab] = useState("basics");
  const [dateSubtab, setDateSubtab] = useState("plan");
  const [logicSubtab, setLogicSubtab] = useState("predecessors");
  const [name, setName] = useState(task.name);
  const [description, setDescription] = useState(task.description);
  const [taskType, setTaskType] = useState<ScheduleTaskType>(task.taskType);
  const [status, setStatus] = useState<ScheduleTaskStatus>(task.status);
  const [startDate, setStartDate] = useState(task.startDate?.slice(0, 10) ?? "");
  const [endDate, setEndDate] = useState(task.endDate?.slice(0, 10) ?? "");
  const [progress, setProgress] = useState(task.progress);
  const [assignee, setAssignee] = useState(task.assignee);
  const [phaseId, setPhaseId] = useState(task.phaseId ?? "");
  const [calendarId, setCalendarId] = useState(task.calendarId ?? "");
  const [parentTaskId, setParentTaskId] = useState(task.parentTaskId ?? "");
  const [constraintType, setConstraintType] = useState<ScheduleConstraintType>(task.constraintType);
  const [constraintDate, setConstraintDate] = useState(task.constraintDate?.slice(0, 10) ?? "");
  const [deadlineDate, setDeadlineDate] = useState(task.deadlineDate?.slice(0, 10) ?? "");
  const [actualStart, setActualStart] = useState(task.actualStart?.slice(0, 10) ?? "");
  const [actualEnd, setActualEnd] = useState(task.actualEnd?.slice(0, 10) ?? "");
  const [resourceAssignments, setResourceAssignments] = useState(
    taskAssignments.map((assignment) => ({
      resourceId: assignment.resourceId,
      units: String(assignment.units),
      role: assignment.role,
    }))
  );
  const [selectedPredecessorId, setSelectedPredecessorId] = useState("");
  const [dependencyType, setDependencyType] = useState<DependencyType>("FS");
  const [dependencyLagDays, setDependencyLagDays] = useState("0");
  const [formError, setFormError] = useState<string | null>(null);
  const [dependencyError, setDependencyError] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab("task");
    setTaskSubtab("basics");
    setDateSubtab("plan");
    setLogicSubtab("predecessors");
    setName(task.name);
    setDescription(task.description);
    setTaskType(task.taskType);
    setStatus(task.status);
    setStartDate(task.startDate?.slice(0, 10) ?? "");
    setEndDate(task.endDate?.slice(0, 10) ?? "");
    setProgress(task.progress);
    setAssignee(task.assignee);
    setPhaseId(task.phaseId ?? "");
    setCalendarId(task.calendarId ?? "");
    setParentTaskId(task.parentTaskId ?? "");
    setConstraintType(task.constraintType);
    setConstraintDate(task.constraintDate?.slice(0, 10) ?? "");
    setDeadlineDate(task.deadlineDate?.slice(0, 10) ?? "");
    setActualStart(task.actualStart?.slice(0, 10) ?? "");
    setActualEnd(task.actualEnd?.slice(0, 10) ?? "");
    setResourceAssignments(
      taskAssignments.map((assignment) => ({
        resourceId: assignment.resourceId,
        units: String(assignment.units),
        role: assignment.role,
      }))
    );
    setSelectedPredecessorId("");
    setDependencyType("FS");
    setDependencyLagDays("0");
    setFormError(null);
    setDependencyError(null);
  }, [task, taskAssignments]);

  const taskNameById = useMemo(() => new Map(allTasks.map((item) => [item.id, item.name || "Untitled"])), [allTasks]);
  const predecessorDependencies = useMemo(
    () => dependencies.filter((dependency) => dependency.successorId === task.id),
    [dependencies, task.id]
  );
  const successorDependencies = useMemo(
    () => dependencies.filter((dependency) => dependency.predecessorId === task.id),
    [dependencies, task.id]
  );
  const variance = useMemo(() => getTaskVariance(task), [task]);
  const totalFloat = insights.totalFloatByTask.get(task.id);
  const isCritical = insights.criticalTaskIds.has(task.id);
  const isOverdue = insights.overdueTaskIds.has(task.id);
  const hasLogicIssue = insights.violatingTaskIds.has(task.id);
  const hasDeadlineRisk = insights.deadlineMissTaskIds.has(task.id);
  const hasConstraintRisk = insights.constraintViolationTaskIds.has(task.id);
  const hasActualRisk = insights.actualDateGapTaskIds.has(task.id);
  const hasResourceRisk = insights.resourceConflictTaskIds.has(task.id);
  const currentPhaseTasks = useMemo(
    () => sortTasksByOrder(allTasks.filter((item) => (item.phaseId ?? "") === phaseId)),
    [allTasks, phaseId]
  );
  const currentPhaseHierarchy = useMemo(() => buildTaskHierarchyInfo(currentPhaseTasks), [currentPhaseTasks]);
  const hasChildren = (currentPhaseHierarchy.get(task.id)?.hasChildren ?? false) || allTasks.some((item) => item.parentTaskId === task.id);
  const effectiveTaskType: ScheduleTaskType = hasChildren ? "summary" : taskType;
  const isMilestoneTask = effectiveTaskType === "milestone";
  const isSummaryTask = effectiveTaskType === "summary";
  const isRollupLocked = hasChildren;
  const descendantIds = useMemo(() => new Set(getTaskDescendantIds(allTasks, task.id)), [allTasks, task.id]);
  const availableParentTasks = useMemo(
    () => currentPhaseTasks.filter((item) => item.id !== task.id && !descendantIds.has(item.id)),
    [currentPhaseTasks, descendantIds, task.id]
  );
  const availablePredecessors = useMemo(() => {
    const existingIds = new Set(predecessorDependencies.map((dependency) => dependency.predecessorId));
    return allTasks
      .filter(
        (item) =>
          item.id !== task.id &&
          !existingIds.has(item.id) &&
          !wouldCreateDependencyCycle(dependencies, item.id, task.id)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allTasks, dependencies, predecessorDependencies, task.id]);
  const parentTask = parentTaskId ? allTasks.find((item) => item.id === parentTaskId) ?? null : null;
  const outlineLevel = parentTask ? Math.min(12, (parentTask.outlineLevel ?? 0) + 1) : 0;
  const wbsPath = useMemo(() => {
    const segments: string[] = [];
    let current = parentTask;
    let safety = 0;
    while (current && safety < 12) {
      segments.unshift(current.name || "Untitled");
      current = current.parentTaskId ? allTasks.find((item) => item.id === current!.parentTaskId) ?? null : null;
      safety += 1;
    }
    return segments;
  }, [allTasks, parentTask]);

  useEffect(() => {
    if (!parentTaskId) return;
    if (!availableParentTasks.some((item) => item.id === parentTaskId)) {
      setParentTaskId("");
    }
  }, [availableParentTasks, parentTaskId]);

  const handleSave = async () => {
    const normalizedStartDate = startDate || null;
    const normalizedEndDate = isMilestoneTask ? (startDate || null) : (endDate || null);
    const parsedStartDate = parseDate(normalizedStartDate);
    const parsedEndDate = parseDate(normalizedEndDate);

    if (
      !isMilestoneTask &&
      parsedStartDate &&
      parsedEndDate &&
      parsedEndDate.getTime() < parsedStartDate.getTime()
    ) {
      setFormError("End date cannot be before the start date.");
      setActiveTab("dates");
      return;
    }

    const duration =
      isMilestoneTask
        ? 0
        : parsedStartDate && parsedEndDate
          ? Math.max(0, diffDays(parsedEndDate, parsedStartDate))
          : task.duration;

    setFormError(null);
    const didSave = await onSave(task.id, {
      name,
      description,
      taskType: effectiveTaskType,
      status,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
      duration,
      progress: isMilestoneTask ? 0 : progress,
      assignee,
      phaseId: phaseId || null,
      calendarId: calendarId || null,
      parentTaskId: parentTaskId || null,
      outlineLevel,
      constraintType,
      constraintDate: constraintDate || null,
      deadlineDate: deadlineDate || null,
      actualStart: actualStart || null,
      actualEnd: actualEnd || null,
      resourceAssignments: resourceAssignments
        .filter((assignment) => assignment.resourceId)
        .map((assignment) => ({
          resourceId: assignment.resourceId,
          units: Number.parseFloat(assignment.units || "1") || 1,
          role: assignment.role || "",
        })),
    });

    if (didSave) {
      onClose();
    }
  };

  const handleDelete = async () => {
    const didDelete = await onDelete(task.id);
    if (didDelete) {
      onClose();
    }
  };

  const handleAddDependency = async () => {
    if (!selectedPredecessorId) {
      setDependencyError("Choose a predecessor task first.");
      return;
    }
    if (wouldCreateDependencyCycle(dependencies, selectedPredecessorId, task.id)) {
      setDependencyError("That dependency would create a cycle in the schedule.");
      return;
    }

    const didCreate = await onCreateDependency({
      predecessorId: selectedPredecessorId,
      successorId: task.id,
      type: dependencyType,
      lagDays: Number.parseInt(dependencyLagDays || "0", 10) || 0,
    });

    if (didCreate) {
      setSelectedPredecessorId("");
      setDependencyType("FS");
      setDependencyLagDays("0");
      setDependencyError(null);
    }
  };

  const handleRemoveDependency = async (dependencyId: string) => {
    const didDelete = await onDeleteDependency(dependencyId);
    if (!didDelete) {
      setDependencyError("Unable to remove the dependency right now.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="task-popover">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <div
        data-testid="task-popover-panel"
        className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
        style={{ height: "min(92vh, 780px)" }}
      >
        <div className="border-b border-line px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg/35">Task Editor</p>
              <h3 className="mt-1 truncate text-base font-semibold text-fg">{task.name || "Untitled Task"}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-fg/45">
                <span className="rounded-full bg-panel2 px-2 py-1">{STATUS_LABELS[status]}</span>
                <span className="rounded-full bg-panel2 px-2 py-1">
                  {isSummaryTask ? "Summary Task" : isMilestoneTask ? "Milestone" : "Task"}
                </span>
                <span className="rounded-full bg-panel2 px-2 py-1">WBS L{outlineLevel}</span>
                {phaseId ? (
                  <span className="rounded-full bg-panel2 px-2 py-1">
                    {phases.find((phase) => phase.id === phaseId)?.name ?? "Phase"}
                  </span>
                ) : null}
              </div>
            </div>
            <button type="button" onClick={onClose} className="text-fg/40 transition-colors hover:text-fg">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-h-0 flex-col px-5 py-4">
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="task">Task</TabsTrigger>
                <TabsTrigger value="dates">Dates</TabsTrigger>
                <TabsTrigger value="resources">Resources</TabsTrigger>
                <TabsTrigger value="logic">Logic</TabsTrigger>
              </TabsList>

              <TabsContent value="task" className="space-y-4">
                <Tabs value={taskSubtab} onValueChange={setTaskSubtab}>
                  <TabsList className="mb-4">
                    <TabsTrigger value="basics">Basics</TabsTrigger>
                    <TabsTrigger value="placement">Placement</TabsTrigger>
                    <TabsTrigger value="notes">Notes</TabsTrigger>
                  </TabsList>

                  <TabsContent value="basics" className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>Name</Label>
                      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Task name" />
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Type</Label>
                        <Select
                          value={effectiveTaskType}
                          onValueChange={(v) => setTaskType(v as ScheduleTaskType)}
                          disabled={hasChildren}
                          options={[
                            { value: "task", label: "Task" },
                            { value: "milestone", label: "Milestone" },
                            { value: "summary", label: "Summary Task" },
                          ]}
                        />
                        {hasChildren ? (
                          <p className="text-[11px] text-fg/40">
                            Tasks with children behave as summary tasks and roll up their child dates automatically.
                          </p>
                        ) : null}
                      </div>
                      <div className="space-y-1.5">
                        <Label>Status</Label>
                        <Select
                          value={status}
                          onValueChange={(v) => setStatus(v as ScheduleTaskStatus)}
                          disabled={isRollupLocked}
                          options={(Object.entries(STATUS_LABELS) as [ScheduleTaskStatus, string][]).map(([key, label]) => ({ value: key, label }))}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Assignee</Label>
                        <Input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Assignee name" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Calendar</Label>
                        <Select
                          value={calendarId || "__default__"}
                          onValueChange={(v) => setCalendarId(v === "__default__" ? "" : v)}
                          options={[
                            { value: "__default__", label: "Default Project Calendar" },
                            ...calendars.map((calendar) => ({
                              value: calendar.id,
                              label: `${calendar.isDefault ? "[Default] " : ""}${calendar.name}`,
                            })),
                          ]}
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="placement" className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Phase</Label>
                        <Select
                          value={phaseId || "__none__"}
                          onValueChange={(v) => setPhaseId(v === "__none__" ? "" : v)}
                          options={[
                            { value: "__none__", label: "No Phase" },
                            ...phases.map((phase) => ({
                              value: phase.id,
                              label: `${phase.number ? `${phase.number}. ` : ""}${phase.name}`,
                            })),
                          ]}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Parent Task</Label>
                        <Select
                          value={parentTaskId || "__top__"}
                          onValueChange={(v) => setParentTaskId(v === "__top__" ? "" : v)}
                          options={[
                            { value: "__top__", label: "Top Level Task" },
                            ...availableParentTasks.map((item) => {
                              const depth = currentPhaseHierarchy.get(item.id)?.depth ?? item.outlineLevel ?? 0;
                              return {
                                value: item.id,
                                label: `${"  ".repeat(depth)}${item.name || "Untitled"}`,
                              };
                            }),
                          ]}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-line bg-panel2/15 px-4 py-3 text-xs text-fg/55">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg/35">WBS Path</p>
                        <p className="mt-2 text-fg/75">
                          {wbsPath.length > 0 ? `${wbsPath.join(" / ")} / ${name || "Untitled Task"}` : "Top-level schedule task"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-line bg-panel2/15 px-4 py-3 text-xs text-fg/55">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg/35">Hierarchy Rules</p>
                        <p className="mt-2">
                          Child tasks stay in the same phase as their parent. Drag list rows onto the middle of another row to nest under it.
                        </p>
                        {hasChildren ? (
                          <p className="mt-2 text-fg/45">
                            This row is currently a summary task because it has child activities under it.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="notes" className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>Description</Label>
                      <Textarea
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="Task description..."
                        rows={8}
                      />
                    </div>
                  </TabsContent>
                </Tabs>
              </TabsContent>

              <TabsContent value="dates" className="space-y-4">
                <Tabs value={dateSubtab} onValueChange={setDateSubtab}>
                  <TabsList className="mb-4">
                    <TabsTrigger value="plan">Plan</TabsTrigger>
                    <TabsTrigger value="actuals">Actuals</TabsTrigger>
                  </TabsList>

                  <TabsContent value="plan" className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Start Date</Label>
                        <Input
                          type="date"
                          value={startDate}
                          onChange={(event) => setStartDate(event.target.value)}
                          disabled={isRollupLocked}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{isMilestoneTask ? "Milestone Date" : "Finish Date"}</Label>
                        <Input
                          type="date"
                          value={isMilestoneTask ? startDate : endDate}
                          onChange={(event) => {
                            if (isMilestoneTask) {
                              setStartDate(event.target.value);
                            } else {
                              setEndDate(event.target.value);
                            }
                          }}
                          disabled={isRollupLocked}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Constraint</Label>
                        <Select
                          value={constraintType}
                          onValueChange={(v) => setConstraintType(v as ScheduleConstraintType)}
                          options={(Object.entries(CONSTRAINT_LABELS) as [ScheduleConstraintType, string][]).map(([key, label]) => ({ value: key, label }))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Constraint Date</Label>
                        <Input data-testid="task-constraint-date" type="date" value={constraintDate} onChange={(event) => setConstraintDate(event.target.value)} />
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Deadline</Label>
                        <Input data-testid="task-deadline-date" type="date" value={deadlineDate} onChange={(event) => setDeadlineDate(event.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Progress ({Math.round((isMilestoneTask ? 0 : progress) * 100)}%)</Label>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={isMilestoneTask ? 0 : progress}
                          onChange={(event) => setProgress(Number.parseFloat(event.target.value))}
                          disabled={isMilestoneTask || isRollupLocked}
                          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-accent disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </div>
                    </div>

                    {isRollupLocked ? (
                      <div className="rounded-xl border border-line bg-panel2/15 px-4 py-3 text-xs text-fg/55">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg/35">Summary Rollup</p>
                        <p className="mt-2">
                        Start, finish, duration, and progress are being calculated from this task's child activities.
                        </p>
                      </div>
                    ) : null}
                  </TabsContent>

                  <TabsContent value="actuals" className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Actual Start</Label>
                        <Input type="date" value={actualStart} onChange={(event) => setActualStart(event.target.value)} disabled={isRollupLocked} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Actual Finish</Label>
                        <Input type="date" value={actualEnd} onChange={(event) => setActualEnd(event.target.value)} disabled={isRollupLocked} />
                      </div>
                    </div>

                    <div className="rounded-xl border border-line bg-panel2/15 px-4 py-3 text-xs text-fg/55">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg/35">Actuals Check</p>
                      <p className="mt-2">
                        Completed tasks should have actual finish dates. Tasks with actuals but no status alignment will be flagged in schedule health.
                      </p>
                    </div>
                  </TabsContent>
                </Tabs>
              </TabsContent>

              <TabsContent value="resources" className="space-y-4">
                <div className="space-y-3 rounded-xl border border-line bg-panel2/15 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-fg">Resource Loading</h4>
                      <p className="mt-1 text-xs text-fg/45">Assign labor, crews, or equipment with daily units and role notes.</p>
                    </div>
                    <Button
                      variant="secondary"
                      size="xs"
                      data-testid="task-add-resource"
                      onClick={() => setResourceAssignments((current) => [...current, { resourceId: "", units: "1", role: "" }])}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add
                    </Button>
                  </div>

                  {resourceAssignments.length === 0 ? (
                    <p className="text-xs text-fg/40">No resources assigned yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {resourceAssignments.map((assignment, index) => (
                        <div key={`${assignment.resourceId}-${index}`} className="grid gap-2 rounded-lg border border-line/70 bg-panel px-3 py-3 md:grid-cols-[minmax(0,1fr)_92px_minmax(0,1fr)_36px]">
                          <Select
                            data-testid={`task-resource-${index}`}
                            value={assignment.resourceId || "__choose__"}
                            onValueChange={(v) =>
                              setResourceAssignments((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index ? { ...entry, resourceId: v === "__choose__" ? "" : v } : entry
                                )
                              )
                            }
                            options={[
                              { value: "__choose__", label: "Choose resource..." },
                              ...resources.map((resource) => ({ value: resource.id, label: resource.name })),
                            ]}
                          />
                          <Input
                            data-testid={`task-resource-units-${index}`}
                            type="number"
                            step="0.25"
                            value={assignment.units}
                            onChange={(event) =>
                              setResourceAssignments((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index ? { ...entry, units: event.target.value } : entry
                                )
                              )
                            }
                          />
                          <Input
                            data-testid={`task-resource-role-${index}`}
                            value={assignment.role}
                            onChange={(event) =>
                              setResourceAssignments((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index ? { ...entry, role: event.target.value } : entry
                                )
                              )
                            }
                            placeholder="Role"
                          />
                          <button
                            type="button"
                            onClick={() => setResourceAssignments((current) => current.filter((_, entryIndex) => entryIndex !== index))}
                            className="text-fg/25 transition-colors hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="logic" className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-fg">Dependencies</h4>
                  <p className="mt-1 text-xs text-fg/45">Manage predecessor logic for this activity. Gantt links update automatically.</p>
                </div>
                <Tabs value={logicSubtab} onValueChange={setLogicSubtab}>
                  <TabsList className="mb-4">
                    <TabsTrigger value="predecessors">Predecessors</TabsTrigger>
                    <TabsTrigger value="successors">Successors</TabsTrigger>
                  </TabsList>

                  <TabsContent value="predecessors" className="space-y-4">
                    <div className="space-y-2">
                      <Label>Incoming Logic</Label>
                      {predecessorDependencies.length === 0 ? (
                        <p className="text-xs text-fg/40">No predecessor dependencies yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {predecessorDependencies.map((dependency) => (
                            <div key={dependency.id} className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs text-fg/75">
                                  {taskNameById.get(dependency.predecessorId) ?? "Unknown task"}
                                </p>
                                <p className="text-[11px] text-fg/40">
                                  {DEPENDENCY_TYPE_LABELS[dependency.type]}
                                  {dependency.lagDays ? ` | Lag ${dependency.lagDays}d` : ""}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleRemoveDependency(dependency.id)}
                                className="text-fg/25 transition-colors hover:text-danger"
                                title="Remove dependency"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 rounded-xl border border-dashed border-line p-4">
                      <Label>Add Predecessor</Label>
                      <Select
                        value={selectedPredecessorId || "__choose__"}
                        onValueChange={(v) => setSelectedPredecessorId(v === "__choose__" ? "" : v)}
                        options={[
                          { value: "__choose__", label: "Choose a task..." },
                          ...availablePredecessors.map((item) => ({ value: item.id, label: item.name || "Untitled" })),
                        ]}
                      />
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_88px]">
                        <Select
                          value={dependencyType}
                          onValueChange={(v) => setDependencyType(v as DependencyType)}
                          options={(Object.entries(DEPENDENCY_TYPE_LABELS) as [DependencyType, string][]).map(([key, label]) => ({ value: key, label }))}
                        />
                        <Input
                          type="number"
                          value={dependencyLagDays}
                          onChange={(event) => setDependencyLagDays(event.target.value)}
                          placeholder="Lag"
                        />
                      </div>
                      {dependencyError && <p className="text-[11px] text-danger">{dependencyError}</p>}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleAddDependency()}
                        disabled={availablePredecessors.length === 0}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Dependency
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="successors" className="space-y-4">
                    <div className="space-y-2">
                      <Label>Outgoing Logic</Label>
                      {successorDependencies.length === 0 ? (
                        <p className="text-xs text-fg/40">No tasks depend on this one yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {successorDependencies.map((dependency) => (
                            <div key={dependency.id} className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs text-fg/75">
                                  {taskNameById.get(dependency.successorId) ?? "Unknown task"}
                                </p>
                                <p className="text-[11px] text-fg/40">
                                  {DEPENDENCY_TYPE_LABELS[dependency.type]}
                                  {dependency.lagDays ? ` | Lag ${dependency.lagDays}d` : ""}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleRemoveDependency(dependency.id)}
                                className="text-fg/25 transition-colors hover:text-danger"
                                title="Remove dependency"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </TabsContent>
              </Tabs>

              {formError && <p className="mt-4 text-xs text-danger">{formError}</p>}
            </div>

            <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
              <Button variant="danger" size="sm" onClick={() => void handleDelete()}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="accent" size="sm" onClick={() => void handleSave()} data-testid="task-save">
                Save
              </Button>
            </div>
          </div>

          <aside className="min-h-0 overflow-y-auto border-l border-line bg-panel2/18 px-5 py-4">
            <div className="space-y-4">
              <div className="space-y-2 rounded-xl border border-line bg-panel px-4 py-4">
                <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-fg/40">Schedule Health</h4>
                <div className="grid grid-cols-2 gap-2 text-xs text-fg/60">
                  <div className="rounded-lg border border-line/70 bg-panel2/25 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-fg/35">Total Float</p>
                    <p className="mt-1 font-medium text-fg/80">
                      {typeof totalFloat === "number" && Number.isFinite(totalFloat) ? `${Math.round(totalFloat)}d` : "N/A"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-line/70 bg-panel2/25 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-fg/35">Finish Variance</p>
                    <p className="mt-1 font-medium text-fg/80">
                      {variance.finishDays === null ? "N/A" : `${variance.finishDays > 0 ? "+" : ""}${variance.finishDays}d`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {isCritical && <span className="rounded-full bg-accent/10 px-2 py-1 text-[11px] text-accent">Critical</span>}
                  {isOverdue && <span className="rounded-full bg-danger/10 px-2 py-1 text-[11px] text-danger">Overdue</span>}
                  {variance.isBehind && <span className="rounded-full bg-warning/10 px-2 py-1 text-[11px] text-warning">Behind baseline</span>}
                  {hasLogicIssue && <span className="rounded-full bg-warning/10 px-2 py-1 text-[11px] text-warning">Logic issue</span>}
                  {hasDeadlineRisk && <span className="rounded-full bg-danger/10 px-2 py-1 text-[11px] text-danger">Missed deadline</span>}
                  {hasConstraintRisk && <span className="rounded-full bg-warning/10 px-2 py-1 text-[11px] text-warning">Constraint risk</span>}
                  {hasActualRisk && <span className="rounded-full bg-warning/10 px-2 py-1 text-[11px] text-warning">Actuals mismatch</span>}
                  {hasResourceRisk && <span className="rounded-full bg-warning/10 px-2 py-1 text-[11px] text-warning">Resource overload</span>}
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-line bg-panel px-4 py-4">
                <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-fg/40">WBS Placement</h4>
                <div className="space-y-2 text-xs text-fg/55">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-fg/40">Level</span>
                    <span className="font-medium text-fg/75">{outlineLevel}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-fg/40">Parent</span>
                    <span className="truncate text-right font-medium text-fg/75">{parentTask?.name ?? "Top Level"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-fg/40">Children</span>
                    <span className="font-medium text-fg/75">{currentPhaseHierarchy.get(task.id)?.childCount ?? 0}</span>
                  </div>
                </div>
                <div className="rounded-lg bg-panel2/20 px-3 py-2 text-[11px] text-fg/45">
                  {wbsPath.length > 0 ? wbsPath.join(" / ") : "This task sits at the top level of the schedule hierarchy."}
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-line bg-panel px-4 py-4">
                <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-fg/40">Field Snapshot</h4>
                <div className="space-y-2 text-xs text-fg/55">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-fg/40">Start</span>
                    <span className="font-medium text-fg/75">{startDate || "TBD"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-fg/40">Finish</span>
                    <span className="font-medium text-fg/75">{isMilestoneTask ? startDate || "TBD" : endDate || "TBD"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-fg/40">Assigned Resources</span>
                    <span className="font-medium text-fg/75">{resourceAssignments.filter((assignment) => assignment.resourceId).length}</span>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
