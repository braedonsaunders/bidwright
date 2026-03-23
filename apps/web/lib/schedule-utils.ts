import type { ScheduleTask, ScheduleDependency, ProjectPhase, ScheduleTaskStatus } from "./api";

/* ─── Constants ─── */

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

/* ─── Date Helpers ─── */

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function diffDays(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY);
}

export function formatShortDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatMonthYear(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function formatISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function startOfWeek(d: Date) {
  const day = d.getDay();
  return addDays(d, -day);
}

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function snapToDay(ms: number): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}

/* ─── Bar Positioning ─── */

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

/* ─── Phase Date Computation from Tasks ─── */

export function computePhaseDatesFromTasks(
  tasks: ScheduleTask[],
  phases: ProjectPhase[]
): Map<string, { startDate: Date; endDate: Date }> {
  const result = new Map<string, { startDate: Date; endDate: Date }>();

  for (const phase of phases) {
    const phaseTasks = tasks.filter((t) => t.phaseId === phase.id);
    if (phaseTasks.length === 0) {
      // Use stored dates if available
      const s = parseDate(phase.startDate);
      const e = parseDate(phase.endDate);
      if (s && e) result.set(phase.id, { startDate: s, endDate: e });
      continue;
    }

    let earliest = Infinity;
    let latest = -Infinity;

    for (const t of phaseTasks) {
      const s = parseDate(t.startDate);
      const e = parseDate(t.endDate);
      if (s) earliest = Math.min(earliest, s.getTime());
      if (e) latest = Math.max(latest, e.getTime());
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

/* ─── Critical Path Method ─── */

interface CPMNode {
  id: string;
  duration: number;
  startMs: number;
  endMs: number;
  es: number; // earliest start
  ef: number; // earliest finish
  ls: number; // latest start
  lf: number; // latest finish
  float: number;
}

export function computeCriticalPath(
  tasks: ScheduleTask[],
  dependencies: ScheduleDependency[]
): Set<string> {
  if (tasks.length === 0) return new Set();

  // Build adjacency
  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  for (const d of dependencies) {
    if (!successors.has(d.predecessorId)) successors.set(d.predecessorId, []);
    successors.get(d.predecessorId)!.push(d.successorId);
    if (!predecessors.has(d.successorId)) predecessors.set(d.successorId, []);
    predecessors.get(d.successorId)!.push(d.predecessorId);
  }

  const nodes = new Map<string, CPMNode>();
  for (const t of tasks) {
    const s = parseDate(t.startDate);
    const e = parseDate(t.endDate);
    const startMs = s?.getTime() ?? 0;
    const endMs = e?.getTime() ?? startMs;
    const duration = Math.max(0, (endMs - startMs) / MS_PER_DAY);
    nodes.set(t.id, { id: t.id, duration, startMs, endMs, es: 0, ef: 0, ls: Infinity, lf: Infinity, float: 0 });
  }

  // Topological sort
  const inDegree = new Map<string, number>();
  for (const t of tasks) inDegree.set(t.id, 0);
  for (const d of dependencies) {
    if (inDegree.has(d.successorId)) {
      inDegree.set(d.successorId, (inDegree.get(d.successorId) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const succ of successors.get(id) ?? []) {
      const newDeg = (inDegree.get(succ) ?? 1) - 1;
      inDegree.set(succ, newDeg);
      if (newDeg === 0) queue.push(succ);
    }
  }

  // Forward pass
  for (const id of sorted) {
    const node = nodes.get(id)!;
    const preds = predecessors.get(id) ?? [];
    if (preds.length === 0) {
      node.es = 0;
    } else {
      node.es = Math.max(...preds.map((p) => nodes.get(p)?.ef ?? 0));
    }
    node.ef = node.es + node.duration;
  }

  // Project end
  const projectEnd = Math.max(...Array.from(nodes.values()).map((n) => n.ef));

  // Backward pass
  for (let i = sorted.length - 1; i >= 0; i--) {
    const id = sorted[i];
    const node = nodes.get(id)!;
    const succs = successors.get(id) ?? [];
    if (succs.length === 0) {
      node.lf = projectEnd;
    } else {
      node.lf = Math.min(...succs.map((s) => nodes.get(s)?.ls ?? projectEnd));
    }
    node.ls = node.lf - node.duration;
    node.float = node.ls - node.es;
  }

  // Critical path = tasks with zero float
  const critical = new Set<string>();
  for (const [id, node] of nodes) {
    if (Math.abs(node.float) < 0.001) {
      critical.add(id);
    }
  }

  return critical;
}

/* ─── Dependency Graph for Rendering ─── */

export interface DependencyEdge {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  lagDays: number;
}

export function buildDependencyEdges(dependencies: ScheduleDependency[]): DependencyEdge[] {
  return dependencies.map((d) => ({
    id: d.id,
    fromId: d.predecessorId,
    toId: d.successorId,
    type: d.type,
    lagDays: d.lagDays,
  }));
}

/* ─── Drag Helpers ─── */

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
  } else if (edge === "start") {
    const newStart = snapToDay(startDate.getTime() + deltaMs);
    return {
      startDate: newStart.getTime() < endDate.getTime() ? newStart : addDays(endDate, -1),
      endDate,
    };
  } else {
    const newEnd = snapToDay(endDate.getTime() + deltaMs);
    return {
      startDate,
      endDate: newEnd.getTime() > startDate.getTime() ? newEnd : addDays(startDate, 1),
    };
  }
}

/* ─── Filters ─── */

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

export function filterTasks(tasks: ScheduleTask[], filters: ScheduleFilters): ScheduleTask[] {
  return tasks.filter((t) => {
    if (filters.phaseIds.length > 0 && !filters.phaseIds.includes(t.phaseId ?? "")) return false;
    if (filters.statuses.length > 0 && !filters.statuses.includes(t.status)) return false;
    if (filters.assignees.length > 0 && !filters.assignees.includes(t.assignee)) return false;
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom);
      const end = parseDate(t.endDate);
      if (end && end < from) return false;
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      const start = parseDate(t.startDate);
      if (start && start > to) return false;
    }
    return true;
  });
}

/* ─── Grouping ─── */

export interface TaskGroup {
  phase: ProjectPhase | null;
  tasks: ScheduleTask[];
  phaseDates: { startDate: Date; endDate: Date } | null;
}

export function groupTasksByPhase(
  tasks: ScheduleTask[],
  phases: ProjectPhase[],
  phaseDates: Map<string, { startDate: Date; endDate: Date }>
): TaskGroup[] {
  const groups: TaskGroup[] = [];
  const phaseMap = new Map(phases.map((p) => [p.id, p]));

  // Group by phase
  const byPhase = new Map<string | null, ScheduleTask[]>();
  for (const t of tasks) {
    const key = t.phaseId;
    if (!byPhase.has(key)) byPhase.set(key, []);
    byPhase.get(key)!.push(t);
  }

  // Phases in order
  for (const phase of phases) {
    const pTasks = byPhase.get(phase.id) ?? [];
    groups.push({
      phase,
      tasks: pTasks.sort((a, b) => a.order - b.order),
      phaseDates: phaseDates.get(phase.id) ?? null,
    });
  }

  // Standalone tasks (no phase)
  const standalone = byPhase.get(null) ?? [];
  if (standalone.length > 0) {
    groups.push({
      phase: null,
      tasks: standalone.sort((a, b) => a.order - b.order),
      phaseDates: null,
    });
  }

  return groups;
}

/* ─── Timeline Columns ─── */

export type ZoomLevel = "day" | "week" | "month";

export interface TimelineColumn {
  date: Date;
  label: string;
  isToday: boolean;
}

export function generateColumns(
  start: Date,
  end: Date,
  zoomLevel: ZoomLevel
): TimelineColumn[] {
  const cols: TimelineColumn[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const totalDays = diffDays(end, start);

  if (zoomLevel === "day") {
    for (let i = 0; i < Math.min(totalDays, 60); i++) {
      const d = addDays(start, i);
      cols.push({ date: d, label: formatShortDate(d), isToday: diffDays(d, today) === 0 });
    }
  } else if (zoomLevel === "week") {
    let current = startOfWeek(start);
    while (current < end && cols.length < 30) {
      cols.push({ date: current, label: formatShortDate(current), isToday: today >= current && today < addDays(current, 7) });
      current = addDays(current, 7);
    }
  } else {
    let current = startOfMonth(start);
    while (current < end && cols.length < 24) {
      cols.push({
        date: current,
        label: formatMonthYear(current),
        isToday: today.getFullYear() === current.getFullYear() && today.getMonth() === current.getMonth(),
      });
      current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    }
  }

  return cols;
}

export function getTodayPosition(columns: TimelineColumn[]): string | null {
  if (columns.length === 0) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const timelineStart = columns[0].date.getTime();
  const timelineEnd = columns[columns.length - 1].date.getTime();
  const span = timelineEnd - timelineStart;
  if (span <= 0) return null;
  const pos = (today.getTime() - timelineStart) / span;
  if (pos < 0 || pos > 1) return null;
  return `${(pos * 100).toFixed(2)}%`;
}
