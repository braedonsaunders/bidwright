import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiPost, getProjectId, projectPath } from "../api-client.js";

const sourceTypeSchema = z.enum([
  "catalog_item",
  "rate_schedule_item",
  "effective_cost",
  "labor_unit",
  "assembly",
  "plugin_tool",
  "external_action",
]);

const takeoffQuantityFieldSchema = z.enum(["value", "area", "volume", "count"]);

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

type BasisMatchType = "exact" | "similar" | "context" | "fallback";
type SourceQuality = "strong" | "good" | "weak" | "missing";

type SourceBasis = {
  kind: string;
  label: string;
  description?: string;
  matchType?: BasisMatchType;
  sourceQuality?: SourceQuality;
  confidence?: number;
  query?: string;
  sourceType?: string;
  sourceId?: string | null;
  sourceName?: string;
  documentId?: string;
  pageNumber?: number;
  annotationId?: string;
  takeoffLinkId?: string;
  modelId?: string;
  modelElementId?: string;
  modelTakeoffLinkId?: string;
  costResourceId?: string | null;
  effectiveCostId?: string | null;
  laborUnitId?: string | null;
  rateScheduleItemId?: string | null;
  itemId?: string | null;
  vendor?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
};

type EnrichedSearchCandidate = SearchCandidate & {
  basis: SourceBasis;
  matchType: BasisMatchType;
  sourceQuality: SourceQuality;
};

