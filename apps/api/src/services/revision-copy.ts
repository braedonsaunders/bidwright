/**
 * Identifier remapping for a revision copy.
 *
 * Copying a revision mints new rate schedules, tiers and schedule items. A
 * worksheet row addresses two of those by id — `rateScheduleItemId` names the
 * rate item, and `tierUnits` is keyed by tier id — so a row carried over
 * verbatim still points at the previous revision's ids. The new revision then
 * shows no hours (its tier keys match none of its tiers) and rejects its own
 * rate items as non-existent.
 */

/**
 * Re-key a row's tier hours onto the copied tiers.
 *
 * Keys that name no copied tier pass through untouched: legacy rows use
 * synthetic aliases like `__reg`, and dropping them would silently delete
 * hours the estimator entered.
 */
export function remapTierUnits(
  tierUnits: unknown,
  tierIdMap: ReadonlyMap<string, string>,
): Record<string, number> {
  if (!tierUnits || typeof tierUnits !== "object" || Array.isArray(tierUnits)) return {};
  const remapped: Record<string, number> = {};
  for (const [tierId, value] of Object.entries(tierUnits as Record<string, unknown>)) {
    const numeric = Number(value);
    remapped[tierIdMap.get(tierId) ?? tierId] = Number.isFinite(numeric) ? numeric : 0;
  }
  return remapped;
}

/**
 * Point a copied row at the copied rate item. An id with no mapping is left
 * as-is rather than nulled — losing the reference would strip the row's
 * pricing basis, which is worse than leaving a stale pointer to diagnose.
 */
export function remapRateScheduleItemId(
  rateScheduleItemId: string | null | undefined,
  scheduleItemIdMap: ReadonlyMap<string, string>,
): string | null {
  if (!rateScheduleItemId) return null;
  return scheduleItemIdMap.get(rateScheduleItemId) ?? rateScheduleItemId;
}
