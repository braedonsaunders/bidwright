export type EstimateValidationSeverity = "info" | "warning" | "error" | "critical";

export type EstimateValidationCategory =
  | "structure"
  | "pricing"
  | "evidence"
  | "rate_schedule"
  | "quantity"
  | "consistency"
  | "strategy"
  | (string & {});

export interface EstimateValidationElementRef {
  type: string;
  id?: string;
  label?: string;
  path?: string;
  worksheetId?: string;
  itemId?: string;
  metadata?: Record<string, unknown>;
}

export interface EstimateValidationIssue {
  ruleId: string;
  ruleName: string;
  severity: EstimateValidationSeverity;
  category: EstimateValidationCategory;
  message: string;
  element?: EstimateValidationElementRef;
  suggestions: string[];
  weight: number;
  scoreImpact: number;
  details?: Record<string, unknown>;
}

export interface EstimateValidationIssueInput {
  message: string;
  severity?: EstimateValidationSeverity;
  category?: EstimateValidationCategory;
  element?: EstimateValidationElementRef;
  suggestions?: string[];
  scoreImpact?: number;
  details?: Record<string, unknown>;
}

/** A pure validation rule. Rules return issue inputs; the engine attaches rule metadata. */
export interface EstimateValidationRule {
  id: string;
  name: string;
  description?: string;
  severity: EstimateValidationSeverity;
  category: EstimateValidationCategory;
  weight: number;
  ruleSets: string[];
  validate(context: EstimateValidationContext): EstimateValidationIssueInput[];
}

/** Minimal worksheet item shape accepted by the validation engine. */
export interface EstimateValidationWorksheetItemLike {
  id?: string | null;
  worksheetId?: string | null;
  phaseId?: string | null;
  category?: string | null;
  entityType?: string | null;
  entityName?: string | null;
  vendor?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  uom?: string | null;
  cost?: number | string | null;
  price?: number | string | null;
  rateScheduleItemId?: string | null;
  itemId?: string | null;
  costResourceId?: string | null;
  effectiveCostId?: string | null;
  laborUnitId?: string | null;
  tierUnits?: Record<string, number | string | null | undefined> | null;
  sourceNotes?: string | null;
  sourceEvidence?: unknown;
  takeoffLinks?: unknown[] | null;
  modelTakeoffLinks?: unknown[] | null;
  evidenceLinks?: unknown[] | null;
  citationIds?: string[] | null;
  confidence?: number | string | null;
  confidenceScore?: number | string | null;
  quantityConfidence?: number | string | null;
  pricingConfidence?: number | string | null;
  sourceConfidence?: number | string | null;
  pricingUpdatedAt?: string | null;
  priceUpdatedAt?: string | null;
  pricedAt?: string | null;
  costUpdatedAt?: string | null;
  sourceAssemblyId?: string | null;
  assemblyInstanceId?: string | null;
  resources?: unknown[] | null;
  resourceComposition?: unknown;
  resourceSnapshot?: unknown;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface EstimateValidationWorksheetLike {
  id?: string | null;
  name?: string | null;
  items?: EstimateValidationWorksheetItemLike[] | null;
  [key: string]: unknown;
}

export interface EstimateValidationEntityCategoryLike {
  name?: string | null;
  entityType?: string | null;
  calculationType?: string | null;
  itemSource?: string | null;
  validUoms?: string[] | null;
  analyticsBucket?: string | null;
  [key: string]: unknown;
}

export interface EstimateValidationPackagePlanEntryLike {
  id?: string | null;
  name?: string | null;
  pricingMode?: string | null;
  bindings?: Record<string, unknown> | null;
  binding?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface EstimateValidationStrategyLike {
  id?: string | null;
  packagePlan?: EstimateValidationPackagePlanEntryLike[] | null;
  [key: string]: unknown;
}

export interface EstimateValidationEvidenceLinkLike {
  id?: string | null;
  worksheetItemId?: string | null;
  itemId?: string | null;
  lineItemId?: string | null;
  kind?: string | null;
  confidence?: number | string | null;
  facets?: string[] | null;
  derivedQuantity?: number | string | null;
  [key: string]: unknown;
}

export interface EstimateValidationRateScheduleItemLike {
  id?: string | null;
  name?: string | null;
  code?: string | null;
  [key: string]: unknown;
}

export interface EstimateValidationRateScheduleTierLike {
  id?: string | null;
  name?: string | null;
  [key: string]: unknown;
}

export interface EstimateValidationRateScheduleLike {
  id?: string | null;
  items?: EstimateValidationRateScheduleItemLike[] | null;
  tiers?: EstimateValidationRateScheduleTierLike[] | null;
  [key: string]: unknown;
}

/** ProjectWorkspace-compatible shape; callers may pass richer objects with extra fields. */
export interface EstimateValidationWorkspaceLike {
  worksheets?: EstimateValidationWorksheetLike[] | null;
  entityCategories?: EstimateValidationEntityCategoryLike[] | null;
  estimateStrategy?: EstimateValidationStrategyLike | null;
  strategy?: EstimateValidationStrategyLike | null;
  packagePlan?: EstimateValidationPackagePlanEntryLike[] | null;
  takeoffLinks?: EstimateValidationEvidenceLinkLike[] | null;
  modelTakeoffLinks?: EstimateValidationEvidenceLinkLike[] | null;
  evidenceLinks?: EstimateValidationEvidenceLinkLike[] | null;
  rateScheduleItems?: EstimateValidationRateScheduleItemLike[] | null;
  rateScheduleTiers?: EstimateValidationRateScheduleTierLike[] | null;
  rateSchedules?: EstimateValidationRateScheduleLike[] | null;
  estimate?: {
    lineItems?: EstimateValidationWorksheetItemLike[] | null;
    summary?: Record<string, unknown> | null;
    [key: string]: unknown;
  } | null;
  validationDate?: string | null;
  asOfDate?: string | null;
  currentDate?: string | null;
  [key: string]: unknown;
}

export interface EstimateValidationScoreRuleBreakdown {
  ruleId: string;
  issueCount: number;
  weight: number;
  penalty: number;
}

export interface EstimateValidationScore {
  value: number;
  max: number;
  penalty: number;
  grade: "excellent" | "good" | "fair" | "poor";
  byRule: EstimateValidationScoreRuleBreakdown[];
  bySeverity: Record<EstimateValidationSeverity, number>;
}

export interface EstimateValidationSummary {
  issueCount: number;
  bySeverity: Record<EstimateValidationSeverity, number>;
  byCategory: Record<string, number>;
  failedRuleIds: string[];
  passedRuleIds: string[];
}

export interface EstimateValidationResult {
  isValid: boolean;
  issues: EstimateValidationIssue[];
  score: EstimateValidationScore;
  summary: EstimateValidationSummary;
  ruleSetIds: string[];
}

export interface EstimateValidationOptions {
  ruleIds?: string[];
  disabledRuleIds?: string[];
  ruleSetIds?: string[];
  severityWeights?: Partial<Record<EstimateValidationSeverity, number>>;
  scoreMax?: number;
  scoreFloor?: number;
  referenceDate?: string | Date;
}

/** Normalized, indexed workspace data shared by rules during a validation pass. */
export interface EstimateValidationContext {
  workspace: EstimateValidationWorkspaceLike;
  worksheets: EstimateValidationWorksheetLike[];
  rows: EstimateValidationWorksheetItemRow[];
  categoryByName: Map<string, EstimateValidationEntityCategoryLike>;
  knownRateScheduleItemIds: Set<string>;
  knownTierIds: Set<string>;
  takeoffLinksByItemId: Map<string, EstimateValidationEvidenceLinkLike[]>;
  modelTakeoffLinksByItemId: Map<string, EstimateValidationEvidenceLinkLike[]>;
  evidenceLinksByItemId: Map<string, EstimateValidationEvidenceLinkLike[]>;
  referenceDate: Date;
}

interface EstimateValidationWorksheetItemRow {
  item: EstimateValidationWorksheetItemLike;
  worksheet?: EstimateValidationWorksheetLike;
}

const defaultSeverityWeights: Record<EstimateValidationSeverity, number> = {
  info: 0.2,
  warning: 0.5,
  error: 1,
  critical: 1.25,
};

export class EstimateValidationRuleRegistry {
  private readonly rules = new Map<string, EstimateValidationRule>();

