import { createHash } from "node:crypto";

export interface SourceRef { id: string; line: number; endLine?: number; path?: string }
export interface MtoItem {
  type: string;
  size: string;
  spec: string;
  material: string;
  schedule: string;
  skey: string;
  itemCode: string;
  description: string;
  quantity: number | null;
  unit: "m" | "EA";
  basis: string;
  scope: string;
  refs: SourceRef[];
}
export interface PipingMto {
  format: "pcf" | "piping";
  coordinateSpace: string;
  lines: Array<MtoItem & { id: string }>;
  joints: { status: "known" | "unknown"; knownCount: number; unknown: Array<{ reason: string; refs: SourceRef[] }> };
  warnings: string[];
}
export function aggregateMto(format: PipingMto["format"], items: MtoItem[], unknown: PipingMto["joints"]["unknown"], warnings: string[]): PipingMto {
  const grouped = new Map<string, MtoItem & { id: string }>();
  for (const item of items) {
    const { quantity, refs, ...identity } = item;
    const key = JSON.stringify(identity);
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity = existing.quantity === null || quantity === null ? null : existing.quantity + quantity;
      existing.refs.push(...refs);
    } else grouped.set(key, { ...item, refs: [...refs], id: createHash("sha256").update(key).digest("hex").slice(0, 20) });
  }
  const lines = [...grouped.values()];
  return {
    format, coordinateSpace: format === "piping" ? "native XYZ millimetres; NPS inches" : "native XYZ in UNITS-CO-ORDS; bore in UNITS-BORE",
    lines,
    joints: { status: unknown.length ? "unknown" : "known", knownCount: lines.filter(l => l.type === "JOINT").reduce((n, l) => n + (l.quantity ?? 0), 0), unknown },
    warnings,
  };
}
export function item(fields: Partial<MtoItem> & Pick<MtoItem, "type" | "refs">): MtoItem {
  return { size: "unknown", spec: "", material: "", schedule: "", skey: "", itemCode: "", description: fields.type, quantity: 1, unit: "EA", basis: "explicit component", scope: "unknown", ...fields };
}
export function connection(value: string | undefined): string | undefined {
  const normalized = value?.toUpperCase();
  return normalized === "THD" ? "SC" : normalized && ["BW", "SW", "SC", "FL"].includes(normalized) ? normalized : undefined;
}
