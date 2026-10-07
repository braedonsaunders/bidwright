/**
 * Response compaction for high-volume list tools.
 *
 * Measured on the 2026-10-07 model matrix: a single estimate run accumulated
 * ~200k tokens of tool-result text before any row was saved. The biggest
 * B-owned contributors were listLaborUnits (~1.3k chars per candidate),
 * listRateScheduleItems (up to 50k chars when every item carried full rate
 * maps), listRateSchedules (tiers + samples per schedule) and getItemConfig
 * (unbounded catalog item lists). These helpers keep the fields an estimator
 * needs to select and plumb a row (stable ids, unit, basis, rates when the
 * query is narrow enough to act on) and make every omission explicit.
 */

export interface PageInput {
  limit?: number | null;
  offset?: number | null;
}

export interface PageResult<T> {
  page: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  /** Offset to pass for the next page, or null when exhausted. */
  nextOffset: number | null;
  /** Rows not included in this page. */
  omitted: number;
}

export function paginate<T>(items: T[], input: PageInput, options: { defaultLimit: number; maxLimit: number }): PageResult<T> {
  const offset = Math.max(0, Math.trunc(Number(input.offset ?? 0)) || 0);
  const requested = Number(input.limit ?? options.defaultLimit);
  const limit = Math.max(1, Math.min(Number.isFinite(requested) ? Math.trunc(requested) : options.defaultLimit, options.maxLimit));
  const page = items.slice(offset, offset + limit);
  const hasMore = offset + page.length < items.length;
  return {
    page,
    total: items.length,
    offset,
    limit,
    hasMore,
    nextOffset: hasMore ? offset + page.length : null,
    omitted: Math.max(0, items.length - page.length),
  };
}

