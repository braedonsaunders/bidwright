import type {
  ProjectPhase,
  ScheduleCalendar,
  ScheduleDependency,
  ScheduleResource,
  ScheduleTask,
  ScheduleTaskPatchInput,
  ScheduleTaskAssignment,
  ScheduleTaskStatus,
} from "./api";

export const MS_PER_DAY = 86_400_000;

export const PHASE_COLORS = [
  { bg: "bg-blue-500", text: "text-blue-500", hex: "#3b82f6" },
  { bg: "bg-emerald-500", text: "text-emerald-500", hex: "#10b981" },
  { bg: "bg-amber-500", text: "text-amber-500", hex: "#f59e0b" },
  { bg: "bg-violet-500", text: "text-violet-500", hex: "#8b5cf6" },
  { bg: "bg-rose-500", text: "text-rose-500", hex: "#f43f5e" },
  { bg: "bg-cyan-500", text: "text-cyan-500", hex: "#06b6d4" },
  { bg: "bg-orange-500", text: "text-orange-500", hex: "#f97316" },
  { bg: "bg-pink-500", text: "text-pink-500", hex: "#ec4899" },
];

export const STATUS_LABELS: Record<ScheduleTaskStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  complete: "Complete",
  on_hold: "On Hold",
};

export const STATUS_COLORS: Record<ScheduleTaskStatus, string> = {
  not_started: "default",
  in_progress: "info",
  complete: "success",
  on_hold: "warning",
};

export type ZoomLevel = "day" | "week" | "month";
export type ScheduleQuickFilter =
  | "all"
  | "lookahead_14"
  | "lookahead_28"
  | "critical"
  | "overdue"
  | "variance"
  | "issues";

export interface ScheduleFilters {
  phaseIds: string[];
  statuses: ScheduleTaskStatus[];
  assignees: string[];
  dateFrom: string | null;
  dateTo: string | null;
}

export const emptyFilters: ScheduleFilters = {
  phaseIds: [],
  statuses: [],
  assignees: [],
  dateFrom: null,
  dateTo: null,
};

export interface TimelineColumn {
  date: Date;
  label: string;
  subLabel?: string;
  groupKey: string;
  groupLabel: string;
  isToday: boolean;
  isNonWorking: boolean;
}

export interface TimelineHeaderBand {
  key: string;
  label: string;
  span: number;
}

export interface TaskGroup {
  phase: ProjectPhase | null;
  tasks: ScheduleTask[];
  phaseDates: { startDate: Date; endDate: Date } | null;
}

export interface TaskHierarchyInfo {
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
  childCount: number;
}

export type TaskTreePlacement = "before" | "after" | "inside";
export type TaskTreeUpdate = { id: string } & Pick<ScheduleTaskPatchInput, "order" | "outlineLevel" | "parentTaskId">;
export interface TaskTreeDropPosition {
  placement: TaskTreePlacement;
  depth: number;
}

export interface DependencyEdge {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  lagDays: number;
}

export interface ScheduleTaskVariance {
  startDays: number | null;
  finishDays: number | null;
  hasVariance: boolean;
  isBehind: boolean;
  isAhead: boolean;
}

export interface ScheduleDependencyViolation {
  dependencyId: string;
  predecessorId: string;
  successorId: string;
  type: ScheduleDependency["type"];
  lagDays: number;
  shortfallDays: number;
}

export interface ScheduleNetworkSummary {
  totalFloatByTask: Map<string, number>;
  criticalTaskIds: Set<string>;
  hasCycle: boolean;
}

export interface ScheduleInsights {
  totalTasks: number;
  milestoneTasks: number;
  completeTasks: number;
  inProgressTasks: number;
  criticalTaskIds: Set<string>;
  totalFloatByTask: Map<string, number>;
  overdueTaskIds: Set<string>;
  lookahead14TaskIds: Set<string>;
  lookahead28TaskIds: Set<string>;
  varianceTaskIds: Set<string>;
  behindBaselineTaskIds: Set<string>;
  missingDateTaskIds: Set<string>;
  unassignedTaskIds: Set<string>;
  isolatedTaskIds: Set<string>;
  openEndedTaskIds: Set<string>;
  deadlineMissTaskIds: Set<string>;
  constraintViolationTaskIds: Set<string>;
  actualDateGapTaskIds: Set<string>;
  resourceConflictTaskIds: Set<string>;
  overallocatedResourceIds: Set<string>;
  resourceOverloadByResource: Map<string, number>;
  attentionTaskIds: Set<string>;
  dependencyViolations: ScheduleDependencyViolation[];
  violatingDependencyIds: Set<string>;
  violatingTaskIds: Set<string>;
  hasCycle: boolean;
}

export interface ScheduleInsightOptions {
  calendars?: ScheduleCalendar[];
  resources?: ScheduleResource[];
  taskAssignments?: ScheduleTaskAssignment[];
}

interface ScheduleNetworkNode {
  duration: number;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  float: number;
}

