import { isDeepStrictEqual } from "node:util";

export type RecordLike = Record<string, any>;
export type EvalMode = "reuse" | "independent";
export interface ReferenceEntry {
  pickupId: string;
  source: { documentId: string; fileName: string; checksum: string; revision: string | null };
  page: number;
  calibration: unknown;
  quantity: number;
  unit: string;
  kind: "count" | "length" | "area" | "volume";
  scope: string;
  exclusions: string[];
  snapshot: RecordLike;
}
export interface TakeoffReference {
  version: 1;
  reviewed: boolean;
  frozenAt: string;
  projectId: string;
  entries: ReferenceEntry[];
  calibrations: RecordLike;
  total?: number;
}
export interface TakeoffResult {
  projectId: string;
  documents: RecordLike[];
  pickups: RecordLike[];
  links: RecordLike[];
  rows: RecordLike[];
  total?: number;
}
export interface PreparedRun {
  projectId: string;
  sourceProjectId: string;
  mode: EvalMode;
  iteration: number;
  prepared: boolean;
  baseline: RecordLike[];
}

export function pickupSnapshot(pickup: RecordLike): RecordLike {
  return Object.fromEntries([
    "documentId", "pageNumber", "annotationType", "label", "color", "lineThickness", "visible", "groupName",
    "points", "measurement", "calibration", "metadata", "sourceKind", "cadEntityId", "cadEntityType", "cadLayer",
    "modelId", "modelElementId", "modelQuantityId", "selection", "createdBy",
  ].filter((key) => pickup[key] !== undefined).map((key) => [key, pickup[key]]));
}

export function pickupKind(pickup: RecordLike): ReferenceEntry["kind"] {
  const type = String(pickup.annotationType);
  if (type === "count" || type === "count-by-distance") return "count";
  if (type.startsWith("area")) return "area";
  if (pickup.measurement?.volume !== undefined) return "volume";
  return "length";
}

export function pickupQuantity(pickup: RecordLike): number {
  const m = pickup.measurement ?? {};
  // PickupLink uses measurement.value, including grouped counts. Checking the
  // persisted value catches the historical N-pickups-each-worth-N regression.
  const value = m.value ?? m[pickupKind(pickup)];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : NaN;
}

const normalized = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
export function normalizedUnit(value: unknown) {
  const unit = normalized(value);
  return ({ each: "ea", count: "ea", pcs: "ea", "m²": "m2", "m³": "m3", "ft²": "ft2", "ft³": "ft3" } as Record<string, string>)[unit] ?? unit;
}
const scopeOf = (pickup: RecordLike) => normalized(pickup.groupName || pickup.label);
const sourceKey = (source: { fileName: string; checksum: string }) => JSON.stringify([source.fileName, source.checksum]);
const entryKey = (entry: ReferenceEntry) => JSON.stringify([sourceKey(entry.source), entry.page, normalized(entry.scope), entry.kind]);

export function validateReference(reference: TakeoffReference, reviewed = true) {
  if (reference.version !== 1 || !Array.isArray(reference.entries) || !reference.entries.length) throw new Error("Reference v1 needs at least one pickup");
  if (reviewed && reference.reviewed !== true) throw new Error("Review the frozen reference and set reviewed:true before scoring or preparing");
  if (new Set(reference.entries.map((entry) => entry.pickupId)).size !== reference.entries.length) throw new Error("Duplicate reference pickup ids");
  for (const entry of reference.entries) {
    if (!entry.source?.checksum || !entry.source.fileName || !entry.scope?.trim() || !entry.unit?.trim() ||
        !Number.isFinite(entry.quantity) || entry.quantity < 0 || !Number.isInteger(entry.page) || entry.page < 0 ||
        !["count", "length", "area", "volume"].includes(entry.kind) || !Array.isArray(entry.exclusions)) {
      throw new Error(`Incomplete reference pickup ${entry.pickupId}: source checksum, scope, page, quantity, unit and exclusions are required`);
    }
    if (entry.kind === "count" && !Number.isInteger(entry.quantity)) throw new Error(`Fractional reference count ${entry.pickupId}`);
  }
}