type EnrichedLaborUnit = Record<string, unknown> & {
  basis: SourceBasis;
  matchType?: BasisMatchType;
  sourceQuality?: SourceQuality;
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
  if (resourceType.includes("material") || resourceType.includes("product") || candidate.sourceType === "effective_cost") {
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

function tokenizeSearch(value: unknown): string[] {
  const text = normalizeKey(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!text) return [];
  const stop = new Set(["and", "the", "for", "with", "from", "inch", "inches", "each", "unit", "item"]);
  return text.split(/\s+/).filter((token) => token.length > 1 && !stop.has(token));
}

function candidateHaystack(candidate: SearchCandidate) {
  const payload = asObject(candidate.payload);
  return [
    candidate.title,
    candidate.subtitle,
    candidate.code,
    candidate.vendor,
    candidate.category,
    candidate.entityType,
    payload.description,
    payload.name,
    payload.code,
    payload.vendor,
    payload.manufacturer,
    payload.model,
  ].map((value) => typeof value === "string" ? value : "").join(" ");
}

function determineCandidateMatchType(candidate: SearchCandidate, q?: string): BasisMatchType {
  const query = normalizeKey(q);
  if (!query) return "context";

  const normalizedTitle = normalizeKey(candidate.title);
  const normalizedCode = normalizeKey(candidate.code);
  const normalizedVendor = normalizeKey(candidate.vendor);
  const haystack = normalizeKey(candidateHaystack(candidate));
  const score = candidate.score ?? 0;

  if (
    query === normalizedTitle ||
    query === normalizedCode ||
    query === normalizedVendor ||
    (normalizedCode && normalizedCode.includes(query)) ||
    (normalizedTitle && (normalizedTitle.startsWith(query) || query.startsWith(normalizedTitle))) ||
    score >= 95
  ) {
    return "exact";
  }

  const queryTokens = tokenizeSearch(query);
  const candidateTokens = new Set(tokenizeSearch(haystack));
  const overlap = queryTokens.filter((token) => candidateTokens.has(token)).length;
  const overlapRatio = queryTokens.length ? overlap / queryTokens.length : 0;

  if (overlap >= 2 || overlapRatio >= 0.55 || score >= 70) return "similar";
  if (overlap >= 1 || score >= 35 || (query && haystack.includes(query))) return "context";
  return "fallback";
}

function sourceQualityForCandidate(candidate: SearchCandidate, matchType: BasisMatchType): SourceQuality {
  const hasPrice = candidate.unitCost != null || candidate.unitPrice != null;
  const links = candidateLinks(candidate);
  const hasStructuredLink = Object.values(links).some(Boolean);

  if (matchType === "exact" && (hasPrice || hasStructuredLink)) return "strong";
  if ((matchType === "exact" || matchType === "similar") && (hasPrice || hasStructuredLink)) return "good";
  if (matchType === "context") return "weak";
  return "missing";
}

function candidateBasisKind(candidate: SearchCandidate, matchType: BasisMatchType): string {
  if (candidate.sourceType === "effective_cost") {
    if (matchType === "exact") return "cost_intelligence_exact";
    if (matchType === "similar") return "cost_intelligence_similar";
    return "cost_intelligence_context";
  }
  if (candidate.sourceType === "labor_unit") return "labor_unit";
  if (candidate.sourceType === "rate_schedule_item") return "rate_schedule";
  if (candidate.sourceType === "catalog_item") return "catalog";
  if (candidate.sourceType === "assembly") return "assembly";
  if (candidate.sourceType === "plugin_tool") return "plugin";
  return "manual";
}

function candidateSourceBasis(candidate: SearchCandidate, input: { q?: string } = {}): SourceBasis {
  const payload = asObject(candidate.payload);
  const links = candidateLinks(candidate);
  const matchType = determineCandidateMatchType(candidate, input.q);
  const sourceQuality = sourceQualityForCandidate(candidate, matchType);
  const label = candidate.title ?? stringValue(payload.name) ?? candidate.code ?? candidate.sourceType ?? "Line item source";
  const description = candidate.subtitle ?? stringValue(payload.description) ?? undefined;

  return {
    kind: candidateBasisKind(candidate, matchType),
    label,
    description,
    matchType,
    sourceQuality,
    confidence: candidate.score,
    query: input.q,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId ?? null,
    sourceName: stringValue(payload.sourceName) ?? stringValue(payload.libraryName),
    vendor: candidate.vendor,
    notes: matchType === "similar"
      ? "Similar source. Use as estimating context unless the spec/product details line up."
      : matchType === "context"
        ? "Context source. Useful for triangulation, not an exact priced match."
        : undefined,
    ...links,
    metadata: {
      searchDocumentId: candidate.id ?? null,
      actionType: candidate.actionType ?? null,
      category: candidate.category ?? null,
      entityType: candidate.entityType ?? null,
      uom: candidate.uom ?? null,
      unitCost: candidate.unitCost ?? null,
      unitPrice: candidate.unitPrice ?? null,
    },
  };
}

function enrichCandidateWithBasis(candidate: SearchCandidate, input: { q?: string } = {}): EnrichedSearchCandidate {
  const basis = candidateSourceBasis(candidate, input);
  return {
    ...candidate,
    basis,
    matchType: basis.matchType ?? "context",
    sourceQuality: basis.sourceQuality ?? "weak",
  };
}

function enrichCandidatesWithBasis(candidates: SearchCandidate[], input: { q?: string } = {}) {
  return candidates.map((candidate) => enrichCandidateWithBasis(candidate, input));
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

function fallbackSourceEvidence(candidate: SearchCandidate, input: { q?: string } = {}) {
  const basis = candidateSourceBasis(candidate, input);
  return {
    source: candidate.sourceType ?? "line_item_search",
    sourceId: candidate.sourceId ?? null,
    searchDocumentId: candidate.id ?? null,
    subtitle: candidate.subtitle ?? "",
    basis,
    basisTrail: [basis],
    matchType: basis.matchType,
    sourceQuality: basis.sourceQuality,
    pricing: {
      unitCost: candidate.unitCost ?? null,
      unitPrice: candidate.unitPrice ?? null,
      uom: candidate.uom ?? null,
      vendor: candidate.vendor ?? null,
    },
  };
}

function mergeSourceEvidence(candidate: SearchCandidate, existing: Record<string, unknown>, input: { q?: string } = {}) {
  const fallback = fallbackSourceEvidence(candidate, input);
  const existingTrail = Array.isArray(existing.basisTrail) ? existing.basisTrail : [];
  const trail = existingTrail.length ? existingTrail : fallback.basisTrail;
  return {
    ...fallback,
    ...existing,
    basis: existing.basis ?? fallback.basis,
    basisTrail: trail,
    matchType: existing.matchType ?? fallback.matchType,
    sourceQuality: existing.sourceQuality ?? fallback.sourceQuality,
  };
}

function sourceNotesFromCandidate(candidate: SearchCandidate, input: { q?: string } = {}) {
  const basis = candidateSourceBasis(candidate, input);
  const sourceLabel = `${basis.sourceType ?? "source"}${basis.sourceId ? ` ${basis.sourceId}` : ""}`;
  const matchNote = basis.matchType === "exact"
    ? "exact/strong match"
    : basis.matchType === "similar"
      ? "similar match used for context, not exact product equivalence"
      : basis.matchType === "context"
        ? "context source for triangulation, not exact product equivalence"
        : "fallback source";
  const vendor = candidate.vendor ? `; vendor ${candidate.vendor}` : "";
  const query = input.q ? `; query "${input.q}"` : "";
  return `${basis.label} from ${sourceLabel} (${matchNote}${vendor}${query}).`;
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
    q?: string;
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
  const mergedSourceEvidence = mergeSourceEvidence(candidate, sourceEvidence, { q: input.q });
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
    sourceNotes: input.sourceNotes ?? stringValue(payload.sourceNotes) ?? sourceNotesFromCandidate(candidate, { q: input.q }),
    resourceComposition: Object.keys(resourceComposition).length ? resourceComposition : fallbackResourceComposition(candidate, links),
    sourceEvidence: mergedSourceEvidence,
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

function isDirectlyCreateableCandidate(result: SearchCandidate) {
  if (result.actionType !== "select") return false;
  if (result.sourceType === "external_action" || result.sourceType === "plugin_tool") return false;
  if (result.sourceType === "labor_unit" && !candidateLinks(result).rateScheduleItemId) return false;
  return result.unitCost != null || result.unitPrice != null || Object.values(candidateLinks(result)).some(Boolean);
}

function unitsFromPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((unit): unit is Record<string, unknown> => typeof unit === "object" && unit !== null && !Array.isArray(unit));
  const object = asObject(payload);
  const units = object.units;
  return Array.isArray(units)
    ? units.filter((unit): unit is Record<string, unknown> => typeof unit === "object" && unit !== null && !Array.isArray(unit))
    : [];
}

function laborUnitBasis(unit: Record<string, unknown>, q?: string): SourceBasis {
  const haystack = [
    unit.name,
    unit.code,
    unit.description,
    unit.category,
    unit.className,
    unit.subClassName,
  ].map((value) => typeof value === "string" ? value : "").join(" ");
  const syntheticCandidate: SearchCandidate = {
    sourceType: "labor_unit",
    sourceId: stringValue(unit.id),
    title: stringValue(unit.name) ?? stringValue(unit.code),
    subtitle: stringValue(unit.description) ?? haystack,
    code: stringValue(unit.code),
    uom: stringValue(unit.outputUom),
    payload: {
      laborUnitId: stringValue(unit.id),
      hoursNormal: numberValue(unit.hoursNormal),
      defaultDifficulty: stringValue(unit.defaultDifficulty),
    },
    score: undefined,
  };
  return candidateSourceBasis(syntheticCandidate, { q });
}

function enrichLaborUnits(payload: unknown, q?: string): EnrichedLaborUnit[] {
  return unitsFromPayload(payload).map((unit) => {
    const basis = laborUnitBasis(unit, q);
    return {
      ...unit,
      basis,
      matchType: basis.matchType,
      sourceQuality: basis.sourceQuality,
    };
  });
}

function annotationsFromPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((annotation): annotation is Record<string, unknown> => typeof annotation === "object" && annotation !== null && !Array.isArray(annotation));
  const object = asObject(payload);
  const annotations = object.annotations;
  return Array.isArray(annotations)
    ? annotations.filter((annotation): annotation is Record<string, unknown> => typeof annotation === "object" && annotation !== null && !Array.isArray(annotation))
    : [];
}

function annotationMeasurement(annotation: Record<string, unknown>) {
  const measurement = asObject(annotation.measurement);
  return {
    value: numberValue(measurement.value),
    area: numberValue(measurement.area),
    volume: numberValue(measurement.volume),
    height: numberValue(measurement.height),
    unit: stringValue(measurement.unit),
  };
}

function annotationMatchesQuery(annotation: Record<string, unknown>, q?: string) {
  const tokens = tokenizeSearch(q);
  if (!tokens.length) return true;
  const metadata = asObject(annotation.metadata);
  const haystack = normalizeKey([
    annotation.label,
    annotation.groupName,
    annotation.annotationType,
    metadata.symbolLabel,
    metadata.symbolDescription,
    metadata.layer,
    metadata.source,
  ].map((value) => typeof value === "string" ? value : "").join(" "));
  return tokens.some((token) => haystack.includes(token));
}

async function findTakeoffHints(input: { q?: string; limit?: number; documentId?: string }) {
  const projectId = getProjectId();
  if (!projectId) return [];
  const annotations = await apiGet(`/api/takeoff/${projectId}/annotations${queryString({ documentId: input.documentId })}`)
    .then(annotationsFromPayload)
    .catch(() => []);
  return annotations
    .filter((annotation) => annotationMatchesQuery(annotation, input.q))
    .slice(0, input.limit ?? 8)
    .map((annotation) => {
      const measurement = annotationMeasurement(annotation);
      const label = stringValue(annotation.label) ?? stringValue(annotation.groupName) ?? "Takeoff annotation";
      const basis: SourceBasis = {
        kind: stringValue(annotation.annotationType)?.includes("count") ? "takeoff" : "takeoff",
        label,
        description: stringValue(annotation.groupName) ?? stringValue(annotation.annotationType),
        matchType: annotationMatchesQuery(annotation, input.q) ? "similar" : "context",
        sourceQuality: "good",
        query: input.q,
        documentId: stringValue(annotation.documentId),
        pageNumber: numberValue(annotation.pageNumber),
        annotationId: stringValue(annotation.id),
        metadata: {
          annotationType: stringValue(annotation.annotationType),
          measurement,
        },
      };
      return {
        id: annotation.id,
        documentId: annotation.documentId,
        pageNumber: annotation.pageNumber,
        annotationType: annotation.annotationType,
        label,
        groupName: annotation.groupName,
        measurement,
        basis,
      };
    });
}

function groupedCandidates(candidates: EnrichedSearchCandidate[]) {
  return {
    exact: candidates.filter((candidate) => candidate.matchType === "exact"),
    similar: candidates.filter((candidate) => candidate.matchType === "similar"),
    context: candidates.filter((candidate) => candidate.matchType === "context" || candidate.matchType === "fallback"),
  };
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
      return { content: [{ type: "text" as const, text: JSON.stringify(enrichCandidatesWithBasis(results, { q: input.q }), null, 2) }] };
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
      const enrichedResults = enrichCandidatesWithBasis(results, { q: input.q });
      const preferred = enrichedResults.find((result) =>
        isDirectlyCreateableCandidate(result)
      ) ?? enrichedResults.find((result) => result.actionType === "select") ?? enrichedResults[0];

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
        q: input.q,
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
            basis: preferred.basis,
            matchType: preferred.matchType,
            sourceQuality: preferred.sourceQuality,
            warning,
            alternates: enrichedResults.filter((result) => result.id !== preferred.id).slice(0, 5),
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "recommendEstimateBasis",
    "Find the best source basis for an estimate row: exact cost intelligence when available, similar vendor/product context when useful, labor productivity units, and existing takeoff annotations. Use this before creating or updating priced worksheet rows.",
    {
      q: z.string().describe("Scope phrase, product, activity, material, or line item to estimate."),
      categoryId: z.string().optional().describe("Stable EntityCategory id to prefer for category-aware search."),
      category: z.string().optional().describe("Preferred worksheet category/entity type, e.g. Labour, Material, Equipment."),
      worksheetId: z.string().optional(),
      sourceTypes: z.array(sourceTypeSchema).optional(),
      limit: z.number().int().positive().max(50).default(12),
      quantity: z.number().positive().optional(),
      markup: z.number().optional().describe("Markup as decimal or percent. 0.15 and 15 both mean 15%."),
      includeLabor: z.boolean().default(true).describe("Also search labor-unit productivity libraries for hours/unit context."),
      includeTakeoff: z.boolean().default(true).describe("Also surface existing PDF/DWG takeoff annotations that may support quantity."),
      documentId: z.string().optional().describe("Optional drawing/document id to narrow takeoff annotation hints."),
      refresh: z.boolean().default(false),
    },
    async (input) => {
      const ws = await apiGet<any>(projectPath("/workspace")).catch(() => null);
      const categories = workspaceCategories(ws);
      const defaultMarkup = Number(ws?.workspace?.currentRevision?.defaultMarkup ?? ws?.currentRevision?.defaultMarkup ?? 0);
      const searchCategory = categoryNameForSearch(input.categoryId, input.category, categories);

      const [rawCandidates, laborPayload, takeoffHints] = await Promise.all([
        searchCandidates({
          ...input,
          category: searchCategory,
        }),
        input.includeLabor
          ? apiGet(`/api/labor-units/units${queryString({ q: input.q, category: searchCategory, limit: 10 })}`).catch(() => null)
          : Promise.resolve(null),
        input.includeTakeoff
          ? findTakeoffHints({ q: input.q, documentId: input.documentId, limit: 8 })
          : Promise.resolve([]),
      ]);

      const candidates = enrichCandidatesWithBasis(rawCandidates, { q: input.q });
      const preferred = candidates.find((candidate) =>
        isDirectlyCreateableCandidate(candidate) && candidate.matchType === "exact"
      ) ?? candidates.find((candidate) =>
        isDirectlyCreateableCandidate(candidate) && candidate.matchType === "similar"
      ) ?? candidates.find(isDirectlyCreateableCandidate) ?? candidates[0];

      const suggestedWorksheetItem = preferred
        ? worksheetItemFromCandidate(preferred, {
            quantity: input.quantity,
            markup: input.markup,
            defaultMarkup,
            categoryId: input.categoryId,
            category: input.category,
            q: input.q,
          }, categories)
        : null;
      const warnings: string[] = [];
      if (!preferred) {
        warnings.push("No structured cost candidate was found. Use document/web evidence and record the basis as sourceNotes.");
      } else if (preferred.matchType !== "exact") {
        warnings.push("Best cost candidate is not an exact match. Treat it as similar/context evidence unless specs, vendor, size, and UOM line up.");
      }
      if (preferred?.sourceType === "labor_unit" && !candidateLinks(preferred).rateScheduleItemId) {
        warnings.push("The recommended labor unit supplies productivity only. Pair it with an imported rate-schedule item to price the labor row.");
      }
      if (input.includeTakeoff && takeoffHints.length === 0) {
        warnings.push("No matching takeoff annotation was found. If drawings drive this quantity, use the vision/model/takeoff tools and save or link the annotation.");
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            query: input.q,
            recommendation: preferred ?? null,
            suggestedWorksheetItem,
            basis: preferred?.basis ?? null,
            candidates: groupedCandidates(candidates),
            laborUnits: laborPayload ? enrichLaborUnits(laborPayload, input.q) : [],
            takeoffHints,
            warnings,
            guidance: [
              "Prefer exact structured sources for priced rows; keep costResourceId, effectiveCostId, rateScheduleItemId, itemId, laborUnitId, sourceEvidence, and resourceComposition when present.",
              "Use similar cost-intelligence/vendor/product matches as context and say so in sourceNotes; they are useful for triangulation, not automatic exact pricing.",
              "For labor, search and attach a labor unit for productivity, then price the row with the appropriate rate-schedule item or justified rate.",
              "When the quantity comes from drawings/models, save or link the takeoff/model evidence and include the annotation/model basis in sourceEvidence/sourceNotes.",
            ],
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "recommendLaborBasis",
    "Search labor productivity units plus labor/rate cost sources for a scope phrase. Use this before creating labour rows so hours/unit and pricing basis are both defensible.",
    {
      q: z.string().describe("Labor activity, crew task, material install activity, or trade phrase."),
      category: z.string().optional().describe("Labor unit category to prefer."),
      className: z.string().optional().describe("Labor unit class to prefer."),
      provider: z.string().optional(),
      libraryId: z.string().optional(),
      quantity: z.number().positive().optional(),
      limit: z.number().int().positive().max(50).default(12),
    },
    async (input) => {
      const [laborPayload, rateCandidates] = await Promise.all([
        apiGet(`/api/labor-units/units${queryString({
          q: input.q,
          category: input.category,
          className: input.className,
          provider: input.provider,
          libraryId: input.libraryId,
          limit: input.limit,
        })}`).catch(() => null),
        searchCandidates({
          q: input.q,
          category: input.category ?? "Labour",
          sourceTypes: ["rate_schedule_item", "labor_unit"],
          limit: input.limit,
        }).catch(() => []),
      ]);

      const laborUnits = laborPayload ? enrichLaborUnits(laborPayload, input.q) : [];
      const rateSources = enrichCandidatesWithBasis(rateCandidates, { q: input.q });
      const bestUnit = laborUnits[0] ?? null;
      const bestRate = rateSources.find((candidate) => candidate.sourceType === "rate_schedule_item")
        ?? rateSources.find(isDirectlyCreateableCandidate)
        ?? null;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            query: input.q,
            recommendation: {
              laborUnit: bestUnit,
              rateSource: bestRate,
              estimatedHours: bestUnit && input.quantity
                ? Number(bestUnit.hoursNormal ?? 0) * input.quantity
                : null,
            },
            laborUnits,
            rateSources,
            guidance: [
              "Use the laborUnitId/hoursNormal as productivity evidence for hours per unit.",
              "Use a rateScheduleItemId or other structured cost source to price the labor row; a labor unit alone is not a fully priced line.",
              "Record both pieces in sourceEvidence/sourceNotes so reviewers can see productivity basis and pricing basis separately.",
            ],
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "listTakeoffAnnotations",
    "List saved PDF/DWG takeoff annotations so an estimate row can cite or link drawing quantity evidence.",
    {
      q: z.string().optional().describe("Optional scope/symbol/label search to filter annotations."),
      documentId: z.string().optional().describe("Optional drawing/document id."),
      page: z.number().int().positive().optional().describe("Optional 1-based page number."),
      limit: z.number().int().positive().max(100).default(25),
      offset: z.number().int().min(0).default(0),
    },
    async (input) => {
      const projectId = getProjectId();
      if (!projectId) {
        return { content: [{ type: "text" as const, text: "No active project id is available for takeoff annotations." }], isError: true };
      }
      const data = await apiGet(`/api/takeoff/${projectId}/annotations${queryString({
        documentId: input.documentId,
        page: input.page,
      })}`);
      const matches = annotationsFromPayload(data)
        .filter((annotation) => annotationMatchesQuery(annotation, input.q));
      const offset = input.offset ?? 0;
      const limit = input.limit ?? 25;
      const annotations = matches
        .slice(offset, offset + limit)
        .map((annotation) => {
          const measurement = annotationMeasurement(annotation);
          const label = stringValue(annotation.label) ?? stringValue(annotation.groupName) ?? "Takeoff annotation";
          const basis: SourceBasis = {
            kind: "takeoff",
            label,
            description: stringValue(annotation.groupName) ?? stringValue(annotation.annotationType),
            matchType: annotationMatchesQuery(annotation, input.q) ? "similar" : "context",
            sourceQuality: "good",
            query: input.q,
            documentId: stringValue(annotation.documentId),
            pageNumber: numberValue(annotation.pageNumber),
            annotationId: stringValue(annotation.id),
            metadata: {
              annotationType: stringValue(annotation.annotationType),
              measurement,
            },
          };
          return {
            id: annotation.id,
            documentId: annotation.documentId,
            pageNumber: annotation.pageNumber,
            annotationType: annotation.annotationType,
            label,
            groupName: annotation.groupName,
            measurement,
            basis,
          };
        });
      return { content: [{ type: "text" as const, text: JSON.stringify({
        total: matches.length,
        offset,
        limit,
        hasMore: offset + annotations.length < matches.length,
        annotations,
      }, null, 2) }] };
    },
  );

  server.tool(
    "linkTakeoffAnnotationToWorksheetItem",
    "Link a saved takeoff annotation to a worksheet item. This makes the row quantity derive from the PDF/DWG takeoff link and gives reviewers a trail back to the Takeoff tab.",
    {
      annotationId: z.string(),
      worksheetItemId: z.string(),
      quantityField: takeoffQuantityFieldSchema.default("value").describe("Measurement field to use from the annotation."),
      multiplier: z.number().finite().default(1).describe("Multiplier applied to the annotation measurement."),
    },
    async (input) => {
      const projectId = getProjectId();
      if (!projectId) {
        return { content: [{ type: "text" as const, text: "No active project id is available for takeoff links." }], isError: true };
      }
      const link = await apiPost(`/api/takeoff/${projectId}/links`, input);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            link,
            sourceEvidencePatch: {
              takeoff: link,
              basis: {
                kind: "takeoff",
                label: "Linked takeoff annotation",
                matchType: "exact",
                sourceQuality: "strong",
                annotationId: input.annotationId,
                takeoffLinkId: stringValue(asObject(link).id),
                metadata: {
                  quantityField: input.quantityField,
                  multiplier: input.multiplier,
                  derivedQuantity: numberValue(asObject(link).derivedQuantity),
                },
              },
            },
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "createWorksheetItemFromCandidate",
    "Create a worksheet item from a candidate returned by searchLineItemCandidates, recommendCostSource, or recommendEstimateBasis, preserving structured cost-resource provenance and source-basis evidence.",
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
      const object = asObject(data);
      const enriched = Array.isArray(data)
        ? enrichLaborUnits(data, input.q)
        : { ...object, units: enrichLaborUnits(data, input.q) };
      return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
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
