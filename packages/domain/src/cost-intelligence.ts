import type {
  CostObservation,
  EffectiveCostMethod,
  ResourceCatalogItem,
} from "./models";

export interface CostObservationLike {
  id: string;
  resourceId?: string | null;
  vendorName?: string | null;
  observedAt?: string | Date | null;
  effectiveDate?: string | null;
  observedUom?: string | null;
  unitCost?: number | null;
  unitPrice?: number | null;
  currency?: string | null;
  confidence?: number | null;
}

export interface EffectiveCostDerivationOptions {
  method?: Extract<EffectiveCostMethod, "latest_observation" | "weighted_average">;
  projectId?: string | null;
  vendorName?: string | null;
  region?: string | null;
  targetUom?: string | null;
  currency?: string | null;
  asOf?: string | Date | null;
  lookbackDays?: number | null;
  minConfidence?: number | null;
}

export interface EffectiveCostDraft {
  resourceId: string;
  projectId: string | null;
  vendorName: string;
  region: string;
  uom: string;
  unitCost: number;
  unitPrice: number | null;
  currency: string;
  effectiveDate: string | null;
  sourceObservationId: string | null;
  method: EffectiveCostMethod;
  sampleSize: number;
  confidence: number;
  metadata: Record<string, unknown>;
}

const DEFAULT_CURRENCY = "USD";
const DEFAULT_UOM = "EA";
const DAY_MS = 86_400_000;
const UNIT_ALIASES = new Map<string, string>([
  ["ea", "ea"],
  ["each", "ea"],
  ["unit", "ea"],
  ["units", "ea"],
  ["pc", "ea"],
  ["pcs", "ea"],
  ["hr", "hr"],
  ["hrs", "hr"],
  ["hour", "hr"],
  ["hours", "hr"],
  ["mh", "hr"],
  ["manhour", "hr"],
  ["manhours", "hr"],
  ["day", "day"],
  ["days", "day"],
  ["daily", "day"],
  ["wk", "wk"],
  ["week", "wk"],
  ["weeks", "wk"],
  ["mo", "mo"],
  ["month", "mo"],
  ["months", "mo"],
  ["ft", "ft"],
  ["foot", "ft"],
  ["feet", "ft"],
  ["lf", "ft"],
  ["m", "m"],
  ["meter", "m"],
  ["meters", "m"],
  ["metre", "m"],
  ["metres", "m"],
  ["sf", "sf"],
  ["sqft", "sf"],
  ["ft2", "sf"],
  ["sy", "sy"],
  ["sqyd", "sy"],
]);

export function normalizeResourceName(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildResourceFingerprint(input: {
  code?: string | null;
  name?: string | null;
  manufacturer?: string | null;
  manufacturerPartNumber?: string | null;
  defaultUom?: string | null;
}): string {
  return [
    normalizeResourceName(input.manufacturer),
    normalizeResourceName(input.manufacturerPartNumber),
    normalizeResourceName(input.code),
    normalizeResourceName(input.name),
    (normalizeCostUnit(input.defaultUom) ?? normalizeResourceName(input.defaultUom)) || DEFAULT_UOM.toLowerCase(),
  ]
    .filter(Boolean)
    .join(":");
}

export function deriveEffectiveCostFromObservations(
  resource: Pick<ResourceCatalogItem, "id" | "defaultUom">,
  observations: readonly CostObservationLike[],
  options: EffectiveCostDerivationOptions = {},
): EffectiveCostDraft | null {
  const method = options.method ?? "latest_observation";
  const targetUom = normalizeCostUnit(options.targetUom ?? resource.defaultUom) ?? DEFAULT_UOM.toLowerCase();
  const currency = (options.currency ?? DEFAULT_CURRENCY).trim().toUpperCase() || DEFAULT_CURRENCY;
  const asOf = parseDate(options.asOf) ?? new Date();
  const minConfidence = clamp01(options.minConfidence ?? 0);
  const cutoff =
    typeof options.lookbackDays === "number" && options.lookbackDays > 0
      ? new Date(asOf.getTime() - options.lookbackDays * DAY_MS)
      : null;

  const candidates = observations
    .filter((observation) => !observation.resourceId || observation.resourceId === resource.id)
    .map((observation) => normalizeObservationForDerivation(observation, targetUom, currency, asOf))
    .filter((observation): observation is NormalizedObservation => {
      if (!observation) return false;
      if (observation.confidence < minConfidence) return false;
      if (cutoff && observation.observedAt < cutoff) return false;
      if (observation.observedAt > asOf) return false;
      return true;
    })
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());

  if (candidates.length === 0) return null;

  if (method === "weighted_average") {
    return deriveWeightedAverage(resource.id, candidates, options);
  }

  const latest = candidates[0]!;
  return {
    resourceId: resource.id,
    projectId: options.projectId ?? null,
    vendorName: options.vendorName ?? latest.vendorName,
    region: options.region ?? "",
    uom: latest.uom.toUpperCase(),
    unitCost: roundCurrency(latest.unitCost),
    unitPrice: latest.unitPrice == null ? null : roundCurrency(latest.unitPrice),
    currency: latest.currency,
    effectiveDate: latest.effectiveDate ?? latest.observedAt.toISOString().slice(0, 10),
    sourceObservationId: latest.id,
    method: "latest_observation",
    sampleSize: 1,
    confidence: latest.confidence,
    metadata: {
      observationIds: [latest.id],
      observedAt: latest.observedAt.toISOString(),
    },
  };
}

