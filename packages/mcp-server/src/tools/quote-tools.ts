import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, apiPatch, apiDelete, projectPath, getRevisionId } from "../api-client.js";

/**
 * Convert plain text with newlines to HTML paragraphs.
 * Handles markdown-style headers (### → h3), bullet lists (- → li), and bold (**text**).
 */
function plainTextToHtml(text: string): string {
  const lines = text.split("\n");
  const htmlParts: string[] = [];
  let inUl = false;
  let inOl = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inUl) { htmlParts.push("</ul>"); inUl = false; }
      if (inOl) { htmlParts.push("</ol>"); inOl = false; }
      continue;
    }

    // Inline formatting: bold and italic
    const formatted = trimmed
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/_(.+?)_/g, "<em>$1</em>");

    // Unordered list: "- item", "* item", "• item"
    const ulMatch = formatted.match(/^[-*•]\s+(.*)/);
    // Ordered list: "1. item"
    const olMatch = formatted.match(/^\d+\.\s+(.*)/);

    if (ulMatch) {
      if (inOl) { htmlParts.push("</ol>"); inOl = false; }
      if (!inUl) { htmlParts.push("<ul>"); inUl = true; }
      htmlParts.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (inUl) { htmlParts.push("</ul>"); inUl = false; }
      if (!inOl) { htmlParts.push("<ol>"); inOl = true; }
      htmlParts.push(`<li>${olMatch[1]}</li>`);
    } else if (formatted.startsWith("### ")) {
      if (inUl) { htmlParts.push("</ul>"); inUl = false; }
      if (inOl) { htmlParts.push("</ol>"); inOl = false; }
      htmlParts.push(`<h3>${formatted.slice(4)}</h3>`);
    } else if (formatted.startsWith("## ")) {
      if (inUl) { htmlParts.push("</ul>"); inUl = false; }
      if (inOl) { htmlParts.push("</ol>"); inOl = false; }
      htmlParts.push(`<h2>${formatted.slice(3)}</h2>`);
    } else if (formatted.startsWith("# ")) {
      if (inUl) { htmlParts.push("</ul>"); inUl = false; }
      if (inOl) { htmlParts.push("</ol>"); inOl = false; }
      htmlParts.push(`<h1>${formatted.slice(2)}</h1>`);
    } else {
      if (inUl) { htmlParts.push("</ul>"); inUl = false; }
      if (inOl) { htmlParts.push("</ol>"); inOl = false; }
      htmlParts.push(`<p>${formatted}</p>`);
    }
  }
  if (inUl) htmlParts.push("</ul>");
  if (inOl) htmlParts.push("</ol>");
  return htmlParts.join("");
}

