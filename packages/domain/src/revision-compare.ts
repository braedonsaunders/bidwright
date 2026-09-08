// Quote-revision comparison.
//
// This is the estimate-side compare: "what changed between Rev 2 and Rev 3 of
// this quote". It is a different thing from the drawing-revision diff in
// revision-diff-service.ts, which compares two ModelAssets (BIM elements) and
// re-takes-off the worksheet rows they feed.
//
// Copying a revision mints brand new ids for every worksheet, row, phase and
// adjustment (see PrismaApiStore.createRevision), and nothing carries a
// back-pointer to the row it was copied from. So positions cannot be paired by
// id — they are paired on their natural key (worksheet + category + name +
// description + uom + vendor), the same identity an estimator reads off the
// sheet. Rows that share a key inside one revision are paired in sheet order,
// which keeps a repeated "Elbow, 2in" line from being reported as one add and
// one delete every time its neighbour moves.

/* ─── Inputs ─── */

export interface RevisionCompareItemLike {
  id?: string | null;
  worksheetId?: string | null;
  phaseId?: string | null;
  category?: string | null;
  entityType?: string | null;
  entityName?: string | null;
  vendor?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  uom?: string | null;
  /** Per-unit cost — the storage convention the calc engine relies on. */
  cost?: number | string | null;
  /** Extended sell price for the whole line, NOT a unit rate. `computeAggregates`
   *  in quote-engine.ts sums `price` straight into the subtotal while costing
   *  runs `quantity × cost`; the compare has to honour the same asymmetry or
   *  every priced line reads as a rate change. */
  price?: number | string | null;
  markup?: number | string | null;
  tierUnits?: Record<string, number | string | null | undefined> | null;
  /** Extended labour hours for the row, if the caller resolved them through
   *  the rate schedule. Falls back to sum(tierUnits) x quantity. */
  hours?: number | null;
}

export interface RevisionCompareWorksheetLike {
  id?: string | null;
  name?: string | null;
  order?: number | null;
  items?: RevisionCompareItemLike[] | null;
}

export interface RevisionComparePhaseLike {
  id?: string | null;
  number?: string | null;
  name?: string | null;
  description?: string | null;
  order?: number | null;
}

export interface RevisionCompareAdjustmentLike {
  id?: string | null;
  name?: string | null;
  kind?: string | null;
  type?: string | null;
  active?: boolean | null;
  show?: string | null;
  percentage?: number | string | null;
  amount?: number | string | null;
}