// Duplicate geometry is compared only within a source page and scope, in the
// stored pickup coordinate space. Native ids avoid floating-point comparisons.
function overlap(left: RecordLike, right: RecordLike, epsilon: number): boolean {
  if (left.cadEntityId && left.cadEntityId === right.cadEntityId) return true;
  if (left.modelElementId && left.modelElementId === right.modelElementId && left.modelId === right.modelId) return true;
  const a: RecordLike[] = left.points ?? [], b: RecordLike[] = right.points ?? [];
  const near = (p: RecordLike, q: RecordLike) => Math.hypot(p.x - q.x, p.y - q.y, (p.z ?? 0) - (q.z ?? 0)) <= epsilon;
  if (!a.length || !b.length) return false;
  if (pickupKind(left) === "count" && pickupKind(right) === "count") return a.some((p) => b.some((q) => near(p, q)));
  if (a.length === b.length && a.every((p) => b.some((q) => near(p, q))) && b.every((q) => a.some((p) => near(p, q)))) return true;
  if (left.annotationType === "area-rectangle" && right.annotationType === "area-rectangle" && a.length === 2 && b.length === 2) {
    const width = Math.min(Math.max(a[0].x, a[1].x), Math.max(b[0].x, b[1].x)) - Math.max(Math.min(a[0].x, a[1].x), Math.min(b[0].x, b[1].x));
    const height = Math.min(Math.max(a[0].y, a[1].y), Math.max(b[0].y, b[1].y)) - Math.max(Math.min(a[0].y, a[1].y), Math.min(b[0].y, b[1].y));
    return width > epsilon && height > epsilon;
  }
  if (left.annotationType === "linear" && right.annotationType === "linear" && a.length === 2 && b.length === 2) {
    const dx = a[1].x - a[0].x, dy = a[1].y - a[0].y, length = Math.hypot(dx, dy);
    if (length <= epsilon) return false;
    const cross = (p: RecordLike) => Math.abs((p.x - a[0].x) * dy - (p.y - a[0].y) * dx) / length;
    if (b.some((p) => cross(p) > epsilon)) return false;
    const projected = b.map((p) => ((p.x - a[0].x) * dx + (p.y - a[0].y) * dy) / length);
    return Math.min(length, Math.max(...projected)) - Math.max(0, Math.min(...projected)) > epsilon;
  }
  return false;
}

