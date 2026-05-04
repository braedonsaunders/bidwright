import type {
  Adjustment,
  AdjustmentCalculationBase,
  AdjustmentPricingMode,
  AdditionalLineItem,
  BidwrightStore,
  BreakoutEntry,
  CostBreakdownEntry,
  EntityCategory,
  EstimateFactor,
  EstimateFactorTotalEntry,
  PricingLadderRow,
  ProjectWorkspace,
  QuoteRevision,
  RevisionTotals,
  SourceTotalEntry,
  SummaryBuilderConfig,
  SummaryRow,
  SummaryPreset,
  SummaryRowType,
  Worksheet,
  WorksheetItem,
} from "./models";
import {
  normalizeSummaryClassificationConfig,
  resolveConstructionClassification,
  type ResolvedConstructionClassification,
} from "./construction-classification";
import { buildSummaryBuilderConfig, materializeSummaryRowsFromBuilder } from "./summary-builder";
import { getExtendedWorksheetHourBreakdown, type WorksheetHourRateScheduleLike } from "./worksheet-hours";
import {
  NECA_DIFFICULTY_RANGES,
  NECA_EXTENDED_DURATION_TABLE,
  NECA_TEMPERATURE_PRODUCTIVITY_SAMPLES,
} from "./estimate-factors";


const standalonePricingModes = new Set<AdjustmentPricingMode>([
  "option_standalone",
  "line_item_standalone",
  "custom_total",
]);

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundRatio(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Categories are dynamically configured per organization (see EntityCategory).
 * WorksheetItem.category is expected to match an EntityCategory.name verbatim;
 * this just trims whitespace and falls back to entityType when category is empty.
 */
function normalizeCategoryName(value: string, entityType?: string | null) {
  const trimmed = value.trim();
  return trimmed || entityType?.trim() || "";
}

function categoryIdForName(value: string) {
  const normalized = normalizeCategoryName(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `cat_${normalized || "uncategorized"}`;
}

type CategoryLookup = {
  byId: Map<string, EntityCategory>;
  byName: Map<string, EntityCategory>;
  byEntityType: Map<string, EntityCategory>;
};

function buildCategoryLookup(entityCategories: EntityCategory[] = []): CategoryLookup {
  return {
    byId: new Map(entityCategories.map((category) => [category.id, category])),
    byName: new Map(entityCategories.map((category) => [category.name.trim().toLowerCase(), category])),
    byEntityType: new Map(entityCategories.map((category) => [category.entityType.trim().toLowerCase(), category])),
  };
}

function categoryForItem(item: WorksheetItem, lookup: CategoryLookup): EntityCategory | undefined {
  if (item.categoryId) {
    const byId = lookup.byId.get(item.categoryId);
    if (byId) return byId;
  }
  const categoryName = normalizeCategoryName(item.category, item.entityType).trim().toLowerCase();
  return lookup.byName.get(categoryName) ?? lookup.byEntityType.get((item.entityType ?? "").trim().toLowerCase());
}

function categoryLabelForItem(item: WorksheetItem, lookup: CategoryLookup) {
  return categoryForItem(item, lookup)?.name ?? normalizeCategoryName(item.category, item.entityType);
}

function categoryStableIdForItem(item: WorksheetItem, lookup: CategoryLookup) {
  const category = categoryForItem(item, lookup);
  return category?.id ?? item.categoryId ?? categoryIdForName(categoryLabelForItem(item, lookup));
}

function categoryStableIdForName(name: string, lookup: CategoryLookup) {
  const key = name.trim().toLowerCase();
  return lookup.byName.get(key)?.id ?? lookup.byEntityType.get(key)?.id ?? categoryIdForName(name);
}

function itemMatchesCategoryName(item: WorksheetItem, target: string, lookup: CategoryLookup) {
  if (target === "All") return true;
  return categoryLabelForItem(item, lookup) === target;
}

function normalizeAdjustmentFinancialCategory(adjustment: Adjustment) {
  const value = (adjustment.financialCategory || adjustment.type || adjustment.pricingMode || "other")
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "_");

  if (value.includes("overhead")) return "overhead";
  if (value.includes("profit") || value === "margin") return "profit";
  if (value.includes("tax") || value.includes("hst") || value.includes("gst") || value.includes("pst")) return "tax";
  if (value.includes("contingenc")) return "contingency";
  if (value.includes("insurance")) return "insurance";
  if (value.includes("bond")) return "bond";
  if (value.includes("allowance")) return "allowance";
  if (value.includes("alternate") || value.includes("option")) return "alternate";
  if (value.includes("fee")) return "fee";
  return value || "other";
}

function normalizeAdjustmentCalculationBase(adjustment: Adjustment): AdjustmentCalculationBase {
  const raw = (adjustment.calculationBase || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (raw === "direct_cost" || raw === "cost") return "direct_cost";
  if (raw === "cumulative" || raw === "running_total") return "cumulative";
  if (raw === "line_subtotal" || raw === "sell_subtotal" || raw === "subtotal") return "line_subtotal";
  return "selected_scope";
}

function additionalLineItemTypeForAdjustment(adjustment: Adjustment) {
  const lineItemType: AdditionalLineItem["type"] = (() => {
    switch (adjustment.pricingMode) {
      case "option_standalone":
        return "OptionStandalone";
      case "option_additional":
        return "OptionAdditional";
      case "line_item_standalone":
        return "LineItemStandalone";
      case "custom_total":
        return "CustomTotal";
      default:
        return "LineItemAdditional";
    }
  })();

  return lineItemType;
}

function adjustmentToLegacyModifier(adjustment: Adjustment) {
  if (adjustment.pricingMode !== "modifier" && adjustment.kind !== "modifier") {
    return null;
  }

  return {
    id: adjustment.id,
    revisionId: adjustment.revisionId,
    name: adjustment.name,
    type: adjustment.type,
    appliesTo: adjustment.appliesTo,
    percentage: adjustment.percentage,
    amount: adjustment.amount,
    show: adjustment.show,
  };
}

function adjustmentToLegacyAdditionalLineItem(adjustment: Adjustment) {
  if (adjustment.kind !== "line_item") {
    return null;
  }

  return {
    id: adjustment.id,
    revisionId: adjustment.revisionId,
    name: adjustment.name,
    description: adjustment.description,
    type: additionalLineItemTypeForAdjustment(adjustment),
    amount: adjustment.amount ?? 0,
  };
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value != null;
}

function getCurrentRevision(store: BidwrightStore, quoteId: string) {
  const quote = store.quotes.find((entry) => entry.id === quoteId);
  const revisions = [...store.revisions]
    .filter((revision) => revision.quoteId === quoteId)
    .sort((left, right) => right.revisionNumber - left.revisionNumber);
  if (quote?.currentRevisionId) {
    const activeRevision = revisions.find((revision) => revision.id === quote.currentRevisionId);
    if (activeRevision) return activeRevision;
  }
  return revisions[0];
}

function getQuoteByProjectId(store: BidwrightStore, projectId: string) {
  return store.quotes.find((quote) => quote.projectId === projectId);
}

/**
 * The line's extended cost. `WorksheetItem.cost` is always per-unit (see the
 * storage convention block at the top of apps/api/src/services/calc-engine.ts);
 * the line's true cost is qty × cost regardless of category.
 */
export function computeItemCost(item: WorksheetItem) {
  return item.quantity * item.cost;
}

interface ItemHourTotals {
  /** Total hours summed across all tiers (× quantity). */
  total: number;
  /** Bucketed by canonical multiplier — used by revision summary columns. */
  reg: number;
  ot: number;
  dt: number;
  /** Per-tier hours (× quantity). */
  tierUnits: Record<string, number>;
}

function computeItemHours(
  item: WorksheetItem,
  schedules: WorksheetHourRateScheduleLike[],
): ItemHourTotals {
  // Items contribute to the labour-hours rollup only when their rate-schedule
  // tier breakdown is populated. Material / Subcontractor / Equipment etc.
  // never have tierUnits, so they short-circuit to zero — no hardcoded
  // category-name check required.
  const hasTierUnits = !!item.tierUnits && Object.keys(item.tierUnits).length > 0;
  const linkedToSchedule = !!item.rateScheduleItemId;
  if (!hasTierUnits && !linkedToSchedule) {
    return { total: 0, reg: 0, ot: 0, dt: 0, tierUnits: {} };
  }

  const tierUnits: Record<string, number> = {};
  if (item.tierUnits && Object.keys(item.tierUnits).length > 0) {
    for (const [tierId, hours] of Object.entries(item.tierUnits)) {
      tierUnits[tierId] = roundMoney((Number(hours) || 0) * item.quantity);
    }
  }

  const breakdown = getExtendedWorksheetHourBreakdown(item, schedules, item.quantity);
  let reg = 0;
  let ot = 0;
  let dt = 0;
  for (const tier of breakdown.tiers) {
    if (tier.multiplier === 1) reg += tier.hours;
    else if (tier.multiplier === 1.5) ot += tier.hours;
    else if (tier.multiplier === 2) dt += tier.hours;
  }

  return { total: breakdown.total, reg, ot, dt, tierUnits };
}

function computeAggregates(items: WorksheetItem[]) {
  const value = roundMoney(items.reduce((sum, item) => sum + item.price, 0));
  const cost = roundMoney(items.reduce((sum, item) => sum + computeItemCost(item), 0));
  const margin = value === 0 ? 0 : roundMoney((value - cost) / value);

  return {
    value,
    cost,
    margin,
  };
}

function getWorksheetItems(store: BidwrightStore, worksheetId: string) {
  return [...store.worksheetItems]
    .filter((item) => item.worksheetId === worksheetId)
    .sort((left, right) => left.lineOrder - right.lineOrder);
}

function getWorksheets(store: BidwrightStore, revisionId: string) {
  return [...store.worksheets]
    .filter((worksheet) => worksheet.revisionId === revisionId)
    .sort((left, right) => left.order - right.order)
    .map((worksheet) => ({
      ...worksheet,
      items: getWorksheetItems(store, worksheet.id),
    }));
}

function getWorksheetFolders(store: BidwrightStore, revisionId: string) {
  return [...(store.worksheetFolders ?? [])]
    .filter((folder) => folder.revisionId === revisionId)
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      return left.name.localeCompare(right.name);
    });
}

function getRevisionRateSchedules(
  store: BidwrightStore,
  revisionId: string,
): WorksheetHourRateScheduleLike[] {
  const revisionScheduleIds = new Set(
    store.rateSchedules
      .filter((schedule) => schedule.revisionId === revisionId)
      .map((schedule) => schedule.id),
  );

  return store.rateSchedules
    .filter((schedule) => revisionScheduleIds.has(schedule.id))
    .map((schedule) => ({
      tiers: store.rateScheduleTiers.filter((tier) => tier.scheduleId === schedule.id),
      items: store.rateScheduleItems.filter((item) => item.scheduleId === schedule.id),
    }));
}

function getCatalogs(store: BidwrightStore, projectId: string) {
  return store.catalogs
    .filter((catalog) => catalog.scope === "global" || catalog.projectId === projectId)
    .map((catalog) => ({
      ...catalog,
      items: store.catalogItems.filter((item) => item.catalogId === catalog.id),
    }));
}

function getPhaseLabel(phaseId: string | null | undefined, phaseNameById: Map<string, string>) {
  if (!phaseId) {
    return "Unphased";
  }

  return phaseNameById.get(phaseId) ?? "Unphased";
}

function sortPhasesForDisplay(phases: BidwrightStore["phases"]) {
  const byId = new Map(phases.map((phase) => [phase.id, phase]));
  const childrenByParent = new Map<string | null, typeof phases>();
  for (const phase of phases) {
    const parentId = phase.parentId && byId.has(phase.parentId) ? phase.parentId : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(phase);
    childrenByParent.set(parentId, siblings);
  }

  const sortSiblings = (items: typeof phases) =>
    items.sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      const leftNumber = left.number || left.name;
      const rightNumber = right.number || right.name;
      return leftNumber.localeCompare(rightNumber, undefined, { numeric: true, sensitivity: "base" });
    });

  const ordered: typeof phases = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null) => {
    for (const phase of sortSiblings([...(childrenByParent.get(parentId) ?? [])])) {
      if (visited.has(phase.id)) continue;
      visited.add(phase.id);
      ordered.push(phase);
      visit(phase.id);
    }
  };

  visit(null);
  for (const phase of sortSiblings([...phases])) {
    if (!visited.has(phase.id)) {
      visited.add(phase.id);
      ordered.push(phase);
    }
  }
  return ordered;
}

