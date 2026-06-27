export type LinearDimensionUnit = "ft" | "in" | "yd" | "m" | "cm" | "mm";

export interface ParsedConstructionDimension {
  value: number;
  unit: LinearDimensionUnit;
  explicitUnit: boolean;
}

const METERS_PER_UNIT: Record<LinearDimensionUnit, number> = {
  ft: 0.3048,
  in: 0.0254,
  yd: 0.9144,
  m: 1,
  cm: 0.01,
  mm: 0.001,
};

const NUMBER_PATTERN = String.raw`[+-]?(?:\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+)?|\d+\s*\/\s*\d+)`;
const FEET_COMPONENT_RE = new RegExp(`(${NUMBER_PATTERN})\\s*(?:'|ft\\b|feet\\b|foot\\b)`, "i");
const INCH_COMPONENT_RE = new RegExp(`(${NUMBER_PATTERN})\\s*(?:\\"|in\\b|inch\\b|inches\\b)`, "i");
const DASH_FEET_INCHES_RE = new RegExp(`^(${NUMBER_PATTERN})\\s*-\\s*(${NUMBER_PATTERN})$`, "i");
const SIMPLE_UNIT_RE = new RegExp(
  `^(${NUMBER_PATTERN})\\s*(millimeters?|millimetres?|mm|centimeters?|centimetres?|cm|meters?|metres?|m|yards?|yd|feet|foot|ft|inches|inch|in)$`,
  "i",
);

function cleanDimensionInput(input: string): string {
  return input
    .trim()
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeUnit(unit: string | null | undefined): LinearDimensionUnit | null {
  const normalized = (unit ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "ft" || normalized === "foot" || normalized === "feet") return "ft";
  if (normalized === "in" || normalized === "inch" || normalized === "inches") return "in";
  if (normalized === "yd" || normalized === "yard" || normalized === "yards") return "yd";
  if (normalized === "m" || normalized === "meter" || normalized === "meters" || normalized === "metre" || normalized === "metres") return "m";
  if (normalized === "cm" || normalized === "centimeter" || normalized === "centimeters" || normalized === "centimetre" || normalized === "centimetres") return "cm";
  if (normalized === "mm" || normalized === "millimeter" || normalized === "millimeters" || normalized === "millimetre" || normalized === "millimetres") return "mm";
  return null;
}

function parseNumberPhrase(raw: string): number | null {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) return null;

  const mixed = value.match(/^([+-]?\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number.parseFloat(mixed[1]!);
    const numerator = Number.parseFloat(mixed[2]!);
    const denominator = Number.parseFloat(mixed[3]!);
    if (Number.isFinite(whole) && Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return whole + Math.sign(whole || 1) * (numerator / denominator);
    }
  }

  const fraction = value.match(/^([+-])?(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const numerator = Number.parseFloat(fraction[2]!);
    const denominator = Number.parseFloat(fraction[3]!);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return (fraction[1] === "-" ? -1 : 1) * (numerator / denominator);
    }
  }

  if (/^[+-]?\d+(?:\.\d+)?$/.test(value)) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function convertLinearDimension(
  value: number,
  fromUnit: LinearDimensionUnit,
  toUnit: LinearDimensionUnit,
): number {
  return (value * METERS_PER_UNIT[fromUnit]) / METERS_PER_UNIT[toUnit];
}

export function parseConstructionDimensionInput(
  input: string,
  fallbackUnit: string = "ft",
): ParsedConstructionDimension | null {
  const fallback = normalizeUnit(fallbackUnit) ?? "ft";
  const text = cleanDimensionInput(input);
  if (!text) return null;

  const feetMatch = text.match(FEET_COMPONENT_RE);
  if (feetMatch) {
    const feet = parseNumberPhrase(feetMatch[1]!);
    if (feet === null) return null;
    const remainder = text.slice((feetMatch.index ?? 0) + feetMatch[0].length).replace(/^[\s-]+/, "");
    const inchesMatch = remainder.match(INCH_COMPONENT_RE);
    const inches = inchesMatch ? parseNumberPhrase(inchesMatch[1]!) : 0;
    if (inches === null) return null;
    return { value: feet + inches / 12, unit: "ft", explicitUnit: true };
  }

  const inchesMatch = text.match(INCH_COMPONENT_RE);
  if (inchesMatch) {
    const inches = parseNumberPhrase(inchesMatch[1]!);
    if (inches === null) return null;
    return { value: inches, unit: "in", explicitUnit: true };
  }

  const dashFeetInches = text.match(DASH_FEET_INCHES_RE);
  if (dashFeetInches) {
    const feet = parseNumberPhrase(dashFeetInches[1]!);
    const inches = parseNumberPhrase(dashFeetInches[2]!);
    if (feet === null || inches === null) return null;
    return { value: feet + inches / 12, unit: "ft", explicitUnit: true };
  }

  const simpleUnit = text.match(SIMPLE_UNIT_RE);
  if (simpleUnit) {
    const value = parseNumberPhrase(simpleUnit[1]!);
    const unit = normalizeUnit(simpleUnit[2]);
    if (value === null || !unit) return null;
    return { value, unit, explicitUnit: true };
  }

  const bareValue = parseNumberPhrase(text);
  if (bareValue === null) return null;
  return { value: bareValue, unit: fallback, explicitUnit: false };
}

export function parseConstructionDimensionToUnit(input: string, targetUnit: string): number | null {
  const target = normalizeUnit(targetUnit) ?? "ft";
  const parsed = parseConstructionDimensionInput(input, target);
  if (!parsed) return null;
  return convertLinearDimension(parsed.value, parsed.unit, target);
}
