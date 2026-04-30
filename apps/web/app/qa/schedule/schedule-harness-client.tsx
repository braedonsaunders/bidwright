"use client";

import { useMemo, useRef, useState } from "react";
import { ScheduleTab } from "@/components/workspace/schedule-tab";
import type {
  CreateDependencyInput,
  CreateScheduleBaselineInput,
  CreateScheduleCalendarInput,
  CreateScheduleResourceInput,
  CreateScheduleTaskInput,
  ProjectWorkspaceData,
  ScheduleBaseline,
  ScheduleCalendarPatchInput,
  ScheduleResourcePatchInput,
  ScheduleTask,
  ScheduleTaskPatchInput,
  WorkspaceResponse,
} from "@/lib/api";

function buildHarnessWorkspace(): ProjectWorkspaceData {
  const projectId = "project-harness";
  const revisionId = "revision-harness";
  const phaseId = "phase-roof";

  return {
    project: {
      id: projectId,
      name: "QA Schedule Harness",
      clientName: "Internal",
      location: "Toronto, ON",
      scope: "",
      packageName: "Schedule QA",
      packageUploadedAt: null,
      ingestionStatus: "review",
      summary: "Interactive schedule test harness",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
    sourceDocuments: [],
    quote: {
      id: "quote-harness",
      quoteNumber: "QA-001",
      title: "Schedule QA",
      projectId,
      status: "review",
      currentRevisionId: revisionId,
      customerExistingNew: "Existing",
      customerId: null,
      customerName: null,
      customerString: "Internal",
      customerContactId: null,
      customerContactString: "",
      customerContactEmailString: "",
      departmentId: null,
      userId: null,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
    currentRevision: {
      id: revisionId,
      quoteId: "quote-harness",
      revisionNumber: 0,
      title: "Revision 0",
      description: "",
      notes: "",
      breakoutStyle: "phase",
      type: "Firm",
      scratchpad: "",
      leadLetter: "",
      dateEstimatedShip: null,
      dateQuote: null,
      dateDue: null,
      dateWalkdown: null,
      dateWorkStart: "2026-04-06",
      dateWorkEnd: "2026-05-08",
      shippingMethod: "",
      shippingTerms: "",
      freightOnBoard: "",
      status: "Open",
      defaultMarkup: 0,
      necaDifficulty: "",
      followUpNote: "",
      printEmptyNotesColumn: false,
      printCategory: [],
      printPhaseTotalOnly: false,
      grandTotal: 0,
      regHours: 0,
      overHours: 0,
      doubleHours: 0,
      breakoutPackage: [],
      calculatedCategoryTotals: [],
      summaryLayoutPreset: "custom",
      pdfPreferences: {},
      subtotal: 0,
      cost: 0,
      estimatedProfit: 0,
      estimatedMargin: 0,
      calculatedTotal: 0,
      totalHours: 0,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
    worksheets: [],
    phases: [
      {
        id: phaseId,
        revisionId,
        number: "1",
        name: "Roofing",
        description: "",
        order: 1,
        startDate: null,
        endDate: null,
        color: "#0ea5e9",
      },
    ],
    adjustments: [],
    modifiers: [],
    additionalLineItems: [],
    summaryBuilder: null,
    summaryRows: [],
    conditions: [],
    catalogs: [],
    rateSchedules: [],
    aiRuns: [],
    citations: [],
    scheduleTasks: [
      {
        id: "task-mobilize",
        projectId,
        revisionId,
        phaseId,
        calendarId: "cal-standard",
        parentTaskId: null,
        outlineLevel: 0,
        name: "Mobilize and layout",
        description: "Confirm access, crane path, and rooftop staging.",
        taskType: "task",
        status: "in_progress",
        startDate: "2026-04-06",
        endDate: "2026-04-10",
        duration: 4,
        progress: 0.5,
        assignee: "Alex",
        order: 1,
        constraintType: "asap",
        constraintDate: null,
        deadlineDate: "2026-04-10",
        actualStart: "2026-04-06",
        actualEnd: null,
        baselineStart: "2026-04-06",
        baselineEnd: "2026-04-09",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "task-curbs",
        projectId,
        revisionId,
        phaseId,
        calendarId: "cal-standard",
        parentTaskId: "task-mobilize",
        outlineLevel: 1,
        name: "Install roof curbs",
        description: "Coordinate penetrations and weatherproofing.",
        taskType: "task",
        status: "not_started",
        startDate: "2026-04-10",
        endDate: "2026-04-15",
        duration: 5,
        progress: 0,
        assignee: "Blair",
        order: 2,
        constraintType: "snet",
        constraintDate: "2026-04-10",
        deadlineDate: "2026-04-15",
        actualStart: null,
        actualEnd: null,
        baselineStart: "2026-04-09",
        baselineEnd: "2026-04-14",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "task-startup",
        projectId,
        revisionId,
        phaseId,
        calendarId: "cal-standard",
        parentTaskId: "task-curbs",
        outlineLevel: 2,
        name: "Startup milestone",
        description: "Owner witness and turnover.",
        taskType: "milestone",
        status: "not_started",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        duration: 0,
        progress: 0,
        assignee: "",
        order: 3,
        constraintType: "mfo",
        constraintDate: "2026-04-20",
        deadlineDate: "2026-04-20",
        actualStart: null,
        actualEnd: null,
        baselineStart: "2026-04-18",
        baselineEnd: "2026-04-18",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "task-closeout",
        projectId,
        revisionId,
        phaseId,
        calendarId: "cal-standard",
        parentTaskId: null,
        outlineLevel: 0,
        name: "Closeout and punchlist",
        description: "Final cleanup, punchlist work, and turnover package.",
        taskType: "task",
        status: "not_started",
        startDate: "2026-04-22",
        endDate: "2026-04-26",
        duration: 4,
        progress: 0,
        assignee: "Casey",
        order: 4,
        constraintType: "asap",
        constraintDate: null,
        deadlineDate: "2026-04-27",
        actualStart: null,
        actualEnd: null,
        baselineStart: "2026-04-21",
        baselineEnd: "2026-04-25",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
    ],
    scheduleDependencies: [
      { id: "dep-1", predecessorId: "task-mobilize", successorId: "task-curbs", type: "FS", lagDays: 0 },
      { id: "dep-2", predecessorId: "task-curbs", successorId: "task-startup", type: "FS", lagDays: 2 },
      { id: "dep-3", predecessorId: "task-startup", successorId: "task-closeout", type: "FS", lagDays: 1 },
    ],
    scheduleCalendars: [
      {
        id: "cal-standard",
        projectId,
        revisionId,
        name: "Standard 5-Day",
        description: "Mon-Fri 8am-5pm",
        isDefault: true,
        workingDays: { "0": false, "1": true, "2": true, "3": true, "4": true, "5": true, "6": false },
        shiftStartMinutes: 480,
        shiftEndMinutes: 1020,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
    ],
    scheduleBaselines: [
      {
        id: "baseline-primary",
        projectId,
        revisionId,
        name: "Award Baseline",
        description: "Issued execution plan",
        kind: "primary",
        isPrimary: true,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
    ],
    scheduleBaselineTasks: [
      {
        id: "baseline-primary-1",
        baselineId: "baseline-primary",
        taskId: "task-mobilize",
        taskName: "Mobilize and layout",
        phaseId,
        startDate: "2026-04-06",
        endDate: "2026-04-09",
        duration: 4,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "baseline-primary-2",
        baselineId: "baseline-primary",
        taskId: "task-curbs",
        taskName: "Install roof curbs",
        phaseId,
        startDate: "2026-04-09",
        endDate: "2026-04-14",
        duration: 5,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "baseline-primary-3",
        baselineId: "baseline-primary",
        taskId: "task-startup",
        taskName: "Startup milestone",
        phaseId,
        startDate: "2026-04-18",
        endDate: "2026-04-18",
        duration: 0,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "baseline-primary-4",
        baselineId: "baseline-primary",
        taskId: "task-closeout",
        taskName: "Closeout and punchlist",
        phaseId,
        startDate: "2026-04-21",
        endDate: "2026-04-25",
        duration: 4,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
    ],
    scheduleResources: [
      {
        id: "res-crew-a",
        projectId,
        revisionId,
        calendarId: "cal-standard",
        name: "Crew A",
        role: "Install Crew",
        kind: "crew",
        color: "#0ea5e9",
        defaultUnits: 1,
        capacityPerDay: 1,
        costRate: 0,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "res-lift",
        projectId,
        revisionId,
        calendarId: "cal-standard",
        name: "Scissor Lift",
        role: "Equipment",
        kind: "equipment",
        color: "#f59e0b",
        defaultUnits: 1,
        capacityPerDay: 1,
        costRate: 0,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
    ],
    scheduleTaskAssignments: [
      {
        id: "asg-1",
        taskId: "task-mobilize",
        resourceId: "res-crew-a",
        units: 1,
        role: "Lead",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "asg-2",
        taskId: "task-curbs",
        resourceId: "res-crew-a",
        units: 1,
        role: "Lead",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "asg-3",
        taskId: "task-curbs",
        resourceId: "res-lift",
        units: 1,
        role: "Equipment",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "asg-4",
        taskId: "task-closeout",
        resourceId: "res-lift",
        units: 1,
        role: "Support",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
    ],
    estimate: {
      revisionId,
      totals: {
        revisionId,
        subtotal: 0,
        cost: 0,
        estimatedProfit: 0,
        estimatedMargin: 0,
        calculatedTotal: 0,
        regHours: 0,
        overHours: 0,
        doubleHours: 0,
        totalHours: 0,
        categoryTotals: [],
        phaseTotals: [],
        phaseCategoryTotals: [],
        worksheetTotals: [],
        worksheetCategoryTotals: [],
        worksheetPhaseTotals: [],
        adjustmentTotals: [],
        breakout: [],
      },
      lineItems: [],
      summary: {
        sourceDocumentCount: 0,
        worksheetCount: 0,
        lineItemCount: 0,
        citationCount: 0,
        aiRunCount: 0,
      },
    },
    takeoffLinks: [],
    estimateStrategy: null,
    estimateFeedback: [],
  } as unknown as ProjectWorkspaceData;
}

function wrapWorkspace(workspace: ProjectWorkspaceData): WorkspaceResponse {
  return {
    workspace,
    workspaceState: null,
    summaryMetrics: [],
    packages: [],
    jobs: [],
    documents: workspace.sourceDocuments,
  };
}

function syncPrimaryBaselineFields(workspace: ProjectWorkspaceData): ProjectWorkspaceData {
  const primaryBaseline = workspace.scheduleBaselines.find((baseline) => baseline.isPrimary) ?? null;
  if (!primaryBaseline) {
    return {
      ...workspace,
      scheduleTasks: workspace.scheduleTasks.map((task) => ({ ...task, baselineStart: null, baselineEnd: null })),
    };
  }

  const itemByTaskId = new Map(
    workspace.scheduleBaselineTasks
      .filter((item) => item.baselineId === primaryBaseline.id)
      .map((item) => [item.taskId, item] as const)
  );
  return {
    ...workspace,
    scheduleTasks: workspace.scheduleTasks.map((task) => ({
      ...task,
      baselineStart: itemByTaskId.get(task.id)?.startDate ?? null,
      baselineEnd: itemByTaskId.get(task.id)?.endDate ?? null,
    })),
  };
}

function captureBaseline(
  workspace: ProjectWorkspaceData,
  input: CreateScheduleBaselineInput,
  idSeed: number
): ProjectWorkspaceData {
  const now = new Date().toISOString();
  const isPrimary = !!input.isPrimary || input.kind === "primary";
  const baselineId = isPrimary
    ? workspace.scheduleBaselines.find((baseline) => baseline.isPrimary)?.id ?? `baseline-${idSeed}`
    : `baseline-${idSeed}`;
  const nextBaseline: ScheduleBaseline = {
    id: baselineId,
    projectId: workspace.project.id,
    revisionId: workspace.currentRevision.id,
    name: input.name ?? (isPrimary ? "Primary Baseline" : `Snapshot ${workspace.scheduleBaselines.length + 1}`),
    description: input.description ?? "",
    kind: input.kind ?? (isPrimary ? "primary" : "snapshot"),
    isPrimary,
    createdAt: now,
    updatedAt: now,
  };

  return syncPrimaryBaselineFields({
    ...workspace,
    scheduleBaselines: [
      ...workspace.scheduleBaselines
        .filter((baseline) => baseline.id !== baselineId)
        .map((baseline) => ({ ...baseline, isPrimary: isPrimary ? false : baseline.isPrimary })),
      nextBaseline,
    ],
    scheduleBaselineTasks: [
      ...workspace.scheduleBaselineTasks.filter((item) => item.baselineId !== baselineId),
      ...workspace.scheduleTasks.map((task, index) => ({
        id: `${baselineId}-item-${index + 1}`,
        baselineId,
        taskId: task.id,
        taskName: task.name,
        phaseId: task.phaseId,
        startDate: task.startDate,
        endDate: task.endDate,
        duration: task.duration,
        createdAt: now,
        updatedAt: now,
      })),
    ],
  });
}

export function ScheduleHarnessClient() {
  const [response, setResponse] = useState<WorkspaceResponse>(() => wrapWorkspace(buildHarnessWorkspace()));
  const responseRef = useRef(response);
  const idCounter = useRef(100);
  responseRef.current = response;

  const api = useMemo(
    () => ({
      async createScheduleTask(projectId: string, input: CreateScheduleTaskInput) {
        const workspace = responseRef.current.workspace;
        const id = `task-${(idCounter.current += 1)}`;
        const now = new Date().toISOString();
        const defaultCalendarId = workspace.scheduleCalendars.find((calendar) => calendar.isDefault)?.id ?? null;
        return wrapWorkspace({
          ...workspace,
          scheduleTasks: [
            ...workspace.scheduleTasks,
            {
              id,
              projectId,
              revisionId: workspace.currentRevision.id,
              phaseId: input.phaseId ?? null,
              calendarId: input.calendarId ?? defaultCalendarId,
              parentTaskId: input.parentTaskId ?? null,
              outlineLevel: input.outlineLevel ?? 0,
              name: input.name ?? "New Task",
              description: input.description ?? "",
              taskType: input.taskType ?? "task",
              status: input.status ?? "not_started",
              startDate: input.startDate ?? null,
              endDate: input.endDate ?? null,
              duration: input.duration ?? 0,
              progress: input.progress ?? 0,
              assignee: input.assignee ?? "",
              order: input.order ?? workspace.scheduleTasks.length + 1,
              constraintType: input.constraintType ?? "asap",
              constraintDate: input.constraintDate ?? null,
              deadlineDate: input.deadlineDate ?? null,
              actualStart: input.actualStart ?? null,
              actualEnd: input.actualEnd ?? null,
              baselineStart: null,
              baselineEnd: null,
              createdAt: now,
              updatedAt: now,
            },
          ],
          scheduleTaskAssignments: [
            ...workspace.scheduleTaskAssignments,
            ...(input.resourceAssignments ?? []).map((assignment, index) => ({
              id: `${id}-assignment-${index + 1}`,
              taskId: id,
              resourceId: assignment.resourceId,
              units: assignment.units ?? 1,
              role: assignment.role ?? "",
              createdAt: now,
              updatedAt: now,
            })),
          ],
        });
      },
      async updateScheduleTask(_projectId: string, taskId: string, patch: ScheduleTaskPatchInput) {
        const workspace = responseRef.current.workspace;
        const now = new Date().toISOString();
        const currentTask = workspace.scheduleTasks.find((task) => task.id === taskId) ?? null;
        const descendantIds = new Set<string>();
        const queue = [taskId];
        while (queue.length > 0) {
          const currentId = queue.shift()!;
          for (const task of workspace.scheduleTasks) {
            if (task.parentTaskId === currentId && !descendantIds.has(task.id)) {
              descendantIds.add(task.id);
              queue.push(task.id);
            }
          }
        }
        const outlineDelta =
          currentTask && patch.outlineLevel !== undefined
            ? patch.outlineLevel - (currentTask.outlineLevel ?? 0)
            : 0;
        return wrapWorkspace({
          ...workspace,
          scheduleTasks: workspace.scheduleTasks.map((task) =>
            task.id === taskId
              ? { ...task, ...patch, updatedAt: now }
              : descendantIds.has(task.id)
                ? {
                    ...task,
                    outlineLevel:
                      patch.outlineLevel !== undefined
                        ? Math.max(0, (task.outlineLevel ?? 0) + outlineDelta)
                        : task.outlineLevel,
                    phaseId: patch.phaseId !== undefined ? patch.phaseId : task.phaseId,
                  }
                : task
          ),
          scheduleTaskAssignments:
            patch.resourceAssignments === undefined
              ? workspace.scheduleTaskAssignments
              : [
                  ...workspace.scheduleTaskAssignments.filter((assignment) => assignment.taskId !== taskId),
                  ...patch.resourceAssignments.map((assignment, index) => ({
                    id: `${taskId}-assignment-${index + 1}`,
                    taskId,
                    resourceId: assignment.resourceId,
                    units: assignment.units ?? 1,
                    role: assignment.role ?? "",
                    createdAt: now,
                    updatedAt: now,
                  })),
                ],
        });
      },
      async batchUpdateScheduleTasks(_projectId: string, updates: Array<{ id: string } & ScheduleTaskPatchInput>) {
        let workspace = responseRef.current.workspace;
        for (const update of updates) {
          const { id, ...patch } = update;
          workspace = (await this.updateScheduleTask(workspace.project.id, id, patch)).workspace;
        }
        return wrapWorkspace(workspace);
      },
      async deleteScheduleTask(_projectId: string, taskId: string) {
        const workspace = responseRef.current.workspace;
        const deletedTask = workspace.scheduleTasks.find((task) => task.id === taskId) ?? null;
        const descendantIds = new Set<string>();
        const queue = [taskId];
        while (queue.length > 0) {
          const currentId = queue.shift()!;
          for (const task of workspace.scheduleTasks) {
            if (task.parentTaskId === currentId && !descendantIds.has(task.id)) {
              descendantIds.add(task.id);
              queue.push(task.id);
            }
          }
        }
        return wrapWorkspace({
          ...workspace,
          scheduleTasks: workspace.scheduleTasks
            .filter((task) => task.id !== taskId)
            .map((task) =>
              !deletedTask || !descendantIds.has(task.id)
                ? task
                : {
                    ...task,
                    parentTaskId: task.parentTaskId === taskId ? deletedTask.parentTaskId ?? null : task.parentTaskId,
                    outlineLevel: Math.max(0, (task.outlineLevel ?? 0) - 1),
                  }
            ),
          scheduleDependencies: workspace.scheduleDependencies.filter(
            (dependency) => dependency.predecessorId !== taskId && dependency.successorId !== taskId
          ),
          scheduleTaskAssignments: workspace.scheduleTaskAssignments.filter((assignment) => assignment.taskId !== taskId),
          scheduleBaselineTasks: workspace.scheduleBaselineTasks.filter((item) => item.taskId !== taskId),
        });
      },
      async createScheduleDependency(_projectId: string, input: CreateDependencyInput) {
        const workspace = responseRef.current.workspace;
        return wrapWorkspace({
          ...workspace,
          scheduleDependencies: [
            ...workspace.scheduleDependencies,
            {
              id: `dep-${(idCounter.current += 1)}`,
              predecessorId: input.predecessorId,
              successorId: input.successorId,
              type: input.type ?? "FS",
              lagDays: input.lagDays ?? 0,
            },
          ],
        });
      },
      async deleteScheduleDependency(_projectId: string, depId: string) {
        const workspace = responseRef.current.workspace;
        return wrapWorkspace({
          ...workspace,
          scheduleDependencies: workspace.scheduleDependencies.filter((dependency) => dependency.id !== depId),
        });
      },
      async saveScheduleBaseline(_projectId: string) {
        return wrapWorkspace(captureBaseline(responseRef.current.workspace, { kind: "primary", isPrimary: true, name: "Primary Baseline" }, (idCounter.current += 1)));
      },
      async clearScheduleBaseline(_projectId: string) {
        const workspace = responseRef.current.workspace;
        const primaryIds = new Set(
          workspace.scheduleBaselines.filter((baseline) => baseline.isPrimary).map((baseline) => baseline.id)
        );
        return wrapWorkspace(
          syncPrimaryBaselineFields({
            ...workspace,
            scheduleBaselines: workspace.scheduleBaselines.filter((baseline) => !baseline.isPrimary),
            scheduleBaselineTasks: workspace.scheduleBaselineTasks.filter((item) => !primaryIds.has(item.baselineId)),
          })
        );
      },
      async createScheduleBaseline(_projectId: string, input: CreateScheduleBaselineInput) {
        return wrapWorkspace(captureBaseline(responseRef.current.workspace, input, (idCounter.current += 1)));
      },
      async deleteScheduleBaseline(_projectId: string, baselineId: string) {
        const workspace = responseRef.current.workspace;
        return wrapWorkspace(
          syncPrimaryBaselineFields({
            ...workspace,
            scheduleBaselines: workspace.scheduleBaselines.filter((baseline) => baseline.id !== baselineId),
            scheduleBaselineTasks: workspace.scheduleBaselineTasks.filter((item) => item.baselineId !== baselineId),
          })
        );
      },
      async createScheduleCalendar(_projectId: string, input: CreateScheduleCalendarInput) {
        const workspace = responseRef.current.workspace;
        const now = new Date().toISOString();
        const id = `calendar-${(idCounter.current += 1)}`;
        return wrapWorkspace({
          ...workspace,
          scheduleCalendars: [
            ...workspace.scheduleCalendars.map((calendar) => ({
              ...calendar,
              isDefault: input.isDefault ? false : calendar.isDefault,
            })),
            {
              id,
              projectId: workspace.project.id,
              revisionId: workspace.currentRevision.id,
              name: input.name ?? `Calendar ${workspace.scheduleCalendars.length + 1}`,
              description: input.description ?? "",
              isDefault: input.isDefault ?? workspace.scheduleCalendars.length === 0,
              workingDays: input.workingDays ?? { "0": false, "1": true, "2": true, "3": true, "4": true, "5": true, "6": false },
              shiftStartMinutes: input.shiftStartMinutes ?? 480,
              shiftEndMinutes: input.shiftEndMinutes ?? 1020,
              createdAt: now,
              updatedAt: now,
            },
          ],
        });
      },
      async updateScheduleCalendar(_projectId: string, calendarId: string, patch: ScheduleCalendarPatchInput) {
        const workspace = responseRef.current.workspace;
        return wrapWorkspace({
          ...workspace,
          scheduleCalendars: workspace.scheduleCalendars.map((calendar) =>
            calendar.id === calendarId
              ? { ...calendar, ...patch, isDefault: patch.isDefault ?? calendar.isDefault }
              : { ...calendar, isDefault: patch.isDefault ? false : calendar.isDefault }
          ),
        });
      },
      async deleteScheduleCalendar(_projectId: string, calendarId: string) {
        const workspace = responseRef.current.workspace;
        const fallbackId = workspace.scheduleCalendars.find((calendar) => calendar.id !== calendarId)?.id ?? null;
        return wrapWorkspace({
          ...workspace,
          scheduleCalendars: workspace.scheduleCalendars.filter((calendar) => calendar.id !== calendarId),
          scheduleTasks: workspace.scheduleTasks.map((task) =>
            task.calendarId === calendarId ? { ...task, calendarId: fallbackId } : task
          ),
          scheduleResources: workspace.scheduleResources.map((resource) =>
            resource.calendarId === calendarId ? { ...resource, calendarId: fallbackId } : resource
          ),
        });
      },
      async createScheduleResource(_projectId: string, input: CreateScheduleResourceInput) {
        const workspace = responseRef.current.workspace;
        const now = new Date().toISOString();
        return wrapWorkspace({
          ...workspace,
          scheduleResources: [
            ...workspace.scheduleResources,
            {
              id: `resource-${(idCounter.current += 1)}`,
              projectId: workspace.project.id,
              revisionId: workspace.currentRevision.id,
              calendarId: input.calendarId ?? workspace.scheduleCalendars.find((calendar) => calendar.isDefault)?.id ?? null,
              name: input.name ?? "New Resource",
              role: input.role ?? "",
              kind: input.kind ?? "labor",
              color: input.color ?? "",
              defaultUnits: input.defaultUnits ?? 1,
              capacityPerDay: input.capacityPerDay ?? 1,
              costRate: input.costRate ?? 0,
              createdAt: now,
              updatedAt: now,
            },
          ],
        });
      },
      async updateScheduleResource(_projectId: string, resourceId: string, patch: ScheduleResourcePatchInput) {
        const workspace = responseRef.current.workspace;
        return wrapWorkspace({
          ...workspace,
          scheduleResources: workspace.scheduleResources.map((resource) =>
            resource.id === resourceId ? { ...resource, ...patch } : resource
          ),
        });
      },
      async deleteScheduleResource(_projectId: string, resourceId: string) {
        const workspace = responseRef.current.workspace;
        return wrapWorkspace({
          ...workspace,
          scheduleResources: workspace.scheduleResources.filter((resource) => resource.id !== resourceId),
          scheduleTaskAssignments: workspace.scheduleTaskAssignments.filter((assignment) => assignment.resourceId !== resourceId),
        });
      },
    }),
    []
  );

  const apply = (nextResponse: WorkspaceResponse) => {
    responseRef.current = nextResponse;
    setResponse(nextResponse);
  };

  return (
    <div className="min-h-screen bg-bg px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.2em] text-fg/35">QA Harness</p>
          <h1 className="mt-2 text-2xl font-semibold text-fg">Schedule Module Browser Harness</h1>
          <p className="mt-2 max-w-3xl text-sm text-fg/50">
            This page keeps the schedule module fully interactive with in-memory mutations so we can run browser
            coverage against zoom, drag/resize, baselines, calendars, resources, and schedule health flows.
          </p>
        </div>
        <ScheduleTab workspace={response.workspace} apply={apply} api={api} />
      </div>
    </div>
  );
}
