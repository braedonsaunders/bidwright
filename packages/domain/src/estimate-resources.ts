import { z } from "zod";

import type { CatalogItem, RateScheduleItem } from "./models";

export enum EstimateResourceType {
  Labor = "labor",
  Material = "material",
  Equipment = "equipment",
  Subcontractor = "subcontractor",
  Other = "other",
}

export type EstimateResourceSourceKind =
  | "manual"
  | "catalog_item"
  | "rate_schedule_item"
  | "worksheet_item"
  | "assembly_component";

const sourceKinds = [
  "manual",
  "catalog_item",
  "rate_schedule_item",
  "worksheet_item",
  "assembly_component",
] as const satisfies readonly EstimateResourceSourceKind[];

const nonEmptyTextSchema = z.string().trim().min(1);
const optionalTextSchema = z.string().trim().min(1).optional().nullable();
const finiteNumberSchema = z.number().refine(Number.isFinite, "Expected a finite number");
const positiveNumberSchema = finiteNumberSchema.refine((value) => value > 0, "Expected a positive number");
const nonNegativeNumberSchema = finiteNumberSchema.refine(
  (value) => value >= 0,
  "Expected a non-negative number",
);
const metadataSchema = z.record(z.unknown()).default(() => ({}));

export const estimateResourceTypeSchema = z.nativeEnum(EstimateResourceType);

export const estimateResourceSourceSchema = z
  .object({
    kind: z.enum(sourceKinds),
    sourceLineId: optionalTextSchema,
    catalogItemId: optionalTextSchema,
    rateScheduleItemId: optionalTextSchema,
    worksheetItemId: optionalTextSchema,
    assemblyComponentId: optionalTextSchema,
  })
  .strict();

export const estimateResourceVariantSnapshotSchema = z
  .object({
    source: z.enum(sourceKinds),
    sourceId: optionalTextSchema,
    code: optionalTextSchema,
    name: nonEmptyTextSchema,
    unit: nonEmptyTextSchema,
    unitCost: nonNegativeNumberSchema,
    unitPrice: nonNegativeNumberSchema,
    selectedRateKey: optionalTextSchema,
    selectedCostRateKey: optionalTextSchema,
    metadata: metadataSchema,
  })
  .strict();

// `quantityPerUnit` is the amount of this resource consumed by one worksheet
// item unit. Extended resource quantity is `quantityPerUnit * item.quantity`.
export const estimateResourceLineSchema = z
  .object({
    id: nonEmptyTextSchema,
    type: estimateResourceTypeSchema,
    code: optionalTextSchema,
    name: nonEmptyTextSchema,
    description: z.string().trim().optional().nullable(),
    quantityPerUnit: positiveNumberSchema,
    unit: nonEmptyTextSchema,
    unitCost: nonNegativeNumberSchema,
    unitPrice: nonNegativeNumberSchema,
    markup: nonNegativeNumberSchema.optional().nullable(),
    source: estimateResourceSourceSchema.optional().nullable(),
    variant: estimateResourceVariantSnapshotSchema.optional().nullable(),
    metadata: metadataSchema,
  })
  .strict();

// Snapshot shape callers can store on worksheet-item metadata before the
// persistence schema grows first-class resource rows.
export const estimateResourceCompositionSnapshotSchema = z
  .object({
    worksheetItemId: optionalTextSchema,
    quantity: nonNegativeNumberSchema,
    uom: optionalTextSchema,
    unitCost: nonNegativeNumberSchema,
    unitPrice: nonNegativeNumberSchema,
    totalCost: nonNegativeNumberSchema,
    totalPrice: nonNegativeNumberSchema,
    resources: z.array(estimateResourceLineSchema),
    variant: estimateResourceVariantSnapshotSchema.optional().nullable(),
    metadata: metadataSchema,
  })
  .strict();

export type EstimateResourceSource = z.infer<typeof estimateResourceSourceSchema>;
export type EstimateResourceVariantSnapshot = z.infer<typeof estimateResourceVariantSnapshotSchema>;
export type EstimateResourceVariantSnapshotInput = z.input<typeof estimateResourceVariantSnapshotSchema>;
export type EstimateResourceLine = z.infer<typeof estimateResourceLineSchema>;
export type EstimateResourceLineInput = z.input<typeof estimateResourceLineSchema>;
export type EstimateResourceCompositionSnapshot = z.infer<typeof estimateResourceCompositionSnapshotSchema>;
export type EstimateResourceCompositionSnapshotInput = {
  worksheetItemId?: string | null;
  quantity: number;
  uom?: string | null;
  resources: readonly EstimateResourceLineInput[];
  variant?: EstimateResourceVariantSnapshotInput | null;
  metadata?: Record<string, unknown>;
};

