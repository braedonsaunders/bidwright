import type { RateSchedule, WorkspaceWorksheetItem } from "@/lib/api";

interface WorksheetHourBreakdown {
  unit1: number;
  unit2: number;
  unit3: number;
  total: number;
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

function inferSlotFromTier(tierName: string | undefined, multiplier: number | undefined) {
  const normalizedMultiplier = toNumber(multiplier);
  if (Math.abs(normalizedMultiplier - 2) < 0.001) {
    return "unit3" as const;
  }
  if (Math.abs(normalizedMultiplier - 1.5) < 0.001) {
    return "unit2" as const;
  }
  if (Math.abs(normalizedMultiplier - 1) < 0.001) {
    return "unit1" as const;
  }

  const label = (tierName ?? "").trim();
  if (DOUBLETIME_PATTERN.test(label)) {
    return "unit3" as const;
  }
  if (OVERTIME_PATTERN.test(label)) {
    return "unit2" as const;
  }
  if (REGULAR_PATTERN.test(label)) {
    return "unit1" as const;
  }

  return "unit1" as const;
}

function sortTiers(schedule: RateSchedule | null) {
  return [...(schedule?.tiers ?? [])].sort((left, right) => {
    const leftSort = Number.isFinite(left.sortOrder) ? Number(left.sortOrder) : Number.POSITIVE_INFINITY;
    const rightSort = Number.isFinite(right.sortOrder) ? Number(right.sortOrder) : Number.POSITIVE_INFINITY;
    if (leftSort !== rightSort) {
      return leftSort - rightSort;
    }

    return toNumber(left.multiplier) - toNumber(right.multiplier);
  });
}

function findTierForSlot(slot: "unit1" | "unit2" | "unit3", schedule: RateSchedule | null) {
  return sortTiers(schedule).find((tier) => inferSlotFromTier(tier.name, tier.multiplier) === slot) ?? null;
}

export function getWorksheetHourBreakdown(row: WorkspaceWorksheetItem, schedules: RateSchedule[]): WorksheetHourBreakdown {
  const legacy = {
    unit1: toNumber(row.unit1),
    unit2: toNumber(row.unit2),
    unit3: toNumber(row.unit3),
  };
  const tierUnits = normalizeTierUnits(row.tierUnits);

  if (Object.keys(tierUnits).length === 0) {
    return {
      ...legacy,
      total: roundHours(legacy.unit1 + legacy.unit2 + legacy.unit3),
    };
  }

  const schedule = findMatchingSchedule(row, schedules);

  let unit1 = 0;
  let unit2 = 0;
  let unit3 = 0;

  for (const [tierId, rawHours] of Object.entries(tierUnits)) {
    const hours = toNumber(rawHours);
    if (hours <= 0) {
      continue;
    }

    const tier = findTierByIdOrPrefix(schedule, tierId);
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
  };
}

export function mapLegacyUnitsToTierUnits(
  row: WorkspaceWorksheetItem,
  schedules: RateSchedule[],
  nextUnits: Pick<WorkspaceWorksheetItem, "unit1" | "unit2" | "unit3">,
) {
  const schedule = findMatchingSchedule(row, schedules);
  if (!schedule) {
    return {};
  }

  const regularTier = findTierForSlot("unit1", schedule) ?? sortTiers(schedule)[0] ?? null;
  const overtimeTier = findTierForSlot("unit2", schedule);
  const doubletimeTier = findTierForSlot("unit3", schedule);

  const tierUnits: Record<string, number> = {};
  if (nextUnits.unit1 > 0 && regularTier) {
    tierUnits[regularTier.id] = nextUnits.unit1;
  }
  if (nextUnits.unit2 > 0 && overtimeTier) {
    tierUnits[overtimeTier.id] = nextUnits.unit2;
  }
  if (nextUnits.unit3 > 0 && doubletimeTier) {
    tierUnits[doubletimeTier.id] = nextUnits.unit3;
  }

  return tierUnits;
}
