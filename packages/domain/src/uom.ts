export interface UnitOfMeasure {
  code: string;
  label: string;
  description?: string;
  active: boolean;
  order: number;
}

export const DEFAULT_UOMS: UnitOfMeasure[] = [
  { code: "EA", label: "Each", description: "Individual count", active: true, order: 0 },
  { code: "LF", label: "Linear foot", description: "Measured length", active: true, order: 1 },
  { code: "FT", label: "Foot", description: "Measured length", active: true, order: 2 },
  { code: "SF", label: "Square foot", description: "Measured area", active: true, order: 3 },
  { code: "SY", label: "Square yard", description: "Measured area", active: true, order: 4 },
  { code: "CY", label: "Cubic yard", description: "Measured volume", active: true, order: 5 },
  { code: "CF", label: "Cubic foot", description: "Measured volume", active: true, order: 6 },
  { code: "BF", label: "Board foot", description: "Lumber volume", active: true, order: 7 },
  { code: "TON", label: "Ton", description: "Weight or cooling capacity", active: true, order: 8 },
  { code: "LB", label: "Pound", description: "Weight", active: true, order: 9 },
  { code: "GAL", label: "Gallon", description: "Liquid volume", active: true, order: 10 },
  { code: "HR", label: "Hour", description: "Time", active: true, order: 11 },
  { code: "MH", label: "Man-hour", description: "Labor time", active: true, order: 12 },
  { code: "DAY", label: "Day", description: "Time or rental duration", active: true, order: 13 },
  { code: "WK", label: "Week", description: "Time or rental duration", active: true, order: 14 },
  { code: "MO", label: "Month", description: "Time or rental duration", active: true, order: 15 },
  { code: "LS", label: "Lump sum", description: "Single allowance or package", active: true, order: 16 },
  { code: "LOT", label: "Lot", description: "Batch or group", active: true, order: 17 },
  { code: "PC", label: "Piece", description: "Piece count", active: true, order: 18 },
  { code: "PR", label: "Pair", description: "Pair count", active: true, order: 19 },
  { code: "PKG", label: "Package", description: "Packaged quantity", active: true, order: 20 },
  { code: "SET", label: "Set", description: "Set count", active: true, order: 21 },
  { code: "BAG", label: "Bag", description: "Bagged material", active: true, order: 22 },
  { code: "BOX", label: "Box", description: "Boxed material", active: true, order: 23 },
  { code: "ROLL", label: "Roll", description: "Rolled material", active: true, order: 24 },
];

export function normalizeUomCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .slice(0, 16);
}

export function normalizeUomLibrary(value?: unknown): UnitOfMeasure[] {
  const source = Array.isArray(value) && value.length > 0 ? value : DEFAULT_UOMS;
  const byCode = new Map<string, UnitOfMeasure>();

  source.forEach((entry, index) => {
    const raw = typeof entry === "string" ? { code: entry, label: entry } : entry;
    if (!raw || typeof raw !== "object") return;

    const code = normalizeUomCode((raw as { code?: unknown }).code);
    if (!code) return;

    const label = String((raw as { label?: unknown }).label ?? code).trim() || code;
    const description = String((raw as { description?: unknown }).description ?? "").trim();
    const orderRaw = Number((raw as { order?: unknown }).order);
    byCode.set(code, {
      code,
      label,
      description,
      active: (raw as { active?: unknown }).active !== false,
      order: Number.isFinite(orderRaw) ? orderRaw : index,
    });
  });

  for (const fallback of DEFAULT_UOMS) {
    if (!byCode.has(fallback.code)) byCode.set(fallback.code, fallback);
  }

  return Array.from(byCode.values()).sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
}

export function activeUomCodes(value?: unknown): string[] {
  return normalizeUomLibrary(value)
    .filter((unit) => unit.active)
    .map((unit) => unit.code);
}
