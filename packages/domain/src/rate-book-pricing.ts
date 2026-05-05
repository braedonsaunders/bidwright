import type {
  EntityCategory,
  RateSchedule,
  RateScheduleItem,
  RateScheduleTier,
  RateResolutionSnapshot,
  RateResolutionComponent,
  WorksheetItem,
} from "./models";

export type RateBookComponentKind =
  | "base_rate"
  | "base_cost"
  | "burden"
  | "travel"
  | "per_diem"
  | "mileage"
  | "accommodation"
  | "allowance"
  | "minimum"
  | "markup"
  | "discount"
  | "tax"
  | "other";

export type RateBookComponentTarget = "cost" | "price" | "both";

export type RateBookComponentBasis =
  | "per_tier_unit"
  | "per_hour"
  | "per_day"
  | "per_quantity"
  | "per_line"
  | "percent_of_base_cost"
  | "percent_of_base_price";

export interface RateBookComponentRule {
  id?: string;
  code?: string;
  label?: string;
  kind?: RateBookComponentKind | string;
  target?: RateBookComponentTarget;
  basis?: RateBookComponentBasis;
  amount?: number;
  rate?: number;
  percentage?: number;
  appliesToTierId?: string | null;
  appliesToTierName?: string | null;
  categoryIds?: string[];
  categoryNames?: string[];
  entityTypes?: string[];
  metadata?: Record<string, unknown>;
}

export interface RateBookPricingContext {
  projectId?: string | null;
  revisionId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  rateBooks?: RateBookLike[];
  resolvedAt?: string;
  currency?: string;
  region?: string;
}

export interface RateBookLike extends Partial<RateSchedule> {
  id: string;
  name?: string;
  category?: string;
  defaultMarkup?: number;
  metadata?: Record<string, unknown>;
  tiers?: Array<Partial<RateScheduleTier> & { id: string }>;
  items?: RateBookItemLike[];
}

export interface RateBookItemLike extends Partial<RateScheduleItem> {
  id: string;
  scheduleId?: string;
  name?: string;
  code?: string;
  unit?: string;
  rates?: Record<string, number>;
  costRates?: Record<string, number>;
  burden?: number;
  perDiem?: number;
  metadata?: Record<string, unknown>;
}

