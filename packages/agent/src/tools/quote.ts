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
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const errMsg = errBody ? tryParseErrorMessage(errBody) : `${res.status} ${res.statusText}`;
    return { success: false, error: `API error: ${errMsg}`, duration_ms: 0 };
  }
  const data = await res.json() as Record<string, unknown>;
  return { success: true, data, sideEffects: [sideEffect], duration_ms: 0 };
}

async function apiPatch(ctx: ToolExecutionContext, path: string, body: Record<string, unknown>, sideEffect: string): Promise<ToolResult> {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}${path}`, {
    method: "PATCH",
    headers: authHeaders(ctx),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const errMsg = errBody ? tryParseErrorMessage(errBody) : `${res.status} ${res.statusText}`;
    return { success: false, error: `API error: ${errMsg}`, duration_ms: 0 };
  }
  const data = await res.json() as Record<string, unknown>;
  return { success: true, data, sideEffects: [sideEffect], duration_ms: 0 };
}

/** Extract human-readable message from API error response JSON */
function tryParseErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    const parts: string[] = [];
    if (parsed.message) parts.push(parsed.message);
    if (parsed.hint) parts.push(`Hint: ${parsed.hint}`);
    if (parsed.availableItems) {
      const items = parsed.availableItems.slice(0, 10);
      parts.push(`Available items: ${items.map((i: any) => `${i.name} (${i.id})`).join(", ")}`);
    }
    return parts.length > 0 ? parts.join(" | ") : (parsed.error || body);
  } catch {
    return body;
  }
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
// 3b. quote.getItemConfig — discover categories, rate schedules, catalog items
// ──────────────────────────────────────────────────────────────
export const getItemConfigTool = createQuoteTool({
  id: "quote.getItemConfig",
  name: "Get Item Configuration",
  description: `Discover how line items work in this organization. Returns:
1. Entity categories — the types of line items (e.g. Labour, Material) with their calculation types and editable fields. Categories are user-configured and vary per organization.
2. Rate schedule items — pre-configured rates (labour rates, equipment rates) that should be linked to line items via rateScheduleItemId for categories with auto-calculation.
3. Catalog items — equipment/material catalog with pricing.