export function normalizeCostObservation(
  observation: Pick<CostObservation, "id" | "observedUom" | "unitCost" | "unitPrice" | "currency" | "confidence">,
): Pick<CostObservation, "id" | "observedUom" | "unitCost" | "unitPrice" | "currency" | "confidence"> {
  return {
    ...observation,
    observedUom: (normalizeCostUnit(observation.observedUom) ?? observation.observedUom ?? DEFAULT_UOM).toUpperCase(),
    unitCost: roundCurrency(Math.max(0, observation.unitCost || 0)),
    unitPrice: observation.unitPrice == null ? null : roundCurrency(Math.max(0, observation.unitPrice || 0)),
    currency: (observation.currency || DEFAULT_CURRENCY).trim().toUpperCase(),
    confidence: clamp01(observation.confidence ?? 0),
  };
}

interface NormalizedObservation {
  id: string;
  vendorName: string;
  observedAt: Date;
  effectiveDate: string | null;
  uom: string;
  unitCost: number;
  unitPrice: number | null;
  currency: string;
  confidence: number;
  recencyWeight: number;
}

function normalizeObservationForDerivation(
  observation: CostObservationLike,
  targetUom: string,
  currency: string,
  asOf: Date,
): NormalizedObservation | null {
  const observedUom = normalizeCostUnit(observation.observedUom) ?? DEFAULT_UOM.toLowerCase();
  const observedCurrency = (observation.currency ?? DEFAULT_CURRENCY).trim().toUpperCase() || DEFAULT_CURRENCY;
  const observedAt = parseDate(observation.observedAt) ?? asOf;
  const unitCost = Number(observation.unitCost);
  if (!Number.isFinite(unitCost) || unitCost < 0) return null;
  if (observedUom !== targetUom || observedCurrency !== currency) return null;

  const ageDays = Math.max(0, (asOf.getTime() - observedAt.getTime()) / DAY_MS);
  const recencyWeight = 1 / (1 + ageDays / 90);
  const confidence = clamp01(observation.confidence ?? 0.5);

  return {
    id: observation.id,
    vendorName: observation.vendorName?.trim() ?? "",
    observedAt,
    effectiveDate: observation.effectiveDate ?? null,
    uom: observedUom,
    unitCost,
    unitPrice: observation.unitPrice == null || !Number.isFinite(Number(observation.unitPrice))
      ? null
      : Math.max(0, Number(observation.unitPrice)),
    currency: observedCurrency,
    confidence,
    recencyWeight,
  };
}

function deriveWeightedAverage(
  resourceId: string,
  candidates: readonly NormalizedObservation[],
  options: EffectiveCostDerivationOptions,
): EffectiveCostDraft {
  let weightTotal = 0;
  let costTotal = 0;
  let priceWeightTotal = 0;
  let priceTotal = 0;
  let confidenceTotal = 0;

  for (const candidate of candidates) {
    const weight = Math.max(0.05, candidate.confidence) * candidate.recencyWeight;
    weightTotal += weight;
    costTotal += candidate.unitCost * weight;
    confidenceTotal += candidate.confidence * weight;
    if (candidate.unitPrice != null) {
      priceWeightTotal += weight;
      priceTotal += candidate.unitPrice * weight;
    }
  }

  const latest = candidates[0]!;
  return {
    resourceId,
    projectId: options.projectId ?? null,
    vendorName: options.vendorName ?? latest.vendorName,
    region: options.region ?? "",
    uom: latest.uom.toUpperCase(),
    unitCost: roundCurrency(costTotal / weightTotal),
    unitPrice: priceWeightTotal > 0 ? roundCurrency(priceTotal / priceWeightTotal) : null,
    currency: latest.currency,
    effectiveDate: latest.effectiveDate ?? latest.observedAt.toISOString().slice(0, 10),
    sourceObservationId: latest.id,
    method: "weighted_average",
    sampleSize: candidates.length,
    confidence: roundConfidence(confidenceTotal / weightTotal),
    metadata: {
      observationIds: candidates.map((candidate) => candidate.id),
      latestObservedAt: latest.observedAt.toISOString(),
    },
  };
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeCostUnit(value: string | null | undefined): string | null {
  const compact = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!compact) return null;
  return UNIT_ALIASES.get(compact) ?? compact;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundCurrency(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundConfidence(value: number): number {
  return Math.round(clamp01(value) * 1000) / 1000;
}
