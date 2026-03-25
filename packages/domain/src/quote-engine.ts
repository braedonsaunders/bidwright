import type {
  AdditionalLineItem,
  BidwrightStore,
  BreakoutEntry,
  Modifier,
  ProjectWorkspace,
  QuoteRevision,
  RevisionTotals,
  SummaryRow,
  SummaryPreset,
  SummaryRowType,
  Worksheet,
  WorksheetItem
} from "./models.js";

const directCostCategories = new Set([
  "Material",
  "Materials",
  "Rental Equipment",
  "Travel & Per Diem",
  "Subcontractors"
]);

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeCategoryName(value: string) {
  if (value === "Materials") {
    return "Material";
  }

  return value;
}

function normalizeModifierTarget(appliesTo: string) {
  switch (appliesTo) {
    case "LaborClass":
      return "Labour";
    case "EquipmentRate":
      return "Equipment";
    case "Material":
    case "Materials":
      return "Material";
    default:
      return appliesTo;
  }
}

function getCurrentRevision(store: BidwrightStore, quoteId: string) {
  return [...store.revisions]
    .filter((revision) => revision.quoteId === quoteId)
    .sort((left, right) => right.revisionNumber - left.revisionNumber)[0];
}

function getQuoteByProjectId(store: BidwrightStore, projectId: string) {
  return store.quotes.find((quote) => quote.projectId === projectId);
}

function computeItemCost(item: WorksheetItem) {
  const category = normalizeCategoryName(item.category);

  if (directCostCategories.has(category)) {
    return item.quantity * item.cost;
  }

  return item.cost;
}

function computeItemHours(item: WorksheetItem) {
  const category = normalizeCategoryName(item.category);

  if (category !== "Labour") {
    return {
      unit1: 0,
      unit2: 0,
      unit3: 0,
      tierUnits: {} as Record<string, number>,
    };
  }

  // If item has tierUnits set (rate-schedule-driven), aggregate those
  const tierUnits: Record<string, number> = {};
  if (item.tierUnits && Object.keys(item.tierUnits).length > 0) {
    for (const [tierId, hours] of Object.entries(item.tierUnits)) {
      tierUnits[tierId] = (Number(hours) || 0) * item.quantity;
    }
  }

  return {
    unit1: item.unit1 * item.quantity,
    unit2: item.unit2 * item.quantity,
    unit3: item.unit3 * item.quantity,
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
    margin
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
      items: getWorksheetItems(store, worksheet.id)
    }));
}

function getCatalogs(store: BidwrightStore, projectId: string) {
  return store.catalogs
    .filter((catalog) => catalog.scope === "global" || catalog.projectId === projectId)
    .map((catalog) => ({
      ...catalog,
      items: store.catalogItems.filter((item) => item.catalogId === catalog.id)
    }));
}

function groupItemsForBreakout(
  breakoutStyle: QuoteRevision["breakoutStyle"],
  worksheets: Array<Worksheet & { items: WorksheetItem[] }>,
  phases: BidwrightStore["phases"],
  lineItems: WorksheetItem[],
  phaseWorksheetEnabled: boolean
) {
  if (breakoutStyle === "labour_material_equipment") {
    return [
      {
        key: "Labour",
        name: "Labour",
        items: lineItems.filter((item) => normalizeCategoryName(item.category) === "Labour")
      },
      {
        key: "Materials",
        name: "Materials",
        items: lineItems.filter((item) => {
          const category = normalizeCategoryName(item.category);
          return !["Labour", "Equipment", "Rental Equipment"].includes(category);
        })
      },
      {
        key: "Equipment",
        name: "Equipment",
        items: lineItems.filter((item) => {
          const category = normalizeCategoryName(item.category);
          return ["Equipment", "Rental Equipment"].includes(category);
        })
      }
    ];
  }

  if (breakoutStyle === "grand_total") {
    return [
      {
        key: "Total",
        name: "Total",
        items: lineItems
      }
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
      }, new Map<string, WorksheetItem[]>())
    ).map(([name, items]) => ({
      key: name,
      name,
      items
    }));
  }

  const groupSource = phaseWorksheetEnabled
    ? worksheets.map((worksheet) => ({
        key: worksheet.id,
        name: worksheet.name,
        items: worksheet.items
      }))
    : phases.map((phase) => ({
        key: phase.id,
        name: phase.name,
        items: lineItems.filter((item) => item.phaseId === phase.id)
      }));

  return groupSource;
}

