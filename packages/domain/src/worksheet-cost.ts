export interface WorksheetCostProvenanceLike {
  itemId?: string | null;
  costResourceId?: string | null;
  effectiveCostId?: string | null;
  rateScheduleItemId?: string | null;
}

/**
 * Estimate categories define calculation and reporting behavior. The row's
 * provenance independently defines whether its unit cost is user-owned or
 * supplied by a library/rate source.
 */
export function isWorksheetCostLibraryManaged(
  item: WorksheetCostProvenanceLike | null | undefined,
) {
  return Boolean(
    item?.itemId
    || item?.costResourceId
    || item?.effectiveCostId
    || item?.rateScheduleItemId,
  );
}