CALL THIS FIRST before creating any line items. The response tells you which categories use rate schedules (calculationType=auto_labour or auto_equipment) and which are freeform (calculationType=manual or direct_price).`,
  inputSchema: z.object({}),
  tags: ["item", "read", "rates", "config"],
}, async (ctx, _input) => {
  // Fetch workspace which includes rate schedules
  const wsRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}/workspace`, {
    method: "GET", headers: authHeaders(ctx),
  });
  let rateSchedules: any[] = [];
  let entityCategories: any[] = [];
  if (wsRes.ok) {
    const wsData = await wsRes.json() as any;
    // workspace response nests data under .workspace
    const ws = wsData.workspace || wsData;
    rateSchedules = ws.rateSchedules || [];
    entityCategories = ws.entityCategories || [];
  }

  // Fetch catalogs
  const catRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/catalogs`, {
    method: "GET", headers: authHeaders(ctx),
  });
  let catalogs: any[] = [];
  if (catRes.ok) {
    const catData = await catRes.json() as any;
    catalogs = catData.catalogs || catData || [];
  }

  // Build category config — this tells the agent HOW to create items per category
  const categoryConfig = entityCategories.map((ec: any) => ({
    name: ec.name,
    entityType: ec.entityType,
    defaultUom: ec.defaultUom,
    validUoms: ec.validUoms,
    calculationType: ec.calculationType,
    editableFields: ec.editableFields,
    itemSource: ec.itemSource, // "rate_schedule", "catalog", or "freeform"
    catalogId: ec.catalogId ?? null,
    // Derive whether this category needs rate schedule linking
    usesRateSchedule: ec.calculationType === "auto_labour" || ec.calculationType === "auto_equipment",
  }));

  // Build rate schedule items — only if there are schedules configured
  const rateItems: any[] = [];
  for (const rs of rateSchedules) {
    const tiers = (rs.tiers || []).map((t: any) => ({ id: t.id, name: t.name, multiplier: t.multiplier }));
    for (const item of (rs.items || [])) {
      rateItems.push({
        rateScheduleItemId: item.id,
        name: item.name,
        code: item.code,
        unit: item.unit,
        forCategory: rs.category, // "labour", "equipment", etc.
        scheduleName: rs.name,
        rates: item.rates,
        costRates: item.costRates,
        burden: item.burden,
        perDiem: item.perDiem,
        tiers,
      });
    }
  }

  // Build catalog items summary (first 50)
  const catalogItems: any[] = [];
  for (const cat of catalogs) {
    for (const item of (cat.items || [])) {
      catalogItems.push({
        catalogItemId: item.id,
        name: item.name,
        code: item.code,
        unit: item.unit,
        unitCost: item.unitCost,
        unitPrice: item.unitPrice,
        catalogName: cat.name,
        catalogKind: cat.kind,
      });
    }
  }

  // Build dynamic instructions from the actual configuration
  const autoCategories = categoryConfig.filter((c: any) => c.usesRateSchedule);
  const manualCategories = categoryConfig.filter((c: any) => !c.usesRateSchedule);

  // Identify categories that have catalogs
  const catalogCategories = categoryConfig.filter((c: any) => c.itemSource === "catalog");

  let instructions = "";
  if (autoCategories.length > 0) {
    const names = autoCategories.map((c: any) => c.name).join(", ");
    if (rateItems.length > 0) {
      instructions += `RATE SCHEDULE CATEGORIES [${names}]: These categories REQUIRE a valid rateScheduleItemId from the rateScheduleItems list below. You MUST pick an existing rate — do NOT invent labour classes, equipment types, or rates that don't exist in the list. If no suitable rate exists, use the closest match and note the discrepancy in the description. `;
    } else {
      instructions += `Categories [${names}] are configured for auto-calculation but NO rate schedules are set up yet. You MUST import rate schedules using rateSchedule.import before creating items in these categories. `;
    }
  }
  if (catalogCategories.length > 0) {
    const names = catalogCategories.map((c: any) => c.name).join(", ");
    instructions += `CATALOG CATEGORIES [${names}]: Items must be selected from the catalogItems list. Do NOT invent items — pick from the available catalog entries only. `;
  }
  if (manualCategories.length > 0) {
    const freeformManual = manualCategories.filter((c: any) => c.itemSource === "freeform");
    if (freeformManual.length > 0) {
      const names = freeformManual.map((c: any) => c.name).join(", ");
      instructions += `FREEFORM CATEGORIES [${names}]: Set cost and quantity directly. `;
    }
  }

  // Add explicit warning about consumables if applicable
  const consumableCat = categoryConfig.find((c: any) => c.calculationType === "auto_consumable");
  if (consumableCat) {
    const hasConsumableRates = rateItems.some((r: any) => r.forCategory === "consumable" || r.forCategory === "consumables");
    const hasConsumableCatalog = catalogItems.some((c: any) => c.catalogKind === "consumable" || c.catalogKind === "consumables");
    if (hasConsumableRates || hasConsumableCatalog) {
      instructions += `CONSUMABLES: Must be selected from the available rate/catalog items — do NOT invent consumable items. `;
    }
  }

  return {
    success: true,
    data: {
      categories: categoryConfig,
      rateScheduleItems: rateItems,
      catalogItems: catalogItems.slice(0, 50),
      instructions,
    },
    duration_ms: 0,
  };
});

