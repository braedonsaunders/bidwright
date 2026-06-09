export const CALCULATION_TYPES = [
  "manual",
  "unit_markup",
  "quantity_markup",
  "unit_rate",
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

export function normalizeCalculationType(value: unknown): CalculationType {
  return isCalculationType(value) ? value : "manual";
}