function createSourceEntry(id: string, label: string): SourceTotalEntry {
  return {
    id,
    name: label,
    label,
    value: 0,
    cost: 0,
    margin: 0,
  };
}

function createClassificationSourceEntry(classification: ResolvedConstructionClassification): SourceTotalEntry {
  return {
    ...createSourceEntry(classification.id, classification.label),
    classificationStandard: classification.standard,
    classificationLevel: classification.level,
    classificationCode: classification.code,
    classificationLabel: classification.label,
  };
}

function sortSourceEntries(entries: SourceTotalEntry[]) {
  return [...entries].sort((left, right) => left.label.localeCompare(right.label));
}

function updateSourceMargins(entries: Iterable<SourceTotalEntry>) {
  for (const entry of entries) {
    entry.value = roundMoney(entry.value);
    entry.cost = roundMoney(entry.cost);
    entry.margin = entry.value === 0 ? 0 : roundMoney((entry.value - entry.cost) / entry.value);
  }
}

function groupItemsForBreakout(
  breakoutStyle: QuoteRevision["breakoutStyle"],
  lineItems: WorksheetItem[],
  phases: BidwrightStore["phases"],
  entityCategories: EntityCategory[] = [],
) {
  const categoryLookup = buildCategoryLookup(entityCategories);
  if (breakoutStyle === "labour_material_equipment") {
    // Map each item to a bucket via the org's EntityCategory.analyticsBucket.
    // Items in categories with bucket "labour" → Labour; "equipment" → Equipment;
    // anything else (including null and "material") rolls into Materials.
    const bucketFor = (item: WorksheetItem): "labour" | "equipment" | "materials" => {
      const b = categoryForItem(item, categoryLookup)?.analyticsBucket;
      if (b === "labour") return "labour";
      if (b === "equipment") return "equipment";
      return "materials";
    };
    return [
      { key: "Labour",    name: "Labour",    items: lineItems.filter((i) => bucketFor(i) === "labour") },
      { key: "Materials", name: "Materials", items: lineItems.filter((i) => bucketFor(i) === "materials") },
      { key: "Equipment", name: "Equipment", items: lineItems.filter((i) => bucketFor(i) === "equipment") },
    ];
  }

  if (breakoutStyle === "grand_total") {
    return [
      {
        key: "Total",
        name: "Total",
        items: lineItems,
      },
    ];
  }

  if (breakoutStyle === "category") {
    return Array.from(
      lineItems.reduce((map, item) => {
        const id = categoryStableIdForItem(item, categoryLookup);
        const name = categoryLabelForItem(item, categoryLookup);
        const entry = map.get(id) ?? { name, items: [] as WorksheetItem[] };
        entry.items.push(item);
        map.set(id, entry);
        return map;
      }, new Map<string, { name: string; items: WorksheetItem[] }>()),
    ).map(([id, entry]) => ({
      key: id,
      name: entry.name,
      items: entry.items,
    }));
  }

  return phases.map((phase) => ({
    key: phase.id,
    name: phase.name,
    items: lineItems.filter((item) => item.phaseId === phase.id),
  }));
}

function buildPhaseCategoryKey(phaseId: string | null | undefined, categoryId: string) {
  return `${phaseId ?? "__unphased__"}::${categoryId}`;
}

function buildPairKey(leftId: string | null | undefined, rightId: string | null | undefined) {
  return `${leftId ?? "__unphased__"}::${rightId ?? ""}`;
}

function distributeHiddenAdjustment(
  breakout: BreakoutEntry[],
  modifierAmount: number,
  appliesTo: string,
  lineItems: WorksheetItem[],
  breakoutStyle: QuoteRevision["breakoutStyle"],
  entityCategories: EntityCategory[] = [],
) {
  if (modifierAmount === 0) {
    return breakout;
  }

  const categoryLookup = buildCategoryLookup(entityCategories);
  const targetedItems = lineItems.filter((item) => itemMatchesCategoryName(item, appliesTo, categoryLookup));
  const targetBase = targetedItems.reduce((sum, item) => sum + item.price, 0);

  if (targetBase === 0) {
    return breakout;
  }

  return breakout.map((entry) => {
    if (breakoutStyle === "grand_total" && entry.name === "Total") {
      const nextValue = roundMoney(entry.value + modifierAmount);
      return {
        ...entry,
        value: nextValue,
        margin: nextValue === 0 ? 0 : roundMoney((nextValue - entry.cost) / nextValue),
      };
    }

	    if (breakoutStyle === "category") {
	      if (appliesTo !== "All" && entry.name !== appliesTo) {
	        return entry;
      }

      const entryBase =
	        appliesTo === "All"
	          ? lineItems
	              .filter((item) => categoryLabelForItem(item, categoryLookup) === entry.name)
	              .reduce((sum, item) => sum + item.price, 0)
          : targetedItems.reduce((sum, item) => sum + item.price, 0);
      const delta = targetBase === 0 ? 0 : modifierAmount * (entryBase / targetBase);
      const nextValue = roundMoney(entry.value + delta);
      return {
        ...entry,
        value: nextValue,
        margin: nextValue === 0 ? 0 : roundMoney((nextValue - entry.cost) / nextValue),
      };
    }

    const scopedItems = lineItems.filter((item) => item.phaseId === entry.entityId);
	    const phaseScoped =
	      appliesTo === "All"
	        ? scopedItems
	        : scopedItems.filter((item) => itemMatchesCategoryName(item, appliesTo, categoryLookup));
    const phaseBase = phaseScoped.reduce((sum, item) => sum + item.price, 0);
    const delta = targetBase === 0 ? 0 : modifierAmount * (phaseBase / targetBase);
    const nextValue = roundMoney(entry.value + delta);

    return {
      ...entry,
      value: nextValue,
      margin: nextValue === 0 ? 0 : roundMoney((nextValue - entry.cost) / nextValue),
      category: entry.category?.map((categoryEntry) => {
        if (appliesTo !== "All" && categoryEntry.name !== appliesTo) {
          return categoryEntry;
        }

	        const categoryBase =
	          appliesTo === "All"
	            ? scopedItems
	                .filter((item) => categoryLabelForItem(item, categoryLookup) === categoryEntry.name)
	                .reduce((sum, item) => sum + item.price, 0)
            : phaseScoped.reduce((sum, item) => sum + item.price, 0);
        const categoryDelta = phaseBase === 0 ? 0 : delta * (categoryBase / phaseBase);
        const categoryValue = roundMoney(categoryEntry.value + categoryDelta);

        return {
          ...categoryEntry,
          value: categoryValue,
          margin: categoryValue === 0 ? 0 : roundMoney((categoryValue - categoryEntry.cost) / categoryValue),
        };
      }),
    };
  });
}

function applyHiddenAdjustmentToAggregates(
  amount: number,
  targetCategory: string,
  lineItems: WorksheetItem[],
  categoryTotals: Map<string, SourceTotalEntry>,
  phaseTotals: Map<string, SourceTotalEntry>,
  phaseCategoryTotals: Map<string, SourceTotalEntry>,
  categoryLookup: CategoryLookup,
  classificationRollups?: {
    classificationConfig: SummaryBuilderConfig["classification"];
    classificationTotals: Map<string, SourceTotalEntry>;
    phaseClassificationTotals: Map<string, SourceTotalEntry>;
    worksheetClassificationTotals: Map<string, SourceTotalEntry>;
    categoryClassificationTotals: Map<string, SourceTotalEntry>;
  },
) {
  if (amount === 0) {
    return;
  }

  const targetedItems = lineItems.filter((item) => itemMatchesCategoryName(item, targetCategory, categoryLookup));
  const targetBase = targetedItems.reduce((sum, item) => sum + item.price, 0);

  if (targetBase === 0) {
    return;
  }

	if (targetCategory === "All") {
	  for (const entry of categoryTotals.values()) {
	    const categoryBase = lineItems
	      .filter((item) => categoryStableIdForItem(item, categoryLookup) === entry.id)
	      .reduce((sum, item) => sum + item.price, 0);
      entry.value += amount * (categoryBase / targetBase);
    }
	} else {
	  const targetEntry = categoryTotals.get(categoryStableIdForName(targetCategory, categoryLookup));
    if (targetEntry) {
      targetEntry.value += amount;
    }
  }

  for (const phaseEntry of phaseTotals.values()) {
    const phaseScoped = targetedItems.filter(
      (item) => (item.phaseId ?? "__unphased__") === (phaseEntry.id === "__unphased__" ? "__unphased__" : phaseEntry.id),
    );
    const phaseBase = phaseScoped.reduce((sum, item) => sum + item.price, 0);
    if (phaseBase === 0) {
      continue;
    }

    const phaseDelta = amount * (phaseBase / targetBase);
    phaseEntry.value += phaseDelta;
  }

	if (targetCategory === "All") {
	  for (const entry of phaseCategoryTotals.values()) {
	    const phaseBase = targetedItems
	      .filter((item) => buildPhaseCategoryKey(item.phaseId, categoryStableIdForItem(item, categoryLookup)) === entry.id)
	      .reduce((sum, item) => sum + item.price, 0);
      entry.value += amount * (phaseBase / targetBase);
    }
	} else {
	  const targetCategoryId = categoryStableIdForName(targetCategory, categoryLookup);
    for (const entry of phaseCategoryTotals.values()) {
      if (!entry.id.endsWith(`::${targetCategoryId}`)) {
        continue;
      }
	    const phaseScoped = targetedItems.filter(
	      (item) => buildPhaseCategoryKey(item.phaseId, categoryStableIdForItem(item, categoryLookup)) === entry.id,
	    );
      const phaseBase = phaseScoped.reduce((sum, item) => sum + item.price, 0);
      if (phaseBase === 0) {
        continue;
      }
      entry.value += amount * (phaseBase / targetBase);
    }
  }

  if (classificationRollups) {
    const classificationIdForItem = (item: WorksheetItem) =>
      resolveConstructionClassification(item, classificationRollups.classificationConfig)?.id ?? null;
    const addProportionalValue = (entry: SourceTotalEntry, scopedItems: WorksheetItem[]) => {
      const base = scopedItems.reduce((sum, item) => sum + item.price, 0);
      if (base === 0) {
        return;
      }
      entry.value += amount * (base / targetBase);
    };

    for (const entry of classificationRollups.classificationTotals.values()) {
      addProportionalValue(
        entry,
        targetedItems.filter((item) => classificationIdForItem(item) === entry.id),
      );
    }

    for (const entry of classificationRollups.phaseClassificationTotals.values()) {
      addProportionalValue(
        entry,
        targetedItems.filter((item) => buildPairKey(item.phaseId, classificationIdForItem(item)) === entry.id),
      );
    }

    for (const entry of classificationRollups.worksheetClassificationTotals.values()) {
      addProportionalValue(
        entry,
        targetedItems.filter((item) => buildPairKey(item.worksheetId, classificationIdForItem(item)) === entry.id),
      );
    }

	    for (const entry of classificationRollups.categoryClassificationTotals.values()) {
	      addProportionalValue(
	        entry,
	        targetedItems.filter((item) => buildPairKey(categoryStableIdForItem(item, categoryLookup), classificationIdForItem(item)) === entry.id),
	      );
	    }
  }
}

function scopedItemsForAdjustment(adjustment: Adjustment, lineItems: WorksheetItem[], categoryLookup: CategoryLookup) {
  // Adjustment.appliesTo is either "All" or an EntityCategory.name verbatim;
  // legacy "LaborClass" / "EquipmentRate" / plural-form aliases were dropped
  // when the app moved to per-org dynamic categories.
  const target = adjustment.appliesTo || "All";
  return {
    target,
    items:
      target === "All"
        ? lineItems
        : lineItems.filter((item) => itemMatchesCategoryName(item, target, categoryLookup)),
  };
}

function calculateModifierAmount(
  adjustment: Adjustment,
  lineItems: WorksheetItem[],
  lineSubtotal: number,
  directCost: number,
  runningSubtotal: number,
  categoryLookup: CategoryLookup,
) {
  const { target, items } = scopedItemsForAdjustment(adjustment, lineItems, categoryLookup);
  const scopeLineSubtotal = items.reduce((sum, item) => sum + item.price, 0);
  const scopeDirectCost = items.reduce((sum, item) => sum + computeItemCost(item), 0);
  const calculationBase = normalizeAdjustmentCalculationBase(adjustment);
  const applicableBase = (() => {
    switch (calculationBase) {
      case "direct_cost":
        return target === "All" ? directCost : scopeDirectCost;
      case "cumulative":
        return target === "All" ? runningSubtotal : scopeLineSubtotal;
      case "line_subtotal":
        return target === "All" ? lineSubtotal : scopeLineSubtotal;
      case "selected_scope":
      default:
        return scopeLineSubtotal;
    }
  })();

  if (applicableBase === 0 && !adjustment.amount) {
    return {
      target,
      calculationBase,
      applicableBase,
      value: 0,
    };
  }

  return {
    target,
    calculationBase,
    applicableBase,
    value: roundMoney((adjustment.amount ?? 0) + applicableBase * (adjustment.percentage ?? 0)),
  };
}