export function clipText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Display rounding for non-monetary summary fields only (hours, confidence); never applied to rates. */
function round2(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

export interface RateTier {
  id: string;
  name: string;
  multiplier?: number | null;
  uom?: string | null;
}

export function scheduleTierList(schedule: Record<string, any>): RateTier[] {
  return (Array.isArray(schedule?.tiers) ? schedule.tiers : []).map((tier: any) => ({
    id: String(tier.id ?? ""),
    name: String(tier.name ?? ""),
    multiplier: tier.multiplier ?? null,
    uom: tier.uom ?? null,
  }));
}

/**
 * Rates come back keyed by tier id. Re-key by tier NAME for readability (ids
 * are listed once per schedule in `tiers`). Values pass through at their
 * stored precision: unit rates may legitimately be fractional cents and a
 * derivation built from a rounded input would disagree with the stored rate.
 * Never drops a rate value: an unknown tier id is kept under its id, and a
 * tier name shared by more than one tier falls back to the id so one tier's
 * rate can never overwrite another's.
 */
export function compactRateMap(map: unknown, tiers: RateTier[]): Record<string, number> | undefined {
  if (!map || typeof map !== "object") return undefined;
  const nameCounts = new Map<string, number>();
  for (const tier of tiers) {
    const name = tier.name || tier.id;
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  // Duplicate tier names are disambiguated as "name (tierId)" so two tiers
  // can never share an output key.
  const keyById = new Map(tiers.map((tier) => {
    const name = tier.name || tier.id;
    return [tier.id, (nameCounts.get(name) ?? 0) > 1 ? `${name} (${tier.id})` : name];
  }));
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) continue;
    let outKey = keyById.get(key) ?? key;
    if (outKey in out) {
      // An unmapped key colliding with a named tier's label keeps its source key visible.
      outKey = `${outKey} (${key})`;
      let suffix = 2;
      while (outKey in out) outKey = `${keyById.get(key) ?? key} (${key}) #${suffix++}`;
    }
    out[outKey] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface CompactRateItem {
  rateScheduleItemId: string;
  scheduleId: string;
  name: string | undefined;
  code: string | undefined;
  unit: string | undefined;
  description?: string;
  /** Present when rates are included: sell rate by tier name. */
  rates?: Record<string, number>;
  /** Present when rates are included and differ: cost rate by tier name. */
  costRates?: Record<string, number>;
  burden?: unknown;
  perDiem?: unknown;
}

/**
 * One rate-schedule item for selection. Schedule name/category/tier ids are
 * NOT repeated per row; they are emitted once per schedule alongside the page.
 */
export function compactRateItem(item: Record<string, any>, schedule: Record<string, any>, options: { includeRates: boolean }): CompactRateItem {
  const tiers = scheduleTierList(schedule);
  const row: CompactRateItem = {
    rateScheduleItemId: String(item.id ?? ""),
    scheduleId: String(schedule.id ?? ""),
    name: clipText(item.name, 80),
    code: clipText(item.code, 32),
    unit: item.unit ? String(item.unit) : undefined,
    description: clipText(item.description, 80),
  };
  if (options.includeRates) {
    row.rates = compactRateMap(item.rates, tiers);
    const costRates = compactRateMap(item.costRates, tiers);
    if (costRates && JSON.stringify(costRates) !== JSON.stringify(row.rates)) row.costRates = costRates;
    if (item.burden && typeof item.burden === "object" && Object.keys(item.burden).length > 0) row.burden = item.burden;
    if (item.perDiem && typeof item.perDiem === "object" && Object.keys(item.perDiem).length > 0) row.perDiem = item.perDiem;
  }
  return row;
}

/**
 * Rates are included automatically when the request is narrow enough to act
 * on (a search term, a schedule, or a category filter) or when the page is
 * small; broad unfiltered pages omit them and say so. An explicit boolean
 * always wins, so a caller can never lose rates silently.
 */
export function shouldIncludeRates(input: { includeRates?: boolean | null; narrowed: boolean; returned: number; smallPage?: number }): boolean {
  if (typeof input.includeRates === "boolean") return input.includeRates;
  if (input.narrowed) return true;
  return input.returned <= (input.smallPage ?? 25);
}

export interface CompactScheduleSummary {
  id: string;
  name: string | undefined;
  category: string | undefined;
  scope?: string;
  description?: string;
  itemCount: number;
  tierCount: number;
  /** Tier ids + names (needed for tierUnits). Multiplier/uom only on request. */
  tiers?: Array<{ id: string; name: string; multiplier?: number | null; uom?: string | null }>;
  tierNames?: string[];
  sampleItems?: string[];
  sampleItemsOmitted?: number;
}

export function compactScheduleSummary(
  schedule: Record<string, any>,
  options: { includeTiers?: "ids" | "full" | "names"; sampleItemCount?: number } = {},
): CompactScheduleSummary {
  const items = Array.isArray(schedule?.items) ? schedule.items : [];
  const tiers = scheduleTierList(schedule);
  const summary: CompactScheduleSummary = {
    id: String(schedule.id ?? ""),
    name: clipText(schedule.name, 80),
    category: schedule.category ? String(schedule.category) : undefined,
    scope: schedule.scope ? String(schedule.scope) : undefined,
    description: clipText(schedule.description, 100),
    itemCount: items.length || Number(schedule.itemCount ?? 0) || 0,
    tierCount: tiers.length,
  };
  const tierMode = options.includeTiers ?? "names";
  if (tierMode === "full") summary.tiers = tiers;
  else if (tierMode === "ids") summary.tiers = tiers.map((tier) => ({ id: tier.id, name: tier.name }));
  else summary.tierNames = tiers.map((tier) => tier.name || tier.id);
  const sampleCount = Math.max(0, options.sampleItemCount ?? 0);
  if (sampleCount > 0 && items.length > 0) {
    summary.sampleItems = items.slice(0, sampleCount).map((item: any) => clipText(item.name, 60) ?? String(item.id ?? ""));
    if (items.length > sampleCount) summary.sampleItemsOmitted = items.length - sampleCount;
  }
  return summary;
}

export interface CompactLaborUnitRow {
  id: string | undefined;
  code: string | undefined;
  name: string | undefined;
  /** "discipline › category › class › subclass" with empty segments dropped. */
  path: string | undefined;
  outputUom: string | undefined;
  hoursNormal: number | undefined;
  entityCategoryType: string | undefined;
  basis: { kind?: string; matchType?: string; sourceQuality?: string; confidence?: number; label?: string };
}

/**
 * A labour-unit candidate row for shortlisting. Everything needed to pick and
 * plumb it (id, code, hours per output unit) stays; taxonomy collapses to one
 * path string; duplicated basis fields and prose are removed. getLaborUnit
 * returns the full record.
 */
export function compactLaborUnitRow(
  unit: Record<string, any>,
  basis: { kind?: string; label?: string; matchType?: string; sourceQuality?: string; confidence?: number },
): CompactLaborUnitRow {
  const path = [unit.discipline, unit.category, unit.className, unit.subClassName]
    .map((segment) => clipText(segment, 40))
    .filter((segment): segment is string => Boolean(segment))
    .join(" › ");
  const hoursNormal = round2(unit.hoursNormal);
  return {
    id: unit.id ? String(unit.id) : undefined,
    code: clipText(unit.code, 32),
    name: clipText(unit.name, 80),
    path: path || undefined,
    outputUom: unit.outputUom ? String(unit.outputUom) : undefined,
    hoursNormal,
    entityCategoryType: unit.entityCategoryType ? String(unit.entityCategoryType) : undefined,
    basis: {
      kind: basis.kind,
      matchType: basis.matchType,
      sourceQuality: basis.sourceQuality,
      confidence: basis.confidence === undefined ? undefined : round2(basis.confidence),
      label: clipText(basis.label, 60),
    },
  };
}

/** Diagnostics reduced to the two signals the prompt tells the agent to read. */
export function compactLaborDiagnostics(diagnostics: unknown): { termHits?: Record<string, number>; querySlices?: number; truncatedKeys?: string[] } | undefined {
  if (!diagnostics || typeof diagnostics !== "object") return undefined;
  const raw = diagnostics as Record<string, unknown>;
  const out: { termHits?: Record<string, number>; querySlices?: number; truncatedKeys?: string[] } = {};
  const term = raw.term ?? raw.termHits ?? raw.terms;
  if (term && typeof term === "object" && !Array.isArray(term)) {
    const hits: Record<string, number> = {};
    for (const [key, value] of Object.entries(term as Record<string, unknown>).slice(0, 12)) {
      const n = typeof value === "number" ? value : Number((value as any)?.hits ?? (value as any)?.count ?? NaN);
      if (Number.isFinite(n)) hits[key] = n;
    }
    if (Object.keys(hits).length > 0) out.termHits = hits;
  }
  if (Array.isArray(raw.querySlices)) out.querySlices = raw.querySlices.length;
  const dropped = Object.keys(raw).filter((key) => !["term", "termHits", "terms", "querySlices"].includes(key));
  if (dropped.length > 0) out.truncatedKeys = dropped.slice(0, 8);
  return Object.keys(out).length > 0 ? out : undefined;
}
