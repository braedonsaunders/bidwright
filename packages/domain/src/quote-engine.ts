import type {
  Adjustment,
  AdjustmentPricingMode,
  AdditionalLineItem,
  BidwrightStore,
  BreakoutEntry,
  ProjectWorkspace,
  QuoteRevision,
  RevisionTotals,
  SourceTotalEntry,
  SummaryRow,
  SummaryPreset,
  SummaryRowType,
  Worksheet,
  WorksheetItem,
} from "./models";
import { buildSummaryBuilderConfig, materializeSummaryRowsFromBuilder } from "./summary-builder";
import { getExtendedWorksheetHourBreakdown, type WorksheetHourRateScheduleLike } from "./worksheet-hours";


const standalonePricingModes = new Set<AdjustmentPricingMode>([
  "option_standalone",
  "line_item_standalone",
  "custom_total",
]);

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
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

function normalizeModifierTarget(appliesTo: string) {
  switch (appliesTo) {
    case "LaborClass":
    case "Labor":
      return "Labour";
    case "EquipmentRate":
      return "Equipment";
    case "Material":
    case "Materials":
      return "Material";
    case "Subcontractor":
      return "Subcontractors";
    default:
      return appliesTo;
  }
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
  return [...store.revisions]
    .filter((revision) => revision.quoteId === quoteId)
    .sort((left, right) => right.revisionNumber - left.revisionNumber)[0];
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

function computeItemHours(item: WorksheetItem, schedules: WorksheetHourRateScheduleLike[]) {
  const category = normalizeCategoryName(item.category, item.entityType);

  if (category !== "Labour") {
    return {
      unit1: 0,
      unit2: 0,
      unit3: 0,
      tierUnits: {} as Record<string, number>,
    };
  }

  const tierUnits: Record<string, number> = {};
  if (item.tierUnits && Object.keys(item.tierUnits).length > 0) {
    for (const [tierId, hours] of Object.entries(item.tierUnits)) {
      tierUnits[tierId] = roundMoney((Number(hours) || 0) * item.quantity);
    }
  }

  const derivedHours = getExtendedWorksheetHourBreakdown(item, schedules, item.quantity);

  return {
    unit1: derivedHours.unit1,
    unit2: derivedHours.unit2,
    unit3: derivedHours.unit3,
    tierUnits,
  };
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
) {
  if (breakoutStyle === "labour_material_equipment") {
    return [
      {
        key: "Labour",
        name: "Labour",
        items: lineItems.filter((item) => normalizeCategoryName(item.category) === "Labour"),
      },
      {
        key: "Materials",
        name: "Materials",
        items: lineItems.filter((item) => {
          const category = normalizeCategoryName(item.category);
          return !["Labour", "Equipment", "Rental Equipment"].includes(category);
        }),
      },
      {
        key: "Equipment",
        name: "Equipment",
        items: lineItems.filter((item) => {
          const category = normalizeCategoryName(item.category);
          return ["Equipment", "Rental Equipment"].includes(category);
        }),
      },
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
        const name = normalizeCategoryName(item.category);
        const list = map.get(name) ?? [];
        list.push(item);
        map.set(name, list);
        return map;
      }, new Map<string, WorksheetItem[]>()),
    ).map(([name, items]) => ({
      key: categoryIdForName(name),
      name,
      items,
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

function distributeHiddenAdjustment(
  breakout: BreakoutEntry[],
  modifierAmount: number,
  appliesTo: string,
  lineItems: WorksheetItem[],
  breakoutStyle: QuoteRevision["breakoutStyle"],
) {
  if (modifierAmount === 0) {
    return breakout;
  }

  const targetedItems =
    appliesTo === "All"
      ? lineItems
      : lineItems.filter((item) => normalizeCategoryName(item.category) === appliesTo);
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
              .filter((item) => normalizeCategoryName(item.category) === entry.name)
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
        : scopedItems.filter((item) => normalizeCategoryName(item.category) === appliesTo);
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
                .filter((item) => normalizeCategoryName(item.category) === categoryEntry.name)
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
) {
  if (amount === 0) {
    return;
  }

  const targetedItems =
    targetCategory === "All"
      ? lineItems
      : lineItems.filter((item) => normalizeCategoryName(item.category) === targetCategory);
  const targetBase = targetedItems.reduce((sum, item) => sum + item.price, 0);

  if (targetBase === 0) {
    return;
  }

  if (targetCategory === "All") {
    for (const entry of categoryTotals.values()) {
      const categoryBase = lineItems
        .filter((item) => categoryIdForName(item.category) === entry.id)
        .reduce((sum, item) => sum + item.price, 0);
      entry.value += amount * (categoryBase / targetBase);
    }
  } else {
    const targetEntry = categoryTotals.get(categoryIdForName(targetCategory));
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
        .filter((item) => buildPhaseCategoryKey(item.phaseId, categoryIdForName(item.category)) === entry.id)
        .reduce((sum, item) => sum + item.price, 0);
      entry.value += amount * (phaseBase / targetBase);
    }
  } else {
    const targetCategoryId = categoryIdForName(targetCategory);
    for (const entry of phaseCategoryTotals.values()) {
      if (!entry.id.endsWith(`::${targetCategoryId}`)) {
        continue;
      }
      const phaseScoped = targetedItems.filter(
        (item) => buildPhaseCategoryKey(item.phaseId, categoryIdForName(item.category)) === entry.id,
      );
      const phaseBase = phaseScoped.reduce((sum, item) => sum + item.price, 0);
      if (phaseBase === 0) {
        continue;
      }
      entry.value += amount * (phaseBase / targetBase);
    }
  }
}

function calculateModifierAmount(adjustment: Adjustment, lineItems: WorksheetItem[]) {
  const target = normalizeModifierTarget(adjustment.appliesTo);
  const applicableItems =
    target === "All"
      ? lineItems
      : lineItems.filter((item) => normalizeCategoryName(item.category) === target);
  const applicableBase = applicableItems.reduce((sum, item) => sum + item.price, 0);

  if (applicableBase === 0 && !adjustment.amount) {
    return {
      target,
      applicableBase,
      value: 0,
    };
  }

  return {
    target,
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
) {
  const phaseNameById = new Map(phases.map((phase) => [phase.id, phase.name]));
  const categoryTotals = new Map<string, SourceTotalEntry>();
  const phaseTotals = new Map<string, SourceTotalEntry>();
  const phaseCategoryTotals = new Map<string, SourceTotalEntry>();

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
    const categoryLabel = normalizeCategoryName(item.category);
    const categoryId = categoryIdForName(categoryLabel);
    const phaseId = item.phaseId ?? "__unphased__";
    const phaseLabel = getPhaseLabel(item.phaseId, phaseNameById);

    const categoryEntry = categoryTotals.get(categoryId) ?? createSourceEntry(categoryId, categoryLabel);
    categoryEntry.value += item.price;
    categoryEntry.cost += computeItemCost(item);
    categoryTotals.set(categoryId, categoryEntry);

    const phaseEntry =
      phaseTotals.get(phaseId) ??
      {
        ...createSourceEntry(phaseId, phaseLabel),
        phaseId,
        phaseLabel,
      };
    phaseEntry.value += item.price;
    phaseEntry.cost += computeItemCost(item);
    phaseTotals.set(phaseId, phaseEntry);

    const phaseCategoryKey = buildPhaseCategoryKey(phaseId, categoryId);
    const phaseCategoryEntry =
      phaseCategoryTotals.get(phaseCategoryKey) ??
      {
        ...createSourceEntry(phaseCategoryKey, categoryLabel),
        phaseId,
        phaseLabel,
      };
    phaseCategoryEntry.value += item.price;
    phaseCategoryEntry.cost += computeItemCost(item);
    phaseCategoryTotals.set(phaseCategoryKey, phaseCategoryEntry);
  }

  updateSourceMargins(categoryTotals.values());
  updateSourceMargins(phaseTotals.values());
  updateSourceMargins(phaseCategoryTotals.values());

  return {
    categoryTotals,
    phaseTotals,
    phaseCategoryTotals,
  };
}

export function calculateTotals(
  revision: QuoteRevision,
  worksheets: Array<Worksheet & { items: WorksheetItem[] }>,
  phases: BidwrightStore["phases"],
  adjustments: Adjustment[],
  revisionSchedules: WorksheetHourRateScheduleLike[] = [],
): RevisionTotals {
  const lineItems = worksheets.flatMap((worksheet) => worksheet.items);
  const {
    categoryTotals: categoryTotalsMap,
    phaseTotals: phaseTotalsMap,
    phaseCategoryTotals: phaseCategoryTotalsMap,
  } = buildSourceTotals(lineItems, phases);

  let subtotal = roundMoney(lineItems.reduce((sum, item) => sum + item.price, 0));
  const cost = roundMoney(lineItems.reduce((sum, item) => sum + computeItemCost(item), 0));

  let breakout: BreakoutEntry[] = groupItemsForBreakout(revision.breakoutStyle, lineItems, phases)
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
                  const name = normalizeCategoryName(item.category);
                  const list = map.get(name) ?? [];
                  list.push(item);
                  map.set(name, list);
                  return map;
                }, new Map<string, WorksheetItem[]>()),
              )
                .map(([name, items]) => {
                  const nested = computeAggregates(items);
                  return {
                    name,
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
    if (adjustment.pricingMode === "modifier") {
      const { target, value } = calculateModifierAmount(adjustment, lineItems);
      if (value === 0 && !adjustment.amount && !adjustment.percentage) {
        continue;
      }

      subtotal = roundMoney(subtotal + value);
      adjustmentTotals.push({
        id: adjustment.id,
        label: adjustment.name,
        kind: adjustment.kind,
        pricingMode: adjustment.pricingMode,
        type: adjustment.type,
        appliesTo: target,
        show: adjustment.show,
        affectsSubtotal: affectsSubtotal(adjustment),
        value,
        cost: 0,
        margin: value === 0 ? 0 : 1,
      });

      if (adjustment.show === "No") {
        applyHiddenAdjustmentToAggregates(
          value,
          target,
          lineItems,
          categoryTotalsMap,
          phaseTotalsMap,
          phaseCategoryTotalsMap,
        );
        breakout = distributeHiddenAdjustment(breakout, value, target, lineItems, revision.breakoutStyle);
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

    const amount = roundMoney(adjustment.amount ?? 0);
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
      appliesTo: adjustment.appliesTo,
      show: adjustment.show,
      affectsSubtotal: affectsSubtotal(adjustment),
      value: amount,
      cost: 0,
      margin: amount === 0 ? 0 : 1,
    });

    switch (adjustment.pricingMode) {
      case "option_standalone":
        if (optionStandalone.length === 0) {
          subtotal = amount;
        }
        optionStandalone.push(baseEntry);
        break;
      case "option_additional":
        breakout.push(baseEntry);
        break;
      case "line_item_additional":
        subtotal = roundMoney(subtotal + amount);
        breakout.push(baseEntry);
        break;
      case "line_item_standalone":
        lineItemStandalone.push(baseEntry);
        break;
      case "custom_total":
        subtotal = amount;
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

  const allItemHours = lineItems.map((item) => computeItemHours(item, revisionSchedules));
  const regHours = roundMoney(allItemHours.reduce((sum, hours) => sum + hours.unit1, 0));
  const overHours = roundMoney(allItemHours.reduce((sum, hours) => sum + hours.unit2, 0));
  const doubleHours = roundMoney(allItemHours.reduce((sum, hours) => sum + hours.unit3, 0));
  const totalHours = roundMoney(regHours + overHours + doubleHours);

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

  return {
    subtotal,
    cost,
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
    adjustmentTotals: adjustmentTotals.map((entry) => ({
      ...entry,
      value: roundMoney(entry.value),
      cost: roundMoney(entry.cost),
      margin: roundMoney(entry.margin),
    })),
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
  const aiRuns = store.aiRuns.filter((run) => run.projectId === projectId);
  const citations = store.citations.filter((citation) => citation.projectId === projectId);
  const phases = store.phases.filter((phase) => phase.revisionId === revision.id);
  const adjustments = store.adjustments
    .filter((adjustment) => adjustment.revisionId === revision.id)
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
  const totals = calculateTotals(revision, worksheets, phases, adjustments, revisionSchedules);
  const summaryBuilder = buildSummaryBuilderConfig(
    (revision.pdfPreferences as Record<string, unknown> | undefined)?.summaryBuilder as any,
    summaryRows,
    revision.summaryLayoutPreset,
    totals,
  );
  const lineItems = worksheets.flatMap((worksheet) => worksheet.items);
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
    currentRevision: {
      ...revision,
      subtotal: totals.subtotal,
      cost: totals.cost,
      estimatedProfit: totals.estimatedProfit,
      estimatedMargin: totals.estimatedMargin,
      calculatedTotal: totals.calculatedTotal,
      totalHours: totals.totalHours,
    },
    worksheets,
    phases,
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
    estimateStrategy,
    estimateFeedback,
    estimate: {
      revisionId: revision.id,
      totals,
      lineItems,
      summary: {
        sourceDocumentCount: store.sourceDocuments.filter((document) => document.projectId === projectId).length,
        worksheetCount: worksheets.length,
        lineItemCount: lineItems.length,
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

  if (row.type === "category" || row.type === "phase") {
    if (isStandaloneQuote(totals)) {
      return { value: 0, cost: 0 };
    }
    return { value: row.computedValue, cost: row.computedCost };
  }

  return { value: 0, cost: 0 };
}

export function computeSummaryRows(rows: SummaryRow[], totals: RevisionTotals): SummaryRow[] {
  const categoryTotals = new Map(totals.categoryTotals.map((entry) => [entry.id, entry]));
  const phaseTotals = new Map(totals.phaseTotals.map((entry) => [entry.id, entry]));
  const phaseCategoryTotals = new Map(totals.phaseCategoryTotals.map((entry) => [entry.id, entry]));
  const adjustmentTotals = new Map(totals.adjustmentTotals.map((entry) => [entry.id, entry]));
  const computed = rows.map((row) => ({ ...row }));

  for (const row of computed) {
    if (!row.visible) {
      row.computedValue = 0;
      row.computedCost = 0;
      row.computedMargin = 0;
      continue;
    }

    switch (row.type) {
      case "category": {
        const sourceEntry = row.sourcePhaseId
          ? phaseCategoryTotals.get(buildPhaseCategoryKey(row.sourcePhaseId, row.sourceCategoryId ?? ""))
          : categoryTotals.get(row.sourceCategoryId ?? "");
        row.computedValue = roundMoney(sourceEntry?.value ?? 0);
        row.computedCost = roundMoney(sourceEntry?.cost ?? 0);
        row.computedMargin = row.computedValue === 0 ? 0 : roundMoney((row.computedValue - row.computedCost) / row.computedValue);
        break;
      }
      case "phase": {
        const sourceEntry = phaseTotals.get(row.sourcePhaseId ?? "");
        row.computedValue = roundMoney(sourceEntry?.value ?? 0);
        row.computedCost = roundMoney(sourceEntry?.cost ?? 0);
        row.computedMargin = row.computedValue === 0 ? 0 : roundMoney((row.computedValue - row.computedCost) / row.computedValue);
        break;
      }
      case "adjustment": {
        const sourceEntry = adjustmentTotals.get(row.sourceAdjustmentId ?? "");
        row.computedValue = roundMoney(sourceEntry?.value ?? 0);
        row.computedCost = roundMoney(sourceEntry?.cost ?? 0);
        row.computedMargin = row.computedValue === 0 ? 0 : roundMoney((row.computedValue - row.computedCost) / row.computedValue);
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
            sourceCategoryId: categoryIdForName(category.label),
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

export function summarizeProjectTotals(store: BidwrightStore, projectId: string) {
  const project = store.projects.find((entry) => entry.id === projectId);
  const quote = project ? getQuoteByProjectId(store, project.id) : undefined;
  const revision = quote ? getCurrentRevision(store, quote.id) : undefined;
  if (!project || !quote || !revision) {
    return null;
  }

  const worksheets = getWorksheets(store, revision.id);
  const phases = store.phases.filter((phase) => phase.revisionId === revision.id);
  const adjustments = store.adjustments.filter((adjustment) => adjustment.revisionId === revision.id);
  const revisionSchedules = getRevisionRateSchedules(store, revision.id);

  return calculateTotals(revision, worksheets, phases, adjustments, revisionSchedules);
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
          category: patch.category ? normalizeCategoryName(patch.category) : item.category,
        }
      : item,
  );

  return {
    ...store,
    worksheetItems: nextItems,
  };
}