export interface EstimateResourceUnitTotals {
  unitCost: number;
  unitPrice: number;
}

export interface EstimateResourcePositionTotals extends EstimateResourceUnitTotals {
  quantity: number;
  totalCost: number;
  totalPrice: number;
}

export type EstimateResourceRollupDimension = "type" | "name" | "code";

export interface EstimateResourceRollup {
  key: string;
  dimension: EstimateResourceRollupDimension;
  type?: EstimateResourceType;
  code?: string | null;
  name?: string;
  quantityPerUnit: number;
  positionQuantity: number;
  totalQuantity: number;
  unitCost: number;
  unitPrice: number;
  totalCost: number;
  totalPrice: number;
  resourceCount: number;
}

export type CatalogResourceLineLike = Pick<
  CatalogItem,
  "id" | "code" | "name" | "unit" | "unitCost" | "unitPrice" | "metadata"
>;

export type RateScheduleResourceLineLike = Pick<
  RateScheduleItem,
  "id" | "code" | "name" | "unit" | "rates" | "costRates" | "metadata"
>;

export interface CatalogResourceConversionOptions {
  id?: string;
  type?: EstimateResourceType | string | null;
  quantityPerUnit?: number;
  description?: string | null;
  metadata?: Record<string, unknown>;
  variantMetadata?: Record<string, unknown>;
}