  constructor(rules: EstimateValidationRule[] = []) {
    for (const rule of rules) {
      this.register(rule);
    }
  }

  register(rule: EstimateValidationRule) {
    if (this.rules.has(rule.id)) {
      throw new Error(`Estimate validation rule "${rule.id}" is already registered.`);
    }
    this.rules.set(rule.id, rule);
    return this;
  }

  unregister(ruleId: string) {
    this.rules.delete(ruleId);
    return this;
  }

  get(ruleId: string) {
    return this.rules.get(ruleId) ?? null;
  }

  list(options: Pick<EstimateValidationOptions, "ruleIds" | "disabledRuleIds" | "ruleSetIds"> = {}) {
    const allow = options.ruleIds ? new Set(options.ruleIds) : null;
    const disabled = new Set(options.disabledRuleIds ?? []);
    const ruleSets = options.ruleSetIds && options.ruleSetIds.length > 0
      ? new Set(options.ruleSetIds)
      : null;

    return Array.from(this.rules.values()).filter((rule) => {
      if (allow && !allow.has(rule.id)) {
        return false;
      }
      if (disabled.has(rule.id)) {
        return false;
      }
      if (ruleSets && !rule.ruleSets.some((ruleSet) => ruleSets.has(ruleSet))) {
        return false;
      }
      return true;
    });
  }
}

export class EstimateValidationEngine {
  constructor(private readonly registry = createDefaultEstimateValidationRegistry()) {}

