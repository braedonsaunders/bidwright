export type ModelTakeoffQuantityKind = "count" | "length" | "area" | "volume" | "weight" | "custom";

export type ModelTakeoffPredicateValue = string | number | boolean;

type PredicateInput = ModelTakeoffPredicateValue | ModelTakeoffPredicateValue[] | null | undefined;

interface FoundQuantity {
  key: string;
  value: number;
  unit?: string;
  confidence?: number;
  quantityId?: string;
}

export interface ModelTakeoffQuantity {
  id?: string;
  quantityType?: string;
  type?: string;
  key?: string;
  name?: string;
  value?: string | number | null;
  quantity?: string | number | null;
  amount?: string | number | null;
  total?: string | number | null;
  unit?: string | null;
  confidence?: string | number | null;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ModelTakeoffElement {
  id: string;
  modelId?: string;
  externalId?: string;
  name?: string;
  type?: string;
  elementType?: string;
  elementClass?: string;
  category?: string;
  level?: string;
  material?: string;
  system?: string;
  classification?: Record<string, ModelTakeoffPredicateValue | undefined>;
  properties?: Record<string, unknown>;
  quantities?: Record<string, unknown> | ModelTakeoffQuantity[];
  linkedWorksheetItemIds?: string[];
  [key: string]: unknown;
}

export interface ModelTakeoffPredicate {
  modelId?: string | string[];
  externalId?: string | string[];
  type?: string | string[];
  elementType?: string | string[];
  elementClass?: string | string[];
  category?: string | string[];
  level?: string | string[];
  material?: string | string[];
  system?: string | string[];
  nameContains?: string | string[];
  classification?: Record<string, string | string[] | null | undefined>;
  propertyEquals?: Record<string, PredicateInput>;
}

export interface ModelTakeoffQuantityRule {
  id: string;
  name: string;
  predicate: ModelTakeoffPredicate;
  quantityKind: ModelTakeoffQuantityKind;
  quantityKeys: string[];
  outputUnit: string;
  worksheetCategory?: string;
  defaultEntityName?: string;
  defaultDescription?: string;
  confidence?: number;
}

export interface ModelTakeoffGroup {
  id: string;
  name: string;
  modelId?: string;
  predicate?: ModelTakeoffPredicate;
  elementIds: string[];
  createdAt?: string;
}

export interface ModelTakeoffAggregation {
  ruleId: string;
  ruleName: string;
  quantityKind: ModelTakeoffQuantityKind;
  quantityKey: string | null;
  unit: string;
  quantity: number;
  elementCount: number;
  matchedElementIds: string[];
  missingQuantityElementIds: string[];
  quantityKeysUsed: string[];
  sourceQuantityUnits: string[];
  sourceQuantityConfidence: number;
  confidence: number;
  worksheetItemProposal: {
    category?: string;
    entityName: string;
    description: string;
    quantity: number;
    uom: string;
    sourceNotes: string;
  };
}

export interface ModelTakeoffAggregationOptions {
  onlyUnlinked?: boolean;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function predicateOptions(expected: PredicateInput | string | string[]): string[] {
  return asArray(expected)
    .map((option) => normalized(option))
    .filter(Boolean);
}

function hasPredicateValue(expected: PredicateInput | string | string[]): boolean {
  return predicateOptions(expected).length > 0;
}

function matchesOne(actual: unknown, expected: PredicateInput | string | string[]): boolean {
  const options = predicateOptions(expected);
  if (options.length === 0) return true;
  const actualValues = Array.isArray(actual) ? actual : [actual];
  return actualValues.some((value) => options.includes(normalized(value)));
}

function matchesAny(actuals: unknown[], expected: PredicateInput | string | string[]): boolean {
  const options = predicateOptions(expected);
  if (options.length === 0) return true;
  return actuals.some((actual) => options.includes(normalized(actual)));
}

function getPathValue(record: Record<string, unknown> | undefined, path: string): unknown {
  if (!record) return undefined;
  const parts = path.split(".").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;

  let current: unknown = record;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0) return undefined;
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;

  const trimmed = value.trim().replace(/,/g, "");
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed)) return parsed;

  const numericPrefix = /^[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i.exec(trimmed)?.[0];
  if (!numericPrefix) return null;

  const parsedPrefix = Number(numericPrefix);
  return Number.isFinite(parsedPrefix) ? parsedPrefix : null;
}