function createCalendarDate(year: number, monthIndex: number, day: number) {
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

function normalizeCalendarDate(date: Date) {
  return createCalendarDate(date.getFullYear(), date.getMonth(), date.getDate());
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function yearKey(date: Date) {
  return `${date.getFullYear()}`;
}

const DEFAULT_WORKING_DAYS: Record<string, boolean> = {
  "0": false,
  "1": true,
  "2": true,
  "3": true,
  "4": true,
  "5": true,
  "6": false,
};

function getCalendarWorkingDays(calendar?: ScheduleCalendar | null) {
  return calendar?.workingDays && Object.keys(calendar.workingDays).length > 0
    ? calendar.workingDays
    : DEFAULT_WORKING_DAYS;
}

export function isNonWorkingDay(date: Date, calendar?: ScheduleCalendar | null) {
  const day = String(normalizeCalendarDate(date).getDay());
  return getCalendarWorkingDays(calendar)[day] === false;
}

function isWorkingDay(date: Date, calendar?: ScheduleCalendar | null) {
  return !isNonWorkingDay(date, calendar);
}

function getTaskWorkingDates(task: ScheduleTask, calendar?: ScheduleCalendar | null) {
  const startDate = parseDate(task.actualStart ?? task.startDate);
  const endDate = parseDate(task.actualEnd ?? task.endDate);
  if (!startDate && !endDate) return [];

  const resolvedStart = startDate ?? endDate!;
  const resolvedEnd = endDate ?? startDate!;
  const activeDates: Date[] = [];

  if (resolvedEnd.getTime() <= resolvedStart.getTime()) {
    if (isWorkingDay(resolvedStart, calendar)) {
      activeDates.push(resolvedStart);
    }
    return activeDates;
  }

  for (
    let current = normalizeCalendarDate(resolvedStart);
    current.getTime() < resolvedEnd.getTime();
    current = addDays(current, 1)
  ) {
    if (isWorkingDay(current, calendar)) {
      activeDates.push(current);
    }
  }

  if (activeDates.length === 0 && isWorkingDay(resolvedStart, calendar)) {
    activeDates.push(resolvedStart);
  }

  return activeDates;
}

function getTaskDuration(task: ScheduleTask) {
  const startDate = parseDate(task.actualStart ?? task.startDate);
  const endDate = parseDate(task.actualEnd ?? task.endDate);
  if (startDate && endDate) {
    return Math.max(0, diffDays(endDate, startDate));
  }
  return Math.max(0, task.duration ?? 0);
}

function getDependencyWeight(
  dependency: ScheduleDependency,
  predecessor: ScheduleTask,
  successor: ScheduleTask
) {
  const predecessorDuration = getTaskDuration(predecessor);
  const successorDuration = getTaskDuration(successor);

  switch (dependency.type) {
    case "SS":
      return dependency.lagDays;
    case "FF":
      return predecessorDuration - successorDuration + dependency.lagDays;
    case "SF":
      return -successorDuration + dependency.lagDays;
    case "FS":
    default:
      return predecessorDuration + dependency.lagDays;
  }
}

export function todayDate() {
  return normalizeCalendarDate(new Date());
}

export function addDays(date: Date, days: number) {
  const next = normalizeCalendarDate(date);
  next.setDate(next.getDate() + days);
  next.setHours(12, 0, 0, 0);
  return next;
}

export function diffDays(a: Date, b: Date) {
  const aMidnight = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bMidnight = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((aMidnight - bMidnight) / MS_PER_DAY);
}

export function formatShortDate(date: Date) {
  return normalizeCalendarDate(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatMonthYear(date: Date) {
  return normalizeCalendarDate(date).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function formatMonthShort(date: Date) {
  return normalizeCalendarDate(date).toLocaleDateString("en-US", { month: "short" });
}

export function formatWeekdayShort(date: Date) {
  return normalizeCalendarDate(date).toLocaleDateString("en-US", { weekday: "short" });
}

export function formatISODate(date: Date) {
  const normalized = normalizeCalendarDate(date);
  return `${normalized.getFullYear()}-${padDatePart(normalized.getMonth() + 1)}-${padDatePart(normalized.getDate())}`;
}

export function startOfWeek(date: Date) {
  const normalized = normalizeCalendarDate(date);
  return addDays(normalized, -normalized.getDay());
}

export function startOfMonth(date: Date) {
  return createCalendarDate(date.getFullYear(), date.getMonth(), 1);
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (match) {
    const [, year, month, day] = match;
    return createCalendarDate(Number.parseInt(year, 10), Number.parseInt(month, 10) - 1, Number.parseInt(day, 10));
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return normalizeCalendarDate(parsed);
}

export function snapToDay(ms: number) {
  return normalizeCalendarDate(new Date(ms));
}

export function getBarPosition(
  startDate: Date,
  endDate: Date,
  timelineStartMs: number,
  timelineEndMs: number
): { left: number; width: number } {
  const span = timelineEndMs - timelineStartMs || 1;
  const barStart = Math.max(0, (startDate.getTime() - timelineStartMs) / span);
  const barEnd = Math.min(1, (endDate.getTime() - timelineStartMs) / span);
  const barWidth = Math.max(0.02, barEnd - barStart);
  return { left: barStart, width: barWidth };
}

export function computePhaseDatesFromTasks(
  tasks: ScheduleTask[],
  phases: ProjectPhase[]
): Map<string, { startDate: Date; endDate: Date }> {
  const result = new Map<string, { startDate: Date; endDate: Date }>();

  for (const phase of phases) {
    const phaseTasks = tasks.filter((task) => task.phaseId === phase.id);
    if (phaseTasks.length === 0) {
      const startDate = parseDate(phase.startDate);
      const endDate = parseDate(phase.endDate);
      if (startDate && endDate) {
        result.set(phase.id, { startDate, endDate });
      }
      continue;
    }

    let earliest = Infinity;
    let latest = -Infinity;

    for (const task of phaseTasks) {
      const startDate = parseDate(task.startDate);
      const endDate = parseDate(task.endDate);
      if (startDate) earliest = Math.min(earliest, startDate.getTime());
      if (endDate) latest = Math.max(latest, endDate.getTime());
    }

    if (earliest !== Infinity && latest !== -Infinity) {
      result.set(phase.id, {
        startDate: new Date(earliest),
        endDate: new Date(latest),
      });
    }
  }

  return result;
}

export function getTaskVariance(task: ScheduleTask): ScheduleTaskVariance {
  const startDate = parseDate(task.actualStart ?? task.startDate);
  const endDate = parseDate(task.actualEnd ?? task.endDate);
  const baselineStart = parseDate(task.baselineStart);
  const baselineEnd = parseDate(task.baselineEnd);
  const startDays = startDate && baselineStart ? diffDays(startDate, baselineStart) : null;
  const finishDays = endDate && baselineEnd ? diffDays(endDate, baselineEnd) : null;
  const hasVariance = startDays !== null || finishDays !== null;
  const largestVariance = Math.max(startDays ?? 0, finishDays ?? 0);
  const smallestVariance = Math.min(startDays ?? 0, finishDays ?? 0);

  return {
    startDays,
    finishDays,
    hasVariance,
    isBehind: largestVariance > 0,
    isAhead: smallestVariance < 0,
  };
}

export function isTaskOverdue(task: ScheduleTask, referenceDate = todayDate()) {
  if (task.status === "complete") return false;
  const endDate = parseDate(task.endDate);
  if (!endDate) return false;
  return endDate.getTime() < referenceDate.getTime();
}

export function isTaskInLookahead(
  task: ScheduleTask,
  lookaheadDays: number,
  referenceDate = todayDate()
) {
  if (task.status === "complete") return false;

  const rawStart = parseDate(task.startDate);
  const rawEnd = parseDate(task.endDate);
  const startDate = rawStart ?? rawEnd;
  const endDate = rawEnd ?? rawStart;
  if (!startDate || !endDate) return false;

  const windowEnd = addDays(referenceDate, lookaheadDays);
  return endDate.getTime() >= referenceDate.getTime() && startDate.getTime() <= windowEnd.getTime();
}

export function buildDependencyEdges(dependencies: ScheduleDependency[]): DependencyEdge[] {
  return dependencies.map((dependency) => ({
    id: dependency.id,
    fromId: dependency.predecessorId,
    toId: dependency.successorId,
    type: dependency.type,
    lagDays: dependency.lagDays,
  }));
}

export function resolveDependencyAnchorDates(
  dependency: ScheduleDependency,
  predecessor: ScheduleTask,
  successor: ScheduleTask
): { from: Date; to: Date } | null {
  const predecessorStart = parseDate(predecessor.startDate);
  const predecessorEnd = parseDate(predecessor.endDate);
  const successorStart = parseDate(successor.startDate);
  const successorEnd = parseDate(successor.endDate);

  switch (dependency.type) {
    case "SS":
      return predecessorStart && successorStart ? { from: predecessorStart, to: successorStart } : null;
    case "FF":
      return predecessorEnd && successorEnd ? { from: predecessorEnd, to: successorEnd } : null;
    case "SF":
      return predecessorStart && successorEnd ? { from: predecessorStart, to: successorEnd } : null;
    case "FS":
    default:
      return predecessorEnd && successorStart ? { from: predecessorEnd, to: successorStart } : null;
  }
}

export function getDependencyGapDays(
  dependency: ScheduleDependency,
  predecessor: ScheduleTask,
  successor: ScheduleTask
) {
  const predecessorStart = parseDate(predecessor.startDate);
  const predecessorEnd = parseDate(predecessor.endDate);
  const successorStart = parseDate(successor.startDate);
  const successorEnd = parseDate(successor.endDate);

  switch (dependency.type) {
    case "SS":
      return predecessorStart && successorStart
        ? diffDays(successorStart, predecessorStart) - dependency.lagDays
        : null;
    case "FF":
      return predecessorEnd && successorEnd
        ? diffDays(successorEnd, predecessorEnd) - dependency.lagDays
        : null;
    case "SF":
      return predecessorStart && successorEnd
        ? diffDays(successorEnd, predecessorStart) - dependency.lagDays
        : null;
    case "FS":
    default:
      return predecessorEnd && successorStart
        ? diffDays(successorStart, predecessorEnd) - dependency.lagDays
        : null;
  }
}

export function computeDependencyViolations(
  tasks: ScheduleTask[],
  dependencies: ScheduleDependency[]
): ScheduleDependencyViolation[] {
  const summaryTaskIds = getSummaryTaskIds(tasks);
  const taskMap = new Map(tasks.filter((task) => !summaryTaskIds.has(task.id)).map((task) => [task.id, task]));
  const violations: ScheduleDependencyViolation[] = [];

  for (const dependency of dependencies) {
    const predecessor = taskMap.get(dependency.predecessorId);
    const successor = taskMap.get(dependency.successorId);
    if (!predecessor || !successor) continue;

    const gapDays = getDependencyGapDays(dependency, predecessor, successor);
    if (gapDays === null || gapDays >= 0) continue;

    violations.push({
      dependencyId: dependency.id,
      predecessorId: dependency.predecessorId,
      successorId: dependency.successorId,
      type: dependency.type,
      lagDays: dependency.lagDays,
      shortfallDays: Math.abs(gapDays),
    });
  }

  return violations;
}

export function wouldCreateDependencyCycle(
  dependencies: ScheduleDependency[],
  predecessorId: string,
  successorId: string
) {
  if (predecessorId === successorId) {
    return true;
  }

  const adjacency = new Map<string, string[]>();
  for (const dependency of dependencies) {
    if (!adjacency.has(dependency.predecessorId)) {
      adjacency.set(dependency.predecessorId, []);
    }
    adjacency.get(dependency.predecessorId)!.push(dependency.successorId);
  }

  const stack = [successorId];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === predecessorId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        stack.push(next);
      }
    }
  }

  return false;
}

export function analyzeScheduleNetwork(
  tasks: ScheduleTask[],
  dependencies: ScheduleDependency[]
): ScheduleNetworkSummary {
  const summaryTaskIds = getSummaryTaskIds(tasks);
  const schedulableTasks = tasks.filter((task) => !summaryTaskIds.has(task.id));

  if (schedulableTasks.length === 0) {
    return {
      totalFloatByTask: new Map(),
      criticalTaskIds: new Set(),
      hasCycle: false,
    };
  }

  const taskMap = new Map(schedulableTasks.map((task) => [task.id, task]));
  const successors = new Map<string, ScheduleDependency[]>();
  const predecessors = new Map<string, ScheduleDependency[]>();
  for (const dependency of dependencies) {
    if (!taskMap.has(dependency.predecessorId) || !taskMap.has(dependency.successorId)) {
      continue;
    }
    if (!successors.has(dependency.predecessorId)) successors.set(dependency.predecessorId, []);
    if (!predecessors.has(dependency.successorId)) predecessors.set(dependency.successorId, []);
    successors.get(dependency.predecessorId)!.push(dependency);
    predecessors.get(dependency.successorId)!.push(dependency);
  }

  const nodes = new Map<string, ScheduleNetworkNode>();
  for (const task of schedulableTasks) {
    nodes.set(task.id, {
      duration: getTaskDuration(task),
      es: 0,
      ef: 0,
      ls: Infinity,
      lf: Infinity,
      float: 0,
    });
  }

  const inDegree = new Map<string, number>();
  for (const task of schedulableTasks) {
    inDegree.set(task.id, 0);
  }
  for (const dependency of dependencies) {
    if (inDegree.has(dependency.successorId) && taskMap.has(dependency.predecessorId)) {
      inDegree.set(dependency.successorId, (inDegree.get(dependency.successorId) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const dependency of successors.get(id) ?? []) {
      const successorId = dependency.successorId;
      const nextDegree = (inDegree.get(successorId) ?? 1) - 1;
      inDegree.set(successorId, nextDegree);
      if (nextDegree === 0) {
        queue.push(successorId);
      }
    }
  }

  if (sorted.length !== schedulableTasks.length) {
    return {
      totalFloatByTask: new Map(),
      criticalTaskIds: new Set(),
      hasCycle: true,
    };
  }

  for (const id of sorted) {
    const node = nodes.get(id)!;
    const candidateStarts = [0];
    for (const dependency of predecessors.get(id) ?? []) {
      const predecessorNode = nodes.get(dependency.predecessorId);
      const predecessorTask = taskMap.get(dependency.predecessorId);
      const successorTask = taskMap.get(dependency.successorId);
      if (!predecessorNode || !predecessorTask || !successorTask) continue;
      candidateStarts.push(predecessorNode.es + getDependencyWeight(dependency, predecessorTask, successorTask));
    }
    node.es = Math.max(...candidateStarts);
    node.ef = node.es + node.duration;
  }

  const projectEnd = Math.max(...Array.from(nodes.values()).map((node) => node.ef));

  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const id = sorted[index];
    const node = nodes.get(id)!;
    let latestStart = projectEnd - node.duration;

    for (const dependency of successors.get(id) ?? []) {
      const successorNode = nodes.get(dependency.successorId);
      const predecessorTask = taskMap.get(dependency.predecessorId);
      const successorTask = taskMap.get(dependency.successorId);
      if (!successorNode || !predecessorTask || !successorTask) continue;
      latestStart = Math.min(
        latestStart,
        successorNode.ls - getDependencyWeight(dependency, predecessorTask, successorTask)
      );
    }

    node.ls = latestStart;
    node.lf = latestStart + node.duration;
    node.float = latestStart - node.es;
  }

  const totalFloatByTask = new Map<string, number>();
  const criticalTaskIds = new Set<string>();
  for (const [id, node] of nodes) {
    const totalFloat = Number.isFinite(node.float) ? node.float : 0;
    totalFloatByTask.set(id, totalFloat);
    if (Math.abs(totalFloat) < 0.001) {
      criticalTaskIds.add(id);
    }
  }

  return {
    totalFloatByTask,
    criticalTaskIds,
    hasCycle: false,
  };
}

export function computeCriticalPath(
  tasks: ScheduleTask[],
  dependencies: ScheduleDependency[]
): Set<string> {
  return analyzeScheduleNetwork(tasks, dependencies).criticalTaskIds;
}

export function buildScheduleInsights(
  tasks: ScheduleTask[],
  dependencies: ScheduleDependency[],
  referenceDate = todayDate(),
  options: ScheduleInsightOptions = {}
): ScheduleInsights {
  const summaryTaskIds = getSummaryTaskIds(tasks);
  const leafTasks = tasks.filter((task) => !summaryTaskIds.has(task.id));
  const network = analyzeScheduleNetwork(tasks, dependencies);
  const dependencyViolations = computeDependencyViolations(tasks, dependencies);
  const calendarById = new Map((options.calendars ?? []).map((calendar) => [calendar.id, calendar]));
  const resourceById = new Map((options.resources ?? []).map((resource) => [resource.id, resource]));
  const assignmentsByTaskId = new Map<string, ScheduleTaskAssignment[]>();
  for (const assignment of options.taskAssignments ?? []) {
    if (!assignmentsByTaskId.has(assignment.taskId)) {
      assignmentsByTaskId.set(assignment.taskId, []);
    }
    assignmentsByTaskId.get(assignment.taskId)!.push(assignment);
  }
  const violatingDependencyIds = new Set(dependencyViolations.map((violation) => violation.dependencyId));
  const violatingTaskIds = new Set<string>();
  for (const violation of dependencyViolations) {
    violatingTaskIds.add(violation.predecessorId);
    violatingTaskIds.add(violation.successorId);
  }

  const predecessorCounts = new Map<string, number>();
  const successorCounts = new Map<string, number>();
  for (const dependency of dependencies) {
    predecessorCounts.set(
      dependency.successorId,
      (predecessorCounts.get(dependency.successorId) ?? 0) + 1
    );
    successorCounts.set(
      dependency.predecessorId,
      (successorCounts.get(dependency.predecessorId) ?? 0) + 1
    );
  }

  const overdueTaskIds = new Set<string>();
  const lookahead14TaskIds = new Set<string>();
  const lookahead28TaskIds = new Set<string>();
  const varianceTaskIds = new Set<string>();
  const behindBaselineTaskIds = new Set<string>();
  const missingDateTaskIds = new Set<string>();
  const unassignedTaskIds = new Set<string>();
  const isolatedTaskIds = new Set<string>();
  const openEndedTaskIds = new Set<string>();
  const deadlineMissTaskIds = new Set<string>();
  const constraintViolationTaskIds = new Set<string>();
  const actualDateGapTaskIds = new Set<string>();
  const resourceConflictTaskIds = new Set<string>();
  const overallocatedResourceIds = new Set<string>();
  const resourceOverloadByResource = new Map<string, number>();
  const attentionTaskIds = new Set<string>();

  let milestoneTasks = 0;
  let completeTasks = 0;
  let inProgressTasks = 0;

  const resourceLoadByDay = new Map<string, Map<string, number>>();

  for (const task of leafTasks) {
    if (task.taskType === "milestone") milestoneTasks += 1;
    if (task.status === "complete") completeTasks += 1;
    if (task.status === "in_progress") inProgressTasks += 1;

    if (!task.startDate || !task.endDate) {
      missingDateTaskIds.add(task.id);
      attentionTaskIds.add(task.id);
    }

    if (!task.assignee.trim()) {
      unassignedTaskIds.add(task.id);
    }

    const deadlineDate = parseDate(task.deadlineDate);
    const finishDate = parseDate(task.actualEnd ?? task.endDate);
    if (deadlineDate && finishDate && finishDate.getTime() > deadlineDate.getTime()) {
      deadlineMissTaskIds.add(task.id);
      attentionTaskIds.add(task.id);
    }

    const constraintDate = parseDate(task.constraintDate);
    const plannedStart = parseDate(task.actualStart ?? task.startDate);
    if (constraintDate) {
      const startCompare =
        plannedStart &&
        ((task.constraintType === "snet" && plannedStart.getTime() < constraintDate.getTime()) ||
          (task.constraintType === "snlt" && plannedStart.getTime() > constraintDate.getTime()) ||
          (task.constraintType === "mso" && diffDays(plannedStart, constraintDate) !== 0));
      const finishCompare =
        finishDate &&
        ((task.constraintType === "fnet" && finishDate.getTime() < constraintDate.getTime()) ||
          (task.constraintType === "fnlt" && finishDate.getTime() > constraintDate.getTime()) ||
          (task.constraintType === "mfo" && diffDays(finishDate, constraintDate) !== 0));
      if (startCompare || finishCompare) {
        constraintViolationTaskIds.add(task.id);
        attentionTaskIds.add(task.id);
      }
    }

    if (
      (task.actualStart && task.status === "not_started") ||
      (task.actualEnd && task.status !== "complete") ||
      (task.status === "complete" && !task.actualEnd)
    ) {
      actualDateGapTaskIds.add(task.id);
      attentionTaskIds.add(task.id);
    }

    if (isTaskOverdue(task, referenceDate)) {
      overdueTaskIds.add(task.id);
      attentionTaskIds.add(task.id);
    }

    if (isTaskInLookahead(task, 14, referenceDate)) {
      lookahead14TaskIds.add(task.id);
    }

    if (isTaskInLookahead(task, 28, referenceDate)) {
      lookahead28TaskIds.add(task.id);
    }

    const variance = getTaskVariance(task);
    if (variance.hasVariance) {
      varianceTaskIds.add(task.id);
    }
    if (variance.isBehind) {
      behindBaselineTaskIds.add(task.id);
      attentionTaskIds.add(task.id);
    }

    const predecessorCount = predecessorCounts.get(task.id) ?? 0;
    const successorCount = successorCounts.get(task.id) ?? 0;
    if (predecessorCount === 0 && successorCount === 0) {
      isolatedTaskIds.add(task.id);
      attentionTaskIds.add(task.id);
    }
    if (task.taskType !== "milestone" && task.status !== "complete" && successorCount === 0) {
      openEndedTaskIds.add(task.id);
      attentionTaskIds.add(task.id);
    }

    const taskAssignments = assignmentsByTaskId.get(task.id) ?? [];
    const taskCalendar = task.calendarId ? calendarById.get(task.calendarId) : null;
    for (const assignment of taskAssignments) {
      const resource = resourceById.get(assignment.resourceId);
      const workingCalendar =
        (resource?.calendarId ? calendarById.get(resource.calendarId) : null) ?? taskCalendar ?? null;
      for (const date of getTaskWorkingDates(task, workingCalendar)) {
        const dayKey = formatISODate(date);
        if (!resourceLoadByDay.has(assignment.resourceId)) {
          resourceLoadByDay.set(assignment.resourceId, new Map());
        }
        const dayLoad = resourceLoadByDay.get(assignment.resourceId)!;
        dayLoad.set(dayKey, (dayLoad.get(dayKey) ?? 0) + (assignment.units ?? resource?.defaultUnits ?? 1));
      }
    }
  }

  for (const taskId of violatingTaskIds) {
    attentionTaskIds.add(taskId);
  }

  for (const [resourceId, loadByDay] of resourceLoadByDay) {
    const resource = resourceById.get(resourceId);
    const capacity = resource?.capacityPerDay ?? resource?.defaultUnits ?? 1;
    let maxOverload = 0;

    for (const load of loadByDay.values()) {
      const overload = load - capacity;
      if (overload > 0) {
        maxOverload = Math.max(maxOverload, overload);
      }
    }

    if (maxOverload > 0) {
      overallocatedResourceIds.add(resourceId);
      resourceOverloadByResource.set(resourceId, maxOverload);
      for (const task of leafTasks) {
        if ((assignmentsByTaskId.get(task.id) ?? []).some((assignment) => assignment.resourceId === resourceId)) {
          resourceConflictTaskIds.add(task.id);
          attentionTaskIds.add(task.id);
        }
      }
    }
  }

  return {
    totalTasks: leafTasks.length,
    milestoneTasks,
    completeTasks,
    inProgressTasks,
    criticalTaskIds: network.criticalTaskIds,
    totalFloatByTask: network.totalFloatByTask,
    overdueTaskIds,
    lookahead14TaskIds,
    lookahead28TaskIds,
    varianceTaskIds,
    behindBaselineTaskIds,
    missingDateTaskIds,
    unassignedTaskIds,
    isolatedTaskIds,
    openEndedTaskIds,
    deadlineMissTaskIds,
    constraintViolationTaskIds,
    actualDateGapTaskIds,
    resourceConflictTaskIds,
    overallocatedResourceIds,
    resourceOverloadByResource,
    attentionTaskIds,
    dependencyViolations,
    violatingDependencyIds,
    violatingTaskIds,
    hasCycle: network.hasCycle,
  };
}

export function applyQuickFilter(
  tasks: ScheduleTask[],
  quickFilter: ScheduleQuickFilter,
  insights: ScheduleInsights
): ScheduleTask[] {
  if (quickFilter === "all") {
    return tasks;
  }

  const allowedIds =
    quickFilter === "lookahead_14"
      ? insights.lookahead14TaskIds
      : quickFilter === "lookahead_28"
        ? insights.lookahead28TaskIds
        : quickFilter === "critical"
          ? insights.criticalTaskIds
          : quickFilter === "overdue"
            ? insights.overdueTaskIds
            : quickFilter === "variance"
              ? insights.behindBaselineTaskIds
              : insights.attentionTaskIds;

  const expandedIds = new Set<string>(allowedIds);
  for (const task of tasks) {
    if (!allowedIds.has(task.id)) continue;
    for (const ancestorId of getTaskAncestorIds(tasks, task.id)) {
      expandedIds.add(ancestorId);
    }
  }

  return tasks.filter((task) => expandedIds.has(task.id));
}

export function applyDragDelta(
  startDate: Date,
  endDate: Date,
  deltaMs: number,
  edge: "start" | "end" | "move"
): { startDate: Date; endDate: Date } {
  if (edge === "move") {
    return {
      startDate: snapToDay(startDate.getTime() + deltaMs),
      endDate: snapToDay(endDate.getTime() + deltaMs),
    };
  }

  if (edge === "start") {
    const nextStart = snapToDay(startDate.getTime() + deltaMs);
    return {
      startDate: nextStart.getTime() < endDate.getTime() ? nextStart : addDays(endDate, -1),
      endDate,
    };
  }

  const nextEnd = snapToDay(endDate.getTime() + deltaMs);
  return {
    startDate,
    endDate: nextEnd.getTime() > startDate.getTime() ? nextEnd : addDays(startDate, 1),
  };
}

export function filterTasks(tasks: ScheduleTask[], filters: ScheduleFilters): ScheduleTask[] {
  return tasks.filter((task) => {
    if (filters.phaseIds.length > 0 && !filters.phaseIds.includes(task.phaseId ?? "")) return false;
    if (filters.statuses.length > 0 && !filters.statuses.includes(task.status)) return false;
    if (filters.assignees.length > 0 && !filters.assignees.includes(task.assignee)) return false;

    if (filters.dateFrom) {
      const from = parseDate(filters.dateFrom);
      const endDate = parseDate(task.endDate);
      if (from && endDate && endDate < from) return false;
    }

    if (filters.dateTo) {
      const to = parseDate(filters.dateTo);
      const startDate = parseDate(task.startDate);
      if (to && startDate && startDate > to) return false;
    }

    return true;
  });
}

export function sortTasksByOrder(tasks: ScheduleTask[]) {
  return [...tasks].sort((a, b) => a.order - b.order);
}

function clampOutlineLevel(level: number) {
  return Math.max(0, Math.min(12, level));
}

export function getSummaryTaskIds(tasks: ScheduleTask[]): Set<string> {
  const summaryTaskIds = new Set(tasks.filter((task) => task.taskType === "summary").map((task) => task.id));
  const hierarchyInfo = buildTaskHierarchyInfo(tasks);
  for (const [taskId, info] of hierarchyInfo) {
    if (info.hasChildren) {
      summaryTaskIds.add(taskId);
    }
  }
  return summaryTaskIds;
}

export function buildTaskHierarchyInfo(tasks: ScheduleTask[]): Map<string, TaskHierarchyInfo> {
  const orderedTasks = sortTasksByOrder(tasks);
  const taskById = new Map(orderedTasks.map((task) => [task.id, task]));
  const childCountByParent = new Map<string, number>();

  for (const task of orderedTasks) {
    const parentId =
      task.parentTaskId && task.parentTaskId !== task.id && taskById.has(task.parentTaskId)
        ? task.parentTaskId
        : null;
    if (parentId) {
      childCountByParent.set(parentId, (childCountByParent.get(parentId) ?? 0) + 1);
    }
  }

  const infoById = new Map<string, TaskHierarchyInfo>();
  const computeDepth = (task: ScheduleTask, trail = new Set<string>()): number => {
    if (trail.has(task.id)) return 0;
    trail.add(task.id);
    const parentId =
      task.parentTaskId && task.parentTaskId !== task.id && taskById.has(task.parentTaskId)
        ? task.parentTaskId
        : null;
    const parentTask = parentId ? taskById.get(parentId) ?? null : null;
    const depth = parentTask ? Math.min(12, computeDepth(parentTask, trail) + 1) : 0;
    trail.delete(task.id);
    return depth;
  };

  for (const task of orderedTasks) {
    const parentId =
      task.parentTaskId && task.parentTaskId !== task.id && taskById.has(task.parentTaskId)
        ? task.parentTaskId
        : null;
    const childCount = childCountByParent.get(task.id) ?? 0;
    infoById.set(task.id, {
      depth: computeDepth(task),
      parentId,
      hasChildren: childCount > 0,
      childCount,
    });
  }

  return infoById;
}

function getTaskChildrenByParent(tasks: ScheduleTask[]) {
  const orderedTasks = sortTasksByOrder(tasks);
  const taskById = new Map(orderedTasks.map((task) => [task.id, task]));
  const childrenByParent = new Map<string, ScheduleTask[]>();

  for (const task of orderedTasks) {
    const parentId =
      task.parentTaskId && task.parentTaskId !== task.id && taskById.has(task.parentTaskId)
        ? task.parentTaskId
        : null;
    if (!parentId) continue;
    if (!childrenByParent.has(parentId)) {
      childrenByParent.set(parentId, []);
    }
    childrenByParent.get(parentId)!.push(task);
  }

  return { orderedTasks, taskById, childrenByParent };
}

function computeSummaryStatus(children: ScheduleTask[]): ScheduleTask["status"] {
  if (children.length === 0) return "not_started";
  if (children.every((child) => child.status === "complete")) return "complete";
  if (children.every((child) => child.status === "on_hold")) return "on_hold";

  const anyStarted = children.some(
    (child) =>
      child.status === "in_progress" ||
      child.status === "complete" ||
      (child.progress ?? 0) > 0 ||
      !!child.actualStart ||
      !!child.actualEnd
  );
  if (anyStarted) return "in_progress";
  if (children.some((child) => child.status === "on_hold")) return "on_hold";
  return "not_started";
}

function computeRollupProgress(children: ScheduleTask[]) {
  if (children.length === 0) return 0;
  const totalWeight = children.reduce((sum, child) => sum + Math.max(1, child.duration ?? 0), 0);
  if (totalWeight <= 0) return 0;
  const progress = children.reduce(
    (sum, child) => sum + (child.progress ?? 0) * Math.max(1, child.duration ?? 0),
    0
  );
  return Math.max(0, Math.min(1, progress / totalWeight));
}

export function rollupScheduleTasks(tasks: ScheduleTask[]): ScheduleTask[] {
  const { orderedTasks, taskById, childrenByParent } = getTaskChildrenByParent(tasks);
  const rolledById = new Map<string, ScheduleTask>();

  const rollTask = (taskId: string): ScheduleTask => {
    const cached = rolledById.get(taskId);
    if (cached) return cached;

    const task = taskById.get(taskId)!;
    const rolledChildren = (childrenByParent.get(taskId) ?? []).map((child) => rollTask(child.id));
    if (rolledChildren.length === 0) {
      rolledById.set(taskId, task);
      return task;
    }

    const startCandidates = rolledChildren
      .map((child) => parseDate(child.startDate ?? child.endDate))
      .filter((value): value is Date => !!value);
    const endCandidates = rolledChildren
      .map((child) => parseDate(child.endDate ?? child.startDate))
      .filter((value): value is Date => !!value);
    const baselineStartCandidates = rolledChildren
      .map((child) => parseDate(child.baselineStart ?? child.baselineEnd))
      .filter((value): value is Date => !!value);
    const baselineEndCandidates = rolledChildren
      .map((child) => parseDate(child.baselineEnd ?? child.baselineStart))
      .filter((value): value is Date => !!value);
    const actualStartCandidates = rolledChildren
      .map((child) => parseDate(child.actualStart))
      .filter((value): value is Date => !!value);
    const actualEndCandidates = rolledChildren
      .map((child) => parseDate(child.actualEnd))
      .filter((value): value is Date => !!value);

    const earliestStart =
      startCandidates.length > 0
        ? new Date(Math.min(...startCandidates.map((value) => value.getTime())))
        : null;
    const latestEnd =
      endCandidates.length > 0
        ? new Date(Math.max(...endCandidates.map((value) => value.getTime())))
        : null;
    const earliestBaselineStart =
      baselineStartCandidates.length > 0
        ? new Date(Math.min(...baselineStartCandidates.map((value) => value.getTime())))
        : null;
    const latestBaselineEnd =
      baselineEndCandidates.length > 0
        ? new Date(Math.max(...baselineEndCandidates.map((value) => value.getTime())))
        : null;
    const earliestActualStart =
      actualStartCandidates.length > 0
        ? new Date(Math.min(...actualStartCandidates.map((value) => value.getTime())))
        : null;
    const latestActualEnd =
      actualEndCandidates.length === rolledChildren.length && actualEndCandidates.length > 0
        ? new Date(Math.max(...actualEndCandidates.map((value) => value.getTime())))
        : null;

    const rolledTask: ScheduleTask = {
      ...task,
      taskType: "summary",
      startDate: earliestStart ? formatISODate(earliestStart) : task.startDate,
      endDate: latestEnd ? formatISODate(latestEnd) : task.endDate,
      duration: earliestStart && latestEnd ? Math.max(0, diffDays(latestEnd, earliestStart)) : task.duration,
      progress: computeRollupProgress(rolledChildren),
      status: computeSummaryStatus(rolledChildren),
      actualStart: earliestActualStart ? formatISODate(earliestActualStart) : null,
      actualEnd: latestActualEnd ? formatISODate(latestActualEnd) : null,
      baselineStart: earliestBaselineStart ? formatISODate(earliestBaselineStart) : task.baselineStart,
      baselineEnd: latestBaselineEnd ? formatISODate(latestBaselineEnd) : task.baselineEnd,
    };
    rolledById.set(taskId, rolledTask);
    return rolledTask;
  };

  return orderedTasks.map((task) => rollTask(task.id));
}

export function getTaskDescendantIds(tasks: ScheduleTask[], taskId: string): string[] {
  const orderedTasks = sortTasksByOrder(tasks);
  const childrenByParent = new Map<string, ScheduleTask[]>();

  for (const task of orderedTasks) {
    if (!task.parentTaskId || task.parentTaskId === task.id) continue;
    if (!childrenByParent.has(task.parentTaskId)) {
      childrenByParent.set(task.parentTaskId, []);
    }
    childrenByParent.get(task.parentTaskId)!.push(task);
  }

  const descendants: string[] = [];
  const walk = (parentId: string) => {
    for (const child of childrenByParent.get(parentId) ?? []) {
      descendants.push(child.id);
      walk(child.id);
    }
  };

  walk(taskId);
  return descendants;
}

export function getTaskSubtreeIds(tasks: ScheduleTask[], taskId: string): string[] {
  return [taskId, ...getTaskDescendantIds(tasks, taskId)];
}

export function buildIndentTaskUpdates(tasks: ScheduleTask[], taskId: string): TaskTreeUpdate[] {
  const orderedTasks = sortTasksByOrder(tasks);
  const hierarchyInfo = buildTaskHierarchyInfo(orderedTasks);
  const taskIndex = orderedTasks.findIndex((task) => task.id === taskId);
  if (taskIndex <= 0) return [];

  const task = orderedTasks[taskIndex];
  const previousTask = orderedTasks[taskIndex - 1];
  const currentDepth = hierarchyInfo.get(taskId)?.depth ?? task.outlineLevel ?? 0;
  const nextDepth = clampOutlineLevel((hierarchyInfo.get(previousTask.id)?.depth ?? previousTask.outlineLevel ?? 0) + 1);
  const nextParentId = previousTask.id;

  if ((task.parentTaskId ?? null) === nextParentId && currentDepth === nextDepth) {
    return [];
  }

  return [{ id: task.id, parentTaskId: nextParentId, outlineLevel: nextDepth }];
}

export function buildOutdentTaskUpdates(tasks: ScheduleTask[], taskId: string): TaskTreeUpdate[] {
  const orderedTasks = sortTasksByOrder(tasks);
  const taskById = new Map(orderedTasks.map((task) => [task.id, task]));
  const hierarchyInfo = buildTaskHierarchyInfo(orderedTasks);
  const task = taskById.get(taskId);
  if (!task?.parentTaskId) return [];

  const parentTask = taskById.get(task.parentTaskId);
  if (!parentTask) return [];

  const currentDepth = hierarchyInfo.get(taskId)?.depth ?? task.outlineLevel ?? 0;
  const nextParentId = hierarchyInfo.get(parentTask.id)?.parentId ?? parentTask.parentTaskId ?? null;
  const nextDepth = clampOutlineLevel(currentDepth - 1);

  return [{ id: task.id, parentTaskId: nextParentId, outlineLevel: nextDepth }];
}

function findSubtreeEndIndex(tasks: ScheduleTask[], taskId: string) {
  const subtreeIds = new Set(getTaskSubtreeIds(tasks, taskId));
  let endIndex = tasks.findIndex((task) => task.id === taskId);
  for (let index = endIndex; index < tasks.length; index += 1) {
    if (subtreeIds.has(tasks[index].id)) {
      endIndex = index;
    }
  }
  return endIndex;
}

function findNearestPreviousTaskAtDepth(
  tasks: ScheduleTask[],
  hierarchyInfo: Map<string, TaskHierarchyInfo>,
  beforeIndex: number,
  depth: number
) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const candidate = tasks[index];
    const candidateDepth = hierarchyInfo.get(candidate.id)?.depth ?? candidate.outlineLevel ?? 0;
    if (candidateDepth === depth) {
      return candidate;
    }
  }
  return null;
}

export function buildReorderTaskUpdates(
  tasks: ScheduleTask[],
  taskId: string,
  targetTaskId: string,
  placement: TaskTreePlacement,
  depthHint?: number
): TaskTreeUpdate[] {
  if (taskId === targetTaskId) return [];

  const orderedTasks = sortTasksByOrder(tasks);
  const taskById = new Map(orderedTasks.map((task) => [task.id, task]));
  const hierarchyInfo = buildTaskHierarchyInfo(orderedTasks);
  const task = taskById.get(taskId);
  const targetTask = taskById.get(targetTaskId);
  if (!task || !targetTask) return [];

  const blockIds = new Set(getTaskSubtreeIds(orderedTasks, taskId));
  if (blockIds.has(targetTaskId)) return [];

  const taskBlock = orderedTasks.filter((item) => blockIds.has(item.id));
  if (taskBlock.length === 0) return [];

  const remainingTasks = orderedTasks.filter((item) => !blockIds.has(item.id));
  const targetIndex = remainingTasks.findIndex((item) => item.id === targetTaskId);
  if (targetIndex < 0) return [];

  let nextParentId: string | null = null;
  let nextDepth = 0;
  let insertIndex: number;
  const targetDepth = hierarchyInfo.get(targetTask.id)?.depth ?? targetTask.outlineLevel ?? 0;

  if (placement === "inside") {
    nextParentId = targetTask.id;
    nextDepth = clampOutlineLevel(targetDepth + 1);
    insertIndex = findSubtreeEndIndex(remainingTasks, targetTaskId) + 1;
  } else {
    insertIndex = placement === "before" ? targetIndex : findSubtreeEndIndex(remainingTasks, targetTaskId) + 1;
    const requestedDepth = clampOutlineLevel(depthHint ?? targetDepth);
    const previousTask = remainingTasks[insertIndex - 1] ?? null;
    const previousDepth = previousTask
      ? (hierarchyInfo.get(previousTask.id)?.depth ?? previousTask.outlineLevel ?? 0)
      : -1;
    let resolvedDepth = Math.min(requestedDepth, previousDepth + 1);

    while (resolvedDepth > 0) {
      const parentTask = findNearestPreviousTaskAtDepth(remainingTasks, hierarchyInfo, insertIndex, resolvedDepth - 1);
      if (parentTask) {
        nextParentId = parentTask.id;
        nextDepth = resolvedDepth;
        break;
      }
      resolvedDepth -= 1;
    }

    if (resolvedDepth <= 0) {
      nextParentId = null;
      nextDepth = 0;
    }
  }

  const nextOrder = [
    ...remainingTasks.slice(0, insertIndex),
    ...taskBlock,
    ...remainingTasks.slice(insertIndex),
  ];
  const currentDepth = hierarchyInfo.get(taskId)?.depth ?? task.outlineLevel ?? 0;

  return nextOrder.flatMap((item, index) => {
    const patch: Omit<TaskTreeUpdate, "id"> = {};
    const nextOrderValue = index + 1;
    if (item.order !== nextOrderValue) {
      patch.order = nextOrderValue;
    }
    if (item.id === taskId) {
      if ((item.parentTaskId ?? null) !== (nextParentId ?? null)) {
        patch.parentTaskId = nextParentId;
      }
      if (currentDepth !== nextDepth) {
        patch.outlineLevel = nextDepth;
      }
    }
    return Object.keys(patch).length > 0 ? [{ id: item.id, ...patch }] : [];
  });
}

export function getTaskAncestorIds(tasks: ScheduleTask[], taskId: string): string[] {
  const orderedTasks = sortTasksByOrder(tasks);
  const taskById = new Map(orderedTasks.map((task) => [task.id, task]));
  const ancestors: string[] = [];
  const visited = new Set<string>();
  let current = taskById.get(taskId) ?? null;

  while (current?.parentTaskId && !visited.has(current.parentTaskId)) {
    const parent = taskById.get(current.parentTaskId) ?? null;
    if (!parent) break;
    ancestors.push(parent.id);
    visited.add(parent.id);
    current = parent;
  }

  return ancestors;
}

export function getVisibleTaskOrder(tasks: ScheduleTask[], collapsedTaskIds: Set<string> = new Set()) {
  const { orderedTasks, taskById, childrenByParent } = getTaskChildrenByParent(tasks);
  const orderedIds: string[] = [];

  const visit = (task: ScheduleTask) => {
    orderedIds.push(task.id);
    if (collapsedTaskIds.has(task.id)) return;
    for (const child of childrenByParent.get(task.id) ?? []) {
      visit(child);
    }
  };

  for (const task of orderedTasks) {
    const hasValidParent =
      task.parentTaskId && task.parentTaskId !== task.id && taskById.has(task.parentTaskId);
    if (!hasValidParent) {
      visit(task);
    }
  }

  return orderedIds;
}

export function getVisibleTasks(tasks: ScheduleTask[], collapsedTaskIds: Set<string> = new Set()) {
  const orderedTasks = sortTasksByOrder(tasks);
  const taskById = new Map(orderedTasks.map((task) => [task.id, task]));
  return getVisibleTaskOrder(tasks, collapsedTaskIds)
    .map((taskId) => taskById.get(taskId))
    .filter((task): task is ScheduleTask => !!task);
}

export function groupTasksByPhase(
  tasks: ScheduleTask[],
  phases: ProjectPhase[],
  phaseDates: Map<string, { startDate: Date; endDate: Date }>
): TaskGroup[] {
  const groups: TaskGroup[] = [];
  const byPhase = new Map<string | null, ScheduleTask[]>();

  for (const task of tasks) {
    const key = task.phaseId;
    if (!byPhase.has(key)) {
      byPhase.set(key, []);
    }
    byPhase.get(key)!.push(task);
  }

  for (const phase of phases) {
    const phaseTasks = byPhase.get(phase.id) ?? [];
    groups.push({
      phase,
      tasks: sortTasksByOrder(phaseTasks),
      phaseDates: phaseDates.get(phase.id) ?? null,
    });
  }

  const standaloneTasks = byPhase.get(null) ?? [];
  if (standaloneTasks.length > 0) {
    groups.push({
      phase: null,
      tasks: sortTasksByOrder(standaloneTasks),
      phaseDates: null,
    });
  }

  return groups;
}

const MAX_COLUMNS: Record<ZoomLevel, number> = {
  day: 366,
  week: 156,
  month: 120,
};

export function generateColumns(
  start: Date,
  end: Date,
  zoomLevel: ZoomLevel,
  calendar?: ScheduleCalendar | null
): TimelineColumn[] {
  const columns: TimelineColumn[] = [];
  const today = todayDate();
  const totalDays = Math.max(0, diffDays(end, start));
  const maxColumns = MAX_COLUMNS[zoomLevel];

  if (zoomLevel === "day") {
    for (let index = 0; index < Math.min(totalDays, maxColumns); index += 1) {
      const date = addDays(start, index);
      columns.push({
        date,
        label: String(date.getDate()),
        subLabel: formatWeekdayShort(date),
        groupKey: monthKey(date),
        groupLabel: formatMonthYear(date),
        isToday: diffDays(date, today) === 0,
        isNonWorking: isNonWorkingDay(date, calendar),
      });
    }
    return columns;
  }

  if (zoomLevel === "week") {
    let current = startOfWeek(start);
    while (current < end && columns.length < maxColumns) {
      columns.push({
        date: current,
        label: formatShortDate(current),
        subLabel: "Week",
        groupKey: monthKey(current),
        groupLabel: formatMonthYear(current),
        isToday: today >= current && today < addDays(current, 7),
        isNonWorking: false,
      });
      current = addDays(current, 7);
    }
    return columns;
  }

  let current = startOfMonth(start);
  while (current < end && columns.length < maxColumns) {
    columns.push({
      date: current,
      label: formatMonthShort(current),
      groupKey: yearKey(current),
      groupLabel: String(current.getFullYear()),
      isToday: today.getFullYear() === current.getFullYear() && today.getMonth() === current.getMonth(),
      isNonWorking: false,
    });
    current = createCalendarDate(current.getFullYear(), current.getMonth() + 1, 1);
  }

  return columns;
}

export function buildTimelineHeaderBands(columns: TimelineColumn[]): TimelineHeaderBand[] {
  const bands: TimelineHeaderBand[] = [];

  for (const column of columns) {
    const current = bands[bands.length - 1];
    if (current && current.key === column.groupKey) {
      current.span += 1;
      continue;
    }

    bands.push({
      key: column.groupKey,
      label: column.groupLabel,
      span: 1,
    });
  }

  return bands;
}

export function getTimelineBounds(
  columns: TimelineColumn[],
  zoomLevel: ZoomLevel
): { startMs: number; endMs: number } {
  if (columns.length === 0) {
    return { startMs: 0, endMs: 1 };
  }

  const startMs = columns[0].date.getTime();
  const lastDate = columns[columns.length - 1].date;
  const endDate =
    zoomLevel === "day"
      ? addDays(lastDate, 1)
      : zoomLevel === "week"
        ? addDays(lastDate, 7)
        : createCalendarDate(lastDate.getFullYear(), lastDate.getMonth() + 1, 1);

  return { startMs, endMs: endDate.getTime() };
}

export function getTodayPosition(timelineStartMs: number, timelineEndMs: number): string | null {
  const today = todayDate();
  const span = timelineEndMs - timelineStartMs;
  if (span <= 0) return null;

  const position = (today.getTime() - timelineStartMs) / span;
  if (position < 0 || position > 1) return null;
  return `${(position * 100).toFixed(2)}%`;
}
