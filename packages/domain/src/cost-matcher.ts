import type {
  Catalog,
  CatalogItem,
  Dataset,
  DatasetColumn,
  DatasetRow,
  RateSchedule,
  RateScheduleItem,
  WorksheetItem,
} from "./models";

export type CostMatcherSourceType =
  | "catalog_item"
  | "rate_schedule_item"
  | "dataset_row"
  | "workspace_item";

export interface CostMatcherCandidate {
  id: string;
  sourceType: CostMatcherSourceType;
  sourceId: string;
  name: string;
  code?: string | null;
  description?: string | null;
  unit?: string | null;
  category?: string | null;
  source?: string | null;
  sourceKey?: string | null;
  sourceLabel?: string | null;
  unitCost?: number | null;
  unitPrice?: number | null;
  searchableText?: string | null;
  tags?: readonly string[];
  metadata?: Record<string, unknown>;
  order?: number;
  priorScore?: number | null;
  historicalScore?: number | null;
}

export interface CostMatcherQuery {
  text: string;
  unit?: string | null;
  category?: string | null;
  source?: string | null;
  sourceType?: CostMatcherSourceType | null;
}

export interface CostMatcherPriorMatch {
  candidateId: string;
  weight?: number | null;
  reason?: string | null;
}

export interface CostMatcherOptions {
  topK?: number;
  priorMatches?: readonly CostMatcherPriorMatch[];
  historicalMatches?: readonly CostMatcherPriorMatch[];
}

export interface CostMatcherScoreComponents {
  lexical: number;
  unit: number;
  category: number;
  source: number;
  prior: number;
}

export interface CostMatcherResult {
  candidate: CostMatcherCandidate;
  rank: number;
  score: number;
  confidence: number;
  reasons: string[];
  components: CostMatcherScoreComponents;
}

export interface NormalizeCatalogItemOptions {
  order?: number;
}

export interface NormalizeRateScheduleItemOptions {
  order?: number;
}

export interface NormalizeDatasetRowOptions {
  order?: number;
  nameKeys?: readonly string[];
  codeKeys?: readonly string[];
  descriptionKeys?: readonly string[];
  unitKeys?: readonly string[];
  unitCostKeys?: readonly string[];
  unitPriceKeys?: readonly string[];
  categoryKeys?: readonly string[];
}

export interface NormalizeWorkspaceItemOptions {
  order?: number;
  worksheetName?: string | null;
}

export interface NormalizeCostMatcherCandidatesInput {
  catalogs?: readonly Catalog[];
  catalogItems?: readonly CatalogItem[];
  rateSchedules?: readonly RateSchedule[];
  rateScheduleItems?: readonly RateScheduleItem[];
  datasets?: readonly Dataset[];
  datasetRows?: readonly DatasetRow[];
  workspaceItems?: readonly WorksheetItem[];
}

const DEFAULT_TOP_K = 10;
const UNIT_BONUS = 0.16;
const UNIT_COMPATIBLE_BONUS = 0.08;
const CATEGORY_BONUS = 0.12;
const CATEGORY_PARTIAL_BONUS = 0.07;
const SOURCE_BONUS = 0.1;
const SOURCE_TYPE_BONUS = 0.08;
const PRIOR_BONUS = 0.14;
const HISTORICAL_BONUS = 0.1;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "cost",
  "for",
  "from",
  "item",
  "line",
  "of",
  "or",
  "per",
  "price",
  "rate",
  "to",
  "the",
  "with",
]);

const NAME_KEYS = [
  "name",
  "itemName",
  "serviceItem",
  "service_item",
  "equipment",
  "material",
  "product",
  "condition",
  "class",
  "subClass",
  "sub_class",
  "category",
];