// 4. quote.createWorksheetItem
// ──────────────────────────────────────────────────────────────
export const createWorksheetItemTool = createQuoteTool({
  id: "quote.createWorksheetItem",
  name: "Create Line Item",
  description: `Create a new line item in a worksheet. Requires worksheetId and entityName.

STRICT RULES — the server will REJECT items that violate these:
- For LABOUR and EQUIPMENT categories (itemSource=rate_schedule): you MUST provide a valid rateScheduleItemId from the getItemConfig results. Do NOT invent labour classes or equipment — pick from the available rate schedule items.
- For CATALOG categories: you MUST use an existing catalogItemId from getItemConfig results.
- For FREEFORM categories (Material, Subcontractors, etc.): provide cost and quantity directly.

If the server rejects your item, read the error message — it will tell you what items are available.`,
  inputSchema: z.object({
    worksheetId: z.string().describe("ID of the worksheet to add the item to"),
    category: z.string().describe("Item category — MUST match a category name from getItemConfig (e.g. 'Labour', 'Equipment', 'Material', 'Consumables', 'Rental Equipment', 'Subcontractors'). Use the correct category for each item type."),
    entityName: z.string().describe("Name of the line item"),
    description: z.string().optional().default("").describe("Detailed description with document reference and assumptions"),
    quantity: z.number().optional().default(1).describe("Quantity of the item"),
    uom: z.string().optional().default("EA").describe("Unit of measure: EA, LF, SF, HR, LS, DAY, etc."),
    cost: z.number().optional().default(0).describe("Unit cost ($0 if unknown — note NEEDS PRICING in description)"),
    markup: z.number().optional().default(0).describe("Markup percentage (e.g. 15 for 15%)"),
    unit1: z.number().optional().default(0).describe("Unit 1 value per unit (e.g. regular hours for Labour)"),
    unit2: z.number().optional().default(0).describe("Unit 2 value per unit (e.g. overtime hours for Labour)"),
    unit3: z.number().optional().default(0).describe("Unit 3 value per unit (e.g. double-time hours for Labour)"),
    rateScheduleItemId: z.string().optional().describe("Rate schedule item ID — REQUIRED for Labour items. Get from listRateItems tool."),
    phaseId: z.string().optional().describe("Phase ID to associate this item with"),
  }),
  tags: ["item", "create", "write"],
}, async (ctx, input) => {
  const { worksheetId, category, ...rest } = input;
  const cost = Number(rest.cost ?? 0);
  const markup = Number(rest.markup ?? 0);
  const price = cost * (1 + markup / 100);
  const cat = category;
  const body: Record<string, unknown> = {
    ...rest,
    category: cat,
    entityType: cat,
    cost,
    markup,
    price,
    quantity: rest.quantity ?? 1,
    uom: rest.uom ?? "EA",
    description: rest.description ?? "",
  };

  // If rateScheduleItemId provided, include it and set up tierUnits
  if (rest.rateScheduleItemId) {
    body.rateScheduleItemId = rest.rateScheduleItemId;
  }

  return apiPost(ctx, `/worksheets/${worksheetId}/items`, body, `Created line item: ${rest.entityName}`);
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
    unit1: z.number().optional().describe("Unit 1 value per unit"),
    unit2: z.number().optional().describe("Unit 2 value per unit"),
    unit3: z.number().optional().describe("Unit 3 value per unit"),
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
  description: "Update revision-level fields such as title, description, notes, or status.",
  inputSchema: z.object({
    title: z.string().optional().describe("Revision title"),
    description: z.string().optional().describe("Revision description / scope of work"),
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
  description: "Update quote-level fields: project name (quote title), description (scope of work), client, and other metadata. Call this early to set the quote title and scope.",
  inputSchema: z.object({
    projectName: z.string().optional().describe("Project name — also sets the quote title displayed in the UI"),
    description: z.string().optional().describe("Scope of work / description (rich text supported). This is the main description field shown on the quote page."),
    clientName: z.string().optional().describe("Client/customer name"),
    customerId: z.string().optional().describe("Customer ID to link from the client dropdown (e.g. 'cust_apex_industrial')"),
    clientEmail: z.string().optional().describe("Client email"),
    clientPhone: z.string().optional().describe("Client phone number"),
    clientAddress: z.string().optional().describe("Client address"),
    projectAddress: z.string().optional().describe("Project/job site address"),
    bidDate: z.string().optional().describe("Bid date (ISO 8601)"),
    notes: z.string().optional().describe("General project notes / assumptions"),
  }),
  tags: ["quote", "update", "write"],
}, async (ctx, input) => {
  const results: string[] = [];

  // Project-level fields → PATCH /projects/{id} (routes to Project + Quote.title + QuoteRevision.description)
  const projectFields: Record<string, unknown> = {};
  if (input.projectName) projectFields.projectName = input.projectName;
  if (input.description) projectFields.description = input.description;
  if (input.notes) projectFields.notes = input.notes;
  if (input.clientName) projectFields.clientName = input.clientName;
  if (input.clientEmail) projectFields.clientEmail = input.clientEmail;
  if (input.clientPhone) projectFields.clientPhone = input.clientPhone;
  if (input.clientAddress) projectFields.clientAddress = input.clientAddress;
  if (input.projectAddress) projectFields.location = input.projectAddress;
  if (input.bidDate) projectFields.bidDate = input.bidDate;

  if (Object.keys(projectFields).length > 0) {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}`, {
      method: "PATCH",
      headers: authHeaders(ctx),
      body: JSON.stringify(projectFields),
    });
    if (!res.ok) return { success: false, error: `Project update failed: ${res.status} ${res.statusText}`, duration_ms: 0 };
    results.push("Updated project metadata");
  }

  // Quote-level fields → PATCH /projects/{id}/quote (customerId, etc.)
  const quoteFields: Record<string, unknown> = {};
  if (input.customerId) quoteFields.customerId = input.customerId;
  if (input.clientName) quoteFields.customerString = input.clientName;

  if (Object.keys(quoteFields).length > 0) {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}/quote`, {
      method: "PATCH",
      headers: authHeaders(ctx),
      body: JSON.stringify(quoteFields),
    });
    if (!res.ok) return { success: false, error: `Quote update failed: ${res.status} ${res.statusText}`, duration_ms: 0 };
    results.push("Updated quote client");
  }

  return { success: true, data: { updated: results }, sideEffects: results, duration_ms: 0 };
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
// 34. quote.applySummaryPreset
// ──────────────────────────────────────────────────────────────
export const applySummaryPresetTool = createQuoteTool({
  id: "quote.applySummaryPreset",
  name: "Apply Summary Preset",
  description: "Apply a summary preset to configure how the quote total is broken out. Presets: quick_total (single total), by_category (one row per item category), by_phase (one row per project phase), phase_x_category (phases with category detail), custom (empty — build from scratch). After applying, rows can be individually customized.",
  inputSchema: z.object({
    preset: z.enum(["quick_total", "by_category", "by_phase", "phase_x_category", "custom"]).describe("The preset to apply"),
  }),
  tags: ["summary", "breakout", "preset", "write"],
}, async (ctx, input) => {
  return apiPost(ctx, "/summary-rows/apply-preset", { preset: input.preset }, `Applied summary preset: ${input.preset}`);
});

// ──────────────────────────────────────────────────────────────
// 35. quote.createSummaryRow
// ──────────────────────────────────────────────────────────────
export const createSummaryRowTool = createQuoteTool({
  id: "quote.createSummaryRow",
  name: "Create Summary Row",
  description: "Add a row to the quote summary. Types: auto_category (aggregates items by category name), auto_phase (aggregates by phase name), manual (user-defined value/cost), modifier (percentage or fixed amount applied to other rows), subtotal (sums preceding rows), separator (visual divider).",
  inputSchema: z.object({
    type: z.enum(["auto_category", "auto_phase", "manual", "modifier", "subtotal", "separator"]).describe("Row type"),
    label: z.string().describe("Display label for the row"),
    sourceCategory: z.string().optional().describe("For auto_category: the EntityCategory name to aggregate"),
    sourcePhase: z.string().optional().describe("For auto_phase: the phase name to aggregate"),
    manualValue: z.number().optional().describe("For manual rows: the sell/price value"),
    manualCost: z.number().optional().describe("For manual rows: the cost value"),
    modifierPercent: z.number().optional().describe("For modifier rows: percentage to apply"),
    modifierAmount: z.number().optional().describe("For modifier rows: fixed dollar amount"),
    appliesTo: z.array(z.string()).optional().describe("For modifier rows: array of row IDs or ['all']"),
    visible: z.boolean().optional().describe("Whether visible on PDF output (default true)"),
    style: z.enum(["normal", "bold", "indent", "highlight"]).optional().describe("Display style"),
  }),
  tags: ["summary", "row", "create", "write"],
}, async (ctx, input) => {
  return apiPost(ctx, "/summary-rows", input, `Created summary row: ${input.label}`);
});

// ──────────────────────────────────────────────────────────────
// 36. quote.updateSummaryRow
// ──────────────────────────────────────────────────────────────
export const updateSummaryRowTool = createQuoteTool({
  id: "quote.updateSummaryRow",
  name: "Update Summary Row",
  description: "Update an existing summary row. Can change label, type, values, visibility, etc.",
  inputSchema: z.object({
    rowId: z.string().describe("ID of the summary row to update"),
    label: z.string().optional(),
    type: z.enum(["auto_category", "auto_phase", "manual", "modifier", "subtotal", "separator"]).optional(),
    sourceCategory: z.string().nullable().optional(),
    sourcePhase: z.string().nullable().optional(),
    manualValue: z.number().nullable().optional(),
    manualCost: z.number().nullable().optional(),
    modifierPercent: z.number().nullable().optional(),
    modifierAmount: z.number().nullable().optional(),
    appliesTo: z.array(z.string()).optional(),
    visible: z.boolean().optional(),
    style: z.enum(["normal", "bold", "indent", "highlight"]).optional(),
  }),
  tags: ["summary", "row", "update", "write"],
}, async (ctx, input) => {
  const { rowId, ...patch } = input;
  return apiPatch(ctx, `/summary-rows/${rowId}`, patch, `Updated summary row ${rowId}`);
});

// ──────────────────────────────────────────────────────────────
// 37. quote.deleteSummaryRow
// ──────────────────────────────────────────────────────────────
export const deleteSummaryRowTool = createQuoteTool({
  id: "quote.deleteSummaryRow",
  name: "Delete Summary Row",
  description: "Remove a summary row from the quote.",
  inputSchema: z.object({
    rowId: z.string().describe("ID of the summary row to delete"),
  }),
  requiresConfirmation: true,
  tags: ["summary", "row", "delete", "write"],
}, async (ctx, input) => {
  return apiDelete(ctx, `/summary-rows/${input.rowId}`, "Deleted summary row");
});

// ──────────────────────────────────────────────────────────────
// Export all tools as array
// ──────────────────────────────────────────────────────────────
export const quoteTools: Tool[] = [
  getWorkspaceTool,
  listWorksheetsTool,
  searchItemsTool,
  getItemConfigTool,
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
  applySummaryPresetTool,
  createSummaryRowTool,
  updateSummaryRowTool,
  deleteSummaryRowTool,
];