function firstPresent(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function clampConfidence(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

function roundQuantity(value: number): number {
  return Number(value.toFixed(4));
}

function quantityRecordValue(quantity: ModelTakeoffQuantity): number | null {
  return numericValue(firstPresent(quantity.value, quantity.quantity, quantity.amount, quantity.total));
}

function quantityRecordConfidence(quantity: ModelTakeoffQuantity): number | undefined {
  const value = numericValue(quantity.confidence);
  return value === null ? undefined : Math.max(0, Math.min(1, value));
}

function quantityRecordMatchesKey(quantity: ModelTakeoffQuantity, key: string): boolean {
  const aliases = [
    quantity.quantityType,
    quantity.type,
    quantity.key,
    quantity.name,
    quantity.id,
    quantity.metadata?.quantityType,
    quantity.metadata?.key,
    quantity.metadata?.name,
  ];
  return aliases.some((alias) => normalized(alias) === normalized(key));
}

function findQuantity(element: ModelTakeoffElement, keys: string[]): FoundQuantity | null {
  const usableKeys = keys.map((key) => key.trim()).filter(Boolean);
  if (usableKeys.length === 0) return null;

  for (const key of usableKeys) {
    if (Array.isArray(element.quantities)) {
      for (const quantity of element.quantities) {
        if (!quantityRecordMatchesKey(quantity, key)) continue;
        const value = quantityRecordValue(quantity);
        if (value === null) continue;
        return {
          key,
          value,
          unit: String(quantity.unit ?? "").trim() || undefined,
          confidence: quantityRecordConfidence(quantity),
          quantityId: quantity.id,
        };
      }
    } else if (element.quantities) {
      const direct = numericValue(element.quantities[key]);
      if (direct !== null) return { key, value: direct };

      const nested = numericValue(getPathValue(element.quantities, key));
      if (nested !== null) return { key, value: nested };
    }

    const propertyValue = numericValue(getPathValue(element.properties, key));
    if (propertyValue !== null) return { key, value: propertyValue };

    const topLevelValue = numericValue(getPathValue(element, key));
    if (topLevelValue !== null) return { key, value: topLevelValue };
  }

  return null;
}

function hasRecordPredicate(record: Record<string, PredicateInput | string | string[]> | undefined): boolean {
  return Object.values(record ?? {}).some((value) => hasPredicateValue(value));
}

function effectivePropertyValue(element: ModelTakeoffElement, key: string): unknown {
  const propertyValue = getPathValue(element.properties, key);
  return propertyValue === undefined ? getPathValue(element, key) : propertyValue;
}

function commonModelId(elements: ModelTakeoffElement[]): string | undefined {
  const modelIds = new Set(elements.map((element) => String(element.modelId ?? "").trim()).filter(Boolean));
  return modelIds.size === 1 ? [...modelIds][0] : undefined;
}

function averageConfidence(values: number[]): number {
  if (values.length === 0) return 1;
  const average = values.reduce((total, value) => total + value, 0) / values.length;
  return clampConfidence(average);
}

export function matchesModelTakeoffPredicate(element: ModelTakeoffElement, predicate: ModelTakeoffPredicate = {}): boolean {
  const checks: Array<[unknown[], PredicateInput | string | string[]]> = [
    [[element.modelId], predicate.modelId],
    [[element.externalId, element.id], predicate.externalId],
    [[element.type, element.elementType, element.elementClass], predicate.type],
    [[element.elementType], predicate.elementType],
    [[element.category, element.elementClass], predicate.category],
    [[element.elementClass], predicate.elementClass],
    [[element.level], predicate.level],
    [[element.material], predicate.material],
    [[element.system], predicate.system],
  ];

  for (const [actuals, expected] of checks) {
    if (!matchesAny(actuals, expected)) return false;
  }

  const nameNeedles = predicateOptions(predicate.nameContains);
  if (nameNeedles.length > 0) {
    const name = normalized(element.name);
    if (!nameNeedles.some((needle) => name.includes(needle))) return false;
  }

  for (const [key, expected] of Object.entries(predicate.classification ?? {})) {
    const classification = element.classification as Record<string, unknown> | undefined;
    if (!matchesOne(getPathValue(classification, key), expected)) return false;
  }

  for (const [key, expected] of Object.entries(predicate.propertyEquals ?? {})) {
    if (!matchesOne(effectivePropertyValue(element, key), expected)) return false;
  }

  return true;
}

export function scoreModelTakeoffRule(rule: ModelTakeoffQuantityRule, element: ModelTakeoffElement): number {
  if (!matchesModelTakeoffPredicate(element, rule.predicate)) return 0;

  let score = 0.55;
  if (rule.quantityKind === "count" || findQuantity(element, rule.quantityKeys)) score += 0.25;
  if (hasPredicateValue(rule.predicate.modelId)) score += 0.05;
  if (hasPredicateValue(rule.predicate.type) || hasPredicateValue(rule.predicate.elementType)) score += 0.05;
  if (hasPredicateValue(rule.predicate.category) || hasPredicateValue(rule.predicate.elementClass)) score += 0.05;
  if (hasPredicateValue(rule.predicate.material) || hasPredicateValue(rule.predicate.system)) score += 0.05;
  if (hasRecordPredicate(rule.predicate.classification)) score += 0.05;
  if (hasRecordPredicate(rule.predicate.propertyEquals)) score += 0.05;

  return clampConfidence(score);
}

export function filterUnlinkedModelElements(elements: ModelTakeoffElement[]): ModelTakeoffElement[] {
  return elements.filter((element) => (element.linkedWorksheetItemIds ?? []).every((id) => !normalized(id)));
}

export function aggregateModelTakeoff(
  rule: ModelTakeoffQuantityRule,
  elements: ModelTakeoffElement[],
): ModelTakeoffAggregation {
  const matched = elements.filter((element) => matchesModelTakeoffPredicate(element, rule.predicate));
  const missingQuantityElementIds: string[] = [];
  const quantityKeysUsed = new Set<string>();
  const sourceQuantityUnits = new Set<string>();
  const sourceQuantityConfidences: number[] = [];
  let quantity = 0;
  let quantityKey: string | null = null;

  for (const element of matched) {
    if (rule.quantityKind === "count") {
      quantity += 1;
      quantityKey ??= "count";
      quantityKeysUsed.add("count");
      continue;
    }

    const found = findQuantity(element, rule.quantityKeys);
    if (!found) {
      missingQuantityElementIds.push(element.id);
      continue;
    }

    quantity += found.value;
    quantityKey ??= found.key;
    quantityKeysUsed.add(found.key);
    if (found.unit) sourceQuantityUnits.add(found.unit);
    sourceQuantityConfidences.push(found.confidence ?? 1);
  }

  const outputQuantity = roundQuantity(quantity);
  const quantityKeysUsedList = [...quantityKeysUsed].sort((a, b) => a.localeCompare(b));
  const sourceQuantityUnitsList = [...sourceQuantityUnits].sort((a, b) => a.localeCompare(b));
  const sourceQuantityConfidence = averageConfidence(sourceQuantityConfidences);
  const completeness = matched.length === 0 ? 0 : (matched.length - missingQuantityElementIds.length) / matched.length;
  const confidence = clampConfidence((rule.confidence ?? 0.85) * completeness * sourceQuantityConfidence);
  const entityName = rule.defaultEntityName ?? rule.name;
  const description = rule.defaultDescription ?? `${rule.name} from ${matched.length} model element${matched.length === 1 ? "" : "s"}`;
  const quantityKeyNote = quantityKeysUsedList.length === 0 ? "no quantity key" : quantityKeysUsedList.join(", ");

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    quantityKind: rule.quantityKind,
    quantityKey,
    unit: rule.outputUnit,
    quantity: outputQuantity,
    elementCount: matched.length,
    matchedElementIds: matched.map((element) => element.id),
    missingQuantityElementIds,
    quantityKeysUsed: quantityKeysUsedList,
    sourceQuantityUnits: sourceQuantityUnitsList,
    sourceQuantityConfidence,
    confidence,
    worksheetItemProposal: {
      category: rule.worksheetCategory,
      entityName,
      description,
      quantity: outputQuantity,
      uom: rule.outputUnit,
      sourceNotes: `Model takeoff rule "${rule.name}" matched ${matched.length} element${matched.length === 1 ? "" : "s"} using ${quantityKeyNote}.`,
    },
  };
}

export function aggregateModelTakeoffRules(
  rules: ModelTakeoffQuantityRule[],
  elements: ModelTakeoffElement[],
  options: ModelTakeoffAggregationOptions = {},
): ModelTakeoffAggregation[] {
  const sourceElements = options.onlyUnlinked ? filterUnlinkedModelElements(elements) : elements;
  return rules.map((rule) => aggregateModelTakeoff(rule, sourceElements));
}

export function buildModelTakeoffGroup(
  id: string,
  name: string,
  elements: ModelTakeoffElement[],
  predicate?: ModelTakeoffPredicate,
): ModelTakeoffGroup {
  const members = predicate ? elements.filter((element) => matchesModelTakeoffPredicate(element, predicate)) : elements;
  return {
    id,
    name,
    modelId: commonModelId(members),
    predicate,
    elementIds: members.map((element) => element.id),
  };
}