const CODE_KEYS = ["code", "itemCode", "item_code", "sku", "partNumber", "part_number", "part", "number"];
const DESCRIPTION_KEYS = ["description", "desc", "notes", "note"];
const UNIT_KEYS = ["uom", "unit", "units", "unitOfMeasure", "unit_of_measure", "measure"];
const UNIT_COST_KEYS = [
  "unitCost",
  "unit_cost",
  "cost",
  "costRate",
  "cost_rate",
  "rate",
  "daily",
  "weekly",
  "monthly",
  "hourNormal",
  "hoursPerUnit",
  "mhPerUnit",
];
const UNIT_PRICE_KEYS = ["unitPrice", "unit_price", "price", "sell", "sellRate", "sell_rate", "billingRate"];
const CATEGORY_KEYS = ["category", "type", "group", "trade", "class"];

const UNIT_ALIASES = new Map<string, string>([
  ["bag", "bag"],
  ["bags", "bag"],
  ["bundle", "bundle"],
  ["bundles", "bundle"],
  ["box", "box"],
  ["boxes", "box"],
  ["count", "ea"],
  ["ct", "ea"],
  ["ea", "ea"],
  ["each", "ea"],
  ["eachs", "ea"],
  ["pc", "ea"],
  ["pcs", "ea"],
  ["piece", "ea"],
  ["pieces", "ea"],
  ["unit", "ea"],
  ["units", "ea"],
  ["day", "day"],
  ["days", "day"],
  ["daily", "day"],
  ["dy", "day"],
  ["dys", "day"],
  ["hr", "hr"],
  ["hrs", "hr"],
  ["hour", "hr"],
  ["hours", "hr"],
  ["laborhour", "hr"],
  ["laborhours", "hr"],
  ["labourhour", "hr"],
  ["labourhours", "hr"],
  ["manhour", "hr"],
  ["manhours", "hr"],
  ["mh", "hr"],
  ["mo", "mo"],
  ["month", "mo"],
  ["months", "mo"],
  ["monthly", "mo"],
  ["wk", "wk"],
  ["wks", "wk"],
  ["week", "wk"],
  ["weeks", "wk"],
  ["weekly", "wk"],
  ["ft", "ft"],
  ["foot", "ft"],
  ["feet", "ft"],
  ["lf", "ft"],
  ["linearfoot", "ft"],
  ["linearfeet", "ft"],
  ["linft", "ft"],
  ["in", "in"],
  ["inch", "in"],
  ["inches", "in"],
  ["m", "m"],
  ["meter", "m"],
  ["meters", "m"],
  ["metre", "m"],
  ["metres", "m"],
  ["sqft", "sf"],
  ["sf", "sf"],
  ["ft2", "sf"],
  ["squarefoot", "sf"],
  ["squarefeet", "sf"],
  ["sqyd", "sy"],
  ["sy", "sy"],
  ["yd2", "sy"],
  ["squareyard", "sy"],
  ["squareyards", "sy"],
  ["yd", "yd"],
  ["yard", "yd"],
  ["yards", "yd"],
  ["lb", "lb"],
  ["lbs", "lb"],
  ["pound", "lb"],
  ["pounds", "lb"],
  ["ton", "ton"],
  ["tons", "ton"],
]);

const UNIT_FAMILIES = new Map<string, string>([
  ["day", "time"],
  ["hr", "time"],
  ["mo", "time"],
  ["wk", "time"],
  ["ft", "length"],
  ["in", "length"],
  ["m", "length"],
  ["yd", "length"],
  ["sf", "area"],
  ["sy", "area"],
]);

export function normalizeCatalogItemCandidate(
  item: CatalogItem,
  catalog?: Catalog | null,
  options: NormalizeCatalogItemOptions = {},
): CostMatcherCandidate {
  const metadata = item.metadata ?? {};
  const metadataCategory = firstStringFromRecord(metadata, CATEGORY_KEYS);
  const category = metadataCategory ?? catalog?.kind ?? null;

  return {
    id: makeCandidateId("catalog_item", item.id),
    sourceType: "catalog_item",
    sourceId: item.id,
    name: item.name,
    code: item.code,
    description: catalog?.description ?? null,
    unit: item.unit,
    category,
    source: catalog?.source ?? null,
    sourceKey: item.catalogId,
    sourceLabel: catalog?.name ?? item.catalogId,
    unitCost: item.unitCost,
    unitPrice: item.unitPrice,
    searchableText: joinSearchText([
      item.code,
      item.name,
      item.unit,
      category,
      catalog?.name,
      catalog?.description,
      catalog?.source,
      catalog?.sourceDescription,
      ...unknownToSearchText(metadata),
    ]),
    tags: compactStrings([catalog?.kind, catalog?.scope, metadataCategory]),
    metadata,
    order: options.order,
  };
}