export function registerQuoteTools(server: McpServer) {

  // ── Cached workspace fetcher (shared across tool handlers) ──────────
  let cachedWs: { data: any; at: number } | null = null;

  async function getWs(): Promise<any> {
    if (cachedWs && Date.now() - cachedWs.at < 5000) return cachedWs.data;
    const raw = await apiGet(projectPath("/workspace"));
    const ws = raw.workspace || raw;
    cachedWs = { data: ws, at: Date.now() };
    return ws;
  }

  function invalidateWs() { cachedWs = null; }

  // ── Tool gating — state-based prerequisite checks ───────────────────
  // Gates check actual workspace state, not session history.
  // Resumed sessions / existing quotes pass automatically if data exists.
  //
  // Chain: updateQuote → importRateSchedule → createWorksheet → createWorksheetItem

  type GateTarget = "importRateSchedule" | "createWorksheet" | "createWorksheetItem";

  async function checkGate(gate: GateTarget): Promise<string | null> {
    const ws = await getWs();
    const project = ws.project || {};
    const revision = ws.currentRevision || {};
    const worksheets = ws.worksheets || [];
    const rateSchedules = ws.rateSchedules || [];
    const entityCategories = ws.entityCategories || [];

    // Has the agent (or user) filled in quote basics?
    const hasQuoteInfo = !!(
      (project.name && project.name !== "Untitled Project" && project.name !== "New Project")
      || revision.description
    );

    // Do any categories require rate schedules?
    const rsCats = entityCategories.filter((c: any) => c.itemSource === "rate_schedule");
    const needsRateSchedules = rsCats.length > 0;
    const hasRateSchedules = rateSchedules.length > 0;
    const hasWorksheets = worksheets.length > 0;

    // Gate 3: quote info required for all gated tools
    if (!hasQuoteInfo) {
      const action = gate === "importRateSchedule" ? "importing rate schedules"
        : gate === "createWorksheet" ? "creating worksheets" : "creating items";
      return `Quote setup required first. Call updateQuote with projectName and description before ${action}.`;
    }

    // Gate 2: rate schedules required for createWorksheet and createWorksheetItem
    if ((gate === "createWorksheet" || gate === "createWorksheetItem") && needsRateSchedules && !hasRateSchedules) {
      const names = rsCats.map((c: any) => c.name).join(", ");
      return `Rate schedules must be imported first. Categories [${names}] require rate schedules. Call listRateSchedules to see available schedules, then importRateSchedule to import them.`;
    }

    // Gate 1: worksheets required for createWorksheetItem
    if (gate === "createWorksheetItem" && !hasWorksheets) {
      return `No worksheets exist yet. Call createWorksheet to create at least one worksheet before adding items.`;
    }

    return null; // all gates passed
  }

  // ── getWorkspace ──────────────────────────────────────────
  server.tool(
    "getWorkspace",
    "Get the current quote workspace — all worksheets, items, phases, modifiers, conditions, totals. Call this to understand the current state of the estimate.",
    {},
    async () => {
      const data = await apiGet(projectPath("/workspace"));
      // Return a compact summary to avoid context bloat
      const ws = data.workspace || data;
      const rev = ws.currentRevision || ws.revisions?.[0] || {};
      const summary = {
        quote: { name: (ws.project || ws.projects?.[0])?.name, client: (ws.project || ws.projects?.[0])?.clientName },
        revision: {
          id: rev.id, title: rev.title, status: rev.status, type: rev.type,
          breakoutStyle: rev.breakoutStyle, defaultMarkup: rev.defaultMarkup,
        },
        worksheets: (ws.worksheets || []).map((w: any) => ({
          id: w.id, name: w.name, itemCount: (w.items || []).length,
        })),
        totalItems: (ws.worksheets || []).reduce((sum: number, w: any) => sum + (w.items || []).length, 0),
        phases: (ws.phases || []).map((p: any) => ({ id: p.id, name: p.name })),
        modifiers: (ws.modifiers || []).map((m: any) => ({
          id: m.id, name: m.name, type: m.type, appliesTo: m.appliesTo,
          percentage: m.percentage, amount: m.amount, show: m.show,
        })),
        additionalLineItems: (ws.additionalLineItems || []).map((a: any) => ({
          id: a.id, name: a.name, type: a.type, amount: a.amount, description: a.description,
        })),
        conditions: (ws.conditions || []).map((c: any) => ({ id: c.id, type: c.type, text: c.text })),
        reportSections: (ws.reportSections || []).map((s: any) => ({
          id: s.id, sectionType: s.sectionType, title: s.title, order: s.order,
        })),
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

      // Fetch org-level rate schedules available for import
      let orgSchedules: any[] = [];
      try {
        const orgData = await apiGet("/api/rate-schedules");
        orgSchedules = (orgData.schedules || orgData || []).map((s: any) => ({
          id: s.id, name: s.name, category: s.category,
          itemCount: s.items?.length || s.itemCount || 0,
          sampleItems: (s.items || []).slice(0, 3).map((i: any) => i.name),
        }));
      } catch {}

      const rateScheduleCats = entityCategories.filter((c: any) => c.itemSource === "rate_schedule");
      const catalogCats = entityCategories.filter((c: any) => c.itemSource === "catalog");
      const freeformCats = entityCategories.filter((c: any) => c.itemSource === "freeform");
      let instructions = "";
      if (rateScheduleCats.length > 0) {
        const names = rateScheduleCats.map((c: any) => c.name).join(", ");
        if (rateItems.length > 0) {
          instructions += `Categories [${names}] use rate schedules. Link items via rateScheduleItemId. `;
        } else if (orgSchedules.length > 0) {
          instructions += `Categories [${names}] use rate schedules but NONE are imported into this quote yet. ` +
            `You MUST import a rate schedule before creating items in these categories. Steps:\n` +
            `1. Review the available org schedules listed below\n` +
            `2. Call importRateSchedule with the appropriate schedule ID\n` +
            `3. Call listRateScheduleItems to get the item IDs\n` +
            `4. Set rateScheduleItemId on each item you create\n` +
            `DO NOT create items with made-up rates — import the schedule first.\n`;
        } else {
          instructions += `Categories [${names}] use rate schedules but no org schedules exist. Create items with estimated costs and note "NEEDS RATE SCHEDULE" in description. `;
        }
      }
      if (catalogCats.length > 0) {
        const names = catalogCats.map((c: any) => c.name).join(", ");
        instructions += `Categories [${names}] use catalog items. Set itemId to link to a catalog item. `;
      }
      if (freeformCats.length > 0) {
        instructions += `Categories [${freeformCats.map((c: any) => c.name).join(", ")}] use freeform input — set cost and quantity directly.`;
      }

      // If no categories configured, provide default guidance
      if (entityCategories.length === 0) {
        instructions = `No entity categories configured for this organization. Use these standard categories when creating items:\n` +
          `- "Material" — physical materials, supplies, consumables\n` +
          `- "Labour" — labour hours, crew costs (set unit1 for hours)\n` +
          `- "Equipment" — equipment rental, tools, machinery\n` +
          `- "Subcontractor" — subcontracted work (lump sum or per-unit)\n` +
          `All categories use freeform input — set cost and quantity directly. ` +
          `IMPORTANT: Use the correct category for each item. Do NOT put labour under Material.`;
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          categories: entityCategories.length > 0 ? entityCategories : [
            { name: "Material", entityType: "Material", defaultUom: "EA", calculationType: "manual", itemSource: "freeform", usesRateSchedule: false },
            { name: "Labour", entityType: "Labour", defaultUom: "HR", calculationType: "manual", itemSource: "freeform", usesRateSchedule: false },
            { name: "Equipment", entityType: "Equipment", defaultUom: "DAY", calculationType: "manual", itemSource: "freeform", usesRateSchedule: false },
            { name: "Subcontractor", entityType: "Subcontractor", defaultUom: "LS", calculationType: "manual", itemSource: "freeform", usesRateSchedule: false },
          ],
          rateScheduleItems: rateItems,
          availableOrgSchedules: orgSchedules.length > 0 && rateItems.length === 0 ? orgSchedules : undefined,
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
      const gateError = await checkGate("createWorksheet");
      if (gateError) return { content: [{ type: "text" as const, text: gateError }], isError: true };

      const data = await apiPost(projectPath("/worksheets"), { name, description });
      // Extract the worksheet ID from the response
      const worksheets = (data as any)?.workspace?.worksheets ?? [];
      const created = worksheets.find((w: any) => w.name === name);
      const wsId = created?.id ?? "unknown";
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Created worksheet: ${name} (worksheetId: ${wsId})` }] };
    }
  );

  // ── createWorksheetItem ───────────────────────────────────
  server.tool(
    "createWorksheetItem",
    `Create a line item in a worksheet. IMPORTANT: category is REQUIRED and must match exactly from getItemConfig. Use Equipment for equipment, Labour for labour, Material for materials, etc. For rate_schedule categories, set rateScheduleItemId. For freeform categories, set cost and quantity directly. Always include a description citing the source document.`,
    {
      worksheetId: z.string().describe("ID of the worksheet"),
      entityName: z.string().describe("Item name"),
      category: z.string().describe("Category name — MUST match exactly from getItemConfig (e.g. 'Labour', 'Equipment', 'Material', 'Consumables'). Use the correct category for each item type."),
      description: z.string().default("").describe("Description with document reference and assumptions"),
      quantity: z.number().default(1).describe("Quantity"),
      uom: z.string().default("EA").describe("Unit of measure: EA, LF, SF, HR, LS, DAY, etc."),
      cost: z.number().default(0).describe("Unit cost ($0 if unknown — note NEEDS PRICING in description)"),
      markup: z.number().default(0).describe("Markup percentage"),
      unit1: z.number().default(0).describe("Unit 1 value (e.g. regular hours for Labour)"),
      unit2: z.number().default(0).describe("Unit 2 value (e.g. overtime hours for Labour)"),
      unit3: z.number().default(0).describe("Unit 3 value (e.g. double-time hours for Labour)"),
      rateScheduleItemId: z.string().optional().describe("Rate schedule item ID for rate_schedule-backed categories"),
      itemId: z.string().optional().describe("Catalog item ID for catalog-backed categories"),
      phaseId: z.string().optional().describe("Phase ID"),
    },
    async (input) => {
      const gateError = await checkGate("createWorksheetItem");
      if (gateError) return { content: [{ type: "text" as const, text: gateError }], isError: true };

      const { worksheetId, ...rest } = input;
      const cat = rest.category;
      if (!cat) {
        return { content: [{ type: "text" as const, text: "ERROR: category is required. Use the exact category name from getItemConfig (e.g. 'Labour', 'Equipment', 'Material')." }], isError: true };
      }

      // ── Dynamic validation from workspace (entity categories + rate schedules) ──
      try {
        const ws = await getWs(); // reuses cached fetch from gate check
        const entityCategories = ws.entityCategories || [];
        const catConfig = entityCategories.find((c: any) => c.name === cat || c.entityType === cat);

        if (catConfig) {
          const src = catConfig.itemSource || "freeform";
          const calcType = catConfig.calculationType || "manual";

          // Validate itemSource requirements
          if (src === "rate_schedule" && !rest.rateScheduleItemId) {
            return { content: [{ type: "text" as const, text: `ERROR: Category "${cat}" is configured with itemSource=rate_schedule — a rateScheduleItemId is required.\n1. Call getItemConfig to see available rate schedule items\n2. Set rateScheduleItemId to a valid item ID\nWithout this, the item will have no linked rate.` }], isError: true };
          }
          if (src === "catalog" && !rest.itemId) {
            return { content: [{ type: "text" as const, text: `WARNING: Category "${cat}" is configured with itemSource=catalog but no itemId was provided. Item will be created without linked catalog pricing.` }] };
          }

          // Validate rateScheduleItemId actually exists in revision rate schedules
          if (rest.rateScheduleItemId) {
            const rateSchedules = ws.rateSchedules || [];
            const allRsItems = rateSchedules.flatMap((rs: any) => (rs.items || []).map((i: any) => ({ id: i.id, name: i.name, code: i.code })));
            const match = allRsItems.find((ri: any) => ri.id === rest.rateScheduleItemId);
            if (!match) {
              const available = allRsItems.slice(0, 15).map((ri: any) => `"${ri.name}" (${ri.id})`).join(", ");
              return { content: [{ type: "text" as const, text: `ERROR: rateScheduleItemId "${rest.rateScheduleItemId}" does not match any rate schedule item in this revision.` +
                (available ? `\nAvailable items: ${available}` : `\nNo rate schedule items found. Call getItemConfig to check available items.`) +
                `\nFix the rateScheduleItemId and retry.` }], isError: true };
            }
          }

          // Validate itemId actually exists in catalogs
          if (rest.itemId) {
            const catalogItems = (ws.catalogItems || []);
            const catalogs = ws.catalogs || [];
            const allCatItems = catalogs.flatMap((c: any) => catalogItems.filter((ci: any) => ci.catalogId === c.id).map((ci: any) => ({ id: ci.id, name: ci.name })));
            const match = allCatItems.find((ci: any) => ci.id === rest.itemId);
            if (!match) {
              return { content: [{ type: "text" as const, text: `ERROR: itemId "${rest.itemId}" does not match any catalog item. Call getItemConfig to check available catalog items, then retry with a valid itemId.` }], isError: true };
            }
          }

          // Validate calculationType requirements
          if (calcType === "auto_labour" && !rest.unit1 && !rest.unit2 && !rest.unit3) {
            return { content: [{ type: "text" as const, text: `ERROR: Category "${cat}" uses auto_labour calculation — unit values are required. Set unit1 at minimum. Without units, this item will calculate to $0.` }], isError: true };
          }
        }
      } catch {
        // Workspace not available — let API-level validation handle it
      }

      const price = (rest.cost || 0) * (1 + (rest.markup || 0) / 100);
      const body = { ...rest, category: cat, entityType: cat, price };
      try {
        const data = await apiPost(projectPath(`/worksheets/${worksheetId}/items`), body);
        invalidateWs();
        const itemId = (data as any)?.id || (data as any)?.item?.id || "";
        return { content: [{ type: "text" as const, text: `Created item: ${rest.entityName} (${cat})${itemId ? ` [id: ${itemId}]` : ""}` }] };
      } catch (err: any) {
        const msg = err?.message || String(err);
        return { content: [{ type: "text" as const, text: `ERROR creating item "${rest.entityName}": ${msg}. Check field values and try again.` }], isError: true };
      }
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
      unit1: z.number().optional(),
      unit2: z.number().optional(),
      unit3: z.number().optional(),
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
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Deleted item ${itemId}` }] };
    }
  );

  // ── updateQuote ───────────────────────────────────────────
  server.tool(
    "updateQuote",
    "Update the quote metadata — project name, client info, description, notes, scope summary. The description supports rich text (HTML). If you provide plain text with newlines, it will be auto-converted to HTML paragraphs.",
    {
      projectName: z.string().optional(),
      clientName: z.string().optional(),
      clientEmail: z.string().optional(),
      projectAddress: z.string().optional(),
      notes: z.string().optional(),
      description: z.string().optional().describe("Scope of work description. Can be plain text (auto-converted to HTML) or HTML. Use \\n for line breaks in plain text, or provide HTML directly with <p>, <ul>, <li>, <strong>, <h3> tags."),
    },
    async (input) => {
      // Convert plain text description to HTML if it doesn't contain HTML tags
      if (input.description && !/<[a-z][\s\S]*>/i.test(input.description)) {
        input.description = plainTextToHtml(input.description);
      }

      // Update project-level fields (name, client, address)
      const projectFields: Record<string, unknown> = {};
      if (input.projectName) projectFields.projectName = input.projectName;
      if (input.clientName) projectFields.clientName = input.clientName;
      if (input.clientEmail) projectFields.clientEmail = input.clientEmail;
      if (input.projectAddress) projectFields.projectAddress = input.projectAddress;
      if (input.description) projectFields.description = input.description;
      if (input.notes) projectFields.notes = input.notes;

      if (Object.keys(projectFields).length > 0) {
        await apiPatch(projectPath(""), projectFields);
      }

      // Also update revision title and description so the Setup tab reflects changes
      const revisionFields: Record<string, unknown> = {};
      if (input.projectName) revisionFields.title = input.projectName;
      if (input.description) revisionFields.description = input.description;
      if (input.notes) revisionFields.notes = input.notes;

      const revisionId = getRevisionId();
      if (revisionId && Object.keys(revisionFields).length > 0) {
        try {
          await apiPatch(projectPath(`/revisions/${revisionId}`), revisionFields);
        } catch {
          // Non-fatal — project-level update already succeeded
        }
      }

      invalidateWs();
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
    "Create a project phase for organizing line items. Returns the phase ID — use it as phaseId when creating worksheet items.",
    { name: z.string(), description: z.string().optional() },
    async ({ name, description }) => {
      const data = await apiPost(projectPath("/phases"), { name, description });
      // Extract the newly created phase ID from the workspace response
      const phases = (data as any)?.workspace?.phases ?? [];
      const created = phases.find((p: any) => p.name === name);
      const phaseId = created?.id ?? "unknown";
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Created phase: ${name} (phaseId: ${phaseId})` }] };
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

  // ── listRateSchedules (org-level discovery) ──────────────
  server.tool(
    "listRateSchedules",
    "List all available org-level rate schedules that can be imported into the quote. Call this to discover what labour/equipment rate schedules exist BEFORE importing them. Returns schedule IDs, names, categories, and item counts.",
    {},
    async () => {
      const data = await apiGet("/api/rate-schedules");
      const schedules = (data.schedules || data || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        itemCount: s.items?.length || s.itemCount || 0,
        items: (s.items || []).slice(0, 5).map((i: any) => ({ id: i.id, name: i.name, code: i.code, unit: i.unit })),
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify({
        schedules,
        note: "Call importRateSchedule with a schedule ID to import it, then listRateScheduleItems to get item IDs for linking to worksheet items.",
      }, null, 2) }] };
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
      const gateError = await checkGate("importRateSchedule");
      if (gateError) return { content: [{ type: "text" as const, text: gateError }], isError: true };

      const data = await apiPost(projectPath("/rate-schedules/import"), { sourceScheduleId: globalScheduleId });
      invalidateWs();
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

  // ═══════════════════════════════════════════════════════════
  // MODIFIERS — overhead, profit, contingency, discounts
  // ═══════════════════════════════════════════════════════════

  // ── createModifier ──────────────────────────────────────────
  server.tool(
    "createModifier",
    `Create a financial modifier on the quote — overhead, profit, contingency, discount, fuel surcharge, etc. Modifiers adjust the quote total by percentage or fixed amount. Use appliesTo to control scope (All, Labour Only, Materials Only, Equipment Only). Set show="Yes" to display on the client-facing quote, "No" to hide (distribute into line items).`,
    {
      name: z.string().describe("Modifier name, e.g. 'Overhead', '10% Contingency', 'Volume Discount'"),
      type: z.enum(["Contingency", "Surcharge", "Discount", "Other"]).default("Other").describe("Modifier type"),
      appliesTo: z.enum(["All", "Labour Only", "Materials Only", "Equipment Only"]).default("All").describe("What the modifier applies to"),
      percentage: z.number().optional().describe("Percentage adjustment (e.g. 10 for 10%). Use this OR amount, not both."),
      amount: z.number().optional().describe("Fixed dollar amount. Use this OR percentage, not both."),
      show: z.enum(["Yes", "No"]).default("Yes").describe("Show on client quote ('Yes') or hide/distribute ('No')"),
    },
    async (input) => {
      await apiPost(projectPath("/modifiers"), input);
      return { content: [{ type: "text" as const, text: `Created modifier: ${input.name}` }] };
    }
  );

  // ── updateModifier ──────────────────────────────────────────
  server.tool(
    "updateModifier",
    "Update an existing modifier. Only provided fields are changed.",
    {
      modifierId: z.string().describe("Modifier ID"),
      name: z.string().optional(),
      type: z.enum(["Contingency", "Surcharge", "Discount", "Other"]).optional(),
      appliesTo: z.enum(["All", "Labour Only", "Materials Only", "Equipment Only"]).optional(),
      percentage: z.number().nullable().optional().describe("Set to null to clear percentage"),
      amount: z.number().nullable().optional().describe("Set to null to clear amount"),
      show: z.enum(["Yes", "No"]).optional(),
    },
    async ({ modifierId, ...patch }) => {
      await apiPatch(projectPath(`/modifiers/${modifierId}`), patch);
      return { content: [{ type: "text" as const, text: `Updated modifier ${modifierId}` }] };
    }
  );

  // ── deleteModifier ──────────────────────────────────────────
  server.tool(
    "deleteModifier",
    "Delete a modifier from the quote.",
    { modifierId: z.string().describe("Modifier ID") },
    async ({ modifierId }) => {
      await apiDelete(projectPath(`/modifiers/${modifierId}`));
      return { content: [{ type: "text" as const, text: `Deleted modifier ${modifierId}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════
  // ADDITIONAL LINE ITEMS (ALIs) — options, standalone items, custom totals
  // ═══════════════════════════════════════════════════════════

  // ── createALI ───────────────────────────────────────────────
  server.tool(
    "createALI",
    `Create an additional line item (ALI) — items outside worksheets like options, bonds, permits, or allowances. Types:
- OptionStandalone: a priced option the client can accept/decline (excluded from base total)
- OptionAdditional: an add-on option (adds to base total if accepted)
- LineItemAdditional: extra cost added to the base total
- LineItemStandalone: standalone item not in any worksheet
- CustomTotal: override or custom total line`,
    {
      name: z.string().describe("ALI name, e.g. 'Performance Bond', 'Option: Expedited Schedule'"),
      type: z.enum(["OptionStandalone", "OptionAdditional", "LineItemAdditional", "LineItemStandalone", "CustomTotal"]).describe("ALI type"),
      description: z.string().optional().describe("Description or notes"),
      amount: z.number().default(0).describe("Dollar amount"),
    },
    async (input) => {
      await apiPost(projectPath("/ali"), input);
      return { content: [{ type: "text" as const, text: `Created ALI: ${input.name} ($${input.amount})` }] };
    }
  );

  // ── updateALI ───────────────────────────────────────────────
  server.tool(
    "updateALI",
    "Update an existing additional line item. Only provided fields are changed.",
    {
      aliId: z.string().describe("ALI ID"),
      name: z.string().optional(),
      type: z.enum(["OptionStandalone", "OptionAdditional", "LineItemAdditional", "LineItemStandalone", "CustomTotal"]).optional(),
      description: z.string().optional(),
      amount: z.number().optional(),
    },
    async ({ aliId, ...patch }) => {
      await apiPatch(projectPath(`/ali/${aliId}`), patch);
      return { content: [{ type: "text" as const, text: `Updated ALI ${aliId}` }] };
    }
  );

  // ── deleteALI ───────────────────────────────────────────────
  server.tool(
    "deleteALI",
    "Delete an additional line item from the quote.",
    { aliId: z.string().describe("ALI ID") },
    async ({ aliId }) => {
      await apiDelete(projectPath(`/ali/${aliId}`));
      return { content: [{ type: "text" as const, text: `Deleted ALI ${aliId}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════
  // REPORT SECTIONS — cover letter, scope narrative, schedule
  // ═══════════════════════════════════════════════════════════

  // ── createReportSection ─────────────────────────────────────
  server.tool(
    "createReportSection",
    `Create a report section for the quote PDF. Sections appear in the generated PDF document in order. Common types: cover_letter, scope, methodology, schedule, safety, assumptions, team. Content supports markdown.`,
    {
      sectionType: z.string().default("custom").describe("Section type: cover_letter, scope, methodology, schedule, safety, assumptions, team, custom"),
      title: z.string().describe("Section heading, e.g. 'Scope of Work', 'Project Schedule'"),
      content: z.string().describe("Section body text (markdown supported)"),
      order: z.number().optional().describe("Sort order (lower = earlier in PDF)"),
    },
    async (input) => {
      await apiPost(projectPath("/report-sections"), input);
      return { content: [{ type: "text" as const, text: `Created report section: ${input.title}` }] };
    }
  );

  // ── updateReportSection ─────────────────────────────────────
  server.tool(
    "updateReportSection",
    "Update a report section. Only provided fields are changed.",
    {
      sectionId: z.string().describe("Report section ID"),
      sectionType: z.string().optional(),
      title: z.string().optional(),
      content: z.string().optional(),
      order: z.number().optional(),
    },
    async ({ sectionId, ...patch }) => {
      await apiPatch(projectPath(`/report-sections/${sectionId}`), patch);
      return { content: [{ type: "text" as const, text: `Updated report section ${sectionId}` }] };
    }
  );

  // ── deleteReportSection ─────────────────────────────────────
  server.tool(
    "deleteReportSection",
    "Delete a report section from the quote.",
    { sectionId: z.string().describe("Report section ID") },
    async ({ sectionId }) => {
      await apiDelete(projectPath(`/report-sections/${sectionId}`));
      return { content: [{ type: "text" as const, text: `Deleted report section ${sectionId}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════
  // BREAKOUT STYLE & REVISION SETTINGS
  // ═══════════════════════════════════════════════════════════

  // ── updateRevision ──────────────────────────────────────────
  server.tool(
    "updateRevision",
    `Update revision-level settings — breakout style, dates, status, quote type, print options, and more. Use this to configure how the quote is presented to the client.`,
    {
      breakoutStyle: z.enum(["grand_total", "category", "phase", "phase_detail", "labour_material_equipment"]).optional()
        .describe("How costs are organized on the quote: grand_total (lump sum), category (by material/labour/etc), phase (by project phase), phase_detail (phases with category breakdown), labour_material_equipment (L/M/E columns)"),
      status: z.enum(["Open", "Pending", "Awarded", "DidNotGet", "Declined", "Cancelled", "Closed", "Other"]).optional(),
      type: z.enum(["Firm", "Budget", "BudgetDNE"]).optional().describe("Quote type: Firm (binding), Budget (estimate), BudgetDNE (do not exceed)"),
      title: z.string().optional().describe("Revision title"),
      description: z.string().optional(),
      notes: z.string().optional(),
      defaultMarkup: z.number().optional().describe("Default markup percentage for new items"),
      dateQuote: z.string().nullable().optional().describe("Quote date (ISO string)"),
      dateDue: z.string().nullable().optional().describe("Due date (ISO string)"),
      dateWalkdown: z.string().nullable().optional().describe("Walkdown date (ISO string)"),
      dateWorkStart: z.string().nullable().optional().describe("Work start date (ISO string)"),
      dateWorkEnd: z.string().nullable().optional().describe("Work end date (ISO string)"),
      dateEstimatedShip: z.string().nullable().optional().describe("Estimated ship date (ISO string)"),
      shippingMethod: z.string().optional(),
      shippingTerms: z.string().optional(),
      leadLetter: z.string().optional().describe("Cover letter / lead-in text for the quote"),
      useCalculatedTotal: z.boolean().optional().describe("Use calculated total vs manual grandTotal"),
      grandTotal: z.number().optional().describe("Manual grand total override (when useCalculatedTotal=false)"),
      printEmptyNotesColumn: z.boolean().optional(),
      printPhaseTotalOnly: z.boolean().optional().describe("Show only phase totals, hide individual items"),
      showOvertimeDoubletime: z.boolean().optional(),
    },
    async (input) => {
      const wsData = await apiGet(projectPath("/workspace"));
      const ws = wsData.workspace || wsData;
      const revisionId = ws.revisions?.[0]?.id || ws.currentRevisionId;
      if (!revisionId) {
        return { content: [{ type: "text" as const, text: "Error: Could not determine current revision ID" }] };
      }
      await apiPatch(projectPath(`/revisions/${revisionId}`), input);
      const updated: string[] = Object.keys(input).filter(k => (input as any)[k] !== undefined);
      return { content: [{ type: "text" as const, text: `Updated revision: ${updated.join(", ")}` }] };
    }
  );

  // ═══════════════════════════════════════════════════════════
  // PDF GENERATION
  // ═══════════════════════════════════════════════════════════

  // ── generateQuotePdf ────────────────────────────────────────
  server.tool(
    "generateQuotePdf",
    `Generate the quote PDF and return a download URL. Uses saved PDF preferences for layout. Template types:
- main: Full client-facing quote with cover letter, breakout, conditions
- backup: Detailed backup/internal version with all line items
- sitecopy: Simplified site copy for field use
- closeout: Closeout/as-built version
- schedule: Project schedule/Gantt chart PDF`,
    {
      templateType: z.enum(["main", "backup", "sitecopy", "closeout", "schedule"]).default("main")
        .describe("PDF template to generate"),
    },
    async ({ templateType }) => {
      // Build URL with saved preferences
      let url = projectPath(`/pdf/${templateType}`);
      try {
        const prefData = await apiGet(projectPath("/pdf-preferences"));
        const prefs = prefData.pdfPreferences ?? {};
        if (Object.keys(prefs).length > 0) {
          url += `?layout=${encodeURIComponent(JSON.stringify(prefs))}`;
        }
      } catch { /* use defaults */ }
      return { content: [{ type: "text" as const, text: `PDF ready for download at: ${url}\n\nThe quote PDF has been generated using the "${templateType}" template with saved layout preferences. The user can download it from the application.` }] };
    }
  );

  // ── getPdfPreferences ──────────────────────────────────────
  server.tool(
    "getPdfPreferences",
    "Get the saved PDF layout preferences for this quote — sections, branding, page setup, template, and custom sections.",
    {},
    async () => {
      const data = await apiGet(projectPath("/pdf-preferences"));
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── updatePdfPreferences ───────────────────────────────────
  server.tool(
    "updatePdfPreferences",
    `Update PDF layout preferences for this quote. Supports partial updates. Available keys:
- sections: { coverPage, scopeOfWork, leadLetter, lineItems, phases, modifiers, conditions, hoursSummary, labourSummary, notes, reportSections } (all boolean)
- sectionOrder: array of section keys controlling display order
- lineItemOptions: { showCostColumn, showMarkupColumn, groupBy: none/phase/worksheet }
- branding: { accentColor: hex, headerBgColor: hex, fontFamily: sans/serif/mono }
- pageSetup: { orientation: portrait/landscape, pageSize: letter/a4/legal }
- coverPageOptions: { companyName, tagline, logoUrl }
- headerFooter: { showHeader, showFooter, headerText, footerText, showPageNumbers }
- customSections: array of { id, title, content, order }
- activeTemplate: standard/detailed/summary/client`,
    {
      sections: z.record(z.boolean()).optional().describe("Toggle sections on/off"),
      sectionOrder: z.array(z.string()).optional().describe("Section display order"),
      lineItemOptions: z.object({
        showCostColumn: z.boolean().optional(),
        showMarkupColumn: z.boolean().optional(),
        groupBy: z.enum(["none", "phase", "worksheet"]).optional(),
      }).optional(),
      branding: z.object({
        accentColor: z.string().optional(),
        headerBgColor: z.string().optional(),
        fontFamily: z.enum(["sans", "serif", "mono"]).optional(),
      }).optional(),
      pageSetup: z.object({
        orientation: z.enum(["portrait", "landscape"]).optional(),
        pageSize: z.enum(["letter", "a4", "legal"]).optional(),
      }).optional(),
      coverPageOptions: z.object({
        companyName: z.string().optional(),
        tagline: z.string().optional(),
        logoUrl: z.string().optional(),
      }).optional(),
      headerFooter: z.object({
        showHeader: z.boolean().optional(),
        showFooter: z.boolean().optional(),
        headerText: z.string().optional(),
        footerText: z.string().optional(),
        showPageNumbers: z.boolean().optional(),
      }).optional(),
      activeTemplate: z.enum(["standard", "detailed", "summary", "client"]).optional(),
    },
    async (input) => {
      // Fetch existing preferences and deep merge
      let current: any = {};
      try {
        const existing = await apiGet(projectPath("/pdf-preferences"));
        current = existing.pdfPreferences ?? {};
      } catch { /* start fresh */ }

      const merged = { ...current };
      if (input.sections) merged.sections = { ...(current.sections ?? {}), ...input.sections };
      if (input.sectionOrder) merged.sectionOrder = input.sectionOrder;
      if (input.lineItemOptions) merged.lineItemOptions = { ...(current.lineItemOptions ?? {}), ...input.lineItemOptions };
      if (input.branding) merged.branding = { ...(current.branding ?? {}), ...input.branding };
      if (input.pageSetup) merged.pageSetup = { ...(current.pageSetup ?? {}), ...input.pageSetup };
      if (input.coverPageOptions) merged.coverPageOptions = { ...(current.coverPageOptions ?? {}), ...input.coverPageOptions };
      if (input.headerFooter) merged.headerFooter = { ...(current.headerFooter ?? {}), ...input.headerFooter };
      if (input.activeTemplate) merged.activeTemplate = input.activeTemplate;

      await apiPatch(projectPath("/pdf-preferences"), merged);
      const updated = Object.keys(input).filter(k => (input as any)[k] !== undefined);
      return { content: [{ type: "text" as const, text: `PDF preferences updated: ${updated.join(", ")}` }] };
    }
  );

  // ── applySummaryPreset ──────────────────────────────────────
  server.tool(
    "applySummaryPreset",
    "Apply a summary preset to configure quote breakout. Presets: quick_total (single total), by_category (per category), by_phase (per phase), phase_x_category (phases with category detail), custom (empty). After applying, rows can be individually customized.",
    {
      preset: z.enum(["quick_total", "by_category", "by_phase", "phase_x_category", "custom"]).describe("Preset name"),
    },
    async ({ preset }) => {
      await apiPost(projectPath("/summary-rows/apply-preset"), { preset });
      return { content: [{ type: "text" as const, text: `Applied summary preset: ${preset}` }] };
    }
  );

  // ── createSummaryRow ────────────────────────────────────────
  server.tool(
    "createSummaryRow",
    "Add a row to the quote summary. Types: auto_category, auto_phase, manual, modifier, subtotal, separator.",
    {
      type: z.enum(["auto_category", "auto_phase", "manual", "modifier", "subtotal", "separator"]).describe("Row type"),
      label: z.string().describe("Display label"),
      sourceCategory: z.string().optional().describe("For auto_category: EntityCategory name to aggregate"),
      sourcePhase: z.string().optional().describe("For auto_phase: phase name to aggregate"),
      manualValue: z.number().optional().describe("For manual: sell/price value"),
      manualCost: z.number().optional().describe("For manual: cost value"),
      modifierPercent: z.number().optional().describe("For modifier: percentage"),
      modifierAmount: z.number().optional().describe("For modifier: fixed dollar amount"),
      visible: z.boolean().optional().describe("Visible on PDF (default true)"),
    },
    async (input) => {
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) {
        if (v !== undefined) body[k] = v;
      }
      await apiPost(projectPath("/summary-rows"), body);
      return { content: [{ type: "text" as const, text: `Created summary row: ${input.label}` }] };
    }
  );

  // ── updateSummaryRow ────────────────────────────────────────
  server.tool(
    "updateSummaryRow",
    "Update an existing summary row.",
    {
      rowId: z.string().describe("Summary row ID"),
      label: z.string().optional().describe("New label"),
      manualValue: z.number().optional().describe("New value (manual rows)"),
      manualCost: z.number().optional().describe("New cost (manual rows)"),
      modifierPercent: z.number().optional().describe("New percentage (modifier rows)"),
      modifierAmount: z.number().optional().describe("New amount (modifier rows)"),
      visible: z.boolean().optional().describe("Visible on PDF"),
      style: z.enum(["normal", "bold", "indent", "highlight"]).optional().describe("Display style"),
    },
    async (input) => {
      const { rowId, ...patch } = input;
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) body[k] = v;
      }
      await apiPatch(projectPath(`/summary-rows/${rowId}`), body);
      return { content: [{ type: "text" as const, text: `Updated summary row ${rowId}` }] };
    }
  );

  // ── deleteSummaryRow ────────────────────────────────────────
  server.tool(
    "deleteSummaryRow",
    "Delete a summary row from the quote.",
    {
      rowId: z.string().describe("Summary row ID to delete"),
    },
    async ({ rowId }) => {
      await apiDelete(projectPath(`/summary-rows/${rowId}`));
      return { content: [{ type: "text" as const, text: "Deleted summary row" }] };
    }
  );
}
