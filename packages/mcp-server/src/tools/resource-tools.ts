import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, projectPath } from "../api-client.js";

const sourceTypeSchema = z.enum([
  "catalog_item",
  "rate_schedule_item",
  "cost_resource",
  "effective_cost",
  "labor_unit",
  "assembly",
  "plugin_tool",
  "external_action",
]);

type SearchCandidate = {
  id?: string;
  sourceType?: string;
  sourceId?: string;
  actionType?: string;
  category?: string;
  entityType?: string;
  title?: string;
  subtitle?: string;
  code?: string;
  vendor?: string;
  uom?: string;
  unitCost?: number | null;
  unitPrice?: number | null;
  payload?: Record<string, unknown>;
  score?: number;
};

type EntityCategoryRecord = {
  id: string;
  name: string;
  entityType?: string | null;
  itemSource?: string | null;
  calculationType?: string | null;
  analyticsBucket?: string | null;
  enabled?: boolean | null;
  order?: number | null;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeMarkup(markup: number | undefined, fallback = 0): number {
  const raw = Number.isFinite(markup) ? markup! : fallback;
  return raw > 1 ? raw / 100 : raw;
}

function normalizeKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function workspaceCategories(workspacePayload: any): EntityCategoryRecord[] {
  const workspace = workspacePayload?.workspace ?? workspacePayload ?? {};
  const categories = workspace.entityCategories ?? workspace.workspace?.entityCategories ?? [];
  return Array.isArray(categories) ? categories : [];
}

function sortedEnabledCategories(categories: EntityCategoryRecord[]) {
  return categories
    .filter((category) => category.enabled !== false)
    .slice()
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

function findCategoryByIdOrName(
  categories: EntityCategoryRecord[],
  input: { categoryId?: string | null; category?: string | null; entityType?: string | null },
): EntityCategoryRecord | undefined {
  const byId = normalizeKey(input.categoryId);
  if (byId) {
    const match = categories.find((category) => normalizeKey(category.id) === byId);
    if (match) return match;
    return undefined;
  }

  const names = [input.category, input.entityType].map(normalizeKey).filter(Boolean);
  for (const name of names) {
    const match = categories.find((category) =>
      normalizeKey(category.name) === name ||
      normalizeKey(category.entityType) === name
    );
    if (match) return match;
  }

  return undefined;
}

function findCategoryByBucket(categories: EntityCategoryRecord[], buckets: string[]) {
  const enabled = sortedEnabledCategories(categories);
  const normalizedBuckets = buckets.map(normalizeKey).filter(Boolean);
  for (const bucket of normalizedBuckets) {
    const match = enabled.find((category) =>
      normalizeKey(category.analyticsBucket) === bucket ||
      normalizeKey(category.entityType).includes(bucket) ||
      normalizeKey(category.name).includes(bucket)
    );
    if (match) return match;
  }
  return undefined;
}

function resolveCandidateCategory(
  candidate: SearchCandidate,
  input: { categoryId?: string | null; category?: string | null; entityType?: string | null },
  categories: EntityCategoryRecord[],
) {
  const payload = asObject(candidate.payload);
  const requestedCategoryId = input.categoryId ?? stringValue(payload.categoryId);
  if (requestedCategoryId) {
    return findCategoryByIdOrName(categories, { categoryId: requestedCategoryId });
  }
  const direct = findCategoryByIdOrName(categories, {
    category: input.category ?? stringValue(payload.category),
    entityType: input.entityType ?? stringValue(payload.entityType),
  });
  if (direct) return direct;

  const candidateDirect = findCategoryByIdOrName(categories, {
    category: candidate.category,
    entityType: candidate.entityType,
  });
  if (candidateDirect) return candidateDirect;

  if (candidate.sourceType === "labor_unit") {
    const labour = findCategoryByBucket(categories, ["labour", "labor"]);
    if (labour) return labour;
  }

  const resourceType = normalizeKey(payload.resourceType) || normalizeKey(payload.componentType) || normalizeKey(candidate.category);
  if (resourceType.includes("equip")) {
    const equipment = findCategoryByBucket(categories, ["equipment"]);
    if (equipment) return equipment;
  }
  if (resourceType.includes("subcontract") || resourceType.includes("contractor")) {
    const subcontract = findCategoryByBucket(categories, ["subcontract", "subcontractor"]);
    if (subcontract) return subcontract;
  }
  if (resourceType.includes("labour") || resourceType.includes("labor")) {
    const labour = findCategoryByBucket(categories, ["labour", "labor"]);
    if (labour) return labour;
  }
  if (resourceType.includes("material") || resourceType.includes("product") || candidate.sourceType === "cost_resource" || candidate.sourceType === "effective_cost") {
    const material = findCategoryByBucket(categories, ["material"]);
    if (material) return material;
  }

  return findCategoryByBucket(categories, ["material"]) ?? sortedEnabledCategories(categories)[0];
}

function categoryNameForSearch(categoryId: string | undefined, category: string | undefined, categories: EntityCategoryRecord[]) {
  if (category) return category;
  const match = findCategoryByIdOrName(categories, { categoryId });
  return match?.name;
}

function queryString(input: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(","));
    } else {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function candidateLinks(candidate: SearchCandidate) {
  const payload = asObject(candidate.payload);
  return {
    rateScheduleItemId: stringValue(payload.rateScheduleItemId),
    itemId: stringValue(payload.itemId) ?? stringValue(payload.catalogItemId),
    costResourceId: stringValue(payload.costResourceId),
    effectiveCostId: stringValue(payload.effectiveCostId),
    laborUnitId: stringValue(payload.laborUnitId),
  };
}

function fallbackResourceComposition(candidate: SearchCandidate, links = candidateLinks(candidate)) {
  if (!links.rateScheduleItemId && !links.itemId && !links.costResourceId && !links.effectiveCostId && !links.laborUnitId) {
    return {};
  }
  return {
    source: candidate.sourceType ?? "line_item_search",
    resources: [{
      componentType: candidate.sourceType ?? "line_item_search",
      ...links,
      uom: candidate.uom ?? null,
      unitCost: candidate.unitCost ?? null,
      unitPrice: candidate.unitPrice ?? null,
    }],
  };
}

function fallbackSourceEvidence(candidate: SearchCandidate) {
  return {
    source: candidate.sourceType ?? "line_item_search",
    sourceId: candidate.sourceId ?? null,
    searchDocumentId: candidate.id ?? null,
    subtitle: candidate.subtitle ?? "",
  };
}

function worksheetItemFromCandidate(
  candidate: SearchCandidate,
  input: {
    quantity?: number;
    markup?: number;
    defaultMarkup?: number;
    categoryId?: string | null;
    category?: string;
    entityType?: string;
    entityName?: string;
    description?: string;
    uom?: string;
    cost?: number;
    price?: number;
    sourceNotes?: string;
    phaseId?: string | null;
    lineOrder?: number;
  } = {},
  categories: EntityCategoryRecord[] = [],
) {
  const payload = asObject(candidate.payload);
  const links = candidateLinks(candidate);
  const category = resolveCandidateCategory(candidate, input, categories);
  const markup = normalizeMarkup(input.markup, input.defaultMarkup ?? 0);
  const cost = input.cost ?? candidate.unitCost ?? numberValue(payload.unitCost) ?? 0;
  const price = input.price ?? candidate.unitPrice ?? numberValue(payload.unitPrice) ?? cost * (1 + markup);
  const resourceComposition = asObject(payload.resourceComposition);
  const sourceEvidence = asObject(payload.sourceEvidence);
  return {
    phaseId: input.phaseId ?? null,
    categoryId: category?.id ?? input.categoryId ?? null,
    category: category?.name ?? input.category ?? candidate.category ?? candidate.entityType ?? "Material",
    entityType: category?.entityType ?? input.entityType ?? candidate.entityType ?? candidate.category ?? "Material",
    entityName: input.entityName ?? candidate.title ?? "Line item",
    vendor: candidate.vendor || null,
    description: input.description ?? stringValue(payload.description) ?? candidate.subtitle ?? candidate.title ?? "",
    quantity: input.quantity ?? 1,
    uom: input.uom ?? candidate.uom ?? "EA",
    cost,
    markup,
    price,
    lineOrder: input.lineOrder,
    ...links,
    tierUnits: asObject(payload.tierUnits),
    sourceNotes: input.sourceNotes ?? stringValue(payload.sourceNotes) ?? candidate.subtitle ?? "",
    resourceComposition: Object.keys(resourceComposition).length ? resourceComposition : fallbackResourceComposition(candidate, links),
    sourceEvidence: Object.keys(sourceEvidence).length ? sourceEvidence : fallbackSourceEvidence(candidate),
  };
}

async function searchCandidates(input: {
  q?: string;
  categoryId?: string;
  category?: string;
  worksheetId?: string;
  sourceTypes?: string[];
  limit?: number;
  offset?: number;
  refresh?: boolean;
}) {
  return await apiGet<SearchCandidate[]>(
    projectPath(`/line-item-search${queryString({
      q: input.q,
      category: input.category,
      worksheetId: input.worksheetId,
      sourceTypes: input.sourceTypes,
      limit: input.limit,
      offset: input.offset,
      refresh: input.refresh,
    })}`),
  );
}

export function registerResourceTools(server: McpServer) {
  server.tool(
    "searchLineItemCandidates",
    "Search the unified Bidwright line-item index for catalog items, imported rates, cost-intelligence effective costs, cost resources, labor units, assemblies, and provider actions. Use this before creating priced worksheet rows.",
    {
      q: z.string().optional().describe("Search terms, item name, cost code, vendor, or scope phrase."),
      categoryId: z.string().optional().describe("Stable EntityCategory id to prefer for category-aware search."),
      category: z.string().optional().describe("Preferred worksheet category/entity type, e.g. Labour, Material, Equipment."),
      worksheetId: z.string().optional(),
      sourceTypes: z.array(sourceTypeSchema).optional(),
      limit: z.number().int().positive().max(100).default(20),
      offset: z.number().int().min(0).optional(),
      refresh: z.boolean().default(false).describe("Rebuild the search index before searching."),
    },
    async (input) => {
      const ws = input.categoryId ? await apiGet<any>(projectPath("/workspace")).catch(() => null) : null;
      const categories = workspaceCategories(ws);
      const results = await searchCandidates({
        ...input,
        category: categoryNameForSearch(input.categoryId, input.category, categories),
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.tool(
    "recommendCostSource",
    "Return the best structured cost source for a scope phrase and a ready-to-use worksheet item patch. Prefer this over freeform prices.",
    {
      q: z.string().describe("Scope phrase or item to price."),
      categoryId: z.string().optional().describe("Stable EntityCategory id to prefer for the resulting worksheet item."),
      category: z.string().optional().describe("Preferred worksheet category/entity type."),
      worksheetId: z.string().optional(),
      sourceTypes: z.array(sourceTypeSchema).optional(),
      limit: z.number().int().positive().max(50).default(12),
      quantity: z.number().positive().optional(),
      markup: z.number().optional().describe("Markup as decimal or percent. 0.15 and 15 both mean 15%."),
      refresh: z.boolean().default(false),
    },
    async (input) => {
      const ws = await apiGet<any>(projectPath("/workspace")).catch(() => null);
      const categories = workspaceCategories(ws);
      const defaultMarkup = Number(ws?.workspace?.currentRevision?.defaultMarkup ?? ws?.currentRevision?.defaultMarkup ?? 0);
      const results = await searchCandidates({
        ...input,
        category: categoryNameForSearch(input.categoryId, input.category, categories),
      });
      const isDirectlyCreateable = (result: SearchCandidate) => {
        if (result.actionType !== "select") return false;
        if (result.sourceType === "external_action" || result.sourceType === "plugin_tool") return false;
        if (result.sourceType === "labor_unit" && !candidateLinks(result).rateScheduleItemId) return false;
        return result.unitCost != null || result.unitPrice != null || Object.values(candidateLinks(result)).some(Boolean);
      };
      const preferred = results.find((result) =>
        isDirectlyCreateable(result)
      ) ?? results.find((result) => result.actionType === "select") ?? results[0];

      if (!preferred) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ recommendation: null, candidates: [], warning: "No candidates found." }, null, 2) }],
          isError: true,
        };
      }

      const suggestedWorksheetItem = worksheetItemFromCandidate(preferred, {
        quantity: input.quantity,
        markup: input.markup,
        defaultMarkup,
        categoryId: input.categoryId,
        category: input.category,
      }, categories);
      const warning = preferred.sourceType === "labor_unit" && !candidateLinks(preferred).rateScheduleItemId
        ? "This is a labour productivity source, not a priced rate item. Apply its laborUnitId/unit values to a labour line, then choose an imported rate schedule item to price the row."
        : undefined;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            recommendation: preferred,
            suggestedWorksheetItem,
            warning,
            alternates: results.filter((result) => result.id !== preferred.id).slice(0, 5),
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "createWorksheetItemFromCandidate",
    "Create a worksheet item from a candidate returned by searchLineItemCandidates or recommendCostSource, preserving structured cost-resource provenance.",
    {
      worksheetId: z.string(),
      candidate: z.record(z.unknown()).optional().describe("A candidate object returned by searchLineItemCandidates/recommendCostSource."),
      candidateId: z.string().optional().describe("Search-document id from a prior search. Provide q/category if using candidateId."),
      q: z.string().optional(),
      categoryId: z.string().optional(),
      category: z.string().optional(),
      quantity: z.number().positive().default(1),
      markup: z.number().optional(),
      entityName: z.string().optional(),
      description: z.string().optional(),
      uom: z.string().optional(),
      cost: z.number().optional(),
      price: z.number().optional(),
      sourceNotes: z.string().optional(),
      phaseId: z.string().nullable().optional(),
    },
    async (input) => {
      let candidate = input.candidate as SearchCandidate | undefined;
      if (!candidate && input.candidateId) {
        const candidates = await searchCandidates({ q: input.q, category: input.category, limit: 100 });
        candidate = candidates.find((result) => result.id === input.candidateId);
      }
      if (!candidate) {
        return { content: [{ type: "text" as const, text: "No candidate was provided or found. Call searchLineItemCandidates first." }], isError: true };
      }
      if (candidate.actionType && candidate.actionType !== "select") {
        return { content: [{ type: "text" as const, text: `Candidate ${candidate.id ?? ""} is an action (${candidate.actionType}), not a selectable cost source.` }], isError: true };
      }
      if (candidate.sourceType === "labor_unit" && !candidateLinks(candidate).rateScheduleItemId) {
        return {
          content: [{
            type: "text" as const,
            text: "This candidate is a labour productivity unit. It can supply laborUnitId and hours/unit, but it is not itself a priced line item. Create or select a labour row with an imported rateScheduleItemId, then apply this candidate's laborUnitId/unit values to that row.",
          }],
          isError: true,
        };
      }

      const ws = await apiGet<any>(projectPath("/workspace")).catch(() => null);
      const categories = workspaceCategories(ws);
      const defaultMarkup = Number(ws?.workspace?.currentRevision?.defaultMarkup ?? ws?.currentRevision?.defaultMarkup ?? 0);
      const body = worksheetItemFromCandidate(candidate, {
        ...input,
        defaultMarkup,
      }, categories);
      const data = await apiPost(projectPath(`/worksheets/${input.worksheetId}/items`), body);
      const created = (data as any)?.item ?? (data as any)?.workspace?.worksheets
        ?.flatMap((worksheet: any) => worksheet.items ?? [])
        ?.find((item: any) => item.entityName === body.entityName);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ createdItemId: created?.id ?? null, worksheetItem: body }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "listLaborUnits",
    "List labor-productivity units from the labor-unit libraries. Use this when a labour row needs hours/unit, difficulty basis, or a laborUnitId.",
    {
      q: z.string().optional(),
      provider: z.string().optional(),
      category: z.string().optional(),
      className: z.string().optional(),
      libraryId: z.string().optional(),
      limit: z.number().int().positive().max(100).default(25),
      offset: z.number().int().min(0).optional(),
    },
    async (input) => {
      const data = await apiGet(`/api/labor-units/units${queryString(input)}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "previewAssembly",
    "Preview an assembly expansion and resource rollup before inserting it into a worksheet. Use this for assembly-backed scope instead of hand-building all child rows.",
    {
      assemblyId: z.string(),
      quantity: z.number().positive().default(1),
      parameterValues: z.record(z.union([z.number(), z.string()])).optional(),
    },
    async (input) => {
      const data = await apiPost("/api/assemblies/preview", input);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}
