export interface WorksheetHourTierLike {
  id: string;
  name?: string | null;
  multiplier?: number | null;
  sortOrder?: number | null;
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
  entityName?: string | null;
  rateScheduleItemId?: string | null;
  unit1?: number | null;
  unit2?: number | null;
  unit3?: number | null;
  tierUnits?: Record<string, number> | null;
}

export interface WorksheetHourBreakdown {
  unit1: number;
  unit2: number;
  unit3: number;
  total: number;
  source: "legacy" | "tier";
}

const OVERTIME_PATTERN = /(^|[^a-z])ot([^a-z]|$)|overtime|time[\s-]*and[\s-]*half|week(?:ly)?/i;
const DOUBLETIME_PATTERN = /double|(^|[^a-z])dt([^a-z]|$)|2x|two[\s-]*time|month(?:ly)?/i;
const REGULAR_PATTERN = /regular|straight|base|day(?:ly)?/i;

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLegacyUnits(item: WorksheetHourItemLike) {
  return {
    unit1: toNumber(item.unit1),
    unit2: toNumber(item.unit2),
    unit3: toNumber(item.unit3),
  };
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

function inferSlotFromTier(
  tierName: string | null | undefined,
  multiplier: number | null | undefined,
): "unit1" | "unit2" | "unit3" {
  const normalizedMultiplier = toNumber(multiplier);
  if (Math.abs(normalizedMultiplier - 2) < 0.001) {
    return "unit3";
  }
  if (Math.abs(normalizedMultiplier - 1.5) < 0.001) {
    return "unit2";
  }
  if (Math.abs(normalizedMultiplier - 1) < 0.001) {
    return "unit1";
  }

  const label = (tierName ?? "").trim();
  if (DOUBLETIME_PATTERN.test(label)) {
    return "unit3";
  }
  if (OVERTIME_PATTERN.test(label)) {
    return "unit2";
  }
  if (REGULAR_PATTERN.test(label)) {
    return "unit1";
  }

  return "unit1";
}

function sortTiersByLikelyOrder(tiers: WorksheetHourTierLike[]) {
  return [...tiers].sort((left, right) => {
    const leftSort = Number.isFinite(left.sortOrder) ? Number(left.sortOrder) : Number.POSITIVE_INFINITY;
    const rightSort = Number.isFinite(right.sortOrder) ? Number(right.sortOrder) : Number.POSITIVE_INFINITY;
    if (leftSort !== rightSort) {
      return leftSort - rightSort;
    }

    return toNumber(left.multiplier) - toNumber(right.multiplier);
  });
}

function findTierForSlot(
  slot: "unit1" | "unit2" | "unit3",
  tiers: WorksheetHourTierLike[],
) {
  const matcher = slot === "unit1"
    ? (tier: WorksheetHourTierLike) => inferSlotFromTier(tier.name, tier.multiplier) === "unit1"
    : slot === "unit2"
      ? (tier: WorksheetHourTierLike) => inferSlotFromTier(tier.name, tier.multiplier) === "unit2"
      : (tier: WorksheetHourTierLike) => inferSlotFromTier(tier.name, tier.multiplier) === "unit3";

  return sortTiersByLikelyOrder(tiers).find(matcher) ?? null;
}

export function getWorksheetHourBreakdown(
  item: WorksheetHourItemLike,
  schedules: WorksheetHourRateScheduleLike[],
): WorksheetHourBreakdown {
  const legacyUnits = normalizeLegacyUnits(item);
  const tierUnits = normalizeTierUnits(item.tierUnits);

  if (Object.keys(tierUnits).length === 0) {
    return {
      ...legacyUnits,
      total: roundHours(legacyUnits.unit1 + legacyUnits.unit2 + legacyUnits.unit3),
      source: "legacy",
    };
  }

  const schedule = findMatchingSchedule(item, schedules);
  const tiers = schedule?.tiers ?? [];

  let unit1 = 0;
  let unit2 = 0;
  let unit3 = 0;

  for (const [tierId, rawHours] of Object.entries(tierUnits)) {
    const hours = toNumber(rawHours);
    if (hours <= 0) {
      continue;
    }

    const tier = findTierByIdOrPrefix(tiers, tierId);
    const slot = inferSlotFromTier(tier?.name ?? tierId, tier?.multiplier);
    if (slot === "unit3") {
      unit3 += hours;
    } else if (slot === "unit2") {
      unit2 += hours;
    } else {
      unit1 += hours;
    }
  }

  return {
    unit1: roundHours(unit1),
    unit2: roundHours(unit2),
    unit3: roundHours(unit3),
    total: roundHours(unit1 + unit2 + unit3),
    source: "tier",
  };
}

export function getExtendedWorksheetHourBreakdown(
  item: WorksheetHourItemLike,
  schedules: WorksheetHourRateScheduleLike[],
  quantity = 1,
): WorksheetHourBreakdown {
  const base = getWorksheetHourBreakdown(item, schedules);
  const multiplier = toNumber(quantity) || 1;

  return {
    unit1: roundHours(base.unit1 * multiplier),
    unit2: roundHours(base.unit2 * multiplier),
    unit3: roundHours(base.unit3 * multiplier),
    total: roundHours(base.total * multiplier),
    source: base.source,
  };
}

export function mapLegacyUnitsToTierUnits(
  item: WorksheetHourItemLike,
  schedules: WorksheetHourRateScheduleLike[],
): Record<string, number> {
  const schedule = findMatchingSchedule(item, schedules);
  if (!schedule) {
    return {};
  }

  const units = normalizeLegacyUnits(item);
  const tiers = schedule.tiers ?? [];
  const regularTier = findTierForSlot("unit1", tiers);
  const overtimeTier = findTierForSlot("unit2", tiers);
  const doubletimeTier = findTierForSlot("unit3", tiers);
  const sortedTiers = sortTiersByLikelyOrder(tiers);

  const mapped: Record<string, number> = {};

  if (units.unit1 > 0) {
    const targetTier = regularTier ?? sortedTiers[0];
    if (targetTier) {
      mapped[targetTier.id] = units.unit1;
    }
  }
  if (units.unit2 > 0 && overtimeTier) {
    mapped[overtimeTier.id] = units.unit2;
  }
  if (units.unit3 > 0 && doubletimeTier) {
    mapped[doubletimeTier.id] = units.unit3;
  }

  return mapped;
}