export interface RateScheduleResourceConversionOptions extends CatalogResourceConversionOptions {
  rateKey?: string | null;
  costRateKey?: string | null;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function formatIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "value";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function parseWithMessage<Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown,
  label: string,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid ${label}: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

function assertNonNegativeFinite(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite, non-negative number`);
  }
}

function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function metadataFrom(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function metadataValue(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

export function normalizeEstimateResourceType(
  value: unknown,
  fallback: EstimateResourceType = EstimateResourceType.Other,
): EstimateResourceType {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase().replace(/[_\s-]+/g, "");
  if (!normalized) {
    return fallback;
  }

  if (normalized === "labor" || normalized === "labour") {
    return EstimateResourceType.Labor;
  }
  if (
    normalized === "material" ||
    normalized === "materials" ||
    normalized === "stock" ||
    normalized === "stockitem" ||
    normalized === "consumable" ||
    normalized === "consumables"
  ) {
    return EstimateResourceType.Material;
  }
  if (normalized === "equipment" || normalized === "rental" || normalized === "equipmentrate") {
    return EstimateResourceType.Equipment;
  }
  if (
    normalized === "subcontractor" ||
    normalized === "subcontractors" ||
    normalized === "subcontract" ||
    normalized === "sub"
  ) {
    return EstimateResourceType.Subcontractor;
  }
  if (normalized === "other" || normalized === "general") {
    return EstimateResourceType.Other;
  }

  return fallback;
}

export function inferEstimateResourceType(
  values: readonly unknown[],
  fallback: EstimateResourceType = EstimateResourceType.Other,
): EstimateResourceType {
  for (const value of values) {
    const inferred = normalizeEstimateResourceType(value, fallback);
    if (inferred !== fallback) {
      return inferred;
    }
  }

  const haystack = values
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (/\blabou?r\b|\bcrew\b|\btrade\b|\bjourneyman\b|\bapprentice\b/.test(haystack)) {
    return EstimateResourceType.Labor;
  }
  if (/\bmaterial\b|\bpipe\b|\bfitting\b|\bstock\b|\bconsumable\b/.test(haystack)) {
    return EstimateResourceType.Material;
  }
  if (/\bequipment\b|\bcrane\b|\blift\b|\brental\b/.test(haystack)) {
    return EstimateResourceType.Equipment;
  }
  if (/\bsubcontract\b|\bsubcontractor\b|\bsub\b/.test(haystack)) {
    return EstimateResourceType.Subcontractor;
  }

  return fallback;
}

export function createEstimateResourceLine(input: EstimateResourceLineInput): EstimateResourceLine {
  return parseWithMessage(estimateResourceLineSchema, input, "estimate resource line");
}

export function createEstimateResourceVariantSnapshot(
  input: EstimateResourceVariantSnapshotInput,
): EstimateResourceVariantSnapshot {
  return parseWithMessage(
    estimateResourceVariantSnapshotSchema,
    input,
    "estimate resource variant snapshot",
  );
}

export function deriveResourceUnitTotals(
  resources: readonly EstimateResourceLineInput[],
): EstimateResourceUnitTotals {
  let unitCost = 0;
  let unitPrice = 0;

  for (const input of resources) {
    const resource = createEstimateResourceLine(input);
    unitCost += resource.quantityPerUnit * resource.unitCost;
    unitPrice += resource.quantityPerUnit * resource.unitPrice;
  }

  return {
    unitCost: roundMoney(unitCost),
    unitPrice: roundMoney(unitPrice),
  };
}

export function deriveResourcePositionTotals(
  resources: readonly EstimateResourceLineInput[],
  quantity: number,
): EstimateResourcePositionTotals {
  assertNonNegativeFinite(quantity, "Position quantity");

  const unitTotals = deriveResourceUnitTotals(resources);
  return {
    quantity,
    ...unitTotals,
    totalCost: roundMoney(unitTotals.unitCost * quantity),
    totalPrice: roundMoney(unitTotals.unitPrice * quantity),
  };
}

export function createEstimateResourceCompositionSnapshot(
  input: EstimateResourceCompositionSnapshotInput,
): EstimateResourceCompositionSnapshot {
  const resources = input.resources.map((resource) => createEstimateResourceLine(resource));
  const totals = deriveResourcePositionTotals(resources, input.quantity);

  return parseWithMessage(
    estimateResourceCompositionSnapshotSchema,
    {
      worksheetItemId: input.worksheetItemId,
      quantity: totals.quantity,
      uom: input.uom,
      unitCost: totals.unitCost,
      unitPrice: totals.unitPrice,
      totalCost: totals.totalCost,
      totalPrice: totals.totalPrice,
      resources,
      variant: input.variant ? createEstimateResourceVariantSnapshot(input.variant) : null,
      metadata: input.metadata ?? {},
    },
    "estimate resource composition snapshot",
  );
}

function rollupKey(resource: EstimateResourceLine, dimension: EstimateResourceRollupDimension) {
  if (dimension === "type") {
    return resource.type;
  }
  if (dimension === "name") {
    return resource.name.trim().toLowerCase();
  }

  return resource.code?.trim().toLowerCase() || `${resource.type}:${resource.name.trim().toLowerCase()}`;
}

export function rollupEstimateResources(
  resources: readonly EstimateResourceLineInput[],
  dimension: EstimateResourceRollupDimension,
  positionQuantity = 1,
): EstimateResourceRollup[] {
  assertNonNegativeFinite(positionQuantity, "Position quantity");

  const groups = new Map<string, EstimateResourceRollup>();
  for (const input of resources) {
    const resource = createEstimateResourceLine(input);
    const key = rollupKey(resource, dimension);
    const unitCost = resource.quantityPerUnit * resource.unitCost;
    const unitPrice = resource.quantityPerUnit * resource.unitPrice;
    const existing = groups.get(key);

    if (existing) {
      existing.quantityPerUnit += resource.quantityPerUnit;
      existing.totalQuantity += resource.quantityPerUnit * positionQuantity;
      existing.unitCost += unitCost;
      existing.unitPrice += unitPrice;
      existing.totalCost += unitCost * positionQuantity;
      existing.totalPrice += unitPrice * positionQuantity;
      existing.resourceCount += 1;

      if (existing.type !== resource.type) {
        delete existing.type;
      }
      if (existing.code !== (resource.code ?? null)) {
        existing.code = null;
      }
      continue;
    }

    groups.set(key, {
      key,
      dimension,
      type: resource.type,
      code: resource.code ?? null,
      name: dimension === "type" ? resource.type : resource.name,
      quantityPerUnit: resource.quantityPerUnit,
      positionQuantity,
      totalQuantity: resource.quantityPerUnit * positionQuantity,
      unitCost,
      unitPrice,
      totalCost: unitCost * positionQuantity,
      totalPrice: unitPrice * positionQuantity,
      resourceCount: 1,
    });
  }

  return Array.from(groups.values())
    .map((entry) => ({
      ...entry,
      quantityPerUnit: roundQuantity(entry.quantityPerUnit),
      totalQuantity: roundQuantity(entry.totalQuantity),
      unitCost: roundMoney(entry.unitCost),
      unitPrice: roundMoney(entry.unitPrice),
      totalCost: roundMoney(entry.totalCost),
      totalPrice: roundMoney(entry.totalPrice),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function rollupEstimateResourcesByType(
  resources: readonly EstimateResourceLineInput[],
  positionQuantity = 1,
) {
  return rollupEstimateResources(resources, "type", positionQuantity);
}

export function rollupEstimateResourcesByName(
  resources: readonly EstimateResourceLineInput[],
  positionQuantity = 1,
) {
  return rollupEstimateResources(resources, "name", positionQuantity);
}

export function rollupEstimateResourcesByCode(
  resources: readonly EstimateResourceLineInput[],
  positionQuantity = 1,
) {
  return rollupEstimateResources(resources, "code", positionQuantity);
}

function toFiniteNonNegativeNumber(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a finite, non-negative number`);
  }
  return parsed;
}