function isDisplayedAdjustment(adjustment: Adjustment) {
  if (adjustment.pricingMode === "modifier") {
    return adjustment.show !== "No";
  }

  return true;
}

function affectsSubtotal(adjustment: Adjustment) {
  if (adjustment.active === false) {
    return false;
  }

  switch (adjustment.pricingMode) {
    case "modifier":
      return adjustment.show !== "No";
    case "line_item_additional":
    case "line_item_standalone":
      return true;
    default:
      return false;
  }
}

function buildSourceTotals(
  lineItems: WorksheetItem[],
  phases: BidwrightStore["phases"],
  worksheets: Array<Worksheet & { items: WorksheetItem[] }> = [],
  entityCategories: EntityCategory[] = [],
  rawClassificationConfig?: Partial<SummaryBuilderConfig["classification"]> | null,
) {
  const classificationConfig = normalizeSummaryClassificationConfig(rawClassificationConfig);
  const categoryLookup = buildCategoryLookup(entityCategories);
  const phaseNameById = new Map(phases.map((phase) => [phase.id, phase.name]));
  const worksheetNameById = new Map(worksheets.map((ws) => [ws.id, ws.name]));
  const categoryTotals = new Map<string, SourceTotalEntry>();
  const phaseTotals = new Map<string, SourceTotalEntry>();
  const phaseCategoryTotals = new Map<string, SourceTotalEntry>();
  const worksheetTotals = new Map<string, SourceTotalEntry>();
  const worksheetCategoryTotals = new Map<string, SourceTotalEntry>();
  const worksheetPhaseTotals = new Map<string, SourceTotalEntry>();
  const classificationTotals = new Map<string, SourceTotalEntry>();
  const phaseClassificationTotals = new Map<string, SourceTotalEntry>();
  const worksheetClassificationTotals = new Map<string, SourceTotalEntry>();
  const categoryClassificationTotals = new Map<string, SourceTotalEntry>();

  for (const worksheet of worksheets) {
    worksheetTotals.set(worksheet.id, createSourceEntry(worksheet.id, worksheet.name));
  }

  for (const phase of phases) {
    phaseTotals.set(
      phase.id,
      {
        ...createSourceEntry(phase.id, phase.name),
        phaseId: phase.id,
        phaseLabel: phase.name,
      },
    );
  }

	for (const item of lineItems) {
	  const categoryLabel = categoryLabelForItem(item, categoryLookup);
	  const categoryId = categoryStableIdForItem(item, categoryLookup);
	  const legacyCategoryId = categoryIdForName(categoryLabel);
    const phaseId = item.phaseId ?? "__unphased__";
    const phaseLabel = getPhaseLabel(item.phaseId, phaseNameById);
    const worksheetId = item.worksheetId;
    const worksheetLabel = worksheetNameById.get(worksheetId) ?? "Worksheet";
    const itemCost = computeItemCost(item);

	  const categoryEntry = categoryTotals.get(categoryId) ?? {
	    ...createSourceEntry(categoryId, categoryLabel),
	    categoryId,
	    categoryLabel,
	    legacyCategoryId,
	  };
    categoryEntry.value += item.price;
    categoryEntry.cost += itemCost;
    categoryTotals.set(categoryId, categoryEntry);

    const phaseEntry =
      phaseTotals.get(phaseId) ??
      {
        ...createSourceEntry(phaseId, phaseLabel),
        phaseId,
        phaseLabel,
    };
    phaseEntry.value += item.price;
    phaseEntry.cost += itemCost;
    phaseTotals.set(phaseId, phaseEntry);

    const phaseCategoryKey = buildPhaseCategoryKey(phaseId, categoryId);
    const phaseCategoryEntry =
      phaseCategoryTotals.get(phaseCategoryKey) ??
	    {
	      ...createSourceEntry(phaseCategoryKey, categoryLabel),
	      phaseId,
	      phaseLabel,
	      categoryId,
	      categoryLabel,
	      legacyCategoryId,
	    };
    phaseCategoryEntry.value += item.price;
    phaseCategoryEntry.cost += itemCost;
    phaseCategoryTotals.set(phaseCategoryKey, phaseCategoryEntry);

    const worksheetEntry = worksheetTotals.get(worksheetId) ?? createSourceEntry(worksheetId, worksheetLabel);
    worksheetEntry.value += item.price;
    worksheetEntry.cost += itemCost;
    worksheetTotals.set(worksheetId, worksheetEntry);

    const worksheetCategoryKey = `${worksheetId}::${categoryId}`;
	    const worksheetCategoryEntry =
	      worksheetCategoryTotals.get(worksheetCategoryKey) ?? {
	        ...createSourceEntry(worksheetCategoryKey, categoryLabel),
	        worksheetId,
	        worksheetLabel,
	        categoryId,
	        categoryLabel,
	        legacyCategoryId,
	      };
    worksheetCategoryEntry.value += item.price;
    worksheetCategoryEntry.cost += itemCost;
    worksheetCategoryTotals.set(worksheetCategoryKey, worksheetCategoryEntry);

    const worksheetPhaseKey = `${worksheetId}::${phaseId}`;
    const worksheetPhaseEntry =
      worksheetPhaseTotals.get(worksheetPhaseKey) ??
      {
        ...createSourceEntry(worksheetPhaseKey, phaseLabel),
        phaseId,
        phaseLabel,
    };
    worksheetPhaseEntry.value += item.price;
    worksheetPhaseEntry.cost += itemCost;
    worksheetPhaseTotals.set(worksheetPhaseKey, worksheetPhaseEntry);

    const classification = resolveConstructionClassification(item, classificationConfig);
    if (classification) {
      const classificationEntry = classificationTotals.get(classification.id) ?? createClassificationSourceEntry(classification);
      classificationEntry.value += item.price;
      classificationEntry.cost += itemCost;
      classificationTotals.set(classification.id, classificationEntry);

      const phaseClassificationKey = buildPairKey(phaseId, classification.id);
      const phaseClassificationEntry =
        phaseClassificationTotals.get(phaseClassificationKey) ??
        {
          ...createClassificationSourceEntry(classification),
          id: phaseClassificationKey,
          phaseId,
          phaseLabel,
        };
      phaseClassificationEntry.value += item.price;
      phaseClassificationEntry.cost += itemCost;
      phaseClassificationTotals.set(phaseClassificationKey, phaseClassificationEntry);

      const worksheetClassificationKey = buildPairKey(worksheetId, classification.id);
      const worksheetClassificationEntry =
        worksheetClassificationTotals.get(worksheetClassificationKey) ??
        {
          ...createClassificationSourceEntry(classification),
          id: worksheetClassificationKey,
          worksheetId,
          worksheetLabel,
        };
      worksheetClassificationEntry.value += item.price;
      worksheetClassificationEntry.cost += itemCost;
      worksheetClassificationTotals.set(worksheetClassificationKey, worksheetClassificationEntry);

      const categoryClassificationKey = buildPairKey(categoryId, classification.id);
      const categoryClassificationEntry =
        categoryClassificationTotals.get(categoryClassificationKey) ??
	        {
	          ...createClassificationSourceEntry(classification),
	          id: categoryClassificationKey,
	          categoryId,
	          categoryLabel,
	          legacyCategoryId,
	        };
      categoryClassificationEntry.value += item.price;
      categoryClassificationEntry.cost += itemCost;
      categoryClassificationTotals.set(categoryClassificationKey, categoryClassificationEntry);
    }
  }

  updateSourceMargins(categoryTotals.values());
  updateSourceMargins(phaseTotals.values());
  updateSourceMargins(phaseCategoryTotals.values());
  updateSourceMargins(worksheetTotals.values());
  updateSourceMargins(worksheetCategoryTotals.values());
  updateSourceMargins(worksheetPhaseTotals.values());
  updateSourceMargins(classificationTotals.values());
  updateSourceMargins(phaseClassificationTotals.values());
  updateSourceMargins(worksheetClassificationTotals.values());
  updateSourceMargins(categoryClassificationTotals.values());

  return {
    classificationConfig,
    categoryTotals,
    phaseTotals,
    phaseCategoryTotals,
    worksheetTotals,
    worksheetCategoryTotals,
    worksheetPhaseTotals,
    classificationTotals,
    phaseClassificationTotals,
    worksheetClassificationTotals,
    categoryClassificationTotals,
  };
}

function normalizeBreakdownType(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[_\s-]+/g, "_");
  if (normalized === "labor" || normalized === "labour" || normalized.includes("labor") || normalized.includes("labour")) {
    return "labour";
  }
  if (normalized.includes("material") || normalized.includes("catalog") || normalized.includes("stock")) {
    return "material";
  }
  if (normalized.includes("equipment") || normalized.includes("rental")) {
    return "equipment";
  }
  if (normalized.includes("subcontract") || normalized === "sub") {
    return "subcontract";
  }
  if (normalized.includes("travel") || normalized.includes("per_diem") || normalized.includes("perdiem")) {
    return "travel";
  }
  return normalized || "other";
}

