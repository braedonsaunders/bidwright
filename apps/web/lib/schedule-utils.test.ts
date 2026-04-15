import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectPhase, ScheduleCalendar, ScheduleDependency, ScheduleResource, ScheduleTask, ScheduleTaskAssignment } from "./api";
import {
  addDays,
  analyzeScheduleNetwork,
  applyDragDelta,
  applyQuickFilter,
  buildIndentTaskUpdates,
  buildOutdentTaskUpdates,
  buildReorderTaskUpdates,
  buildScheduleInsights,
  buildTaskHierarchyInfo,
  buildTimelineHeaderBands,
  computeCriticalPath,
  computeDependencyViolations,
  computePhaseDatesFromTasks,
  formatISODate,
  generateColumns,
  getSummaryTaskIds,
  getTaskAncestorIds,
  getTaskDescendantIds,
  getVisibleTasks,
  getTaskVariance,
  getTimelineBounds,
  parseDate,
  resolveDependencyAnchorDates,
  rollupScheduleTasks,
  wouldCreateDependencyCycle,
} from "./schedule-utils";

function makeTask(overrides: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id: overrides.id ?? "task-1",
    projectId: overrides.projectId ?? "project-1",
    revisionId: overrides.revisionId ?? "revision-1",
    phaseId: Object.prototype.hasOwnProperty.call(overrides, "phaseId") ? (overrides.phaseId ?? null) : null,
    calendarId: Object.prototype.hasOwnProperty.call(overrides, "calendarId") ? (overrides.calendarId ?? null) : null,
    parentTaskId: Object.prototype.hasOwnProperty.call(overrides, "parentTaskId") ? (overrides.parentTaskId ?? null) : null,
    outlineLevel: overrides.outlineLevel ?? 0,
    name: overrides.name ?? "Task",
    description: overrides.description ?? "",
    taskType: overrides.taskType ?? "task",
    status: overrides.status ?? "not_started",
    startDate: Object.prototype.hasOwnProperty.call(overrides, "startDate") ? (overrides.startDate ?? null) : "2026-04-01",
    endDate: Object.prototype.hasOwnProperty.call(overrides, "endDate") ? (overrides.endDate ?? null) : "2026-04-05",
    duration: overrides.duration ?? 4,
    progress: overrides.progress ?? 0,
    assignee: overrides.assignee ?? "",
    order: overrides.order ?? 1,
    constraintType: overrides.constraintType ?? "asap",
    constraintDate: Object.prototype.hasOwnProperty.call(overrides, "constraintDate") ? (overrides.constraintDate ?? null) : null,
    deadlineDate: Object.prototype.hasOwnProperty.call(overrides, "deadlineDate") ? (overrides.deadlineDate ?? null) : null,
    actualStart: Object.prototype.hasOwnProperty.call(overrides, "actualStart") ? (overrides.actualStart ?? null) : null,
    actualEnd: Object.prototype.hasOwnProperty.call(overrides, "actualEnd") ? (overrides.actualEnd ?? null) : null,
    baselineStart: Object.prototype.hasOwnProperty.call(overrides, "baselineStart") ? (overrides.baselineStart ?? null) : null,
    baselineEnd: Object.prototype.hasOwnProperty.call(overrides, "baselineEnd") ? (overrides.baselineEnd ?? null) : null,
    createdAt: overrides.createdAt ?? "2026-04-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-01T00:00:00.000Z",
  };
}

