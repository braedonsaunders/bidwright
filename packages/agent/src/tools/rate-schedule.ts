import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";

type RsOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<ToolResult>;

function createRsTool(def: {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodType;
  mutates?: boolean;
  tags: string[];
}, operation: RsOperation): Tool {
  return {
    definition: {
      id: def.id,
      name: def.name,
      category: "quote",
      description: def.description,
      parameters: [],
      inputSchema: def.inputSchema,
      requiresConfirmation: false,
      mutates: def.mutates ?? false,
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

async function apiFetch(ctx: ToolExecutionContext, path: string, opts?: RequestInit): Promise<ToolResult> {
  const headers = new Headers(opts?.headers);
  if (ctx.authToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${ctx.authToken}`);
  }
  const res = await fetch(`${ctx.apiBaseUrl}${path}`, { ...opts, headers });
  if (!res.ok) return { success: false, error: `API error: ${res.status} ${res.statusText}`, duration_ms: 0 };
  const data = await res.json() as Record<string, unknown>;
  return { success: true, data, duration_ms: 0 };
}

function jsonOpts(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// ── Tools ────────────────────────────────────────────────────────────────

const listTool = createRsTool({
  id: "rateSchedule.list",
  name: "List Rate Schedules",
  description: "List rate schedules. Use scope='global' for org master library, scope='revision' for the current project's imported schedules.",
  inputSchema: z.object({
    scope: z.enum(["global", "revision"]).optional().default("global").describe("Scope: 'global' for org masters, 'revision' for project schedules"),
  }),
  tags: ["rates", "read"],
}, async (ctx, input) => {
  if (input.scope === "revision") {
    return apiFetch(ctx, `/projects/${ctx.projectId}/rate-schedules`);
  }
  return apiFetch(ctx, `/api/rate-schedules?scope=${input.scope ?? "global"}`);
});

const getTool = createRsTool({
  id: "rateSchedule.get",
  name: "Get Rate Schedule",
  description: "Get a rate schedule with all its tiers and items.",
  inputSchema: z.object({
    scheduleId: z.string().describe("ID of the rate schedule"),
  }),
  tags: ["rates", "read"],
}, async (ctx, input) => {
  return apiFetch(ctx, `/api/rate-schedules/${input.scheduleId}`);
});

const createTool = createRsTool({
  id: "rateSchedule.create",
  name: "Create Rate Schedule",
  description: "Create a new master rate schedule in the org library.",
  inputSchema: z.object({
    name: z.string().describe("Schedule name"),
    description: z.string().optional().describe("Description"),
    category: z.enum(["labour", "equipment", "materials", "general"]).optional().describe("Category"),
    defaultMarkup: z.number().optional().describe("Default markup percentage"),
    autoCalculate: z.boolean().optional().describe("Auto-calculate derived tier rates from base rate"),
  }),
  mutates: true,
  tags: ["rates", "write"],
}, async (ctx, input) => {
  return apiFetch(ctx, "/api/rate-schedules", jsonOpts("POST", input));
});

const updateTool = createRsTool({
  id: "rateSchedule.update",
  name: "Update Rate Schedule",
  description: "Update a rate schedule's properties.",
  inputSchema: z.object({
    scheduleId: z.string().describe("ID of the rate schedule"),
    name: z.string().optional(),
    description: z.string().optional(),
    category: z.enum(["labour", "equipment", "materials", "general"]).optional(),
    defaultMarkup: z.number().optional(),
    autoCalculate: z.boolean().optional(),
  }),
  mutates: true,
  tags: ["rates", "write"],
}, async (ctx, input) => {
  const { scheduleId, ...patch } = input;
  return apiFetch(ctx, `/api/rate-schedules/${scheduleId}`, jsonOpts("PATCH", patch));
});

const deleteTool = createRsTool({
  id: "rateSchedule.delete",
  name: "Delete Rate Schedule",
  description: "Delete a rate schedule.",
  inputSchema: z.object({
    scheduleId: z.string().describe("ID of the rate schedule to delete"),
  }),
  mutates: true,
  tags: ["rates", "write"],
}, async (ctx, input) => {
  return apiFetch(ctx, `/api/rate-schedules/${input.scheduleId}`, { method: "DELETE" });
});

const addTierTool = createRsTool({
  id: "rateSchedule.addTier",
  name: "Add Rate Tier",
  description: "Add a new tier (e.g., Regular, Overtime, Double Time) to a rate schedule.",
  inputSchema: z.object({
    scheduleId: z.string().describe("Rate schedule ID"),
    name: z.string().describe("Tier name (e.g., 'Regular', 'Overtime', 'Double Time')"),
    multiplier: z.number().optional().describe("Rate multiplier (e.g., 1.0, 1.5, 2.0)"),
    sortOrder: z.number().optional().describe("Display order"),
  }),
  mutates: true,
  tags: ["rates", "write"],
}, async (ctx, input) => {
  const { scheduleId, ...body } = input;
  return apiFetch(ctx, `/api/rate-schedules/${scheduleId}/tiers`, jsonOpts("POST", body));
});

const updateTierTool = createRsTool({
  id: "rateSchedule.updateTier",
  name: "Update Rate Tier",
  description: "Update a tier's name, multiplier, or sort order.",
  inputSchema: z.object({
    scheduleId: z.string().describe("Rate schedule ID"),
    tierId: z.string().describe("Tier ID"),
    name: z.string().optional(),
    multiplier: z.number().optional(),
    sortOrder: z.number().optional(),
  }),
  mutates: true,
  tags: ["rates", "write"],
}, async (ctx, input) => {
  const { scheduleId, tierId, ...patch } = input;
  return apiFetch(ctx, `/api/rate-schedules/${scheduleId}/tiers/${tierId}`, jsonOpts("PATCH", patch));
});

const removeTierTool = createRsTool({
  id: "rateSchedule.removeTier",
  name: "Remove Rate Tier",
  description: "Remove a tier from a rate schedule.",
  inputSchema: z.object({
    scheduleId: z.string().describe("Rate schedule ID"),
    tierId: z.string().describe("Tier ID to remove"),
  }),
  mutates: true,
  tags: ["rates", "write"],
}, async (ctx, input) => {
  return apiFetch(ctx, `/api/rate-schedules/${input.scheduleId}/tiers/${input.tierId}`, { method: "DELETE" });
});

const addItemTool = createRsTool({
  id: "rateSchedule.addItem",
  name: "Add Rate Item",
  description: "Add a new item to a rate schedule with rates per tier.",
  inputSchema: z.object({
    scheduleId: z.string().describe("Rate schedule ID"),
    name: z.string().describe("Item name"),
    code: z.string().optional().describe("Short code"),
    unit: z.string().optional().describe("Unit of measure (e.g., 'HR', 'DAY')"),
    rates: z.record(z.number()).optional().describe("Rates per tier: { tierId: rate }"),
    costRates: z.record(z.number()).optional().describe("Cost rates per tier: { tierId: costRate }"),
    burden: z.number().optional().describe("Per-hour burden cost"),
    perDiem: z.number().optional().describe("Per-day per diem cost"),
    catalogItemId: z.string().optional().describe("Link to catalog item"),
  }),
  mutates: true,
  tags: ["rates", "write"],
}, async (ctx, input) => {
  const { scheduleId, ...body } = input;
  return apiFetch(ctx, `/api/rate-schedules/${scheduleId}/items`, jsonOpts("POST", body));
});

const updateItemTool = createRsTool({
  id: "rateSchedule.updateItem",
  name: "Update Rate Item",
  description: "Update a rate schedule item's rates, costs, or properties.",
  inputSchema: z.object({
    scheduleId: z.string().describe("Rate schedule ID"),
    itemId: z.string().describe("Item ID"),
    name: z.string().optional(),
    code: z.string().optional(),
    unit: z.string().optional(),
    rates: z.record(z.number()).optional().describe("Updated rates per tier"),
    costRates: z.record(z.number()).optional().describe("Updated cost rates per tier"),
    burden: z.number().optional(),
    perDiem: z.number().optional(),
  }),
  mutates: true,
  tags: ["rates", "write"],
}, async (ctx, input) => {
  const { scheduleId, itemId, ...patch } = input;
  return apiFetch(ctx, `/api/rate-schedules/${scheduleId}/items/${itemId}`, jsonOpts("PATCH", patch));
});

const removeItemTool = createRsTool({
  id: "rateSchedule.removeItem",
  name: "Remove Rate Item",
  description: "Remove an item from a rate schedule.",
  inputSchema: z.object({
    scheduleId: z.string().describe("Rate schedule ID"),
    itemId: z.string().describe("Item ID to remove"),
  }),
  mutates: true,
  tags: ["rates", "write"],
}, async (ctx, input) => {
  return apiFetch(ctx, `/api/rate-schedules/${input.scheduleId}/items/${input.itemId}`, { method: "DELETE" });
});

const importTool = createRsTool({
  id: "rateSchedule.import",
  name: "Import Rate Schedule",
  description: "Import a master rate schedule from the org library into the current project's revision as an editable snapshot.",
  inputSchema: z.object({
    scheduleId: z.string().describe("Master rate schedule ID to import"),
  }),
  mutates: true,
  tags: ["rates", "write"],
}, async (ctx, input) => {
  return apiFetch(ctx, `/projects/${ctx.projectId}/rate-schedules/import`, jsonOpts("POST", { scheduleId: input.scheduleId }));
});

const autoCalcTool = createRsTool({
  id: "rateSchedule.autoCalculate",
  name: "Auto-Calculate Rate Schedule",
  description: "Auto-calculate derived tier rates from the base (first tier) rate using each tier's multiplier. E.g., if Regular=$50 and OT multiplier=1.5, OT becomes $75.",
  inputSchema: z.object({
    scheduleId: z.string().describe("Rate schedule ID"),
  }),
  mutates: true,
  tags: ["rates", "write"],
}, async (ctx, input) => {
  return apiFetch(ctx, `/api/rate-schedules/${input.scheduleId}/auto-calculate`, { method: "POST" });
});

const applyToLineItemTool = createRsTool({
  id: "rateSchedule.applyToLineItem",
  name: "Apply Rate to Line Item",
  description: "Assign a rate schedule item to a worksheet line item, linking it for rate-schedule-driven pricing. Optionally set tier hours.",
  inputSchema: z.object({
    worksheetItemId: z.string().describe("Worksheet item ID"),
    rateScheduleItemId: z.string().describe("Rate schedule item ID to link"),
    tierUnits: z.record(z.number()).optional().describe("Hours per tier: { tierId: hours }"),
  }),
  mutates: true,
  tags: ["rates", "write"],
}, async (ctx, input) => {
  const body: Record<string, unknown> = { rateScheduleItemId: input.rateScheduleItemId };
  if (input.tierUnits) body.tierUnits = input.tierUnits;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ctx.authToken) headers["Authorization"] = `Bearer ${ctx.authToken}`;
  const res = await fetch(`${ctx.apiBaseUrl}/projects/${ctx.projectId}/worksheet-items/${input.worksheetItemId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) return { success: false, error: `API error: ${res.status}`, duration_ms: 0 };
  const data = await res.json() as Record<string, unknown>;
  return { success: true, data, sideEffects: ["worksheet_item_updated"], duration_ms: 0 };
});

export const rateScheduleTools: Tool[] = [
  listTool,
  getTool,
  createTool,
  updateTool,
  deleteTool,
  addTierTool,
  updateTierTool,
  removeTierTool,
  addItemTool,
  updateItemTool,
  removeItemTool,
  importTool,
  autoCalcTool,
  applyToLineItemTool,
];