function breakdownLabel(type: string) {
  switch (type) {
    case "labour":
      return "Labour";
    case "material":
      return "Material";
    case "equipment":
      return "Equipment";
    case "subcontract":
      return "Subcontract";
    case "travel":
      return "Travel";
    case "other":
      return "Other";
    default:
      return type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function inferBreakdownType(item: WorksheetItem, categoryLookup: CategoryLookup) {
  const category = categoryForItem(item, categoryLookup);
  const analyticsBucket = typeof category?.analyticsBucket === "string" ? category.analyticsBucket : "";
  const categoryText = category?.name ?? item.category;
  const entityTypeText = category?.entityType ?? item.entityType;
  const inferred = normalizeBreakdownType(analyticsBucket || `${categoryText} ${entityTypeText} ${item.entityName}`);
  return inferred || "other";
}

function buildCostBreakdown(
  lineItems: WorksheetItem[],
  entityCategories: EntityCategory[] = [],
  totalCost: number,
): CostBreakdownEntry[] {
  const categoryLookup = buildCategoryLookup(entityCategories);
  const grouped = new Map<string, CostBreakdownEntry>();

  for (const item of lineItems) {
    const type = inferBreakdownType(item, categoryLookup);
    const existing =
      grouped.get(type) ??
      {
        id: type,
        label: breakdownLabel(type),
        type,
        value: 0,
        cost: 0,
        margin: 0,
        quantity: 0,
        itemCount: 0,
        shareOfCost: 0,
      };

    existing.value += item.price;
    existing.cost += computeItemCost(item);
    existing.quantity += Number(item.quantity) || 0;
    existing.itemCount += 1;
    grouped.set(type, existing);
  }

  return Array.from(grouped.values())
    .map((entry) => {
      const value = roundMoney(entry.value);
      const cost = roundMoney(entry.cost);
      return {
        ...entry,
        value,
        cost,
        quantity: roundMoney(entry.quantity),
        margin: value === 0 ? 0 : roundRatio((value - cost) / value),
        shareOfCost: totalCost === 0 ? 0 : roundRatio(cost / totalCost),
      };
    })
    .sort((left, right) => right.cost - left.cost || left.label.localeCompare(right.label));
}

function normalizeFactorMultiplier(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return roundRatio(Math.min(10, Math.max(0.05, value)));
}

function factorNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function factorRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function factorArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeFactorToken(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeFactorKey(value: unknown) {
  return normalizeFactorToken(value).replace(/[_\s-]+/g, "_");
}

function factorStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];
}

function factorScopeHasFilters(factor: EstimateFactor) {
  const scope = factor.scope ?? {};
  const filterKeys = [
    "worksheetItemIds",
    "categoryIds",
    "categoryNames",
    "analyticsBuckets",
    "phaseIds",
    "worksheetIds",
    "classificationCodes",
    "laborUnitIds",
    "costCodes",
    "text",
  ];
  return filterKeys.some((key) => factorStringArray(scope[key]).length > 0);
}

function factorScopeHasGlobalFilters(factor: EstimateFactor) {
  const scope = factor.scope ?? {};
  const filterKeys = [
    "categoryIds",
    "categoryNames",
    "analyticsBuckets",
    "phaseIds",
    "worksheetIds",
    "classificationCodes",
    "laborUnitIds",
    "costCodes",
    "text",
  ];
  return filterKeys.some((key) => factorStringArray(scope[key]).length > 0);
}

function categoryAnalyticsBucketForItem(item: WorksheetItem, lookup: CategoryLookup) {
  return categoryForItem(item, lookup)?.analyticsBucket ?? "";
}

function isLabourLikeItem(item: WorksheetItem, lookup: CategoryLookup) {
  const bucket = normalizeBreakdownType(categoryAnalyticsBucketForItem(item, lookup));
  if (bucket === "labour") return true;
  if (item.laborUnitId || item.rateScheduleItemId) return true;
  return normalizeBreakdownType(`${categoryLabelForItem(item, lookup)} ${item.entityType} ${item.entityName}`) === "labour";
}

function matchesAnyToken(candidate: unknown, targets: unknown[], normalizer: (value: unknown) => string = normalizeFactorToken) {
  if (targets.length === 0) return true;
  const normalized = normalizer(candidate);
  return targets.map(normalizer).some((target) => target === normalized);
}

function itemClassificationMatches(item: WorksheetItem, codes: string[]) {
  if (codes.length === 0) return true;
  const normalizedTargets = codes.map(normalizeFactorKey);
  const collected: string[] = [];

  function collect(value: unknown) {
    if (value === null || value === undefined) return;
    if (typeof value === "string" || typeof value === "number") {
      collected.push(normalizeFactorKey(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (typeof value === "object") {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        collected.push(normalizeFactorKey(key));
        collect(nested);
      }
    }
  }

  collect(item.classification);
  if (item.costCode) collected.push(normalizeFactorKey(item.costCode));
  return normalizedTargets.some((target) => collected.some((candidate) => candidate === target || candidate.includes(target)));
}

function itemTextMatches(item: WorksheetItem, terms: string[]) {
  if (terms.length === 0) return true;
  const haystack = normalizeFactorToken(
    [
      item.entityName,
      item.entityType,
      item.description,
      item.sourceNotes,
      item.costCode,
      item.vendor,
    ].filter(Boolean).join(" "),
  );
  return terms.some((term) => haystack.includes(normalizeFactorToken(term)));
}

function itemMatchesGlobalEstimateFactorScope(item: WorksheetItem, factor: EstimateFactor, lookup: CategoryLookup) {
  const scope = factor.scope ?? {};
  if ((scope.mode ?? "all") === "line") return false;
  const hasLineTargets = factorStringArray(scope.worksheetItemIds).length > 0;
  if ((scope.mode ?? "all") === "all" && !factorScopeHasFilters(factor)) return true;
  if ((scope.mode ?? "all") === "all" && !factorScopeHasGlobalFilters(factor)) return !hasLineTargets;

  const categoryIds = factorStringArray(scope.categoryIds);
  if (categoryIds.length > 0) {
    const stableCategoryId = categoryStableIdForItem(item, lookup);
    if (!matchesAnyToken(item.categoryId ?? stableCategoryId, categoryIds) && !matchesAnyToken(stableCategoryId, categoryIds)) return false;
  }

  const categoryNames = factorStringArray(scope.categoryNames);
  if (categoryNames.length > 0 && !matchesAnyToken(categoryLabelForItem(item, lookup), categoryNames)) return false;

  const analyticsBuckets = factorStringArray(scope.analyticsBuckets);
  if (analyticsBuckets.length > 0 && !matchesAnyToken(categoryAnalyticsBucketForItem(item, lookup), analyticsBuckets, normalizeFactorKey)) return false;

  const phaseIds = factorStringArray(scope.phaseIds);
  if (phaseIds.length > 0 && !matchesAnyToken(item.phaseId ?? "__unphased__", phaseIds)) return false;

  const worksheetIds = factorStringArray(scope.worksheetIds);
  if (worksheetIds.length > 0 && !matchesAnyToken(item.worksheetId, worksheetIds)) return false;

  const laborUnitIds = factorStringArray(scope.laborUnitIds);
  if (laborUnitIds.length > 0 && !matchesAnyToken(item.laborUnitId ?? "", laborUnitIds)) return false;

  const costCodes = factorStringArray(scope.costCodes);
  if (costCodes.length > 0 && !matchesAnyToken(item.costCode ?? "", costCodes, normalizeFactorKey)) return false;

  const classificationCodes = factorStringArray(scope.classificationCodes);
  if (!itemClassificationMatches(item, classificationCodes)) return false;

  return itemTextMatches(item, factorStringArray(scope.text));
}

function itemMatchesLineEstimateFactorScope(item: WorksheetItem, factor: EstimateFactor) {
  const itemIds = factorStringArray(factor.scope?.worksheetItemIds);
  return itemIds.length > 0 && matchesAnyToken(item.id, itemIds);
}

function itemMatchesEstimateFactor(item: WorksheetItem, factor: EstimateFactor, lookup: CategoryLookup) {
  const applicationScope = factor.applicationScope ?? (factorStringArray(factor.scope?.worksheetItemIds).length > 0 ? "line" : "global");
  const lineMatch = itemMatchesLineEstimateFactorScope(item, factor);
  if (applicationScope === "line") return lineMatch;
  const globalMatch = itemMatchesGlobalEstimateFactorScope(item, factor, lookup);
  if (applicationScope === "global") return globalMatch;
  return lineMatch || globalMatch;
}

function resolveNecaTemperatureMultiplier(parameters: Record<string, unknown>) {
  const unit = String(parameters.temperatureUnit ?? "C").toUpperCase();
  const inputTemperature = factorNumber(parameters.temperature, unit === "F" ? 68 : 20);
  const temperatureF = unit === "F" ? inputTemperature : (inputTemperature * 9 / 5) + 32;
  const humidity = factorNumber(parameters.humidity, 60);
  const samples = factorArray(parameters.sampleData).map((entry) => {
    const record = factorRecord(entry);
    return {
      temperatureF: factorNumber(record.temperatureF ?? record.T),
      humidity: factorNumber(record.humidity ?? record.H),
      productivity: factorNumber(record.productivity ?? record.P, 100),
    };
  }).filter((entry) => Number.isFinite(entry.productivity));
  const source = samples.length > 0 ? samples : NECA_TEMPERATURE_PRODUCTIVITY_SAMPLES;
  let best = source[0] ?? { temperatureF: 68, humidity: 60, productivity: 100 };
  let minDistance = Number.POSITIVE_INFINITY;
  for (const sample of source) {
    const distance = Math.sqrt(Math.pow(sample.temperatureF - temperatureF, 2) + Math.pow(sample.humidity - humidity, 2));
    if (distance < minDistance) {
      minDistance = distance;
      best = sample;
    }
  }
  const lostPercent = Math.max(0, 100 - best.productivity);
  return normalizeFactorMultiplier(1 + lostPercent / 100);
}

function resolveNecaConditionMultiplier(parameters: Record<string, unknown>) {
  const criteria = factorArray(parameters.criteria);
  const totalScore = criteria.reduce<number>((sum, entry) => sum + Math.max(0, Math.min(5, factorNumber(factorRecord(entry).score, 0))), 0);
  const ranges = factorArray(parameters.ranges).map((entry) => {
    const record = factorRecord(entry);
    return {
      minScore: factorNumber(record.minScore, 0),
      maxScore: factorNumber(record.maxScore, 0),
      multiplier: factorNumber(record.multiplier, 1),
    };
  }).filter((entry) => entry.maxScore >= entry.minScore);
  const source = ranges.length > 0 ? ranges : NECA_DIFFICULTY_RANGES;
  const matched = source.find((range) => totalScore >= range.minScore && totalScore <= range.maxScore);
  return normalizeFactorMultiplier(matched?.multiplier ?? 1);
}

function resolveConditionScoreMultiplier(parameters: Record<string, unknown>) {
  const maxScore = Math.max(1, factorNumber(parameters.maxScore, 5));
  const score = Math.max(0, Math.min(maxScore, factorNumber(parameters.score, factorNumber(parameters.input, 0))));
  const calibrationTotalScore = Math.max(1, factorNumber(parameters.calibrationTotalScore, 175));
  const calibrationMultiplier = Math.max(0.05, factorNumber(parameters.calibrationMultiplier, 1.3));
  const min = factorNumber(parameters.minMultiplier, 0.05);
  const max = factorNumber(parameters.maxMultiplier, 10);
  const raw = Math.pow(calibrationMultiplier, score / calibrationTotalScore);
  return normalizeFactorMultiplier(Math.max(Math.min(raw, max), min));
}

function interpolateExtendedDurationRow(table: typeof NECA_EXTENDED_DURATION_TABLE, baseHours: number) {
  const rows = table.slice().sort((left, right) => left.laborHours - right.laborHours);
  if (rows.length === 0) return { laborHours: baseHours, workers: 1, extraHours: 0 };
  const interpolate = (lower: typeof rows[number], upper: typeof rows[number]) => {
    const span = upper.laborHours - lower.laborHours;
    const ratio = span === 0 ? 0 : (baseHours - lower.laborHours) / span;
    return {
      laborHours: baseHours,
      workers: lower.workers + ratio * (upper.workers - lower.workers),
      extraHours: lower.extraHours + ratio * (upper.extraHours - lower.extraHours),
    };
  };
  if (baseHours <= rows[0].laborHours) return interpolate(rows[0], rows[1] ?? rows[0]);
  if (baseHours >= rows[rows.length - 1].laborHours) return interpolate(rows[rows.length - 2] ?? rows[rows.length - 1], rows[rows.length - 1]);
  for (let index = 1; index < rows.length; index += 1) {
    if (baseHours <= rows[index].laborHours) return interpolate(rows[index - 1], rows[index]);
  }
  return rows[rows.length - 1];
}

function resolveExtendedDurationMultiplier(parameters: Record<string, unknown>, baseHours: number) {
  if (baseHours <= 0) return 1;
  const tableInput = factorArray(parameters.table);
  const table = tableInput.map((entry) => {
    const record = factorRecord(entry);
    return {
      laborHours: factorNumber(record.laborHours),
      laborDays: factorNumber(record.laborDays),
      workers: factorNumber(record.workers, 1),
      crewWeeks: factorNumber(record.crewWeeks),
      normalMonths: factorNumber(record.normalMonths),
      factor: factorNumber(record.factor),
      extraHours: factorNumber(record.extraHours),
    };
  }).filter((entry) => entry.laborHours > 0);
  const source = table.length > 0 ? table : NECA_EXTENDED_DURATION_TABLE;
  const synthetic = interpolateExtendedDurationRow(source, baseHours);
  const workers = factorNumber(parameters.workers, synthetic.workers || 1);
  const monthsExtended = Math.max(0, factorNumber(parameters.monthsExtended, 0));
  const additionalHours = synthetic.workers === 0 ? 0 : (synthetic.extraHours / synthetic.workers) * workers * monthsExtended;
  return normalizeFactorMultiplier(1 + additionalHours / baseHours);
}

function resolvePerUnitScaleMultiplier(parameters: Record<string, unknown>) {
  const input = factorNumber(parameters.input, factorNumber(parameters.current, factorNumber(parameters.value, 0)));
  const baseline = factorNumber(parameters.baseline, 0);
  const rate = factorNumber(parameters.rate, 0);
  const unitSize = Math.max(0.000001, Math.abs(factorNumber(parameters.unitSize, 1)));
  const min = factorNumber(parameters.minMultiplier, 0.05);
  const max = factorNumber(parameters.maxMultiplier, 10);
  const raw = 1 + ((input - baseline) / unitSize) * rate;
  return normalizeFactorMultiplier(Math.max(Math.min(raw, max), min));
}

function resolveEstimateFactorMultiplier(factor: EstimateFactor, baseHours: number) {
  const parameters = factor.parameters ?? {};
  switch (factor.formulaType ?? "fixed_multiplier") {
    case "temperature_productivity":
      return resolveNecaTemperatureMultiplier(parameters);
    case "condition_score":
      return resolveConditionScoreMultiplier(parameters);
    case "neca_condition_score":
      return resolveNecaConditionMultiplier(parameters);
    case "extended_duration":
      return resolveExtendedDurationMultiplier(parameters, baseHours);
    case "per_unit_scale":
      return resolvePerUnitScaleMultiplier(parameters);
    case "fixed_multiplier":
    default:
      return normalizeFactorMultiplier(factor.value);
  }
}

function scaleTierUnits(tierUnits: WorksheetItem["tierUnits"], multiplier: number) {
  if (!tierUnits || Object.keys(tierUnits).length === 0) return tierUnits;
  return Object.fromEntries(Object.entries(tierUnits).map(([key, value]) => [key, roundMoney((Number(value) || 0) * multiplier)]));
}

function computeTotalHours(items: WorksheetItem[], schedules: WorksheetHourRateScheduleLike[]) {
  const hours = items.map((item) => computeItemHours(item, schedules));
  return roundMoney(hours.reduce((sum, entry) => sum + entry.total, 0));
}

function computeItemTotalHours(item: WorksheetItem, schedules: WorksheetHourRateScheduleLike[]) {
  return roundMoney(computeItemHours(item, schedules).total);
}

function applyEstimateFactorToItem(
  item: WorksheetItem,
  factor: EstimateFactor,
  multiplier: number,
  lookup: CategoryLookup,
) {
  if (factor.impact === "labor_hours" && !isLabourLikeItem(item, lookup)) return item;

  if (factor.impact === "labor_hours" || factor.impact === "resource_units") {
    return {
      ...item,
      cost: roundMoney(item.cost * multiplier),
      price: roundMoney(item.price * multiplier),
      tierUnits: scaleTierUnits(item.tierUnits, multiplier),
    };
  }

  if (factor.impact === "direct_cost") {
    const previousCost = computeItemCost(item);
    const nextCost = roundMoney(item.cost * multiplier);
    const nextExtendedCost = roundMoney(item.quantity * nextCost);
    const markedUpCostDelta = roundMoney((nextExtendedCost - previousCost) * (1 + (Number(item.markup) || 0)));
    return {
      ...item,
      cost: nextCost,
      price: roundMoney(item.price + markedUpCostDelta),
    };
  }

  return {
    ...item,
    price: roundMoney(item.price * multiplier),
  };
}

function applyEstimateFactorsToLineItems(
  rawLineItems: WorksheetItem[],
  factors: EstimateFactor[],
  categoryLookup: CategoryLookup,
  schedules: WorksheetHourRateScheduleLike[],
) {
  const factorTotals: EstimateFactorTotalEntry[] = [];
  let lineItems: WorksheetItem[] = rawLineItems.map((item) => ({
    ...item,
    tierUnits: item.tierUnits ? { ...item.tierUnits } : item.tierUnits,
  }));
  const sortedFactors = [...factors].sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return left.name.localeCompare(right.name);
  });

  for (const factor of sortedFactors) {
    const active = factor.active !== false;
    const targetIndexes = lineItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => itemMatchesEstimateFactor(item, factor, categoryLookup))
      .filter(({ item }) => factor.impact !== "labor_hours" || isLabourLikeItem(item, categoryLookup));

    const baseValue = roundMoney(targetIndexes.reduce((sum, { item }) => sum + item.price, 0));
    const baseCost = roundMoney(targetIndexes.reduce((sum, { item }) => sum + computeItemCost(item), 0));
    const baseHours = roundMoney(targetIndexes.reduce((sum, { item }) => sum + computeItemTotalHours(item, schedules), 0));
    const multiplier = resolveEstimateFactorMultiplier(factor, baseHours);
    const targetLineItemIds = targetIndexes.map(({ item }) => item.id);

    if (!active) {
      factorTotals.push({
        id: factor.id,
        label: factor.name,
        category: factor.category,
        impact: factor.impact,
        active,
        appliesTo: factor.appliesTo,
        applicationScope: factor.applicationScope ?? "global",
        value: multiplier,
        formulaType: factor.formulaType ?? "fixed_multiplier",
        parameters: factor.parameters ?? {},
        targetCount: targetIndexes.length,
        targetLineItemIds,
        baseValue,
        baseCost,
        baseHours,
        valueDelta: 0,
        costDelta: 0,
        hoursDelta: 0,
        effectiveValue: baseValue,
        effectiveCost: baseCost,
        effectiveHours: baseHours,
        scope: factor.scope,
        confidence: factor.confidence,
        sourceType: factor.sourceType,
        sourceId: factor.sourceId ?? null,
        sourceRef: factor.sourceRef ?? {},
      });
      continue;
    }

    const nextLineItems = [...lineItems];
    for (const { item, index } of targetIndexes) {
      nextLineItems[index] = applyEstimateFactorToItem(item, factor, multiplier, categoryLookup);
    }

    const effectiveItems = targetIndexes.map(({ index }) => nextLineItems[index]);
    const effectiveValue = roundMoney(effectiveItems.reduce((sum, item) => sum + item.price, 0));
    const effectiveCost = roundMoney(effectiveItems.reduce((sum, item) => sum + computeItemCost(item), 0));
    const effectiveHours = roundMoney(effectiveItems.reduce((sum, item) => sum + computeItemTotalHours(item, schedules), 0));

    factorTotals.push({
      id: factor.id,
      label: factor.name,
      category: factor.category,
      impact: factor.impact,
      active,
      appliesTo: factor.appliesTo,
      applicationScope: factor.applicationScope ?? "global",
      value: multiplier,
      formulaType: factor.formulaType ?? "fixed_multiplier",
      parameters: factor.parameters ?? {},
      targetCount: targetIndexes.length,
      targetLineItemIds,
      baseValue,
      baseCost,
      baseHours,
      valueDelta: roundMoney(effectiveValue - baseValue),
      costDelta: roundMoney(effectiveCost - baseCost),
      hoursDelta: roundMoney(effectiveHours - baseHours),
      effectiveValue,
      effectiveCost,
      effectiveHours,
      scope: factor.scope,
      confidence: factor.confidence,
      sourceType: factor.sourceType,
      sourceId: factor.sourceId ?? null,
      sourceRef: factor.sourceRef ?? {},
    });

    lineItems = nextLineItems;
  }

  return { lineItems, factorTotals };
}

