export const CALCULATION_TYPES = [
  "manual",
  "unit_markup",
  "quantity_markup",
  "tiered_rate",
  "duration_rate",
  "direct_total",
  "formula",
] as const;

export type CalculationType = (typeof CALCULATION_TYPES)[number];

const CALCULATION_TYPE_SET = new Set<string>(CALCULATION_TYPES);

export function isCalculationType(value: unknown): value is CalculationType {
  return typeof value === "string" && CALCULATION_TYPE_SET.has(value);
}

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

export function normalizeCalculationType(value: unknown): CalculationType {
  if (isCalculationType(value)) {
    return value;
  }

  if (typeof value === "string") {
    const alias = LEGACY_CALCULATION_TYPE_ALIASES[value.trim().toLowerCase()];
    if (alias) return alias;
  }

  return "manual";
}