export interface RateBookLineResolution {
  cost: number;
  price: number;
  markup: number;
  snapshot: RateResolutionSnapshot;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function ratio(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function normalizeKey(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function metadataArray(value: unknown): RateBookComponentRule[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is RateBookComponentRule => {
    return !!entry && typeof entry === "object" && !Array.isArray(entry);
  });
}

function componentRulesFromMetadata(metadata: Record<string, unknown> | null | undefined) {
  return [
    ...metadataArray(metadata?.costComponents),
    ...metadataArray(metadata?.rateComponents),
    ...metadataArray(metadata?.pricingComponents),
  ];
}

function findRateBookForItem(item: WorksheetItem, rateBooks: RateBookLike[]) {
  for (const rateBook of rateBooks) {
    const items = rateBook.items ?? [];
    if (item.rateScheduleItemId) {
      const rateBookItem = items.find((candidate) => candidate.id === item.rateScheduleItemId);
      if (rateBookItem) return { rateBook, rateBookItem };
    }

    if (item.costResourceId) {
      const rateBookItem = items.find((candidate) => candidate.resourceId === item.costResourceId);
      if (rateBookItem) return { rateBook, rateBookItem };
    }

    if (item.itemId) {
      const rateBookItem = items.find((candidate) => candidate.catalogItemId === item.itemId);
      if (rateBookItem) return { rateBook, rateBookItem };
    }

    const name = normalizeKey(item.entityName);
    if (!name) continue;
    const rateBookItem = items.find((candidate) =>
      normalizeKey(candidate.name) === name || normalizeKey(candidate.code) === name,
    );
    if (rateBookItem) return { rateBook, rateBookItem };
  }
  return null;
}

function resolveTierId(rawTierId: string, validKeys: string[]): string {
  if (validKeys.includes(rawTierId)) return rawTierId;
  return validKeys.find((candidate) => candidate.startsWith(rawTierId)) ?? rawTierId;
}

function findTier(rateBook: RateBookLike, rawTierId: string) {
  const tiers = rateBook.tiers ?? [];
  return tiers.find((tier) => tier.id === rawTierId || tier.id.startsWith(rawTierId)) ?? null;
}

function defaultTierForItem(rateBook: RateBookLike, item: WorksheetItem) {
  const tiers = [...(rateBook.tiers ?? [])].sort((left, right) => numberValue(left.sortOrder, 0) - numberValue(right.sortOrder, 0));
  if (tiers.length === 0) return null;
  const itemUom = normalizeKey(item.uom);
  return tiers.find((tier) => normalizeKey(tier.uom) === itemUom)
    ?? tiers.find((tier) => Number(tier.multiplier) === 1)
    ?? tiers[0]!;
}

function ruleMatchesLine(rule: RateBookComponentRule, item: WorksheetItem, category?: EntityCategory) {
  const categoryIds = rule.categoryIds ?? [];
  if (categoryIds.length > 0 && !categoryIds.includes(item.categoryId ?? "") && !categoryIds.includes(category?.id ?? "")) {
    return false;
  }

  const categoryNames = (rule.categoryNames ?? []).map(normalizeKey);
  if (
    categoryNames.length > 0 &&
    !categoryNames.includes(normalizeKey(item.category)) &&
    !categoryNames.includes(normalizeKey(category?.name))
  ) {
    return false;
  }

  const entityTypes = (rule.entityTypes ?? []).map(normalizeKey);
  if (
    entityTypes.length > 0 &&
    !entityTypes.includes(normalizeKey(item.entityType)) &&
    !entityTypes.includes(normalizeKey(category?.entityType))
  ) {
    return false;
  }

  return true;
}

function tierMatchesRule(rule: RateBookComponentRule, tier: (Partial<RateScheduleTier> & { id: string }) | null) {
  if (!rule.appliesToTierId && !rule.appliesToTierName) return true;
  if (rule.appliesToTierId && tier?.id !== rule.appliesToTierId) return false;
  if (rule.appliesToTierName && normalizeKey(tier?.name) !== normalizeKey(rule.appliesToTierName)) return false;
  return true;
}

function targetForRule(rule: RateBookComponentRule): RateBookComponentTarget {
  if (rule.target === "price" || rule.target === "both") return rule.target;
  return "cost";
}

function amountForRule(rule: RateBookComponentRule) {
  return numberValue(rule.amount ?? rule.rate ?? rule.percentage, 0);
}

function componentId(prefix: string, index: number, suffix?: string | null) {
  return [prefix, suffix, index].filter((part) => part !== undefined && part !== null && part !== "").join("-");
}

function buildComponent(input: Omit<RateResolutionComponent, "amount"> & { amount: number }): RateResolutionComponent {
  return {
    ...input,
    amount: money(input.amount),
  };
}

export function resolveRateBookLine(
  item: WorksheetItem,
  category: EntityCategory | undefined,
  context: RateBookPricingContext,
): RateBookLineResolution | null {
  const match = findRateBookForItem(item, context.rateBooks ?? []);
  if (!match) return null;

  const { rateBook, rateBookItem } = match;
  const rawTierUnits = item.tierUnits ?? {};
  const defaultTier = defaultTierForItem(rateBook, item);
  const tierUnits = Object.keys(rawTierUnits).length > 0
    ? rawTierUnits
    : defaultTier
      ? { [defaultTier.id]: 1 }
      : { "__unit": 1 };

  const quantity = numberValue(item.quantity, 1);
  const rates = rateBookItem.rates ?? {};
  const costRates = rateBookItem.costRates ?? {};
  const validRateKeys = Object.keys(rates);
  const validCostKeys = Object.keys(costRates);
  const components: RateResolutionComponent[] = [];
  const warnings: string[] = [];
  let totalPrice = 0;
  let totalCost = 0;
  let totalTierUnits = 0;
  let baseCost = 0;
  let basePrice = 0;

  for (const [rawTierId, rawUnits] of Object.entries(tierUnits)) {
    const units = numberValue(rawUnits, 0);
    if (units <= 0) continue;

    const tier = findTier(rateBook, rawTierId) ?? (rawTierId === "__unit" ? defaultTier : null);
    const priceKey = resolveTierId(rawTierId, validRateKeys);
    const costKey = resolveTierId(rawTierId, validCostKeys);
    const fallbackKey = defaultTier?.id ?? "";
    const unitPrice = numberValue(rates[priceKey] ?? rates[fallbackKey], Number.NaN);
    const unitCost = numberValue(costRates[costKey] ?? costRates[fallbackKey], Number.NaN);
    const extendedUnits = units * quantity;

    if (!Number.isFinite(unitPrice)) {
      warnings.push(`Missing sell rate for ${tier?.name ?? rawTierId}.`);
    } else {
      const amount = unitPrice * extendedUnits;
      totalPrice += amount;
      basePrice += amount;
      components.push(buildComponent({
        id: componentId("sell", components.length + 1, tier?.id ?? rawTierId),
        code: tier?.name ?? rawTierId,
        label: `${tier?.name ?? rawTierId} sell rate`,
        kind: "base_rate",
        source: "rate_book",
        target: "price",
        basis: "per_tier_unit",
        quantity: extendedUnits,
        rate: unitPrice,
        amount,
        rateBookId: rateBook.id,
        rateBookItemId: rateBookItem.id,
        tierId: tier?.id ?? rawTierId,
        metadata: {},
      }));
    }

    if (!Number.isFinite(unitCost)) {
      warnings.push(`Missing cost rate for ${tier?.name ?? rawTierId}.`);
    } else {
      const amount = unitCost * extendedUnits;
      totalCost += amount;
      baseCost += amount;
      components.push(buildComponent({
        id: componentId("cost", components.length + 1, tier?.id ?? rawTierId),
        code: tier?.name ?? rawTierId,
        label: `${tier?.name ?? rawTierId} direct cost`,
        kind: "base_cost",
        source: "rate_book",
        target: "cost",
        basis: "per_tier_unit",
        quantity: extendedUnits,
        rate: unitCost,
        amount,
        rateBookId: rateBook.id,
        rateBookItemId: rateBookItem.id,
        tierId: tier?.id ?? rawTierId,
        metadata: {},
      }));
    }

    totalTierUnits += units;
  }

  const rules = [
    ...componentRulesFromMetadata(rateBook.metadata),
    ...componentRulesFromMetadata(rateBookItem.metadata),
  ].filter((rule) => ruleMatchesLine(rule, item, category));

  if (numberValue(rateBookItem.burden, 0) > 0) {
    rules.push({
      code: "legacy_burden",
      label: "Burden",
      kind: "burden",
      target: "cost",
      basis: "per_hour",
      amount: numberValue(rateBookItem.burden, 0),
      metadata: { sourceField: "RateScheduleItem.burden" },
    });
  }

  if (numberValue(rateBookItem.perDiem, 0) > 0) {
    rules.push({
      code: "legacy_per_diem",
      label: "Per diem",
      kind: "per_diem",
      target: "cost",
      basis: "per_day",
      amount: numberValue(rateBookItem.perDiem, 0),
      metadata: { sourceField: "RateScheduleItem.perDiem" },
    });
  }

  for (const rule of rules) {
    const basis = rule.basis ?? "per_line";
    const target = targetForRule(rule);
    const rate = amountForRule(rule);
    if (rate === 0) continue;

    const appliesToTierId = rule.appliesToTierId || rule.appliesToTierName;
    const tierScopedUnits = appliesToTierId
      ? Object.entries(tierUnits).reduce((sum, [rawTierId, rawUnits]) => {
        const tier = findTier(rateBook, rawTierId) ?? (rawTierId === "__unit" ? defaultTier : null);
        if (!tierMatchesRule(rule, tier)) return sum;
        return sum + numberValue(rawUnits, 0);
      }, 0)
      : totalTierUnits;

    const unitsForRule = tierScopedUnits * quantity;
    if (appliesToTierId && unitsForRule <= 0) continue;

    let ruleQuantity = 1;
    let amount = 0;
    switch (basis) {
      case "per_tier_unit":
      case "per_hour":
        ruleQuantity = unitsForRule;
        amount = rate * ruleQuantity;
        break;
      case "per_day":
        ruleQuantity = Math.ceil(tierScopedUnits / 8) * quantity;
        amount = rate * ruleQuantity;
        break;
      case "per_quantity":
        ruleQuantity = quantity;
        amount = rate * ruleQuantity;
        break;
      case "percent_of_base_cost":
        ruleQuantity = baseCost;
        amount = baseCost * rate;
        break;
      case "percent_of_base_price":
        ruleQuantity = basePrice;
        amount = basePrice * rate;
        break;
      case "per_line":
      default:
        ruleQuantity = 1;
        amount = rate;
        break;
    }

    if (target === "cost" || target === "both") totalCost += amount;
    if (target === "price" || target === "both") totalPrice += amount;

    components.push(buildComponent({
      id: rule.id ?? componentId("component", components.length + 1, rule.code),
      code: rule.code ?? rule.kind ?? "component",
      label: rule.label ?? rule.code ?? "Rate book component",
      kind: rule.kind ?? "other",
      source: "rate_book",
      target,
      basis,
      quantity: ruleQuantity,
      rate,
      amount,
      rateBookId: rateBook.id,
      rateBookItemId: rateBookItem.id,
      tierId: rule.appliesToTierId ?? undefined,
      metadata: rule.metadata ?? {},
    }));
  }

  if (basePrice === 0 && baseCost > 0 && numberValue(rateBook.defaultMarkup, 0) > 0) {
    totalPrice = baseCost * (1 + numberValue(rateBook.defaultMarkup, 0));
    warnings.push("Sell rate was missing; rate book default markup was applied to direct cost.");
  }

  const unitCost = quantity === 0 ? 0 : totalCost / quantity;
  const markup = totalCost === 0 ? 0 : (totalPrice - totalCost) / totalCost;

  return {
    cost: money(unitCost),
    price: money(totalPrice),
    markup: ratio(markup),
    snapshot: {
      source: "rate_book",
      engineVersion: 1,
      resolvedAt: context.resolvedAt ?? new Date().toISOString(),
      projectId: context.projectId ?? null,
      revisionId: context.revisionId ?? null,
      customerId: context.customerId ?? null,
      customerName: context.customerName ?? null,
      categoryId: item.categoryId ?? category?.id ?? null,
      categoryName: category?.name ?? item.category,
      entityType: category?.entityType ?? item.entityType,
      rateBookId: rateBook.id,
      rateBookName: rateBook.name ?? "Rate book",
      rateBookItemId: rateBookItem.id,
      rateBookItemName: rateBookItem.name ?? item.entityName,
      resourceId: rateBookItem.resourceId ?? item.costResourceId ?? null,
      catalogItemId: rateBookItem.catalogItemId ?? item.itemId ?? null,
      currency: context.currency ?? String(rateBook.metadata?.currency ?? "USD"),
      region: context.region ?? (typeof rateBook.metadata?.region === "string" ? rateBook.metadata.region : undefined),
      quantity,
      uom: item.uom,
      tierUnits: { ...tierUnits },
      components,
      baseCost: money(baseCost),
      basePrice: money(basePrice),
      totalCost: money(totalCost),
      unitCost: money(unitCost),
      totalPrice: money(totalPrice),
      markup: ratio(markup),
      warnings,
    },
  };
}