export function calculateTotals(
  revision: QuoteRevision,
  worksheets: Array<Worksheet & { items: WorksheetItem[] }>,
  phases: BidwrightStore["phases"],
  adjustments: Adjustment[],
  revisionSchedules: WorksheetHourRateScheduleLike[] = [],
  entityCategories: EntityCategory[] = [],
  summaryBuilder?: Partial<SummaryBuilderConfig> | null,
  estimateFactors: EstimateFactor[] = [],
): RevisionTotals {
  const rawLineItems = worksheets.flatMap((worksheet) => worksheet.items);
  const categoryLookup = buildCategoryLookup(entityCategories);
  const { lineItems, factorTotals } = applyEstimateFactorsToLineItems(rawLineItems, estimateFactors, categoryLookup, revisionSchedules);
  const storedSummaryBuilder = (revision.pdfPreferences as Record<string, unknown> | undefined)?.summaryBuilder as
    | Partial<SummaryBuilderConfig>
    | undefined;
  const classificationConfig = normalizeSummaryClassificationConfig(summaryBuilder?.classification ?? storedSummaryBuilder?.classification);
  const {
    classificationConfig: normalizedClassificationConfig,
    categoryTotals: categoryTotalsMap,
    phaseTotals: phaseTotalsMap,
    phaseCategoryTotals: phaseCategoryTotalsMap,
    worksheetTotals: worksheetTotalsMap,
    worksheetCategoryTotals: worksheetCategoryTotalsMap,
    worksheetPhaseTotals: worksheetPhaseTotalsMap,
    classificationTotals: classificationTotalsMap,
    phaseClassificationTotals: phaseClassificationTotalsMap,
    worksheetClassificationTotals: worksheetClassificationTotalsMap,
    categoryClassificationTotals: categoryClassificationTotalsMap,
	  } = buildSourceTotals(lineItems, phases, worksheets, entityCategories, classificationConfig);

  const lineSubtotalBeforeFactors = roundMoney(rawLineItems.reduce((sum, item) => sum + item.price, 0));
  const costBeforeFactors = roundMoney(rawLineItems.reduce((sum, item) => sum + computeItemCost(item), 0));
  const totalHoursBeforeFactors = computeTotalHours(rawLineItems, revisionSchedules);
  const lineSubtotal = roundMoney(lineItems.reduce((sum, item) => sum + item.price, 0));
  let subtotal = lineSubtotal;
  const cost = roundMoney(lineItems.reduce((sum, item) => sum + computeItemCost(item), 0));
  const costBreakdown = buildCostBreakdown(lineItems, entityCategories, cost);
  const pricingLadderRows: PricingLadderRow[] = [
    {
      id: "direct_cost",
      label: "Direct Cost",
      rowType: "base",
      financialCategory: "direct_cost",
      baseAmount: cost,
      value: cost,
      cost,
      margin: 0,
      runningTotal: cost,
      affectsTotal: false,
      visible: true,
      active: true,
      sourceAdjustmentId: null,
      sourceFactorId: null,
    },
    {
      id: "line_subtotal",
      label: "Line Sell Subtotal",
      rowType: "base",
      financialCategory: "line_subtotal",
      baseAmount: lineSubtotal,
      value: lineSubtotal,
      cost,
      margin: lineSubtotal === 0 ? 0 : roundRatio((lineSubtotal - cost) / lineSubtotal),
      runningTotal: lineSubtotal,
      affectsTotal: true,
      visible: true,
      active: true,
      sourceAdjustmentId: null,
      sourceFactorId: null,
    },
  ];

  if (factorTotals.length > 0) {
    const activeFactorDelta = factorTotals.reduce((sum, entry) => sum + entry.valueDelta, 0);
    const factorBase = roundMoney(lineSubtotal - activeFactorDelta);
    let factorRunningTotal = factorBase;
    const factorRows: PricingLadderRow[] = factorTotals.map((entry) => {
      if (entry.active) {
        factorRunningTotal = roundMoney(factorRunningTotal + entry.valueDelta);
      }
      return {
        id: `factor:${entry.id}`,
        label: entry.label,
        rowType: "factor",
        financialCategory: "productivity",
        appliesTo: entry.appliesTo,
        percentage: roundRatio((entry.value - 1) * 100),
        fixedAmount: null,
        baseAmount: entry.baseValue,
        value: entry.valueDelta,
        cost: entry.costDelta,
        margin: entry.effectiveValue === 0 ? 0 : roundRatio((entry.effectiveValue - entry.effectiveCost) / entry.effectiveValue),
        runningTotal: entry.active ? factorRunningTotal : factorRunningTotal,
        affectsTotal: entry.active,
        visible: true,
        active: entry.active,
        sourceAdjustmentId: null,
        sourceFactorId: entry.id,
      };
    });
    pricingLadderRows.splice(1, 0, ...factorRows);
  }

  let breakout: BreakoutEntry[] = groupItemsForBreakout(revision.breakoutStyle, lineItems, phases, entityCategories)
    .filter((group) => group.name)
    .map((group) => {
      const aggregates = computeAggregates(group.items);

      return {
        name: group.name,
        entityId: group.key,
        value: aggregates.value,
        cost: aggregates.cost,
        margin: aggregates.margin,
        category:
          revision.breakoutStyle === "phase_detail"
	            ? Array.from(
	                group.items.reduce((map, item) => {
	                  const id = categoryStableIdForItem(item, categoryLookup);
	                  const entry = map.get(id) ?? { name: categoryLabelForItem(item, categoryLookup), items: [] as WorksheetItem[] };
	                  entry.items.push(item);
	                  map.set(id, entry);
	                  return map;
	                }, new Map<string, { name: string; items: WorksheetItem[] }>()),
	              )
	                .map(([, entry]) => {
	                  const nested = computeAggregates(entry.items);
	                  return {
	                    name: entry.name,
                    value: nested.value,
                    cost: nested.cost,
                    margin: nested.margin,
                  };
                })
                .sort((left, right) => left.name.localeCompare(right.name))
            : undefined,
      } satisfies BreakoutEntry;
    });

  const adjustmentTotals: RevisionTotals["adjustmentTotals"] = [];
  const sortedAdjustments = [...adjustments].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.name.localeCompare(right.name);
  });

  let breakoutOverride: BreakoutEntry[] | null = null;
  const optionStandalone: BreakoutEntry[] = [];
  const lineItemStandalone: BreakoutEntry[] = [];

  for (const adjustment of sortedAdjustments) {
    const active = adjustment.active !== false;
    const financialCategory = normalizeAdjustmentFinancialCategory(adjustment);
    if (adjustment.pricingMode === "modifier") {
      const { target, calculationBase, applicableBase, value: calculatedValue } = calculateModifierAmount(
	        adjustment,
	        lineItems,
	        lineSubtotal,
	        cost,
	        subtotal,
	        categoryLookup,
	      );
      const value = active ? calculatedValue : 0;
      const runningTotal = active ? roundMoney(subtotal + value) : subtotal;
      const subtotalAffected = affectsSubtotal(adjustment);
      adjustmentTotals.push({
        id: adjustment.id,
        label: adjustment.name,
        kind: adjustment.kind,
        pricingMode: adjustment.pricingMode,
        type: adjustment.type,
        financialCategory,
        calculationBase,
        active,
        appliesTo: target,
        show: adjustment.show,
        affectsSubtotal: subtotalAffected,
        baseAmount: applicableBase,
        runningTotal,
        value,
        cost: 0,
        margin: value === 0 ? 0 : 1,
      });
      pricingLadderRows.push({
        id: `adjustment:${adjustment.id}`,
        label: adjustment.name,
        rowType: "adjustment",
        financialCategory,
        pricingMode: adjustment.pricingMode,
        calculationBase,
        appliesTo: target,
        percentage: adjustment.percentage,
        fixedAmount: adjustment.amount,
        baseAmount: roundMoney(applicableBase),
        value,
        cost: 0,
        margin: value === 0 ? 0 : 1,
        runningTotal,
        affectsTotal: active,
        visible: adjustment.show !== "No",
        active,
        sourceAdjustmentId: adjustment.id,
      });

      if (!active || (value === 0 && !adjustment.amount && !adjustment.percentage)) {
        continue;
      }

      subtotal = runningTotal;

      if (adjustment.show === "No") {
        applyHiddenAdjustmentToAggregates(
          value,
          target,
          lineItems,
          categoryTotalsMap,
	          phaseTotalsMap,
	          phaseCategoryTotalsMap,
	          categoryLookup,
	          {
            classificationConfig: normalizedClassificationConfig,
            classificationTotals: classificationTotalsMap,
            phaseClassificationTotals: phaseClassificationTotalsMap,
            worksheetClassificationTotals: worksheetClassificationTotalsMap,
            categoryClassificationTotals: categoryClassificationTotalsMap,
          },
        );
        breakout = distributeHiddenAdjustment(breakout, value, target, lineItems, revision.breakoutStyle, entityCategories);
      } else {
        breakout.push({
          name: adjustment.name,
          value,
          cost: 0,
          margin: value === 0 ? 0 : 1,
          type: "Adjustment",
        });
      }
      continue;
    }

    const amount = active ? roundMoney(adjustment.amount ?? 0) : 0;
    const calculationBase = normalizeAdjustmentCalculationBase(adjustment);
    const subtotalAffected = affectsSubtotal(adjustment);
    const baseEntry: BreakoutEntry = {
      name: adjustment.name,
      value: amount,
      cost: 0,
      margin: amount === 0 ? 0 : 1,
      type: adjustment.type || adjustment.pricingMode,
    };

    adjustmentTotals.push({
      id: adjustment.id,
      label: adjustment.name,
      kind: adjustment.kind,
      pricingMode: adjustment.pricingMode,
      type: adjustment.type,
      financialCategory,
      calculationBase,
      active,
      appliesTo: adjustment.appliesTo,
      show: adjustment.show,
      affectsSubtotal: subtotalAffected,
      baseAmount: 0,
      runningTotal: subtotal,
      value: amount,
      cost: 0,
      margin: amount === 0 ? 0 : 1,
    });

    if (!active) {
      pricingLadderRows.push({
        id: `adjustment:${adjustment.id}`,
        label: adjustment.name,
        rowType: "adjustment",
        financialCategory,
        pricingMode: adjustment.pricingMode,
        calculationBase,
        appliesTo: adjustment.appliesTo,
        percentage: adjustment.percentage,
        fixedAmount: adjustment.amount,
        baseAmount: 0,
        value: 0,
        cost: 0,
        margin: 0,
        runningTotal: subtotal,
        affectsTotal: false,
        visible: adjustment.show !== "No",
        active,
        sourceAdjustmentId: adjustment.id,
      });
      continue;
    }

    let nextRunningTotal = subtotal;
    switch (adjustment.pricingMode) {
      case "option_standalone":
        if (optionStandalone.length === 0) {
          subtotal = amount;
        }
        nextRunningTotal = amount;
        optionStandalone.push(baseEntry);
        break;
      case "option_additional":
        breakout.push(baseEntry);
        break;
      case "line_item_additional":
        subtotal = roundMoney(subtotal + amount);
        nextRunningTotal = subtotal;
        breakout.push(baseEntry);
        break;
      case "line_item_standalone":
        nextRunningTotal = amount;
        lineItemStandalone.push(baseEntry);
        break;
      case "custom_total":
        subtotal = amount;
        nextRunningTotal = subtotal;
        breakoutOverride = [
          {
            ...baseEntry,
            cost,
            margin: amount === 0 ? 0 : roundMoney((amount - cost) / amount),
          },
        ];
        break;
      default:
        breakout.push(baseEntry);
        break;
    }

    const lastAdjustment = adjustmentTotals[adjustmentTotals.length - 1];
    lastAdjustment.runningTotal = nextRunningTotal;
    pricingLadderRows.push({
      id: `adjustment:${adjustment.id}`,
      label: adjustment.name,
      rowType: "adjustment",
      financialCategory,
      pricingMode: adjustment.pricingMode,
      calculationBase,
      appliesTo: adjustment.appliesTo,
      percentage: adjustment.percentage,
      fixedAmount: adjustment.amount,
      baseAmount: 0,
      value: amount,
      cost: 0,
      margin: amount === 0 ? 0 : 1,
      runningTotal: nextRunningTotal,
      affectsTotal: subtotalAffected || standalonePricingModes.has(adjustment.pricingMode),
      visible: adjustment.show !== "No",
      active,
      sourceAdjustmentId: adjustment.id,
    });
  }

  if (optionStandalone.length > 0) {
    breakoutOverride = optionStandalone;
  } else if (lineItemStandalone.length > 0) {
    subtotal = roundMoney(lineItemStandalone.reduce((sum, item) => sum + item.value, 0));
    breakoutOverride = lineItemStandalone;
  }

  if (breakoutOverride) {
    breakout = breakoutOverride;
  }

  updateSourceMargins(categoryTotalsMap.values());
  updateSourceMargins(phaseTotalsMap.values());
  updateSourceMargins(phaseCategoryTotalsMap.values());
  updateSourceMargins(worksheetTotalsMap.values());
  updateSourceMargins(worksheetCategoryTotalsMap.values());
  updateSourceMargins(worksheetPhaseTotalsMap.values());
  updateSourceMargins(classificationTotalsMap.values());
  updateSourceMargins(phaseClassificationTotalsMap.values());
  updateSourceMargins(worksheetClassificationTotalsMap.values());
  updateSourceMargins(categoryClassificationTotalsMap.values());

  const allItemHours = lineItems.map((item) => computeItemHours(item, revisionSchedules));
  const regHours = roundMoney(allItemHours.reduce((sum, hours) => sum + hours.reg, 0));
  const overHours = roundMoney(allItemHours.reduce((sum, hours) => sum + hours.ot, 0));
  const doubleHours = roundMoney(allItemHours.reduce((sum, hours) => sum + hours.dt, 0));
  const totalHours = roundMoney(allItemHours.reduce((sum, hours) => sum + hours.total, 0));

  const tierUnitTotals: Record<string, number> = {};
  for (const hours of allItemHours) {
    if (!hours.tierUnits) {
      continue;
    }
    for (const [tierId, value] of Object.entries(hours.tierUnits)) {
      tierUnitTotals[tierId] = roundMoney((tierUnitTotals[tierId] ?? 0) + value);
    }
  }

  const estimatedProfit = roundMoney(subtotal - cost);
  const estimatedMargin = subtotal === 0 ? 0 : roundMoney(estimatedProfit / subtotal);
  const adjustmentTotal = roundMoney(subtotal - lineSubtotal);
  const pricingLadder = {
    version: 1 as const,
    directCost: cost,
    lineSubtotal,
    adjustmentTotal,
    netTotal: subtotal,
    grandTotal: subtotal,
    internalProfit: estimatedProfit,
    internalMargin: estimatedMargin,
    rows: [
      ...pricingLadderRows.map((row) => ({
        ...row,
        baseAmount: roundMoney(row.baseAmount),
        value: roundMoney(row.value),
        cost: roundMoney(row.cost),
        margin: roundRatio(row.margin),
        runningTotal: roundMoney(row.runningTotal),
      })),
      {
        id: "grand_total",
        label: "Customer Total",
        rowType: "total" as const,
        financialCategory: "total",
        baseAmount: subtotal,
        value: subtotal,
        cost,
        margin: estimatedMargin,
        runningTotal: subtotal,
        affectsTotal: true,
        visible: true,
        active: true,
        sourceAdjustmentId: null,
      },
      {
        id: "internal_profit",
        label: "Internal Profit",
        rowType: "profit" as const,
        financialCategory: "profit",
        baseAmount: subtotal,
        value: estimatedProfit,
        cost: 0,
        margin: estimatedMargin,
        runningTotal: estimatedProfit,
        affectsTotal: false,
        visible: true,
        active: true,
        sourceAdjustmentId: null,
      },
    ],
  };

  return {
    subtotal,
    cost,
    lineSubtotalBeforeFactors,
    costBeforeFactors,
    totalHoursBeforeFactors,
    adjustedLineItems: lineItems.map((item) => ({
      ...item,
      cost: roundMoney(item.cost),
      price: roundMoney(item.price),
      tierUnits: scaleTierUnits(item.tierUnits, 1),
    })),
    estimatedProfit,
    estimatedMargin,
    calculatedTotal: subtotal,
    regHours,
    overHours,
    doubleHours,
    totalHours,
    categoryTotals: sortSourceEntries(Array.from(categoryTotalsMap.values())),
    phaseTotals: sortSourceEntries(Array.from(phaseTotalsMap.values())),
    phaseCategoryTotals: sortSourceEntries(Array.from(phaseCategoryTotalsMap.values())),
    worksheetTotals: sortSourceEntries(Array.from(worksheetTotalsMap.values())),
    worksheetCategoryTotals: sortSourceEntries(Array.from(worksheetCategoryTotalsMap.values())),
    worksheetPhaseTotals: sortSourceEntries(Array.from(worksheetPhaseTotalsMap.values())),
    classificationTotals: sortSourceEntries(Array.from(classificationTotalsMap.values())),
    phaseClassificationTotals: sortSourceEntries(Array.from(phaseClassificationTotalsMap.values())),
    worksheetClassificationTotals: sortSourceEntries(Array.from(worksheetClassificationTotalsMap.values())),
    categoryClassificationTotals: sortSourceEntries(Array.from(categoryClassificationTotalsMap.values())),
    factorTotals: factorTotals.map((entry) => ({
      ...entry,
      value: roundRatio(entry.value),
      baseValue: roundMoney(entry.baseValue),
      baseCost: roundMoney(entry.baseCost),
      baseHours: roundMoney(entry.baseHours),
      valueDelta: roundMoney(entry.valueDelta),
      costDelta: roundMoney(entry.costDelta),
      hoursDelta: roundMoney(entry.hoursDelta),
      effectiveValue: roundMoney(entry.effectiveValue),
      effectiveCost: roundMoney(entry.effectiveCost),
      effectiveHours: roundMoney(entry.effectiveHours),
    })),
    adjustmentTotals: adjustmentTotals.map((entry) => ({
      ...entry,
      baseAmount: roundMoney(entry.baseAmount),
      runningTotal: roundMoney(entry.runningTotal),
      value: roundMoney(entry.value),
      cost: roundMoney(entry.cost),
      margin: roundMoney(entry.margin),
    })),
    pricingLadder,
    costBreakdown,
    tierUnitTotals: Object.keys(tierUnitTotals).length > 0 ? tierUnitTotals : undefined,
    breakout: breakout.map((entry) => ({
      ...entry,
      value: roundMoney(entry.value),
      cost: roundMoney(entry.cost),
      margin: roundMoney(entry.margin),
      category: entry.category?.map((nested) => ({
        ...nested,
        value: roundMoney(nested.value),
        cost: roundMoney(nested.cost),
        margin: roundMoney(nested.margin),
      })),
    })),
  };
}

