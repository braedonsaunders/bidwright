/**
 * Display formatting for estimating measurements.
 *
 * Estimators read and write imperial lengths as feet and inches, not decimal
 * feet: 4'11" rather than 4.9 ft. Decimal feet force a mental conversion on
 * every read and invite tape-measure errors on the floor.
 */

const FEET_INCHES_UNITS = new Set(["ft", "foot", "feet", "'"]);
const INCH_UNITS = new Set(["in", "inch", "inches", '"']);

function normalize(unit: string | null | undefined) {
  return String(unit ?? "").trim().toLowerCase();
}

/** True when a unit should render as feet-inches rather than a decimal. */
export function isFeetInchesUnit(unit: string | null | undefined) {
  const normalized = normalize(unit);
  return FEET_INCHES_UNITS.has(normalized) || INCH_UNITS.has(normalized);
}

export interface FeetInchesOptions {
  /** Denominator for the fractional inch, e.g. 8 renders 1/8" steps. Default 1 (whole inches). */
  precision?: number;
}

/**
 * Render a decimal foot value as feet and inches: 4.9 -> `4'11"`.
 * Rounds carry properly (11.6" becomes the next foot, not `4'12"`).
 */
export function formatFeetInches(feet: number, options: FeetInchesOptions = {}): string {
  if (!Number.isFinite(feet)) return "";
  const precision = Math.max(1, Math.round(options.precision ?? 1));
  const negative = feet < 0;
  const absolute = Math.abs(feet);

  const totalInches = absolute * 12;
  const rounded = Math.round(totalInches * precision) / precision;
  let wholeFeet = Math.floor(rounded / 12);
  let inches = rounded - wholeFeet * 12;
  // Guard the boundary: 11.98" must roll into the next foot, never print 12".
  if (inches >= 12) {
    wholeFeet += 1;
    inches -= 12;
  }

  const wholeInches = Math.floor(inches + 1e-9);
  const fraction = inches - wholeInches;
  let fractionText = "";
  if (precision > 1 && fraction > 1e-9) {
    let numerator = Math.round(fraction * precision);
    let denominator = precision;
    while (numerator % 2 === 0 && denominator % 2 === 0) {
      numerator /= 2;
      denominator /= 2;
    }
    if (numerator > 0) fractionText = ` ${numerator}/${denominator}`;
  }

  const sign = negative ? "-" : "";
  if (wholeFeet === 0 && wholeInches === 0 && !fractionText) return `0"`;
  if (wholeFeet === 0) return `${sign}${wholeInches}${fractionText}"`;
  if (wholeInches === 0 && !fractionText) return `${sign}${wholeFeet}'`;
  return `${sign}${wholeFeet}'${wholeInches}${fractionText}"`;
}

/**
 * Format a measurement for display. Imperial lengths become feet-inches;
 * everything else keeps a compact decimal with its unit appended.
 */
export function formatMeasurement(
  value: number,
  unit: string | null | undefined,
  options: FeetInchesOptions = {},
): string {
  if (!Number.isFinite(value)) return "";
  const normalized = normalize(unit);

  if (FEET_INCHES_UNITS.has(normalized)) return formatFeetInches(value, options);
  if (INCH_UNITS.has(normalized)) return formatFeetInches(value / 12, options);

  const decimals = Math.abs(value) >= 100 ? 0 : 2;
  const text = new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals }).format(value);
  return unit ? `${text} ${unit}` : text;
}
