import type { EstimateItem, Modifier, QuoteRevision } from "./types";

const directCostCategories = new Set([
  "Material",
  "Rental Equipment",
  "Travel & Per Diem",
  "Subcontractors"
]);

export function computeItemCost(item: EstimateItem): number {
  if (directCostCategories.has(item.category)) {
    return item.quantity * item.cost;
  }

  return item.cost;
}

export function summarizeRevisionFinancials(revision: QuoteRevision) {
  const allItems = revision.worksheets.flatMap((worksheet) => worksheet.items);
  const baseCost = allItems.reduce((sum, item) => sum + computeItemCost(item), 0);
  const baseSubtotal = allItems.reduce((sum, item) => sum + item.price, 0);

  const modifierDelta = revision.modifiers.reduce((sum, modifier) => {
    const applicableBase =
      modifier.appliesTo === "All"
        ? baseSubtotal
        : allItems
            .filter((item) => item.category === modifier.appliesTo)
            .reduce((acc, item) => acc + item.price, 0);

    return sum + (modifier.amount ?? 0) + applicableBase * (modifier.percentage ?? 0);
  }, 0);

  const subtotal = baseSubtotal + modifierDelta;
  const estimatedProfit = subtotal - baseCost;
  const estimatedMargin = subtotal === 0 ? 0 : estimatedProfit / subtotal;

  return {
    subtotal,
    cost: baseCost,
    estimatedProfit,
    estimatedMargin
  };
}