test("generateColumns builds grouped day headers across month boundaries and marks weekends", () => {
  const columns = generateColumns(parseDate("2026-04-29")!, parseDate("2026-05-04")!, "day");
  const bands = buildTimelineHeaderBands(columns);

  assert.equal(columns.length, 5);
  assert.deepEqual(
    columns.map((column) => ({ label: column.label, group: column.groupLabel, isNonWorking: column.isNonWorking })),
    [
      { label: "29", group: "Apr 2026", isNonWorking: false },
      { label: "30", group: "Apr 2026", isNonWorking: false },
      { label: "1", group: "May 2026", isNonWorking: false },
      { label: "2", group: "May 2026", isNonWorking: true },
      { label: "3", group: "May 2026", isNonWorking: true },
    ]
  );
  assert.deepEqual(
    bands.map((band) => ({ label: band.label, span: band.span })),
    [
      { label: "Apr 2026", span: 2 },
      { label: "May 2026", span: 3 },
    ]
  );
});

test("generateColumns builds year groupings for month zoom", () => {
  const columns = generateColumns(parseDate("2026-11-01")!, parseDate("2027-03-01")!, "month");
  const bands = buildTimelineHeaderBands(columns);

  assert.deepEqual(
    bands.map((band) => ({ label: band.label, span: band.span })),
    [
      { label: "2026", span: 2 },
      { label: "2027", span: 2 },
    ]
  );
});

test("getTimelineBounds uses the full width of the last visible column", () => {
  const weekColumns = generateColumns(parseDate("2026-04-01")!, parseDate("2026-04-25")!, "week");
  const weekBounds = getTimelineBounds(weekColumns, "week");
  assert.equal(
    formatISODate(new Date(weekBounds.endMs)),
    formatISODate(addDays(weekColumns[weekColumns.length - 1].date, 7))
  );

  const monthColumns = generateColumns(parseDate("2026-11-01")!, parseDate("2027-03-01")!, "month");
  const monthBounds = getTimelineBounds(monthColumns, "month");
  assert.equal(formatISODate(new Date(monthBounds.endMs)), "2027-03-01");
});

test("applyDragDelta moves tasks and clamps resize operations", () => {
  const start = parseDate("2026-04-10")!;
  const end = parseDate("2026-04-15")!;

  const moved = applyDragDelta(start, end, 3 * 86_400_000, "move");
  assert.equal(formatISODate(moved.startDate), "2026-04-13");
  assert.equal(formatISODate(moved.endDate), "2026-04-18");

  const resizedStart = applyDragDelta(start, end, 10 * 86_400_000, "start");
  assert.equal(formatISODate(resizedStart.startDate), "2026-04-14");
  assert.equal(formatISODate(resizedStart.endDate), "2026-04-15");

  const resizedEnd = applyDragDelta(start, end, -10 * 86_400_000, "end");
  assert.equal(formatISODate(resizedEnd.startDate), "2026-04-10");
  assert.equal(formatISODate(resizedEnd.endDate), "2026-04-11");
});

test("resolveDependencyAnchorDates supports all dependency types", () => {
  const predecessor = makeTask({
    id: "pred",
    startDate: "2026-04-01",
    endDate: "2026-04-05",
  });
  const successor = makeTask({
    id: "succ",
    startDate: "2026-04-10",
    endDate: "2026-04-14",
  });

  const expectationByType: Record<ScheduleDependency["type"], [string, string]> = {
    FS: ["2026-04-05", "2026-04-10"],
    SS: ["2026-04-01", "2026-04-10"],
    FF: ["2026-04-05", "2026-04-14"],
    SF: ["2026-04-01", "2026-04-14"],
  };

  for (const [type, [from, to]] of Object.entries(expectationByType) as Array<
    [ScheduleDependency["type"], [string, string]]
  >) {
    const anchors = resolveDependencyAnchorDates(
      { id: `dep-${type}`, predecessorId: predecessor.id, successorId: successor.id, type, lagDays: 0 },
      predecessor,
      successor
    );
    assert.ok(anchors);
    assert.equal(formatISODate(anchors!.from), from);
    assert.equal(formatISODate(anchors!.to), to);
  }
});

