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

function toolUiText(message: string, uiEvent: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    success: true,
    message,
    uiEvent,
    sideEffects: [String(uiEvent.kind || "workspace.updated")],
    ...extra,
  }, null, 2);
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

  function normalizeCategoryToolKey(value: unknown) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function findEntityCategory(
    categories: any[],
    input: { categoryId?: string | null; category?: string | null; entityType?: string | null },
  ) {
    const categoryId = normalizeCategoryToolKey(input.categoryId);
    if (categoryId) {
      const byId = categories.find((category: any) => normalizeCategoryToolKey(category.id) === categoryId);
      if (byId) return byId;
      return null;
    }

    const names = [input.category, input.entityType].map(normalizeCategoryToolKey).filter(Boolean);
    for (const name of names) {
      const match = categories.find((category: any) =>
        normalizeCategoryToolKey(category.name) === name ||
        normalizeCategoryToolKey(category.entityType) === name
      );
      if (match) return match;
    }

    return null;
  }

  function folderPath(ws: any, folderId?: string | null): string {
    if (!folderId) return "";
    const folders: any[] = ws.worksheetFolders || [];
    const byId = new Map<string, any>(folders.map((folder: any) => [folder.id, folder]));
    const parts: string[] = [];
    const seen = new Set<string>();
    let cursor = byId.get(folderId);
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      parts.unshift(cursor.name);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
    }
    return parts.join(" / ");
  }

  function worksheetTreeSummary(ws: any) {
    const folders = ws.worksheetFolders || [];
    const worksheets = ws.worksheets || [];
    return {
      folders: folders.map((folder: any) => {
        const childWorksheetIds = worksheets
          .filter((worksheet: any) => worksheet.folderId === folder.id)
          .map((worksheet: any) => worksheet.id);
        return {
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId ?? null,
          path: folderPath(ws, folder.id),
          childWorksheetIds,
        };
      }),
      worksheets: worksheets.map((worksheet: any) => ({
        id: worksheet.id,
        name: worksheet.name,
        folderId: worksheet.folderId ?? null,
        path: [folderPath(ws, worksheet.folderId), worksheet.name].filter(Boolean).join(" / "),
        itemCount: (worksheet.items || []).length,
        priceTotal: (worksheet.items || []).reduce((sum: number, item: any) => sum + (item.price || 0), 0),
      })),
    };
  }

  async function ensureWorksheetFolderPath(path?: string | null): Promise<string | null> {
    if (!path?.trim()) return null;
    const parts = path.split("/").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    let ws = await getWs();
    let parentId: string | null = null;
    for (const part of parts) {
      const existing = (ws.worksheetFolders || []).find(
        (folder: any) => folder.name.toLowerCase() === part.toLowerCase() && (folder.parentId ?? null) === parentId,
      );
      if (existing) {
        parentId = existing.id;
        continue;
      }
      const data = await apiPost(projectPath("/worksheet-folders"), { name: part, parentId });
      ws = (data as any).workspace || data;
      cachedWs = { data: ws, at: Date.now() };
      const created = (ws.worksheetFolders || []).find(
        (folder: any) => folder.name === part && (folder.parentId ?? null) === parentId,
      );
      parentId = created?.id ?? null;
    }
    return parentId;
  }

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
    const strategy = ws.estimateStrategy || null;

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

    const hasScopeGraph = !!strategy && Object.keys(strategy.scopeGraph || {}).length > 0;
    const hasExecutionPlan = !!strategy && Object.keys(strategy.executionPlan || {}).length > 0;
    const hasAssumptions = !!strategy && Array.isArray(strategy.assumptions) && strategy.assumptions.length > 0;
    const hasPackagePlan = !!strategy && Array.isArray(strategy.packagePlan) && strategy.packagePlan.length > 0;
    const hasBenchmarks = !!strategy && Object.keys(strategy.benchmarkProfile || {}).length > 0;

    if ((gate === "createWorksheet" || gate === "createWorksheetItem") && !hasScopeGraph) {
      return `Estimate strategy is incomplete. Call saveEstimateScopeGraph before creating worksheets or items.`;
    }
    if ((gate === "createWorksheet" || gate === "createWorksheetItem") && !hasExecutionPlan) {
      return `Execution model not saved yet. Call saveEstimateExecutionPlan before creating worksheets or items.`;
    }
    if ((gate === "createWorksheet" || gate === "createWorksheetItem") && !hasAssumptions) {
      return `Assumptions are not persisted yet. Call saveEstimateAssumptions before creating worksheets or items.`;
    }
    if ((gate === "createWorksheet" || gate === "createWorksheetItem") && !hasPackagePlan) {
      return `Commercial/package structure is missing. Call saveEstimatePackagePlan before creating worksheets or items.`;
    }
    if (gate === "createWorksheetItem" && !hasBenchmarks) {
      return `Historical benchmark pass has not been run. Call recomputeEstimateBenchmarks and saveEstimateAdjustments before creating detailed line items.`;
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
    "Get the current quote workspace — all worksheets, items, phases, estimate factors, modifiers, conditions, totals. Call this to understand the current state of the estimate.",
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
          id: w.id,
          name: w.name,
          folderId: w.folderId ?? null,
          path: [folderPath(ws, w.folderId), w.name].filter(Boolean).join(" / "),
          itemCount: (w.items || []).length,
          structuredSourceCount: (w.items || []).filter((item: any) =>
            item.rateScheduleItemId ||
            item.itemId ||
            item.costResourceId ||
            item.effectiveCostId ||
            item.laborUnitId ||
            (Array.isArray(item.resourceComposition?.resources) && item.resourceComposition.resources.length > 0)
          ).length,
        })),
        worksheetFolders: (ws.worksheetFolders || []).map((folder: any) => ({
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId ?? null,
          path: folderPath(ws, folder.id),
        })),
        totalItems: (ws.worksheets || []).reduce((sum: number, w: any) => sum + (w.items || []).length, 0),
        totalStructuredSourceItems: (ws.worksheets || []).reduce((sum: number, w: any) => sum + (w.items || []).filter((item: any) =>
          item.rateScheduleItemId ||
          item.itemId ||
          item.costResourceId ||
          item.effectiveCostId ||
          item.laborUnitId ||
          (Array.isArray(item.resourceComposition?.resources) && item.resourceComposition.resources.length > 0)
        ).length, 0),
        phases: (ws.phases || []).map((p: any) => ({ id: p.id, name: p.name })),
        estimateFactors: (ws.estimateFactors || []).map((f: any) => ({
          id: f.id,
          name: f.name,
          code: f.code,
          impact: f.impact,
          value: f.value,
          active: f.active,
          appliesTo: f.appliesTo,
          scope: f.scope,
          confidence: f.confidence,
          sourceType: f.sourceType,
          sourceId: f.sourceId,
        })),
        factorTotals: (ws.estimate?.totals?.factorTotals || []).map((entry: any) => ({
          id: entry.id,
          label: entry.label,
          targetCount: entry.targetCount,
          valueDelta: entry.valueDelta,
          costDelta: entry.costDelta,
          hoursDelta: entry.hoursDelta,
        })),
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
        estimateStrategy: ws.estimateStrategy ? {
          currentStage: ws.estimateStrategy.currentStage,
          status: ws.estimateStrategy.status,
          reviewCompleted: ws.estimateStrategy.reviewCompleted,
          benchmarkCandidateCount: ws.estimateStrategy.benchmarkProfile?.candidateCount ?? 0,
        } : null,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // ── getWorksheetTree ──────────────────────────────────────
  server.tool(
    "getWorksheetTree",
    "Get the worksheet folder tree for the current quote. Folders organize worksheets; line items still belong to worksheets.",
    {},
    async () => {
      const ws = await getWs();
      return { content: [{ type: "text" as const, text: JSON.stringify(worksheetTreeSummary(ws), null, 2) }] };
    }
  );

  // ── getItemConfig ─────────────────────────────────────────
  server.tool(
    "getItemConfig",
    `Discover how line items work in this organization. Returns entity categories (with calculation types), available rate schedule items, and catalog items. CALL THIS FIRST before creating any line items. Use searchLineItemCandidates/recommendCostSource for cost-intelligence resources, labor units, assemblies, and canonical source provenance before creating priced rows.`,
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
        unitLabels: ec.unitLabels ?? {},
        itemSource: ec.itemSource ?? "freeform",
        catalogId: ec.catalogId ?? null,
        usesRateSchedule: (ec.itemSource ?? "freeform") === "rate_schedule",
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

      instructions += `\n\nCANONICAL COST SOURCE WORKFLOW: Before creating a priced line item, call searchLineItemCandidates or recommendCostSource with the scope phrase and preferred category. If a result exists, preserve its rateScheduleItemId/itemId/costResourceId/effectiveCostId/laborUnitId plus sourceEvidence and resourceComposition when calling createWorksheetItem. Use listLaborUnits for labour productivity and previewAssembly for assembly-backed scope. Use WebSearch/WebFetch alongside internal sources for high-value, volatile, regional, unfamiliar, or vendor-specific items. Create freeform priced rows only when no structured candidate exists, or when current web/vendor evidence is materially better than stale internal data; write both the internal search and web/vendor basis in sourceNotes.`;

      // If no categories configured, provide default guidance
      if (entityCategories.length === 0) {
        instructions = `No entity categories configured for this organization. Use these standard categories when creating items:\n` +
          `- "Material" — physical materials, supplies, consumables\n` +
          `- "Labour" — labour hours, crew costs (set tierUnits with the schedule's tier ids)\n` +
          `- "Equipment" — equipment rental, tools, machinery\n` +
          `- "Subcontractor" — subcontracted work (lump sum or per-unit)\n` +
          `All categories use freeform input — set cost and quantity directly. ` +
          `IMPORTANT: Use the correct category for each item. Do NOT put labour under Material.`;
      }

      // UOM validation instructions
      if (entityCategories.length > 0) {
        instructions += `\n\nUOM RULES: Each category has a validUoms list. You MUST use one of those UOMs — the server will REJECT invalid UOMs. `;
        for (const c of entityCategories) {
          if (c.validUoms?.length > 0) {
            instructions += `${c.name}: ${c.validUoms.join(", ")}. `;
          }
        }
      }

      // Markup instructions
      const rev = ws.currentRevision || {};
      const revisionDefaultMarkup: number = rev.defaultMarkup ?? 0;
      const markupPct = revisionDefaultMarkup > 1 ? revisionDefaultMarkup : revisionDefaultMarkup * 100;
      const markupCats = entityCategories.filter((c: any) => c.editableFields?.markup);
      if (markupCats.length > 0 && revisionDefaultMarkup > 0) {
        const noMarkupCats = entityCategories.filter((c: any) => !c.editableFields?.markup).map((c: any) => c.name);
        instructions += `\n\nMARKUP: The revision default markup is ${markupPct.toFixed(1)}%. Apply this to categories with editable markup: ${markupCats.map((c: any) => c.name).join(", ")}. Set markup=${markupPct} (e.g. 15 for 15%) on items in these categories unless you have a specific reason not to.`;
        if (noMarkupCats.length > 0) {
          instructions += ` Categories WITHOUT markup (pricing set by rate/catalog/direct entry): ${noMarkupCats.join(", ")}.`;
        }
      }

      // Quantity × units clarification — derive from actual category configs
      const rateSchedCatNames = rateScheduleCats.map((c: any) => c.name);
      if (rateSchedCatNames.length > 0) {
        instructions += `\n\nQUANTITY × UNITS (CRITICAL for rate_schedule categories: ${rateSchedCatNames.join(", ")}): `;
        instructions += `For these categories, quantity is a MULTIPLIER on the tierUnits values. tierUnits is a JSON map keyed by RateScheduleTier id with hours per quantity. `;
        instructions += `The calc engine computes: total = Σ(tierUnits[tierId] × tier rate) × quantity. `;
        instructions += `Get tier ids from the rate schedule. Do NOT confuse quantity with total tier hours — quantity × tier hours must make logical sense for the item. `;
        instructions += `Example: 1 person for 80 regular hours → quantity=1, tierUnits={"<reg-tier-id>": 80}. 4 people for 200 regular hours each → quantity=4, tierUnits={"<reg-tier-id>": 200}.`;
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
          defaultMarkup: revisionDefaultMarkup,
          instructions,
        }, null, 2) }],
      };
    }
  );

  // ── createWorksheet ───────────────────────────────────────
  server.tool(
    "createWorksheet",
    "Create a new worksheet (cost breakdown section) in the quote. Use folderId or folderPath for large estimates. Folders organize worksheets; line items still belong to worksheets.",
    {
      name: z.string().describe("Worksheet name"),
      description: z.string().optional().describe("Optional description"),
      folderId: z.string().nullable().optional().describe("Existing worksheet folder ID"),
      folderPath: z.string().optional().describe("Folder path to create/use, e.g. 'Mechanical / Field Install'"),
    },
    async ({ name, description, folderId, folderPath }) => {
      const gateError = await checkGate("createWorksheet");
      if (gateError) return { content: [{ type: "text" as const, text: gateError }], isError: true };

      const resolvedFolderId = folderId ?? await ensureWorksheetFolderPath(folderPath);
      const data = await apiPost(projectPath("/worksheets"), { name, description, folderId: resolvedFolderId });
      // Extract the worksheet ID from the response
      const worksheets = (data as any)?.workspace?.worksheets ?? [];
      const created = worksheets.find((w: any) => w.name === name && (w.folderId ?? null) === (resolvedFolderId ?? null));
      const wsId = created?.id ?? "unknown";
      invalidateWs();
      const path = created ? [folderPath || "", name].filter(Boolean).join(" / ") : name;
      return { content: [{ type: "text" as const, text: toolUiText(`Created worksheet: ${path}`, {
        kind: "worksheet.created",
        worksheetId: wsId,
        name,
        path,
        folderId: resolvedFolderId ?? null,
      }) }] };
    }
  );

  // ── createWorksheetFolder ─────────────────────────────────
  server.tool(
    "createWorksheetFolder",
    "Create a worksheet folder for organizing large estimates. Folders do not contain line items directly; worksheets do.",
    {
      name: z.string().describe("Folder name"),
      parentId: z.string().nullable().optional().describe("Optional parent folder ID"),
      parentPath: z.string().optional().describe("Optional parent path to create/use, e.g. 'Mechanical'"),
    },
    async ({ name, parentId, parentPath }) => {
      const resolvedParentId = parentId ?? await ensureWorksheetFolderPath(parentPath);
      const data = await apiPost(projectPath("/worksheet-folders"), { name, parentId: resolvedParentId });
      const ws = (data as any).workspace || data;
      const folder = (ws.worksheetFolders || []).find((entry: any) => entry.name === name && (entry.parentId ?? null) === (resolvedParentId ?? null));
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Created worksheet folder: ${folder ? folderPath(ws, folder.id) : name}${folder?.id ? ` (folderId: ${folder.id})` : ""}` }] };
    }
  );

  // ── updateWorksheetFolder ─────────────────────────────────
  server.tool(
    "updateWorksheetFolder",
    "Rename or move a worksheet folder.",
    {
      folderId: z.string(),
      name: z.string().optional(),
      parentId: z.string().nullable().optional(),
      parentPath: z.string().optional().describe("Destination parent path to create/use"),
    },
    async ({ folderId, name, parentId, parentPath }) => {
      const patch: Record<string, unknown> = {};
      if (name) patch.name = name;
      if (parentId !== undefined || parentPath !== undefined) {
        patch.parentId = parentId !== undefined ? parentId : await ensureWorksheetFolderPath(parentPath);
      }
      await apiPatch(projectPath(`/worksheet-folders/${folderId}`), patch);
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Updated worksheet folder ${folderId}` }] };
    }
  );

  // ── deleteWorksheetFolder ─────────────────────────────────
  server.tool(
    "deleteWorksheetFolder",
    "Delete a worksheet folder. Child folders and worksheets are moved up one level; line items are not deleted.",
    { folderId: z.string() },
    async ({ folderId }) => {
      await apiDelete(projectPath(`/worksheet-folders/${folderId}`));
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Deleted worksheet folder ${folderId}` }] };
    }
  );

  // ── moveWorksheet ─────────────────────────────────────────
  server.tool(
    "moveWorksheet",
    "Move a worksheet into a folder, or to the top level with folderId=null. This does not change line items.",
    {
      worksheetId: z.string(),
      folderId: z.string().nullable().optional(),
      folderPath: z.string().optional().describe("Destination folder path to create/use"),
    },
    async ({ worksheetId, folderId, folderPath }) => {
      const resolvedFolderId = folderId !== undefined ? folderId : await ensureWorksheetFolderPath(folderPath);
      await apiPatch(projectPath(`/worksheets/${worksheetId}`), { folderId: resolvedFolderId ?? null });
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Moved worksheet ${worksheetId}` }] };
    }
  );

  // ── moveWorksheetFolder ───────────────────────────────────
  server.tool(
    "moveWorksheetFolder",
    "Move a worksheet folder under another folder, or to the top level with parentId=null.",
    {
      folderId: z.string(),
      parentId: z.string().nullable().optional(),
      parentPath: z.string().optional().describe("Destination parent path to create/use"),
    },
    async ({ folderId, parentId, parentPath }) => {
      const resolvedParentId = parentId !== undefined ? parentId : await ensureWorksheetFolderPath(parentPath);
      await apiPatch(projectPath(`/worksheet-folders/${folderId}`), { parentId: resolvedParentId ?? null });
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Moved worksheet folder ${folderId}` }] };
    }
  );

  // ── createWorksheetItem ───────────────────────────────────
  server.tool(
    "createWorksheetItem",
    `Create a line item in a worksheet. IMPORTANT: categoryId is preferred; category name is accepted for backward compatibility and must resolve to an EntityCategory from getItemConfig. For rate_schedule categories (itemSource=rate_schedule), set rateScheduleItemId and use the rate item name as entityName. Put task details in the description field, NOT in entityName. For freeform categories, set cost and quantity directly. UOM must be from the category's validUoms list.`,
    {
      worksheetId: z.string().describe("ID of the worksheet"),
      entityName: z.string().describe("Item name — for rate_schedule items, use ONLY the rate item name (e.g. 'Trade Labour'). Put task details in description."),
      categoryId: z.string().optional().describe("Stable EntityCategory ID from getItemConfig. Prefer this over category name so renames cannot affect the row."),
      category: z.string().optional().describe("Category name from getItemConfig (e.g. 'Labour', 'Equipment', 'Material', 'Consumables'). Use categoryId when available."),
      entityType: z.string().optional().describe("Legacy entity type/category type. The server canonicalizes this from categoryId when provided."),
      description: z.string().default("").describe("Description with document reference and assumptions"),
      quantity: z.number().default(1).describe("Quantity multiplier. For rate_schedule categories this is a multiplier on the unit values (e.g. crew size). Total = Σ(units × rate) × quantity. Check the category config from getItemConfig to understand what quantity means for each category."),
      uom: z.string().default("EA").describe("Unit of measure — MUST be from the category's validUoms (see getItemConfig). Server rejects invalid UOMs and auto-corrects to the category default."),
      cost: z.number().default(0).describe("Unit cost ($0 if unknown — note NEEDS PRICING in description)"),
      markup: z.number().default(0).describe("Markup percentage. For markup-eligible categories, apply the revision defaultMarkup from getItemConfig."),
      price: z.number().optional().describe("Optional unit price override. If omitted, server uses cost plus markup."),
      tierUnits: z.record(z.number()).optional().describe("Units per rate tier. Keys are tier IDs from getItemConfig, values are units PER quantity. The calc engine multiplies these by the tier rate, then by quantity. REQUIRED for rate_schedule categories."),
      rateScheduleItemId: z.string().optional().describe("Rate schedule item ID for rate_schedule-backed categories"),
      itemId: z.string().optional().describe("Catalog item ID for catalog-backed categories"),
      costResourceId: z.string().nullable().optional().describe("Cost intelligence resource ID from searchLineItemCandidates/recommendCostSource."),
      effectiveCostId: z.string().nullable().optional().describe("Effective cost ID from cost intelligence. Preserve this when a priced effective_cost candidate is selected."),
      laborUnitId: z.string().nullable().optional().describe("Labor unit ID for labour productivity sources."),
      resourceComposition: z.record(z.unknown()).optional().describe("Structured resource rollup from a search candidate, recommendation, or assembly expansion."),
      sourceEvidence: z.record(z.unknown()).optional().describe("Structured provenance from a search candidate, recommendation, or source document."),
      classification: z.record(z.unknown()).optional().describe("Optional construction classification JSON, e.g. { masterformat: '03 30 00' }."),
      costCode: z.string().nullable().optional().describe("Optional internal cost code used by cost-code rollups."),
      phaseId: z.string().optional().describe("Phase ID"),
      sourceNotes: z.string().default("").describe(
        "MANDATORY: knowledge book refs, dataset lookups, correction factors applied, web search URLs/findings, assumptions for this item"
      ),
    },
    async (input) => {
      const gateError = await checkGate("createWorksheetItem");
      if (gateError) return { content: [{ type: "text" as const, text: gateError }], isError: true };

      const { worksheetId, ...rest } = input;
      const requestedCategory = rest.category;
      const requestedCategoryId = rest.categoryId;
      if (!requestedCategory && !requestedCategoryId) {
        return { content: [{ type: "text" as const, text: "ERROR: categoryId or category is required. Prefer the stable categoryId from getItemConfig." }], isError: true };
      }
      let resolvedCategory: any = null;

      // ── Dynamic validation from workspace (entity categories + rate schedules) ──
      try {
        const ws = await getWs(); // reuses cached fetch from gate check
        const entityCategories = ws.entityCategories || [];
        const catConfig = findEntityCategory(entityCategories, {
          categoryId: requestedCategoryId,
          category: requestedCategory,
          entityType: rest.entityType,
        });

        if (catConfig) {
          resolvedCategory = catConfig;
          rest.categoryId = catConfig.id;
          rest.category = catConfig.name;
          rest.entityType = catConfig.entityType;
          const src = catConfig.itemSource || "freeform";
          const calcType = catConfig.calculationType || "manual";

          // Validate UOM against category's validUoms
          const validUoms: string[] = catConfig.validUoms || [];
          if (validUoms.length > 0) {
            if (!rest.uom || rest.uom === "EA") {
              // Auto-correct to category default if UOM was omitted or left as generic default
              if (!validUoms.includes(rest.uom || "EA")) {
                rest.uom = catConfig.defaultUom || validUoms[0];
              }
            } else if (!validUoms.includes(rest.uom)) {
              return { content: [{ type: "text" as const, text: `ERROR: UOM "${rest.uom}" is not valid for category "${catConfig.name}". Valid UOMs: ${validUoms.join(", ")}. Use one of these or omit uom to use the default (${catConfig.defaultUom}).` }], isError: true };
            }
          }

          // Validate itemSource requirements
          if (src === "rate_schedule" && !rest.rateScheduleItemId) {
            return { content: [{ type: "text" as const, text: `ERROR: Category "${catConfig.name}" is configured with itemSource=rate_schedule — a rateScheduleItemId is required.\n1. Call getItemConfig to see available rate schedule items\n2. Set rateScheduleItemId to a valid item ID\nWithout this, the item will have no linked rate.` }], isError: true };
          }
          if (src === "catalog" && !rest.itemId) {
            return { content: [{ type: "text" as const, text: `ERROR: Category "${catConfig.name}" is configured with itemSource=catalog — itemId is required. Call searchLineItemCandidates or getItemConfig, then retry with a valid itemId.` }], isError: true };
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
            const allCatItems = catalogs.flatMap((c: any) => [
              ...(c.items || []).map((ci: any) => ({ id: ci.id, name: ci.name })),
              ...catalogItems.filter((ci: any) => ci.catalogId === c.id).map((ci: any) => ({ id: ci.id, name: ci.name })),
            ]);
            const match = allCatItems.find((ci: any) => ci.id === rest.itemId);
            if (!match) {
              return { content: [{ type: "text" as const, text: `ERROR: itemId "${rest.itemId}" does not match any catalog item. Call getItemConfig to check available catalog items, then retry with a valid itemId.` }], isError: true };
            }
          }

          // Validate calculationType requirements
          const hasTierUnits = !!rest.tierUnits && Object.values(rest.tierUnits).some((value) => Number(value) !== 0);
          if ((calcType === "tiered_rate" || calcType === "duration_rate") && src === "rate_schedule" && !hasTierUnits) {
            return { content: [{ type: "text" as const, text: `ERROR: Category "${catConfig.name}" uses ${calcType} calculation with rate-schedule pricing, so tierUnits are required. Without tierUnits, this item will calculate to $0.` }], isError: true };
          }

          // Auto-apply default markup for markup-eligible categories when not explicitly set
          if (catConfig.editableFields?.markup && (rest.markup === 0 || rest.markup === undefined)) {
            const rev = ws.currentRevision || {};
            const revMarkup: number = rev.defaultMarkup ?? 0;
            if (revMarkup > 0) {
              // Revision stores markup as decimal (0.15 for 15%) — pass through directly
              rest.markup = revMarkup > 1 ? revMarkup / 100 : revMarkup;
            }
          }
        }
      } catch {
        // Workspace not available — let API-level validation handle it
      }

      // Normalize markup to decimal: agent may send 15 for 15%, DB stores 0.15
      const normalizedMarkup = (rest.markup || 0) > 1 ? (rest.markup || 0) / 100 : (rest.markup || 0);
      rest.markup = normalizedMarkup;
      const price = rest.price ?? (rest.cost || 0) * (1 + normalizedMarkup);
      const cat = resolvedCategory?.name ?? requestedCategory ?? rest.category;
      if (!cat) {
        return { content: [{ type: "text" as const, text: "ERROR: categoryId could not be resolved from the current workspace. Call getItemConfig and retry with a valid categoryId or category name." }], isError: true };
      }
      const body = { ...rest, category: cat, categoryId: resolvedCategory?.id ?? rest.categoryId, entityType: resolvedCategory?.entityType ?? rest.entityType ?? cat, price };
      try {
        const data = await apiPost(projectPath(`/worksheets/${worksheetId}/items`), body);
        invalidateWs();
        const itemId = (data as any)?.id || (data as any)?.item?.id || "";
        return { content: [{ type: "text" as const, text: toolUiText(`Created item: ${rest.entityName} (${cat})`, {
          kind: "worksheet_item.created",
          worksheetId,
          itemId,
          entityName: rest.entityName,
          category: cat,
          categoryId: body.categoryId ?? null,
          quantity: rest.quantity,
          uom: rest.uom,
          unitCost: rest.cost ?? 0,
          unitPrice: price,
          sourceNotes: rest.sourceNotes ?? "",
        }) }] };
      } catch (err: any) {
        const msg = err?.message || String(err);
        return { content: [{ type: "text" as const, text: `ERROR creating item "${rest.entityName}": ${msg}. Check field values and try again.` }], isError: true };
      }
    }
  );

  // ── updateWorksheetItem ───────────────────────────────────
  server.tool(
    "updateWorksheetItem",
    "Update an existing line item. Only provided fields are changed. When re-pointing an item at a different rate-schedule item (e.g. swapping MECH labour for SHOP labour), pass BOTH rateScheduleItemId AND tierUnits in the same call — the server keeps the previously persisted tierUnits otherwise, leaving stale tier IDs that price to $0.",
    {
      itemId: z.string().describe("Line item ID"),
      entityName: z.string().optional(),
      categoryId: z.string().nullable().optional().describe("Stable EntityCategory ID from getItemConfig. Prefer this when changing category."),
      category: z.string().optional(),
      description: z.string().optional(),
      quantity: z.number().optional(),
      uom: z.string().optional(),
      cost: z.number().optional(),
      markup: z.number().optional(),
      price: z.number().optional(),
      rateScheduleItemId: z.string().nullable().optional().describe("Rate schedule item ID. Pass null to clear. When changing this, also pass tierUnits."),
      costResourceId: z.string().nullable().optional().describe("Cost intelligence resource ID. Pass null to clear."),
      effectiveCostId: z.string().nullable().optional().describe("Effective cost ID. Pass null to clear."),
      laborUnitId: z.string().nullable().optional().describe("Labor unit ID. Pass null to clear."),
      resourceComposition: z.record(z.unknown()).optional(),
      sourceEvidence: z.record(z.unknown()).optional(),
      tierUnits: z.record(z.number()).optional().describe("Units per rate tier — keys are tier IDs (or tier names; server resolves) for the rate schedule referenced by rateScheduleItemId. REQUIRED when rateScheduleItemId changes."),
      classification: z.record(z.unknown()).optional().describe("Construction classification JSON, e.g. { masterformat: '03 30 00' }."),
      costCode: z.string().nullable().optional().describe("Internal cost code. Pass null to clear."),
      phaseId: z.string().nullable().optional().describe("Phase ID. Pass null to clear."),
      sourceNotes: z.string().optional(),
      catalogItemId: z.string().nullable().optional().describe("Catalog item ID for catalog-backed categories. Pass null to clear."),
    },
    async ({ itemId, catalogItemId, ...patch }) => {
      if (catalogItemId !== undefined) (patch as any).itemId = catalogItemId;
      // Normalize markup to decimal: agent sends 15 for 15%, DB stores 0.15
      if ((patch as any).markup !== undefined && (patch as any).markup > 1) {
        (patch as any).markup = (patch as any).markup / 100;
      }
      const data = await apiPatch(projectPath(`/worksheet-items/${itemId}`), patch);
      invalidateWs();
      const updated = (data as any)?.item || (data as any)?.worksheetItem || data || {};
      return { content: [{ type: "text" as const, text: toolUiText(`Updated item ${itemId}`, {
        kind: "worksheet_item.updated",
        worksheetId: updated.worksheetId ?? (patch as any).worksheetId ?? null,
        itemId,
        entityName: updated.entityName ?? (patch as any).entityName ?? null,
        category: updated.category ?? (patch as any).category ?? null,
        quantity: updated.quantity ?? (patch as any).quantity ?? null,
        uom: updated.uom ?? (patch as any).uom ?? null,
        unitCost: updated.cost ?? (patch as any).cost ?? null,
        unitPrice: updated.price ?? (patch as any).price ?? null,
        fields: Object.keys(patch),
        patch,
      }) }] };
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
    "Update the quote metadata — project name, client info, scope description, and customer-facing estimate notes. The description supports rich text (HTML). If you provide plain text with newlines, it will be auto-converted to HTML paragraphs. Use updateRevision.scratchpad for internal estimator notes or scratch work.",
    {
      projectName: z.string().optional(),
      clientName: z.string().optional(),
      clientEmail: z.string().optional(),
      projectAddress: z.string().optional(),
      notes: z.string().optional().describe("Customer-facing estimate notes that may appear in quote/PDF output. Do not put internal reasoning, TODOs, or private estimator scratch work here."),
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
      return { content: [{ type: "text" as const, text: toolUiText("Quote updated", {
        kind: "quote.updated",
        fields: Object.keys(input),
        projectName: input.projectName ?? null,
        clientName: input.clientName ?? null,
        descriptionUpdated: Boolean(input.description),
        notesUpdated: Boolean(input.notes),
      }) }] };
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
      await apiPost(projectPath("/schedule-tasks"), input);
      return { content: [{ type: "text" as const, text: `Created schedule task: ${input.name}` }] };
    }
  );

  // ── listScheduleTasks ─────────────────────────────────────
  server.tool(
    "listScheduleTasks",
    "List all schedule tasks and milestones for the project.",
    {},
    async () => {
      const data = await apiGet(projectPath("/schedule-tasks"));
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

      const data = await apiPost(projectPath("/rate-schedules/import"), { scheduleId: globalScheduleId });
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
  // ESTIMATE FACTORS — productivity, difficulty, weather, access
  // ═══════════════════════════════════════════════════════════

  const factorImpactSchema = z.enum(["labor_hours", "resource_units", "direct_cost", "sell_price"]);
  const factorConfidenceSchema = z.enum(["high", "medium", "low"]);
  const factorSourceTypeSchema = z.enum(["library", "knowledge", "labor_unit", "condition_difficulty", "neca_difficulty", "custom", "agent"]);
  const factorApplicationScopeSchema = z.enum(["global", "line", "both"]);
  const factorFormulaTypeSchema = z.enum(["fixed_multiplier", "per_unit_scale", "condition_score", "temperature_productivity", "neca_condition_score", "extended_duration"]);
  const factorScopeSchema = z.object({
    mode: z.enum(["all", "line", "category", "phase", "worksheet", "classification", "labor_unit", "cost_code", "text"]).optional(),
    worksheetItemIds: z.array(z.string()).optional(),
    categoryIds: z.array(z.string()).optional(),
    categoryNames: z.array(z.string()).optional(),
    analyticsBuckets: z.array(z.string()).optional(),
    phaseIds: z.array(z.string()).optional(),
    worksheetIds: z.array(z.string()).optional(),
    classificationCodes: z.array(z.string()).optional(),
    laborUnitIds: z.array(z.string()).optional(),
    costCodes: z.array(z.string()).optional(),
    text: z.array(z.string()).optional(),
  }).passthrough();

  server.tool(
    "listEstimateFactorLibrary",
    "List built-in and organization estimate productivity factors. Use this after reading knowledge books and labor units to seed weather, access, safety, schedule, methods, or condition difficulty factors.",
    {},
    async () => {
      const data = await apiGet(projectPath("/factors/library"));
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "createEstimateFactorLibraryEntry",
    "Create a reusable organization factor library entry. Use this when a researched factor should be available on future estimates; include sourceRef evidence from books, labor units, condition score sheets, or human-approved assumptions.",
    {
      name: z.string(),
      code: z.string().optional(),
      description: z.string().optional(),
      category: z.string().default("Productivity"),
      impact: factorImpactSchema.default("labor_hours"),
      value: z.number().min(0.05).max(10).describe("Multiplier, e.g. 1.10 for +10% or 0.92 for -8%"),
      appliesTo: z.string().default("Labour"),
      applicationScope: factorApplicationScopeSchema.default("both"),
      scope: factorScopeSchema.default({ mode: "all" }),
      formulaType: factorFormulaTypeSchema.default("fixed_multiplier"),
      parameters: z.record(z.unknown()).default({}),
      confidence: factorConfidenceSchema.default("medium"),
      sourceType: factorSourceTypeSchema.default("agent"),
      sourceId: z.string().nullable().optional(),
      sourceRef: z.record(z.unknown()).default({}),
      tags: z.array(z.string()).default([]),
    },
    async (input) => {
      const data = await apiPost("/factor-library", input);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "updateEstimateFactorLibraryEntry",
    "Update an editable organization factor library entry. Factory research presets are returned by the library listing as templates; organization entries are fully editable.",
    {
      entryId: z.string(),
      name: z.string().optional(),
      code: z.string().optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      impact: factorImpactSchema.optional(),
      value: z.number().min(0.05).max(10).optional(),
      appliesTo: z.string().optional(),
      applicationScope: factorApplicationScopeSchema.optional(),
      scope: factorScopeSchema.optional(),
      formulaType: factorFormulaTypeSchema.optional(),
      parameters: z.record(z.unknown()).optional(),
      confidence: factorConfidenceSchema.optional(),
      sourceType: factorSourceTypeSchema.optional(),
      sourceId: z.string().nullable().optional(),
      sourceRef: z.record(z.unknown()).optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ entryId, ...patch }) => {
      const data = await apiPatch(`/factor-library/${entryId}`, patch);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "deleteEstimateFactorLibraryEntry",
    "Delete an editable organization factor library entry.",
    { entryId: z.string() },
    async ({ entryId }) => {
      await apiDelete(`/factor-library/${entryId}`);
      return { content: [{ type: "text" as const, text: `Deleted factor library entry ${entryId}` }] };
    }
  );

  server.tool(
    "listEstimateFactors",
    "List estimate factors already applied to the current revision, including calculated target counts and value/cost/hour deltas.",
    {},
    async () => {
      const ws = await getWs();
      const data = {
        factors: ws.estimateFactors || [],
        factorTotals: ws.estimate?.totals?.factorTotals || [],
        beforeFactors: {
          lineSubtotal: ws.estimate?.totals?.lineSubtotalBeforeFactors,
          cost: ws.estimate?.totals?.costBeforeFactors,
          hours: ws.estimate?.totals?.totalHoursBeforeFactors,
        },
        afterFactors: {
          lineSubtotal: ws.estimate?.totals?.pricingLadder?.lineSubtotal ?? ws.estimate?.totals?.subtotal,
          cost: ws.estimate?.totals?.cost,
          hours: ws.estimate?.totals?.totalHours,
        },
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "createEstimateFactor",
    `Create an estimate productivity factor. Factors affect worksheet-derived production before rollups and quote modifiers. Use sourceType/sourceRef to cite the basis: knowledge book page, labor-unit difficulty column, condition difficulty bridge, or custom assumption. value is a multiplier: 1.10 = +10%, 0.92 = -8%.`,
    {
      name: z.string().describe("Factor name, e.g. Winter Weather, Confined Space, Shop Prefabrication"),
      code: z.string().optional(),
      description: z.string().optional(),
      category: z.string().default("Productivity"),
      impact: factorImpactSchema.default("labor_hours"),
      value: z.number().min(0.05).max(10).describe("Multiplier, e.g. 1.10 for +10% or 0.92 for -8%"),
      active: z.boolean().default(true),
      appliesTo: z.string().default("Labour"),
      applicationScope: factorApplicationScopeSchema.default("global"),
      scope: factorScopeSchema.default({ mode: "all" }).describe("Scope filters. For labor items use {mode:'category', analyticsBuckets:['labour']}; for a phase use phaseIds."),
      formulaType: factorFormulaTypeSchema.default("fixed_multiplier"),
      parameters: z.record(z.unknown()).default({}).describe("Formula inputs. For line factors use scope.worksheetItemIds; for condition scores use score/maxScore; for temperature use temperature, temperatureUnit, humidity."),
      confidence: factorConfidenceSchema.default("medium"),
      sourceType: factorSourceTypeSchema.default("agent"),
      sourceId: z.string().nullable().optional(),
      sourceRef: z.record(z.unknown()).default({}).describe("Evidence such as {bookId,page,quote,reasoning,presetId,laborUnitId}"),
      tags: z.array(z.string()).default([]),
    },
    async (input) => {
      await apiPost(projectPath("/factors"), input);
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Created estimate factor: ${input.name}` }] };
    }
  );

  server.tool(
    "updateEstimateFactor",
    "Update an estimate productivity factor. Use this to refine scope, multiplier, evidence, confidence, active state, or source references.",
    {
      factorId: z.string(),
      name: z.string().optional(),
      code: z.string().optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      impact: factorImpactSchema.optional(),
      value: z.number().min(0.05).max(10).optional(),
      active: z.boolean().optional(),
      appliesTo: z.string().optional(),
      applicationScope: factorApplicationScopeSchema.optional(),
      scope: factorScopeSchema.optional(),
      formulaType: factorFormulaTypeSchema.optional(),
      parameters: z.record(z.unknown()).optional(),
      confidence: factorConfidenceSchema.optional(),
      sourceType: factorSourceTypeSchema.optional(),
      sourceId: z.string().nullable().optional(),
      sourceRef: z.record(z.unknown()).optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ factorId, ...patch }) => {
      await apiPatch(projectPath(`/factors/${factorId}`), patch);
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Updated estimate factor ${factorId}` }] };
    }
  );

  server.tool(
    "deleteEstimateFactor",
    "Delete an estimate factor from the current revision.",
    { factorId: z.string() },
    async ({ factorId }) => {
      await apiDelete(projectPath(`/factors/${factorId}`));
      invalidateWs();
      return { content: [{ type: "text" as const, text: `Deleted estimate factor ${factorId}` }] };
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
    `Update revision-level settings — breakout style, dates, status, quote type, print options, customer-facing notes, internal scratchpad, and more. Use this to configure how the quote is presented to the client.`,
    {
      breakoutStyle: z.enum(["grand_total", "category", "phase", "phase_detail", "labour_material_equipment"]).optional()
        .describe("How costs are organized on the quote: grand_total (lump sum), category (by material/labour/etc), phase (by project phase), phase_detail (phases with category breakdown), labour_material_equipment (L/M/E columns)"),
      status: z.enum(["Open", "Pending", "Awarded", "DidNotGet", "Declined", "Cancelled", "Closed", "Other"]).optional(),
      type: z.enum(["Firm", "Budget", "BudgetDNE"]).optional().describe("Quote type: Firm (binding), Budget (estimate), BudgetDNE (do not exceed)"),
      title: z.string().optional().describe("Revision title"),
      description: z.string().optional(),
      notes: z.string().optional().describe("Customer-facing estimate notes that may appear in quote/PDF output."),
      scratchpad: z.string().optional().describe("Internal estimator/agent notes and scratch work. Not customer-facing."),
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
      grandTotal: z.number().optional().describe("Manual grand total"),
      printEmptyNotesColumn: z.boolean().optional(),
      printPhaseTotalOnly: z.boolean().optional().describe("Show only phase totals, hide individual items"),
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
    "Apply a summary preset to configure quote breakout. Presets: quick_total (single total), by_category (per category), by_phase (per phase), by_worksheet (per worksheet), by_masterformat_division, by_uniformat_division, by_omniclass_division, by_uniclass_division, by_din276_division, by_nrm_division, by_icms_division, by_cost_code, phase_x_category (phases with category detail), custom (empty). After applying, rows can be individually customized.",
    {
      preset: z.enum(["quick_total", "by_category", "by_phase", "by_worksheet", "by_masterformat_division", "by_uniformat_division", "by_omniclass_division", "by_uniclass_division", "by_din276_division", "by_nrm_division", "by_icms_division", "by_cost_code", "phase_x_category", "custom"]).describe("Preset name"),
    },
    async ({ preset }) => {
      await apiPost(projectPath("/summary-rows/apply-preset"), { preset });
      return { content: [{ type: "text" as const, text: toolUiText(`Applied summary preset: ${preset}`, {
        kind: "summary_preset.applied",
        preset,
      }) }] };
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