export function normalizeRateScheduleItemCandidate(
  item: RateScheduleItem,
  schedule?: RateSchedule | null,
  options: NormalizeRateScheduleItemOptions = {},
): CostMatcherCandidate {
  const metadata = item.metadata ?? {};
  const metadataCategory = firstStringFromRecord(metadata, CATEGORY_KEYS);
  const category = metadataCategory ?? schedule?.category ?? null;
  const firstCostRate = firstFiniteNumber(Object.values(item.costRates ?? {}));
  const firstSellRate = firstFiniteNumber(Object.values(item.rates ?? {}));

  return {
    id: makeCandidateId("rate_schedule_item", item.id),
    sourceType: "rate_schedule_item",
    sourceId: item.id,
    name: item.name,
    code: item.code,
    description: schedule?.description ?? null,
    unit: item.unit,
    category,
    source: schedule?.scope ?? null,
    sourceKey: item.scheduleId,
    sourceLabel: schedule?.name ?? item.scheduleId,
    unitCost: firstCostRate,
    unitPrice: firstSellRate,
    searchableText: joinSearchText([
      item.code,
      item.name,
      item.unit,
      category,
      schedule?.name,
      schedule?.description,
      schedule?.category,
      schedule?.scope,
      ...Object.keys(item.rates ?? {}),
      ...Object.keys(item.costRates ?? {}),
      ...unknownToSearchText(metadata),
    ]),
    tags: compactStrings([schedule?.category, schedule?.scope, metadataCategory]),
    metadata,
    order: options.order,
  };
}

export function normalizeDatasetRowCandidate(
  row: DatasetRow,
  dataset?: Dataset | null,
  options: NormalizeDatasetRowOptions = {},
): CostMatcherCandidate {
  const data = row.data ?? {};
  const name = inferDatasetRowName(data, dataset?.columns, options.nameKeys);
  const code = firstStringFromRecord(data, options.codeKeys ?? CODE_KEYS);
  const description = firstStringFromRecord(data, options.descriptionKeys ?? DESCRIPTION_KEYS);
  const unit = firstStringFromRecord(data, options.unitKeys ?? UNIT_KEYS);
  const dataCategory = firstStringFromRecord(data, options.categoryKeys ?? CATEGORY_KEYS);
  const category = dataCategory ?? dataset?.category ?? null;
  const unitCost = firstNumberFromRecord(data, options.unitCostKeys ?? UNIT_COST_KEYS);
  const unitPrice = firstNumberFromRecord(data, options.unitPriceKeys ?? UNIT_PRICE_KEYS);

  return {
    id: makeCandidateId("dataset_row", row.id),
    sourceType: "dataset_row",
    sourceId: row.id,
    name: name || `${dataset?.name ?? "Dataset"} row ${row.order + 1}`,
    code,
    description,
    unit,
    category,
    source: dataset?.source ?? null,
    sourceKey: row.datasetId,
    sourceLabel: dataset?.name ?? row.datasetId,
    unitCost,
    unitPrice,
    searchableText: joinSearchText([
      code,
      name,
      description,
      unit,
      category,
      dataset?.name,
      dataset?.description,
      dataset?.category,
      dataset?.source,
      dataset?.sourceDescription,
      ...unknownToSearchText(data),
      ...unknownToSearchText(row.metadata ?? {}),
    ]),
    tags: compactStrings([dataset?.category, dataset?.scope, dataset?.source, dataCategory]),
    metadata: {
      row: data,
      ...(row.metadata ?? {}),
    },
    order: options.order,
  };
}