function distributeHiddenModifier(
  breakout: BreakoutEntry[],
  modifierAmount: number,
  appliesTo: string,
  lineItems: WorksheetItem[],
  breakoutStyle: QuoteRevision["breakoutStyle"],
  phaseWorksheetEnabled: boolean
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
      return {
        ...entry,
        value: roundMoney(entry.value + modifierAmount),
        margin: entry.value + modifierAmount === 0 ? 0 : roundMoney((entry.value + modifierAmount - entry.cost) / (entry.value + modifierAmount))
      };
    }

    if (breakoutStyle === "category") {
      if (appliesTo !== "All" && entry.name !== appliesTo) {
        return entry;
      }
      const scopedBase =
        appliesTo === "All"
          ? lineItems.reduce((sum, item) => sum + item.price, 0)
          : targetedItems.reduce((sum, item) => sum + item.price, 0);
      const entryBase =
        appliesTo === "All"
          ? lineItems
              .filter((item) => normalizeCategoryName(item.category) === entry.name)
              .reduce((sum, item) => sum + item.price, 0)
          : targetedItems.reduce((sum, item) => sum + item.price, 0);
      const delta = scopedBase === 0 ? 0 : modifierAmount * (entryBase / scopedBase);
      const nextValue = roundMoney(entry.value + delta);
      return {
        ...entry,
        value: nextValue,
        margin: nextValue === 0 ? 0 : roundMoney((nextValue - entry.cost) / nextValue)
      };
    }

    const scopedItems = phaseWorksheetEnabled
      ? lineItems.filter((item) => item.worksheetId === entry.entityId)
      : lineItems.filter((item) => item.phaseId === entry.entityId);
    const phaseScoped = appliesTo === "All"
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
          phaseBase === 0
            ? 0
            : phaseScoped
                .filter((item) => normalizeCategoryName(item.category) === categoryEntry.name)
                .reduce((sum, item) => sum + item.price, 0);
        const categoryDelta = phaseBase === 0 ? 0 : delta * (categoryBase / phaseBase);
        const categoryValue = roundMoney(categoryEntry.value + categoryDelta);

        return {
          ...categoryEntry,
          value: categoryValue,
          margin: categoryValue === 0 ? 0 : roundMoney((categoryValue - categoryEntry.cost) / categoryValue)
        };
      })
    };
  });
}

