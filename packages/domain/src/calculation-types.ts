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

export type LegacyCalculationType =
  | "auto_labour"
  | "auto_equipment"
  | "auto_stock"
  | "auto_consumable"
  | "auto_subcontract"
  | "direct_price";

export const LEGACY_CALCULATION_TYPE_MAP: Record<LegacyCalculationType, CalculationType> = {
  auto_labour: "tiered_rate",
  auto_equipment: "duration_rate",
  auto_stock: "unit_markup",
  auto_consumable: "quantity_markup",
  auto_subcontract: "unit_markup",
  direct_price: "direct_total",
};

const CALCULATION_TYPE_SET = new Set<string>(CALCULATION_TYPES);

export function isCalculationType(value: unknown): value is CalculationType {
  return typeof value === "string" && CALCULATION_TYPE_SET.has(value);
}

export function normalizeCalculationType(value: unknown): CalculationType {
  if (isCalculationType(value)) {
    return value;
  }

  if (typeof value === "string" && value in LEGACY_CALCULATION_TYPE_MAP) {
    return LEGACY_CALCULATION_TYPE_MAP[value as LegacyCalculationType];
  }

  return "manual";
}