export function normalizeWorkspaceItemCandidate(
  item: WorksheetItem,
  options: NormalizeWorkspaceItemOptions = {},
): CostMatcherCandidate {
  return {
    id: makeCandidateId("workspace_item", item.id),
    sourceType: "workspace_item",
    sourceId: item.id,
    name: item.entityName,
    code: item.itemId ?? item.rateScheduleItemId ?? null,
    description: item.description || item.sourceNotes || null,
    unit: item.uom,
    category: item.category || item.entityType || null,
    source: "workspace",
    sourceKey: item.worksheetId,
    sourceLabel: options.worksheetName ?? item.worksheetId,
    unitCost: item.cost,
    unitPrice: item.price,
    searchableText: joinSearchText([
      item.itemId,
      item.rateScheduleItemId,
      item.entityName,
      item.entityType,
      item.category,
      item.vendor,
      item.description,
      item.sourceNotes,
      item.uom,
      options.worksheetName,
    ]),
    tags: compactStrings([item.category, item.entityType, item.vendor]),
    metadata: {
      quantity: item.quantity,
      markup: item.markup,
      unit1: item.unit1,
      unit2: item.unit2,
      unit3: item.unit3,
      lineOrder: item.lineOrder,
    },
    order: options.order,
  };
}

export function normalizeCostMatcherCandidates(
  input: NormalizeCostMatcherCandidatesInput,
): CostMatcherCandidate[] {
  const catalogsById = new Map((input.catalogs ?? []).map((catalog) => [catalog.id, catalog]));
  const schedulesById = new Map((input.rateSchedules ?? []).map((schedule) => [schedule.id, schedule]));
  const datasetsById = new Map((input.datasets ?? []).map((dataset) => [dataset.id, dataset]));
  const candidates: CostMatcherCandidate[] = [];
  let order = 0;

  for (const item of input.catalogItems ?? []) {
    candidates.push(normalizeCatalogItemCandidate(item, catalogsById.get(item.catalogId), { order: order++ }));
  }

  for (const item of input.rateScheduleItems ?? []) {
    candidates.push(normalizeRateScheduleItemCandidate(item, schedulesById.get(item.scheduleId), { order: order++ }));
  }

  for (const row of input.datasetRows ?? []) {
    candidates.push(normalizeDatasetRowCandidate(row, datasetsById.get(row.datasetId), { order: order++ }));
  }

  for (const item of input.workspaceItems ?? []) {
    candidates.push(normalizeWorkspaceItemCandidate(item, { order: order++ }));
  }

  return candidates;
}

export function matchCostCandidates(
  query: string | CostMatcherQuery,
  candidates: readonly CostMatcherCandidate[],
  options: CostMatcherOptions = {},
): CostMatcherResult[] {
  const parsedQuery = parseQuery(query);
  const queryText = normalizeSearchText(parsedQuery.text);
  const queryTokens = tokenize(queryText);
  const topK = normalizeTopK(options.topK);

  if (topK === 0 || queryTokens.length === 0 || candidates.length === 0) {
    return [];
  }

  const unit = normalizeUnit(parsedQuery.unit) ?? inferUnitFromText(parsedQuery.text);
  const priorIndex = buildBonusIndex(options.priorMatches);
  const historicalIndex = buildBonusIndex(options.historicalMatches);
  const scored: Array<CostMatcherResult & { inputIndex: number }> = [];

  candidates.forEach((candidate, inputIndex) => {
    const lexical = scoreLexical(parsedQuery.text, queryTokens, candidate);
    const prior = scorePrior(candidate, priorIndex, historicalIndex);

    if (lexical.score <= 0 && prior.score <= 0) {
      return;
    }

    const unitScore = scoreUnit(unit, candidate);
    const categoryScore = scoreCategory(parsedQuery.category, candidate);
    const sourceScore = scoreSource(parsedQuery.source, parsedQuery.sourceType, candidate);
    const components: CostMatcherScoreComponents = {
      lexical: roundScore(lexical.score),
      unit: roundScore(unitScore.score),
      category: roundScore(categoryScore.score),
      source: roundScore(sourceScore.score),
      prior: roundScore(prior.score),
    };
    const total =
      components.lexical +
      components.unit +
      components.category +
      components.source +
      components.prior;

    scored.push({
      candidate,
      inputIndex,
      rank: 0,
      score: roundScore(total),
      confidence: roundScore(clamp(total / 1.2, 0, 1)),
      reasons: [
        ...lexical.reasons,
        ...unitScore.reasons,
        ...categoryScore.reasons,
        ...sourceScore.reasons,
        ...prior.reasons,
      ],
      components,
    });
  });

  return scored
    .sort(compareResults)
    .slice(0, topK)
    .map(({ inputIndex: _inputIndex, ...result }, index) => ({
      ...result,
      rank: index + 1,
    }));
}

