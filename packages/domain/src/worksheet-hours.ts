export interface WorksheetHourTierLike {
  id: string;
  name?: string | null;
  multiplier?: number | null;
  sortOrder?: number | null;
  uom?: string | null;
}

export interface WorksheetHourRateScheduleItemLike {
  id: string;
  name?: string | null;
  code?: string | null;
}

export interface WorksheetHourRateScheduleLike {
  tiers: WorksheetHourTierLike[];
  items: WorksheetHourRateScheduleItemLike[];
}

export interface WorksheetHourItemLike {
  categoryId?: string | null;
  category?: string | null;
  entityType?: string | null;
  entityName?: string | null;
  rateScheduleItemId?: string | null;
  tierUnits?: Record<string, number> | null;
}

export interface WorksheetUnitCategoryLike {
  id: string;
  name?: string | null;
  entityType?: string | null;
  analyticsBucket?: string | null;
  calculationType?: string | null;
}

export type WorksheetUnitKind = "labour_hours" | "equipment_duration" | "other_units";

export interface WorksheetHourTierBreakdown {
  tierId: string;
  name: string;
  multiplier: number;
  sortOrder: number;
  uom: string;
  hours: number;
}

export interface WorksheetHourBreakdown {
  /** One entry per tier with hours > 0, ordered by tier.sortOrder then multiplier. */
  tiers: WorksheetHourTierBreakdown[];
  total: number;
}

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTierUnits(tierUnits: Record<string, number> | null | undefined) {
  const normalized: Record<string, number> = {};
  for (const [tierId, rawHours] of Object.entries(tierUnits ?? {})) {
    const hours = toNumber(rawHours);
    if (hours > 0) {
      normalized[tierId] = hours;
    }
  }
  return normalized;
}