export function listProjects(store: BidwrightStore) {
  return store.projects.map((project) => {
    const quote = getQuoteByProjectId(store, project.id);
    const revision = quote ? getCurrentRevision(store, quote.id) : undefined;
    return {
      ...project,
      quote: quote
        ? {
            id: quote.id,
            quoteNumber: quote.quoteNumber,
            title: quote.title,
            status: quote.status,
            currentRevisionId: quote.currentRevisionId,
          }
        : null,
      latestRevision: revision
        ? {
            id: revision.id,
            revisionNumber: revision.revisionNumber,
            subtotal: revision.subtotal,
            estimatedProfit: revision.estimatedProfit,
            estimatedMargin: revision.estimatedMargin,
          }
        : null,
    };
  });
}

export function getProjectById(store: BidwrightStore, projectId: string) {
  const project = store.projects.find((entry) => entry.id === projectId);
  if (!project) {
    return null;
  }

  const quote = getQuoteByProjectId(store, projectId);
  const revision = quote ? getCurrentRevision(store, quote.id) : undefined;

  return {
    ...project,
    quote: quote ?? null,
    latestRevision: revision ?? null,
    sourceDocumentCount: store.sourceDocuments.filter((document) => document.projectId === projectId).length,
    aiRunCount: store.aiRuns.filter((run) => run.projectId === projectId).length,
  };
}

