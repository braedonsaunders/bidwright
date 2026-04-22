import type { CalculationType, EntityCategory } from "@/lib/api";

type EditableFieldMap = EntityCategory["editableFields"];
type UnitLabelMap = EntityCategory["unitLabels"];
type UnitFieldKey = keyof Pick<EditableFieldMap, "unit1" | "unit2" | "unit3">;

export type CategoryUnitMode = "none" | "single" | "tiered";

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
    description: "Estimator edits cost, markup, and price directly. Best for flexible categories without an automatic pricing source.",
    unitMode: "none",
    recommendedEditableFields: { quantity: true, cost: true, markup: true, price: true, unit1: false, unit2: false, unit3: false },
    recommendedUnitLabels: { unit1: "Unit 1", unit2: "Unit 2", unit3: "Unit 3" },
  },
  {
    value: "direct_price",
    label: "Direct Total",
    description: "Estimator enters the sell value directly. Cost and markup are derived or suppressed.",
    unitMode: "none",
    recommendedEditableFields: { quantity: false, cost: false, markup: false, price: true, unit1: false, unit2: false, unit3: false },
    recommendedUnitLabels: { unit1: "", unit2: "", unit3: "" },
  },
  {
    value: "formula",
    label: "Custom Formula",
    description: "Bidwright calculates the line from a custom formula using quantity, cost, markup, price, and unit slots.",
    unitMode: "single",
    recommendedEditableFields: { quantity: true, cost: true, markup: true, price: false, unit1: true, unit2: true, unit3: true },
    recommendedUnitLabels: { unit1: "Input 1", unit2: "Input 2", unit3: "Input 3" },
  },
  {
    value: "auto_labour",
    label: "Tiered Rate Schedule",
    description: "Uses linked rate-schedule tiers. All three unit slots stay available for tier-based hours or quantities.",
    unitMode: "tiered",
    recommendedEditableFields: { quantity: true, cost: false, markup: false, price: false, unit1: true, unit2: true, unit3: true },
    recommendedUnitLabels: { unit1: "Regular", unit2: "Overtime", unit3: "Doubletime" },
  },
  {
    value: "auto_equipment",
    label: "Duration / Rental Auto Pricing",
    description: "Uses linked schedule or catalog pricing with up to three duration slots. Good for rental, equipment, or other multi-tier duration categories.",
    unitMode: "tiered",
    recommendedEditableFields: { quantity: true, cost: false, markup: false, price: false, unit1: true, unit2: true, unit3: true },
    recommendedUnitLabels: { unit1: "Base", unit2: "Tier 2", unit3: "Tier 3" },
  },
  {
    value: "auto_consumable",
    label: "Quantity × Cost + Markup",
    description: "Automatically extends quantity and cost, then applies markup for sell pricing.",
    unitMode: "none",
    recommendedEditableFields: { quantity: true, cost: true, markup: true, price: false, unit1: false, unit2: false, unit3: false },
    recommendedUnitLabels: { unit1: "", unit2: "", unit3: "" },
  },
  {
    value: "auto_subcontract",
    label: "Subcontract Auto Pricing",
    description: "Calculates subcontract sell value from quantity, cost, and markup while keeping pricing controlled.",
    unitMode: "none",
    recommendedEditableFields: { quantity: true, cost: true, markup: true, price: false, unit1: false, unit2: false, unit3: false },
    recommendedUnitLabels: { unit1: "", unit2: "", unit3: "" },
  },
  {
    value: "auto_stock",
    label: "Stock / Inventory Pricing",
    description: "Uses standard quantity and cost pricing for stocked or repeat inventory-style items.",
    unitMode: "single",
    recommendedEditableFields: { quantity: true, cost: true, markup: true, price: false, unit1: true, unit2: false, unit3: false },
    recommendedUnitLabels: { unit1: "Quantity Basis", unit2: "", unit3: "" },
  },
];

const CALCULATION_TYPE_MAP = new Map(
  CALCULATION_TYPE_OPTIONS.map((option) => [option.value, option]),
);

export function getCalculationTypeOption(value: CalculationType | string | undefined) {
  return CALCULATION_TYPE_MAP.get((value ?? "manual") as CalculationType) ?? CALCULATION_TYPE_MAP.get("manual")!;
}

export function categoryUsesTieredUnits(category: Pick<EntityCategory, "calculationType"> | undefined) {
  return getCalculationTypeOption(category?.calculationType).unitMode === "tiered";
}

export function categoryShowsSingleUnit(category: Pick<EntityCategory, "calculationType"> | undefined) {
  return getCalculationTypeOption(category?.calculationType).unitMode === "single";
}

export function categoryAllowsEditingUnitSlot(
  category: Pick<EntityCategory, "calculationType" | "editableFields"> | undefined,
  field: UnitFieldKey,
) {
  if (!category) return true;
  if (categoryUsesTieredUnits(category)) return true;
  return category.editableFields[field];
}

export function getCalculationPreset(type: CalculationType) {
  const option = getCalculationTypeOption(type);
  return {
    editableFields: { ...option.recommendedEditableFields },
    unitLabels: { ...option.recommendedUnitLabels },
  };
}
