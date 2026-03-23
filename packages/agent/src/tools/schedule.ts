import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";
import { apiFetch } from "./api-fetch.js";

type StoreOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<ToolResult>;

function createScheduleTool(def: {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodType;
  requiresConfirmation?: boolean;
  mutates?: boolean;
  tags: string[];
}, operation: StoreOperation): Tool {
  return {
    definition: {
      id: def.id,
      name: def.name,
      category: "quote",
      description: def.description,
      parameters: [],
      inputSchema: def.inputSchema,
      requiresConfirmation: def.requiresConfirmation ?? false,
      mutates: def.mutates ?? true,
      tags: def.tags,
    },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext) {
      const start = Date.now();
      try {
        const result = await operation(context, input);
        return { ...result, duration_ms: Date.now() - start };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), duration_ms: Date.now() - start };
      }
    },
  };
}

async function apiGet(ctx: ToolExecutionContext, path: string): Promise<ToolResult> {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}${path}`);
  if (!res.ok) return { success: false, error: `API error: ${res.status} ${res.statusText}`, duration_ms: 0 };
  const data = await res.json() as Record<string, unknown>;
  return { success: true, data, duration_ms: 0 };
}

async function apiPost(ctx: ToolExecutionContext, path: string, body: Record<string, unknown>, sideEffect: string): Promise<ToolResult> {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { success: false, error: `API error: ${res.status} ${res.statusText}`, duration_ms: 0 };
  const data = await res.json() as Record<string, unknown>;
  return { success: true, data, sideEffects: [sideEffect], duration_ms: 0 };
}

async function apiPatch(ctx: ToolExecutionContext, path: string, body: Record<string, unknown>, sideEffect: string): Promise<ToolResult> {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { success: false, error: `API error: ${res.status} ${res.statusText}`, duration_ms: 0 };
  const data = await res.json() as Record<string, unknown>;
  return { success: true, data, sideEffects: [sideEffect], duration_ms: 0 };
}

async function apiDelete(ctx: ToolExecutionContext, path: string, sideEffect: string): Promise<ToolResult> {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}${path}`, {
    method: "DELETE",
  });
  if (!res.ok) return { success: false, error: `API error: ${res.status} ${res.statusText}`, duration_ms: 0 };
  const data = await res.json() as Record<string, unknown>;
  return { success: true, data, sideEffects: [sideEffect], duration_ms: 0 };
}

// ──────────────────────────────────────────────────────────────
// schedule.listTasks
// ──────────────────────────────────────────────────────────────
export const listScheduleTasksTool = createScheduleTool({
  id: "schedule.listTasks",
  name: "List Schedule Tasks",
  description: "List all schedule tasks for the current project. Returns task names, dates, status, progress, assignees, and phase assignments.",
  inputSchema: z.object({}),
  mutates: false,
  tags: ["schedule", "tasks", "read"],
}, async (ctx) => {
  return apiGet(ctx, "/schedule-tasks");
});

// ──────────────────────────────────────────────────────────────
// schedule.createTask
// ──────────────────────────────────────────────────────────────
export const createScheduleTaskTool = createScheduleTool({
  id: "schedule.createTask",
  name: "Create Schedule Task",
  description: "Create a new task in the project schedule. Tasks can be assigned to phases, given start/end dates, assigned to team members, and tracked with progress percentage. Use taskType 'milestone' for key dates with no duration.",
  inputSchema: z.object({
    name: z.string().describe("Task name"),
    description: z.string().optional().describe("Task description"),
    phaseId: z.string().nullable().optional().describe("Phase ID to assign the task to (null for standalone)"),
    taskType: z.enum(["task", "milestone"]).optional().describe("Task type: 'task' (default) or 'milestone' for key dates"),
    status: z.enum(["not_started", "in_progress", "complete", "on_hold"]).optional().describe("Task status"),
    startDate: z.string().nullable().optional().describe("Start date (ISO date string, e.g. '2024-03-15')"),
    endDate: z.string().nullable().optional().describe("End date (ISO date string)"),
    duration: z.number().optional().describe("Duration in days"),
    progress: z.number().min(0).max(1).optional().describe("Progress from 0.0 to 1.0"),
    assignee: z.string().optional().describe("Person assigned to this task"),
    order: z.number().optional().describe("Sort order within its phase group"),
  }),
  tags: ["schedule", "tasks", "create", "write"],
}, async (ctx, input) => {
  return apiPost(ctx, "/schedule-tasks", input, `Created schedule task: ${input.name}`);
});

