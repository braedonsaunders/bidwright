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

const LEGACY_CALCULATION_TYPE_ALIASES: Record<string, CalculationType> = {
  auto_labour: "tiered_rate",
  auto_labor: "tiered_rate",
  labour: "tiered_rate",
  labor: "tiered_rate",
  hours: "tiered_rate",
  labour_rate: "tiered_rate",
  labor_rate: "tiered_rate",
  rate_schedule: "tiered_rate",
  auto_equipment: "duration_rate",
  equipment: "duration_rate",
  equipment_duration: "duration_rate",
  rental_equipment: "duration_rate",
  rental: "duration_rate",
  duration: "duration_rate",
  auto_consumable: "quantity_markup",
  consumable: "quantity_markup",
  quantity: "quantity_markup",
  quantity_rate: "quantity_markup",
  quantity_cost: "quantity_markup",
  cost_plus: "unit_markup",
  unit_price: "unit_markup",
  unit_cost: "unit_markup",
  direct_price: "direct_total",
  fixed_price: "direct_total",
  lump_sum: "direct_total",
  lump_sum_price: "direct_total",
};

const UNIT_FIELD_LEGACY_KEYS: Record<UnitFieldKey, string[]> = {
  unit1: ["unit1", "laborHourReg", "labourHourReg", "reg", "regular", "normal"],
  unit2: ["unit2", "laborHourOver", "labourHourOver", "over", "overtime", "ot"],
  unit3: ["unit3", "laborHourDouble", "labourHourDouble", "double", "doubletime", "dt"],
};

function normalizeCalculationTypeForUi(value: CalculationType | string | undefined): CalculationType {
  if (value && CALCULATION_TYPE_MAP.has(value as CalculationType)) {
    return value as CalculationType;
  }
  if (typeof value === "string") {
    const alias = LEGACY_CALCULATION_TYPE_ALIASES[value.trim().toLowerCase()];
    if (alias) return alias;
  }
  return "manual";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalBoolean(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
  }
  return undefined;
}

export function getCalculationTypeOption(value: CalculationType | string | undefined) {
  const normalized = normalizeCalculationTypeForUi(value);
  return (
    CALCULATION_TYPE_MAP.get(normalized) ??
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
  const preset = getCalculationTypeOption(category.calculationType).recommendedEditableFields[field];
  const editableFields = recordValue(category.editableFields);
  return optionalBoolean(editableFields, UNIT_FIELD_LEGACY_KEYS[field]) ?? preset;
}

export function getCategoryUnitLabel(
  category: Pick<EntityCategory, "unitLabels"> | undefined,
  field: UnitFieldKey,
  fallback?: string,
) {
  const labels = recordValue(category?.unitLabels);
  for (const key of UNIT_FIELD_LEGACY_KEYS[field]) {
    const value = labels[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback ?? (field === "unit1" ? "Unit 1" : field === "unit2" ? "Unit 2" : "Unit 3");
}

export function getCalculationPreset(type: CalculationType) {
  const option = getCalculationTypeOption(type);
  return {
    editableFields: { ...option.recommendedEditableFields },
    unitLabels: { ...option.recommendedUnitLabels },
  };
}
