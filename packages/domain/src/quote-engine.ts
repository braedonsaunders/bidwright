import type {
  AdditionalLineItem,
  BidwrightStore,
  BreakoutEntry,
  Modifier,
  ProjectWorkspace,
  QuoteRevision,
  RevisionTotals,
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
      reg: 0,
      over: 0,
      double: 0
    };
  }

  return {
    reg: item.laborHourReg * item.quantity,
    over: item.laborHourOver * item.quantity,
    double: item.laborHourDouble * item.quantity
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

  const regHours = roundMoney(lineItems.reduce((sum, item) => sum + computeItemHours(item).reg, 0));
  const overHours = roundMoney(lineItems.reduce((sum, item) => sum + computeItemHours(item).over, 0));
  const doubleHours = roundMoney(lineItems.reduce((sum, item) => sum + computeItemHours(item).double, 0));
  const totalHours = roundMoney(regHours + overHours + doubleHours);
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
  const totals = calculateTotals(revision, worksheets, phases, modifiers, additionalLineItems);
  const lineItems = worksheets.flatMap((worksheet) => worksheet.items);

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
    conditions: store.conditions.filter((condition) => condition.revisionId === revision.id),
    catalogs: getCatalogs(store, projectId),
    aiRuns,
    citations,
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