export interface RevisionCompareRevisionLike {
  id: string;
  revisionNumber?: number | null;
  title?: string | null;
  status?: string | null;
  type?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface RevisionCompareTotalsLike {
  subtotal?: number | null;
  cost?: number | null;
  estimatedProfit?: number | null;
  estimatedMargin?: number | null;
  calculatedTotal?: number | null;
  totalHours?: number | null;
  regHours?: number | null;
  overHours?: number | null;
  doubleHours?: number | null;
}

export interface RevisionCompareSide {
  revision: RevisionCompareRevisionLike;
  totals: RevisionCompareTotalsLike;
  worksheets: RevisionCompareWorksheetLike[];
  phases: RevisionComparePhaseLike[];
  adjustments: RevisionCompareAdjustmentLike[];
}

/* ─── Outputs ─── */

export interface RevisionCompareMeta {
  id: string;
  revisionNumber: number;
  title: string;
  status: string;
  type: string;
  updatedAt: string | null;
}

export type RevisionCompareMetricFormat = "money" | "percent" | "number";

export interface RevisionCompareMetric {
  key: string;
  label: string;
  format: RevisionCompareMetricFormat;
  base: number;
  head: number;
  delta: number;
  /** Fractional change vs the base, or null when the base is zero. */
  percentDelta: number | null;
}

export interface RevisionCompareLineItem {
  key: string;
  worksheetName: string;
  category: string;
  entityName: string;
  description: string;
  uom: string;
  vendor: string;
  quantity: number;
  /** As stored on the row. */
  unitCost: number;
  /** Derived: extended price ÷ quantity. */
  unitPrice: number;
  /** Derived: unit cost × quantity. */
  extendedCost: number;
  /** As stored on the row. */
  extendedPrice: number;
  hours: number;
}

/** What moved on a position that exists in both revisions. */
export type RevisionCompareChangeKind = "quantity" | "rate" | "cost" | "markup" | "hours";

export interface RevisionCompareLineItemChange {
  key: string;
  worksheetName: string;
  category: string;
  entityName: string;
  description: string;
  uom: string;
  vendor: string;
  changes: RevisionCompareChangeKind[];
  base: RevisionCompareLineItem;
  head: RevisionCompareLineItem;
  quantityDelta: number;
  unitCostDelta: number;
  unitPriceDelta: number;
  extendedCostDelta: number;
  extendedPriceDelta: number;
  hoursDelta: number;
}

export interface RevisionComparePhaseChange {
  number: string;
  base: { number: string; name: string; description: string } | null;
  head: { number: string; name: string; description: string } | null;
  changes: Array<"name" | "description">;
}

export interface RevisionCompareAdjustmentChange {
  name: string;
  base: { name: string; kind: string; percentage: number | null; amount: number | null; active: boolean } | null;
  head: { name: string; kind: string; percentage: number | null; amount: number | null; active: boolean } | null;
  changes: Array<"percentage" | "amount" | "active" | "kind">;
}

export interface QuoteRevisionComparison {
  /** The revision being compared *against* (usually the older one). */
  base: RevisionCompareMeta;
  /** The revision in hand (usually the current one). Deltas are head - base. */
  head: RevisionCompareMeta;
  financials: RevisionCompareMetric[];
  lineItems: {
    added: RevisionCompareLineItem[];
    removed: RevisionCompareLineItem[];
    changed: RevisionCompareLineItemChange[];
    unchangedCount: number;
  };
  phases: {
    added: Array<{ number: string; name: string }>;
    removed: Array<{ number: string; name: string }>;
    changed: RevisionComparePhaseChange[];
  };
  adjustments: {
    added: Array<{ name: string; kind: string; percentage: number | null; amount: number | null }>;
    removed: Array<{ name: string; kind: string; percentage: number | null; amount: number | null }>;
    changed: RevisionCompareAdjustmentChange[];
  };
  worksheets: {
    added: string[];
    removed: string[];
  };
  summary: {
    addedCount: number;
    removedCount: number;
    changedCount: number;
    quantityChangedCount: number;
    rateChangedCount: number;
    priceDelta: number;
    costDelta: number;
    hoursDelta: number;
  };
}

/* ─── Helpers ─── */

/** Money is compared to the cent; anything finer is rounding noise from the
 *  calc engine, not an estimator's edit. */
const MONEY_EPSILON = 0.005;
const QUANTITY_EPSILON = 1e-6;
const HOURS_EPSILON = 0.005;

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKeyPart(value: unknown): string {
  return toText(value).toLowerCase().replace(/\s+/g, " ");
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function differs(left: number, right: number, epsilon: number): boolean {
  return Math.abs(left - right) > epsilon;
}

function sumPositiveTierUnits(tierUnits: RevisionCompareItemLike["tierUnits"]): number {
  return Object.values(tierUnits ?? {}).reduce<number>((sum, value) => {
    const parsed = toNumber(value);
    return parsed > 0 ? sum + parsed : sum;
  }, 0);
}

function itemHours(item: RevisionCompareItemLike, quantity: number): number {
  if (item.hours != null && Number.isFinite(Number(item.hours))) {
    return round(toNumber(item.hours));
  }
  return round(sumPositiveTierUnits(item.tierUnits) * quantity);
}

function revisionMeta(revision: RevisionCompareRevisionLike): RevisionCompareMeta {
  return {
    id: revision.id,
    revisionNumber: toNumber(revision.revisionNumber),
    title: toText(revision.title),
    status: toText(revision.status),
    type: toText(revision.type),
    updatedAt: toText(revision.updatedAt) || null,
  };
}

function metric(
  key: string,
  label: string,
  format: RevisionCompareMetricFormat,
  base: number,
  head: number,
): RevisionCompareMetric {
  const places = format === "percent" ? 6 : 2;
  const roundedBase = round(base, places);
  const roundedHead = round(head, places);
  const delta = round(roundedHead - roundedBase, places);
  return {
    key,
    label,
    format,
    base: roundedBase,
    head: roundedHead,
    delta,
    percentDelta: roundedBase === 0 ? null : round(delta / Math.abs(roundedBase), 6),
  };
}

interface FlatItem {
  key: string;
  /** Position in sheet order, so unmatched base rows report in reading order. */
  index: number;
  worksheetName: string;
  item: RevisionCompareLineItem;
}

/** Flatten a side's worksheets into keyed positions, in sheet order. */
function flattenItems(worksheets: RevisionCompareWorksheetLike[]): FlatItem[] {
  const flat: FlatItem[] = [];
  const ordered = [...(worksheets ?? [])].sort((left, right) => toNumber(left.order) - toNumber(right.order));
  for (const worksheet of ordered) {
    const worksheetName = toText(worksheet.name);
    for (const raw of worksheet.items ?? []) {
      const quantity = toNumber(raw.quantity);
      const unitCost = toNumber(raw.cost);
      const extendedPrice = toNumber(raw.price);
      // Back out a comparable unit rate so a pure quantity move on an
      // otherwise untouched line doesn't also read as a rate change.
      const unitPrice = quantity === 0 ? extendedPrice : extendedPrice / quantity;
      const key = [
        normalizeKeyPart(worksheetName),
        normalizeKeyPart(raw.category),
        normalizeKeyPart(raw.entityType),
        normalizeKeyPart(raw.entityName),
        normalizeKeyPart(raw.description),
        normalizeKeyPart(raw.uom),
        normalizeKeyPart(raw.vendor),
      ].join("|");
      flat.push({
        key,
        index: flat.length,
        worksheetName,
        item: {
          key,
          worksheetName,
          category: toText(raw.category),
          entityName: toText(raw.entityName),
          description: toText(raw.description),
          uom: toText(raw.uom),
          vendor: toText(raw.vendor),
          quantity: round(quantity, 6),
          unitCost: round(unitCost),
          unitPrice: round(unitPrice, 4),
          extendedCost: round(unitCost * quantity),
          extendedPrice: round(extendedPrice),
          hours: itemHours(raw, quantity),
        },
      });
    }
  }
  return flat;
}

function groupByKey(items: FlatItem[]): Map<string, FlatItem[]> {
  const grouped = new Map<string, FlatItem[]>();
  for (const entry of items) {
    const bucket = grouped.get(entry.key);
    if (bucket) bucket.push(entry);
    else grouped.set(entry.key, [entry]);
  }
  return grouped;
}

function classifyChange(
  base: RevisionCompareLineItem,
  head: RevisionCompareLineItem,
): RevisionCompareChangeKind[] {
  const changes: RevisionCompareChangeKind[] = [];
  if (differs(base.quantity, head.quantity, QUANTITY_EPSILON)) changes.push("quantity");
  if (differs(base.unitPrice, head.unitPrice, MONEY_EPSILON)) changes.push("rate");
  if (differs(base.unitCost, head.unitCost, MONEY_EPSILON)) changes.push("cost");
  if (differs(base.hours, head.hours, HOURS_EPSILON)) changes.push("hours");
  return changes;
}

function phaseKey(phase: RevisionComparePhaseLike): string {
  return normalizeKeyPart(phase.number) || normalizeKeyPart(phase.name);
}

function adjustmentKey(adjustment: RevisionCompareAdjustmentLike): string {
  return normalizeKeyPart(adjustment.name) || normalizeKeyPart(adjustment.kind);
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? round(parsed, 6) : null;
}

/* ─── Main ─── */

export function compareQuoteRevisions(base: RevisionCompareSide, head: RevisionCompareSide): QuoteRevisionComparison {
  /* Financials */
  const financials: RevisionCompareMetric[] = [
    metric("subtotal", "Subtotal", "money", toNumber(base.totals.subtotal), toNumber(head.totals.subtotal)),
    metric("cost", "Cost", "money", toNumber(base.totals.cost), toNumber(head.totals.cost)),
    metric("estimatedProfit", "Profit", "money", toNumber(base.totals.estimatedProfit), toNumber(head.totals.estimatedProfit)),
    metric("estimatedMargin", "Margin", "percent", toNumber(base.totals.estimatedMargin), toNumber(head.totals.estimatedMargin)),
    metric("totalHours", "Total Hours", "number", toNumber(base.totals.totalHours), toNumber(head.totals.totalHours)),
    metric("regHours", "Reg Hours", "number", toNumber(base.totals.regHours), toNumber(head.totals.regHours)),
    metric("overHours", "OT Hours", "number", toNumber(base.totals.overHours), toNumber(head.totals.overHours)),
    metric("doubleHours", "DT Hours", "number", toNumber(base.totals.doubleHours), toNumber(head.totals.doubleHours)),
  ];

  /* Line items */
  const baseItems = flattenItems(base.worksheets);
  const headItems = flattenItems(head.worksheets);
  const baseByKey = groupByKey(baseItems);

  const added: RevisionCompareLineItem[] = [];
  const removed: RevisionCompareLineItem[] = [];
  const changed: RevisionCompareLineItemChange[] = [];
  let unchangedCount = 0;

  for (const entry of headItems) {
    const baseBucket = baseByKey.get(entry.key);
    if (!baseBucket || baseBucket.length === 0) {
      added.push(entry.item);
      continue;
    }
    const baseItem = baseBucket.shift()!.item;
    const changes = classifyChange(baseItem, entry.item);
    if (changes.length === 0) {
      unchangedCount += 1;
      continue;
    }
    changed.push({
      key: entry.key,
      worksheetName: entry.item.worksheetName,
      category: entry.item.category,
      entityName: entry.item.entityName,
      description: entry.item.description,
      uom: entry.item.uom,
      vendor: entry.item.vendor,
      changes,
      base: baseItem,
      head: entry.item,
      quantityDelta: round(entry.item.quantity - baseItem.quantity, 6),
      unitCostDelta: round(entry.item.unitCost - baseItem.unitCost),
      unitPriceDelta: round(entry.item.unitPrice - baseItem.unitPrice),
      extendedCostDelta: round(entry.item.extendedCost - baseItem.extendedCost),
      extendedPriceDelta: round(entry.item.extendedPrice - baseItem.extendedPrice),
      hoursDelta: round(entry.item.hours - baseItem.hours),
    });
  }

  // Whatever is left in the base buckets never found a head partner. Report
  // them in sheet order rather than key order.
  const leftover: FlatItem[] = [];
  for (const bucket of baseByKey.values()) leftover.push(...bucket);
  leftover.sort((left, right) => left.index - right.index);
  for (const entry of leftover) removed.push(entry.item);

  /* Phases */
  const basePhases = new Map(base.phases.map((phase) => [phaseKey(phase), phase]));
  const headPhases = new Map(head.phases.map((phase) => [phaseKey(phase), phase]));
  const phasesAdded: Array<{ number: string; name: string }> = [];
  const phasesRemoved: Array<{ number: string; name: string }> = [];
  const phasesChanged: RevisionComparePhaseChange[] = [];

  for (const [key, phase] of headPhases) {
    const previous = basePhases.get(key);
    if (!previous) {
      phasesAdded.push({ number: toText(phase.number), name: toText(phase.name) });
      continue;
    }
    const changes: Array<"name" | "description"> = [];
    if (toText(previous.name) !== toText(phase.name)) changes.push("name");
    if (toText(previous.description) !== toText(phase.description)) changes.push("description");
    if (changes.length > 0) {
      phasesChanged.push({
        number: toText(phase.number),
        base: { number: toText(previous.number), name: toText(previous.name), description: toText(previous.description) },
        head: { number: toText(phase.number), name: toText(phase.name), description: toText(phase.description) },
        changes,
      });
    }
  }
  for (const [key, phase] of basePhases) {
    if (!headPhases.has(key)) {
      phasesRemoved.push({ number: toText(phase.number), name: toText(phase.name) });
    }
  }

  /* Adjustments */
  const baseAdjustments = new Map(base.adjustments.map((entry) => [adjustmentKey(entry), entry]));
  const headAdjustments = new Map(head.adjustments.map((entry) => [adjustmentKey(entry), entry]));
  const adjustmentsAdded: QuoteRevisionComparison["adjustments"]["added"] = [];
  const adjustmentsRemoved: QuoteRevisionComparison["adjustments"]["removed"] = [];
  const adjustmentsChanged: RevisionCompareAdjustmentChange[] = [];

  const describeAdjustment = (entry: RevisionCompareAdjustmentLike) => ({
    name: toText(entry.name),
    kind: toText(entry.kind),
    percentage: nullableNumber(entry.percentage),
    amount: nullableNumber(entry.amount),
    active: entry.active !== false,
  });

  for (const [key, entry] of headAdjustments) {
    const previous = baseAdjustments.get(key);
    const current = describeAdjustment(entry);
    if (!previous) {
      adjustmentsAdded.push({ name: current.name, kind: current.kind, percentage: current.percentage, amount: current.amount });
      continue;
    }
    const before = describeAdjustment(previous);
    const changes: RevisionCompareAdjustmentChange["changes"] = [];
    if (before.percentage !== current.percentage) changes.push("percentage");
    if (before.amount !== current.amount) changes.push("amount");
    if (before.active !== current.active) changes.push("active");
    if (before.kind !== current.kind) changes.push("kind");
    if (changes.length > 0) {
      adjustmentsChanged.push({ name: current.name || before.name, base: before, head: current, changes });
    }
  }
  for (const [key, entry] of baseAdjustments) {
    if (!headAdjustments.has(key)) {
      const before = describeAdjustment(entry);
      adjustmentsRemoved.push({ name: before.name, kind: before.kind, percentage: before.percentage, amount: before.amount });
    }
  }

  /* Worksheets */
  const baseWorksheetNames = new Set(base.worksheets.map((worksheet) => normalizeKeyPart(worksheet.name)));
  const headWorksheetNames = new Set(head.worksheets.map((worksheet) => normalizeKeyPart(worksheet.name)));
  const worksheetsAdded = head.worksheets
    .filter((worksheet) => !baseWorksheetNames.has(normalizeKeyPart(worksheet.name)))
    .map((worksheet) => toText(worksheet.name));
  const worksheetsRemoved = base.worksheets
    .filter((worksheet) => !headWorksheetNames.has(normalizeKeyPart(worksheet.name)))
    .map((worksheet) => toText(worksheet.name));

  /* Summary — the position-level dollar movement, which is not the same as the
   * subtotal delta: factors, adjustments and rounding also move the subtotal. */
  const priceDelta = round(
    added.reduce((sum, item) => sum + item.extendedPrice, 0)
    - removed.reduce((sum, item) => sum + item.extendedPrice, 0)
    + changed.reduce((sum, entry) => sum + entry.extendedPriceDelta, 0),
  );
  const costDelta = round(
    added.reduce((sum, item) => sum + item.extendedCost, 0)
    - removed.reduce((sum, item) => sum + item.extendedCost, 0)
    + changed.reduce((sum, entry) => sum + entry.extendedCostDelta, 0),
  );
  const hoursDelta = round(
    added.reduce((sum, item) => sum + item.hours, 0)
    - removed.reduce((sum, item) => sum + item.hours, 0)
    + changed.reduce((sum, entry) => sum + entry.hoursDelta, 0),
  );

  return {
    base: revisionMeta(base.revision),
    head: revisionMeta(head.revision),
    financials,
    lineItems: { added, removed, changed, unchangedCount },
    phases: { added: phasesAdded, removed: phasesRemoved, changed: phasesChanged },
    adjustments: { added: adjustmentsAdded, removed: adjustmentsRemoved, changed: adjustmentsChanged },
    worksheets: { added: worksheetsAdded, removed: worksheetsRemoved },
    summary: {
      addedCount: added.length,
      removedCount: removed.length,
      changedCount: changed.length,
      quantityChangedCount: changed.filter((entry) => entry.changes.includes("quantity")).length,
      rateChangedCount: changed.filter((entry) => entry.changes.includes("rate") || entry.changes.includes("cost")).length,
      priceDelta,
      costDelta,
      hoursDelta,
    },
  };
}