export function buildProjectWorkspace(store: BidwrightStore, projectId: string): ProjectWorkspace | null {
  const project = store.projects.find((entry) => entry.id === projectId);
  if (!project) {
    return null;
  }

  const quote = getQuoteByProjectId(store, projectId);
  if (!quote) {
    return null;
  }

  const revision = getCurrentRevision(store, quote.id);
  if (!revision) {
    return null;
  }

  const worksheets = getWorksheets(store, revision.id);
  const worksheetFolders = getWorksheetFolders(store, revision.id);
  const aiRuns = store.aiRuns.filter((run) => run.projectId === projectId);
  const citations = store.citations.filter((citation) => citation.projectId === projectId);
  const phases = sortPhasesForDisplay(store.phases.filter((phase) => phase.revisionId === revision.id));
  const adjustments = store.adjustments
    .filter((adjustment) => adjustment.revisionId === revision.id)
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      return left.name.localeCompare(right.name);
    });
  const estimateFactors = (store.estimateFactors ?? [])
    .filter((factor) => factor.revisionId === revision.id)
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      return left.name.localeCompare(right.name);
    });
  const summaryRows = (store.summaryRows ?? [])
    .filter((row) => row.revisionId === revision.id)
    .sort((left, right) => left.order - right.order);
  const estimateStrategy = (store.estimateStrategies ?? []).find((entry) => entry.revisionId === revision.id) ?? null;
  const estimateFeedback = (store.estimateCalibrationFeedback ?? [])
    .filter((entry) => entry.revisionId === revision.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const revisionSchedules = getRevisionRateSchedules(store, revision.id);
  const storedSummaryBuilder = (revision.pdfPreferences as Record<string, unknown> | undefined)?.summaryBuilder as
    | Partial<SummaryBuilderConfig>
    | undefined;
  const totals = calculateTotals(
    revision,
    worksheets,
    phases,
    adjustments,
    revisionSchedules,
    store.entityCategories ?? [],
    storedSummaryBuilder,
    estimateFactors,
  );
  const currentRevision = {
    ...revision,
    subtotal: totals.subtotal,
    cost: totals.cost,
    estimatedProfit: totals.estimatedProfit,
    estimatedMargin: totals.estimatedMargin,
    calculatedTotal: totals.calculatedTotal,
    pricingLadder: totals.pricingLadder,
    totalHours: totals.totalHours,
  };
  const revisions = store.revisions
    .filter((entry) => entry.quoteId === quote.id)
    .map((entry) => entry.id === revision.id ? currentRevision : entry)
    .sort((left, right) => {
      if (left.revisionNumber !== right.revisionNumber) {
        return right.revisionNumber - left.revisionNumber;
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  const summaryBuilder = buildSummaryBuilderConfig(
    storedSummaryBuilder,
    summaryRows,
    revision.summaryLayoutPreset,
    totals,
  );
  const rawLineItems = worksheets.flatMap((worksheet) => worksheet.items);
  const lineItems = totals.adjustedLineItems.length > 0 ? totals.adjustedLineItems : rawLineItems;
  const modifiers = adjustments.map(adjustmentToLegacyModifier).filter(isDefined);
  const additionalLineItems = adjustments.map(adjustmentToLegacyAdditionalLineItem).filter(isDefined);
  const materializedSummaryRows = materializeSummaryRowsFromBuilder(summaryBuilder, totals);
  const scheduleTasks = (store.scheduleTasks || []).filter(
    (task) => task.projectId === projectId && task.revisionId === revision.id,
  );
  const scheduleTaskIds = new Set(scheduleTasks.map((task) => task.id));
  const scheduleBaselines = (store.scheduleBaselines || []).filter(
    (baseline) => baseline.projectId === projectId && baseline.revisionId === revision.id,
  );
  const scheduleBaselineIds = new Set(scheduleBaselines.map((baseline) => baseline.id));

  return {
    project,
    sourceDocuments: store.sourceDocuments.filter((document) => document.projectId === projectId),
    quote,
    currentRevision,
    revisions,
    worksheetFolders,
    worksheets,
    phases,
    estimateFactors,
    adjustments,
    modifiers,
    additionalLineItems,
    summaryBuilder,
    summaryRows: computeSummaryRows(
      materializedSummaryRows.map((row, index) => ({
        ...row,
        id: summaryRows[index]?.id ?? `summary-builder-${index}`,
        revisionId: revision.id,
        computedValue: 0,
        computedCost: 0,
        computedMargin: 0,
      })),
      totals,
    ),
    conditions: store.conditions.filter((condition) => condition.revisionId === revision.id),
    catalogs: getCatalogs(store, projectId),
    aiRuns,
    citations,
    scheduleTasks,
    scheduleDependencies: (store.scheduleDependencies || []).filter(
      (dependency) =>
        scheduleTaskIds.has(dependency.predecessorId) && scheduleTaskIds.has(dependency.successorId),
    ),
    scheduleCalendars: (store.scheduleCalendars || []).filter(
      (calendar) => calendar.projectId === projectId && calendar.revisionId === revision.id,
    ),
    scheduleBaselines,
    scheduleBaselineTasks: (store.scheduleBaselineTasks || []).filter((baselineTask) =>
      scheduleBaselineIds.has(baselineTask.baselineId),
    ),
    scheduleResources: (store.scheduleResources || []).filter(
      (resource) => resource.projectId === projectId && resource.revisionId === revision.id,
    ),
    scheduleTaskAssignments: (store.scheduleTaskAssignments || []).filter((assignment) =>
      scheduleTaskIds.has(assignment.taskId),
    ),
    takeoffLinks: (store.takeoffLinks || []).filter((link) => link.projectId === projectId),
    entityCategories: store.entityCategories ?? [],
    estimateStrategy,
    estimateFeedback,
    estimate: {
      revisionId: revision.id,
      totals,
      lineItems,
      summary: {
        sourceDocumentCount: store.sourceDocuments.filter((document) => document.projectId === projectId).length,
        worksheetCount: worksheets.length,
        lineItemCount: rawLineItems.length,
        citationCount: citations.length,
        aiRunCount: aiRuns.length,
      },
    },
  };
}

function isStandaloneQuote(totals: RevisionTotals) {
  return totals.adjustmentTotals.some((entry) => standalonePricingModes.has(entry.pricingMode));
}

function subtotalContribution(row: SummaryRow, totals: RevisionTotals) {
  if (row.type === "adjustment") {
    const entry = totals.adjustmentTotals.find((adjustment) => adjustment.id === row.sourceAdjustmentId);
    if (!entry || !entry.affectsSubtotal) {
      return { value: 0, cost: 0 };
    }
    return { value: row.computedValue, cost: row.computedCost };
  }

  if (row.type === "category" || row.type === "phase" || row.type === "worksheet" || row.type === "classification") {
    if (isStandaloneQuote(totals)) {
      return { value: 0, cost: 0 };
    }
    return { value: row.computedValue, cost: row.computedCost };
  }

  return { value: 0, cost: 0 };
}

export function computeSummaryRows(rows: SummaryRow[], totals: RevisionTotals): SummaryRow[] {
  const mapSourceEntries = (entries: SourceTotalEntry[]) => {
    const map = new Map<string, SourceTotalEntry>();
    for (const entry of entries) {
      map.set(entry.id, entry);
      if (entry.legacyCategoryId && !map.has(entry.legacyCategoryId)) {
        map.set(entry.legacyCategoryId, entry);
      }
      if (entry.legacyCategoryId && entry.categoryId && entry.id.includes(entry.categoryId)) {
        const legacyCompositeId = entry.id.replace(entry.categoryId, entry.legacyCategoryId);
        if (!map.has(legacyCompositeId)) {
          map.set(legacyCompositeId, entry);
        }
      }
    }
    return map;
  };
  const categoryTotals = mapSourceEntries(totals.categoryTotals);
  const phaseTotals = new Map(totals.phaseTotals.map((entry) => [entry.id, entry]));
  const phaseCategoryTotals = mapSourceEntries(totals.phaseCategoryTotals);
  const worksheetTotals = new Map((totals.worksheetTotals ?? []).map((entry) => [entry.id, entry]));
  const worksheetCategoryTotals = mapSourceEntries(totals.worksheetCategoryTotals ?? []);
  const worksheetPhaseTotals = new Map((totals.worksheetPhaseTotals ?? []).map((entry) => [entry.id, entry]));
  const classificationTotals = new Map((totals.classificationTotals ?? []).map((entry) => [entry.id, entry]));
  const phaseClassificationTotals = new Map((totals.phaseClassificationTotals ?? []).map((entry) => [entry.id, entry]));
  const worksheetClassificationTotals = new Map((totals.worksheetClassificationTotals ?? []).map((entry) => [entry.id, entry]));
  const categoryClassificationTotals = mapSourceEntries(totals.categoryClassificationTotals ?? []);
  const adjustmentTotals = new Map(totals.adjustmentTotals.map((entry) => [entry.id, entry]));
  const computed = rows.map((row) => ({ ...row }));

  const applyEntry = (row: SummaryRow, sourceEntry: Pick<SourceTotalEntry, "value" | "cost"> | undefined) => {
    row.computedValue = roundMoney(sourceEntry?.value ?? 0);
    row.computedCost = roundMoney(sourceEntry?.cost ?? 0);
    row.computedMargin = row.computedValue === 0 ? 0 : roundMoney((row.computedValue - row.computedCost) / row.computedValue);
  };

  for (const row of computed) {
    if (!row.visible) {
      row.computedValue = 0;
      row.computedCost = 0;
      row.computedMargin = 0;
      continue;
    }

    switch (row.type) {
      case "category": {
        const sourceEntry = row.sourceClassificationId
          ? categoryClassificationTotals.get(buildPairKey(row.sourceCategoryId, row.sourceClassificationId))
          : row.sourceWorksheetId
            ? worksheetCategoryTotals.get(buildPairKey(row.sourceWorksheetId, row.sourceCategoryId))
            : row.sourcePhaseId
              ? phaseCategoryTotals.get(buildPhaseCategoryKey(row.sourcePhaseId, row.sourceCategoryId ?? ""))
              : categoryTotals.get(row.sourceCategoryId ?? "");
        applyEntry(row, sourceEntry);
        break;
      }
      case "phase": {
        const sourceEntry = row.sourceClassificationId
          ? phaseClassificationTotals.get(buildPairKey(row.sourcePhaseId, row.sourceClassificationId))
          : row.sourceWorksheetId
            ? worksheetPhaseTotals.get(buildPairKey(row.sourceWorksheetId, row.sourcePhaseId))
            : row.sourceCategoryId
              ? phaseCategoryTotals.get(buildPhaseCategoryKey(row.sourcePhaseId, row.sourceCategoryId))
              : phaseTotals.get(row.sourcePhaseId ?? "");
        applyEntry(row, sourceEntry);
        break;
      }
      case "worksheet": {
        const sourceEntry = row.sourceClassificationId
          ? worksheetClassificationTotals.get(buildPairKey(row.sourceWorksheetId, row.sourceClassificationId))
          : row.sourceCategoryId
            ? worksheetCategoryTotals.get(buildPairKey(row.sourceWorksheetId, row.sourceCategoryId))
            : row.sourcePhaseId
              ? worksheetPhaseTotals.get(buildPairKey(row.sourceWorksheetId, row.sourcePhaseId))
              : worksheetTotals.get(row.sourceWorksheetId ?? "");
        applyEntry(row, sourceEntry);
        break;
      }
      case "classification": {
        const sourceEntry = row.sourceWorksheetId
          ? worksheetClassificationTotals.get(buildPairKey(row.sourceWorksheetId, row.sourceClassificationId))
          : row.sourceCategoryId
            ? categoryClassificationTotals.get(buildPairKey(row.sourceCategoryId, row.sourceClassificationId))
            : row.sourcePhaseId
              ? phaseClassificationTotals.get(buildPairKey(row.sourcePhaseId, row.sourceClassificationId))
              : classificationTotals.get(row.sourceClassificationId ?? "");
        applyEntry(row, sourceEntry);
        break;
      }
      case "adjustment": {
        const sourceEntry = adjustmentTotals.get(row.sourceAdjustmentId ?? "");
        applyEntry(row, sourceEntry);
        break;
      }
      case "subtotal": {
        let sumValue = 0;
        let sumCost = 0;
        let hasContributingRows = false;
        for (const previous of computed) {
          if (previous.id === row.id) {
            break;
          }
          if (!previous.visible || previous.type === "separator" || previous.type === "heading") {
            continue;
          }
          if (previous.type === "subtotal") {
            sumValue = 0;
            sumCost = 0;
            hasContributingRows = false;
            continue;
          }

          const contribution = subtotalContribution(previous, totals);
          if (contribution.value === 0 && contribution.cost === 0) {
            continue;
          }
          hasContributingRows = true;
          sumValue += contribution.value;
          sumCost += contribution.cost;
        }

        row.computedValue = roundMoney(hasContributingRows ? sumValue : totals.subtotal);
        row.computedCost = roundMoney(hasContributingRows ? sumCost : totals.cost);
        row.computedMargin = row.computedValue === 0 ? 0 : roundMoney((row.computedValue - row.computedCost) / row.computedValue);
        break;
      }
      case "heading":
      case "separator":
      default:
        row.computedValue = 0;
        row.computedCost = 0;
        row.computedMargin = 0;
        break;
    }
  }

  return computed;
}

export function generateSummaryPreset(
  preset: SummaryPreset,
  totals: RevisionTotals,
): Array<Omit<SummaryRow, "id" | "revisionId" | "computedValue" | "computedCost" | "computedMargin">> {
  type SummaryRowTemplate = Omit<
    SummaryRow,
    "id" | "revisionId" | "computedValue" | "computedCost" | "computedMargin"
  >;
  const visibleAdjustments = totals.adjustmentTotals.filter((entry) => entry.show !== "No");
  const standaloneQuote = isStandaloneQuote(totals);
  const nonZeroCategories = totals.categoryTotals.filter((entry) => entry.value !== 0 || entry.cost !== 0);
  const nonZeroPhases = totals.phaseTotals.filter((entry) => entry.value !== 0 || entry.cost !== 0);
  const nonZeroPhaseCategories = totals.phaseCategoryTotals.filter((entry) => entry.value !== 0 || entry.cost !== 0);
  const nonZeroWorksheets = (totals.worksheetTotals ?? []).filter((entry) => entry.value !== 0 || entry.cost !== 0);
  const nonZeroClassifications = (totals.classificationTotals ?? []).filter((entry) => entry.value !== 0 || entry.cost !== 0);

  const adjustmentRows = (startOrder: number): SummaryRowTemplate[] =>
    visibleAdjustments.map((entry, index) => ({
      type: "adjustment" as SummaryRowType,
      label: entry.label,
      order: startOrder + index,
      visible: true,
      style: "normal" as const,
      sourceCategoryId: null,
      sourceCategoryLabel: null,
      sourcePhaseId: null,
      sourceAdjustmentId: entry.id,
    }));

  switch (preset) {
    case "quick_total":
      return [
        {
          type: "subtotal",
          label: "Grand Total",
          order: 0,
          visible: true,
          style: "bold",
          sourceCategoryId: null,
          sourceCategoryLabel: null,
          sourcePhaseId: null,
          sourceAdjustmentId: null,
        } satisfies SummaryRowTemplate,
      ];

    case "by_category": {
      if (standaloneQuote) {
        const rows = adjustmentRows(0);
        rows.push({
          type: "subtotal",
          label: "Grand Total",
          order: rows.length,
          visible: true,
          style: "bold",
          sourceCategoryId: null,
          sourceCategoryLabel: null,
          sourcePhaseId: null,
          sourceAdjustmentId: null,
        } satisfies SummaryRowTemplate);
        return rows;
      }

      const rows: SummaryRowTemplate[] = nonZeroCategories.map((entry, index) => ({
        type: "category" as SummaryRowType,
        label: entry.label,
        order: index,
        visible: true,
        style: "normal" as const,
        sourceCategoryId: entry.id,
        sourceCategoryLabel: entry.label,
        sourcePhaseId: null,
        sourceAdjustmentId: null,
      }));
      rows.push(...adjustmentRows(rows.length));
      rows.push({
        type: "subtotal" as SummaryRowType,
        label: "Grand Total",
        order: rows.length,
        visible: true,
        style: "bold" as const,
        sourceCategoryId: null,
        sourceCategoryLabel: null,
        sourcePhaseId: null,
        sourceAdjustmentId: null,
      } satisfies SummaryRowTemplate);
      return rows;
    }

    case "by_phase": {
      if (standaloneQuote) {
        const rows = adjustmentRows(0);
        rows.push({
          type: "subtotal",
          label: "Grand Total",
          order: rows.length,
          visible: true,
          style: "bold",
          sourceCategoryId: null,
          sourceCategoryLabel: null,
          sourcePhaseId: null,
          sourceAdjustmentId: null,
        } satisfies SummaryRowTemplate);
        return rows;
      }

      const rows: SummaryRowTemplate[] = nonZeroPhases.map((entry, index) => ({
        type: "phase" as SummaryRowType,
        label: entry.label,
        order: index,
        visible: true,
        style: "normal" as const,
        sourceCategoryId: null,
        sourceCategoryLabel: null,
        sourcePhaseId: entry.id,
        sourceAdjustmentId: null,
      }));
      rows.push(...adjustmentRows(rows.length));
      rows.push({
        type: "subtotal" as SummaryRowType,
        label: "Grand Total",
        order: rows.length,
        visible: true,
        style: "bold" as const,
        sourceCategoryId: null,
        sourceCategoryLabel: null,
        sourcePhaseId: null,
        sourceAdjustmentId: null,
      } satisfies SummaryRowTemplate);
      return rows;
    }

    case "by_worksheet": {
      if (standaloneQuote) {
        const rows = adjustmentRows(0);
        rows.push({
          type: "subtotal",
          label: "Grand Total",
          order: rows.length,
          visible: true,
          style: "bold",
          sourceCategoryId: null,
          sourceCategoryLabel: null,
          sourcePhaseId: null,
          sourceAdjustmentId: null,
        } satisfies SummaryRowTemplate);
        return rows;
      }

      const rows: SummaryRowTemplate[] = nonZeroWorksheets.map((entry, index) => ({
        type: "worksheet" as SummaryRowType,
        label: entry.label,
        order: index,
        visible: true,
        style: "normal" as const,
        sourceWorksheetId: entry.id,
        sourceWorksheetLabel: entry.label,
        sourceAdjustmentId: null,
      }));
      rows.push(...adjustmentRows(rows.length));
      rows.push({
        type: "subtotal" as SummaryRowType,
        label: "Grand Total",
        order: rows.length,
        visible: true,
        style: "bold" as const,
        sourceAdjustmentId: null,
      } satisfies SummaryRowTemplate);
      return rows;
    }

    case "by_masterformat_division":
    case "by_uniformat_division":
    case "by_omniclass_division":
    case "by_uniclass_division":
    case "by_din276_division":
    case "by_nrm_division":
    case "by_icms_division":
    case "by_cost_code": {
      if (standaloneQuote) {
        const rows = adjustmentRows(0);
        rows.push({
          type: "subtotal",
          label: "Grand Total",
          order: rows.length,
          visible: true,
          style: "bold",
          sourceAdjustmentId: null,
        } satisfies SummaryRowTemplate);
        return rows;
      }

      const rows: SummaryRowTemplate[] = nonZeroClassifications.map((entry, index) => ({
        type: "classification" as SummaryRowType,
        label: entry.label,
        order: index,
        visible: true,
        style: "normal" as const,
        sourceClassificationId: entry.id,
        sourceClassificationLabel: entry.label,
        sourceAdjustmentId: null,
      }));
      rows.push(...adjustmentRows(rows.length));
      rows.push({
        type: "subtotal" as SummaryRowType,
        label: "Grand Total",
        order: rows.length,
        visible: true,
        style: "bold" as const,
        sourceAdjustmentId: null,
      } satisfies SummaryRowTemplate);
      return rows;
    }

    case "phase_x_category": {
      if (standaloneQuote) {
        const rows = adjustmentRows(0);
        rows.push({
          type: "subtotal",
          label: "Grand Total",
          order: rows.length,
          visible: true,
          style: "bold",
          sourceCategoryId: null,
          sourceCategoryLabel: null,
          sourcePhaseId: null,
          sourceAdjustmentId: null,
        } satisfies SummaryRowTemplate);
        return rows;
      }

      const rows: SummaryRowTemplate[] = [];
      for (const phase of nonZeroPhases) {
        rows.push({
          type: "phase",
          label: phase.label,
          order: rows.length,
          visible: true,
          style: "bold",
          sourceCategoryId: null,
          sourceCategoryLabel: null,
          sourcePhaseId: phase.id,
          sourceAdjustmentId: null,
        } satisfies SummaryRowTemplate);

        const phaseCategories = nonZeroPhaseCategories
          .filter((entry) => entry.phaseId === phase.id)
          .sort((left, right) => left.label.localeCompare(right.label));

        for (const category of phaseCategories) {
          rows.push({
            type: "category",
            label: category.label,
            order: rows.length,
            visible: true,
            style: "indent",
	            sourceCategoryId: category.categoryId ?? categoryIdForName(category.label),
            sourceCategoryLabel: category.label,
            sourcePhaseId: phase.id,
            sourceAdjustmentId: null,
          } satisfies SummaryRowTemplate);
        }
      }

      if (visibleAdjustments.length > 0) {
        rows.push({
          type: "separator",
          label: "",
          order: rows.length,
          visible: true,
          style: "normal",
          sourceCategoryId: null,
          sourceCategoryLabel: null,
          sourcePhaseId: null,
          sourceAdjustmentId: null,
        } satisfies SummaryRowTemplate);
        rows.push(...adjustmentRows(rows.length));
      }

      rows.push({
        type: "subtotal",
        label: "Grand Total",
        order: rows.length,
        visible: true,
        style: "bold",
        sourceCategoryId: null,
        sourceCategoryLabel: null,
        sourcePhaseId: null,
        sourceAdjustmentId: null,
      } satisfies SummaryRowTemplate);
      return rows;
    }

    case "custom":
    default:
      return [];
  }
}

export function summarizeProjectTotals(store: BidwrightStore, projectId: string, summaryBuilder?: Partial<SummaryBuilderConfig> | null) {
  const project = store.projects.find((entry) => entry.id === projectId);
  const quote = project ? getQuoteByProjectId(store, project.id) : undefined;
  const revision = quote ? getCurrentRevision(store, quote.id) : undefined;
  if (!project || !quote || !revision) {
    return null;
  }

  const worksheets = getWorksheets(store, revision.id);
  const phases = store.phases.filter((phase) => phase.revisionId === revision.id);
  const estimateFactors = (store.estimateFactors ?? []).filter((factor) => factor.revisionId === revision.id);
  const adjustments = store.adjustments.filter((adjustment) => adjustment.revisionId === revision.id);
  const revisionSchedules = getRevisionRateSchedules(store, revision.id);

  return calculateTotals(
    revision,
    worksheets,
    phases,
    adjustments,
    revisionSchedules,
    store.entityCategories ?? [],
    summaryBuilder,
    estimateFactors,
  );
}

export function updateWorksheetItem(
  store: BidwrightStore,
  itemId: string,
  patch: Partial<WorksheetItem>,
) {
  const nextItems = store.worksheetItems.map((item) =>
    item.id === itemId
	      ? {
	          ...item,
	          ...patch,
	          categoryId: patch.categoryId ?? item.categoryId,
	          category: patch.category ? normalizeCategoryName(patch.category) : item.category,
	        }
      : item,
  );

  return {
    ...store,
    worksheetItems: nextItems,
  };
}