// ──────────────────────────────────────────────────────────────
// schedule.updateTask
// ──────────────────────────────────────────────────────────────
export const updateScheduleTaskTool = createScheduleTool({
  id: "schedule.updateTask",
  name: "Update Schedule Task",
  description: "Update an existing schedule task. Can change name, dates, status, progress, assignee, or phase assignment.",
  inputSchema: z.object({
    taskId: z.string().describe("ID of the task to update"),
    name: z.string().optional().describe("New task name"),
    description: z.string().optional().describe("New description"),
    phaseId: z.string().nullable().optional().describe("New phase assignment (null to unassign)"),
    taskType: z.enum(["task", "milestone"]).optional().describe("Change task type"),
    status: z.enum(["not_started", "in_progress", "complete", "on_hold"]).optional().describe("New status"),
    startDate: z.string().nullable().optional().describe("New start date"),
    endDate: z.string().nullable().optional().describe("New end date"),
    duration: z.number().optional().describe("New duration in days"),
    progress: z.number().min(0).max(1).optional().describe("New progress (0.0 to 1.0)"),
    assignee: z.string().optional().describe("New assignee"),
    order: z.number().optional().describe("New sort order"),
  }),
  tags: ["schedule", "tasks", "update", "write"],
}, async (ctx, input) => {
  const { taskId, ...body } = input;
  return apiPatch(ctx, `/schedule-tasks/${taskId}`, body, "Updated schedule task");
});

// ──────────────────────────────────────────────────────────────
// schedule.deleteTask
// ──────────────────────────────────────────────────────────────
export const deleteScheduleTaskTool = createScheduleTool({
  id: "schedule.deleteTask",
  name: "Delete Schedule Task",
  description: "Delete a schedule task. Also removes any dependencies connected to this task. Requires confirmation.",
  inputSchema: z.object({
    taskId: z.string().describe("ID of the task to delete"),
  }),
  requiresConfirmation: true,
  tags: ["schedule", "tasks", "delete", "write"],
}, async (ctx, input) => {
  return apiDelete(ctx, `/schedule-tasks/${input.taskId}`, "Deleted schedule task");
});

// ──────────────────────────────────────────────────────────────
// schedule.batchUpdateTasks
// ──────────────────────────────────────────────────────────────
export const batchUpdateScheduleTasksTool = createScheduleTool({
  id: "schedule.batchUpdateTasks",
  name: "Batch Update Schedule Tasks",
  description: "Update multiple schedule tasks at once. Useful for bulk status changes, reordering, or updating dates across multiple tasks.",
  inputSchema: z.object({
    updates: z.array(z.object({
      id: z.string().describe("Task ID"),
      name: z.string().optional(),
      status: z.enum(["not_started", "in_progress", "complete", "on_hold"]).optional(),
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
      duration: z.number().optional(),
      progress: z.number().min(0).max(1).optional(),
      assignee: z.string().optional(),
      order: z.number().optional(),
    })).describe("Array of task updates"),
  }),
  tags: ["schedule", "tasks", "batch", "update", "write"],
}, async (ctx, input) => {
  return apiPost(ctx, "/schedule-tasks/batch", input, `Batch updated ${(input.updates as unknown[]).length} schedule tasks`);
});

// ──────────────────────────────────────────────────────────────
// schedule.createDependency
// ──────────────────────────────────────────────────────────────
export const createDependencyTool = createScheduleTool({
  id: "schedule.createDependency",
  name: "Create Task Dependency",
  description: "Create a dependency between two schedule tasks. Dependency types: FS (finish-to-start, default), SS (start-to-start), FF (finish-to-finish), SF (start-to-finish). Optional lag in days.",
  inputSchema: z.object({
    predecessorId: z.string().describe("ID of the predecessor task (the task that must happen first for FS)"),
    successorId: z.string().describe("ID of the successor task (the task that depends on the predecessor)"),
    type: z.enum(["FS", "SS", "FF", "SF"]).optional().describe("Dependency type (default: FS = finish-to-start)"),
    lagDays: z.number().optional().describe("Lag in days (positive = delay, negative = overlap)"),
  }),
  tags: ["schedule", "dependency", "create", "write"],
}, async (ctx, input) => {
  return apiPost(ctx, "/schedule-dependencies", input, "Created task dependency");
});

// ──────────────────────────────────────────────────────────────
// schedule.deleteDependency
// ──────────────────────────────────────────────────────────────
export const deleteDependencyTool = createScheduleTool({
  id: "schedule.deleteDependency",
  name: "Delete Task Dependency",
  description: "Remove a dependency between two schedule tasks.",
  inputSchema: z.object({
    dependencyId: z.string().describe("ID of the dependency to delete"),
  }),
  tags: ["schedule", "dependency", "delete", "write"],
}, async (ctx, input) => {
  return apiDelete(ctx, `/schedule-dependencies/${input.dependencyId}`, "Deleted task dependency");
});