export const rankCostCandidates = matchCostCandidates;

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['\u2019]/g, "")
    .replace(/[$/]/g, " ")
    .replace(/([a-z])([0-9])/gi, "$1 $2")
    .replace(/([0-9])([a-z])/gi, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeUnit(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeSearchText(value)
    .replace(/\bper\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const compact = normalized.replace(/\s+/g, "");

  if (UNIT_ALIASES.has(compact)) {
    return UNIT_ALIASES.get(compact)!;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  for (const token of tokens) {
    const canonical = UNIT_ALIASES.get(token);
    if (canonical) {
      return canonical;
    }
  }

  return compact || null;
}

function compareResults(
  a: CostMatcherResult & { inputIndex: number },
  b: CostMatcherResult & { inputIndex: number },
): number {
  return (
    b.score - a.score ||
    b.components.lexical - a.components.lexical ||
    b.components.unit - a.components.unit ||
    b.components.category - a.components.category ||
    b.components.source - a.components.source ||
    b.components.prior - a.components.prior ||
    a.inputIndex - b.inputIndex ||
    a.candidate.id.localeCompare(b.candidate.id)
  );
}

function parseQuery(query: string | CostMatcherQuery): CostMatcherQuery {
  return typeof query === "string" ? { text: query } : query;
}

function normalizeTopK(topK: number | undefined): number {
  if (topK === undefined) {
    return DEFAULT_TOP_K;
  }

  if (!Number.isFinite(topK)) {
    return DEFAULT_TOP_K;
  }

  return Math.max(0, Math.floor(topK));
}

interface LexicalScore {
  score: number;
  reasons: string[];
}

function scoreLexical(
  rawQuery: string,
  queryTokens: readonly string[],
  candidate: CostMatcherCandidate,
): LexicalScore {
  const nameTokens = tokenize(candidate.name);
  const codeTokens = tokenize(candidate.code ?? "");
  const allTokens = tokenize(candidateText(candidate));
  const allCoverage = tokenCoverage(queryTokens, allTokens);
  const nameCoverage = tokenCoverage(queryTokens, nameTokens);
  const codeCoverage = tokenCoverage(queryTokens, codeTokens);
  const candidatePrecision = allTokens.length === 0 ? 0 : allCoverage.matchedTokens.length / allTokens.length;
  const queryNormalized = normalizeSearchText(rawQuery);
  const nameText = normalizeSearchText(candidate.name);
  const allText = normalizeSearchText(candidateText(candidate));
  const phraseInName = queryNormalized.length > 0 && nameText.includes(queryNormalized);
  const phraseInAll = queryNormalized.length > 0 && allText.includes(queryNormalized);
  const codeMatchScore = scoreCode(rawQuery, candidate.code);

  let score =
    allCoverage.score * 0.58 +
    nameCoverage.score * 0.27 +
    codeCoverage.score * 0.1 +
    Math.min(0.1, candidatePrecision * 0.4) +
    codeMatchScore;

  if (phraseInName) {
    score += 0.18;
  } else if (phraseInAll) {
    score += 0.08;
  }

  if (allCoverage.score >= 0.999 && queryTokens.length > 1) {
    score += 0.06;
  }

  score = clamp(score, 0, 1);

  if (score <= 0) {
    return { score: 0, reasons: [] };
  }

  const reasons: string[] = [];
  if (phraseInName) {
    reasons.push("phrase match in name");
  } else if (phraseInAll) {
    reasons.push("phrase match in source text");
  }

  if (codeMatchScore > 0 && candidate.code) {
    reasons.push(`code match: ${candidate.code}`);
  }

  const matchedTerms = allCoverage.matchedTokens.slice(0, 6);
  if (matchedTerms.length > 0) {
    reasons.push(`matched terms: ${matchedTerms.join(", ")}`);
  }

  return {
    score,
    reasons,
  };
}

function tokenCoverage(queryTokens: readonly string[], candidateTokens: readonly string[]): {
  score: number;
  matchedTokens: string[];
} {
  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return { score: 0, matchedTokens: [] };
  }

  const matchedTokens: string[] = [];
  let total = 0;

  for (const queryToken of queryTokens) {
    const best = bestTokenMatch(queryToken, candidateTokens);
    if (best > 0) {
      total += best;
      matchedTokens.push(queryToken);
    }
  }

  return {
    score: total / queryTokens.length,
    matchedTokens,
  };
}

function bestTokenMatch(queryToken: string, candidateTokens: readonly string[]): number {
  for (const candidateToken of candidateTokens) {
    if (candidateToken === queryToken) {
      return 1;
    }
  }

  for (const candidateToken of candidateTokens) {
    if (candidateToken.length >= 4 && queryToken.length >= 4) {
      if (candidateToken.startsWith(queryToken) || queryToken.startsWith(candidateToken)) {
        return 0.72;
      }
    }
  }

  return 0;
}

function scoreCode(rawQuery: string, code: string | null | undefined): number {
  if (!code) {
    return 0;
  }

  const queryCompact = normalizeSearchText(rawQuery).replace(/\s+/g, "");
  const codeCompact = normalizeSearchText(code).replace(/\s+/g, "");

  if (queryCompact.length === 0 || codeCompact.length === 0) {
    return 0;
  }

  if (queryCompact === codeCompact) {
    return 0.24;
  }

  if (queryCompact.length >= 3 && codeCompact.includes(queryCompact)) {
    return 0.14;
  }

  return 0;
}

function scoreUnit(queryUnit: string | null, candidate: CostMatcherCandidate): { score: number; reasons: string[] } {
  if (!queryUnit) {
    return { score: 0, reasons: [] };
  }

  const candidateUnit = normalizeUnit(candidate.unit);
  if (!candidateUnit) {
    return { score: 0, reasons: [] };
  }

  if (queryUnit === candidateUnit) {
    return {
      score: UNIT_BONUS,
      reasons: [`unit match: ${candidate.unit}`],
    };
  }

  const queryFamily = UNIT_FAMILIES.get(queryUnit);
  const candidateFamily = UNIT_FAMILIES.get(candidateUnit);
  if (queryFamily && queryFamily === candidateFamily) {
    return {
      score: UNIT_COMPATIBLE_BONUS,
      reasons: [`compatible unit: ${candidate.unit}`],
    };
  }

  return { score: 0, reasons: [] };
}

function scoreCategory(
  queryCategory: string | null | undefined,
  candidate: CostMatcherCandidate,
): { score: number; reasons: string[] } {
  if (!queryCategory || !candidate.category) {
    return { score: 0, reasons: [] };
  }

  const queryText = normalizeSearchText(queryCategory);
  const candidateTextValue = normalizeSearchText(candidate.category);
  if (!queryText || !candidateTextValue) {
    return { score: 0, reasons: [] };
  }

  if (queryText === candidateTextValue) {
    return {
      score: CATEGORY_BONUS,
      reasons: [`category match: ${candidate.category}`],
    };
  }

  const coverage = tokenCoverage(tokenize(queryText), tokenize(candidateTextValue));
  if (coverage.score > 0) {
    return {
      score: CATEGORY_PARTIAL_BONUS,
      reasons: [`category overlap: ${candidate.category}`],
    };
  }

  return { score: 0, reasons: [] };
}

function scoreSource(
  querySource: string | null | undefined,
  querySourceType: CostMatcherSourceType | null | undefined,
  candidate: CostMatcherCandidate,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (querySourceType && querySourceType === candidate.sourceType) {
    score += SOURCE_TYPE_BONUS;
    reasons.push(`source type match: ${candidate.sourceType}`);
  }

  if (querySource) {
    const queryText = normalizeSearchText(querySource);
    const sourceText = normalizeSearchText(
      joinSearchText([
        candidate.source,
        candidate.sourceKey,
        candidate.sourceLabel,
        candidate.sourceType.replace(/_/g, " "),
      ]),
    );

    if (queryText && sourceText) {
      if (queryText === sourceText || sourceText.includes(queryText)) {
        score += SOURCE_BONUS;
        reasons.push(`source match: ${candidate.sourceLabel ?? candidate.source ?? candidate.sourceType}`);
      } else {
        const coverage = tokenCoverage(tokenize(queryText), tokenize(sourceText));
        if (coverage.score > 0) {
          score += SOURCE_BONUS * 0.6;
          reasons.push(`source overlap: ${candidate.sourceLabel ?? candidate.source ?? candidate.sourceType}`);
        }
      }
    }
  }

  return {
    score: clamp(score, 0, SOURCE_BONUS + SOURCE_TYPE_BONUS),
    reasons,
  };
}

function scorePrior(
  candidate: CostMatcherCandidate,
  priorIndex: Map<string, CostMatcherPriorMatch>,
  historicalIndex: Map<string, CostMatcherPriorMatch>,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const prior = lookupBonus(candidate, priorIndex);
  if (prior) {
    const weight = normalizeWeight(prior.weight);
    score += PRIOR_BONUS * weight;
    reasons.push(prior.reason ? `prior match: ${prior.reason}` : "prior match");
  }

  const historical = lookupBonus(candidate, historicalIndex);
  if (historical) {
    const weight = normalizeWeight(historical.weight);
    score += HISTORICAL_BONUS * weight;
    reasons.push(historical.reason ? `historical match: ${historical.reason}` : "historical match");
  }

  if (candidate.priorScore && candidate.priorScore > 0) {
    score += PRIOR_BONUS * clamp(candidate.priorScore, 0, 1);
    reasons.push("candidate prior score");
  }

  if (candidate.historicalScore && candidate.historicalScore > 0) {
    score += HISTORICAL_BONUS * clamp(candidate.historicalScore, 0, 1);
    reasons.push("candidate historical score");
  }

  return {
    score: clamp(score, 0, PRIOR_BONUS + HISTORICAL_BONUS),
    reasons,
  };
}

function buildBonusIndex(matches: readonly CostMatcherPriorMatch[] | undefined): Map<string, CostMatcherPriorMatch> {
  const index = new Map<string, CostMatcherPriorMatch>();
  for (const match of matches ?? []) {
    if (!match.candidateId) {
      continue;
    }
    const existing = index.get(match.candidateId);
    if (!existing || normalizeWeight(match.weight) > normalizeWeight(existing.weight)) {
      index.set(match.candidateId, match);
    }
  }
  return index;
}

function lookupBonus(
  candidate: CostMatcherCandidate,
  index: Map<string, CostMatcherPriorMatch>,
): CostMatcherPriorMatch | null {
  return (
    index.get(candidate.id) ??
    index.get(candidate.sourceId) ??
    index.get(makeCandidateId(candidate.sourceType, candidate.sourceId)) ??
    null
  );
}

function normalizeWeight(weight: number | null | undefined): number {
  return weight === undefined || weight === null ? 1 : clamp(weight, 0, 1);
}

function inferUnitFromText(text: string): string | null {
  const normalized = normalizeSearchText(text);
  const compact = normalized.replace(/\s+/g, "");

  if (UNIT_ALIASES.has(compact)) {
    return UNIT_ALIASES.get(compact)!;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  for (let index = 0; index < tokens.length; index += 1) {
    const one = tokens[index]!;
    const two = `${one}${tokens[index + 1] ?? ""}`;
    const canonical = UNIT_ALIASES.get(two) ?? UNIT_ALIASES.get(one);
    if (canonical) {
      return canonical;
    }
  }

  return null;
}

function tokenize(value: string): string[] {
  const normalized = normalizeSearchText(value);
  if (!normalized) {
    return [];
  }

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of normalized.split(" ")) {
    const normalizedToken = normalizeToken(token);
    if (!normalizedToken || STOP_WORDS.has(normalizedToken) || seen.has(normalizedToken)) {
      continue;
    }
    seen.add(normalizedToken);
    tokens.push(normalizedToken);
  }

  return tokens;
}

function normalizeToken(token: string): string {
  let value = token.toLowerCase();
  if (value === "labour") {
    value = "labor";
  }

  if (value.endsWith("ies") && value.length > 4) {
    value = `${value.slice(0, -3)}y`;
  } else if (
    value.length > 4 &&
    (value.endsWith("ches") ||
      value.endsWith("shes") ||
      value.endsWith("xes") ||
      value.endsWith("sses") ||
      value.endsWith("zzes"))
  ) {
    value = value.slice(0, -2);
  } else if (value.endsWith("s") && !value.endsWith("ss") && value.length > 3) {
    value = value.slice(0, -1);
  }

  return value;
}

function candidateText(candidate: CostMatcherCandidate): string {
  return joinSearchText([
    candidate.code,
    candidate.name,
    candidate.description,
    candidate.unit,
    candidate.category,
    candidate.source,
    candidate.sourceKey,
    candidate.sourceLabel,
    candidate.sourceType.replace(/_/g, " "),
    ...(candidate.tags ?? []),
    candidate.searchableText,
    ...unknownToSearchText(candidate.metadata ?? {}),
  ]);
}

function inferDatasetRowName(
  data: Record<string, unknown>,
  columns: readonly DatasetColumn[] | undefined,
  nameKeys: readonly string[] | undefined,
): string {
  const explicit = firstStringFromRecord(data, nameKeys ?? NAME_KEYS.slice(0, 7));
  if (explicit) {
    return explicit;
  }

  const textValues: string[] = [];
  for (const column of columns ?? []) {
    if (column.type !== "text" && column.type !== "select") {
      continue;
    }

    if (UNIT_KEYS.some((key) => keysEqual(column.key, key))) {
      continue;
    }

    const value = unknownToSingleLineString(data[column.key]);
    if (value) {
      textValues.push(value);
    }
  }

  if (textValues.length > 0) {
    return uniqueStrings(textValues).slice(0, 4).join(" - ");
  }

  return uniqueStrings(unknownToSearchText(data)).slice(0, 4).join(" - ");
}

function firstStringFromRecord(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = findRecordValue(record, key);
    const text = unknownToSingleLineString(value);
    if (text) {
      return text;
    }
  }

  return null;
}

function firstNumberFromRecord(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = parseFiniteNumber(findRecordValue(record, key));
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function findRecordValue(record: Record<string, unknown>, wantedKey: string): unknown {
  for (const [key, value] of Object.entries(record)) {
    if (keysEqual(key, wantedKey)) {
      return value;
    }
  }

  return undefined;
}

function keysEqual(left: string, right: string): boolean {
  return normalizeSearchText(left).replace(/\s+/g, "") === normalizeSearchText(right).replace(/\s+/g, "");
}

function firstFiniteNumber(values: readonly unknown[]): number | null {
  for (const value of values) {
    const number = parseFiniteNumber(value);
    if (number !== null) {
      return number;
    }
  }

  return null;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function unknownToSingleLineString(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.trim().replace(/\s+/g, " ");
    return text || null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function unknownToSearchText(value: unknown, depth = 0): string[] {
  if (value === null || value === undefined || depth > 3) {
    return [];
  }

  const scalar = unknownToSingleLineString(value);
  if (scalar) {
    return [scalar];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => unknownToSearchText(entry, depth + 1));
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => [
      key,
      ...unknownToSearchText(entry, depth + 1),
    ]);
  }

  return [];
}

function joinSearchText(values: readonly unknown[]): string {
  return compactStrings(values.flatMap((value) => unknownToSearchText(value))).join(" ");
}

function compactStrings(values: readonly unknown[]): string[] {
  return values
    .map((value) => unknownToSingleLineString(value))
    .filter((value): value is string => !!value);
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function makeCandidateId(sourceType: CostMatcherSourceType, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