test("computeDependencyViolations flags lag shortfalls", () => {
  const tasks = [
    makeTask({ id: "pred", startDate: "2026-04-01", endDate: "2026-04-05" }),
    makeTask({ id: "succ", startDate: "2026-04-06", endDate: "2026-04-10" }),
  ];
  const dependencies: ScheduleDependency[] = [
    { id: "dep-1", predecessorId: "pred", successorId: "succ", type: "FS", lagDays: 2 },
  ];

  const violations = computeDependencyViolations(tasks, dependencies);
  assert.equal(violations.length, 1);
  assert.deepEqual(violations[0], {
    dependencyId: "dep-1",
    predecessorId: "pred",
    successorId: "succ",
    type: "FS",
    lagDays: 2,
    shortfallDays: 1,
  });
});

test("analyzeScheduleNetwork computes float using dependency types and lag", () => {
  const tasks = [
    makeTask({ id: "task-a", startDate: "2026-04-01", endDate: "2026-04-05" }),
    makeTask({ id: "task-b", startDate: "2026-04-08", endDate: "2026-04-12" }),
    makeTask({ id: "task-c", startDate: "2026-04-03", endDate: "2026-04-07" }),
  ];
  const dependencies: ScheduleDependency[] = [
    { id: "dep-1", predecessorId: "task-a", successorId: "task-b", type: "FS", lagDays: 2 },
    { id: "dep-2", predecessorId: "task-a", successorId: "task-c", type: "SS", lagDays: 1 },
  ];

  const network = analyzeScheduleNetwork(tasks, dependencies);

  assert.equal(network.hasCycle, false);
  assert.deepEqual(Array.from(network.criticalTaskIds).sort(), ["task-a", "task-b"]);
  assert.equal(network.totalFloatByTask.get("task-a"), 0);
  assert.equal(network.totalFloatByTask.get("task-b"), 0);
  assert.equal(network.totalFloatByTask.get("task-c"), 5);
});

test("getTaskVariance reports baseline drift correctly", () => {
  const variance = getTaskVariance(
    makeTask({
      startDate: "2026-04-05",
      endDate: "2026-04-12",
      baselineStart: "2026-04-03",
      baselineEnd: "2026-04-10",
    })
  );

  assert.deepEqual(variance, {
    startDays: 2,
    finishDays: 2,
    hasVariance: true,
    isBehind: true,
    isAhead: false,
  });
});

test("buildScheduleInsights aggregates lookahead, variance, and quality issues", () => {
  const tasks = [
    makeTask({
      id: "task-a",
      name: "Overdue",
      startDate: "2026-04-01",
      endDate: "2026-04-05",
      assignee: "Alex",
    }),
    makeTask({
      id: "task-b",
      name: "Lookahead",
      startDate: "2026-04-15",
      endDate: "2026-04-18",
      baselineStart: "2026-04-13",
      baselineEnd: "2026-04-16",
      assignee: "Blair",
    }),
    makeTask({
      id: "task-c",
      name: "Missing Dates",
      startDate: null,
      endDate: null,
      assignee: "",
    }),
  ];
  const dependencies: ScheduleDependency[] = [
    { id: "dep-1", predecessorId: "task-a", successorId: "task-b", type: "FS", lagDays: 0 },
  ];

  const insights = buildScheduleInsights(tasks, dependencies, parseDate("2026-04-10")!);

  assert.deepEqual(Array.from(insights.overdueTaskIds), ["task-a"]);
  assert.deepEqual(Array.from(insights.lookahead14TaskIds), ["task-b"]);
  assert.deepEqual(Array.from(insights.behindBaselineTaskIds), ["task-b"]);
  assert.deepEqual(Array.from(insights.missingDateTaskIds), ["task-c"]);
  assert.deepEqual(Array.from(insights.isolatedTaskIds), ["task-c"]);
  assert.equal(insights.unassignedTaskIds.has("task-c"), true);
  assert.equal(insights.openEndedTaskIds.has("task-b"), true);
  assert.deepEqual(Array.from(insights.attentionTaskIds).sort(), ["task-a", "task-b", "task-c"]);
});