function pickRate(
  rates: Record<string, unknown> | null | undefined,
  requestedKey: string | null | undefined,
  label: string,
  fallbackKey?: string | null,
) {
  const entries = Object.entries(rates ?? {}).filter((entry): entry is [string, number] => {
    const value = Number(entry[1]);
    return Number.isFinite(value) && value >= 0;
  });

  const normalizedRequestedKey = emptyToNull(requestedKey);
  if (normalizedRequestedKey) {
    const direct = entries.find(([key]) => key === normalizedRequestedKey);
    if (!direct) {
      throw new Error(`${label} does not contain rate key "${normalizedRequestedKey}"`);
    }
    return { key: direct[0], value: Number(direct[1]) };
  }

  const normalizedFallbackKey = emptyToNull(fallbackKey);
  if (normalizedFallbackKey) {
    const direct = entries.find(([key]) => key === normalizedFallbackKey);
    if (direct) {
      return { key: direct[0], value: Number(direct[1]) };
    }
  }

  const first = entries[0];
  return first ? { key: first[0], value: Number(first[1]) } : { key: null, value: 0 };
}

export function resourceLineFromCatalogItem(
  item: CatalogResourceLineLike,
  options: CatalogResourceConversionOptions = {},
): EstimateResourceLine {
  const itemMetadata = metadataFrom(item.metadata);
  const code = emptyToNull(item.code);
  const unit = emptyToNull(item.unit) ?? "EA";
  const unitCost = toFiniteNonNegativeNumber(item.unitCost, "Catalog item unitCost");
  const unitPrice = toFiniteNonNegativeNumber(item.unitPrice, "Catalog item unitPrice");
  const type =
    options.type != null
      ? normalizeEstimateResourceType(options.type)
      : inferEstimateResourceType(
          [
            metadataValue(itemMetadata, "resourceType"),
            metadataValue(itemMetadata, "type"),
            metadataValue(itemMetadata, "category"),
            item.name,
            unit,
          ],
          EstimateResourceType.Material,
        );

  return createEstimateResourceLine({
    id: options.id ?? `catalog:${item.id}`,
    type,
    code,
    name: item.name,
    description: options.description ?? null,
    quantityPerUnit: options.quantityPerUnit ?? 1,
    unit,
    unitCost,
    unitPrice,
    source: {
      kind: "catalog_item",
      sourceLineId: item.id,
      catalogItemId: item.id,
    },
    variant: {
      source: "catalog_item",
      sourceId: item.id,
      code,
      name: item.name,
      unit,
      unitCost,
      unitPrice,
      metadata: { ...itemMetadata, ...(options.variantMetadata ?? {}) },
    },
    metadata: options.metadata ?? {},
  });
}

export function resourceLineFromRateScheduleItem(
  item: RateScheduleResourceLineLike,
  options: RateScheduleResourceConversionOptions = {},
): EstimateResourceLine {
  const itemMetadata = metadataFrom(item.metadata);
  const code = emptyToNull(item.code);
  const unit = emptyToNull(item.unit) ?? "HR";
  const selectedPrice = pickRate(item.rates, options.rateKey, "Rate schedule item rates");
  const selectedCost = pickRate(
    item.costRates,
    options.costRateKey,
    "Rate schedule item costRates",
    selectedPrice.key,
  );
  const type =
    options.type != null
      ? normalizeEstimateResourceType(options.type)
      : inferEstimateResourceType(
          [
            metadataValue(itemMetadata, "resourceType"),
            metadataValue(itemMetadata, "type"),
            metadataValue(itemMetadata, "category"),
            item.name,
            unit,
          ],
          EstimateResourceType.Labor,
        );

  return createEstimateResourceLine({
    id: options.id ?? `rate-schedule:${item.id}:${selectedPrice.key ?? "default"}`,
    type,
    code,
    name: item.name,
    description: options.description ?? null,
    quantityPerUnit: options.quantityPerUnit ?? 1,
    unit,
    unitCost: selectedCost.value,
    unitPrice: selectedPrice.value,
    source: {
      kind: "rate_schedule_item",
      sourceLineId: item.id,
      rateScheduleItemId: item.id,
    },
    variant: {
      source: "rate_schedule_item",
      sourceId: item.id,
      code,
      name: item.name,
      unit,
      unitCost: selectedCost.value,
      unitPrice: selectedPrice.value,
      selectedRateKey: selectedPrice.key,
      selectedCostRateKey: selectedCost.key,
      metadata: { ...itemMetadata, ...(options.variantMetadata ?? {}) },
    },
    metadata: options.metadata ?? {},
  });
}