export function scoreTakeoff(reference: TakeoffReference, result: TakeoffResult, options: {
  mode: EvalMode; tolerance?: number; baseline?: RecordLike[]; coordinateTolerance?: number;
}) {
  validateReference(reference);
  const tolerance = options.tolerance ?? 0.05;
  const epsilon = options.coordinateTolerance ?? 0.5;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1 || !Number.isFinite(epsilon) || epsilon < 0) throw new Error("Invalid tolerance");
  if (options.mode !== "reuse" && options.mode !== "independent") throw new Error("Invalid eval mode");
  if (options.mode === "reuse" && !options.baseline?.length) throw new Error("Reuse scoring needs the prepared run baseline");
  const documents = new Map(result.documents.map((doc) => [doc.id, doc]));
  const groups = new Map<string, ReferenceEntry[]>();
  for (const entry of reference.entries) groups.set(entryKey(entry), [...(groups.get(entryKey(entry)) ?? []), entry]);
  const matchedIds = new Set<string>();
  const duplicates: Array<{ pickupIds: string[] }> = [];
  const rows = new Map(result.rows.map((row) => [row.id, row]));
  const pickups = new Map(result.pickups.map((pickup) => [pickup.id, pickup]));
  const usableLink = (pickup: RecordLike) => result.links.some((link) => {
    if (link.pickupId !== pickup.id || !rows.has(link.worksheetItemId)) return false;
    const row = rows.get(link.worksheetItemId)!;
    const rowLinks = result.links.filter((entry) => entry.worksheetItemId === row.id);
    const valid = rowLinks.every((entry) => {
      const source = pickups.get(entry.pickupId);
      const value = source?.measurement?.[entry.quantityField ?? "value"] ?? source?.measurement?.value;
      return source && typeof value === "number" && Number.isFinite(value) &&
        typeof entry.multiplier === "number" && Number.isFinite(entry.multiplier) && entry.multiplier > 0 &&
        Number.isFinite(entry.derivedQuantity) && Math.abs(entry.derivedQuantity - value * entry.multiplier) < 1e-6 &&
        normalizedUnit(row.unit ?? row.uom) === normalizedUnit(source.measurement?.unit);
    });
    const sum = rowLinks.reduce((total, entry) => total + entry.derivedQuantity, 0);
    return valid && Number.isFinite(row.quantity) && Math.abs(row.quantity - sum) <= 1e-6;
  });
  const comparisons = [...groups.values()].map((entries) => {
    const first = entries[0];
    const candidates = result.pickups.filter((pickup) => {
      const doc = documents.get(pickup.documentId);
      return doc && sourceKey({ fileName: doc.fileName, checksum: doc.checksum }) === sourceKey(first.source) &&
        pickup.pageNumber === first.page && scopeOf(pickup) === normalized(first.scope) && pickupKind(pickup) === first.kind;
    });
    for (const pickup of candidates) matchedIds.add(pickup.id);
    for (let i = 0; i < candidates.length; i++) {
      const left = candidates[i];
      if (pickupKind(left) === "count" && Array.isArray(left.points) && left.points.some((p: RecordLike, index: number) =>
        left.points.slice(index + 1).some((q: RecordLike) => Math.hypot(p.x - q.x, p.y - q.y) <= epsilon))) duplicates.push({ pickupIds: [left.id] });
      for (const right of candidates.slice(i + 1)) if (overlap(left, right, epsilon)) duplicates.push({ pickupIds: [left.id, right.id] });
    }
    const units = new Set(entries.map((entry) => normalizedUnit(entry.unit)));
    if (units.size !== 1) throw new Error(`Reference scope ${first.scope} mixes units; split the scope labels`);
    const expected = entries.reduce((sum, entry) => sum + entry.quantity, 0);
    const observed = candidates.reduce((sum, pickup) => sum + pickupQuantity(pickup), 0);
    const unitCorrect = candidates.length > 0 && candidates.every((pickup) => normalizedUnit(pickup.measurement?.unit) === normalizedUnit(first.unit));
    const quantityCorrect = candidates.length > 0 && Number.isFinite(observed) &&
      Math.abs(observed - expected) <= (first.kind === "count" ? 0 : Math.abs(expected) * tolerance);
    return { scope: first.scope, source: first.source, page: first.page, kind: first.kind, expected, observed: Number.isFinite(observed) ? observed : null,
      unit: first.unit, unitCorrect, quantityCorrect, pickupIds: candidates.map((pickup) => pickup.id),
      usableLinks: candidates.length > 0 && candidates.every(usableLink) };
  });
  const changedHumanPickups = (options.baseline ?? []).filter((baseline) => {
    const pickup = pickups.get(baseline.id);
    return !pickup || !isDeepStrictEqual(pickupSnapshot(pickup), pickupSnapshot(baseline));
  }).map((pickup) => pickup.id);
  const fraction = (key: "quantityCorrect" | "unitCorrect" | "usableLinks") => comparisons.filter((entry) => entry[key]).length / comparisons.length;
  const totalAccuracy = reference.total === undefined ? undefined : result.total === undefined ? 0
    : Math.max(0, 1 - Math.abs(result.total - reference.total) / Math.max(1, Math.abs(reference.total)));
  const metrics = {
    quantityAccuracy: fraction("quantityCorrect"), unitCorrectness: fraction("unitCorrect"), usableLinks: fraction("usableLinks"),
    noDuplicates: duplicates.length ? 0 : 1,
    ...(options.mode === "reuse" ? { humanEditsPreserved: 1 - changedHumanPickups.length / options.baseline!.length } : {}),
    ...(totalAccuracy === undefined ? {} : { totalAccuracy }),
  };
  const values = Object.values(metrics);
  return { mode: options.mode, projectId: result.projectId, comparisons, duplicates, changedHumanPickups,
    unmatchedPickupIds: result.pickups.filter((pickup) => !matchedIds.has(pickup.id)).map((pickup) => pickup.id),
    metrics, accuracy: values.reduce((a, b) => a + b, 0) / values.length,
    note: "Scope matching uses source checksum/name, page, scope label and measurement kind. Unmatched pickups need review; exclusions remain reviewer context. Geometry comparisons use stored coordinates, default 0.5 source pixels; native ids are exact." };
}

export function summarizeScores(scores: ReturnType<typeof scoreTakeoff>[]) {
  if (!scores.length) throw new Error("No results to summarize");
  const keys = new Set(scores.flatMap((score) => Object.keys(score.metrics)));
  return Object.fromEntries(["accuracy", ...keys].map((key) => {
    const values = scores.map((score) => key === "accuracy" ? score.accuracy : (score.metrics as Record<string, number>)[key]).filter(Number.isFinite);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return [key, { n: values.length, mean, variance: values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length }];
  }));
}