function normalizeToken(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function findWorksheetUnitCategory(
  item: WorksheetHourItemLike,
  categories: WorksheetUnitCategoryLike[],
) {
  if (item.categoryId) {
    const byId = categories.find((category) => category.id === item.categoryId);
    if (byId) return byId;
  }
  const categoryName = normalizeToken(item.category);
  const entityType = normalizeToken(item.entityType);
  return categories.find((category) => {
    const name = normalizeToken(category.name);
    const type = normalizeToken(category.entityType);
    return (categoryName && name === categoryName) || (entityType && type === entityType);
  }) ?? null;
}

export function getWorksheetUnitKind(
  item: WorksheetHourItemLike,
  categories: WorksheetUnitCategoryLike[],
): WorksheetUnitKind {
  const category = findWorksheetUnitCategory(item, categories);
  const bucket = normalizeToken(category?.analyticsBucket);
  if (bucket === "labour" || bucket === "labor") return "labour_hours";
  if (bucket === "equipment" || category?.calculationType === "duration_rate") {
    return "equipment_duration";
  }

  // Compatibility for older tenants that have not populated analyticsBucket.
  // Stable category configuration remains authoritative whenever it exists.
  const categoryIdentity = normalizeToken(
    `${category?.name ?? item.category ?? ""} ${category?.entityType ?? item.entityType ?? ""}`,
  );
  if (categoryIdentity.includes("labour") || categoryIdentity.includes("labor")) {
    return "labour_hours";
  }
  if (categoryIdentity.includes("equipment")) return "equipment_duration";
  return "other_units";
}

function findMatchingSchedule(
  item: WorksheetHourItemLike,
  schedules: WorksheetHourRateScheduleLike[],
) {
  if (item.rateScheduleItemId) {
    const directMatch = schedules.find((schedule) =>
      (schedule.items ?? []).some((scheduleItem) => scheduleItem.id === item.rateScheduleItemId),
    );
    if (directMatch) {
      return directMatch;
    }
  }

  const entityName = item.entityName?.trim();
  if (!entityName) {
    return null;
  }

  return (
    schedules.find((schedule) =>
      (schedule.items ?? []).some(
        (scheduleItem) => scheduleItem.name === entityName || scheduleItem.code === entityName,
      ),
    ) ?? null
  );
}

function findTierByIdOrPrefix(
  tiers: WorksheetHourTierLike[],
  tierId: string,
) {
  return tiers.find((tier) => tier.id === tierId || tier.id.startsWith(tierId)) ?? null;
}

const TIER_KEY_LABELS: Record<string, string> = {
  __unit: "Units",
  unit: "Units",
  units: "Units",
  __reg: "Regular",
  reg: "Regular",
  regular: "Regular",
  __ot: "Overtime",
  ot: "Overtime",
  overtime: "Overtime",
  __dt: "Double Time",
  dt: "Double Time",
  doubletime: "Double Time",
};

function findTierByAlias(tiers: WorksheetHourTierLike[], rawTierId: string) {
  const expectedLabel = TIER_KEY_LABELS[normalizeToken(rawTierId)];
  if (!expectedLabel) return null;
  const expected = normalizeToken(expectedLabel);
  return tiers.find((tier) => normalizeToken(tier.name) === expected) ?? null;
}

/** Natural progression for legacy alias keys that match no ratebook tier. */
const TIER_KEY_FALLBACK_ORDER: Record<string, number> = {
  unit: 0, units: 0,
  reg: 1, regular: 1,
  ot: 2, overtime: 2,
  dt: 3, doubletime: 3,
};

// Ordered after every real ratebook tier, but deterministically among
// themselves — an unresolved tier has no authored sortOrder to honour, and
// leaving these at Infinity made the comparator return NaN.
const UNRESOLVED_TIER_SORT_BASE = 1_000_000;

function fallbackTierSortOrder(rawTierId: string) {
  const known = TIER_KEY_FALLBACK_ORDER[normalizeToken(rawTierId)];
  return known === undefined
    ? UNRESOLVED_TIER_SORT_BASE + 100
    : UNRESOLVED_TIER_SORT_BASE + known;
}

function safeTierLabel(rawTierId: string) {
  const known = TIER_KEY_LABELS[normalizeToken(rawTierId)];
  if (known) return known;
  // Persisted tier IDs are implementation details. If a tier was replaced or
  // deleted, never leak its UUID into customer-facing tables or summaries.
  if (/^(?:rst|tier)-[a-f0-9-]{12,}$/i.test(rawTierId)) return "Standard";
  const readable = rawTierId
    .replace(/^__/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return readable
    ? readable.replace(/\b\w/g, (character) => character.toUpperCase())
    : "Standard";
}

function compareTiers(
  a: { sortOrder?: number | null; multiplier?: number | null },
  b: { sortOrder?: number | null; multiplier?: number | null },
): number {
  const aSort = Number.isFinite(a.sortOrder) ? Number(a.sortOrder) : Number.POSITIVE_INFINITY;
  const bSort = Number.isFinite(b.sortOrder) ? Number(b.sortOrder) : Number.POSITIVE_INFINITY;
  if (aSort !== bSort) return aSort - bSort;
  return toNumber(a.multiplier) - toNumber(b.multiplier);
}

export function getWorksheetHourBreakdown(
  item: WorksheetHourItemLike,
  schedules: WorksheetHourRateScheduleLike[],
): WorksheetHourBreakdown {
  const tierUnits = normalizeTierUnits(item.tierUnits);
  if (Object.keys(tierUnits).length === 0) {
    return { tiers: [], total: 0 };
  }

  const schedule = findMatchingSchedule(item, schedules);
  const tiers = schedule?.tiers ?? [];
  const populatedTierIds = Object.keys(tierUnits);
  const soleUnresolvedTier = populatedTierIds.length === 1
    && !findTierByIdOrPrefix(tiers, populatedTierIds[0]!)
    && !findTierByAlias(tiers, populatedTierIds[0]!);
  const defaultScheduleTier = soleUnresolvedTier
    ? [...tiers].sort(compareTiers).find((tier) => toNumber(tier.multiplier) === 1)
      ?? [...tiers].sort(compareTiers)[0]
      ?? null
    : null;

  const breakdown: WorksheetHourTierBreakdown[] = [];
  let total = 0;
  for (const [rawTierId, rawHours] of Object.entries(tierUnits)) {
    const hours = toNumber(rawHours);
    if (hours <= 0) continue;
    const tier = findTierByIdOrPrefix(tiers, rawTierId)
      ?? findTierByAlias(tiers, rawTierId)
      ?? defaultScheduleTier;
    breakdown.push({
      tierId: tier?.id ?? rawTierId,
      name: tier?.name ?? safeTierLabel(rawTierId),
      multiplier: toNumber(tier?.multiplier) || 1,
      sortOrder: Number.isFinite(tier?.sortOrder ?? null)
        ? Number(tier?.sortOrder)
        : fallbackTierSortOrder(rawTierId),
      uom: String(tier?.uom ?? "").trim(),
      hours: roundHours(hours),
    });
    total += hours;
  }

  breakdown.sort(compareTiers);

  return {
    tiers: breakdown,
    total: roundHours(total),
  };
}

export function getExtendedWorksheetHourBreakdown(
  item: WorksheetHourItemLike,
  schedules: WorksheetHourRateScheduleLike[],
  quantity = 1,
): WorksheetHourBreakdown {
  const base = getWorksheetHourBreakdown(item, schedules);
  const parsedQuantity = Number(quantity);
  const multiplier = Number.isFinite(parsedQuantity) ? parsedQuantity : 1;

  return {
    tiers: base.tiers.map((tier) => ({
      ...tier,
      hours: roundHours(tier.hours * multiplier),
    })),
    total: roundHours(base.total * multiplier),
  };
}

export interface WorksheetSemanticUnitBreakdown extends WorksheetHourBreakdown {
  kind: WorksheetUnitKind;
}

export function getExtendedWorksheetUnitBreakdown(
  item: WorksheetHourItemLike,
  schedules: WorksheetHourRateScheduleLike[],
  categories: WorksheetUnitCategoryLike[],
  quantity = 1,
): WorksheetSemanticUnitBreakdown {
  return {
    ...getExtendedWorksheetHourBreakdown(item, schedules, quantity),
    kind: getWorksheetUnitKind(item, categories),
  };
}

export interface WorksheetUnitRollupTier {
  tierId: string;
  name: string;
  multiplier: number;
  sortOrder: number;
  uom: string;
  total: number;
}

export interface WorksheetUnitRollup {
  labourHours: {
    tiers: WorksheetUnitRollupTier[];
    total: number;
  };
  equipmentDuration: {
    tiers: WorksheetUnitRollupTier[];
    total: number;
  };
  otherUnits: {
    tiers: WorksheetUnitRollupTier[];
    total: number;
  };
}

export function rollupWorksheetUnits(
  items: Array<WorksheetHourItemLike & { quantity?: number | null }>,
  schedules: WorksheetHourRateScheduleLike[],
  categories: WorksheetUnitCategoryLike[],
): WorksheetUnitRollup {
  const buckets = {
    labour_hours: new Map<string, WorksheetUnitRollupTier>(),
    equipment_duration: new Map<string, WorksheetUnitRollupTier>(),
    other_units: new Map<string, WorksheetUnitRollupTier>(),
  };

  for (const item of items) {
    const breakdown = getExtendedWorksheetUnitBreakdown(
      item,
      schedules,
      categories,
      item.quantity ?? 1,
    );
    for (const tier of breakdown.tiers) {
      const key = `${tier.tierId}::${tier.uom}`;
      const existing = buckets[breakdown.kind].get(key);
      if (existing) {
        existing.total = roundHours(existing.total + tier.hours);
      } else {
        buckets[breakdown.kind].set(key, {
          tierId: tier.tierId,
          name: tier.name,
          multiplier: tier.multiplier,
          sortOrder: tier.sortOrder,
          uom: tier.uom,
          total: tier.hours,
        });
      }
    }
  }

  const materialize = (bucket: Map<string, WorksheetUnitRollupTier>) => {
    const tiers = [...bucket.values()].sort(compareTiers);
    return {
      tiers,
      total: roundHours(tiers.reduce((sum, tier) => sum + tier.total, 0)),
    };
  };

  return {
    labourHours: materialize(buckets.labour_hours),
    equipmentDuration: materialize(buckets.equipment_duration),
    otherUnits: materialize(buckets.other_units),
  };
}
