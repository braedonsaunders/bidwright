import type { CalculationType, EntityCategory } from "@/lib/api";

type EditableFieldMap = EntityCategory["editableFields"];
type UnitLabelMap = EntityCategory["unitLabels"];

export type CategoryUnitMode = "none" | "tiered";

export interface CalculationTypeOption {
  value: CalculationType;
  label: string;
  description: string;
  unitMode: CategoryUnitMode;
  recommendedEditableFields: EditableFieldMap;
  recommendedUnitLabels: UnitLabelMap;
}

export const CALCULATION_TYPE_OPTIONS: CalculationTypeOption[] = [
  {
    value: "manual",
    label: "Manual Pricing",
    description:
      "Estimator edits cost, markup, and price directly. Best for flexible categories without an automatic pricing source.",
    unitMode: "none",
    recommendedEditableFields: { quantity: true, cost: true, markup: true, price: true, tierUnits: false },
    recommendedUnitLabels: {},
  },
  {
    value: "direct_total",
    label: "Direct Total",
    description: "Estimator enters the sell value directly. Cost and markup are derived or suppressed.",
    unitMode: "none",
    recommendedEditableFields: { quantity: false, cost: false, markup: false, price: true, tierUnits: false },
    recommendedUnitLabels: {},
  },
  {
    value: "formula",
    label: "Custom Formula",
    description:
      "Bidwright calculates the line from a custom formula using quantity, cost, markup, price, and per-tier hours.",
    unitMode: "tiered",
    recommendedEditableFields: { quantity: true, cost: true, markup: true, price: false, tierUnits: true },
    recommendedUnitLabels: {},
  },
  {
    value: "tiered_rate",
    label: "Tiered Rate Schedule",
    description:
      "Uses linked rate-schedule tiers. Hours are entered per tier in tierUnits.",
    unitMode: "tiered",
    recommendedEditableFields: { quantity: true, cost: false, markup: false, price: false, tierUnits: true },
    recommendedUnitLabels: {},
  },
  {
    value: "duration_rate",
    label: "Duration / Usage Pricing",
    description:
      "Uses linked rate-schedule tiers (DAY/WEEK/MONTH or similar). Duration counts entered per tier in tierUnits.",
    unitMode: "tiered",
    recommendedEditableFields: { quantity: true, cost: false, markup: false, price: false, tierUnits: true },
    recommendedUnitLabels: {},
  },
  {
    value: "quantity_markup",
    label: "Quantity x Cost + Markup",
    description: "Automatically extends quantity and cost, then applies markup for sell pricing.",
    unitMode: "none",
    recommendedEditableFields: { quantity: true, cost: true, markup: true, price: false, tierUnits: false },
    recommendedUnitLabels: {},
  },
  {
    value: "unit_markup",
    label: "Unit Cost + Markup",
    description: "Calculates sell value from quantity, unit cost, and markup while keeping pricing controlled.",
    unitMode: "none",
    recommendedEditableFields: { quantity: true, cost: true, markup: true, price: false, tierUnits: false },
    recommendedUnitLabels: {},
  },
];

const CALCULATION_TYPE_MAP = new Map(
  CALCULATION_TYPE_OPTIONS.map((option) => [option.value, option]),
);

export function getCalculationTypeOption(value: CalculationType | string | undefined) {
  if (value && CALCULATION_TYPE_MAP.has(value as CalculationType)) {
    return CALCULATION_TYPE_MAP.get(value as CalculationType)!;
  }
  return CALCULATION_TYPE_MAP.get("manual")!;
}

export function categoryUsesTieredUnits(category: Pick<EntityCategory, "calculationType" | "itemSource"> | undefined) {
  if (category?.itemSource === "rate_schedule") return true;
  return getCalculationTypeOption(category?.calculationType).unitMode === "tiered";
}

export function categoryAllowsEditingTierUnits(
  category: Pick<EntityCategory, "calculationType" | "editableFields" | "itemSource"> | undefined,
) {
  if (!category) return true;
  if (category.itemSource === "rate_schedule") return true;
  if (categoryUsesTieredUnits(category)) return true;
  return Boolean(category.editableFields?.tierUnits);
}

export function getTierLabel(
  category: Pick<EntityCategory, "unitLabels"> | undefined,
  tierId: string,
  fallback?: string,
) {
  const label = category?.unitLabels?.[tierId];
  if (typeof label === "string" && label.trim()) return label.trim();
  return fallback ?? "";
}

export function getCalculationPreset(type: CalculationType) {
  const option = getCalculationTypeOption(type);
  return {
    editableFields: { ...option.recommendedEditableFields },
    unitLabels: { ...option.recommendedUnitLabels },
  };
}