export function calculateTotals(
  revision: QuoteRevision,
  worksheets: Array<Worksheet & { items: WorksheetItem[] }>,
  phases: BidwrightStore["phases"],
  modifiers: Modifier[],
  additionalLineItems: AdditionalLineItem[] = []
): RevisionTotals {
  const lineItems = worksheets.flatMap((worksheet) => worksheet.items);

  let subtotal = roundMoney(lineItems.reduce((sum, item) => sum + item.price, 0));
  const cost = roundMoney(lineItems.reduce((sum, item) => sum + computeItemCost(item), 0));

  const categoryTotalsMap = lineItems.reduce((map, item) => {
    const name = normalizeCategoryName(item.category);
    map.set(name, roundMoney((map.get(name) ?? 0) + item.price));
    return map;
  }, new Map<string, number>());

  let categoryTotals = Array.from(categoryTotalsMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => left.name.localeCompare(right.name));

  let breakout: BreakoutEntry[] = groupItemsForBreakout(
    revision.breakoutStyle,
    worksheets,
    phases,
    lineItems,
    revision.phaseWorksheetEnabled ?? false
  )
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
                }, new Map<string, WorksheetItem[]>())
              )
                .map(([name, items]) => {
                  const nested = computeAggregates(items);
                  return {
                    name,
                    value: nested.value,
                    cost: nested.cost,
                    margin: nested.margin
                  };
                })
                .sort((left, right) => left.name.localeCompare(right.name))
            : undefined
      } satisfies BreakoutEntry;
    });

  let shownModifierTotal = 0;

  for (const modifier of modifiers) {
    const target = normalizeModifierTarget(modifier.appliesTo);
    const applicableItems =
      target === "All"
        ? lineItems
        : lineItems.filter((item) => normalizeCategoryName(item.category) === target);
    const applicableBase = applicableItems.reduce((sum, item) => sum + item.price, 0);

    if (applicableBase === 0 && !modifier.amount) {
      continue;
    }

    const modifierAmount = roundMoney((modifier.amount ?? 0) + applicableBase * (modifier.percentage ?? 0));
    subtotal = roundMoney(subtotal + modifierAmount);

    if (modifier.show === "No") {
      breakout = distributeHiddenModifier(
        breakout,
        modifierAmount,
        target,
        lineItems,
        revision.breakoutStyle,
        revision.phaseWorksheetEnabled ?? false
      );

      categoryTotals = categoryTotals.map((entry) => {
        if (target !== "All" && entry.name !== target) {
          return entry;
        }

        const base =
          target === "All"
            ? lineItems.reduce((sum, item) => sum + item.price, 0)
            : applicableItems.reduce((sum, item) => sum + item.price, 0);
        const entryBase =
          target === "All"
            ? lineItems
                .filter((item) => normalizeCategoryName(item.category) === entry.name)
                .reduce((sum, item) => sum + item.price, 0)
            : applicableBase;
        const delta = base === 0 ? 0 : modifierAmount * (entryBase / base);

        return {
          ...entry,
          value: roundMoney(entry.value + delta)
        };
      });
    } else {
      shownModifierTotal = roundMoney(shownModifierTotal + modifierAmount);
      breakout.push({
        name: modifier.name,
        value: modifierAmount,
        cost: 0,
        margin: modifierAmount === 0 ? 0 : 1,
        type: "Modifier"
      });
    }
  }

  let breakoutOverride: BreakoutEntry[] | null = null;

  const optionStandalone: BreakoutEntry[] = [];
  const lineItemStandalone: BreakoutEntry[] = [];

  for (const item of additionalLineItems) {
    const baseEntry: BreakoutEntry = {
      name: item.name,
      value: item.amount,
      cost: 0,
      margin: item.amount === 0 ? 0 : 1,
      type: item.type
    };

    switch (item.type) {
      case "OptionStandalone":
        if (optionStandalone.length === 0) {
          subtotal = item.amount;
        }
        optionStandalone.push(baseEntry);
        break;
      case "OptionAdditional":
        breakout.push(baseEntry);
        break;
      case "LineItemAdditional":
        subtotal = roundMoney(subtotal + item.amount);
        breakout.push(baseEntry);
        shownModifierTotal = roundMoney(shownModifierTotal + item.amount);
        break;
      case "LineItemStandalone":
        lineItemStandalone.push(baseEntry);
        break;
      case "CustomTotal":
        subtotal = item.amount;
        breakoutOverride = [
          {
            ...baseEntry,
            cost,
            margin: item.amount === 0 ? 0 : roundMoney((item.amount - cost) / item.amount)
          }
        ];
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

  const allItemHours = lineItems.map((item) => computeItemHours(item));
  const regHours = roundMoney(allItemHours.reduce((sum, h) => sum + h.unit1, 0));
  const overHours = roundMoney(allItemHours.reduce((sum, h) => sum + h.unit2, 0));
  const doubleHours = roundMoney(allItemHours.reduce((sum, h) => sum + h.unit3, 0));
  const totalHours = roundMoney(regHours + overHours + doubleHours);

  // Aggregate tier hours across all items
  const tierUnitTotals: Record<string, number> = {};
  for (const h of allItemHours) {
    if (h.tierUnits) {
      for (const [tierId, hours] of Object.entries(h.tierUnits)) {
        tierUnitTotals[tierId] = roundMoney((tierUnitTotals[tierId] ?? 0) + hours);
      }
    }
  }
  const estimatedProfit = roundMoney(subtotal - cost);
  const estimatedMargin = subtotal === 0 ? 0 : roundMoney(estimatedProfit / subtotal);
  const calculatedTotal = roundMoney(categoryTotals.reduce((sum, entry) => sum + entry.value, 0) + shownModifierTotal);

  return {
    subtotal,
    cost,
    estimatedProfit,
    estimatedMargin,
    calculatedTotal,
    regHours,
    overHours,
    doubleHours,
    totalHours,
    categoryTotals,
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
        margin: roundMoney(nested.margin)
      }))
    }))
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
            currentRevisionId: quote.currentRevisionId
          }
        : null,
      latestRevision: revision
        ? {
            id: revision.id,
            revisionNumber: revision.revisionNumber,
            subtotal: revision.subtotal,
            estimatedProfit: revision.estimatedProfit,
            estimatedMargin: revision.estimatedMargin
          }
        : null
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
    aiRunCount: store.aiRuns.filter((run) => run.projectId === projectId).length
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
  const modifiers = store.modifiers.filter((modifier) => modifier.revisionId === revision.id);
  const additionalLineItems = store.additionalLineItems.filter((item) => item.revisionId === revision.id);
  const summaryRows = (store.summaryRows ?? [])
    .filter((row) => row.revisionId === revision.id)
    .sort((a, b) => a.order - b.order);
  const totals = calculateTotals(revision, worksheets, phases, modifiers, additionalLineItems);
  const lineItems = worksheets.flatMap((worksheet) => worksheet.items);

  // Compute summary row values
  const computedSummaryRows = summaryRows.length > 0
    ? computeSummaryRows(summaryRows, worksheets, phases)
    : summaryRows;

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
      totalHours: totals.totalHours
    },
    worksheets,
    phases,
    modifiers,
    additionalLineItems,
    summaryRows: computedSummaryRows,
    conditions: store.conditions.filter((condition) => condition.revisionId === revision.id),
    catalogs: getCatalogs(store, projectId),
    aiRuns,
    citations,
    scheduleTasks: (store.scheduleTasks || []).filter((t) => t.projectId === projectId && t.revisionId === revision.id),
    scheduleDependencies: (store.scheduleDependencies || []).filter((d) => {
      const taskIds = new Set((store.scheduleTasks || []).filter((t) => t.projectId === projectId && t.revisionId === revision.id).map((t) => t.id));
      return taskIds.has(d.predecessorId) || taskIds.has(d.successorId);
    }),
    estimate: {
      revisionId: revision.id,
      totals,
      lineItems,
      summary: {
        sourceDocumentCount: store.sourceDocuments.filter((document) => document.projectId === projectId).length,
        worksheetCount: worksheets.length,
        lineItemCount: lineItems.length,
        citationCount: citations.length,
        aiRunCount: aiRuns.length
      }
    }
  };
}

