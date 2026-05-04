import type { RateSchedule, WorkspaceWorksheetItem } from "@/lib/api";

export interface WorksheetHourTierBreakdown {
  tierId: string;
  name: string;
  multiplier: number;
  sortOrder: number;
  hours: number;
}

export interface WorksheetHourBreakdown {
  /** Per-tier hours (sorted by tier sortOrder, then multiplier). */
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

function normalizeTierUnits(tierUnits: Record<string, number> | undefined) {
  const normalized: Record<string, number> = {};
  for (const [tierId, rawHours] of Object.entries(tierUnits ?? {})) {
    const hours = toNumber(rawHours);
    if (hours > 0) {
      normalized[tierId] = hours;
    }
  }
  return normalized;
}

function findMatchingSchedule(row: WorkspaceWorksheetItem, schedules: RateSchedule[]) {
  if (row.rateScheduleItemId) {
    const directMatch = schedules.find((schedule) =>
      (schedule.items ?? []).some((scheduleItem) => scheduleItem.id === row.rateScheduleItemId),
    );
    if (directMatch) {
      return directMatch;
    }
  }

  const entityName = row.entityName?.trim();
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

function findTierByIdOrPrefix(schedule: RateSchedule | null, tierId: string) {
  const tiers = schedule?.tiers ?? [];
  return tiers.find((tier) => tier.id === tierId || tier.id.startsWith(tierId)) ?? null;
}

function compareTiers(a: { sortOrder?: number; multiplier?: number }, b: { sortOrder?: number; multiplier?: number }) {
  const aSort = Number.isFinite(a.sortOrder) ? Number(a.sortOrder) : Number.POSITIVE_INFINITY;
  const bSort = Number.isFinite(b.sortOrder) ? Number(b.sortOrder) : Number.POSITIVE_INFINITY;
  if (aSort !== bSort) return aSort - bSort;
  return toNumber(a.multiplier) - toNumber(b.multiplier);
}

export function getWorksheetHourBreakdown(row: WorkspaceWorksheetItem, schedules: RateSchedule[]): WorksheetHourBreakdown {
  const tierUnits = normalizeTierUnits(row.tierUnits);
  if (Object.keys(tierUnits).length === 0) {
    return { tiers: [], total: 0 };
  }

  const schedule = findMatchingSchedule(row, schedules);
  const breakdown: WorksheetHourTierBreakdown[] = [];
  let total = 0;

  for (const [rawTierId, rawHours] of Object.entries(tierUnits)) {
    const hours = toNumber(rawHours);
    if (hours <= 0) continue;
    const tier = findTierByIdOrPrefix(schedule, rawTierId);
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
  return { tiers: breakdown, total: roundHours(total) };
}

/**
 * Buckets per-tier hours into reg / ot / dt by tier multiplier (1.0 / 1.5 / 2.0).
 * Tiers with other multipliers fall through into total only.
 */
export function bucketHoursByMultiplier(breakdown: WorksheetHourBreakdown) {
  let reg = 0;
  let ot = 0;
  let dt = 0;
  for (const tier of breakdown.tiers) {
    if (tier.multiplier === 1) reg += tier.hours;
    else if (tier.multiplier === 1.5) ot += tier.hours;
    else if (tier.multiplier === 2) dt += tier.hours;
  }
  return { reg, ot, dt, total: breakdown.total };
}
