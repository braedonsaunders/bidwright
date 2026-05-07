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
const lineEvidenceBasisTypeSchema = z.enum([
  "drawing_quantity",
  "visual_takeoff",
  "drawing_table",
  "drawing_note",
  "document_quantity",
  "vendor_quote",
  "knowledge_labor",
  "rate_schedule",
  "allowance",
  "indirect",
  "subcontract",
  "equipment_rental",
  "material_quote",
  "assumption",
  "mixed",
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

type CompactLaborUnit = {
  id?: string;
  libraryId?: string;
  catalogItemId?: string;
  code?: string;
  name?: string;
  description?: string;
  discipline?: string;
  category?: string;
  className?: string;
  subClassName?: string;
  outputUom?: string;
  hoursNormal?: number;
  hoursPerOutput?: string;
  entityCategoryType?: string;
  tags?: unknown;
  sourceRef?: unknown;
  search?: unknown;
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

function compactText(value: unknown, maxLength = 220): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 15)).trimEnd()}...[truncated]`;
}

function compactUnknownValue(value: unknown, options: { depth?: number; maxString?: number; maxArray?: number; maxKeys?: number } = {}): unknown {
  const depth = options.depth ?? 2;
  const maxString = options.maxString ?? 180;
  const maxArray = options.maxArray ?? 8;
  const maxKeys = options.maxKeys ?? 12;
  if (typeof value === "string") return compactText(value, maxString) ?? "";
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (depth <= 0) {
    if (Array.isArray(value)) return { count: value.length };
    return { keys: Object.keys(value as Record<string, unknown>).slice(0, maxKeys) };
  }
  if (Array.isArray(value)) {
    const compacted = value.slice(0, maxArray).map((entry) => compactUnknownValue(entry, {
      depth: depth - 1,
      maxString,
      maxArray,
      maxKeys,
    }));
    if (value.length > maxArray) compacted.push(`[${value.length - maxArray} more]`);
    return compacted;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined && child !== null && child !== "")
      .slice(0, maxKeys)
      .map(([key, child]) => [key, compactUnknownValue(child, {
        depth: depth - 1,
        maxString,
        maxArray,
        maxKeys,
      })]),
  );
}

function normalizeMarkup(markup: number | undefined, fallback = 0): number {
  const raw = Number.isFinite(markup) ? markup! : fallback;
  return raw > 1 ? raw / 100 : raw;
}

function normalizeKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function workspaceCategories(workspacePayload: any): EntityCategoryRecord[] {
  const workspace = workspacePayload?.workspace ?? workspacePayload ?? {};
  const categories = workspace.entityCategories ?? workspace.workspace?.entityCategories ?? [];
  return Array.isArray(categories) ? categories : [];
}

function workspaceSourceDocuments(workspacePayload: any): Record<string, unknown>[] {
  const workspace = workspacePayload?.workspace ?? workspacePayload ?? {};
  const docs = workspace.sourceDocuments ?? workspace.workspace?.sourceDocuments ?? [];
  return Array.isArray(docs) ? docs.filter((doc) => doc && typeof doc === "object" && !Array.isArray(doc)) as Record<string, unknown>[] : [];
}

function isDrawingLikeSourceDocument(doc: Record<string, unknown>) {
  const documentType = normalizeKey(doc.documentType);
  const fileType = normalizeKey(doc.fileType);
  const fileName = normalizeKey(doc.fileName);
  if (/^__macosx\/|\/__macosx\/|(^|\/)\._|(^|\/)\.ds_store$|(^|\/)thumbs\.db$/.test(fileName)) return false;
  if (fileType !== "application/pdf" && fileType !== "pdf" && !fileName.endsWith(".pdf")) return false;
  return documentType === "drawing";
}

function evidenceBasisRequiresDrawing(evidenceBasis: Record<string, unknown>) {
  const quantityBasis = asObject(evidenceBasis.quantity);
  return ["drawing_quantity", "visual_takeoff", "drawing_table", "drawing_note"].includes(
    normalizeKey(quantityBasis.type ?? evidenceBasis.quantityType ?? evidenceBasis.type),
  );
}

function evidenceBasisClaimIds(evidenceBasis: Record<string, unknown>) {
  const quantityBasis = asObject(evidenceBasis.quantity);
  return [
    ...asArray(evidenceBasis.drawingClaimIds),
    ...asArray(quantityBasis.drawingClaimIds),
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function claimIdsMentionedInCandidateLine(input: Record<string, unknown>, evidenceBasis: Record<string, unknown>) {
  const text = [
    input.entityName,
    input.description,
    input.sourceNotes,
    JSON.stringify(input.candidate ?? {}),
    JSON.stringify(evidenceBasis),
  ].join("\n");
  return [...new Set([...text.matchAll(/\bclaim-[0-9a-f]{12}\b/gi)].map((match) => match[0]))];
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
    payload.category,
    payload.laborCategory,
    payload.className,
    payload.subClassName,
    payload.libraryName,
    payload.tags,
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
  disabledSourceTypes?: string[];
  disabledLaborLibraryIds?: string[];
  disabledCatalogIds?: string[];
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
      disabledSourceTypes: input.disabledSourceTypes,
      disabledLaborLibraryIds: input.disabledLaborLibraryIds,
      disabledCatalogIds: input.disabledCatalogIds,
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

function compactLaborUnit(unit: Record<string, unknown>, q?: string): CompactLaborUnit {
  const basis = laborUnitBasis(unit, q);
  const metadata = asObject(unit.metadata);
  const searchMatch = asObject(metadata.searchMatch);
  const outputUom = stringValue(unit.outputUom);
  const hoursNormal = numberValue(unit.hoursNormal);
  const compactSearch = Object.keys(searchMatch).length > 0
    ? {
        score: numberValue(searchMatch.score),
        coverage: numberValue(searchMatch.coverage),
        matchedTerms: compactUnknownValue(searchMatch.matchedTerms, { maxArray: 10, maxString: 80 }),
        matchedPhrases: compactUnknownValue(searchMatch.matchedPhrases, { maxArray: 8, maxString: 120 }),
        anchorMatches: compactUnknownValue(searchMatch.anchorMatches, { maxArray: 8, maxString: 120 }),
      }
    : undefined;
  return {
    id: stringValue(unit.id),
    libraryId: stringValue(unit.libraryId),
    catalogItemId: stringValue(unit.catalogItemId),
    code: stringValue(unit.code),
    name: compactText(unit.name, 160),
    description: compactText(unit.description, 280),
    discipline: stringValue(unit.discipline),
    category: stringValue(unit.category),
    className: stringValue(unit.className),
    subClassName: stringValue(unit.subClassName),
    outputUom,
    hoursNormal,
    hoursPerOutput: hoursNormal !== undefined && outputUom ? `${hoursNormal} HR/${outputUom}` : undefined,
    entityCategoryType: stringValue(unit.entityCategoryType),
    tags: compactUnknownValue(unit.tags, { maxArray: 8, maxString: 80 }),
    sourceRef: compactUnknownValue(unit.sourceRef, { depth: 2, maxString: 120, maxArray: 4, maxKeys: 8 }),
    search: compactSearch,
    basis: {
      ...basis,
      description: compactText(basis.description, 220),
      notes: compactText(basis.notes, 220),
      metadata: basis.metadata ? asObject(compactUnknownValue(basis.metadata, { depth: 1, maxString: 140, maxArray: 5, maxKeys: 8 })) : undefined,
    },
    matchType: basis.matchType,
    sourceQuality: basis.sourceQuality,
  };
}

function compactLaborUnitsPayload(payload: unknown, q?: string) {
  const object = asObject(payload);
  const units = unitsFromPayload(payload);
  const total = numberValue(object.total) ?? units.length;
  const offset = numberValue(object.offset) ?? 0;
  const diagnostics = object.diagnostics
    ? compactUnknownValue(object.diagnostics, { depth: 3, maxString: 240, maxArray: 10, maxKeys: 14 })
    : undefined;
  return {
    total,
    offset,
    returned: units.length,
    hasMore: offset + units.length < total,
    units: units.map((unit) => compactLaborUnit(unit, q)),
    diagnostics,
    guidance: [
      "Results are compact candidate rows; the estimator decides exact/similar/context/unusable.",
      "Use libraryId/category/className/subClassName from listLaborUnitTree to narrow broad searches.",
      "Use getLaborUnit with a laborUnitId when one compact row needs deeper sourceRef/metadata inspection.",
    ],
  };
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
      disabledSourceTypes: z.array(sourceTypeSchema).optional().describe("Optional UI search setting: source types disabled for this quote."),
      disabledLaborLibraryIds: z.array(z.string()).optional().describe("Optional UI search setting: labor-unit libraries disabled for this quote."),
      disabledCatalogIds: z.array(z.string()).optional().describe("Optional UI search setting: catalogs disabled for this quote."),
      limit: z.coerce.number().int().positive().max(100).default(20),
      offset: z.coerce.number().int().min(0).optional(),
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
      disabledSourceTypes: z.array(sourceTypeSchema).optional().describe("Optional UI search setting: source types disabled for this quote."),
      disabledLaborLibraryIds: z.array(z.string()).optional().describe("Optional UI search setting: labor-unit libraries disabled for this quote."),
      disabledCatalogIds: z.array(z.string()).optional().describe("Optional UI search setting: catalogs disabled for this quote."),
      limit: z.coerce.number().int().positive().max(50).default(12),
      quantity: z.coerce.number().positive().optional(),
      markup: z.coerce.number().optional().describe("Markup as decimal or percent. 0.15 and 15 both mean 15%."),
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
      disabledSourceTypes: z.array(sourceTypeSchema).optional().describe("Optional UI search setting: source types disabled for this quote."),
      disabledLaborLibraryIds: z.array(z.string()).optional().describe("Optional UI search setting: labor-unit libraries disabled for this quote."),
      disabledCatalogIds: z.array(z.string()).optional().describe("Optional UI search setting: catalogs disabled for this quote."),
      limit: z.coerce.number().int().positive().max(50).default(12),
      quantity: z.coerce.number().positive().optional(),
      markup: z.coerce.number().optional().describe("Markup as decimal or percent. 0.15 and 15 both mean 15%."),
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
    "listTakeoffAnnotations",
    "List saved PDF/DWG takeoff annotations so an estimate row can cite or link drawing quantity evidence.",
    {
      q: z.string().optional().describe("Optional scope/symbol/label search to filter annotations."),
      documentId: z.string().optional().describe("Optional drawing/document id."),
      page: z.coerce.number().int().positive().optional().describe("Optional 1-based page number."),
      limit: z.coerce.number().int().positive().max(40).default(20),
      offset: z.coerce.number().int().min(0).default(0),
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
      multiplier: z.coerce.number().finite().default(1).describe("Multiplier applied to the annotation measurement."),
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
    "Create a worksheet item from a candidate returned by searchLineItemCandidates, recommendCostSource, or recommendEstimateBasis, preserving structured cost-resource provenance and source-basis evidence. When drawings exist, include evidenceBasis so this helper cannot bypass the line-level evidence contract.",
    {
      worksheetId: z.string(),
      candidate: z.record(z.unknown()).optional().describe("A candidate object returned by searchLineItemCandidates/recommendCostSource."),
      candidateId: z.string().optional().describe("Search-document id from a prior search. Provide q/category if using candidateId."),
      q: z.string().optional(),
      categoryId: z.string().optional(),
      category: z.string().optional(),
      quantity: z.coerce.number().positive().default(1),
      markup: z.coerce.number().optional(),
      entityName: z.string().optional(),
      description: z.string().optional(),
      uom: z.string().optional(),
      cost: z.coerce.number().optional(),
      price: z.coerce.number().optional(),
      sourceNotes: z.string().optional(),
      phaseId: z.string().nullable().optional(),
      evidenceBasis: z.object({
        type: lineEvidenceBasisTypeSchema.optional().describe("Legacy single-source shorthand. Prefer quantity.type plus pricing.type when quantity and price/rate come from different sources."),
        quantity: z.object({
          type: lineEvidenceBasisTypeSchema.describe("Source class that justifies the row quantity, hours, duration, or count."),
          drawingClaimIds: z.array(z.string()).default([]),
          quantityDriver: z.string().optional(),
          sourceRefs: z.array(z.string()).default([]),
          assumptionIds: z.array(z.string()).default([]),
          rationale: z.string().optional(),
        }).passthrough().optional(),
        pricing: z.object({
          type: lineEvidenceBasisTypeSchema.describe("Source class that justifies unit cost, rate, productivity, or allowance value."),
          sourceRefs: z.array(z.string()).default([]),
          assumptionIds: z.array(z.string()).default([]),
          rationale: z.string().optional(),
        }).passthrough().optional(),
        quantityDriver: z.string().optional(),
        drawingClaimIds: z.array(z.string()).default([]),
        sourceRefs: z.array(z.string()).default([]),
        assumptionIds: z.array(z.string()).default([]),
        rationale: z.string().optional(),
      }).passthrough().optional().describe("Line-level evidence contract. Required when drawings exist. Prefer quantity/pricing axes. Drawing/takeoff quantity basis needs quantity.drawingClaimIds; pricing can separately be rate_schedule, knowledge_labor, material_quote, vendor_quote, allowance, indirect, document_quantity, assumption, subcontract, equipment_rental, or mixed."),
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
      const drawingDocs = workspaceSourceDocuments(ws).filter(isDrawingLikeSourceDocument);
      const evidenceBasis = asObject(input.evidenceBasis);
      const declaredClaimIds = evidenceBasisClaimIds(evidenceBasis);
      const mentionedClaimIds = claimIdsMentionedInCandidateLine(input, evidenceBasis);
      const missingDeclaredClaimIds = mentionedClaimIds.filter((id) => !declaredClaimIds.includes(id));
      if (drawingDocs.length > 0 && Object.keys(evidenceBasis).length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "Line evidence basis is required because this project contains drawings. Prefer evidenceBasis.quantity.type plus evidenceBasis.pricing.type. Use drawing_quantity/visual_takeoff/drawing_table/drawing_note with quantity.drawingClaimIds only when the row quantity is drawing-derived; otherwise declare the non-drawing quantity and pricing source classes such as rate_schedule, knowledge_labor, material_quote, vendor_quote, allowance, indirect, document_quantity, assumption, subcontract, equipment_rental, or mixed.",
          }],
          isError: true,
        };
      }
      if (missingDeclaredClaimIds.length > 0) {
        return {
          content: [{
            type: "text" as const,
            text: `Drawing evidence claim id(s) are mentioned but not attached to evidenceBasis.quantity.drawingClaimIds: ${missingDeclaredClaimIds.join(", ")}. Split the row provenance into evidenceBasis.quantity for quantity evidence and evidenceBasis.pricing for cost/rate evidence.`,
          }],
          isError: true,
        };
      }
      if (declaredClaimIds.length > 0 && !evidenceBasisRequiresDrawing(evidenceBasis)) {
        return {
          content: [{
            type: "text" as const,
            text: "Drawing claim IDs belong under evidenceBasis.quantity. Set evidenceBasis.quantity.type to drawing_quantity, visual_takeoff, drawing_table, or drawing_note and move claim IDs to evidenceBasis.quantity.drawingClaimIds. Put candidate/library/material/rate support under evidenceBasis.pricing.",
          }],
          isError: true,
        };
      }
      const pricingBasis = asObject(evidenceBasis.pricing);
      const pricingType = normalizeKey(pricingBasis.type ?? evidenceBasis.pricingType);
      if (evidenceBasisRequiresDrawing(evidenceBasis) && (!pricingType || ["drawing_quantity", "visual_takeoff", "drawing_table", "drawing_note"].includes(pricingType))) {
        return {
          content: [{
            type: "text" as const,
            text: "Drawing quantity evidence proves count/measurement, not price/rate/productivity. Add evidenceBasis.pricing.type with the candidate/library/material/rate/vendor/subcontract/allowance source that supports cost or productivity.",
          }],
          isError: true,
        };
      }
      if (evidenceBasisRequiresDrawing(evidenceBasis) && declaredClaimIds.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "This candidate row is marked as drawing/takeoff quantity driven, so evidenceBasis.quantity.drawingClaimIds must name the Drawing Evidence Engine claim(s) that prove the quantity. Use evidenceBasis.pricing for the candidate/library source that supports pricing.",
          }],
          isError: true,
        };
      }
      const categories = workspaceCategories(ws);
      const defaultMarkup = Number(ws?.workspace?.currentRevision?.defaultMarkup ?? ws?.currentRevision?.defaultMarkup ?? 0);
      const body = worksheetItemFromCandidate(candidate, {
        ...input,
        defaultMarkup,
      }, categories);
      if (Object.keys(evidenceBasis).length > 0) {
        (body as any).sourceEvidence = {
          ...asObject(body.sourceEvidence),
          evidenceBasis,
        };
      }
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
    "List compact labor-productivity candidate units from the labor-unit libraries. Use this when a labour row needs hours/unit, a productivity analog, or a laborUnitId. Search results are deliberately compact and include diagnostics so the agent can refine deliberately; call getLaborUnit for focused details on one candidate.",
    {
      q: z.string().optional(),
      provider: z.string().optional(),
      category: z.string().optional(),
      className: z.string().optional(),
      subClassName: z.string().optional(),
      libraryId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).default(25),
      offset: z.coerce.number().int().min(0).optional(),
    },
    async (input) => {
      const data = await apiGet(`/api/labor-units/units${queryString(input)}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(compactLaborUnitsPayload(data, input.q), null, 2) }] };
    },
  );

  server.tool(
    "getLaborUnit",
    "Fetch one labor-productivity unit by ID for focused source/metadata inspection after listLaborUnits returns a candidate. Use this for sourceRef details, not broad searches.",
    {
      laborUnitId: z.string().min(1),
    },
    async (input) => {
      const unit = await apiGet(`/api/labor-units/units/${encodeURIComponent(input.laborUnitId)}`);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            unit: compactLaborUnit(asObject(unit)),
            rawDetails: {
              sourceRef: compactUnknownValue(asObject(unit).sourceRef, { depth: 4, maxString: 500, maxArray: 20, maxKeys: 30 }),
              metadata: compactUnknownValue(asObject(unit).metadata, { depth: 4, maxString: 500, maxArray: 20, maxKeys: 30 }),
            },
            guidance: "Use this labor unit only if the operation and output unit are defensible for the worksheet row; otherwise treat it as context or reject it.",
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "listLaborUnitTree",
    "Browse labor-unit libraries by catalog, category, class, and subclass. Use this before repeated listLaborUnits searches so the agent can refine with the library's actual taxonomy instead of guessing terms.",
    {
      parentType: z.enum(["root", "catalog", "category", "class", "subclass"]).default("root"),
      libraryId: z.string().optional(),
      q: z.string().optional().describe("Optional text search applied while building the tree."),
      category: z.string().optional(),
      className: z.string().optional(),
      subClassName: z.string().optional(),
      limit: z.coerce.number().int().positive().max(200).default(50),
      offset: z.coerce.number().int().min(0).optional(),
    },
    async (input) => {
      const data = await apiGet(`/api/labor-units/tree${queryString(input)}`);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ...asObject(data),
            guidance: [
              "This is taxonomy/navigation data only. When q is present, nodes are ranked by generic text matches inside that branch and include representative units.",
              "Read diagnostics.term hit counts and diagnostics.querySlices: if multi-term slices have zero matches, treat separate-token hits as analog candidates rather than exact basis.",
              "Use libraryId/category/className/subClassName from nodes to narrow listLaborUnits.",
              "Do not treat high unit counts as recommendations; the estimator agent still decides relevance from the returned labor units and source context.",
            ],
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "previewAssembly",
    "Preview an assembly expansion and resource rollup before inserting it into a worksheet. Use this for assembly-backed scope instead of hand-building all child rows.",
    {
      assemblyId: z.string(),
      quantity: z.coerce.number().positive().default(1),
      parameterValues: z.record(z.union([z.coerce.number(), z.string()])).optional(),
    },
    async (input) => {
      const data = await apiPost("/api/assemblies/preview", input);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}
