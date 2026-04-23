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
    description:
      "Estimator edits cost, markup, and price directly. Best for flexible categories without an automatic pricing source.",
    unitMode: "none",
    recommendedEditableFields: {
      quantity: true,
      cost: true,
      markup: true,
      price: true,
      unit1: false,
      unit2: false,
      unit3: false,
    },
    recommendedUnitLabels: { unit1: "Unit 1", unit2: "Unit 2", unit3: "Unit 3" },
  },
  {
    value: "direct_total",
    label: "Direct Total",
    description: "Estimator enters the sell value directly. Cost and markup are derived or suppressed.",
    unitMode: "none",
    recommendedEditableFields: {
      quantity: false,
      cost: false,
      markup: false,
      price: true,
      unit1: false,
      unit2: false,
      unit3: false,
    },
    recommendedUnitLabels: { unit1: "", unit2: "", unit3: "" },
  },
  {
    value: "formula",
    label: "Custom Formula",
    description:
      "Bidwright calculates the line from a custom formula using quantity, cost, markup, price, and unit slots.",
    unitMode: "single",
    recommendedEditableFields: {
      quantity: true,
      cost: true,
      markup: true,
      price: false,
      unit1: true,
      unit2: true,
      unit3: true,
    },
    recommendedUnitLabels: { unit1: "Input 1", unit2: "Input 2", unit3: "Input 3" },
  },
  {
    value: "tiered_rate",
    label: "Tiered Rate Schedule",
    description:
      "Uses linked rate-schedule tiers. All three unit slots stay available for tier-based hours or quantities.",
    unitMode: "tiered",
    recommendedEditableFields: {
      quantity: true,
      cost: false,
      markup: false,
      price: false,
      unit1: true,
      unit2: true,
      unit3: true,
    },
    recommendedUnitLabels: { unit1: "Tier 1", unit2: "Tier 2", unit3: "Tier 3" },
  },
  {
    value: "duration_rate",
    label: "Duration / Usage Pricing",
    description:
      "Uses linked catalog or schedule pricing with up to three duration slots. Good for rental, usage, or other time-based categories.",
    unitMode: "tiered",
    recommendedEditableFields: {
      quantity: true,
      cost: false,
      markup: false,
      price: false,
      unit1: true,
      unit2: true,
      unit3: true,
    },
    recommendedUnitLabels: { unit1: "Base", unit2: "Tier 2", unit3: "Tier 3" },
  },
  {
    value: "quantity_markup",
    label: "Quantity x Cost + Markup",
    description: "Automatically extends quantity and cost, then applies markup for sell pricing.",
    unitMode: "none",
    recommendedEditableFields: {
      quantity: true,
      cost: true,
      markup: true,
      price: false,
      unit1: false,
      unit2: false,
      unit3: false,
    },
    recommendedUnitLabels: { unit1: "", unit2: "", unit3: "" },
  },
  {
    value: "unit_markup",
    label: "Unit Cost + Markup",
    description: "Calculates sell value from quantity, unit cost, and markup while keeping pricing controlled.",
    unitMode: "none",
    recommendedEditableFields: {
      quantity: true,
      cost: true,
      markup: true,
      price: false,
      unit1: false,
      unit2: false,
      unit3: false,
    },
    recommendedUnitLabels: { unit1: "", unit2: "", unit3: "" },
  },
];

const CALCULATION_TYPE_MAP = new Map(
  CALCULATION_TYPE_OPTIONS.map((option) => [option.value, option]),
);

const LEGACY_CALCULATION_TYPE_MAP: Record<string, CalculationType> = {
  auto_labour: "tiered_rate",
  auto_equipment: "duration_rate",
  auto_stock: "unit_markup",
  auto_consumable: "quantity_markup",
  auto_subcontract: "unit_markup",
  direct_price: "direct_total",
};

export function getCalculationTypeOption(value: CalculationType | string | undefined) {
  const normalized =
    value && value in LEGACY_CALCULATION_TYPE_MAP
      ? LEGACY_CALCULATION_TYPE_MAP[value]
      : value;
  return (
    CALCULATION_TYPE_MAP.get((normalized ?? "manual") as CalculationType) ??
    CALCULATION_TYPE_MAP.get("manual")!
  );
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