  /** Validate a ProjectWorkspace-like value with the selected rule set. */
  validate(
    workspace: EstimateValidationWorkspaceLike,
    options: EstimateValidationOptions = {},
  ): EstimateValidationResult {
    const ruleSetIds = options.ruleSetIds && options.ruleSetIds.length > 0 ? options.ruleSetIds : ["default"];
    const rules = this.registry.list({ ...options, ruleSetIds });
    const context = createValidationContext(workspace, options);
    const issues: EstimateValidationIssue[] = [];
    const passedRuleIds: string[] = [];
    const failedRuleIds: string[] = [];

    for (const rule of rules) {
      const ruleIssues = rule.validate(context).map((issue) => ({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: issue.severity ?? rule.severity,
        category: issue.category ?? rule.category,
        message: issue.message,
        element: issue.element,
        suggestions: issue.suggestions ?? [],
        weight: rule.weight,
        scoreImpact: issue.scoreImpact ?? 1,
        details: issue.details,
      }));

      if (ruleIssues.length > 0) {
        failedRuleIds.push(rule.id);
        issues.push(...ruleIssues);
      } else {
        passedRuleIds.push(rule.id);
      }
    }

    const score = computeScore(issues, rules, options);
    const summary = summarizeIssues(issues, failedRuleIds, passedRuleIds);

    return {
      isValid: summary.bySeverity.error === 0 && summary.bySeverity.critical === 0,
      issues,
      score,
      summary,
      ruleSetIds,
    };
  }
}

export function createDefaultEstimateValidationRegistry() {
  return new EstimateValidationRuleRegistry(defaultEstimateValidationRules);
}

/** Convenience entry point for the default BidWright estimate validation rule set. */
export function validateEstimateWorkspace(
  workspace: EstimateValidationWorkspaceLike,
  options: EstimateValidationOptions = {},
) {
  return new EstimateValidationEngine().validate(workspace, options);
}

export type ValidationRule = EstimateValidationRule;
export type ValidationIssue = EstimateValidationIssue;
export type ValidationResult = EstimateValidationResult;
export const RuleRegistry = EstimateValidationRuleRegistry;
export const ValidationEngine = EstimateValidationEngine;

export const defaultEstimateValidationRules: EstimateValidationRule[] = [
  {
    id: "estimate.structure.missing_worksheets_or_items",
    name: "Worksheets and items exist",
    severity: "critical",
    category: "structure",
    weight: 16,
    ruleSets: ["default", "readiness"],
    validate(context) {
      const issues: EstimateValidationIssueInput[] = [];
      if (context.worksheets.length === 0) {
        issues.push({
          message: "Estimate workspace has no worksheets.",
          element: { type: "workspace", path: "worksheets" },
          suggestions: ["Create at least one worksheet before validating estimate readiness."],
        });
      }

      if (context.rows.length === 0) {
        issues.push({
          message: "Estimate workspace has no worksheet items.",
          severity: "error",
          element: { type: "workspace", path: "worksheets[].items" },
          suggestions: ["Add itemized worksheet rows or include estimate.lineItems in the validation workspace."],
        });
      }

      for (const worksheet of context.worksheets) {
        if (asArray(worksheet.items).length === 0) {
          issues.push({
            message: `Worksheet "${displayWorksheetName(worksheet)}" has no items.`,
            severity: "warning",
            element: worksheetRef(worksheet),
            suggestions: ["Add line items or remove the empty worksheet from this estimate revision."],
            scoreImpact: 0.5,
          });
        }
      }
      return issues;
    },
  },
  {
    id: "worksheet.pricing.zero_cost_or_price",
    name: "Rows carry cost and price",
    severity: "error",
    category: "pricing",
    weight: 12,
    ruleSets: ["default", "readiness"],
    validate(context) {
      return context.rows.flatMap((row) => {
        const quantity = toFiniteNumber(row.item.quantity);
        if (quantity <= 0) {
          return [];
        }

        const cost = toFiniteNumber(row.item.cost);
        const price = toFiniteNumber(row.item.price);
        if (cost > 0 && price > 0) {
          return [];
        }

        const bothZero = cost <= 0 && price <= 0;
        return [{
          message: bothZero
            ? `Worksheet item "${displayItemName(row.item)}" has zero cost and zero price.`
            : `Worksheet item "${displayItemName(row.item)}" has ${cost <= 0 ? "zero cost" : "zero price"}.`,
          severity: bothZero ? "error" : "warning",
          element: itemRef(row),
          suggestions: [
            bothZero
              ? "Confirm whether this is a no-charge scope item; otherwise add unit cost and unit price."
              : "Confirm the commercial intent and fill the missing unit cost or unit price.",
          ],
          details: { quantity, cost, price },
        }];
      });
    },
  },
  {
    id: "worksheet.evidence.missing_source_notes",
    name: "Rows include source notes",
    severity: "warning",
    category: "evidence",
    weight: 8,
    ruleSets: ["default", "readiness"],
    validate(context) {
      return context.rows
        .filter((row) => !normalizeText(row.item.sourceNotes))
        .map((row) => ({
          message: `Worksheet item "${displayItemName(row.item)}" is missing source notes.`,
          element: itemRef(row),
          suggestions: ["Add concise source notes that identify the drawing, model, quote, assumption, or human input used."],
          scoreImpact: 0.5,
        }));
    },
  },
  {
    id: "worksheet.pricing.stale_price_basis",
    name: "Pricing basis is current",
    severity: "warning",
    category: "pricing",
    weight: 10,
    ruleSets: ["default", "readiness"],
    validate(context) {
      return context.rows.flatMap((row) => {
        if (!isCommercialRow(row.item)) {
          return [];
        }

        const pricedAt = getPricingDate(row.item);
        const explicitAgeDays = firstFiniteNumberFromRecord(row.item, [
          "pricingAgeDays",
          "priceAgeDays",
          "costAgeDays",
        ]);
        const ageDays = explicitAgeDays ?? daysBetween(pricedAt, context.referenceDate);
        if (ageDays === null || ageDays <= 90) {
          return [];
        }

        const severe = ageDays > 180;
        return [{
          message: `Pricing basis for "${displayItemName(row.item)}" is ${Math.round(ageDays)} days old.`,
          severity: severe ? "error" : "warning",
          element: itemRef(row),
          suggestions: [
            "Refresh this row from the catalog, rate schedule, supplier quote, or approved historical benchmark.",
            "If the old rate is intentional, add an explicit source note with the pricing date.",
          ],
          details: {
            ageDays: Math.round(ageDays),
            pricedAt: pricedAt?.toISOString(),
          },
          scoreImpact: severe ? 1 : 0.6,
        }];
      });
    },
  },
  {
    id: "worksheet.pricing.missing_cost_source_link",
    name: "Priced rows have a cost basis",
    severity: "warning",
    category: "pricing",
    weight: 12,
    ruleSets: ["default", "readiness"],
    validate(context) {
      return context.rows
        .filter((row) => isCommercialRow(row.item) && !hasCostBasisEvidence(row.item))
        .map((row) => ({
          message: `Priced worksheet item "${displayItemName(row.item)}" has no structured cost source or cited web/vendor basis.`,
          element: itemRef(row),
          suggestions: [
            "Call searchLineItemCandidates or recommendCostSource and link the row to a catalog item, rate item, effective cost, cost resource, or labor unit when available.",
            "If current web/vendor evidence is intentionally used instead, store the source in sourceEvidence/sourceNotes with the query, URL/vendor, and date.",
          ],
          scoreImpact: 0.75,
        }));
    },
  },
  {
    id: "worksheet.pricing.effective_cost_freshness",
    name: "Effective costs are current",
    severity: "warning",
    category: "pricing",
    weight: 10,
    ruleSets: ["default", "readiness"],
    validate(context) {
      const issues: EstimateValidationIssueInput[] = [];
      for (const row of context.rows) {
        if (!normalizeText(row.item.effectiveCostId)) {
          continue;
        }
        const evidence = getSourceEvidenceRecord(row.item);
        const expiresAt = firstDateFromUnknownSources([evidence, row.item.resourceComposition], ["expiresAt", "expiryDate", "expirationDate"]);
        if (expiresAt && expiresAt.getTime() < context.referenceDate.getTime()) {
          issues.push({
            message: `Effective cost for "${displayItemName(row.item)}" expired on ${expiresAt.toISOString().slice(0, 10)}.`,
            severity: "error",
            element: itemRef(row),
            suggestions: ["Refresh the effective cost from cost intelligence or validate it with current web/vendor evidence."],
            details: {
              effectiveCostId: normalizeText(row.item.effectiveCostId),
              expiresAt: expiresAt.toISOString(),
            },
          });
          continue;
        }

        const effectiveDate = firstDateFromUnknownSources([evidence, row.item.resourceComposition], [
          "effectiveDate",
          "priceEffectiveDate",
          "costEffectiveDate",
          "observedAt",
        ]);
        const ageDays = daysBetween(effectiveDate, context.referenceDate);
        if (ageDays !== null && ageDays > 180) {
          issues.push({
            message: `Effective cost for "${displayItemName(row.item)}" is based on ${Math.round(ageDays)} day old evidence.`,
            severity: ageDays > 365 ? "error" : "warning",
            element: itemRef(row),
            suggestions: ["Refresh cost intelligence or cross-check against current WebSearch/WebFetch vendor pricing."],
            details: {
              effectiveCostId: normalizeText(row.item.effectiveCostId),
              effectiveDate: effectiveDate?.toISOString(),
              ageDays: Math.round(ageDays),
            },
            scoreImpact: ageDays > 365 ? 1 : 0.6,
          });
        }
      }
      return issues;
    },
  },
  {
    id: "worksheet.resources.labor_unit_basis",
    name: "Labour productivity has a basis",
    severity: "warning",
    category: "evidence",
    weight: 9,
    ruleSets: ["default", "readiness"],
    validate(context) {
      const issues: EstimateValidationIssueInput[] = [];
      for (const row of context.rows) {
        if (!expectsLaborBasis(row.item)) {
          continue;
        }
        const hasBasis = !!normalizeText(row.item.laborUnitId)
          || !!normalizeText(row.item.rateScheduleItemId)
          || collectItemResources(row.item).some((resource) => resourceTypeFor(resource) === "labor")
          || /\b(productivity|man[- ]?hour|mh\/|hours?\/|crew|labor unit|labour unit|table)\b/i.test(normalizeText(row.item.sourceNotes));
        if (!hasBasis) {
          issues.push({
            message: `Labour row "${displayItemName(row.item)}" has hours but no labor-unit, rate, resource, or productivity citation.`,
            element: itemRef(row),
            suggestions: ["Use listLaborUnits or cite the productivity table/web/vendor basis used for hours per unit."],
            scoreImpact: 0.7,
          });
        }
      }
      return issues;
    },
  },
  {
    id: "worksheet.pricing.uom_conversion_basis",
    name: "UOM conversions are documented",
    severity: "warning",
    category: "evidence",
    weight: 7,
    ruleSets: ["default", "readiness"],
    validate(context) {
      const issues: EstimateValidationIssueInput[] = [];
      for (const row of context.rows) {
        const evidence = getSourceEvidenceRecord(row.item);
        const sourceUom = normalizeUom(
          evidence.originalUom
            ?? evidence.observedUom
            ?? evidence.sourceUom
            ?? nestedMetadataValue(row.item, "sourceUom"),
        );
        const itemUom = normalizeUom(row.item.uom);
        if (!sourceUom || !itemUom || sourceUom === itemUom) {
          continue;
        }
        const hasConversion = firstFiniteNumberFromRecord(evidence, ["conversionFactor", "uomConversionFactor"]) !== null
          || !!normalizeText(evidence.conversionNote)
          || /\bconvert|conversion|per\s+|\/\s*.+\b/i.test(normalizeText(row.item.sourceNotes));
        if (!hasConversion) {
          issues.push({
            message: `Worksheet item "${displayItemName(row.item)}" uses UOM ${row.item.uom || "unknown"} but source evidence is ${sourceUom}.`,
            element: itemRef(row),
            suggestions: ["Add conversionFactor/sourceNotes or re-price the row in the worksheet UOM."],
            details: { sourceUom, itemUom },
            scoreImpact: 0.55,
          });
        }
      }
      return issues;
    },
  },
  {
    id: "worksheet.evidence.low_confidence_basis",
    name: "Rows have acceptable confidence",
    severity: "warning",
    category: "evidence",
    weight: 9,
    ruleSets: ["default", "readiness"],
    validate(context) {
      const issues: EstimateValidationIssueInput[] = [];
      for (const row of context.rows) {
        const itemConfidence = getItemConfidence(row.item);
        if (itemConfidence !== null && itemConfidence < 0.55) {
          issues.push({
            message: `Worksheet item "${displayItemName(row.item)}" has low confidence (${Math.round(itemConfidence * 100)}%).`,
            severity: itemConfidence < 0.35 ? "error" : "warning",
            element: itemRef(row),
            suggestions: ["Review the quantity, price basis, and scope evidence before marking this estimate bid-ready."],
            details: { confidence: roundNumber(itemConfidence) },
            scoreImpact: itemConfidence < 0.35 ? 1 : 0.65,
          });
        }

        const itemId = normalizeText(row.item.id);
        if (!itemId) {
          continue;
        }

        for (const link of [
          ...(context.takeoffLinksByItemId.get(itemId) ?? []),
          ...(context.modelTakeoffLinksByItemId.get(itemId) ?? []),
          ...(context.evidenceLinksByItemId.get(itemId) ?? []),
        ]) {
          const linkConfidence = normalizeConfidence(link.confidence ?? nestedMetadataValue(link, "confidence"));
          if (linkConfidence !== null && linkConfidence < 0.45) {
            issues.push({
              message: `Evidence linked to "${displayItemName(row.item)}" has low confidence (${Math.round(linkConfidence * 100)}%).`,
              element: itemRef(row),
              suggestions: ["Replace weak evidence with a reviewed takeoff link, model quantity, supplier quote, or approved assumption."],
              details: {
                evidenceLinkId: normalizeText(link.id) || undefined,
                confidence: roundNumber(linkConfidence),
              },
              scoreImpact: 0.5,
            });
          }
        }
      }
      return issues;
    },
  },
  {
    id: "rate_schedule.linkage.invalid_rate_schedule_payload",
    name: "Rate schedule rows are linked and tiered",
    severity: "error",
    category: "rate_schedule",
    weight: 18,
    ruleSets: ["default", "readiness"],
    validate(context) {
      const issues: EstimateValidationIssueInput[] = [];
      for (const row of context.rows) {
        const category = categoryForItem(row.item, context);
        const categoryRequiresRateSchedule = category?.itemSource === "rate_schedule";
        const hasRateScheduleId = !!normalizeText(row.item.rateScheduleItemId);
        const tierEntries = Object.entries(row.item.tierUnits ?? {});
        const hasTierPayload = tierEntries.length > 0;
        const shouldValidate = categoryRequiresRateSchedule || hasRateScheduleId || hasTierPayload;
        if (!shouldValidate) {
          continue;
        }

        if (categoryRequiresRateSchedule && !hasRateScheduleId) {
          issues.push({
            message: `Rate-schedule item "${displayItemName(row.item)}" is missing rateScheduleItemId.`,
            element: itemRef(row),
            suggestions: ["Link this row to the selected rate schedule item so cost, price, and hour rollups stay auditable."],
          });
        }

        if (hasRateScheduleId && context.knownRateScheduleItemIds.size > 0) {
          const rateScheduleItemId = normalizeText(row.item.rateScheduleItemId);
          if (!context.knownRateScheduleItemIds.has(rateScheduleItemId)) {
            issues.push({
              message: `Rate-schedule item "${displayItemName(row.item)}" references unknown rateScheduleItemId "${rateScheduleItemId}".`,
              element: itemRef(row),
              suggestions: ["Use a rateScheduleItemId present in the workspace rate schedule data."],
              details: { rateScheduleItemId },
            });
          }
        }

        if (categoryRequiresRateSchedule || hasRateScheduleId) {
          const positiveTierEntries = tierEntries.filter(([, value]) => toFiniteNumber(value) > 0);
          if (positiveTierEntries.length === 0) {
            issues.push({
              message: `Rate-schedule item "${displayItemName(row.item)}" has no positive tierUnits.`,
              element: itemRef(row),
              suggestions: ["Populate tierUnits with per-unit hours for the applicable regular, overtime, or double-time tiers."],
            });
          }
        }

        for (const [tierId, rawValue] of tierEntries) {
          const value = toFiniteNumber(rawValue);
          if (!Number.isFinite(Number(rawValue)) || value < 0) {
            issues.push({
              message: `Rate-schedule item "${displayItemName(row.item)}" has invalid tierUnits value for "${tierId}".`,
              element: itemRef(row),
              suggestions: ["Use finite, non-negative numeric tierUnits values."],
              details: { tierId, value: rawValue },
            });
          }
          if (
            context.knownTierIds.size > 0
            && normalizeText(tierId)
            && !hasKnownTierId(context.knownTierIds, tierId)
          ) {
            issues.push({
              message: `Rate-schedule item "${displayItemName(row.item)}" references unknown tier "${tierId}".`,
              element: itemRef(row),
              suggestions: ["Use tier IDs from the workspace rate schedule tiers."],
              details: { tierId },
            });
          }
        }
      }
      return issues;
    },
  },
  {
    id: "rate_schedule.hours.suspicious_tier_quantity_multiplication",
    name: "Tier units look per-unit",
    severity: "warning",
    category: "quantity",
    weight: 10,
    ruleSets: ["default", "readiness"],
    validate(context) {
      const issues: EstimateValidationIssueInput[] = [];
      for (const row of context.rows) {
        const quantity = toFiniteNumber(row.item.quantity);
        if (quantity <= 1) {
          continue;
        }

        const tierTotal = sumPositiveTierUnits(row.item.tierUnits);
        if (tierTotal <= 0) {
          continue;
        }

        if (nearlyEqual(tierTotal * quantity, tierTotal, Math.max(0.25, tierTotal * 0.02))) {
          issues.push({
            message: `Tier units for "${displayItemName(row.item)}" appear to already include the multiplier while quantity is ${quantity}.`,
            element: itemRef(row),
            suggestions: [
              "Confirm tierUnits are per-unit hours; BidWright multiplies tierUnits by quantity during rollups.",
              "If tierUnits were copied from extended hours, divide them by quantity before saving.",
            ],
            details: {
              quantity,
              tierUnitsTotal: roundNumber(tierTotal),
              projectedExtendedHours: roundNumber(tierTotal * quantity),
            },
          });
        }
      }
      return issues;
    },
  },
  {
    id: "worksheet.assembly.resource_mismatch",
    name: "Assembly rows match resource detail",
    severity: "warning",
    category: "consistency",
    weight: 10,
    ruleSets: ["default", "readiness"],
    validate(context) {
      const issues: EstimateValidationIssueInput[] = [];
      for (const row of context.rows) {
        if (!isAssemblyBacked(row.item)) {
          continue;
        }

        const resources = collectItemResources(row.item);
        if (resources.length === 0) {
          issues.push({
            message: `Assembly-backed item "${displayItemName(row.item)}" has no resource/component snapshot.`,
            element: itemRef(row),
            suggestions: ["Re-sync the assembly so labor, material, equipment, and subcontractor resources are auditable."],
            details: {
              sourceAssemblyId: normalizeText(row.item.sourceAssemblyId) || undefined,
              assemblyInstanceId: normalizeText(row.item.assemblyInstanceId) || undefined,
            },
          });
          continue;
        }

        const expectedType = expectedResourceTypeForItem(row.item);
        const resourceTypes = new Set(resources.map(resourceTypeFor).filter(Boolean));
        if (expectedType && resourceTypes.size > 0 && !resourceTypes.has(expectedType)) {
          issues.push({
            message: `Assembly-backed item "${displayItemName(row.item)}" is categorized as ${expectedType} but its resource snapshot does not include ${expectedType}.`,
            element: itemRef(row),
            suggestions: ["Align the worksheet category with the assembly resource mix, or re-expand the assembly with the correct component type."],
            details: {
              expectedType,
              resourceTypes: Array.from(resourceTypes),
            },
          });
        }

        const resourceTotals = getResourceSnapshotTotals(row.item, resources);
        const costVariance = relativeVariance(toFiniteNumber(row.item.cost), resourceTotals.unitCost);
        const priceVariance = relativeVariance(toFiniteNumber(row.item.price), resourceTotals.unitPrice);
        if ((costVariance ?? 0) > 0.05 || (priceVariance ?? 0) > 0.05) {
          issues.push({
            message: `Assembly resource totals for "${displayItemName(row.item)}" do not match the worksheet unit cost or price.`,
            element: itemRef(row),
            suggestions: ["Recalculate the row from assembly resources or document the manual override."],
            details: {
              worksheetUnitCost: toFiniteNumber(row.item.cost),
              worksheetUnitPrice: toFiniteNumber(row.item.price),
              resourceUnitCost: resourceTotals.unitCost,
              resourceUnitPrice: resourceTotals.unitPrice,
              costVariancePct: costVariance == null ? undefined : roundNumber(costVariance * 100),
              priceVariancePct: priceVariance == null ? undefined : roundNumber(priceVariance * 100),
            },
          });
        }
      }
      return issues;
    },
  },
  {
    id: "worksheet.pricing.price_variance_outlier",
    name: "Pricing variance is explainable",
    severity: "warning",
    category: "pricing",
    weight: 12,
    ruleSets: ["default", "readiness"],
    validate(context) {
      const issues: EstimateValidationIssueInput[] = [];
      for (const row of context.rows) {
        const cost = toFiniteNumber(row.item.cost);
        const price = toFiniteNumber(row.item.price);
        if (cost > 0 && price > 0 && price < cost) {
          issues.push({
            message: `Worksheet item "${displayItemName(row.item)}" has unit price below unit cost.`,
            severity: "error",
            element: itemRef(row),
            suggestions: ["Correct the markup/sell rate or document why this scope is intentionally sold below cost."],
            details: { cost, price },
          });
        }

        for (const comparison of getPriceBenchmarks(row.item)) {
          const actual = comparison.field === "cost" ? cost : price;
          const variance = relativeVariance(actual, comparison.value);
          if (variance === null || variance <= 0.3) {
            continue;
          }

          issues.push({
            message: `${comparison.field === "cost" ? "Cost" : "Price"} for "${displayItemName(row.item)}" varies ${Math.round(variance * 100)}% from ${comparison.label}.`,
            element: itemRef(row),
            suggestions: ["Check for unit-of-measure mistakes, stale catalog data, supplier quote changes, or missing escalation notes."],
            details: {
              field: comparison.field,
              actual,
              benchmark: comparison.value,
              benchmarkLabel: comparison.label,
              variancePct: roundNumber(variance * 100),
            },
            scoreImpact: variance > 0.75 ? 1 : 0.65,
          });
        }
      }
      return issues;
    },
  },
  {
    id: "worksheet.consistency.duplicate_item_signature",
    name: "Rows are not duplicated",
    severity: "warning",
    category: "consistency",
    weight: 8,
    ruleSets: ["default", "readiness"],
    validate(context) {
      const groups = new Map<string, EstimateValidationWorksheetItemRow[]>();
      for (const row of context.rows) {
        if (toFiniteNumber(row.item.quantity) <= 0) {
          continue;
        }
        const signature = itemSignature(row.item);
        if (!signature) {
          continue;
        }
        const rows = groups.get(signature) ?? [];
        rows.push(row);
        groups.set(signature, rows);
      }

      return Array.from(groups.values())
        .filter((rows) => rows.length > 1)
        .map((rows) => ({
          message: `${rows.length} worksheet items share the same estimate signature as "${displayItemName(rows[0]!.item)}".`,
          element: {
            type: "worksheet-item-group",
            id: rows.map((row) => normalizeText(row.item.id)).filter(Boolean).join(","),
            label: displayItemName(rows[0]!.item),
            metadata: {
              itemIds: rows.map((row) => normalizeText(row.item.id)).filter(Boolean),
              worksheetIds: rows.map((row) => normalizeText(row.worksheet?.id ?? row.item.worksheetId)).filter(Boolean),
            },
          },
          suggestions: ["Confirm these are intentional repeated scope rows; otherwise merge or remove duplicates."],
          details: { duplicateCount: rows.length },
        }));
    },
  },
  {
    id: "strategy.package_plan.missing_bindings",
    name: "Package plan binds to rows",
    severity: "error",
    category: "strategy",
    weight: 14,
    ruleSets: ["default", "readiness"],
    validate(context) {
      const issues: EstimateValidationIssueInput[] = [];
      const packagePlan = getPackagePlan(context.workspace);
      if (context.rows.length > 0 && packagePlan.length === 0) {
        return [{
          message: "Estimate strategy has no package plan entries for the worksheet items.",
          severity: "warning",
          element: { type: "estimate-strategy", path: "estimateStrategy.packagePlan" },
          suggestions: ["Add package plan entries with bindings to worksheets, categories, or item text matchers."],
        }];
      }

      const assignments = new Map<string, string[]>();
      for (const [index, entry] of packagePlan.entries()) {
        const packageId = normalizeText(entry.id) || `package-${index + 1}`;
        const packageName = normalizeText(entry.name) || packageId;
        const bindings = getPackageBindings(entry);
        if (!bindings.hasAny) {
          issues.push({
            message: `Package plan entry "${packageName}" has no worksheet, category, or text bindings.`,
            element: packageRef(entry, index, "bindings"),
            suggestions: ["Populate bindings.worksheetIds, bindings.categories, or bindings.textMatchers for this package."],
          });
          continue;
        }

        const matchedRows = context.rows.filter((row) => packageMatchesRow(bindings, row));
        if (matchedRows.length === 0) {
          issues.push({
            message: `Package plan entry "${packageName}" does not match any worksheet items.`,
            severity: "warning",
            element: packageRef(entry, index, "bindings"),
            suggestions: ["Adjust package bindings so they resolve to current worksheet names, IDs, categories, or item text."],
            details: { packageId, packageName },
          });
          continue;
        }

        for (const row of matchedRows) {
          const itemId = normalizeText(row.item.id);
          if (!itemId) {
            continue;
          }
          const itemPackages = assignments.get(itemId) ?? [];
          itemPackages.push(packageId);
          assignments.set(itemId, itemPackages);
        }
      }

      for (const [itemId, packageIds] of assignments.entries()) {
        const uniquePackageIds = Array.from(new Set(packageIds));
        if (uniquePackageIds.length > 1) {
          issues.push({
            message: `Worksheet item "${itemId}" is matched by multiple package plan entries.`,
            severity: "warning",
            element: { type: "worksheet-item", id: itemId, itemId },
            suggestions: ["Make package bindings mutually exclusive so each row has one commercial owner."],
            details: { packageIds: uniquePackageIds },
          });
        }
      }

      for (const row of context.rows) {
        const itemId = normalizeText(row.item.id);
        if (!itemId || assignments.has(itemId) || !isCommercialRow(row.item)) {
          continue;
        }
        issues.push({
          message: `Worksheet item "${displayItemName(row.item)}" is not bound to any package plan entry.`,
          severity: "warning",
          element: itemRef(row),
          suggestions: ["Add or broaden a package binding so this row is covered by the estimate strategy."],
          scoreImpact: 0.5,
        });
      }

      return issues;
    },
  },
  {
    id: "worksheet.evidence.missing_takeoff_or_model_links",
    name: "Takeoff-driven rows are linked",
    severity: "warning",
    category: "evidence",
    weight: 14,
    ruleSets: ["default", "readiness"],
    validate(context) {
      return context.rows
        .filter((row) => looksTakeoffDriven(row.item) && !hasDirectQuantityEvidenceLink(row.item, context))
        .map((row) => ({
          message: `Quantity for "${displayItemName(row.item)}" looks takeoff-driven but has no direct takeoff or model evidence.`,
          element: itemRef(row),
          suggestions: ["Link the row to a drawing takeoff annotation, model quantity, or quantity-focused evidence record."],
          details: { quantity: toFiniteNumber(row.item.quantity), uom: normalizeText(row.item.uom) },
        }));
    },
  },
];

function createValidationContext(
  workspace: EstimateValidationWorkspaceLike,
  options: EstimateValidationOptions = {},
): EstimateValidationContext {
  const worksheets = asArray(workspace.worksheets);
  const rows = collectRows(workspace, worksheets);
  return {
    workspace,
    worksheets,
    rows,
    categoryByName: createCategoryMap(asArray(workspace.entityCategories)),
    knownRateScheduleItemIds: collectKnownIds(
      asArray(workspace.rateScheduleItems),
      asArray(workspace.rateSchedules).flatMap((schedule) => asArray(schedule.items)),
    ),
    knownTierIds: collectKnownIds(
      asArray(workspace.rateScheduleTiers),
      asArray(workspace.rateSchedules).flatMap((schedule) => asArray(schedule.tiers)),
    ),
    takeoffLinksByItemId: indexLinksByItemId(asArray(workspace.takeoffLinks)),
    modelTakeoffLinksByItemId: indexLinksByItemId(asArray(workspace.modelTakeoffLinks)),
    evidenceLinksByItemId: indexLinksByItemId(asArray(workspace.evidenceLinks)),
    referenceDate: parseDate(
      options.referenceDate
        ?? workspace.validationDate
        ?? workspace.asOfDate
        ?? workspace.currentDate,
    ) ?? new Date(),
  };
}

function collectRows(
  workspace: EstimateValidationWorkspaceLike,
  worksheets: EstimateValidationWorksheetLike[],
): EstimateValidationWorksheetItemRow[] {
  const rows = worksheets.flatMap((worksheet) =>
    asArray(worksheet.items).map((item) => ({ item, worksheet })),
  );
  if (rows.length > 0) {
    return rows;
  }

  return asArray(workspace.estimate?.lineItems).map((item) => ({ item }));
}

function computeScore(
  issues: EstimateValidationIssue[],
  rules: EstimateValidationRule[],
  options: EstimateValidationOptions,
): EstimateValidationScore {
  const severityWeights = { ...defaultSeverityWeights, ...(options.severityWeights ?? {}) };
  const max = options.scoreMax ?? 100;
  const floor = options.scoreFloor ?? 0;
  const bySeverity = emptySeverityCounts();
  const byRule = rules.map((rule) => {
    const ruleIssues = issues.filter((issue) => issue.ruleId === rule.id);
    const rawPenalty = ruleIssues.reduce(
      (sum, issue) => sum + issue.weight * severityWeights[issue.severity] * clampImpact(issue.scoreImpact),
      0,
    );
    const cap = rule.weight * Math.max(...Object.values(severityWeights));
    const penalty = Math.min(rawPenalty, cap);
    for (const issue of ruleIssues) {
      bySeverity[issue.severity] += 1;
    }
    return {
      ruleId: rule.id,
      issueCount: ruleIssues.length,
      weight: rule.weight,
      penalty: roundNumber(penalty),
    };
  });

  const penalty = roundNumber(byRule.reduce((sum, entry) => sum + entry.penalty, 0));
  const value = Math.max(floor, roundNumber(max - penalty));
  return {
    value,
    max,
    penalty,
    grade: value >= 90 ? "excellent" : value >= 75 ? "good" : value >= 60 ? "fair" : "poor",
    byRule,
    bySeverity,
  };
}

function summarizeIssues(
  issues: EstimateValidationIssue[],
  failedRuleIds: string[],
  passedRuleIds: string[],
): EstimateValidationSummary {
  const bySeverity = emptySeverityCounts();
  const byCategory: Record<string, number> = {};
  for (const issue of issues) {
    bySeverity[issue.severity] += 1;
    byCategory[issue.category] = (byCategory[issue.category] ?? 0) + 1;
  }
  return {
    issueCount: issues.length,
    bySeverity,
    byCategory,
    failedRuleIds,
    passedRuleIds,
  };
}

function emptySeverityCounts(): Record<EstimateValidationSeverity, number> {
  return { info: 0, warning: 0, error: 0, critical: 0 };
}

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toFiniteNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "string" ? Number(value.replace(/[%,$,\s]/g, "")) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeToken(value: unknown) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizeCategory(value: unknown, fallback?: unknown) {
  return normalizeToken(normalizeText(value) || normalizeText(fallback));
}

function normalizeUom(value: unknown) {
  return normalizeText(value).toUpperCase().replace(/[\s._-]+/g, "");
}

function roundNumber(value: number) {
  return Math.round(value * 100) / 100;
}

function clampImpact(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(value, 1));
}

function createCategoryMap(categories: EstimateValidationEntityCategoryLike[]) {
  const categoryByName = new Map<string, EstimateValidationEntityCategoryLike>();
  for (const category of categories) {
    const key = normalizeCategory(category.name, category.entityType);
    if (key) {
      categoryByName.set(key, category);
    }
  }
  return categoryByName;
}

function categoryForItem(
  item: EstimateValidationWorksheetItemLike,
  context: EstimateValidationContext,
) {
  return context.categoryByName.get(normalizeCategory(item.category, item.entityType)) ?? null;
}

function collectKnownIds(
  direct: Array<{ id?: string | null }>,
  nested: Array<{ id?: string | null }>,
) {
  const ids = new Set<string>();
  for (const entry of [...direct, ...nested]) {
    const id = normalizeText(entry.id);
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

function indexLinksByItemId(links: EstimateValidationEvidenceLinkLike[]) {
  const byItemId = new Map<string, EstimateValidationEvidenceLinkLike[]>();
  for (const link of links) {
    const itemId = normalizeText(link.worksheetItemId ?? link.itemId ?? link.lineItemId);
    if (!itemId) {
      continue;
    }
    const entries = byItemId.get(itemId) ?? [];
    entries.push(link);
    byItemId.set(itemId, entries);
  }
  return byItemId;
}

function displayWorksheetName(worksheet: EstimateValidationWorksheetLike) {
  return normalizeText(worksheet.name) || normalizeText(worksheet.id) || "Unnamed worksheet";
}

function displayItemName(item: EstimateValidationWorksheetItemLike) {
  return normalizeText(item.entityName)
    || normalizeText(item.description)
    || normalizeText(item.id)
    || "Unnamed item";
}

function worksheetRef(worksheet: EstimateValidationWorksheetLike): EstimateValidationElementRef {
  return {
    type: "worksheet",
    id: normalizeText(worksheet.id) || undefined,
    label: displayWorksheetName(worksheet),
  };
}

function itemRef(row: EstimateValidationWorksheetItemRow): EstimateValidationElementRef {
  const itemId = normalizeText(row.item.id) || undefined;
  const worksheetId = normalizeText(row.worksheet?.id ?? row.item.worksheetId) || undefined;
  return {
    type: "worksheet-item",
    id: itemId,
    itemId,
    worksheetId,
    label: displayItemName(row.item),
  };
}

function packageRef(
  entry: EstimateValidationPackagePlanEntryLike,
  index: number,
  pathSuffix?: string,
): EstimateValidationElementRef {
  const id = normalizeText(entry.id) || `package-${index + 1}`;
  return {
    type: "package-plan-entry",
    id,
    label: normalizeText(entry.name) || id,
    path: pathSuffix ? `estimateStrategy.packagePlan[${index}].${pathSuffix}` : `estimateStrategy.packagePlan[${index}]`,
  };
}

function hasKnownTierId(knownTierIds: Set<string>, tierId: string) {
  return knownTierIds.has(tierId) || Array.from(knownTierIds).some((knownId) => knownId.startsWith(tierId));
}

function sumPositiveTierUnits(tierUnits: EstimateValidationWorksheetItemLike["tierUnits"]): number {
  return Object.values(tierUnits ?? {}).reduce<number>((sum, value) => {
    const parsed = toFiniteNumber(value);
    return parsed > 0 ? sum + parsed : sum;
  }, 0);
}

function nearlyEqual(left: number, right: number, tolerance: number) {
  return Math.abs(left - right) <= tolerance;
}

function itemSignature(item: EstimateValidationWorksheetItemLike) {
  const name = normalizeToken(item.entityName);
  const description = normalizeToken(item.description);
  if (!name && !description) {
    return "";
  }

  return [
    normalizeCategory(item.category, item.entityType),
    name,
    description,
    normalizeUom(item.uom),
    roundNumber(toFiniteNumber(item.quantity)),
    roundNumber(toFiniteNumber(item.cost)),
    roundNumber(toFiniteNumber(item.price)),
    normalizeText(item.rateScheduleItemId),
    tierUnitsSignature(item.tierUnits),
  ].join("|");
}

function tierUnitsSignature(tierUnits: EstimateValidationWorksheetItemLike["tierUnits"]) {
  return Object.entries(tierUnits ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tierId, value]) => `${tierId}:${roundNumber(toFiniteNumber(value))}`)
    .join(",");
}

function getPackagePlan(workspace: EstimateValidationWorkspaceLike) {
  return asArray(
    workspace.estimateStrategy?.packagePlan
      ?? workspace.strategy?.packagePlan
      ?? workspace.packagePlan
      ?? null,
  ).filter((entry): entry is EstimateValidationPackagePlanEntryLike => isRecord(entry));
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
}

interface NormalizedPackageBindings {
  worksheetIds: string[];
  worksheetNames: string[];
  categories: string[];
  textMatchers: string[];
  hasAny: boolean;
}

function getPackageBindings(entry: EstimateValidationPackagePlanEntryLike): NormalizedPackageBindings {
  const explicitBindings = isRecord(entry.bindings) ? entry.bindings : {};
  const fallbackBindings = Object.keys(explicitBindings).length > 0
    ? explicitBindings
    : isRecord(entry.binding)
      ? entry.binding
      : {};
  const worksheetIds = asStringArray(fallbackBindings.worksheetIds);
  const worksheetNames = asStringArray(fallbackBindings.worksheetNames).map(normalizeToken);
  const categories = asStringArray(fallbackBindings.categories ?? fallbackBindings.categoryTargets).map((value) =>
    normalizeCategory(value),
  );
  const textMatchers = asStringArray(
    fallbackBindings.textMatchers
      ?? fallbackBindings.descriptionMatchers
      ?? fallbackBindings.itemMatchers,
  ).map(normalizeToken);

  return {
    worksheetIds,
    worksheetNames,
    categories,
    textMatchers,
    hasAny: worksheetIds.length > 0 || worksheetNames.length > 0 || categories.length > 0 || textMatchers.length > 0,
  };
}

function packageMatchesRow(
  bindings: NormalizedPackageBindings,
  row: EstimateValidationWorksheetItemRow,
) {
  const worksheetId = normalizeText(row.worksheet?.id ?? row.item.worksheetId);
  const worksheetName = normalizeToken(row.worksheet?.name);
  const category = normalizeCategory(row.item.category, row.item.entityType);
  const haystack = normalizeToken([
    row.worksheet?.name,
    row.item.category,
    row.item.entityName,
    row.item.description,
    row.item.vendor,
  ].map((value) => normalizeText(value)).join(" "));

  const worksheetIdMatch = bindings.worksheetIds.length === 0 || bindings.worksheetIds.includes(worksheetId);
  const worksheetNameMatch = bindings.worksheetNames.length === 0 || bindings.worksheetNames.some((target) =>
    worksheetName === target || worksheetName.includes(target) || target.includes(worksheetName),
  );
  const categoryMatch = bindings.categories.length === 0 || bindings.categories.includes(category);
  const textMatch = bindings.textMatchers.length === 0 || bindings.textMatchers.some((matcher) => haystack.includes(matcher));
  return worksheetIdMatch && worksheetNameMatch && categoryMatch && textMatch;
}

function isCommercialRow(item: EstimateValidationWorksheetItemLike) {
  return toFiniteNumber(item.quantity) > 0
    && (
      toFiniteNumber(item.cost) > 0
      || toFiniteNumber(item.price) > 0
      || sumPositiveTierUnits(item.tierUnits) > 0
    );
}

function getSourceEvidenceRecord(item: EstimateValidationWorksheetItemLike): Record<string, unknown> {
  if (isPlainObject(item.sourceEvidence)) {
    return item.sourceEvidence;
  }
  const nested = nestedMetadataValue(item, "sourceEvidence");
  return isPlainObject(nested) ? nested : {};
}

function hasStructuredCostSource(item: EstimateValidationWorksheetItemLike) {
  return [
    item.rateScheduleItemId,
    item.itemId,
    item.costResourceId,
    item.effectiveCostId,
    item.laborUnitId,
    item.sourceAssemblyId,
    item.assemblyInstanceId,
  ].some((value) => !!normalizeText(value))
    || collectItemResources(item).length > 0;
}

function hasCitedExternalBasis(item: EstimateValidationWorksheetItemLike) {
  const evidence = getSourceEvidenceRecord(item);
  const evidenceSource = normalizeToken(evidence.source ?? evidence.kind ?? evidence.sourceType);
  if (evidenceSource && !["freeform", "manual", "unknown"].includes(evidenceSource)) {
    return true;
  }
  return /\b(websearch|webfetch|https?:\/\/|vendor quote|supplier quote|quote #|proposal|allowance|budget|fixed price|subcontract)\b/i
    .test(normalizeText(item.sourceNotes));
}

function hasCostBasisEvidence(item: EstimateValidationWorksheetItemLike) {
  return hasStructuredCostSource(item) || hasCitedExternalBasis(item);
}

function firstDateFromUnknownSources(sources: unknown[], keys: readonly string[]): Date | null {
  for (const source of sources) {
    if (!isPlainObject(source)) {
      continue;
    }
    const direct = firstDateFromRecord(source, keys);
    if (direct) {
      return direct;
    }
    for (const nestedKey of ["sourceEvidence", "metadata", "pricing", "cost", "effectiveCost"]) {
      const nested = source[nestedKey];
      if (isPlainObject(nested)) {
        const nestedDate = firstDateFromRecord(nested, keys);
        if (nestedDate) {
          return nestedDate;
        }
      }
    }
    const resources = source.resources ?? source.components;
    if (Array.isArray(resources)) {
      const resourceDate = firstDateFromUnknownSources(resources, keys);
      if (resourceDate) {
        return resourceDate;
      }
    }
  }
  return null;
}

function expectsLaborBasis(item: EstimateValidationWorksheetItemLike) {
  const expectedType = expectedResourceTypeForItem(item);
  const hasHours = sumPositiveTierUnits(item.tierUnits) > 0;
  return expectedType === "labor" && hasHours;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function daysBetween(start: Date | null, end: Date): number | null {
  if (!start || !Number.isFinite(end.getTime())) {
    return null;
  }
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  return Number.isFinite(days) && days >= 0 ? days : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nestedMetadataValue(value: unknown, key: string): unknown {
  if (!isPlainObject(value)) {
    return undefined;
  }
  if (value[key] !== undefined) {
    return value[key];
  }
  const metadata = value.metadata;
  return isPlainObject(metadata) ? metadata[key] : undefined;
}

function nestedMetadataRecord(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    return {};
  }
  const metadata = value.metadata;
  return isPlainObject(metadata) ? metadata : {};
}

function firstFiniteNumberFromRecord(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const direct = toFiniteNumberOrNull(record[key]);
    if (direct !== null) {
      return direct;
    }
    const nested = toFiniteNumberOrNull(nestedMetadataValue(record, key));
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

function firstDateFromRecord(record: Record<string, unknown>, keys: readonly string[]): Date | null {
  for (const key of keys) {
    const direct = parseDate(record[key]);
    if (direct) {
      return direct;
    }
    const nested = parseDate(nestedMetadataValue(record, key));
    if (nested) {
      return nested;
    }
  }
  return null;
}

function getPricingDate(item: EstimateValidationWorksheetItemLike): Date | null {
  return firstDateFromRecord(item, [
    "pricingUpdatedAt",
    "priceUpdatedAt",
    "pricedAt",
    "costUpdatedAt",
    "rateUpdatedAt",
    "catalogUpdatedAt",
    "sourcePriceUpdatedAt",
    "priceAsOf",
    "costAsOf",
    "quoteDate",
    "supplierQuoteDate",
  ]);
}

function normalizeConfidence(value: unknown): number | null {
  const parsed = toFiniteNumberOrNull(value);
  if (parsed === null) {
    const text = normalizeToken(value);
    if (text === "verified" || text === "high") {
      return 0.9;
    }
    if (text === "medium" || text === "med") {
      return 0.65;
    }
    if (text === "low") {
      return 0.3;
    }
    if (text === "unknown") {
      return 0.5;
    }
    return null;
  }

  const normalized = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  return Math.max(0, Math.min(1, normalized));
}

function getItemConfidence(item: EstimateValidationWorksheetItemLike): number | null {
  const values = [
    item.confidence,
    item.confidenceScore,
    item.quantityConfidence,
    item.pricingConfidence,
    item.sourceConfidence,
    nestedMetadataValue(item, "confidence"),
    nestedMetadataValue(item, "confidenceScore"),
    nestedMetadataValue(item, "quantityConfidence"),
    nestedMetadataValue(item, "pricingConfidence"),
    nestedMetadataValue(item, "sourceConfidence"),
  ]
    .map(normalizeConfidence)
    .filter((value): value is number => value !== null);

  if (values.length === 0) {
    return null;
  }
  return Math.min(...values);
}

function isAssemblyBacked(item: EstimateValidationWorksheetItemLike): boolean {
  return [
    item.sourceAssemblyId,
    item.assemblyInstanceId,
    nestedMetadataValue(item, "sourceAssemblyId"),
    nestedMetadataValue(item, "assemblyInstanceId"),
    nestedMetadataValue(item, "assemblyId"),
  ].some((value) => !!normalizeText(value))
    || normalizeToken(nestedMetadataValue(item, "sourceKind")) === "assembly";
}

function collectItemResources(item: EstimateValidationWorksheetItemLike): Record<string, unknown>[] {
  const candidates = [
    item.resources,
    item.resourceComposition,
    item.resourceSnapshot,
    item.assemblyResources,
    item.assemblyComponents,
    nestedMetadataValue(item, "resources"),
    nestedMetadataValue(item, "resourceComposition"),
    nestedMetadataValue(item, "resourceSnapshot"),
    nestedMetadataValue(item, "assemblyResources"),
    nestedMetadataValue(item, "assemblyComponents"),
  ];

  const resources: Record<string, unknown>[] = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      resources.push(...candidate.filter(isPlainObject));
      continue;
    }
    if (isPlainObject(candidate)) {
      const nestedResources = candidate.resources ?? candidate.components ?? candidate.lines;
      if (Array.isArray(nestedResources)) {
        resources.push(...nestedResources.filter(isPlainObject));
      }
    }
  }

  return resources;
}

function expectedResourceTypeForItem(item: EstimateValidationWorksheetItemLike): string | null {
  const category = normalizeToken(item.category || item.entityType);
  if (/\blabou?r\b|\bcrew\b|\btrade\b/.test(category)) {
    return "labor";
  }
  if (/\bmaterial\b|\bmaterials\b|\bcatalog\b|\bstock\b/.test(category)) {
    return "material";
  }
  if (/\bequipment\b|\brental\b/.test(category)) {
    return "equipment";
  }
  if (/\bsubcontract\b|\bsub\b/.test(category)) {
    return "subcontractor";
  }
  return null;
}

function resourceTypeFor(resource: Record<string, unknown>): string | null {
  const text = normalizeToken(
    resource.type
      ?? resource.resourceType
      ?? resource.category
      ?? nestedMetadataValue(resource, "resourceType")
      ?? nestedMetadataValue(resource, "type"),
  );
  if (!text) {
    const sourceKind = normalizeToken(
      isPlainObject(resource.source) ? resource.source.kind : resource.source,
    );
    if (sourceKind === "rate schedule item" || sourceKind === "rate_schedule_item") {
      return "labor";
    }
    if (sourceKind === "catalog item" || sourceKind === "catalog_item") {
      return "material";
    }
    return null;
  }
  if (text.includes("labour") || text.includes("labor") || text.includes("crew")) {
    return "labor";
  }
  if (text.includes("material") || text.includes("catalog") || text.includes("stock")) {
    return "material";
  }
  if (text.includes("equipment") || text.includes("rental")) {
    return "equipment";
  }
  if (text.includes("subcontract") || text === "sub") {
    return "subcontractor";
  }
  if (text === "other" || text === "general") {
    return "other";
  }
  return text;
}

function getResourceSnapshotTotals(
  item: EstimateValidationWorksheetItemLike,
  resources: Record<string, unknown>[],
): { unitCost: number; unitPrice: number } {
  const snapshotCandidates = [item.resourceComposition, item.resourceSnapshot, nestedMetadataValue(item, "resourceComposition"), nestedMetadataValue(item, "resourceSnapshot")]
    .filter(isPlainObject);
  for (const snapshot of snapshotCandidates) {
    const unitCost = firstFiniteNumberFromRecord(snapshot, ["unitCost", "cost"]);
    const unitPrice = firstFiniteNumberFromRecord(snapshot, ["unitPrice", "price"]);
    if (unitCost !== null || unitPrice !== null) {
      return {
        unitCost: unitCost ?? 0,
        unitPrice: unitPrice ?? 0,
      };
    }
  }

  return resources.reduce<{ unitCost: number; unitPrice: number }>(
    (totals, resource) => {
      const quantityPerUnit = firstFiniteNumberFromRecord(resource, ["quantityPerUnit", "quantity", "qty"]) ?? 1;
      const unitCost = firstFiniteNumberFromRecord(resource, ["unitCost", "cost", "costRate"]) ?? 0;
      const unitPrice = firstFiniteNumberFromRecord(resource, ["unitPrice", "price", "rate"]) ?? 0;
      totals.unitCost += quantityPerUnit * unitCost;
      totals.unitPrice += quantityPerUnit * unitPrice;
      return totals;
    },
    { unitCost: 0, unitPrice: 0 },
  );
}

function relativeVariance(actual: number, benchmark: number): number | null {
  if (actual <= 0 || benchmark <= 0) {
    return null;
  }
  return Math.abs(actual - benchmark) / benchmark;
}

function getPriceBenchmarks(item: EstimateValidationWorksheetItemLike) {
  const metadata = nestedMetadataRecord(item);
  const costKeys = [
    "benchmarkUnitCost",
    "matchedUnitCost",
    "historicalUnitCost",
    "catalogUnitCost",
    "supplierUnitCost",
    "lastUnitCost",
    "previousUnitCost",
    "marketUnitCost",
  ];
  const priceKeys = [
    "benchmarkUnitPrice",
    "matchedUnitPrice",
    "historicalUnitPrice",
    "catalogUnitPrice",
    "supplierUnitPrice",
    "lastUnitPrice",
    "previousUnitPrice",
    "marketUnitPrice",
  ];
  const comparisons: Array<{ field: "cost" | "price"; label: string; value: number }> = [];

  for (const key of costKeys) {
    const value = toFiniteNumberOrNull(item[key] ?? metadata[key]);
    if (value !== null && value > 0) {
      comparisons.push({ field: "cost", label: labelForBenchmarkKey(key), value });
    }
  }
  for (const key of priceKeys) {
    const value = toFiniteNumberOrNull(item[key] ?? metadata[key]);
    if (value !== null && value > 0) {
      comparisons.push({ field: "price", label: labelForBenchmarkKey(key), value });
    }
  }

  return comparisons;
}

function labelForBenchmarkKey(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toLowerCase())
    .trim();
}

const measuredUoms = new Set([
  "LF",
  "FT",
  "FOOT",
  "FEET",
  "SF",
  "SQFT",
  "SQFEET",
  "SQUAREFOOT",
  "SQUAREFEET",
  "SY",
  "CY",
  "CF",
  "YD",
  "M",
  "M2",
  "M3",
  "SM",
]);

const countUoms = new Set(["EA", "EACH", "PCS", "PC", "COUNT"]);

function looksTakeoffDriven(item: EstimateValidationWorksheetItemLike) {
  const quantity = toFiniteNumber(item.quantity);
  if (quantity <= 1) {
    return false;
  }

  const uom = normalizeUom(item.uom);
  const text = normalizeToken([
    item.sourceNotes,
    item.description,
    item.entityName,
  ].map((value) => normalizeText(value)).join(" "));
  const hasTakeoffLanguage = /\b(takeoff|drawing|sheet|plan|scaled|measur|counted|model|bim|annotation|area|linear|volume|length|sf|sqft|lf)\b/.test(text);

  if (hasTakeoffLanguage) {
    return true;
  }
  if (measuredUoms.has(uom) && (quantity >= 10 || !Number.isInteger(quantity))) {
    return true;
  }
  return countUoms.has(uom) && quantity >= 50 && !Number.isInteger(quantity);
}

function hasDirectQuantityEvidenceLink(
  item: EstimateValidationWorksheetItemLike,
  context: EstimateValidationContext,
) {
  const itemId = normalizeText(item.id);
  if (itemId) {
    if ((context.takeoffLinksByItemId.get(itemId)?.length ?? 0) > 0) {
      return true;
    }
    if ((context.modelTakeoffLinksByItemId.get(itemId)?.length ?? 0) > 0) {
      return true;
    }
    if ((context.evidenceLinksByItemId.get(itemId)?.some(isQuantityEvidenceLink) ?? false)) {
      return true;
    }
  }

  const arrayEvidenceKeys = [
    "takeoffLinks",
    "modelTakeoffLinks",
    "evidenceLinks",
    "modelLinks",
  ];
  if (arrayEvidenceKeys.some((key) => Array.isArray(item[key]) && (item[key] as unknown[]).some(isQuantityEvidenceLink))) {
    return true;
  }

  return [
    item.takeoffLinkId,
    item.modelTakeoffLinkId,
    item.evidenceLinkId,
    item.modelQuantityId,
    item.annotationId,
  ].some((value) => !!normalizeText(value));
}

function isQuantityEvidenceLink(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return true;
  }
  const kind = normalizeToken(value.kind ?? value.type ?? value.evidenceKind ?? nestedMetadataValue(value, "kind"));
  if (/\b(takeoff|model|quantity|annotation|measurement)\b/.test(kind)) {
    return true;
  }
  if (Array.isArray(value.facets) && value.facets.some((facet) => normalizeToken(facet) === "quantity")) {
    return true;
  }
  return ["derivedQuantity", "quantity", "measurement", "annotationId", "takeoffLinkId", "modelTakeoffLinkId"]
    .some((key) => value[key] !== undefined || nestedMetadataValue(value, key) !== undefined);
}
