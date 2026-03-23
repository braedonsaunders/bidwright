import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";
import { apiFetch } from "./api-fetch.js";

type StoreOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<ToolResult>;

function createQuoteTool(def: {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodType;
  requiresConfirmation?: boolean;
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
      mutates: true,
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

// Helper for making API requests
// Note: duration_ms is set to 0 here; the createQuoteTool wrapper overwrites it with the actual elapsed time.
function authHeaders(ctx: ToolExecutionContext): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (ctx.authToken) h["Authorization"] = `Bearer ${ctx.authToken}`;
  return h;
}

async function apiGet(ctx: ToolExecutionContext, path: string): Promise<ToolResult> {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}${path}`, { headers: authHeaders(ctx) });
  if (!res.ok) return { success: false, error: `API error: ${res.status} ${res.statusText}`, duration_ms: 0 };
  const data = await res.json() as Record<string, unknown>;
  return { success: true, data, duration_ms: 0 };
}

async function apiPost(ctx: ToolExecutionContext, path: string, body: Record<string, unknown>, sideEffect: string): Promise<ToolResult> {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}${path}`, {
    method: "POST",
    headers: authHeaders(ctx),
    body: JSON.stringify(body),
  });
  if (!res.ok) return { success: false, error: `API error: ${res.status} ${res.statusText}`, duration_ms: 0 };
  const data = await res.json() as Record<string, unknown>;
  return { success: true, data, sideEffects: [sideEffect], duration_ms: 0 };
}

async function apiPatch(ctx: ToolExecutionContext, path: string, body: Record<string, unknown>, sideEffect: string): Promise<ToolResult> {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}${path}`, {
    method: "PATCH",
    headers: authHeaders(ctx),
    body: JSON.stringify(body),
  });
  if (!res.ok) return { success: false, error: `API error: ${res.status} ${res.statusText}`, duration_ms: 0 };
  const data = await res.json() as Record<string, unknown>;
  return { success: true, data, sideEffects: [sideEffect], duration_ms: 0 };
}

async function apiDelete(ctx: ToolExecutionContext, path: string, sideEffect: string): Promise<ToolResult> {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}${path}`, {
    method: "DELETE",
    headers: authHeaders(ctx),
  });
  if (!res.ok) return { success: false, error: `API error: ${res.status} ${res.statusText}`, duration_ms: 0 };
  const data = await res.json() as Record<string, unknown>;
  return { success: true, data, sideEffects: [sideEffect], duration_ms: 0 };
}

// ──────────────────────────────────────────────────────────────
// 1. quote.getWorkspace
// ──────────────────────────────────────────────────────────────
export const getWorkspaceTool = createQuoteTool({
  id: "quote.getWorkspace",
  name: "Get Project Workspace",
  description: "Get the complete current workspace including revision, worksheets, phases, modifiers, conditions, and financial totals.",
  inputSchema: z.object({}),
  tags: ["workspace", "read"],
}, async (ctx) => {
  return apiGet(ctx, "/workspace");
});