// ──────────────────────────────────────────────────────────────
// schedule.saveBaseline
// ──────────────────────────────────────────────────────────────
export const saveBaselineTool = createScheduleTool({
  id: "schedule.saveBaseline",
  name: "Save Schedule Baseline",
  description: "Snapshot the current schedule as a baseline for comparison. Saves each task's current start/end dates as baseline dates. Useful for tracking schedule variance.",
  inputSchema: z.object({}),
  tags: ["schedule", "baseline", "write"],
}, async (ctx) => {
  return apiPost(ctx, "/schedule/save-baseline", {}, "Saved schedule baseline");
});

// ──────────────────────────────────────────────────────────────
// schedule.clearBaseline
// ──────────────────────────────────────────────────────────────
export const clearBaselineTool = createScheduleTool({
  id: "schedule.clearBaseline",
  name: "Clear Schedule Baseline",
  description: "Remove the saved baseline from all schedule tasks.",
  inputSchema: z.object({}),
  requiresConfirmation: true,
  tags: ["schedule", "baseline", "delete", "write"],
}, async (ctx) => {
  return apiDelete(ctx, "/schedule/clear-baseline", "Cleared schedule baseline");
});

// ──────────────────────────────────────────────────────────────
// schedule.generateSchedule
// ──────────────────────────────────────────────────────────────
export const generateScheduleTool = createScheduleTool({
  id: "schedule.generateSchedule",
  name: "Generate Schedule from Phases",
  description: "Automatically create schedule tasks from the existing project phases. Creates one task per phase with dates distributed across the project timeline. Useful as a starting point for detailed scheduling.",
  inputSchema: z.object({
    includesMilestones: z.boolean().optional().describe("Whether to add milestone markers between phases (default: true)"),
  }),
  tags: ["schedule", "generate", "ai", "write"],
}, async (ctx, input) => {
  // Get workspace to access phases and dates
  const wsRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}/workspace`);
  if (!wsRes.ok) return { success: false, error: "Failed to fetch workspace", duration_ms: 0 };
  const wsData = await wsRes.json() as any;

  const workspace = wsData.workspace;
  const phases = workspace?.phases ?? [];
  const rev = workspace?.currentRevision;

  if (phases.length === 0) {
    return { success: false, error: "No phases defined. Add phases first before generating a schedule.", duration_ms: 0 };
  }

  const rawStart = rev?.dateWorkStart ? new Date(rev.dateWorkStart) : new Date();
  const rawEnd = rev?.dateWorkEnd ? new Date(rev.dateWorkEnd) : new Date(rawStart.getTime() + 90 * 86400000);
  const projectDuration = Math.max(7, Math.round((rawEnd.getTime() - rawStart.getTime()) / 86400000));
  const phaseDuration = Math.max(7, Math.floor(projectDuration / phases.length));

  const addMilestones = input.includesMilestones !== false;
  const tasksToCreate: Record<string, unknown>[] = [];

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i] as any;
    const phaseStart = new Date(rawStart.getTime() + i * phaseDuration * 86400000);
    const phaseEnd = new Date(phaseStart.getTime() + phaseDuration * 86400000);

    tasksToCreate.push({
      name: phase.name || `Phase ${i + 1}`,
      phaseId: phase.id,
      taskType: "task",
      startDate: phaseStart.toISOString().slice(0, 10),
      endDate: phaseEnd.toISOString().slice(0, 10),
      duration: phaseDuration,
      status: "not_started",
    });

    if (addMilestones && i < phases.length - 1) {
      tasksToCreate.push({
        name: `${phase.name || `Phase ${i + 1}`} Complete`,
        phaseId: phase.id,
        taskType: "milestone",
        startDate: phaseEnd.toISOString().slice(0, 10),
        endDate: phaseEnd.toISOString().slice(0, 10),
        duration: 0,
        status: "not_started",
      });
    }
  }

  // Create tasks one by one
  let createdCount = 0;
  for (const task of tasksToCreate) {
    const createRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}/schedule-tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(task),
    });
    if (createRes.ok) createdCount++;
  }

  return {
    success: true,
    data: { createdTasks: createdCount, totalPhases: phases.length },
    sideEffects: [`Generated ${createdCount} schedule tasks from ${phases.length} phases`],
    duration_ms: 0,
  };
});

// ──────────────────────────────────────────────────────────────
// Export all schedule tools
// ──────────────────────────────────────────────────────────────
export const scheduleTools: Tool[] = [
  listScheduleTasksTool,
  createScheduleTaskTool,
  updateScheduleTaskTool,
  deleteScheduleTaskTool,
  batchUpdateScheduleTasksTool,
  createDependencyTool,
  deleteDependencyTool,
  saveBaselineTool,
  clearBaselineTool,
  generateScheduleTool,
];