test("buildScheduleInsights flags deadline, constraint, actual, and resource loading issues", () => {
  const calendar: ScheduleCalendar = {
    id: "cal-1",
    projectId: "project-1",
    revisionId: "revision-1",
    name: "Standard",
    description: "",
    isDefault: true,
    workingDays: { "0": false, "1": true, "2": true, "3": true, "4": true, "5": true, "6": false },
    shiftStartMinutes: 480,
    shiftEndMinutes: 1020,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };
  const resources: ScheduleResource[] = [
    {
      id: "res-1",
      projectId: "project-1",
      revisionId: "revision-1",
      calendarId: "cal-1",
      name: "Crew A",
      role: "Crew",
      kind: "crew",
      color: "",
      defaultUnits: 1,
      capacityPerDay: 1,
      costRate: 0,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
  ];
  const assignments: ScheduleTaskAssignment[] = [
    {
      id: "asg-1",
      taskId: "task-a",
      resourceId: "res-1",
      units: 1,
      role: "Lead",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
    {
      id: "asg-2",
      taskId: "task-b",
      resourceId: "res-1",
      units: 1,
      role: "Lead",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
  ];
  const tasks = [
    makeTask({
      id: "task-a",
      calendarId: "cal-1",
      startDate: "2026-04-07",
      endDate: "2026-04-10",
      deadlineDate: "2026-04-09",
    }),
    makeTask({
      id: "task-b",
      calendarId: "cal-1",
      startDate: "2026-04-07",
      endDate: "2026-04-10",
      constraintType: "mso",
      constraintDate: "2026-04-08",
      status: "complete",
      actualStart: "2026-04-07",
      actualEnd: null,
    }),
  ];

  const insights = buildScheduleInsights(tasks, [], parseDate("2026-04-08")!, {
    calendars: [calendar],
    resources,
    taskAssignments: assignments,
  });

  assert.equal(insights.deadlineMissTaskIds.has("task-a"), true);
  assert.equal(insights.constraintViolationTaskIds.has("task-b"), true);
  assert.equal(insights.actualDateGapTaskIds.has("task-b"), true);
  assert.equal(insights.resourceConflictTaskIds.has("task-a"), true);
  assert.equal(insights.resourceConflictTaskIds.has("task-b"), true);
  assert.equal(insights.overallocatedResourceIds.has("res-1"), true);
});

test("applyQuickFilter narrows tasks using schedule insights", () => {
  const tasks = [
    makeTask({ id: "task-a", endDate: "2026-04-05" }),
    makeTask({ id: "task-b", startDate: "2026-04-15", endDate: "2026-04-18", baselineEnd: "2026-04-16" }),
    makeTask({ id: "task-c", startDate: null, endDate: null }),
  ];
  const insights = buildScheduleInsights(tasks, [], parseDate("2026-04-10")!);

  assert.deepEqual(
    applyQuickFilter(tasks, "lookahead_14", insights).map((task) => task.id),
    ["task-b"]
  );
  assert.deepEqual(
    applyQuickFilter(tasks, "issues", insights).map((task) => task.id).sort(),
    ["task-a", "task-b", "task-c"]
  );
});

test("computePhaseDatesFromTasks returns the earliest start and latest finish per phase", () => {
  const phases: ProjectPhase[] = [
    {
      id: "phase-1",
      revisionId: "revision-1",
      number: "1",
      name: "Preconstruction",
      description: "",
      order: 1,
      startDate: null,
      endDate: null,
      color: "",
    },
  ];

  const phaseDates = computePhaseDatesFromTasks(
    [
      makeTask({ id: "task-a", phaseId: "phase-1", startDate: "2026-04-03", endDate: "2026-04-04" }),
      makeTask({ id: "task-b", phaseId: "phase-1", startDate: "2026-04-01", endDate: "2026-04-08" }),
    ],
    phases
  );

  const phaseRange = phaseDates.get("phase-1");
  assert.ok(phaseRange);
  assert.equal(formatISODate(phaseRange!.startDate), "2026-04-01");
  assert.equal(formatISODate(phaseRange!.endDate), "2026-04-08");
});

test("task hierarchy helpers return depth and descendant order", () => {
  const tasks = [
    makeTask({ id: "task-a", order: 1 }),
    makeTask({ id: "task-b", order: 2, parentTaskId: "task-a", outlineLevel: 1 }),
    makeTask({ id: "task-c", order: 3, parentTaskId: "task-b", outlineLevel: 2 }),
    makeTask({ id: "task-d", order: 4 }),
  ];

  const hierarchy = buildTaskHierarchyInfo(tasks);

  assert.equal(hierarchy.get("task-a")?.childCount, 1);
  assert.equal(hierarchy.get("task-b")?.depth, 1);
  assert.equal(hierarchy.get("task-c")?.depth, 2);
  assert.deepEqual(getTaskDescendantIds(tasks, "task-a"), ["task-b", "task-c"]);
});

test("buildIndentTaskUpdates nests a task under the row above without touching descendants", () => {
  const tasks = [
    makeTask({ id: "task-a", order: 1 }),
    makeTask({ id: "task-b", order: 2 }),
    makeTask({ id: "task-c", order: 3, parentTaskId: "task-b", outlineLevel: 1 }),
  ];

  assert.deepEqual(buildIndentTaskUpdates(tasks, "task-b"), [
    { id: "task-b", parentTaskId: "task-a", outlineLevel: 1 },
  ]);
});

test("buildOutdentTaskUpdates lifts a task one level up", () => {
  const tasks = [
    makeTask({ id: "task-a", order: 1 }),
    makeTask({ id: "task-b", order: 2, parentTaskId: "task-a", outlineLevel: 1 }),
    makeTask({ id: "task-c", order: 3, parentTaskId: "task-b", outlineLevel: 2 }),
  ];

  assert.deepEqual(buildOutdentTaskUpdates(tasks, "task-c"), [
    { id: "task-c", parentTaskId: "task-a", outlineLevel: 1 },
  ]);
});

test("buildReorderTaskUpdates moves a subtree and only changes the root hierarchy fields", () => {
  const tasks = [
    makeTask({ id: "task-a", order: 1 }),
    makeTask({ id: "task-a1", order: 2, parentTaskId: "task-a", outlineLevel: 1 }),
    makeTask({ id: "task-b", order: 3 }),
    makeTask({ id: "task-c", order: 4 }),
  ];

  assert.deepEqual(buildReorderTaskUpdates(tasks, "task-a", "task-c", "inside"), [
    { id: "task-b", order: 1 },
    { id: "task-c", order: 2 },
    { id: "task-a", order: 3, parentTaskId: "task-c", outlineLevel: 1 },
    { id: "task-a1", order: 4 },
  ]);
});

test("buildReorderTaskUpdates can drag a child task back out toward root by lowering depth", () => {
  const tasks = [
    makeTask({ id: "root-a", order: 1 }),
    makeTask({ id: "child-a1", order: 2, parentTaskId: "root-a", outlineLevel: 1 }),
    makeTask({ id: "child-a2", order: 3, parentTaskId: "root-a", outlineLevel: 1 }),
    makeTask({ id: "root-b", order: 4 }),
  ];

  assert.deepEqual(buildReorderTaskUpdates(tasks, "child-a2", "root-b", "before", 0), [
    { id: "child-a2", parentTaskId: null, outlineLevel: 0 },
  ]);
});

test("buildReorderTaskUpdates can drag a root task under another parent using depth hint", () => {
  const tasks = [
    makeTask({ id: "root-a", order: 1 }),
    makeTask({ id: "root-b", order: 2 }),
    makeTask({ id: "root-c", order: 3 }),
  ];

  assert.deepEqual(buildReorderTaskUpdates(tasks, "root-c", "root-b", "after", 1), [
    { id: "root-c", parentTaskId: "root-b", outlineLevel: 1 },
  ]);
});

test("summary rollups inherit earliest start and latest finish from child tasks", () => {
  const tasks = rollupScheduleTasks([
    makeTask({ id: "summary", taskType: "task", order: 1, startDate: "2026-04-01", endDate: "2026-04-02" }),
    makeTask({ id: "child-a", order: 2, parentTaskId: "summary", outlineLevel: 1, startDate: "2026-04-03", endDate: "2026-04-05", progress: 0.5 }),
    makeTask({ id: "child-b", order: 3, parentTaskId: "summary", outlineLevel: 1, startDate: "2026-04-07", endDate: "2026-04-10", progress: 1, status: "complete" }),
  ]);

  const summary = tasks.find((task) => task.id === "summary");
  assert.ok(summary);
  assert.equal(summary!.taskType, "summary");
  assert.equal(summary!.startDate, "2026-04-03");
  assert.equal(summary!.endDate, "2026-04-10");
  assert.equal(summary!.duration, 7);
  assert.equal(summary!.status, "in_progress");
});

test("summary helpers preserve ancestors and visible tree rows", () => {
  const tasks = [
    makeTask({ id: "summary", taskType: "summary", order: 1 }),
    makeTask({ id: "child-a", order: 2, parentTaskId: "summary", outlineLevel: 1 }),
    makeTask({ id: "child-b", order: 3, parentTaskId: "summary", outlineLevel: 1 }),
    makeTask({ id: "leaf", order: 4 }),
  ];

  assert.deepEqual(Array.from(getSummaryTaskIds(tasks)).sort(), ["summary"]);
  assert.deepEqual(getTaskAncestorIds(tasks, "child-a"), ["summary"]);
  assert.deepEqual(
    getVisibleTasks(tasks, new Set(["summary"])).map((task) => task.id),
    ["summary", "leaf"]
  );
});

test("wouldCreateDependencyCycle blocks cycles before they reach the graph", () => {
  const dependencies: ScheduleDependency[] = [
    { id: "dep-1", predecessorId: "task-a", successorId: "task-b", type: "FS", lagDays: 0 },
    { id: "dep-2", predecessorId: "task-b", successorId: "task-c", type: "FS", lagDays: 0 },
  ];

  assert.equal(wouldCreateDependencyCycle(dependencies, "task-c", "task-a"), true);
  assert.equal(wouldCreateDependencyCycle(dependencies, "task-a", "task-c"), false);
});

test("computeCriticalPath returns an empty set when dependencies contain a cycle", () => {
  const tasks = [
    makeTask({ id: "task-a" }),
    makeTask({ id: "task-b", startDate: "2026-04-06", endDate: "2026-04-08" }),
  ];
  const dependencies: ScheduleDependency[] = [
    { id: "dep-1", predecessorId: "task-a", successorId: "task-b", type: "FS", lagDays: 0 },
    { id: "dep-2", predecessorId: "task-b", successorId: "task-a", type: "FS", lagDays: 0 },
  ];

  assert.deepEqual(Array.from(computeCriticalPath(tasks, dependencies)), []);
});

test("quick filters keep summary ancestors visible when a child is flagged", () => {
  const tasks = rollupScheduleTasks([
    makeTask({ id: "summary", order: 1 }),
    makeTask({ id: "child-a", order: 2, parentTaskId: "summary", outlineLevel: 1, endDate: "2026-04-05" }),
    makeTask({ id: "child-b", order: 3, parentTaskId: "summary", outlineLevel: 1, startDate: "2026-04-15", endDate: "2026-04-18" }),
  ]);
  const insights = buildScheduleInsights(tasks, [], parseDate("2026-04-10")!);

  assert.deepEqual(
    applyQuickFilter(tasks, "overdue", insights).map((task) => task.id).sort(),
    ["child-a", "summary"]
  );
});
