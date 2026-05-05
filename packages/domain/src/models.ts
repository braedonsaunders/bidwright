import type { CalculationType } from "./calculation-types";
import type { LineTotal, MarkupRatio, PerUnitCost } from "./money";
import type { UnitOfMeasure } from "./uom";

export type ProjectIngestionStatus = "queued" | "processing" | "ready" | "review" | "quoted" | "estimating";
export type QuoteStatus = "draft" | "review" | "submitted" | "awarded" | "lost";
export type AiRunStatus = "queued" | "running" | "complete" | "failed";
export type CatalogKind = string;

export interface Project {
  id: string;
  name: string;
  clientName: string;
  location: string;
  scope: string;
  packageName: string;
  packageUploadedAt: string;
  ingestionStatus: ProjectIngestionStatus;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceDocumentStructuredData {
  tables?: Array<{
    pageNumber: number;
    headers: string[];
    rows: string[][];
    rawMarkdown: string;
  }>;
  keyValuePairs?: Array<{ key: string; value: string; confidence: number }>;
  selectionMarks?: Array<{ state: string; pageNumber: number; confidence: number }>;
}

export interface SourceDocument {
  id: string;
  projectId: string;
  fileName: string;
  fileType: string;
  documentType: "rfq" | "spec" | "drawing" | "addendum" | "vendor" | "reference";
  pageCount: number;
  checksum: string;
  storagePath: string;
  extractedText: string;
  structuredData?: SourceDocumentStructuredData | null;
  createdAt: string;
  updatedAt: string;
}

export interface Quote {
  id: string;
  projectId: string;
  quoteNumber: string;
  title: string;
  status: QuoteStatus;
  currentRevisionId: string;
  customerExistingNew: "Existing" | "New";
  customerId: string | null;
  customerName?: string | null;
  customerString: string;
  customerContactId: string | null;
  customerContactString: string;
  customerContactEmailString: string;
  departmentId: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Customers ──────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  organizationId: string;
  name: string;
  shortName: string;
  phone: string;
  email: string;
  website: string;
  addressStreet: string;
  addressCity: string;
  addressProvince: string;
  addressPostalCode: string;
  addressCountry: string;
  notes: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerContact {
  id: string;
  customerId: string;
  name: string;
  title: string;
  phone: string;
  email: string;
  isPrimary: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerWithContacts extends Customer {
  contacts: CustomerContact[];
}

// ── Departments ────────────────────────────────────────────────────────

export interface Department {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteRevision {
  id: string;
  quoteId: string;
  revisionNumber: number;
  title: string;
  description: string;
  notes: string;
  breakoutStyle: "grand_total" | "category" | "phase" | "phase_detail" | "labour_material_equipment";
  type: "Firm" | "Budget" | "BudgetDNE";
  scratchpad: string;
  leadLetter: string;
  dateEstimatedShip: string | null;
  dateQuote: string | null;
  dateDue: string | null;
  dateWalkdown: string | null;
  dateWorkStart: string | null;
  dateWorkEnd: string | null;
  shippingMethod: string;
  shippingTerms: string;
  freightOnBoard: string;
  status: "Open" | "Pending" | "Awarded" | "DidNotGet" | "Declined" | "Cancelled" | "Closed" | "Other";
  defaultMarkup: number;
  laborDifficulty: string;
  followUpNote: string;
  printEmptyNotesColumn: boolean;
  printCategory: string[];
  printPhaseTotalOnly: boolean;
  grandTotal: number;
  regHours: number;
  overHours: number;
  doubleHours: number;
  breakoutPackage: unknown[];
  calculatedCategoryTotals: unknown[];
  summaryLayoutPreset: SummaryPreset;
  pdfPreferences: Record<string, unknown>;
  pricingLadder: PricingLadderSnapshot;
  subtotal: number;
  cost: number;
  estimatedProfit: number;
  estimatedMargin: number;
  calculatedTotal?: number;
  totalHours: number;
  createdAt: string;
  updatedAt: string;
}

export interface Worksheet {
  id: string;
  revisionId: string;
  folderId?: string | null;
  name: string;
  order: number;
}

export interface WorksheetFolder {
  id: string;
  revisionId: string;
  parentId?: string | null;
  name: string;
  order: number;
}

export type WorksheetItemSourceBasisKind =
  | "takeoff"
  | "model_takeoff"
  | "dwg_takeoff"
  | "cost_intelligence_exact"
  | "cost_intelligence_similar"
  | "cost_intelligence_context"
  | "labor_unit"
  | "catalog"
  | "rate_schedule"
  | "assembly"
  | "plugin"
  | "document"
  | "assumption"
  | "manual";

export type WorksheetItemSourceBasisMatchType = "exact" | "similar" | "context" | "fallback";
export type WorksheetItemSourceQuality = "strong" | "good" | "weak" | "missing";

export interface WorksheetItemSourceBasis {
  kind: WorksheetItemSourceBasisKind;
  label: string;
  description?: string;
  matchType?: WorksheetItemSourceBasisMatchType;
  sourceQuality?: WorksheetItemSourceQuality;
  confidence?: number;
  query?: string;
  sourceType?: string;
  sourceId?: string | null;
  sourceName?: string;
  documentId?: string;
  pageNumber?: number;
  annotationId?: string;
  takeoffLinkId?: string;
  modelId?: string;
  modelElementId?: string;
  modelTakeoffLinkId?: string;
  costResourceId?: string | null;
  effectiveCostId?: string | null;
  laborUnitId?: string | null;
  rateScheduleItemId?: string | null;
  itemId?: string | null;
  vendor?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface WorksheetItemSourceEvidence {
  basis?: WorksheetItemSourceBasis;
  basisTrail?: WorksheetItemSourceBasis[];
  pricing?: Record<string, unknown>;
  labor?: Record<string, unknown>;
  takeoff?: Record<string, unknown>;
  warnings?: string[];
  sourceQuality?: WorksheetItemSourceQuality;
  matchType?: WorksheetItemSourceBasisMatchType;
  [key: string]: unknown;
}

export interface WorksheetItem {
  id: string;
  worksheetId: string;
  phaseId?: string | null;
  categoryId?: string | null;
  category: string;
  entityType: string;
  entityName: string;
  classification?: WorksheetItemClassification;
  costCode?: string | null;
  vendor?: string;
  description: string;
  quantity: number;
  uom: string;
  cost: number;
  markup: number;
  price: number;
  lineOrder: number;
  rateScheduleItemId?: string | null;
  itemId?: string | null;
  tierUnits?: Record<string, number>;
  /**
   * Snapshot of the source that produced this row's `cost` / `price` the
   * last time the engine resolved it. Lets the UI show "priced from
   * vendor X on date Y" and detect when the underlying library has moved
   * since the snapshot was taken.
   */
  costSnapshot?: CostSnapshot;
  /**
   * Rate-book pricing audit for this row. It explains how the imported quote
   * rate book priced the resource and overrode the row's base cost/price.
   */
  rateResolution?: RateResolutionSnapshot | null;
  sourceNotes?: string;
  costResourceId?: string | null;
  effectiveCostId?: string | null;
  laborUnitId?: string | null;
  resourceComposition?: Record<string, unknown>;
  sourceEvidence?: WorksheetItemSourceEvidence;
  sourceAssemblyId?: string | null;
  assemblyInstanceId?: string | null;
}

/** Where a worksheet item's cost/price came from when it was last priced. */
export type CostSnapshotSource =
  | "manual"
  | "catalog"
  | "rate_schedule"
  | "effective_cost"
  | "labor_unit"
  | "assembly"
  | "ai"
  | "import";

export interface CostSnapshot {
  /** Which library / origin produced the cost. */
  source: CostSnapshotSource;
  /** FK of the source record (CatalogItem.id, EffectiveCost.id, …). */
  sourceId: string | null;
  /** Optional human-readable label for UI badges. */
  sourceLabel?: string;
  /** ISO timestamp of when the snapshot was captured. */
  snapshotAt: string;
  /** The per-unit cost at the moment of capture. */
  originalUnitCost: number;
  /** Optional per-unit price at the moment of capture. */
  originalUnitPrice?: number;
  /** Optional currency tag for international snapshots. */
  currency?: string;
  /** Optional region tag for regional pricing. */
  region?: string;
}

export interface RateResolutionComponent {
  id: string;
  code: string;
  label: string;
  kind: string;
  source: "rate_book" | "manual" | "catalog" | "system";
  target: "cost" | "price" | "both";
  basis: string;
  quantity: number;
  rate: number;
  amount: number;
  rateBookId?: string | null;
  rateBookItemId?: string | null;
  tierId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RateResolutionSnapshot {
  source: "rate_book" | "manual";
  engineVersion: number;
  resolvedAt: string;
  projectId?: string | null;
  revisionId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  entityType?: string | null;
  rateBookId?: string | null;
  rateBookName?: string | null;
  rateBookItemId?: string | null;
  rateBookItemName?: string | null;
  resourceId?: string | null;
  catalogItemId?: string | null;
  currency?: string;
  region?: string;
  quantity: number;
  uom: string;
  tierUnits: Record<string, number>;
  components: RateResolutionComponent[];
  baseCost: number;
  basePrice: number;
  totalCost: number;
  unitCost: number;
  totalPrice: number;
  markup: number;
  warnings: string[];
}

export interface Phase {
  id: string;
  revisionId: string;
  parentId?: string | null;
  number: string;
  name: string;
  description: string;
  order: number;
  startDate?: string | null;
  endDate?: string | null;
  color?: string;
}

// ── Schedule Tasks ──────────────────────────────────────────────────────

export type ScheduleTaskType = "task" | "milestone" | "summary";
export type ScheduleTaskStatus = "not_started" | "in_progress" | "complete" | "on_hold";
export type DependencyType = "FS" | "SS" | "FF" | "SF";
export type ScheduleConstraintType =
  | "asap"
  | "alap"
  | "snet"
  | "snlt"
  | "fnet"
  | "fnlt"
  | "mso"
  | "mfo";
export type ScheduleBaselineKind = "primary" | "secondary" | "tertiary" | "snapshot" | "custom";
export type ScheduleResourceKind = "labor" | "crew" | "equipment" | "subcontractor";

export interface ScheduleCalendar {
  id: string;
  projectId: string;
  revisionId: string;
  name: string;
  description: string;
  isDefault: boolean;
  workingDays: Record<string, boolean>;
  shiftStartMinutes: number;
  shiftEndMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleResource {
  id: string;
  projectId: string;
  revisionId: string;
  calendarId: string | null;
  name: string;
  role: string;
  kind: ScheduleResourceKind;
  color: string;
  defaultUnits: number;
  capacityPerDay: number;
  costRate: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleTaskAssignment {
  id: string;
  taskId: string;
  resourceId: string;
  units: number;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleBaseline {
  id: string;
  projectId: string;
  revisionId: string;
  name: string;
  description: string;
  kind: ScheduleBaselineKind;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleBaselineTask {
  id: string;
  baselineId: string;
  taskId: string;
  taskName: string;
  phaseId: string | null;
  startDate: string | null;
  endDate: string | null;
  duration: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleTask {
  id: string;
  projectId: string;
  revisionId: string;
  phaseId: string | null;
  calendarId: string | null;
  parentTaskId: string | null;
  outlineLevel: number;
  name: string;
  description: string;
  taskType: ScheduleTaskType;
  status: ScheduleTaskStatus;
  startDate: string | null;
  endDate: string | null;
  duration: number;
  progress: number;
  assignee: string;
  order: number;
  constraintType: ScheduleConstraintType;
  constraintDate: string | null;
  deadlineDate: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  baselineStart: string | null;
  baselineEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleDependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
}

export type AdjustmentKind = "modifier" | "line_item";
export type AdjustmentPricingMode =
  | "modifier"
  | "option_standalone"
  | "option_additional"
  | "line_item_additional"
  | "line_item_standalone"
  | "custom_total";
export type AdjustmentFinancialCategory =
  | "overhead"
  | "profit"
  | "tax"
  | "contingency"
  | "insurance"
  | "bond"
  | "allowance"
  | "alternate"
  | "fee"
  | "other";
export type AdjustmentCalculationBase =
  | "selected_scope"
  | "line_subtotal"
  | "direct_cost"
  | "cumulative";

export interface Adjustment {
  id: string;
  revisionId: string;
  order: number;
  kind: AdjustmentKind;
  pricingMode: AdjustmentPricingMode;
  name: string;
  description: string;
  type: string;
  financialCategory: AdjustmentFinancialCategory | string;
  calculationBase: AdjustmentCalculationBase | string;
  active: boolean;
  appliesTo: string;
  percentage: number | null;
  amount: number | null;
  show: "Yes" | "No";
}

export type EstimateFactorImpact = "labor_hours" | "resource_units" | "direct_cost" | "sell_price";
export type EstimateFactorConfidence = "high" | "medium" | "low";
export type EstimateFactorSourceType = "library" | "knowledge" | "labor_unit" | "condition_difficulty" | "neca_difficulty" | "custom" | "agent";
export type EstimateFactorApplicationScope = "global" | "line" | "both";
export type EstimateFactorFormulaType =
  | "fixed_multiplier"
  | "per_unit_scale"
  | "condition_score"
  | "temperature_productivity"
  | "neca_condition_score"
  | "extended_duration";

export interface EstimateFactorScope {
  mode?: "all" | "line" | "category" | "phase" | "worksheet" | "classification" | "labor_unit" | "cost_code" | "text";
  worksheetItemIds?: string[];
  categoryIds?: string[];
  categoryNames?: string[];
  analyticsBuckets?: string[];
  phaseIds?: string[];
  worksheetIds?: string[];
  classificationCodes?: string[];
  laborUnitIds?: string[];
  costCodes?: string[];
  text?: string[];
  [key: string]: unknown;
}

export interface EstimateFactor {
  id: string;
  revisionId: string;
  order: number;
  name: string;
  code: string;
  description: string;
  category: string;
  impact: EstimateFactorImpact;
  value: number;
  active: boolean;
  appliesTo: string;
  applicationScope: EstimateFactorApplicationScope;
  scope: EstimateFactorScope;
  formulaType: EstimateFactorFormulaType;
  parameters: Record<string, unknown>;
  confidence: EstimateFactorConfidence;
  sourceType: EstimateFactorSourceType;
  sourceId?: string | null;
  sourceRef: Record<string, unknown>;
  tags: string[];
}

export interface EstimateFactorLibraryEntry {
  id: string;
  organizationId: string;
  order: number;
  name: string;
  code: string;
  description: string;
  category: string;
  impact: EstimateFactorImpact;
  value: number;
  appliesTo: string;
  applicationScope: EstimateFactorApplicationScope;
  scope: EstimateFactorScope;
  formulaType: EstimateFactorFormulaType;
  parameters: Record<string, unknown>;
  confidence: EstimateFactorConfidence;
  sourceType: EstimateFactorSourceType;
  sourceId?: string | null;
  sourceRef: Record<string, unknown>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Modifier {
  id: string;
  revisionId: string;
  name: string;
  type: string;
  appliesTo: string;
  percentage: number | null;
  amount: number | null;
  show: "Yes" | "No";
}

export interface AdditionalLineItem {
  id: string;
  revisionId: string;
  name: string;
  description?: string;
  type:
    | "OptionStandalone"
    | "OptionAdditional"
    | "LineItemAdditional"
    | "LineItemStandalone"
    | "CustomTotal";
  amount: number;
}

export type ConstructionClassificationStandard =
  | "masterformat"
  | "uniformat"
  | "omniclass"
  | "uniclass"
  | "din276"
  | "nrm"
  | "icms"
  | "cost_code";
export type ConstructionClassificationLevel = "division" | "section" | "full";
export type WorksheetItemClassification = Record<string, unknown>;

export interface SummaryBuilderClassificationConfig {
  standard: ConstructionClassificationStandard;
  level: ConstructionClassificationLevel;
  includeUnclassified: boolean;
}

export type SummaryRowType = "category" | "phase" | "worksheet" | "classification" | "adjustment" | "heading" | "separator" | "subtotal";
export type SummaryRowStyle = "normal" | "bold" | "indent" | "highlight";
export type SummaryPreset =
  | "quick_total"
  | "by_category"
  | "by_phase"
  | "by_worksheet"
  | "by_masterformat_division"
  | "by_uniformat_division"
  | "by_omniclass_division"
  | "by_uniclass_division"
  | "by_din276_division"
  | "by_nrm_division"
  | "by_icms_division"
  | "by_cost_code"
  | "phase_x_category"
  | "custom";
export type SummaryBuilderMode = "total" | "grouped" | "pivot";
export type SummaryBuilderDimension = "none" | "phase" | "category" | "worksheet" | "classification";

export interface SummaryBuilderAxisItem {
  key: string;
  sourceId: string | null;
  label: string;
  visible: boolean;
  order: number;
}

export interface SummaryBuilderConfig {
  version: 1;
  preset: SummaryPreset;
  mode: SummaryBuilderMode;
  rowDimension: SummaryBuilderDimension;
  columnDimension: SummaryBuilderDimension;
  rows: SummaryBuilderAxisItem[];
  columns: SummaryBuilderAxisItem[];
  classification: SummaryBuilderClassificationConfig;
  totals: {
    label: string;
    visible: boolean;
  };
}

export interface SummaryRow {
  id: string;
  revisionId: string;
  type: SummaryRowType;
  label: string;
  order: number;
  visible: boolean;
  style: SummaryRowStyle;

  // Auto source
  sourceCategoryId?: string | null;
  sourceCategoryLabel?: string | null;
  sourcePhaseId?: string | null;
  sourceWorksheetId?: string | null;
  sourceWorksheetLabel?: string | null;
  sourceClassificationId?: string | null;
  sourceClassificationLabel?: string | null;
  sourceAdjustmentId?: string | null;

  // Manual rows: direct value entry (not backed by items)

  // Auto row override: when set on auto_category/auto_phase rows,
  // this value is used INSTEAD of the aggregated value from items.
  // Set to null to go back to fully-auto. This lets users "pin" a
  // number while keeping the row linked to its source.

  // Modifier fields

  // Computed (filled by recalculate — reflects override if set)
  computedValue: number;
  computedCost: number;
  computedMargin: number;
}

export interface Condition {
  id: string;
  revisionId: string;
  type: string;
  value: string;
  order: number;
}

export interface Catalog {
  id: string;
  name: string;
  kind: CatalogKind;
  scope: "global" | "project";
  projectId: string | null;
  description: string;
  source: string;
  sourceDescription: string;
  isTemplate: boolean;
  sourceTemplateId: string | null;
  itemCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogItem {
  id: string;
  catalogId: string;
  code: string;
  name: string;
  unit: string;
  unitCost: number;
  unitPrice: number;
  metadata: Record<string, unknown>;
}

// ── Labor Units ─────────────────────────────────────────────────────────

export interface LaborUnitLibrary {
  id: string;
  organizationId: string | null;
  cabinetId: string | null;
  name: string;
  description: string;
  provider: string;
  discipline: string;
  source: "manual" | "import" | "library" | "plugin";
  sourceDescription: string;
  sourceDatasetId: string | null;
  tags: string[];
  isTemplate: boolean;
  sourceTemplateId: string | null;
  metadata: Record<string, unknown>;
  unitCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface LaborUnit {
  id: string;
  libraryId: string;
  catalogItemId: string | null;
  code: string;
  name: string;
  description: string;
  discipline: string;
  category: string;
  className: string;
  subClassName: string;
  outputUom: string;
  hoursNormal: number;
  hoursDifficult: number | null;
  hoursVeryDifficult: number | null;
  defaultDifficulty: "normal" | "difficult" | "very_difficult";
  entityCategoryType: string;
  tags: string[];
  sourceRef: Record<string, unknown>;
  metadata: Record<string, unknown>;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ── Cost Intelligence ─────────────────────────────────────────────────

export type ResourceCatalogItemType =
  | "material"
  | "labour"
  | "equipment"
  | "subcontractor"
  | "consumable"
  | "other";

export type CostObservationDocumentType =
  | "manual"
  | "vendor_pdf"
  | "invoice"
  | "receipt"
  | "quote"
  | "price_list"
  | "catalog_import"
  | "integration";

export type EffectiveCostMethod =
  | "latest_observation"
  | "weighted_average"
  | "manual"
  | "contract";

export interface ResourceCatalogItem {
  id: string;
  organizationId: string;
  catalogItemId: string | null;
  resourceType: string;
  category: string;
  code: string;
  name: string;
  normalizedName: string;
  description: string;
  manufacturer: string;
  manufacturerPartNumber: string;
  defaultUom: string;
  aliases: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CostObservation {
  id: string;
  organizationId: string;
  resourceId: string | null;
  projectId: string | null;
  sourceDocumentId: string | null;
  vendorName: string;
  vendorSku: string;
  documentType: string;
  observedAt: string;
  effectiveDate: string | null;
  quantity: number;
  observedUom: string;
  unitCost: number;
  unitPrice: number | null;
  currency: string;
  freight: number;
  tax: number;
  discount: number;
  confidence: number;
  fingerprint: string;
  sourceRef: Record<string, unknown>;
  rawText: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveCost {
  id: string;
  organizationId: string;
  resourceId: string | null;
  resource?: ResourceCatalogItem | null;
  projectId: string | null;
  vendorName: string;
  region: string;
  uom: string;
  unitCost: number;
  unitPrice: number | null;
  currency: string;
  effectiveDate: string | null;
  expiresAt: string | null;
  sourceObservationId: string | null;
  sourceObservation?: CostObservation | null;
  method: string;
  sampleSize: number;
  confidence: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type AssemblyComponentType =
  | "catalog_item"
  | "rate_schedule_item"
  | "labor_unit"
  | "cost_intelligence"
  | "sub_assembly";

export interface AssemblyParameter {
  id: string;
  assemblyId: string;
  key: string;
  label: string;
  description: string;
  paramType: string;
  defaultValue: string;
  unit: string;
  sortOrder: number;
}

export interface AssemblyComponent {
  id: string;
  assemblyId: string;
  componentType: AssemblyComponentType;
  catalogItemId: string | null;
  rateScheduleItemId: string | null;
  laborUnitId: string | null;
  laborDifficulty: "normal" | "difficult" | "very_difficult";
  costResourceId: string | null;
  effectiveCostId: string | null;
  subAssemblyId: string | null;
  quantityExpr: string;
  description: string;
  category: string;
  uomOverride: string | null;
  costOverride: number | null;
  markupOverride: number | null;
  parameterBindings: Record<string, string>;
  notes: string;
  sortOrder: number;
}

export interface Assembly {
  id: string;
  organizationId: string | null;
  name: string;
  code: string;
  description: string;
  category: string;
  unit: string;
  isTemplate: boolean;
  sourceTemplateId: string | null;
  metadata: Record<string, unknown>;
  parameters: AssemblyParameter[];
  components: AssemblyComponent[];
  createdAt: string;
  updatedAt: string;
}

export interface AssemblySummary {
  id: string;
  name: string;
  code: string;
  category: string;
  unit: string;
  description: string;
  componentCount: number;
  parameterCount: number;
  isTemplate: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AssemblyInstanceRecord {
  id: string;
  worksheetId: string;
  assemblyId: string | null;
  assemblyName: string | null;
  phaseId: string | null;
  quantity: number;
  parameterValues: Record<string, number | string>;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiRun {
  id: string;
  projectId: string;
  revisionId: string | null;
  kind: "intake" | "scope" | "phase" | "equipment" | "qa" | "estimate";
  status: AiRunStatus;
  model: string;
  promptVersion: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type EstimateStrategyStage =
  | "scope"
  | "execution"
  | "packaging"
  | "benchmark"
  | "reconcile"
  | "complete";

export interface EstimateStrategy {
  id: string;
  projectId: string;
  revisionId: string;
  aiRunId?: string | null;
  personaId?: string | null;
  status: "draft" | "in_progress" | "ready_for_review" | "complete";
  currentStage: EstimateStrategyStage;
  scopeGraph: Record<string, unknown>;
  executionPlan: Record<string, unknown>;
  assumptions: Array<Record<string, unknown>>;
  packagePlan: Array<Record<string, unknown>>;
  benchmarkProfile: Record<string, unknown>;
  benchmarkComparables: Array<Record<string, unknown>>;
  adjustmentPlan: Array<Record<string, unknown>>;
  reconcileReport: Record<string, unknown>;
  confidenceSummary: Record<string, unknown>;
  summary: Record<string, unknown>;
  reviewRequired: boolean;
  reviewCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateCalibrationFeedback {
  id: string;
  projectId: string;
  revisionId: string;
  strategyId?: string | null;
  quoteReviewId?: string | null;
  source: string;
  feedbackType: string;
  sourceLabel: string;
  aiSnapshot: Record<string, unknown>;
  humanSnapshot: Record<string, unknown>;
  deltaSummary: Record<string, unknown>;
  corrections: Array<Record<string, unknown>>;
  lessons: Array<Record<string, unknown>>;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Citation {
  id: string;
  projectId: string;
  aiRunId: string | null;
  sourceDocumentId: string | null;
  resourceType: "source_document" | "knowledge_library" | "catalog" | "human_note";
  resourceKey: string;
  pageStart: number | null;
  pageEnd: number | null;
  excerpt: string;
  confidence: number;
}

// ── Rate Schedules ──────────────────────────────────────────────────────

export type RateScheduleScope = "global" | "revision";

export interface RateScheduleTier {
  id: string;
  scheduleId: string;
  name: string;
  multiplier: number;
  sortOrder: number;
  /** UoM this tier prices (DAY/WK/MO/HR/etc.). Calc engine prefers a tier
      whose uom matches the line item's uom before falling back to multiplier
      or name-pattern matching. */
  uom?: string | null;
}

export interface RateScheduleItem {
  id: string;
  scheduleId: string;
  catalogItemId: string | null;
  resourceId?: string | null;
  code: string;
  name: string;
  unit: string;
  rates: Record<string, number>;
  costRates: Record<string, number>;
  burden: number;
  perDiem: number;
  metadata: Record<string, unknown>;
  sortOrder: number;
}

export interface RateSchedule {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  category: string;
  scope: RateScheduleScope;
  projectId: string | null;
  revisionId: string | null;
  sourceScheduleId: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  defaultMarkup: number;
  autoCalculate: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RateScheduleWithChildren extends RateSchedule {
  tiers: RateScheduleTier[];
  items: RateScheduleItem[];
}

export interface RateBookAssignment {
  id: string;
  organizationId: string;
  rateScheduleId: string;
  customerId: string | null;
  projectId: string | null;
  category: string;
  priority: number;
  active: boolean;
  effectiveDate: string | null;
  expiryDate: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  projectId: string;
  revisionId: string | null;
  type: string;
  data: Record<string, unknown>;
  userId: string | null;
  userName: string | null;
  revertible: boolean;
  createdAt: string;
}

export interface Job {
  id: string;
  projectId: string;
  revisionId: string;
  name: string;
  foreman: string;
  projectManager: string;
  startDate: string | null;
  shipDate: string | null;
  poNumber: string;
  poIssuer: string;
  status: "Draft" | "Active" | "Complete" | "Cancelled";
  createdAt: string;
}

export interface ConditionLibraryEntry {
  id: string;
  type: string;
  value: string;
}

export interface ReportSection {
  id: string;
  revisionId: string;
  sectionType: string;
  title: string;
  content: string;
  order: number;
  parentSectionId: string | null;
}

export interface FileNode {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  type: "file" | "directory";
  scope: "project" | "knowledge";
  fileType?: string;
  size?: number;
  documentId?: string;
  storagePath?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

// ── Takeoff Annotations ──────────────────────────────────────────────────

export type TakeoffAnnotationType =
  | "linear" | "linear-polyline" | "linear-drop"
  | "count" | "count-by-distance"
  | "area-vertical-wall" | "area-rectangle" | "area-triangle" | "area-ellipse" | "area-polygon";

export interface TakeoffAnnotation {
  id: string;
  projectId: string;
  documentId: string;
  pageNumber: number;
  annotationType: TakeoffAnnotationType;
  label: string;
  color: string;
  lineThickness: number;
  visible: boolean;
  groupName: string;
  points: Array<{ x: number; y: number }>;
  measurement: { value?: number; unit?: string; area?: number; volume?: number; height?: number };
  calibration?: { pixelsPerUnit: number; unit: string } | null;
  metadata: Record<string, unknown>;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Takeoff Links ────────────────────────────────────────────────────────

export type TakeoffLinkQuantityField = "value" | "area" | "volume" | "count";

export interface TakeoffLink {
  id: string;
  projectId: string;
  annotationId: string;
  worksheetItemId: string;
  quantityField: TakeoffLinkQuantityField;
  multiplier: number;
  derivedQuantity: number;
  createdAt: string;
  updatedAt: string;
}

// ── Plugin UI Schema ──────────────────────────────────────────────────────
// Declarative schema system for rendering complex interactive plugin UIs.
// LLMs can read, populate, and invoke these schemas directly.

export type PluginFieldType =
  | "text" | "number" | "currency" | "percentage" | "boolean"
  | "select" | "multi-select" | "radio" | "slider" | "date"
  | "textarea" | "rich-text" | "hidden" | "computed" | "search";

export interface PluginFieldOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface PluginFieldValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  patternMessage?: string;
  required?: boolean;
  custom?: string; // expression evaluated at runtime
}

export interface PluginFieldConditional {
  field: string;       // field id to watch
  operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "in" | "not_in" | "contains" | "truthy" | "falsy";
  value?: unknown;
  action: "show" | "hide" | "enable" | "disable" | "set_value" | "set_options";
  actionValue?: unknown;
}

export type PluginSearchDataSourceParam =
  | string
  | number
  | boolean
  | { from: "static"; value: string | number | boolean; required?: boolean; label?: string; key?: string; default?: string | number | boolean }
  | { from: "query"; key?: string; required?: boolean; label?: string; default?: string | number | boolean }
  | { from: "field"; key: string; required?: boolean; label?: string; default?: string | number | boolean }
  | { from: "config"; key: string; env?: string; required?: boolean; label?: string; default?: string | number | boolean }
  | { from: "env"; key: string; required?: boolean; label?: string; default?: string | number | boolean }
  | { from: "limit"; min?: number; max?: number; default?: number; required?: boolean; label?: string; key?: string };

export interface PluginSearchDataSource {
  type: "http-json";
  url: string;
  method?: "GET";
  timeoutMs?: number;
  query?: Record<string, PluginSearchDataSourceParam>;
  headers?: Record<string, PluginSearchDataSourceParam>;
  resultPaths: string[];
  resultMap: Record<string, string | string[]>;
  resultDefaults?: Record<string, unknown>;
  resultTypes?: Record<string, "string" | "number" | "boolean" | "image">;
  errorPaths?: string[];
  dedupeFields?: string[];
}

export interface PluginField {
  id: string;
  type: PluginFieldType;
  label: string;
  description?: string;
  placeholder?: string;
  defaultValue?: unknown;
  options?: PluginFieldOption[];            // for select/multi-select/radio
  optionsSource?: {                         // dynamic options from dataset or API
    type: "dataset" | "api" | "cascade" | "rate_schedule" | "knowledge";
    datasetId?: string;
    column?: string;
    endpoint?: string;
    dependsOn?: string;                     // cascade: parent field id
    parentColumn?: string;                  // cascade: filter by parent value
    scope?: "revision" | "global" | "all";  // rate_schedule: which imported/master schedules to read
    category?: string | string[];           // rate_schedule: filter by schedule category
    rateKind?: "sell" | "cost";             // rate_schedule: choose sell rates or cost rates
    tierName?: string;                      // rate_schedule: prefer a named tier
  };
  validation?: PluginFieldValidation;
  conditionals?: PluginFieldConditional[];  // show/hide/modify based on other fields
  computation?: {                           // computed fields
    formula: string;                        // e.g., "quantity * hoursPerUnit * difficultyFactor"
    dependencies: string[];                 // field ids used in formula
    format?: string;                        // display format: "number", "currency", "hours"
    datasetId?: string;                     // dataset for lookup/interpolate/nearest formulas
    lookupColumns?: string[];               // columns to match on in the dataset
    resultColumn?: string;                  // column to return from the matched row
    resultColumnFrom?: string;              // field id whose value selects the result column
    resultColumnMap?: Record<string, string>; // map field value -> result column name
  };
  searchConfig?: {                          // for "search" type fields
    endpoint?: string;
    datasetId?: string;
    queryParam?: string;
    displayField: string | string[];
    valueField: string | string[];
    searchFields?: string[];
    resultFields?: string[];
    params?: Record<string, string>;        // endpoint query param or dataset field -> field id mapping
    minQueryLength?: number;
    populateFields?: Record<string, string | string[]>;
    dataSource?: PluginSearchDataSource;
  };
  width?: "full" | "half" | "third" | "quarter";
  group?: string;                           // group fields visually
  order?: number;
}

export interface PluginTableColumn {
  id: string;
  label: string;
  type: PluginFieldType;
  width?: string;                           // CSS width
  editable?: boolean;
  options?: PluginFieldOption[];
  computation?: {
    formula: string;
    dependencies: string[];
    format?: string;
  };
  aggregate?: "sum" | "avg" | "min" | "max" | "count";
  defaultValue?: unknown;
}

export interface PluginTable {
  id: string;
  label: string;
  description?: string;
  columns: PluginTableColumn[];
  defaultRows?: Record<string, unknown>[];   // pre-populated rows
  minRows?: number;
  maxRows?: number;
  allowAddRow?: boolean;
  allowDeleteRow?: boolean;
  allowReorder?: boolean;
  rowTemplate?: Record<string, unknown>;     // template for new rows
  totalsRow?: boolean;                       // show aggregation totals
}

export interface PluginScoringCriterion {
  id: string;
  label: string;
  description?: string;
  weight: number;
  scale: { min: number; max: number; step: number; labels?: Record<number, string> };
}

export interface PluginScoringEffect {
  type: "revision_patch" | "modifier" | "both";
  // For revision_patch: which field to write (e.g., "laborDifficulty", "defaultMarkup")
  revisionField?: string;
  // For modifier: create/update a quote modifier from the scoring result
  modifier?: {
    name: string;                                          // modifier name (e.g., "Difficulty Factor")
    appliesTo: "All" | "Labour" | "Material" | "Equipment"; // what it affects
    show: "Yes" | "No";                                    // visible on breakout?
    // The result band's `value` is parsed as a number and used as the percentage.
    // e.g., resultMapping value "0.15" → 15% modifier
  };
}

export interface PluginScoring {
  id: string;
  label: string;
  description?: string;
  criteria: PluginScoringCriterion[];
  resultMapping: Array<{
    minScore: number;
    maxScore: number;
    label: string;
    value: string;
    color?: string;
    description?: string;
  }>;
  outputField?: string;           // DEPRECATED — use outputEffect.revisionField instead
  outputEffect?: PluginScoringEffect;  // what to do with the resolved result
}

export interface PluginFieldGroup {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  order?: number;
}

export interface PluginUISection {
  id: string;
  type: "fields" | "table" | "scoring" | "search" | "preview" | "summary" | "custom";
  label?: string;
  description?: string;
  order?: number;
  fields?: PluginField[];
  table?: PluginTable;
  scoring?: PluginScoring;
  conditionals?: PluginFieldConditional[];
}

export interface PluginUISchema {
  sections: PluginUISection[];
  groups?: PluginFieldGroup[];
  layout?: "single" | "tabs" | "wizard" | "accordion";
  submitLabel?: string;
  cancelLabel?: string;
  showPreview?: boolean;
}

// ── Plugin Output Types ───────────────────────────────────────────────────
// Standardized output formats that plugins produce. The system knows how to
// consume each type and apply it to the estimate.

export interface PluginOutputLineItem {
  category: string;        // Labour, Equipment, Material, Travel & Per Diem, etc.
  entityType: string;      // LabourClass, Material, Equipment, etc.
  entityName: string;
  vendor?: string;
  description: string;
  quantity: number;
  uom: string;
  cost?: number;
  markup?: number;
  price?: number;
  phaseId?: string;
  rateScheduleItemId?: string | null;
  itemId?: string | null;
  tierUnits?: Record<string, number>;
  sourceNotes?: string;
  costResourceId?: string | null;
  effectiveCostId?: string | null;
  laborUnitId?: string | null;
  resourceComposition?: Record<string, unknown>;
  sourceEvidence?: WorksheetItemSourceEvidence;
  metadata?: Record<string, unknown>;
}

export interface PluginOutputWorksheet {
  name: string;
  items: PluginOutputLineItem[];
}

export interface PluginOutputTextContent {
  targetField: string;     // e.g., "revision.notes", "revision.scratchpad", "revision.leadLetter"
  content: string;
  format: "plain" | "markdown" | "html";
  mode: "replace" | "append" | "prepend";
}

export interface PluginOutputRevisionPatch {
  field: string;           // e.g., "laborDifficulty", "defaultMarkup"
  value: unknown;
}

export interface PluginOutputScore {
  criterionId: string;
  label: string;
  score: number;
  maxScore: number;
  weight: number;
}

export interface PluginOutputSummary {
  title: string;
  sections: Array<{
    label: string;
    value: string | number;
    format?: "text" | "number" | "currency" | "percentage" | "hours";
  }>;
}

export interface PluginOutputModifier {
  name: string;
  type: "percentage" | "amount";
  appliesTo: string;        // "All", "Labour", "Material", "Equipment"
  percentage?: number;       // decimal, e.g., 0.15 = 15%
  amount?: number;
  show: "Yes" | "No";
}

export interface PluginOutput {
  type: "line_items" | "worksheet" | "text_content" | "revision_patch" | "score" | "modifier" | "summary" | "composite";
  lineItems?: PluginOutputLineItem[];
  worksheet?: PluginOutputWorksheet;
  textContent?: PluginOutputTextContent;
  revisionPatches?: PluginOutputRevisionPatch[];
  scores?: PluginOutputScore[];
  modifier?: PluginOutputModifier;
  summary?: PluginOutputSummary;
  displayText?: string;    // human-readable summary of what was produced
  children?: PluginOutput[]; // for "composite" type - multiple outputs
  // Applied effects — populated by the execution handler after applying
  appliedEffects?: Array<{ type: string; description: string }>;
}

// ── Plugin Tool Definition (enhanced) ─────────────────────────────────────

export type PluginOutputTemplateValue =
  | string
  | number
  | boolean
  | null
  | { from: "input"; key: string; type?: "string" | "number" | "boolean"; default?: PluginOutputTemplateValue; min?: number; max?: number }
  | { first: PluginOutputTemplateValue[] }
  | { join: PluginOutputTemplateValue[]; separator?: string }
  | { template: string };

export interface PluginOutputValidationRule {
  field?: string;
  value?: PluginOutputTemplateValue;
  rule: "required" | "positive";
  message: string;
}

export interface PluginToolOutputTemplate {
  type: "line_items";
  validation?: PluginOutputValidationRule[];
  lineItems: Array<Partial<Record<keyof PluginOutputLineItem, PluginOutputTemplateValue>>>;
  summary?: {
    title: PluginOutputTemplateValue;
    sections: Array<{
      label: string;
      value: PluginOutputTemplateValue;
      format?: "text" | "number" | "currency" | "percentage" | "hours";
    }>;
  };
  displayText?: PluginOutputTemplateValue;
}

export type PluginToolExecutionDefinition =
  | { type: "labor_units"; providerLabel: string }
  | { type: "scoring_result_patch"; scoringId: string; revisionField: string; summaryTitle?: string }
  | {
      type: "table_hours";
      tableId: string;
      totalField: string;
      quantityField: string;
      rateField: string;
      multiplierField?: string;
      defaultMultiplier?: number;
      descriptionDefault: string;
    }
  | { type: "shop_pipe_estimate"; tableId: string; descriptionDefault: string }
  | { type: "shop_weld_estimate"; tableId: string; descriptionDefault: string };

export interface PluginToolDefinition {
  id: string;
  name: string;
  description: string;
  llmDescription?: string;       // richer description for LLM context
  parameters: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
    enum?: string[];
    default?: unknown;
  }>;
  outputType: PluginOutput["type"];
  ui?: PluginUISchema;           // declarative UI for this tool
  outputTemplate?: PluginToolOutputTemplate;
  execution?: PluginToolExecutionDefinition;
  requiresConfirmation?: boolean;
  mutates?: boolean;
  tags?: string[];
}

// ── Plugin Config Schema ──────────────────────────────────────────────────

export interface PluginConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "boolean" | "select" | "url";
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: PluginFieldOption[];
  placeholder?: string;
  validation?: PluginFieldValidation;
}

// ── Plugin (fully expanded) ───────────────────────────────────────────────

export interface Plugin {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  category: "labour" | "equipment" | "material" | "travel" | "general" | "dynamic";
  description: string;
  llmDescription?: string;        // richer description for LLM tool discovery
  version: string;
  author?: string;
  enabled: boolean;
  config: Record<string, unknown>;
  configSchema?: PluginConfigField[];
  toolDefinitions: PluginToolDefinition[];
  defaultOutputType?: PluginOutput["type"];
  supportedCategories?: string[];  // which line item categories this plugin can produce
  tags?: string[];
  documentation?: string;         // markdown documentation
  createdAt: string;
  updatedAt: string;
}

// ── Plugin Execution (fully expanded) ─────────────────────────────────────

export interface PluginExecution {
  id: string;
  pluginId: string;
  toolId: string;
  projectId: string;
  revisionId: string;
  worksheetId?: string;
  input: Record<string, unknown>;
  formState?: Record<string, unknown>;  // full UI form state for re-population
  output: PluginOutput;
  appliedLineItemIds?: string[];        // IDs of line items created by this execution
  status: "pending" | "running" | "complete" | "failed";
  error?: string;
  executedBy?: "user" | "agent";
  agentSessionId?: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "estimator" | "viewer";
  active: boolean;
  passwordHash: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export interface BrandProfile {
  companyName: string;
  tagline: string;
  industry: string;
  description: string;
  services: string[];
  targetMarkets: string[];
  brandVoice: string;
  colors: { primary: string; secondary: string; accent: string };
  logoUrl: string;
  socialLinks: Record<string, string>;
  websiteUrl: string;
  lastCapturedAt: string | null;
}

export interface AppSettings {
  general: { orgName: string; address: string; phone: string; website: string; logoUrl: string; language: string };
  email: { host: string; port: number; username: string; password: string; fromAddress: string; fromName: string; authMethod?: "smtp" | "oauth2"; oauth2TenantId?: string; oauth2ClientId?: string; oauth2ClientSecret?: string };
  defaults: {
    defaultMarkup: number;
    breakoutStyle: string;
    quoteType: string;
    timezone: string;
    currency: string;
    dateFormat: string;
    fiscalYearStart: number;
    maxAgentIterations?: number;
    uoms?: UnitOfMeasure[];
    benchmarkingEnabled?: boolean;
    benchmarkMinimumSimilarity?: number;
    benchmarkMaximumComparables?: number;
    benchmarkLowerHoursRatio?: number;
    benchmarkUpperHoursRatio?: number;
    requireHumanReviewForBenchmarkOutliers?: boolean;
  };
  integrations: {
    openaiKey: string;
    anthropicKey: string;
    openrouterKey: string;
    geminiKey: string;
    lmstudioBaseUrl?: string;
    llmProvider: string;
    llmModel: string;
    azureDiEndpoint?: string;
    azureDiKey?: string;
    documentExtractionProvider?: "azure" | "local" | "auto";
    azureDiModel?: "prebuilt-layout" | "prebuilt-read" | "prebuilt-document" | "prebuilt-invoice" | "prebuilt-contract";
    azureDiFeatures?: Array<"keyValuePairs" | "queryFields" | "ocrHighResolution" | "formulas" | "styleFont" | "barcodes" | "languages">;
    azureDiQueryFields?: string;
    azureDiOutputFormat?: "text" | "markdown";
    agentRuntime?: string;
    agentModel?: string;
    agentReasoningEffort?: string;
    maxConcurrentSubAgents?: number;
    /** Optional CLI binary path overrides for each registered runtime adapter. */
    claudeCodePath?: string;
    codexPath?: string;
    opencodePath?: string;
    geminiPath?: string;
  };
  brand: BrandProfile;
  termsAndConditions: string;
}

// ── Knowledge Base ──

export interface KnowledgeBook {
  id: string;
  cabinetId: string | null;
  name: string;
  description: string;
  category: "estimating" | "labour" | "equipment" | "materials" | "safety" | "standards" | "general";
  scope: "global" | "project";
  projectId: string | null;
  pageCount: number;
  chunkCount: number;
  status: "uploading" | "processing" | "indexed" | "failed";
  sourceFileName: string;
  sourceFileSize: number;
  storagePath: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  bookId: string;
  pageNumber: number | null;
  sectionTitle: string;
  text: string;
  tokenCount: number;
  order: number;
  metadata: Record<string, unknown>;
}

// ── Datasets (structured tabular data) ──

export interface KnowledgeDocument {
  id: string;
  cabinetId: string | null;
  title: string;
  description: string;
  category: KnowledgeBook["category"];
  scope: "global" | "project";
  projectId: string | null;
  tags: string[];
  pageCount: number;
  chunkCount: number;
  status: "draft" | "indexing" | "indexed" | "failed";
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocumentPage {
  id: string;
  documentId: string;
  title: string;
  slug: string;
  order: number;
  contentJson: Record<string, unknown>;
  contentMarkdown: string;
  plainText: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocumentChunk {
  id: string;
  documentId: string;
  pageId: string | null;
  sectionTitle: string;
  text: string;
  tokenCount: number;
  order: number;
  metadata: Record<string, unknown>;
}

export interface Dataset {
  id: string;
  cabinetId: string | null;
  name: string;
  description: string;
  category: "labour_units" | "equipment_rates" | "material_prices" | "productivity" | "burden_rates" | "custom";
  scope: "global" | "project";
  projectId: string | null;
  columns: DatasetColumn[];
  rowCount: number;
  source: "manual" | "import" | "ai_generated" | "plugin" | "library";
  sourceDescription: string;
  isTemplate: boolean;
  sourceTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetColumn {
  key: string;
  name: string;
  type: "text" | "number" | "currency" | "percentage" | "boolean" | "select";
  required: boolean;
  options?: string[];  // for select type
  unit?: string;       // e.g., "$/hr", "hrs/unit", "lbs/ft"
}

export interface DatasetRow {
  id: string;
  datasetId: string;
  data: Record<string, unknown>;  // keyed by column key
  order: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeLibraryCabinet {
  id: string;
  organizationId: string;
  parentId: string | null;
  itemType: "book" | "dataset" | "document";
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntityCategory {
  id: string;
  name: string;
  entityType: string;
  shortform: string;
  defaultUom: string;
  validUoms: string[];
  editableFields: {
    quantity: boolean;
    cost: boolean;
    markup: boolean;
    price: boolean;
    /** Whether tier-hour cells (tierUnits) are editable for this category. */
    tierUnits?: boolean;
  };
  /** Display labels keyed by RateScheduleTier id. Empty for non-labour categories. */
  unitLabels: Record<string, string>;
  calculationType: CalculationType;
  calcFormula: string;
  itemSource: "rate_schedule" | "catalog" | "freeform";
  catalogId?: string | null;
  /**
   * Analytics roll-up bucket used by the labour/material/equipment breakout
   * style and the per-bucket benchmark output. Free string; common values are
   * "labour" / "material" / "equipment" / "subcontractor" / "allowance". Null
   * means the category isn't part of the standard analytics roll-up.
   */
  analyticsBucket?: string | null;
  color: string;
  order: number;
  isBuiltIn: boolean;
  enabled: boolean;
}

export interface BidwrightStore {
  projects: Project[];
  sourceDocuments: SourceDocument[];
  quotes: Quote[];
  revisions: QuoteRevision[];
  worksheetFolders?: WorksheetFolder[];
  worksheets: Worksheet[];
  worksheetItems: WorksheetItem[];
  phases: Phase[];
  estimateFactors?: EstimateFactor[];
  adjustments: Adjustment[];
  modifiers: Modifier[];
  additionalLineItems: AdditionalLineItem[];
  summaryRows: SummaryRow[];
  conditions: Condition[];
  catalogs: Catalog[];
  catalogItems: CatalogItem[];
  aiRuns: AiRun[];
  citations: Citation[];
  activities: Activity[];
  conditionLibrary: ConditionLibraryEntry[];
  reportSections: ReportSection[];
  jobs: Job[];
  fileNodes: FileNode[];
  plugins: Plugin[];
  pluginExecutions: PluginExecution[];
  users: User[];
  authSessions: AuthSession[];
  knowledgeBooks: KnowledgeBook[];
  knowledgeChunks: KnowledgeChunk[];
  knowledgeDocuments: KnowledgeDocument[];
  knowledgeDocumentPages: KnowledgeDocumentPage[];
  knowledgeDocumentChunks: KnowledgeDocumentChunk[];
  datasets: Dataset[];
  datasetRows: DatasetRow[];
  entityCategories: EntityCategory[];
  scheduleTasks: ScheduleTask[];
  scheduleDependencies: ScheduleDependency[];
  scheduleCalendars: ScheduleCalendar[];
  scheduleBaselines: ScheduleBaseline[];
  scheduleBaselineTasks: ScheduleBaselineTask[];
  scheduleResources: ScheduleResource[];
  scheduleTaskAssignments: ScheduleTaskAssignment[];
  rateSchedules: RateSchedule[];
  rateScheduleTiers: RateScheduleTier[];
  rateScheduleItems: RateScheduleItem[];
  takeoffLinks: TakeoffLink[];
  estimateStrategies?: EstimateStrategy[];
  estimateCalibrationFeedback?: EstimateCalibrationFeedback[];
}

export interface BreakoutEntry {
  name: string;
  value: number;
  cost: number;
  margin: number;
  entityId?: string | null;
  category?: Array<{
    name: string;
    value: number;
    cost: number;
    margin: number;
  }>;
  type?: string;
}

export interface SourceTotalEntry {
  id: string;
  name: string;
  label: string;
  value: number;
  cost: number;
  margin: number;
  phaseId?: string | null;
  phaseLabel?: string | null;
  worksheetId?: string | null;
  worksheetLabel?: string | null;
  categoryId?: string | null;
  categoryLabel?: string | null;
  legacyCategoryId?: string | null;
  classificationStandard?: ConstructionClassificationStandard;
  classificationLevel?: ConstructionClassificationLevel;
  classificationCode?: string | null;
  classificationLabel?: string | null;
}

export interface AdjustmentTotalEntry {
  id: string;
  label: string;
  kind: AdjustmentKind;
  pricingMode: AdjustmentPricingMode;
  type: string;
  financialCategory: AdjustmentFinancialCategory | string;
  calculationBase: AdjustmentCalculationBase | string;
  active: boolean;
  appliesTo: string;
  show: "Yes" | "No";
  affectsSubtotal: boolean;
  baseAmount: number;
  runningTotal: number;
  value: number;
  cost: number;
  margin: number;
}

export interface EstimateFactorTotalEntry {
  id: string;
  label: string;
  category: string;
  impact: EstimateFactorImpact;
  active: boolean;
  appliesTo: string;
  applicationScope: EstimateFactorApplicationScope;
  value: number;
  formulaType: EstimateFactorFormulaType;
  parameters: Record<string, unknown>;
  targetCount: number;
  targetLineItemIds: string[];
  baseValue: number;
  baseCost: number;
  baseHours: number;
  valueDelta: number;
  costDelta: number;
  hoursDelta: number;
  effectiveValue: number;
  effectiveCost: number;
  effectiveHours: number;
  scope: EstimateFactorScope;
  confidence: EstimateFactorConfidence;
  sourceType: EstimateFactorSourceType;
  sourceId?: string | null;
  sourceRef: Record<string, unknown>;
}

export interface PricingLadderRow {
  id: string;
  label: string;
  rowType: "base" | "factor" | "adjustment" | "total" | "profit";
  financialCategory: AdjustmentFinancialCategory | string;
  pricingMode?: AdjustmentPricingMode;
  calculationBase?: AdjustmentCalculationBase | string;
  appliesTo?: string;
  percentage?: number | null;
  fixedAmount?: number | null;
  baseAmount: number;
  value: number;
  cost: number;
  margin: number;
  runningTotal: number;
  affectsTotal: boolean;
  visible: boolean;
  active: boolean;
  sourceAdjustmentId?: string | null;
  sourceFactorId?: string | null;
}

export interface PricingLadderSnapshot {
  version: 1;
  directCost: number;
  lineSubtotal: number;
  adjustmentTotal: number;
  netTotal: number;
  grandTotal: number;
  internalProfit: number;
  internalMargin: number;
  rows: PricingLadderRow[];
}

export interface CostBreakdownEntry {
  id: string;
  label: string;
  type: string;
  value: number;
  cost: number;
  margin: number;
  quantity: number;
  itemCount: number;
  shareOfCost: number;
}

export interface RevisionTotals {
  subtotal: number;
  cost: number;
  lineSubtotalBeforeFactors?: number;
  costBeforeFactors?: number;
  totalHoursBeforeFactors?: number;
  adjustedLineItems: WorksheetItem[];
  estimatedProfit: number;
  estimatedMargin: number;
  calculatedTotal: number;
  regHours: number;
  overHours: number;
  doubleHours: number;
  totalHours: number;
  categoryTotals: SourceTotalEntry[];
  phaseTotals: SourceTotalEntry[];
  phaseCategoryTotals: SourceTotalEntry[];
  worksheetTotals: SourceTotalEntry[];
  worksheetCategoryTotals: SourceTotalEntry[];
  worksheetPhaseTotals: SourceTotalEntry[];
  classificationTotals: SourceTotalEntry[];
  phaseClassificationTotals: SourceTotalEntry[];
  worksheetClassificationTotals: SourceTotalEntry[];
  categoryClassificationTotals: SourceTotalEntry[];
  factorTotals: EstimateFactorTotalEntry[];
  adjustmentTotals: AdjustmentTotalEntry[];
  pricingLadder: PricingLadderSnapshot;
  costBreakdown: CostBreakdownEntry[];
  tierUnitTotals?: Record<string, number>;
  breakout: BreakoutEntry[];
}

export interface ProjectWorkspace {
  project: Project;
  sourceDocuments: SourceDocument[];
  quote: Quote;
  currentRevision: QuoteRevision;
  revisions: QuoteRevision[];
  worksheetFolders: WorksheetFolder[];
  worksheets: Array<Worksheet & { items: WorksheetItem[] }>;
  phases: Phase[];
  estimateFactors: EstimateFactor[];
  adjustments: Adjustment[];
  modifiers: Modifier[];
  additionalLineItems: AdditionalLineItem[];
  summaryBuilder?: SummaryBuilderConfig | null;
  summaryRows: SummaryRow[];
  conditions: Condition[];
  catalogs: Array<Catalog & { items: CatalogItem[] }>;
  entityCategories: EntityCategory[];
  aiRuns: AiRun[];
  citations: Citation[];
  scheduleTasks: ScheduleTask[];
  scheduleDependencies: ScheduleDependency[];
  scheduleCalendars: ScheduleCalendar[];
  scheduleBaselines: ScheduleBaseline[];
  scheduleBaselineTasks: ScheduleBaselineTask[];
  scheduleResources: ScheduleResource[];
  scheduleTaskAssignments: ScheduleTaskAssignment[];
  takeoffLinks: TakeoffLink[];
  estimateStrategy?: EstimateStrategy | null;
  estimateFeedback?: EstimateCalibrationFeedback[];
  estimate: {
    revisionId: string;
    totals: RevisionTotals;
    lineItems: WorksheetItem[];
    summary: {
      sourceDocumentCount: number;
      worksheetCount: number;
      lineItemCount: number;
      citationCount: number;
      aiRunCount: number;
    };
  };
}
