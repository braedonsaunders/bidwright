import { randomUUID, createHash } from "node:crypto";
import { hashPassword } from "./services/auth-service.js";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  calculateTotals,
  buildProjectWorkspace,
  buildSummaryBuilderConfig,
  computeSummaryRows,
  createSummaryBuilderPreset,
  deriveSummaryBuilderFromLegacy,
  expandAssembly,
  findAssemblyCycles,
  getExtendedWorksheetHourBreakdown,
  getWorksheetHourBreakdown,
  inferSummaryPresetFromBuilder,
  materializeSummaryRowsFromBuilder,
  normalizeSummaryBuilderConfig,
  normalizeCalculationType,
  normalizeUomLibrary,
  summarizeExpandedAssemblyResources,
  summarizeProjectTotals,
  validateEstimateWorkspace,
} from "@bidwright/domain";
import type { SummaryBuilderConfig, SummaryPreset } from "@bidwright/domain";
import type {
  Activity,
  Adjustment,
  AdditionalLineItem,
  AppSettings,
  Assembly,
  AssemblyComponent,
  AssemblyDefinition,
  AssemblyInstanceRecord,
  AssemblyParameter,
  AssemblySummary,
  AuthSession,
  BidwrightStore,
  CatalogItemRef,
  RateScheduleItemRef,
  Catalog,
  CatalogItem,
  Condition,
  ConditionLibraryEntry,
  Customer,
  CustomerContact,
  CustomerWithContacts,
  Dataset,
  DatasetColumn,
  DatasetRow,
  Department,
  EntityCategory,
  EstimateCalibrationFeedback,
  EstimateFactor,
  EstimateStrategy,
  EffectiveCostRef,
  FileNode,
  Job,
  KnowledgeBook,
  KnowledgeLibraryCabinet,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeDocumentChunk,
  KnowledgeDocumentPage,
  LaborUnitRef,
  LaborUnit,
  LaborUnitLibrary,
  Modifier,
  RateSchedule,
  RateScheduleItem,
  RateScheduleTier,
  RateScheduleWithChildren,
  Phase,
  Plugin,
  PluginExecution,
  PluginOutput,
  PluginOutputLineItem,
  PluginOutputModifier,
  PluginOutputRevisionPatch,
  PluginOutputScore,
  Project,
  ProjectWorkspace,
  Quote,
  QuoteRevision,
  ReportSection,
  RevisionTotals,
  ResourceCatalogItem,
  ScheduleBaseline,
  ScheduleBaselineTask,
  ScheduleCalendar,
  ScheduleDependency,
  ScheduleResource,
  ScheduleTask,
  ScheduleTaskAssignment,
  SourceDocument,
  SummaryRow,
  User,
  WorksheetItem,
} from "@bidwright/domain";
import type {
  AzureDocumentIntelligenceModel,
  DocumentChunk,
  DocumentExtractionProvider,
  IngestionReport,
  PackageSourceKind,
} from "@bidwright/ingestion";
import { ingestCustomerPackage, extractArchiveEntries } from "@bidwright/ingestion";
import type { PrismaClient, Prisma } from "@bidwright/db";
import { prisma as sharedPrisma } from "@bidwright/db";
import { decodeHtmlEntities } from "./text-utils.js";

import {
  apiDataRoot,
  relativeJobPath,
  relativePackageArchivePath,
  relativePackageChunksPath,
  relativePackageDocumentPath,
  relativePackageReportPath,
  relativePackageRoot,
  relativeWorkspacePath,
  resolveApiPath,
  resolveRelativePath,
  sanitizeFileName,
} from "./paths.js";

import {
  calculateLineItem,
  roundMoney,
  makeQuoteNumber,
  createId,
  isoNow,
  defaultProjectSummary,
  documentTypeFromIngestion,
} from "./calc-utils.js";
import { executeBuiltinPluginTool } from "./plugins/builtin-execution.js";
import {
  DEFAULT_BRAND,
  DEFAULT_SETTINGS,
  checksumForDocument,
  inferPageCount,
  knowledgeCategoryFromDocType,
  mapActivity,
  mapAdjustment,
  mapAdditionalLineItem,
  mapAiRun,
  mapAssembly,
  mapAssemblyComponent,
  mapAssemblyInstance,
  mapAssemblyParameter,
  mapAssemblySummary,
  mapCatalog,
  mapCatalogItem,
  mapCitation,
  mapCondition,
  mapConditionLibrary,
  mapCustomer,
  mapCustomerContact,
  mapDataset,
  mapDatasetRow,
  mapDepartment,
  mapEntityCategory,
  mapEstimateCalibrationFeedback,
  mapEstimateFactor,
  mapEstimateFactorLibraryEntry,
  mapEstimateStrategy,
  mapFileNode,
  mapIngestionJob,
  mapJob,
  mapKnowledgeBook,
  mapKnowledgeLibraryCabinet,
  mapKnowledgeChunk,
  mapKnowledgeDocument,
  mapKnowledgeDocumentChunk,
  mapKnowledgeDocumentPage,
  mapLaborUnit,
  mapLaborUnitLibrary,
  mapModifier,
  mapPersona,
  mapPhase,
  mapPlugin,
  mapPluginExecution,
  mapProject,
  mapQuote,
  mapRateBookAssignment,
  mapRateSchedule,
  mapRateScheduleItem,
  mapRateScheduleTier,
  mapRateScheduleWithChildren,
  mapReportSection,
  mapResourceCatalogItem,
  mapRevision,
  mapScheduleBaseline,
  mapScheduleBaselineTask,
  mapScheduleCalendar,
  mapScheduleDependency,
  mapScheduleResource,
  mapScheduleTask,
  mapScheduleTaskAssignment,
  mapSourceDocument,
  mapStoredPackage,
  mapSummaryRow,
  mapTakeoffAnnotation,
  mapTakeoffLink,
  mapUser,
  mapWorksheet,
  mapWorksheetFolder,
  mapWorksheetItem,
  mapWorkspaceState,
} from "./store/mappers.js";
import type { IngestionJobRecord, StoredPackageRecord, WorkspaceStateRecord } from "./store/types.js";

function badRequestError(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

const NON_REVERTIBLE_ACTIVITY_TYPES = new Set([
  "quote_sent", "ai_phases_accepted", "ai_equipment_accepted",
  "quote_updated", "worksheet_created", "worksheet_updated", "worksheet_deleted",
]);

const DEFAULT_SCHEDULE_WORKING_DAYS: Record<string, boolean> = {
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: false,
  sunday: false,
};

function createScheduleDate(year: number, monthIndex: number, day: number) {
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

function parseScheduleDate(value?: string | null) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  return createScheduleDate(Number.parseInt(year, 10), Number.parseInt(month, 10) - 1, Number.parseInt(day, 10));
}

function formatScheduleDate(date: Date) {
  const normalized = createScheduleDate(date.getFullYear(), date.getMonth(), date.getDate());
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${normalized.getFullYear()}-${pad(normalized.getMonth() + 1)}-${pad(normalized.getDate())}`;
}

function diffScheduleDays(a: Date, b: Date) {
  const aMidnight = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bMidnight = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((aMidnight - bMidnight) / 86_400_000);
}

function isActivityRevertible(activity: { type: string; data: any }): boolean {
  if (activity.type.startsWith("revert:")) return false;
  if (NON_REVERTIBLE_ACTIVITY_TYPES.has(activity.type)) return false;
  const d = (activity.data as Record<string, unknown>) ?? {};
  if (!d.before && !d.after) return false;
  return true;
}

/**
 * Resolve tierUnit keys to full tier IDs.
 * Handles three formats:
 *   1. Exact tier ID match (e.g. "rst-f6d2116a-d6e4-4303-9d0b-ec68381795e5")
 *   2. Tier NAME match (e.g. "Regular", "Overtime") — resolved to the tier's ID
 *   3. Truncated ID prefix match (e.g. "rst-f6d2116a") — resolved to the full ID
 */
function resolveTierUnitKeys(
  tierUnits: Record<string, number>,
  schedules: any[],
): Record<string, number> {
  const allTiers = schedules.flatMap((s) => (s.tiers ?? []).map((t: any) => ({ id: t.id as string, name: (t.name as string) ?? "" })));
  const tierById = new Map(allTiers.map((t) => [t.id, t]));
  const tierByNameLower = new Map(allTiers.map((t) => [t.name.toLowerCase(), t]));

  const resolved: Record<string, number> = {};
  for (const [key, val] of Object.entries(tierUnits)) {
    const numVal = Number(val) || 0;
    // 1. Exact ID match
    if (tierById.has(key)) {
      resolved[key] = numVal;
      continue;
    }
    // 2. Name match (case-insensitive)
    const byName = tierByNameLower.get(key.toLowerCase());
    if (byName) {
      resolved[byName.id] = numVal;
      continue;
    }
    // 3. Prefix match for truncated IDs
    const prefixMatch = allTiers.find((t) => t.id.startsWith(key));
    if (prefixMatch) {
      resolved[prefixMatch.id] = numVal;
      continue;
    }
    // Fallback — keep the key as-is (will be ignored by calc engine)
    resolved[key] = numVal;
  }
  return resolved;
}

/**
 * Categories are dynamically configured per organization. New writes resolve
 * through the stable EntityCategory.id first; category/entityType strings are
 * legacy display mirrors and backward-compatible import keys.
 */
function normalizeEstimateCategoryName(value: string, entityType?: string | null) {
  const trimmed = value.trim();
  return trimmed || entityType?.trim() || "Uncategorized";
}

type EntityCategoryLike = {
  id: string;
  name: string;
  entityType: string;
  calculationType?: string | null;
  itemSource?: string | null;
};

function normalizeCategoryMatchKey(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function resolveEntityCategoryForItemInput(
  categories: EntityCategoryLike[],
  input: { categoryId?: string | null; category?: string | null; entityType?: string | null },
): EntityCategoryLike | null {
  const categoryId = typeof input.categoryId === "string" ? input.categoryId.trim() : "";
  if (categoryId) {
    const byId = categories.find((category) => category.id === categoryId);
    if (byId) return byId;
    return null;
  }

  const categoryName = normalizeCategoryMatchKey(input.category);
  if (categoryName) {
    const byName = categories.find((category) => normalizeCategoryMatchKey(category.name) === categoryName);
    if (byName) return byName;
  }

  const entityType = normalizeCategoryMatchKey(input.entityType);
  if (entityType) {
    const byEntityType = categories.find((category) => normalizeCategoryMatchKey(category.entityType) === entityType);
    if (byEntityType) return byEntityType;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeWorksheetClassification(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function catalogClassificationFromMetadata(metadata: unknown): Record<string, unknown> {
  const record = normalizeWorksheetClassification(metadata);
  const nested = normalizeWorksheetClassification(record.classification);
  for (const key of [
    "masterformat",
    "masterFormat",
    "uniformat",
    "uniFormat",
    "Uniformat",
    "uniformat2",
    "uniformatII",
    "astmE1557",
    "omniclass",
    "omniClass",
    "OmniClass",
    "uniclass",
    "uniClass",
    "Uniclass",
    "din276",
    "din",
    "DIN276",
    "DIN",
    "nrm",
    "NRM",
    "nrm1",
    "NRM1",
    "icms",
    "ICMS",
    "costCode",
    "cost_code",
    "costcode",
  ]) {
    if (record[key] !== undefined && nested[key] === undefined) {
      nested[key] = record[key];
    }
  }
  return nested;
}

function mergeWorksheetClassifications(...values: unknown[]): Record<string, unknown> {
  return values.reduce<Record<string, unknown>>((merged, value) => {
    Object.assign(merged, normalizeWorksheetClassification(value));
    return merged;
  }, {});
}

function costCodeFromClassification(classification: Record<string, unknown>): string | null {
  const direct = stringValue(classification.costCode) ?? stringValue(classification.cost_code) ?? stringValue(classification.costcode);
  if (direct) {
    return direct;
  }
  const nested = normalizeWorksheetClassification(classification.cost_code);
  return stringValue(nested.code) ?? stringValue(nested.value);
}

/**
 * The shape we persist into WorksheetItem.costSnapshot. Mirrors the
 * `CostSnapshot` interface from @bidwright/domain.
 */
interface PersistedCostSnapshot {
  source:
    | "manual"
    | "catalog"
    | "rate_schedule"
    | "effective_cost"
    | "labor_unit"
    | "assembly"
    | "ai"
    | "import";
  sourceId: string | null;
  sourceLabel?: string;
  snapshotAt: string;
  originalUnitCost: number;
  originalUnitPrice?: number;
  currency?: string;
  region?: string;
}

/**
 * Pick the most appropriate cost-snapshot source for a worksheet item based
 * on which library FK the item carries. The actual cost value is taken from
 * the item's already-resolved `cost` field (per-unit). Used after auto-resolve
 * has run so `cost` is the right number to snapshot.
 */
function buildSnapshotForItem(item: WorksheetItem): PersistedCostSnapshot {
  const snapshotAt = new Date().toISOString();
  const originalUnitCost = Number(item.cost) || 0;
  if (item.rateScheduleItemId) {
    return { source: "rate_schedule", sourceId: item.rateScheduleItemId, snapshotAt, originalUnitCost };
  }
  if (item.effectiveCostId) {
    return { source: "effective_cost", sourceId: item.effectiveCostId, snapshotAt, originalUnitCost };
  }
  if (item.itemId) {
    return { source: "catalog", sourceId: item.itemId, snapshotAt, originalUnitCost };
  }
  if (item.laborUnitId) {
    return { source: "labor_unit", sourceId: item.laborUnitId, snapshotAt, originalUnitCost };
  }
  if (item.sourceAssemblyId) {
    return { source: "assembly", sourceId: item.sourceAssemblyId, snapshotAt, originalUnitCost };
  }
  return { source: "manual", sourceId: null, snapshotAt, originalUnitCost };
}

interface RevisionItemAggregateRow {
  phaseId: string | null;
  category: string | null;
  priceTotal: number;
  costTotal: number;
}

function adjustmentToLegacyModifier(adjustment: Adjustment): Modifier | null {
  if (adjustment.pricingMode !== "modifier" && adjustment.kind !== "modifier") {
    return null;
  }

  return {
    id: adjustment.id,
    revisionId: adjustment.revisionId,
    name: adjustment.name,
    type: adjustment.type,
    appliesTo: adjustment.appliesTo,
    percentage: adjustment.percentage ?? null,
    amount: adjustment.amount ?? null,
    show: adjustment.show,
  };
}

function adjustmentToLegacyAdditionalLineItem(adjustment: Adjustment): AdditionalLineItem | null {
  if (adjustment.kind !== "line_item") {
    return null;
  }

  const type: AdditionalLineItem["type"] =
    adjustment.pricingMode === "option_standalone"
      ? "OptionStandalone"
      : adjustment.pricingMode === "option_additional"
        ? "OptionAdditional"
        : adjustment.pricingMode === "line_item_standalone"
          ? "LineItemStandalone"
          : adjustment.pricingMode === "custom_total"
            ? "CustomTotal"
            : "LineItemAdditional";

  return {
    id: adjustment.id,
    revisionId: adjustment.revisionId,
    name: adjustment.name,
    description: adjustment.description,
    type,
    amount: adjustment.amount ?? 0,
  };
}

function remapEstimateFactorScope(
  scope: unknown,
  phaseIdMap: Map<string, string>,
  worksheetIdMap: Map<string, string>,
  worksheetItemIdMap: Map<string, string> = new Map(),
) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return {};
  }
  const next = { ...(scope as Record<string, unknown>) };
  const remapArray = (value: unknown, map: Map<string, string>) =>
    Array.isArray(value) ? value.map((entry) => map.get(String(entry)) ?? String(entry)) : value;

  next.phaseIds = remapArray(next.phaseIds, phaseIdMap);
  next.worksheetIds = remapArray(next.worksheetIds, worksheetIdMap);
  next.worksheetItemIds = remapArray(next.worksheetItemIds, worksheetItemIdMap);
  if (typeof next.phaseId === "string") next.phaseId = phaseIdMap.get(next.phaseId) ?? next.phaseId;
  if (typeof next.worksheetId === "string") next.worksheetId = worksheetIdMap.get(next.worksheetId) ?? next.worksheetId;
  if (typeof next.worksheetItemId === "string") next.worksheetItemId = worksheetItemIdMap.get(next.worksheetItemId) ?? next.worksheetItemId;
  return next;
}

function isLegacyModifier(value: Modifier | null): value is Modifier {
  return value !== null;
}

function isLegacyAdditionalLineItem(value: AdditionalLineItem | null): value is AdditionalLineItem {
  return value !== null;
}

// ── Re-exported Interfaces ────────────────────────────────────────────────────
// These interfaces are re-exported so that existing consumers (server.ts, routes)
// continue to work unchanged.
export type { IngestionJobRecord, StoredPackageRecord, WorkspaceStateRecord } from "./store/types.js";

export type PluginPatchInput = Partial<Pick<Plugin, "name" | "description" | "enabled" | "config" | "configSchema" | "toolDefinitions" | "tags" | "supportedCategories" | "defaultOutputType" | "llmDescription" | "documentation" | "icon" | "author">>;

export type CreatePluginInput = Omit<Plugin, "id" | "createdAt" | "updatedAt">;

export interface CreateProjectInput {
  name: string;
  clientName: string;
  customerId?: string | null;
  location: string;
  packageName?: string;
  scope?: string;
  creationMode?: "manual" | "intake";
  summary?: string;
}

export interface RegisterPackageInput {
  projectId: string;
  packageName: string;
  originalFileName: string;
  checksum: string;
  totalBytes: number;
  sourceKind?: PackageSourceKind;
}

export interface UploadArtifact {
  originalFileName: string;
  storagePath: string;
  checksum: string;
  totalBytes: number;
  packageId: string;
}

export interface PackageIngestionOutcome {
  project: Project;
  quote: Quote;
  revision: QuoteRevision;
  packageRecord: StoredPackageRecord;
  job: IngestionJobRecord;
  report: IngestionReport;
  documents: SourceDocument[];
  workspace: ProjectWorkspace;
  totals: ReturnType<typeof summarizeProjectTotals>;
}

export interface RevisionPatchInput {
  title?: string;
  description?: string;
  notes?: string;
  breakoutStyle?: QuoteRevision["breakoutStyle"];
  type?: QuoteRevision["type"];
  scratchpad?: string;
  leadLetter?: string;
  dateEstimatedShip?: string | null;
  dateQuote?: string | null;
  dateDue?: string | null;
  dateWalkdown?: string | null;
  dateWorkStart?: string | null;
  dateWorkEnd?: string | null;
  shippingMethod?: string;
  shippingTerms?: string;
  freightOnBoard?: string;
  status?: QuoteRevision["status"];
  defaultMarkup?: number;
  laborDifficulty?: string;
  followUpNote?: string;
  printEmptyNotesColumn?: boolean;
  printCategory?: string[];
  printPhaseTotalOnly?: boolean;
  grandTotal?: number;
  regHours?: number;
  overHours?: number;
  doubleHours?: number;
  breakoutPackage?: unknown[];
  calculatedCategoryTotals?: unknown[];
  pricingLadder?: Record<string, unknown>;
  pdfPreferences?: Record<string, unknown>;
}

export interface QuotePatchInput {
  customerExistingNew?: Quote["customerExistingNew"];
  customerId?: string | null;
  customerString?: string;
  customerContactId?: string | null;
  customerContactString?: string;
  customerContactEmailString?: string;
  departmentId?: string | null;
  userId?: string | null;
}

export interface WorksheetItemPatchInput {
  phaseId?: string | null;
  categoryId?: string | null;
  category?: string;
  entityType?: string;
  entityName?: string;
  classification?: Record<string, unknown>;
  costCode?: string | null;
  vendor?: string | null;
  description?: string;
  quantity?: number;
  uom?: string;
  cost?: number;
  markup?: number;
  price?: number;
  lineOrder?: number;
  rateScheduleItemId?: string | null;
  itemId?: string | null;
  tierUnits?: Record<string, number>;
  sourceNotes?: string;
  costResourceId?: string | null;
  effectiveCostId?: string | null;
  laborUnitId?: string | null;
  resourceComposition?: Record<string, unknown>;
  sourceEvidence?: Record<string, unknown>;
}

export interface CreateWorksheetItemInput {
  phaseId?: string | null;
  categoryId?: string | null;
  category: string;
  entityType: string;
  entityName: string;
  classification?: Record<string, unknown>;
  costCode?: string | null;
  vendor?: string | null;
  description: string;
  quantity: number;
  uom: string;
  cost: number;
  markup: number;
  price: number;
  lineOrder?: number;
  rateScheduleItemId?: string | null;
  itemId?: string | null;
  tierUnits?: Record<string, number>;
  sourceNotes?: string;
  costResourceId?: string | null;
  effectiveCostId?: string | null;
  laborUnitId?: string | null;
  resourceComposition?: Record<string, unknown>;
  sourceEvidence?: Record<string, unknown>;
}

export interface CreateWorksheetInput {
  name: string;
  folderId?: string | null;
  order?: number;
}

export interface EstimateMutationSnapshot {
  currentRevision: QuoteRevision;
  estimateTotals: RevisionTotals;
}

export interface WorksheetItemMutationResult {
  item: WorksheetItem;
  snapshot: EstimateMutationSnapshot;
}

export interface WorksheetPatchInput {
  name?: string;
  order?: number;
  folderId?: string | null;
}

export interface CreateWorksheetFolderInput {
  name: string;
  parentId?: string | null;
  order?: number;
}

export interface WorksheetFolderPatchInput {
  name?: string;
  parentId?: string | null;
  order?: number;
}

export interface CreatePhaseInput {
  parentId?: string | null;
  number?: string;
  name?: string;
  description?: string;
  order?: number;
  startDate?: string | null;
  endDate?: string | null;
  color?: string;
}

export interface PhasePatchInput {
  parentId?: string | null;
  number?: string;
  name?: string;
  description?: string;
  order?: number;
  startDate?: string | null;
  endDate?: string | null;
  color?: string;
}

export interface CreateScheduleTaskInput {
  phaseId?: string | null;
  calendarId?: string | null;
  parentTaskId?: string | null;
  outlineLevel?: number;
  name?: string;
  description?: string;
  taskType?: "task" | "milestone" | "summary";
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
  duration?: number;
  progress?: number;
  assignee?: string;
  order?: number;
  constraintType?: ScheduleTask["constraintType"];
  constraintDate?: string | null;
  deadlineDate?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  resourceAssignments?: Array<{
    resourceId: string;
    units?: number;
    role?: string;
  }>;
}

export interface ScheduleTaskPatchInput {
  phaseId?: string | null;
  calendarId?: string | null;
  parentTaskId?: string | null;
  outlineLevel?: number;
  name?: string;
  description?: string;
  taskType?: "task" | "milestone" | "summary";
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
  duration?: number;
  progress?: number;
  assignee?: string;
  order?: number;
  constraintType?: ScheduleTask["constraintType"];
  constraintDate?: string | null;
  deadlineDate?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  resourceAssignments?: Array<{
    resourceId: string;
    units?: number;
    role?: string;
  }>;
}

export interface CreateDependencyInput {
  predecessorId: string;
  successorId: string;
  type?: "FS" | "SS" | "FF" | "SF";
  lagDays?: number;
}

export interface CreateScheduleCalendarInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
  workingDays?: Record<string, boolean>;
  shiftStartMinutes?: number;
  shiftEndMinutes?: number;
}

export interface ScheduleCalendarPatchInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
  workingDays?: Record<string, boolean>;
  shiftStartMinutes?: number;
  shiftEndMinutes?: number;
}

export interface CreateScheduleResourceInput {
  calendarId?: string | null;
  name?: string;
  role?: string;
  kind?: ScheduleResource["kind"];
  color?: string;
  defaultUnits?: number;
  capacityPerDay?: number;
  costRate?: number;
}

export interface ScheduleResourcePatchInput {
  calendarId?: string | null;
  name?: string;
  role?: string;
  kind?: ScheduleResource["kind"];
  color?: string;
  defaultUnits?: number;
  capacityPerDay?: number;
  costRate?: number;
}

export interface CreateScheduleBaselineInput {
  name?: string;
  description?: string;
  kind?: ScheduleBaseline["kind"];
  isPrimary?: boolean;
}

export interface CreateModifierInput {
  name?: string;
  type?: string;
  appliesTo?: string;
  percentage?: number | null;
  amount?: number | null;
  show?: "Yes" | "No";
}

export interface ModifierPatchInput {
  name?: string;
  type?: string;
  appliesTo?: string;
  percentage?: number | null;
  amount?: number | null;
  show?: "Yes" | "No";
}

export interface CreateAdjustmentInput {
  name?: string;
  description?: string;
  type?: string;
  kind?: Adjustment["kind"];
  pricingMode?: Adjustment["pricingMode"];
  financialCategory?: Adjustment["financialCategory"];
  calculationBase?: Adjustment["calculationBase"];
  active?: boolean;
  appliesTo?: string;
  percentage?: number | null;
  amount?: number | null;
  show?: "Yes" | "No";
  order?: number;
}

export interface AdjustmentPatchInput {
  name?: string;
  description?: string;
  type?: string;
  kind?: Adjustment["kind"];
  pricingMode?: Adjustment["pricingMode"];
  financialCategory?: Adjustment["financialCategory"];
  calculationBase?: Adjustment["calculationBase"];
  active?: boolean;
  appliesTo?: string;
  percentage?: number | null;
  amount?: number | null;
  show?: "Yes" | "No";
  order?: number;
}

export interface CreateEstimateFactorInput {
  name?: string;
  code?: string;
  description?: string;
  category?: string;
  impact?: EstimateFactor["impact"];
  value?: number;
  active?: boolean;
  appliesTo?: string;
  applicationScope?: EstimateFactor["applicationScope"];
  scope?: EstimateFactor["scope"];
  formulaType?: EstimateFactor["formulaType"];
  parameters?: Record<string, unknown>;
  confidence?: EstimateFactor["confidence"];
  sourceType?: EstimateFactor["sourceType"];
  sourceId?: string | null;
  sourceRef?: Record<string, unknown>;
  tags?: string[];
  order?: number;
}

export interface EstimateFactorPatchInput extends CreateEstimateFactorInput {}

export interface CreateEstimateFactorLibraryEntryInput {
  name?: string;
  code?: string;
  description?: string;
  category?: string;
  impact?: EstimateFactor["impact"];
  value?: number;
  appliesTo?: string;
  applicationScope?: EstimateFactor["applicationScope"];
  scope?: EstimateFactor["scope"];
  formulaType?: EstimateFactor["formulaType"];
  parameters?: Record<string, unknown>;
  confidence?: EstimateFactor["confidence"];
  sourceType?: EstimateFactor["sourceType"];
  sourceId?: string | null;
  sourceRef?: Record<string, unknown>;
  tags?: string[];
  order?: number;
}

export interface EstimateFactorLibraryEntryPatchInput extends CreateEstimateFactorLibraryEntryInput {}

export interface CreateConditionInput {
  type: string;
  value: string;
  order?: number;
}

export interface ConditionPatchInput {
  type?: string;
  value?: string;
  order?: number;
}

export interface CreateAdditionalLineItemInput {
  name?: string;
  type?: AdditionalLineItem["type"];
  description?: string;
  amount?: number;
}

export interface AdditionalLineItemPatchInput {
  name?: string;
  type?: AdditionalLineItem["type"];
  description?: string;
  amount?: number;
}

export interface CreateSummaryRowInput {
  type?: SummaryRow["type"];
  label?: string;
  order?: number;
  visible?: boolean;
  style?: SummaryRow["style"];
  sourceCategoryId?: string | null;
  sourceCategoryLabel?: string | null;
  sourcePhaseId?: string | null;
  sourceWorksheetId?: string | null;
  sourceWorksheetLabel?: string | null;
  sourceClassificationId?: string | null;
  sourceClassificationLabel?: string | null;
  sourceAdjustmentId?: string | null;
}

export interface SummaryRowPatchInput extends CreateSummaryRowInput {}

export interface CreateReportSectionInput {
  sectionType?: string;
  title?: string;
  content?: string;
  order?: number;
  parentSectionId?: string | null;
}

export interface ReportSectionPatchInput {
  sectionType?: string;
  title?: string;
  content?: string;
  order?: number;
  parentSectionId?: string | null;
}

export interface StatusPatchInput {
  ingestionStatus: Project["ingestionStatus"];
}

export interface CreateJobInput {
  name: string;
  foreman?: string;
  projectManager?: string;
  startDate?: string | null;
  shipDate?: string | null;
  poNumber?: string;
  poIssuer?: string;
}

export interface CreateCatalogInput {
  name: string;
  kind: string;
  scope: string;
  projectId?: string | null;
  description?: string;
}

export interface CatalogPatchInput {
  name?: string;
  kind?: string;
  scope?: string;
  projectId?: string | null;
  description?: string;
}

export interface CreateCatalogItemInput {
  code: string;
  name: string;
  unit: string;
  unitCost: number;
  unitPrice: number;
  category?: string;
  metadata?: Record<string, unknown>;
}

export interface CatalogItemPatchInput {
  code?: string;
  name?: string;
  unit?: string;
  unitCost?: number;
  unitPrice?: number;
  category?: string;
  metadata?: Record<string, unknown>;
}

export type LineItemSearchSourceType =
  | "catalog_item"
  | "rate_schedule_item"
  | "labor_unit"
  | "cost_resource"
  | "effective_cost"
  | "assembly"
  | "plugin_tool"
  | "external_action";

export type LineItemSearchActionType =
  | "select"
  | "open_assembly"
  | "plugin_tool"
  | "plugin_remote_search";

export interface LineItemSearchDocumentInput {
  sourceType: LineItemSearchSourceType;
  sourceId: string;
  actionType?: LineItemSearchActionType;
  projectId?: string | null;
  category?: string;
  entityType?: string;
  title: string;
  subtitle?: string;
  code?: string;
  vendor?: string;
  uom?: string;
  unitCost?: number | null;
  unitPrice?: number | null;
  searchText?: string;
  payload?: Record<string, unknown>;
}

export interface LineItemSearchResult {
  id: string;
  sourceType: LineItemSearchSourceType;
  sourceId: string;
  actionType: LineItemSearchActionType;
  projectId: string | null;
  category: string;
  entityType: string;
  title: string;
  subtitle: string;
  code: string;
  vendor: string;
  uom: string;
  unitCost: number | null;
  unitPrice: number | null;
  payload: Record<string, unknown>;
  score: number;
}

export interface LineItemSearchInput {
  q?: string;
  preferredCategory?: string;
  worksheetId?: string;
  sourceTypes?: LineItemSearchSourceType[];
  disabledSourceTypes?: LineItemSearchSourceType[];
  disabledLaborLibraryIds?: string[];
  disabledCatalogIds?: string[];
  limit?: number;
  offset?: number;
  refresh?: boolean;
}

export interface CreateLaborUnitLibraryInput {
  name: string;
  description?: string;
  provider?: string;
  discipline?: string;
  source?: "manual" | "import" | "library" | "plugin";
  sourceDescription?: string;
  sourceDatasetId?: string | null;
  cabinetId?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface LaborUnitLibraryPatchInput {
  name?: string;
  description?: string;
  provider?: string;
  discipline?: string;
  source?: "manual" | "import" | "library" | "plugin";
  sourceDescription?: string;
  sourceDatasetId?: string | null;
  cabinetId?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateLaborUnitInput {
  catalogItemId?: string | null;
  code?: string;
  name: string;
  description?: string;
  discipline?: string;
  category?: string;
  className?: string;
  subClassName?: string;
  outputUom?: string;
  hoursNormal: number;
  hoursDifficult?: number | null;
  hoursVeryDifficult?: number | null;
  defaultDifficulty?: "normal" | "difficult" | "very_difficult";
  entityCategoryType?: string;
  tags?: string[];
  sourceRef?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  sortOrder?: number;
}

export interface LaborUnitPatchInput {
  catalogItemId?: string | null;
  code?: string;
  name?: string;
  description?: string;
  discipline?: string;
  category?: string;
  className?: string;
  subClassName?: string;
  outputUom?: string;
  hoursNormal?: number;
  hoursDifficult?: number | null;
  hoursVeryDifficult?: number | null;
  defaultDifficulty?: "normal" | "difficult" | "very_difficult";
  entityCategoryType?: string;
  tags?: string[];
  sourceRef?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  sortOrder?: number;
}

export type LaborUnitTreeParentType = "root" | "catalog" | "category" | "class" | "subclass";

export interface LaborUnitTreeGroup {
  id: string;
  level: "catalog" | "category" | "class" | "subclass";
  label: string;
  libraryId: string | null;
  category: string;
  className: string;
  subClassName: string;
  unitCount: number;
  normalHoursTotal: number;
}

export interface LaborUnitTreeInput {
  parentType?: LaborUnitTreeParentType;
  libraryId?: string;
  q?: string;
  category?: string;
  className?: string;
  subClassName?: string;
  limit?: number;
  offset?: number;
}

export interface CreateAssemblyInput {
  name: string;
  code?: string;
  description?: string;
  category?: string;
  unit?: string;
  metadata?: Record<string, unknown>;
}

export interface AssemblyPatchInput {
  name?: string;
  code?: string;
  description?: string;
  category?: string;
  unit?: string;
  metadata?: Record<string, unknown>;
}

export interface AssemblyParameterInput {
  key: string;
  label?: string;
  description?: string;
  paramType?: string;
  defaultValue?: string;
  unit?: string;
  sortOrder?: number;
}

export interface AssemblyParameterPatchInput {
  key?: string;
  label?: string;
  description?: string;
  paramType?: string;
  defaultValue?: string;
  unit?: string;
  sortOrder?: number;
}

export interface AssemblyComponentInput {
  componentType: "catalog_item" | "rate_schedule_item" | "labor_unit" | "cost_intelligence" | "sub_assembly";
  catalogItemId?: string | null;
  rateScheduleItemId?: string | null;
  laborUnitId?: string | null;
  laborDifficulty?: "normal" | "difficult" | "very_difficult";
  costResourceId?: string | null;
  effectiveCostId?: string | null;
  subAssemblyId?: string | null;
  quantityExpr?: string;
  description?: string;
  category?: string;
  uomOverride?: string | null;
  costOverride?: number | null;
  markupOverride?: number | null;
  parameterBindings?: Record<string, string>;
  notes?: string;
  sortOrder?: number;
}

export interface AssemblyComponentPatchInput {
  componentType?: "catalog_item" | "rate_schedule_item" | "labor_unit" | "cost_intelligence" | "sub_assembly";
  catalogItemId?: string | null;
  rateScheduleItemId?: string | null;
  laborUnitId?: string | null;
  laborDifficulty?: "normal" | "difficult" | "very_difficult";
  costResourceId?: string | null;
  effectiveCostId?: string | null;
  subAssemblyId?: string | null;
  quantityExpr?: string;
  description?: string;
  category?: string;
  uomOverride?: string | null;
  costOverride?: number | null;
  markupOverride?: number | null;
  parameterBindings?: Record<string, string>;
  notes?: string;
  sortOrder?: number;
}

export interface InsertAssemblyIntoWorksheetInput {
  assemblyId: string;
  quantity: number;
  parameterValues?: Record<string, number | string>;
  phaseId?: string | null;
}

export interface CreateFileNodeInput {
  parentId?: string | null;
  name: string;
  type: "file" | "directory";
  scope?: "project" | "knowledge";
  fileType?: string;
  size?: number;
  documentId?: string;
  storagePath?: string;
  metadata?: Record<string, unknown>;
  createdBy?: string;
}

export interface FileNodePatchInput {
  name?: string;
  parentId?: string | null;
  storagePath?: string;
  fileType?: string;
  size?: number;
  metadata?: Record<string, unknown>;
}

export interface SourceDocumentPatchInput {
  fileName?: string;
  documentType?: string;
}

export interface CreateTakeoffAnnotationInput {
  documentId: string;
  pageNumber: number;
  annotationType: string;
  label?: string;
  color?: string;
  lineThickness?: number;
  visible?: boolean;
  groupName?: string;
  points?: Array<{ x: number; y: number }>;
  measurement?: Record<string, unknown>;
  calibration?: { pixelsPerUnit: number; unit: string } | null;
  metadata?: Record<string, unknown>;
  createdBy?: string;
}

export interface TakeoffAnnotationPatchInput {
  label?: string;
  color?: string;
  lineThickness?: number;
  visible?: boolean;
  groupName?: string;
  points?: Array<{ x: number; y: number }>;
  measurement?: Record<string, unknown>;
  calibration?: { pixelsPerUnit: number; unit: string } | null;
  metadata?: Record<string, unknown>;
}

export interface CreateTakeoffLinkInput {
  annotationId: string;
  worksheetItemId: string;
  quantityField?: string;  // defaults to "value"
  multiplier?: number;     // defaults to 1.0
}

export interface UpdateTakeoffLinkInput {
  quantityField?: string;
  multiplier?: number;
}

export interface ImportPreviewResult {
  headers: string[];
  sampleRows: string[][];
  fileId: string;
}

export interface ImportProcessInput {
  fileId: string;
  worksheetId: string;
  mapping: Record<string, string>;
}

export interface CreateUserInput {
  email: string;
  name: string;
  role: "admin" | "estimator" | "viewer";
  password?: string;
}

export interface UserPatchInput {
  email?: string;
  name?: string;
  role?: "admin" | "estimator" | "viewer";
  active?: boolean;
  password?: string;
}
function relativePackageDocumentArtifact(packageId: string, documentId: string, title: string) {
  return relativePackageDocumentPath(packageId, documentId, title);
}

function normalizeStoredSourcePath(value: string | undefined, fallbackFileName: string) {
  const safeSegments = (value ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => sanitizeFileName(segment))
    .filter(Boolean);

  if (safeSegments.length > 0) {
    return safeSegments.join("/");
  }

  return sanitizeFileName(fallbackFileName);
}

async function ensureParentDir(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await ensureParentDir(filePath);
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function toRateScheduleCalcContext(schedules: Array<{
  id?: string;
  name?: string;
  category?: string;
  defaultMarkup?: number;
  metadata?: unknown;
  tiers?: Array<{ id: string; name: string; multiplier: number; sortOrder: number; uom?: string | null }>;
  items?: Array<{
    id: string;
    scheduleId?: string;
    catalogItemId?: string | null;
    resourceId?: string | null;
    name: string;
    code: string;
    unit?: string;
    rates?: unknown;
    costRates?: unknown;
    burden?: number;
    perDiem?: number;
    metadata?: unknown;
  }>;
}>) {
  return schedules.map((schedule) => ({
    id: schedule.id ?? "",
    name: schedule.name ?? "",
    category: schedule.category ?? "",
    defaultMarkup: Number(schedule.defaultMarkup) || 0,
    metadata: (schedule.metadata && typeof schedule.metadata === "object" && !Array.isArray(schedule.metadata)
      ? schedule.metadata
      : {}) as Record<string, unknown>,
    tiers: (schedule.tiers ?? []).map((tier) => ({
      id: tier.id,
      name: tier.name,
      multiplier: tier.multiplier,
      sortOrder: tier.sortOrder,
      uom: tier.uom ?? null,
    })),
    items: (schedule.items ?? []).map((item) => ({
      id: item.id,
      scheduleId: item.scheduleId ?? schedule.id ?? "",
      catalogItemId: item.catalogItemId ?? null,
      resourceId: item.resourceId ?? null,
      name: item.name,
      code: item.code,
      unit: item.unit ?? "HR",
      rates: (item.rates as Record<string, number>) ?? {},
      costRates: (item.costRates as Record<string, number>) ?? {},
      burden: item.burden ?? 0,
      perDiem: item.perDiem ?? 0,
      metadata: (item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
        ? item.metadata
        : {}) as Record<string, unknown>,
    })),
  }));
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve());
  });
  return hash.digest("hex");
}

function stableLineItemSearchDocumentId(
  organizationId: string,
  projectId: string | null | undefined,
  sourceType: string,
  sourceId: string,
) {
  const digest = createHash("sha1")
    .update([organizationId, projectId ?? "", sourceType, sourceId].join("\u001f"))
    .digest("hex")
    .slice(0, 32);
  return `lis_${digest}`;
}

function searchTextFromParts(parts: Array<unknown>) {
  return parts
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 8000);
}

function parseSearchDocumentPayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function expandLineItemFtsQuery(value: string) {
  return value
    .replace(/\blabor\b/gi, "labor OR labour")
    .replace(/\blabour\b/gi, "labour OR labor");
}

function firstPluginSearchField(tool: { ui?: { sections?: Array<{ fields?: Array<Record<string, any>> }> } }) {
  for (const section of tool.ui?.sections ?? []) {
    for (const field of section.fields ?? []) {
      if (field?.type === "search" && field.searchConfig?.dataSource) {
        return field;
      }
    }
  }
  return null;
}

// ── Main Store Class ──────────────────────────────────────────────────────────

export class PrismaApiStore {
  private static lineItemSearchInfrastructureReady = false;
  private importCache = new Map<string, { headers: string[]; rows: string[][] }>();
  private _userId: string | null = null;
  private _activityActor: { id: string; name: string; type: "user" | "super_admin" | "ai" | "system" } | null = null;

  setUserId(id: string) { this._userId = id; }
  setActivityActor(actor: { id: string; name: string; type: "user" | "super_admin" | "ai" | "system" } | null) {
    this._activityActor = actor;
  }

  constructor(
    private readonly db: PrismaClient,
    public readonly organizationId: string,
  ) {}

  // ── Org-scoped project guard ────────────────────────────────────────────

  private async requireProject(projectId: string): Promise<void> {
    const project = await this.db.project.findFirst({
      where: { id: projectId, organizationId: this.organizationId },
    });
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }
  }

  private async requireProjectReference(projectId: string | null | undefined, label = "Project"): Promise<void> {
    if (!projectId) return;
    const project = await this.db.project.findFirst({
      where: { id: projectId, organizationId: this.organizationId },
      select: { id: true },
    });
    if (!project) {
      throw new Error(`${label} ${projectId} not found`);
    }
  }

  private async requireRevisionForProject(projectId: string, revisionId: string) {
    await this.requireProject(projectId);
    const revision = await this.db.quoteRevision.findFirst({
      where: {
        id: revisionId,
        quote: { projectId, project: { organizationId: this.organizationId } },
      } as any,
    });
    if (!revision) {
      throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
    }
    return revision;
  }

  private async ensureLineItemSearchInfrastructure() {
    if (PrismaApiStore.lineItemSearchInfrastructureReady) {
      return;
    }
    await this.db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await this.db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "LineItemSearchDocument" (
        "id" TEXT PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "projectId" TEXT,
        "sourceType" TEXT NOT NULL,
        "sourceId" TEXT NOT NULL,
        "actionType" TEXT NOT NULL DEFAULT 'select',
        "category" TEXT NOT NULL DEFAULT '',
        "entityType" TEXT NOT NULL DEFAULT '',
        "title" TEXT NOT NULL,
        "subtitle" TEXT NOT NULL DEFAULT '',
        "code" TEXT NOT NULL DEFAULT '',
        "vendor" TEXT NOT NULL DEFAULT '',
        "uom" TEXT NOT NULL DEFAULT 'EA',
        "unitCost" DOUBLE PRECISION,
        "unitPrice" DOUBLE PRECISION,
        "searchText" TEXT NOT NULL DEFAULT '',
        "searchVector" tsvector NOT NULL DEFAULT ''::tsvector,
        "payload" JSONB NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.db.$executeRawUnsafe(`ALTER TABLE "LineItemSearchDocument" ADD COLUMN IF NOT EXISTS "searchVector" tsvector NOT NULL DEFAULT ''::tsvector`);
    await this.db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_organizationId_idx" ON "LineItemSearchDocument"("organizationId")`);
    await this.db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_organizationId_projectId_idx" ON "LineItemSearchDocument"("organizationId", "projectId")`);
    await this.db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_organizationId_sourceType_idx" ON "LineItemSearchDocument"("organizationId", "sourceType")`);
    await this.db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_organizationId_category_idx" ON "LineItemSearchDocument"("organizationId", "category")`);
    await this.db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_organizationId_entityType_idx" ON "LineItemSearchDocument"("organizationId", "entityType")`);
    await this.db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_searchVector_fts_idx" ON "LineItemSearchDocument" USING GIN ("searchVector")`);
    await this.db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_searchText_fts_idx" ON "LineItemSearchDocument" USING GIN (to_tsvector('english', "searchText"))`);
    await this.db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_searchText_trgm_idx" ON "LineItemSearchDocument" USING GIN ("searchText" gin_trgm_ops)`);
    await this.db.$executeRawUnsafe(`UPDATE "LineItemSearchDocument" SET "searchVector" = to_tsvector('english', "searchText") WHERE "searchVector" = ''::tsvector`);
    PrismaApiStore.lineItemSearchInfrastructureReady = true;
  }

  private async upsertLineItemSearchDocument(doc: LineItemSearchDocumentInput) {
    const title = doc.title.trim();
    if (!title) return;
    const sourceId = doc.sourceId.trim();
    if (!sourceId) return;
    const projectId = doc.projectId ?? null;
    const payload = doc.payload ?? {};
    const searchText = doc.searchText?.trim() || searchTextFromParts([
      title,
      doc.subtitle,
      doc.code,
      doc.vendor,
      doc.category,
      doc.entityType,
      Object.values(payload),
    ]);
    await this.db.$executeRawUnsafe(
      `
        INSERT INTO "LineItemSearchDocument" (
          "id", "organizationId", "projectId", "sourceType", "sourceId", "actionType",
          "category", "entityType", "title", "subtitle", "code", "vendor", "uom",
          "unitCost", "unitPrice", "searchText", "searchVector", "payload", "createdAt", "updatedAt"
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, to_tsvector('english', $16::text), $17::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("id") DO UPDATE SET
          "projectId" = EXCLUDED."projectId",
          "sourceType" = EXCLUDED."sourceType",
          "sourceId" = EXCLUDED."sourceId",
          "actionType" = EXCLUDED."actionType",
          "category" = EXCLUDED."category",
          "entityType" = EXCLUDED."entityType",
          "title" = EXCLUDED."title",
          "subtitle" = EXCLUDED."subtitle",
          "code" = EXCLUDED."code",
          "vendor" = EXCLUDED."vendor",
          "uom" = EXCLUDED."uom",
          "unitCost" = EXCLUDED."unitCost",
          "unitPrice" = EXCLUDED."unitPrice",
          "searchText" = EXCLUDED."searchText",
          "searchVector" = EXCLUDED."searchVector",
          "payload" = EXCLUDED."payload",
          "updatedAt" = CURRENT_TIMESTAMP
      `,
      stableLineItemSearchDocumentId(this.organizationId, projectId, doc.sourceType, sourceId),
      this.organizationId,
      projectId,
      doc.sourceType,
      sourceId,
      doc.actionType ?? "select",
      doc.category ?? "",
      doc.entityType ?? "",
      title,
      doc.subtitle ?? "",
      doc.code ?? "",
      doc.vendor ?? "",
      doc.uom ?? "EA",
      doc.unitCost ?? null,
      doc.unitPrice ?? null,
      searchText,
      JSON.stringify(payload),
    );
  }

  private async upsertPluginSearchDocuments() {
    const plugins = await this.db.plugin.findMany({
      where: { organizationId: this.organizationId, enabled: true },
    });

    for (const plugin of plugins) {
      const tools = Array.isArray(plugin.toolDefinitions) ? plugin.toolDefinitions as Array<any> : [];
      for (const tool of tools) {
        if (tool?.outputType !== "line_items" && tool?.outputType !== "worksheet") continue;
        const searchField = firstPluginSearchField(tool);
        const isRemoteSearch = Boolean(searchField);
        const sourceId = `${plugin.id}:${tool.id}:${isRemoteSearch ? searchField!.id : "run"}`;
        const title = isRemoteSearch
          ? plugin.name.replace(/\s+(product\s+)?search$/i, "").trim() || plugin.name
          : tool.name || plugin.name;
        await this.upsertLineItemSearchDocument({
          sourceType: isRemoteSearch ? "external_action" : "plugin_tool",
          sourceId,
          actionType: isRemoteSearch ? "plugin_remote_search" : "plugin_tool",
          title,
          subtitle: isRemoteSearch
            ? `Search ${plugin.name} and create line items`
            : `Run ${plugin.name}${tool.name ? `: ${tool.name}` : ""}`,
          category: (plugin.supportedCategories?.[0] as string | undefined) ?? plugin.category ?? "Actions",
          entityType: (plugin.supportedCategories?.[0] as string | undefined) ?? plugin.category ?? "plugin",
          searchText: searchTextFromParts([
            plugin.name,
            plugin.slug,
            plugin.category,
            plugin.description,
            plugin.llmDescription,
            plugin.tags,
            plugin.supportedCategories,
            tool.name,
            tool.description,
            tool.llmDescription,
            tool.tags,
            isRemoteSearch ? "search products vendor pricing external line items action" : "run create line items plugin action",
          ]),
          payload: {
            pluginId: plugin.id,
            pluginSlug: plugin.slug,
            pluginName: plugin.name,
            toolId: tool.id,
            toolName: tool.name,
            searchFieldId: searchField?.id,
            queryParam: searchField?.searchConfig?.queryParam ?? "q",
            populateFields: searchField?.searchConfig?.populateFields ?? {},
          },
        });
      }
    }
  }

  async rebuildLineItemSearchIndex(projectId?: string): Promise<{ indexed: number }> {
    if (projectId) {
      await this.requireProject(projectId);
    }
    await this.ensureLineItemSearchInfrastructure();

    await this.db.$executeRawUnsafe(
      `
        DELETE FROM "LineItemSearchDocument"
        WHERE "organizationId" = $1::text
          AND ($2::text IS NULL OR "projectId" IS NULL OR "projectId" = $2::text)
      `,
      this.organizationId,
      projectId ?? null,
    );

    await this.db.$executeRawUnsafe(
      `
        INSERT INTO "LineItemSearchDocument" (
          "id", "organizationId", "projectId", "sourceType", "sourceId", "actionType",
          "category", "entityType", "title", "subtitle", "code", "vendor", "uom",
          "unitCost", "unitPrice", "searchText", "searchVector", "payload", "createdAt", "updatedAt"
        )
        SELECT
          'lis_' || md5(concat_ws('|', $1::text, COALESCE(c."projectId", $2::text, ''), 'catalog_item', ci."id")),
          $1::text,
          COALESCE(c."projectId", $2::text),
          'catalog_item',
          ci."id",
          'select',
          COALESCE(NULLIF(ci."metadata"->>'category', ''), c."kind", ''),
          c."kind",
          COALESCE(NULLIF(ci."name", ''), 'Catalog item'),
          c."name",
          ci."code",
          COALESCE(ci."metadata"->>'vendor', ''),
          COALESCE(NULLIF(linked_rate."rateUnit", ''), NULLIF(ci."unit", ''), 'EA'),
          COALESCE(linked_rate."rateUnitCost", ci."unitCost"),
          ci."unitPrice",
          concat_ws(' ', ci."name", ci."code", ci."unit", c."name", c."kind", c."description", linked_rate."scheduleName", linked_rate."scheduleCategory", ci."metadata"::text),
          to_tsvector('english', concat_ws(' ', ci."name", ci."code", ci."unit", c."name", c."kind", c."description", linked_rate."scheduleName", linked_rate."scheduleCategory", ci."metadata"::text)),
          jsonb_build_object(
            'source', 'catalog',
            'itemId', ci."id",
            'catalogId', c."id",
            'catalogName', c."name",
            'catalogKind', c."kind",
            'catalogCategory', COALESCE(NULLIF(ci."metadata"->>'category', ''), c."kind", ''),
            'rateScheduleItemId', linked_rate."rateScheduleItemId",
            'scheduleId', linked_rate."scheduleId",
            'scheduleName', linked_rate."scheduleName",
            'scheduleCategory', linked_rate."scheduleCategory",
            'rateScheduleLinked', linked_rate."rateScheduleItemId" IS NOT NULL,
            'vendor', COALESCE(ci."metadata"->>'vendor', ''),
            'description', ci."name",
            'resourceComposition', jsonb_build_object(
              'source', 'catalog',
              'resources', jsonb_build_array(jsonb_build_object(
                'componentType', 'catalog_item',
                'itemId', ci."id",
                'rateScheduleItemId', linked_rate."rateScheduleItemId",
                'scheduleId', linked_rate."scheduleId",
                'uom', COALESCE(NULLIF(linked_rate."rateUnit", ''), NULLIF(ci."unit", ''), 'EA'),
                'unitCost', COALESCE(linked_rate."rateUnitCost", ci."unitCost"),
                'unitPrice', ci."unitPrice"
              ))
            ),
            'sourceEvidence', jsonb_build_object(
              'source', 'catalog',
              'itemId', ci."id",
              'catalogId', c."id",
              'catalogName', c."name",
              'rateScheduleItemId', linked_rate."rateScheduleItemId",
              'scheduleId', linked_rate."scheduleId",
              'scheduleName', linked_rate."scheduleName",
              'tierId', linked_rate."tierId"
            )
          ),
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM "CatalogItem" ci
        JOIN "Catalog" c ON c."id" = ci."catalogId"
        LEFT JOIN LATERAL (
          SELECT
            rsi."id" AS "rateScheduleItemId",
            rsi."scheduleId",
            rs."name" AS "scheduleName",
            rs."category" AS "scheduleCategory",
            rsi."unit" AS "rateUnit",
            tier."id" AS "tierId",
            COALESCE(NULLIF(rsi."rates"->>tier."id", '')::double precision, 0) AS "rateUnitCost"
          FROM "RateScheduleItem" rsi
          JOIN "RateSchedule" rs ON rs."id" = rsi."scheduleId"
          JOIN "QuoteRevision" qr ON qr."id" = rs."revisionId"
          JOIN "Quote" q ON q."id" = qr."quoteId"
          LEFT JOIN LATERAL (
            SELECT "id"
            FROM "RateScheduleTier" rst
            WHERE rst."scheduleId" = rs."id"
            ORDER BY rst."sortOrder" ASC
            LIMIT 1
          ) tier ON true
          WHERE rsi."catalogItemId" = ci."id"
            AND rs."organizationId" = $1::text
            AND $2::text IS NOT NULL
            AND q."projectId" = $2::text
            AND q."currentRevisionId" = rs."revisionId"
          ORDER BY
            CASE WHEN rs."projectId" = $2::text THEN 0 ELSE 1 END,
            rs."updatedAt" DESC,
            rsi."sortOrder" ASC,
            rsi."name" ASC
          LIMIT 1
        ) linked_rate ON true
        WHERE c."organizationId" = $1::text
          AND ($2::text IS NULL OR c."scope" = 'global' OR c."projectId" = $2::text)
        ON CONFLICT ("id") DO UPDATE SET
          "projectId" = EXCLUDED."projectId",
          "category" = EXCLUDED."category",
          "entityType" = EXCLUDED."entityType",
          "title" = EXCLUDED."title",
          "subtitle" = EXCLUDED."subtitle",
          "code" = EXCLUDED."code",
          "vendor" = EXCLUDED."vendor",
          "uom" = EXCLUDED."uom",
          "unitCost" = EXCLUDED."unitCost",
          "unitPrice" = EXCLUDED."unitPrice",
          "searchText" = EXCLUDED."searchText",
          "searchVector" = EXCLUDED."searchVector",
          "payload" = EXCLUDED."payload",
          "updatedAt" = CURRENT_TIMESTAMP
      `,
      this.organizationId,
      projectId ?? null,
    );

    await this.db.$executeRawUnsafe(
      `
        INSERT INTO "LineItemSearchDocument" (
          "id", "organizationId", "projectId", "sourceType", "sourceId", "actionType",
          "category", "entityType", "title", "subtitle", "code", "vendor", "uom",
          "unitCost", "unitPrice", "searchText", "searchVector", "payload", "createdAt", "updatedAt"
        )
        SELECT
          'lis_' || md5(concat_ws('|', $1::text, COALESCE(rs."projectId", q."projectId", ''), 'rate_schedule_item', rsi."id")),
          $1::text,
          COALESCE(rs."projectId", q."projectId"),
          'rate_schedule_item',
          rsi."id",
          'select',
          rs."category",
          rs."category",
          COALESCE(NULLIF(rsi."name", ''), 'Rate schedule item'),
          rs."name",
          rsi."code",
          COALESCE(rsi."metadata"->>'vendor', ''),
          COALESCE(NULLIF(rsi."unit", ''), 'HR'),
          COALESCE(NULLIF(rsi."rates"->>tier."id", '')::double precision, 0),
          NULL,
          concat_ws(' ', rsi."name", rsi."code", rsi."unit", rs."name", rs."category", rs."description", rsi."metadata"::text),
          to_tsvector('english', concat_ws(' ', rsi."name", rsi."code", rsi."unit", rs."name", rs."category", rs."description", rsi."metadata"::text)),
          jsonb_build_object(
            'source', 'rate_schedule',
            'rateScheduleItemId', rsi."id",
            'scheduleId', rs."id",
            'scheduleName', rs."name",
            'scheduleCategory', rs."category",
            'description', rsi."name",
            'resourceComposition', jsonb_build_object(
              'source', 'rate_schedule',
              'resources', jsonb_build_array(jsonb_build_object(
                'componentType', 'rate_schedule_item',
                'rateScheduleItemId', rsi."id",
                'scheduleId', rs."id",
                'uom', rsi."unit",
                'unitCost', COALESCE(NULLIF(rsi."rates"->>tier."id", '')::double precision, 0)
              ))
            ),
            'sourceEvidence', jsonb_build_object(
              'source', 'rate_schedule',
              'rateScheduleItemId', rsi."id",
              'scheduleId', rs."id",
              'scheduleName', rs."name",
              'tierId', tier."id"
            )
          ),
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM "RateScheduleItem" rsi
        JOIN "RateSchedule" rs ON rs."id" = rsi."scheduleId"
        LEFT JOIN "QuoteRevision" qr ON qr."id" = rs."revisionId"
        LEFT JOIN "Quote" q ON q."id" = qr."quoteId"
        LEFT JOIN LATERAL (
          SELECT "id"
          FROM "RateScheduleTier" rst
          WHERE rst."scheduleId" = rs."id"
          ORDER BY rst."sortOrder" ASC
          LIMIT 1
        ) tier ON true
        WHERE rs."organizationId" = $1::text
          AND rs."revisionId" IS NOT NULL
          AND q."currentRevisionId" = rs."revisionId"
          AND ($2::text IS NULL OR q."projectId" = $2::text OR rs."projectId" = $2::text)
        ON CONFLICT ("id") DO UPDATE SET
          "projectId" = EXCLUDED."projectId",
          "category" = EXCLUDED."category",
          "entityType" = EXCLUDED."entityType",
          "title" = EXCLUDED."title",
          "subtitle" = EXCLUDED."subtitle",
          "code" = EXCLUDED."code",
          "vendor" = EXCLUDED."vendor",
          "uom" = EXCLUDED."uom",
          "unitCost" = EXCLUDED."unitCost",
          "unitPrice" = EXCLUDED."unitPrice",
          "searchText" = EXCLUDED."searchText",
          "searchVector" = EXCLUDED."searchVector",
          "payload" = EXCLUDED."payload",
          "updatedAt" = CURRENT_TIMESTAMP
      `,
      this.organizationId,
      projectId ?? null,
    );

    await this.db.$executeRawUnsafe(
      `
        INSERT INTO "LineItemSearchDocument" (
          "id", "organizationId", "projectId", "sourceType", "sourceId", "actionType",
          "category", "entityType", "title", "subtitle", "code", "vendor", "uom",
          "unitCost", "unitPrice", "searchText", "searchVector", "payload", "createdAt", "updatedAt"
        )
        SELECT
          'lis_' || md5(concat_ws('|', $1::text, '', 'cost_resource', r."id")),
          $1::text,
          NULL,
          'cost_resource',
          r."id",
          'select',
          r."category",
          r."resourceType",
          r."name",
          concat_ws(' ', r."manufacturer", r."manufacturerPartNumber"),
          r."code",
          r."manufacturer",
          COALESCE(NULLIF(r."defaultUom", ''), 'EA'),
          NULL,
          NULL,
          concat_ws(' ', r."name", r."code", r."description", r."category", r."resourceType", r."manufacturer", r."manufacturerPartNumber", array_to_string(r."aliases", ' '), array_to_string(r."tags", ' '), r."metadata"::text),
          to_tsvector('english', concat_ws(' ', r."name", r."code", r."description", r."category", r."resourceType", r."manufacturer", r."manufacturerPartNumber", array_to_string(r."aliases", ' '), array_to_string(r."tags", ' '), r."metadata"::text)),
          jsonb_build_object(
            'source', 'cost_resource',
            'costResourceId', r."id",
            'itemId', r."catalogItemId",
            'resourceCategory', r."category",
            'resourceType', r."resourceType",
            'manufacturer', r."manufacturer",
            'manufacturerPartNumber', r."manufacturerPartNumber",
            'description', r."description",
            'resourceComposition', jsonb_build_object(
              'source', 'cost_resource',
              'resources', jsonb_build_array(jsonb_build_object(
                'componentType', 'cost_resource',
                'costResourceId', r."id",
                'itemId', r."catalogItemId",
                'uom', r."defaultUom"
              ))
            ),
            'sourceEvidence', jsonb_build_object(
              'source', 'cost_resource',
              'costResourceId', r."id",
              'itemId', r."catalogItemId",
              'updatedAt', r."updatedAt"
            )
          ),
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM "ResourceCatalogItem" r
        WHERE r."organizationId" = $1::text
          AND r."active" = true
        ON CONFLICT ("id") DO UPDATE SET
          "category" = EXCLUDED."category",
          "entityType" = EXCLUDED."entityType",
          "title" = EXCLUDED."title",
          "subtitle" = EXCLUDED."subtitle",
          "code" = EXCLUDED."code",
          "vendor" = EXCLUDED."vendor",
          "uom" = EXCLUDED."uom",
          "searchText" = EXCLUDED."searchText",
          "searchVector" = EXCLUDED."searchVector",
          "payload" = EXCLUDED."payload",
          "updatedAt" = CURRENT_TIMESTAMP
      `,
      this.organizationId,
    );

    await this.db.$executeRawUnsafe(
      `
        INSERT INTO "LineItemSearchDocument" (
          "id", "organizationId", "projectId", "sourceType", "sourceId", "actionType",
          "category", "entityType", "title", "subtitle", "code", "vendor", "uom",
          "unitCost", "unitPrice", "searchText", "searchVector", "payload", "createdAt", "updatedAt"
        )
        SELECT
          'lis_' || md5(concat_ws('|', $1::text, COALESCE(ec."projectId", ''), 'effective_cost', ec."id")),
          $1::text,
          ec."projectId",
          'effective_cost',
          ec."id",
          'select',
          COALESCE(r."category", ''),
          COALESCE(r."resourceType", ''),
          COALESCE(r."name", ec."metadata"->'costItem'->>'name', 'Effective cost'),
          concat_ws(' ', ec."vendorName", ec."region", ec."method"),
          COALESCE(r."code", ec."metadata"->'costItem'->>'code', ''),
          ec."vendorName",
          COALESCE(NULLIF(ec."uom", ''), r."defaultUom", 'EA'),
          ec."unitCost",
          ec."unitPrice",
          concat_ws(' ', r."name", r."code", r."description", r."category", r."resourceType", r."manufacturer", r."manufacturerPartNumber", ec."vendorName", ec."region", ec."method", left(COALESCE(po."rawText", ''), 500), ec."metadata"::text),
          to_tsvector('english', concat_ws(' ', r."name", r."code", r."description", r."category", r."resourceType", r."manufacturer", r."manufacturerPartNumber", ec."vendorName", ec."region", ec."method", left(COALESCE(po."rawText", ''), 500), ec."metadata"::text)),
          jsonb_build_object(
            'source', 'cost_intelligence',
            'effectiveCostId', ec."id",
            'costResourceId', ec."resourceId",
            'itemId', r."catalogItemId",
            'costCategory', COALESCE(r."category", ''),
            'resourceType', COALESCE(r."resourceType", ''),
            'vendorName', ec."vendorName",
            'region', ec."region",
            'method', ec."method",
            'description', COALESCE(r."description", r."name", ''),
            'sourceNotes', concat_ws('; ', 'Cost Intelligence cost basis ' || ec."id", ec."method", NULLIF(ec."vendorName", '')),
            'effectiveDate', ec."effectiveDate",
            'expiresAt', ec."expiresAt",
            'confidence', ec."confidence",
            'sourceObservationId', ec."sourceObservationId",
            'resourceComposition', jsonb_build_object(
              'source', 'cost_intelligence',
              'resources', jsonb_build_array(jsonb_build_object(
                'componentType', 'cost_intelligence',
                'effectiveCostId', ec."id",
                'costResourceId', ec."resourceId",
                'itemId', r."catalogItemId",
                'uom', ec."uom",
                'unitCost', ec."unitCost",
                'unitPrice', ec."unitPrice"
              ))
            ),
            'sourceEvidence', jsonb_build_object(
              'source', 'cost_intelligence',
              'effectiveCostId', ec."id",
              'costResourceId', ec."resourceId",
              'sourceObservationId', ec."sourceObservationId",
              'vendorName', ec."vendorName",
              'region', ec."region",
              'method', ec."method",
              'effectiveDate', ec."effectiveDate",
              'expiresAt', ec."expiresAt",
              'confidence', ec."confidence"
            )
          ),
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM "EffectiveCost" ec
        LEFT JOIN "ResourceCatalogItem" r ON r."id" = ec."resourceId"
        LEFT JOIN "PriceObservation" po ON po."id" = ec."sourceObservationId"
        WHERE ec."organizationId" = $1::text
          AND ($2::text IS NULL OR ec."projectId" IS NULL OR ec."projectId" = $2::text)
        ON CONFLICT ("id") DO UPDATE SET
          "projectId" = EXCLUDED."projectId",
          "category" = EXCLUDED."category",
          "entityType" = EXCLUDED."entityType",
          "title" = EXCLUDED."title",
          "subtitle" = EXCLUDED."subtitle",
          "code" = EXCLUDED."code",
          "vendor" = EXCLUDED."vendor",
          "uom" = EXCLUDED."uom",
          "unitCost" = EXCLUDED."unitCost",
          "unitPrice" = EXCLUDED."unitPrice",
          "searchText" = EXCLUDED."searchText",
          "searchVector" = EXCLUDED."searchVector",
          "payload" = EXCLUDED."payload",
          "updatedAt" = CURRENT_TIMESTAMP
      `,
      this.organizationId,
      projectId ?? null,
    );

    await this.db.$executeRawUnsafe(
      `
        INSERT INTO "LineItemSearchDocument" (
          "id", "organizationId", "projectId", "sourceType", "sourceId", "actionType",
          "category", "entityType", "title", "subtitle", "code", "vendor", "uom",
          "unitCost", "unitPrice", "searchText", "searchVector", "payload", "createdAt", "updatedAt"
        )
        SELECT
          'lis_' || md5(concat_ws('|', $1::text, '', 'labor_unit', lu."id")),
          $1::text,
          NULL,
          'labor_unit',
          lu."id",
          'select',
          COALESCE(NULLIF(lu."entityCategoryType", ''), 'Labour'),
          COALESCE(NULLIF(lu."entityCategoryType", ''), 'Labour'),
          lu."name",
          concat_ws(' · ', NULLIF(lib."provider", ''), NULLIF(lu."category", ''), NULLIF(lu."className", ''), NULLIF(lu."subClassName", '')),
          lu."code",
          lib."provider",
          COALESCE(NULLIF(lu."outputUom", ''), 'EA'),
          NULL,
          NULL,
          concat_ws(' ', lu."name", lu."code", lu."description", lu."discipline", lu."category", lu."className", lu."subClassName", lib."name", lib."provider", array_to_string(lu."tags", ' '), lu."metadata"::text),
          to_tsvector('english', concat_ws(' ', lu."name", lu."code", lu."description", lu."discipline", lu."category", lu."className", lu."subClassName", lib."name", lib."provider", array_to_string(lu."tags", ' '), lu."metadata"::text)),
          jsonb_build_object(
            'source', 'labor_unit',
            'laborUnitId', lu."id",
            'libraryId', lib."id",
            'libraryName', lib."name",
            'provider', lib."provider",
            'discipline', lu."discipline",
            'laborCategory', lu."category",
            'className', lu."className",
            'subClassName', lu."subClassName",
            'catalogItemId', lu."catalogItemId",
            'description', lu."description",
            'hoursNormal', lu."hoursNormal",
            'hoursDifficult', lu."hoursDifficult",
            'hoursVeryDifficult', lu."hoursVeryDifficult",
            'defaultDifficulty', lu."defaultDifficulty",
            'resourceComposition', jsonb_build_object(
              'source', 'labor_unit',
              'resources', jsonb_build_array(jsonb_build_object(
                'componentType', 'labor_unit',
                'laborUnitId', lu."id",
                'catalogItemId', lu."catalogItemId",
                'uom', lu."outputUom",
                'hoursNormal', lu."hoursNormal",
                'hoursDifficult', lu."hoursDifficult",
                'hoursVeryDifficult', lu."hoursVeryDifficult"
              ))
            ),
            'sourceEvidence', jsonb_build_object(
              'source', 'labor_unit',
              'laborUnitId', lu."id",
              'libraryId', lu."libraryId",
              'libraryProvider', lib."provider",
              'defaultDifficulty', lu."defaultDifficulty"
            )
          ),
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM "LaborUnit" lu
        JOIN "LaborUnitLibrary" lib ON lib."id" = lu."libraryId"
        WHERE (lib."organizationId" = $1::text OR lib."organizationId" IS NULL)
        ON CONFLICT ("id") DO UPDATE SET
          "category" = EXCLUDED."category",
          "entityType" = EXCLUDED."entityType",
          "title" = EXCLUDED."title",
          "subtitle" = EXCLUDED."subtitle",
          "code" = EXCLUDED."code",
          "vendor" = EXCLUDED."vendor",
          "uom" = EXCLUDED."uom",
          "searchText" = EXCLUDED."searchText",
          "searchVector" = EXCLUDED."searchVector",
          "payload" = EXCLUDED."payload",
          "updatedAt" = CURRENT_TIMESTAMP
      `,
      this.organizationId,
    );

    await this.db.$executeRawUnsafe(
      `
        INSERT INTO "LineItemSearchDocument" (
          "id", "organizationId", "projectId", "sourceType", "sourceId", "actionType",
          "category", "entityType", "title", "subtitle", "code", "vendor", "uom",
          "unitCost", "unitPrice", "searchText", "searchVector", "payload", "createdAt", "updatedAt"
        )
        SELECT
          'lis_' || md5(concat_ws('|', $1::text, '', 'assembly', a."id")),
          $1::text,
          NULL,
          'assembly',
          a."id",
          'open_assembly',
          COALESCE(NULLIF(a."category", ''), 'Assembly'),
          'Assembly',
          a."name",
          a."description",
          a."code",
          '',
          COALESCE(NULLIF(a."unit", ''), 'EA'),
          NULL,
          NULL,
          concat_ws(' ', a."name", a."code", a."description", a."category", a."unit", a."metadata"::text),
          to_tsvector('english', concat_ws(' ', a."name", a."code", a."description", a."category", a."unit", a."metadata"::text)),
          jsonb_build_object(
            'source', 'assembly',
            'assemblyId', a."id",
            'assemblyCategory', a."category",
            'unit', a."unit",
            'code', a."code",
            'description', a."description",
            'sourceEvidence', jsonb_build_object(
              'source', 'assembly',
              'assemblyId', a."id",
              'updatedAt', a."updatedAt"
            )
          ),
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM "Assembly" a
        WHERE a."organizationId" = $1::text
        ON CONFLICT ("id") DO UPDATE SET
          "category" = EXCLUDED."category",
          "entityType" = EXCLUDED."entityType",
          "title" = EXCLUDED."title",
          "subtitle" = EXCLUDED."subtitle",
          "code" = EXCLUDED."code",
          "uom" = EXCLUDED."uom",
          "searchText" = EXCLUDED."searchText",
          "searchVector" = EXCLUDED."searchVector",
          "payload" = EXCLUDED."payload",
          "updatedAt" = CURRENT_TIMESTAMP
      `,
      this.organizationId,
    );

    await this.upsertPluginSearchDocuments();

    const countRows = await this.db.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      `
        SELECT count(*)::int AS count
        FROM "LineItemSearchDocument"
        WHERE "organizationId" = $1::text
          AND ($2::text IS NULL OR "projectId" IS NULL OR "projectId" = $2::text)
      `,
      this.organizationId,
      projectId ?? null,
    );
    return { indexed: Number(countRows[0]?.count ?? 0) };
  }

  async searchLineItemCandidates(projectId: string, input: LineItemSearchInput = {}): Promise<LineItemSearchResult[]> {
    await this.requireProject(projectId);
    await this.ensureLineItemSearchInfrastructure();
    if (input.refresh) {
      await this.rebuildLineItemSearchIndex(projectId);
    } else {
      const countRows = await this.db.$queryRawUnsafe<Array<{ count: number | bigint }>>(
        `
          SELECT count(*)::int AS count
          FROM "LineItemSearchDocument"
          WHERE "organizationId" = $1::text
            AND ("projectId" IS NULL OR "projectId" = $2::text)
        `,
        this.organizationId,
        projectId,
      );
      if (Number(countRows[0]?.count ?? 0) === 0) {
        await this.rebuildLineItemSearchIndex(projectId);
      }
    }

    const q = input.q?.trim() ?? "";
    const ftsQuery = expandLineItemFtsQuery(q);
    const preferredCategory = input.preferredCategory?.trim() ?? "";
    const sourceTypes = input.sourceTypes ?? [];
    const disabledSourceTypes = input.disabledSourceTypes ?? [];
    const disabledLaborLibraryIds = input.disabledLaborLibraryIds ?? [];
    const disabledCatalogIds = input.disabledCatalogIds ?? [];
    const limit = Math.min(100, Math.max(1, input.limit ?? 60));
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const rows = await this.db.$queryRawUnsafe<Array<{
      id: string;
      sourceType: LineItemSearchSourceType;
      sourceId: string;
      actionType: LineItemSearchActionType;
      projectId: string | null;
      category: string;
      entityType: string;
      title: string;
      subtitle: string;
      code: string;
      vendor: string;
      uom: string;
      unitCost: number | null;
      unitPrice: number | null;
      payload: unknown;
      score: number;
    }>>(
      `
        SELECT
          "id",
          "sourceType",
          "sourceId",
          "actionType",
          "projectId",
          "category",
          "entityType",
          "title",
          "subtitle",
          "code",
          "vendor",
          "uom",
          "unitCost",
          "unitPrice",
          "payload",
          (
            CASE
              WHEN $3::text <> '' AND (lower("category") = lower($3::text) OR lower("entityType") = lower($3::text)) THEN 4
              ELSE 0
            END
            + CASE "sourceType"
              WHEN 'catalog_item' THEN 1.5
              WHEN 'rate_schedule_item' THEN 1.4
              WHEN 'effective_cost' THEN 1.3
              WHEN 'labor_unit' THEN 1.2
              WHEN 'assembly' THEN 0.8
              WHEN 'external_action' THEN 0.35
              WHEN 'plugin_tool' THEN 0.25
              ELSE 0
            END
            + CASE
              WHEN NULLIF("payload"->>'rateScheduleItemId', '') IS NOT NULL THEN 1.75
              ELSE 0
            END
            + CASE
              WHEN $5::text = '' THEN 0
              WHEN lower("title") = lower($5::text) THEN 10
              WHEN lower("code") = lower($5::text) THEN 8
              WHEN lower("title") LIKE lower($5::text) || '%' THEN 5
              WHEN lower("code") LIKE lower($5::text) || '%' THEN 4
              ELSE 0
            END
            + CASE
              WHEN $6::text = '' THEN 0
              WHEN "searchVector" @@ websearch_to_tsquery('english', $6::text) THEN 2
              ELSE 0
            END
            + CASE
              WHEN $5::text = '' THEN 0
              WHEN "title" ILIKE '%' || $5::text || '%' THEN 1
              WHEN "code" ILIKE '%' || $5::text || '%' THEN 1
              WHEN "subtitle" ILIKE '%' || $5::text || '%' THEN 0.5
              WHEN "vendor" ILIKE '%' || $5::text || '%' THEN 0.5
              ELSE 0
            END
          )::double precision AS score
        FROM "LineItemSearchDocument"
        WHERE "organizationId" = $1::text
          AND ("projectId" IS NULL OR "projectId" = $2::text)
          AND ("sourceType" <> 'rate_schedule_item' OR "projectId" = $2::text)
          AND (cardinality($4::text[]) = 0 OR "sourceType" = ANY($4::text[]))
          AND (cardinality($9::text[]) = 0 OR "sourceType" <> ALL($9::text[]))
          AND (
            cardinality($10::text[]) = 0
            OR "sourceType" <> 'labor_unit'
            OR COALESCE("payload"->>'libraryId', '') <> ALL($10::text[])
          )
          AND (
            cardinality($11::text[]) = 0
            OR "sourceType" <> 'catalog_item'
            OR COALESCE("payload"->>'catalogId', '') <> ALL($11::text[])
          )
          AND (
            $5::text = ''
            OR "sourceType" = 'external_action'
            OR "searchVector" @@ websearch_to_tsquery('english', $6::text)
            OR "title" ILIKE '%' || $5::text || '%'
            OR "code" ILIKE '%' || $5::text || '%'
            OR "subtitle" ILIKE '%' || $5::text || '%'
            OR "vendor" ILIKE '%' || $5::text || '%'
          )
        ORDER BY score DESC, "title" ASC
        LIMIT $7
        OFFSET $8
      `,
      this.organizationId,
      projectId,
      preferredCategory,
      sourceTypes,
      q,
      ftsQuery,
      limit,
      offset,
      disabledSourceTypes,
      disabledLaborLibraryIds,
      disabledCatalogIds,
    );

    return rows.map((row) => ({
      id: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      actionType: row.actionType,
      projectId: row.projectId ?? null,
      category: row.category ?? "",
      entityType: row.entityType ?? "",
      title: row.title,
      subtitle: row.subtitle ?? "",
      code: row.code ?? "",
      vendor: row.vendor ?? "",
      uom: row.uom || "EA",
      unitCost: row.unitCost ?? null,
      unitPrice: row.unitPrice ?? null,
      payload: parseSearchDocumentPayload(row.payload),
      score: Number(row.score ?? 0),
    }));
  }

  private async requireCatalog(catalogId: string) {
    const catalog = await this.db.catalog.findFirst({
      where: { id: catalogId, organizationId: this.organizationId },
    });
    if (!catalog) {
      throw new Error(`Catalog ${catalogId} not found`);
    }
    return catalog;
  }

  private async requireCatalogItem(itemId: string) {
    const item = await this.db.catalogItem.findFirst({
      where: { id: itemId, catalog: { organizationId: this.organizationId } },
    });
    if (!item) {
      throw new Error(`Catalog item ${itemId} not found`);
    }
    return item;
  }

  private async requireLaborUnitLibrary(libraryId: string) {
    const library = await (this.db as any).laborUnitLibrary.findFirst({
      where: {
        id: libraryId,
        OR: [
          { organizationId: this.organizationId },
          { organizationId: null },
        ],
      } as any,
    });
    if (!library) {
      throw new Error(`Labor unit catalog ${libraryId} not found`);
    }
    return library;
  }

  private async requireLaborUnit(unitId: string) {
    const unit = await (this.db as any).laborUnit.findFirst({
      where: {
        id: unitId,
        library: {
          OR: [
            { organizationId: this.organizationId },
            { organizationId: null },
          ],
        },
      } as any,
      include: { library: true },
    });
    if (!unit) {
      throw new Error(`Labor unit ${unitId} not found`);
    }
    return unit;
  }

  private async requireCostResource(resourceId: string) {
    const resource = await (this.db as any).resourceCatalogItem.findFirst({
      where: { id: resourceId, organizationId: this.organizationId },
    });
    if (!resource) {
      throw new Error(`Cost resource ${resourceId} not found`);
    }
    return resource;
  }

  private async requireRateBookResource(resourceId: string) {
    const resource = await (this.db as any).resourceCatalogItem.findFirst({
      where: { id: resourceId, organizationId: this.organizationId },
    });
    if (!resource) {
      throw new Error(`Resource ${resourceId} not found`);
    }
    return resource;
  }

  private async requireEffectiveCost(effectiveCostId: string) {
    const cost = await (this.db as any).effectiveCost.findFirst({
      where: { id: effectiveCostId, organizationId: this.organizationId },
      include: { resource: true },
    });
    if (!cost) {
      throw new Error(`Effective cost ${effectiveCostId} not found`);
    }
    return cost;
  }

  private async validateWorksheetItemProvenanceRefs(input: {
    costResourceId?: string | null;
    effectiveCostId?: string | null;
    laborUnitId?: string | null;
  }) {
    if (input.costResourceId) {
      await this.requireCostResource(input.costResourceId);
    }
    if (input.effectiveCostId) {
      const cost = await this.requireEffectiveCost(input.effectiveCostId);
      if (input.costResourceId && cost.resourceId && cost.resourceId !== input.costResourceId) {
        throw new Error(`Cost resource ${input.costResourceId} does not match effective cost ${input.effectiveCostId}`);
      }
    }
    if (input.laborUnitId) {
      await this.requireLaborUnit(input.laborUnitId);
    }
  }

  private async requireDatasetRow(rowId: string) {
    const row = await this.db.datasetRow.findFirst({
      where: { id: rowId, dataset: { organizationId: this.organizationId } },
    });
    if (!row) {
      throw new Error(`Dataset row ${rowId} not found`);
    }
    return row;
  }

  private async validateKnowledgeBookReferences(bookIds: string[] | undefined): Promise<void> {
    if (!bookIds || bookIds.length === 0) return;
    const uniqueIds = Array.from(new Set(bookIds.filter(Boolean)));
    if (uniqueIds.length === 0) return;

    const count = await this.db.knowledgeBook.count({
      where: { id: { in: uniqueIds }, organizationId: this.organizationId },
    });
    if (count !== uniqueIds.length) {
      throw new Error("One or more knowledge books were not found");
    }
  }

  private async validateKnowledgeDocumentReferences(documentIds: string[] | undefined): Promise<void> {
    if (!documentIds || documentIds.length === 0) return;
    const uniqueIds = Array.from(new Set(documentIds.filter(Boolean)));
    if (uniqueIds.length === 0) return;

    const count = await this.db.knowledgeDocument.count({
      where: { id: { in: uniqueIds }, organizationId: this.organizationId },
    });
    if (count !== uniqueIds.length) {
      throw new Error("One or more knowledge documents were not found");
    }
  }

  private async validateQuotePatchReferences(patch: QuotePatchInput): Promise<void> {
    if (patch.customerId) {
      const customer = await this.db.customer.findFirst({
        where: { id: patch.customerId, organizationId: this.organizationId },
        select: { id: true },
      });
      if (!customer) throw badRequestError(`Customer ${patch.customerId} not found`);
    }

    if (patch.customerContactId) {
      const contact = await this.db.customerContact.findFirst({
        where: { id: patch.customerContactId, customer: { organizationId: this.organizationId } },
        include: { customer: { select: { id: true } } },
      });
      if (!contact) throw badRequestError(`Customer contact ${patch.customerContactId} not found`);
      if (patch.customerId && contact.customer.id !== patch.customerId) {
        throw badRequestError(`Customer contact ${patch.customerContactId} does not belong to customer ${patch.customerId}`);
      }
    }

    if (patch.departmentId) {
      const department = await this.db.department.findFirst({
        where: { id: patch.departmentId, organizationId: this.organizationId },
        select: { id: true },
      });
      if (!department) throw badRequestError(`Department ${patch.departmentId} not found`);
    }

    if (patch.userId) {
      const user = await this.db.user.findFirst({
        where: { id: patch.userId, organizationId: this.organizationId, active: true },
        select: { id: true },
      });
      if (!user) throw badRequestError(`User ${patch.userId} not found`);
    }
  }

  // ── Build BidwrightStore snapshot for domain functions ──────────────────

  private async buildStoreSnapshot(projectId: string): Promise<BidwrightStore> {
    const project = await this.db.project.findFirst({
      where: { id: projectId, organizationId: this.organizationId },
    });
    if (!project) throw new Error(`Project ${projectId} not found`);

    const quotes = await this.db.quote.findMany({
      where: { projectId },
      include: { customer: true },
    });
    const quoteIds = quotes.map((q) => q.id);
    const revisions = await this.db.quoteRevision.findMany({ where: { quoteId: { in: quoteIds } } });
    const revisionIds = revisions.map((r) => r.id);
    const worksheetFolders = await this.db.worksheetFolder.findMany({ where: { revisionId: { in: revisionIds } } });
    const worksheets = await this.db.worksheet.findMany({ where: { revisionId: { in: revisionIds } } });
    const worksheetIds = worksheets.map((w) => w.id);
    const worksheetItems = await this.db.worksheetItem.findMany({
      where: { worksheetId: { in: worksheetIds } },
      include: { entityCategory: true },
    });
    const phases = await this.db.phase.findMany({ where: { revisionId: { in: revisionIds } } });
    const estimateFactors = await this.db.estimateFactor.findMany({ where: { revisionId: { in: revisionIds } } });
    const adjustments = await this.db.adjustment.findMany({ where: { revisionId: { in: revisionIds } } });
    const summaryRows = await this.db.summaryRow.findMany({ where: { revisionId: { in: revisionIds } }, orderBy: { order: "asc" } });
    const conditions = await this.db.condition.findMany({ where: { revisionId: { in: revisionIds } } });
    const reportSections = await this.db.reportSection.findMany({ where: { revisionId: { in: revisionIds } } });
    const sourceDocuments = await this.db.sourceDocument.findMany({ where: { projectId } });
    const aiRuns = await this.db.aiRun.findMany({ where: { projectId } });
    const estimateStrategies = await this.db.estimateStrategy.findMany({ where: { projectId } });
    const estimateCalibrationFeedback = await this.db.estimateCalibrationFeedback.findMany({ where: { projectId } });
    const citations = await this.db.citation.findMany({ where: { projectId } });
    const activities = await this.db.activity.findMany({ where: { projectId } });
    const jobs = await this.db.job.findMany({ where: { projectId } });
    const fileNodes = await this.db.fileNode.findMany({ where: { projectId } });
    const pluginExecutions = await this.db.pluginExecution.findMany({ where: { projectId } });
    const takeoffLinks = await this.db.takeoffLink.findMany({ where: { projectId } });
    const scheduleTasks = await this.db.scheduleTask.findMany({ where: { projectId } });
    const scheduleTaskIds = scheduleTasks.map((t) => t.id);
    const scheduleDependencies = scheduleTaskIds.length > 0
      ? await this.db.scheduleDependency.findMany({ where: { predecessorId: { in: scheduleTaskIds } } })
      : [];
    const scheduleCalendars = await this.db.scheduleCalendar.findMany({ where: { projectId } });
    const scheduleBaselines = await this.db.scheduleBaseline.findMany({ where: { projectId } });
    const scheduleBaselineIds = scheduleBaselines.map((baseline) => baseline.id);
    const scheduleBaselineTasks = scheduleBaselineIds.length > 0
      ? await this.db.scheduleBaselineTask.findMany({ where: { baselineId: { in: scheduleBaselineIds } } })
      : [];
    const scheduleResources = await this.db.scheduleResource.findMany({ where: { projectId } });
    const scheduleTaskAssignments = scheduleTaskIds.length > 0
      ? await this.db.scheduleTaskAssignment.findMany({ where: { taskId: { in: scheduleTaskIds } } })
      : [];

    // Global entities for the org
    const catalogs = await this.db.catalog.findMany({ where: { organizationId: this.organizationId } });
    const catalogIds = catalogs.map((c) => c.id);
    const catalogItems = await this.db.catalogItem.findMany({ where: { catalogId: { in: catalogIds } } });
    const conditionLibrary = await this.db.conditionLibraryEntry.findMany({ where: { organizationId: this.organizationId } });
    const plugins = await this.db.plugin.findMany({ where: { organizationId: this.organizationId } });
    const users = await this.db.user.findMany({ where: { organizationId: this.organizationId } });
    const entityCategories = await this.db.entityCategory.findMany({ where: { organizationId: this.organizationId } });

    // Rate schedules: both revision-scoped and org-level
    const rateSchedules = await this.db.rateSchedule.findMany({
      where: { OR: [{ revisionId: { in: revisionIds } }, { organizationId: this.organizationId, scope: "global" }] },
      include: { tiers: true, items: true },
    });
    const mappedAdjustments = adjustments.map(mapAdjustment);
    const mappedModifiers = mappedAdjustments
      .map(adjustmentToLegacyModifier)
      .filter(isLegacyModifier);
    const mappedAdditionalLineItems = mappedAdjustments
      .map(adjustmentToLegacyAdditionalLineItem)
      .filter(isLegacyAdditionalLineItem);

    return {
      projects: [mapProject(project)],
      sourceDocuments: sourceDocuments.map(mapSourceDocument),
      quotes: quotes.map(mapQuote),
      revisions: revisions.map(mapRevision),
      worksheetFolders: worksheetFolders.map(mapWorksheetFolder),
      worksheets: worksheets.map(mapWorksheet),
      worksheetItems: worksheetItems.map(mapWorksheetItem),
      phases: phases.map(mapPhase),
      estimateFactors: estimateFactors.map(mapEstimateFactor),
      adjustments: mappedAdjustments,
      modifiers: mappedModifiers,
      additionalLineItems: mappedAdditionalLineItems,
      summaryRows: summaryRows.map(mapSummaryRow),
      conditions: conditions.map(mapCondition),
      catalogs: catalogs.map(mapCatalog),
      catalogItems: catalogItems.map(mapCatalogItem),
      aiRuns: aiRuns.map(mapAiRun) as any,
      estimateStrategies: estimateStrategies.map(mapEstimateStrategy),
      estimateCalibrationFeedback: estimateCalibrationFeedback.map(mapEstimateCalibrationFeedback),
      citations: citations.map(mapCitation) as any,
      activities: activities.map(mapActivity),
      conditionLibrary: conditionLibrary.map(mapConditionLibrary),
      reportSections: reportSections.map(mapReportSection),
      jobs: jobs.map(mapJob),
      fileNodes: fileNodes.map(mapFileNode),
      plugins: plugins.map(mapPlugin),
      pluginExecutions: pluginExecutions.map(mapPluginExecution),
      users: users.map(mapUser),
      authSessions: [],
      knowledgeBooks: [],
      knowledgeChunks: [],
      knowledgeDocuments: [],
      knowledgeDocumentPages: [],
      knowledgeDocumentChunks: [],
      datasets: [],
      datasetRows: [],
      entityCategories: entityCategories.map(mapEntityCategory) as any,
      scheduleTasks: scheduleTasks.map(mapScheduleTask),
      scheduleDependencies: scheduleDependencies.map(mapScheduleDependency),
      scheduleCalendars: scheduleCalendars.map(mapScheduleCalendar),
      scheduleBaselines: scheduleBaselines.map(mapScheduleBaseline),
      scheduleBaselineTasks: scheduleBaselineTasks.map(mapScheduleBaselineTask),
      scheduleResources: scheduleResources.map(mapScheduleResource),
      scheduleTaskAssignments: scheduleTaskAssignments.map(mapScheduleTaskAssignment),
      rateSchedules: rateSchedules.map(mapRateSchedule),
      rateScheduleTiers: rateSchedules.flatMap((s) => (s.tiers ?? []).map(mapRateScheduleTier)),
      rateScheduleItems: rateSchedules.flatMap((s) => (s.items ?? []).map(mapRateScheduleItem)),
      takeoffLinks: takeoffLinks.map(mapTakeoffLink),
    };
  }

  // ── Private: sync estimate totals back to the revision ──────────────────

  private async resolveCurrentRevisionTotals(projectId: string) {
    await this.requireProject(projectId);
    const { quote, revision } = await this.findCurrentRevision(projectId);
    if (!quote || !revision) {
      return null;
    }

    const [worksheets, phases, estimateFactors, adjustments, revisionSchedules, entityCategories] = await Promise.all([
      this.db.worksheet.findMany({
        where: { revisionId: revision.id },
        include: { items: { include: { entityCategory: true } } },
        orderBy: { order: "asc" },
      }),
      this.db.phase.findMany({
        where: { revisionId: revision.id },
        orderBy: { order: "asc" },
      }),
      this.db.estimateFactor.findMany({
        where: { revisionId: revision.id },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      }),
      this.db.adjustment.findMany({
        where: { revisionId: revision.id },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      }),
      this.db.rateSchedule.findMany({
        where: { revisionId: revision.id },
        include: { tiers: true, items: true },
      }),
      this.db.entityCategory.findMany({ where: { organizationId: this.organizationId } }),
    ]);

    const mappedRevision = mapRevision(revision);
    const mappedWorksheets: Array<ReturnType<typeof mapWorksheet> & { items: WorksheetItem[] }> =
      worksheets.map((worksheet) => ({
        ...mapWorksheet(worksheet),
        items: (worksheet.items ?? [])
          .map(mapWorksheetItem)
          .sort((left, right) => {
            if (left.lineOrder !== right.lineOrder) {
              return left.lineOrder - right.lineOrder;
            }
            return left.id.localeCompare(right.id);
          }),
      }));

    return {
      quote,
      revision,
      mappedRevision,
      totals: calculateTotals(
        mappedRevision,
        mappedWorksheets,
        phases.map(mapPhase),
        adjustments.map(mapAdjustment),
        revisionSchedules.map(mapRateScheduleWithChildren),
        entityCategories.map(mapEntityCategory),
        undefined,
        estimateFactors.map(mapEstimateFactor),
      ),
    };
  }

  private async getRevisionItemAggregateRows(revisionId: string): Promise<RevisionItemAggregateRow[]> {
    // wi.cost is always per-unit (see calc-engine storage convention); the line's
    // extended cost is qty × cost regardless of category. wi.price is the line total.
    return this.db.$queryRaw<RevisionItemAggregateRow[]>`
      SELECT
        wi."phaseId" AS "phaseId",
        wi."category" AS "category",
        COALESCE(SUM(wi."price"), 0)::double precision AS "priceTotal",
        COALESCE(SUM(wi."quantity" * wi."cost"), 0)::double precision AS "costTotal"
      FROM "WorksheetItem" wi
      INNER JOIN "Worksheet" w ON w."id" = wi."worksheetId"
      WHERE w."revisionId" = ${revisionId}
      GROUP BY wi."phaseId", wi."category"
    `;
  }

  private async syncProjectEstimateForWorksheetItemMutation(
    projectId: string,
    options: {
      previousItem?: WorksheetItem | null;
      nextItem?: WorksheetItem | null;
      revisionSchedules?: RateScheduleWithChildren[];
      timestamp?: string;
    } = {},
  ): Promise<EstimateMutationSnapshot | null> {
    const { quote, revision } = await this.findCurrentRevision(projectId);
    const timestampDate = new Date(options.timestamp ?? isoNow());

    if (!quote || !revision) {
      await this.db.project.update({
        where: { id: projectId },
        data: { updatedAt: timestampDate },
      });
      return null;
    }

    const [aggregateRows, phaseRows, activeFactorCount, adjustmentRows, revisionSchedules, entityCategoryRows] = await Promise.all([
      this.getRevisionItemAggregateRows(revision.id),
      this.db.phase.findMany({
        where: { revisionId: revision.id },
        orderBy: { order: "asc" },
      }),
      this.db.estimateFactor.count({
        where: { revisionId: revision.id, active: true },
      }),
      this.db.adjustment.findMany({
        where: { revisionId: revision.id },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      }),
      options.revisionSchedules
        ? Promise.resolve(options.revisionSchedules)
        : this.db.rateSchedule.findMany({
            where: { revisionId: revision.id },
            include: { tiers: true, items: true },
          }).then((rows) => rows.map(mapRateScheduleWithChildren)),
      this.db.entityCategory.findMany({ where: { organizationId: this.organizationId } }),
    ]);

    if (activeFactorCount > 0) {
      const totals = await this.syncProjectEstimate(projectId, options.timestamp);
      const currentRevision = await this.getCurrentRevisionSnapshot(projectId);
      return currentRevision && totals ? { currentRevision, estimateTotals: totals } : null;
    }

    const groupedAggregates = new Map<string, {
      phaseId: string | null;
      category: string;
      priceTotal: number;
      costTotal: number;
    }>();

    for (const row of aggregateRows) {
      const category = normalizeEstimateCategoryName(String(row.category ?? ""));
      const phaseId = row.phaseId ?? null;
      const key = `${phaseId ?? "__unphased__"}::${category}`;
      const existing = groupedAggregates.get(key) ?? {
        phaseId,
        category,
        priceTotal: 0,
        costTotal: 0,
      };
      existing.priceTotal += Number(row.priceTotal) || 0;
      existing.costTotal += Number(row.costTotal) || 0;
      groupedAggregates.set(key, existing);
    }

    const phaseOrder = new Map(phaseRows.map((phase, index) => [phase.id, index]));
    const aggregateItems = Array.from(groupedAggregates.values())
      .sort((left, right) => {
        const leftOrder = left.phaseId ? (phaseOrder.get(left.phaseId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        const rightOrder = right.phaseId ? (phaseOrder.get(right.phaseId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
        return left.category.localeCompare(right.category);
      })
      .map((entry, index) => ({
        id: `aggregate-item-${index + 1}`,
        worksheetId: "__aggregate__",
        phaseId: entry.phaseId,
        category: entry.category,
        entityType: entry.category,
        entityName: entry.category,
        description: "",
        quantity: 1,
        uom: "EA",
        cost: roundMoney(entry.costTotal),
        markup: 0,
        price: roundMoney(entry.priceTotal),
        lineOrder: index + 1,
        rateScheduleItemId: null,
        itemId: null,
        tierUnits: {},
        sourceNotes: "",
      } satisfies WorksheetItem));

    const mappedRevision = mapRevision(revision);
    const totalsBase = calculateTotals(
      mappedRevision,
      [{
        id: "__aggregate__",
        revisionId: revision.id,
        name: "Aggregated",
        order: 1,
        items: aggregateItems,
      }],
      phaseRows.map(mapPhase),
      adjustmentRows.map(mapAdjustment),
      [],
      entityCategoryRows.map(mapEntityCategory),
    );

    // Bucket per-tier hours into the revision's reg/over/double summary columns
    // by tier multiplier (1.0 = reg, 1.5 = over, 2.0 = double). Tiers with other
    // multipliers contribute to total only.
    const toHourTotals = (item?: WorksheetItem | null) => {
      if (!item) {
        return { reg: 0, over: 0, double: 0, total: 0 };
      }
      const breakdown = getExtendedWorksheetHourBreakdown(item, revisionSchedules, item.quantity);
      let reg = 0;
      let over = 0;
      let double = 0;
      for (const tier of breakdown.tiers) {
        if (tier.multiplier === 1) reg += tier.hours;
        else if (tier.multiplier === 1.5) over += tier.hours;
        else if (tier.multiplier === 2) double += tier.hours;
      }
      return { reg, over, double, total: breakdown.total };
    };

    const previousHours = toHourTotals(options.previousItem);
    const nextHours = toHourTotals(options.nextItem);
    const regHours = roundMoney((Number(revision.regHours) || 0) - previousHours.reg + nextHours.reg);
    const overHours = roundMoney((Number(revision.overHours) || 0) - previousHours.over + nextHours.over);
    const doubleHours = roundMoney((Number(revision.doubleHours) || 0) - previousHours.double + nextHours.double);
    const totalHours = roundMoney((Number(revision.totalHours) || 0) - previousHours.total + nextHours.total);

    const totals: RevisionTotals = {
      ...totalsBase,
      regHours,
      overHours,
      doubleHours,
      totalHours,
    };

    const updatedRevision = await this.db.quoteRevision.update({
      where: { id: revision.id },
      data: {
        subtotal: totals.subtotal,
        cost: totals.cost,
        estimatedProfit: totals.estimatedProfit,
        estimatedMargin: totals.estimatedMargin,
        calculatedTotal: totals.calculatedTotal,
        regHours: totals.regHours,
        overHours: totals.overHours,
        doubleHours: totals.doubleHours,
        totalHours: totals.totalHours,
        breakoutPackage: totals.breakout as any,
        calculatedCategoryTotals: totals.categoryTotals as any,
        pricingLadder: totals.pricingLadder as any,
      },
    });

    await this.db.quote.update({
      where: { id: quote.id },
      data: { updatedAt: timestampDate },
    });

    await this.db.project.update({
      where: { id: projectId },
      data: { updatedAt: timestampDate },
    });

    return {
      currentRevision: mapRevision(updatedRevision),
      estimateTotals: totals,
    };
  }

  private async syncProjectEstimate(projectId: string, timestamp = isoNow()) {
    const resolved = await this.resolveCurrentRevisionTotals(projectId);
    const timestampDate = new Date(timestamp);

    if (resolved) {
      const { quote, revision, totals } = resolved;
      await this.db.quoteRevision.update({
        where: { id: revision.id },
        data: {
          subtotal: totals.subtotal,
          cost: totals.cost,
          estimatedProfit: totals.estimatedProfit,
          estimatedMargin: totals.estimatedMargin,
          calculatedTotal: totals.calculatedTotal,
          regHours: totals.regHours,
          overHours: totals.overHours,
          doubleHours: totals.doubleHours,
          totalHours: totals.totalHours,
          breakoutPackage: totals.breakout as any,
          calculatedCategoryTotals: totals.categoryTotals as any,
          pricingLadder: totals.pricingLadder as any,
        } as any,
      });

      await this.db.quote.update({
        where: { id: quote.id },
        data: { updatedAt: timestampDate },
      });

      await this.db.project.update({
        where: { id: projectId },
        data: { updatedAt: timestampDate },
      });

      return totals;
    }

    await this.db.project.update({
      where: { id: projectId },
      data: { updatedAt: timestampDate },
    });

    return null;
  }

  // ── Private: find current revision ──────────────────────────────────────

  private async findCurrentRevision(projectId: string) {
    const quote = await this.db.quote.findFirst({ where: { projectId } });
    if (!quote) return { quote: null, revision: null };
    const revision = await this.db.quoteRevision.findFirst({ where: { id: quote.currentRevisionId } });
    return { quote, revision };
  }

  private async requireCurrentRevision(projectId: string) {
    const { quote, revision } = await this.findCurrentRevision(projectId);
    if (!quote || !revision) {
      throw new Error(`Project ${projectId} does not have an active revision`);
    }
    return { quote, revision };
  }

  private async ensureDefaultScheduleCalendar(projectId: string, revisionId: string) {
    const existing = await this.db.scheduleCalendar.findFirst({
      where: { projectId, revisionId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    if (existing) {
      if (!existing.isDefault) {
        await this.db.scheduleCalendar.update({ where: { id: existing.id }, data: { isDefault: true } });
        return { ...existing, isDefault: true };
      }
      return existing;
    }

    return this.db.scheduleCalendar.create({
      data: {
        id: createId("schcal"),
        projectId,
        revisionId,
        name: "Standard 5-Day",
        description: "Default Monday-Friday schedule calendar",
        isDefault: true,
        workingDays: DEFAULT_SCHEDULE_WORKING_DAYS as any,
        shiftStartMinutes: 480,
        shiftEndMinutes: 1020,
      },
    });
  }

  private async syncTaskAssignments(
    projectId: string,
    taskId: string,
    assignments?: Array<{ resourceId: string; units?: number; role?: string }>
  ) {
    if (assignments === undefined) {
      return;
    }

    const cleaned = Array.from(
      new Map(
        assignments
          .filter((assignment) => assignment.resourceId?.trim())
          .map((assignment) => [
            assignment.resourceId,
            {
              resourceId: assignment.resourceId,
              units: assignment.units ?? 1,
              role: assignment.role ?? "",
            } as any,
          ])
      ).values()
    );

    if (cleaned.length > 0) {
      const validResourceIds = new Set(
        (
          await this.db.scheduleResource.findMany({
            where: { projectId, id: { in: cleaned.map((assignment) => assignment.resourceId) } },
            select: { id: true },
          })
        ).map((resource) => resource.id)
      );
      const invalid = cleaned.find((assignment) => !validResourceIds.has(assignment.resourceId));
      if (invalid) {
        throw new Error(`Schedule resource ${invalid.resourceId} not found`);
      }
    }

    await this.db.scheduleTaskAssignment.deleteMany({ where: { taskId } });
    if (cleaned.length > 0) {
      await this.db.scheduleTaskAssignment.createMany({
        data: cleaned.map((assignment) => ({
          id: createId("schasg"),
          taskId,
          resourceId: assignment.resourceId,
          units: assignment.units,
          role: assignment.role,
        })),
      });
    }
  }

  private async enforceSingleDefaultScheduleCalendar(projectId: string, revisionId: string, calendarId: string) {
    await this.db.scheduleCalendar.updateMany({
      where: { projectId, revisionId, id: { not: calendarId } },
      data: { isDefault: false },
    });
  }

  private async enforceSinglePrimaryBaseline(projectId: string, revisionId: string, baselineId: string) {
    await this.db.scheduleBaseline.updateMany({
      where: { projectId, revisionId, id: { not: baselineId } },
      data: { isPrimary: false },
    });
  }

  private async syncPrimaryBaselineFields(projectId: string, revisionId: string) {
    const primary = await this.db.scheduleBaseline.findFirst({
      where: { projectId, revisionId, isPrimary: true },
      orderBy: { updatedAt: "desc" },
    });
    const tasks = await this.db.scheduleTask.findMany({
      where: { projectId, revisionId },
      select: { id: true },
    });

    if (!primary) {
      for (const task of tasks) {
        await this.db.scheduleTask.update({
          where: { id: task.id },
          data: { baselineStart: null, baselineEnd: null },
        });
      }
      return;
    }

    const items = await this.db.scheduleBaselineTask.findMany({ where: { baselineId: primary.id } });
    const itemByTaskId = new Map(items.map((item) => [item.taskId, item]));

    for (const task of tasks) {
      const snapshot = itemByTaskId.get(task.id);
      await this.db.scheduleTask.update({
        where: { id: task.id },
        data: {
          baselineStart: snapshot?.startDate ?? null,
          baselineEnd: snapshot?.endDate ?? null,
        },
      });
    }
  }

  private async captureScheduleBaseline(
    projectId: string,
    revisionId: string,
    input: CreateScheduleBaselineInput
  ) {
    const isPrimary = !!input.isPrimary || input.kind === "primary";
    const tasks = await this.db.scheduleTask.findMany({
      where: { projectId, revisionId },
      orderBy: { order: "asc" },
    });

    let baseline = isPrimary
      ? await this.db.scheduleBaseline.findFirst({ where: { projectId, revisionId, isPrimary: true } })
      : null;

    if (baseline) {
      baseline = await this.db.scheduleBaseline.update({
        where: { id: baseline.id },
        data: {
          name: input.name ?? baseline.name,
          description: input.description ?? baseline.description,
          kind: input.kind ?? "primary",
          isPrimary: true,
        },
      });
      await this.db.scheduleBaselineTask.deleteMany({ where: { baselineId: baseline.id } });
    } else {
      baseline = await this.db.scheduleBaseline.create({
        data: {
          id: createId("schbase"),
          projectId,
          revisionId,
          name: input.name ?? (isPrimary ? "Primary Baseline" : "Schedule Snapshot"),
          description: input.description ?? "",
          kind: input.kind ?? (isPrimary ? "primary" : "custom"),
          isPrimary,
        },
      });
    }

    if (tasks.length > 0) {
      await this.db.scheduleBaselineTask.createMany({
        data: tasks.map((task) => ({
          id: createId("schbitem"),
          baselineId: baseline.id,
          taskId: task.id,
          taskName: task.name,
          phaseId: task.phaseId ?? null,
          startDate: task.startDate ?? null,
          endDate: task.endDate ?? null,
          duration: task.duration ?? 0,
        })),
      });
    }

    if (isPrimary) {
      await this.enforceSinglePrimaryBaseline(projectId, revisionId, baseline.id);
      await this.syncPrimaryBaselineFields(projectId, revisionId);
    }

    return baseline;
  }

  private async syncScheduleSummaryTaskRollups(projectId: string, revisionId: string) {
    const tasks = await this.db.scheduleTask.findMany({
      where: { projectId, revisionId },
      orderBy: { order: "asc" },
    });
    if (tasks.length === 0) return;

    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const childrenByParent = new Map<string, typeof tasks>();
    for (const task of tasks) {
      const parentId =
        task.parentTaskId && task.parentTaskId !== task.id && taskById.has(task.parentTaskId)
          ? task.parentTaskId
          : null;
      if (!parentId) continue;
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      childrenByParent.get(parentId)!.push(task);
    }

    const rolledById = new Map<string, (typeof tasks)[number]>();
    const rollTask = (taskId: string): (typeof tasks)[number] => {
      const cached = rolledById.get(taskId);
      if (cached) return cached;

      const task = taskById.get(taskId)!;
      const rolledChildren = (childrenByParent.get(taskId) ?? []).map((child) => rollTask(child.id));
      if (rolledChildren.length === 0) {
        rolledById.set(taskId, task);
        return task;
      }

      const startCandidates = rolledChildren
        .map((child) => parseScheduleDate(child.startDate ?? child.endDate))
        .filter((value): value is Date => !!value);
      const endCandidates = rolledChildren
        .map((child) => parseScheduleDate(child.endDate ?? child.startDate))
        .filter((value): value is Date => !!value);
      const actualStartCandidates = rolledChildren
        .map((child) => parseScheduleDate(child.actualStart))
        .filter((value): value is Date => !!value);
      const actualEndCandidates = rolledChildren
        .map((child) => parseScheduleDate(child.actualEnd))
        .filter((value): value is Date => !!value);

      const earliestStart =
        startCandidates.length > 0
          ? new Date(Math.min(...startCandidates.map((value) => value.getTime())))
          : null;
      const latestEnd =
        endCandidates.length > 0
          ? new Date(Math.max(...endCandidates.map((value) => value.getTime())))
          : null;
      const earliestActualStart =
        actualStartCandidates.length > 0
          ? new Date(Math.min(...actualStartCandidates.map((value) => value.getTime())))
          : null;
      const latestActualEnd =
        actualEndCandidates.length === rolledChildren.length && actualEndCandidates.length > 0
          ? new Date(Math.max(...actualEndCandidates.map((value) => value.getTime())))
          : null;
      const weightedDuration = rolledChildren.reduce((sum, child) => sum + Math.max(1, child.duration ?? 0), 0);
      const progress =
        weightedDuration > 0
          ? Math.max(
              0,
              Math.min(
                1,
                rolledChildren.reduce(
                  (sum, child) => sum + (child.progress ?? 0) * Math.max(1, child.duration ?? 0),
                  0
                ) / weightedDuration
              )
            )
          : 0;
      const anyStarted = rolledChildren.some(
        (child) =>
          child.status === "in_progress" ||
          child.status === "complete" ||
          (child.progress ?? 0) > 0 ||
          !!child.actualStart ||
          !!child.actualEnd
      );
      const status =
        rolledChildren.every((child) => child.status === "complete")
          ? "complete"
          : rolledChildren.every((child) => child.status === "on_hold")
            ? "on_hold"
            : anyStarted
              ? "in_progress"
              : rolledChildren.some((child) => child.status === "on_hold")
                ? "on_hold"
                : "not_started";

      const rolledTask = {
        ...task,
        taskType: "summary",
        startDate: earliestStart ? formatScheduleDate(earliestStart) : task.startDate,
        endDate: latestEnd ? formatScheduleDate(latestEnd) : task.endDate,
        duration: earliestStart && latestEnd ? Math.max(0, diffScheduleDays(latestEnd, earliestStart)) : task.duration,
        progress,
        status,
        actualStart: earliestActualStart ? formatScheduleDate(earliestActualStart) : null,
        actualEnd: latestActualEnd ? formatScheduleDate(latestActualEnd) : null,
      } as (typeof tasks)[number];
      rolledById.set(taskId, rolledTask);
      return rolledTask;
    };

    const updates: Prisma.PrismaPromise<unknown>[] = [];
    for (const task of tasks) {
      if (!(childrenByParent.get(task.id)?.length)) continue;
      const rolled = rollTask(task.id);
      const patch: Prisma.ScheduleTaskUpdateInput = {};
      if ((task.taskType ?? "task") !== "summary") patch.taskType = "summary";
      if ((task.startDate ?? null) !== (rolled.startDate ?? null)) patch.startDate = rolled.startDate ?? null;
      if ((task.endDate ?? null) !== (rolled.endDate ?? null)) patch.endDate = rolled.endDate ?? null;
      if ((task.duration ?? 0) !== (rolled.duration ?? 0)) patch.duration = rolled.duration ?? 0;
      if (Math.abs((task.progress ?? 0) - (rolled.progress ?? 0)) > 0.0001) patch.progress = rolled.progress ?? 0;
      if ((task.status ?? "not_started") !== (rolled.status ?? "not_started")) patch.status = rolled.status;
      if ((task.actualStart ?? null) !== (rolled.actualStart ?? null)) patch.actualStart = rolled.actualStart ?? null;
      if ((task.actualEnd ?? null) !== (rolled.actualEnd ?? null)) patch.actualEnd = rolled.actualEnd ?? null;

      if (Object.keys(patch).length > 0) {
        updates.push(
          this.db.scheduleTask.update({
            where: { id: task.id },
            data: patch,
          })
        );
      }
    }

    if (updates.length > 0) {
      await this.db.$transaction(updates);
    }
  }

  private advanceStrategyStage(currentStage: string | null | undefined, nextStage: string) {
    const order: Record<string, number> = {
      scope: 1,
      execution: 2,
      packaging: 3,
      benchmark: 4,
      reconcile: 5,
      complete: 6,
    };
    const current = currentStage && order[currentStage] ? currentStage : "scope";
    return order[nextStage] > order[current] ? nextStage : current;
  }

  private normalizeEstimateCategory(value: string | null | undefined, entityType?: string | null | undefined) {
    // Categories are dynamically configured per organization. Trim and fall back
    // to entityType, then "Uncategorized" if both are blank.
    const trimmed = typeof value === "string" ? value.trim() : "";
    const trimmedEntityType = typeof entityType === "string" ? entityType.trim() : "";
    return trimmed || trimmedEntityType || "Uncategorized";
  }

  private estimateItemExtendedHours(item: {
    category?: string | null;
    entityType?: string | null;
    quantity?: number | null;
    tierUnits?: Record<string, number> | null;
    rateScheduleItemId?: string | null;
  }) {
    // Hours roll up only from rate-schedule-linked items (tier unit breakdown);
    // any other category contributes zero hours.
    const hasTierUnits = !!item.tierUnits && Object.keys(item.tierUnits).length > 0;
    const linkedToSchedule = !!item.rateScheduleItemId;
    if (!hasTierUnits && !linkedToSchedule) {
      return 0;
    }

    return getExtendedWorksheetHourBreakdown(item, [], Number(item.quantity ?? 1)).total;
  }

  private estimateItemExtendedCost(item: {
    category?: string | null;
    entityType?: string | null;
    quantity?: number | null;
    cost?: number | null;
  }) {
    // wi.cost is always per-unit (see calc-engine storage convention).
    const quantity = Number(item.quantity ?? 1);
    const cost = Number(item.cost ?? 0);
    return quantity * cost;
  }

  private categoryShareMetrics(items: Array<{ category?: string | null; entityType?: string | null; quantity?: number | null; price?: number | null; tierUnits?: Record<string, number> | null; rateScheduleItemId?: string | null }>) {
    const totalsByCategory = new Map<string, { value: number; hours: number }>();
    let totalValue = 0;
    let totalHours = 0;

    for (const item of items) {
      const category = this.normalizeEstimateCategory(item.category, item.entityType);
      const value = Number(item.price ?? 0);
      const hours = this.estimateItemExtendedHours(item);
      totalValue += value;
      totalHours += hours;
      const existing = totalsByCategory.get(category) ?? { value: 0, hours: 0 };
      existing.value += value;
      existing.hours += hours;
      totalsByCategory.set(category, existing);
    }

    const valueShare: Record<string, number> = {};
    const hourShare: Record<string, number> = {};
    for (const [category, totals] of totalsByCategory.entries()) {
      valueShare[category] = totalValue > 0 ? totals.value / totalValue : 0;
      hourShare[category] = totalHours > 0 ? totals.hours / totalHours : 0;
    }

    return { valueShare, hourShare, totalValue, totalHours };
  }

  private buildEstimateSnapshot(
    workspace: ProjectWorkspace,
    strategy?: { benchmarkProfile?: unknown } | null,
  ): Record<string, unknown> {
    const lineItems = (workspace.worksheets ?? []).flatMap((worksheet) => worksheet.items ?? []);
    const shares = this.categoryShareMetrics(lineItems);

    const worksheetTotals = Object.fromEntries(
      (workspace.worksheets ?? []).map((worksheet) => {
        const totals = (worksheet.items ?? []).reduce((acc, item) => {
          acc.lineItemCount += 1;
          acc.extendedHours += this.estimateItemExtendedHours(item);
          acc.extendedCost += this.estimateItemExtendedCost(item);
          acc.extendedPrice += Number(item.price ?? 0);
          return acc;
        }, {
          lineItemCount: 0,
          extendedHours: 0,
          extendedCost: 0,
          extendedPrice: 0,
        });

        return [worksheet.name || worksheet.id, {
          lineItemCount: totals.lineItemCount,
          extendedHours: Number(totals.extendedHours.toFixed(2)),
          extendedCost: Number(totals.extendedCost.toFixed(2)),
          extendedPrice: Number(totals.extendedPrice.toFixed(2)),
        }];
      }),
    );

    return {
      totalHours: Number(workspace.currentRevision.totalHours ?? workspace.estimate.totals.totalHours ?? 0),
      subtotal: Number(workspace.currentRevision.subtotal ?? workspace.estimate.totals.subtotal ?? 0),
      worksheetCount: workspace.worksheets.length,
      lineItemCount: workspace.estimate.lineItems.length,
      worksheetTotals,
      categoryValueShare: shares.valueShare,
      categoryHourShare: shares.hourShare,
      benchmarkProfile: strategy && typeof strategy.benchmarkProfile === "object" ? strategy.benchmarkProfile : {},
      capturedAt: new Date().toISOString(),
    };
  }

  private buildEstimateComputedSummary(
    workspace: ProjectWorkspace,
    strategy?: { benchmarkProfile?: unknown } | null,
  ): Record<string, unknown> {
    const items = (workspace.worksheets ?? []).flatMap((worksheet) => worksheet.items ?? []);
    type Totals = { lineItemCount: number; hours: number; cost: number; price: number };
    const emptyTotals = (): Totals => ({ lineItemCount: 0, hours: 0, cost: 0, price: 0 });
    const accumulate = (target: Totals, item: typeof items[number]) => {
      target.lineItemCount += 1;
      target.hours += this.estimateItemExtendedHours(item);
      target.cost += this.estimateItemExtendedCost(item);
      target.price += Number(item.price ?? 0);
    };

    // Per-category roll-up (keyed by category name).
    const categoryTotals = new Map<string, Totals>();
    // Per-analytics-bucket roll-up (keyed by bucket name from EntityCategory.analyticsBucket).
    const bucketTotals = new Map<string, Totals>();

    // Build category-name → bucket lookup from the org's configured EntityCategory rows.
    const bucketByCategory = new Map<string, string | null>();
    for (const cat of workspace.entityCategories ?? []) {
      bucketByCategory.set(cat.name, cat.analyticsBucket ?? null);
    }

    for (const item of items) {
      const categoryName = this.normalizeEstimateCategory(item.category, item.entityType);
      const categoryEntry = categoryTotals.get(categoryName) ?? emptyTotals();
      accumulate(categoryEntry, item);
      categoryTotals.set(categoryName, categoryEntry);

      const bucket = bucketByCategory.get(categoryName);
      if (bucket) {
        const bucketEntry = bucketTotals.get(bucket) ?? emptyTotals();
        accumulate(bucketEntry, item);
        bucketTotals.set(bucket, bucketEntry);
      }
    }

    const fmtTotals = (totals: Totals) => ({
      lineItemCount: totals.lineItemCount,
      hours: Number(totals.hours.toFixed(2)),
      cost: Number(totals.cost.toFixed(2)),
      price: Number(totals.price.toFixed(2)),
    });

    const categoryBreakdown = Object.fromEntries(
      Array.from(categoryTotals.entries())
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([category, totals]) => [category, fmtTotals(totals)]),
    );
    const bucketBreakdown = Object.fromEntries(
      Array.from(bucketTotals.entries())
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([bucket, totals]) => [bucket, fmtTotals(totals)]),
    );

    const zeroPricedItems = items.filter((item) => Number(item.price ?? 0) === 0 && this.estimateItemExtendedCost(item) === 0);
    const duplicateGroups = new Map<string, number>();
    for (const item of items) {
      const entity = String(item.entityName ?? "").trim().toLowerCase();
      const description = String(item.description ?? "").trim().toLowerCase();
      if (!entity && !description) continue;
      const signature = `${this.normalizeEstimateCategory(item.category, item.entityType)}|${entity}|${description}`;
      duplicateGroups.set(signature, (duplicateGroups.get(signature) ?? 0) + 1);
    }
    const duplicateEntries = Array.from(duplicateGroups.values()).filter((count) => count > 1);

    const totalHours = Number(workspace.currentRevision.totalHours ?? workspace.estimate.totals.totalHours ?? 0);
    const subtotal = Number(workspace.currentRevision.subtotal ?? workspace.estimate.totals.subtotal ?? 0);
    const worksheetCount = workspace.worksheets.length;
    const lineItemCount = workspace.estimate.lineItems.length;
    const benchmarkProfile = strategy && typeof strategy.benchmarkProfile === "object"
      ? { ...(strategy.benchmarkProfile as Record<string, unknown>) }
      : {};
    benchmarkProfile.current = {
      ...this.asEstimateObject(benchmarkProfile.current),
      totalHours,
      subtotal,
      hoursPerItem: lineItemCount > 0 ? Number((totalHours / lineItemCount).toFixed(2)) : 0,
      hoursPerWorksheet: worksheetCount > 0 ? Number((totalHours / worksheetCount).toFixed(2)) : 0,
      pricePerHour: totalHours > 0 ? Number((subtotal / totalHours).toFixed(2)) : 0,
    };

    return {
      totalHours,
      subtotal,
      worksheetCount,
      lineItemCount,
      zeroPriceItemCount: zeroPricedItems.length,
      duplicateGroupCount: duplicateEntries.length,
      duplicateItemCount: duplicateEntries.reduce((sum, count) => sum + count, 0),
      // Per-category and per-analytics-bucket rolls — keyed by the org's own
      // configured names, not a fixed enum. Consumers (AI claim verifier,
      // benchmark profile, downstream reports) read from these maps instead of
      // hardcoded labour/material/equipment fields.
      categoryBreakdown,
      bucketBreakdown,
      benchmarkProfile,
      capturedAt: new Date().toISOString(),
    };
  }

  private asEstimateObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private asEstimateStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [];
  }

  private estimateSizeBucket(totalHours: number) {
    if (totalHours < 400) return "small";
    if (totalHours < 2000) return "medium";
    return "large";
  }

  private derivePackageCommercialProfile(packagePlanValue: unknown) {
    const counts = {
      detailed: 0,
      allowance: 0,
      subcontract: 0,
      historical_allowance: 0,
    };

    const packagePlan = Array.isArray(packagePlanValue)
      ? packagePlanValue.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry))
      : [];

    for (const entry of packagePlan) {
      const pricingMode = String(entry.pricingMode ?? "");
      if (pricingMode in counts) {
        counts[pricingMode as keyof typeof counts] += 1;
      }
    }

    const packageCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
    let commercialModel = "unspecified";
    if (packageCount > 0) {
      if (counts.subcontract / packageCount >= 0.6) {
        commercialModel = "subcontract_led";
      } else if ((counts.allowance + counts.historical_allowance) / packageCount >= 0.6) {
        commercialModel = "allowance_led";
      } else if (counts.detailed / packageCount >= 0.6) {
        commercialModel = "self_perform_detailed";
      } else {
        commercialModel = "mixed";
      }
    }

    return {
      packageCount,
      pricingModeCounts: counts,
      commercialModel,
    };
  }

  private validatePackagePlanAgainstWorkspace(packagePlanValue: unknown, workspace: ProjectWorkspace) {
    const issues: Array<Record<string, unknown>> = [];
    const packagePlan = Array.isArray(packagePlanValue)
      ? packagePlanValue.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry))
      : [];
    const itemPackageAssignments = new Map<string, string[]>();

    // Build a categoryName → analyticsBucket lookup so policy decisions
    // ("does this package have a labour line?" / "an allowance line?") key on
    // the org's configured bucket instead of hardcoded category names.
    const bucketByCategory = new Map<string, string | null>();
    for (const cat of workspace.entityCategories ?? []) {
      bucketByCategory.set(cat.name, cat.analyticsBucket ?? null);
    }
    const bucketOf = (item: { category?: string | null; entityType?: string | null }): string | null =>
      bucketByCategory.get(this.normalizeEstimateCategory(item.category, item.entityType)) ?? null;

    // Categories that contribute "execution" rows — anything with a non-null
    // analytics bucket counts as an execution category.
    const isExecutionCategory = (categoryName: string): boolean => {
      const bucket = bucketByCategory.get(categoryName);
      return !!bucket;
    };

    const worksheetRows = (workspace.worksheets ?? []).flatMap((worksheet) =>
      (worksheet.items ?? []).map((item) => ({ worksheet, item })),
    );

    for (const entry of packagePlan) {
      const packageId = String(entry.id ?? "");
      const packageName = String(entry.name ?? (packageId || "Unnamed package")).trim();
      const pricingMode = String(entry.pricingMode ?? "");
      const bindings = this.asEstimateObject(entry.bindings);
      const fallbackBindings = Object.keys(bindings).length > 0 ? bindings : this.asEstimateObject(entry.binding);
      const worksheetIds = this.asEstimateStringArray(fallbackBindings.worksheetIds);
      const worksheetNames = this.asEstimateStringArray(fallbackBindings.worksheetNames).map((value) => value.toLowerCase());
      const categories = this.asEstimateStringArray(fallbackBindings.categories ?? fallbackBindings.categoryTargets)
        .map((value) => this.normalizeEstimateCategory(value));
      const textMatchers = this.asEstimateStringArray(fallbackBindings.textMatchers ?? fallbackBindings.descriptionMatchers ?? fallbackBindings.itemMatchers)
        .map((value) => value.toLowerCase());
      const hasBindings = worksheetIds.length > 0 || worksheetNames.length > 0 || categories.length > 0 || textMatchers.length > 0;

      if (!hasBindings) {
        issues.push({
          code: "package_binding_missing",
          packageId,
          packageName,
          message: "Package plan entries must bind to worksheets, categories, or text matchers so commercialization can be validated.",
        });
        continue;
      }

      const matchedItems = worksheetRows
        .filter(({ worksheet, item }) => {
          const normalizedWorksheetName = String(worksheet.name ?? "").trim().toLowerCase();
          const textHaystack = `${worksheet.name ?? ""} ${item.entityName ?? ""} ${item.description ?? ""} ${item.vendor ?? ""}`.toLowerCase();
          const worksheetIdMatch = worksheetIds.length === 0 || worksheetIds.includes(worksheet.id);
          const worksheetNameMatch = worksheetNames.length === 0 || worksheetNames.some((target) =>
            normalizedWorksheetName === target || normalizedWorksheetName.includes(target) || target.includes(normalizedWorksheetName),
          );
          const categoryMatch = categories.length === 0 || categories.includes(this.normalizeEstimateCategory(item.category, item.entityType));
          const textMatch = textMatchers.length === 0 || textMatchers.some((matcher) => textHaystack.includes(matcher));
          return worksheetIdMatch && worksheetNameMatch && categoryMatch && textMatch;
        })
        .map(({ item }) => item);

      if (matchedItems.length === 0) {
        issues.push({
          code: "package_binding_unresolved",
          packageId,
          packageName,
          pricingMode,
          message: "Package bindings did not resolve to any worksheet items in the current workspace.",
        });
        continue;
      }

      for (const item of matchedItems) {
        const assignedPackages = itemPackageAssignments.get(item.id) ?? [];
        assignedPackages.push(packageId || packageName);
        itemPackageAssignments.set(item.id, assignedPackages);
      }

      const labourHours = matchedItems.reduce((sum, item) => sum + this.estimateItemExtendedHours(item), 0);
      const categoriesPresent = new Set(matchedItems.map((item) => this.normalizeEstimateCategory(item.category, item.entityType)));
      const bucketsPresent = new Set(matchedItems.map(bucketOf).filter((b): b is string => !!b));
      const hasLabourLine = bucketsPresent.has("labour");
      const hasSubcontractorLine = bucketsPresent.has("subcontractor");
      const hasAllowanceLine = bucketsPresent.has("allowance");
      const hasCommercialCarryLine = matchedItems.some((item) =>
        !hasLabourLine &&
        (bucketOf(item) === "allowance"
          || Number(item.price ?? 0) !== 0
          || Number(item.cost ?? 0) !== 0),
      );
      const hasDetailedExecutionLine = Array.from(categoriesPresent).some(isExecutionCategory) || labourHours > 0;

      if (pricingMode === "subcontract") {
        if (labourHours > 0 || hasLabourLine) {
          issues.push({
            code: "package_mode_conflict",
            packageId,
            packageName,
            pricingMode,
            labourHours: Number(labourHours.toFixed(2)),
            message: "Subcontract packages cannot carry detailed labour hours in persisted worksheet rows.",
          });
        }
        if (!hasSubcontractorLine) {
          issues.push({
            code: "package_mode_conflict",
            packageId,
            packageName,
            pricingMode,
            message: "Subcontract packages must resolve to subcontractor-priced worksheet rows.",
          });
        }
      } else if (pricingMode === "allowance" || pricingMode === "historical_allowance") {
        if (labourHours > 0 || hasLabourLine) {
          issues.push({
            code: "package_mode_conflict",
            packageId,
            packageName,
            pricingMode,
            labourHours: Number(labourHours.toFixed(2)),
            message: "Allowance packages cannot carry labour-bearing execution rows in persisted worksheet items.",
          });
        }
        if (!hasAllowanceLine && !hasSubcontractorLine && !hasCommercialCarryLine) {
          issues.push({
            code: "package_mode_conflict",
            packageId,
            packageName,
            pricingMode,
            message: "Allowance packages must resolve to zero-hour commercial carry rows, not only detailed execution rows.",
          });
        }
      } else if (pricingMode === "detailed" && !hasDetailedExecutionLine) {
        issues.push({
          code: "package_mode_conflict",
          packageId,
          packageName,
          pricingMode,
          message: "Detailed packages must resolve to persisted execution rows, not only lump-sum allowance or subcontract rows.",
        });
      }
    }

    for (const [itemId, packageIds] of itemPackageAssignments.entries()) {
      const uniquePackageIds = Array.from(new Set(packageIds));
      if (uniquePackageIds.length > 1) {
        issues.push({
          code: "package_binding_overlap",
          itemId,
          packageIds: uniquePackageIds,
          message: "A worksheet item is governed by multiple package-plan bindings. Package ownership must be exclusive.",
        });
      }
    }

    return issues;
  }

  private resolveSupervisionCoverageMode(
    productivityGuidanceValue: unknown,
    commercialGuidanceValue: unknown,
  ): "single_source" | "embedded" | "general_conditions" | "hybrid" {
    const productivityGuidance = this.asEstimateObject(productivityGuidanceValue);
    const commercialGuidance = this.asEstimateObject(commercialGuidanceValue);
    const supervisionSources = [
      this.asEstimateObject(productivityGuidance.supervision).coverageMode,
      productivityGuidance.supervisionMode,
      this.asEstimateObject(commercialGuidance.supervision).coverageMode,
      commercialGuidance.supervisionMode,
    ];

    for (const source of supervisionSources) {
      const normalized = String(source ?? "").trim().toLowerCase();
      if (normalized === "embedded" || normalized === "general_conditions" || normalized === "hybrid" || normalized === "single_source") {
        return normalized as "single_source" | "embedded" | "general_conditions" | "hybrid";
      }
    }

    return "single_source";
  }

  private validateSupervisionCoverage(
    workspace: ProjectWorkspace,
    coverageMode: "single_source" | "embedded" | "general_conditions" | "hybrid",
  ) {
    const issues: Array<Record<string, unknown>> = [];
    const supervisionPattern = /(foreman|superintendent|supervision|supervisor|general foreman|lead hand|leadman)/i;
    const overheadWorksheetPattern = /(general conditions|site overhead|overhead|site services|general condition)/i;
    const gcSupervisionItems: Array<{ worksheet: string; itemId: string }> = [];
    const embeddedSupervisionItems: Array<{ worksheet: string; itemId: string }> = [];

    for (const worksheet of workspace.worksheets ?? []) {
      for (const item of worksheet.items ?? []) {
      if (this.normalizeEstimateCategory(item.category, item.entityType) !== "Labour") continue;
        const text = `${item.entityName ?? ""} ${item.description ?? ""}`;
        if (!supervisionPattern.test(text)) continue;
        if (overheadWorksheetPattern.test(String(worksheet.name ?? ""))) {
          gcSupervisionItems.push({ worksheet: worksheet.name, itemId: item.id });
        } else {
          embeddedSupervisionItems.push({ worksheet: worksheet.name, itemId: item.id });
        }
      }
    }

    if (coverageMode === "embedded" && gcSupervisionItems.length > 0) {
      issues.push({
        code: "supervision_coverage_conflict",
        coverageMode,
        gcSupervisionItemCount: gcSupervisionItems.length,
        message: "Persona guidance says supervision should be embedded in execution packages, but General Conditions labour supervision rows were persisted.",
      });
    }

    if (coverageMode === "general_conditions" && embeddedSupervisionItems.length > 0) {
      issues.push({
        code: "supervision_coverage_conflict",
        coverageMode,
        embeddedSupervisionItemCount: embeddedSupervisionItems.length,
        message: "Persona guidance says supervision should be carried in General Conditions, but package-level supervision rows were persisted.",
      });
    }

    if (coverageMode === "single_source" && gcSupervisionItems.length > 0 && embeddedSupervisionItems.length > 0) {
      issues.push({
        code: "supervision_coverage_conflict",
        coverageMode,
        gcSupervisionItemCount: gcSupervisionItems.length,
        embeddedSupervisionItemCount: embeddedSupervisionItems.length,
        message: "Supervision exists in both General Conditions and execution worksheets. Choose one coverage model unless the persona explicitly allows hybrid supervision.",
      });
    }

    return issues;
  }

  private async buildHistoricalCalibrationEnvelope(
    projectId: string,
    packagePlanValue: unknown,
    personaTrade: string | null | undefined,
    totalHours: number,
    subtotal: number,
    estimateDefaults: {
      benchmarkLowerHoursRatio: number;
      benchmarkUpperHoursRatio: number;
    },
  ) {
    const currentCommercialProfile = this.derivePackageCommercialProfile(packagePlanValue);
    const currentTrade = String(personaTrade ?? "unknown").trim().toLowerCase() || "unknown";
    const currentSizeBucket = this.estimateSizeBucket(totalHours);
    const feedbackRows = await this.db.estimateCalibrationFeedback.findMany({
      where: {
        project: {
          organizationId: this.organizationId,
          id: { not: projectId },
        },
      },
      include: {
        strategy: {
          select: {
            personaId: true,
            packagePlan: true,
          },
        },
        revision: {
          select: {
            totalHours: true,
            subtotal: true,
          },
        },
      },
    });

    const personaIds = Array.from(new Set(
      feedbackRows
        .map((row) => row.strategy?.personaId ?? null)
        .filter((personaId): personaId is string => Boolean(personaId)),
    ));
    const personas = personaIds.length > 0
      ? await this.db.estimatorPersona.findMany({
        where: { id: { in: personaIds } },
        select: { id: true, trade: true },
      })
      : [];
    const personaTradeById = new Map(personas.map((persona) => [persona.id, persona.trade.trim().toLowerCase()]));

    const comparableRows = feedbackRows
      .map((row) => {
        const humanSnapshot = this.asEstimateObject(row.humanSnapshot);
        const humanHours = Number(humanSnapshot.totalHours ?? row.revision.totalHours ?? 0);
        const humanSubtotal = Number(humanSnapshot.subtotal ?? row.revision.subtotal ?? 0);
        if (!Number.isFinite(humanHours) || humanHours <= 0 || !Number.isFinite(humanSubtotal) || humanSubtotal <= 0) {
          return null;
        }

        const calibration = this.asEstimateObject(humanSnapshot.calibration);
        const trade = String(
          calibration.trade ??
          (row.strategy?.personaId ? personaTradeById.get(row.strategy.personaId) : undefined) ??
          "unknown",
        ).trim().toLowerCase() || "unknown";
        const commercialModel = String(
          calibration.commercialModel ??
          this.derivePackageCommercialProfile(row.strategy?.packagePlan).commercialModel,
        ).trim().toLowerCase() || "unspecified";
        const sizeBucket = String(calibration.sizeBucket ?? this.estimateSizeBucket(humanHours)).trim().toLowerCase() || "medium";

        return {
          totalHours: humanHours,
          subtotal: humanSubtotal,
          trade,
          commercialModel,
          sizeBucket,
        };
      })
      .filter((row): row is {
        totalHours: number;
        subtotal: number;
        trade: string;
        commercialModel: string;
        sizeBucket: string;
      } => row !== null);

    const sameTradeRows = currentTrade === "unknown"
      ? comparableRows
      : comparableRows.filter((row) => row.trade === currentTrade);
    const sameCommercialRows = sameTradeRows.filter((row) => row.commercialModel === currentCommercialProfile.commercialModel);
    const sameSizeRows = sameCommercialRows.filter((row) => row.sizeBucket === currentSizeBucket);

    const matchedRows =
      sameSizeRows.length >= 2 ? sameSizeRows
        : sameCommercialRows.length >= 2 ? sameCommercialRows
          : sameTradeRows.length >= 2 ? sameTradeRows
            : [];
    const matchedBy =
      matchedRows === sameSizeRows ? "trade+commercial_model+size_bucket"
        : matchedRows === sameCommercialRows ? "trade+commercial_model"
          : matchedRows === sameTradeRows ? "trade"
            : "insufficient_history";

    if (matchedRows.length < 2) {
      return {
        trade: currentTrade,
        commercialModel: currentCommercialProfile.commercialModel,
        sizeBucket: currentSizeBucket,
        matchedBy,
        candidateCount: matchedRows.length,
        outlier: false,
      };
    }

    const median = (values: number[]) => {
      const ordered = [...values].sort((left, right) => left - right);
      const mid = Math.floor(ordered.length / 2);
      return ordered.length % 2 === 0 ? (ordered[mid - 1] + ordered[mid]) / 2 : ordered[mid];
    };

    const medianHours = median(matchedRows.map((row) => row.totalHours));
    const medianSubtotal = median(matchedRows.map((row) => row.subtotal));
    const hoursRatio = medianHours > 0 ? totalHours / medianHours : null;
    const subtotalRatio = medianSubtotal > 0 ? subtotal / medianSubtotal : null;
    const outlier =
      (hoursRatio !== null &&
        (hoursRatio < estimateDefaults.benchmarkLowerHoursRatio || hoursRatio > estimateDefaults.benchmarkUpperHoursRatio)) ||
      (subtotalRatio !== null &&
        (subtotalRatio < estimateDefaults.benchmarkLowerHoursRatio || subtotalRatio > estimateDefaults.benchmarkUpperHoursRatio));

    return {
      trade: currentTrade,
      commercialModel: currentCommercialProfile.commercialModel,
      sizeBucket: currentSizeBucket,
      matchedBy,
      candidateCount: matchedRows.length,
      medianHours: Number(medianHours.toFixed(2)),
      medianSubtotal: Number(medianSubtotal.toFixed(2)),
      hoursRatio: hoursRatio !== null ? Number(hoursRatio.toFixed(4)) : null,
      subtotalRatio: subtotalRatio !== null ? Number(subtotalRatio.toFixed(4)) : null,
      outlier,
    };
  }

  private extractEstimateBaseline(strategy?: { summary?: unknown; confidenceSummary?: unknown } | null): Record<string, unknown> | null {
    if (!strategy) return null;

    const fromObject = (value: unknown): Record<string, unknown> | null => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      return value as Record<string, unknown>;
    };

    const summary = fromObject(strategy.summary);
    const confidenceSummary = fromObject(strategy.confidenceSummary);
    const summaryBaseline = fromObject(summary?.aiBaselineSnapshot);
    if (summaryBaseline) return summaryBaseline;
    const confidenceBaseline = fromObject(confidenceSummary?.aiBaselineSnapshot);
    if (confidenceBaseline) return confidenceBaseline;
    return null;
  }

  private computeEstimateDeltaSummary(
    aiSnapshot: Record<string, unknown>,
    humanSnapshot: Record<string, unknown>,
  ): Record<string, unknown> {
    const asObject = (value: unknown): Record<string, unknown> =>
      value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

    const numericMapDelta = (aiMapValue: unknown, humanMapValue: unknown) => {
      const aiMap = asObject(aiMapValue);
      const humanMap = asObject(humanMapValue);
      const keys = new Set([...Object.keys(aiMap), ...Object.keys(humanMap)]);
      return Array.from(keys)
        .map((key) => {
          const ai = Number(aiMap[key] ?? 0);
          const human = Number(humanMap[key] ?? 0);
          return {
            key,
            ai: Number(ai.toFixed(4)),
            human: Number(human.toFixed(4)),
            delta: Number((ai - human).toFixed(4)),
          };
        })
        .filter((entry) => Math.abs(entry.delta) >= 0.0001)
        .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
        .slice(0, 8);
    };

    const worksheetMetricDelta = (aiValue: unknown, humanValue: unknown, field: string) => {
      const aiMap = asObject(aiValue);
      const humanMap = asObject(humanValue);
      const keys = new Set([...Object.keys(aiMap), ...Object.keys(humanMap)]);
      return Array.from(keys)
        .map((key) => {
          const ai = Number(asObject(aiMap[key])[field] ?? 0);
          const human = Number(asObject(humanMap[key])[field] ?? 0);
          return {
            key,
            ai: Number(ai.toFixed(2)),
            human: Number(human.toFixed(2)),
            delta: Number((ai - human).toFixed(2)),
          };
        })
        .filter((entry) => Math.abs(entry.delta) >= 0.01)
        .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
        .slice(0, 8);
    };

    const aiHours = Number(aiSnapshot.totalHours ?? 0);
    const humanHours = Number(humanSnapshot.totalHours ?? 0);
    const aiSubtotal = Number(aiSnapshot.subtotal ?? 0);
    const humanSubtotal = Number(humanSnapshot.subtotal ?? 0);
    const aiLineItems = Number(aiSnapshot.lineItemCount ?? 0);
    const humanLineItems = Number(humanSnapshot.lineItemCount ?? 0);
    const aiWorksheets = Number(aiSnapshot.worksheetCount ?? 0);
    const humanWorksheets = Number(humanSnapshot.worksheetCount ?? 0);

    return {
      totalHoursDelta: Number((aiHours - humanHours).toFixed(2)),
      totalHoursDeltaPct: humanHours !== 0 ? Number((((aiHours - humanHours) / humanHours) * 100).toFixed(2)) : null,
      subtotalDelta: Number((aiSubtotal - humanSubtotal).toFixed(2)),
      subtotalDeltaPct: humanSubtotal !== 0 ? Number((((aiSubtotal - humanSubtotal) / humanSubtotal) * 100).toFixed(2)) : null,
      lineItemCountDelta: aiLineItems - humanLineItems,
      worksheetCountDelta: aiWorksheets - humanWorksheets,
      worksheetHoursDelta: worksheetMetricDelta(aiSnapshot.worksheetTotals, humanSnapshot.worksheetTotals, "extendedHours"),
      worksheetValueDelta: worksheetMetricDelta(aiSnapshot.worksheetTotals, humanSnapshot.worksheetTotals, "extendedPrice"),
      categoryHourShareDelta: numericMapDelta(aiSnapshot.categoryHourShare, humanSnapshot.categoryHourShare),
      categoryValueShareDelta: numericMapDelta(aiSnapshot.categoryValueShare, humanSnapshot.categoryValueShare),
    };
  }

  private hasMeaningfulEstimateDelta(deltaSummary: Record<string, unknown>): boolean {
    const totalHoursDelta = Math.abs(Number(deltaSummary.totalHoursDelta ?? 0));
    const subtotalDelta = Math.abs(Number(deltaSummary.subtotalDelta ?? 0));
    const lineItemCountDelta = Math.abs(Number(deltaSummary.lineItemCountDelta ?? 0));
    const worksheetCountDelta = Math.abs(Number(deltaSummary.worksheetCountDelta ?? 0));
    const worksheetHoursDelta = Array.isArray(deltaSummary.worksheetHoursDelta) ? deltaSummary.worksheetHoursDelta : [];
    const worksheetValueDelta = Array.isArray(deltaSummary.worksheetValueDelta) ? deltaSummary.worksheetValueDelta : [];
    const categoryHourShareDelta = Array.isArray(deltaSummary.categoryHourShareDelta) ? deltaSummary.categoryHourShareDelta : [];
    const categoryValueShareDelta = Array.isArray(deltaSummary.categoryValueShareDelta) ? deltaSummary.categoryValueShareDelta : [];

    return (
      totalHoursDelta >= 0.01 ||
      subtotalDelta >= 0.01 ||
      lineItemCountDelta > 0 ||
      worksheetCountDelta > 0 ||
      worksheetHoursDelta.length > 0 ||
      worksheetValueDelta.length > 0 ||
      categoryHourShareDelta.length > 0 ||
      categoryValueShareDelta.length > 0
    );
  }

  // ── Private: pick helper for snapshots ──────────────────────────────────

  private pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const k of keys) if (k in obj) result[k] = obj[k];
    return result;
  }

  private resolveActivityUserId(): string | null {
    if (this._activityActor?.type === "user") return this._activityActor.id;
    return this._userId;
  }

  private withActivityActor(data: Record<string, unknown>): Record<string, unknown> {
    if (!this._activityActor) return data;
    return {
      ...data,
      actorId: data.actorId ?? this._activityActor.id,
      actorName: data.actorName ?? this._activityActor.name,
      actorType: data.actorType ?? this._activityActor.type,
    };
  }

  // ── Private: push activity ──────────────────────────────────────────────

  private async pushActivity(projectId: string, revisionId: string | null, type: string, data: Record<string, unknown>) {
    try {
      const payload = this.withActivityActor(data);
      await this.db.activity.create({
        data: {
          id: createId("activity"),
          projectId,
          revisionId,
          type,
          data: payload as any,
          userId: this.resolveActivityUserId(),
          createdAt: new Date(),
        },
      });
    } catch (err) {
      // Activity logging is non-critical — don't fail the main operation
      console.warn(`[pushActivity] Failed to log activity (type=${type}, userId=${this._userId}):`, (err as Error).message);
    }
  }

  // ── Private: save file artifacts for package ────────────────────────────

  private async saveArtifactsForPackage(
    packageId: string,
    report: IngestionReport,
    packageChecksum: string,
    zipPath?: string,
  ): Promise<Map<string, string>> {
    const reportPath = resolveApiPath(relativePackageReportPath(packageId));
    const chunksPath = resolveApiPath(relativePackageChunksPath(packageId));
    const documentsDir = resolveApiPath(relativePackageRoot(packageId), "documents");

    await rm(documentsDir, { recursive: true, force: true });
    await mkdir(documentsDir, { recursive: true });
    await writeJsonAtomic(reportPath, report);
    await writeJsonAtomic(chunksPath, report.chunks);

    for (const document of report.documents) {
      const storagePath = relativePackageDocumentArtifact(packageId, document.id, document.title);
      const absoluteDocumentPath = resolveApiPath(storagePath);
      const payload = {
        ...document,
        packageId,
        checksum: checksumForDocument(packageChecksum, document),
        storagePath,
        createdAt: isoNow(),
        updatedAt: isoNow(),
        pageCount: inferPageCount(document, report.chunks),
      };
      await writeJsonAtomic(absoluteDocumentPath, payload);
    }

    // Save original binary files from the zip so they can be previewed/downloaded
    const binaryPathMap = new Map<string, string>();
    if (zipPath) {
      try {
        const originalsDir = resolveApiPath(relativePackageRoot(packageId), "originals");
        await mkdir(originalsDir, { recursive: true });
        const entries = await extractArchiveEntries(zipPath);
        const entryMap = new Map(entries.map((e) => [e.path, e]));

        for (const document of report.documents) {
          const entry = entryMap.get(document.sourcePath);
          if (!entry || entry.bytes.length === 0) continue;
          const safeRelativePath = normalizeStoredSourcePath(entry.path, path.basename(entry.name));
          const relPath = path.join("packages", packageId, "originals", document.id, ...safeRelativePath.split("/"));
          const absPath = resolveApiPath(relPath);
          await mkdir(path.dirname(absPath), { recursive: true });
          await writeFile(absPath, Buffer.from(entry.bytes));
          binaryPathMap.set(document.id, relPath);
        }
      } catch {
        // Non-fatal: previews won't work but ingestion continues
      }
    }

    return binaryPathMap;
  }

  // ── Private: ensure project has a quote+revision skeleton ───────────────

  private async ensureProjectSkeleton(projectId: string, projectName: string): Promise<{ quoteId: string; revisionId: string; worksheetId: string }> {
    const existingQuote = await this.db.quote.findFirst({ where: { projectId } });
    if (existingQuote) {
      const rev = await this.db.quoteRevision.findFirst({ where: { quoteId: existingQuote.id } });
      const ws = rev ? await this.db.worksheet.findFirst({ where: { revisionId: rev.id }, orderBy: { order: "asc" } }) : null;
      return { quoteId: existingQuote.id, revisionId: rev?.id ?? "", worksheetId: ws?.id ?? "" };
    }

    const quoteId = createId("quote");
    const revisionId = createId("revision");
    const worksheetId = createId("worksheet");
    const timestamp = new Date();

    await this.db.quote.create({
      data: {
        id: quoteId,
        projectId,
        quoteNumber: makeQuoteNumber(),
        title: projectName,
        status: "draft",
        currentRevisionId: revisionId,
        customerExistingNew: "New",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });

    // Fetch org settings to inherit defaultMarkup
    const orgSettings = await this.db.organizationSettings.findUnique({
      where: { organizationId: this.organizationId },
    });
    const orgDefaults = (orgSettings?.defaults as any) ?? {};
    const defaultMarkup = typeof orgDefaults.defaultMarkup === "number" ? orgDefaults.defaultMarkup / 100 : 0.2;

    await this.db.quoteRevision.create({
      data: {
        id: revisionId,
        quoteId,
        revisionNumber: 0,
        title: "Initial Estimate",
        description: "Seeded estimate shell for the uploaded customer package.",
        notes: "Populate worksheets, phases, modifiers, and conditions as the estimate matures.",
        breakoutStyle: "phase_detail",
        type: "Firm",
        status: "Open",
        defaultMarkup,
        laborDifficulty: "Normal",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });

    // No default worksheet — the agent or user creates worksheets as needed

    return { quoteId, revisionId, worksheetId };
  }

  // ── Project CRUD ───────────────────────────────────────────────────────

  async listProjects() {
    const store = await this.buildListStoreSnapshot();
    return store.projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Lightweight store snapshot that only has enough data
   * for listProjects (which just returns the projects array).
   */
  private async buildListStoreSnapshot() {
    const projects = await this.db.project.findMany({
      where: { organizationId: this.organizationId },
      orderBy: { createdAt: "desc" },
    });
    return { projects: projects.map(mapProject) };
  }

  async listProjectsWithState() {
    const projects = await this.db.project.findMany({
      where: { organizationId: this.organizationId },
      orderBy: { createdAt: "desc" },
    });

    const projectIds = projects.map((p) => p.id);
    const [packages, jobs, workspaceStates, quotes, revisions, users] = await Promise.all([
      this.db.storedPackage.findMany({ where: { projectId: { in: projectIds } } }),
      this.db.ingestionJob.findMany({ where: { projectId: { in: projectIds } } }),
      this.db.workspaceState.findMany({ where: { projectId: { in: projectIds } } }),
      this.db.quote.findMany({
        where: { projectId: { in: projectIds } },
        include: { department: true, customer: true },
      }),
      this.db.quoteRevision.findMany({
        where: { quote: { projectId: { in: projectIds } } },
      }),
      this.db.user.findMany({ where: { organizationId: this.organizationId, active: true }, select: { id: true, name: true, email: true } }),
    ]);

    return projects.map((p) => {
      const mapped = mapProject(p);
      const quote = quotes.find((q) => q.projectId === p.id);
      const revision = quote
        ? revisions.find((r) => r.id === quote.currentRevisionId) ??
          revisions.filter((r) => r.quoteId === quote.id).sort((a, b) => b.revisionNumber - a.revisionNumber)[0]
        : undefined;

      return {
        ...mapped,
        packageCount: packages.filter((pkg) => pkg.projectId === p.id).length,
        jobCount: jobs.filter((j) => j.projectId === p.id).length,
        workspaceState: workspaceStates.find((ws) => ws.projectId === p.id)
          ? mapWorkspaceState(workspaceStates.find((ws) => ws.projectId === p.id))
          : null,
        quote: quote ? {
          id: quote.id,
          quoteNumber: quote.quoteNumber,
          title: quote.title,
          status: quote.status,
          currentRevisionId: quote.currentRevisionId,
          customerId: quote.customerId || null,
          customerName: (quote as any).customer?.name || null,
          customerString: quote.customerString || "",
          userId: quote.userId || null,
          userName: quote.userId ? users.find((u) => u.id === quote.userId)?.name || null : null,
          departmentId: quote.departmentId || null,
          departmentName: (quote as any).department?.name || null,
        } : null,
        latestRevision: revision ? {
          id: revision.id,
          revisionNumber: revision.revisionNumber,
          subtotal: revision.subtotal,
          estimatedProfit: revision.estimatedProfit,
          estimatedMargin: revision.estimatedMargin,
        } : null,
      };
    });
  }

  async getProject(projectId: string) {
    const project = await this.db.project.findFirst({
      where: { id: projectId, organizationId: this.organizationId },
    });
    if (!project) return null;

    const [packageCount, jobCount, ws] = await Promise.all([
      this.db.storedPackage.count({ where: { projectId } }),
      this.db.ingestionJob.count({ where: { projectId } }),
      this.db.workspaceState.findFirst({ where: { projectId } }),
    ]);

    return {
      ...mapProject(project),
      packageCount,
      jobCount,
      workspaceState: ws ? mapWorkspaceState(ws) : null,
    };
  }

  async deleteProject(projectId: string) {
    await this.requireProject(projectId);

    // Gather file references before cascade-deleting DB records
    const [packages, knowledgeBooks, knowledgeDocuments] = await Promise.all([
      this.db.storedPackage.findMany({ where: { projectId }, select: { id: true } }),
      this.db.knowledgeBook.findMany({ where: { projectId }, select: { id: true } }),
      this.db.knowledgeDocument.findMany({ where: { projectId }, select: { id: true } }),
    ]);

    // Explicitly delete project-scoped knowledge books + chunks (no FK cascade to Project)
    if (knowledgeBooks.length > 0) {
      const bookIds = knowledgeBooks.map((b) => b.id);
      await this.db.knowledgeChunk.deleteMany({ where: { bookId: { in: bookIds } } });
      await this.db.knowledgeBook.deleteMany({ where: { id: { in: bookIds } } });
    }
    if (knowledgeDocuments.length > 0) {
      const documentIds = knowledgeDocuments.map((document) => document.id);
      await this.db.knowledgeDocumentChunk.deleteMany({ where: { documentId: { in: documentIds } } });
      await this.db.knowledgeDocumentPage.deleteMany({ where: { documentId: { in: documentIds } } });
      await this.db.knowledgeDocument.deleteMany({ where: { id: { in: documentIds } } });
    }

    // Prisma cascade deletes handle other child entities
    await this.db.project.delete({ where: { id: projectId } });

    // Clean up files on disk (best-effort, don't fail the delete if cleanup fails)
    const dirsToRemove: string[] = [
      // Project file uploads: projects/{projectId}/
      resolveApiPath("projects", projectId),
      // Workspace state: workspaces/{projectId}.json
      resolveApiPath(relativeWorkspacePath(projectId)),
    ];

    for (const pkg of packages) {
      // Check if any surviving SourceDocument still references files in this package
      const sharedRefs = await this.db.sourceDocument.count({
        where: { storagePath: { startsWith: relativePackageRoot(pkg.id) } },
      });
      if (sharedRefs === 0) {
        dirsToRemove.push(resolveApiPath(relativePackageRoot(pkg.id)));
      }
    }

    for (const book of knowledgeBooks) {
      dirsToRemove.push(resolveApiPath("knowledge", book.id));
    }

    await Promise.allSettled(
      dirsToRemove.map((dir) => rm(dir, { recursive: true, force: true })),
    );

    return { deleted: true };
  }

  async getWorkspace(projectId: string) {
    await this.requireProject(projectId);
    const store = await this.buildStoreSnapshot(projectId);
    return buildProjectWorkspace(store, projectId);
  }

  async getEstimateTotals(projectId: string) {
    const resolved = await this.resolveCurrentRevisionTotals(projectId);
    return resolved?.totals ?? null;
  }

  async getCurrentRevisionSnapshot(projectId: string) {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    return revision ? mapRevision(revision) : null;
  }

  async recalculateProjectEstimate(projectId: string) {
    await this.requireProject(projectId);
    return this.syncProjectEstimate(projectId);
  }

  async getEstimateStrategy(projectId: string, revisionId?: string): Promise<EstimateStrategy | null> {
    await this.requireProject(projectId);
    const targetRevisionId = revisionId ?? (await this.requireCurrentRevision(projectId)).revision.id;
    const row = await this.db.estimateStrategy.findFirst({
      where: { projectId, revisionId: targetRevisionId },
    });
    return row ? mapEstimateStrategy(row) : null;
  }

  async saveEstimateStrategySection(projectId: string, input: {
    section: "scopeGraph" | "executionPlan" | "assumptions" | "packagePlan" | "adjustmentPlan" | "reconcileReport" | "summary";
    data: Record<string, unknown> | Array<Record<string, unknown>>;
    aiRunId?: string | null;
    personaId?: string | null;
  }): Promise<EstimateStrategy> {
    await this.requireProject(projectId);
    const { revision } = await this.requireCurrentRevision(projectId);
    const existing = await this.db.estimateStrategy.findUnique({ where: { revisionId: revision.id } });

    const stageBySection: Record<typeof input.section, string> = {
      scopeGraph: "scope",
      executionPlan: "execution",
      assumptions: "execution",
      packagePlan: "packaging",
      adjustmentPlan: "benchmark",
      reconcileReport: "reconcile",
      summary: existing?.currentStage ?? "reconcile",
    };

    const nextStage = this.advanceStrategyStage(existing?.currentStage, stageBySection[input.section]);
    const status =
      existing?.status === "complete" || existing?.status === "ready_for_review"
        ? existing.status
        : "in_progress";
    const row = await this.db.estimateStrategy.upsert({
      where: { revisionId: revision.id },
      create: {
        projectId,
        revisionId: revision.id,
        aiRunId: input.aiRunId ?? null,
        personaId: input.personaId ?? null,
        status,
        currentStage: nextStage,
        [input.section]: input.data as any,
        reviewCompleted: false,
      },
      update: {
        aiRunId: input.aiRunId ?? existing?.aiRunId ?? null,
        personaId: input.personaId ?? existing?.personaId ?? null,
        status,
        currentStage: nextStage,
        [input.section]: input.data as any,
        reviewCompleted: existing?.reviewCompleted ?? false,
      },
    });

    await this.pushActivity(projectId, revision.id, "estimate_strategy_updated", {
      section: input.section,
      currentStage: row.currentStage,
      status: row.status,
    });

    return mapEstimateStrategy(row);
  }

  private resolveEstimateDefaults(settings?: AppSettings | null) {
    const defaults = (settings?.defaults ?? {}) as AppSettings["defaults"];
    const asNumber = (value: unknown, fallback: number) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    return {
      benchmarkingEnabled: defaults.benchmarkingEnabled !== false,
      benchmarkMinimumSimilarity: Math.min(0.99, Math.max(0, asNumber(defaults.benchmarkMinimumSimilarity, 0.55))),
      benchmarkMaximumComparables: Math.max(1, Math.min(10, Math.round(asNumber(defaults.benchmarkMaximumComparables, 5)))),
      benchmarkLowerHoursRatio: Math.max(0.1, asNumber(defaults.benchmarkLowerHoursRatio, 0.75)),
      benchmarkUpperHoursRatio: Math.max(0.1, asNumber(defaults.benchmarkUpperHoursRatio, 1.25)),
      requireHumanReviewForBenchmarkOutliers: defaults.requireHumanReviewForBenchmarkOutliers !== false,
    };
  }

  private selectAutomaticSummaryPreset(workspace: ProjectWorkspace): SummaryPreset {
    const totals = workspace.estimate?.totals;
    const nonZeroCategories = (totals?.categoryTotals ?? []).filter((entry) => entry.value !== 0 || entry.cost !== 0);
    const nonZeroPhases = (totals?.phaseTotals ?? []).filter((entry) => entry.value !== 0 || entry.cost !== 0);
    const nonZeroPhaseCategories = (totals?.phaseCategoryTotals ?? []).filter((entry) => entry.value !== 0 || entry.cost !== 0);
    const visibleAdjustments = (totals?.adjustmentTotals ?? []).filter((entry) => entry.show !== "No");

    if (nonZeroPhases.length > 1 && nonZeroCategories.length > 1 && nonZeroPhaseCategories.length > nonZeroPhases.length) {
      return "phase_x_category";
    }
    if (nonZeroPhases.length > 1) {
      return "by_phase";
    }
    if (nonZeroCategories.length > 1 || visibleAdjustments.length > 0) {
      return "by_category";
    }
    return "quick_total";
  }

  private async ensureSummaryPresentation(projectId: string, revisionId: string, workspace: ProjectWorkspace) {
    const existingRowCount = await this.db.summaryRow.count({ where: { revisionId } });
    if (existingRowCount > 0) {
      return {
        generated: false,
        preset: workspace.currentRevision.summaryLayoutPreset as SummaryPreset,
        rowCount: existingRowCount,
      };
    }

    const preset = this.selectAutomaticSummaryPreset(workspace);
    await this.applySummaryPreset(projectId, preset);
    const rowCount = await this.db.summaryRow.count({ where: { revisionId } });
    return {
      generated: true,
      preset,
      rowCount,
    };
  }

  private async resolveEstimateFinalizeAiRun(projectId: string, revisionId: string, boundAiRunId?: string | null) {
    const boundRun = boundAiRunId
      ? await this.db.aiRun.findUnique({
        where: { id: boundAiRunId },
        select: { id: true, status: true },
      })
      : null;
    const latestRevisionRun = await this.db.aiRun.findFirst({
      where: { projectId, revisionId, kind: "cli-intake" },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    const latestProjectRun = latestRevisionRun ?? await this.db.aiRun.findFirst({
      where: { projectId, kind: "cli-intake" },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });

    const effectiveRun = latestProjectRun ?? boundRun;
    return {
      boundAiRunId: boundRun?.id ?? boundAiRunId ?? null,
      effectiveAiRunId: effectiveRun?.id ?? boundAiRunId ?? null,
      aiRunStatus: effectiveRun?.status ?? boundRun?.status ?? null,
      reboundToLatestRun: Boolean(boundRun?.id && effectiveRun?.id && boundRun.id !== effectiveRun.id),
    };
  }

  async finalizeEstimateStrategy(projectId: string, summary: Record<string, unknown>): Promise<EstimateStrategy> {
    await this.requireProject(projectId);
    const { revision } = await this.requireCurrentRevision(projectId);
    const existing = await this.db.estimateStrategy.findUnique({ where: { revisionId: revision.id } });
    const workspace = await this.getWorkspace(projectId);
    if (!workspace) throw new Error(`Workspace unavailable for project ${projectId}`);
    const summaryPresentation = await this.ensureSummaryPresentation(projectId, revision.id, workspace);
    const settings = await this.getSettings();
    const estimateDefaults = this.resolveEstimateDefaults(settings);
    const aiRunContext = await this.resolveEstimateFinalizeAiRun(projectId, revision.id, existing?.aiRunId);
    const baselineSnapshot = this.buildEstimateSnapshot(workspace, existing);
    const computedSummary = this.buildEstimateComputedSummary(workspace, existing);
    const persona = existing?.personaId
      ? await this.db.estimatorPersona.findFirst({
        where: { id: existing.personaId, organizationId: this.organizationId },
        select: {
          trade: true,
          productivityGuidance: true,
          commercialGuidance: true,
        },
      })
      : null;

    const asObject = (value: unknown): Record<string, unknown> =>
      value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
    const numericClaim = (key: string) => {
      const value = summary[key];
      if (typeof value === "number") return value;
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    const validationIssues: Array<Record<string, unknown>> = [];
    if (!existing || !existing.scopeGraph || Object.keys(asObject(existing.scopeGraph)).length === 0) {
      validationIssues.push({ code: "missing_scope_graph", message: "Scope graph must be saved before finalize." });
    }
    if (!existing || !existing.executionPlan || Object.keys(asObject(existing.executionPlan)).length === 0) {
      validationIssues.push({ code: "missing_execution_plan", message: "Execution plan must be saved before finalize." });
    }
    if (!existing || !Array.isArray(existing.assumptions)) {
      validationIssues.push({ code: "missing_assumptions", message: "Assumptions must be saved before finalize." });
    }
    if (!existing || !Array.isArray(existing.packagePlan) || existing.packagePlan.length === 0) {
      validationIssues.push({ code: "missing_package_plan", message: "Package plan must be saved before finalize." });
    }
    if (!existing || !existing.reconcileReport || Object.keys(asObject(existing.reconcileReport)).length === 0) {
      validationIssues.push({ code: "missing_reconcile_report", message: "Reconcile report must be saved before finalize." });
    }

    const packageValidationIssues = this.validatePackagePlanAgainstWorkspace(existing?.packagePlan, workspace);
    validationIssues.push(...packageValidationIssues);

    const supervisionCoverageMode = this.resolveSupervisionCoverageMode(
      persona?.productivityGuidance,
      persona?.commercialGuidance,
    );
    const supervisionCoverageIssues = this.validateSupervisionCoverage(workspace, supervisionCoverageMode);
    validationIssues.push(...supervisionCoverageIssues);

    const readinessValidation = validateEstimateWorkspace(workspace as any, {
      ruleSetIds: ["readiness"],
      referenceDate: new Date(),
    });
    const readinessBlockingIssues = readinessValidation.issues.filter((issue) =>
      issue.severity === "error" || issue.severity === "critical",
    );
    validationIssues.push(...readinessBlockingIssues.map((issue) => ({
      code: issue.ruleId,
      message: issue.message,
      severity: issue.severity,
      category: issue.category,
      element: issue.element,
      suggestions: issue.suggestions,
      details: issue.details,
    })));

    const aiRunStatus = aiRunContext.aiRunStatus;

    if (estimateDefaults.benchmarkingEnabled) {
      const benchmarkProfile = asObject(existing?.benchmarkProfile);
      if (!benchmarkProfile.computedAt) {
        validationIssues.push({
          code: "missing_benchmark_pass",
          message: "Benchmark recompute must run before finalize when benchmarking is enabled.",
        });
      }
    }

    const tolerancePct = (actual: number) => Math.max(1, Math.abs(actual) * 0.02);

    const comparisons: Array<{
      claimKeys: string[];
      actualKeys: string[];
      tolerance: (actual: number) => number;
    }> = [
      { claimKeys: ["totalHours"], actualKeys: ["totalHours"], tolerance: tolerancePct },
      { claimKeys: ["subtotal", "quotedTotal", "totalPrice"], actualKeys: ["subtotal"], tolerance: tolerancePct },
      { claimKeys: ["worksheetCount"], actualKeys: ["worksheetCount"], tolerance: () => 0 },
      { claimKeys: ["lineItemCount", "itemCount"], actualKeys: ["lineItemCount"], tolerance: () => 0 },
      { claimKeys: ["zeroPriceItemCount"], actualKeys: ["zeroPriceItemCount"], tolerance: () => 0 },
      { claimKeys: ["duplicateGroupCount", "duplicateItemCount"], actualKeys: ["duplicateGroupCount", "duplicateItemCount"], tolerance: () => 0 },
    ];

    // Generate per-bucket comparisons from the actual bucketBreakdown so the
    // verifier matches an LLM claim like "labourPrice: $X" / "materialCost: $Y"
    // against the corresponding bucketBreakdown[bucket].price/cost/hours.
    const bucketBreakdown = (computedSummary.bucketBreakdown ?? {}) as Record<string, { price?: number; cost?: number; hours?: number }>;
    const bucketLookup: Record<string, number> = {};
    for (const [bucket, totals] of Object.entries(bucketBreakdown)) {
      const cap = bucket.charAt(0).toUpperCase() + bucket.slice(1);
      if (typeof totals.price === "number") bucketLookup[`${bucket}Price`] = totals.price;
      if (typeof totals.cost === "number") bucketLookup[`${bucket}Cost`] = totals.cost;
      if (typeof totals.hours === "number") bucketLookup[`${bucket}Hours`] = totals.hours;
      // Common camelCase aliases (e.g. "Labour" → "labourPrice").
      if (typeof totals.price === "number") bucketLookup[`${cap}Price`] = totals.price;
      if (typeof totals.cost === "number") bucketLookup[`${cap}Cost`] = totals.cost;
      if (typeof totals.hours === "number") bucketLookup[`${cap}Hours`] = totals.hours;
    }
    for (const bucket of Object.keys(bucketBreakdown)) {
      const cap = bucket.charAt(0).toUpperCase() + bucket.slice(1);
      comparisons.push({ claimKeys: [`${bucket}Price`, `${cap}Price`], actualKeys: [`${bucket}Price`, `${cap}Price`], tolerance: tolerancePct });
      comparisons.push({ claimKeys: [`${bucket}Cost`, `${cap}Cost`], actualKeys: [`${bucket}Cost`, `${cap}Cost`], tolerance: tolerancePct });
      comparisons.push({ claimKeys: [`${bucket}Hours`, `${cap}Hours`], actualKeys: [`${bucket}Hours`, `${cap}Hours`], tolerance: tolerancePct });
    }
    const lookupActual = (key: string): number | null => {
      if (key in bucketLookup) return bucketLookup[key];
      const direct = computedSummary[key];
      const num = Number(direct);
      return Number.isFinite(num) ? num : null;
    };

    for (const comparison of comparisons) {
      const claimKey = comparison.claimKeys.find((key) => numericClaim(key) !== null);
      if (!claimKey) continue;
      const claimed = numericClaim(claimKey);
      if (claimed === null) continue;

      const actualCandidates = comparison.actualKeys
        .map((key) => ({ key, value: lookupActual(key) }))
        .filter((entry): entry is { key: string; value: number } => entry.value !== null);
      if (actualCandidates.length === 0) continue;

      const closest = actualCandidates.reduce(
        (best, candidate) =>
          Math.abs(candidate.value - claimed) < Math.abs(best.value - claimed) ? candidate : best,
        actualCandidates[0],
      );
      const allowedDelta = comparison.tolerance(closest.value);
      if (Math.abs(closest.value - claimed) > allowedDelta) {
        validationIssues.push({
          code: "summary_mismatch",
          field: claimKey,
          actualField: closest.key,
          claimed,
          actual: Number(closest.value.toFixed(2)),
          allowedDelta: Number(allowedDelta.toFixed(2)),
        });
      }
    }

    if (validationIssues.length > 0) {
      throw Object.assign(new Error("Estimate strategy finalize validation failed."), {
        statusCode: 400,
        details: {
          validationIssues,
          readinessValidation: {
            score: readinessValidation.score,
            summary: readinessValidation.summary,
            blockingIssueCount: readinessBlockingIssues.length,
          },
          computedSummary,
        },
      });
    }

    const benchmarkProfile = asObject(existing?.benchmarkProfile);
    const benchmarkMedians = asObject(benchmarkProfile.medians);
    const benchmarkCategoryBenchmarks = asArray(benchmarkProfile.categoryBenchmarks);
    const medianHours = Number(benchmarkMedians.totalHours ?? 0);
    const totalHours = Number(computedSummary.totalHours ?? 0);
    const hoursRatio = medianHours > 0 ? totalHours / medianHours : null;
    const benchmarkOutlier =
      hoursRatio !== null &&
      (hoursRatio < estimateDefaults.benchmarkLowerHoursRatio || hoursRatio > estimateDefaults.benchmarkUpperHoursRatio);
    const categoryOutlier = benchmarkCategoryBenchmarks.some((entry) => asObject(entry).outlier === true);
    const calibrationEnvelope = await this.buildHistoricalCalibrationEnvelope(
      projectId,
      existing?.packagePlan,
      persona?.trade,
      totalHours,
      Number(computedSummary.subtotal ?? 0),
      estimateDefaults,
    );
    const requiresHumanReview =
      calibrationEnvelope.outlier === true ||
      (
        estimateDefaults.requireHumanReviewForBenchmarkOutliers &&
        estimateDefaults.benchmarkingEnabled &&
        Number(benchmarkProfile.candidateCount ?? 0) > 0 &&
        (benchmarkOutlier || categoryOutlier)
      );
    const status = requiresHumanReview ? "ready_for_review" : "complete";

    const validationSummary = {
      validatedAt: new Date().toISOString(),
      aiRunId: aiRunContext.effectiveAiRunId,
      aiRunStatus,
      aiRunRebound: aiRunContext.reboundToLatestRun,
      benchmarkingEnabled: estimateDefaults.benchmarkingEnabled,
      benchmarkHoursRatio: hoursRatio !== null ? Number(hoursRatio.toFixed(4)) : null,
      benchmarkOutlier,
      calibrationEnvelope,
      supervisionCoverageMode,
      requiresHumanReview,
      issues: [
        ...(summaryPresentation.generated
          ? [{
            code: "summary_presentation_generated",
            preset: summaryPresentation.preset,
            rowCount: summaryPresentation.rowCount,
          }]
          : []),
        ...(aiRunContext.reboundToLatestRun
          ? [{
            code: "ai_run_rebound",
            fromAiRunId: aiRunContext.boundAiRunId,
            toAiRunId: aiRunContext.effectiveAiRunId,
          }]
          : []),
        ...(readinessValidation.issues.length > 0
          ? [{
            code: "estimate_readiness_validation",
            score: readinessValidation.score.value,
            grade: readinessValidation.score.grade,
            issueCount: readinessValidation.issues.length,
            blockingIssueCount: readinessBlockingIssues.length,
            bySeverity: readinessValidation.summary.bySeverity,
            failedRuleIds: readinessValidation.summary.failedRuleIds,
            sampleIssues: readinessValidation.issues.slice(0, 20).map((issue) => ({
              ruleId: issue.ruleId,
              severity: issue.severity,
              category: issue.category,
              message: issue.message,
              element: issue.element,
            })),
          }]
          : []),
      ],
    };
    const mergedSummary = {
      ...((existing?.summary as Record<string, unknown>) ?? {}),
      ...summary,
      ...computedSummary,
      aiBaselineSnapshot: baselineSnapshot,
      summaryPresentation,
      packagePlanValidation: {
        validatedAt: validationSummary.validatedAt,
        issueCount: packageValidationIssues.length,
      },
      supervisionPolicy: {
        coverageMode: supervisionCoverageMode,
      },
      finalizationValidation: validationSummary,
    };
    const row = await this.db.estimateStrategy.upsert({
      where: { revisionId: revision.id },
      create: {
        projectId,
        revisionId: revision.id,
        aiRunId: aiRunContext.effectiveAiRunId,
        currentStage: "complete",
        status,
        reviewRequired: requiresHumanReview,
        reviewCompleted: !requiresHumanReview,
        summary: mergedSummary as any,
      },
      update: {
        aiRunId: aiRunContext.effectiveAiRunId,
        currentStage: "complete",
        status,
        reviewRequired: requiresHumanReview,
        reviewCompleted: !requiresHumanReview,
        summary: mergedSummary as any,
      },
    });

    await this.pushActivity(projectId, revision.id, "estimate_strategy_finalized", {
      currentStage: row.currentStage,
      status: row.status,
      reviewRequired: row.reviewRequired,
    });

    return mapEstimateStrategy(row);
  }

  async recomputeEstimateBenchmarks(projectId: string): Promise<EstimateStrategy> {
    await this.requireProject(projectId);
    const currentWorkspace = await this.getWorkspace(projectId);
    if (!currentWorkspace) throw new Error(`Workspace unavailable for project ${projectId}`);
    const { revision } = await this.requireCurrentRevision(projectId);
    const currentStrategy = await this.db.estimateStrategy.findUnique({ where: { revisionId: revision.id } });
    const settings = await this.getSettings();
    const estimateDefaults = this.resolveEstimateDefaults(settings);

    const currentLineItems = currentWorkspace.estimate.lineItems ?? [];
    const currentShares = this.categoryShareMetrics(currentLineItems);
    const currentFeatures = {
      projectId,
      revisionId: revision.id,
      projectName: currentWorkspace.project.name,
      totalHours: Number(currentWorkspace.currentRevision.totalHours ?? currentWorkspace.estimate.totals.totalHours ?? 0),
      subtotal: Number(currentWorkspace.currentRevision.subtotal ?? currentWorkspace.estimate.totals.subtotal ?? 0),
      worksheetCount: currentWorkspace.worksheets.length,
      lineItemCount: currentLineItems.length,
      documentCount: currentWorkspace.sourceDocuments.length,
      valueShare: currentShares.valueShare,
      hourShare: currentShares.hourShare,
    };

    if (!estimateDefaults.benchmarkingEnabled) {
      const disabledProfile = {
        basis: "organization_setting_disabled",
        disabled: true,
        candidateCount: 0,
        current: {
          totalHours: currentFeatures.totalHours,
          subtotal: currentFeatures.subtotal,
          hoursPerItem: currentFeatures.lineItemCount > 0 ? Number((currentFeatures.totalHours / currentFeatures.lineItemCount).toFixed(2)) : 0,
          hoursPerWorksheet: currentFeatures.worksheetCount > 0 ? Number((currentFeatures.totalHours / currentFeatures.worksheetCount).toFixed(2)) : 0,
          pricePerHour: currentFeatures.totalHours > 0 ? Number((currentFeatures.subtotal / currentFeatures.totalHours).toFixed(2)) : 0,
        },
        medians: {},
        categoryBenchmarks: [],
        suggestedActions: [],
        computedAt: new Date().toISOString(),
      };

      const disabledRow = await this.db.estimateStrategy.upsert({
        where: { revisionId: revision.id },
        create: {
          projectId,
          revisionId: revision.id,
          aiRunId: currentStrategy?.aiRunId ?? null,
          personaId: currentStrategy?.personaId ?? null,
          currentStage: this.advanceStrategyStage(currentStrategy?.currentStage, "benchmark"),
          status: currentStrategy?.status === "complete" || currentStrategy?.status === "ready_for_review" ? currentStrategy.status : "in_progress",
          benchmarkProfile: disabledProfile as any,
          benchmarkComparables: [] as any,
        },
        update: {
          currentStage: this.advanceStrategyStage(currentStrategy?.currentStage, "benchmark"),
          status: currentStrategy?.status === "complete" || currentStrategy?.status === "ready_for_review" ? currentStrategy.status : "in_progress",
          benchmarkProfile: disabledProfile as any,
          benchmarkComparables: [] as any,
        },
      });

      await this.pushActivity(projectId, revision.id, "estimate_benchmarks_recomputed", {
        disabled: true,
        candidateCount: 0,
        suggestedActions: 0,
      });

      return mapEstimateStrategy(disabledRow);
    }

    const quotes = await this.db.quote.findMany({
      where: {
        project: {
          organizationId: this.organizationId,
          id: { not: projectId },
        },
      },
      include: { project: true },
    });

    const candidateRevisionIds = quotes.map((quote) => quote.currentRevisionId).filter(Boolean);
    const candidateProjectIds = quotes.map((quote) => quote.projectId);
    const [candidateRevisions, candidateWorksheets, candidateDocuments] = await Promise.all([
      candidateRevisionIds.length > 0
        ? this.db.quoteRevision.findMany({ where: { id: { in: candidateRevisionIds } } })
        : Promise.resolve([] as any[]),
      candidateRevisionIds.length > 0
        ? this.db.worksheet.findMany({ where: { revisionId: { in: candidateRevisionIds } } })
        : Promise.resolve([] as any[]),
      candidateProjectIds.length > 0
        ? this.db.sourceDocument.findMany({ where: { projectId: { in: candidateProjectIds } }, select: { projectId: true } })
        : Promise.resolve([] as Array<{ projectId: string }>),
    ]);
    const candidateWorksheetIds = candidateWorksheets.map((worksheet) => worksheet.id);
    const candidateItems = candidateWorksheetIds.length > 0
      ? await this.db.worksheetItem.findMany({ where: { worksheetId: { in: candidateWorksheetIds } } })
      : [];

    const revisionById = new Map(candidateRevisions.map((candidate) => [candidate.id, candidate]));
    const worksheetsByRevision = new Map<string, any[]>();
    for (const worksheet of candidateWorksheets) {
      const list = worksheetsByRevision.get(worksheet.revisionId) ?? [];
      list.push(worksheet);
      worksheetsByRevision.set(worksheet.revisionId, list);
    }
    const itemsByWorksheet = new Map<string, any[]>();
    for (const item of candidateItems) {
      const list = itemsByWorksheet.get(item.worksheetId) ?? [];
      list.push(item);
      itemsByWorksheet.set(item.worksheetId, list);
    }
    const documentCountByProject = new Map<string, number>();
    for (const document of candidateDocuments) {
      documentCountByProject.set(document.projectId, (documentCountByProject.get(document.projectId) ?? 0) + 1);
    }

    const relativeScore = (left: number, right: number) => {
      const baseline = Math.max(Math.abs(left), Math.abs(right), 1);
      return 1 - Math.min(1, Math.abs(left - right) / baseline);
    };

    const shareSimilarity = (left: Record<string, number>, right: Record<string, number>) => {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      if (keys.size === 0) return 0.5;
      let distance = 0;
      for (const key of keys) {
        distance += Math.abs((left[key] ?? 0) - (right[key] ?? 0));
      }
      return 1 - Math.min(1, distance / 2);
    };

    const comparableRows = quotes.flatMap((quote) => {
      const candidateRevision = revisionById.get(quote.currentRevisionId);
      if (!candidateRevision) return [];
      const worksheets = worksheetsByRevision.get(candidateRevision.id) ?? [];
      const items = worksheets.flatMap((worksheet) => itemsByWorksheet.get(worksheet.id) ?? []);
      if (items.length === 0 && Number(candidateRevision.totalHours ?? 0) === 0) return [];
      const shares = this.categoryShareMetrics(items);
      const totalHours = Number(candidateRevision.totalHours ?? 0);
      const similarity =
        0.25 * relativeScore(currentFeatures.totalHours, totalHours) +
        0.15 * relativeScore(currentFeatures.subtotal, Number(candidateRevision.subtotal ?? 0)) +
        0.15 * relativeScore(currentFeatures.lineItemCount, items.length) +
        0.15 * relativeScore(currentFeatures.worksheetCount, worksheets.length) +
        0.1 * relativeScore(currentFeatures.documentCount, documentCountByProject.get(quote.projectId) ?? 0) +
        0.1 * shareSimilarity(currentFeatures.valueShare, shares.valueShare) +
        0.1 * shareSimilarity(currentFeatures.hourShare, shares.hourShare);

      return [{
        projectId: quote.projectId,
        projectName: quote.project.name,
        revisionId: candidateRevision.id,
        totalHours,
        subtotal: Number(candidateRevision.subtotal ?? 0),
        worksheetCount: worksheets.length,
        lineItemCount: items.length,
        documentCount: documentCountByProject.get(quote.projectId) ?? 0,
        valueShare: shares.valueShare,
        hourShare: shares.hourShare,
        similarityScore: Number(similarity.toFixed(4)),
        pricePerHour: totalHours > 0 ? Number((Number(candidateRevision.subtotal ?? 0) / totalHours).toFixed(2)) : 0,
        hoursPerItem: items.length > 0 ? Number((totalHours / items.length).toFixed(2)) : 0,
        hoursPerWorksheet: worksheets.length > 0 ? Number((totalHours / worksheets.length).toFixed(2)) : 0,
        updatedAt: candidateRevision.updatedAt.toISOString(),
      }];
    })
      .filter((row) => row.similarityScore >= estimateDefaults.benchmarkMinimumSimilarity)
      .sort((left, right) => right.similarityScore - left.similarityScore)
      .slice(0, estimateDefaults.benchmarkMaximumComparables);

    const median = (values: number[]) => {
      if (values.length === 0) return 0;
      const ordered = [...values].sort((a, b) => a - b);
      const mid = Math.floor(ordered.length / 2);
      return ordered.length % 2 === 0 ? (ordered[mid - 1] + ordered[mid]) / 2 : ordered[mid];
    };

    const medianHours = median(comparableRows.map((row) => row.totalHours));
    const medianHoursPerItem = median(comparableRows.map((row) => row.hoursPerItem));
    const medianHoursPerWorksheet = median(comparableRows.map((row) => row.hoursPerWorksheet));
    const medianPricePerHour = median(comparableRows.map((row) => row.pricePerHour));

    const categoryKeys = new Set<string>(Object.keys(currentFeatures.valueShare));
    for (const candidate of comparableRows) {
      Object.keys(candidate.valueShare).forEach((key) => categoryKeys.add(key));
    }

    const categoryBenchmarks = Array.from(categoryKeys)
      .map((category) => {
        const candidateValueShares = comparableRows.map((row) => row.valueShare[category] ?? 0);
        const candidateHourShares = comparableRows.map((row) => row.hourShare[category] ?? 0);
        const medianValueShare = median(candidateValueShares);
        const medianHourShare = median(candidateHourShares);
        const currentValueShare = currentFeatures.valueShare[category] ?? 0;
        const currentHourShare = currentFeatures.hourShare[category] ?? 0;
        const valueDeviation = currentValueShare - medianValueShare;
        const hourDeviation = currentHourShare - medianHourShare;
        const outlier = Math.abs(valueDeviation) >= 0.12 || Math.abs(hourDeviation) >= 0.12;
        const recommendation = outlier
          ? (valueDeviation > 0 || hourDeviation > 0 ? "heavy_vs_history" : "light_vs_history")
          : "within_range";
        return {
          category,
          currentValueShare: Number(currentValueShare.toFixed(4)),
          medianValueShare: Number(medianValueShare.toFixed(4)),
          currentHourShare: Number(currentHourShare.toFixed(4)),
          medianHourShare: Number(medianHourShare.toFixed(4)),
          valueDeviation: Number(valueDeviation.toFixed(4)),
          hourDeviation: Number(hourDeviation.toFixed(4)),
          outlier,
          recommendation,
        };
      })
      .sort((left, right) => Math.abs(right.valueDeviation) - Math.abs(left.valueDeviation));

    const suggestedActions: Array<Record<string, unknown>> = [];
    if (comparableRows.length > 0 && medianHours > 0) {
      const ratio = currentFeatures.totalHours / medianHours;
      if (ratio > estimateDefaults.benchmarkUpperHoursRatio) {
        suggestedActions.push({
          area: "overall_hours",
          action: "scrutinize_and_reduce",
          rationale: `Current total hours are ${ratio.toFixed(2)}x the median of comparable jobs.`,
          benchmarkValue: medianHours,
          currentValue: currentFeatures.totalHours,
        });
      } else if (ratio < estimateDefaults.benchmarkLowerHoursRatio) {
        suggestedActions.push({
          area: "overall_hours",
          action: "check_for_omissions",
          rationale: `Current total hours are ${ratio.toFixed(2)}x the median of comparable jobs.`,
          benchmarkValue: medianHours,
          currentValue: currentFeatures.totalHours,
        });
      }
    }

    for (const row of categoryBenchmarks.filter((entry) => entry.outlier).slice(0, 6)) {
      suggestedActions.push({
        area: row.category,
        action: row.recommendation === "heavy_vs_history" ? "reduce_or_regroup" : "validate_scope_or_raise",
        rationale: `Category share diverges from comparable jobs by value ${row.valueDeviation} and hours ${row.hourDeviation}.`,
        benchmarkValue: {
          medianValueShare: row.medianValueShare,
          medianHourShare: row.medianHourShare,
        },
        currentValue: {
          valueShare: row.currentValueShare,
          hourShare: row.currentHourShare,
        },
      });
    }

    const benchmarkProfile = {
      basis: "organization_historical_quotes",
      candidateCount: comparableRows.length,
      current: {
        totalHours: currentFeatures.totalHours,
        subtotal: currentFeatures.subtotal,
        hoursPerItem: currentFeatures.lineItemCount > 0 ? Number((currentFeatures.totalHours / currentFeatures.lineItemCount).toFixed(2)) : 0,
        hoursPerWorksheet: currentFeatures.worksheetCount > 0 ? Number((currentFeatures.totalHours / currentFeatures.worksheetCount).toFixed(2)) : 0,
        pricePerHour: currentFeatures.totalHours > 0 ? Number((currentFeatures.subtotal / currentFeatures.totalHours).toFixed(2)) : 0,
      },
      medians: {
        totalHours: Number(medianHours.toFixed(2)),
        hoursPerItem: Number(medianHoursPerItem.toFixed(2)),
        hoursPerWorksheet: Number(medianHoursPerWorksheet.toFixed(2)),
        pricePerHour: Number(medianPricePerHour.toFixed(2)),
      },
      categoryBenchmarks,
      suggestedActions,
      computedAt: new Date().toISOString(),
    };

    const row = await this.db.estimateStrategy.upsert({
      where: { revisionId: revision.id },
      create: {
        projectId,
        revisionId: revision.id,
        aiRunId: currentStrategy?.aiRunId ?? null,
        personaId: currentStrategy?.personaId ?? null,
        currentStage: this.advanceStrategyStage(currentStrategy?.currentStage, "benchmark"),
        status: currentStrategy?.status === "complete" || currentStrategy?.status === "ready_for_review" ? currentStrategy.status : "in_progress",
        benchmarkProfile: benchmarkProfile as any,
        benchmarkComparables: comparableRows as any,
      },
      update: {
        currentStage: this.advanceStrategyStage(currentStrategy?.currentStage, "benchmark"),
        status: currentStrategy?.status === "complete" || currentStrategy?.status === "ready_for_review" ? currentStrategy.status : "in_progress",
        benchmarkProfile: benchmarkProfile as any,
        benchmarkComparables: comparableRows as any,
      },
    });

    await this.pushActivity(projectId, revision.id, "estimate_benchmarks_recomputed", {
      candidateCount: comparableRows.length,
      suggestedActions: suggestedActions.length,
    });

    return mapEstimateStrategy(row);
  }

  async markEstimateReviewCompleted(projectId: string, revisionId: string, reviewId?: string | null): Promise<EstimateStrategy | null> {
    await this.requireProject(projectId);
    const existing = await this.db.estimateStrategy.findUnique({ where: { revisionId } });
    if (!existing) return null;

    const updated = await this.db.estimateStrategy.update({
      where: { revisionId },
      data: {
        currentStage: this.advanceStrategyStage(existing.currentStage, "complete"),
        status: "complete",
        reviewCompleted: true,
        summary: {
          ...(existing.summary as Record<string, unknown>),
          reviewId: reviewId ?? null,
          externalReviewCompletedAt: new Date().toISOString(),
        } as any,
      },
    });

    await this.pushActivity(projectId, revisionId, "estimate_review_completed", {
      reviewId: reviewId ?? null,
    });

    return mapEstimateStrategy(updated);
  }

  async listEstimateFeedback(projectId: string, revisionId?: string): Promise<EstimateCalibrationFeedback[]> {
    await this.requireProject(projectId);
    const where: Prisma.EstimateCalibrationFeedbackWhereInput = { projectId };
    if (revisionId) where.revisionId = revisionId;
    const rows = await this.db.estimateCalibrationFeedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(mapEstimateCalibrationFeedback);
  }

  async createEstimateFeedback(projectId: string, input: {
    source?: string;
    feedbackType?: string;
    sourceLabel?: string;
    humanSnapshot: Record<string, unknown>;
    corrections?: Array<Record<string, unknown>>;
    lessons?: Array<Record<string, unknown>>;
    notes?: string;
    quoteReviewId?: string | null;
  }): Promise<EstimateCalibrationFeedback> {
    await this.requireProject(projectId);
    const workspace = await this.getWorkspace(projectId);
    if (!workspace) throw new Error(`Workspace unavailable for project ${projectId}`);
    const { revision } = await this.requireCurrentRevision(projectId);
    const strategy = await this.db.estimateStrategy.findUnique({ where: { revisionId: revision.id } });
    const currentSnapshot = this.buildEstimateSnapshot(workspace, strategy);
    const aiSnapshot = this.extractEstimateBaseline(strategy) ?? currentSnapshot;
    const deltaSummary = this.computeEstimateDeltaSummary(aiSnapshot, input.humanSnapshot);

    const row = await this.db.estimateCalibrationFeedback.create({
      data: {
        projectId,
        revisionId: revision.id,
        strategyId: strategy?.id ?? null,
        quoteReviewId: input.quoteReviewId ?? null,
        source: input.source ?? "manual",
        feedbackType: input.feedbackType ?? "comparison",
        sourceLabel: input.sourceLabel ?? "",
        aiSnapshot: aiSnapshot as any,
        humanSnapshot: input.humanSnapshot as any,
        deltaSummary: deltaSummary as any,
        corrections: (input.corrections ?? []) as any,
        lessons: (input.lessons ?? []) as any,
        notes: input.notes ?? "",
      },
    });

    await this.pushActivity(projectId, revision.id, "estimate_feedback_captured", {
      feedbackId: row.id,
      feedbackType: row.feedbackType,
      source: row.source,
    });

    return mapEstimateCalibrationFeedback(row);
  }

  async captureAutomaticEstimateFeedback(projectId: string, input: {
    source?: string;
    feedbackType?: string;
    sourceLabel?: string;
    correction?: Record<string, unknown>;
    notes?: string;
    quoteReviewId?: string | null;
    createNew?: boolean;
  }): Promise<EstimateCalibrationFeedback | null> {
    await this.requireProject(projectId);
    const { revision } = await this.requireCurrentRevision(projectId);
    const strategy = await this.db.estimateStrategy.findUnique({ where: { revisionId: revision.id } });
    const aiSnapshot = this.extractEstimateBaseline(strategy);
    if (!strategy || !aiSnapshot) return null;

    const workspace = await this.getWorkspace(projectId);
    if (!workspace) return null;
    const humanSnapshot = this.buildEstimateSnapshot(workspace, strategy);
    const deltaSummary = this.computeEstimateDeltaSummary(aiSnapshot, humanSnapshot);
    if (!this.hasMeaningfulEstimateDelta(deltaSummary)) return null;

    const source = input.source ?? "background";
    const feedbackType = input.feedbackType ?? "human_edit_stream";
    const sourceLabel = input.sourceLabel ?? "Human corrections";
    const nextCorrections = input.correction ? [input.correction] : [];

    let row;
    if (!input.createNew) {
      const existing = await this.db.estimateCalibrationFeedback.findFirst({
        where: {
          projectId,
          revisionId: revision.id,
          source,
          feedbackType,
          sourceLabel,
          quoteReviewId: input.quoteReviewId ?? null,
        },
        orderBy: { createdAt: "desc" },
      });

      if (existing) {
        row = await this.db.estimateCalibrationFeedback.update({
          where: { id: existing.id },
          data: {
            strategyId: strategy.id,
            quoteReviewId: input.quoteReviewId ?? existing.quoteReviewId ?? null,
            aiSnapshot: aiSnapshot as any,
            humanSnapshot: humanSnapshot as any,
            deltaSummary: deltaSummary as any,
            corrections: ([...((existing.corrections as Array<Record<string, unknown>>) ?? []), ...nextCorrections]) as any,
            notes: input.notes ?? existing.notes,
          },
        });
      }
    }

    if (!row) {
      row = await this.db.estimateCalibrationFeedback.create({
        data: {
          projectId,
          revisionId: revision.id,
          strategyId: strategy.id,
          quoteReviewId: input.quoteReviewId ?? null,
          source,
          feedbackType,
          sourceLabel,
          aiSnapshot: aiSnapshot as any,
          humanSnapshot: humanSnapshot as any,
          deltaSummary: deltaSummary as any,
          corrections: nextCorrections as any,
          lessons: [],
          notes: input.notes ?? "",
        },
      });
    }

    await this.pushActivity(projectId, revision.id, "estimate_feedback_captured", {
      feedbackId: row.id,
      feedbackType: row.feedbackType,
      source: row.source,
      automatic: true,
    });

    return mapEstimateCalibrationFeedback(row);
  }

  // ── Packages ────────────────────────────────────────────────────────────

  async listPackages(projectId?: string) {
    const where: any = {};
    if (projectId) {
      await this.requireProject(projectId);
      where.projectId = projectId;
    } else {
      where.project = { organizationId: this.organizationId };
    }
    const packages = await this.db.storedPackage.findMany({ where });
    return packages.map(mapStoredPackage);
  }

  async getPackage(packageId: string) {
    const pkg = await this.db.storedPackage.findFirst({
      where: { id: packageId, project: { organizationId: this.organizationId } },
    });
    return pkg ? mapStoredPackage(pkg) : null;
  }

  // ── Ingestion Jobs ─────────────────────────────────────────────────────

  async listJobs(projectId?: string) {
    const where: any = {};
    if (projectId) {
      await this.requireProject(projectId);
      where.projectId = projectId;
    } else {
      where.project = { organizationId: this.organizationId };
    }
    const jobs = await this.db.ingestionJob.findMany({ where });
    return jobs.map(mapIngestionJob);
  }

  async getJob(jobId: string) {
    const job = await this.db.ingestionJob.findFirst({
      where: { id: jobId, project: { organizationId: this.organizationId } },
    });
    return job ? mapIngestionJob(job) : null;
  }

  // ── Documents ──────────────────────────────────────────────────────────

  async listDocuments(projectId: string) {
    await this.requireProject(projectId);
    const docs = await this.db.sourceDocument.findMany({ where: { projectId } });
    return docs.map(mapSourceDocument);
  }

  async getDocument(projectId: string, documentId: string) {
    await this.requireProject(projectId);
    const doc = await this.db.sourceDocument.findFirst({ where: { id: documentId, projectId } });
    return doc ? mapSourceDocument(doc) : null;
  }

  async createSourceDocument(projectId: string, input: {
    fileName: string;
    fileType?: string;
    documentType?: string;
    pageCount?: number;
    checksum?: string;
    storagePath?: string;
    extractedText?: string;
    structuredData?: Record<string, unknown> | null;
  }) {
    await this.requireProject(projectId);
    const document = await this.db.sourceDocument.create({
      data: {
        id: createId("doc"),
        projectId,
        fileName: input.fileName,
        fileType: input.fileType ?? "",
        documentType: input.documentType ?? "reference",
        pageCount: input.pageCount ?? 0,
        checksum: input.checksum ?? "",
        storagePath: input.storagePath ?? "",
        extractedText: input.extractedText ?? "",
        structuredData: input.structuredData as Prisma.InputJsonValue | undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return mapSourceDocument(document);
  }

  async updateDocument(projectId: string, documentId: string, patch: SourceDocumentPatchInput) {
    await this.requireProject(projectId);
    const document = await this.db.sourceDocument.findFirst({ where: { id: documentId, projectId } });
    if (!document) throw new Error(`Document ${documentId} not found`);

    const data: Prisma.SourceDocumentUpdateInput = {};
    if (patch.fileName !== undefined) {
      data.fileName = patch.fileName;
      const ext = path.extname(patch.fileName).replace(/^\./, "").toLowerCase();
      if (ext) data.fileType = ext;
    }
    if (patch.documentType !== undefined) data.documentType = patch.documentType;

    const updated = await this.db.sourceDocument.update({ where: { id: documentId }, data });
    return mapSourceDocument(updated);
  }

  async deleteDocument(projectId: string, documentId: string) {
    await this.requireProject(projectId);
    const document = await this.db.sourceDocument.findFirst({ where: { id: documentId, projectId } });
    if (!document) throw new Error(`Document ${documentId} not found`);

    await this.db.sourceDocument.delete({ where: { id: documentId } });

    if (document.storagePath) {
      const sharedRefs = await this.db.sourceDocument.count({
        where: { storagePath: document.storagePath },
      });
      if (sharedRefs === 0) {
        await rm(resolveApiPath(document.storagePath), { force: true }).catch(() => undefined);
      }
    }

    return { deleted: true };
  }

  // ── AI Runs ────────────────────────────────────────────────────────────

  async listAiRuns(projectId?: string) {
    const where: any = {};
    if (projectId) {
      await this.requireProject(projectId);
      where.projectId = projectId;
    } else {
      where.project = { organizationId: this.organizationId };
    }
    const runs = await this.db.aiRun.findMany({ where });
    return runs.map(mapAiRun);
  }

  async createAiRun(input: { id: string; projectId: string; revisionId?: string; kind: string; status: string; model: string; input: any; output: any }) {
    await this.requireProject(input.projectId);
    if (input.revisionId) {
      await this.requireRevisionForProject(input.projectId, input.revisionId);
    }
    return this.db.aiRun.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        revisionId: input.revisionId ?? "",
        kind: input.kind,
        status: input.status,
        model: input.model,
        input: input.input ?? {},
        output: input.output ?? {},
      },
    });
  }

  async updateAiRun(id: string, patch: { status?: string; output?: any }) {
    const run = await this.db.aiRun.findFirst({
      where: { id, project: { organizationId: this.organizationId } },
      select: { id: true },
    });
    if (!run) throw new Error(`AI run ${id} not found`);
    return this.db.aiRun.update({
      where: { id },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.output ? { output: patch.output } : {}),
      },
    });
  }

  async getAiRun(id: string) {
    const run = await this.db.aiRun.findFirst({
      where: { id, project: { organizationId: this.organizationId } },
    });
    return run ? mapAiRun(run) : null;
  }

  async getLatestAiRun(projectId: string, kind?: string) {
    await this.requireProject(projectId);
    const where: any = { projectId };
    if (kind) where.kind = kind;
    const run = await this.db.aiRun.findFirst({ where, orderBy: { createdAt: "desc" } });
    return run ? mapAiRun(run) : null;
  }

  // ── Entity Categories ──────────────────────────────────────────────────

  async listEntityCategories() {
    const categories = await this.db.entityCategory.findMany({
      where: { organizationId: this.organizationId },
      orderBy: { order: "asc" },
    });
    return categories.map(mapEntityCategory);
  }

  async getEntityCategory(id: string): Promise<EntityCategory | null> {
    const cat = await this.db.entityCategory.findFirst({
      where: { id, organizationId: this.organizationId },
    });
    return cat ? mapEntityCategory(cat) : null;
  }

  async getEntityCategoryByName(name: string): Promise<EntityCategory | null> {
    const cat = await this.db.entityCategory.findFirst({
      where: { organizationId: this.organizationId, name },
    });
    return cat ? mapEntityCategory(cat) : null;
  }

  async createEntityCategory(input: {
    name: string;
    entityType: string;
    shortform?: string;
    defaultUom?: string;
    validUoms?: string[];
    editableFields?: Record<string, boolean>;
    unitLabels?: Record<string, string>;
    calculationType?: string;
    calcFormula?: string;
    itemSource?: string;
    catalogId?: string | null;
    analyticsBucket?: string | null;
    color?: string;
  }): Promise<EntityCategory> {
    if (input.catalogId) {
      await this.requireCatalog(input.catalogId);
    }
    const maxOrder = await this.db.entityCategory.aggregate({
      where: { organizationId: this.organizationId },
      _max: { order: true },
    });
    const cat = await this.db.entityCategory.create({
      data: {
        id: createId("ecat"),
        organizationId: this.organizationId,
        name: input.name,
        entityType: input.entityType,
        shortform: input.shortform ?? input.name.charAt(0).toUpperCase(),
        defaultUom: input.defaultUom ?? "EA",
        validUoms: input.validUoms ?? ["EA"],
        editableFields: (input.editableFields ?? { quantity: true, cost: true, markup: true, price: true, tierUnits: false }) as any,
        unitLabels: (input.unitLabels ?? {}) as any,
        calculationType: normalizeCalculationType(input.calculationType),
        calcFormula: input.calcFormula ?? "",
        itemSource: input.itemSource ?? "freeform",
        catalogId: input.catalogId ?? null,
        analyticsBucket: input.analyticsBucket ?? null,
        color: input.color ?? "#6b7280",
        order: (maxOrder._max.order ?? 0) + 1,
        isBuiltIn: false,
        enabled: true,
      },
    });
    return mapEntityCategory(cat);
  }

  async updateEntityCategory(id: string, patch: Record<string, unknown>): Promise<EntityCategory> {
    const existing = await this.db.entityCategory.findFirst({
      where: { id, organizationId: this.organizationId },
    });
    if (!existing) throw new Error(`Entity category ${id} not found`);

    const data: any = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.entityType !== undefined) data.entityType = patch.entityType;
    if (patch.shortform !== undefined) data.shortform = patch.shortform;
    if (patch.defaultUom !== undefined) data.defaultUom = patch.defaultUom;
    if (patch.validUoms !== undefined) data.validUoms = patch.validUoms;
    if (patch.editableFields !== undefined) data.editableFields = patch.editableFields as any;
    if (patch.unitLabels !== undefined) data.unitLabels = patch.unitLabels as any;
    if (patch.calculationType !== undefined) data.calculationType = normalizeCalculationType(patch.calculationType);
    if (patch.calcFormula !== undefined) data.calcFormula = patch.calcFormula;
    if (patch.itemSource !== undefined) data.itemSource = patch.itemSource;
    if (patch.catalogId !== undefined) {
      if (typeof patch.catalogId === "string" && patch.catalogId) {
        await this.requireCatalog(patch.catalogId);
      }
      data.catalogId = patch.catalogId;
    }
    if (patch.analyticsBucket !== undefined) data.analyticsBucket = patch.analyticsBucket;
    if (patch.color !== undefined) data.color = patch.color;
    if (patch.order !== undefined) data.order = patch.order;
    if (patch.enabled !== undefined) data.enabled = patch.enabled;

    const updated = await this.db.entityCategory.update({ where: { id }, data });
    if (patch.name !== undefined || patch.entityType !== undefined) {
      await this.db.worksheetItem.updateMany({
        where: { categoryId: id },
        data: {
          category: updated.name,
          entityType: updated.entityType,
        },
      });
    }
    return mapEntityCategory(updated);
  }

	  async deleteEntityCategory(id: string): Promise<{ deleted: boolean }> {
	    const existing = await this.db.entityCategory.findFirst({
	      where: { id, organizationId: this.organizationId },
	    });
	    if (!existing) throw new Error(`Entity category ${id} not found`);
    const usageCount = await this.db.worksheetItem.count({ where: { categoryId: id } });
    if (usageCount > 0) {
      throw new Error(`Entity category "${existing.name}" is used by ${usageCount} worksheet item(s) and cannot be deleted. Disable or rename it instead.`);
    }

	    await this.db.entityCategory.delete({ where: { id } });
	    return { deleted: true };
	  }

  async reorderEntityCategories(orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await this.db.entityCategory.updateMany({
        where: { id: orderedIds[i], organizationId: this.organizationId },
        data: { order: i },
      });
    }
  }

  // ── Customers ──────────────────────────────────────────────────────────

  async listCustomers(): Promise<Customer[]> {
    const customers = await this.db.customer.findMany({
      where: { organizationId: this.organizationId },
      orderBy: { name: "asc" },
    });
    return customers.map(mapCustomer);
  }

  async searchCustomers(query: string): Promise<Customer[]> {
    const customers = await this.db.customer.findMany({
      where: {
        organizationId: this.organizationId,
        name: { contains: query, mode: "insensitive" },
      },
      orderBy: { name: "asc" },
      take: 25,
    });
    return customers.map(mapCustomer);
  }

  async getCustomer(id: string): Promise<Customer | null> {
    const c = await this.db.customer.findFirst({
      where: { id, organizationId: this.organizationId },
    });
    return c ? mapCustomer(c) : null;
  }

  async getCustomerWithContacts(id: string): Promise<CustomerWithContacts | null> {
    const c = await this.db.customer.findFirst({
      where: { id, organizationId: this.organizationId },
      include: { contacts: { orderBy: { name: "asc" } } },
    });
    if (!c) return null;
    return {
      ...mapCustomer(c),
      contacts: c.contacts.map(mapCustomerContact),
    };
  }

  async createCustomer(input: {
    name: string;
    shortName?: string;
    phone?: string;
    email?: string;
    website?: string;
    addressStreet?: string;
    addressCity?: string;
    addressProvince?: string;
    addressPostalCode?: string;
    addressCountry?: string;
    notes?: string;
  }): Promise<Customer> {
    const c = await this.db.customer.create({
      data: {
        id: createId("cust"),
        organizationId: this.organizationId,
        name: input.name,
        shortName: input.shortName ?? "",
        phone: input.phone ?? "",
        email: input.email ?? "",
        website: input.website ?? "",
        addressStreet: input.addressStreet ?? "",
        addressCity: input.addressCity ?? "",
        addressProvince: input.addressProvince ?? "",
        addressPostalCode: input.addressPostalCode ?? "",
        addressCountry: input.addressCountry ?? "",
        notes: input.notes ?? "",
      },
    });
    return mapCustomer(c);
  }

  async updateCustomer(id: string, patch: Record<string, unknown>): Promise<Customer> {
    const existing = await this.db.customer.findFirst({
      where: { id, organizationId: this.organizationId },
    });
    if (!existing) throw new Error(`Customer ${id} not found`);

    const data: any = {};
    const fields = ["name", "shortName", "phone", "email", "website", "addressStreet", "addressCity", "addressProvince", "addressPostalCode", "addressCountry", "notes", "active"];
    for (const f of fields) {
      if (patch[f] !== undefined) data[f] = patch[f];
    }

    const updated = await this.db.customer.update({ where: { id }, data });
    return mapCustomer(updated);
  }

  async deleteCustomer(id: string): Promise<{ deleted: boolean }> {
    const existing = await this.db.customer.findFirst({
      where: { id, organizationId: this.organizationId },
    });
    if (!existing) throw new Error(`Customer ${id} not found`);
    // Null out FK references on quotes before deleting
    await this.db.quote.updateMany({ where: { customerId: id }, data: { customerId: null } });
    await this.db.customer.delete({ where: { id } });
    return { deleted: true };
  }

  // ── Customer Contacts ─────────────────────────────────────────────────

  async listCustomerContacts(customerId: string): Promise<CustomerContact[]> {
    const customer = await this.db.customer.findFirst({
      where: { id: customerId, organizationId: this.organizationId },
      select: { id: true },
    });
    if (!customer) throw new Error(`Customer ${customerId} not found`);
    const contacts = await this.db.customerContact.findMany({
      where: { customerId },
      orderBy: { name: "asc" },
    });
    return contacts.map(mapCustomerContact);
  }

  async createCustomerContact(customerId: string, input: {
    name: string;
    title?: string;
    phone?: string;
    email?: string;
    isPrimary?: boolean;
  }): Promise<CustomerContact> {
    // Verify customer belongs to org
    const customer = await this.db.customer.findFirst({
      where: { id: customerId, organizationId: this.organizationId },
    });
    if (!customer) throw new Error(`Customer ${customerId} not found`);

    const c = await this.db.customerContact.create({
      data: {
        id: createId("ccon"),
        customerId,
        name: input.name,
        title: input.title ?? "",
        phone: input.phone ?? "",
        email: input.email ?? "",
        isPrimary: input.isPrimary ?? false,
      },
    });
    return mapCustomerContact(c);
  }

  async updateCustomerContact(contactId: string, patch: Record<string, unknown>): Promise<CustomerContact> {
    const existing = await this.db.customerContact.findFirst({
      where: { id: contactId },
      include: { customer: true },
    });
    if (!existing || (existing.customer as any).organizationId !== this.organizationId) {
      throw new Error(`Contact ${contactId} not found`);
    }

    const data: any = {};
    const fields = ["name", "title", "phone", "email", "isPrimary", "active"];
    for (const f of fields) {
      if (patch[f] !== undefined) data[f] = patch[f];
    }

    const updated = await this.db.customerContact.update({ where: { id: contactId }, data });
    return mapCustomerContact(updated);
  }

  async deleteCustomerContact(contactId: string): Promise<{ deleted: boolean }> {
    const existing = await this.db.customerContact.findFirst({
      where: { id: contactId },
      include: { customer: true },
    });
    if (!existing || (existing.customer as any).organizationId !== this.organizationId) {
      throw new Error(`Contact ${contactId} not found`);
    }
    await this.db.quote.updateMany({ where: { customerContactId: contactId }, data: { customerContactId: null } });
    await this.db.customerContact.delete({ where: { id: contactId } });
    return { deleted: true };
  }

  // ── Departments ───────────────────────────────────────────────────────

  async listDepartments(): Promise<Department[]> {
    const departments = await this.db.department.findMany({
      where: { organizationId: this.organizationId },
      orderBy: { name: "asc" },
    });
    return departments.map(mapDepartment);
  }

  async createDepartment(input: {
    name: string;
    code?: string;
    description?: string;
  }): Promise<Department> {
    const d = await this.db.department.create({
      data: {
        id: createId("dept"),
        organizationId: this.organizationId,
        name: input.name,
        code: input.code ?? "",
        description: input.description ?? "",
      },
    });
    return mapDepartment(d);
  }

  async updateDepartment(id: string, patch: Record<string, unknown>): Promise<Department> {
    const existing = await this.db.department.findFirst({
      where: { id, organizationId: this.organizationId },
    });
    if (!existing) throw new Error(`Department ${id} not found`);

    const data: any = {};
    const fields = ["name", "code", "description", "active"];
    for (const f of fields) {
      if (patch[f] !== undefined) data[f] = patch[f];
    }

    const updated = await this.db.department.update({ where: { id }, data });
    return mapDepartment(updated);
  }

  async deleteDepartment(id: string): Promise<{ deleted: boolean }> {
    const existing = await this.db.department.findFirst({
      where: { id, organizationId: this.organizationId },
    });
    if (!existing) throw new Error(`Department ${id} not found`);
    await this.db.quote.updateMany({ where: { departmentId: id }, data: { departmentId: null } });
    await this.db.department.delete({ where: { id } });
    return { deleted: true };
  }

  // ── Catalogs ───────────────────────────────────────────────────────────

  async listCatalogs() {
    const catalogs = await this.db.catalog.findMany({
      where: { organizationId: this.organizationId, isTemplate: false },
      include: { _count: { select: { items: true } } },
    });
    return catalogs.map(mapCatalog);
  }

  async listCatalogRates() {
    const catalogs = await this.db.catalog.findMany({
      where: { organizationId: this.organizationId },
      select: { id: true },
    });
    const catalogIds = catalogs.map((c) => c.id);
    const items = await this.db.catalogItem.findMany({
      where: { catalogId: { in: catalogIds } },
    });
    return items.map(mapCatalogItem);
  }

  // ── Workspace State ────────────────────────────────────────────────────

  async getWorkspaceState(projectId: string) {
    await this.requireProject(projectId);
    const ws = await this.db.workspaceState.findFirst({ where: { projectId } });
    return ws ? mapWorkspaceState(ws) : null;
  }

  async updateWorkspaceState(projectId: string, patch: Record<string, unknown>) {
    await this.requireProject(projectId);
    const existing = await this.db.workspaceState.findFirst({ where: { projectId } });

    if (!existing) {
      const { quote, revision } = await this.findCurrentRevision(projectId);
      const worksheet = revision
        ? await this.db.worksheet.findFirst({ where: { revisionId: revision.id }, orderBy: { order: "asc" } })
        : null;

      const state = {
        activeTab: "overview",
        selectedQuoteId: quote?.id ?? null,
        selectedRevisionId: revision?.id ?? null,
        selectedWorksheetId: worksheet?.id ?? null,
        selectedDocumentId: null,
        openDocumentIds: [],
        filters: { documentKinds: [], search: "" },
        ...patch,
      };

      const ws = await this.db.workspaceState.create({
        data: {
          projectId,
          state: state as any,
          updatedAt: new Date(),
        },
      });

      const record = mapWorkspaceState(ws);
      await writeJsonAtomic(resolveApiPath(record.storagePath), record);
      return record;
    }

    const merged = { ...(existing.state as any), ...patch };
    const ws = await this.db.workspaceState.update({
      where: { id: existing.id },
      data: { state: merged as any, updatedAt: new Date() },
    });

    const record = mapWorkspaceState(ws);
    await writeJsonAtomic(resolveApiPath(record.storagePath), record);
    return record;
  }

  // ── Revision CRUD ──────────────────────────────────────────────────────

  async updateRevision(projectId: string, revisionId: string, patch: RevisionPatchInput) {
    await this.requireProject(projectId);
    const quote = await this.db.quote.findFirst({ where: { projectId } });
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });

    if (!quote || !revision || revision.quoteId !== quote.id) {
      throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
    }

    const data: any = { ...patch };
    if (patch.breakoutPackage !== undefined) data.breakoutPackage = patch.breakoutPackage as any;
    if (patch.calculatedCategoryTotals !== undefined) data.calculatedCategoryTotals = patch.calculatedCategoryTotals as any;
    if (patch.pricingLadder !== undefined) data.pricingLadder = patch.pricingLadder as any;
    if (patch.pdfPreferences !== undefined) data.pdfPreferences = patch.pdfPreferences as any;

    const changedKeys = Object.keys(patch);
    const beforeSnap = this.pick(revision as any, changedKeys);

    const updated = await this.db.quoteRevision.update({
      where: { id: revisionId },
      data,
    });

    const afterSnap = this.pick(updated as any, changedKeys);
    await this.pushActivity(projectId, revisionId, "revision_updated", { fields: changedKeys, before: beforeSnap, after: afterSnap });
    await this.syncProjectEstimate(projectId);

    return mapRevision(updated);
  }

  // ── Worksheet Item CRUD ────────────────────────────────────────────────

  /**
   * If the row carries a `costResourceId` but no `effectiveCostId`, pick the
   * highest-confidence, currently-effective cost basis for the matching
   * (resource, uom) pair and snap the row's `cost`/`effectiveCostId` to it.
   *
   * No-op when:
   *   - the row already has an effectiveCostId (caller chose explicitly)
   *   - the row has no costResourceId (not driven by cost intelligence)
   *   - no matching EffectiveCost exists (caller's `cost` stays as-is)
   *
   * Mutates the item in place. Returns true when a cost basis was applied.
   */
  private async autoResolveEffectiveCost(
    item: { uom?: string; cost?: number; costResourceId?: string | null; effectiveCostId?: string | null },
  ): Promise<boolean> {
    if (!item.costResourceId || item.effectiveCostId) return false;

    const today = new Date().toISOString().substring(0, 10);
    const ec = await this.db.effectiveCost.findFirst({
      where: {
        organizationId: this.organizationId,
        resourceId: item.costResourceId,
        ...(item.uom ? { uom: item.uom } : {}),
        OR: [{ expiresAt: null }, { expiresAt: { gt: today } }],
      },
      orderBy: [
        { confidence: "desc" },
        { effectiveDate: "desc" },
      ],
    });

    if (!ec) return false;
    item.effectiveCostId = ec.id;
    item.cost = ec.unitCost;
    return true;
  }

  async createWorksheetItem(projectId: string, worksheetId: string, input: CreateWorksheetItemInput) {
    return (await this.createWorksheetItemWithSnapshot(projectId, worksheetId, input)).item;
  }

  async createWorksheetItemWithSnapshot(
    projectId: string,
    worksheetId: string,
    input: CreateWorksheetItemInput,
  ): Promise<WorksheetItemMutationResult> {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    const worksheet = await this.db.worksheet.findFirst({ where: { id: worksheetId } });

    if (!revision || !worksheet || worksheet.revisionId !== revision.id) {
      throw new Error(`Worksheet ${worksheetId} not found for project ${projectId}`);
    }

    const normalizedInput: CreateWorksheetItemInput = {
      ...input,
      entityName: decodeHtmlEntities(input.entityName),
      vendor: typeof input.vendor === "string" ? decodeHtmlEntities(input.vendor) : input.vendor,
      description: decodeHtmlEntities(input.description),
      sourceNotes: decodeHtmlEntities(input.sourceNotes ?? ""),
    };
    await this.validateWorksheetItemProvenanceRefs(normalizedInput);

    const entityCats = await this.db.entityCategory.findMany({ where: { organizationId: this.organizationId } });
    const catDef = resolveEntityCategoryForItemInput(entityCats, normalizedInput);
    if (!catDef) {
      throw new Error(
        `Category "${normalizedInput.category}" is not configured. Choose a valid EntityCategory id or name before creating a worksheet item.`,
      );
    }

    const maxOrder = await this.db.worksheetItem.aggregate({
      where: { worksheetId },
      _max: { lineOrder: true },
    });
    const lineOrder = normalizedInput.lineOrder ?? ((maxOrder._max.lineOrder ?? 0) + 1);
    let linkedCatalogClassification: Record<string, unknown> = {};
    if (normalizedInput.itemId) {
      const linkedCatalogItem = await this.requireCatalogItem(normalizedInput.itemId);
      linkedCatalogClassification = catalogClassificationFromMetadata(linkedCatalogItem.metadata);
    }
    const classification = mergeWorksheetClassifications(linkedCatalogClassification, normalizedInput.classification);
    const costCode = stringValue(normalizedInput.costCode) ?? costCodeFromClassification(classification);

    const item: WorksheetItem = {
      id: createId("li"),
	      worksheetId,
	      phaseId: normalizedInput.phaseId ?? null,
	      categoryId: catDef.id,
	      category: catDef.name,
	      entityType: catDef.entityType,
      entityName: normalizedInput.entityName,
      classification,
      costCode,
      vendor: normalizedInput.vendor ?? undefined,
      description: normalizedInput.description,
      quantity: normalizedInput.quantity,
      uom: normalizedInput.uom,
      cost: normalizedInput.cost,
      markup: normalizedInput.markup,
      price: normalizedInput.price,
      lineOrder,
      rateScheduleItemId: normalizedInput.rateScheduleItemId ?? null,
      itemId: normalizedInput.itemId ?? null,
      tierUnits: normalizedInput.tierUnits ?? {},
      sourceNotes: normalizedInput.sourceNotes ?? "",
      costResourceId: normalizedInput.costResourceId ?? null,
      effectiveCostId: normalizedInput.effectiveCostId ?? null,
      laborUnitId: normalizedInput.laborUnitId ?? null,
      resourceComposition: normalizedInput.resourceComposition ?? {},
      sourceEvidence: normalizedInput.sourceEvidence ?? {},
    };

    const revisionScheduleRows = await this.db.rateSchedule.findMany({
      where: { revisionId: revision.id },
      include: { tiers: true, items: true },
    });
    const mappedRevisionSchedules = revisionScheduleRows.map(mapRateScheduleWithChildren);
    const rateScheduleCtx = toRateScheduleCalcContext(revisionScheduleRows);

    // ── Validate rateScheduleItemId / itemId references ──────────────
    const itemSource = catDef?.itemSource ?? "freeform";

    if (item.rateScheduleItemId) {
      const allRsItems = revisionScheduleRows.flatMap((s) => s.items ?? []);
      const match = allRsItems.find((ri) => ri.id === item.rateScheduleItemId);
      if (!match) {
        const available = allRsItems.map((ri) => `${ri.name} (${ri.id})`).slice(0, 20);
        throw new Error(
          `Invalid rateScheduleItemId "${item.rateScheduleItemId}" — no matching rate schedule item found in this revision.` +
          (available.length > 0
            ? ` Available items: ${available.join(", ")}`
            : ` No rate schedule items exist. Import a rate schedule first via importRateSchedule.`)
        );
      }

    } else if (itemSource === "rate_schedule") {
      throw new Error(
        `Category "${item.category}" requires a rateScheduleItemId (itemSource=rate_schedule). ` +
        `Call listRateScheduleItems to find valid IDs, then set rateScheduleItemId.`
      );
    }

    // ── Resolve tierUnit keys to full tier IDs ────────────
    // Handles: exact IDs, tier names (e.g. "Regular"), and truncated ID prefixes
    if (item.tierUnits && Object.keys(item.tierUnits).length > 0) {
      item.tierUnits = resolveTierUnitKeys(item.tierUnits, revisionScheduleRows);
    }

    // ── Auto-resolve EffectiveCost for cost-resource-linked rows ─────
    // When the caller specifies costResourceId without an effectiveCostId,
    // pick the highest-confidence, most recent matching cost basis. This
    // gives the institutional financial engine a single resolution path
    // instead of asking each caller to pre-look-up the cost id.
    await this.autoResolveEffectiveCost(item);

    const calcType = (catDef?.calculationType ?? "manual") as import("@bidwright/domain").CalculationType;
    const calculated = calculateLineItem(item, mapRevision(revision), calcType, rateScheduleCtx);
    Object.assign(item, calculated);

    const costSnapshot = buildSnapshotForItem(item);

	    const created = await this.db.worksheetItem.create({
      include: { entityCategory: true },
	      data: {
	        id: item.id,
	        worksheetId: item.worksheetId,
	        phaseId: item.phaseId,
	        categoryId: item.categoryId!,
	        category: item.category,
        entityType: item.entityType,
        entityName: item.entityName,
        classification: (item.classification ?? {}) as Prisma.InputJsonValue,
        costCode: item.costCode ?? null,
        vendor: item.vendor,
        description: item.description,
        quantity: item.quantity,
        uom: item.uom,
        cost: item.cost,
        markup: item.markup,
        price: item.price,
        lineOrder: item.lineOrder,
        rateScheduleItemId: item.rateScheduleItemId ?? null,
        itemId: item.itemId ?? null,
        tierUnits: item.tierUnits ?? {},
        costSnapshot: costSnapshot as unknown as Prisma.InputJsonValue,
        rateResolution: toPrismaJson(item.rateResolution ?? {}),
        sourceNotes: item.sourceNotes ?? "",
        costResourceId: item.costResourceId ?? null,
        effectiveCostId: item.effectiveCostId ?? null,
        laborUnitId: item.laborUnitId ?? null,
        resourceComposition: toPrismaJson(item.resourceComposition ?? {}),
        sourceEvidence: toPrismaJson(item.sourceEvidence ?? {}),
      } as any,
    });

    const mappedCreated = mapWorksheetItem(created);
    await this.pushActivity(projectId, revision.id, "item_created", { itemId: item.id, entityName: item.entityName, category: item.category, before: null, after: mappedCreated });
    const snapshot = await this.syncProjectEstimateForWorksheetItemMutation(projectId, {
      nextItem: mappedCreated,
      revisionSchedules: mappedRevisionSchedules,
    });
    if (!snapshot) {
      throw new Error(`Project ${projectId} does not have an active revision`);
    }

    return {
      item: mappedCreated,
      snapshot,
    };
  }

  async createWorksheet(projectId: string, input: CreateWorksheetInput) {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) {
      throw new Error(`Project ${projectId} not found`);
    }
    if (input.folderId) {
      await this.requireWorksheetFolderForRevision(input.folderId, revision.id, projectId);
    }

    const maxOrder = await this.db.worksheet.aggregate({
      where: { revisionId: revision.id },
      _max: { order: true },
    });
    const order = typeof input.order === "number" ? input.order : (maxOrder._max.order ?? 0) + 1;

    const worksheet = await this.db.worksheet.create({
      data: {
        id: createId("worksheet"),
        revisionId: revision.id,
        folderId: input.folderId ?? null,
        name: input.name.trim() || `Worksheet ${order}`,
        order,
      },
    });

    await this.pushActivity(projectId, revision.id, "worksheet_created", {
      worksheetId: worksheet.id,
      name: worksheet.name,
      before: null,
      after: mapWorksheet(worksheet),
      folderId: worksheet.folderId ?? null,
    });
    await this.syncProjectEstimate(projectId);
    return mapWorksheet(worksheet);
  }

  async updateWorksheet(projectId: string, worksheetId: string, patch: WorksheetPatchInput) {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    const worksheet = await this.db.worksheet.findFirst({ where: { id: worksheetId } });

    if (!revision || !worksheet || worksheet.revisionId !== revision.id) {
      throw new Error(`Worksheet ${worksheetId} not found for project ${projectId}`);
    }

    const data: any = {};
    if (typeof patch.name === "string") data.name = patch.name.trim() || worksheet.name;
    if (typeof patch.order === "number") data.order = patch.order;
    if (patch.folderId !== undefined) {
      if (patch.folderId) {
        await this.requireWorksheetFolderForRevision(patch.folderId, revision.id, projectId);
      }
      data.folderId = patch.folderId ?? null;
    }

    const worksheetBefore = mapWorksheet(worksheet);
    const updated = await this.db.worksheet.update({ where: { id: worksheetId }, data });
    await this.pushActivity(projectId, revision.id, "worksheet_updated", {
      worksheetId,
      name: updated.name,
      patch: Object.keys(data),
      before: worksheetBefore,
      after: mapWorksheet(updated),
    });
    await this.syncProjectEstimate(projectId);
    return mapWorksheet(updated);
  }

  private async requireWorksheetFolderForRevision(folderId: string, revisionId: string, projectId: string) {
    const folder = await this.db.worksheetFolder.findFirst({ where: { id: folderId, revisionId } });
    if (!folder) {
      throw new Error(`Worksheet folder ${folderId} not found for project ${projectId}`);
    }
    return folder;
  }

  private async assertWorksheetFolderParent(
    projectId: string,
    revisionId: string,
    parentId: string | null | undefined,
    movingFolderId?: string,
  ) {
    if (!parentId) return null;
    const parent = await this.requireWorksheetFolderForRevision(parentId, revisionId, projectId);
    if (movingFolderId && parentId === movingFolderId) {
      throw new Error("A folder cannot be moved inside itself");
    }
    if (movingFolderId) {
      let cursor: typeof parent | null = parent;
      while (cursor?.parentId) {
        if (cursor.parentId === movingFolderId) {
          throw new Error("A folder cannot be moved inside one of its descendants");
        }
        cursor = await this.db.worksheetFolder.findFirst({
          where: { id: cursor.parentId, revisionId },
        });
      }
    }
    return parent;
  }

  async createWorksheetFolder(projectId: string, input: CreateWorksheetFolderInput) {
    await this.requireProject(projectId);
    const { revision } = await this.requireCurrentRevision(projectId);
    await this.assertWorksheetFolderParent(projectId, revision.id, input.parentId);

    const maxOrder = await this.db.worksheetFolder.aggregate({
      where: { revisionId: revision.id, parentId: input.parentId ?? null },
      _max: { order: true },
    });
    const order = typeof input.order === "number" ? input.order : (maxOrder._max.order ?? 0) + 1;

    const folder = await this.db.worksheetFolder.create({
      data: {
        id: createId("worksheet-folder"),
        revisionId: revision.id,
        parentId: input.parentId ?? null,
        name: input.name.trim() || `Folder ${order}`,
        order,
      },
    });

    await this.pushActivity(projectId, revision.id, "worksheet_folder_created", {
      folderId: folder.id,
      name: folder.name,
      parentId: folder.parentId ?? null,
      before: null,
      after: mapWorksheetFolder(folder),
    });
    await this.syncProjectEstimate(projectId);
    return mapWorksheetFolder(folder);
  }

  async updateWorksheetFolder(projectId: string, folderId: string, patch: WorksheetFolderPatchInput) {
    await this.requireProject(projectId);
    const { revision } = await this.requireCurrentRevision(projectId);
    const folder = await this.requireWorksheetFolderForRevision(folderId, revision.id, projectId);

    const data: any = {};
    if (typeof patch.name === "string") data.name = patch.name.trim() || folder.name;
    if (typeof patch.order === "number") data.order = patch.order;
    if (patch.parentId !== undefined) {
      await this.assertWorksheetFolderParent(projectId, revision.id, patch.parentId, folderId);
      data.parentId = patch.parentId ?? null;
    }

    const before = mapWorksheetFolder(folder);
    const updated = await this.db.worksheetFolder.update({ where: { id: folderId }, data });
    await this.pushActivity(projectId, revision.id, "worksheet_folder_updated", {
      folderId,
      name: updated.name,
      patch: Object.keys(data),
      before,
      after: mapWorksheetFolder(updated),
    });
    await this.syncProjectEstimate(projectId);
    return mapWorksheetFolder(updated);
  }

  async deleteWorksheetFolder(projectId: string, folderId: string) {
    await this.requireProject(projectId);
    const { revision } = await this.requireCurrentRevision(projectId);
    const folder = await this.requireWorksheetFolderForRevision(folderId, revision.id, projectId);
    const before = mapWorksheetFolder(folder);

    await this.db.$transaction([
      this.db.worksheetFolder.updateMany({
        where: { revisionId: revision.id, parentId: folderId },
        data: { parentId: folder.parentId ?? null },
      }),
      this.db.worksheet.updateMany({
        where: { revisionId: revision.id, folderId },
        data: { folderId: folder.parentId ?? null },
      }),
      this.db.worksheetFolder.delete({ where: { id: folderId } }),
    ]);

    await this.pushActivity(projectId, revision.id, "worksheet_folder_deleted", {
      folderId,
      name: folder.name,
      parentId: folder.parentId ?? null,
      before,
      after: null,
      promotedChildrenToParentId: folder.parentId ?? null,
    });
    await this.syncProjectEstimate(projectId);
    return before;
  }

  async deleteWorksheet(projectId: string, worksheetId: string) {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    const worksheet = await this.db.worksheet.findFirst({ where: { id: worksheetId } });

    if (!revision || !worksheet || worksheet.revisionId !== revision.id) {
      throw new Error(`Worksheet ${worksheetId} not found for project ${projectId}`);
    }

    const count = await this.db.worksheet.count({ where: { revisionId: revision.id } });
    if (count <= 1) {
      throw new Error("The last worksheet in a revision cannot be deleted");
    }

    // Delete items then worksheet
    const worksheetBefore = mapWorksheet(worksheet);
    await this.db.worksheetItem.deleteMany({ where: { worksheetId } });
    await this.db.worksheet.delete({ where: { id: worksheetId } });
    await this.pushActivity(projectId, revision.id, "worksheet_deleted", {
      worksheetId,
      name: worksheet.name,
      before: worksheetBefore,
      after: null,
    });
    await this.syncProjectEstimate(projectId);

    return mapWorksheet(worksheet);
  }

  async updateWorksheetItem(projectId: string, itemId: string, patch: WorksheetItemPatchInput) {
    return (await this.updateWorksheetItemWithSnapshot(projectId, itemId, patch)).item;
  }

  async updateWorksheetItemWithSnapshot(
    projectId: string,
    itemId: string,
    patch: WorksheetItemPatchInput,
  ): Promise<WorksheetItemMutationResult> {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    const item = await this.db.worksheetItem.findFirst({
      where: { id: itemId },
      include: { entityCategory: true },
    });
    if (!item) throw new Error(`Worksheet item ${itemId} not found for project ${projectId}`);
    const worksheet = await this.db.worksheet.findFirst({ where: { id: item.worksheetId } });

    if (!revision || !worksheet || worksheet.revisionId !== revision.id) {
      throw new Error(`Worksheet item ${itemId} not found for project ${projectId}`);
    }

    const normalizedPatch: WorksheetItemPatchInput = {
      ...patch,
      ...(typeof patch.entityName === "string" ? { entityName: decodeHtmlEntities(patch.entityName) } : {}),
      ...(typeof patch.vendor === "string" ? { vendor: decodeHtmlEntities(patch.vendor) } : {}),
      ...(typeof patch.description === "string" ? { description: decodeHtmlEntities(patch.description) } : {}),
      ...(typeof patch.sourceNotes === "string" ? { sourceNotes: decodeHtmlEntities(patch.sourceNotes) } : {}),
    };

    // Apply patch to a domain item for recalculation
    const domainItem = mapWorksheetItem(item);
    const previousClassification = normalizeWorksheetClassification(domainItem.classification);
    Object.assign(domainItem, normalizedPatch);
	    if (normalizedPatch.vendor === null) {
	      domainItem.vendor = undefined;
	    }
    if (normalizedPatch.categoryId === null) {
      throw new Error("Worksheet item categoryId is required and cannot be cleared.");
    }
	    await this.validateWorksheetItemProvenanceRefs(domainItem);
    let linkedCatalogClassification: Record<string, unknown> = {};
    if (normalizedPatch.itemId !== undefined && domainItem.itemId) {
      const linkedCatalogItem = await this.requireCatalogItem(domainItem.itemId);
      linkedCatalogClassification = catalogClassificationFromMetadata(linkedCatalogItem.metadata);
    }
    domainItem.classification = mergeWorksheetClassifications(
      previousClassification,
      linkedCatalogClassification,
      normalizedPatch.classification,
    );
    if (normalizedPatch.costCode !== undefined) {
      domainItem.costCode = stringValue(normalizedPatch.costCode);
    } else {
      domainItem.costCode = domainItem.costCode ?? costCodeFromClassification(domainItem.classification);
    }

    const revisionScheduleRows = await this.db.rateSchedule.findMany({
      where: { revisionId: revision.id },
      include: { tiers: true, items: true },
    });
    const mappedRevisionSchedules = revisionScheduleRows.map(mapRateScheduleWithChildren);
    const rateScheduleCtx = toRateScheduleCalcContext(revisionScheduleRows);

    // ── Validate rateScheduleItemId / itemId references ──────────────
    const updateEntityCats = await this.db.entityCategory.findMany({ where: { organizationId: this.organizationId } });
    const updateCatDef = resolveEntityCategoryForItemInput(updateEntityCats, domainItem);
    if (!updateCatDef) {
      throw new Error(
        `Category "${domainItem.category}" is not configured. Choose a valid EntityCategory id or name before updating this worksheet item.`,
      );
    }
    domainItem.categoryId = updateCatDef.id;
    domainItem.category = updateCatDef.name;
    domainItem.entityType = updateCatDef.entityType;
    const updateItemSource = updateCatDef?.itemSource ?? "freeform";

    if (domainItem.rateScheduleItemId) {
      const allRsItems = revisionScheduleRows.flatMap((s) => s.items ?? []);
      const match = allRsItems.find((ri) => ri.id === domainItem.rateScheduleItemId);
      if (!match) {
        const available = allRsItems.map((ri) => `${ri.name} (${ri.id})`).slice(0, 20);
        throw new Error(
          `Invalid rateScheduleItemId "${domainItem.rateScheduleItemId}" — no matching rate schedule item found in this revision.` +
          (available.length > 0
            ? ` Available items: ${available.join(", ")}`
            : ` No rate schedule items exist. Import a rate schedule first via importRateSchedule.`)
        );
      }
    } else if (updateItemSource === "rate_schedule" && normalizedPatch.rateScheduleItemId === null) {
      // Only reject if explicitly clearing the ID on a rate_schedule category
      throw new Error(
        `Category "${domainItem.category}" requires a rateScheduleItemId (itemSource=rate_schedule). ` +
        `Call listRateScheduleItems to find valid IDs, then set rateScheduleItemId.`
      );
    }

    // ── Resolve tierUnit keys to full tier IDs ────────────
    // When the rate-schedule item is changing in this patch, remap existing
    // tierUnits onto the NEW schedule's tiers by name. Otherwise the persisted
    // tierUnits keep pointing at the old schedule's tier IDs and the calc
    // engine prices the line at $0 because those IDs aren't in the new
    // schedule's rates. This catches the agent flow that re-points labour
    // items at a different schedule (e.g. MECH → SHOP) without explicitly
    // sending tierUnits.
    const rateScheduleIdChanged =
      normalizedPatch.rateScheduleItemId !== undefined &&
      normalizedPatch.rateScheduleItemId !== item.rateScheduleItemId;
    if (
      rateScheduleIdChanged &&
      normalizedPatch.tierUnits === undefined &&
      domainItem.rateScheduleItemId &&
      domainItem.tierUnits &&
      Object.keys(domainItem.tierUnits).length > 0
    ) {
      const targetSchedule = revisionScheduleRows.find((s) =>
        (s.items ?? []).some((ri) => ri.id === domainItem.rateScheduleItemId),
      );
      if (targetSchedule) {
        const oldTierById = new Map<string, { id: string; name: string }>(
          revisionScheduleRows.flatMap((s) =>
            (s.tiers ?? []).map((t: any) => [t.id, { id: t.id, name: (t.name as string) ?? "" }]),
          ),
        );
        const newTiers = (targetSchedule.tiers ?? []).map((t: any) => ({
          id: t.id as string,
          name: (t.name as string) ?? "",
        }));
        const newTierByNameLower = new Map(newTiers.map((t) => [t.name.toLowerCase(), t]));
        const newTierById = new Map(newTiers.map((t) => [t.id, t]));
        const remapped: Record<string, number> = {};
        for (const [key, val] of Object.entries(domainItem.tierUnits)) {
          const numVal = Number(val) || 0;
          if (newTierById.has(key)) {
            remapped[key] = numVal;
            continue;
          }
          const oldTier = oldTierById.get(key);
          const byName = oldTier
            ? newTierByNameLower.get(oldTier.name.toLowerCase())
            : newTierByNameLower.get(key.toLowerCase());
          if (byName) remapped[byName.id] = numVal;
          // else drop — the old tier has no equivalent in the new schedule
        }
        domainItem.tierUnits = remapped;
      }
    }

    if (domainItem.tierUnits && Object.keys(domainItem.tierUnits).length > 0) {
      domainItem.tierUnits = resolveTierUnitKeys(domainItem.tierUnits, revisionScheduleRows);
    }

    // ── Auto-resolve EffectiveCost on cost-resource changes ──────────
    // If the caller cleared `costResourceId` (set to null), drop the
    // associated `effectiveCostId` too so the row no longer claims to
    // be cost-intelligence-backed.
    if (
      Object.prototype.hasOwnProperty.call(normalizedPatch, "costResourceId") &&
      !domainItem.costResourceId
    ) {
      domainItem.effectiveCostId = null;
    } else {
      // If costResourceId is set but effectiveCostId isn't, snap to the
      // best-matching cost basis row.
      await this.autoResolveEffectiveCost(domainItem);
    }

    const updateCalcType = (updateCatDef?.calculationType ?? "manual") as import("@bidwright/domain").CalculationType;
    const calculated = calculateLineItem(domainItem, mapRevision(revision), updateCalcType, rateScheduleCtx);
    Object.assign(domainItem, calculated);

    // Re-snapshot whenever cost or any library reference moved on this update.
    const costSnapshot = buildSnapshotForItem(domainItem);

	    const updated = await this.db.worksheetItem.update({
	      where: { id: itemId },
      include: { entityCategory: true },
	      data: {
	        phaseId: domainItem.phaseId,
	        categoryId: domainItem.categoryId!,
	        category: domainItem.category,
        entityType: domainItem.entityType,
        entityName: domainItem.entityName,
        classification: (domainItem.classification ?? {}) as Prisma.InputJsonValue,
        costCode: domainItem.costCode ?? null,
        vendor: domainItem.vendor ?? null,
        description: domainItem.description,
        quantity: domainItem.quantity,
        uom: domainItem.uom,
        cost: domainItem.cost,
        markup: domainItem.markup,
        price: domainItem.price,
        lineOrder: domainItem.lineOrder,
        rateScheduleItemId: domainItem.rateScheduleItemId ?? null,
        itemId: domainItem.itemId ?? null,
        tierUnits: domainItem.tierUnits ?? {},
        costSnapshot: costSnapshot as unknown as Prisma.InputJsonValue,
        rateResolution: toPrismaJson(domainItem.rateResolution ?? {}),
        sourceNotes: domainItem.sourceNotes ?? "",
        costResourceId: domainItem.costResourceId ?? null,
        effectiveCostId: domainItem.effectiveCostId ?? null,
        laborUnitId: domainItem.laborUnitId ?? null,
        resourceComposition: toPrismaJson(domainItem.resourceComposition ?? {}),
        sourceEvidence: toPrismaJson(domainItem.sourceEvidence ?? {}),
      } as any,
    });

    const patchKeys = Object.keys(normalizedPatch);
    const itemBefore = this.pick(mapWorksheetItem(item) as any, patchKeys);
    const mappedUpdated = mapWorksheetItem(updated);
    const itemAfter = this.pick(mappedUpdated as any, patchKeys);
    await this.pushActivity(projectId, revision.id, "item_updated", { itemId, entityName: domainItem.entityName, patch: patchKeys, before: itemBefore, after: itemAfter });
    const snapshot = await this.syncProjectEstimateForWorksheetItemMutation(projectId, {
      previousItem: mapWorksheetItem(item),
      nextItem: mappedUpdated,
      revisionSchedules: mappedRevisionSchedules,
    });
    if (!snapshot) {
      throw new Error(`Project ${projectId} does not have an active revision`);
    }

    return {
      item: mappedUpdated,
      snapshot,
    };
  }

  /**
   * Re-pull cost from the library reference attached to this row, write a
   * fresh snapshot, and re-price. Per-row only — this is the user-driven
   * "Refresh from library" affordance. Never automatic.
   *
   * Behavior by source:
   *   - costResourceId set: auto-resolve EffectiveCost (highest confidence
   *     for the row's UoM), apply unitCost, snapshot.
   *   - itemId set: pull CatalogItem.unitCost, apply, snapshot.
   *   - laborUnitId set: pull LaborUnit.hoursNormal × tier rate via the
   *     standard calc path; snapshot reflects the labor unit reference.
   *   - rateScheduleItemId only: re-run the calc engine to recompute price
   *     from the live rate schedule; snapshot reflects the rate-schedule ref.
   *   - manual rows: nothing to refresh — returns the existing item unchanged.
   */
  async refreshWorksheetItemFromLibrary(projectId: string, itemId: string) {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    const item = await this.db.worksheetItem.findFirst({
      where: { id: itemId },
      include: { entityCategory: true },
    });
    if (!item || !revision) {
      throw new Error(`Worksheet item ${itemId} not found for project ${projectId}`);
    }

    const domainItem = mapWorksheetItem(item);
    const before = mapWorksheetItem(item);

    let pulledFromLibrary = false;

    // Pull fresh cost from the most-specific available library source.
    if (domainItem.costResourceId) {
      // Force re-resolution by clearing the existing effectiveCostId so the
      // helper picks the current best match.
      domainItem.effectiveCostId = null;
      pulledFromLibrary = await this.autoResolveEffectiveCost(domainItem);
    } else if (domainItem.itemId) {
      const catalogItem = await this.db.catalogItem.findFirst({ where: { id: domainItem.itemId } });
      if (catalogItem) {
        domainItem.cost = catalogItem.unitCost ?? domainItem.cost;
        pulledFromLibrary = true;
      }
    }
    // Rate schedule and labor unit pricing flow naturally through the calc
    // engine below — no separate "pull cost" step needed; the schedule rates
    // and labor-unit hours will already pick up any library updates.

    // Re-run the standard calc engine.
    const revisionScheduleRows = await this.db.rateSchedule.findMany({
      where: { revisionId: revision.id },
      include: { tiers: true, items: true },
    });
    const mappedRevisionSchedules = revisionScheduleRows.map(mapRateScheduleWithChildren);
    const rateScheduleCtx = toRateScheduleCalcContext(revisionScheduleRows);
    const calcType = (item.entityCategory?.calculationType ?? "manual") as import("@bidwright/domain").CalculationType;
    const calculated = calculateLineItem(domainItem, mapRevision(revision), calcType, rateScheduleCtx);
    Object.assign(domainItem, calculated);

    const costSnapshot = buildSnapshotForItem(domainItem);

    const updated = await this.db.worksheetItem.update({
      where: { id: itemId },
      include: { entityCategory: true },
      data: {
        cost: domainItem.cost,
        markup: domainItem.markup,
        price: domainItem.price,
        effectiveCostId: domainItem.effectiveCostId ?? null,
        costSnapshot: costSnapshot as unknown as Prisma.InputJsonValue,
        rateResolution: toPrismaJson(domainItem.rateResolution ?? {}),
      } as any,
    });
    const mappedUpdated = mapWorksheetItem(updated);

    await this.pushActivity(projectId, revision.id, "item_refreshed", {
      itemId,
      entityName: domainItem.entityName,
      pulledFromLibrary,
      before: { cost: before.cost, price: before.price, effectiveCostId: before.effectiveCostId },
      after: { cost: mappedUpdated.cost, price: mappedUpdated.price, effectiveCostId: mappedUpdated.effectiveCostId },
    });

    const snapshot = await this.syncProjectEstimateForWorksheetItemMutation(projectId, {
      previousItem: before,
      nextItem: mappedUpdated,
      revisionSchedules: mappedRevisionSchedules,
    });
    if (!snapshot) {
      throw new Error(`Project ${projectId} does not have an active revision`);
    }

    return { item: mappedUpdated, snapshot, pulledFromLibrary };
  }

  async reorderWorksheetItems(projectId: string, worksheetId: string, orderedIds: string[]) {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    const worksheet = await this.db.worksheet.findFirst({ where: { id: worksheetId } });

    if (!revision || !worksheet || worksheet.revisionId !== revision.id) {
      throw new Error(`Worksheet ${worksheetId} not found for project ${projectId}`);
    }

    await this.db.$transaction(
      orderedIds.map((id, i) =>
        this.db.worksheetItem.updateMany({
          where: { id, worksheetId },
          data: { lineOrder: i + 1 },
        })
      )
    );

    await this.syncProjectEstimate(projectId);
    return { reordered: orderedIds.length };
  }

  async importWorksheetItems(projectId: string, worksheetId: string, items: Array<Record<string, unknown>>) {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    const worksheet = await this.db.worksheet.findFirst({ where: { id: worksheetId } });

    if (!revision || !worksheet || worksheet.revisionId !== revision.id) {
      throw new Error(`Worksheet ${worksheetId} not found for project ${projectId}`);
    }

    const maxOrder = await this.db.worksheetItem.aggregate({
      where: { worksheetId },
      _max: { lineOrder: true },
    });
    const baseOrder = (maxOrder._max.lineOrder ?? 0);

    const revisionSchedules = await this.db.rateSchedule.findMany({
      where: { revisionId: revision.id },
      include: { tiers: true, items: true },
    });
    const rateScheduleCtx = toRateScheduleCalcContext(revisionSchedules);
    const mappedRev = mapRevision(revision);
    const importEntityCats = await this.db.entityCategory.findMany({ where: { organizationId: this.organizationId } });

    const created: WorksheetItem[] = [];

	  for (let idx = 0; idx < items.length; idx++) {
	    const raw = items[idx];
	    const classification = normalizeWorksheetClassification(raw.classification);
      const importCatDef = resolveEntityCategoryForItemInput(importEntityCats, {
        categoryId: typeof raw.categoryId === "string" ? raw.categoryId : null,
        category: typeof raw.category === "string" ? raw.category : "Material",
        entityType: typeof raw.entityType === "string" ? raw.entityType : "Material",
      });
      if (!importCatDef) {
        throw new Error(`Imported row ${idx + 1} has an unknown category "${String(raw.category ?? "")}".`);
      }
	    const item: WorksheetItem = {
	      id: createId("li"),
	      worksheetId,
	      phaseId: raw.phaseId ? String(raw.phaseId) : null,
	      categoryId: importCatDef.id,
	      category: importCatDef.name,
	      entityType: importCatDef.entityType,
        entityName: String(raw.entityName ?? raw.name ?? "Imported Item"),
        classification,
        costCode: stringValue(raw.costCode) ?? stringValue(raw.cost_code) ?? costCodeFromClassification(classification),
        vendor: raw.vendor ? String(raw.vendor) : undefined,
        description: String(raw.description ?? ""),
        quantity: Number(raw.quantity) || 1,
        uom: String(raw.uom ?? "EA"),
        cost: Number(raw.cost) || 0,
        markup: Number(raw.markup) || 0.2,
        price: Number(raw.price) || 0,
        lineOrder: baseOrder + idx + 1,
        costResourceId: typeof raw.costResourceId === "string" ? raw.costResourceId : null,
        effectiveCostId: typeof raw.effectiveCostId === "string" ? raw.effectiveCostId : null,
        laborUnitId: typeof raw.laborUnitId === "string" ? raw.laborUnitId : null,
        resourceComposition: raw.resourceComposition && typeof raw.resourceComposition === "object" && !Array.isArray(raw.resourceComposition)
          ? raw.resourceComposition as Record<string, unknown>
          : {},
        sourceEvidence: raw.sourceEvidence && typeof raw.sourceEvidence === "object" && !Array.isArray(raw.sourceEvidence)
          ? raw.sourceEvidence as Record<string, unknown>
          : {},
	    };
	    await this.validateWorksheetItemProvenanceRefs(item);

	    const importCalcType = (importCatDef?.calculationType ?? "manual") as import("@bidwright/domain").CalculationType;
      const calculated = calculateLineItem(item, mappedRev, importCalcType, rateScheduleCtx);
      Object.assign(item, calculated);

      await this.db.worksheetItem.create({
        data: {
          id: item.id,
	          worksheetId: item.worksheetId,
	          phaseId: item.phaseId,
	          categoryId: item.categoryId!,
	          category: item.category,
          entityType: item.entityType,
          entityName: item.entityName,
          classification: (item.classification ?? {}) as Prisma.InputJsonValue,
          costCode: item.costCode ?? null,
          vendor: item.vendor,
          description: item.description,
          quantity: item.quantity,
          uom: item.uom,
          cost: item.cost,
          markup: item.markup,
          price: item.price,
          lineOrder: item.lineOrder,
          tierUnits: item.tierUnits ?? {},
          rateResolution: toPrismaJson(item.rateResolution ?? {}),
          sourceNotes: item.sourceNotes ?? "",
          costResourceId: item.costResourceId ?? null,
          effectiveCostId: item.effectiveCostId ?? null,
          laborUnitId: item.laborUnitId ?? null,
          resourceComposition: toPrismaJson(item.resourceComposition ?? {}),
          sourceEvidence: toPrismaJson(item.sourceEvidence ?? {}),
        } as any,
      });

      created.push(item);
      await this.pushActivity(projectId, revision.id, "item_created", { itemId: item.id, entityName: item.entityName, category: item.category, before: null, after: { ...item } });
    }

    await this.syncProjectEstimate(projectId);
    return created;
  }

  async deleteWorksheetItem(projectId: string, itemId: string) {
    return (await this.deleteWorksheetItemWithSnapshot(projectId, itemId)).item;
  }

  async deleteWorksheetItemWithSnapshot(
    projectId: string,
    itemId: string,
  ): Promise<WorksheetItemMutationResult> {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    const item = await this.db.worksheetItem.findFirst({ where: { id: itemId } });
    if (!item) throw new Error(`Worksheet item ${itemId} not found for project ${projectId}`);
    const worksheet = await this.db.worksheet.findFirst({ where: { id: item.worksheetId } });

    if (!revision || !worksheet || worksheet.revisionId !== revision.id) {
      throw new Error(`Worksheet item ${itemId} not found for project ${projectId}`);
    }

    await this.db.worksheetItem.delete({ where: { id: itemId } });
    const mappedDeleted = mapWorksheetItem(item);
    await this.pushActivity(projectId, revision.id, "item_deleted", { itemId, entityName: item.entityName, before: mappedDeleted, after: null });
    const revisionScheduleRows = await this.db.rateSchedule.findMany({
      where: { revisionId: revision.id },
      include: { tiers: true, items: true },
    });
    const snapshot = await this.syncProjectEstimateForWorksheetItemMutation(projectId, {
      previousItem: mappedDeleted,
      revisionSchedules: revisionScheduleRows.map(mapRateScheduleWithChildren),
    });
    if (!snapshot) {
      throw new Error(`Project ${projectId} does not have an active revision`);
    }

    return {
      item: mappedDeleted,
      snapshot,
    };
  }

  // ── Create Project ─────────────────────────────────────────────────────

  private async resolveCustomerSelection(
    db: PrismaClient | Prisma.TransactionClient,
    input: {
      customerId?: string | null;
      fallbackClientName?: string | null;
    },
  ): Promise<{
    customerId: string | null;
    clientName: string;
    customerString: string;
    customerExistingNew: Quote["customerExistingNew"];
  }> {
    const requestedCustomerId = input.customerId?.trim();
    const fallbackClientName = input.fallbackClientName?.trim() || "Unassigned Client";

    if (!requestedCustomerId) {
      return {
        customerId: null,
        clientName: fallbackClientName,
        customerString: fallbackClientName,
        customerExistingNew: "New",
      };
    }

    const customer = await db.customer.findFirst({
      where: {
        id: requestedCustomerId,
        organizationId: this.organizationId,
      },
    });

    if (!customer) {
      throw new Error(`Customer ${requestedCustomerId} not found`);
    }

    const resolvedName = customer.name.trim() || fallbackClientName;
    return {
      customerId: customer.id,
      clientName: resolvedName,
      customerString: resolvedName,
      customerExistingNew: "Existing",
    };
  }

  async createProject(input: CreateProjectInput) {
    const now = new Date();
    const nowISO = now.toISOString();
    const projectId = createId("project");
    const isManualProject = input.creationMode === "manual";
    const packageName = input.packageName ?? input.name;

    // Fetch org settings to inherit defaultMarkup
    const orgSettings = await this.db.organizationSettings.findUnique({
      where: { organizationId: this.organizationId },
    });
    const orgDefaults = (orgSettings?.defaults as any) ?? {};
    const defaultMarkup = typeof orgDefaults.defaultMarkup === "number" ? orgDefaults.defaultMarkup / 100 : 0.2;

    const created = await this.db.$transaction(async (tx) => {
      const customerSelection = await this.resolveCustomerSelection(tx, {
        customerId: input.customerId,
        fallbackClientName: input.clientName,
      });

      const project = await tx.project.create({
        data: {
          id: projectId,
          organizationId: this.organizationId,
          name: input.name,
          clientName: customerSelection.clientName,
          location: input.location,
          packageName,
          packageUploadedAt: nowISO,
          ingestionStatus: isManualProject ? "review" : "queued",
          scope: input.scope ?? "",
          summary: input.summary ?? (isManualProject ? "Manual quote created from scratch." : defaultProjectSummary(packageName, customerSelection.clientName)),
          createdAt: now,
          updatedAt: now,
        },
      });

      const quoteId = createId("quote");
      const revisionId = createId("revision");
      const worksheetId = createId("worksheet");

      await tx.quote.create({
        data: {
          id: quoteId,
          projectId,
          quoteNumber: makeQuoteNumber(),
          title: input.name,
          customerId: customerSelection.customerId,
          customerString: customerSelection.customerString,
          status: "draft",
          currentRevisionId: revisionId,
          customerExistingNew: customerSelection.customerExistingNew,
          userId: this._userId,
          createdAt: now,
          updatedAt: now,
        },
      });

      await tx.quoteRevision.create({
        data: {
          id: revisionId,
          quoteId,
          revisionNumber: 0,
          title: input.name,
          description: `Estimate for ${input.clientName} — ${input.location}${input.scope ? `. Scope: ${input.scope}` : ""}`,
          notes: "Populate worksheets, phases, modifiers, and conditions as the estimate matures.",
          breakoutStyle: "phase_detail",
          type: "Firm",
          status: "Open",
          defaultMarkup,
          laborDifficulty: "Normal",
          createdAt: now,
          updatedAt: now,
        },
      });

      // No default worksheet — the agent or user creates worksheets as needed

      const wsState = {
        activeTab: isManualProject ? "estimate" : "overview",
        selectedQuoteId: quoteId,
        selectedRevisionId: revisionId,
        selectedWorksheetId: null,
        selectedDocumentId: null,
        openDocumentIds: [],
        filters: { documentKinds: [], search: "" },
        panels: { documents: true, estimate: true, ai: true },
      };

      await tx.workspaceState.create({
        data: {
          projectId,
          state: wsState as any,
          updatedAt: now,
        },
      });

      const quote = await tx.quote.findFirst({
        where: { id: quoteId },
        include: { customer: true },
      });
      const revision = await tx.quoteRevision.findFirst({ where: { id: revisionId } });

      const wsRecord: WorkspaceStateRecord = {
        projectId,
        state: wsState,
        updatedAt: nowISO,
        storagePath: relativeWorkspacePath(projectId),
      };
      await writeJsonAtomic(resolveApiPath(wsRecord.storagePath), wsRecord);

      return {
        project: mapProject(project),
        quote: quote ? mapQuote(quote) : null,
        revision: revision ? mapRevision(revision) : null,
        workspaceState: wsRecord,
      };
    });
    await this.importAssignedRateSchedulesToRevision(projectId);
    return created;
  }

  // ── Package Registration ───────────────────────────────────────────────

  async assignProjectCustomer(projectId: string, customerId: string | null): Promise<void> {
    await this.requireProject(projectId);

    await this.db.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: projectId, organizationId: this.organizationId },
      });
      if (!project) throw new Error(`Project ${projectId} not found`);

      const quote = await tx.quote.findFirst({
        where: { projectId },
        orderBy: { createdAt: "asc" },
      });

      const customerSelection = await this.resolveCustomerSelection(tx, {
        customerId,
        fallbackClientName: quote?.customerString || project.clientName,
      });

      await tx.project.update({
        where: { id: projectId },
        data: {
          clientName: customerSelection.clientName,
          updatedAt: new Date(),
        },
      });

      if (quote) {
        await tx.quote.update({
          where: { id: quote.id },
          data: {
            customerId: customerSelection.customerId,
            customerString: customerSelection.customerString,
            customerExistingNew: customerSelection.customerExistingNew,
            updatedAt: new Date(),
          },
        });
      }
    });
    await this.importAssignedRateSchedulesToRevision(projectId);
  }

  async registerUploadedPackage(input: RegisterPackageInput & UploadArtifact) {
    await this.requireProject(input.projectId);
    const now = new Date();
    const nowISO = now.toISOString();
    const jobId = createId("job");

    // Upsert package
    await this.db.storedPackage.upsert({
      where: { id: input.packageId },
      create: {
        id: input.packageId,
        projectId: input.projectId,
        packageName: input.packageName,
        originalFileName: input.originalFileName,
        sourceKind: input.sourceKind ?? "project",
        storagePath: input.storagePath,
        checksum: input.checksum,
        totalBytes: input.totalBytes,
        status: "uploaded",
        uploadedAt: now,
        updatedAt: now,
      },
      update: {
        packageName: input.packageName,
        originalFileName: input.originalFileName,
        sourceKind: input.sourceKind ?? "project",
        storagePath: input.storagePath,
        checksum: input.checksum,
        totalBytes: input.totalBytes,
        status: "uploaded",
        updatedAt: now,
      },
    });

    const jobRecord = await this.db.ingestionJob.create({
      data: {
        id: jobId,
        projectId: input.projectId,
        packageId: input.packageId,
        kind: "package_upload",
        status: "complete",
        progress: 1,
        input: {
          originalFileName: input.originalFileName,
          storagePath: input.storagePath,
          packageName: input.packageName,
          checksum: input.checksum,
          totalBytes: input.totalBytes,
        } as any,
        output: { packageId: input.packageId } as any,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        completedAt: now,
        storagePath: relativeJobPath(jobId),
      },
    });

    await writeJsonAtomic(resolveApiPath(relativeJobPath(jobId)), mapIngestionJob(jobRecord));

    const pkg = await this.db.storedPackage.findFirst({ where: { id: input.packageId } });
    return mapStoredPackage(pkg!);
  }

  // ── Package Ingestion ──────────────────────────────────────────────────

  async ingestUploadedPackage(packageId: string): Promise<PackageIngestionOutcome> {
    const pkg = await this.db.storedPackage.findFirst({
      where: { id: packageId, project: { organizationId: this.organizationId } },
    });
    if (!pkg) throw new Error(`Package ${packageId} not found`);

    const project = await this.db.project.findFirst({ where: { id: pkg.projectId } });
    if (!project) throw new Error(`Project ${pkg.projectId} not found`);

    const ingestionJobId = createId("job");
    const now = new Date();

    // Create processing job
    await this.db.ingestionJob.create({
      data: {
        id: ingestionJobId,
        projectId: project.id,
        packageId,
        kind: "package_ingest",
        status: "processing",
        progress: 25,
        input: {
          packageId,
          packageName: pkg.packageName,
          originalFileName: pkg.originalFileName,
          storagePath: pkg.storagePath,
          sourceKind: pkg.sourceKind,
        } as any,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        storagePath: relativeJobPath(ingestionJobId),
      },
    });

    await this.db.storedPackage.update({
      where: { id: packageId },
      data: { status: "processing", updatedAt: now, error: null },
    });

    await this.db.project.update({
      where: { id: project.id },
      data: { ingestionStatus: "processing", updatedAt: now },
    });

    const zipPath = resolveRelativePath(pkg.storagePath);
    const checksum = await sha256File(zipPath);

    try {
      // Resolve Azure DI credentials from org settings for scanned PDF support
      const orgSettings = await this.getSettings();
      const integrations = orgSettings.integrations ?? {} as any;
      const documentExtractionProviderRaw = integrations.documentExtractionProvider;
      const documentExtractionProvider = typeof documentExtractionProviderRaw === "string" && ["azure", "local", "auto"].includes(documentExtractionProviderRaw)
        ? documentExtractionProviderRaw as DocumentExtractionProvider
        : "azure";
      const azureModelRaw = integrations.azureDiModel;
      const azureModel = typeof azureModelRaw === "string" && ["prebuilt-layout", "prebuilt-read", "prebuilt-document", "prebuilt-invoice"].includes(azureModelRaw)
        ? azureModelRaw as AzureDocumentIntelligenceModel
        : "prebuilt-layout";
      const azureConfig = (integrations.azureDiEndpoint || integrations.azureDiKey)
        ? { endpoint: integrations.azureDiEndpoint, key: integrations.azureDiKey, model: azureModel }
        : undefined;

      let latestDocumentProgress: any[] = [];
      const persistIngestionProgress = async (event: any) => {
        latestDocumentProgress = Array.isArray(event.documents) ? event.documents : latestDocumentProgress;
        const progressPercent = Math.max(1, Math.min(99, Math.round((Number(event.progress) || 0) * 100)));
        await this.db.ingestionJob.update({
          where: { id: ingestionJobId },
          data: {
            progress: progressPercent,
            output: {
              packageId,
              packageName: pkg.packageName,
              stage: event.stage,
              message: event.message ?? null,
              currentDocumentId: event.currentDocumentId ?? null,
              currentDocumentName: event.currentDocumentName ?? null,
              documentProgress: latestDocumentProgress,
              totalBytes: event.totalBytes ?? null,
              processedBytes: event.processedBytes ?? null,
              updatedAt: new Date().toISOString(),
            } as any,
            updatedAt: new Date(),
          },
        }).catch((err: unknown) => {
          console.warn("[ingestion-progress] Failed to persist progress:", err instanceof Error ? err.message : err);
        });
      };

      const report = await ingestCustomerPackage({
        packageId,
        packageName: pkg.packageName,
        sourceKind: pkg.sourceKind as PackageSourceKind,
        zipInput: zipPath,
      }, { azureConfig, documentExtractionProvider, onProgress: persistIngestionProgress });

      const binaryPathMap = await this.saveArtifactsForPackage(packageId, report, checksum, zipPath);

      const timestamp = new Date();
      const timestampISO = timestamp.toISOString();

      const sourceDocuments: SourceDocument[] = report.documents.map((document) => ({
        id: document.id,
        projectId: project.id,
        fileName: normalizeStoredSourcePath(document.sourcePath, document.title),
        fileType: path.extname(document.sourcePath || document.title).replace(/^\./, "") || "txt",
        documentType: documentTypeFromIngestion(document.kind),
        pageCount: inferPageCount(document, report.chunks),
        checksum: checksumForDocument(checksum, document),
        storagePath: binaryPathMap.get(document.id) ?? relativePackageDocumentArtifact(packageId, document.id, document.title),
        extractedText: document.text?.replace(/\0/g, "") ?? null,
        structuredData: document.structuredData ?? null,
        createdAt: timestampISO,
        updatedAt: timestampISO,
      }));

      await this.db.$transaction(async (tx) => {
        // Remove old documents for this package
        const oldDocIds = pkg.documentIds ?? [];
        if (oldDocIds.length > 0) {
          await tx.sourceDocument.deleteMany({ where: { id: { in: oldDocIds } } });
        }

        // Create new documents
        for (const doc of sourceDocuments) {
          // Strip null bytes (0x00) — PostgreSQL rejects them in text columns
          const sanitize = (s: string | null | undefined) => s?.replace(/\0/g, "") ?? undefined;
          await tx.sourceDocument.create({
            data: {
              id: doc.id,
              projectId: doc.projectId,
              fileName: sanitize(doc.fileName) ?? doc.fileName,
              fileType: doc.fileType,
              documentType: doc.documentType,
              pageCount: doc.pageCount,
              checksum: doc.checksum,
              storagePath: doc.storagePath,
              extractedText: sanitize(doc.extractedText),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              structuredData: doc.structuredData ? JSON.parse(JSON.stringify(doc.structuredData).replace(/\0/g, "")) : undefined,
              createdAt: timestamp,
              updatedAt: timestamp,
            } as any,
          });
        }

        // Update package
        await tx.storedPackage.update({
          where: { id: packageId },
          data: {
            status: "ready",
            reportPath: relativePackageReportPath(packageId),
            chunksPath: relativePackageChunksPath(packageId),
            documentIds: sourceDocuments.map((d) => d.id),
            documentCount: sourceDocuments.length,
            chunkCount: report.chunks.length,
            unknownFiles: report.unknownFiles,
            ingestedAt: timestamp,
            updatedAt: timestamp,
            error: null,
          } as any,
        });

        // Update job
        await tx.ingestionJob.update({
          where: { id: ingestionJobId },
          data: {
            status: "complete",
            progress: 100,
            output: {
              packageId,
              reportPath: relativePackageReportPath(packageId),
              chunksPath: relativePackageChunksPath(packageId),
              unknownFiles: report.unknownFiles,
              documentCount: sourceDocuments.length,
              chunkCount: report.chunks.length,
              documentProgress: latestDocumentProgress.length > 0
                ? latestDocumentProgress.map((entry) => {
                  const created = sourceDocuments.find((doc) =>
                    doc.id === entry.id ||
                    doc.fileName === normalizeStoredSourcePath(entry.sourcePath, entry.fileName)
                  );
                  return created ? {
                    ...entry,
                    id: created.id,
                    documentType: created.documentType,
                    pageCount: created.pageCount,
                    status: "complete",
                    stage: "Ready",
                    progress: 1,
                  } : entry;
                })
                : undefined,
            } as any,
            error: null,
            updatedAt: timestamp,
            completedAt: timestamp,
          },
        });

        // Update project
        await tx.project.update({
          where: { id: project.id },
          data: {
            packageName: pkg.packageName,
            packageUploadedAt: timestampISO,
            ingestionStatus: sourceDocuments.length > 0 ? "review" : "queued",
            summary: sourceDocuments.length > 0
              ? `Ingested ${sourceDocuments.length} documents from ${pkg.packageName}.`
              : `Package ${pkg.packageName} uploaded and awaiting classification.`,
            updatedAt: timestamp,
          },
        });

        // Update workspace state
        const ws = await tx.workspaceState.findFirst({ where: { projectId: project.id } });
        if (ws) {
          const state = ws.state as any;
          await tx.workspaceState.update({
            where: { id: ws.id },
            data: {
              state: {
                ...state,
                lastPackageId: packageId,
                selectedDocumentId: sourceDocuments[0]?.id ?? state.selectedDocumentId ?? null,
              } as any,
              updatedAt: timestamp,
            },
          });
        } else {
          const quote = await tx.quote.findFirst({ where: { projectId: project.id } });
          const revision = quote ? await tx.quoteRevision.findFirst({ where: { quoteId: quote.id } }) : null;
          const worksheet = revision
            ? await tx.worksheet.findFirst({ where: { revisionId: revision.id }, orderBy: { order: "asc" } })
            : null;

          await tx.workspaceState.create({
            data: {
              projectId: project.id,
              state: {
                activeTab: "overview",
                selectedQuoteId: quote?.id ?? null,
                selectedRevisionId: revision?.id ?? null,
                selectedWorksheetId: worksheet?.id ?? null,
                selectedDocumentId: sourceDocuments[0]?.id ?? null,
                openDocumentIds: [],
                filters: { documentKinds: [], search: "" },
                lastPackageId: packageId,
              } as any,
              updatedAt: timestamp,
            },
          });
        }
      });

      // Write job artifact
      const finalJob = await this.db.ingestionJob.findFirst({ where: { id: ingestionJobId } });
      if (finalJob) {
        await writeJsonAtomic(resolveApiPath(relativeJobPath(ingestionJobId)), mapIngestionJob(finalJob));
      }

      // Write workspace state artifact
      const wsRecord = await this.db.workspaceState.findFirst({ where: { projectId: project.id } });
      if (wsRecord) {
        await writeJsonAtomic(resolveApiPath(relativeWorkspacePath(project.id)), mapWorkspaceState(wsRecord));
      }

      // Sync totals
      await this.syncProjectEstimate(project.id, timestampISO);

      // Index documents into vector store for RAG search
      // This bridges the zip→document pipeline to the knowledge/vector pipeline
      // so the intake agent can immediately search document content.
      try {
        const { knowledgeService } = await import("./services/knowledge-service.js");
        for (const doc of sourceDocuments) {
          if (!doc.extractedText) continue;
          await knowledgeService.ingestDocument({
            content: doc.extractedText,
            title: doc.fileName,
            category: knowledgeCategoryFromDocType(doc.documentType),
            scope: "project",
            projectId: project.id,
            organizationId: this.organizationId,
            options: { chunkStrategy: "section-aware" },
          }, this).catch((err: unknown) => {
            // Non-fatal: log but don't fail the ingestion
            console.warn(`[vector-index] Failed to index document ${doc.fileName}:`, err instanceof Error ? err.message : err);
          });
        }
      } catch (indexError) {
        console.warn("[vector-index] Vector indexing skipped:", indexError instanceof Error ? indexError.message : indexError);
      }

      // Build result
      const store = await this.buildStoreSnapshot(project.id);
      const refreshedProject = store.projects[0];
      const refreshedQuote = store.quotes.find((q) => q.projectId === project.id);
      const refreshedRevision = refreshedQuote
        ? store.revisions.find((r) => r.id === refreshedQuote.currentRevisionId)
        : undefined;

      if (!refreshedProject || !refreshedQuote || !refreshedRevision) {
        throw new Error("Project workspace could not be rebuilt after ingestion");
      }

      const workspace = buildProjectWorkspace(store, project.id);
      if (!workspace) throw new Error("Workspace is unavailable after ingestion");

      const totals = summarizeProjectTotals(store, project.id);
      const finalPkg = await this.db.storedPackage.findFirst({ where: { id: packageId } });

      return {
        project: refreshedProject,
        quote: refreshedQuote,
        revision: refreshedRevision,
        packageRecord: finalPkg ? mapStoredPackage(finalPkg) : mapStoredPackage(pkg),
        job: finalJob ? mapIngestionJob(finalJob) : mapIngestionJob({ id: ingestionJobId } as any),
        report,
        documents: sourceDocuments,
        workspace,
        totals,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Package ingestion failed";
      const failTime = new Date();

      await this.db.storedPackage.update({
        where: { id: packageId },
        data: { status: "failed", error: message, updatedAt: failTime },
      }).catch(() => {});

      await this.db.project.update({
        where: { id: project.id },
        data: {
          ingestionStatus: "review",
          summary: `${pkg.packageName} uploaded, but ingestion failed: ${message}`,
          updatedAt: failTime,
        } as any,
      }).catch(() => {});

      await this.db.ingestionJob.update({
        where: { id: ingestionJobId },
        data: {
          status: "failed",
          progress: 100,
          error: message,
          updatedAt: failTime,
          completedAt: failTime,
        },
      }).catch(() => {});

      throw error;
    }
  }

  // ── Phase CRUD ─────────────────────────────────────────────────────────

  private async requirePhaseForRevision(phaseId: string, revisionId: string, projectId: string) {
    const phase = await this.db.phase.findFirst({ where: { id: phaseId, revisionId } });
    if (!phase) {
      throw new Error(`Phase ${phaseId} not found for project ${projectId}`);
    }
    return phase;
  }

  private async assertPhaseParent(
    projectId: string,
    revisionId: string,
    parentId: string | null | undefined,
    movingPhaseId?: string,
  ) {
    if (!parentId) return null;
    const parent = await this.requirePhaseForRevision(parentId, revisionId, projectId);
    if (movingPhaseId && parentId === movingPhaseId) {
      throw new Error("A phase cannot be moved inside itself");
    }
    if (movingPhaseId) {
      let cursor: typeof parent | null = parent;
      while (cursor?.parentId) {
        if (cursor.parentId === movingPhaseId) {
          throw new Error("A phase cannot be moved inside one of its descendants");
        }
        cursor = await this.db.phase.findFirst({
          where: { id: cursor.parentId, revisionId },
        });
      }
    }
    return parent;
  }

  async createPhase(projectId: string, revisionId: string, input: CreatePhaseInput) {
    await this.requireProject(projectId);
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
    if (!revision) throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
    await this.assertPhaseParent(projectId, revisionId, input.parentId);

    const maxOrder = await this.db.phase.aggregate({
      where: { revisionId, parentId: input.parentId ?? null },
      _max: { order: true },
    });
    const order = typeof input.order === "number" ? input.order : (maxOrder._max.order ?? 0) + 1;

    const phase = await this.db.phase.create({
      data: {
        id: createId("phase"),
        revisionId,
        parentId: input.parentId ?? null,
        number: input.number ?? String(order),
        name: input.name ?? `Phase ${order}`,
        description: input.description ?? "",
        order,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        color: input.color ?? "",
      },
    });

    await this.pushActivity(projectId, revisionId, "phase_created", { phaseId: phase.id, name: phase.name, before: null, after: mapPhase(phase) });
    await this.syncProjectEstimate(projectId);
    return mapPhase(phase);
  }

  async updatePhase(projectId: string, phaseId: string, patch: PhasePatchInput) {
    await this.requireProject(projectId);
    const phase = await this.db.phase.findFirst({ where: { id: phaseId } });
    if (!phase) throw new Error(`Phase ${phaseId} not found for project ${projectId}`);

    const data: any = {};
    if (patch.parentId !== undefined) {
      await this.assertPhaseParent(projectId, phase.revisionId, patch.parentId, phaseId);
      data.parentId = patch.parentId ?? null;
    }
    if (typeof patch.number === "string") data.number = patch.number;
    if (typeof patch.name === "string") data.name = patch.name;
    if (typeof patch.description === "string") data.description = patch.description;
    if (typeof patch.order === "number") data.order = patch.order;
    if (patch.startDate !== undefined) data.startDate = patch.startDate;
    if (patch.endDate !== undefined) data.endDate = patch.endDate;
    if (typeof patch.color === "string") data.color = patch.color;

    const phasePatchKeys = Object.keys(data);
    const phaseBefore = this.pick(phase as any, phasePatchKeys);
    const updated = await this.db.phase.update({ where: { id: phaseId }, data });
    const phaseAfter = this.pick(updated as any, phasePatchKeys);
    await this.pushActivity(projectId, phase.revisionId, "phase_updated", { phaseId, name: updated.name, patch: phasePatchKeys, before: phaseBefore, after: phaseAfter });
    await this.syncProjectEstimate(projectId);
    return mapPhase(updated);
  }

  async deletePhase(projectId: string, phaseId: string) {
    await this.requireProject(projectId);
    const phase = await this.db.phase.findFirst({ where: { id: phaseId } });
    if (!phase) throw new Error(`Phase ${phaseId} not found for project ${projectId}`);

    await this.db.$transaction([
      this.db.phase.updateMany({
        where: { revisionId: phase.revisionId, parentId: phaseId },
        data: { parentId: phase.parentId ?? null },
      }),
      this.db.worksheetItem.updateMany({
        where: { phaseId },
        data: { phaseId: null },
      }),
      this.db.phase.delete({ where: { id: phaseId } }),
    ]);
    await this.pushActivity(projectId, phase.revisionId, "phase_deleted", {
      phaseId,
      name: phase.name,
      before: mapPhase(phase),
      after: null,
      promotedChildrenToParentId: phase.parentId ?? null,
    });
    await this.syncProjectEstimate(projectId);
    return mapPhase(phase);
  }

  // ── Schedule Task CRUD ──────────────────────────────────────────────────

  async listScheduleTasks(projectId: string) {
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return [];
    const tasks = await this.db.scheduleTask.findMany({
      where: { projectId, revisionId: revision.id },
      orderBy: { order: "asc" },
    });
    return tasks.map(mapScheduleTask);
  }

  async createScheduleTask(projectId: string, revisionId: string, input: CreateScheduleTaskInput) {
    await this.requireProject(projectId);
    let parentTask: Awaited<ReturnType<typeof this.db.scheduleTask.findFirst>> | null = null;
    if (input.parentTaskId) {
      parentTask = await this.db.scheduleTask.findFirst({
        where: { id: input.parentTaskId, projectId, revisionId },
      });
      if (!parentTask) {
        throw new Error(`Parent schedule task ${input.parentTaskId} not found`);
      }
      if ((parentTask.phaseId ?? null) !== (input.phaseId ?? null)) {
        throw new Error("Parent task must be in the same phase.");
      }
    }
    const maxOrder = await this.db.scheduleTask.aggregate({
      where: { projectId, revisionId },
      _max: { order: true },
    });
    const order = input.order ?? (maxOrder._max.order ?? 0) + 1;
    const defaultCalendarId =
      input.calendarId === undefined
        ? (await this.ensureDefaultScheduleCalendar(projectId, revisionId)).id
        : input.calendarId ?? null;

    const task = await this.db.scheduleTask.create({
      data: {
        id: createId("schtask"),
        projectId,
        revisionId,
        phaseId: input.phaseId ?? null,
        calendarId: defaultCalendarId,
        parentTaskId: parentTask?.id ?? null,
        outlineLevel: Math.max(
          0,
          Math.min(12, input.outlineLevel ?? (parentTask ? (parentTask.outlineLevel ?? 0) + 1 : 0))
        ),
        name: input.name ?? "",
        description: input.description ?? "",
        taskType: input.taskType ?? "task",
        status: input.status ?? "not_started",
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        duration: input.duration ?? 0,
        progress: input.progress ?? 0,
        assignee: input.assignee ?? "",
        order,
        constraintType: input.constraintType ?? "asap",
        constraintDate: input.constraintDate ?? null,
        deadlineDate: input.deadlineDate ?? null,
        actualStart: input.actualStart ?? null,
        actualEnd: input.actualEnd ?? null,
      },
    });
    await this.syncTaskAssignments(projectId, task.id, input.resourceAssignments);
    await this.syncScheduleSummaryTaskRollups(projectId, revisionId);
    await this.pushActivity(projectId, revisionId, "schedule_task_created", { taskId: task.id, name: task.name, before: null, after: mapScheduleTask(task) });
    return mapScheduleTask(task);
  }

  async updateScheduleTask(
    projectId: string,
    taskId: string,
    patch: ScheduleTaskPatchInput,
    options?: { skipSummarySync?: boolean; explicitHierarchyUpdateIds?: Set<string> }
  ) {
    await this.requireProject(projectId);
    const task = await this.db.scheduleTask.findFirst({ where: { id: taskId, projectId } });
    if (!task) throw new Error(`Schedule task ${taskId} not found`);
    const revisionTasks = await this.db.scheduleTask.findMany({
      where: { projectId, revisionId: task.revisionId },
      orderBy: { order: "asc" },
    });

    const data: any = {};
    if (patch.phaseId !== undefined) data.phaseId = patch.phaseId;
    if (patch.calendarId !== undefined) data.calendarId = patch.calendarId;
    if (typeof patch.name === "string") data.name = patch.name;
    if (typeof patch.description === "string") data.description = patch.description;
    if (patch.taskType) data.taskType = patch.taskType;
    if (typeof patch.status === "string") data.status = patch.status;
    if (patch.startDate !== undefined) data.startDate = patch.startDate;
    if (patch.endDate !== undefined) data.endDate = patch.endDate;
    if (typeof patch.duration === "number") data.duration = patch.duration;
    if (typeof patch.progress === "number") data.progress = patch.progress;
    if (typeof patch.assignee === "string") data.assignee = patch.assignee;
    if (typeof patch.order === "number") data.order = patch.order;
    if (patch.constraintType) data.constraintType = patch.constraintType;
    if (patch.constraintDate !== undefined) data.constraintDate = patch.constraintDate;
    if (patch.deadlineDate !== undefined) data.deadlineDate = patch.deadlineDate;
    if (patch.actualStart !== undefined) data.actualStart = patch.actualStart;
    if (patch.actualEnd !== undefined) data.actualEnd = patch.actualEnd;

    const descendants = new Map<string, typeof revisionTasks[number]>();
    const stack = [taskId];
    while (stack.length > 0) {
      const currentId = stack.pop()!;
      for (const candidate of revisionTasks) {
        if (candidate.parentTaskId === currentId && !descendants.has(candidate.id)) {
          descendants.set(candidate.id, candidate);
          stack.push(candidate.id);
        }
      }
    }

    if (patch.phaseId !== undefined && patch.parentTaskId === undefined && task.parentTaskId) {
      data.parentTaskId = null;
      data.outlineLevel = 0;
    }

    if (patch.parentTaskId !== undefined || patch.outlineLevel !== undefined) {
      const nextParentTaskId =
        patch.parentTaskId !== undefined ? patch.parentTaskId : (data.parentTaskId ?? task.parentTaskId ?? null);
      const effectivePhaseId =
        patch.phaseId !== undefined ? patch.phaseId : (data.phaseId ?? task.phaseId ?? null);

      if (nextParentTaskId === taskId) {
        throw new Error("A task cannot be its own parent.");
      }
      if (nextParentTaskId && descendants.has(nextParentTaskId)) {
        throw new Error("A task cannot be nested under one of its descendants.");
      }

      let parentTask: typeof revisionTasks[number] | null = null;
      if (nextParentTaskId) {
        parentTask = revisionTasks.find((candidate) => candidate.id === nextParentTaskId) ?? null;
        if (!parentTask) {
          throw new Error(`Parent schedule task ${nextParentTaskId} not found`);
        }
        if ((parentTask.phaseId ?? null) !== (effectivePhaseId ?? null)) {
          throw new Error("Parent task must be in the same phase.");
        }
      }

      data.parentTaskId = nextParentTaskId;
      data.outlineLevel = Math.max(
        0,
        Math.min(12, patch.outlineLevel ?? (parentTask ? (parentTask.outlineLevel ?? 0) + 1 : 0))
      );
    }

    const taskPatchKeys = Object.keys(data);
    const taskBefore = this.pick(task as any, taskPatchKeys);
    const nextOutlineLevel = typeof data.outlineLevel === "number" ? data.outlineLevel : task.outlineLevel ?? 0;
    const previousOutlineLevel = task.outlineLevel ?? 0;
    const outlineDelta = nextOutlineLevel - previousOutlineLevel;
    const descendantUpdates: Prisma.PrismaPromise<unknown>[] = [];
    if (outlineDelta !== 0 || patch.phaseId !== undefined) {
      for (const descendant of descendants.values()) {
        if (options?.explicitHierarchyUpdateIds?.has(descendant.id)) {
          continue;
        }
        const descendantData: any = {};
        if (outlineDelta !== 0) {
          descendantData.outlineLevel = Math.max(0, Math.min(12, (descendant.outlineLevel ?? 0) + outlineDelta));
        }
        if (patch.phaseId !== undefined) {
          descendantData.phaseId = patch.phaseId;
        }
        if (Object.keys(descendantData).length > 0) {
          descendantUpdates.push(
            this.db.scheduleTask.update({
              where: { id: descendant.id },
              data: descendantData,
            })
          );
        }
      }
    }

    const transactionResult = await this.db.$transaction([
      ...descendantUpdates,
      this.db.scheduleTask.update({ where: { id: taskId }, data }),
    ]);
    let updated = transactionResult[transactionResult.length - 1] as typeof task;
    await this.syncTaskAssignments(projectId, taskId, patch.resourceAssignments);
    if (!options?.skipSummarySync) {
      await this.syncScheduleSummaryTaskRollups(projectId, task.revisionId);
      updated =
        (await this.db.scheduleTask.findFirst({
          where: { id: taskId, projectId },
        })) ?? updated;
    }
    const taskAfter = this.pick(updated as any, taskPatchKeys);
    await this.pushActivity(projectId, task.revisionId, "schedule_task_updated", { taskId, name: updated.name, patch: taskPatchKeys, before: taskBefore, after: taskAfter });
    return mapScheduleTask(updated);
  }

  async batchUpdateScheduleTasks(projectId: string, updates: Array<{ id: string } & ScheduleTaskPatchInput>) {
    await this.requireProject(projectId);
    const results: ScheduleTask[] = [];
    const touchedRevisionIds = new Set<string>();
    const explicitHierarchyUpdateIds = new Set(
      updates
        .filter(
          (update) =>
            update.phaseId !== undefined ||
            update.parentTaskId !== undefined ||
            update.outlineLevel !== undefined
        )
        .map((update) => update.id)
    );
    for (const upd of updates) {
      const { id, ...patch } = upd;
      const result = await this.updateScheduleTask(projectId, id, patch, {
        skipSummarySync: true,
        explicitHierarchyUpdateIds,
      });
      results.push(result);
      touchedRevisionIds.add(result.revisionId);
    }
    for (const revisionId of touchedRevisionIds) {
      await this.syncScheduleSummaryTaskRollups(projectId, revisionId);
    }
    return results;
  }

  async deleteScheduleTask(projectId: string, taskId: string) {
    await this.requireProject(projectId);
    const task = await this.db.scheduleTask.findFirst({ where: { id: taskId, projectId } });
    if (!task) throw new Error(`Schedule task ${taskId} not found`);
    const revisionTasks = await this.db.scheduleTask.findMany({
      where: { projectId, revisionId: task.revisionId },
      orderBy: { order: "asc" },
    });
    const descendants = new Map<string, typeof revisionTasks[number]>();
    const stack = [taskId];
    while (stack.length > 0) {
      const currentId = stack.pop()!;
      for (const candidate of revisionTasks) {
        if (candidate.parentTaskId === currentId && !descendants.has(candidate.id)) {
          descendants.set(candidate.id, candidate);
          stack.push(candidate.id);
        }
      }
    }

    const rebalanceUpdates: Prisma.PrismaPromise<unknown>[] = [];
    for (const descendant of descendants.values()) {
      rebalanceUpdates.push(
        this.db.scheduleTask.update({
          where: { id: descendant.id },
          data: {
            parentTaskId: descendant.parentTaskId === taskId ? task.parentTaskId ?? null : descendant.parentTaskId,
            outlineLevel: Math.max(0, (descendant.outlineLevel ?? 0) - 1),
          },
        })
      );
    }

    await this.db.$transaction([
      ...rebalanceUpdates,
      this.db.scheduleDependency.deleteMany({
        where: { OR: [{ predecessorId: taskId }, { successorId: taskId }] },
      }),
      this.db.scheduleTask.delete({ where: { id: taskId } }),
    ]);
    await this.syncScheduleSummaryTaskRollups(projectId, task.revisionId);
    await this.pushActivity(projectId, task.revisionId, "schedule_task_deleted", { taskId, name: task.name, before: mapScheduleTask(task), after: null });
    return mapScheduleTask(task);
  }

  // ── Schedule Dependency CRUD ────────────────────────────────────────────

  async createDependency(projectId: string, input: CreateDependencyInput) {
    await this.requireProject(projectId);
    const dep = await this.db.scheduleDependency.create({
      data: {
        id: createId("dep"),
        predecessorId: input.predecessorId,
        successorId: input.successorId,
        type: input.type ?? "FS",
        lagDays: input.lagDays ?? 0,
      },
    });
    return mapScheduleDependency(dep);
  }

  async deleteDependency(projectId: string, depId: string) {
    await this.requireProject(projectId);
    const dep = await this.db.scheduleDependency.findFirst({ where: { id: depId } });
    if (!dep) throw new Error(`Dependency ${depId} not found`);
    await this.db.scheduleDependency.delete({ where: { id: depId } });
    return mapScheduleDependency(dep);
  }

  async listScheduleCalendars(projectId: string) {
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return [];
    const calendars = await this.db.scheduleCalendar.findMany({
      where: { projectId, revisionId: revision.id },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }, { createdAt: "asc" }],
    });
    if (calendars.length > 0) return calendars.map(mapScheduleCalendar);
    const created = await this.ensureDefaultScheduleCalendar(projectId, revision.id);
    return [mapScheduleCalendar(created)];
  }

  async createScheduleCalendar(projectId: string, input: CreateScheduleCalendarInput) {
    await this.requireProject(projectId);
    const { revision } = await this.requireCurrentRevision(projectId);
    const existingCount = await this.db.scheduleCalendar.count({
      where: { projectId, revisionId: revision.id },
    });
    const calendar = await this.db.scheduleCalendar.create({
      data: {
        id: createId("schcal"),
        projectId,
        revisionId: revision.id,
        name: input.name ?? `Calendar ${existingCount + 1}`,
        description: input.description ?? "",
        isDefault: input.isDefault ?? existingCount === 0,
        workingDays: toPrismaJson(input.workingDays ?? DEFAULT_SCHEDULE_WORKING_DAYS),
        shiftStartMinutes: input.shiftStartMinutes ?? 480,
        shiftEndMinutes: input.shiftEndMinutes ?? 1020,
      },
    });
    if (calendar.isDefault) {
      await this.enforceSingleDefaultScheduleCalendar(projectId, revision.id, calendar.id);
      await this.db.scheduleTask.updateMany({
        where: { projectId, revisionId: revision.id, calendarId: null },
        data: { calendarId: calendar.id },
      });
    }
    return mapScheduleCalendar(calendar);
  }

  async updateScheduleCalendar(projectId: string, calendarId: string, patch: ScheduleCalendarPatchInput) {
    await this.requireProject(projectId);
    const calendar = await this.db.scheduleCalendar.findFirst({ where: { id: calendarId, projectId } });
    if (!calendar) throw new Error(`Schedule calendar ${calendarId} not found`);

    const data: Prisma.ScheduleCalendarUpdateInput = {};
    if (typeof patch.name === "string") data.name = patch.name;
    if (typeof patch.description === "string") data.description = patch.description;
    if (typeof patch.isDefault === "boolean") data.isDefault = patch.isDefault;
    if (patch.workingDays !== undefined) data.workingDays = toPrismaJson(patch.workingDays);
    if (typeof patch.shiftStartMinutes === "number") data.shiftStartMinutes = patch.shiftStartMinutes;
    if (typeof patch.shiftEndMinutes === "number") data.shiftEndMinutes = patch.shiftEndMinutes;

    let updated = await this.db.scheduleCalendar.update({
      where: { id: calendarId },
      data,
    });
    if (updated.isDefault) {
      await this.enforceSingleDefaultScheduleCalendar(projectId, calendar.revisionId, updated.id);
    } else if (calendar.isDefault) {
      updated = await this.db.scheduleCalendar.update({
        where: { id: calendarId },
        data: { isDefault: true },
      });
    }
    return mapScheduleCalendar(updated);
  }

  async deleteScheduleCalendar(projectId: string, calendarId: string) {
    await this.requireProject(projectId);
    const calendar = await this.db.scheduleCalendar.findFirst({ where: { id: calendarId, projectId } });
    if (!calendar) throw new Error(`Schedule calendar ${calendarId} not found`);

    let fallback = await this.db.scheduleCalendar.findFirst({
      where: { projectId, revisionId: calendar.revisionId, id: { not: calendarId } },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    if (!fallback) {
      fallback = await this.db.scheduleCalendar.create({
        data: {
          id: createId("schcal"),
          projectId,
          revisionId: calendar.revisionId,
          name: "Standard 5-Day",
          description: "Default Monday-Friday schedule calendar",
          isDefault: true,
          workingDays: DEFAULT_SCHEDULE_WORKING_DAYS as any,
          shiftStartMinutes: 480,
          shiftEndMinutes: 1020,
        },
      });
    }

    await this.db.scheduleTask.updateMany({
      where: { projectId, revisionId: calendar.revisionId, calendarId },
      data: { calendarId: fallback.id },
    });
    await this.db.scheduleResource.updateMany({
      where: { projectId, revisionId: calendar.revisionId, calendarId },
      data: { calendarId: fallback.id },
    });
    await this.db.scheduleCalendar.delete({ where: { id: calendarId } });
    await this.enforceSingleDefaultScheduleCalendar(projectId, calendar.revisionId, fallback.id);
    await this.db.scheduleCalendar.update({ where: { id: fallback.id }, data: { isDefault: true } });
    return mapScheduleCalendar(calendar);
  }

  async listScheduleResources(projectId: string) {
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return [];
    const resources = await this.db.scheduleResource.findMany({
      where: { projectId, revisionId: revision.id },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    });
    return resources.map(mapScheduleResource);
  }

  async createScheduleResource(projectId: string, input: CreateScheduleResourceInput) {
    await this.requireProject(projectId);
    const { revision } = await this.requireCurrentRevision(projectId);

    let calendarId = input.calendarId ?? null;
    if (calendarId) {
      const calendar = await this.db.scheduleCalendar.findFirst({
        where: { id: calendarId, projectId, revisionId: revision.id },
      });
      if (!calendar) throw new Error(`Schedule calendar ${calendarId} not found`);
    } else {
      calendarId = (await this.ensureDefaultScheduleCalendar(projectId, revision.id)).id;
    }

    const resource = await this.db.scheduleResource.create({
      data: {
        id: createId("schres"),
        projectId,
        revisionId: revision.id,
        calendarId,
        name: input.name ?? "New Resource",
        role: input.role ?? "",
        kind: input.kind ?? "labor",
        color: input.color ?? "",
        defaultUnits: input.defaultUnits ?? 1,
        capacityPerDay: input.capacityPerDay ?? 1,
        costRate: input.costRate ?? 0,
      },
    });
    return mapScheduleResource(resource);
  }

  async updateScheduleResource(projectId: string, resourceId: string, patch: ScheduleResourcePatchInput) {
    await this.requireProject(projectId);
    const resource = await this.db.scheduleResource.findFirst({ where: { id: resourceId, projectId } });
    if (!resource) throw new Error(`Schedule resource ${resourceId} not found`);

    if (patch.calendarId) {
      const calendar = await this.db.scheduleCalendar.findFirst({
        where: { id: patch.calendarId, projectId, revisionId: resource.revisionId },
      });
      if (!calendar) throw new Error(`Schedule calendar ${patch.calendarId} not found`);
    }

    const data: Prisma.ScheduleResourceUpdateInput = {};
    if (patch.calendarId !== undefined) {
      data.calendar = patch.calendarId ? { connect: { id: patch.calendarId } } : { disconnect: true };
    }
    if (typeof patch.name === "string") data.name = patch.name;
    if (typeof patch.role === "string") data.role = patch.role;
    if (patch.kind) data.kind = patch.kind;
    if (typeof patch.color === "string") data.color = patch.color;
    if (typeof patch.defaultUnits === "number") data.defaultUnits = patch.defaultUnits;
    if (typeof patch.capacityPerDay === "number") data.capacityPerDay = patch.capacityPerDay;
    if (typeof patch.costRate === "number") data.costRate = patch.costRate;

    const updated = await this.db.scheduleResource.update({
      where: { id: resourceId },
      data,
    });
    return mapScheduleResource(updated);
  }

  async deleteScheduleResource(projectId: string, resourceId: string) {
    await this.requireProject(projectId);
    const resource = await this.db.scheduleResource.findFirst({ where: { id: resourceId, projectId } });
    if (!resource) throw new Error(`Schedule resource ${resourceId} not found`);
    await this.db.scheduleResource.delete({ where: { id: resourceId } });
    return mapScheduleResource(resource);
  }

  async listScheduleBaselines(projectId: string) {
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return [];
    const baselines = await this.db.scheduleBaseline.findMany({
      where: { projectId, revisionId: revision.id },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
    });
    return baselines.map(mapScheduleBaseline);
  }

  async createScheduleBaseline(projectId: string, input: CreateScheduleBaselineInput) {
    await this.requireProject(projectId);
    const { revision } = await this.requireCurrentRevision(projectId);
    const baseline = await this.captureScheduleBaseline(projectId, revision.id, input);
    return mapScheduleBaseline(baseline);
  }

  async deleteScheduleBaseline(projectId: string, baselineId: string) {
    await this.requireProject(projectId);
    const baseline = await this.db.scheduleBaseline.findFirst({ where: { id: baselineId, projectId } });
    if (!baseline) throw new Error(`Schedule baseline ${baselineId} not found`);
    await this.db.scheduleBaseline.delete({ where: { id: baselineId } });
    if (baseline.isPrimary) {
      await this.syncPrimaryBaselineFields(projectId, baseline.revisionId);
    }
    return mapScheduleBaseline(baseline);
  }

  // ── Schedule Baseline ──────────────────────────────────────────────────

  async saveBaseline(projectId: string) {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return;
    await this.captureScheduleBaseline(projectId, revision.id, {
      name: "Primary Baseline",
      description: "Current committed schedule baseline",
      kind: "primary",
      isPrimary: true,
    });
  }

  async clearBaseline(projectId: string) {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return;
    const primaryBaselines = await this.db.scheduleBaseline.findMany({
      where: { projectId, revisionId: revision.id, isPrimary: true },
      select: { id: true },
    });
    if (primaryBaselines.length > 0) {
      await this.db.scheduleBaseline.deleteMany({
        where: { id: { in: primaryBaselines.map((baseline) => baseline.id) } },
      });
    }
    await this.syncPrimaryBaselineFields(projectId, revision.id);
  }

  // ── Modifier CRUD ──────────────────────────────────────────────────────

  async listAdjustments(projectId: string) {
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return [];
    const adjustments = await this.db.adjustment.findMany({
      where: { revisionId: revision.id },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    return adjustments.map(mapAdjustment);
  }

  async createAdjustment(projectId: string, revisionId: string, input: CreateAdjustmentInput) {
    await this.requireProject(projectId);
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
    if (!revision) throw new Error(`Revision ${revisionId} not found for project ${projectId}`);

    const maxOrder = await this.db.adjustment.aggregate({
      where: { revisionId },
      _max: { order: true },
    });

    const adjustment = await this.db.adjustment.create({
      data: {
        id: createId("adj"),
        revisionId,
        order: input.order ?? ((maxOrder._max.order ?? -1) + 1),
        kind: input.kind ?? "modifier",
        pricingMode: input.pricingMode ?? "modifier",
        name: input.name ?? "New Adjustment",
        description: input.description ?? "",
        type: input.type ?? "",
        financialCategory: input.financialCategory ?? "other",
        calculationBase: input.calculationBase ?? (input.pricingMode === "modifier" || input.kind === "modifier" ? "selected_scope" : "line_subtotal"),
        active: input.active ?? true,
        appliesTo: input.appliesTo ?? "All",
        percentage: input.percentage ?? null,
        amount: input.amount ?? null,
        show: input.show ?? "Yes",
      },
    });

    await this.syncProjectEstimate(projectId);
    return mapAdjustment(adjustment);
  }

  async updateAdjustment(projectId: string, adjustmentId: string, patch: AdjustmentPatchInput) {
    await this.requireProject(projectId);
    const adjustment = await this.db.adjustment.findFirst({ where: { id: adjustmentId } });
    if (!adjustment) throw new Error(`Adjustment ${adjustmentId} not found for project ${projectId}`);

    const updated = await this.db.adjustment.update({
      where: { id: adjustmentId },
      data: patch as any,
    });

    await this.syncProjectEstimate(projectId);
    return mapAdjustment(updated);
  }

  async deleteAdjustment(projectId: string, adjustmentId: string) {
    await this.requireProject(projectId);
    const adjustment = await this.db.adjustment.findFirst({ where: { id: adjustmentId } });
    if (!adjustment) throw new Error(`Adjustment ${adjustmentId} not found for project ${projectId}`);

    await this.db.adjustment.delete({ where: { id: adjustmentId } });
    await this.syncProjectEstimate(projectId);
    return mapAdjustment(adjustment);
  }

  async listEstimateFactors(projectId: string) {
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return [];
    const factors = await this.db.estimateFactor.findMany({
      where: { revisionId: revision.id },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    return factors.map(mapEstimateFactor);
  }

  async createEstimateFactor(projectId: string, revisionId: string, input: CreateEstimateFactorInput) {
    await this.requireProject(projectId);
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
    if (!revision) throw new Error(`Revision ${revisionId} not found for project ${projectId}`);

    const maxOrder = await this.db.estimateFactor.aggregate({
      where: { revisionId },
      _max: { order: true },
    });

    const factor = await this.db.estimateFactor.create({
      data: {
        id: createId("factor"),
        revisionId,
        order: input.order ?? ((maxOrder._max.order ?? -1) + 1),
        name: input.name ?? "New Factor",
        code: input.code ?? "",
        description: input.description ?? "",
        category: input.category ?? "Productivity",
        impact: input.impact ?? "labor_hours",
        value: input.value ?? 1,
        active: input.active ?? true,
        appliesTo: input.appliesTo ?? "Labour",
        applicationScope: input.applicationScope ?? "global",
        scope: (input.scope ?? { mode: "all" }) as any,
        formulaType: input.formulaType ?? "fixed_multiplier",
        parameters: (input.parameters ?? {}) as any,
        confidence: input.confidence ?? "medium",
        sourceType: input.sourceType ?? "custom",
        sourceId: input.sourceId ?? null,
        sourceRef: (input.sourceRef ?? {}) as any,
        tags: input.tags ?? [],
      },
    });

    await this.syncProjectEstimate(projectId);
    return mapEstimateFactor(factor);
  }

  async updateEstimateFactor(projectId: string, factorId: string, patch: EstimateFactorPatchInput) {
    await this.requireProject(projectId);
    const factor = await this.db.estimateFactor.findFirst({ where: { id: factorId } });
    if (!factor) throw new Error(`Estimate factor ${factorId} not found for project ${projectId}`);

    const data: Prisma.EstimateFactorUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.code !== undefined) data.code = patch.code;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.impact !== undefined) data.impact = patch.impact;
    if (patch.value !== undefined) data.value = patch.value;
    if (patch.active !== undefined) data.active = patch.active;
    if (patch.appliesTo !== undefined) data.appliesTo = patch.appliesTo;
    if (patch.applicationScope !== undefined) data.applicationScope = patch.applicationScope;
    if (patch.scope !== undefined) data.scope = patch.scope as any;
    if (patch.formulaType !== undefined) data.formulaType = patch.formulaType;
    if (patch.parameters !== undefined) data.parameters = patch.parameters as any;
    if (patch.confidence !== undefined) data.confidence = patch.confidence;
    if (patch.sourceType !== undefined) data.sourceType = patch.sourceType;
    if (patch.sourceId !== undefined) data.sourceId = patch.sourceId;
    if (patch.sourceRef !== undefined) data.sourceRef = patch.sourceRef as any;
    if (patch.tags !== undefined) data.tags = patch.tags;
    if (patch.order !== undefined) data.order = patch.order;

    const updated = await this.db.estimateFactor.update({
      where: { id: factorId },
      data,
    });

    await this.syncProjectEstimate(projectId);
    return mapEstimateFactor(updated);
  }

  async deleteEstimateFactor(projectId: string, factorId: string) {
    await this.requireProject(projectId);
    const factor = await this.db.estimateFactor.findFirst({ where: { id: factorId } });
    if (!factor) throw new Error(`Estimate factor ${factorId} not found for project ${projectId}`);

    await this.db.estimateFactor.delete({ where: { id: factorId } });
    await this.syncProjectEstimate(projectId);
    return mapEstimateFactor(factor);
  }

  async listEstimateFactorLibraryEntries() {
    const entries = await this.db.estimateFactorLibraryEntry.findMany({
      where: { organizationId: this.organizationId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    return entries.map(mapEstimateFactorLibraryEntry);
  }

  async createEstimateFactorLibraryEntry(input: CreateEstimateFactorLibraryEntryInput) {
    const maxOrder = await this.db.estimateFactorLibraryEntry.aggregate({
      where: { organizationId: this.organizationId },
      _max: { order: true },
    });

    const entry = await this.db.estimateFactorLibraryEntry.create({
      data: {
        id: createId("factorlib"),
        organizationId: this.organizationId,
        order: input.order ?? ((maxOrder._max.order ?? -1) + 1),
        name: input.name ?? "New Factor",
        code: input.code ?? "",
        description: input.description ?? "",
        category: input.category ?? "Productivity",
        impact: input.impact ?? "labor_hours",
        value: input.value ?? 1,
        appliesTo: input.appliesTo ?? "Labour",
        applicationScope: input.applicationScope ?? "both",
        scope: (input.scope ?? { mode: "all" }) as any,
        formulaType: input.formulaType ?? "fixed_multiplier",
        parameters: (input.parameters ?? {}) as any,
        confidence: input.confidence ?? "medium",
        sourceType: input.sourceType ?? "custom",
        sourceId: input.sourceId ?? null,
        sourceRef: (input.sourceRef ?? {}) as any,
        tags: input.tags ?? [],
      },
    });
    return mapEstimateFactorLibraryEntry(entry);
  }

  async updateEstimateFactorLibraryEntry(entryId: string, patch: EstimateFactorLibraryEntryPatchInput) {
    const existing = await this.db.estimateFactorLibraryEntry.findFirst({
      where: { id: entryId, organizationId: this.organizationId },
    });
    if (!existing) throw new Error(`Estimate factor library entry ${entryId} not found`);

    const data: Prisma.EstimateFactorLibraryEntryUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.code !== undefined) data.code = patch.code;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.impact !== undefined) data.impact = patch.impact;
    if (patch.value !== undefined) data.value = patch.value;
    if (patch.appliesTo !== undefined) data.appliesTo = patch.appliesTo;
    if (patch.applicationScope !== undefined) data.applicationScope = patch.applicationScope;
    if (patch.scope !== undefined) data.scope = patch.scope as any;
    if (patch.formulaType !== undefined) data.formulaType = patch.formulaType;
    if (patch.parameters !== undefined) data.parameters = patch.parameters as any;
    if (patch.confidence !== undefined) data.confidence = patch.confidence;
    if (patch.sourceType !== undefined) data.sourceType = patch.sourceType;
    if (patch.sourceId !== undefined) data.sourceId = patch.sourceId;
    if (patch.sourceRef !== undefined) data.sourceRef = patch.sourceRef as any;
    if (patch.tags !== undefined) data.tags = patch.tags;
    if (patch.order !== undefined) data.order = patch.order;

    const updated = await this.db.estimateFactorLibraryEntry.update({
      where: { id: entryId },
      data,
    });
    return mapEstimateFactorLibraryEntry(updated);
  }

  async deleteEstimateFactorLibraryEntry(entryId: string) {
    const existing = await this.db.estimateFactorLibraryEntry.findFirst({
      where: { id: entryId, organizationId: this.organizationId },
    });
    if (!existing) throw new Error(`Estimate factor library entry ${entryId} not found`);
    await this.db.estimateFactorLibraryEntry.delete({ where: { id: entryId } });
    return mapEstimateFactorLibraryEntry(existing);
  }

  async listModifiers(projectId: string) {
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return [];
    const adjustments = await this.db.adjustment.findMany({
      where: { revisionId: revision.id, kind: "modifier" },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    return adjustments
      .map(mapAdjustment)
      .map(adjustmentToLegacyModifier)
      .filter(isLegacyModifier);
  }

  async createModifier(projectId: string, revisionId: string, input: CreateModifierInput) {
    const adjustment = await this.createAdjustment(projectId, revisionId, {
      kind: "modifier",
      pricingMode: "modifier",
      name: input.name ?? "New Modifier",
      type: input.type ?? "Contingency",
      appliesTo: input.appliesTo ?? "All",
      percentage: input.percentage ?? null,
      amount: input.amount ?? null,
      show: input.show ?? "Yes",
    });
    return adjustmentToLegacyModifier(adjustment)!;
  }

  async updateModifier(projectId: string, modifierId: string, patch: ModifierPatchInput) {
    const adjustment = await this.updateAdjustment(projectId, modifierId, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.appliesTo !== undefined ? { appliesTo: patch.appliesTo } : {}),
      ...(patch.percentage !== undefined ? { percentage: patch.percentage } : {}),
      ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
      ...(patch.show !== undefined ? { show: patch.show } : {}),
    });
    return adjustmentToLegacyModifier(adjustment)!;
  }

  async deleteModifier(projectId: string, modifierId: string) {
    const adjustment = await this.deleteAdjustment(projectId, modifierId);
    return adjustmentToLegacyModifier(adjustment)!;
  }

  // ── Condition CRUD ─────────────────────────────────────────────────────

  async listConditionLibrary() {
    const entries = await this.db.conditionLibraryEntry.findMany({
      where: { organizationId: this.organizationId },
      orderBy: { type: "asc" },
    });
    return entries.map(mapConditionLibrary);
  }

  async createConditionLibraryEntry(input: { type: string; value: string }) {
    const entry = await this.db.conditionLibraryEntry.create({
      data: {
        id: createId("clib"),
        organizationId: this.organizationId,
        type: input.type,
        value: input.value,
      },
    });
    return mapConditionLibrary(entry);
  }

  async updateConditionLibraryEntry(
    entryId: string,
    patch: { type?: string; value?: string },
  ) {
    const existing = await this.db.conditionLibraryEntry.findFirst({
      where: { id: entryId, organizationId: this.organizationId },
    });
    if (!existing) throw new Error(`Condition library entry ${entryId} not found`);
    const data: Record<string, unknown> = {};
    if (patch.type !== undefined) data.type = patch.type;
    if (patch.value !== undefined) data.value = patch.value;
    const updated = await this.db.conditionLibraryEntry.update({
      where: { id: entryId },
      data,
    });
    return mapConditionLibrary(updated);
  }

  async deleteConditionLibraryEntry(entryId: string) {
    const entry = await this.db.conditionLibraryEntry.findFirst({
      where: { id: entryId, organizationId: this.organizationId },
    });
    if (!entry) throw new Error(`Condition library entry ${entryId} not found`);
    await this.db.conditionLibraryEntry.delete({ where: { id: entryId } });
    return mapConditionLibrary(entry);
  }

  async listConditions(projectId: string) {
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return [];
    const conditions = await this.db.condition.findMany({
      where: { revisionId: revision.id },
      orderBy: { order: "asc" },
    });
    return conditions.map(mapCondition);
  }

  async createCondition(projectId: string, revisionId: string, input: CreateConditionInput) {
    await this.requireProject(projectId);
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
    if (!revision) throw new Error(`Revision ${revisionId} not found for project ${projectId}`);

    const maxOrder = await this.db.condition.aggregate({
      where: { revisionId },
      _max: { order: true },
    });
    const order = input.order ?? ((maxOrder._max.order ?? 0) + 1);

    const condition = await this.db.condition.create({
      data: {
        id: createId("cond"),
        revisionId,
        type: input.type,
        value: input.value,
        order,
      },
    });

    await this.syncProjectEstimate(projectId);
    return mapCondition(condition);
  }

  async updateCondition(projectId: string, conditionId: string, patch: ConditionPatchInput) {
    await this.requireProject(projectId);
    const condition = await this.db.condition.findFirst({ where: { id: conditionId } });
    if (!condition) throw new Error(`Condition ${conditionId} not found for project ${projectId}`);

    const data: any = {};
    if (typeof patch.type === "string") data.type = patch.type;
    if (typeof patch.value === "string") data.value = patch.value;
    if (typeof patch.order === "number") data.order = patch.order;

    const updated = await this.db.condition.update({ where: { id: conditionId }, data });
    await this.syncProjectEstimate(projectId);
    return mapCondition(updated);
  }

  async deleteCondition(projectId: string, conditionId: string) {
    await this.requireProject(projectId);
    const condition = await this.db.condition.findFirst({ where: { id: conditionId } });
    if (!condition) throw new Error(`Condition ${conditionId} not found for project ${projectId}`);

    await this.db.condition.delete({ where: { id: conditionId } });
    await this.syncProjectEstimate(projectId);
    return mapCondition(condition);
  }

  async reorderConditions(projectId: string, revisionId: string, orderedIds: string[]) {
    await this.requireProject(projectId);
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
    if (!revision) throw new Error(`Revision ${revisionId} not found for project ${projectId}`);

    await this.db.$transaction(
      orderedIds.map((id, i) =>
        this.db.condition.updateMany({
          where: { id, revisionId },
          data: { order: i + 1 },
        })
      )
    );

    await this.syncProjectEstimate(projectId);
    const conditions = await this.db.condition.findMany({
      where: { revisionId },
      orderBy: { order: "asc" },
    });
    return conditions.map(mapCondition);
  }

  // ── Additional Line Item CRUD ──────────────────────────────────────────

  async listAdditionalLineItems(projectId: string) {
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return [];
    const adjustments = await this.db.adjustment.findMany({
      where: { revisionId: revision.id, kind: "line_item" },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    return adjustments
      .map(mapAdjustment)
      .map(adjustmentToLegacyAdditionalLineItem)
      .filter(isLegacyAdditionalLineItem);
  }

  async createAdditionalLineItem(projectId: string, revisionId: string, input: CreateAdditionalLineItemInput) {
    const pricingMode: Adjustment["pricingMode"] =
      input.type === "OptionStandalone"
        ? "option_standalone"
        : input.type === "OptionAdditional"
          ? "option_additional"
          : input.type === "LineItemStandalone"
            ? "line_item_standalone"
            : input.type === "CustomTotal"
              ? "custom_total"
              : "line_item_additional";

    const adjustment = await this.createAdjustment(projectId, revisionId, {
      kind: "line_item",
      pricingMode,
      name: input.name ?? "New Line Item",
      description: input.description ?? "",
      type: input.type ?? "LineItemAdditional",
      amount: input.amount ?? 0,
      show: "Yes",
    });
    return adjustmentToLegacyAdditionalLineItem(adjustment)!;
  }

  async updateAdditionalLineItem(projectId: string, aliId: string, patch: AdditionalLineItemPatchInput) {
    const pricingMode: Adjustment["pricingMode"] | undefined =
      patch.type === undefined
        ? undefined
        : patch.type === "OptionStandalone"
          ? "option_standalone"
          : patch.type === "OptionAdditional"
            ? "option_additional"
            : patch.type === "LineItemStandalone"
              ? "line_item_standalone"
              : patch.type === "CustomTotal"
                ? "custom_total"
                : "line_item_additional";

    const adjustment = await this.updateAdjustment(projectId, aliId, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(pricingMode !== undefined ? { pricingMode } : {}),
      ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
    });
    return adjustmentToLegacyAdditionalLineItem(adjustment)!;
  }

  async deleteAdditionalLineItem(projectId: string, aliId: string) {
    const adjustment = await this.deleteAdjustment(projectId, aliId);
    return adjustmentToLegacyAdditionalLineItem(adjustment)!;
  }

  // ── Summary Row CRUD ────────────────────────────────────────────────────

  async listSummaryRows(projectId: string): Promise<SummaryRow[]> {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return [];
    const rows = await this.db.summaryRow.findMany({
      where: { revisionId: revision.id },
      orderBy: { order: "asc" },
    });
    return rows.map(mapSummaryRow);
  }

  async getSummaryBuilder(projectId: string): Promise<SummaryBuilderConfig | null> {
    const workspace = await this.getWorkspace(projectId);
    return workspace?.summaryBuilder ?? null;
  }

  private async syncSummaryBuilderFromStoredRows(projectId: string, revisionId: string) {
    const store = await this.buildStoreSnapshot(projectId);
    const revision = store.revisions.find((entry) => entry.id === revisionId);
    if (!revision) {
      return null;
    }
    const existingBuilder = (revision.pdfPreferences as Record<string, unknown> | undefined)?.summaryBuilder as
      | Partial<SummaryBuilderConfig>
      | undefined;
    const totals = summarizeProjectTotals(store, projectId, existingBuilder);
    if (!totals) {
      return null;
    }

    const rows = (store.summaryRows ?? [])
      .filter((row) => row.revisionId === revisionId)
      .sort((left, right) => left.order - right.order);
    const derived = deriveSummaryBuilderFromLegacy(rows, revision.summaryLayoutPreset as SummaryPreset, totals);
    const config = normalizeSummaryBuilderConfig(
      {
        ...derived,
        classification: existingBuilder?.classification ?? derived.classification,
      },
      totals,
    );
    const currentPreferences = (revision.pdfPreferences as Record<string, unknown> | undefined) ?? {};

    await this.db.quoteRevision.update({
      where: { id: revisionId },
      data: {
        pdfPreferences: {
          ...currentPreferences,
          summaryBuilder: config,
        } as any,
      },
    });

    return config;
  }

  private async persistSummaryBuilder(
    projectId: string,
    revisionId: string,
    config: SummaryBuilderConfig,
    totals: ReturnType<typeof summarizeProjectTotals>,
  ) {
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
    if (!revision) {
      throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
    }
    if (!totals) {
      throw new Error(`Unable to resolve totals for summary builder on project ${projectId}`);
    }

    const materializedRows = materializeSummaryRowsFromBuilder(config, totals);
    const currentPreferences = (revision.pdfPreferences as Record<string, unknown> | undefined) ?? {};
    const preset = inferSummaryPresetFromBuilder(config);

    await this.db.$transaction(async (tx) => {
      await tx.summaryRow.deleteMany({ where: { revisionId } });
      for (const row of materializedRows) {
        await tx.summaryRow.create({
          data: {
            id: createId("sr"),
            revisionId,
            type: row.type,
            label: row.label,
            order: row.order,
            visible: row.visible,
            style: row.style,
            sourceCategory: row.sourceCategoryLabel ?? null,
            sourcePhase: null,
            sourceCategoryId: row.sourceCategoryId ?? null,
            sourceCategoryLabel: row.sourceCategoryLabel ?? null,
            sourcePhaseId: row.sourcePhaseId ?? null,
            sourceWorksheetId: row.sourceWorksheetId ?? null,
            sourceWorksheetLabel: row.sourceWorksheetLabel ?? null,
            sourceClassificationId: row.sourceClassificationId ?? null,
            sourceClassificationLabel: row.sourceClassificationLabel ?? null,
            sourceAdjustmentId: row.sourceAdjustmentId ?? null,
          },
        });
      }

      await tx.quoteRevision.update({
        where: { id: revisionId },
        data: {
          summaryLayoutPreset: preset,
          pdfPreferences: {
            ...currentPreferences,
            summaryBuilder: config,
          } as any,
        },
      });
    });

    await this.syncProjectEstimate(projectId);
    return config;
  }

  async saveSummaryBuilder(projectId: string, input: SummaryBuilderConfig): Promise<SummaryBuilderConfig> {
    await this.requireProject(projectId);
    const { revision } = await this.requireCurrentRevision(projectId);
    const store = await this.buildStoreSnapshot(projectId);
    const seedTotals = summarizeProjectTotals(store, projectId, input);
    if (!seedTotals) {
      throw new Error(`Unable to resolve totals for project ${projectId}`);
    }

    const normalizedSeed = normalizeSummaryBuilderConfig(input, seedTotals);
    const totals = summarizeProjectTotals(store, projectId, normalizedSeed) ?? seedTotals;
    const normalized = normalizeSummaryBuilderConfig(normalizedSeed, totals);
    return this.persistSummaryBuilder(projectId, revision.id, normalized, totals);
  }

  async createSummaryRow(projectId: string, revisionId: string, input: CreateSummaryRowInput): Promise<SummaryRow> {
    await this.requireProject(projectId);
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
    if (!revision) throw new Error(`Revision ${revisionId} not found for project ${projectId}`);

    // Auto-assign order if not provided
    let order = input.order;
    if (order === undefined) {
      const maxRow = await this.db.summaryRow.findFirst({
        where: { revisionId },
        orderBy: { order: "desc" },
      });
      order = (maxRow?.order ?? -1) + 1;
    }

      const row = await this.db.summaryRow.create({
        data: {
          id: createId("sr"),
          revisionId,
          type: input.type ?? "heading",
          label: input.label ?? "",
          order,
          visible: input.visible ?? true,
          style: input.style ?? "normal",
          sourceCategory: input.sourceCategoryLabel ?? null,
          sourcePhase: null,
          sourceCategoryId: input.sourceCategoryId ?? null,
          sourceCategoryLabel: input.sourceCategoryLabel ?? null,
          sourcePhaseId: input.sourcePhaseId ?? null,
          sourceWorksheetId: input.sourceWorksheetId ?? null,
          sourceWorksheetLabel: input.sourceWorksheetLabel ?? null,
          sourceClassificationId: input.sourceClassificationId ?? null,
          sourceClassificationLabel: input.sourceClassificationLabel ?? null,
          sourceAdjustmentId: input.sourceAdjustmentId ?? null,
        },
      });

      await this.db.quoteRevision.update({
        where: { id: revisionId },
        data: { summaryLayoutPreset: "custom" },
      });
      await this.syncSummaryBuilderFromStoredRows(projectId, revisionId);
      await this.syncProjectEstimate(projectId);
      return mapSummaryRow(row);
    }

  async updateSummaryRow(projectId: string, rowId: string, patch: SummaryRowPatchInput): Promise<SummaryRow> {
    await this.requireProject(projectId);
    const existing = await this.db.summaryRow.findFirst({ where: { id: rowId } });
    if (!existing) throw new Error(`Summary row ${rowId} not found`);

    const data: any = {};
    if (patch.type !== undefined) data.type = patch.type;
    if (patch.label !== undefined) data.label = patch.label;
    if (patch.order !== undefined) data.order = patch.order;
    if (patch.visible !== undefined) data.visible = patch.visible;
    if (patch.style !== undefined) data.style = patch.style;
    if (patch.sourceCategoryId !== undefined) data.sourceCategoryId = patch.sourceCategoryId;
    if (patch.sourceCategoryLabel !== undefined) {
      data.sourceCategoryLabel = patch.sourceCategoryLabel;
      data.sourceCategory = patch.sourceCategoryLabel;
    }
    if (patch.sourcePhaseId !== undefined) data.sourcePhaseId = patch.sourcePhaseId;
    if (patch.sourceWorksheetId !== undefined) data.sourceWorksheetId = patch.sourceWorksheetId;
    if (patch.sourceWorksheetLabel !== undefined) data.sourceWorksheetLabel = patch.sourceWorksheetLabel;
    if (patch.sourceClassificationId !== undefined) data.sourceClassificationId = patch.sourceClassificationId;
    if (patch.sourceClassificationLabel !== undefined) data.sourceClassificationLabel = patch.sourceClassificationLabel;
    if (patch.sourceAdjustmentId !== undefined) data.sourceAdjustmentId = patch.sourceAdjustmentId;

    const updated = await this.db.summaryRow.update({ where: { id: rowId }, data });
    await this.db.quoteRevision.update({
      where: { id: existing.revisionId },
      data: { summaryLayoutPreset: "custom" },
    });
    await this.syncSummaryBuilderFromStoredRows(projectId, existing.revisionId);
    await this.syncProjectEstimate(projectId);
    return mapSummaryRow(updated);
  }

  async deleteSummaryRow(projectId: string, rowId: string): Promise<SummaryRow> {
    await this.requireProject(projectId);
    const row = await this.db.summaryRow.findFirst({ where: { id: rowId } });
    if (!row) throw new Error(`Summary row ${rowId} not found`);

    await this.db.summaryRow.delete({ where: { id: rowId } });
    await this.db.quoteRevision.update({
      where: { id: row.revisionId },
      data: { summaryLayoutPreset: "custom" },
    });
    await this.syncSummaryBuilderFromStoredRows(projectId, row.revisionId);
    await this.syncProjectEstimate(projectId);
    return mapSummaryRow(row);
  }

  async reorderSummaryRows(projectId: string, orderedIds: string[]): Promise<{ reordered: number }> {
    await this.requireProject(projectId);
    const { revision } = await this.requireCurrentRevision(projectId);
    await Promise.all(
      orderedIds.map((id, index) =>
        this.db.summaryRow.update({ where: { id }, data: { order: index } })
      )
    );
    await this.db.quoteRevision.update({
      where: { id: revision.id },
      data: { summaryLayoutPreset: "custom" },
    });
    await this.syncSummaryBuilderFromStoredRows(projectId, revision.id);
    await this.syncProjectEstimate(projectId);
    return { reordered: orderedIds.length };
  }

  async applySummaryPreset(projectId: string, preset: SummaryPreset): Promise<SummaryRow[]> {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) throw new Error("No current revision found");

    if (preset === "custom") {
      await this.db.quoteRevision.update({
        where: { id: revision.id },
        data: { summaryLayoutPreset: "custom" },
      });
      await this.syncSummaryBuilderFromStoredRows(projectId, revision.id);
      await this.syncProjectEstimate(projectId);
      return this.listSummaryRows(projectId);
    }

    const store = await this.buildStoreSnapshot(projectId);
    const seedTotals = summarizeProjectTotals(store, projectId);
    if (!seedTotals) throw new Error(`Unable to generate summary preset for project ${projectId}`);

    const seedConfig = createSummaryBuilderPreset(preset, seedTotals);
    const totals = summarizeProjectTotals(store, projectId, seedConfig) ?? seedTotals;
    const config = createSummaryBuilderPreset(preset, totals);
    await this.persistSummaryBuilder(projectId, revision.id, config, totals);
    return this.listSummaryRows(projectId);
  }

  // ── Resource Catalogue ─────────────────────────────────────────────────

  async listResources(filters: {
    q?: string;
    resourceType?: string;
    category?: string;
    active?: boolean;
    limit?: number;
  } = {}): Promise<ResourceCatalogItem[]> {
    const where: any = { organizationId: this.organizationId };
    const q = filters.q?.trim();
    if (filters.resourceType) where.resourceType = filters.resourceType;
    if (filters.category) where.category = filters.category;
    if (filters.active !== undefined) where.active = filters.active;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
        { resourceType: { contains: q, mode: "insensitive" } },
        { manufacturer: { contains: q, mode: "insensitive" } },
        { manufacturerPartNumber: { contains: q, mode: "insensitive" } },
      ];
    }
    const rows = await (this.db as any).resourceCatalogItem.findMany({
      where,
      orderBy: [{ name: "asc" }, { code: "asc" }],
      take: Math.max(1, Math.min(filters.limit ?? 250, 1000)),
    });
    return rows.map(mapResourceCatalogItem);
  }

  // ── Rate Schedule CRUD ─────────────────────────────────────────────────

  async listRateSchedules(scope?: string): Promise<RateScheduleWithChildren[]> {
    const where: any = { organizationId: this.organizationId };
    if (scope) where.scope = scope;
    const schedules = await this.db.rateSchedule.findMany({
      where,
      include: { tiers: { orderBy: { sortOrder: "asc" } }, items: { orderBy: { sortOrder: "asc" } } },
      orderBy: { name: "asc" },
    });
    return schedules.map(mapRateScheduleWithChildren);
  }

  async getRateSchedule(id: string): Promise<RateScheduleWithChildren> {
    const schedule = await this.db.rateSchedule.findFirst({
      where: { id, organizationId: this.organizationId },
      include: { tiers: { orderBy: { sortOrder: "asc" } }, items: { orderBy: { sortOrder: "asc" } } },
    });
    if (!schedule) throw new Error(`Rate schedule ${id} not found`);
    return mapRateScheduleWithChildren(schedule);
  }

  private async requireRateScheduleCategory(category: string | null | undefined): Promise<string> {
    const value = typeof category === "string" ? category.trim() : "";
    if (!value) throw new Error("Rate schedule category is required");
    const entityCategory = await this.db.entityCategory.findFirst({
      where: {
        organizationId: this.organizationId,
        enabled: true,
        OR: [
          { entityType: value },
          { name: value },
          { id: value },
        ],
      },
    });
    if (!entityCategory) {
      throw new Error(`Rate schedule category "${value}" must match an enabled EntityCategory`);
    }
    return entityCategory.entityType?.trim() || entityCategory.name.trim();
  }

  private metadataTouchesRateBookCostSide(metadata: unknown): boolean {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
    const record = metadata as Record<string, unknown>;
    for (const key of ["costComponents", "rateComponents", "pricingComponents"]) {
      const components = record[key];
      if (!Array.isArray(components)) continue;
      for (const component of components) {
        if (!component || typeof component !== "object" || Array.isArray(component)) continue;
        const target = String((component as Record<string, unknown>).target ?? "cost").trim().toLowerCase();
        if (target !== "price") return true;
      }
    }
    return false;
  }

  private assertRevisionRateBookItemPatchIsSellSideOnly(
    schedule: { scope: string },
    patch: { costRates?: unknown; burden?: unknown; perDiem?: unknown; metadata?: unknown },
  ) {
    if (schedule.scope !== "revision") return;
    if (
      patch.costRates !== undefined ||
      patch.burden !== undefined ||
      patch.perDiem !== undefined ||
      this.metadataTouchesRateBookCostSide(patch.metadata)
    ) {
      throw badRequestError("Imported quote Ratebooks can only modify sell rates. Cost rates and cost-side components remain locked to the imported cost basis.");
    }
  }

  async createRateSchedule(input: {
    name: string; description?: string; category?: string; defaultMarkup?: number; autoCalculate?: boolean;
    effectiveDate?: string | null; expiryDate?: string | null; metadata?: Record<string, unknown>;
  }): Promise<RateScheduleWithChildren> {
    const category = await this.requireRateScheduleCategory(input.category);
    const created = await this.db.rateSchedule.create({
      data: {
        id: createId("rs"),
        organizationId: this.organizationId,
        name: input.name,
        description: input.description ?? "",
        category,
        scope: "global",
        effectiveDate: input.effectiveDate ?? null,
        expiryDate: input.expiryDate ?? null,
        defaultMarkup: input.defaultMarkup ?? 0,
        autoCalculate: input.autoCalculate ?? true,
        metadata: (input.metadata ?? {}) as any,
      },
      include: { tiers: true, items: true },
    });
    return mapRateScheduleWithChildren(created);
  }

  async updateRateSchedule(id: string, patch: {
    name?: string; description?: string; category?: string; defaultMarkup?: number;
    autoCalculate?: boolean; effectiveDate?: string | null; expiryDate?: string | null; metadata?: Record<string, unknown>;
  }): Promise<RateScheduleWithChildren> {
    const existing = await this.db.rateSchedule.findFirst({ where: { id, organizationId: this.organizationId } });
    if (!existing) throw new Error(`Rate schedule ${id} not found`);
    const data: any = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.category !== undefined) data.category = await this.requireRateScheduleCategory(patch.category);
    if (patch.defaultMarkup !== undefined) data.defaultMarkup = patch.defaultMarkup;
    if (patch.autoCalculate !== undefined) data.autoCalculate = patch.autoCalculate;
    if (patch.effectiveDate !== undefined) data.effectiveDate = patch.effectiveDate;
    if (patch.expiryDate !== undefined) data.expiryDate = patch.expiryDate;
    if (patch.metadata !== undefined) {
      if (existing.scope === "revision" && this.metadataTouchesRateBookCostSide(patch.metadata)) {
        throw badRequestError("Imported quote Ratebooks can only modify sell-side metadata. Cost-side components remain locked to the imported cost basis.");
      }
      data.metadata = patch.metadata;
    }
    const updated = await this.db.rateSchedule.update({
      where: { id }, data,
      include: { tiers: { orderBy: { sortOrder: "asc" } }, items: { orderBy: { sortOrder: "asc" } } },
    });
    if (existing.scope === "revision" && existing.projectId) {
      await this.syncProjectEstimate(existing.projectId);
    }
    return mapRateScheduleWithChildren(updated);
  }

  async deleteRateSchedule(id: string): Promise<{ deleted: boolean }> {
    const existing = await this.db.rateSchedule.findFirst({ where: { id, organizationId: this.organizationId } });
    if (!existing) throw new Error(`Rate schedule ${id} not found`);
    await this.db.rateSchedule.delete({ where: { id } });
    if (existing.scope === "revision" && existing.projectId) {
      await this.syncProjectEstimate(existing.projectId);
    }
    return { deleted: true };
  }

  async createRateScheduleTier(scheduleId: string, input: { name: string; multiplier?: number; sortOrder?: number; uom?: string | null }): Promise<RateScheduleWithChildren> {
    const schedule = await this.db.rateSchedule.findFirst({ where: { id: scheduleId, organizationId: this.organizationId } });
    if (!schedule) throw new Error(`Rate schedule ${scheduleId} not found`);
    const maxOrder = await this.db.rateScheduleTier.aggregate({ where: { scheduleId }, _max: { sortOrder: true } });
    await this.db.rateScheduleTier.create({
      data: {
        id: createId("rst"),
        scheduleId,
        name: input.name,
        multiplier: input.multiplier ?? 1.0,
        sortOrder: input.sortOrder ?? ((maxOrder._max.sortOrder ?? -1) + 1),
        uom: input.uom ?? null,
      },
    });
    return this.getRateSchedule(scheduleId);
  }

  async updateRateScheduleTier(tierId: string, patch: { name?: string; multiplier?: number; sortOrder?: number; uom?: string | null }): Promise<RateScheduleWithChildren> {
    const tier = await this.db.rateScheduleTier.findFirst({ where: { id: tierId } });
    if (!tier) throw new Error(`Rate schedule tier ${tierId} not found`);
    const schedule = await this.db.rateSchedule.findFirst({ where: { id: tier.scheduleId, organizationId: this.organizationId } });
    if (!schedule) throw new Error(`Rate schedule not found`);
    const data: any = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.multiplier !== undefined) data.multiplier = patch.multiplier;
    if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
    if (patch.uom !== undefined) data.uom = patch.uom;
    await this.db.rateScheduleTier.update({ where: { id: tierId }, data });
    return this.getRateSchedule(tier.scheduleId);
  }

  async deleteRateScheduleTier(tierId: string): Promise<RateScheduleWithChildren> {
    const tier = await this.db.rateScheduleTier.findFirst({ where: { id: tierId } });
    if (!tier) throw new Error(`Rate schedule tier ${tierId} not found`);
    const schedule = await this.db.rateSchedule.findFirst({ where: { id: tier.scheduleId, organizationId: this.organizationId } });
    if (!schedule) throw new Error(`Rate schedule not found`);
    await this.db.rateScheduleTier.delete({ where: { id: tierId } });
    return this.getRateSchedule(tier.scheduleId);
  }

  async createRateScheduleItem(scheduleId: string, input: {
    resourceId?: string | null;
    catalogItemId?: string | null;
    rates?: Record<string, number>; costRates?: Record<string, number>;
    burden?: number; perDiem?: number; metadata?: Record<string, unknown>; sortOrder?: number;
  }): Promise<RateScheduleWithChildren> {
    if (!input.resourceId && !input.catalogItemId) {
      throw new Error("resourceId or catalogItemId is required for Ratebook items.");
    }
    const schedule = await this.db.rateSchedule.findFirst({ where: { id: scheduleId, organizationId: this.organizationId } });
    if (!schedule) throw new Error(`Rate schedule ${scheduleId} not found`);
    const resource = input.resourceId ? await this.requireRateBookResource(input.resourceId) : null;
    const catalogItemId = input.catalogItemId ?? resource?.catalogItemId ?? null;
    const catalogItem = catalogItemId ? await this.requireCatalogItem(catalogItemId) : null;
    if (resource && input.catalogItemId && resource.catalogItemId && resource.catalogItemId !== input.catalogItemId) {
      throw new Error(`Resource ${resource.id} is linked to catalog item ${resource.catalogItemId}, not ${input.catalogItemId}.`);
    }
    const tiers = await this.db.rateScheduleTier.findMany({ where: { scheduleId }, orderBy: { sortOrder: "asc" } });
    const resourceMetadata = (resource?.metadata && typeof resource.metadata === "object" && !Array.isArray(resource.metadata)
      ? resource.metadata
      : {}) as Record<string, unknown>;
    const baseCost = Number(resourceMetadata.unitCost ?? resourceMetadata.cost ?? catalogItem?.unitCost ?? 0) || 0;
    const basePrice = Number(resourceMetadata.unitPrice ?? resourceMetadata.price ?? catalogItem?.unitPrice ?? 0) || 0;
    const seedByTier = (base: number) => {
      if (base <= 0) return {};
      const targetTiers = tiers.length > 0 ? tiers : [{ id: "__unit", multiplier: 1 }];
      return Object.fromEntries(
        targetTiers.map((tier) => [tier.id, Math.round(base * Number(tier.multiplier ?? 1) * 100) / 100]),
      );
    };
    const maxOrder = await this.db.rateScheduleItem.aggregate({ where: { scheduleId }, _max: { sortOrder: true } });
    await (this.db as any).rateScheduleItem.create({
      data: {
        id: createId("rsi"), scheduleId,
        catalogItemId: catalogItem?.id ?? null,
        resourceId: resource?.id ?? null,
        code: resource?.code || catalogItem?.code || "",
        name: resource?.name || catalogItem?.name || "",
        unit: resource?.defaultUom || catalogItem?.unit || "EA",
        rates: (input.rates ?? seedByTier(basePrice)) as any,
        costRates: (input.costRates ?? seedByTier(baseCost)) as any,
        burden: input.burden ?? 0, perDiem: input.perDiem ?? 0,
        metadata: (input.metadata ?? {}) as any,
        sortOrder: input.sortOrder ?? ((maxOrder._max.sortOrder ?? -1) + 1),
      },
    });
    if (schedule.scope === "revision" && schedule.projectId) {
      await this.syncProjectEstimate(schedule.projectId);
    }
    return this.getRateSchedule(scheduleId);
  }

  async updateRateScheduleItem(itemId: string, patch: {
    rates?: Record<string, number>; costRates?: Record<string, number>;
    burden?: number; perDiem?: number; metadata?: Record<string, unknown>; sortOrder?: number;
  }): Promise<RateScheduleWithChildren> {
    const item = await this.db.rateScheduleItem.findFirst({ where: { id: itemId } });
    if (!item) throw new Error(`Rate schedule item ${itemId} not found`);
    const schedule = await this.db.rateSchedule.findFirst({ where: { id: item.scheduleId, organizationId: this.organizationId } });
    if (!schedule) throw new Error(`Rate schedule not found`);
    this.assertRevisionRateBookItemPatchIsSellSideOnly(schedule, patch);
    const data: any = {};
    if (patch.rates !== undefined) data.rates = patch.rates;
    if (patch.costRates !== undefined) data.costRates = patch.costRates;
    if (patch.burden !== undefined) data.burden = patch.burden;
    if (patch.perDiem !== undefined) data.perDiem = patch.perDiem;
    if (patch.metadata !== undefined) data.metadata = patch.metadata;
    if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
    await this.db.rateScheduleItem.update({ where: { id: itemId }, data });
    if (schedule.scope === "revision" && schedule.projectId) {
      await this.syncProjectEstimate(schedule.projectId);
    }
    return this.getRateSchedule(item.scheduleId);
  }

  async deleteRateScheduleItem(itemId: string): Promise<RateScheduleWithChildren> {
    const item = await this.db.rateScheduleItem.findFirst({ where: { id: itemId } });
    if (!item) throw new Error(`Rate schedule item ${itemId} not found`);
    const schedule = await this.db.rateSchedule.findFirst({ where: { id: item.scheduleId, organizationId: this.organizationId } });
    if (!schedule) throw new Error(`Rate schedule not found`);
    await this.db.rateScheduleItem.delete({ where: { id: itemId } });
    if (schedule.scope === "revision" && schedule.projectId) {
      await this.syncProjectEstimate(schedule.projectId);
    }
    return this.getRateSchedule(item.scheduleId);
  }

  async importRateScheduleToRevision(projectId: string, scheduleId: string): Promise<RateScheduleWithChildren> {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) throw new Error(`No active revision for project ${projectId}`);
    const source = await this.db.rateSchedule.findFirst({
      where: { id: scheduleId, organizationId: this.organizationId, scope: "global" },
      include: { tiers: true, items: true },
    });
    if (!source) throw new Error(`Rate schedule ${scheduleId} not found`);

    // Prevent duplicate imports — if this schedule was already imported for this revision, return the existing copy
    const existing = await this.db.rateSchedule.findFirst({
      where: { revisionId: revision.id, sourceScheduleId: scheduleId },
      include: { tiers: true, items: true },
    });
    if (existing) {
      return mapRateScheduleWithChildren(existing);
    }

    return await this.db.$transaction(async (tx) => {
      const newSchedId = createId("rs");
      const tierIdMap = new Map<string, string>();

      await tx.rateSchedule.create({
        data: {
          id: newSchedId, organizationId: this.organizationId, name: source.name, description: source.description,
          category: source.category, scope: "revision", projectId, revisionId: revision.id,
          sourceScheduleId: source.id, effectiveDate: source.effectiveDate, expiryDate: source.expiryDate,
          defaultMarkup: source.defaultMarkup, autoCalculate: source.autoCalculate,
          metadata: source.metadata as any,
        },
      });

      for (const tier of source.tiers) {
        const newTierId = createId("rst");
        tierIdMap.set(tier.id, newTierId);
        await tx.rateScheduleTier.create({
          data: { id: newTierId, scheduleId: newSchedId, name: tier.name, multiplier: tier.multiplier, sortOrder: tier.sortOrder, uom: tier.uom ?? null },
        });
      }

      for (const item of source.items) {
        const remappedRates: Record<string, number> = {};
        const remappedCostRates: Record<string, number> = {};
        for (const [oldTierId, val] of Object.entries((item.rates as Record<string, number>) ?? {})) {
          remappedRates[tierIdMap.get(oldTierId) ?? oldTierId] = val;
        }
        for (const [oldTierId, val] of Object.entries((item.costRates as Record<string, number>) ?? {})) {
          remappedCostRates[tierIdMap.get(oldTierId) ?? oldTierId] = val;
        }
        await (tx as any).rateScheduleItem.create({
          data: {
            id: createId("rsi"), scheduleId: newSchedId, catalogItemId: item.catalogItemId ?? null,
            resourceId: (item as any).resourceId ?? null,
            code: item.code, name: item.name, unit: item.unit,
            rates: remappedRates, costRates: remappedCostRates,
            burden: item.burden, perDiem: item.perDiem, metadata: item.metadata as any, sortOrder: item.sortOrder,
          },
        });
      }

      const result = await tx.rateSchedule.findFirst({
        where: { id: newSchedId },
        include: { tiers: { orderBy: { sortOrder: "asc" } }, items: { orderBy: { sortOrder: "asc" } } },
      });
      return mapRateScheduleWithChildren(result);
    });
  }

  async listRevisionRateSchedules(projectId: string): Promise<RateScheduleWithChildren[]> {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return [];
    const schedules = await this.db.rateSchedule.findMany({
      where: { revisionId: revision.id },
      include: { tiers: { orderBy: { sortOrder: "asc" } }, items: { orderBy: { sortOrder: "asc" } } },
      orderBy: { name: "asc" },
    });
    return schedules.map(mapRateScheduleWithChildren);
  }

  async listRateBookAssignments(filters: {
    customerId?: string | null;
    projectId?: string | null;
    category?: string | null;
    active?: boolean;
  } = {}) {
    const where: any = { organizationId: this.organizationId };
    if (filters.customerId !== undefined) where.customerId = filters.customerId;
    if (filters.projectId !== undefined) where.projectId = filters.projectId;
    if (filters.category) where.category = filters.category;
    if (filters.active !== undefined) where.active = filters.active;
    const rows = await (this.db as any).rateBookAssignment.findMany({
      where,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    });
    return rows.map(mapRateBookAssignment);
  }

  async createRateBookAssignment(input: {
    rateScheduleId: string;
    customerId?: string | null;
    projectId?: string | null;
    category?: string | null;
    priority?: number;
    active?: boolean;
    effectiveDate?: string | null;
    expiryDate?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const schedule = await this.db.rateSchedule.findFirst({
      where: { id: input.rateScheduleId, organizationId: this.organizationId },
      select: { id: true },
    });
    if (!schedule) throw new Error(`Rate schedule ${input.rateScheduleId} not found`);
    if (input.customerId) {
      const customer = await this.db.customer.findFirst({
        where: { id: input.customerId, organizationId: this.organizationId },
        select: { id: true },
      });
      if (!customer) throw new Error(`Customer ${input.customerId} not found`);
    }
    if (input.projectId) {
      await this.requireProject(input.projectId);
    }
    const created = await (this.db as any).rateBookAssignment.create({
      data: {
        id: createId("rba"),
        organizationId: this.organizationId,
        rateScheduleId: input.rateScheduleId,
        customerId: input.customerId ?? null,
        projectId: input.projectId ?? null,
        category: input.category ?? "",
        priority: input.priority ?? 0,
        active: input.active ?? true,
        effectiveDate: input.effectiveDate ?? null,
        expiryDate: input.expiryDate ?? null,
        metadata: input.metadata ?? {},
      },
    });
    return mapRateBookAssignment(created);
  }

  async updateRateBookAssignment(id: string, patch: Record<string, unknown>) {
    const existing = await (this.db as any).rateBookAssignment.findFirst({
      where: { id, organizationId: this.organizationId },
    });
    if (!existing) throw new Error(`Rate book assignment ${id} not found`);
    const data: any = {};
    if (patch.rateScheduleId !== undefined) {
      const scheduleId = String(patch.rateScheduleId || "");
      const schedule = await this.db.rateSchedule.findFirst({
        where: { id: scheduleId, organizationId: this.organizationId },
        select: { id: true },
      });
      if (!schedule) throw new Error(`Rate schedule ${scheduleId} not found`);
      data.rateScheduleId = scheduleId;
    }
    if (patch.customerId !== undefined) data.customerId = patch.customerId || null;
    if (patch.projectId !== undefined) data.projectId = patch.projectId || null;
    if (patch.category !== undefined) data.category = String(patch.category ?? "");
    if (patch.priority !== undefined) data.priority = Number(patch.priority) || 0;
    if (patch.active !== undefined) data.active = Boolean(patch.active);
    if (patch.effectiveDate !== undefined) data.effectiveDate = patch.effectiveDate || null;
    if (patch.expiryDate !== undefined) data.expiryDate = patch.expiryDate || null;
    if (patch.metadata !== undefined) data.metadata = patch.metadata as any;
    const updated = await (this.db as any).rateBookAssignment.update({ where: { id }, data });
    return mapRateBookAssignment(updated);
  }

  async deleteRateBookAssignment(id: string) {
    const existing = await (this.db as any).rateBookAssignment.findFirst({
      where: { id, organizationId: this.organizationId },
    });
    if (!existing) throw new Error(`Rate book assignment ${id} not found`);
    await (this.db as any).rateBookAssignment.delete({ where: { id } });
    return { deleted: true };
  }

  async importAssignedRateSchedulesToRevision(projectId: string): Promise<RateScheduleWithChildren[]> {
    await this.requireProject(projectId);
    const { quote } = await this.findCurrentRevision(projectId);
    const customerId = quote?.customerId ?? null;
    const rows = await (this.db as any).rateBookAssignment.findMany({
      where: {
        organizationId: this.organizationId,
        active: true,
        OR: [
          { projectId },
          ...(customerId ? [{ customerId }] : []),
          { projectId: null, customerId: null },
        ],
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    const imported: RateScheduleWithChildren[] = [];
    const seen = new Set<string>();
    for (const assignment of rows) {
      if (seen.has(assignment.rateScheduleId)) continue;
      seen.add(assignment.rateScheduleId);
      const importedSchedule = await this.importRateScheduleToRevision(projectId, assignment.rateScheduleId);
      imported.push(importedSchedule);
    }
    return imported;
  }

  async autoCalculateRateSchedule(id: string): Promise<RateScheduleWithChildren> {
    const schedule = await this.db.rateSchedule.findFirst({
      where: { id, organizationId: this.organizationId },
      include: { tiers: { orderBy: { sortOrder: "asc" } }, items: true },
    });
    if (!schedule) throw new Error(`Rate schedule ${id} not found`);
    if (schedule.tiers.length === 0) return mapRateScheduleWithChildren(schedule);

    const baseTier = schedule.tiers[0];
    for (const item of schedule.items) {
      const rates = (item.rates as Record<string, number>) ?? {};
      const costRates = (item.costRates as Record<string, number>) ?? {};
      const baseRate = rates[baseTier.id] ?? 0;
      const baseCost = costRates[baseTier.id] ?? 0;
      const newRates: Record<string, number> = {};
      const newCostRates: Record<string, number> = {};
      for (const tier of schedule.tiers) {
        newRates[tier.id] = Math.round(baseRate * tier.multiplier * 100) / 100;
        newCostRates[tier.id] = Math.round(baseCost * tier.multiplier * 100) / 100;
      }
      await this.db.rateScheduleItem.update({
        where: { id: item.id },
        data: schedule.scope === "revision" ? { rates: newRates } : { rates: newRates, costRates: newCostRates },
      });
    }

    if (schedule.scope === "revision" && schedule.projectId) {
      await this.syncProjectEstimate(schedule.projectId);
    }
    return this.getRateSchedule(id);
  }

  // ── Revision Management ────────────────────────────────────────────────

  async createRevision(projectId: string, quoteId: string) {
    await this.requireProject(projectId);
    const quote = await this.db.quote.findFirst({ where: { id: quoteId, projectId } });
    if (!quote) throw new Error(`Quote ${quoteId} not found for project ${projectId}`);

    const currentRevision = await this.db.quoteRevision.findFirst({ where: { id: quote.currentRevisionId } });
    if (!currentRevision) throw new Error(`Current revision not found for quote ${quoteId}`);

    return await this.db.$transaction(async (tx) => {
      const maxRev = await tx.quoteRevision.aggregate({
        where: { quoteId },
        _max: { revisionNumber: true },
      });
      const newRevisionId = createId("revision");
      const timestamp = new Date();

      // Copy revision
      const revData = mapRevision(currentRevision);
      await tx.quoteRevision.create({
        data: {
          id: newRevisionId,
          quoteId,
          revisionNumber: (maxRev._max.revisionNumber ?? 0) + 1,
          title: revData.title,
          description: revData.description,
          notes: revData.notes,
          breakoutStyle: revData.breakoutStyle,
          type: revData.type,
          scratchpad: revData.scratchpad,
          leadLetter: revData.leadLetter,
          dateEstimatedShip: revData.dateEstimatedShip,
          dateQuote: revData.dateQuote,
          dateDue: revData.dateDue,
          dateWalkdown: revData.dateWalkdown,
          dateWorkStart: revData.dateWorkStart,
          dateWorkEnd: revData.dateWorkEnd,
          shippingMethod: revData.shippingMethod,
          shippingTerms: revData.shippingTerms,
          freightOnBoard: revData.freightOnBoard,
          status: revData.status,
          defaultMarkup: revData.defaultMarkup,
          laborDifficulty: revData.laborDifficulty,
          followUpNote: revData.followUpNote,
          printEmptyNotesColumn: revData.printEmptyNotesColumn,
          printCategory: revData.printCategory,
          printPhaseTotalOnly: revData.printPhaseTotalOnly,
          grandTotal: revData.grandTotal,
          regHours: revData.regHours,
          overHours: revData.overHours,
          doubleHours: revData.doubleHours,
          subtotal: revData.subtotal,
          cost: revData.cost,
          estimatedProfit: revData.estimatedProfit,
          estimatedMargin: revData.estimatedMargin,
          calculatedTotal: revData.calculatedTotal ?? 0,
          totalHours: revData.totalHours,
          breakoutPackage: revData.breakoutPackage as any,
          calculatedCategoryTotals: revData.calculatedCategoryTotals as any,
          pricingLadder: revData.pricingLadder as any,
          summaryLayoutPreset: revData.summaryLayoutPreset,
          pdfPreferences: revData.pdfPreferences as any,
          createdAt: timestamp,
          updatedAt: timestamp,
        } as any,
      });

      // Copy phases with ID mapping
      const phaseIdMap = new Map<string, string>();
      const oldPhases = await tx.phase.findMany({ where: { revisionId: currentRevision.id } });
      for (const oldPhase of oldPhases) {
        phaseIdMap.set(oldPhase.id, createId("phase"));
      }
      for (const oldPhase of oldPhases) {
        const newPhaseId = phaseIdMap.get(oldPhase.id)!;
        await tx.phase.create({
          data: {
            id: newPhaseId,
            revisionId: newRevisionId,
            parentId: oldPhase.parentId ? (phaseIdMap.get(oldPhase.parentId) ?? null) : null,
            number: oldPhase.number,
            name: oldPhase.name,
            description: oldPhase.description,
            order: oldPhase.order,
            startDate: oldPhase.startDate,
            endDate: oldPhase.endDate,
            color: oldPhase.color,
          },
        });
      }

      // Copy worksheets and items
      const worksheetIdMap = new Map<string, string>();
      const worksheetItemIdMap = new Map<string, string>();
      const oldWorksheets = await tx.worksheet.findMany({ where: { revisionId: currentRevision.id } });
      for (const oldWs of oldWorksheets) {
        const newWsId = createId("worksheet");
        worksheetIdMap.set(oldWs.id, newWsId);
        await tx.worksheet.create({ data: { id: newWsId, revisionId: newRevisionId, name: oldWs.name, order: oldWs.order } });

        const oldItems = await tx.worksheetItem.findMany({ where: { worksheetId: oldWs.id } });
        for (const oldItem of oldItems) {
          const newItemId = createId("li");
          worksheetItemIdMap.set(oldItem.id, newItemId);
          await tx.worksheetItem.create({
            data: {
              id: newItemId,
              worksheetId: newWsId,
              phaseId: oldItem.phaseId ? (phaseIdMap.get(oldItem.phaseId) ?? null) : oldItem.phaseId,
	              categoryId: oldItem.categoryId,
	              category: oldItem.category, entityType: oldItem.entityType, entityName: oldItem.entityName,
              classification: oldItem.classification ?? {},
              costCode: oldItem.costCode ?? null,
              vendor: oldItem.vendor, description: oldItem.description, quantity: oldItem.quantity,
              uom: oldItem.uom, cost: oldItem.cost, markup: oldItem.markup, price: oldItem.price,
              lineOrder: oldItem.lineOrder,
              rateScheduleItemId: oldItem.rateScheduleItemId ?? null,
              itemId: oldItem.itemId ?? null,
              tierUnits: oldItem.tierUnits ?? {},
              rateResolution: toPrismaJson((oldItem as any).rateResolution ?? {}),
              sourceNotes: oldItem.sourceNotes ?? "",
              costResourceId: (oldItem as any).costResourceId ?? null,
              effectiveCostId: (oldItem as any).effectiveCostId ?? null,
              laborUnitId: (oldItem as any).laborUnitId ?? null,
              resourceComposition: toPrismaJson((oldItem as any).resourceComposition ?? {}),
              sourceEvidence: toPrismaJson((oldItem as any).sourceEvidence ?? {}),
            } as any,
          });
        }
      }

      // Copy canonical adjustments
      const adjustmentIdMap = new Map<string, string>();
      const oldAdjustments = await tx.adjustment.findMany({
        where: { revisionId: currentRevision.id },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      });
      for (const adjustment of oldAdjustments) {
        const newAdjustmentId = createId("adj");
        adjustmentIdMap.set(adjustment.id, newAdjustmentId);
        await tx.adjustment.create({
          data: {
            id: newAdjustmentId,
            revisionId: newRevisionId,
            order: adjustment.order,
            kind: adjustment.kind,
            pricingMode: adjustment.pricingMode,
            name: adjustment.name,
            description: adjustment.description,
            type: adjustment.type,
            financialCategory: adjustment.financialCategory,
            calculationBase: adjustment.calculationBase,
            active: adjustment.active,
            appliesTo: adjustment.appliesTo,
            percentage: adjustment.percentage,
            amount: adjustment.amount,
            show: adjustment.show,
          },
        });
      }

      // Copy estimate productivity factors with phase/worksheet scope remapping
      const oldFactors = await tx.estimateFactor.findMany({
        where: { revisionId: currentRevision.id },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      });
      for (const factor of oldFactors) {
        await tx.estimateFactor.create({
          data: {
            id: createId("factor"),
            revisionId: newRevisionId,
            order: factor.order,
            name: factor.name,
            code: factor.code,
            description: factor.description,
            category: factor.category,
            impact: factor.impact,
            value: factor.value,
            active: factor.active,
            appliesTo: factor.appliesTo,
            applicationScope: (factor as any).applicationScope ?? "global",
            scope: remapEstimateFactorScope(factor.scope, phaseIdMap, worksheetIdMap, worksheetItemIdMap) as any,
            formulaType: (factor as any).formulaType ?? "fixed_multiplier",
            parameters: ((factor as any).parameters ?? {}) as any,
            confidence: factor.confidence,
            sourceType: factor.sourceType,
            sourceId: factor.sourceId,
            sourceRef: (factor.sourceRef ?? {}) as any,
            tags: factor.tags,
          },
        });
      }

      // Copy presentation-only summary rows with stable source remapping
      const oldSummaryRows = await tx.summaryRow.findMany({
        where: { revisionId: currentRevision.id },
        orderBy: { order: "asc" },
      });
      for (const sourceRow of oldSummaryRows.map(mapSummaryRow)) {
        await tx.summaryRow.create({
          data: {
            id: createId("sr"),
            revisionId: newRevisionId,
            type: sourceRow.type,
            label: sourceRow.label,
            order: sourceRow.order,
            visible: sourceRow.visible,
            style: sourceRow.style,
            sourceCategory: sourceRow.sourceCategoryLabel ?? null,
            sourcePhase: null,
            sourceCategoryId: sourceRow.sourceCategoryId ?? null,
            sourceCategoryLabel: sourceRow.sourceCategoryLabel ?? null,
            sourcePhaseId: sourceRow.sourcePhaseId ? (phaseIdMap.get(sourceRow.sourcePhaseId) ?? null) : null,
            sourceWorksheetId: sourceRow.sourceWorksheetId ? (worksheetIdMap.get(sourceRow.sourceWorksheetId) ?? null) : null,
            sourceWorksheetLabel: sourceRow.sourceWorksheetLabel ?? null,
            sourceClassificationId: sourceRow.sourceClassificationId ?? null,
            sourceClassificationLabel: sourceRow.sourceClassificationLabel ?? null,
            sourceAdjustmentId: sourceRow.sourceAdjustmentId ? (adjustmentIdMap.get(sourceRow.sourceAdjustmentId) ?? null) : null,
          },
        });
      }

      // Copy conditions
      const oldConditions = await tx.condition.findMany({ where: { revisionId: currentRevision.id } });
      for (const c of oldConditions) {
        await tx.condition.create({ data: { id: createId("cond"), revisionId: newRevisionId, type: c.type, value: c.value, order: c.order } });
      }

      // Copy rate schedules (deep copy with tier ID remapping)
      const oldSchedules = await tx.rateSchedule.findMany({
        where: { revisionId: currentRevision.id },
        include: { tiers: true, items: true },
      });
      for (const sched of oldSchedules) {
        const newSchedId = createId("rs");
        const tierIdMap = new Map<string, string>();
        await tx.rateSchedule.create({
          data: {
            id: newSchedId, organizationId: sched.organizationId, name: sched.name, description: sched.description,
            category: sched.category, scope: "revision", projectId: sched.projectId,
            revisionId: newRevisionId, sourceScheduleId: sched.sourceScheduleId,
            effectiveDate: sched.effectiveDate, expiryDate: sched.expiryDate,
            defaultMarkup: sched.defaultMarkup, autoCalculate: sched.autoCalculate,
            metadata: sched.metadata as any,
          },
        });
        for (const tier of sched.tiers) {
          const newTierId = createId("rst");
          tierIdMap.set(tier.id, newTierId);
          await tx.rateScheduleTier.create({
            data: { id: newTierId, scheduleId: newSchedId, name: tier.name, multiplier: tier.multiplier, sortOrder: tier.sortOrder, uom: (tier as any).uom ?? null },
          });
        }
        for (const item of sched.items) {
          const remappedRates: Record<string, number> = {};
          const remappedCostRates: Record<string, number> = {};
          for (const [oldTierId, val] of Object.entries((item.rates as Record<string, number>) ?? {})) {
            const newTierId = tierIdMap.get(oldTierId) ?? oldTierId;
            remappedRates[newTierId] = val;
          }
          for (const [oldTierId, val] of Object.entries((item.costRates as Record<string, number>) ?? {})) {
            const newTierId = tierIdMap.get(oldTierId) ?? oldTierId;
            remappedCostRates[newTierId] = val;
          }
          await (tx as any).rateScheduleItem.create({
            data: {
              id: createId("rsi"), scheduleId: newSchedId, catalogItemId: item.catalogItemId ?? null,
              resourceId: (item as any).resourceId ?? null,
              code: item.code, name: item.name, unit: item.unit,
              rates: remappedRates, costRates: remappedCostRates,
              burden: item.burden, perDiem: item.perDiem, metadata: item.metadata as any, sortOrder: item.sortOrder,
            },
          });
        }
      }

      // Copy report sections with ID mapping
      const sectionIdMap = new Map<string, string>();
      const oldSections = await tx.reportSection.findMany({ where: { revisionId: currentRevision.id } });
      for (const s of oldSections) {
        const newSId = createId("section");
        sectionIdMap.set(s.id, newSId);
        await tx.reportSection.create({ data: { id: newSId, revisionId: newRevisionId, sectionType: s.sectionType, title: s.title, content: s.content, order: s.order, parentSectionId: s.parentSectionId } });
      }
      // Remap parent section IDs
      for (const s of oldSections) {
        if (s.parentSectionId && sectionIdMap.has(s.parentSectionId)) {
          const newSId = sectionIdMap.get(s.id)!;
          await tx.reportSection.update({ where: { id: newSId }, data: { parentSectionId: sectionIdMap.get(s.parentSectionId) } });
        }
      }

      // Switch to new revision
      await tx.quote.update({ where: { id: quoteId }, data: { currentRevisionId: newRevisionId, updatedAt: timestamp } });

      await tx.activity.create({
        data: {
          id: createId("activity"),
          projectId,
          revisionId: newRevisionId,
          type: "revision_created",
          data: { revisionNumber: (maxRev._max.revisionNumber ?? 0) + 1 } as any,
          createdAt: timestamp,
        },
      });

      const newRevision = await tx.quoteRevision.findFirst({ where: { id: newRevisionId } });
      return mapRevision(newRevision!);
    });
  }

  async deleteRevision(projectId: string, revisionId: string) {
    await this.requireProject(projectId);
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
    if (!revision) throw new Error(`Revision ${revisionId} not found for project ${projectId}`);

    if (revision.revisionNumber === 0) {
      throw new Error("Cannot delete the initial revision (revision 0)");
    }

    const quote = await this.db.quote.findFirst({ where: { id: revision.quoteId } });

    return await this.db.$transaction(async (tx) => {
      if (quote && quote.currentRevisionId === revisionId) {
        const otherRevisions = await tx.quoteRevision.findMany({
          where: { quoteId: revision.quoteId, id: { not: revisionId } },
          orderBy: { revisionNumber: "desc" },
          take: 1,
        });
        if (otherRevisions.length > 0) {
          await tx.quote.update({ where: { id: quote.id }, data: { currentRevisionId: otherRevisions[0].id, updatedAt: new Date() } });
        }
      }

      // Cascade handled by Prisma, but be explicit for worksheetItems
      const worksheetIds = (await tx.worksheet.findMany({ where: { revisionId }, select: { id: true } })).map((w) => w.id);
      await tx.worksheetItem.deleteMany({ where: { worksheetId: { in: worksheetIds } } });
      await tx.worksheet.deleteMany({ where: { revisionId } });
      await tx.phase.deleteMany({ where: { revisionId } });
      await tx.estimateFactor.deleteMany({ where: { revisionId } });
      await tx.adjustment.deleteMany({ where: { revisionId } });
      await tx.summaryRow.deleteMany({ where: { revisionId } });
      await tx.modifier.deleteMany({ where: { revisionId } });
      await tx.additionalLineItem.deleteMany({ where: { revisionId } });
      await tx.condition.deleteMany({ where: { revisionId } });
      await tx.reportSection.deleteMany({ where: { revisionId } });
      await tx.quoteRevision.delete({ where: { id: revisionId } });

      await tx.activity.create({
        data: {
          id: createId("activity"),
          projectId,
          type: "revision_deleted",
          data: { revisionId, revisionNumber: revision.revisionNumber } as any,
          createdAt: new Date(),
        },
      });

      return mapRevision(revision);
    });
  }

  async switchRevision(projectId: string, revisionId: string) {
    await this.requireProject(projectId);
    const quote = await this.db.quote.findFirst({ where: { projectId } });
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });

    if (!quote || !revision || revision.quoteId !== quote.id) {
      throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
    }

    await this.db.quote.update({ where: { id: quote.id }, data: { currentRevisionId: revisionId, updatedAt: new Date() } });
    await this.syncProjectEstimate(projectId);
    return mapRevision(revision);
  }

  async copyQuote(projectId: string) {
    await this.requireProject(projectId);
    const sourceProject = await this.db.project.findFirst({ where: { id: projectId, organizationId: this.organizationId } });
    const sourceQuote = await this.db.quote.findFirst({ where: { projectId } });
    if (!sourceProject || !sourceQuote) throw new Error(`Project ${projectId} not found or has no quote`);

    const sourceRevision = await this.db.quoteRevision.findFirst({ where: { id: sourceQuote.currentRevisionId } });
    if (!sourceRevision) throw new Error(`Current revision not found for project ${projectId}`);

    return await this.db.$transaction(async (tx) => {
      const timestamp = new Date();
      const newProjectId = createId("project");
      const newQuoteId = createId("quote");
      const newRevisionId = createId("revision");

      // Copy project
      await tx.project.create({
        data: {
          id: newProjectId,
          organizationId: this.organizationId,
          name: `${sourceProject.name} (Copy)`,
          clientName: sourceProject.clientName,
          location: sourceProject.location,
          packageName: sourceProject.packageName,
          packageUploadedAt: sourceProject.packageUploadedAt,
          ingestionStatus: sourceProject.ingestionStatus,
          summary: sourceProject.summary,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });

      // Copy quote
      await tx.quote.create({
        data: {
          id: newQuoteId,
          projectId: newProjectId,
          quoteNumber: makeQuoteNumber(),
          title: sourceQuote.title,
          status: sourceQuote.status,
          currentRevisionId: newRevisionId,
          customerExistingNew: sourceQuote.customerExistingNew,
          customerId: sourceQuote.customerId,
          customerString: sourceQuote.customerString,
          customerContactId: sourceQuote.customerContactId,
          customerContactString: sourceQuote.customerContactString,
          customerContactEmailString: sourceQuote.customerContactEmailString,
          departmentId: sourceQuote.departmentId,
          userId: sourceQuote.userId,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });

      // Copy revision
      const revData = mapRevision(sourceRevision);
      await tx.quoteRevision.create({
        data: {
          id: newRevisionId,
          quoteId: newQuoteId,
          revisionNumber: 0,
          title: revData.title, description: revData.description, notes: revData.notes,
          breakoutStyle: revData.breakoutStyle, type: revData.type,
          scratchpad: revData.scratchpad, leadLetter: revData.leadLetter,
          dateEstimatedShip: revData.dateEstimatedShip, dateQuote: revData.dateQuote,
          dateDue: revData.dateDue, dateWalkdown: revData.dateWalkdown,
          dateWorkStart: revData.dateWorkStart, dateWorkEnd: revData.dateWorkEnd,
          shippingMethod: revData.shippingMethod, shippingTerms: revData.shippingTerms,
          freightOnBoard: revData.freightOnBoard, status: revData.status,
          defaultMarkup: revData.defaultMarkup, laborDifficulty: revData.laborDifficulty,
          followUpNote: revData.followUpNote, printEmptyNotesColumn: revData.printEmptyNotesColumn,
          printCategory: revData.printCategory, printPhaseTotalOnly: revData.printPhaseTotalOnly,
          grandTotal: revData.grandTotal, regHours: revData.regHours, overHours: revData.overHours, doubleHours: revData.doubleHours,
          subtotal: revData.subtotal, cost: revData.cost, estimatedProfit: revData.estimatedProfit, estimatedMargin: revData.estimatedMargin,
          calculatedTotal: revData.calculatedTotal ?? 0, totalHours: revData.totalHours,
          breakoutPackage: revData.breakoutPackage as any,
          calculatedCategoryTotals: revData.calculatedCategoryTotals as any,
          pricingLadder: revData.pricingLadder as any,
          summaryLayoutPreset: revData.summaryLayoutPreset,
          pdfPreferences: revData.pdfPreferences as any,
          createdAt: timestamp, updatedAt: timestamp,
        },
      });

      // Build phase ID map
      const phaseIdMap = new Map<string, string>();
      const oldPhases = await tx.phase.findMany({ where: { revisionId: sourceRevision.id } });
      for (const p of oldPhases) {
        phaseIdMap.set(p.id, createId("phase"));
      }
      for (const p of oldPhases) {
        const newId = phaseIdMap.get(p.id)!;
        await tx.phase.create({
          data: {
            id: newId,
            revisionId: newRevisionId,
            parentId: p.parentId ? (phaseIdMap.get(p.parentId) ?? null) : null,
            number: p.number,
            name: p.name,
            description: p.description,
            order: p.order,
            startDate: p.startDate,
            endDate: p.endDate,
            color: p.color,
          },
        });
      }

      // Copy worksheets and items
      let firstWorksheetId: string | null = null;
      const worksheetIdMap = new Map<string, string>();
      const worksheetItemIdMap = new Map<string, string>();
      const oldWorksheets = await tx.worksheet.findMany({ where: { revisionId: sourceRevision.id } });
      for (const ws of oldWorksheets) {
        const newWsId = createId("worksheet");
        worksheetIdMap.set(ws.id, newWsId);
        if (!firstWorksheetId) firstWorksheetId = newWsId;
        await tx.worksheet.create({ data: { id: newWsId, revisionId: newRevisionId, name: ws.name, order: ws.order } });
        const oldItems = await tx.worksheetItem.findMany({ where: { worksheetId: ws.id } });
        for (const it of oldItems) {
          const newItemId = createId("li");
          worksheetItemIdMap.set(it.id, newItemId);
          await tx.worksheetItem.create({
            data: {
              id: newItemId, worksheetId: newWsId,
              phaseId: it.phaseId ? (phaseIdMap.get(it.phaseId) ?? null) : it.phaseId,
	              categoryId: it.categoryId,
	              category: it.category, entityType: it.entityType, entityName: it.entityName,
              classification: it.classification ?? {},
              costCode: it.costCode ?? null,
              vendor: it.vendor, description: it.description, quantity: it.quantity,
              uom: it.uom, cost: it.cost, markup: it.markup, price: it.price,
              lineOrder: it.lineOrder,
              rateScheduleItemId: it.rateScheduleItemId ?? null,
              itemId: it.itemId ?? null,
              tierUnits: it.tierUnits ?? {},
              rateResolution: toPrismaJson((it as any).rateResolution ?? {}),
              sourceNotes: it.sourceNotes ?? "",
              costResourceId: (it as any).costResourceId ?? null,
              effectiveCostId: (it as any).effectiveCostId ?? null,
              laborUnitId: (it as any).laborUnitId ?? null,
              resourceComposition: toPrismaJson((it as any).resourceComposition ?? {}),
              sourceEvidence: toPrismaJson((it as any).sourceEvidence ?? {}),
            } as any,
          });
        }
      }

      // Copy canonical adjustments
      const adjustmentIdMap = new Map<string, string>();
      for (const adjustment of await tx.adjustment.findMany({
        where: { revisionId: sourceRevision.id },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      })) {
        const newAdjustmentId = createId("adj");
        adjustmentIdMap.set(adjustment.id, newAdjustmentId);
        await tx.adjustment.create({
          data: {
            id: newAdjustmentId,
            revisionId: newRevisionId,
            order: adjustment.order,
            kind: adjustment.kind,
            pricingMode: adjustment.pricingMode,
            name: adjustment.name,
            description: adjustment.description,
            type: adjustment.type,
            financialCategory: adjustment.financialCategory,
            calculationBase: adjustment.calculationBase,
            active: adjustment.active,
            appliesTo: adjustment.appliesTo,
            percentage: adjustment.percentage,
            amount: adjustment.amount,
            show: adjustment.show,
          },
        });
      }

      // Copy estimate productivity factors with phase/worksheet scope remapping
      for (const factor of await tx.estimateFactor.findMany({
        where: { revisionId: sourceRevision.id },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      })) {
        await tx.estimateFactor.create({
          data: {
            id: createId("factor"),
            revisionId: newRevisionId,
            order: factor.order,
            name: factor.name,
            code: factor.code,
            description: factor.description,
            category: factor.category,
            impact: factor.impact,
            value: factor.value,
            active: factor.active,
            appliesTo: factor.appliesTo,
            applicationScope: (factor as any).applicationScope ?? "global",
            scope: remapEstimateFactorScope(factor.scope, phaseIdMap, worksheetIdMap, worksheetItemIdMap) as any,
            formulaType: (factor as any).formulaType ?? "fixed_multiplier",
            parameters: ((factor as any).parameters ?? {}) as any,
            confidence: factor.confidence,
            sourceType: factor.sourceType,
            sourceId: factor.sourceId,
            sourceRef: (factor.sourceRef ?? {}) as any,
            tags: factor.tags,
          },
        });
      }

      // Copy presentation-only summary rows with stable source remapping
      for (const sourceRow of (await tx.summaryRow.findMany({
        where: { revisionId: sourceRevision.id },
        orderBy: { order: "asc" },
      })).map(mapSummaryRow)) {
        await tx.summaryRow.create({
          data: {
            id: createId("sr"),
            revisionId: newRevisionId,
            type: sourceRow.type,
            label: sourceRow.label,
            order: sourceRow.order,
            visible: sourceRow.visible,
            style: sourceRow.style,
            sourceCategory: sourceRow.sourceCategoryLabel ?? null,
            sourcePhase: null,
            sourceCategoryId: sourceRow.sourceCategoryId ?? null,
            sourceCategoryLabel: sourceRow.sourceCategoryLabel ?? null,
            sourcePhaseId: sourceRow.sourcePhaseId ? (phaseIdMap.get(sourceRow.sourcePhaseId) ?? null) : null,
            sourceWorksheetId: sourceRow.sourceWorksheetId ? (worksheetIdMap.get(sourceRow.sourceWorksheetId) ?? null) : null,
            sourceWorksheetLabel: sourceRow.sourceWorksheetLabel ?? null,
            sourceClassificationId: sourceRow.sourceClassificationId ?? null,
            sourceClassificationLabel: sourceRow.sourceClassificationLabel ?? null,
            sourceAdjustmentId: sourceRow.sourceAdjustmentId ? (adjustmentIdMap.get(sourceRow.sourceAdjustmentId) ?? null) : null,
          },
        });
      }

      for (const c of await tx.condition.findMany({ where: { revisionId: sourceRevision.id } })) {
        await tx.condition.create({ data: { id: createId("cond"), revisionId: newRevisionId, type: c.type, value: c.value, order: c.order } });
      }
      const sectionIdMap = new Map<string, string>();
      for (const s of await tx.reportSection.findMany({ where: { revisionId: sourceRevision.id } })) {
        const newSId = createId("section");
        sectionIdMap.set(s.id, newSId);
        await tx.reportSection.create({ data: { id: newSId, revisionId: newRevisionId, sectionType: s.sectionType, title: s.title, content: s.content, order: s.order, parentSectionId: s.parentSectionId } });
      }
      for (const [oldId, newId] of sectionIdMap) {
        const oldSection = await tx.reportSection.findFirst({ where: { id: newId } });
        if (oldSection?.parentSectionId && sectionIdMap.has(oldSection.parentSectionId)) {
          await tx.reportSection.update({ where: { id: newId }, data: { parentSectionId: sectionIdMap.get(oldSection.parentSectionId) } });
        }
      }

      // Copy source documents
      const oldDocs = await tx.sourceDocument.findMany({ where: { projectId } });
      for (const doc of oldDocs) {
        await tx.sourceDocument.create({
          data: {
            id: createId("doc"), projectId: newProjectId, fileName: doc.fileName, fileType: doc.fileType,
            documentType: doc.documentType, pageCount: doc.pageCount, checksum: doc.checksum,
            storagePath: doc.storagePath, extractedText: doc.extractedText, createdAt: timestamp, updatedAt: timestamp,
          },
        });
      }

      // Seed workspace state
      await tx.workspaceState.create({
        data: {
          projectId: newProjectId,
          state: {
            activeTab: "overview",
            selectedQuoteId: newQuoteId,
            selectedRevisionId: newRevisionId,
            selectedWorksheetId: firstWorksheetId,
            selectedDocumentId: null,
            openDocumentIds: [],
            filters: { documentKinds: [], search: "" },
            panels: { documents: true, estimate: true, ai: true },
          } as any,
          updatedAt: timestamp,
        },
      });

      const newProject = await tx.project.findFirst({ where: { id: newProjectId } });
      const newQuote = await tx.quote.findFirst({ where: { id: newQuoteId } });
      const newRevision = await tx.quoteRevision.findFirst({ where: { id: newRevisionId } });

      return {
        project: mapProject(newProject!),
        quote: mapQuote(newQuote!),
        revision: mapRevision(newRevision!),
      };
    });
  }

  async updateQuote(projectId: string, patch: QuotePatchInput) {
    await this.requireProject(projectId);
    await this.validateQuotePatchReferences(patch);
    const quote = await this.db.quote.findFirst({ where: { projectId } });
    if (!quote) throw new Error(`Quote not found for project ${projectId}`);
    if (patch.customerContactId && !patch.customerId && quote.customerId) {
      const contact = await this.db.customerContact.findFirst({
        where: { id: patch.customerContactId, customerId: quote.customerId },
        select: { id: true },
      });
      if (!contact) {
        throw new Error(`Customer contact ${patch.customerContactId} does not belong to customer ${quote.customerId}`);
      }
    }

    const before = {
      id: quote.id,
      title: quote.title,
      customerString: quote.customerString,
      userId: quote.userId,
      quoteNumber: quote.quoteNumber,
      currentRevisionId: quote.currentRevisionId,
    };
    const updated = await this.db.quote.update({
      where: { id: quote.id },
      data: { ...patch as any, updatedAt: new Date() },
    });

    await this.pushActivity(projectId, updated.currentRevisionId ?? null, "quote_updated", {
      fields: Object.keys(patch),
      before,
      after: {
        id: updated.id,
        title: updated.title,
        customerString: updated.customerString,
        userId: updated.userId,
        quoteNumber: updated.quoteNumber,
        currentRevisionId: updated.currentRevisionId,
      },
    });

    return mapQuote(updated);
  }

  async makeCurrentRevisionZero(projectId: string) {
    await this.requireProject(projectId);
    const quote = await this.db.quote.findFirst({ where: { projectId } });
    if (!quote) throw new Error(`Project ${projectId} not found or has no quote`);

    const currentRevision = await this.db.quoteRevision.findFirst({ where: { id: quote.currentRevisionId } });
    if (!currentRevision) throw new Error(`Current revision not found for project ${projectId}`);

    return await this.db.$transaction(async (tx) => {
      const timestamp = new Date();

      // Delete all other revisions and their data
      const otherRevisions = await tx.quoteRevision.findMany({
        where: { quoteId: quote.id, id: { not: currentRevision.id } },
      });
      const otherRevisionIds = otherRevisions.map((r) => r.id);

      if (otherRevisionIds.length > 0) {
        const otherWsIds = (await tx.worksheet.findMany({ where: { revisionId: { in: otherRevisionIds } }, select: { id: true } })).map((w) => w.id);
        await tx.worksheetItem.deleteMany({ where: { worksheetId: { in: otherWsIds } } });
        await tx.worksheet.deleteMany({ where: { revisionId: { in: otherRevisionIds } } });
        await tx.phase.deleteMany({ where: { revisionId: { in: otherRevisionIds } } });
        await tx.estimateFactor.deleteMany({ where: { revisionId: { in: otherRevisionIds } } });
        await tx.adjustment.deleteMany({ where: { revisionId: { in: otherRevisionIds } } });
        await tx.summaryRow.deleteMany({ where: { revisionId: { in: otherRevisionIds } } });
        await tx.modifier.deleteMany({ where: { revisionId: { in: otherRevisionIds } } });
        await tx.additionalLineItem.deleteMany({ where: { revisionId: { in: otherRevisionIds } } });
        await tx.condition.deleteMany({ where: { revisionId: { in: otherRevisionIds } } });
        await tx.reportSection.deleteMany({ where: { revisionId: { in: otherRevisionIds } } });
        await tx.quoteRevision.deleteMany({ where: { id: { in: otherRevisionIds } } });
      }

      const updated = await tx.quoteRevision.update({
        where: { id: currentRevision.id },
        data: { revisionNumber: 0, updatedAt: timestamp },
      });

      await tx.quote.update({ where: { id: quote.id }, data: { updatedAt: timestamp } });

      return mapRevision(updated);
    });
  }

  // ── Activity ───────────────────────────────────────────────────────────

  private mapSyntheticActivityFromAiToolEvent(
    projectId: string,
    run: { id: string; revisionId: string | null; createdAt: Date; output: Prisma.JsonValue },
    event: any,
    index: number,
  ) {
    const toolIdRaw = String(event?.data?.toolId ?? "");
    const toolId = toolIdRaw.replace(/^mcp__bidwright__/, "");
    const input = ((event?.data?.input as Record<string, unknown>) ?? {});
    const createdAt = typeof event?.timestamp === "string" ? event.timestamp : run.createdAt.toISOString();
    const baseData: Record<string, unknown> = {
      aiRunId: run.id,
      actorId: run.id,
      actorName: "Bidwright AI",
      actorType: "ai",
      source: "ai_run_event",
      toolId: toolIdRaw,
    };

    if (toolId === "updateQuote") {
      const fields = Object.keys(input);
      return {
        id: `synthetic-${run.id}-${index}`,
        projectId,
        revisionId: run.revisionId ?? null,
        type: "quote_updated",
        data: {
          ...baseData,
          fields,
          patch: fields,
          projectName: input.projectName ?? input.name ?? null,
          clientName: input.clientName ?? null,
        },
        userId: null,
        userName: "Bidwright AI",
        revertible: false,
        createdAt,
      };
    }

    if (toolId === "createWorksheet") {
      const name = String(input.name ?? "Worksheet");
      return {
        id: `synthetic-${run.id}-${index}`,
        projectId,
        revisionId: run.revisionId ?? null,
        type: "worksheet_created",
        data: {
          ...baseData,
          name,
          worksheetName: name,
          description: String(input.description ?? ""),
        },
        userId: null,
        userName: "Bidwright AI",
        revertible: false,
        createdAt,
      };
    }

    if (toolId === "createWorksheetItem") {
      return {
        id: `synthetic-${run.id}-${index}`,
        projectId,
        revisionId: run.revisionId ?? null,
        type: "item_created",
        data: {
          ...baseData,
          entityName: String(input.entityName ?? "Item"),
          category: String(input.category ?? ""),
          worksheetId: typeof input.worksheetId === "string" ? input.worksheetId : null,
          description: String(input.description ?? ""),
        },
        userId: null,
        userName: "Bidwright AI",
        revertible: false,
        createdAt,
      };
    }

    if (toolId === "updateWorksheetItem") {
      const patch = Object.keys(input).filter((key) => key !== "itemId");
      return {
        id: `synthetic-${run.id}-${index}`,
        projectId,
        revisionId: run.revisionId ?? null,
        type: "item_updated",
        data: {
          ...baseData,
          itemId: typeof input.itemId === "string" ? input.itemId : null,
          entityName: String(input.entityName ?? "Item"),
          patch,
        },
        userId: null,
        userName: "Bidwright AI",
        revertible: false,
        createdAt,
      };
    }

    if (toolId === "deleteWorksheetItem") {
      return {
        id: `synthetic-${run.id}-${index}`,
        projectId,
        revisionId: run.revisionId ?? null,
        type: "item_deleted",
        data: {
          ...baseData,
          itemId: typeof input.itemId === "string" ? input.itemId : null,
          entityName: String(input.entityName ?? "Item"),
        },
        userId: null,
        userName: "Bidwright AI",
        revertible: false,
        createdAt,
      };
    }

    return null;
  }

  private async buildSyntheticActivitiesFromAiRuns(projectId: string) {
    const runs = await this.db.aiRun.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        revisionId: true,
        createdAt: true,
        output: true,
      },
    });

    const synthetic: Array<{
      id: string;
      projectId: string;
      revisionId: string | null;
      type: string;
      data: Record<string, unknown>;
      userId: string | null;
      userName: string | null;
      revertible: boolean;
      createdAt: string;
    }> = [];

    for (const run of runs) {
      const events = (((run.output as Record<string, unknown> | null)?.events ?? []) as any[]);
      events.forEach((event, index) => {
        if (!event || (event.type !== "tool_call" && event.type !== "tool")) return;
        const activity = this.mapSyntheticActivityFromAiToolEvent(projectId, run, event, index);
        if (activity) synthetic.push(activity);
      });
    }

    synthetic.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return synthetic;
  }

  async logActivity(projectId: string, revisionId: string | null, type: string, data: Record<string, unknown>) {
    await this.requireProject(projectId);
    const payload = this.withActivityActor(data);
    const activity = await this.db.activity.create({
      data: {
        id: createId("activity"),
        projectId,
        revisionId,
        type,
        data: payload as any,
        userId: this.resolveActivityUserId(),
        createdAt: new Date(),
      },
    });
    return mapActivity(activity);
  }

  async listActivities(projectId: string) {
    await this.requireProject(projectId);
    const activities = await this.db.activity.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true } } },
    });
    if (activities.length === 0) {
      return this.buildSyntheticActivitiesFromAiRuns(projectId);
    }
    return activities.map((a) => ({
      ...mapActivity(a),
      userId: a.userId ?? ((a.data as Record<string, unknown> | null)?.actorId as string | null) ?? null,
      userName: (a as any).user?.name ?? ((a.data as Record<string, unknown> | null)?.actorName as string | null) ?? null,
      revertible: isActivityRevertible(a),
    }));
  }

  async revertActivity(projectId: string, activityId: string) {
    await this.requireProject(projectId);
    const activity = await this.db.activity.findFirst({ where: { id: activityId, projectId } });
    if (!activity) throw Object.assign(new Error("Activity not found"), { statusCode: 404 });

    const type = activity.type;
    const data = (activity.data as Record<string, unknown>) ?? {};

    if (NON_REVERTIBLE_ACTIVITY_TYPES.has(type)) {
      throw Object.assign(new Error("This action cannot be reverted"), { statusCode: 400 });
    }
    if (type.startsWith("revert:")) {
      throw Object.assign(new Error("Revert actions cannot themselves be reverted"), { statusCode: 400 });
    }
    if (!data.before && !data.after) {
      throw Object.assign(new Error("This activity does not contain snapshot data and cannot be reverted"), { statusCode: 400 });
    }

    const before = data.before as Record<string, unknown> | null;
    const after = data.after as Record<string, unknown> | null;
    const revisionId = activity.revisionId;

    let revertBefore: Record<string, unknown> | null = null;
    let revertAfter: Record<string, unknown> | null = null;

    if (type === "item_created") {
      // Revert: delete the created item
      const itemId = (after?.id ?? data.itemId) as string;
      const item = await this.db.worksheetItem.findFirst({ where: { id: itemId } });
      if (!item) throw Object.assign(new Error("Cannot revert — the item no longer exists"), { statusCode: 409 });
      revertBefore = mapWorksheetItem(item) as any;
      revertAfter = null;
      await this.db.worksheetItem.delete({ where: { id: itemId } });
    } else if (type === "item_updated") {
      const itemId = data.itemId as string;
      const item = await this.db.worksheetItem.findFirst({ where: { id: itemId } });
      if (!item) throw Object.assign(new Error("Cannot revert — the item no longer exists"), { statusCode: 409 });
      revertBefore = this.pick(item as any, Object.keys(before!));
      await this.db.worksheetItem.update({ where: { id: itemId }, data: before as any });
      revertAfter = before;
    } else if (type === "item_deleted") {
      // Revert: recreate the item from the before snapshot
      const snapshot = before!;
      const categories = await this.db.entityCategory.findMany({ where: { organizationId: this.organizationId } });
      const categoryDef = resolveEntityCategoryForItemInput(categories, {
        categoryId: typeof snapshot.categoryId === "string" ? snapshot.categoryId : null,
        category: typeof snapshot.category === "string" ? snapshot.category : null,
        entityType: typeof snapshot.entityType === "string" ? snapshot.entityType : null,
      });
      if (!categoryDef) {
        throw Object.assign(new Error("Cannot revert — the original item category no longer exists."), { statusCode: 409 });
      }
      revertBefore = null;
      const restoredSnapshot = {
        ...snapshot,
        categoryId: categoryDef.id,
        category: categoryDef.name,
        entityType: categoryDef.entityType,
      };
      await this.db.worksheetItem.create({ data: restoredSnapshot as any });
      revertAfter = restoredSnapshot;
    } else if (type === "revision_updated") {
      const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId! } });
      if (!revision) throw Object.assign(new Error("Cannot revert — the revision no longer exists"), { statusCode: 409 });
      revertBefore = this.pick(revision as any, Object.keys(before!));
      await this.db.quoteRevision.update({ where: { id: revisionId! }, data: before as any });
      revertAfter = before;
    } else if (type === "phase_created") {
      const phaseId = (after?.id ?? data.phaseId) as string;
      const phase = await this.db.phase.findFirst({ where: { id: phaseId } });
      if (!phase) throw Object.assign(new Error("Cannot revert — the phase no longer exists"), { statusCode: 409 });
      revertBefore = mapPhase(phase) as any;
      revertAfter = null;
      await this.db.$transaction([
        this.db.phase.updateMany({
          where: { revisionId: phase.revisionId, parentId: phaseId },
          data: { parentId: phase.parentId ?? null },
        }),
        this.db.worksheetItem.updateMany({ where: { phaseId }, data: { phaseId: null } }),
        this.db.phase.delete({ where: { id: phaseId } }),
      ]);
    } else if (type === "phase_updated") {
      const phaseId = data.phaseId as string;
      const phase = await this.db.phase.findFirst({ where: { id: phaseId } });
      if (!phase) throw Object.assign(new Error("Cannot revert — the phase no longer exists"), { statusCode: 409 });
      revertBefore = this.pick(phase as any, Object.keys(before!));
      await this.db.phase.update({ where: { id: phaseId }, data: before as any });
      revertAfter = before;
    } else if (type === "phase_deleted") {
      const snapshot = before!;
      revertBefore = null;
      const parentId = snapshot.parentId as string | null | undefined;
      const parent = parentId
        ? await this.db.phase.findFirst({ where: { id: parentId, revisionId: snapshot.revisionId as string } })
        : null;
      await this.db.phase.create({
        data: {
          id: snapshot.id as string,
          revisionId: snapshot.revisionId as string,
          parentId: parent ? parent.id : null,
          number: snapshot.number as string,
          name: snapshot.name as string,
          description: (snapshot.description as string) ?? "",
          order: (snapshot.order as number) ?? 0,
          startDate: (snapshot.startDate as string) ?? null,
          endDate: (snapshot.endDate as string) ?? null,
          color: (snapshot.color as string) ?? "",
        },
      });
      revertAfter = snapshot;
    } else if (type === "schedule_task_created") {
      const taskId = (after?.id ?? data.taskId) as string;
      const task = await this.db.scheduleTask.findFirst({ where: { id: taskId } });
      if (!task) throw Object.assign(new Error("Cannot revert — the task no longer exists"), { statusCode: 409 });
      revertBefore = mapScheduleTask(task) as any;
      revertAfter = null;
      await this.db.scheduleDependency.deleteMany({ where: { OR: [{ predecessorId: taskId }, { successorId: taskId }] } });
      await this.db.scheduleTask.delete({ where: { id: taskId } });
    } else if (type === "schedule_task_updated") {
      const taskId = data.taskId as string;
      const task = await this.db.scheduleTask.findFirst({ where: { id: taskId, projectId } });
      if (!task) throw Object.assign(new Error("Cannot revert — the task no longer exists"), { statusCode: 409 });
      revertBefore = this.pick(task as any, Object.keys(before!));
      await this.db.scheduleTask.update({ where: { id: taskId }, data: before as any });
      revertAfter = before;
    } else if (type === "schedule_task_deleted") {
      const snapshot = before!;
      revertBefore = null;
      await this.db.scheduleTask.create({
        data: {
          id: snapshot.id as string,
          projectId,
          revisionId: snapshot.revisionId as string,
          phaseId: (snapshot.phaseId as string) ?? null,
          calendarId: (snapshot.calendarId as string) ?? null,
          name: (snapshot.name as string) ?? "",
          description: (snapshot.description as string) ?? "",
          taskType: (snapshot.taskType as string) ?? "task",
          status: (snapshot.status as string) ?? "not_started",
          startDate: (snapshot.startDate as string) ?? null,
          endDate: (snapshot.endDate as string) ?? null,
          duration: (snapshot.duration as number) ?? 0,
          progress: (snapshot.progress as number) ?? 0,
          assignee: (snapshot.assignee as string) ?? "",
          order: (snapshot.order as number) ?? 0,
          constraintType: (snapshot.constraintType as string) ?? "asap",
          constraintDate: (snapshot.constraintDate as string) ?? null,
          deadlineDate: (snapshot.deadlineDate as string) ?? null,
          actualStart: (snapshot.actualStart as string) ?? null,
          actualEnd: (snapshot.actualEnd as string) ?? null,
          baselineStart: (snapshot.baselineStart as string) ?? null,
          baselineEnd: (snapshot.baselineEnd as string) ?? null,
        },
      });
      revertAfter = snapshot;
    } else {
      throw Object.assign(new Error(`Unknown activity type "${type}" cannot be reverted`), { statusCode: 400 });
    }

    // Log the revert as its own activity
    await this.pushActivity(projectId, revisionId, `revert:${type}`, {
      originalActivityId: activityId,
      before: revertBefore,
      after: revertAfter,
    });

    await this.syncProjectEstimate(projectId);
    return this.getWorkspace(projectId);
  }

  // ── Report Sections ────────────────────────────────────────────────────

  async listReportSections(projectId: string) {
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return [];
    const sections = await this.db.reportSection.findMany({
      where: { revisionId: revision.id },
      orderBy: { order: "asc" },
    });
    return sections.map(mapReportSection);
  }

  async createReportSection(projectId: string, revisionId: string, input: CreateReportSectionInput) {
    await this.requireProject(projectId);
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
    if (!revision) throw new Error(`Revision ${revisionId} not found for project ${projectId}`);

    const maxOrder = await this.db.reportSection.aggregate({
      where: { revisionId },
      _max: { order: true },
    });
    const order = input.order ?? ((maxOrder._max.order ?? 0) + 1);

    const section = await this.db.reportSection.create({
      data: {
        id: createId("section"),
        revisionId,
        sectionType: input.sectionType ?? "text",
        title: input.title ?? "",
        content: input.content ?? "",
        order,
        parentSectionId: input.parentSectionId ?? null,
      },
    });

    await this.syncProjectEstimate(projectId);
    return mapReportSection(section);
  }

  async updateReportSection(projectId: string, sectionId: string, patch: ReportSectionPatchInput) {
    await this.requireProject(projectId);
    const section = await this.db.reportSection.findFirst({ where: { id: sectionId } });
    if (!section) throw new Error(`Report section ${sectionId} not found for project ${projectId}`);

    const data: any = {};
    if (typeof patch.sectionType === "string") data.sectionType = patch.sectionType;
    if (typeof patch.title === "string") data.title = patch.title;
    if (typeof patch.content === "string") data.content = patch.content;
    if (typeof patch.order === "number") data.order = patch.order;
    if (patch.parentSectionId !== undefined) data.parentSectionId = patch.parentSectionId;

    const updated = await this.db.reportSection.update({ where: { id: sectionId }, data });
    await this.syncProjectEstimate(projectId);
    return mapReportSection(updated);
  }

  async deleteReportSection(projectId: string, sectionId: string) {
    await this.requireProject(projectId);
    const section = await this.db.reportSection.findFirst({ where: { id: sectionId } });
    if (!section) throw new Error(`Report section ${sectionId} not found for project ${projectId}`);

    await this.db.reportSection.delete({ where: { id: sectionId } });
    await this.syncProjectEstimate(projectId);
    return mapReportSection(section);
  }

  async reorderReportSections(projectId: string, revisionId: string, orderedIds: string[]) {
    await this.requireProject(projectId);
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
    if (!revision) throw new Error(`Revision ${revisionId} not found for project ${projectId}`);

    await this.db.$transaction(
      orderedIds.map((id, i) =>
        this.db.reportSection.updateMany({
          where: { id, revisionId },
          data: { order: i + 1 },
        })
      )
    );

    await this.syncProjectEstimate(projectId);
    const sections = await this.db.reportSection.findMany({
      where: { revisionId },
      orderBy: { order: "asc" },
    });
    return sections.map(mapReportSection);
  }

  // ── Status Update ──────────────────────────────────────────────────────

  async updateProjectStatus(projectId: string, patch: StatusPatchInput) {
    await this.requireProject(projectId);
    const updated = await this.db.project.update({
      where: { id: projectId },
      data: { ingestionStatus: patch.ingestionStatus, updatedAt: new Date() },
    });
    return mapProject(updated);
  }

  // ── Job CRUD ───────────────────────────────────────────────────────────

  async createJob(projectId: string, revisionId: string, input: CreateJobInput) {
    await this.requireProject(projectId);
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
    if (!revision) throw new Error(`Revision ${revisionId} not found for project ${projectId}`);

    const job = await this.db.job.create({
      data: {
        id: createId("job"),
        projectId,
        revisionId,
        name: input.name,
        foreman: input.foreman ?? "",
        projectManager: input.projectManager ?? "",
        startDate: input.startDate ?? null,
        shipDate: input.shipDate ?? null,
        poNumber: input.poNumber ?? "",
        poIssuer: input.poIssuer ?? "",
        status: "Draft",
        createdAt: new Date(),
      },
    });

    return mapJob(job);
  }

  // ── Catalog CRUD ───────────────────────────────────────────────────────

  async createCatalog(input: CreateCatalogInput) {
    const catalog = await this.db.catalog.create({
      data: {
        id: createId("cat"),
        organizationId: this.organizationId,
        name: input.name,
        kind: input.kind || "materials",
        scope: "global",
        projectId: null,
        description: input.description ?? "",
      },
    });
    return mapCatalog(catalog);
  }

  async updateCatalog(catalogId: string, patch: CatalogPatchInput) {
    await this.requireCatalog(catalogId);

    const data: any = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.kind !== undefined) data.kind = patch.kind;
    if (patch.scope !== undefined) data.scope = "global";
    if (patch.projectId !== undefined) data.projectId = null;
    if (patch.description !== undefined) data.description = patch.description;

    const updated = await this.db.catalog.update({ where: { id: catalogId }, data });
    return mapCatalog(updated);
  }

  async deleteCatalog(catalogId: string) {
    await this.requireCatalog(catalogId);
    await this.db.catalogItem.deleteMany({ where: { catalogId } });
    await this.db.catalog.delete({ where: { id: catalogId } });
    return { deleted: true };
  }

  async listCatalogItems(catalogId: string) {
    await this.requireCatalog(catalogId);
    const items = await this.db.catalogItem.findMany({ where: { catalogId } });
    return items.map(mapCatalogItem);
  }

  async createCatalogItem(catalogId: string, input: CreateCatalogItemInput) {
    await this.requireCatalog(catalogId);

    const item = await this.db.catalogItem.create({
      data: {
        id: createId("ci"),
        catalogId,
        code: input.code,
        name: input.name,
        unit: input.unit,
        unitCost: input.unitCost,
        unitPrice: input.unitPrice,
        metadata: { category: input.category ?? "", ...(input.metadata ?? {}) } as any,
      },
    });
    return mapCatalogItem(item);
  }

  async updateCatalogItem(itemId: string, patch: CatalogItemPatchInput) {
    const item = await this.requireCatalogItem(itemId);

    const data: any = {};
    if (patch.code !== undefined) data.code = patch.code;
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.unit !== undefined) data.unit = patch.unit;
    if (patch.unitCost !== undefined) data.unitCost = patch.unitCost;
    if (patch.unitPrice !== undefined) data.unitPrice = patch.unitPrice;
    if (patch.category !== undefined) {
      data.metadata = { ...(item.metadata as any), category: patch.category };
    }
    if (patch.metadata !== undefined) {
      data.metadata = { ...(item.metadata as any), ...(data.metadata ?? {}), ...patch.metadata };
    }

    const updated = await this.db.catalogItem.update({ where: { id: itemId }, data });
    return mapCatalogItem(updated);
  }

  async deleteCatalogItem(itemId: string) {
    await this.requireCatalogItem(itemId);
    await this.db.catalogItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  async bulkCreateCatalogItems(
    catalogId: string,
    items: Array<{ name: string; code?: string; unit?: string; unitCost?: number; unitPrice?: number; category?: string; metadata?: Record<string, unknown> }>,
  ): Promise<{ created: number; catalogId: string }> {
    const catalog = await this.db.catalog.findFirst({
      where: { id: catalogId, organizationId: this.organizationId },
    });
    if (!catalog) throw new Error(`Catalog ${catalogId} not found`);

    const maxOrder = await this.db.catalogItem.aggregate({
      where: { catalogId },
      _max: { order: true },
    });
    let order = (maxOrder._max.order ?? 0) + 1;

    const data = items
      .filter((it) => (it.name ?? "").trim().length > 0)
      .map((it) => ({
        id: createId("ci"),
        catalogId,
        code: it.code ?? "",
        name: it.name.trim(),
        unit: it.unit ?? "EA",
        unitCost: it.unitCost ?? 0,
        unitPrice: it.unitPrice ?? 0,
        metadata: { category: it.category ?? "", ...(it.metadata ?? {}) } as any,
        order: order++,
      }));

    if (data.length === 0) return { created: 0, catalogId };
    await this.db.catalogItem.createMany({ data });
    return { created: data.length, catalogId };
  }

  async searchCatalogItems(query: string, catalogId?: string) {
    const catalogIds = catalogId
      ? [(await this.requireCatalog(catalogId)).id]
      : (await this.db.catalog.findMany({ where: { organizationId: this.organizationId }, select: { id: true } })).map((c) => c.id);

    const items = await this.db.catalogItem.findMany({
      where: { catalogId: { in: catalogIds } },
    });

    if (!query.trim()) return items.map(mapCatalogItem);
    const q = query.toLowerCase();
    return items
      .filter((i) =>
        i.code.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        (typeof (i.metadata as any)?.category === "string" && (i.metadata as any).category.toLowerCase().includes(q))
      )
      .map(mapCatalogItem);
  }

  // ── Labor Unit Libraries ────────────────────────────────────────────────

  async listLaborUnitLibraries(
    scope: "organization" | "all" = "all",
  ): Promise<LaborUnitLibrary[]> {
    const where =
      scope === "organization"
        ? { organizationId: this.organizationId }
        : { OR: [{ organizationId: this.organizationId }, { organizationId: null }] };
    const rows = await (this.db as any).laborUnitLibrary.findMany({
      where,
      include: { _count: { select: { units: true } } },
      orderBy: [{ provider: "asc" }, { name: "asc" }],
    });
    return rows.map(mapLaborUnitLibrary);
  }

  async getLaborUnitLibrary(libraryId: string): Promise<LaborUnitLibrary | null> {
    const row = await (this.db as any).laborUnitLibrary.findFirst({
      where: {
        id: libraryId,
        OR: [{ organizationId: this.organizationId }, { organizationId: null }],
      },
      include: { _count: { select: { units: true } } },
    });
    return row ? mapLaborUnitLibrary(row) : null;
  }

  async createLaborUnitLibrary(input: CreateLaborUnitLibraryInput): Promise<LaborUnitLibrary> {
    const row = await (this.db as any).laborUnitLibrary.create({
      data: {
        id: createId("lul"),
        organizationId: this.organizationId,
        cabinetId: input.cabinetId ?? null,
        name: input.name.trim(),
        description: input.description ?? "",
        provider: input.provider ?? "",
        discipline: input.discipline ?? "",
        source: input.source ?? "manual",
        sourceDescription: input.sourceDescription ?? "",
        sourceDatasetId: input.sourceDatasetId ?? null,
        tags: input.tags ?? [],
        metadata: (input.metadata ?? {}) as any,
      },
      include: { _count: { select: { units: true } } },
    });
    return mapLaborUnitLibrary(row);
  }

  async updateLaborUnitLibrary(libraryId: string, patch: LaborUnitLibraryPatchInput): Promise<LaborUnitLibrary> {
    const existing = await this.requireLaborUnitLibrary(libraryId);
    const data: any = {};
    if (patch.name !== undefined) data.name = patch.name.trim();
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.provider !== undefined) data.provider = patch.provider;
    if (patch.discipline !== undefined) data.discipline = patch.discipline;
    if (patch.source !== undefined) data.source = patch.source;
    if (patch.sourceDescription !== undefined) data.sourceDescription = patch.sourceDescription;
    if (patch.sourceDatasetId !== undefined) data.sourceDatasetId = patch.sourceDatasetId ?? null;
    if (patch.cabinetId !== undefined) data.cabinetId = patch.cabinetId ?? null;
    if (patch.tags !== undefined) data.tags = patch.tags;
    if (patch.metadata !== undefined) data.metadata = { ...((existing.metadata as any) ?? {}), ...patch.metadata };

    const row = await (this.db as any).laborUnitLibrary.update({
      where: { id: libraryId },
      data,
      include: { _count: { select: { units: true } } },
    });
    return mapLaborUnitLibrary(row);
  }

  async deleteLaborUnitLibrary(libraryId: string): Promise<{ deleted: true }> {
    await this.requireLaborUnitLibrary(libraryId);
    await (this.db as any).laborUnitLibrary.delete({ where: { id: libraryId } });
    return { deleted: true };
  }

  async listLaborUnits(input: {
    libraryId?: string;
    q?: string;
    provider?: string;
    category?: string;
    className?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ units: LaborUnit[]; total: number }> {
    const accessibleLibrary =
      input.libraryId
        ? {
            id: input.libraryId,
            OR: [
              { organizationId: this.organizationId },
              { organizationId: null },
            ],
          }
        : {
            OR: [
              { organizationId: this.organizationId },
              { organizationId: null },
            ],
          };
    const where: any = {
      library: accessibleLibrary,
    };
    if (input.provider?.trim()) {
      where.library = { ...accessibleLibrary, provider: input.provider.trim() };
    }
    if (input.category?.trim()) where.category = input.category.trim();
    if (input.className?.trim()) where.className = input.className.trim();
    if (input.q?.trim()) {
      const q = input.q.trim();
      where.OR = [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
        { className: { contains: q, mode: "insensitive" } },
        { subClassName: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, rows] = await Promise.all([
      (this.db as any).laborUnit.count({ where }),
      (this.db as any).laborUnit.findMany({
        where,
        include: { library: true },
        orderBy: [{ category: "asc" }, { className: "asc" }, { subClassName: "asc" }, { sortOrder: "asc" }],
        skip: Math.max(0, input.offset ?? 0),
        take: Math.min(1000, Math.max(1, input.limit ?? 250)),
      }),
    ]);
    return { units: rows.map(mapLaborUnit), total };
  }

  async listLaborUnitTree(input: LaborUnitTreeInput = {}): Promise<{ nodes: LaborUnitTreeGroup[]; units: LaborUnit[]; total: number }> {
    const parentType = input.parentType ?? "root";
    const accessibleLibrary =
      input.libraryId
        ? {
            id: input.libraryId,
            OR: [
              { organizationId: this.organizationId },
              { organizationId: null },
            ],
          }
        : {
            OR: [
              { organizationId: this.organizationId },
              { organizationId: null },
            ],
          };
    const where: any = {
      library: accessibleLibrary,
    };
    if (input.libraryId?.trim()) where.libraryId = input.libraryId.trim();
    if (input.category != null) where.category = input.category;
    if (input.className != null) where.className = input.className;
    if (input.subClassName != null) where.subClassName = input.subClassName;
    if (input.q?.trim()) {
      const q = input.q.trim();
      where.OR = [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
        { className: { contains: q, mode: "insensitive" } },
        { subClassName: { contains: q, mode: "insensitive" } },
      ];
    }

    const countOf = (row: any) => row._count?._all ?? 0;
    const hoursOf = (row: any) => Number(row._sum?.hoursNormal ?? 0);
    const groupId = (parts: Array<string | null | undefined>) =>
      `labor-unit-tree:${parts.map((part) => encodeURIComponent(part ?? "")).join("/")}`;
    const labelFor = (value: string | null | undefined, fallback: string) => value?.trim() || fallback;

    if (parentType === "subclass") {
      const [total, rows] = await Promise.all([
        (this.db as any).laborUnit.count({ where }),
        (this.db as any).laborUnit.findMany({
          where,
          include: { library: true },
          orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { name: "asc" }],
          skip: Math.max(0, input.offset ?? 0),
          take: Math.min(1000, Math.max(1, input.limit ?? 250)),
        }),
      ]);
      return { nodes: [], units: rows.map(mapLaborUnit), total };
    }

    if (parentType === "root") {
      const rows = await (this.db as any).laborUnit.groupBy({
        by: ["libraryId"],
        where,
        _count: { _all: true },
        _sum: { hoursNormal: true },
      });
      const libraries = await (this.db as any).laborUnitLibrary.findMany({
        where: {
          id: { in: rows.map((row: any) => row.libraryId) },
          OR: [
            { organizationId: this.organizationId },
            { organizationId: null },
          ],
        },
      });
      const libraryById = new Map<string, any>(libraries.map((library: any) => [library.id, library]));
      const nodes = rows
        .map((row: any) => {
          const library = libraryById.get(row.libraryId);
          return {
            id: groupId(["catalog", row.libraryId]),
            level: "catalog" as const,
            label: labelFor(library?.name, "Unknown catalog"),
            libraryId: row.libraryId,
            category: "",
            className: "",
            subClassName: "",
            unitCount: countOf(row),
            normalHoursTotal: hoursOf(row),
          };
        })
        .sort((left: LaborUnitTreeGroup, right: LaborUnitTreeGroup) =>
          left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" }),
        );
      return { nodes, units: [], total: nodes.length };
    }

    const nextLevel =
      parentType === "catalog" ? "category" :
      parentType === "category" ? "class" :
      "subclass";
    const by =
      nextLevel === "category" ? ["category"] :
      nextLevel === "class" ? ["className"] :
      ["subClassName"];
    const rows = await (this.db as any).laborUnit.groupBy({
      by,
      where,
      _count: { _all: true },
      _sum: { hoursNormal: true },
      orderBy: by.map((field) => ({ [field]: "asc" })),
    });
    const nodes = rows.map((row: any) => {
      const category = nextLevel === "category" ? row.category ?? "" : input.category ?? "";
      const className = nextLevel === "class" ? row.className ?? "" : input.className ?? "";
      const subClassName = nextLevel === "subclass" ? row.subClassName ?? "" : input.subClassName ?? "";
      return {
        id: groupId([nextLevel, input.libraryId, category, className, subClassName]),
        level: nextLevel,
        label: nextLevel === "category"
          ? labelFor(category, "Uncategorized")
          : nextLevel === "class"
            ? labelFor(className, "Unclassified")
            : labelFor(subClassName, "No subclass"),
        libraryId: input.libraryId ?? null,
        category,
        className,
        subClassName,
        unitCount: countOf(row),
        normalHoursTotal: hoursOf(row),
      } satisfies LaborUnitTreeGroup;
    });

    return { nodes, units: [], total: nodes.length };
  }

  async getLaborUnit(unitId: string): Promise<LaborUnit | null> {
    const row = await (this.db as any).laborUnit.findFirst({
      where: {
        id: unitId,
        library: { OR: [{ organizationId: this.organizationId }, { organizationId: null }] },
      },
    });
    return row ? mapLaborUnit(row) : null;
  }

  async createLaborUnit(libraryId: string, input: CreateLaborUnitInput): Promise<LaborUnit> {
    await this.requireLaborUnitLibrary(libraryId);
    if (input.catalogItemId) {
      await this.requireCatalogItem(input.catalogItemId);
    }
    const row = await (this.db as any).laborUnit.create({
      data: {
        id: createId("lu"),
        libraryId,
        catalogItemId: input.catalogItemId ?? null,
        code: input.code ?? "",
        name: input.name.trim(),
        description: input.description ?? "",
        discipline: input.discipline ?? "",
        category: input.category ?? "",
        className: input.className ?? "",
        subClassName: input.subClassName ?? "",
        outputUom: input.outputUom ?? "EA",
        hoursNormal: input.hoursNormal,
        hoursDifficult: input.hoursDifficult ?? null,
        hoursVeryDifficult: input.hoursVeryDifficult ?? null,
        defaultDifficulty: input.defaultDifficulty ?? "normal",
        entityCategoryType: input.entityCategoryType ?? "Labour",
        tags: input.tags ?? [],
        sourceRef: (input.sourceRef ?? {}) as any,
        metadata: (input.metadata ?? {}) as any,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return mapLaborUnit(row);
  }

  async updateLaborUnit(unitId: string, patch: LaborUnitPatchInput): Promise<LaborUnit> {
    const existing = await this.requireLaborUnit(unitId);
    if (patch.catalogItemId) {
      await this.requireCatalogItem(patch.catalogItemId);
    }

    const data: any = {};
    if (patch.catalogItemId !== undefined) data.catalogItemId = patch.catalogItemId ?? null;
    if (patch.code !== undefined) data.code = patch.code;
    if (patch.name !== undefined) data.name = patch.name.trim();
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.discipline !== undefined) data.discipline = patch.discipline;
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.className !== undefined) data.className = patch.className;
    if (patch.subClassName !== undefined) data.subClassName = patch.subClassName;
    if (patch.outputUom !== undefined) data.outputUom = patch.outputUom;
    if (patch.hoursNormal !== undefined) data.hoursNormal = patch.hoursNormal;
    if (patch.hoursDifficult !== undefined) data.hoursDifficult = patch.hoursDifficult ?? null;
    if (patch.hoursVeryDifficult !== undefined) data.hoursVeryDifficult = patch.hoursVeryDifficult ?? null;
    if (patch.defaultDifficulty !== undefined) data.defaultDifficulty = patch.defaultDifficulty;
    if (patch.entityCategoryType !== undefined) data.entityCategoryType = patch.entityCategoryType;
    if (patch.tags !== undefined) data.tags = patch.tags;
    if (patch.sourceRef !== undefined) data.sourceRef = { ...((existing.sourceRef as any) ?? {}), ...patch.sourceRef };
    if (patch.metadata !== undefined) data.metadata = { ...((existing.metadata as any) ?? {}), ...patch.metadata };
    if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;

    const row = await (this.db as any).laborUnit.update({ where: { id: unitId }, data });
    return mapLaborUnit(row);
  }

  async deleteLaborUnit(unitId: string): Promise<{ deleted: true }> {
    await this.requireLaborUnit(unitId);
    await (this.db as any).laborUnit.delete({ where: { id: unitId } });
    return { deleted: true };
  }

  async resolveLaborUnitByHierarchy(
    providerLabel: string,
    input: { category?: unknown; class?: unknown; className?: unknown; subClass?: unknown; subClassName?: unknown },
  ): Promise<LaborUnit | null> {
    const provider = String(providerLabel ?? "").trim();
    const category = String(input.category ?? "").trim();
    const className = String(input.class ?? input.className ?? "").trim();
    const subClassName = String(input.subClass ?? input.subClassName ?? "").trim();
    if (!provider || !category || !className) {
      return null;
    }

    const rows = await (this.db as any).laborUnit.findMany({
      where: {
        library: {
          provider,
          OR: [{ organizationId: this.organizationId }, { organizationId: null }],
        },
        category,
        className,
      },
      include: { library: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 100,
    });
    rows.sort((a: any, b: any) => Number(!a.library?.organizationId) - Number(!b.library?.organizationId));
    const exact = subClassName
      ? rows.find((row: any) => String(row.subClassName ?? "").trim() === subClassName)
      : undefined;
    const fallback = rows.find((row: any) => !String(row.subClassName ?? "").trim()) ?? rows[0];
    return exact || fallback ? mapLaborUnit(exact ?? fallback) : null;
  }

  // ── Assembly CRUD ──────────────────────────────────────────────────────

  async listAssemblies(): Promise<AssemblySummary[]> {
    const rows = await this.db.assembly.findMany({
      where: { organizationId: this.organizationId },
      orderBy: { name: "asc" },
      include: { _count: { select: { components: true, parameters: true } } },
    });
    return rows.map(mapAssemblySummary);
  }

  async getAssembly(assemblyId: string): Promise<Assembly | null> {
    const row = await this.db.assembly.findFirst({
      where: { id: assemblyId, organizationId: this.organizationId },
      include: { parameters: true, components: true },
    });
    return row ? mapAssembly(row) : null;
  }

  async createAssembly(input: CreateAssemblyInput): Promise<Assembly> {
    const row = await this.db.assembly.create({
      data: {
        id: createId("asm"),
        organizationId: this.organizationId,
        name: input.name.trim() || "Untitled assembly",
        code: input.code ?? "",
        description: input.description ?? "",
        category: input.category ?? "",
        unit: input.unit || "EA",
        metadata: (input.metadata ?? {}) as any,
      },
      include: { parameters: true, components: true },
    });
    return mapAssembly(row);
  }

  async updateAssembly(assemblyId: string, patch: AssemblyPatchInput): Promise<Assembly> {
    const existing = await this.db.assembly.findFirst({
      where: { id: assemblyId, organizationId: this.organizationId },
    });
    if (!existing) throw new Error(`Assembly ${assemblyId} not found`);

    const data: any = {};
    if (patch.name !== undefined) data.name = patch.name.trim() || existing.name;
    if (patch.code !== undefined) data.code = patch.code;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.unit !== undefined) data.unit = patch.unit || existing.unit;
    if (patch.metadata !== undefined) data.metadata = patch.metadata as any;

    const updated = await this.db.assembly.update({
      where: { id: assemblyId },
      data,
      include: { parameters: true, components: true },
    });
    return mapAssembly(updated);
  }

  async deleteAssembly(assemblyId: string): Promise<{ deleted: true }> {
    const existing = await this.db.assembly.findFirst({
      where: { id: assemblyId, organizationId: this.organizationId },
    });
    if (!existing) throw new Error(`Assembly ${assemblyId} not found`);

    const referencedBy = await this.db.assemblyComponent.findFirst({
      where: { subAssemblyId: assemblyId },
      select: { assemblyId: true },
    });
    if (referencedBy) {
      throw new Error(
        `Assembly ${assemblyId} cannot be deleted while it is referenced by another assembly. Remove the references first.`,
      );
    }

    await this.db.assembly.delete({ where: { id: assemblyId } });
    return { deleted: true };
  }

  async createAssemblyParameter(
    assemblyId: string,
    input: AssemblyParameterInput,
  ): Promise<AssemblyParameter> {
    await this.requireAssembly(assemblyId);
    const maxOrder = await this.db.assemblyParameter.aggregate({
      where: { assemblyId },
      _max: { sortOrder: true },
    });
    const row = await this.db.assemblyParameter.create({
      data: {
        id: createId("ap"),
        assemblyId,
        key: input.key.trim(),
        label: input.label ?? "",
        description: input.description ?? "",
        paramType: input.paramType ?? "number",
        defaultValue: input.defaultValue ?? "0",
        unit: input.unit ?? "",
        sortOrder: input.sortOrder ?? ((maxOrder._max.sortOrder ?? 0) + 1),
      },
    });
    return mapAssemblyParameter(row);
  }

  async updateAssemblyParameter(
    assemblyId: string,
    parameterId: string,
    patch: AssemblyParameterPatchInput,
  ): Promise<AssemblyParameter> {
    await this.requireAssembly(assemblyId);
    const existing = await this.db.assemblyParameter.findFirst({
      where: { id: parameterId, assemblyId },
    });
    if (!existing) throw new Error(`Parameter ${parameterId} not found`);

    const data: any = {};
    if (patch.key !== undefined) data.key = patch.key.trim();
    if (patch.label !== undefined) data.label = patch.label;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.paramType !== undefined) data.paramType = patch.paramType;
    if (patch.defaultValue !== undefined) data.defaultValue = patch.defaultValue;
    if (patch.unit !== undefined) data.unit = patch.unit;
    if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;

    const updated = await this.db.assemblyParameter.update({ where: { id: parameterId }, data });
    return mapAssemblyParameter(updated);
  }

  async deleteAssemblyParameter(assemblyId: string, parameterId: string): Promise<{ deleted: true }> {
    await this.requireAssembly(assemblyId);
    const existing = await this.db.assemblyParameter.findFirst({
      where: { id: parameterId, assemblyId },
    });
    if (!existing) throw new Error(`Parameter ${parameterId} not found`);
    await this.db.assemblyParameter.delete({ where: { id: parameterId } });
    return { deleted: true };
  }

  async createAssemblyComponent(
    assemblyId: string,
    input: AssemblyComponentInput,
  ): Promise<AssemblyComponent> {
    await this.requireAssembly(assemblyId);
    await this.validateAssemblyComponentRefs(assemblyId, input);

    const maxOrder = await this.db.assemblyComponent.aggregate({
      where: { assemblyId },
      _max: { sortOrder: true },
    });

    const row = await this.db.assemblyComponent.create({
      data: {
        id: createId("ac"),
        assemblyId,
        componentType: input.componentType,
        catalogItemId: input.catalogItemId ?? null,
        rateScheduleItemId: input.rateScheduleItemId ?? null,
        laborUnitId: input.laborUnitId ?? null,
        laborDifficulty: input.laborDifficulty ?? "normal",
        costResourceId: input.costResourceId ?? null,
        effectiveCostId: input.effectiveCostId ?? null,
        subAssemblyId: input.subAssemblyId ?? null,
        quantityExpr: input.quantityExpr ?? "1",
        description: input.description ?? "",
        category: input.category ?? "",
        uomOverride: input.uomOverride ?? null,
        costOverride: input.costOverride ?? null,
        markupOverride: input.markupOverride ?? null,
        parameterBindings: (input.parameterBindings ?? {}) as any,
        notes: input.notes ?? "",
        sortOrder: input.sortOrder ?? ((maxOrder._max.sortOrder ?? 0) + 1),
      },
    });
    return mapAssemblyComponent(row);
  }

  async updateAssemblyComponent(
    assemblyId: string,
    componentId: string,
    patch: AssemblyComponentPatchInput,
  ): Promise<AssemblyComponent> {
    await this.requireAssembly(assemblyId);
    const existing = await this.db.assemblyComponent.findFirst({
      where: { id: componentId, assemblyId },
    });
    if (!existing) throw new Error(`Component ${componentId} not found`);

    if (
      patch.componentType !== undefined ||
      patch.catalogItemId !== undefined ||
      patch.rateScheduleItemId !== undefined ||
      patch.laborUnitId !== undefined ||
      patch.costResourceId !== undefined ||
      patch.effectiveCostId !== undefined ||
      patch.subAssemblyId !== undefined
    ) {
      await this.validateAssemblyComponentRefs(assemblyId, {
        componentType: patch.componentType ?? (existing.componentType as any),
        catalogItemId: patch.catalogItemId ?? existing.catalogItemId,
        rateScheduleItemId: patch.rateScheduleItemId ?? existing.rateScheduleItemId,
        laborUnitId: patch.laborUnitId ?? existing.laborUnitId,
        costResourceId: patch.costResourceId !== undefined ? patch.costResourceId : undefined,
        effectiveCostId: patch.effectiveCostId ?? (existing as any).effectiveCostId,
        subAssemblyId: patch.subAssemblyId ?? existing.subAssemblyId,
      });
    }

    const data: any = {};
    if (patch.componentType !== undefined) data.componentType = patch.componentType;
    if (patch.catalogItemId !== undefined) data.catalogItemId = patch.catalogItemId ?? null;
    if (patch.rateScheduleItemId !== undefined) data.rateScheduleItemId = patch.rateScheduleItemId ?? null;
    if (patch.laborUnitId !== undefined) data.laborUnitId = patch.laborUnitId ?? null;
    if (patch.laborDifficulty !== undefined) data.laborDifficulty = patch.laborDifficulty;
    if (patch.costResourceId !== undefined) data.costResourceId = patch.costResourceId ?? null;
    if (patch.effectiveCostId !== undefined) data.effectiveCostId = patch.effectiveCostId ?? null;
    if (patch.subAssemblyId !== undefined) data.subAssemblyId = patch.subAssemblyId ?? null;
    if (patch.quantityExpr !== undefined) data.quantityExpr = patch.quantityExpr;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.uomOverride !== undefined) data.uomOverride = patch.uomOverride ?? null;
    if (patch.costOverride !== undefined) data.costOverride = patch.costOverride ?? null;
    if (patch.markupOverride !== undefined) data.markupOverride = patch.markupOverride ?? null;
    if (patch.parameterBindings !== undefined) data.parameterBindings = patch.parameterBindings as any;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;

    const updated = await this.db.assemblyComponent.update({ where: { id: componentId }, data });
    return mapAssemblyComponent(updated);
  }

  async deleteAssemblyComponent(
    assemblyId: string,
    componentId: string,
  ): Promise<{ deleted: true }> {
    await this.requireAssembly(assemblyId);
    const existing = await this.db.assemblyComponent.findFirst({
      where: { id: componentId, assemblyId },
    });
    if (!existing) throw new Error(`Component ${componentId} not found`);
    await this.db.assemblyComponent.delete({ where: { id: componentId } });
    return { deleted: true };
  }

  private async requireAssembly(assemblyId: string): Promise<void> {
    const found = await this.db.assembly.findFirst({
      where: { id: assemblyId, organizationId: this.organizationId },
      select: { id: true },
    });
    if (!found) throw new Error(`Assembly ${assemblyId} not found`);
  }

  private async validateAssemblyComponentRefs(
    assemblyId: string,
    input: {
      componentType: AssemblyComponentInput["componentType"];
      catalogItemId?: string | null;
      rateScheduleItemId?: string | null;
      laborUnitId?: string | null;
      costResourceId?: string | null;
      effectiveCostId?: string | null;
      subAssemblyId?: string | null;
    },
  ): Promise<void> {
    if (input.componentType === "catalog_item") {
      if (!input.catalogItemId) throw new Error("catalogItemId is required for catalog_item components");
      const ci = await this.db.catalogItem.findFirst({
        where: {
          id: input.catalogItemId,
          catalog: { organizationId: this.organizationId },
        },
        select: { id: true },
      });
      if (!ci) throw new Error(`Catalog item ${input.catalogItemId} not found in this organization`);
    } else if (input.componentType === "rate_schedule_item") {
      if (!input.rateScheduleItemId) throw new Error("rateScheduleItemId is required for rate_schedule_item components");
      const rsi = await this.db.rateScheduleItem.findFirst({
        where: {
          id: input.rateScheduleItemId,
          schedule: { organizationId: this.organizationId },
        },
        select: { id: true },
      });
      if (!rsi) throw new Error(`Rate-schedule item ${input.rateScheduleItemId} not found in this organization`);
    } else if (input.componentType === "labor_unit") {
      if (!input.laborUnitId) throw new Error("laborUnitId is required for labor_unit components");
      if (!input.rateScheduleItemId) throw new Error("rateScheduleItemId is required for labor_unit components");
      const unit = await (this.db as any).laborUnit.findFirst({
        where: {
          id: input.laborUnitId,
          library: {
            OR: [
              { organizationId: this.organizationId },
              { organizationId: null },
            ],
          },
        },
        select: { id: true },
      });
      if (!unit) throw new Error(`Labor unit ${input.laborUnitId} not found in this organization`);
      const rsi = await this.db.rateScheduleItem.findFirst({
        where: {
          id: input.rateScheduleItemId,
          schedule: { organizationId: this.organizationId },
        },
        select: { id: true },
      });
      if (!rsi) throw new Error(`Rate-schedule item ${input.rateScheduleItemId} not found in this organization`);
    } else if (input.componentType === "cost_intelligence") {
      if (!input.effectiveCostId) throw new Error("effectiveCostId is required for cost_intelligence components");
      const cost = await (this.db as any).effectiveCost.findFirst({
        where: {
          id: input.effectiveCostId,
          organizationId: this.organizationId,
          ...(input.costResourceId ? { resourceId: input.costResourceId } : {}),
        },
        select: { id: true, resourceId: true },
      });
      if (!cost) throw new Error(`Cost intelligence cost ${input.effectiveCostId} not found in this organization`);
      if (input.costResourceId && cost.resourceId !== input.costResourceId) {
        throw new Error(`Cost resource ${input.costResourceId} does not match effective cost ${input.effectiveCostId}`);
      }
    } else if (input.componentType === "sub_assembly") {
      if (!input.subAssemblyId) throw new Error("subAssemblyId is required for sub_assembly components");
      if (input.subAssemblyId === assemblyId) {
        throw new Error("An assembly cannot reference itself as a sub-assembly");
      }
      await this.requireAssembly(input.subAssemblyId);

      const cycleMap = await this.buildAssemblyDefinitionMap();
      // Pretend the component is already in place to check whether adding it would form a cycle.
      const draftAssembly = cycleMap.get(assemblyId);
      if (draftAssembly) {
        const draft: AssemblyDefinition = {
          ...draftAssembly,
          components: [
            ...draftAssembly.components,
            {
              id: "__draft__",
              componentType: "sub_assembly",
              subAssemblyId: input.subAssemblyId,
              quantityExpr: "1",
            },
          ],
        };
        const next = new Map(cycleMap);
        next.set(assemblyId, draft);
        const cycles = findAssemblyCycles(assemblyId, next);
        if (cycles.length > 0) {
          throw new Error(
            `Adding this sub-assembly would create a cycle: ${cycles[0]!.join(" -> ")}`,
          );
        }
      }
    } else {
      throw new Error(`Unknown component type "${input.componentType}"`);
    }
  }

  private async buildAssemblyDefinitionMap(): Promise<Map<string, AssemblyDefinition>> {
    const rows = await this.db.assembly.findMany({
      where: { organizationId: this.organizationId },
      include: { parameters: true, components: true },
    });
    const map = new Map<string, AssemblyDefinition>();
    for (const row of rows) {
      map.set(row.id, {
        id: row.id,
        name: row.name,
        unit: row.unit,
        parameters: (row.parameters ?? []).map((p: any) => ({
          key: p.key,
          label: p.label,
          defaultValue: p.defaultValue,
          paramType: p.paramType,
          unit: p.unit,
        })),
        components: (row.components ?? []).map((c: any) => ({
          id: c.id,
          componentType: c.componentType,
          catalogItemId: c.catalogItemId,
          rateScheduleItemId: c.rateScheduleItemId,
          laborUnitId: c.laborUnitId,
          laborDifficulty: c.laborDifficulty,
          costResourceId: c.costResourceId,
          effectiveCostId: c.effectiveCostId,
          subAssemblyId: c.subAssemblyId,
          quantityExpr: c.quantityExpr,
          description: c.description,
          category: c.category,
          uomOverride: c.uomOverride,
          costOverride: c.costOverride,
          markupOverride: c.markupOverride,
          parameterBindings: (c.parameterBindings as Record<string, string>) ?? {},
          notes: c.notes,
          sortOrder: c.sortOrder,
        })),
      });
    }
    return map;
  }

  // ── Assembly Expansion Context ─────────────────────────────────────────

  private async buildExpansionContext(): Promise<{
    assemblyMap: Map<string, AssemblyDefinition>;
    catalogMap: Map<string, CatalogItemRef>;
    rateMap: Map<string, RateScheduleItemRef>;
    laborMap: Map<string, LaborUnitRef>;
    effectiveCostMap: Map<string, EffectiveCostRef>;
  }> {
    const assemblyMap = await this.buildAssemblyDefinitionMap();

    const allComponents = await this.db.assemblyComponent.findMany({
      where: { assembly: { organizationId: this.organizationId } },
      select: { catalogItemId: true, rateScheduleItemId: true, laborUnitId: true, effectiveCostId: true },
    });
    const catalogItemIds = Array.from(
      new Set(allComponents.map((c) => c.catalogItemId).filter((id): id is string => Boolean(id))),
    );
    const rateScheduleItemIds = Array.from(
      new Set(allComponents.map((c) => c.rateScheduleItemId).filter((id): id is string => Boolean(id))),
    );
    const laborUnitIds = Array.from(
      new Set(allComponents.map((c) => c.laborUnitId).filter((id): id is string => Boolean(id))),
    );
    const effectiveCostIds = Array.from(
      new Set(
        allComponents
          .map((c: any) => c.effectiveCostId)
          .filter((id: unknown): id is string => typeof id === "string" && id.length > 0),
      ),
    );

    const catalogRows = catalogItemIds.length > 0
      ? await this.db.catalogItem.findMany({
          where: { id: { in: catalogItemIds }, catalog: { organizationId: this.organizationId } },
        })
      : [];
    const rateRows = rateScheduleItemIds.length > 0
      ? await this.db.rateScheduleItem.findMany({
          where: { id: { in: rateScheduleItemIds }, schedule: { organizationId: this.organizationId } },
        })
      : [];
    const laborRows = laborUnitIds.length > 0
      ? await (this.db as any).laborUnit.findMany({
          where: {
            id: { in: laborUnitIds },
            library: {
              OR: [
                { organizationId: this.organizationId },
                { organizationId: null },
              ],
            },
          },
        })
      : [];
    const effectiveCostRows = effectiveCostIds.length > 0
      ? await (this.db as any).effectiveCost.findMany({
          where: { id: { in: effectiveCostIds }, organizationId: this.organizationId },
          include: { resource: true },
        })
      : [];

    const catalogMap = new Map<string, CatalogItemRef>(
      catalogRows.map((c) => [
        c.id,
        { id: c.id, code: c.code, name: c.name, unit: c.unit, unitCost: c.unitCost, unitPrice: c.unitPrice },
      ]),
    );
    const rateMap = new Map<string, RateScheduleItemRef>(
      rateRows.map((r) => [
        r.id,
        {
          id: r.id,
          code: r.code,
          name: r.name,
          unit: r.unit,
          rates: (r.rates as Record<string, number>) ?? {},
          costRates: (r.costRates as Record<string, number>) ?? {},
        },
      ]),
    );
    const laborMap = new Map<string, LaborUnitRef>(
      laborRows.map((unit: any) => [
        unit.id,
        {
          id: unit.id,
          code: unit.code,
          name: unit.name,
          description: unit.description,
          category: unit.category,
          className: unit.className,
          subClassName: unit.subClassName,
          outputUom: unit.outputUom,
          hoursNormal: unit.hoursNormal,
          hoursDifficult: unit.hoursDifficult ?? null,
          hoursVeryDifficult: unit.hoursVeryDifficult ?? null,
          defaultDifficulty: unit.defaultDifficulty,
          entityCategoryType: unit.entityCategoryType,
        },
      ]),
    );
    const metadataString = (metadata: unknown, key: string) => {
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
      const value = (metadata as Record<string, unknown>)[key];
      return typeof value === "string" ? value : "";
    };
    const metadataObject = (metadata: unknown, key: string) => {
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
      const value = (metadata as Record<string, unknown>)[key];
      return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
    };
    const effectiveCostMap = new Map<string, EffectiveCostRef>(
      effectiveCostRows.map((cost: any) => {
        const costItem = metadataObject(cost.metadata, "costItem");
        return [
          cost.id,
          {
            id: cost.id,
            resourceId: cost.resourceId ?? null,
            catalogItemId: cost.resource?.catalogItemId ?? null,
            code: cost.resource?.code || metadataString(costItem, "code"),
            name: cost.resource?.name || metadataString(costItem, "name") || "Cost intelligence item",
            description: cost.resource?.description || metadataString(costItem, "description"),
            category: cost.resource?.category || metadataString(costItem, "category"),
            resourceType: cost.resource?.resourceType || metadataString(costItem, "resourceType"),
            defaultUom: cost.resource?.defaultUom || metadataString(costItem, "defaultUom") || cost.uom || "EA",
            uom: cost.uom,
            unitCost: cost.unitCost,
            unitPrice: cost.unitPrice ?? null,
            vendorName: cost.vendorName ?? "",
            region: cost.region ?? "",
            method: cost.method ?? "",
            effectiveDate: cost.effectiveDate ?? null,
            confidence: cost.confidence ?? null,
          },
        ] as const;
      }),
    );

    return { assemblyMap, catalogMap, rateMap, laborMap, effectiveCostMap };
  }

  async previewAssemblyExpansion(
    assemblyId: string,
    quantity: number,
    parameterValues: Record<string, number | string>,
  ): Promise<{
    items: Array<{
      componentPath: string[];
      componentType: string;
      catalogItemId?: string;
      rateScheduleItemId?: string;
      laborUnitId?: string;
      costResourceId?: string;
      effectiveCostId?: string;
      category: string;
      entityName: string;
      description: string;
      quantity: number;
      uom: string;
      unitCost: number;
      unitPrice: number;
      markup: number;
      lineCost: number;
      linePrice: number;
    }>;
    resourceRollup: Array<{
      key: string;
      componentType: "catalog_item" | "rate_schedule_item" | "labor_unit" | "cost_intelligence" | "mixed";
      catalogItemId?: string;
      rateScheduleItemId?: string;
      laborUnitId?: string;
      costResourceId?: string;
      effectiveCostId?: string;
      category: string;
      entityName: string;
      uom: string;
      quantity: number;
      lineCost: number;
      linePrice: number;
      averageUnitCost: number;
      averageUnitPrice: number;
      componentCount: number;
      componentPaths: string[][];
    }>;
    totals: { cost: number; price: number; lineCount: number };
    warnings: string[];
  }> {
    await this.requireAssembly(assemblyId);
    const { assemblyMap, catalogMap, rateMap, laborMap, effectiveCostMap } = await this.buildExpansionContext();

    const expansion = expandAssembly(assemblyId, quantity, parameterValues ?? {}, {
      assemblies: assemblyMap,
      catalogItems: catalogMap,
      rateScheduleItems: rateMap,
      laborUnits: laborMap,
      effectiveCosts: effectiveCostMap,
    });

    let totalCost = 0;
    let totalPrice = 0;
    const items = expansion.items.map((it) => {
      const lineCost = it.unitCost * it.quantity;
      const linePrice = it.unitPrice * it.quantity * (1 + (it.markup ?? 0));
      totalCost += lineCost;
      totalPrice += linePrice;
      return {
        componentPath: it.componentPath,
        componentType: it.componentType,
	        catalogItemId: it.catalogItemId,
	        rateScheduleItemId: it.rateScheduleItemId,
	        laborUnitId: it.laborUnitId,
	        costResourceId: it.costResourceId,
	        effectiveCostId: it.effectiveCostId,
	        category: it.category,
        entityName: it.entityName,
        description: it.description,
        quantity: it.quantity,
        uom: it.uom,
        unitCost: it.unitCost,
        unitPrice: it.unitPrice,
        markup: it.markup,
        lineCost,
        linePrice,
      };
    });

    return {
      items,
      resourceRollup: summarizeExpandedAssemblyResources(expansion.items),
      totals: { cost: totalCost, price: totalPrice, lineCount: items.length },
      warnings: expansion.warnings,
    };
  }

  // ── Insert Assembly Into Worksheet ─────────────────────────────────────

  async insertAssemblyIntoWorksheet(
    projectId: string,
    worksheetId: string,
    input: InsertAssemblyIntoWorksheetInput,
  ): Promise<{ items: WorksheetItem[]; warnings: string[]; instanceId: string }> {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    const worksheet = await this.db.worksheet.findFirst({ where: { id: worksheetId } });
    if (!revision || !worksheet || worksheet.revisionId !== revision.id) {
      throw new Error(`Worksheet ${worksheetId} not found for project ${projectId}`);
    }

    await this.requireAssembly(input.assemblyId);

    const { assemblyMap, catalogMap, rateMap, laborMap, effectiveCostMap } = await this.buildExpansionContext();
    const expansion = expandAssembly(
      input.assemblyId,
      input.quantity,
      input.parameterValues ?? {},
      {
        assemblies: assemblyMap,
        catalogItems: catalogMap,
        rateScheduleItems: rateMap,
        laborUnits: laborMap,
        effectiveCosts: effectiveCostMap,
      },
    );

    if (expansion.items.length === 0) {
      return { items: [], warnings: expansion.warnings, instanceId: "" };
    }

    const instance = await this.db.assemblyInstance.create({
      data: {
        id: createId("asmi"),
        worksheetId,
        assemblyId: input.assemblyId,
        phaseId: input.phaseId ?? null,
        quantity: input.quantity,
        parameterValues: (input.parameterValues ?? {}) as any,
      },
    });

    const created = await this.expandInstanceIntoWorksheet(
      projectId,
      worksheetId,
      instance.id,
      input.assemblyId,
      expansion.items,
    );

    await this.pushActivity(projectId, revision.id, "assembly_inserted", {
      assemblyId: input.assemblyId,
      worksheetId,
      instanceId: instance.id,
      itemCount: created.length,
      parameterValues: input.parameterValues ?? {},
      quantity: input.quantity,
    });

    return { items: created, warnings: expansion.warnings, instanceId: instance.id };
  }

  // Materialise an array of expanded leaf components into WorksheetItem rows
  // tagged with the given assembly + instance ids. Reused by the initial
  // insertion flow and the resync-instance flow.
  private async expandInstanceIntoWorksheet(
    projectId: string,
    worksheetId: string,
    instanceId: string,
	    assemblyId: string,
	    expandedItems: Array<{
	      catalogItemId?: string;
	      rateScheduleItemId?: string;
	      laborUnitId?: string;
	      costResourceId?: string;
	      effectiveCostId?: string;
	      componentPath?: string[];
	      componentType?: "catalog_item" | "rate_schedule_item" | "labor_unit" | "cost_intelligence" | "mixed";
	      category: string;
	      entityType: string;
      entityName: string;
      description: string;
      quantity: number;
      uom: string;
      tierUnits?: Record<string, number>;
	      unitCost: number;
	      unitPrice: number;
	      markup: number;
	      vendor?: string;
	      notes: string;
    }>,
  ): Promise<WorksheetItem[]> {
    const maxOrder = await this.db.worksheetItem.aggregate({
      where: { worksheetId },
      _max: { lineOrder: true },
    });
    let nextLineOrder = (maxOrder._max.lineOrder ?? 0) + 1;

    const created: WorksheetItem[] = [];
    for (const expanded of expandedItems) {
      const baseInput: CreateWorksheetItemInput = {
        phaseId: null,
        category: expanded.category,
	        entityType: expanded.entityType,
	        entityName: expanded.entityName,
	        description: expanded.description,
	        vendor: expanded.vendor ?? null,
	        quantity: expanded.quantity,
        uom: expanded.uom,
        cost: expanded.unitCost,
        markup: expanded.markup,
        price: expanded.unitPrice,
	        rateScheduleItemId: expanded.rateScheduleItemId ?? null,
	        itemId: expanded.catalogItemId ?? null,
	        tierUnits: expanded.tierUnits ?? {},
	        sourceNotes: expanded.notes,
	        costResourceId: expanded.costResourceId ?? null,
	        effectiveCostId: expanded.effectiveCostId ?? null,
	        laborUnitId: expanded.laborUnitId ?? null,
	        resourceComposition: {
	          source: "assembly",
	          assemblyId,
	          instanceId,
	          unitCost: expanded.unitCost,
	          unitPrice: expanded.unitPrice,
	          totalCost: expanded.quantity * expanded.unitCost,
	          totalPrice: expanded.quantity * expanded.unitPrice * (1 + (expanded.markup ?? 0)),
	          resources: [{
	            type: expanded.componentType,
	            category: expanded.category,
	            name: expanded.entityName,
	            description: expanded.description,
	            quantity: expanded.quantity,
	            uom: expanded.uom,
	            unitCost: expanded.unitCost,
	            unitPrice: expanded.unitPrice,
	            catalogItemId: expanded.catalogItemId ?? null,
	            rateScheduleItemId: expanded.rateScheduleItemId ?? null,
	            laborUnitId: expanded.laborUnitId ?? null,
	            costResourceId: expanded.costResourceId ?? null,
	            effectiveCostId: expanded.effectiveCostId ?? null,
	            componentPath: expanded.componentPath,
	          }],
	        },
	        sourceEvidence: {
	          source: "assembly",
	          assemblyId,
	          instanceId,
	          componentType: expanded.componentType,
	          componentPath: expanded.componentPath,
	          catalogItemId: expanded.catalogItemId ?? null,
	          rateScheduleItemId: expanded.rateScheduleItemId ?? null,
	          laborUnitId: expanded.laborUnitId ?? null,
	          costResourceId: expanded.costResourceId ?? null,
	          effectiveCostId: expanded.effectiveCostId ?? null,
	        },
	        lineOrder: nextLineOrder++,
	      };

      const { item } = await this.createWorksheetItemWithSnapshot(projectId, worksheetId, baseInput);
      await this.db.worksheetItem.update({
        where: { id: item.id },
        data: { sourceAssemblyId: assemblyId, assemblyInstanceId: instanceId },
      });
      created.push({ ...item, sourceAssemblyId: assemblyId, assemblyInstanceId: instanceId });
    }
    return created;
  }

  // ── Assembly Instance Operations ───────────────────────────────────────

  async listAssemblyInstancesForWorksheet(projectId: string, worksheetId: string): Promise<AssemblyInstanceRecord[]> {
    await this.requireProject(projectId);
    const worksheet = await this.db.worksheet.findFirst({
      where: {
        id: worksheetId,
        revision: { quote: { projectId, project: { organizationId: this.organizationId } } },
      },
      select: { id: true },
    });
    if (!worksheet) throw new Error(`Worksheet ${worksheetId} not found for project ${projectId}`);
    const rows = await this.db.assemblyInstance.findMany({
      where: { worksheetId },
      include: {
        assembly: { select: { name: true, organizationId: true } },
        _count: { select: { worksheetItems: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return rows
      .filter((r) => !r.assembly || r.assembly.organizationId === this.organizationId)
      .map(mapAssemblyInstance);
  }

  async deleteAssemblyInstance(
    projectId: string,
    instanceId: string,
  ): Promise<{ deleted: true; itemCount: number }> {
    await this.requireProject(projectId);
    const instance = await this.db.assemblyInstance.findFirst({
      where: {
        id: instanceId,
        worksheet: { revision: { quote: { projectId, project: { organizationId: this.organizationId } } } },
      },
    });
    if (!instance) throw new Error(`Assembly instance ${instanceId} not found`);

    const items = await this.db.worksheetItem.findMany({
      where: { assemblyInstanceId: instanceId },
      select: { id: true },
    });

    for (const it of items) {
      await this.deleteWorksheetItem(projectId, it.id);
    }
    await this.db.assemblyInstance.delete({ where: { id: instanceId } });

    const { revision } = await this.findCurrentRevision(projectId);
    if (revision) {
      await this.pushActivity(projectId, revision.id, "assembly_instance_deleted", {
        instanceId,
        assemblyId: instance.assemblyId,
        worksheetId: instance.worksheetId,
        itemCount: items.length,
      });
    }
    return { deleted: true, itemCount: items.length };
  }

  async resyncAssemblyInstance(
    projectId: string,
    instanceId: string,
    overrides?: { quantity?: number; parameterValues?: Record<string, number | string>; phaseId?: string | null },
  ): Promise<{ items: WorksheetItem[]; warnings: string[]; instanceId: string; itemCount: number }> {
    await this.requireProject(projectId);
    const instance = await this.db.assemblyInstance.findFirst({
      where: {
        id: instanceId,
        worksheet: { revision: { quote: { projectId, project: { organizationId: this.organizationId } } } },
      },
    });
    if (!instance) throw new Error(`Assembly instance ${instanceId} not found`);
    if (!instance.assemblyId) throw new Error(`Assembly instance ${instanceId} has no source assembly to re-sync from`);

    const nextQuantity = overrides?.quantity ?? instance.quantity;
    const nextParams =
      overrides?.parameterValues !== undefined
        ? overrides.parameterValues
        : ((instance.parameterValues as Record<string, number | string>) ?? {});
    const nextPhase = overrides?.phaseId !== undefined ? overrides.phaseId : instance.phaseId;

    await this.requireAssembly(instance.assemblyId);
    const { assemblyMap, catalogMap, rateMap, laborMap, effectiveCostMap } = await this.buildExpansionContext();
    const expansion = expandAssembly(instance.assemblyId, nextQuantity, nextParams, {
      assemblies: assemblyMap,
      catalogItems: catalogMap,
      rateScheduleItems: rateMap,
      laborUnits: laborMap,
      effectiveCosts: effectiveCostMap,
    });

    // Delete the existing line items for this instance.
    const existing = await this.db.worksheetItem.findMany({
      where: { assemblyInstanceId: instanceId },
      select: { id: true },
    });
    for (const it of existing) {
      await this.deleteWorksheetItem(projectId, it.id);
    }

    // Update the instance with the new parameters / quantity / phase.
    await this.db.assemblyInstance.update({
      where: { id: instanceId },
      data: {
        quantity: nextQuantity,
        parameterValues: (nextParams ?? {}) as any,
        phaseId: nextPhase ?? null,
      },
    });

    const created = await this.expandInstanceIntoWorksheet(
      projectId,
      instance.worksheetId,
      instanceId,
      instance.assemblyId,
      expansion.items,
    );

    const { revision } = await this.findCurrentRevision(projectId);
    if (revision) {
      await this.pushActivity(projectId, revision.id, "assembly_instance_resynced", {
        instanceId,
        assemblyId: instance.assemblyId,
        worksheetId: instance.worksheetId,
        replacedCount: existing.length,
        newCount: created.length,
        quantity: nextQuantity,
        parameterValues: nextParams,
      });
    }

    return { items: created, warnings: expansion.warnings, instanceId, itemCount: created.length };
  }

  // ── Save Selection As Assembly ─────────────────────────────────────────

  async saveSelectionAsAssembly(
    projectId: string,
    worksheetId: string,
    input: { name: string; code?: string; description?: string; category?: string; unit?: string; worksheetItemIds: string[] },
  ): Promise<{ assembly: Assembly; skippedFreeform: number }> {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) throw new Error(`Project ${projectId} has no active revision`);
    const worksheet = await this.db.worksheet.findFirst({ where: { id: worksheetId, revisionId: revision.id } });
    if (!worksheet) throw new Error(`Worksheet ${worksheetId} not found for project ${projectId}`);

    const items = await this.db.worksheetItem.findMany({
      where: { id: { in: input.worksheetItemIds }, worksheetId },
    });
    if (items.length === 0) throw new Error("No worksheet items provided to save as assembly");

    // Fetch ref names + units so we can populate component overrides accurately.
    const catalogIds = items.map((i) => i.itemId).filter((x): x is string => Boolean(x));
    const rateIds = items.map((i) => i.rateScheduleItemId).filter((x): x is string => Boolean(x));
    const [catalogRows, rateRows] = await Promise.all([
      catalogIds.length > 0
        ? this.db.catalogItem.findMany({
            where: { id: { in: catalogIds }, catalog: { organizationId: this.organizationId } },
          })
        : Promise.resolve([]),
      rateIds.length > 0
        ? this.db.rateScheduleItem.findMany({
            where: { id: { in: rateIds }, schedule: { organizationId: this.organizationId } },
          })
        : Promise.resolve([]),
    ]);
    const catalogSet = new Set(catalogRows.map((c) => c.id));
    const rateSet = new Set(rateRows.map((r) => r.id));

    const assembly = await this.db.assembly.create({
      data: {
        id: createId("asm"),
        organizationId: this.organizationId,
        name: input.name.trim() || "New assembly",
        code: input.code ?? "",
        description: input.description ?? "",
        category: input.category ?? "",
        unit: input.unit || "EA",
      },
    });

    let skippedFreeform = 0;
    let sortOrder = 1;
    for (const item of items) {
      let componentType: "catalog_item" | "rate_schedule_item" | null = null;
      let catalogItemId: string | null = null;
      let rateScheduleItemId: string | null = null;
      if (item.itemId && catalogSet.has(item.itemId)) {
        componentType = "catalog_item";
        catalogItemId = item.itemId;
      } else if (item.rateScheduleItemId && rateSet.has(item.rateScheduleItemId)) {
        componentType = "rate_schedule_item";
        rateScheduleItemId = item.rateScheduleItemId;
      } else {
        skippedFreeform++;
        continue;
      }

      await this.db.assemblyComponent.create({
        data: {
          id: createId("ac"),
          assemblyId: assembly.id,
          componentType,
          catalogItemId,
          rateScheduleItemId,
          quantityExpr: String(item.quantity ?? 1),
          description: item.description ?? "",
          category: item.category ?? "",
          uomOverride: item.uom ?? null,
          costOverride: item.cost ?? null,
          markupOverride: item.markup ?? null,
          notes: item.sourceNotes ?? "",
          sortOrder: sortOrder++,
        },
      });
    }

    await this.pushActivity(projectId, revision.id, "assembly_saved_from_selection", {
      assemblyId: assembly.id,
      worksheetId,
      worksheetItemIds: input.worksheetItemIds,
      skippedFreeform,
    });

    const full = await this.db.assembly.findFirst({
      where: { id: assembly.id },
      include: { parameters: true, components: true },
    });
    return { assembly: mapAssembly(full!), skippedFreeform };
  }

  // ── File Node CRUD ─────────────────────────────────────────────────────

  async listFileNodes(projectId: string, parentId?: string | null, scope?: string) {
    await this.requireProject(projectId);
    const where: any = { projectId };
    if (parentId !== undefined) {
      where.parentId = parentId ?? null;
    }
    if (scope) {
      where.scope = scope;
    }
    const nodes = await this.db.fileNode.findMany({ where });
    return nodes.map(mapFileNode);
  }

  async getFileNode(nodeId: string) {
    const node = await this.db.fileNode.findFirst({ where: { id: nodeId } });
    return node ? mapFileNode(node) : null;
  }

  async createFileNode(projectId: string, input: CreateFileNodeInput) {
    await this.requireProject(projectId);

    if (input.parentId) {
      const parent = await this.db.fileNode.findFirst({ where: { id: input.parentId, projectId } });
      if (!parent || parent.type !== "directory") {
        throw new Error(`Parent directory ${input.parentId} not found`);
      }
    }

    const node = await this.db.fileNode.create({
      data: {
        id: createId("fn"),
        projectId,
        parentId: input.parentId ?? null,
        name: input.name,
        type: input.type,
        scope: input.scope ?? "project",
        fileType: input.fileType,
        size: input.size,
        documentId: input.documentId,
        storagePath: input.storagePath,
        metadata: (input.metadata ?? {}) as any,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: input.createdBy,
      },
    });
    return mapFileNode(node);
  }

  async updateFileNode(nodeId: string, patch: FileNodePatchInput) {
    const node = await this.db.fileNode.findFirst({ where: { id: nodeId } });
    if (!node) throw new Error(`File node ${nodeId} not found`);

    if (patch.parentId !== undefined && patch.parentId !== null) {
      const parent = await this.db.fileNode.findFirst({
        where: { id: patch.parentId, projectId: node.projectId },
      });
      if (!parent || parent.type !== "directory") {
        throw new Error(`Parent directory ${patch.parentId} not found`);
      }

      if (node.type === "directory") {
        let current: typeof parent | null = parent;
        while (current) {
          if (current.id === nodeId) {
            throw new Error("Cannot move a directory inside itself");
          }
          current = current.parentId
            ? await this.db.fileNode.findFirst({
                where: { id: current.parentId, projectId: node.projectId },
              })
            : null;
        }
      }
    }

    const data: any = { updatedAt: new Date() };
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.parentId !== undefined) data.parentId = patch.parentId ?? null;
    if (patch.storagePath !== undefined) data.storagePath = patch.storagePath;
    if (patch.fileType !== undefined) data.fileType = patch.fileType;
    if (patch.size !== undefined) data.size = patch.size;
    if (patch.metadata !== undefined) data.metadata = patch.metadata as any;

    const updated = await this.db.fileNode.update({ where: { id: nodeId }, data });
    return mapFileNode(updated);
  }

  async deleteFileNode(nodeId: string) {
    const node = await this.db.fileNode.findFirst({ where: { id: nodeId } });
    if (!node) throw new Error(`File node ${nodeId} not found`);

    // Recursive delete: collect all descendant IDs and their storagePaths
    const toDelete = new Set<string>([nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      const children = await this.db.fileNode.findMany({
        where: { parentId: { in: Array.from(toDelete) } },
        select: { id: true },
      });
      for (const child of children) {
        if (!toDelete.has(child.id)) {
          toDelete.add(child.id);
          changed = true;
        }
      }
    }

    // Gather storagePaths before deleting records
    const nodes = await this.db.fileNode.findMany({
      where: { id: { in: Array.from(toDelete) }, storagePath: { not: null } },
      select: { storagePath: true },
    });

    await this.db.fileNode.deleteMany({ where: { id: { in: Array.from(toDelete) } } });

    // Clean up files on disk
    await Promise.allSettled(
      nodes
        .filter((n) => n.storagePath)
        .map((n) => rm(resolveApiPath(n.storagePath!), { recursive: true, force: true })),
    );

    return { deleted: true };
  }

  async getFileTree(projectId: string, scope?: string) {
    await this.requireProject(projectId);
    const where: any = { projectId };
    if (scope) where.scope = scope;
    const nodes = await this.db.fileNode.findMany({ where });
    return nodes.map(mapFileNode);
  }

  // ── Takeoff Annotation CRUD ──────────────────────────────────────────

  async listTakeoffAnnotations(projectId: string, documentId?: string, pageNumber?: number) {
    await this.requireProject(projectId);
    const where: any = { projectId };
    if (documentId) where.documentId = documentId;
    if (pageNumber !== undefined) where.pageNumber = pageNumber;
    const rows = await this.db.takeoffAnnotation.findMany({ where, orderBy: { createdAt: "asc" } });
    return rows.map(mapTakeoffAnnotation);
  }

  async createTakeoffAnnotation(projectId: string, input: CreateTakeoffAnnotationInput) {
    await this.requireProject(projectId);
    if (!input.documentId) throw new Error("documentId is required");
    if (!input.annotationType) throw new Error("annotationType is required");
    const annotation = await this.db.takeoffAnnotation.create({
      data: {
        id: createId("takeoff"),
        projectId,
        documentId: input.documentId,
        pageNumber: input.pageNumber ?? 1,
        annotationType: input.annotationType,
        label: input.label ?? "",
        color: input.color ?? "#3b82f6",
        lineThickness: input.lineThickness ?? 4,
        visible: input.visible ?? true,
        groupName: input.groupName ?? "",
        points: (input.points ?? []) as any,
        measurement: (input.measurement ?? {}) as any,
        calibration: input.calibration !== undefined ? (input.calibration as any) : undefined,
        metadata: (input.metadata ?? {}) as any,
        createdBy: input.createdBy ?? undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return mapTakeoffAnnotation(annotation);
  }

  async updateTakeoffAnnotation(annotationId: string, patch: TakeoffAnnotationPatchInput) {
    const annotation = await this.db.takeoffAnnotation.findFirst({ where: { id: annotationId } });
    if (!annotation) throw new Error(`Takeoff annotation ${annotationId} not found`);

    const data: any = { updatedAt: new Date() };
    if (patch.label !== undefined) data.label = patch.label;
    if (patch.color !== undefined) data.color = patch.color;
    if (patch.lineThickness !== undefined) data.lineThickness = patch.lineThickness;
    if (patch.visible !== undefined) data.visible = patch.visible;
    if (patch.groupName !== undefined) data.groupName = patch.groupName;
    if (patch.points !== undefined) data.points = patch.points as any;
    if (patch.measurement !== undefined) data.measurement = patch.measurement as any;
    if (patch.calibration !== undefined) data.calibration = patch.calibration as any;
    if (patch.metadata !== undefined) data.metadata = patch.metadata as any;

    const updated = await this.db.takeoffAnnotation.update({ where: { id: annotationId }, data });

    // Live sync: if measurement/points/calibration changed, cascade to linked line items
    if (patch.measurement !== undefined || patch.points !== undefined || patch.calibration !== undefined) {
      await this.syncAnnotationLinks(annotation.projectId, annotationId);
    }

    return mapTakeoffAnnotation(updated);
  }

  async deleteTakeoffAnnotation(annotationId: string) {
    const annotation = await this.db.takeoffAnnotation.findFirst({ where: { id: annotationId } });
    if (!annotation) throw new Error(`Takeoff annotation ${annotationId} not found`);

    // Collect affected line items BEFORE cascade delete removes the links
    const links = await this.db.takeoffLink.findMany({ where: { annotationId } });
    const affectedItemIds = [...new Set(links.map((l) => l.worksheetItemId))];

    await this.db.takeoffAnnotation.delete({ where: { id: annotationId } });

    // Recalculate each affected line item (links are now cascade-deleted)
    for (const itemId of affectedItemIds) {
      await this.recalcLinkedItemQuantity(itemId, annotation.projectId);
    }

    return { deleted: true };
  }

  // ── Takeoff Links ─────────────────────────────────────────────────────────

  async listTakeoffLinks(projectId: string, annotationId?: string, worksheetItemId?: string) {
    await this.requireProject(projectId);
    const where: any = { projectId };
    if (annotationId) where.annotationId = annotationId;
    if (worksheetItemId) where.worksheetItemId = worksheetItemId;
    const rows = await this.db.takeoffLink.findMany({
      where,
      include: { annotation: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r: any) => ({
      ...mapTakeoffLink(r),
      annotation: r.annotation ? mapTakeoffAnnotation(r.annotation) : undefined,
    }));
  }

  async createTakeoffLink(projectId: string, input: CreateTakeoffLinkInput) {
    await this.requireProject(projectId);

    if (!input.annotationId) throw new Error("annotationId is required");
    if (!input.worksheetItemId) throw new Error("worksheetItemId is required");

    // Validate annotation exists and belongs to project
    const annotation = await this.db.takeoffAnnotation.findFirst({
      where: { id: input.annotationId, projectId },
    });
    if (!annotation) throw new Error(`Takeoff annotation ${input.annotationId} not found in project`);

    // Validate worksheet item exists and belongs to project's current revision
    const item = await this.db.worksheetItem.findFirst({ where: { id: input.worksheetItemId } });
    if (!item) throw new Error(`Worksheet item ${input.worksheetItemId} not found`);

    const { revision } = await this.findCurrentRevision(projectId);
    if (revision) {
      const worksheet = await this.db.worksheet.findFirst({ where: { id: item.worksheetId } });
      if (!worksheet || worksheet.revisionId !== revision.id) {
        throw new Error(`Worksheet item ${input.worksheetItemId} not in current revision`);
      }
    }

    const quantityField = input.quantityField ?? "value";
    const multiplier = input.multiplier ?? 1.0;

    // Extract measurement value
    const measurement = (annotation.measurement as Record<string, unknown>) ?? {};
    const rawValue = Number(measurement[quantityField] ?? measurement.value ?? 0) || 0;
    const derivedQuantity = rawValue * multiplier;

    const link = await this.db.takeoffLink.create({
      data: {
        id: createId("tlink"),
        projectId,
        annotationId: input.annotationId,
        worksheetItemId: input.worksheetItemId,
        quantityField,
        multiplier,
        derivedQuantity,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await this.recalcLinkedItemQuantity(input.worksheetItemId, projectId);

    return mapTakeoffLink(link);
  }

  async updateTakeoffLink(linkId: string, patch: UpdateTakeoffLinkInput) {
    const link = await this.db.takeoffLink.findFirst({ where: { id: linkId } });
    if (!link) throw new Error(`Takeoff link ${linkId} not found`);

    const quantityField = patch.quantityField ?? link.quantityField;
    const multiplier = patch.multiplier ?? link.multiplier;

    // Re-fetch annotation to get current measurement
    const annotation = await this.db.takeoffAnnotation.findFirst({ where: { id: link.annotationId } });
    const measurement = (annotation?.measurement as Record<string, unknown>) ?? {};
    const rawValue = Number(measurement[quantityField] ?? measurement.value ?? 0) || 0;
    const derivedQuantity = rawValue * multiplier;

    const updated = await this.db.takeoffLink.update({
      where: { id: linkId },
      data: {
        quantityField,
        multiplier,
        derivedQuantity,
        updatedAt: new Date(),
      },
    });

    await this.recalcLinkedItemQuantity(link.worksheetItemId, link.projectId);

    return mapTakeoffLink(updated);
  }

  async deleteTakeoffLink(linkId: string) {
    const link = await this.db.takeoffLink.findFirst({ where: { id: linkId } });
    if (!link) throw new Error(`Takeoff link ${linkId} not found`);

    const { worksheetItemId, projectId } = link;
    await this.db.takeoffLink.delete({ where: { id: linkId } });

    // Recalculate item quantity from remaining links
    await this.recalcLinkedItemQuantity(worksheetItemId, projectId);

    return { deleted: true };
  }

  /** Recompute all TakeoffLinks for an annotation and cascade to affected line items */
  private async syncAnnotationLinks(projectId: string, annotationId: string) {
    const annotation = await this.db.takeoffAnnotation.findFirst({ where: { id: annotationId } });
    if (!annotation) return;

    const links = await this.db.takeoffLink.findMany({ where: { annotationId } });
    if (links.length === 0) return;

    const measurement = (annotation.measurement as Record<string, unknown>) ?? {};
    const affectedItemIds = new Set<string>();

    for (const link of links) {
      const rawValue = Number(measurement[link.quantityField] ?? measurement.value ?? 0) || 0;
      const derivedQuantity = rawValue * link.multiplier;
      await this.db.takeoffLink.update({
        where: { id: link.id },
        data: { derivedQuantity, updatedAt: new Date() },
      });
      affectedItemIds.add(link.worksheetItemId);
    }

    for (const itemId of affectedItemIds) {
      await this.recalcLinkedItemQuantity(itemId, projectId);
    }
  }

  /** Sum all TakeoffLink.derivedQuantity for a WorksheetItem and recalculate its cost/price */
  private async recalcLinkedItemQuantity(worksheetItemId: string, projectId: string) {
    const links = await this.db.takeoffLink.findMany({ where: { worksheetItemId } });
    const totalQuantity = links.reduce((sum, l) => sum + l.derivedQuantity, 0);

    const item = await this.db.worksheetItem.findFirst({ where: { id: worksheetItemId } });
    if (!item) return;

    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return;

    const entityCats = await this.db.entityCategory.findMany({ where: { organizationId: this.organizationId } });
    const catDef = resolveEntityCategoryForItemInput(entityCats, {
      categoryId: (item as any).categoryId ?? null,
      category: item.category,
      entityType: item.entityType,
    });

    const revisionSchedules = await this.db.rateSchedule.findMany({
      where: { revisionId: revision.id },
      include: { tiers: true, items: true },
    });
    const rateScheduleCtx = toRateScheduleCalcContext(revisionSchedules);

    const calcType = (catDef?.calculationType ?? "manual") as import("@bidwright/domain").CalculationType;

    const domainItem = mapWorksheetItem(item);
    domainItem.quantity = totalQuantity;
    const calculated = calculateLineItem(domainItem, mapRevision(revision), calcType, rateScheduleCtx);
    Object.assign(domainItem, calculated);

    await this.db.worksheetItem.update({
      where: { id: worksheetItemId },
      data: {
        quantity: domainItem.quantity,
        cost: domainItem.cost,
        markup: domainItem.markup,
        price: domainItem.price,
      },
    });

    await this.syncProjectEstimate(projectId);
  }

  async listAllJobs() {
    const jobs = await this.db.job.findMany({
      where: { project: { organizationId: this.organizationId } },
    });
    return jobs.map(mapJob);
  }

  async listProjectJobs(projectId: string) {
    await this.requireProject(projectId);
    const jobs = await this.db.job.findMany({ where: { projectId } });
    return jobs.map(mapJob);
  }

  // ── Import BOM (preview + process) ─────────────────────────────────────

  parseCSV(csvText: string): { headers: string[]; rows: string[][] } {
    const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      return { headers: [], rows: [] };
    }

    const firstLine = lines[0];
    const tabCount = (firstLine.match(/\t/g) ?? []).length;
    const commaCount = (firstLine.match(/,/g) ?? []).length;
    const delimiter = tabCount > commaCount ? "\t" : ",";

    const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, ""));
    const rows = lines.slice(1).map((line) =>
      line.split(delimiter).map((cell) => cell.trim().replace(/^["']|["']$/g, ""))
    );

    return { headers, rows };
  }

  storeImportPreview(fileId: string, data: { headers: string[]; rows: string[][] }) {
    this.importCache.set(fileId, data);
  }

  getImportPreview(fileId: string) {
    return this.importCache.get(fileId) ?? null;
  }

  clearImportPreview(fileId: string) {
    this.importCache.delete(fileId);
  }

  async processImport(projectId: string, worksheetId: string, fileId: string, mapping: Record<string, string>) {
    const cached = this.getImportPreview(fileId);
    if (!cached) throw new Error(`Import file ${fileId} not found or expired`);

    const { headers, rows } = cached;
    const getColumn = (mappedField: string): number => {
      const headerName = mapping[mappedField];
      if (!headerName) return -1;
      return headers.indexOf(headerName);
    };
    const readCell = (row: string[], mappedField: string): string => {
      const index = getColumn(mappedField);
      return index >= 0 ? row[index] ?? "" : "";
    };
    const parseNumber = (value: string, fallback = 0): number => {
      const cleaned = String(value ?? "").replace(/[$,\s]/g, "");
      const parsed = Number.parseFloat(cleaned);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const parseMarkup = (value: string, fallback = 0.2): number => {
      if (!value) return fallback;
      const cleaned = String(value).trim();
      const parsed = parseNumber(cleaned.replace(/%$/, ""), fallback);
      if (!Number.isFinite(parsed)) return fallback;
      if (cleaned.endsWith("%")) return parsed / 100;
      return parsed > 1 ? parsed / 100 : parsed;
    };

    for (const row of rows) {
      const description = readCell(row, "description");
      const entityName = readCell(row, "entityName") || description;
      if (!entityName) continue;

      const category = readCell(row, "category") || "Material";
      const entityType = readCell(row, "entityType") || category || "Material";
      const lineOrder = parseNumber(readCell(row, "lineOrder"), Number.NaN);

      const input: CreateWorksheetItemInput = {
        category,
        entityType,
        entityName,
        vendor: readCell(row, "vendor") || undefined,
        description,
        quantity: parseNumber(readCell(row, "quantity"), 1) || 1,
        uom: readCell(row, "uom") || "EA",
        cost: parseNumber(readCell(row, "cost"), 0),
        markup: parseMarkup(readCell(row, "markup"), 0.2),
        price: parseNumber(readCell(row, "price"), 0),
        ...(Number.isFinite(lineOrder) ? { lineOrder } : {}),
      };

      await this.createWorksheetItem(projectId, worksheetId, input);
    }

    this.clearImportPreview(fileId);
  }

  // ── Plugin CRUD ────────────────────────────────────────────────────────

  async listPlugins() {
    const plugins = await this.db.plugin.findMany({ where: { organizationId: this.organizationId } });
    return plugins.map(mapPlugin);
  }

  async getPlugin(pluginId: string) {
    const plugin = await this.db.plugin.findFirst({ where: { id: pluginId, organizationId: this.organizationId } });
    return plugin ? mapPlugin(plugin) : null;
  }

  async getPluginBySlug(slug: string) {
    const plugin = await this.db.plugin.findFirst({ where: { slug, organizationId: this.organizationId } });
    return plugin ? mapPlugin(plugin) : null;
  }

  async createPlugin(input: CreatePluginInput) {
    const plugin = await this.db.plugin.create({
      data: {
        id: createId("plugin"),
        organizationId: this.organizationId,
        name: input.name,
        slug: input.slug,
        icon: input.icon,
        category: input.category,
        description: input.description,
        llmDescription: input.llmDescription,
        version: input.version,
        author: input.author,
        enabled: input.enabled,
        config: (input.config ?? {}) as any,
        configSchema: input.configSchema as any,
        toolDefinitions: (input.toolDefinitions ?? []) as any,
        defaultOutputType: input.defaultOutputType,
        supportedCategories: input.supportedCategories ?? [],
        tags: input.tags ?? [],
        documentation: input.documentation,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return mapPlugin(plugin);
  }

  async updatePlugin(pluginId: string, patch: PluginPatchInput) {
    const plugin = await this.db.plugin.findFirst({ where: { id: pluginId, organizationId: this.organizationId } });
    if (!plugin) throw new Error(`Plugin ${pluginId} not found`);

    const data: any = { updatedAt: new Date() };
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.enabled !== undefined) data.enabled = patch.enabled;
    if (patch.config !== undefined) data.config = { ...(plugin.config as any), ...patch.config };
    if (patch.configSchema !== undefined) data.configSchema = patch.configSchema as any;
    if (patch.toolDefinitions !== undefined) data.toolDefinitions = patch.toolDefinitions as any;
    if (patch.tags !== undefined) data.tags = patch.tags;
    if (patch.supportedCategories !== undefined) data.supportedCategories = patch.supportedCategories;
    if (patch.defaultOutputType !== undefined) data.defaultOutputType = patch.defaultOutputType;
    if (patch.llmDescription !== undefined) data.llmDescription = patch.llmDescription;
    if (patch.documentation !== undefined) data.documentation = patch.documentation;
    if (patch.icon !== undefined) data.icon = patch.icon;
    if (patch.author !== undefined) data.author = patch.author;

    const updated = await this.db.plugin.update({ where: { id: pluginId }, data });
    return mapPlugin(updated);
  }

  async deletePlugin(pluginId: string) {
    const plugin = await this.db.plugin.findFirst({ where: { id: pluginId, organizationId: this.organizationId } });
    if (!plugin) throw new Error(`Plugin ${pluginId} not found`);
    await this.db.pluginExecution.deleteMany({ where: { pluginId } });
    await this.db.plugin.delete({ where: { id: pluginId } });
    return mapPlugin(plugin);
  }

  private async replacePluginExecutionLineItems(
    projectId: string,
    revision: any,
    execution: any,
    lineItems: PluginOutputLineItem[],
    worksheetId?: string,
  ) {
    const storedItemIds = Array.isArray(execution.appliedLineItemIds)
      ? execution.appliedLineItemIds.filter(
          (value: unknown): value is string => typeof value === "string" && value.length > 0,
        )
      : [];

    const existingRows = storedItemIds.length > 0
      ? await this.db.worksheetItem.findMany({ where: { id: { in: storedItemIds } } })
      : [];
    const existingById = new Map(existingRows.map((row) => [row.id, row]));
    const orderedExisting = storedItemIds
      .map((itemId: string) => existingById.get(itemId))
      .filter(
        (row: ((typeof existingRows)[number] | undefined)): row is (typeof existingRows)[number] =>
          Boolean(row),
      );

    let resolvedWorksheetId =
      worksheetId ??
      execution.worksheetId ??
      orderedExisting[0]?.worksheetId ??
      await this._resolveDefaultWorksheetId(projectId, revision.id);

    const resolvedWorksheet = await this.db.worksheet.findFirst({ where: { id: resolvedWorksheetId } });
    if (!resolvedWorksheet || resolvedWorksheet.revisionId !== revision.id) {
      resolvedWorksheetId = await this._resolveDefaultWorksheetId(projectId, revision.id);
    }

    const maxOrder = await this.db.worksheetItem.aggregate({
      where: { worksheetId: resolvedWorksheetId },
      _max: { lineOrder: true },
    });
    let nextLineOrder = (maxOrder._max.lineOrder ?? 0) + 1;

    const revisionSchedules = await this.db.rateSchedule.findMany({
      where: { revisionId: revision.id },
      include: { tiers: true, items: true },
    });
    const rateScheduleCtx = toRateScheduleCalcContext(revisionSchedules);
    const entityCategories = await this.db.entityCategory.findMany({
      where: { organizationId: this.organizationId },
    });
    const mappedRevision = mapRevision(revision);
    const appliedLineItemIds: string[] = [];

	  for (let index = 0; index < lineItems.length; index += 1) {
	    const sourceItem = lineItems[index];
	    const existing = orderedExisting[index];
	    const preserveLineOrder = existing?.worksheetId === resolvedWorksheetId;
      const categoryDef = resolveEntityCategoryForItemInput(entityCategories, {
        categoryId: (sourceItem as any).categoryId ?? null,
        category: sourceItem.category,
        entityType: sourceItem.entityType,
      });
      if (!categoryDef) {
        throw new Error(`Plugin line item "${sourceItem.entityName}" has an unknown category "${sourceItem.category}".`);
      }

	    const domainItem: WorksheetItem = {
	      id: existing?.id ?? createId("li"),
	      worksheetId: resolvedWorksheetId,
	      phaseId: sourceItem.phaseId ?? null,
	      categoryId: categoryDef.id,
	      category: categoryDef.name,
	      entityType: categoryDef.entityType,
        entityName: sourceItem.entityName,
        vendor: sourceItem.vendor ?? undefined,
        description: sourceItem.description,
        quantity: sourceItem.quantity,
        uom: sourceItem.uom,
        cost: sourceItem.cost ?? 0,
        markup: sourceItem.markup ?? 0,
        price: sourceItem.price ?? 0,
        lineOrder: preserveLineOrder ? existing.lineOrder : nextLineOrder++,
        rateScheduleItemId: sourceItem.rateScheduleItemId ?? null,
        itemId: sourceItem.itemId ?? null,
        tierUnits: sourceItem.tierUnits ?? {},
        sourceNotes: sourceItem.sourceNotes ?? "",
        costResourceId: sourceItem.costResourceId ?? null,
        effectiveCostId: sourceItem.effectiveCostId ?? null,
        laborUnitId: sourceItem.laborUnitId ?? null,
        resourceComposition: sourceItem.resourceComposition ?? {},
        sourceEvidence: sourceItem.sourceEvidence ?? {},
      };
      await this.validateWorksheetItemProvenanceRefs(domainItem);

	    const calcType = (categoryDef?.calculationType ?? "manual") as import("@bidwright/domain").CalculationType;
      const itemSource = categoryDef?.itemSource ?? "freeform";

      if (domainItem.rateScheduleItemId) {
        const allRateScheduleItems = revisionSchedules.flatMap((schedule) => schedule.items ?? []);
        const match = allRateScheduleItems.find((candidate) => candidate.id === domainItem.rateScheduleItemId);
        if (!match) {
          throw new Error(
            `Invalid rateScheduleItemId "${domainItem.rateScheduleItemId}" - no matching rate schedule item found in this revision.`,
          );
        }
      } else if (itemSource === "rate_schedule") {
        throw new Error(
          `Category "${domainItem.category}" requires a rateScheduleItemId (itemSource=rate_schedule).`,
        );
      }

      if (domainItem.itemId) {
        const catalogItem = await this.db.catalogItem.findFirst({ where: { id: domainItem.itemId } });
        if (!catalogItem) {
          throw new Error(`Invalid itemId "${domainItem.itemId}" - no matching catalog item found.`);
        }
      }

      if (domainItem.tierUnits && Object.keys(domainItem.tierUnits).length > 0) {
        domainItem.tierUnits = resolveTierUnitKeys(domainItem.tierUnits, revisionSchedules);
      }

      const calculated = calculateLineItem(
        domainItem,
        mappedRevision,
        calcType,
        rateScheduleCtx,
      );
      Object.assign(domainItem, calculated);

      if (existing) {
        const updated = await this.db.worksheetItem.update({
          where: { id: existing.id },
	          data: {
	            worksheetId: domainItem.worksheetId,
	            phaseId: domainItem.phaseId,
	            categoryId: domainItem.categoryId!,
	            category: domainItem.category,
            entityType: domainItem.entityType,
            entityName: domainItem.entityName,
            classification: (domainItem.classification ?? {}) as Prisma.InputJsonValue,
            costCode: domainItem.costCode ?? null,
            vendor: domainItem.vendor ?? null,
            description: domainItem.description,
            quantity: domainItem.quantity,
            uom: domainItem.uom,
            cost: domainItem.cost,
            markup: domainItem.markup,
            price: domainItem.price,
            lineOrder: domainItem.lineOrder,
            rateScheduleItemId: domainItem.rateScheduleItemId ?? null,
            itemId: domainItem.itemId ?? null,
            tierUnits: domainItem.tierUnits ?? {},
            rateResolution: toPrismaJson(domainItem.rateResolution ?? {}),
            sourceNotes: domainItem.sourceNotes ?? "",
            costResourceId: domainItem.costResourceId ?? null,
            effectiveCostId: domainItem.effectiveCostId ?? null,
            laborUnitId: domainItem.laborUnitId ?? null,
            resourceComposition: toPrismaJson(domainItem.resourceComposition ?? {}),
            sourceEvidence: toPrismaJson(domainItem.sourceEvidence ?? {}),
          } as any,
        });

        await this.pushActivity(projectId, revision.id, "item_updated", {
          itemId: updated.id,
          entityName: domainItem.entityName,
          patch: ["plugin_execution"],
          before: mapWorksheetItem(existing),
          after: mapWorksheetItem(updated),
        });

        appliedLineItemIds.push(updated.id);
        continue;
      }

	      const created = await this.db.worksheetItem.create({
	        data: {
	          id: domainItem.id,
	          worksheetId: domainItem.worksheetId,
	          phaseId: domainItem.phaseId,
	          categoryId: domainItem.categoryId!,
	          category: domainItem.category,
          entityType: domainItem.entityType,
          entityName: domainItem.entityName,
          classification: (domainItem.classification ?? {}) as Prisma.InputJsonValue,
          costCode: domainItem.costCode ?? null,
          vendor: domainItem.vendor ?? null,
          description: domainItem.description,
          quantity: domainItem.quantity,
          uom: domainItem.uom,
          cost: domainItem.cost,
          markup: domainItem.markup,
          price: domainItem.price,
          lineOrder: domainItem.lineOrder,
          rateScheduleItemId: domainItem.rateScheduleItemId ?? null,
          itemId: domainItem.itemId ?? null,
          tierUnits: domainItem.tierUnits ?? {},
          rateResolution: toPrismaJson(domainItem.rateResolution ?? {}),
          sourceNotes: domainItem.sourceNotes ?? "",
          costResourceId: domainItem.costResourceId ?? null,
          effectiveCostId: domainItem.effectiveCostId ?? null,
          laborUnitId: domainItem.laborUnitId ?? null,
          resourceComposition: toPrismaJson(domainItem.resourceComposition ?? {}),
          sourceEvidence: toPrismaJson(domainItem.sourceEvidence ?? {}),
        } as any,
      });

      await this.pushActivity(projectId, revision.id, "item_created", {
        itemId: created.id,
        entityName: domainItem.entityName,
        category: domainItem.category,
        before: null,
        after: mapWorksheetItem(created),
      });

      appliedLineItemIds.push(created.id);
    }

    for (const staleRow of orderedExisting.slice(lineItems.length)) {
      await this.db.worksheetItem.delete({ where: { id: staleRow.id } });
      await this.pushActivity(projectId, revision.id, "item_deleted", {
        itemId: staleRow.id,
        entityName: staleRow.entityName,
        before: mapWorksheetItem(staleRow),
        after: null,
      });
    }

    if (lineItems.length > 0 || orderedExisting.length > 0) {
      await this.syncProjectEstimate(projectId);
    }

    return {
      appliedLineItemIds,
      worksheetId: resolvedWorksheetId,
      previousCount: orderedExisting.length,
    };
  }

  async executePlugin(
    pluginId: string,
    toolId: string,
    projectId: string,
    revisionId: string,
    input: Record<string, unknown>,
    opts?: {
      worksheetId?: string;
      replaceExecutionId?: string;
      formState?: Record<string, unknown>;
      executedBy?: "user" | "agent";
      agentSessionId?: string;
    },
  ) {
    const plugin = await this.db.plugin.findFirst({ where: { id: pluginId, organizationId: this.organizationId } });
    if (!plugin) throw new Error(`Plugin ${pluginId} not found`);
    if (!plugin.enabled) throw new Error(`Plugin ${plugin.name} is disabled`);
    await this.requireProject(projectId);

    const toolDefs = (plugin.toolDefinitions as any[]) ?? [];
    const toolDef = toolDefs.find((t: any) => t.id === toolId);
    if (!toolDef) throw new Error(`Tool ${toolId} not found in plugin ${plugin.name}`);

    const missingParams = (toolDef.parameters ?? [])
      .filter((p: any) => p.required && !(p.name in input))
      .map((p: any) => p.name);
    if (missingParams.length > 0) {
      throw new Error(`Missing required parameters: ${missingParams.join(", ")}`);
    }

    const outputType = toolDef.outputType ?? plugin.defaultOutputType ?? "summary";
    const toolName = toolDef.name ?? plugin.name;
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
    if (!revision) {
      throw new Error(`Revision ${revisionId} not found`);
    }
    const replacementExecution = opts?.replaceExecutionId
      ? await this.db.pluginExecution.findFirst({
          where: {
            id: opts.replaceExecutionId,
            projectId,
            pluginId,
            toolId,
          },
        })
      : null;
    if (opts?.replaceExecutionId && !replacementExecution) {
      throw new Error("Plugin execution to reopen was not found for this project.");
    }
    const builtinOutput = await executeBuiltinPluginTool({
      plugin: mapPlugin(plugin),
      toolId,
      input,
      formState: opts?.formState,
      revisionDifficulty: revision?.laborDifficulty ?? undefined,
      lookupDatasetRows: async (datasetRef) => {
        const resolved = await this._resolveDatasetRecordForRead(datasetRef);
        if (!resolved) {
          return [];
        }
        const rows = await resolved.client.datasetRow.findMany({
          where: { datasetId: resolved.dataset.id },
          orderBy: { order: "asc" },
        });
        return rows.map((row) => (row.data as Record<string, unknown>) ?? {});
      },
      lookupDatasetColumns: async (datasetRef) => {
        const resolved = await this._resolveDatasetRecordForRead(datasetRef);
        return resolved ? ((resolved.dataset.columns as DatasetColumn[]) ?? []) : [];
      },
      resolveRateScheduleItem: async (rateScheduleItemId) => {
        const match = await this.db.rateScheduleItem.findFirst({
          where: { id: rateScheduleItemId, schedule: { revisionId, organizationId: this.organizationId } },
          include: { schedule: { include: { tiers: true } } },
        });
        if (!match) return null;
        const category = match.schedule?.category ?? "";
        const regularTier = match.schedule?.tiers?.find((t) => t.multiplier === 1);
        const entityCategory = category
          ? await this.db.entityCategory.findFirst({
              where: {
                organizationId: this.organizationId,
                enabled: true,
                OR: [
                  { entityType: category },
                  { name: category },
                  { id: category },
                ],
              },
              select: { entityType: true, name: true },
            })
          : null;
        return {
          id: match.id,
          name: match.name,
          category: entityCategory?.name ?? category,
          entityCategoryType: entityCategory?.entityType ?? category,
          regularTierId: regularTier?.id,
        };
      },
      lookupLaborUnit: async (providerLabel, labourInput) => {
        return this.resolveLaborUnitByHierarchy(providerLabel, labourInput);
      },
    });

    const output: PluginOutput = builtinOutput ?? { type: outputType, displayText: `Executed ${toolName} with provided input`, appliedEffects: [] };
    output.appliedEffects = output.appliedEffects ?? [];
    const appliedItemIds: string[] = [];

    if (!builtinOutput) {
      switch (outputType) {
      case "line_items":
        output.lineItems = (input.items as PluginOutputLineItem[] | undefined) ?? [];
        output.summary = { title: toolName, sections: [{ label: "Line items", value: String(output.lineItems.length), format: "number" as const }] };
        break;
      case "worksheet":
        output.worksheet = { name: (input.worksheetName as string) ?? toolName, items: (input.items as PluginOutputLineItem[] | undefined) ?? [] };
        output.summary = { title: toolName, sections: [{ label: "Worksheet", value: output.worksheet.name, format: "text" as const }] };
        break;
      case "text_content":
        output.textContent = { targetField: (input.targetField as string) ?? "revision.notes", content: (input.content as string) ?? "", format: (input.format as any) ?? "plain", mode: (input.mode as any) ?? "append" };
        output.summary = { title: toolName, sections: [{ label: "Target", value: output.textContent.targetField, format: "text" as const }, { label: "Format", value: output.textContent.format, format: "text" as const }] };
        break;
      case "revision_patch":
        output.revisionPatches = (input.patches as PluginOutputRevisionPatch[] | undefined) ?? [];
        output.summary = { title: toolName, sections: output.revisionPatches.map((p) => ({ label: p.field, value: String(p.value), format: "text" as const })) };
        break;
      case "modifier":
        output.modifier = (input.modifier as PluginOutputModifier | undefined) ?? {
          name: (input.name as string) ?? toolName,
          type: (input.modifierType as "percentage" | "amount") ?? "percentage",
          appliesTo: (input.appliesTo as string) ?? "All",
          percentage: input.percentage as number | undefined,
          amount: input.amount as number | undefined,
          show: (input.show as "Yes" | "No") ?? "Yes",
        };
        output.summary = { title: toolName, sections: [
          { label: "Modifier", value: output.modifier.name, format: "text" as const },
          { label: "Type", value: output.modifier.type, format: "text" as const },
          ...(output.modifier.percentage != null ? [{ label: "Percentage", value: `${(output.modifier.percentage * 100).toFixed(1)}%`, format: "text" as const }] : []),
          ...(output.modifier.amount != null ? [{ label: "Amount", value: String(output.modifier.amount), format: "currency" as const }] : []),
        ] };
        break;
      case "score":
        output.scores = (input.scores as PluginOutputScore[] | undefined) ?? [];
        const scoringState = (opts?.formState?.scoringData ?? opts?.formState?._scores) as Record<string, Record<string, number>> | undefined;
        if (output.scores.length === 0 && scoringState) {
          const scoringData = scoringState;
          const uiSections = (toolDef.ui?.sections ?? []) as any[];
          for (const section of uiSections) {
            if (section.type !== "scoring" || !section.scoring) continue;
            const scoring = section.scoring as any;
            const scores = scoringData[scoring.id];
            if (!scores) continue;
            for (const criterion of (scoring.criteria ?? []) as any[]) {
              output.scores.push({
                criterionId: criterion.id, label: criterion.label,
                score: scores[criterion.id] ?? criterion.scale?.min ?? 0,
                maxScore: criterion.scale?.max ?? 10, weight: criterion.weight ?? 1,
              });
            }
          }
        }
        output.summary = { title: toolName, sections: output.scores.map((s) => ({ label: s.label, value: `${s.score}/${s.maxScore}`, format: "text" as const })) };
        break;
      case "composite":
        output.children = (input.children as PluginOutput[] | undefined) ?? [];
        output.summary = { title: toolName, sections: [{ label: "Outputs", value: String(output.children.length), format: "number" as const }] };
        break;
      case "summary":
      default:
        output.summary = { title: toolName, sections: Object.entries(input).map(([k, v]) => ({ label: k, value: String(v), format: "text" as const })) };
        break;
      }
    }

    // ── Apply effects to the quote ────────────────────────────────────

    if (output.lineItems) {
      if (replacementExecution) {
        const replacementResult = await this.replacePluginExecutionLineItems(
          projectId,
          revision,
          replacementExecution,
          output.lineItems,
          opts?.worksheetId,
        );
        appliedItemIds.push(...replacementResult.appliedLineItemIds);
        output.appliedEffects!.push({
          type: "line_items",
          description:
            replacementResult.appliedLineItemIds.length > 0
              ? `Updated ${replacementResult.appliedLineItemIds.length} linked line item(s)`
              : `Removed ${replacementResult.previousCount} linked line item(s)`,
        });
        opts = {
          ...opts,
          worksheetId: replacementResult.worksheetId,
        };
      } else if (output.lineItems.length > 0) {
        const wsId = opts?.worksheetId ?? await this._resolveDefaultWorksheetId(projectId, revisionId);
        for (const item of output.lineItems) {
          const created = await this.createWorksheetItem(projectId, wsId, {
            category: item.category, entityType: item.entityType, entityName: item.entityName,
            vendor: item.vendor ?? null, description: item.description,
            quantity: item.quantity, uom: item.uom, cost: item.cost ?? 0,
            markup: item.markup ?? 0, price: item.price ?? 0,
            rateScheduleItemId: item.rateScheduleItemId ?? null,
            itemId: item.itemId ?? null,
            costResourceId: item.costResourceId ?? null,
            effectiveCostId: item.effectiveCostId ?? null,
            laborUnitId: item.laborUnitId ?? null,
            tierUnits: item.tierUnits,
            sourceNotes: item.sourceNotes,
            resourceComposition: item.resourceComposition ?? {},
            sourceEvidence: item.sourceEvidence ?? {},
          });
          appliedItemIds.push(created.id);
        }
        output.appliedEffects!.push({ type: "line_items", description: `Created ${output.lineItems.length} line item(s)` });
      }
    }

    if (output.worksheet) {
      const ws = await this.createWorksheet(projectId, { name: output.worksheet.name });
      for (const item of output.worksheet.items) {
        const created = await this.createWorksheetItem(projectId, ws.id, {
          category: item.category, entityType: item.entityType, entityName: item.entityName,
          vendor: item.vendor ?? null, description: item.description,
          quantity: item.quantity, uom: item.uom, cost: item.cost ?? 0,
          markup: item.markup ?? 0, price: item.price ?? 0,
          rateScheduleItemId: item.rateScheduleItemId ?? null,
          itemId: item.itemId ?? null,
          costResourceId: item.costResourceId ?? null,
          effectiveCostId: item.effectiveCostId ?? null,
          laborUnitId: item.laborUnitId ?? null,
          tierUnits: item.tierUnits,
          sourceNotes: item.sourceNotes,
          resourceComposition: item.resourceComposition ?? {},
          sourceEvidence: item.sourceEvidence ?? {},
        });
        appliedItemIds.push(created.id);
      }
      output.appliedEffects!.push({ type: "worksheet", description: `Created worksheet "${output.worksheet.name}" with ${output.worksheet.items.length} item(s)` });
    }

    if (output.textContent) {
      const tc = output.textContent;
      const fieldMap: Record<string, string> = {
        "revision.notes": "notes", "revision.scratchpad": "scratchpad",
        "revision.leadLetter": "leadLetter", "revision.description": "description",
      };
      const dbField = fieldMap[tc.targetField] ?? tc.targetField.replace("revision.", "");
      const rev = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
      if (rev) {
        const existing = (rev as any)[dbField] as string ?? "";
        let newValue: string;
        if (tc.mode === "replace") newValue = tc.content;
        else if (tc.mode === "prepend") newValue = tc.content + (existing ? "\n" + existing : "");
        else newValue = (existing ? existing + "\n" : "") + tc.content;
        await this.updateRevision(projectId, revisionId, { [dbField]: newValue } as any);
        output.appliedEffects!.push({ type: "text_content", description: `${tc.mode} to ${tc.targetField}` });
      }
    }

    if (output.revisionPatches && output.revisionPatches.length > 0) {
      const patch: Record<string, unknown> = {};
      for (const p of output.revisionPatches) patch[p.field] = p.value;
      await this.updateRevision(projectId, revisionId, patch as any);
      output.appliedEffects!.push({ type: "revision_patch", description: `Patched ${output.revisionPatches.map((p) => p.field).join(", ")}` });
    }

    if (output.modifier) {
      const m = output.modifier;
      await this.createModifier(projectId, revisionId, {
        name: m.name, type: m.type, appliesTo: m.appliesTo,
        percentage: m.percentage ?? null, amount: m.amount ?? null, show: m.show,
      });
      output.appliedEffects!.push({ type: "modifier", description: `Created modifier "${m.name}"` });
    }

    if (output.scores && output.scores.length > 0) {
      const uiSections = (toolDef.ui?.sections ?? []) as any[];
      for (const section of uiSections) {
        if (section.type !== "scoring" || !section.scoring) continue;
        const scoring = section.scoring as any;
        const outputEffect = scoring.outputEffect;
        const outputField = scoring.outputField;

        let totalWeighted = 0, totalMaxWeighted = 0;
        for (const criterion of (scoring.criteria ?? []) as any[]) {
          const s = output.scores.find((sc) => sc.criterionId === criterion.id);
          if (!s) continue;
          totalWeighted += s.score * (criterion.weight ?? 1);
          totalMaxWeighted += (criterion.scale?.max ?? 10) * (criterion.weight ?? 1);
        }
        const pct = totalMaxWeighted > 0 ? (totalWeighted / totalMaxWeighted) * 100 : 0;

        const resultBand = (scoring.resultMapping ?? []).find(
          (r: any) => pct >= r.minScore && pct <= r.maxScore
        );
        if (!resultBand) continue;
        const resolvedValue = resultBand.value;

        if (outputEffect) {
          const effect = outputEffect as any;
          if ((effect.type === "revision_patch" || effect.type === "both") && effect.revisionField) {
            const numVal = Number(resolvedValue);
            await this.updateRevision(projectId, revisionId, { [effect.revisionField]: Number.isFinite(numVal) ? numVal : resolvedValue } as any);
            output.appliedEffects!.push({ type: "scoring_patch", description: `Set ${effect.revisionField} = ${resolvedValue} (band: ${resultBand.label})` });
          }
          if ((effect.type === "modifier" || effect.type === "both") && effect.modifier) {
            const modCfg = effect.modifier;
            const pctVal = Number(resolvedValue);
            await this.createModifier(projectId, revisionId, {
              name: modCfg.name ?? `${toolName} Factor`, type: "percentage",
              appliesTo: modCfg.appliesTo ?? "All",
              percentage: Number.isFinite(pctVal) ? pctVal : 0, show: modCfg.show ?? "Yes",
            });
            output.appliedEffects!.push({ type: "scoring_modifier", description: `Created modifier "${modCfg.name}" at ${(pctVal * 100).toFixed(1)}% (band: ${resultBand.label})` });
          }
        } else if (outputField) {
          const numVal = Number(resolvedValue);
          await this.updateRevision(projectId, revisionId, { [outputField]: Number.isFinite(numVal) ? numVal : resolvedValue } as any);
          output.appliedEffects!.push({ type: "scoring_patch", description: `Set ${outputField} = ${resolvedValue} (band: ${resultBand.label})` });
        }

        output.summary?.sections.push(
          { label: "Score", value: `${pct.toFixed(1)}%`, format: "percentage" as const },
          { label: "Result", value: resultBand.label, format: "text" as const },
        );
      }
    }

    // ── Persist execution ─────────────────────────────────────────────

    const executionData = {
      pluginId,
      toolId,
      projectId,
      revisionId,
      worksheetId: opts?.worksheetId,
      input: input as any,
      formState: opts?.formState as any,
      output: output as any,
      appliedLineItemIds: appliedItemIds,
      status: "complete" as const,
      executedBy: opts?.executedBy ?? "user",
      agentSessionId: opts?.agentSessionId,
    };

    const execution = replacementExecution
      ? await this.db.pluginExecution.update({
          where: { id: replacementExecution.id },
          data: executionData,
        })
      : await this.db.pluginExecution.create({
          data: {
            id: createId("pexec"),
            ...executionData,
            createdAt: new Date(),
          },
        });

    return mapPluginExecution(execution);
  }

  /** Resolve the first worksheet for a revision, or create one. */
  private async _resolveDefaultWorksheetId(projectId: string, revisionId: string): Promise<string> {
    const existing = await this.db.worksheet.findFirst({ where: { revisionId }, orderBy: { order: "asc" } });
    if (existing) return existing.id;
    const ws = await this.createWorksheet(projectId, { name: "Generated" });
    return ws.id;
  }

  async listPluginExecutions(projectId: string) {
    await this.requireProject(projectId);
    const executions = await this.db.pluginExecution.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return executions.map(mapPluginExecution);
  }

  // ── Settings ───────────────────────────────────────────────────────────

  async getSettings() {
    const settings = await this.db.organizationSettings.findFirst({
      where: { organizationId: this.organizationId },
    });
    if (!settings) return structuredClone(DEFAULT_SETTINGS);
    const defaults = { ...DEFAULT_SETTINGS.defaults, ...((settings.defaults as any) ?? {}) };
    defaults.uoms = normalizeUomLibrary(defaults.uoms);
    return {
      general: { ...DEFAULT_SETTINGS.general, ...((settings.general as any) ?? {}) },
      email: { ...DEFAULT_SETTINGS.email, ...((settings.email as any) ?? {}) },
      defaults,
      integrations: { ...DEFAULT_SETTINGS.integrations, ...((settings.integrations as any) ?? {}) },
      brand: { ...DEFAULT_BRAND, ...((settings.brand as any) ?? {}) },
      termsAndConditions: settings.termsAndConditions ?? "",
    } as AppSettings;
  }

  async updateSettings(patch: Partial<AppSettings>) {
    const existing = await this.getSettings();

    const merged = {
      general: patch.general ? { ...existing.general, ...patch.general } : existing.general,
      email: patch.email ? { ...existing.email, ...patch.email } : existing.email,
      defaults: patch.defaults
        ? {
            ...existing.defaults,
            ...patch.defaults,
            uoms: normalizeUomLibrary((patch.defaults as any).uoms ?? (existing.defaults as any).uoms),
          }
        : { ...existing.defaults, uoms: normalizeUomLibrary((existing.defaults as any).uoms) },
      integrations: patch.integrations ? { ...existing.integrations, ...patch.integrations } : existing.integrations,
      brand: patch.brand ? { ...existing.brand, ...patch.brand } : existing.brand,
      termsAndConditions: patch.termsAndConditions ?? existing.termsAndConditions ?? "",
    };

    await this.db.organizationSettings.upsert({
      where: { organizationId: this.organizationId },
      create: {
        organizationId: this.organizationId,
        general: merged.general as any,
        email: merged.email as any,
        defaults: merged.defaults as any,
        integrations: merged.integrations as any,
        brand: merged.brand as any,
        termsAndConditions: merged.termsAndConditions,
        updatedAt: new Date(),
      },
      update: {
        general: merged.general as any,
        email: merged.email as any,
        defaults: merged.defaults as any,
        integrations: merged.integrations as any,
        brand: merged.brand as any,
        termsAndConditions: merged.termsAndConditions,
        updatedAt: new Date(),
      },
    });

    return structuredClone(merged);
  }

  // ── Users ──────────────────────────────────────────────────────────────

  async listUsers(): Promise<User[]> {
    const users = await this.db.user.findMany({ where: { organizationId: this.organizationId } });
    return users.map(mapUser);
  }

  async getUser(userId: string): Promise<User | null> {
    const user = await this.db.user.findFirst({ where: { id: userId, organizationId: this.organizationId } });
    return user ? mapUser(user) : null;
  }

  async createUser(input: CreateUserInput): Promise<User> {
    const existing = await this.db.user.findFirst({ where: { organizationId: this.organizationId, email: input.email } });
    if (existing) throw new Error(`User with email ${input.email} already exists`);

    const user = await this.db.user.create({
      data: {
        id: createId("user"),
        organizationId: this.organizationId,
        email: input.email,
        name: input.name,
        role: input.role,
        active: true,
        passwordHash: input.password ? await hashPassword(input.password) : "",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return mapUser(user);
  }

  async updateUser(userId: string, patch: UserPatchInput): Promise<User> {
    const user = await this.db.user.findFirst({ where: { id: userId, organizationId: this.organizationId } });
    if (!user) throw new Error(`User ${userId} not found`);

    const data: any = { updatedAt: new Date() };
    if (patch.email !== undefined) data.email = patch.email;
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.role !== undefined) data.role = patch.role;
    if (patch.active !== undefined) data.active = patch.active;
    if (patch.password !== undefined) data.passwordHash = await hashPassword(patch.password);

    const updated = await this.db.user.update({ where: { id: userId }, data });
    return mapUser(updated);
  }

  async deleteUser(userId: string): Promise<User> {
    const user = await this.db.user.findFirst({ where: { id: userId, organizationId: this.organizationId } });
    if (!user) throw new Error(`User ${userId} not found`);
    await this.db.user.delete({ where: { id: userId } });
    return mapUser(user);
  }

  // ── Knowledge Books ────────────────────────────────────────────────────

  private async requireKnowledgeLibraryCabinet(cabinetId: string) {
    const cabinet = await this.db.knowledgeLibraryCabinet.findFirst({
      where: { id: cabinetId, organizationId: this.organizationId },
    });
    if (!cabinet) {
      throw new Error(`Knowledge library cabinet ${cabinetId} not found`);
    }
    return cabinet;
  }

  private async validateKnowledgeLibraryParent(
    parentId: string | null | undefined,
    itemType: KnowledgeLibraryCabinet["itemType"],
    cabinetId?: string,
  ) {
    if (parentId == null) return null;
    const parent = await this.requireKnowledgeLibraryCabinet(parentId);
    if (parent.itemType !== itemType) {
      throw new Error(`Parent cabinet must be a ${itemType} cabinet`);
    }
    if (!cabinetId) return parent;

    let cursor = parent;
    while (cursor) {
      if (cursor.id === cabinetId) {
        throw new Error("Cabinet cannot be moved into itself");
      }
      if (!cursor.parentId) break;
      cursor = await this.requireKnowledgeLibraryCabinet(cursor.parentId);
    }
    return parent;
  }

  private async validateKnowledgeLibraryItemCabinet(
    cabinetId: string | null | undefined,
    itemType: KnowledgeLibraryCabinet["itemType"],
  ) {
    if (cabinetId == null) return null;
    const cabinet = await this.requireKnowledgeLibraryCabinet(cabinetId);
    if (cabinet.itemType !== itemType) {
      throw new Error(`Cabinet ${cabinetId} cannot store ${itemType} items`);
    }
    return cabinet;
  }

  async listKnowledgeLibraryCabinets(itemType?: KnowledgeLibraryCabinet["itemType"]): Promise<KnowledgeLibraryCabinet[]> {
    const where: any = { organizationId: this.organizationId };
    if (itemType) where.itemType = itemType;
    const cabinets = await this.db.knowledgeLibraryCabinet.findMany({
      where,
      orderBy: [{ name: "asc" }],
    });
    return cabinets.map(mapKnowledgeLibraryCabinet);
  }

  async createKnowledgeLibraryCabinet(input: {
    name: string;
    itemType: KnowledgeLibraryCabinet["itemType"];
    parentId?: string | null;
  }): Promise<KnowledgeLibraryCabinet> {
    const name = input.name.trim();
    if (!name) throw new Error("Cabinet name is required");
    await this.validateKnowledgeLibraryParent(input.parentId ?? null, input.itemType);

    const cabinet = await this.db.knowledgeLibraryCabinet.create({
      data: {
        id: createId("klc"),
        organizationId: this.organizationId,
        parentId: input.parentId ?? null,
        itemType: input.itemType,
        name,
      },
    });
    return mapKnowledgeLibraryCabinet(cabinet);
  }

  async updateKnowledgeLibraryCabinet(
    cabinetId: string,
    patch: Partial<Pick<KnowledgeLibraryCabinet, "name" | "parentId">>,
  ): Promise<KnowledgeLibraryCabinet> {
    const cabinet = await this.requireKnowledgeLibraryCabinet(cabinetId);
    const data: any = {};

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error("Cabinet name is required");
      data.name = name;
    }
    if (patch.parentId !== undefined) {
      await this.validateKnowledgeLibraryParent(
        patch.parentId ?? null,
        cabinet.itemType as KnowledgeLibraryCabinet["itemType"],
        cabinet.id,
      );
      data.parentId = patch.parentId ?? null;
    }

    if (Object.keys(data).length === 0) {
      return mapKnowledgeLibraryCabinet(cabinet);
    }

    const updated = await this.db.knowledgeLibraryCabinet.update({
      where: { id: cabinetId },
      data,
    });
    return mapKnowledgeLibraryCabinet(updated);
  }

  async deleteKnowledgeLibraryCabinet(cabinetId: string): Promise<KnowledgeLibraryCabinet> {
    const cabinet = await this.requireKnowledgeLibraryCabinet(cabinetId);
    await this.db.knowledgeLibraryCabinet.delete({ where: { id: cabinetId } });
    return mapKnowledgeLibraryCabinet(cabinet);
  }

  async listKnowledgeBooks(projectId?: string): Promise<KnowledgeBook[]> {
    const where: any = { organizationId: this.organizationId };
    if (projectId) {
      await this.requireProject(projectId);
      // Show global books + books scoped to this specific project
      where.OR = [{ projectId }, { scope: "global" }];
    } else {
      // No project context — only return global (library) books
      where.scope = "global";
    }
    const books = await this.db.knowledgeBook.findMany({ where });
    return books.map(mapKnowledgeBook);
  }

  async getKnowledgeBook(bookId: string): Promise<KnowledgeBook | null> {
    const book = await this.db.knowledgeBook.findFirst({ where: { id: bookId, organizationId: this.organizationId } });
    return book ? mapKnowledgeBook(book) : null;
  }

  async createKnowledgeBook(input: {
    name: string;
    description: string;
    category: KnowledgeBook["category"];
    scope: KnowledgeBook["scope"];
    projectId?: string | null;
    cabinetId?: string | null;
    sourceFileName: string;
    sourceFileSize: number;
    storagePath?: string | null;
  }): Promise<KnowledgeBook> {
    await this.validateKnowledgeLibraryItemCabinet(input.cabinetId ?? null, "book");
    await this.requireProjectReference(input.projectId ?? null);

    const book = await this.db.knowledgeBook.create({
      data: {
        id: createId("kb"),
        organizationId: this.organizationId,
        cabinetId: input.cabinetId ?? null,
        name: input.name,
        description: input.description,
        category: input.category,
        scope: input.scope,
        projectId: input.projectId ?? null,
        status: "uploading",
        sourceFileName: input.sourceFileName,
        sourceFileSize: input.sourceFileSize,
        storagePath: input.storagePath ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return mapKnowledgeBook(book);
  }

  async updateKnowledgeBook(bookId: string, patch: Partial<Pick<KnowledgeBook, "name" | "description" | "category" | "scope" | "projectId" | "cabinetId" | "status" | "pageCount" | "chunkCount" | "metadata">>): Promise<KnowledgeBook> {
    const book = await this.db.knowledgeBook.findFirst({ where: { id: bookId, organizationId: this.organizationId } });
    if (!book) throw new Error(`Knowledge book ${bookId} not found`);

    const data: any = { updatedAt: new Date() };
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.scope !== undefined) data.scope = patch.scope;
    if (patch.projectId !== undefined) {
      await this.requireProjectReference(patch.projectId ?? null);
      data.projectId = patch.projectId;
    }
    if (patch.cabinetId !== undefined) {
      await this.validateKnowledgeLibraryItemCabinet(patch.cabinetId ?? null, "book");
      data.cabinetId = patch.cabinetId ?? null;
    }
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.pageCount !== undefined) data.pageCount = patch.pageCount;
    if (patch.chunkCount !== undefined) data.chunkCount = patch.chunkCount;
    if (patch.metadata !== undefined) data.metadata = { ...(book.metadata as any), ...patch.metadata };

    const updated = await this.db.knowledgeBook.update({ where: { id: bookId }, data });
    return mapKnowledgeBook(updated);
  }

  async deleteKnowledgeBook(bookId: string): Promise<KnowledgeBook> {
    const book = await this.db.knowledgeBook.findFirst({ where: { id: bookId, organizationId: this.organizationId } });
    if (!book) throw new Error(`Knowledge book ${bookId} not found`);
    await this.db.knowledgeChunk.deleteMany({ where: { bookId } });
    await this.db.knowledgeBook.delete({ where: { id: bookId } });
    // Clean up files on disk
    await rm(resolveApiPath("knowledge", bookId), { recursive: true, force: true }).catch(() => {});
    return mapKnowledgeBook(book);
  }

  async listKnowledgeChunks(bookId: string): Promise<KnowledgeChunk[]> {
    const book = await this.getKnowledgeBook(bookId);
    if (!book) throw new Error(`Knowledge book ${bookId} not found`);
    const chunks = await this.db.knowledgeChunk.findMany({
      where: { bookId },
      orderBy: { order: "asc" },
    });
    return chunks.map(mapKnowledgeChunk);
  }

  async listKnowledgeChunksPaginated(bookId: string, limit: number, offset: number): Promise<{ chunks: KnowledgeChunk[]; total: number }> {
    const book = await this.getKnowledgeBook(bookId);
    if (!book) throw new Error(`Knowledge book ${bookId} not found`);
    const [chunks, total] = await Promise.all([
      this.db.knowledgeChunk.findMany({
        where: { bookId },
        orderBy: { order: "asc" },
        take: limit,
        skip: offset,
      }),
      this.db.knowledgeChunk.count({ where: { bookId } }),
    ]);
    return { chunks: chunks.map(mapKnowledgeChunk), total };
  }

  async createKnowledgeChunk(bookId: string, input: {
    pageNumber?: number | null;
    sectionTitle: string;
    text: string;
    tokenCount?: number;
    order?: number;
  }): Promise<KnowledgeChunk> {
    const book = await this.db.knowledgeBook.findFirst({ where: { id: bookId, organizationId: this.organizationId } });
    if (!book) throw new Error(`Knowledge book ${bookId} not found`);

    const existingCount = await this.db.knowledgeChunk.count({ where: { bookId } });

    const chunk = await this.db.knowledgeChunk.create({
      data: {
        id: createId("kc"),
        bookId,
        pageNumber: input.pageNumber ?? null,
        sectionTitle: input.sectionTitle,
        text: input.text,
        tokenCount: input.tokenCount ?? Math.ceil(input.text.length / 4),
        order: input.order ?? existingCount,
      },
    });

    await this.db.knowledgeBook.update({
      where: { id: bookId },
      data: { chunkCount: existingCount + 1, updatedAt: new Date() },
    });

    return mapKnowledgeChunk(chunk);
  }

  async searchKnowledgeChunks(query: string, bookId?: string, limit = 20): Promise<KnowledgeChunk[]> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const where: any = {};
    if (bookId) {
      const book = await this.getKnowledgeBook(bookId);
      if (!book) return [];
      where.bookId = book.id;
    } else {
      const bookIds = (await this.db.knowledgeBook.findMany({ where: { organizationId: this.organizationId }, select: { id: true } })).map((b) => b.id);
      where.bookId = { in: bookIds };
    }

    const chunks = await this.db.knowledgeChunk.findMany({ where });

    // Score chunks by how many query terms they contain
    const scored = chunks
      .map((c) => {
        const lower = c.text.toLowerCase() + " " + c.sectionTitle.toLowerCase();
        const matchCount = terms.filter((t) => lower.includes(t)).length;
        return { chunk: c, matchCount };
      })
      .filter((s) => s.matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount)
      .slice(0, limit);

    return scored.map((s) => mapKnowledgeChunk(s.chunk));
  }

  // ── Datasets ───────────────────────────────────────────────────────────

  // ── Knowledge Documents / Pages ────────────────────────────────────────

  private slugifyKnowledgePageTitle(value: string) {
    const slug = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || "page";
  }

  private async requireKnowledgeDocument(documentId: string) {
    const document = await this.db.knowledgeDocument.findFirst({
      where: { id: documentId, organizationId: this.organizationId },
    });
    if (!document) {
      throw new Error(`Knowledge document ${documentId} not found`);
    }
    return document;
  }

  private async requireKnowledgeDocumentPage(pageId: string) {
    const page = await this.db.knowledgeDocumentPage.findFirst({
      where: {
        id: pageId,
        document: { organizationId: this.organizationId },
      },
    });
    if (!page) {
      throw new Error(`Knowledge document page ${pageId} not found`);
    }
    return page;
  }

  async listKnowledgeDocuments(projectId?: string): Promise<KnowledgeDocument[]> {
    const where: any = { organizationId: this.organizationId };
    if (projectId) {
      await this.requireProject(projectId);
      where.OR = [{ projectId }, { scope: "global" }];
    } else {
      where.scope = "global";
    }
    const documents = await this.db.knowledgeDocument.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
    });
    return documents.map(mapKnowledgeDocument);
  }

  async getKnowledgeDocument(documentId: string): Promise<KnowledgeDocument | null> {
    const document = await this.db.knowledgeDocument.findFirst({
      where: { id: documentId, organizationId: this.organizationId },
    });
    return document ? mapKnowledgeDocument(document) : null;
  }

  async createKnowledgeDocument(input: {
    title: string;
    description?: string;
    category?: KnowledgeDocument["category"];
    scope?: KnowledgeDocument["scope"];
    projectId?: string | null;
    cabinetId?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<KnowledgeDocument> {
    const title = input.title.trim();
    if (!title) throw new Error("Document title is required");
    await this.validateKnowledgeLibraryItemCabinet(input.cabinetId ?? null, "document");
    await this.requireProjectReference(input.projectId ?? null);

    const document = await this.db.knowledgeDocument.create({
      data: {
        id: createId("kdoc"),
        organizationId: this.organizationId,
        cabinetId: input.cabinetId ?? null,
        title,
        description: input.description ?? "",
        category: input.category ?? "general",
        scope: input.scope ?? "global",
        projectId: input.projectId ?? null,
        tags: input.tags ?? [],
        status: "draft",
        metadata: (input.metadata ?? {}) as any,
      },
    });
    return mapKnowledgeDocument(document);
  }

  async updateKnowledgeDocument(
    documentId: string,
    patch: Partial<Pick<KnowledgeDocument, "title" | "description" | "category" | "scope" | "projectId" | "cabinetId" | "tags" | "status" | "pageCount" | "chunkCount" | "metadata">>,
  ): Promise<KnowledgeDocument> {
    const document = await this.requireKnowledgeDocument(documentId);
    const data: any = { updatedAt: new Date() };

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new Error("Document title is required");
      data.title = title;
    }
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.scope !== undefined) data.scope = patch.scope;
    if (patch.projectId !== undefined) {
      await this.requireProjectReference(patch.projectId ?? null);
      data.projectId = patch.projectId;
    }
    if (patch.cabinetId !== undefined) {
      await this.validateKnowledgeLibraryItemCabinet(patch.cabinetId ?? null, "document");
      data.cabinetId = patch.cabinetId ?? null;
    }
    if (patch.tags !== undefined) data.tags = patch.tags;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.pageCount !== undefined) data.pageCount = patch.pageCount;
    if (patch.chunkCount !== undefined) data.chunkCount = patch.chunkCount;
    if (patch.metadata !== undefined) {
      data.metadata = { ...((document.metadata as Record<string, unknown>) ?? {}), ...patch.metadata };
    }

    const updated = await this.db.knowledgeDocument.update({ where: { id: documentId }, data });
    return mapKnowledgeDocument(updated);
  }

  async deleteKnowledgeDocument(documentId: string): Promise<KnowledgeDocument> {
    const document = await this.requireKnowledgeDocument(documentId);
    await this.db.knowledgeDocument.delete({ where: { id: documentId } });
    return mapKnowledgeDocument(document);
  }

  async listKnowledgeDocumentPages(documentId: string): Promise<KnowledgeDocumentPage[]> {
    await this.requireKnowledgeDocument(documentId);
    const pages = await this.db.knowledgeDocumentPage.findMany({
      where: { documentId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    return pages.map(mapKnowledgeDocumentPage);
  }

  async getKnowledgeDocumentPage(pageId: string): Promise<KnowledgeDocumentPage | null> {
    const page = await this.db.knowledgeDocumentPage.findFirst({
      where: { id: pageId, document: { organizationId: this.organizationId } },
    });
    return page ? mapKnowledgeDocumentPage(page) : null;
  }

  async createKnowledgeDocumentPage(documentId: string, input: {
    title: string;
    contentJson?: Record<string, unknown>;
    contentMarkdown?: string;
    plainText?: string;
    metadata?: Record<string, unknown>;
    order?: number;
  }): Promise<KnowledgeDocumentPage> {
    await this.requireKnowledgeDocument(documentId);
    const title = input.title.trim();
    if (!title) throw new Error("Page title is required");
    const existingCount = await this.db.knowledgeDocumentPage.count({ where: { documentId } });
    const page = await this.db.knowledgeDocumentPage.create({
      data: {
        id: createId("kpage"),
        documentId,
        title,
        slug: this.slugifyKnowledgePageTitle(title),
        order: input.order ?? existingCount,
        contentJson: (input.contentJson ?? {}) as any,
        contentMarkdown: input.contentMarkdown ?? "",
        plainText: input.plainText ?? "",
        metadata: (input.metadata ?? {}) as any,
      },
    });
    await this.db.knowledgeDocument.update({
      where: { id: documentId },
      data: { pageCount: existingCount + 1, status: "indexing", updatedAt: new Date() },
    });
    return mapKnowledgeDocumentPage(page);
  }

  async updateKnowledgeDocumentPage(
    pageId: string,
    patch: Partial<Pick<KnowledgeDocumentPage, "title" | "slug" | "order" | "contentJson" | "contentMarkdown" | "plainText" | "metadata">>,
  ): Promise<KnowledgeDocumentPage> {
    const page = await this.requireKnowledgeDocumentPage(pageId);
    const data: any = { updatedAt: new Date() };
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new Error("Page title is required");
      data.title = title;
      data.slug = patch.slug ?? this.slugifyKnowledgePageTitle(title);
    }
    if (patch.slug !== undefined && patch.title === undefined) data.slug = this.slugifyKnowledgePageTitle(patch.slug);
    if (patch.order !== undefined) data.order = patch.order;
    if (patch.contentJson !== undefined) data.contentJson = patch.contentJson as any;
    if (patch.contentMarkdown !== undefined) data.contentMarkdown = patch.contentMarkdown;
    if (patch.plainText !== undefined) data.plainText = patch.plainText;
    if (patch.metadata !== undefined) data.metadata = { ...((page.metadata as Record<string, unknown>) ?? {}), ...patch.metadata };

    const updated = await this.db.knowledgeDocumentPage.update({ where: { id: pageId }, data });
    await this.db.knowledgeDocument.update({
      where: { id: page.documentId },
      data: { status: "indexing", updatedAt: new Date() },
    });
    return mapKnowledgeDocumentPage(updated);
  }

  async deleteKnowledgeDocumentPage(pageId: string): Promise<KnowledgeDocumentPage> {
    const page = await this.requireKnowledgeDocumentPage(pageId);
    await this.db.knowledgeDocumentPage.delete({ where: { id: pageId } });
    const [pageCount, chunkCount] = await Promise.all([
      this.db.knowledgeDocumentPage.count({ where: { documentId: page.documentId } }),
      this.db.knowledgeDocumentChunk.count({ where: { documentId: page.documentId } }),
    ]);
    await this.db.knowledgeDocument.update({
      where: { id: page.documentId },
      data: { pageCount, chunkCount, status: pageCount > 0 ? "indexing" : "draft", updatedAt: new Date() },
    });
    return mapKnowledgeDocumentPage(page);
  }

  async listKnowledgeDocumentChunks(documentId: string, pageId?: string): Promise<KnowledgeDocumentChunk[]> {
    await this.requireKnowledgeDocument(documentId);
    const chunks = await this.db.knowledgeDocumentChunk.findMany({
      where: { documentId, ...(pageId ? { pageId } : {}) },
      orderBy: { order: "asc" },
    });
    return chunks.map(mapKnowledgeDocumentChunk);
  }

  async replaceKnowledgeDocumentChunks(documentId: string, chunks: Array<{
    pageId?: string | null;
    sectionTitle?: string;
    text: string;
    tokenCount?: number;
    order?: number;
    metadata?: Record<string, unknown>;
  }>): Promise<KnowledgeDocumentChunk[]> {
    await this.requireKnowledgeDocument(documentId);
    await this.db.knowledgeDocumentChunk.deleteMany({ where: { documentId } });
    if (chunks.length > 0) {
      await this.db.knowledgeDocumentChunk.createMany({
        data: chunks.map((chunk, index) => ({
          id: createId("kdchunk"),
          documentId,
          pageId: chunk.pageId ?? null,
          sectionTitle: chunk.sectionTitle ?? "",
          text: chunk.text,
          tokenCount: chunk.tokenCount ?? Math.ceil(chunk.text.length / 4),
          order: chunk.order ?? index,
          metadata: (chunk.metadata ?? {}) as any,
        })),
      });
    }
    await this.db.knowledgeDocument.update({
      where: { id: documentId },
      data: { chunkCount: chunks.length, status: "indexed", updatedAt: new Date() },
    });
    const saved = await this.db.knowledgeDocumentChunk.findMany({
      where: { documentId },
      orderBy: { order: "asc" },
    });
    return saved.map(mapKnowledgeDocumentChunk);
  }

  async searchKnowledgeDocumentChunks(query: string, documentId?: string, limit = 20): Promise<KnowledgeDocumentChunk[]> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const where: any = {};
    if (documentId) {
      const document = await this.requireKnowledgeDocument(documentId);
      where.documentId = document.id;
    } else {
      const documentIds = (await this.db.knowledgeDocument.findMany({
        where: { organizationId: this.organizationId },
        select: { id: true },
      })).map((document) => document.id);
      where.documentId = { in: documentIds };
    }

    const chunks = await this.db.knowledgeDocumentChunk.findMany({ where });
    const scored = chunks
      .map((chunk) => {
        const lower = `${chunk.text} ${chunk.sectionTitle}`.toLowerCase();
        const matchCount = terms.filter((term) => lower.includes(term)).length;
        return { chunk, matchCount };
      })
      .filter((entry) => entry.matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount)
      .slice(0, limit);

    return scored.map((entry) => mapKnowledgeDocumentChunk(entry.chunk));
  }

  private _normalizeDatasetReference(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  private _tokenizeDatasetReference(value: string) {
    return value
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((token) =>
        token &&
        !new Set(["ds", "dataset", "data", "table", "template", "library", "row", "rows", "unit", "units"]).has(token),
      );
  }

  private _scoreDatasetReferenceMatch(reference: string, candidate: string) {
    if (!reference || !candidate) {
      return 0;
    }

    if (reference === candidate) {
      return 100;
    }

    const normalizedReference = this._normalizeDatasetReference(reference);
    const normalizedCandidate = this._normalizeDatasetReference(candidate);
    if (!normalizedReference || !normalizedCandidate) {
      return 0;
    }

    if (normalizedReference === normalizedCandidate) {
      return 95;
    }

    const referenceTokens = this._tokenizeDatasetReference(reference);
    const candidateTokens = this._tokenizeDatasetReference(candidate);
    if (
      referenceTokens.length > 0 &&
      referenceTokens.every((token) => candidateTokens.includes(token))
    ) {
      return 75 - Math.max(0, candidateTokens.length - referenceTokens.length);
    }

    if (
      normalizedReference.length >= 4 &&
      (normalizedCandidate.includes(normalizedReference) || normalizedReference.includes(normalizedCandidate))
    ) {
      return 60;
    }

    return 0;
  }

  private _findBestDatasetReferenceMatch<T extends { id?: string | null; name?: string | null; sourceTemplateId?: string | null }>(
    datasetRef: string,
    datasets: T[],
  ): T | null {
    const scored = datasets
      .map((dataset) => ({
        dataset,
        score: Math.max(
          this._scoreDatasetReferenceMatch(datasetRef, dataset.id ?? ""),
          this._scoreDatasetReferenceMatch(datasetRef, dataset.name ?? ""),
          this._scoreDatasetReferenceMatch(datasetRef, dataset.sourceTemplateId ?? ""),
        ),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return null;
    }

    const best = scored[0];
    const tied = scored.filter((entry) => entry.score === best.score);
    if (tied.length > 1) {
      const uniqueIds = new Set(tied.map((entry) => entry.dataset.id ?? entry.dataset.name ?? ""));
      if (uniqueIds.size > 1) {
        return null;
      }
    }

    return best.dataset;
  }

  private async _resolveDatasetRecordForRead(datasetRef: string): Promise<{ dataset: any; client: PrismaClient } | null> {
    const trimmed = datasetRef.trim();
    if (!trimmed) {
      return null;
    }

    const direct = await this.db.dataset.findFirst({
      where: { id: trimmed, organizationId: this.organizationId },
    });
    if (direct) {
      return { dataset: direct, client: this.db };
    }

    const adopted = await this.db.dataset.findFirst({
      where: { organizationId: this.organizationId, sourceTemplateId: trimmed },
    });
    if (adopted) {
      return { dataset: adopted, client: this.db };
    }

    const normalizedRef = this._normalizeDatasetReference(trimmed);
    const organizationDatasets = await this.db.dataset.findMany({
      where: { organizationId: this.organizationId },
    });
    const byOrgName = organizationDatasets.find((dataset) => {
      const normalizedName = this._normalizeDatasetReference(dataset.name ?? "");
      return normalizedName === normalizedRef;
    });
    const byOrgReference = byOrgName ?? this._findBestDatasetReferenceMatch(trimmed, organizationDatasets);
    if (byOrgReference) {
      return { dataset: byOrgReference, client: this.db };
    }

    const directTemplate = await sharedPrisma.dataset.findFirst({
      where: { id: trimmed, isTemplate: true },
    });
    if (directTemplate) {
      return { dataset: directTemplate, client: sharedPrisma };
    }

    const templates = await sharedPrisma.dataset.findMany({
      where: { isTemplate: true },
    });
    const byTemplateName = templates.find((dataset) => {
      const normalizedName = this._normalizeDatasetReference(dataset.name ?? "");
      return normalizedName === normalizedRef;
    });
    const byTemplateReference = byTemplateName ?? this._findBestDatasetReferenceMatch(trimmed, templates);
    if (byTemplateReference) {
      return { dataset: byTemplateReference, client: sharedPrisma };
    }

    return null;
  }

  async listDatasets(projectId?: string): Promise<Dataset[]> {
    const where: any = { organizationId: this.organizationId, isTemplate: false };
    if (projectId) {
      await this.requireProject(projectId);
      where.OR = [{ projectId }, { scope: "global" }];
    }
    const datasets = await this.db.dataset.findMany({ where });
    return datasets.map(mapDataset);
  }

  async getDataset(datasetId: string): Promise<Dataset | null> {
    const resolved = await this._resolveDatasetRecordForRead(datasetId);
    return resolved ? mapDataset(resolved.dataset) : null;
  }

  async createDataset(input: {
    name: string;
    description: string;
    category: Dataset["category"];
    scope: Dataset["scope"];
    projectId?: string | null;
    cabinetId?: string | null;
    columns: Dataset["columns"];
    source?: Dataset["source"];
    sourceDescription?: string;
    sourceBookId?: string | null;
    sourcePages?: string;
    tags?: string[];
  }): Promise<Dataset> {
    await this.validateKnowledgeLibraryItemCabinet(input.cabinetId ?? null, "dataset");
    await this.requireProjectReference(input.projectId ?? null);

    const dataset = await this.db.dataset.create({
      data: {
        id: createId("ds"),
        organizationId: this.organizationId,
        cabinetId: input.cabinetId ?? null,
        name: input.name,
        description: input.description,
        category: input.category,
        scope: input.scope,
        projectId: input.projectId ?? null,
        columns: input.columns as any,
        source: input.source ?? "manual",
        sourceDescription: input.sourceDescription ?? "",
        sourceBookId: input.sourceBookId ?? null,
        sourcePages: input.sourcePages ?? "",
        tags: input.tags ?? [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return mapDataset(dataset);
  }

  async updateDataset(datasetId: string, patch: Partial<Pick<Dataset, "name" | "description" | "category" | "scope" | "projectId" | "cabinetId" | "columns" | "source" | "sourceDescription">>): Promise<Dataset> {
    const dataset = await this.db.dataset.findFirst({ where: { id: datasetId, organizationId: this.organizationId } });
    if (!dataset) throw new Error(`Dataset ${datasetId} not found`);

    const data: any = { updatedAt: new Date() };
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.scope !== undefined) data.scope = patch.scope;
    if (patch.projectId !== undefined) {
      await this.requireProjectReference(patch.projectId ?? null);
      data.projectId = patch.projectId;
    }
    if (patch.cabinetId !== undefined) {
      await this.validateKnowledgeLibraryItemCabinet(patch.cabinetId ?? null, "dataset");
      data.cabinetId = patch.cabinetId ?? null;
    }
    if (patch.columns !== undefined) data.columns = patch.columns as any;
    if (patch.source !== undefined) data.source = patch.source;
    if (patch.sourceDescription !== undefined) data.sourceDescription = patch.sourceDescription;

    const updated = await this.db.dataset.update({ where: { id: datasetId }, data });
    return mapDataset(updated);
  }

  async deleteDataset(datasetId: string): Promise<Dataset> {
    const dataset = await this.db.dataset.findFirst({ where: { id: datasetId, organizationId: this.organizationId } });
    if (!dataset) throw new Error(`Dataset ${datasetId} not found`);
    await this.db.datasetRow.deleteMany({ where: { datasetId } });
    await this.db.dataset.delete({ where: { id: datasetId } });
    return mapDataset(dataset);
  }

  async listDatasetRows(datasetId: string, filter?: string, sort?: string, limit = 100, offset = 0): Promise<{ rows: DatasetRow[]; total: number }> {
    const resolved = await this._resolveDatasetRecordForRead(datasetId);
    if (!resolved) {
      return { rows: [], total: 0 };
    }

    let rows = await resolved.client.datasetRow.findMany({
      where: { datasetId: resolved.dataset.id },
      orderBy: { order: "asc" },
    });

    let mapped = rows.map(mapDatasetRow);

    if (filter) {
      const lowerFilter = filter.toLowerCase();
      mapped = mapped.filter((r) => JSON.stringify(r.data).toLowerCase().includes(lowerFilter));
    }

    if (sort) {
      const desc = sort.startsWith("-");
      const key = desc ? sort.slice(1) : sort;
      mapped = [...mapped].sort((a, b) => {
        const aVal = a.data[key];
        const bVal = b.data[key];
        if (typeof aVal === "number" && typeof bVal === "number") return desc ? bVal - aVal : aVal - bVal;
        return desc ? String(bVal ?? "").localeCompare(String(aVal ?? "")) : String(aVal ?? "").localeCompare(String(bVal ?? ""));
      });
    }

    const total = mapped.length;
    return { rows: mapped.slice(offset, offset + limit), total };
  }

  async getDatasetRow(rowId: string): Promise<DatasetRow | null> {
    const row = await this.db.datasetRow.findFirst({
      where: { id: rowId, dataset: { organizationId: this.organizationId } },
    });
    return row ? mapDatasetRow(row) : null;
  }

  async createDatasetRow(datasetId: string, data: Record<string, unknown>): Promise<DatasetRow> {
    const dataset = await this.db.dataset.findFirst({ where: { id: datasetId, organizationId: this.organizationId } });
    if (!dataset) throw new Error(`Dataset ${datasetId} not found`);

    const existingCount = await this.db.datasetRow.count({ where: { datasetId } });
    const now = new Date();

    const row = await this.db.datasetRow.create({
      data: {
        id: createId("dr"),
        datasetId,
        data: data as any,
        order: existingCount,
        createdAt: now,
        updatedAt: now,
      },
    });

    await this.db.dataset.update({
      where: { id: datasetId },
      data: { rowCount: existingCount + 1, updatedAt: now },
    });

    return mapDatasetRow(row);
  }

  async createDatasetRowsBatch(datasetId: string, rows: Array<Record<string, unknown>>): Promise<DatasetRow[]> {
    const dataset = await this.db.dataset.findFirst({ where: { id: datasetId, organizationId: this.organizationId } });
    if (!dataset) throw new Error(`Dataset ${datasetId} not found`);

    const existingCount = await this.db.datasetRow.count({ where: { datasetId } });
    const now = new Date();

    const created: DatasetRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = await this.db.datasetRow.create({
        data: {
          id: createId("dr"),
          datasetId,
          data: rows[i] as any,
          order: existingCount + i,
          createdAt: now,
          updatedAt: now,
        },
      });
      created.push(mapDatasetRow(row));
    }

    await this.db.dataset.update({
      where: { id: datasetId },
      data: { rowCount: existingCount + created.length, updatedAt: now },
    });

    return created;
  }

  async updateDatasetRow(rowId: string, data: Record<string, unknown>): Promise<DatasetRow> {
    const row = await this.requireDatasetRow(rowId);

    const updated = await this.db.datasetRow.update({
      where: { id: rowId },
      data: { data: { ...(row.data as any), ...data } as any, updatedAt: new Date() },
    });
    return mapDatasetRow(updated);
  }

  async deleteDatasetRow(rowId: string): Promise<DatasetRow> {
    const row = await this.requireDatasetRow(rowId);

    await this.db.datasetRow.delete({ where: { id: rowId } });
    const remaining = await this.db.datasetRow.count({ where: { datasetId: row.datasetId } });
    await this.db.dataset.update({
      where: { id: row.datasetId },
      data: { rowCount: remaining, updatedAt: new Date() },
    });

    return mapDatasetRow(row);
  }

  async searchDatasetRows(datasetId: string, query: string): Promise<DatasetRow[]> {
    const resolved = await this._resolveDatasetRecordForRead(datasetId);
    if (!resolved) {
      return [];
    }
    const rows = await resolved.client.datasetRow.findMany({ where: { datasetId: resolved.dataset.id } });
    const lowerQuery = query.toLowerCase();
    return rows
      .filter((r) => JSON.stringify(r.data).toLowerCase().includes(lowerQuery))
      .map(mapDatasetRow);
  }

  async queryDataset(datasetId: string, filters: Array<{ column: string; op: "eq" | "gt" | "lt" | "gte" | "lte" | "contains"; value: unknown }>): Promise<DatasetRow[]> {
    const resolved = await this._resolveDatasetRecordForRead(datasetId);
    if (!resolved) {
      return [];
    }
    const rows = await resolved.client.datasetRow.findMany({ where: { datasetId: resolved.dataset.id } });
    return rows
      .map(mapDatasetRow)
      .filter((r) => {
        return filters.every((f) => {
          const val = r.data[f.column];
          switch (f.op) {
            case "eq": return val === f.value;
            case "gt": return typeof val === "number" && typeof f.value === "number" && val > f.value;
            case "lt": return typeof val === "number" && typeof f.value === "number" && val < f.value;
            case "gte": return typeof val === "number" && typeof f.value === "number" && val >= f.value;
            case "lte": return typeof val === "number" && typeof f.value === "number" && val <= f.value;
            case "contains": return String(val ?? "").toLowerCase().includes(String(f.value).toLowerCase());
            default: return true;
          }
        });
      });
  }

  // ── Estimator Persona CRUD ──────────────────────────────────────────────

  async listEstimatorPersonas(): Promise<any[]> {
    const rows = await this.db.estimatorPersona.findMany({
      where: { organizationId: this.organizationId },
      orderBy: { order: "asc" },
    });
    return rows.map(mapPersona);
  }

  async getEstimatorPersona(id: string): Promise<any | null> {
    const row = await this.db.estimatorPersona.findFirst({
      where: { id, organizationId: this.organizationId },
    });
    return row ? mapPersona(row) : null;
  }

  async createEstimatorPersona(input: {
    name: string;
    trade?: string;
    description?: string;
    systemPrompt?: string;
    knowledgeBookIds?: string[];
    knowledgeDocumentIds?: string[];
    datasetTags?: string[];
    packageBuckets?: string[];
    defaultAssumptions?: Record<string, unknown>;
    productivityGuidance?: Record<string, unknown>;
    commercialGuidance?: Record<string, unknown>;
    reviewFocusAreas?: string[];
    isDefault?: boolean;
    enabled?: boolean;
    order?: number;
  }): Promise<any> {
    await this.validateKnowledgeBookReferences(input.knowledgeBookIds);
    await this.validateKnowledgeDocumentReferences(input.knowledgeDocumentIds);

    const row = await this.db.estimatorPersona.create({
      data: {
        organizationId: this.organizationId,
        name: input.name,
        trade: input.trade ?? "mechanical",
        description: input.description ?? "",
        systemPrompt: input.systemPrompt ?? "",
        knowledgeBookIds: input.knowledgeBookIds ?? [],
        knowledgeDocumentIds: input.knowledgeDocumentIds ?? [],
        datasetTags: input.datasetTags ?? [],
        packageBuckets: input.packageBuckets ?? [],
        defaultAssumptions: toPrismaJson(input.defaultAssumptions),
        productivityGuidance: toPrismaJson(input.productivityGuidance),
        commercialGuidance: toPrismaJson(input.commercialGuidance),
        reviewFocusAreas: input.reviewFocusAreas ?? [],
        isDefault: input.isDefault ?? false,
        enabled: input.enabled ?? true,
        order: input.order ?? 0,
      },
    });
    return mapPersona(row);
  }

  async updateEstimatorPersona(id: string, patch: {
    name?: string;
    trade?: string;
    description?: string;
    systemPrompt?: string;
    knowledgeBookIds?: string[];
    knowledgeDocumentIds?: string[];
    datasetTags?: string[];
    packageBuckets?: string[];
    defaultAssumptions?: Record<string, unknown>;
    productivityGuidance?: Record<string, unknown>;
    commercialGuidance?: Record<string, unknown>;
    reviewFocusAreas?: string[];
    isDefault?: boolean;
    enabled?: boolean;
    order?: number;
  }): Promise<any> {
    const existing = await this.db.estimatorPersona.findFirst({
      where: { id, organizationId: this.organizationId },
    });
    if (!existing) throw new Error(`Estimator persona ${id} not found`);

    await this.validateKnowledgeBookReferences(patch.knowledgeBookIds);
    await this.validateKnowledgeDocumentReferences(patch.knowledgeDocumentIds);

    const {
      defaultAssumptions,
      productivityGuidance,
      commercialGuidance,
      ...rest
    } = patch;
    const data: Prisma.EstimatorPersonaUpdateInput = {
      ...rest,
      ...(defaultAssumptions === undefined ? {} : { defaultAssumptions: toPrismaJson(defaultAssumptions) }),
      ...(productivityGuidance === undefined ? {} : { productivityGuidance: toPrismaJson(productivityGuidance) }),
      ...(commercialGuidance === undefined ? {} : { commercialGuidance: toPrismaJson(commercialGuidance) }),
    };
    const row = await this.db.estimatorPersona.update({
      where: { id },
      data,
    });
    return mapPersona(row);
  }

  async deleteEstimatorPersona(id: string): Promise<void> {
    const existing = await this.db.estimatorPersona.findFirst({
      where: { id, organizationId: this.organizationId },
      select: { id: true },
    });
    if (!existing) throw new Error(`Estimator persona ${id} not found`);
    await this.db.estimatorPersona.delete({ where: { id } });
  }
}

// ── Factory + backward-compat export ─────────────────────────────────────────

export function createApiStore(organizationId: string): PrismaApiStore {
  return new PrismaApiStore(sharedPrisma, organizationId);
}

// ── Catalog Library (global templates) ──────────────────────────────────────

export const catalogLibrary = {
  async listTemplates(): Promise<Catalog[]> {
    const catalogs = await sharedPrisma.catalog.findMany({
      where: { isTemplate: true },
      include: { _count: { select: { items: true } } },
      orderBy: { name: "asc" },
    });
    return catalogs.map(mapCatalog);
  },

  async getTemplate(id: string): Promise<Catalog | null> {
    const catalog = await sharedPrisma.catalog.findFirst({
      where: { id, isTemplate: true },
      include: { _count: { select: { items: true } } },
    });
    return catalog ? mapCatalog(catalog) : null;
  },

  async createTemplate(input: {
    name: string;
    description: string;
    kind: string;
    source?: string;
    sourceDescription?: string;
  }): Promise<Catalog> {
    const catalog = await sharedPrisma.catalog.create({
      data: {
        id: createId("cat"),
        organizationId: null,
        name: input.name,
        description: input.description,
        kind: input.kind,
        scope: "global",
        source: input.source ?? "import",
        sourceDescription: input.sourceDescription ?? "",
        isTemplate: true,
      },
    });
    return mapCatalog(catalog);
  },

  async updateTemplate(
    id: string,
    patch: Partial<Pick<Catalog, "name" | "description" | "kind" | "sourceDescription">>,
  ): Promise<Catalog> {
    const existing = await sharedPrisma.catalog.findFirst({ where: { id, isTemplate: true } });
    if (!existing) throw new Error(`Catalog template ${id} not found`);

    const data: any = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.kind !== undefined) data.kind = patch.kind;
    if (patch.sourceDescription !== undefined) data.sourceDescription = patch.sourceDescription;

    const updated = await sharedPrisma.catalog.update({ where: { id }, data });
    return mapCatalog(updated);
  },

  async deleteTemplate(id: string): Promise<void> {
    const existing = await sharedPrisma.catalog.findFirst({ where: { id, isTemplate: true } });
    if (!existing) throw new Error(`Catalog template ${id} not found`);
    await sharedPrisma.catalogItem.deleteMany({ where: { catalogId: id } });
    await sharedPrisma.catalog.delete({ where: { id } });
  },

  async getTemplateItems(
    id: string,
    limit = 100,
    offset = 0,
    filter?: string,
  ): Promise<{ items: CatalogItem[]; total: number }> {
    const allItems = await sharedPrisma.catalogItem.findMany({
      where: { catalogId: id },
      orderBy: { order: "asc" },
    });
    let mapped = allItems.map(mapCatalogItem);
    if (filter) {
      const lf = filter.toLowerCase();
      mapped = mapped.filter((i) =>
        i.code.toLowerCase().includes(lf) ||
        i.name.toLowerCase().includes(lf) ||
        JSON.stringify(i.metadata).toLowerCase().includes(lf)
      );
    }
    const total = mapped.length;
    return { items: mapped.slice(offset, offset + limit), total };
  },

  async adoptTemplate(templateId: string, organizationId: string): Promise<Catalog> {
    const template = await sharedPrisma.catalog.findFirst({
      where: { id: templateId, isTemplate: true },
    });
    if (!template) throw new Error(`Catalog template ${templateId} not found`);

    const now = new Date();
    const newId = createId("cat");

    const catalog = await sharedPrisma.catalog.create({
      data: {
        id: newId,
        organizationId,
        name: template.name,
        description: template.description,
        kind: template.kind,
        scope: "global",
        source: "library",
        sourceDescription: `Adopted from template: ${template.name}`,
        isTemplate: false,
        sourceTemplateId: templateId,
      },
    });

    // Clone all items in batches
    const allItems = await sharedPrisma.catalogItem.findMany({
      where: { catalogId: templateId },
      orderBy: { order: "asc" },
    });

    const BATCH = 500;
    for (let i = 0; i < allItems.length; i += BATCH) {
      const batch = allItems.slice(i, i + BATCH);
      await sharedPrisma.catalogItem.createMany({
        data: batch.map((item, idx) => ({
          id: createId("ci"),
          catalogId: newId,
          code: item.code,
          name: item.name,
          unit: item.unit,
          unitCost: item.unitCost,
          unitPrice: item.unitPrice,
          metadata: item.metadata as any,
          order: i + idx,
        })),
      });
    }

    return mapCatalog({ ...catalog, _count: { items: allItems.length } });
  },
};