// ── Summary Row System ────────────────────────────────────────────────────

/**
 * Compute values for all summary rows based on line item aggregations.
 * Mutates computedValue/computedCost/computedMargin on each row (in-place).
 */
export function computeSummaryRows(
  rows: SummaryRow[],
  worksheets: Array<Worksheet & { items: WorksheetItem[] }>,
  phases: Array<{ id: string; name: string }>,
): SummaryRow[] {
  const lineItems = worksheets.flatMap((w) => w.items);

  // Build per-category aggregation
  const categoryAgg = new Map<string, { value: number; cost: number }>();
  for (const item of lineItems) {
    const cat = normalizeCategoryName(item.category);
    const existing = categoryAgg.get(cat) ?? { value: 0, cost: 0 };
    existing.value += item.price;
    existing.cost += computeItemCost(item);
    categoryAgg.set(cat, existing);
  }

  // Build per-phase aggregation
  const phaseAgg = new Map<string, { value: number; cost: number }>();
  for (const item of lineItems) {
    const key = item.phaseId ?? "__unphased__";
    const existing = phaseAgg.get(key) ?? { value: 0, cost: 0 };
    existing.value += item.price;
    existing.cost += computeItemCost(item);
    phaseAgg.set(key, existing);
  }

  // Map phase name → phase ID for lookup
  const phaseNameToId = new Map(phases.map((p) => [p.name, p.id]));

  // First pass: compute non-modifier rows
  const computed = rows.map((row) => ({ ...row }));
  const rowById = new Map(computed.map((r) => [r.id, r]));

  for (const row of computed) {
    switch (row.type) {
      case "auto_category": {
        const agg = categoryAgg.get(row.sourceCategory ?? "") ?? { value: 0, cost: 0 };
        // Override takes precedence over aggregation when set
        row.computedValue = roundMoney(row.overrideValue ?? agg.value);
        row.computedCost = roundMoney(row.overrideCost ?? agg.cost);
        row.computedMargin = row.computedValue === 0 ? 0 : roundMoney((row.computedValue - row.computedCost) / row.computedValue);
        break;
      }
      case "auto_phase": {
        const phaseId = phaseNameToId.get(row.sourcePhase ?? "");
        const agg = phaseAgg.get(phaseId ?? "") ?? { value: 0, cost: 0 };
        row.computedValue = roundMoney(row.overrideValue ?? agg.value);
        row.computedCost = roundMoney(row.overrideCost ?? agg.cost);
        row.computedMargin = row.computedValue === 0 ? 0 : roundMoney((row.computedValue - row.computedCost) / row.computedValue);
        break;
      }
      case "manual": {
        row.computedValue = roundMoney(row.manualValue ?? 0);
        row.computedCost = roundMoney(row.manualCost ?? 0);
        row.computedMargin = row.computedValue === 0 ? 0 : roundMoney((row.computedValue - row.computedCost) / row.computedValue);
        break;
      }
      case "subtotal": {
        // Sum all preceding visible non-modifier, non-subtotal, non-separator rows
        let sumValue = 0;
        let sumCost = 0;
        for (const prev of computed) {
          if (prev.id === row.id) break;
          if (!prev.visible) continue;
          if (prev.type === "subtotal" || prev.type === "separator") continue;
          sumValue += prev.computedValue;
          sumCost += prev.computedCost;
        }
        row.computedValue = roundMoney(sumValue);
        row.computedCost = roundMoney(sumCost);
        row.computedMargin = row.computedValue === 0 ? 0 : roundMoney((row.computedValue - row.computedCost) / row.computedValue);
        break;
      }
      case "separator": {
        row.computedValue = 0;
        row.computedCost = 0;
        row.computedMargin = 0;
        break;
      }
      // modifier handled in second pass
    }
  }

  // Second pass: compute modifier rows (they reference other rows)
  for (const row of computed) {
    if (row.type !== "modifier") continue;

    const targets = row.appliesTo;
    let baseValue = 0;

    if (targets.length === 0 || (targets.length === 1 && targets[0] === "all")) {
      // Apply to all non-modifier visible rows
      for (const other of computed) {
        if (other.id === row.id) continue;
        if (other.type === "modifier" || other.type === "separator" || other.type === "subtotal") continue;
        if (!other.visible) continue;
        baseValue += other.computedValue;
      }
    } else {
      // Apply to specific rows by ID
      for (const targetId of targets) {
        const target = rowById.get(targetId);
        if (target && target.id !== row.id) {
          baseValue += target.computedValue;
        }
      }
    }

    row.computedValue = roundMoney((row.modifierAmount ?? 0) + baseValue * ((row.modifierPercent ?? 0) / 100));
    row.computedCost = 0;
    row.computedMargin = row.computedValue === 0 ? 0 : 1;
  }

  return computed;
}

