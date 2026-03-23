import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, apiPatch, apiDelete, projectPath } from "../api-client.js";

export function registerQuoteTools(server: McpServer) {

  // ── getWorkspace ──────────────────────────────────────────
  server.tool(
    "getWorkspace",
    "Get the current quote workspace — all worksheets, items, phases, modifiers, conditions, totals. Call this to understand the current state of the estimate.",
    {},
    async () => {
      const data = await apiGet(projectPath("/workspace"));
      // Return a compact summary to avoid context bloat
      const ws = data.workspace || data;
      const summary = {
        quote: { name: ws.projects?.[0]?.name, client: ws.projects?.[0]?.clientName },
        worksheets: (ws.worksheets || []).map((w: any) => ({
          id: w.id, name: w.name, itemCount: (ws.worksheetItems || []).filter((i: any) => i.worksheetId === w.id).length,
        })),
        totalItems: (ws.worksheetItems || []).length,
        phases: (ws.phases || []).map((p: any) => ({ id: p.id, name: p.name })),
        conditions: (ws.conditions || []).map((c: any) => ({ type: c.type, text: c.text })),
        rateScheduleCount: (ws.rateSchedules || []).length,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // ── getItemConfig ─────────────────────────────────────────
  server.tool(
    "getItemConfig",
    `Discover how line items work in this organization. Returns entity categories (with calculation types), available rate schedule items for labour/equipment, and catalog items. CALL THIS FIRST before creating any line items. Categories with calculationType=auto_labour or auto_equipment need rateScheduleItemId. Manual categories use direct cost/quantity.`,
    {},
    async () => {
      const data = await apiGet(projectPath("/workspace"));
      const ws = data.workspace || data;

      const entityCategories = (ws.entityCategories || []).map((ec: any) => ({
        name: ec.name,
        entityType: ec.entityType,
        defaultUom: ec.defaultUom,
        validUoms: ec.validUoms,
        calculationType: ec.calculationType,
        editableFields: ec.editableFields,
        itemSource: ec.itemSource ?? "freeform",
        catalogId: ec.catalogId ?? null,
        usesRateSchedule: ec.calculationType === "auto_labour" || ec.calculationType === "auto_equipment",
      }));

      const rateItems: any[] = [];
      for (const rs of (ws.rateSchedules || [])) {
        const tiers = (rs.tiers || []).map((t: any) => ({ id: t.id, name: t.name, multiplier: t.multiplier }));
        for (const item of (rs.items || [])) {
          rateItems.push({
            rateScheduleItemId: item.id, name: item.name, code: item.code,
            unit: item.unit, forCategory: rs.category, scheduleName: rs.name,
            rates: item.rates, costRates: item.costRates,
            burden: item.burden, perDiem: item.perDiem, tiers,
          });
        }
      }

      const catalogItems: any[] = [];
      for (const cat of (ws.catalogs || [])) {
        for (const item of (ws.catalogItems || []).filter((ci: any) => ci.catalogId === cat.id)) {
          catalogItems.push({
            catalogItemId: item.id, name: item.name, code: item.code,
            unit: item.unit, unitCost: item.unitCost, unitPrice: item.unitPrice,
            catalogName: cat.name, catalogKind: cat.kind,
          });
        }
      }

      const rateScheduleCats = entityCategories.filter((c: any) => c.itemSource === "rate_schedule");
      const catalogCats = entityCategories.filter((c: any) => c.itemSource === "catalog");
      const freeformCats = entityCategories.filter((c: any) => c.itemSource === "freeform");
      let instructions = "";
      if (rateScheduleCats.length > 0) {
        const names = rateScheduleCats.map((c: any) => c.name).join(", ");
        instructions += rateItems.length > 0
          ? `Categories [${names}] use rate schedules. Link items via rateScheduleItemId. `
          : `Categories [${names}] use rate schedules but NONE are imported. Use estimated costs and note "NEEDS RATE SCHEDULE". `;
      }
      if (catalogCats.length > 0) {
        const names = catalogCats.map((c: any) => c.name).join(", ");
        instructions += `Categories [${names}] use catalog items. Set itemId to link to a catalog item. `;
      }
      if (freeformCats.length > 0) {
        instructions += `Categories [${freeformCats.map((c: any) => c.name).join(", ")}] use freeform input — set cost and quantity directly.`;
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          categories: entityCategories,
          rateScheduleItems: rateItems,
          catalogItems: catalogItems.slice(0, 50),
          instructions,
        }, null, 2) }],
      };
    }
  );

  // ── createWorksheet ───────────────────────────────────────
  server.tool(
    "createWorksheet",
    "Create a new worksheet (cost breakdown section) in the quote. Use clear names like '01 - General Requirements', '02 - Process Piping', etc.",
    { name: z.string().describe("Worksheet name"), description: z.string().optional().describe("Optional description") },
    async ({ name, description }) => {
      const data = await apiPost(projectPath("/worksheets"), { name, description });
      return { content: [{ type: "text" as const, text: `Created worksheet: ${name}` }] };
    }
  );

  // ── createWorksheetItem ───────────────────────────────────
  server.tool(
    "createWorksheetItem",
    `Create a line item in a worksheet. For Labour items with rate schedules, set rateScheduleItemId and laborHourReg. For Material/Subcontractor, set cost and quantity directly. Always include a description citing the source document.`,
    {
      worksheetId: z.string().describe("ID of the worksheet"),
      entityName: z.string().describe("Item name"),
      category: z.string().default("Material").describe("Category name — must match exactly from getItemConfig"),
      description: z.string().default("").describe("Description with document reference and assumptions"),
      quantity: z.number().default(1).describe("Quantity"),
      uom: z.string().default("EA").describe("Unit of measure: EA, LF, SF, HR, LS, DAY, etc."),
      cost: z.number().default(0).describe("Unit cost ($0 if unknown — note NEEDS PRICING in description)"),
      markup: z.number().default(0).describe("Markup percentage"),
      laborHourReg: z.number().default(0).describe("Regular labor hours (for Labour items)"),
      laborHourOver: z.number().default(0).describe("Overtime hours"),
      laborHourDouble: z.number().default(0).describe("Double-time hours"),
      rateScheduleItemId: z.string().optional().describe("Rate schedule item ID for rate_schedule-backed categories"),
      itemId: z.string().optional().describe("Catalog item ID for catalog-backed categories"),
      phaseId: z.string().optional().describe("Phase ID"),
    },
    async (input) => {
      const { worksheetId, ...rest } = input;
      const cat = rest.category || "Material";
      const price = (rest.cost || 0) * (1 + (rest.markup || 0) / 100);
      const body = { ...rest, category: cat, entityType: cat, price };
      const data = await apiPost(projectPath(`/worksheets/${worksheetId}/items`), body);
      return { content: [{ type: "text" as const, text: `Created item: ${rest.entityName} (${cat})` }] };
    }
  );

  // ── updateWorksheetItem ───────────────────────────────────
  server.tool(
    "updateWorksheetItem",
    "Update an existing line item. Only provided fields are changed.",
    {
      itemId: z.string().describe("Line item ID"),
      entityName: z.string().optional(),
      category: z.string().optional(),
      description: z.string().optional(),
      quantity: z.number().optional(),
      uom: z.string().optional(),
      cost: z.number().optional(),
      markup: z.number().optional(),
      laborHourReg: z.number().optional(),
      laborHourOver: z.number().optional(),
      laborHourDouble: z.number().optional(),
      rateScheduleItemId: z.string().optional(),
      catalogItemId: z.string().optional().describe("Catalog item ID for catalog-backed categories"),
    },
    async ({ itemId, catalogItemId, ...patch }) => {
      if (catalogItemId) (patch as any).itemId = catalogItemId;
      const data = await apiPatch(projectPath(`/worksheet-items/${itemId}`), patch);
      return { content: [{ type: "text" as const, text: `Updated item ${itemId}` }] };
    }
  );

  // ── deleteWorksheetItem ───────────────────────────────────
  server.tool(
    "deleteWorksheetItem",
    "Delete a line item from a worksheet.",
    { itemId: z.string() },
    async ({ itemId }) => {
      await apiDelete(projectPath(`/worksheet-items/${itemId}`));
      return { content: [{ type: "text" as const, text: `Deleted item ${itemId}` }] };
    }
  );

  // ── updateQuote ───────────────────────────────────────────
  server.tool(
    "updateQuote",
    "Update the quote metadata — project name, client info, description, notes, scope summary.",
    {
      projectName: z.string().optional(),
      clientName: z.string().optional(),
      clientEmail: z.string().optional(),
      projectAddress: z.string().optional(),
      notes: z.string().optional(),
      description: z.string().optional(),
    },
    async (input) => {
      const data = await apiPatch(projectPath(""), input);
      return { content: [{ type: "text" as const, text: "Quote updated" }] };
    }
  );

  // ── createCondition ───────────────────────────────────────
  server.tool(
    "createCondition",
    "Add a condition to the quote — exclusions, inclusions, clarifications, assumptions, or terms.",
    {
      type: z.enum(["inclusion", "exclusion", "clarification", "assumption", "term"]),
      text: z.string().describe("Condition text"),
    },
    async ({ type, text }) => {
      await apiPost(projectPath("/conditions"), { type, value: text, sortOrder: 0 });
      return { content: [{ type: "text" as const, text: `Added ${type}: ${text.substring(0, 60)}...` }] };
    }
  );

  // ── createPhase ───────────────────────────────────────────
  server.tool(
    "createPhase",
    "Create a project phase for organizing line items.",
    { name: z.string(), description: z.string().optional() },
    async ({ name, description }) => {
      await apiPost(projectPath("/phases"), { name, description });
      return { content: [{ type: "text" as const, text: `Created phase: ${name}` }] };
    }
  );

  // ── createScheduleTask ──────────────────────────────────
  server.tool(
    "createScheduleTask",
    "Create a schedule task or milestone for the project Gantt chart. Link to a phase for grouping. Set startDate/endDate (ISO strings) and duration (days).",
    {
      name: z.string().describe("Task name"),
      description: z.string().optional().describe("Task description"),
      phaseId: z.string().optional().describe("Phase ID to group under"),
      taskType: z.enum(["task", "milestone"]).default("task"),
      startDate: z.string().optional().describe("Start date (ISO string, e.g. '2026-04-01')"),
      endDate: z.string().optional().describe("End date (ISO string)"),
      duration: z.number().optional().describe("Duration in days"),
      order: z.number().optional().describe("Sort order"),
    },
    async (input) => {
      await apiPost(projectPath("/schedule/tasks"), input);
      return { content: [{ type: "text" as const, text: `Created schedule task: ${input.name}` }] };
    }
  );

  // ── listScheduleTasks ─────────────────────────────────────
  server.tool(
    "listScheduleTasks",
    "List all schedule tasks and milestones for the project.",
    {},
    async () => {
      const data = await apiGet(projectPath("/schedule/tasks"));
      const tasks = (Array.isArray(data) ? data : data.tasks || []).map((t: any) => ({
        id: t.id, name: t.name, phaseId: t.phaseId, taskType: t.taskType,
        startDate: t.startDate, endDate: t.endDate, duration: t.duration, order: t.order,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }] };
    }
  );

  // ── recalculateTotals ─────────────────────────────────────
  server.tool(
    "recalculateTotals",
    "Recalculate all financial totals for the quote.",
    {},
    async () => {
      await apiPost(projectPath("/recalculate"), {});
      return { content: [{ type: "text" as const, text: "Totals recalculated" }] };
    }
  );

  // ── importRateSchedule ───────────────────────────────────
  server.tool(
    "importRateSchedule",
    "Import a global (org-level) rate schedule into the current quote revision. This creates a revision-scoped copy with all tiers and items. Required before Labour/rate_schedule items can be created.",
    {
      globalScheduleId: z.string().describe("ID of the global rate schedule to import"),
    },
    async ({ globalScheduleId }) => {
      const data = await apiPost(projectPath("/rate-schedules/import"), { sourceScheduleId: globalScheduleId });
      return { content: [{ type: "text" as const, text: `Imported rate schedule into current revision` }] };
    }
  );

  // ── listRateScheduleItems ──────────────────────────────
  server.tool(
    "listRateScheduleItems",
    "List all rate schedule items available in the current revision. Optionally filter by category (e.g. 'labour', 'equipment').",
    {
      category: z.string().optional().describe("Filter by schedule category (e.g. 'labour', 'equipment')"),
    },
    async ({ category }) => {
      const data = await apiGet(projectPath("/workspace"));
      const ws = data.workspace || data;
      const items: any[] = [];
      for (const rs of (ws.rateSchedules || [])) {
        if (category && rs.category !== category) continue;
        const tiers = (rs.tiers || []).map((t: any) => ({ id: t.id, name: t.name, multiplier: t.multiplier }));
        for (const item of (rs.items || [])) {
          items.push({
            rateScheduleItemId: item.id, name: item.name, code: item.code,
            unit: item.unit, forCategory: rs.category, scheduleName: rs.name,
            rates: item.rates, costRates: item.costRates,
            burden: item.burden, perDiem: item.perDiem, tiers,
          });
        }
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(items, null, 2) }] };
    }
  );

  // ── searchItems ───────────────────────────────────────────
  server.tool(
    "searchItems",
    "Search existing line items across all worksheets.",
    {
      query: z.string().optional(),
      category: z.string().optional(),
      worksheetId: z.string().optional(),
    },
    async ({ query, category, worksheetId }) => {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (category) params.set("category", category);
      if (worksheetId) params.set("worksheetId", worksheetId);
      const data = await apiGet(projectPath(`/worksheet-items/search?${params}`));
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );
}