// ──────────────────────────────────────────────────────────────
// 2. quote.listWorksheets
// ──────────────────────────────────────────────────────────────
export const listWorksheetsTool = createQuoteTool({
  id: "quote.listWorksheets",
  name: "List Worksheets",
  description: "List all worksheets in the current revision with their names, item counts, and subtotals.",
  inputSchema: z.object({}),
  tags: ["worksheet", "read"],
}, async (ctx) => {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}/workspace`);
  if (!res.ok) return { success: false, error: `API error: ${res.status} ${res.statusText}`, duration_ms: 0 };
  const data = await res.json() as { worksheets?: unknown[] };
  return { success: true, data: data.worksheets ?? [], duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 3. quote.searchItems
// ──────────────────────────────────────────────────────────────
export const searchItemsTool = createQuoteTool({
  id: "quote.searchItems",
  name: "Search Line Items",
  description: "Search line items across all worksheets by keyword, category, or price range. Returns matching items with their worksheet context.",
  inputSchema: z.object({
    query: z.string().optional().describe("Text search across entity name, description, and category"),
    category: z.string().optional().describe("Filter by category (e.g. 'Material', 'Labour', 'Equipment')"),
    worksheetId: z.string().optional().describe("Limit search to a specific worksheet"),
    minCost: z.number().optional().describe("Minimum cost filter"),
    maxCost: z.number().optional().describe("Maximum cost filter"),
    limit: z.number().optional().default(50).describe("Maximum number of results to return"),
  }),
  tags: ["item", "search", "read"],
}, async (ctx, input) => {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}/workspace`);
  if (!res.ok) return { success: false, error: `API error: ${res.status} ${res.statusText}`, duration_ms: 0 };
  const workspace = await res.json() as { worksheets?: any[] };

  const worksheets: any[] = workspace.worksheets ?? [];
  let items: any[] = [];

  for (const ws of worksheets) {
    if (input.worksheetId && ws.id !== input.worksheetId) continue;
    for (const item of (ws.items ?? [])) {
      items.push({ ...item, worksheetId: ws.id, worksheetName: ws.name });
    }
  }

  // Apply filters
  if (input.query) {
    const q = (input.query as string).toLowerCase();
    items = items.filter((item: any) =>
      (item.entityName?.toLowerCase()?.includes(q)) ||
      (item.description?.toLowerCase()?.includes(q)) ||
      (item.category?.toLowerCase()?.includes(q))
    );
  }
  if (input.category) {
    const cat = (input.category as string).toLowerCase();
    items = items.filter((item: any) => item.category?.toLowerCase() === cat);
  }
  if (input.minCost != null) {
    items = items.filter((item: any) => (item.cost ?? 0) >= (input.minCost as number));
  }
  if (input.maxCost != null) {
    items = items.filter((item: any) => (item.cost ?? 0) <= (input.maxCost as number));
  }

  const limit = (input.limit as number) ?? 50;
  items = items.slice(0, limit);

  return { success: true, data: { items, totalMatches: items.length }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 4. quote.createWorksheetItem
// ──────────────────────────────────────────────────────────────
export const createWorksheetItemTool = createQuoteTool({
  id: "quote.createWorksheetItem",
  name: "Create Line Item",
  description: "Create a new line item in a worksheet. Requires worksheetId and at minimum an entityName. Costs and quantities default to 0.",
  inputSchema: z.object({
    worksheetId: z.string().describe("ID of the worksheet to add the item to"),
    category: z.string().optional().describe("Item category (e.g. 'Material', 'Labour', 'Equipment', 'Subcontractor')"),
    entityName: z.string().describe("Name of the line item"),
    description: z.string().optional().describe("Detailed description of the line item"),
    quantity: z.number().optional().default(1).describe("Quantity of the item"),
    uom: z.string().optional().default("EA").describe("Unit of measure (e.g. 'EA', 'LF', 'SF', 'HR', 'LS')"),
    cost: z.number().optional().default(0).describe("Unit cost"),
    markup: z.number().optional().default(0).describe("Markup percentage (e.g. 15 for 15%)"),
    price: z.number().optional().describe("Override unit price (if not calculated from cost+markup)"),
    laborHourReg: z.number().optional().default(0).describe("Regular labor hours per unit"),
    laborHourOver: z.number().optional().default(0).describe("Overtime labor hours per unit"),
    laborHourDouble: z.number().optional().default(0).describe("Double-time labor hours per unit"),
    phaseId: z.string().optional().describe("Phase ID to associate this item with"),
    sortOrder: z.number().optional().describe("Sort order within the worksheet"),
  }),
  tags: ["item", "create", "write"],
}, async (ctx, input) => {
  const { worksheetId, ...body } = input;
  return apiPost(ctx, `/worksheets/${worksheetId}/items`, body, "Created line item");
});

// ──────────────────────────────────────────────────────────────
// 5. quote.updateWorksheetItem
// ──────────────────────────────────────────────────────────────
export const updateWorksheetItemTool = createQuoteTool({
  id: "quote.updateWorksheetItem",
  name: "Update Line Item",
  description: "Update an existing line item. Only fields provided will be changed.",
  inputSchema: z.object({
    itemId: z.string().describe("ID of the line item to update"),
    category: z.string().optional().describe("Item category"),
    entityName: z.string().optional().describe("Name of the line item"),
    description: z.string().optional().describe("Detailed description"),
    quantity: z.number().optional().describe("Quantity"),
    uom: z.string().optional().describe("Unit of measure"),
    cost: z.number().optional().describe("Unit cost"),
    markup: z.number().optional().describe("Markup percentage"),
    price: z.number().optional().describe("Override unit price"),
    laborHourReg: z.number().optional().describe("Regular labor hours per unit"),
    laborHourOver: z.number().optional().describe("Overtime labor hours per unit"),
    laborHourDouble: z.number().optional().describe("Double-time labor hours per unit"),
    phaseId: z.string().optional().describe("Phase ID"),
    sortOrder: z.number().optional().describe("Sort order"),
  }),
  tags: ["item", "update", "write"],
}, async (ctx, input) => {
  const { itemId, ...body } = input;
  return apiPatch(ctx, `/items/${itemId}`, body, "Updated line item");
});

// ──────────────────────────────────────────────────────────────
// 6. quote.deleteWorksheetItem
// ──────────────────────────────────────────────────────────────
export const deleteWorksheetItemTool = createQuoteTool({
  id: "quote.deleteWorksheetItem",
  name: "Delete Line Item",
  description: "Delete a line item from a worksheet. This action requires confirmation.",
  inputSchema: z.object({
    itemId: z.string().describe("ID of the line item to delete"),
  }),
  requiresConfirmation: true,
  tags: ["item", "delete", "write"],
}, async (ctx, input) => {
  return apiDelete(ctx, `/items/${input.itemId}`, "Deleted line item");
});

// ──────────────────────────────────────────────────────────────
// 7. quote.createWorksheet
// ──────────────────────────────────────────────────────────────
export const createWorksheetTool = createQuoteTool({
  id: "quote.createWorksheet",
  name: "Create Worksheet",
  description: "Create a new worksheet in the current revision.",
  inputSchema: z.object({
    name: z.string().describe("Name of the worksheet"),
    description: z.string().optional().describe("Description of the worksheet"),
    sortOrder: z.number().optional().describe("Sort order among worksheets"),
  }),
  tags: ["worksheet", "create", "write"],
}, async (ctx, input) => {
  return apiPost(ctx, "/worksheets", input, "Created worksheet");
});

// ──────────────────────────────────────────────────────────────
// 8. quote.updateWorksheet
// ──────────────────────────────────────────────────────────────
export const updateWorksheetTool = createQuoteTool({
  id: "quote.updateWorksheet",
  name: "Update Worksheet",
  description: "Update worksheet properties such as name or description.",
  inputSchema: z.object({
    worksheetId: z.string().describe("ID of the worksheet to update"),
    name: z.string().optional().describe("New name for the worksheet"),
    description: z.string().optional().describe("New description"),
    sortOrder: z.number().optional().describe("New sort order"),
  }),
  tags: ["worksheet", "update", "write"],
}, async (ctx, input) => {
  const { worksheetId, ...body } = input;
  return apiPatch(ctx, `/worksheets/${worksheetId}`, body, "Updated worksheet");
});

// ──────────────────────────────────────────────────────────────
// 9. quote.deleteWorksheet
// ──────────────────────────────────────────────────────────────
export const deleteWorksheetTool = createQuoteTool({
  id: "quote.deleteWorksheet",
  name: "Delete Worksheet",
  description: "Delete a worksheet and all its line items. This action requires confirmation.",
  inputSchema: z.object({
    worksheetId: z.string().describe("ID of the worksheet to delete"),
  }),
  requiresConfirmation: true,
  tags: ["worksheet", "delete", "write"],
}, async (ctx, input) => {
  return apiDelete(ctx, `/worksheets/${input.worksheetId}`, "Deleted worksheet");
});

// ──────────────────────────────────────────────────────────────
// 10. quote.createPhase
// ──────────────────────────────────────────────────────────────
export const createPhaseTool = createQuoteTool({
  id: "quote.createPhase",
  name: "Create Phase",
  description: "Create a new phase for organizing line items (e.g. 'Demolition', 'Rough-In', 'Finish').",
  inputSchema: z.object({
    name: z.string().describe("Phase name"),
    description: z.string().optional().describe("Phase description"),
    sortOrder: z.number().optional().describe("Sort order among phases"),
    code: z.string().optional().describe("Phase code (e.g. '01', '02')"),
  }),
  tags: ["phase", "create", "write"],
}, async (ctx, input) => {
  return apiPost(ctx, `/revisions/${ctx.revisionId}/phases`, input, "Created phase");
});

// ──────────────────────────────────────────────────────────────
// 11. quote.updatePhase
// ──────────────────────────────────────────────────────────────
export const updatePhaseTool = createQuoteTool({
  id: "quote.updatePhase",
  name: "Update Phase",
  description: "Update phase properties.",
  inputSchema: z.object({
    phaseId: z.string().describe("ID of the phase to update"),
    name: z.string().optional().describe("New phase name"),
    description: z.string().optional().describe("New description"),
    sortOrder: z.number().optional().describe("New sort order"),
    code: z.string().optional().describe("New phase code"),
  }),
  tags: ["phase", "update", "write"],
}, async (ctx, input) => {
  const { phaseId, ...body } = input;
  return apiPatch(ctx, `/phases/${phaseId}`, body, "Updated phase");
});

// ──────────────────────────────────────────────────────────────
// 12. quote.deletePhase
// ──────────────────────────────────────────────────────────────
export const deletePhaseTool = createQuoteTool({
  id: "quote.deletePhase",
  name: "Delete Phase",
  description: "Delete a phase. Items assigned to this phase will become unphased. Requires confirmation.",
  inputSchema: z.object({
    phaseId: z.string().describe("ID of the phase to delete"),
  }),
  requiresConfirmation: true,
  tags: ["phase", "delete", "write"],
}, async (ctx, input) => {
  return apiDelete(ctx, `/phases/${input.phaseId}`, "Deleted phase");
});

// ──────────────────────────────────────────────────────────────
// 13. quote.createModifier
// ──────────────────────────────────────────────────────────────
export const createModifierTool = createQuoteTool({
  id: "quote.createModifier",
  name: "Create Modifier",
  description: "Create a modifier that applies percentage or fixed-amount adjustments to the quote (e.g. overhead, profit, discount).",
  inputSchema: z.object({
    name: z.string().describe("Modifier name (e.g. 'Overhead', 'Profit', 'Discount')"),
    type: z.enum(["percentage", "fixed"]).describe("Whether this is a percentage or fixed amount modifier"),
    appliesTo: z.enum(["material", "labour", "equipment", "subcontractor", "all"]).default("all").describe("What cost categories this modifier applies to"),
    percentage: z.number().optional().describe("Percentage value (e.g. 10 for 10%). Required if type is 'percentage'"),
    amount: z.number().optional().describe("Fixed amount. Required if type is 'fixed'"),
    show: z.boolean().optional().default(true).describe("Whether to show this modifier on reports"),
    sortOrder: z.number().optional().describe("Sort order among modifiers"),
  }),
  tags: ["modifier", "create", "write"],
}, async (ctx, input) => {
  return apiPost(ctx, `/revisions/${ctx.revisionId}/modifiers`, input, "Created modifier");
});

// ──────────────────────────────────────────────────────────────
// 14. quote.updateModifier
// ──────────────────────────────────────────────────────────────
export const updateModifierTool = createQuoteTool({
  id: "quote.updateModifier",
  name: "Update Modifier",
  description: "Update an existing modifier's properties.",
  inputSchema: z.object({
    modifierId: z.string().describe("ID of the modifier to update"),
    name: z.string().optional().describe("New name"),
    type: z.enum(["percentage", "fixed"]).optional().describe("New type"),
    appliesTo: z.enum(["material", "labour", "equipment", "subcontractor", "all"]).optional().describe("New applies-to scope"),
    percentage: z.number().optional().describe("New percentage value"),
    amount: z.number().optional().describe("New fixed amount"),
    show: z.boolean().optional().describe("Whether to show on reports"),
    sortOrder: z.number().optional().describe("New sort order"),
  }),
  tags: ["modifier", "update", "write"],
}, async (ctx, input) => {
  const { modifierId, ...body } = input;
  return apiPatch(ctx, `/modifiers/${modifierId}`, body, "Updated modifier");
});

// ──────────────────────────────────────────────────────────────
// 15. quote.deleteModifier
// ──────────────────────────────────────────────────────────────
export const deleteModifierTool = createQuoteTool({
  id: "quote.deleteModifier",
  name: "Delete Modifier",
  description: "Delete a modifier from the revision. Requires confirmation.",
  inputSchema: z.object({
    modifierId: z.string().describe("ID of the modifier to delete"),
  }),
  requiresConfirmation: true,
  tags: ["modifier", "delete", "write"],
}, async (ctx, input) => {
  return apiDelete(ctx, `/modifiers/${input.modifierId}`, "Deleted modifier");
});

// ──────────────────────────────────────────────────────────────
// 16. quote.createCondition
// ──────────────────────────────────────────────────────────────
export const createConditionTool = createQuoteTool({
  id: "quote.createCondition",
  name: "Create Condition",
  description: "Create a quote condition or exclusion (e.g. 'Payment net 30', 'Excludes permit fees').",
  inputSchema: z.object({
    type: z.enum(["inclusion", "exclusion", "clarification", "assumption", "term"]).describe("Type of condition"),
    text: z.string().describe("Condition text"),
    sortOrder: z.number().optional().describe("Sort order among conditions"),
  }),
  tags: ["condition", "create", "write"],
}, async (ctx, input) => {
  return apiPost(ctx, `/revisions/${ctx.revisionId}/conditions`, input, "Created condition");
});

// ──────────────────────────────────────────────────────────────
// 17. quote.updateCondition
// ──────────────────────────────────────────────────────────────
export const updateConditionTool = createQuoteTool({
  id: "quote.updateCondition",
  name: "Update Condition",
  description: "Update an existing condition.",
  inputSchema: z.object({
    conditionId: z.string().describe("ID of the condition to update"),
    type: z.enum(["inclusion", "exclusion", "clarification", "assumption", "term"]).optional().describe("New type"),
    text: z.string().optional().describe("New condition text"),
    sortOrder: z.number().optional().describe("New sort order"),
  }),
  tags: ["condition", "update", "write"],
}, async (ctx, input) => {
  const { conditionId, ...body } = input;
  return apiPatch(ctx, `/conditions/${conditionId}`, body, "Updated condition");
});

// ──────────────────────────────────────────────────────────────
// 18. quote.deleteCondition
// ──────────────────────────────────────────────────────────────
export const deleteConditionTool = createQuoteTool({
  id: "quote.deleteCondition",
  name: "Delete Condition",
  description: "Delete a condition from the revision. Requires confirmation.",
  inputSchema: z.object({
    conditionId: z.string().describe("ID of the condition to delete"),
  }),
  requiresConfirmation: true,
  tags: ["condition", "delete", "write"],
}, async (ctx, input) => {
  return apiDelete(ctx, `/conditions/${input.conditionId}`, "Deleted condition");
});

// ──────────────────────────────────────────────────────────────
// 19. quote.createALI
// ──────────────────────────────────────────────────────────────
export const createALITool = createQuoteTool({
  id: "quote.createALI",
  name: "Create Additional Line Item",
  description: "Create an additional line item (ALI) that appears outside the main worksheets, such as bonds, permits, or allowances.",
  inputSchema: z.object({
    name: z.string().describe("ALI name"),
    description: z.string().optional().describe("ALI description"),
    type: z.enum(["bond", "permit", "allowance", "fee", "tax", "other"]).default("other").describe("Type of additional line item"),
    amount: z.number().describe("Amount for this ALI"),
    isPercentage: z.boolean().optional().default(false).describe("If true, amount is treated as a percentage of the quote total"),
    show: z.boolean().optional().default(true).describe("Whether to show on reports"),
    sortOrder: z.number().optional().describe("Sort order among ALIs"),
  }),
  tags: ["ali", "create", "write"],
}, async (ctx, input) => {
  return apiPost(ctx, `/revisions/${ctx.revisionId}/ali`, input, "Created ALI");
});

// ──────────────────────────────────────────────────────────────
// 20. quote.updateALI
// ──────────────────────────────────────────────────────────────
export const updateALITool = createQuoteTool({
  id: "quote.updateALI",
  name: "Update Additional Line Item",
  description: "Update an existing additional line item.",
  inputSchema: z.object({
    aliId: z.string().describe("ID of the ALI to update"),
    name: z.string().optional().describe("New name"),
    description: z.string().optional().describe("New description"),
    type: z.enum(["bond", "permit", "allowance", "fee", "tax", "other"]).optional().describe("New type"),
    amount: z.number().optional().describe("New amount"),
    isPercentage: z.boolean().optional().describe("Whether amount is a percentage"),
    show: z.boolean().optional().describe("Whether to show on reports"),
    sortOrder: z.number().optional().describe("New sort order"),
  }),
  tags: ["ali", "update", "write"],
}, async (ctx, input) => {
  const { aliId, ...body } = input;
  return apiPatch(ctx, `/ali/${aliId}`, body, "Updated ALI");
});

// ──────────────────────────────────────────────────────────────
// 21. quote.deleteALI
// ──────────────────────────────────────────────────────────────
export const deleteALITool = createQuoteTool({
  id: "quote.deleteALI",
  name: "Delete Additional Line Item",
  description: "Delete an additional line item. Requires confirmation.",
  inputSchema: z.object({
    aliId: z.string().describe("ID of the ALI to delete"),
  }),
  requiresConfirmation: true,
  tags: ["ali", "delete", "write"],
}, async (ctx, input) => {
  return apiDelete(ctx, `/ali/${input.aliId}`, "Deleted ALI");
});

// ──────────────────────────────────────────────────────────────
// 22. quote.updateRevision
// ──────────────────────────────────────────────────────────────
export const updateRevisionTool = createQuoteTool({
  id: "quote.updateRevision",
  name: "Update Revision",
  description: "Update revision-level fields such as name, notes, or status.",
  inputSchema: z.object({
    name: z.string().optional().describe("Revision name"),
    notes: z.string().optional().describe("Revision notes"),
    status: z.enum(["draft", "review", "approved", "sent", "declined", "accepted"]).optional().describe("Revision status"),
    validUntil: z.string().optional().describe("Expiry date for the quote (ISO 8601)"),
  }),
  tags: ["revision", "update", "write"],
}, async (ctx, input) => {
  return apiPatch(ctx, `/revisions/${ctx.revisionId}`, input, "Updated revision");
});

// ──────────────────────────────────────────────────────────────
// 26. quote.createRevision
// ──────────────────────────────────────────────────────────────
export const createRevisionTool = createQuoteTool({
  id: "quote.createRevision",
  name: "Create New Revision",
  description: "Create a new revision by copying the current revision. This creates a full snapshot. Requires confirmation.",
  inputSchema: z.object({
    name: z.string().optional().describe("Name for the new revision (defaults to incrementing the revision number)"),
    notes: z.string().optional().describe("Notes for why a new revision was created"),
  }),
  requiresConfirmation: true,
  tags: ["revision", "create", "write"],
}, async (ctx, input) => {
  return apiPost(ctx, `/quotes/${ctx.quoteId}/revisions`, input, "Created new revision");
});

// ──────────────────────────────────────────────────────────────
// 27. quote.deleteRevision
// ──────────────────────────────────────────────────────────────
export const deleteRevisionTool = createQuoteTool({
  id: "quote.deleteRevision",
  name: "Delete Revision",
  description: "Delete a revision and all its data. Cannot delete the only revision. Requires confirmation.",
  inputSchema: z.object({
    revisionId: z.string().describe("ID of the revision to delete"),
  }),
  requiresConfirmation: true,
  tags: ["revision", "delete", "write"],
}, async (ctx, input) => {
  return apiDelete(ctx, `/revisions/${input.revisionId}`, "Deleted revision");
});

// ──────────────────────────────────────────────────────────────
// 28. quote.copyQuote
// ──────────────────────────────────────────────────────────────
export const copyQuoteTool = createQuoteTool({
  id: "quote.copyQuote",
  name: "Copy Entire Quote",
  description: "Create a full copy of the current quote as a new project. Copies all revisions, worksheets, items, and settings. Requires confirmation.",
  inputSchema: z.object({
    newProjectName: z.string().describe("Name for the new project copy"),
    includeDocuments: z.boolean().optional().default(false).describe("Whether to also copy associated source documents"),
  }),
  requiresConfirmation: true,
  tags: ["quote", "copy", "write"],
}, async (ctx, input) => {
  // First get the workspace data to copy
  const wsRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}/workspace`);
  if (!wsRes.ok) return { success: false, error: `Failed to fetch workspace: ${wsRes.status} ${wsRes.statusText}`, duration_ms: 0 };
  const workspace = await wsRes.json();

  // Create a new project with the workspace data
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.newProjectName,
      sourceProjectId: ctx.projectId,
      includeDocuments: input.includeDocuments ?? false,
      workspace,
    }),
  });
  if (!res.ok) return { success: false, error: `API error: ${res.status} ${res.statusText}`, duration_ms: 0 };
  const data = await res.json();
  return { success: true, data, sideEffects: ["Copied quote to new project"], duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// 29. quote.updateQuote
// ──────────────────────────────────────────────────────────────
export const updateQuoteTool = createQuoteTool({
  id: "quote.updateQuote",
  name: "Update Quote",
  description: "Update quote-level fields such as project name, client info, or settings.",
  inputSchema: z.object({
    projectName: z.string().optional().describe("Project name"),
    clientName: z.string().optional().describe("Client/customer name"),
    clientEmail: z.string().optional().describe("Client email"),
    clientPhone: z.string().optional().describe("Client phone number"),
    clientAddress: z.string().optional().describe("Client address"),
    projectAddress: z.string().optional().describe("Project/job site address"),
    bidDate: z.string().optional().describe("Bid date (ISO 8601)"),
    notes: z.string().optional().describe("General project notes"),
  }),
  tags: ["quote", "update", "write"],
}, async (ctx, input) => {
  return apiPatch(ctx, "/quote", input, "Updated quote");
});

// ──────────────────────────────────────────────────────────────
// 30. quote.recalculateTotals
// ──────────────────────────────────────────────────────────────
export const recalculateTotalsTool = createQuoteTool({
  id: "quote.recalculateTotals",
  name: "Recalculate Financial Totals",
  description: "Force a recalculation of all financial totals including worksheet subtotals, modifiers, ALIs, and grand total.",
  inputSchema: z.object({}),
  tags: ["totals", "calculate", "write"],
}, async (ctx) => {
  return apiPost(ctx, "/recalculate", {}, "Recalculated totals");
});

// ──────────────────────────────────────────────────────────────
// 31. quote.createReportSection
// ──────────────────────────────────────────────────────────────
export const createReportSectionTool = createQuoteTool({
  id: "quote.createReportSection",
  name: "Create Report Section",
  description: "Create a new section in the quote report/proposal (e.g. cover letter, scope of work, schedule).",
  inputSchema: z.object({
    title: z.string().describe("Section title"),
    content: z.string().describe("Section content (supports markdown)"),
    type: z.enum(["cover_letter", "scope", "schedule", "terms", "appendix", "custom"]).default("custom").describe("Section type"),
    sortOrder: z.number().optional().describe("Sort order among report sections"),
  }),
  tags: ["report", "section", "create", "write"],
}, async (ctx, input) => {
  return apiPost(ctx, `/revisions/${ctx.revisionId}/report-sections`, input, "Created report section");
});

// ──────────────────────────────────────────────────────────────
// 32. quote.updateReportSection
// ──────────────────────────────────────────────────────────────
export const updateReportSectionTool = createQuoteTool({
  id: "quote.updateReportSection",
  name: "Update Report Section",
  description: "Update an existing report section.",
  inputSchema: z.object({
    sectionId: z.string().describe("ID of the report section to update"),
    title: z.string().optional().describe("New title"),
    content: z.string().optional().describe("New content (supports markdown)"),
    type: z.enum(["cover_letter", "scope", "schedule", "terms", "appendix", "custom"]).optional().describe("New section type"),
    sortOrder: z.number().optional().describe("New sort order"),
  }),
  tags: ["report", "section", "update", "write"],
}, async (ctx, input) => {
  const { sectionId, ...body } = input;
  return apiPatch(ctx, `/report-sections/${sectionId}`, body, "Updated report section");
});

// ──────────────────────────────────────────────────────────────
// 33. quote.deleteReportSection
// ──────────────────────────────────────────────────────────────
export const deleteReportSectionTool = createQuoteTool({
  id: "quote.deleteReportSection",
  name: "Delete Report Section",
  description: "Delete a report section. Requires confirmation.",
  inputSchema: z.object({
    sectionId: z.string().describe("ID of the report section to delete"),
  }),
  requiresConfirmation: true,
  tags: ["report", "section", "delete", "write"],
}, async (ctx, input) => {
  return apiDelete(ctx, `/report-sections/${input.sectionId}`, "Deleted report section");
});

// ──────────────────────────────────────────────────────────────
// Export all tools as array
// ──────────────────────────────────────────────────────────────
export const quoteTools: Tool[] = [
  getWorkspaceTool,
  listWorksheetsTool,
  searchItemsTool,
  createWorksheetItemTool,
  updateWorksheetItemTool,
  deleteWorksheetItemTool,
  createWorksheetTool,
  updateWorksheetTool,
  deleteWorksheetTool,
  createPhaseTool,
  updatePhaseTool,
  deletePhaseTool,
  createModifierTool,
  updateModifierTool,
  deleteModifierTool,
  createConditionTool,
  updateConditionTool,
  deleteConditionTool,
  createALITool,
  updateALITool,
  deleteALITool,
  updateRevisionTool,
  createRevisionTool,
  deleteRevisionTool,
  copyQuoteTool,
  updateQuoteTool,
  recalculateTotalsTool,
  createReportSectionTool,
  updateReportSectionTool,
  deleteReportSectionTool,
];
