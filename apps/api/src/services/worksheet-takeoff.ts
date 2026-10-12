import { createHash } from "node:crypto";

export interface WorksheetTakeoffInput {
  pickupId: string;
  quantityField?: "value" | "area" | "volume" | "count";
  multiplier?: number;
}

export function takeoffError(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function takeoffUnitKey(unit: string) {
  const key = unit.toLowerCase().replace(/[.\s^]/g, "");
  const aliases: Record<string, string> = {
    each: "ea", pc: "ea", pcs: "ea", count: "ea", ct: "ea", unit: "ea", units: "ea",
    lf: "ft", feet: "ft", foot: "ft", "'": "ft", lm: "m", meter: "m", metre: "m",
    sf: "ft2", sqft: "ft2", "ft²": "ft2", sm: "m2", sqm: "m2", "m²": "m2",
    cf: "ft3", cuft: "ft3", "ft³": "ft3", "m³": "m3", cum: "m3", cy: "yd3", sy: "yd2",
  };
  return aliases[key] ?? key;
}

export function assertTakeoffUnits(measurement: Record<string, unknown>, itemUom: string, multiplier?: number) {
  const source = takeoffUnitKey(String(measurement.unit ?? ""));
  const target = takeoffUnitKey(itemUom);
  if (/^(px|pixel|pixels)([²³23])?$/.test(source) || /^(px|pixel|pixels)([²³23])?$/.test(target)) {
    throw takeoffError("Pixel quantities cannot drive a priced row; a physical-unit measurement is required.");
  }
  if (!source || !target) throw takeoffError("Takeoff or row unit is unknown; a quantity with an explicit unit is required.");
  if (multiplier !== undefined && (!Number.isFinite(multiplier) || multiplier <= 0)) {
    throw takeoffError("Takeoff multiplier must be a finite positive number.");
  }
  if (source !== target && multiplier === undefined) {
    throw takeoffError(`Explicit multiplier required to convert ${measurement.unit} to ${itemUom}.`);
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}

/** Exact retries of a takeoff-backed create address the same row. */
export function takeoffRowId(projectId: string, worksheetId: string, input: object) {
  return `li-${createHash("sha256").update(JSON.stringify(canonical({ projectId, worksheetId, input }))).digest("hex").slice(0, 32)}`;
}