/**
 * Generate a default set of SummaryRow records for a given preset.
 * Returns unsaved row objects (no IDs) — caller should persist them.
 */
export function generateSummaryPreset(
  preset: SummaryPreset,
  categoryNames: string[],
  phaseNames: string[],
): Array<Omit<SummaryRow, "id" | "revisionId" | "computedValue" | "computedCost" | "computedMargin">> {
  switch (preset) {
    case "quick_total":
      return [
        { type: "subtotal", label: "Grand Total", order: 0, visible: true, style: "bold", appliesTo: [] },
      ];

    case "by_category":
      return [
        ...categoryNames.map((name, i) => ({
          type: "auto_category" as SummaryRowType,
          label: name,
          order: i,
          visible: true,
          style: "normal" as const,
          sourceCategory: name,
          appliesTo: [] as string[],
        })),
        { type: "subtotal" as SummaryRowType, label: "Subtotal", order: categoryNames.length, visible: true, style: "bold" as const, appliesTo: [] },
      ];

    case "by_phase":
      return [
        ...phaseNames.map((name, i) => ({
          type: "auto_phase" as SummaryRowType,
          label: name,
          order: i,
          visible: true,
          style: "normal" as const,
          sourcePhase: name,
          appliesTo: [] as string[],
        })),
        { type: "subtotal" as SummaryRowType, label: "Subtotal", order: phaseNames.length, visible: true, style: "bold" as const, appliesTo: [] },
      ];

    case "phase_x_category":
      // Each phase with category detail — flat list
      const rows: Array<Omit<SummaryRow, "id" | "revisionId" | "computedValue" | "computedCost" | "computedMargin">> = [];
      let order = 0;
      for (const phase of phaseNames) {
        rows.push({
          type: "auto_phase",
          label: phase,
          order: order++,
          visible: true,
          style: "bold",
          sourcePhase: phase,
          appliesTo: [],
        });
      }
      rows.push({
        type: "subtotal",
        label: "Subtotal",
        order: order,
        visible: true,
        style: "bold",
        appliesTo: [],
      });
      return rows;

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
  const modifiers = store.modifiers.filter((modifier) => modifier.revisionId === revision.id);
  const additionalLineItems = store.additionalLineItems.filter((item) => item.revisionId === revision.id);

  return calculateTotals(revision, worksheets, phases, modifiers, additionalLineItems);
}

export function updateWorksheetItem(
  store: BidwrightStore,
  itemId: string,
  patch: Partial<WorksheetItem>
) {
  const nextItems = store.worksheetItems.map((item) =>
    item.id === itemId
      ? {
          ...item,
          ...patch,
          category: patch.category ? normalizeCategoryName(patch.category) : item.category
        }
      : item
  );

  return {
    ...store,
    worksheetItems: nextItems
  };
}
