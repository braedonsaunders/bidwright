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
  tierUnits?: Record<string, number> | null;
}

export interface WorksheetHourTierBreakdown {
  tierId: string;
  name: string;
  multiplier: number;
  sortOrder: number;
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

  const breakdown: WorksheetHourTierBreakdown[] = [];
  let total = 0;
  for (const [rawTierId, rawHours] of Object.entries(tierUnits)) {
    const hours = toNumber(rawHours);
    if (hours <= 0) continue;
    const tier = findTierByIdOrPrefix(tiers, rawTierId);
    breakdown.push({
      tierId: tier?.id ?? rawTierId,
      name: tier?.name ?? rawTierId,
      multiplier: toNumber(tier?.multiplier) || 1,
      sortOrder: Number.isFinite(tier?.sortOrder ?? null) ? Number(tier?.sortOrder) : Number.POSITIVE_INFINITY,
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
  const multiplier = toNumber(quantity) || 1;

  return {
    tiers: base.tiers.map((tier) => ({
      ...tier,
      hours: roundHours(tier.hours * multiplier),
    })),
    total: roundHours(base.total * multiplier),
  };
}
