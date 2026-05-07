import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import MsgReader, { type FieldsData } from "@kenjiuno/msgreader";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, stat, writeFile, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import JSZip from "jszip";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import PostalMime, { type Address as PostalAddress, type Attachment as PostalAttachment, type Email as PostalEmail } from "postal-mime";
import { z } from "zod";
import {
  DEFAULT_AZURE_DOCUMENT_INTELLIGENCE_FEATURES,
  ingestCustomerPackage,
  isAzureDocumentIntelligenceModel,
  normalizeAzureDocumentIntelligenceFeatures,
  parseAzureDocumentIntelligenceQueryFields,
  type AzureDocumentIntelligenceModel,
  type DocumentExtractionProvider,
} from "@bidwright/ingestion";

import {
  type PrismaApiStore,
  type AdjustmentPatchInput,
  type AdditionalLineItemPatchInput,
  type CatalogItemPatchInput,
  type CatalogPatchInput,
  type CreateAdjustmentInput,
  type CreateEstimateFactorInput,
  type CreateEstimateFactorLibraryEntryInput,
  type ConditionPatchInput,
  type CreateAdditionalLineItemInput,
  type CreateCatalogInput,
  type CreateCatalogItemInput,
  type CreateConditionInput,
  type CreateFileNodeInput,
  type CreateModifierInput,
  type CreatePhaseInput,
  type CreateReportSectionInput,
  type CreateWorksheetFolderInput,
  type CreateWorksheetInput,
  type CreateWorksheetItemInput,
  type CreateProjectInput,
  type CreateSummaryRowInput,
  type FileNodePatchInput,
  type EstimateFactorPatchInput,
  type EstimateFactorLibraryEntryPatchInput,
  type ModifierPatchInput,
  type PackageIngestionOutcome,
  type PhasePatchInput,
  type QuotePatchInput,
  type ReportSectionPatchInput,
  type RevisionPatchInput,
  type SourceDocumentPatchInput,
  type SummaryRowPatchInput,
  type StatusPatchInput,
  type WorksheetFolderPatchInput,
  type WorksheetPatchInput,
  type WorksheetItemPatchInput,
  type CreateJobInput,
  type ImportProcessInput,
  type PluginPatchInput,
  type CreatePluginInput,
  type CreateTakeoffAnnotationInput,
  type TakeoffAnnotationPatchInput,
  type CreateScheduleTaskInput,
  type ScheduleTaskPatchInput,
  type CreateDependencyInput,
  type CreateScheduleCalendarInput,
  type ScheduleCalendarPatchInput,
  type CreateScheduleResourceInput,
  type ScheduleResourcePatchInput,
  type CreateScheduleBaselineInput,
  type LineItemSearchSourceType
} from "./prisma-store.js";
import { prisma } from "@bidwright/db";
import {
  relativePackageArchivePath,
  relativeProjectFilePath,
  resolveApiPath,
  sanitizeFileName
} from "./paths.js";
import { knowledgeRoutes } from "./routes/knowledge-routes.js";
import { datasetRoutes } from "./routes/dataset-routes.js";
import { takeoffRoutes } from "./routes/takeoff-routes.js";
import { visionRoutes } from "./routes/vision-routes.js";
import { modelRoutes } from "./routes/model-routes.js";
import { fileIngestRoutes } from "./routes/file-ingest-routes.js";
import { scheduleImportRoutes } from "./routes/schedule-import-routes.js";
import { authPlugin } from "./middleware/auth.js";
import { authRoutes } from "./routes/auth-routes.js";
import { adminRoutes } from "./routes/admin-routes.js";
import { rateScheduleRoutes } from "./routes/rate-schedule-routes.js";
import { registerCliRoutes } from "./routes/cli-routes.js";
import { registerReviewRoutes } from "./routes/review-routes.js";
import { estimateRoutes } from "./routes/estimate-routes.js";
import { catalogRoutes } from "./routes/catalog-routes.js";
import { assemblyRoutes } from "./routes/assembly-routes.js";
import { laborUnitRoutes } from "./routes/labor-unit-routes.js";
import { settingsRoutes } from "./routes/settings-routes.js";
import { integrationsRoutes } from "./routes/integrations-routes.js";
import { webhooksRoutes } from "./routes/webhooks-routes.js";
import { costIntelligenceRoutes } from "./routes/cost-intelligence-routes.js";
import { buildPdfDataPackage, generatePdfHtml, generatePdfBuffer, buildSchedulePdfData, generateSchedulePdfHtml, generateSnapPdfHtml, type PdfLayoutOptions } from "./services/pdf-service.js";
import { sendQuoteEmail } from "./services/email-service.js";
import { parseImportFile } from "./services/catalog-import-service.js";
import { cleanExpiredSessions } from "./services/auth-service.js";
import {
  aiRewriteDescription,
  aiRewriteNotes,
  aiSuggestPhases,
  aiSuggestEquipment
} from "./services/ai-service.js";
import { executePluginSearchDataSource } from "./services/plugin-search-data-source.js";
import { knowledgeService } from "./services/knowledge-service.js";
import { documentTypeFromIngestion } from "./calc-utils.js";
import { inferPageCount, knowledgeCategoryFromDocType } from "./store/mappers.js";
import {
  attachNativePdfMetadata,
  choosePdfPageCount,
  getNativePdfPageCountFromBuffer,
  isPdfFileNameOrType,
  type NativePdfPageCountResult,
} from "./services/pdf-native-service.js";

const createProjectSchema = z.object({
  name: z.string().min(1),
  clientName: z.string().min(1),
  customerId: z.string().nullable().optional(),
  location: z.string().min(1),
  packageName: z.string().min(1).optional(),
  scope: z.string().optional(),
  creationMode: z.enum(["manual", "intake", "snap"]).optional(),
  summary: z.string().optional()
});

const workspacePatchSchema = z.record(z.unknown());
const ingestBodySchema = z.object({
  packageId: z.string().min(1).optional()
});
const revisionPatchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  breakoutStyle: z.enum(["grand_total", "category", "phase", "phase_detail", "labour_material_equipment"]).optional(),
  type: z.enum(["Firm", "Budget", "BudgetDNE"]).optional(),
  scratchpad: z.string().optional(),
  leadLetter: z.string().optional(),
  dateEstimatedShip: z.string().nullable().optional(),
  dateQuote: z.string().nullable().optional(),
  dateDue: z.string().nullable().optional(),
  dateWalkdown: z.string().nullable().optional(),
  dateWorkStart: z.string().nullable().optional(),
  dateWorkEnd: z.string().nullable().optional(),
  shippingMethod: z.string().optional(),
  shippingTerms: z.string().optional(),
  freightOnBoard: z.string().optional(),
  status: z.enum(["Open", "Pending", "Awarded", "DidNotGet", "Declined", "Cancelled", "Closed", "Other"]).optional(),
  defaultMarkup: z.number().finite().optional(),
  followUpNote: z.string().optional(),
  printEmptyNotesColumn: z.boolean().optional(),
  printCategory: z.array(z.string()).optional(),
  printPhaseTotalOnly: z.boolean().optional(),
  grandTotal: z.number().finite().optional(),
  regHours: z.number().finite().optional(),
  overHours: z.number().finite().optional(),
  doubleHours: z.number().finite().optional(),
  breakoutPackage: z.array(z.unknown()).optional(),
  calculatedCategoryTotals: z.array(z.unknown()).optional(),
  pdfPreferences: z.record(z.unknown()).optional()
});
const quotePatchSchema = z.object({
  customerExistingNew: z.enum(["Existing", "New"]).optional(),
  customerId: z.string().nullable().optional(),
  customerString: z.string().optional(),
  customerContactId: z.string().nullable().optional(),
  customerContactString: z.string().optional(),
  customerContactEmailString: z.string().optional(),
  departmentId: z.string().nullable().optional(),
  userId: z.string().nullable().optional()
});
const worksheetItemPatchSchema = z.object({
  phaseId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  category: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  entityName: z.string().min(1).optional(),
  classification: z.record(z.unknown()).optional(),
  costCode: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  description: z.string().optional(),
  quantity: z.number().finite().optional(),
  uom: z.string().min(1).optional(),
  cost: z.number().finite().optional(),
  markup: z.number().finite().optional(),
  price: z.number().finite().optional(),
  lineOrder: z.number().int().optional(),
  rateScheduleItemId: z.string().nullable().optional(),
  itemId: z.string().nullable().optional(),
  tierUnits: z.record(z.number()).optional(),
  sourceNotes: z.string().optional(),
  costResourceId: z.string().nullable().optional(),
  effectiveCostId: z.string().nullable().optional(),
  laborUnitId: z.string().nullable().optional(),
  resourceComposition: z.record(z.unknown()).optional(),
  sourceEvidence: z.record(z.unknown()).optional(),
});
const createWorksheetItemSchema = z.object({
  phaseId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  category: z.string().min(1),
  entityType: z.string().min(1),
  entityName: z.string().min(1),
  classification: z.record(z.unknown()).optional(),
  costCode: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  description: z.string().default(""),
  quantity: z.coerce.number().finite(),
  uom: z.string().min(1),
  cost: z.coerce.number().finite().optional(),
  markup: z.coerce.number().finite().optional(),
  price: z.coerce.number().finite().optional(),
  lineOrder: z.coerce.number().int().optional(),
  rateScheduleItemId: z.string().nullable().optional(),
  itemId: z.string().nullable().optional(),
  tierUnits: z.record(z.number()).optional(),
  sourceNotes: z.string().default(""),
  costResourceId: z.string().nullable().optional(),
  effectiveCostId: z.string().nullable().optional(),
  laborUnitId: z.string().nullable().optional(),
  resourceComposition: z.record(z.unknown()).optional(),
  sourceEvidence: z.record(z.unknown()).optional(),
});

const createWorksheetSchema = z.object({
  name: z.string().min(1),
  folderId: z.string().nullable().optional(),
  order: z.number().int().optional(),
});
const worksheetPatchSchema = z.object({
  name: z.string().min(1).optional(),
  order: z.number().int().optional(),
  folderId: z.string().nullable().optional(),
});
const createWorksheetFolderSchema = z.object({
  name: z.string().min(1),
  parentId: z.string().nullable().optional(),
  order: z.number().int().optional(),
});
const worksheetFolderPatchSchema = z.object({
  name: z.string().min(1).optional(),
  parentId: z.string().nullable().optional(),
  order: z.number().int().optional(),
});

const createPhaseSchema = z.object({
  parentId: z.string().nullable().optional(),
  number: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  order: z.number().int().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  color: z.string().optional()
});

const phasePatchSchema = z.object({
  parentId: z.string().nullable().optional(),
  number: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  order: z.number().int().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  color: z.string().optional()
});

const scheduleConstraintTypeSchema = z.enum(["asap", "alap", "snet", "snlt", "fnet", "fnlt", "mso", "mfo"]);
const scheduleResourceAssignmentSchema = z.object({
  resourceId: z.string().min(1),
  units: z.number().finite().positive().optional(),
  role: z.string().optional(),
});

const createScheduleTaskSchema = z.object({
  phaseId: z.string().nullable().optional(),
  calendarId: z.string().nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
  outlineLevel: z.number().int().min(0).max(12).optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  taskType: z.enum(["task", "milestone", "summary"]).optional(),
  status: z.enum(["not_started", "in_progress", "complete", "on_hold"]).optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  duration: z.number().int().min(0).optional(),
  progress: z.number().min(0).max(1).optional(),
  assignee: z.string().optional(),
  order: z.number().int().optional(),
  constraintType: scheduleConstraintTypeSchema.optional(),
  constraintDate: z.string().nullable().optional(),
  deadlineDate: z.string().nullable().optional(),
  actualStart: z.string().nullable().optional(),
  actualEnd: z.string().nullable().optional(),
  resourceAssignments: z.array(scheduleResourceAssignmentSchema).optional(),
});

const scheduleTaskPatchSchema = z.object({
  phaseId: z.string().nullable().optional(),
  calendarId: z.string().nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
  outlineLevel: z.number().int().min(0).max(12).optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  taskType: z.enum(["task", "milestone", "summary"]).optional(),
  status: z.enum(["not_started", "in_progress", "complete", "on_hold"]).optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  duration: z.number().int().min(0).optional(),
  progress: z.number().min(0).max(1).optional(),
  assignee: z.string().optional(),
  order: z.number().int().optional(),
  constraintType: scheduleConstraintTypeSchema.optional(),
  constraintDate: z.string().nullable().optional(),
  deadlineDate: z.string().nullable().optional(),
  actualStart: z.string().nullable().optional(),
  actualEnd: z.string().nullable().optional(),
  resourceAssignments: z.array(scheduleResourceAssignmentSchema).optional(),
});

const batchUpdateScheduleTasksSchema = z.object({
  updates: z.array(z.object({
    id: z.string().min(1),
    phaseId: z.string().nullable().optional(),
    calendarId: z.string().nullable().optional(),
    parentTaskId: z.string().nullable().optional(),
    outlineLevel: z.number().int().min(0).max(12).optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    taskType: z.enum(["task", "milestone", "summary"]).optional(),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    duration: z.number().int().min(0).optional(),
    progress: z.number().min(0).max(1).optional(),
    status: z.enum(["not_started", "in_progress", "complete", "on_hold"]).optional(),
    assignee: z.string().optional(),
    order: z.number().int().optional(),
    constraintType: scheduleConstraintTypeSchema.optional(),
    constraintDate: z.string().nullable().optional(),
    deadlineDate: z.string().nullable().optional(),
    actualStart: z.string().nullable().optional(),
    actualEnd: z.string().nullable().optional(),
    resourceAssignments: z.array(scheduleResourceAssignmentSchema).optional(),
  }))
});

const createDependencySchema = z.object({
  predecessorId: z.string().min(1),
  successorId: z.string().min(1),
  type: z.enum(["FS", "SS", "FF", "SF"]).optional(),
  lagDays: z.number().int().optional()
});

const scheduleCalendarSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  workingDays: z.record(z.boolean()).optional(),
  shiftStartMinutes: z.number().int().min(0).max(24 * 60).optional(),
  shiftEndMinutes: z.number().int().min(0).max(24 * 60).optional(),
});

const scheduleResourceSchema = z.object({
  calendarId: z.string().nullable().optional(),
  name: z.string().optional(),
  role: z.string().optional(),
  kind: z.enum(["labor", "crew", "equipment", "subcontractor"]).optional(),
  color: z.string().optional(),
  defaultUnits: z.number().finite().positive().optional(),
  capacityPerDay: z.number().finite().positive().optional(),
  costRate: z.number().finite().optional(),
});

const scheduleBaselineSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  kind: z.enum(["primary", "secondary", "tertiary", "snapshot", "custom"]).optional(),
  isPrimary: z.boolean().optional(),
});

const createModifierSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  appliesTo: z.string().optional(),
  percentage: z.number().finite().nullable().optional(),
  amount: z.number().finite().nullable().optional(),
  show: z.enum(["Yes", "No"]).optional()
});

const modifierPatchSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  appliesTo: z.string().optional(),
  percentage: z.number().finite().nullable().optional(),
  amount: z.number().finite().nullable().optional(),
  show: z.enum(["Yes", "No"]).optional()
});

const createAdjustmentSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  kind: z.enum(["modifier", "line_item"]).optional(),
  pricingMode: z.enum([
    "modifier",
    "option_standalone",
    "option_additional",
    "line_item_additional",
    "line_item_standalone",
    "custom_total",
  ]).optional(),
  financialCategory: z.string().optional(),
  calculationBase: z.enum(["selected_scope", "line_subtotal", "direct_cost", "cumulative"]).optional(),
  active: z.boolean().optional(),
  appliesTo: z.string().optional(),
  percentage: z.number().finite().nullable().optional(),
  amount: z.number().finite().nullable().optional(),
  show: z.enum(["Yes", "No"]).optional(),
  order: z.number().int().optional(),
});

const adjustmentPatchSchema = createAdjustmentSchema;

const estimateFactorScopeSchema = z.record(z.unknown()).optional();

const createEstimateFactorSchema = z.object({
  name: z.string().optional(),
  code: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  impact: z.enum(["labor_hours", "resource_units", "direct_cost", "sell_price"]).optional(),
  value: z.number().finite().min(0.05).max(10).optional(),
  active: z.boolean().optional(),
  appliesTo: z.string().optional(),
  applicationScope: z.enum(["global", "line", "both"]).optional(),
  scope: estimateFactorScopeSchema,
  formulaType: z.enum(["fixed_multiplier", "per_unit_scale", "condition_score", "temperature_productivity", "neca_condition_score", "extended_duration"]).optional(),
  parameters: z.record(z.unknown()).optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  sourceType: z.enum(["library", "knowledge", "labor_unit", "project_condition", "condition_difficulty", "neca_difficulty", "custom", "agent"]).optional(),
  sourceId: z.string().nullable().optional(),
  sourceRef: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  order: z.number().int().optional(),
});

const estimateFactorPatchSchema = createEstimateFactorSchema;

const estimateFactorLibraryEntrySchema = createEstimateFactorSchema;

const createConditionSchema = z.object({
  type: z.string().min(1),
  value: z.string().min(1),
  order: z.number().int().optional()
});

const conditionPatchSchema = z.object({
  type: z.string().min(1).optional(),
  value: z.string().min(1).optional(),
  order: z.number().int().optional()
});

const reorderSchema = z.object({
  orderedIds: z.array(z.string().min(1))
});

const createAliSchema = z.object({
  name: z.string().optional(),
  type: z.enum(["OptionStandalone", "OptionAdditional", "LineItemAdditional", "LineItemStandalone", "CustomTotal"]).optional(),
  description: z.string().optional(),
  amount: z.number().finite().optional()
});

const aliPatchSchema = z.object({
  name: z.string().optional(),
  type: z.enum(["OptionStandalone", "OptionAdditional", "LineItemAdditional", "LineItemStandalone", "CustomTotal"]).optional(),
  description: z.string().optional(),
  amount: z.number().finite().optional()
});

const createReportSectionSchema = z.object({
  sectionType: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  order: z.number().int().optional(),
  parentSectionId: z.string().nullable().optional()
});

const reportSectionPatchSchema = z.object({
  sectionType: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  order: z.number().int().optional(),
  parentSectionId: z.string().nullable().optional()
});

const statusPatchSchema = z.object({
  ingestionStatus: z.enum(["queued", "processing", "ready", "review", "quoted"])
});

const createCatalogSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  description: z.string().optional()
});

const catalogPatchSchema = z.object({
  name: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  description: z.string().optional()
});

const createCatalogItemSchema = z.object({
  code: z.string().default(""),
  name: z.string().min(1),
  unit: z.string().default("EA"),
  unitCost: z.number().finite().default(0),
  unitPrice: z.number().finite().default(0),
  category: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

const catalogItemPatchSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(1).optional(),
  unit: z.string().optional(),
  unitCost: z.number().finite().optional(),
  unitPrice: z.number().finite().optional(),
  category: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

const createFileNodeSchema = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string().min(1),
  type: z.enum(["file", "directory"]),
  fileType: z.string().optional(),
  size: z.number().int().optional(),
  documentId: z.string().optional(),
  storagePath: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdBy: z.string().optional()
});

const fileNodePatchSchema = z.object({
  name: z.string().min(1).optional(),
  parentId: z.string().nullable().optional()
});

const sourceDocumentPatchSchema = z.object({
  fileName: z.string().min(1).optional(),
  documentType: z.string().min(1).optional()
});

interface UploadFieldMap {
  projectId?: string;
  projectName?: string;
  name?: string;
  clientName?: string;
  customerId?: string;
  location?: string;
  packageName?: string;
  scope?: string;
  summary?: string;
  fileManifest?: string;
  sourceKind?: "project" | "library";
}

interface MultipartPackageUpload {
  packageId: string;
  fields: UploadFieldMap;
  originalFileName: string;
  storagePath: string;
  totalBytes: number;
  checksum: string;
}

interface StagedMultipartFile {
  originalFileName: string;
  safeFileName: string;
  relativePath: string;
  stagingPath: string;
  size: number;
  mimeType?: string;
}

interface UploadFileManifestEntry {
  index: number;
  relativePath?: string;
}

const MULTIPART_MAX_FILES = 10_000;
const MULTIPART_MAX_FIELDS = 32;
const MULTIPART_MAX_FILE_SIZE_BYTES = 1_073_741_824;

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function parseImportNumericValue(value: string) {
  const cleaned = String(value ?? "").replace(/[$,%\s]/g, "").replace(/,/g, "");
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildImportColumnProfiles(headers: string[], rows: string[][]) {
  return headers.map((header, index) => {
    const values = rows
      .map((row) => String(row[index] ?? "").trim())
      .filter(Boolean);
    const numericValues = values
      .map(parseImportNumericValue)
      .filter((value): value is number => value !== null);
    const distinctValues = Array.from(new Set(values.map((value) => value.toLowerCase())));
    const sampleValues = Array.from(new Set(values)).slice(0, 5);

    return {
      header,
      nonEmptyCount: values.length,
      numericCount: numericValues.length,
      distinctCount: distinctValues.length,
      sampleValues,
      ...(numericValues.length > 0 ? {
        sum: roundMoney(numericValues.reduce((sum, value) => sum + value, 0)),
        min: Math.min(...numericValues),
        max: Math.max(...numericValues),
      } : {}),
    };
  });
}

function buildImportPivotSummaries(headers: string[], rows: string[][]) {
  const profiles = buildImportColumnProfiles(headers, rows);
  const rowCount = Math.max(rows.length, 1);
  const groupCandidates = profiles
    .filter((profile) =>
      profile.nonEmptyCount > 0 &&
      profile.distinctCount > 1 &&
      profile.distinctCount <= Math.min(50, rowCount) &&
      profile.numericCount < profile.nonEmptyCount
    )
    .sort((a, b) => {
      const score = (header: string) => /category|type|vendor|phase|uom|unit|description|name/i.test(header) ? 0 : 1;
      return score(a.header) - score(b.header) || a.distinctCount - b.distinctCount;
    })
    .slice(0, 4);
  const measureCandidates = [
    { header: "__count", index: -1 },
    ...profiles
      .filter((profile) => profile.numericCount > 0)
      .sort((a, b) => b.numericCount - a.numericCount)
      .slice(0, 5)
      .map((profile) => ({ header: profile.header, index: headers.indexOf(profile.header) })),
  ];

  return groupCandidates.flatMap((group) => {
    const groupIndex = headers.indexOf(group.header);
    return measureCandidates.map((measure) => {
      const buckets = new Map<string, { count: number; total: number }>();
      for (const row of rows) {
        const label = String(row[groupIndex] ?? "").trim() || "(blank)";
        const bucket = buckets.get(label) ?? { count: 0, total: 0 };
        bucket.count += 1;
        bucket.total += measure.index >= 0 ? parseImportNumericValue(String(row[measure.index] ?? "")) ?? 0 : 1;
        buckets.set(label, bucket);
      }

      return {
        groupBy: group.header,
        measure: measure.header,
        rows: Array.from(buckets.entries())
          .map(([label, bucket]) => ({
            label,
            count: bucket.count,
            total: roundMoney(bucket.total),
            average: bucket.count > 0 ? roundMoney(bucket.total / bucket.count) : 0,
          }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 12),
      };
    });
  });
}

function hashFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function inferFallbackExtension(mimeType?: string) {
  switch ((mimeType ?? "").toLowerCase()) {
    case "application/zip":
    case "application/x-zip-compressed":
      return ".zip";
    case "application/vnd.ms-outlook":
      return ".msg";
    case "application/pdf":
      return ".pdf";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return ".xlsx";
    case "application/vnd.ms-excel.sheet.macroenabled.12":
      return ".xlsm";
    case "application/vnd.ms-excel":
      return ".xls";
    case "application/vnd.oasis.opendocument.spreadsheet":
      return ".ods";
    case "text/csv":
      return ".csv";
    case "text/tab-separated-values":
      return ".tsv";
    case "application/msword":
      return ".doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return ".docx";
    case "message/rfc822":
      return ".eml";
    case "application/x-7z-compressed":
      return ".7z";
    case "application/vnd.rar":
    case "application/x-rar-compressed":
      return ".rar";
    case "application/x-tar":
      return ".tar";
    case "application/gzip":
    case "application/x-gzip":
      return ".gz";
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "text/plain":
      return ".txt";
    default:
      return "";
  }
}

function inferMultipartFileName(fileName: string | undefined, mimeType: string | undefined, index: number) {
  const trimmed = fileName?.trim();
  if (trimmed) {
    return sanitizeFileName(path.basename(trimmed));
  }

  return sanitizeFileName(`upload-${index}${inferFallbackExtension(mimeType)}`);
}

function isZipUpload(fileName: string, mimeType?: string) {
  const ext = path.extname(fileName).toLowerCase();
  return ext === ".zip" || ["application/zip", "application/x-zip-compressed"].includes((mimeType ?? "").toLowerCase());
}

const EXPANDABLE_ARCHIVE_EXTENSIONS = new Set([".zip", ".7z", ".rar", ".tar", ".gz", ".tgz"]);
const EXPANDABLE_ARCHIVE_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-gzip",
]);

function isExpandableArchiveUpload(fileName: string, mimeType?: string) {
  const lower = fileName.toLowerCase();
  const ext = lower.endsWith(".tar.gz") ? ".tgz" : path.extname(lower);
  return EXPANDABLE_ARCHIVE_EXTENSIONS.has(ext) || EXPANDABLE_ARCHIVE_MIME_TYPES.has((mimeType ?? "").toLowerCase());
}

function isMsgUpload(fileName: string, mimeType?: string) {
  const ext = path.extname(fileName).toLowerCase();
  return ext === ".msg" || (mimeType ?? "").toLowerCase() === "application/vnd.ms-outlook";
}

function isEmlUpload(fileName: string, mimeType?: string) {
  const ext = path.extname(fileName).toLowerCase();
  return ext === ".eml" || (mimeType ?? "").toLowerCase() === "message/rfc822";
}

function ensureZipFileName(fileName: string) {
  const safe = sanitizeFileName(fileName);
  if (!safe) {
    return "customer-package.zip";
  }
  return safe.toLowerCase().endsWith(".zip") ? safe : `${safe}.zip`;
}

function buildSyntheticArchiveName(fields: UploadFieldMap, files: StagedMultipartFile[]) {
  const requestedName = fields.packageName?.trim();
  if (requestedName) {
    return ensureZipFileName(requestedName);
  }

  if (files.length === 1) {
    return ensureZipFileName(path.basename(files[0].originalFileName, path.extname(files[0].originalFileName)));
  }

  return ensureZipFileName(`customer-package-${files.length}-files`);
}

function normalizeArchiveEntryPath(value: string) {
  return value
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

function sanitizeArchiveDirectoryPath(value: string | undefined) {
  return normalizeArchiveEntryPath(value ?? "")
    .split("/")
    .filter(Boolean)
    .map((segment) => sanitizeFileName(segment))
    .filter(Boolean)
    .join("/");
}

function sanitizeArchiveFilePath(value: string | undefined, fallbackFileName: string) {
  const normalized = normalizeArchiveEntryPath(value ?? "");
  const directory = sanitizeArchiveDirectoryPath(path.posix.dirname(normalized));
  const desiredName = normalized ? path.posix.basename(normalized) : fallbackFileName;
  const safeName = sanitizeFileName(desiredName || fallbackFileName);
  return directory ? path.posix.join(directory, safeName) : safeName;
}

function archiveFileDirectory(value: string) {
  const directory = sanitizeArchiveDirectoryPath(path.posix.dirname(normalizeArchiveEntryPath(value)));
  return directory || "";
}

function archiveDerivedFolderPath(sourceFileName: string, depth: number) {
  const safeSourcePath = sanitizeArchiveFilePath(sourceFileName, `email-${depth + 1}.msg`);
  const directory = archiveFileDirectory(safeSourcePath);
  const baseName = sanitizeFileName(path.posix.basename(safeSourcePath, path.posix.extname(safeSourcePath))) || `email-${depth + 1}`;
  return directory ? path.posix.join(directory, baseName) : baseName;
}

function archiveOriginalSourcePath(sourceFileName: string, fallbackFileName: string) {
  return sanitizeArchiveFilePath(sourceFileName, fallbackFileName);
}

function parseUploadFileManifest(rawValue: string | undefined) {
  if (!rawValue?.trim()) {
    return new Map<number, string | undefined>();
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return new Map<number, string | undefined>();
    }

    const manifest = new Map<number, string | undefined>();
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const index = Number((entry as UploadFileManifestEntry).index);
      if (!Number.isInteger(index) || index < 0) {
        continue;
      }

      const relativePath = typeof (entry as UploadFileManifestEntry).relativePath === "string"
        ? (entry as UploadFileManifestEntry).relativePath
        : undefined;
      manifest.set(index, relativePath);
    }

    return manifest;
  } catch {
    return new Map<number, string | undefined>();
  }
}

function isIgnoredArchivePath(value: string) {
  const segments = normalizeArchiveEntryPath(value).split("/").filter(Boolean);
  return segments.length === 0 || segments.some((segment) => segment === "__MACOSX" || segment.startsWith("."));
}

function reserveUniqueArchivePath(usedPaths: Set<string>, desiredPath: string) {
  const normalized = normalizeArchiveEntryPath(desiredPath) || "file";
  const directory = path.posix.dirname(normalized);
  const extension = path.posix.extname(normalized);
  const baseName = path.posix.basename(normalized, extension) || "file";
  let candidate = normalized;
  let suffix = 2;

  while (usedPaths.has(candidate.toLowerCase())) {
    candidate = directory === "."
      ? `${baseName}-${suffix}${extension}`
      : path.posix.join(directory, `${baseName}-${suffix}${extension}`);
    suffix += 1;
  }

  usedPaths.add(candidate.toLowerCase());
  return candidate;
}

function addArchiveBuffer(zip: JSZip, usedPaths: Set<string>, desiredPath: string, content: Buffer | Uint8Array | string) {
  const finalPath = reserveUniqueArchivePath(usedPaths, desiredPath);
  zip.file(finalPath, content);
  return finalPath;
}

function toDataView(buffer: Buffer) {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function stripHtmlTags(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function recipientList(recipients: FieldsData[] | undefined, kind?: "to" | "cc" | "bcc") {
  return (recipients ?? [])
    .filter((recipient) => !kind || recipient.recipType === kind)
    .map((recipient) => recipient.smtpAddress || recipient.email || recipient.name || "")
    .map((value) => value.trim())
    .filter(Boolean);
}

function postalAddressList(addresses: PostalAddress[] | undefined) {
  const values: string[] = [];

  for (const address of addresses ?? []) {
    if ("group" in address && Array.isArray(address.group)) {
      values.push(...postalAddressList(address.group));
      continue;
    }

    const parts = [address.name, address.address].map((value) => value?.trim()).filter(Boolean);
    if (parts.length > 0) {
      values.push(parts.join(" "));
    }
  }

  return values;
}

function postalAttachmentBuffer(attachment: PostalAttachment) {
  if (typeof attachment.content === "string") {
    return Buffer.from(attachment.content, attachment.encoding === "base64" ? "base64" : "utf8");
  }

  if (attachment.content instanceof ArrayBuffer) {
    return Buffer.from(attachment.content);
  }

  return Buffer.from(attachment.content.buffer, attachment.content.byteOffset, attachment.content.byteLength);
}

function formatRfc822MessageSummary(sourceFileName: string, email: PostalEmail) {
  const from = postalAddressList(email.from ? [email.from] : undefined);
  const to = postalAddressList(email.to);
  const cc = postalAddressList(email.cc);
  const bcc = postalAddressList(email.bcc);
  const replyTo = postalAddressList(email.replyTo);
  const attachmentNames = email.attachments
    .map((attachment, index) =>
      attachment.filename ||
      `attachment-${index + 1}${inferFallbackExtension(attachment.mimeType)}`
    )
    .map((value) => value.trim())
    .filter(Boolean);
  const body = [
    email.text,
    email.html ? stripHtmlTags(email.html) : undefined,
  ]
    .map((value) => value?.trim())
    .find((value) => value && value.length > 0);

  const lines = [
    `Source file: ${sourceFileName}`,
    `Subject: ${email.subject?.trim() || "(no subject)"}`,
  ];

  if (from.length > 0) lines.push(`From: ${from.join("; ")}`);
  if (to.length > 0) lines.push(`To: ${to.join("; ")}`);
  if (cc.length > 0) lines.push(`CC: ${cc.join("; ")}`);
  if (bcc.length > 0) lines.push(`BCC: ${bcc.join("; ")}`);
  if (replyTo.length > 0) lines.push(`Reply-To: ${replyTo.join("; ")}`);
  if (email.date) lines.push(`Date: ${email.date}`);
  if (email.messageId) lines.push(`Message-ID: ${email.messageId}`);

  if (attachmentNames.length > 0) {
    lines.push("", "Attachments:");
    for (const attachmentName of attachmentNames) {
      lines.push(`- ${attachmentName}`);
    }
  }

  if (body) {
    lines.push("", "Body:", body);
  }

  return lines.join("\n");
}

function formatOutlookMessageSummary(sourceFileName: string, info: FieldsData) {
  const from = [info.senderSmtpAddress, info.senderEmail, info.senderName].filter(Boolean).join(" ").trim();
  const to = recipientList(info.recipients, "to");
  const cc = recipientList(info.recipients, "cc");
  const bcc = recipientList(info.recipients, "bcc");
  const attachmentNames = (info.attachments ?? [])
    .filter((attachment) => !attachment.attachmentHidden)
    .map((attachment, index) =>
      attachment.fileName || attachment.fileNameShort || attachment.name || `attachment-${index + 1}`
    );
  const body = [
    info.body,
    info.preview,
    info.bodyHtml ? stripHtmlTags(info.bodyHtml) : undefined,
  ]
    .map((value) => value?.trim())
    .find((value) => value && value.length > 0);

  const lines = [
    `Source file: ${sourceFileName}`,
    `Subject: ${info.subject?.trim() || "(no subject)"}`,
  ];

  if (from) lines.push(`From: ${from}`);
  if (to.length > 0) lines.push(`To: ${to.join("; ")}`);
  if (cc.length > 0) lines.push(`CC: ${cc.join("; ")}`);
  if (bcc.length > 0) lines.push(`BCC: ${bcc.join("; ")}`);
  if (info.messageDeliveryTime) lines.push(`Received: ${info.messageDeliveryTime}`);
  if (info.clientSubmitTime) lines.push(`Sent: ${info.clientSubmitTime}`);
  if (info.messageId) lines.push(`Message-ID: ${info.messageId}`);

  if (attachmentNames.length > 0) {
    lines.push("", "Attachments:");
    for (const attachmentName of attachmentNames) {
      lines.push(`- ${attachmentName}`);
    }
  }

  if (body) {
    lines.push("", "Body:", body);
  } else if (info.headers?.trim()) {
    lines.push("", "Headers:", info.headers.trim());
  }

  return lines.join("\n");
}

async function appendMsgBufferToArchive(
  zip: JSZip,
  usedPaths: Set<string>,
  buffer: Buffer,
  sourceFileName: string,
  depth = 0
) {
  const basePath = archiveDerivedFolderPath(sourceFileName, depth);
  const baseName = path.posix.basename(basePath);

  try {
    const reader = new MsgReader(toDataView(buffer));
    const info = reader.getFileData();
    addArchiveBuffer(zip, usedPaths, `${basePath}/${baseName}-email.txt`, formatOutlookMessageSummary(sourceFileName, info));

    for (const [index, attachment] of (info.attachments ?? []).entries()) {
      if (attachment.attachmentHidden) {
        continue;
      }

      const attachmentData = reader.getAttachment(attachment);
      const attachmentName = sanitizeFileName(
        attachmentData.fileName ||
        attachment.fileName ||
        attachment.fileNameShort ||
        attachment.name ||
        `attachment-${index + 1}`
      );
      const attachmentBuffer = Buffer.from(attachmentData.content);

      if (depth < 3 && isMsgUpload(attachmentName, attachment.attachMimeTag)) {
        await appendMsgBufferToArchive(
          zip,
          usedPaths,
          attachmentBuffer,
          path.posix.join(basePath, "attachments", attachmentName),
          depth + 1
        );
        continue;
      }

      addArchiveBuffer(zip, usedPaths, `${basePath}/attachments/${attachmentName}`, attachmentBuffer);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addArchiveBuffer(
      zip,
      usedPaths,
      `${basePath}/${baseName}-email.txt`,
      `Source file: ${sourceFileName}\n\nOutlook message parsing failed.\n${message}`
    );
    addArchiveBuffer(
      zip,
      usedPaths,
      archiveOriginalSourcePath(path.posix.join(basePath, path.posix.basename(sourceFileName)), path.posix.basename(sourceFileName)),
      buffer
    );
  }
}

async function appendEmlBufferToArchive(
  zip: JSZip,
  usedPaths: Set<string>,
  buffer: Buffer,
  sourceFileName: string,
  depth = 0
) {
  const basePath = archiveDerivedFolderPath(sourceFileName, depth);
  const baseName = path.posix.basename(basePath);

  try {
    const email = await PostalMime.parse(buffer, {
      rfc822Attachments: true,
      forceRfc822Attachments: true,
      attachmentEncoding: "arraybuffer",
    });
    addArchiveBuffer(zip, usedPaths, `${basePath}/${baseName}-email.txt`, formatRfc822MessageSummary(sourceFileName, email));

    for (const [index, attachment] of email.attachments.entries()) {
      const attachmentName = sanitizeFileName(
        attachment.filename ||
        `attachment-${index + 1}${inferFallbackExtension(attachment.mimeType)}`
      ) || `attachment-${index + 1}${inferFallbackExtension(attachment.mimeType)}`;
      const attachmentBuffer = postalAttachmentBuffer(attachment);

      if (depth < 3 && isMsgUpload(attachmentName, attachment.mimeType)) {
        await appendMsgBufferToArchive(
          zip,
          usedPaths,
          attachmentBuffer,
          path.posix.join(basePath, "attachments", attachmentName),
          depth + 1
        );
        continue;
      }

      if (depth < 3 && isEmlUpload(attachmentName, attachment.mimeType)) {
        await appendEmlBufferToArchive(
          zip,
          usedPaths,
          attachmentBuffer,
          path.posix.join(basePath, "attachments", attachmentName),
          depth + 1
        );
        continue;
      }

      addArchiveBuffer(zip, usedPaths, `${basePath}/attachments/${attachmentName}`, attachmentBuffer);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addArchiveBuffer(
      zip,
      usedPaths,
      `${basePath}/${baseName}-email.txt`,
      `Source file: ${sourceFileName}\n\nRFC822 email parsing failed.\n${message}`
    );
    addArchiveBuffer(
      zip,
      usedPaths,
      archiveOriginalSourcePath(path.posix.join(basePath, path.posix.basename(sourceFileName)), path.posix.basename(sourceFileName)),
      buffer
    );
  }
}

interface LibarchiveFileEntry {
  path?: string;
  file?: {
    name?: string;
    size?: number;
    extract?: () => Promise<File>;
  };
}

function libarchiveEntryPath(entry: LibarchiveFileEntry) {
  const directory = entry.path ?? "";
  const name = entry.file?.name ?? "file";
  return normalizeArchiveEntryPath(`${directory}${name}`);
}

async function appendExpandedLibarchiveToArchive(zip: JSZip, usedPaths: Set<string>, file: StagedMultipartFile) {
  const bytes = await readFile(file.stagingPath);
  const { Archive } = await import("libarchive.js/dist/libarchive-node.mjs");
  const sourceArchive = await Archive.open(new Blob([toArrayBuffer(bytes)]));
  const archiveFolder = sanitizeFileName(path.basename(file.originalFileName, path.extname(file.originalFileName))) || "archive";
  const archiveParent = archiveFileDirectory(file.relativePath);
  const archiveRoot = archiveParent ? path.posix.join(archiveParent, archiveFolder) : archiveFolder;

  try {
    const encrypted = await sourceArchive.hasEncryptedData();
    if (encrypted) {
      addArchiveBuffer(
        zip,
        usedPaths,
        `${archiveRoot}/ARCHIVE-ENCRYPTED.txt`,
        `Source archive ${file.originalFileName} appears to be encrypted and could not be expanded without a password.`
      );
      addArchiveBuffer(zip, usedPaths, archiveOriginalSourcePath(file.relativePath, file.safeFileName), bytes);
      return;
    }

    const entries = await sourceArchive.getFilesArray() as LibarchiveFileEntry[];
    for (const entry of entries.sort((a, b) => libarchiveEntryPath(a).localeCompare(libarchiveEntryPath(b)))) {
      const entryPath = libarchiveEntryPath(entry);
      if (!entryPath || isIgnoredArchivePath(entryPath) || !entry.file?.extract) {
        continue;
      }

      const extracted = await entry.file.extract();
      const entryBuffer = Buffer.from(await extracted.arrayBuffer());
      const expandedEntryPath = path.posix.join(archiveRoot, entryPath);

      if (isMsgUpload(entryPath)) {
        await appendMsgBufferToArchive(zip, usedPaths, entryBuffer, expandedEntryPath);
        continue;
      }

      if (isEmlUpload(entryPath)) {
        await appendEmlBufferToArchive(zip, usedPaths, entryBuffer, expandedEntryPath);
        continue;
      }

      addArchiveBuffer(zip, usedPaths, expandedEntryPath, entryBuffer);
    }
  } finally {
    await sourceArchive.close().catch(() => undefined);
  }
}

async function appendExpandedZipToArchive(zip: JSZip, usedPaths: Set<string>, file: StagedMultipartFile) {
  const bytes = await readFile(file.stagingPath);
  const sourceZip = await JSZip.loadAsync(bytes);
  const archiveFolder = sanitizeFileName(path.basename(file.originalFileName, path.extname(file.originalFileName))) || "archive";
  const archiveParent = archiveFileDirectory(file.relativePath);
  const archiveRoot = archiveParent ? path.posix.join(archiveParent, archiveFolder) : archiveFolder;

  for (const entryName of Object.keys(sourceZip.files).sort()) {
    const sourceEntry = sourceZip.files[entryName];
    if (!sourceEntry || sourceEntry.dir || isIgnoredArchivePath(entryName)) {
      continue;
    }

    const entryBuffer = await sourceEntry.async("nodebuffer");
    const normalizedEntryName = normalizeArchiveEntryPath(entryName);
    const expandedEntryPath = path.posix.join(archiveRoot, normalizedEntryName);

    if (isMsgUpload(normalizedEntryName)) {
      await appendMsgBufferToArchive(zip, usedPaths, entryBuffer, expandedEntryPath);
      continue;
    }

    if (isEmlUpload(normalizedEntryName)) {
      await appendEmlBufferToArchive(zip, usedPaths, entryBuffer, expandedEntryPath);
      continue;
    }

    addArchiveBuffer(zip, usedPaths, expandedEntryPath, entryBuffer);
  }
}

async function appendExpandedArchiveToArchive(zip: JSZip, usedPaths: Set<string>, file: StagedMultipartFile) {
  if (isZipUpload(file.originalFileName, file.mimeType)) {
    await appendExpandedZipToArchive(zip, usedPaths, file);
    return;
  }

  await appendExpandedLibarchiveToArchive(zip, usedPaths, file);
}

async function appendUploadedFileToArchive(zip: JSZip, usedPaths: Set<string>, file: StagedMultipartFile) {
  if (isExpandableArchiveUpload(file.originalFileName, file.mimeType)) {
    try {
      await appendExpandedArchiveToArchive(zip, usedPaths, file);
    } catch (error) {
      const buffer = await readFile(file.stagingPath);
      const message = error instanceof Error ? error.message : String(error);
      const fallbackRoot = archiveDerivedFolderPath(file.relativePath, 0);
      addArchiveBuffer(
        zip,
        usedPaths,
        `${fallbackRoot}/ARCHIVE-EXPANSION-FAILED.txt`,
        `Source archive ${file.originalFileName} could not be expanded.\n${message}`
      );
      addArchiveBuffer(zip, usedPaths, archiveOriginalSourcePath(file.relativePath, file.safeFileName), buffer);
    }
    return;
  }

  const buffer = await readFile(file.stagingPath);
  if (isMsgUpload(file.originalFileName, file.mimeType)) {
    await appendMsgBufferToArchive(zip, usedPaths, buffer, file.relativePath);
    return;
  }

  if (isEmlUpload(file.originalFileName, file.mimeType)) {
    await appendEmlBufferToArchive(zip, usedPaths, buffer, file.relativePath);
    return;
  }

  addArchiveBuffer(zip, usedPaths, file.relativePath, buffer);
}

async function writeSyntheticArchive(storagePath: string, files: StagedMultipartFile[]) {
  const zip = new JSZip();
  const usedPaths = new Set<string>();

  for (const file of files) {
    await appendUploadedFileToArchive(zip, usedPaths, file);
  }

  await mkdir(path.dirname(storagePath), { recursive: true });
  await pipeline(
    zip.generateNodeStream({
      streamFiles: true,
      compression: "DEFLATE",
    }),
    createWriteStream(storagePath)
  );
}

export function summaryMetrics(workspace: PackageIngestionOutcome["workspace"]) {
  return [
    {
      label: "Estimate Total",
      value: roundMoney(workspace.estimate.totals.calculatedTotal || workspace.estimate.totals.subtotal)
    },
    {
      label: "Projected Margin",
      value: roundMoney(workspace.estimate.totals.estimatedMargin)
    },
    {
      label: "Indexed Pages",
      value: workspace.sourceDocuments.reduce((sum, document) => sum + document.pageCount, 0)
    },
    {
      label: "AI Proposals",
      value: workspace.aiRuns.length
    }
  ];
}

async function saveMultipartPackageUpload(request: FastifyRequest): Promise<MultipartPackageUpload> {
  const fields: UploadFieldMap = {};
  const packageId = `pkg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const stagedFiles: StagedMultipartFile[] = [];
  const stagingDir = resolveApiPath("packages", packageId, "staging");
  let originalFileName = "";
  let storagePath = "";
  let totalBytes = 0;
  let checksum = "";

  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        const safeFileName = inferMultipartFileName(part.filename, part.mimetype, stagedFiles.length + 1);
        const stagingPath = path.join(
          stagingDir,
          `${String(stagedFiles.length + 1).padStart(3, "0")}-${safeFileName}`
        );

        await mkdir(path.dirname(stagingPath), { recursive: true });
        await pipeline(part.file, createWriteStream(stagingPath));

        const size = (await stat(stagingPath)).size;
        stagedFiles.push({
          originalFileName: part.filename?.trim() || safeFileName,
          safeFileName,
          relativePath: safeFileName,
          stagingPath,
          size,
          mimeType: part.mimetype,
        });
        continue;
      }

      const value = Array.isArray(part.value) ? part.value.join("") : String(part.value);
      (fields as Record<string, string | undefined>)[part.fieldname] = value;
    }

    if (stagedFiles.length === 0) {
      throw new Error("At least one file is required for package upload");
    }

    const fileManifest = parseUploadFileManifest(fields.fileManifest);
    delete fields.fileManifest;
    for (const [index, file] of stagedFiles.entries()) {
      file.relativePath = sanitizeArchiveFilePath(fileManifest.get(index), file.safeFileName);
    }

    const archiveFileName = buildSyntheticArchiveName(fields, stagedFiles);
    originalFileName = stagedFiles.length === 1 ? stagedFiles[0].originalFileName : archiveFileName;
    storagePath = resolveApiPath(relativePackageArchivePath(packageId, archiveFileName));

    if (
      stagedFiles.length === 1 &&
      isZipUpload(stagedFiles[0].originalFileName, stagedFiles[0].mimeType) &&
      path.posix.dirname(stagedFiles[0].relativePath) === "."
    ) {
      await mkdir(path.dirname(storagePath), { recursive: true });
      await rename(stagedFiles[0].stagingPath, storagePath);
    } else {
      await writeSyntheticArchive(storagePath, stagedFiles);
    }

    totalBytes = (await stat(storagePath)).size;
    checksum = await hashFile(storagePath);
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }

  return {
    packageId,
    fields,
    originalFileName,
    storagePath,
    totalBytes,
    checksum
  };
}

/** Convert simple markdown (paragraphs, lists, bold, italic) to HTML for the RichTextEditor. */
function markdownToBasicHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inUl = false;
  let inOl = false;

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Unordered list item: "- item" or "* item"
    const ulMatch = line.match(/^[\s]*[-*]\s+(.*)/);
    // Ordered list item: "1. item"
    const olMatch = line.match(/^[\s]*\d+\.\s+(.*)/);

    if (ulMatch) {
      if (inOl) { out.push("</ol>"); inOl = false; }
      if (!inUl) { out.push("<ul>"); inUl = true; }
      out.push(`<li>${inlineFormat(ulMatch[1])}</li>`);
    } else if (olMatch) {
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (!inOl) { out.push("<ol>"); inOl = true; }
      out.push(`<li>${inlineFormat(olMatch[1])}</li>`);
    } else {
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (inOl) { out.push("</ol>"); inOl = false; }

      if (line.trim() === "") {
        // skip blank lines between paragraphs
      } else if (line.startsWith("### ")) {
        out.push(`<h3>${inlineFormat(line.slice(4))}</h3>`);
      } else if (line.startsWith("## ")) {
        out.push(`<h2>${inlineFormat(line.slice(3))}</h2>`);
      } else if (line.startsWith("# ")) {
        out.push(`<h1>${inlineFormat(line.slice(2))}</h1>`);
      } else {
        out.push(`<p>${inlineFormat(line)}</p>`);
      }
    }
  }
  if (inUl) out.push("</ul>");
  if (inOl) out.push("</ol>");
  return out.join("");
}

function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
}

function createProjectInputFromUpload(fields: UploadFieldMap, originalFileName: string): CreateProjectInput {
  const packageName = fields.packageName?.trim() || path.basename(originalFileName, path.extname(originalFileName));
  return {
    name: fields.projectName?.trim() || fields.name?.trim() || packageName,
    clientName: fields.clientName?.trim() || "Unassigned Client",
    customerId: fields.customerId?.trim() || undefined,
    location: fields.location?.trim() || "TBD",
    packageName,
    scope: fields.scope?.trim() || undefined,
    summary: fields.summary?.trim() || undefined
  };
}

function buildPackageResponse(result: PackageIngestionOutcome) {
  return {
    project: result.project,
    quote: result.quote,
    revision: result.revision,
    package: result.packageRecord,
    job: result.job,
    documents: result.documents,
    workspace: result.workspace,
    estimate: result.workspace.estimate,
    totals: result.totals,
    summaryMetrics: summaryMetrics(result.workspace)
  };
}

export async function buildWorkspaceResponse(store: PrismaApiStore, projectId: string) {
  const workspace = await store.getWorkspace(projectId);
  if (!workspace) {
    return null;
  }

  const rateSchedules = await store.listRevisionRateSchedules(projectId);
  const entityCategories = await store.listEntityCategories();
  const settings = await store.getSettings();
  const orgDefaults = (settings?.defaults ?? {}) as Record<string, unknown>;
  const meta = {
    benchmarkingEnabled: orgDefaults.benchmarkingEnabled === true,
  };

  return {
    workspace: {
      ...workspace,
      rateSchedules,
      entityCategories,
      meta,
    },
    workspaceState: await store.getWorkspaceState(projectId),
    summaryMetrics: summaryMetrics(workspace),
    packages: await store.listPackages(projectId),
    jobs: await store.listJobs(projectId),
    documents: await store.listDocuments(projectId)
  };
}

function buildWorksheetItemMutationResponse(
  mode: "create" | "update" | "delete",
  mutation: Awaited<ReturnType<PrismaApiStore["createWorksheetItemWithSnapshot"]>>,
) {
  return {
    mode,
    item: mutation.item,
    currentRevision: mutation.snapshot.currentRevision,
    estimateTotals: mutation.snapshot.estimateTotals,
  };
}

function requestActor(request: FastifyRequest): string {
  const raw = request.headers["x-bidwright-actor"];
  if (Array.isArray(raw)) return raw[0]?.toLowerCase() ?? "";
  return typeof raw === "string" ? raw.toLowerCase() : "";
}

function shouldCaptureHumanEstimateFeedback(request: FastifyRequest): boolean {
  const actor = requestActor(request);
  return actor === "" || actor === "web";
}

async function captureHumanEstimateFeedback(
  request: FastifyRequest,
  projectId: string,
  correction: Record<string, unknown>,
  options?: {
    source?: string;
    feedbackType?: string;
    sourceLabel?: string;
    notes?: string;
    quoteReviewId?: string | null;
    createNew?: boolean;
  },
) {
  if (!request.store || !shouldCaptureHumanEstimateFeedback(request)) return;
  await request.store.captureAutomaticEstimateFeedback(projectId, {
    source: options?.source,
    feedbackType: options?.feedbackType,
    sourceLabel: options?.sourceLabel,
    notes: options?.notes,
    quoteReviewId: options?.quoteReviewId ?? null,
    createNew: options?.createNew,
    correction,
  }).catch(() => null);
}

function snapLineLimitFromState(state: Record<string, unknown> | undefined): number | null {
  if (!state || state.quoteMode !== "snap" || state.snapUpgraded === true) return null;
  return typeof state.snapLineLimit === "number"
    ? Math.max(1, Math.floor(state.snapLineLimit))
    : 10;
}

async function ingestUploadForProject(store: PrismaApiStore, request: FastifyRequest, reply: FastifyReply, projectIdOverride?: string) {
  const multipartUpload = await saveMultipartPackageUpload(request);
  const sourceKind = multipartUpload.fields.sourceKind ?? "project";
  const projectId = (projectIdOverride ?? multipartUpload.fields.projectId)?.trim();

  if (projectIdOverride && multipartUpload.fields.projectId && multipartUpload.fields.projectId.trim() !== projectIdOverride) {
    reply.code(400);
    return {
      message: "Multipart projectId does not match the route projectId"
    };
  }

  let targetProjectId = projectId ?? null;
  if (targetProjectId) {
    const existingProject = await store.getProject(targetProjectId);
    if (!existingProject) {
      reply.code(404);
      return {
        message: "Project not found"
      };
    }
  } else {
    const createdProject = await store.createProject(createProjectInputFromUpload(multipartUpload.fields, multipartUpload.originalFileName));
    targetProjectId = createdProject.project.id;
  }

  if (!targetProjectId) {
    reply.code(400);
    return {
      message: "Project could not be resolved for package upload"
    };
  }

  // Sync customerId so the project's clientName + quote's customer fields are
  // populated. Run on both the new-project path (where createProject's
  // resolveCustomerSelection is the primary applier but can be bypassed if
  // the customerId is missing from CreateProjectInput) and the existing-
  // project upload path. assignProjectCustomer is idempotent against a
  // customer that is already correctly assigned.
  const ingestCustomerId = multipartUpload.fields.customerId?.trim();
  if (ingestCustomerId) {
    await store.assignProjectCustomer(targetProjectId, ingestCustomerId);
  }

  const packageName =
    multipartUpload.fields.packageName?.trim() ||
    path.basename(multipartUpload.originalFileName, path.extname(multipartUpload.originalFileName));

  await store.registerUploadedPackage({
    packageId: multipartUpload.packageId,
    projectId: targetProjectId,
    packageName,
    originalFileName: multipartUpload.originalFileName,
    storagePath: path.relative(resolveApiPath(), multipartUpload.storagePath),
    checksum: multipartUpload.checksum,
    totalBytes: multipartUpload.totalBytes,
    sourceKind
  });

  // List ZIP entries immediately and create placeholder SourceDocument records
  // so the file browser shows documents right away. The async ingestion will
  // UPDATE these records with extracted text, page counts, and Azure DI data.
  const placeholderDocIds: string[] = [];
  try {
    const zipData = await readFile(multipartUpload.storagePath);
    const zip = await JSZip.loadAsync(zipData);
    const now = new Date();
    const usedDocumentNames = new Set<string>();

    // Also extract files to disk for CLI access
    const docsDir = resolveApiPath("projects", targetProjectId!, "documents");
    await mkdir(docsDir, { recursive: true });

    const entries: string[] = [];
    zip.forEach((relativePath, entry) => {
      if (!entry.dir && !relativePath.startsWith("__MACOSX") && !relativePath.startsWith(".")) {
        const ext = path.extname(relativePath).toLowerCase();
        if ([".pdf", ".xlsx", ".xls", ".xlsm", ".ods", ".csv", ".tsv", ".docx", ".doc", ".rtf", ".pptx", ".html", ".htm", ".mhtml", ".mht", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".dwg", ".dxf", ".msg", ".eml", ".txt", ".xml", ".mpp", ".mpt", ".mpx", ".xer", ".p6xml", ".pmxml"].includes(ext)) {
          entries.push(relativePath);
        }
      }
    });

    for (const relativePath of entries) {
      const sanitized = reserveUniqueArchivePath(usedDocumentNames, sanitizeArchiveFilePath(relativePath, path.basename(relativePath)));
      const fileName = path.posix.basename(sanitized);
      const ext = path.extname(fileName).toLowerCase();
      const docId = `doc-${randomUUID()}`;
      const relStoragePath = path.join("projects", targetProjectId!, "documents", ...sanitized.split("/"));

      // Extract file to disk FIRST so storagePath is valid
      try {
        const zipEntry = zip.file(relativePath);
        if (zipEntry) {
          const fileData = await zipEntry.async("nodebuffer");
          const diskPath = path.join(docsDir, ...sanitized.split("/"));
          await mkdir(path.dirname(diskPath), { recursive: true });
          await writeFile(diskPath, fileData);
        } else {
          console.error("[upload] zip.file() returned null for:", relativePath);
        }
      } catch (extractErr) {
        console.error("[upload] Failed to extract:", relativePath, extractErr instanceof Error ? extractErr.message : extractErr);
      }

      // Classify document type from filename
      const lowerName = fileName.toLowerCase();
      const docType = lowerName.includes("spec") ? "specification"
        : (lowerName.includes("pid") || lowerName.includes("p&id")) ? "drawing"
        : (lowerName.includes("rfq") || lowerName.includes("quotation")) ? "rfp"
        : "reference";

      await prisma.sourceDocument.create({
        data: {
          id: docId,
          projectId: targetProjectId!,
          fileName: sanitized,
          fileType: ext.replace(".", ""),
          documentType: docType,
          pageCount: 0,
          checksum: "",
          storagePath: relStoragePath,
          extractedText: "",
          createdAt: now,
          updatedAt: now,
        },
      });
      placeholderDocIds.push(docId);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    console.error("[upload] PLACEHOLDER DOCS FAILED:", errMsg);
    // Store error for debugging
    (multipartUpload as any)._placeholderError = errMsg;
  }

  // Store placeholder doc IDs so ingestion can clean them up when it creates real docs
  if (placeholderDocIds.length > 0) {
    try {
      await prisma.storedPackage.update({
        where: { id: multipartUpload.packageId },
        data: { documentIds: placeholderDocIds },
      });
    } catch {}
  }

  // Run ingestion asynchronously — return immediately so the UI can redirect
  store.ingestUploadedPackage(multipartUpload.packageId).then(async (outcome) => {
    // Write ingestion results to agent memory so the AI drawer can display them
    try {
      const docs = outcome.documents ?? [];
      const summary = docs.map((d: any) => {
        const type = d.documentType ?? d.fileType ?? "unknown";
        const pages = d.pageCount ?? 0;
        const hasText = d.extractedText && d.extractedText.length > 50;
        return `- ${d.fileName} | ${type} | ${pages} pages | ${hasText ? "text extracted" : "no text"}`;
      }).join("\n");

      const memPath = resolveApiPath("projects", targetProjectId!, "agent-memory.json");
      let memory: any = { sections: {}, updatedAt: null };
      try { memory = JSON.parse(await readFile(memPath, "utf8")); } catch {}
      memory.sections["ingestion_results"] = `## Document Ingestion Complete\n\n${docs.length} documents extracted from package:\n\n${summary}`;
      memory.updatedAt = new Date().toISOString();
      await mkdir(path.dirname(memPath), { recursive: true });
      await writeFile(memPath, JSON.stringify(memory, null, 2), "utf8");
    } catch {}
  }).catch((err) => {
    console.error(`[ingestion] Package ${multipartUpload.packageId} failed:`, err);
  });

  // Return project info — all files are already on disk and SourceDocument records exist
  const project = await store.getProject(targetProjectId);
  const workspace = await store.getWorkspace(targetProjectId);
  reply.code(201);
  return {
    project,
    quote: workspace?.quote ?? null,
    revision: workspace?.currentRevision ?? null,
    documentCount: placeholderDocIds.length,
    status: "processing",
    message: `Package uploaded. ${placeholderDocIds.length} documents ready. Text extraction running in background.`,
  };
}

export function buildServer() {
  const app = Fastify({
    logger: true
  });

  // Allow empty JSON body (sends {} instead of erroring with FST_ERR_CTP_EMPTY_JSON_BODY)
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const str = (body as string || "").trim();
    if (!str) return done(null, {});
    try {
      done(null, JSON.parse(str));
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // Prisma lifecycle
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  app.register(cors, {
    origin: true,
    credentials: true
  });

  app.register(multipart, {
    limits: {
      files: MULTIPART_MAX_FILES,
      fields: MULTIPART_MAX_FIELDS,
      parts: MULTIPART_MAX_FILES + MULTIPART_MAX_FIELDS,
      fileSize: MULTIPART_MAX_FILE_SIZE_BYTES
    }
  });

  app.register(authPlugin);

  app.setErrorHandler((error, _request, reply) => {
    const multipartCode = typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : null;

    const statusCode = (() => {
      if (multipartCode === "FST_FILES_LIMIT" || multipartCode === "FST_PARTS_LIMIT" || multipartCode === "FST_FILE_TOO_LARGE") {
        return 413;
      }

      if (typeof (error as { statusCode?: unknown }).statusCode === "number") {
        return (error as { statusCode: number }).statusCode;
      }

      return 500;
    })();

    const message = (() => {
      switch (multipartCode) {
        case "FST_FILES_LIMIT":
          return `Upload contains too many files. Intake accepts up to ${MULTIPART_MAX_FILES.toLocaleString()} files per upload.`;
        case "FST_PARTS_LIMIT":
          return `Upload contains too many multipart parts. Intake accepts up to ${(MULTIPART_MAX_FILES + MULTIPART_MAX_FIELDS).toLocaleString()} total parts per upload.`;
        case "FST_FILE_TOO_LARGE":
          return `One of the uploaded files exceeds the ${Math.floor(MULTIPART_MAX_FILE_SIZE_BYTES / (1024 * 1024 * 1024))} GB per-file limit.`;
        default:
          return error instanceof Error ? error.message : "Internal server error";
      }
    })();

    if (statusCode >= 500) {
      app.log.error(error);
    } else {
      app.log.warn(error);
    }

    // Surface error.details when present so callers (especially the AI agent)
    // can see the structured validation issues attached by store methods —
    // e.g. finalizeEstimateStrategy throws with details.validationIssues.
    const details = (error as { details?: unknown }).details;

    reply.status(statusCode).send({
      message,
      code: multipartCode ?? undefined,
      details: details ?? undefined,
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "bidwright-api",
    dataRoot: resolveApiPath()
  }));

  app.get("/projects", async (request) => {
    const store = request.store!;
    const projects = await store.listProjectsWithState();
    // Include org users + departments for filter dropdowns
    const [users, departments] = await Promise.all([
      prisma.user.findMany({
        where: { organizationId: store.organizationId, active: true },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      }),
      prisma.department.findMany({
        where: { organizationId: store.organizationId, active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return { projects, users, departments };
  });

  app.post("/projects", async (request, reply) => {
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid project payload",
        issues: parsed.error.flatten()
      });
    }

    const result = await request.store!.createProject(parsed.data);
    reply.code(201);
    return result;
  });

  app.get("/projects/:projectId", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);

    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }

    return project;
  });

  // PATCH /projects/:projectId — update project + quote + revision metadata
  // Accepts all fields and routes them to the correct table:
  //   Project: name (alias: projectName), clientName, location, scope, summary
  //   Quote: title (synced from name), customerString (synced from clientName)
  //   QuoteRevision: description, notes
  app.patch("/projects/:projectId", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as Record<string, unknown>;

    // Map input fields to the correct tables
    const projectPatch: Record<string, unknown> = {};
    const revisionPatch: Record<string, unknown> = {};

    // Project fields
    const name = (body.projectName ?? body.name) as string | undefined;
    if (name) projectPatch.name = name;
    if (body.clientName) projectPatch.clientName = body.clientName;
    if (body.location) projectPatch.location = body.location;
    if (body.scope) projectPatch.scope = body.scope;
    if (body.summary) projectPatch.summary = body.summary;

    // Revision fields (description and notes live on QuoteRevision, not Project)
    if (body.description) {
      const desc = body.description as string;
      // If the description doesn't already contain HTML tags, convert markdown-style text to basic HTML
      // so the RichTextEditor in the UI renders it properly (lists, paragraphs, bold, etc.)
      revisionPatch.description = /<[a-z][\s\S]*>/i.test(desc) ? desc : markdownToBasicHtml(desc);
    }
    if (body.notes) revisionPatch.notes = body.notes;

    if (Object.keys(projectPatch).length === 0 && Object.keys(revisionPatch).length === 0) {
      return reply.code(400).send({ message: "No valid fields to update" });
    }

    try {
      const scopedProject = await request.store!.getProject(projectId);
      if (!scopedProject) return reply.code(404).send({ message: "Project not found" });

      const beforeProject = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
          name: true,
          clientName: true,
          location: true,
          scope: true,
          summary: true,
        },
      });

      // Update project
      if (Object.keys(projectPatch).length > 0) {
        await prisma.project.update({
          where: { id: projectId },
          data: { ...projectPatch, updatedAt: new Date() },
        });
      }

      // Sync name/client to Quote + Revision
      const quote = await prisma.quote.findFirst({ where: { projectId } });
      let revisionSnapshotBefore: { id: string; title: string; description: string; notes: string } | null = null;
      let revisionSnapshotAfter: { id: string; title: string; description: string; notes: string } | null = null;
      if (quote) {
        const quoteUpdate: Record<string, unknown> = {};
        if (name) quoteUpdate.title = name;
        if (body.clientName) quoteUpdate.customerString = body.clientName;
        if (Object.keys(quoteUpdate).length > 0) {
          await prisma.quote.update({ where: { id: quote.id }, data: quoteUpdate });
        }

        // Also sync project name to QuoteRevision.title so the setup tab reflects it
        if (name) revisionPatch.title = name;

        // Update revision description/notes/title
        const revision = await prisma.quoteRevision.findFirst({
          where: { quoteId: quote.id },
          orderBy: { createdAt: "desc" },
        });
        if (revision) {
          revisionSnapshotBefore = {
            id: revision.id,
            title: revision.title,
            description: revision.description,
            notes: revision.notes,
          };
        }
        if (Object.keys(revisionPatch).length > 0) {
          if (revision) {
            const updatedRevision = await prisma.quoteRevision.update({
              where: { id: revision.id },
              data: revisionPatch,
            });
            revisionSnapshotAfter = {
              id: updatedRevision.id,
              title: updatedRevision.title,
              description: updatedRevision.description,
              notes: updatedRevision.notes,
            };
          }
        } else {
          revisionSnapshotAfter = revisionSnapshotBefore;
        }

        const afterProject = await prisma.project.findUnique({
          where: { id: projectId },
          select: {
            name: true,
            clientName: true,
            location: true,
            scope: true,
            summary: true,
          },
        });

        const changedFields = [...Object.keys(projectPatch), ...Object.keys(revisionPatch)];
        if (changedFields.length > 0) {
          await request.store!.logActivity(projectId, revisionSnapshotAfter?.id ?? revisionSnapshotBefore?.id ?? quote.currentRevisionId ?? null, "quote_updated", {
            fields: changedFields,
            before: {
              project: beforeProject,
              revision: revisionSnapshotBefore,
            },
            after: {
              project: afterProject,
              revision: revisionSnapshotAfter,
            },
          });
        }
      } else if (Object.keys(projectPatch).length > 0) {
        const afterProject = await prisma.project.findUnique({
          where: { id: projectId },
          select: {
            name: true,
            clientName: true,
            location: true,
            scope: true,
            summary: true,
          },
        });
        await request.store!.logActivity(projectId, null, "quote_updated", {
          fields: Object.keys(projectPatch),
          before: {
            project: beforeProject,
            revision: null,
          },
          after: {
            project: afterProject,
            revision: null,
          },
        });
      }

      return { ok: true, updated: { ...projectPatch, ...revisionPatch } };
    } catch (err) {
      return reply.code(500).send({ message: err instanceof Error ? err.message : "Update failed" });
    }
  });

  app.get("/projects/:projectId/workspace", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const payload = await buildWorkspaceResponse(request.store!, projectId);

    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }

    return payload;
  });

  // ── Ingestion Status (for polling from AI drawer) ────────────────
  // Returns the project-level ingestion status plus a per-document
  // breakdown. The UI uses this to:
  //   - Hold the estimator launch surface while ingestion runs
  //   - Show which extraction provider produced each doc's content
  //     (Azure DI signals: structuredData carries tables / keyValuePairs /
  //     selectionMarks; pure local parsing leaves only extractedText)
  //   - Surface an aggregate summary (extracted vs pending vs failed)
  //
  // Provider derivation is shape-based so we don't require a schema column
  // for every supported extractor — adding a new provider only needs the
  // ingestion path to populate `structuredData` (or extractedText) so the
  // status endpoint and UI light up automatically.
  app.get("/projects/:projectId/ingestion-status", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return {
        status: "unknown",
        documents: [],
        documentCount: 0,
        summary: { extracted: 0, pending: 0, failed: 0, total: 0 },
      };
    }

    const latestJob = await prisma.ingestionJob.findFirst({
      where: { projectId, kind: "package_ingest" },
      orderBy: { createdAt: "desc" },
    }).catch(() => null);
    const latestJobOutput = latestJob?.output && typeof latestJob.output === "object"
      ? latestJob.output as Record<string, any>
      : {};
    const inProgressDocuments = Array.isArray(latestJobOutput.documentProgress)
      ? latestJobOutput.documentProgress
      : [];

    const documents = await request.store!.listDocuments(projectId);
    const finalizedById = new Map(documents.map((document: any) => [document.id, document]));
    const enrichedFinalized = documents.map((d: any) => {
      const hasText = !!(d.extractedText && String(d.extractedText).length > 50);
      const structured = d.structuredData ?? null;
      const structuredObj =
        structured && typeof structured === "object" && !Array.isArray(structured)
          ? (structured as Record<string, unknown>)
          : null;
      // Treat the document as Azure-extracted whenever its structuredData
      // carries one of the Azure DI artifacts. Anything else with text is
      // local-parsed; anything without is still pending.
      const azureSignals =
        !!structuredObj &&
        ((Array.isArray((structuredObj as any).tables) && (structuredObj as any).tables.length > 0) ||
          Array.isArray((structuredObj as any).keyValuePairs) ||
          Array.isArray((structuredObj as any).selectionMarks) ||
          Array.isArray((structuredObj as any).documentFields));
      let extractionProvider: string | null = null;
      let extractionState: "pending" | "extracted" | "text_only" = "pending";
      if (azureSignals) {
        extractionProvider = "azure_di";
        extractionState = "extracted";
      } else if (hasText) {
        extractionProvider = "local";
        extractionState = hasText ? "extracted" : "text_only";
      } else {
        extractionProvider = null;
        extractionState = "pending";
      }
      return {
        id: d.id,
        fileName: d.fileName,
        fileType: d.fileType,
        documentType: d.documentType,
        pageCount: d.pageCount,
        hasText,
        extractionProvider,
        extractionState,
        status: extractionState === "extracted" ? "complete" : "pending",
        stage: extractionState === "extracted" ? "Ready" : "Pending",
        progress: extractionState === "extracted" ? 1 : 0,
      };
    });

    const progressDocs = inProgressDocuments
      .filter((doc: any) => !doc?.id || !finalizedById.has(doc.id))
      .map((doc: any, index: number) => ({
        id: String(doc.id || `progress-${index}`),
        fileName: String(doc.fileName || doc.sourcePath || `Document ${index + 1}`),
        fileType: String(doc.fileType || path.extname(String(doc.fileName || "")).replace(/^\./, "") || "file"),
        documentType: String(doc.documentType || "pending"),
        pageCount: Number(doc.pageCount) || 0,
        hasText: doc.status === "complete",
        extractionProvider: doc.extractionProvider ?? null,
        extractionState: doc.status === "complete" ? "extracted" : doc.status === "failed" ? "failed" : "pending",
        status: doc.status || "queued",
        stage: doc.stage || "Queued",
        progress: typeof doc.progress === "number" ? doc.progress : 0,
        size: Number(doc.size) || 0,
        sourcePath: doc.sourcePath || null,
        error: doc.error || null,
        updatedAt: doc.updatedAt || latestJob?.updatedAt?.toISOString?.() || null,
      }));

    const enriched = project.ingestionStatus === "processing" || project.ingestionStatus === "queued"
      ? [...progressDocs, ...enrichedFinalized]
      : enrichedFinalized;

    let extracted = 0;
    let pending = 0;
    let failed = 0;
    for (const doc of enriched) {
      if (doc.extractionState === "failed" || doc.status === "failed") failed += 1;
      else if (doc.extractionState === "extracted" || doc.status === "complete") extracted += 1;
      else pending += 1;
    }

    return {
      status: (project as any).ingestionStatus ?? "unknown",
      job: latestJob ? {
        id: latestJob.id,
        status: latestJob.status,
        progress: latestJob.progress,
        stage: latestJobOutput.stage ?? null,
        message: latestJobOutput.message ?? null,
        currentDocumentId: latestJobOutput.currentDocumentId ?? null,
        currentDocumentName: latestJobOutput.currentDocumentName ?? null,
        updatedAt: latestJob.updatedAt?.toISOString?.() ?? null,
      } : null,
      documentCount: enriched.length,
      documents: enriched,
      summary: {
        total: enriched.length,
        extracted,
        pending,
        failed,
      },
    };
  });

  // ── Agent Memory (per-project persistent scratchpad) ─────────────
  app.get("/projects/:projectId/agent-memory", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const memPath = resolveApiPath("projects", projectId, "agent-memory.json");
    try {
      const raw = await readFile(memPath, "utf8");
      return JSON.parse(raw);
    } catch {
      return { sections: {}, updatedAt: null };
    }
  });

  app.put("/projects/:projectId/agent-memory", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as { section: string; content: string; append?: boolean };
    const memPath = resolveApiPath("projects", projectId, "agent-memory.json");

    let memory: { sections: Record<string, string>; updatedAt: string | null } = { sections: {}, updatedAt: null };
    try {
      const raw = await readFile(memPath, "utf8");
      memory = JSON.parse(raw);
    } catch {}

    if (body.append && memory.sections[body.section]) {
      memory.sections[body.section] += "\n" + body.content;
    } else {
      memory.sections[body.section] = body.content;
    }
    memory.updatedAt = new Date().toISOString();

    await mkdir(path.dirname(memPath), { recursive: true });
    await writeFile(memPath, JSON.stringify(memory, null, 2), "utf8");
    return memory;
  });

  app.get("/projects/:projectId/estimate", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await request.store!.getWorkspace(projectId);

    if (!workspace) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }

    return workspace.estimate;
  });

  app.post("/projects/:projectId/recalculate", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    await request.store!.recalculateProjectEstimate(projectId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  app.get("/projects/:projectId/packages", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }
    return request.store!.listPackages(projectId);
  });

  app.get("/projects/:projectId/jobs", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }
    return request.store!.listJobs(projectId);
  });

  app.get("/projects/:projectId/documents", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }
    return request.store!.listDocuments(projectId);
  });

  app.post("/projects/:projectId/documents/upload", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }

    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;
    let originalFileName = "";
    let fileSeen = false;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (fileSeen) {
          return reply.code(400).send({ message: "Only one file per upload" });
        }
        fileSeen = true;
        originalFileName = part.filename || "unnamed";
        fileBuffer = await part.toBuffer();
      } else {
        fields[part.fieldname] = Array.isArray(part.value) ? part.value.join("") : String(part.value);
      }
    }

    if (!fileSeen || !fileBuffer) {
      return reply.code(400).send({ message: "A file is required" });
    }

    const safeName = sanitizeFileName(originalFileName);
    const fileExt = path.extname(safeName).replace(/^\./, "").toLowerCase();
    const relPath = path.join("projects", projectId, "documents", `${randomUUID()}-${safeName}`);
    const absPath = resolveApiPath(relPath);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, fileBuffer);

    const folderPath = (fields.folderPath || "")
      .split("/")
      .map((segment) => sanitizeFileName(segment))
      .filter(Boolean)
      .join("/");
    const displayName = folderPath ? `${folderPath}/${safeName}` : safeName;

    const uploadedChecksum = createHash("sha256").update(fileBuffer).digest("hex");
    const ingestionJobId = `job-${randomUUID()}`;
    const startedAt = new Date();
    await prisma.project.update({
      where: { id: projectId },
      data: { ingestionStatus: "processing", updatedAt: startedAt },
    }).catch(() => {});
    await prisma.ingestionJob.create({
      data: {
        id: ingestionJobId,
        projectId,
        kind: "package_ingest",
        status: "processing",
        progress: 25,
        input: {
          source: "manual_document_upload",
          fileName: displayName,
          storagePath: relPath,
          checksum: uploadedChecksum,
          totalBytes: fileBuffer.byteLength,
        } as any,
        output: {
          stage: "document",
          message: `Extracting ${displayName}`,
          documentProgress: [{
            id: `upload-${ingestionJobId}`,
            fileName: displayName,
            sourcePath: displayName,
            fileType: fileExt,
            size: fileBuffer.byteLength,
            status: "extracting",
            stage: "Extracting text",
            progress: 0.25,
            updatedAt: startedAt.toISOString(),
          }],
        } as any,
        createdAt: startedAt,
        updatedAt: startedAt,
        startedAt,
      },
    }).catch(() => {});

    let extractedText = "";
    let structuredData: Record<string, unknown> | null = null;
    let pageCount = 0;
    let extractionPageCount = 0;
    let nativePdfPageCount: NativePdfPageCountResult | null = null;
    let inferredDocumentType: string = "reference";
    let extractionError: string | null = null;

    try {
      const settings = await request.store!.getSettings();
      const integrations = settings.integrations ?? {} as any;
      const documentExtractionProviderRaw = integrations.documentExtractionProvider;
      const documentExtractionProvider = typeof documentExtractionProviderRaw === "string" && ["azure", "local", "auto"].includes(documentExtractionProviderRaw)
        ? documentExtractionProviderRaw as DocumentExtractionProvider
        : "azure";
      const azureModelRaw = integrations.azureDiModel;
      const azureModel: AzureDocumentIntelligenceModel = isAzureDocumentIntelligenceModel(azureModelRaw)
        ? azureModelRaw
        : "prebuilt-layout";
      const azureConfig = (integrations.azureDiEndpoint || integrations.azureDiKey)
        ? {
            endpoint: integrations.azureDiEndpoint,
            key: integrations.azureDiKey,
            model: azureModel,
            features: normalizeAzureDocumentIntelligenceFeatures(
              integrations.azureDiFeatures,
              DEFAULT_AZURE_DOCUMENT_INTELLIGENCE_FEATURES,
            ),
            queryFields: parseAzureDocumentIntelligenceQueryFields(integrations.azureDiQueryFields),
            outputContentFormat: integrations.azureDiOutputFormat === "markdown" ? "markdown" as const : "text" as const,
          }
        : undefined;

      const zip = new JSZip();
      zip.file(displayName, fileBuffer);
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const report = await ingestCustomerPackage({
        packageId: `manual-${ingestionJobId}`,
        packageName: displayName,
        sourceKind: "project",
        zipInput: zipBuffer,
      }, { azureConfig, documentExtractionProvider });
      const extractedDocument = report.documents[0];
      if (extractedDocument) {
        extractedText = extractedDocument.text?.replace(/\0/g, "") ?? "";
        structuredData = extractedDocument.structuredData ? JSON.parse(JSON.stringify(extractedDocument.structuredData).replace(/\0/g, "")) : null;
        extractionPageCount = inferPageCount(extractedDocument, report.chunks);
        pageCount = extractionPageCount;
        inferredDocumentType = documentTypeFromIngestion(extractedDocument.kind);
      }
    } catch (err) {
      extractionError = err instanceof Error ? err.message : String(err);
    }

    if (isPdfFileNameOrType(displayName, fileExt)) {
      nativePdfPageCount = await getNativePdfPageCountFromBuffer(fileBuffer);
      pageCount = choosePdfPageCount({
        fileName: displayName,
        fileType: fileExt,
        extractionPageCount: pageCount || 1,
        nativePageCount: nativePdfPageCount.pageCount,
      });
      structuredData = attachNativePdfMetadata(structuredData, nativePdfPageCount, extractionPageCount || pageCount);
    }

    const requestedDocumentType = (fields.documentType || "").trim();
    const documentType = requestedDocumentType && requestedDocumentType !== "reference"
      ? requestedDocumentType
      : inferredDocumentType;
    const document = await request.store!.createSourceDocument(projectId, {
      fileName: displayName,
      fileType: fileExt,
      documentType,
      pageCount,
      checksum: uploadedChecksum,
      storagePath: relPath,
      extractedText,
      structuredData,
    });

    const organizationId = request.user?.organizationId;
    if (extractedText.trim() && organizationId) {
      void knowledgeService.ingestDocument({
        content: extractedText,
        title: displayName,
        category: knowledgeCategoryFromDocType(documentType),
        scope: "project",
        projectId,
        organizationId,
        options: { chunkStrategy: "section-aware" },
      }, request.store!).catch((err: unknown) => {
        request.log.warn({ err }, `Vector indexing failed for uploaded document ${displayName}`);
      });
    }

    const completedAt = new Date();
    await prisma.ingestionJob.update({
      where: { id: ingestionJobId },
      data: {
        status: extractionError ? "failed" : "complete",
        progress: 100,
        output: {
          source: "manual_document_upload",
          documentId: document.id,
          documentCount: 1,
          stage: extractionError ? "failed" : "complete",
          message: extractionError
            ? `Uploaded ${displayName}, but text extraction failed: ${extractionError}`
            : `Prepared ${displayName}`,
          documentProgress: [{
            id: document.id,
            fileName: displayName,
            sourcePath: displayName,
            fileType: fileExt,
            size: fileBuffer.byteLength,
            status: extractionError ? "failed" : "complete",
            stage: extractionError ? "Failed" : "Ready",
            progress: 1,
            documentType,
            pageCount,
            error: extractionError,
            updatedAt: completedAt.toISOString(),
          }],
        } as any,
        error: extractionError,
        updatedAt: completedAt,
        completedAt,
      },
    }).catch(() => {});
    await prisma.project.update({
      where: { id: projectId },
      data: {
        ingestionStatus: "review",
        updatedAt: completedAt,
      },
    }).catch(() => {});

    reply.code(201);
    return document;
  });

  app.patch("/projects/:projectId/documents/:docId", async (request, reply) => {
    const { projectId, docId } = request.params as { projectId: string; docId: string };
    const parsed = sourceDocumentPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid document payload", issues: parsed.error.flatten() });
    }
    try {
      return await request.store!.updateDocument(projectId, docId, parsed.data satisfies SourceDocumentPatchInput);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Document not found";
      return reply.code(404).send({ message });
    }
  });

  app.delete("/projects/:projectId/documents/:docId", async (request, reply) => {
    const { projectId, docId } = request.params as { projectId: string; docId: string };
    try {
      return await request.store!.deleteDocument(projectId, docId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Document not found";
      return reply.code(404).send({ message });
    }
  });

  app.get("/projects/:projectId/workspace-state", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }

    const workspaceState = await request.store!.getWorkspaceState(projectId);

    if (!workspaceState) {
      return reply.code(404).send({
        message: "Workspace state not found"
      });
    }

    return workspaceState;
  });

  app.patch("/projects/:projectId/workspace-state", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }

    const parsed = workspacePatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid workspace state payload",
        issues: parsed.error.flatten()
      });
    }

    const workspaceState = await request.store!.updateWorkspaceState(projectId, parsed.data);
    if (!workspaceState) {
      return reply.code(404).send({
        message: "Workspace state not found"
      });
    }

    return workspaceState;
  });

  app.patch("/projects/:projectId/revisions/:revisionId", async (request, reply) => {
    const { projectId, revisionId } = request.params as { projectId: string; revisionId: string };
    const parsed = revisionPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid revision payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateRevision(projectId, revisionId, parsed.data satisfies RevisionPatchInput);
    await captureHumanEstimateFeedback(request, projectId, {
      action: "update_revision",
      revisionId,
      fields: Object.keys(parsed.data),
    });
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  app.post("/projects/:projectId/worksheets/:worksheetId/items", async (request, reply) => {
    const { projectId, worksheetId } = request.params as { projectId: string; worksheetId: string };
    const deltaResponse = ((request.query as { response?: string } | undefined)?.response) === "delta";
    const parsed = createWorksheetItemSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid worksheet item payload",
        issues: parsed.error.flatten()
      });
    }

    // ── Validate item against entity category configuration ──
    const entityCategories = await request.store!.listEntityCategories();
    const matchedCategory = parsed.data.categoryId
      ? entityCategories.find((ec: any) => ec.id === parsed.data.categoryId)
      : entityCategories.find(
          (ec: any) =>
            ec.name === parsed.data.category ||
            ec.entityType === parsed.data.entityType
        );

    if (parsed.data.categoryId && !matchedCategory) {
      return reply.code(400).send({
        message: `categoryId "${parsed.data.categoryId}" is not configured for this organization.`,
        hint: "Call getEntityCategories or quote.getItemConfig, then retry with a valid categoryId.",
      });
    }

    if (matchedCategory) {
      const calcType = (matchedCategory as any).calculationType;
      const itemSrc = (matchedCategory as any).itemSource;

      // Rate/tier categories are system-calculated and MUST link to a concrete rate item.
      if (calcType === "tiered_rate" || calcType === "duration_rate" || itemSrc === "rate_schedule") {
        if (!parsed.data.rateScheduleItemId) {
          // Check if rate schedules exist for this project
          const rateSchedules = await request.store!.listRevisionRateSchedules(projectId);
          const relevantItems = rateSchedules.flatMap((rs: any) => (rs.items || []).map((i: any) => ({
            id: i.id, name: i.name, code: i.code, scheduleName: rs.name,
          })));

          if (relevantItems.length > 0) {
            return reply.code(400).send({
              message: `Category "${parsed.data.category}" requires a rateScheduleItemId. You cannot create items with made-up rates. Choose from the available rate schedule items.`,
              availableItems: relevantItems.slice(0, 20),
              hint: "Call quote.getItemConfig to see all available rate schedule items, then pass rateScheduleItemId when creating this item.",
            });
          }
          // No rate schedules at all — warn but allow
          return reply.code(400).send({
            message: `Category "${parsed.data.category}" requires rate schedule items but none are imported. Import a rate schedule first using rateSchedule.import, then create items with a valid rateScheduleItemId.`,
            hint: "Call rateSchedule.list to see available master schedules, then rateSchedule.import to import one.",
          });
        }

        // Validate that the rateScheduleItemId actually exists
        const rateSchedules = await request.store!.listRevisionRateSchedules(projectId);
        const allRateItemIds = rateSchedules.flatMap((rs: any) => (rs.items || []).map((i: any) => i.id));
        if (!allRateItemIds.includes(parsed.data.rateScheduleItemId)) {
          const relevantItems = rateSchedules.flatMap((rs: any) => (rs.items || []).map((i: any) => ({
            id: i.id, name: i.name, code: i.code, scheduleName: rs.name,
          })));
          return reply.code(400).send({
            message: `rateScheduleItemId "${parsed.data.rateScheduleItemId}" does not exist. Choose from the available rate schedule items.`,
            availableItems: relevantItems.slice(0, 20),
            hint: "Call quote.getItemConfig to see all available rate schedule items.",
          });
        }

        const hasPositiveTierUnits =
          !!parsed.data.tierUnits && Object.values(parsed.data.tierUnits).some((value) => Number(value) > 0);
        if (!hasPositiveTierUnits) {
          return reply.code(400).send({
            message: `Category "${parsed.data.category}" is calculated from a rate schedule and requires positive tierUnits.`,
            hint: "Pass rateScheduleItemId, quantity, and tierUnits only. The system calculates cost and price.",
          });
        }
      }

      // Catalog-backed categories should use a valid catalogItemId when catalogs are configured
      if (itemSrc === "catalog" && !parsed.data.itemId && !parsed.data.rateScheduleItemId) {
        const catalogs = await request.store!.listCatalogs?.() ?? [];
        const linkedCatalogId = (matchedCategory as any).catalogId as string | null | undefined;
        const catKind = (matchedCategory as any).entityType?.toLowerCase();
        const relevantCatalog = catalogs.find((c: any) =>
          linkedCatalogId ? c.id === linkedCatalogId : c.kind?.toLowerCase() === catKind,
        );
        if (relevantCatalog) {
          return reply.code(400).send({
            message: `Category "${parsed.data.category}" is catalog-backed. Set itemId to a valid catalog item ID, or set cost directly if no catalog is configured.`,
            hint: "Call quote.getItemConfig to see available catalog items.",
          });
        }
        // No catalog configured for this category — allow freeform
      }
    }

    const workspaceState = await request.store!.getWorkspaceState(projectId).catch(() => null);
    const snapLineLimit = snapLineLimitFromState(workspaceState?.state as Record<string, unknown> | undefined);
    if (snapLineLimit !== null) {
      const workspace = await request.store!.getWorkspace(projectId);
      const lineCount = workspace?.worksheets
        .find((worksheet) => worksheet.id === worksheetId)
        ?.items.length ?? 0;
      if (lineCount >= snapLineLimit) {
        return reply.code(400).send({
          message: `Snaps are capped at ${snapLineLimit} line items. Upgrade this Snap to a quote before adding more lines.`,
        });
      }
    }

    const createResult = deltaResponse
      ? await request.store!.createWorksheetItemWithSnapshot(projectId, worksheetId, parsed.data satisfies CreateWorksheetItemInput)
      : null;
    if (!deltaResponse) {
      await request.store!.createWorksheetItem(projectId, worksheetId, parsed.data satisfies CreateWorksheetItemInput);
    }
    await captureHumanEstimateFeedback(request, projectId, {
      action: "create_item",
      worksheetId,
      category: parsed.data.category,
      entityName: parsed.data.entityName,
    });

    if (deltaResponse) {
      reply.code(201);
      return buildWorksheetItemMutationResponse("create", createResult!);
    }

    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    reply.code(201);
    return payload;
  });

  app.post("/projects/:projectId/worksheet-folders", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createWorksheetFolderSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid worksheet folder payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.createWorksheetFolder(projectId, parsed.data satisfies CreateWorksheetFolderInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/worksheet-folders/:folderId", async (request, reply) => {
    const { projectId, folderId } = request.params as { projectId: string; folderId: string };
    const parsed = worksheetFolderPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid worksheet folder payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateWorksheetFolder(projectId, folderId, parsed.data satisfies WorksheetFolderPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  app.delete("/projects/:projectId/worksheet-folders/:folderId", async (request, reply) => {
    const { projectId, folderId } = request.params as { projectId: string; folderId: string };
    await request.store!.deleteWorksheetFolder(projectId, folderId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  app.post("/projects/:projectId/worksheets", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createWorksheetSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid worksheet payload",
        issues: parsed.error.flatten()
      });
    }

    const workspaceState = await request.store!.getWorkspaceState(projectId).catch(() => null);
    if (snapLineLimitFromState(workspaceState?.state as Record<string, unknown> | undefined) !== null) {
      return reply.code(400).send({
        message: "Snaps use a single worksheet. Upgrade this Snap to a quote before adding worksheets.",
      });
    }

    await request.store!.createWorksheet(projectId, parsed.data satisfies CreateWorksheetInput);
    await captureHumanEstimateFeedback(request, projectId, {
      action: "create_worksheet",
      name: parsed.data.name,
    });
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/worksheets/:worksheetId", async (request, reply) => {
    const { projectId, worksheetId } = request.params as { projectId: string; worksheetId: string };
    const parsed = worksheetPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid worksheet payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateWorksheet(projectId, worksheetId, parsed.data satisfies WorksheetPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  app.delete("/projects/:projectId/worksheets/:worksheetId", async (request, reply) => {
    const { projectId, worksheetId } = request.params as { projectId: string; worksheetId: string };
    await request.store!.deleteWorksheet(projectId, worksheetId);
    await captureHumanEstimateFeedback(request, projectId, {
      action: "delete_worksheet",
      worksheetId,
    });
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  app.patch("/projects/:projectId/worksheet-items/:itemId", async (request, reply) => {
    const { projectId, itemId } = request.params as { projectId: string; itemId: string };
    const deltaResponse = ((request.query as { response?: string } | undefined)?.response) === "delta";
    const parsed = worksheetItemPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid worksheet item payload",
        issues: parsed.error.flatten()
      });
    }

    const updateResult = deltaResponse
      ? await request.store!.updateWorksheetItemWithSnapshot(projectId, itemId, parsed.data satisfies WorksheetItemPatchInput)
      : null;
    if (!deltaResponse) {
      await request.store!.updateWorksheetItem(projectId, itemId, parsed.data satisfies WorksheetItemPatchInput);
    }
    await captureHumanEstimateFeedback(request, projectId, {
      action: "update_item",
      itemId,
      fields: Object.keys(parsed.data),
    });

    if (deltaResponse) {
      return buildWorksheetItemMutationResponse("update", updateResult!);
    }

    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  app.delete("/projects/:projectId/worksheet-items/:itemId", async (request, reply) => {
    const { projectId, itemId } = request.params as { projectId: string; itemId: string };
    const deltaResponse = ((request.query as { response?: string } | undefined)?.response) === "delta";
    const deleteResult = deltaResponse
      ? await request.store!.deleteWorksheetItemWithSnapshot(projectId, itemId)
      : null;
    if (!deltaResponse) {
      await request.store!.deleteWorksheetItem(projectId, itemId);
    }
    await captureHumanEstimateFeedback(request, projectId, {
      action: "delete_item",
      itemId,
    });

    if (deltaResponse) {
      return buildWorksheetItemMutationResponse("delete", deleteResult!);
    }

    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  app.post("/projects/:projectId/worksheet-items/:itemId/refresh", async (request, reply) => {
    try {
      const { projectId, itemId } = request.params as { projectId: string; itemId: string };
      return await request.store!.refreshWorksheetItemFromLibrary(projectId, itemId);
    } catch (e: any) {
      reply.code(e.message?.includes("not found") ? 404 : 500);
      return { error: e.message ?? "Internal error" };
    }
  });

  app.get("/projects/:projectId/line-item-search", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = z.object({
      q: z.string().optional(),
      category: z.string().optional(),
      worksheetId: z.string().optional(),
      sourceTypes: z.string().optional(),
      disabledSourceTypes: z.string().optional(),
      disabledLaborLibraryIds: z.string().optional(),
      disabledCatalogIds: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      offset: z.coerce.number().int().min(0).max(100000).optional(),
      refresh: z.coerce.boolean().optional(),
    }).safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid line item search query",
        issues: parsed.error.flatten()
      });
    }

    try {
      const sourceTypes = (parsed.data.sourceTypes ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean) as LineItemSearchSourceType[];
      const disabledSourceTypes = (parsed.data.disabledSourceTypes ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean) as LineItemSearchSourceType[];
      const disabledLaborLibraryIds = (parsed.data.disabledLaborLibraryIds ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const disabledCatalogIds = (parsed.data.disabledCatalogIds ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      return await request.store!.searchLineItemCandidates(projectId, {
        q: parsed.data.q,
        preferredCategory: parsed.data.category,
        worksheetId: parsed.data.worksheetId,
        sourceTypes,
        disabledSourceTypes,
        disabledLaborLibraryIds,
        disabledCatalogIds,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        refresh: parsed.data.refresh,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Line item search failed";
      return reply.code(message.includes("not found") ? 404 : 500).send({ message });
    }
  });

  app.post("/projects/:projectId/line-item-search/rebuild", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    try {
      return await request.store!.rebuildLineItemSearchIndex(projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Line item search rebuild failed";
      return reply.code(message.includes("not found") ? 404 : 500).send({ message });
    }
  });

  // ── Phase routes ──────────────────────────────────────────────────

  app.get("/projects/:projectId/worksheet-items/search", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = z.object({
      q: z.string().optional(),
      category: z.string().optional(),
      worksheetId: z.string().optional(),
      minCost: z.coerce.number().finite().optional(),
      maxCost: z.coerce.number().finite().optional(),
      limit: z.coerce.number().int().positive().max(500).optional(),
    }).safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid worksheet item search query",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }

    let items = (workspace.worksheets ?? []).flatMap((worksheet) =>
      (worksheet.items ?? []).map((item) => ({
        ...item,
        worksheetId: worksheet.id,
        worksheetName: worksheet.name,
      })),
    );

    if (parsed.data.worksheetId) {
      items = items.filter((item) => item.worksheetId === parsed.data.worksheetId);
    }
    if (parsed.data.q) {
      const query = parsed.data.q.trim().toLowerCase();
      items = items.filter((item) =>
        String(item.entityName ?? "").toLowerCase().includes(query)
        || String(item.description ?? "").toLowerCase().includes(query)
        || String(item.category ?? "").toLowerCase().includes(query),
      );
    }
    if (parsed.data.category) {
      const category = parsed.data.category.trim().toLowerCase();
      items = items.filter((item) => String(item.category ?? "").trim().toLowerCase() === category);
    }
    if (parsed.data.minCost !== undefined) {
      items = items.filter((item) => Number(item.cost ?? 0) >= parsed.data.minCost!);
    }
    if (parsed.data.maxCost !== undefined) {
      items = items.filter((item) => Number(item.cost ?? 0) <= parsed.data.maxCost!);
    }

    const totalMatches = items.length;
    const limit = parsed.data.limit ?? 50;

    return {
      items: items.slice(0, limit),
      totalMatches,
    };
  });

  app.post("/projects/:projectId/phases", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createPhaseSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid phase payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createPhase(projectId, workspace.currentRevision.id, parsed.data satisfies CreatePhaseInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/phases/:phaseId", async (request, reply) => {
    const { projectId, phaseId } = request.params as { projectId: string; phaseId: string };
    const parsed = phasePatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid phase payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updatePhase(projectId, phaseId, parsed.data satisfies PhasePatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/phases/:phaseId", async (request, reply) => {
    const { projectId, phaseId } = request.params as { projectId: string; phaseId: string };
    await request.store!.deletePhase(projectId, phaseId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Schedule Task routes ─────────────────────────────────────────────

  app.get("/projects/:projectId/schedule-tasks", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listScheduleTasks(projectId);
  });

  app.post("/projects/:projectId/schedule-tasks", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createScheduleTaskSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid schedule task payload", issues: parsed.error.flatten() });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createScheduleTask(projectId, workspace.currentRevision.id, parsed.data satisfies CreateScheduleTaskInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/schedule-tasks/:taskId", async (request, reply) => {
    const { projectId, taskId } = request.params as { projectId: string; taskId: string };
    const parsed = scheduleTaskPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid schedule task payload", issues: parsed.error.flatten() });
    }

    await request.store!.updateScheduleTask(projectId, taskId, parsed.data satisfies ScheduleTaskPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/schedule-tasks/:taskId", async (request, reply) => {
    const { projectId, taskId } = request.params as { projectId: string; taskId: string };
    await request.store!.deleteScheduleTask(projectId, taskId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.post("/projects/:projectId/schedule-tasks/batch", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = batchUpdateScheduleTasksSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid batch update payload", issues: parsed.error.flatten() });
    }

    await request.store!.batchUpdateScheduleTasks(projectId, parsed.data.updates);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Schedule Dependency routes ──────────────────────────────────────

  app.post("/projects/:projectId/schedule-dependencies", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createDependencySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid dependency payload", issues: parsed.error.flatten() });
    }

    await request.store!.createDependency(projectId, parsed.data satisfies CreateDependencyInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.delete("/projects/:projectId/schedule-dependencies/:depId", async (request, reply) => {
    const { projectId, depId } = request.params as { projectId: string; depId: string };
    await request.store!.deleteDependency(projectId, depId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Schedule Baseline routes ────────────────────────────────────────

  app.get("/projects/:projectId/schedule-calendars", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listScheduleCalendars(projectId);
  });

  app.post("/projects/:projectId/schedule-calendars", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = scheduleCalendarSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid schedule calendar payload", issues: parsed.error.flatten() });
    }

    await request.store!.createScheduleCalendar(projectId, parsed.data satisfies CreateScheduleCalendarInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/schedule-calendars/:calendarId", async (request, reply) => {
    const { projectId, calendarId } = request.params as { projectId: string; calendarId: string };
    const parsed = scheduleCalendarSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid schedule calendar payload", issues: parsed.error.flatten() });
    }

    await request.store!.updateScheduleCalendar(projectId, calendarId, parsed.data satisfies ScheduleCalendarPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/schedule-calendars/:calendarId", async (request, reply) => {
    const { projectId, calendarId } = request.params as { projectId: string; calendarId: string };
    await request.store!.deleteScheduleCalendar(projectId, calendarId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.get("/projects/:projectId/schedule-resources", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listScheduleResources(projectId);
  });

  app.post("/projects/:projectId/schedule-resources", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = scheduleResourceSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid schedule resource payload", issues: parsed.error.flatten() });
    }

    await request.store!.createScheduleResource(projectId, parsed.data satisfies CreateScheduleResourceInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/schedule-resources/:resourceId", async (request, reply) => {
    const { projectId, resourceId } = request.params as { projectId: string; resourceId: string };
    const parsed = scheduleResourceSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid schedule resource payload", issues: parsed.error.flatten() });
    }

    await request.store!.updateScheduleResource(projectId, resourceId, parsed.data satisfies ScheduleResourcePatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/schedule-resources/:resourceId", async (request, reply) => {
    const { projectId, resourceId } = request.params as { projectId: string; resourceId: string };
    await request.store!.deleteScheduleResource(projectId, resourceId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.get("/projects/:projectId/schedule-baselines", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listScheduleBaselines(projectId);
  });

  app.post("/projects/:projectId/schedule-baselines", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = scheduleBaselineSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid schedule baseline payload", issues: parsed.error.flatten() });
    }

    await request.store!.createScheduleBaseline(projectId, parsed.data satisfies CreateScheduleBaselineInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.delete("/projects/:projectId/schedule-baselines/:baselineId", async (request, reply) => {
    const { projectId, baselineId } = request.params as { projectId: string; baselineId: string };
    await request.store!.deleteScheduleBaseline(projectId, baselineId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.post("/projects/:projectId/schedule/save-baseline", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    await request.store!.saveBaseline(projectId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/schedule/clear-baseline", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    await request.store!.clearBaseline(projectId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Modifier routes ────────────────────────────────────────────────

  app.get("/projects/:projectId/adjustments", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listAdjustments(projectId);
  });

  app.post("/projects/:projectId/adjustments", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createAdjustmentSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid adjustment payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createAdjustment(projectId, workspace.currentRevision.id, parsed.data satisfies CreateAdjustmentInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/adjustments/:adjustmentId", async (request, reply) => {
    const { projectId, adjustmentId } = request.params as { projectId: string; adjustmentId: string };
    const parsed = adjustmentPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid adjustment payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateAdjustment(projectId, adjustmentId, parsed.data satisfies AdjustmentPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/adjustments/:adjustmentId", async (request, reply) => {
    const { projectId, adjustmentId } = request.params as { projectId: string; adjustmentId: string };
    await request.store!.deleteAdjustment(projectId, adjustmentId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.get("/factor-library", async (request) => {
    return await request.store!.listEstimateFactorLibraryEntries();
  });

  app.post("/factor-library", async (request, reply) => {
    const parsed = estimateFactorLibraryEntrySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid factor library payload",
        issues: parsed.error.flatten()
      });
    }
    const created = await request.store!.createEstimateFactorLibraryEntry(parsed.data satisfies CreateEstimateFactorLibraryEntryInput);
    reply.code(201);
    return created;
  });

  app.patch("/factor-library/:entryId", async (request, reply) => {
    const { entryId } = request.params as { entryId: string };
    const parsed = estimateFactorLibraryEntrySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid factor library payload",
        issues: parsed.error.flatten()
      });
    }
    return await request.store!.updateEstimateFactorLibraryEntry(entryId, parsed.data satisfies EstimateFactorLibraryEntryPatchInput);
  });

  app.delete("/factor-library/:entryId", async (request, reply) => {
    const { entryId } = request.params as { entryId: string };
    await request.store!.deleteEstimateFactorLibraryEntry(entryId);
    return { deleted: true };
  });

  app.get("/projects/:projectId/factors", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listEstimateFactors(projectId);
  });

  app.get("/projects/:projectId/factors/library", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return await request.store!.listEstimateFactorLibraryEntries();
  });

  app.post("/projects/:projectId/factors", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createEstimateFactorSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid estimate factor payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createEstimateFactor(projectId, workspace.currentRevision.id, parsed.data satisfies CreateEstimateFactorInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/factors/:factorId", async (request, reply) => {
    const { projectId, factorId } = request.params as { projectId: string; factorId: string };
    const parsed = estimateFactorPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid estimate factor payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateEstimateFactor(projectId, factorId, parsed.data satisfies EstimateFactorPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/factors/:factorId", async (request, reply) => {
    const { projectId, factorId } = request.params as { projectId: string; factorId: string };
    await request.store!.deleteEstimateFactor(projectId, factorId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.get("/projects/:projectId/modifiers", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listModifiers(projectId);
  });

  app.post("/projects/:projectId/modifiers", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createModifierSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid modifier payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createModifier(projectId, workspace.currentRevision.id, parsed.data satisfies CreateModifierInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/modifiers/:modifierId", async (request, reply) => {
    const { projectId, modifierId } = request.params as { projectId: string; modifierId: string };
    const parsed = modifierPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid modifier payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateModifier(projectId, modifierId, parsed.data satisfies ModifierPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/modifiers/:modifierId", async (request, reply) => {
    const { projectId, modifierId } = request.params as { projectId: string; modifierId: string };
    await request.store!.deleteModifier(projectId, modifierId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Condition routes ───────────────────────────────────────────────

  app.get("/conditions/library", async (request) => request.store!.listConditionLibrary());

  app.post("/conditions/library", async (request) => {
    const { type, value } = request.body as { type: string; value: string };
    if (!type || !value) throw new Error("type and value are required");
    return request.store!.createConditionLibraryEntry({ type, value });
  });

  app.patch("/conditions/library/:entryId", async (request) => {
    const { entryId } = request.params as { entryId: string };
    const body = request.body as { type?: string; value?: string };
    return request.store!.updateConditionLibraryEntry(entryId, body);
  });

  app.delete("/conditions/library/:entryId", async (request) => {
    const { entryId } = request.params as { entryId: string };
    return request.store!.deleteConditionLibraryEntry(entryId);
  });

  app.get("/projects/:projectId/conditions", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listConditions(projectId);
  });

  app.post("/projects/:projectId/conditions", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createConditionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid condition payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createCondition(projectId, workspace.currentRevision.id, parsed.data satisfies CreateConditionInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/conditions/:conditionId", async (request, reply) => {
    const { projectId, conditionId } = request.params as { projectId: string; conditionId: string };
    const parsed = conditionPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid condition payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateCondition(projectId, conditionId, parsed.data satisfies ConditionPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/conditions/:conditionId", async (request, reply) => {
    const { projectId, conditionId } = request.params as { projectId: string; conditionId: string };
    await request.store!.deleteCondition(projectId, conditionId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.post("/projects/:projectId/conditions/reorder", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = reorderSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid reorder payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.reorderConditions(projectId, workspace.currentRevision.id, parsed.data.orderedIds);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Additional Line Item routes ────────────────────────────────────

  app.get("/projects/:projectId/ali", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listAdditionalLineItems(projectId);
  });

  app.post("/projects/:projectId/ali", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createAliSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid additional line item payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createAdditionalLineItem(projectId, workspace.currentRevision.id, parsed.data satisfies CreateAdditionalLineItemInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/ali/:aliId", async (request, reply) => {
    const { projectId, aliId } = request.params as { projectId: string; aliId: string };
    const parsed = aliPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid additional line item payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateAdditionalLineItem(projectId, aliId, parsed.data satisfies AdditionalLineItemPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/ali/:aliId", async (request, reply) => {
    const { projectId, aliId } = request.params as { projectId: string; aliId: string };
    await request.store!.deleteAdditionalLineItem(projectId, aliId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Summary Row routes ──────────────────────────────────────────────

  const summaryRowCreateSchema = z.object({
    type: z.enum(["category", "phase", "worksheet", "classification", "adjustment", "heading", "separator", "subtotal"]).optional(),
    label: z.string().optional(),
    order: z.number().int().optional(),
    visible: z.boolean().optional(),
    style: z.enum(["normal", "bold", "indent", "highlight"]).optional(),
    sourceCategoryId: z.string().nullable().optional(),
    sourceCategoryLabel: z.string().nullable().optional(),
    sourcePhaseId: z.string().nullable().optional(),
    sourceWorksheetId: z.string().nullable().optional(),
    sourceWorksheetLabel: z.string().nullable().optional(),
    sourceClassificationId: z.string().nullable().optional(),
    sourceClassificationLabel: z.string().nullable().optional(),
    sourceAdjustmentId: z.string().nullable().optional(),
  });

  const summaryRowPatchSchema = summaryRowCreateSchema;
  const summaryBuilderAxisItemSchema = z.object({
    key: z.string(),
    sourceId: z.string().nullable(),
    label: z.string(),
    visible: z.boolean(),
    order: z.number().int(),
  });
  const summaryBuilderClassificationSchema = z.object({
    standard: z.enum(["masterformat", "uniformat", "omniclass", "uniclass", "din276", "nrm", "icms", "cost_code"]),
    level: z.enum(["division", "section", "full"]),
    includeUnclassified: z.boolean(),
  });
  const summaryBuilderSchema = z.object({
    version: z.literal(1),
    preset: z.enum(["quick_total", "by_category", "by_phase", "by_worksheet", "by_masterformat_division", "by_uniformat_division", "by_omniclass_division", "by_uniclass_division", "by_din276_division", "by_nrm_division", "by_icms_division", "by_cost_code", "phase_x_category", "custom"]),
    mode: z.enum(["total", "grouped", "pivot"]),
    rowDimension: z.enum(["none", "phase", "category", "worksheet", "classification"]),
    columnDimension: z.enum(["none", "phase", "category", "worksheet", "classification"]),
    rows: z.array(summaryBuilderAxisItemSchema),
    columns: z.array(summaryBuilderAxisItemSchema),
    classification: summaryBuilderClassificationSchema,
    totals: z.object({
      label: z.string(),
      visible: z.boolean(),
    }),
  });

  app.get("/projects/:projectId/summary-rows", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    return request.store!.listSummaryRows(projectId);
  });

  app.post("/projects/:projectId/summary-rows", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = summaryRowCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid summary row payload", issues: parsed.error.flatten() });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createSummaryRow(projectId, workspace.currentRevision.id, parsed.data);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/summary-rows/:rowId", async (request, reply) => {
    const { projectId, rowId } = request.params as { projectId: string; rowId: string };
    const parsed = summaryRowPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid summary row payload", issues: parsed.error.flatten() });
    }

    await request.store!.updateSummaryRow(projectId, rowId, parsed.data);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/summary-rows/:rowId", async (request, reply) => {
    const { projectId, rowId } = request.params as { projectId: string; rowId: string };
    await request.store!.deleteSummaryRow(projectId, rowId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.post("/projects/:projectId/summary-rows/reorder", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = z.object({ orderedIds: z.array(z.string()) }).safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid reorder payload" });
    }

    await request.store!.reorderSummaryRows(projectId, parsed.data.orderedIds);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.post("/projects/:projectId/summary-rows/apply-preset", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = z.object({
      preset: z.enum(["quick_total", "by_category", "by_phase", "by_worksheet", "by_masterformat_division", "by_uniformat_division", "by_omniclass_division", "by_uniclass_division", "by_din276_division", "by_nrm_division", "by_icms_division", "by_cost_code", "phase_x_category", "custom"]),
    }).safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid preset" });
    }

    await request.store!.applySummaryPreset(projectId, parsed.data.preset);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.get("/projects/:projectId/summary-builder", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const summaryBuilder = await request.store!.getSummaryBuilder(projectId);
    if (!summaryBuilder) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return { summaryBuilder };
  });

  app.put("/projects/:projectId/summary-builder", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = summaryBuilderSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid summary builder payload", issues: parsed.error.flatten() });
    }

    await request.store!.saveSummaryBuilder(projectId, parsed.data);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Revision routes ────────────────────────────────────────────────

  app.post("/projects/:projectId/revisions", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createRevision(projectId, workspace.quote.id);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.delete("/projects/:projectId/revisions/:revisionId", async (request, reply) => {
    const { projectId, revisionId } = request.params as { projectId: string; revisionId: string };
    await request.store!.deleteRevision(projectId, revisionId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.post("/projects/:projectId/revisions/:revisionId/activate", async (request, reply) => {
    const { projectId, revisionId } = request.params as { projectId: string; revisionId: string };
    await request.store!.switchRevision(projectId, revisionId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.post("/projects/:projectId/copy", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = z.object({
      resetEstimate: z.boolean().optional(),
    }).safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid project copy payload",
        issues: parsed.error.flatten(),
      });
    }
    const result = await request.store!.copyQuote(projectId, { resetEstimate: parsed.data.resetEstimate === true });
    const payload = await buildWorkspaceResponse(request.store!, result.project.id);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  // ── Quote-level patch ──────────────────────────────────────────────

  app.patch("/projects/:projectId/quote", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = quotePatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid quote payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateQuote(projectId, parsed.data satisfies QuotePatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  // ── Make revision zero ────────────────────────────────────────────

  app.post("/projects/:projectId/make-revision-zero", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    await request.store!.makeCurrentRevisionZero(projectId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({
        message: "Project workspace not found"
      });
    }
    return payload;
  });

  // ── Activity routes ────────────────────────────────────────────────

  app.get("/projects/:projectId/activity", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listActivities(projectId);
  });

  app.post("/projects/:projectId/activity/:activityId/revert", async (request, reply) => {
    const { projectId, activityId } = request.params as { projectId: string; activityId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    try {
      const result = await request.store!.revertActivity(projectId, activityId);
      return result;
    } catch (err: any) {
      const code = err.statusCode ?? (err.message?.includes("cannot be reverted") ? 400 : err.message?.includes("no longer exists") ? 409 : 500);
      return reply.code(code).send({ message: err.message });
    }
  });

  // ── Report Section routes ──────────────────────────────────────────

  app.get("/projects/:projectId/report-sections", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listReportSections(projectId);
  });

  app.post("/projects/:projectId/report-sections", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createReportSectionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid report section payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.createReportSection(projectId, workspace.currentRevision.id, parsed.data satisfies CreateReportSectionInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    reply.code(201);
    return payload;
  });

  app.patch("/projects/:projectId/report-sections/:sectionId", async (request, reply) => {
    const { projectId, sectionId } = request.params as { projectId: string; sectionId: string };
    const parsed = reportSectionPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid report section payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateReportSection(projectId, sectionId, parsed.data satisfies ReportSectionPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.delete("/projects/:projectId/report-sections/:sectionId", async (request, reply) => {
    const { projectId, sectionId } = request.params as { projectId: string; sectionId: string };
    await request.store!.deleteReportSection(projectId, sectionId);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.post("/projects/:projectId/report-sections/reorder", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = reorderSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid reorder payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    await request.store!.reorderReportSections(projectId, workspace.currentRevision.id, parsed.data.orderedIds);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  // ── Status route ───────────────────────────────────────────────────

  app.patch("/projects/:projectId/status", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = statusPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid status payload",
        issues: parsed.error.flatten()
      });
    }

    await request.store!.updateProjectStatus(projectId, parsed.data satisfies StatusPatchInput);
    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }
    return payload;
  });

  app.get("/packages/:packageId", async (request, reply) => {
    const { packageId } = request.params as { packageId: string };
    const packageRecord = await request.store!.getPackage(packageId);

    if (!packageRecord) {
      return reply.code(404).send({
        message: "Package not found"
      });
    }

    return packageRecord;
  });

  app.get("/jobs/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await request.store!.getJob(jobId);

    if (!job) {
      return reply.code(404).send({
        message: "Job not found"
      });
    }

    return job;
  });

  app.get("/entity-categories", async (request) => request.store!.listEntityCategories());

  app.post("/entity-categories", async (request, reply) => {
    const body = request.body as { name: string; entityType: string; [key: string]: unknown };
    if (!body.name || !body.entityType) {
      return reply.code(400).send({ message: "name and entityType are required" });
    }
    try {
      const cat = await request.store!.createEntityCategory(body);
      reply.code(201);
      return cat;
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to create category" });
    }
  });

  app.patch("/entity-categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const patch = request.body as Record<string, unknown>;
    try {
      return await request.store!.updateEntityCategory(id, patch);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to update category" });
    }
  });

  app.delete("/entity-categories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await request.store!.deleteEntityCategory(id);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to delete category" });
    }
  });

  app.post("/entity-categories/reorder", async (request) => {
    const { orderedIds } = request.body as { orderedIds: string[] };
    await request.store!.reorderEntityCategories(orderedIds);
    return { ok: true };
  });

  // ── Customers ──────────────────────────────────────────────────────────

  app.get("/customers", async (request) => {
    const url = new URL(request.url, "http://localhost");
    const q = url.searchParams.get("q");
    if (q) return request.store!.searchCustomers(q);
    return request.store!.listCustomers();
  });

  app.post("/customers", async (request, reply) => {
    const body = request.body as { name: string; [key: string]: unknown };
    if (!body.name) {
      return reply.code(400).send({ message: "name is required" });
    }
    try {
      const customer = await request.store!.createCustomer(body);
      reply.code(201);
      return customer;
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to create customer" });
    }
  });

  app.get("/customers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const customer = await request.store!.getCustomerWithContacts(id);
    if (!customer) return reply.code(404).send({ message: "Customer not found" });
    return customer;
  });

  app.patch("/customers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const patch = request.body as Record<string, unknown>;
    try {
      return await request.store!.updateCustomer(id, patch);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to update customer" });
    }
  });

  app.delete("/customers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await request.store!.deleteCustomer(id);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to delete customer" });
    }
  });

  // ── Customer Contacts ─────────────────────────────────────────────────

  app.get("/customers/:id/contacts", async (request) => {
    const { id } = request.params as { id: string };
    return request.store!.listCustomerContacts(id);
  });

  app.post("/customers/:id/contacts", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name: string; [key: string]: unknown };
    if (!body.name) {
      return reply.code(400).send({ message: "name is required" });
    }
    try {
      const contact = await request.store!.createCustomerContact(id, body);
      reply.code(201);
      return contact;
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to create contact" });
    }
  });

  app.patch("/customers/:customerId/contacts/:contactId", async (request, reply) => {
    const { contactId } = request.params as { customerId: string; contactId: string };
    const patch = request.body as Record<string, unknown>;
    try {
      return await request.store!.updateCustomerContact(contactId, patch);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to update contact" });
    }
  });

  app.delete("/customers/:customerId/contacts/:contactId", async (request, reply) => {
    const { contactId } = request.params as { customerId: string; contactId: string };
    try {
      return await request.store!.deleteCustomerContact(contactId);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to delete contact" });
    }
  });

  // ── Departments ───────────────────────────────────────────────────────

  app.get("/departments", async (request) => request.store!.listDepartments());

  app.post("/departments", async (request, reply) => {
    const body = request.body as { name: string; [key: string]: unknown };
    if (!body.name) {
      return reply.code(400).send({ message: "name is required" });
    }
    try {
      const dept = await request.store!.createDepartment(body);
      reply.code(201);
      return dept;
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to create department" });
    }
  });

  app.patch("/departments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const patch = request.body as Record<string, unknown>;
    try {
      return await request.store!.updateDepartment(id, patch);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to update department" });
    }
  });

  app.delete("/departments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await request.store!.deleteDepartment(id);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Failed to delete department" });
    }
  });

  // ── Catalogs ──────────────────────────────────────────────────────────

  app.get("/catalogs", async (request) => request.store!.listCatalogs());

  app.post("/catalogs", async (request, reply) => {
    const parsed = createCatalogSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid catalog payload", issues: parsed.error.flatten() });
    }
    const catalog = await request.store!.createCatalog({ ...parsed.data, scope: "global", projectId: null } satisfies CreateCatalogInput);
    reply.code(201);
    return catalog;
  });

  app.patch("/catalogs/:catalogId", async (request, reply) => {
    const { catalogId } = request.params as { catalogId: string };
    const parsed = catalogPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid catalog payload", issues: parsed.error.flatten() });
    }
    try {
      return await request.store!.updateCatalog(catalogId, parsed.data satisfies CatalogPatchInput);
    } catch {
      return reply.code(404).send({ message: "Catalog not found" });
    }
  });

  app.delete("/catalogs/:catalogId", async (request, reply) => {
    const { catalogId } = request.params as { catalogId: string };
    try {
      return await request.store!.deleteCatalog(catalogId);
    } catch {
      return reply.code(404).send({ message: "Catalog not found" });
    }
  });

  app.get("/catalogs/:catalogId/items", async (request) => {
    const { catalogId } = request.params as { catalogId: string };
    return request.store!.listCatalogItems(catalogId);
  });

  app.post("/catalogs/:catalogId/items", async (request, reply) => {
    const { catalogId } = request.params as { catalogId: string };
    const parsed = createCatalogItemSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid catalog item payload", issues: parsed.error.flatten() });
    }
    try {
      const item = await request.store!.createCatalogItem(catalogId, parsed.data satisfies CreateCatalogItemInput);
      reply.code(201);
      return item;
    } catch {
      return reply.code(404).send({ message: "Catalog not found" });
    }
  });

  app.patch("/catalogs/:catalogId/items/:itemId", async (request, reply) => {
    const { itemId } = request.params as { catalogId: string; itemId: string };
    const parsed = catalogItemPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid catalog item payload", issues: parsed.error.flatten() });
    }
    try {
      return await request.store!.updateCatalogItem(itemId, parsed.data satisfies CatalogItemPatchInput);
    } catch {
      return reply.code(404).send({ message: "Catalog item not found" });
    }
  });

  app.delete("/catalogs/:catalogId/items/:itemId", async (request, reply) => {
    const { itemId } = request.params as { catalogId: string; itemId: string };
    try {
      return await request.store!.deleteCatalogItem(itemId);
    } catch {
      return reply.code(404).send({ message: "Catalog item not found" });
    }
  });

  app.get("/catalogs/search", async (request) => {
    const query = z.object({
      q: z.string().default(""),
      catalogId: z.string().optional()
    }).safeParse(request.query ?? {});
    if (!query.success) return [];
    return request.store!.searchCatalogItems(query.data.q, query.data.catalogId);
  });

  app.get("/catalog/rates", async (request) => request.store!.listCatalogRates());

  // ── File Node routes ──────────────────────────────────────────────

  app.get("/projects/:projectId/files", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) return reply.code(404).send({ message: "Project not found" });
    const query = z.object({ parentId: z.string().optional(), scope: z.string().optional() }).safeParse(request.query ?? {});
    const parentId = query.success ? query.data.parentId : undefined;
    const scope = query.success ? query.data.scope : undefined;
    return request.store!.listFileNodes(projectId, parentId, scope);
  });

  app.get("/projects/:projectId/files/tree", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) return reply.code(404).send({ message: "Project not found" });
    const query = request.query as { scope?: string };
    return request.store!.getFileTree(projectId, query.scope);
  });

  app.post("/projects/:projectId/files", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createFileNodeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid file node payload", issues: parsed.error.flatten() });
    }
    try {
      const node = await request.store!.createFileNode(projectId, parsed.data satisfies CreateFileNodeInput);
      reply.code(201);
      return node;
    } catch {
      return reply.code(404).send({ message: "Project or parent not found" });
    }
  });

  app.patch("/projects/:projectId/files/:nodeId", async (request, reply) => {
    const { nodeId } = request.params as { projectId: string; nodeId: string };
    const parsed = fileNodePatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ message: "Invalid file node payload", issues: parsed.error.flatten() });
    }
    try {
      return await request.store!.updateFileNode(nodeId, parsed.data satisfies FileNodePatchInput);
    } catch (err) {
      const message = err instanceof Error ? err.message : "File node not found";
      return reply.code(message.includes("Cannot move") ? 400 : 404).send({ message });
    }
  });

  app.delete("/projects/:projectId/files/:nodeId", async (request, reply) => {
    const { nodeId } = request.params as { projectId: string; nodeId: string };
    try {
      return await request.store!.deleteFileNode(nodeId);
    } catch {
      return reply.code(404).send({ message: "File node not found" });
    }
  });

  // ── File Upload (any file type) ─────────────────────────────────────────

  app.post("/projects/:projectId/files/upload", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) return reply.code(404).send({ message: "Project not found" });

    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;
    let originalFileName = "";
    let fileSize = 0;
    let fileSeen = false;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (fileSeen) {
          return reply.code(400).send({ message: "Only one file per upload" });
        }
        fileSeen = true;
        originalFileName = part.filename || "unnamed";
        fileBuffer = await part.toBuffer();
        fileSize = fileBuffer.length;
      } else {
        fields[part.fieldname] = Array.isArray(part.value) ? part.value.join("") : String(part.value);
      }
    }

    if (!fileSeen || !fileBuffer) {
      return reply.code(400).send({ message: "A file is required" });
    }

    const fileExt = path.extname(originalFileName).replace(/^\./, "").toLowerCase();
    const parentId = fields.parentId || null;

    // Create the FileNode first to get an ID for the storage path
    const node = await request.store!.createFileNode(projectId, {
      parentId,
      name: originalFileName,
      type: "file",
      fileType: fileExt || undefined,
      size: fileSize,
      metadata: {},
    });

    // Write file to disk
    const relPath = relativeProjectFilePath(projectId, node.id, originalFileName);
    const absPath = resolveApiPath(relPath);
    await mkdir(path.dirname(absPath), { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(absPath, fileBuffer);

    // Update node with storagePath
    const updated = await request.store!.updateFileNode(node.id, { storagePath: relPath });

    reply.code(201);
    return updated;
  });

  app.put("/projects/:projectId/files/:nodeId/content", async (request, reply) => {
    const { projectId, nodeId } = request.params as { projectId: string; nodeId: string };
    const node = await request.store!.getFileNode(nodeId);
    if (!node || node.projectId !== projectId) {
      return reply.code(404).send({ message: "File not found" });
    }
    if (node.type === "directory") {
      return reply.code(400).send({ message: "Cannot replace content for a directory" });
    }

    let fileBuffer: Buffer | null = null;
    let originalFileName = node.name || "untitled";
    let fileSize = 0;
    let fileSeen = false;

    for await (const part of request.parts()) {
      if (part.type !== "file") continue;
      if (fileSeen) {
        return reply.code(400).send({ message: "Only one file per upload" });
      }
      fileSeen = true;
      originalFileName = part.filename || originalFileName;
      fileBuffer = await part.toBuffer();
      fileSize = fileBuffer.length;
    }

    if (!fileSeen || !fileBuffer) {
      return reply.code(400).send({ message: "A file is required" });
    }

    const fileExt = path.extname(originalFileName).replace(/^\./, "").toLowerCase();
    const relPath = relativeProjectFilePath(projectId, node.id, originalFileName);
    const absPath = resolveApiPath(relPath);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, fileBuffer);

    return request.store!.updateFileNode(node.id, {
      name: originalFileName,
      storagePath: relPath,
      fileType: fileExt || undefined,
      size: fileSize,
      metadata: {
        ...(node.metadata ?? {}),
        lastSavedAt: new Date().toISOString(),
      },
    });
  });

  // ── File Download ──────────────────────────────────────────────────────

  const MIME_MAP: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
    svg: "image/svg+xml",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    json: "application/json",
    xml: "application/xml",
    yaml: "application/x-yaml",
    yml: "application/x-yaml",
    cd: "application/json",
    dxf: "image/vnd.dxf",
    dwg: "application/acad",
    step: "model/step",
    stp: "model/step",
    iges: "model/iges",
    igs: "model/iges",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    rtf: "application/rtf",
    html: "text/html",
    htm: "text/html",
    mhtml: "multipart/related",
    mht: "multipart/related",
    zip: "application/zip",
    "7z": "application/x-7z-compressed",
    rar: "application/vnd.rar",
    tar: "application/x-tar",
    gz: "application/gzip",
    tgz: "application/gzip",
    msg: "application/vnd.ms-outlook",
    eml: "message/rfc822",
    mpp: "application/vnd.ms-project",
    mpt: "application/vnd.ms-project",
    mpx: "application/x-project",
    xer: "text/plain",
    p6xml: "application/xml",
    pmxml: "application/xml",
  };

  app.get("/projects/:projectId/files/:nodeId/download", async (request, reply) => {
    const { projectId, nodeId } = request.params as { projectId: string; nodeId: string };
    const node = await request.store!.getFileNode(nodeId);
    if (!node || node.projectId !== projectId) {
      return reply.code(404).send({ message: "File not found" });
    }
    if (node.type === "directory") {
      return reply.code(400).send({ message: "Cannot download a directory" });
    }
    if (!node.storagePath) {
      return reply.code(404).send({ message: "File has no stored content" });
    }

    const absPath = resolveApiPath(node.storagePath);
    try {
      await access(absPath);
    } catch {
      return reply.code(404).send({ message: "File not found on disk" });
    }

    const ext = path.extname(node.name).replace(/^\./, "").toLowerCase();
    const mime = MIME_MAP[ext] || "application/octet-stream";
    const inline = request.query && (request.query as Record<string, string>).inline === "1";

    reply.header("Content-Type", mime);
    reply.header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${sanitizeFileName(node.name)}"`);
    return reply.send(createReadStream(absPath));
  });

  // ── Source Document Download ───────────────────────────────────────────

  app.get("/projects/:projectId/documents/:docId/download", async (request, reply) => {
    const { projectId, docId } = request.params as { projectId: string; docId: string };
    const doc = await request.store!.getDocument(projectId, docId);
    if (!doc) {
      return reply.code(404).send({ message: "Document not found" });
    }

    // Try to serve the original file from storagePath
    if (doc.storagePath) {
      const absPath = resolveApiPath(doc.storagePath);
      try {
        await access(absPath);
        const ext = path.extname(doc.fileName).replace(/^\./, "").toLowerCase();
        const mime = MIME_MAP[ext] || "application/octet-stream";
        const inline = request.query && (request.query as Record<string, string>).inline === "1";
        reply.header("Content-Type", mime);
        reply.header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${sanitizeFileName(doc.fileName)}"`);
        return reply.send(createReadStream(absPath));
      } catch {
        // File not on disk — fall through to extracted text
      }
    }

    // Fallback: serve extracted text as plain text
    if (doc.extractedText) {
      reply.header("Content-Type", "text/plain; charset=utf-8");
      reply.header("Content-Disposition", `inline; filename="${sanitizeFileName(doc.fileName)}.txt"`);
      return reply.send(doc.extractedText);
    }

    return reply.code(404).send({ message: "No downloadable content for this document" });
  });

  // ── Upload from URL (for agent use) ────────────────────────────────────

  app.post("/projects/:projectId/files/upload-from-url", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) return reply.code(404).send({ message: "Project not found" });

    const body = z.object({
      url: z.string().url(),
      name: z.string().optional(),
      parentId: z.string().nullable().optional(),
    }).safeParse(request.body ?? {});

    if (!body.success) {
      return reply.code(400).send({ message: "Invalid payload", issues: body.error.flatten() });
    }

    const { url, name, parentId } = body.data;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        return reply.code(400).send({ message: `Failed to fetch URL: ${response.status} ${response.statusText}` });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const urlPath = new URL(url).pathname;
      const fileName = name || path.basename(urlPath) || "downloaded-file";
      const fileExt = path.extname(fileName).replace(/^\./, "").toLowerCase();

      const node = await request.store!.createFileNode(projectId, {
        parentId: parentId ?? null,
        name: fileName,
        type: "file",
        fileType: fileExt || undefined,
        size: buffer.length,
        metadata: { sourceUrl: url },
      });

      const relPath = relativeProjectFilePath(projectId, node.id, fileName);
      const absPath = resolveApiPath(relPath);
      await mkdir(path.dirname(absPath), { recursive: true });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(absPath, buffer);

      const updated = await request.store!.updateFileNode(node.id, { storagePath: relPath });
      reply.code(201);
      return updated;
    } catch (err) {
      return reply.code(500).send({ message: `Upload from URL failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  app.get("/ai/runs", async (request) => {
    const query = z.object({
      projectId: z.string().optional()
    }).safeParse(request.query ?? {});

    if (!query.success) {
      return request.store!.listAiRuns();
    }

    return request.store!.listAiRuns(query.data.projectId);
  });

  app.post("/projects/:projectId/packages/upload", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const result = await ingestUploadForProject(request.store!, request, reply, projectId);

    return result;
  });

  app.post("/ingestion/package", async (request, reply) => {
    return ingestUploadForProject(request.store!, request, reply);
  });

  app.post("/projects/:projectId/ingest", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = ingestBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid ingest payload",
        issues: parsed.error.flatten()
      });
    }

    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({
        message: "Project not found"
      });
    }

    const packages = await request.store!.listPackages(projectId);
    const targetPackage =
      parsed.data.packageId ? packages.find((entry: any) => entry.id === parsed.data.packageId) : packages[0];

    if (!targetPackage) {
      return reply.code(404).send({
        message: "No package available to ingest"
      });
    }

    const outcome = await request.store!.ingestUploadedPackage(targetPackage.id);
    return buildPackageResponse(outcome);
  });

  // -------------------------------------------------------------------------
  // PDF generation
  // -------------------------------------------------------------------------

  app.get("/projects/:projectId/pdf/:templateType", async (request, reply) => {
    const { projectId, templateType } = request.params as {
      projectId: string;
      templateType: string;
    };
    const validTypes = ["main", "backup", "sitecopy", "closeout", "schedule", "snap"];
    if (!validTypes.includes(templateType)) {
      return reply
        .code(400)
        .send({ message: `Invalid template type. Must be one of: ${validTypes.join(", ")}` });
    }
    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }
    if (templateType === "schedule") {
      const schedulePdfData = buildSchedulePdfData(workspace);
      const html = generateSchedulePdfHtml(schedulePdfData);
      const { buffer, contentType } = await generatePdfBuffer(html);
      return reply.type(contentType).send(buffer);
    }

    const reportSections = await request.store!.listReportSections(projectId);

    // Resolve image file paths for report sections so the PDF renderer can embed them
    for (const section of reportSections) {
      if (section.sectionType === "image" && section.content) {
        try {
          const parsed = JSON.parse(section.content);
          if (parsed.fileNodeId) {
            const node = await request.store!.getFileNode(parsed.fileNodeId);
            if (node?.storagePath) {
              parsed.resolvedImagePath = resolveApiPath(node.storagePath);
              section.content = JSON.stringify(parsed);
            }
          }
        } catch { /* not JSON, skip */ }
      }
    }

    const orgSettings = await request.store!.getSettings();
    const pdfData = buildPdfDataPackage(workspace, reportSections, {
      termsAndConditions: orgSettings.termsAndConditions || "",
      companyName: orgSettings.general?.orgName || orgSettings.brand?.companyName || "",
      logoUrl: orgSettings.general?.logoUrl || orgSettings.brand?.logoUrl || "",
      website: orgSettings.general?.website || orgSettings.brand?.websiteUrl || "",
    });

    // Parse layout options from query param if present
    let layoutOptions: Partial<PdfLayoutOptions> | undefined;
    const layoutParam = (request.query as Record<string, string>)?.layout;
    if (layoutParam) {
      try { layoutOptions = JSON.parse(decodeURIComponent(layoutParam)); } catch { /* ignore */ }
    }

    const html = templateType === "snap"
      ? generateSnapPdfHtml(pdfData)
      : generatePdfHtml(pdfData, templateType, layoutOptions);
    const { buffer, contentType } = await generatePdfBuffer(html, layoutOptions);
    return reply.type(contentType).send(buffer);
  });

  // -------------------------------------------------------------------------
  // PDF preferences per quote revision
  // -------------------------------------------------------------------------

  app.get("/projects/:projectId/pdf-preferences", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) return reply.code(404).send({ message: "Project not found" });
    const rev = workspace.currentRevision;
    return { pdfPreferences: (rev as any)?.pdfPreferences ?? {} };
  });

  const handleSavePdfPreferences = async (request: any, reply: any) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as Record<string, unknown>;
    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) return reply.code(404).send({ message: "Project not found" });
    const rev = workspace.currentRevision;
    if (!rev) return reply.code(404).send({ message: "No current revision" });
    await request.store!.updateRevision(projectId, rev.id, {
      pdfPreferences: {
        ...((rev as any)?.pdfPreferences ?? {}),
        ...body,
      },
    } as any);
    return { ok: true };
  };
  app.put("/projects/:projectId/pdf-preferences", handleSavePdfPreferences);
  app.patch("/projects/:projectId/pdf-preferences", handleSavePdfPreferences);

  // -------------------------------------------------------------------------
  // Send quote email
  // -------------------------------------------------------------------------

  app.post("/projects/:projectId/send-quote", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as { contacts?: string[]; message?: string } | null;
    const contacts = body?.contacts ?? [];
    const message = body?.message ?? "";

    if (contacts.length === 0) {
      return reply.code(400).send({ message: "At least one contact email is required" });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }

    const quoteNumber = workspace.quote?.quoteNumber ?? projectId;
    const subject = `Quote ${quoteNumber} – ${workspace.currentRevision?.title ?? workspace.project?.name ?? ""}`;

    const result = await sendQuoteEmail({
      to: contacts,
      subject,
      message,
      quoteNumber,
    });

    await request.store!.logActivity(projectId, workspace.currentRevision?.id ?? null, "quote_sent", {
      recipients: contacts,
      quoteNumber,
    });

    return result;
  });

  // -------------------------------------------------------------------------
  // Delete project
  // -------------------------------------------------------------------------

  app.delete("/projects/:projectId", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }

    return request.store!.deleteProject(projectId);
  });

  // -------------------------------------------------------------------------
  // AI endpoints
  // -------------------------------------------------------------------------

  app.post("/projects/:projectId/ai/description", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }
    const rev = workspace.currentRevision;
    const projectContext = `Project: ${workspace.project?.name ?? ""}\nClient: ${workspace.project?.clientName ?? ""}\nLocation: ${workspace.project?.location ?? ""}`;
    const description = await aiRewriteDescription(
      rev?.description ?? "",
      projectContext
    );
    return { description };
  });

  app.post("/projects/:projectId/ai/notes", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }
    const rev = workspace.currentRevision;
    const projectContext = `Project: ${workspace.project?.name ?? ""}\nClient: ${workspace.project?.clientName ?? ""}`;
    const notes = await aiRewriteNotes(rev?.notes ?? "", projectContext);
    return { notes };
  });

  app.post("/projects/:projectId/ai/phases", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }
    const rev = workspace.currentRevision;
    const allItems = (workspace.worksheets ?? []).flatMap(
      (ws: any) => ws.items ?? []
    );
    const phases = await aiSuggestPhases(rev?.description ?? "", allItems);
    return { phases };
  });

  app.post("/projects/:projectId/ai/phases/accept", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as {
      phases?: Array<{ number: string; name: string; description: string }>;
    } | null;
    const phases = body?.phases ?? [];

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }

    const revisionId = workspace.currentRevision?.id;
    if (!revisionId) {
      return reply.code(400).send({ message: "No active revision" });
    }

    for (const phase of phases) {
      await request.store!.createPhase(projectId, revisionId, {
        number: phase.number,
        name: phase.name,
        description: phase.description,
      });
    }

    await request.store!.logActivity(projectId, revisionId, "ai_phases_accepted", {
      phaseCount: phases.length,
    });

    const response = await buildWorkspaceResponse(request.store!, projectId);
    if (!response) {
      return reply.code(404).send({ message: "Failed to build workspace" });
    }
    return response;
  });

  app.post("/projects/:projectId/ai/equipment", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }
    const rev = workspace.currentRevision;
    const allItems = (workspace.worksheets ?? []).flatMap(
      (ws: any) => ws.items ?? []
    );
    const labourItems = allItems.filter(
      (i: any) =>
        i.category?.toLowerCase() === "labor" ||
        i.category?.toLowerCase() === "labour"
    );
    const equipment = await aiSuggestEquipment(
      rev?.description ?? "",
      labourItems
    );
    return { equipment };
  });

  app.post("/projects/:projectId/ai/equipment/accept", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as {
      equipment?: Array<{
        name: string;
        description: string;
        quantity: number;
        duration: number;
        estimatedCost: number;
      }>;
    } | null;
    const equipment = body?.equipment ?? [];

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project not found" });
    }

    const revisionId = workspace.currentRevision?.id;
    if (!revisionId) {
      return reply.code(400).send({ message: "No active revision" });
    }

    // Find the first worksheet (or create one for equipment)
    const worksheets = workspace.worksheets ?? [];
    let targetWorksheetId = worksheets[0]?.id;
    if (!targetWorksheetId) {
      return reply.code(400).send({ message: "No worksheet available for equipment items" });
    }

    const equipmentCategory = (workspace.entityCategories ?? []).find((category: any) => {
      const key = `${category.name ?? ""} ${category.entityType ?? ""}`.toLowerCase();
      return key.includes("equipment");
    }) ?? (workspace.entityCategories ?? []).find((category: any) => category.enabled !== false);
    if (!equipmentCategory) {
      return reply.code(400).send({ message: "Configure at least one entity category before accepting equipment items." });
    }

    for (const item of equipment) {
      await request.store!.createWorksheetItem(projectId, targetWorksheetId, {
        categoryId: equipmentCategory.id,
        category: equipmentCategory.name,
        entityType: equipmentCategory.entityType,
        entityName: item.name,
        description: item.description,
        quantity: item.quantity,
        uom: "day",
        cost: item.estimatedCost,
        markup: 0,
        price: item.estimatedCost,
      });
    }

    await request.store!.logActivity(projectId, revisionId, "ai_equipment_accepted", {
      equipmentCount: equipment.length,
    });

    const response = await buildWorkspaceResponse(request.store!, projectId);
    if (!response) {
      return reply.code(404).send({ message: "Failed to build workspace" });
    }
    return response;
  });

  // ── Job routes ─────────────────────────────────────────────────────

  const createJobSchema = z.object({
    name: z.string().min(1),
    foreman: z.string().optional(),
    projectManager: z.string().optional(),
    startDate: z.string().nullable().optional(),
    shipDate: z.string().nullable().optional(),
    poNumber: z.string().optional(),
    poIssuer: z.string().optional()
  });

  app.post("/projects/:projectId/jobs", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = createJobSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid job payload",
        issues: parsed.error.flatten()
      });
    }

    const workspace = await request.store!.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    const job = await request.store!.createJob(projectId, workspace.currentRevision.id, parsed.data satisfies CreateJobInput);
    reply.code(201);
    return job;
  });

  app.get("/jobs", async (request) => request.store!.listAllJobs());

  // ── Import BOM routes ─────────────────────────────────────────────

  app.post("/projects/:projectId/import-preview", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }

    let importBuffer: Buffer | null = null;
    let originalFileName = "import.csv";
    let mimeType = "";

    for await (const part of request.parts()) {
      if (part.type === "file") {
        originalFileName = part.filename || originalFileName;
        mimeType = part.mimetype || "";
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        importBuffer = Buffer.concat(chunks);
      }
    }

    if (!importBuffer || importBuffer.length === 0) {
      return reply.code(400).send({ message: "No file uploaded" });
    }

    const tables = await parseImportFile({
      buffer: importBuffer,
      filename: originalFileName,
      mimeType,
      azureConfig: {
        endpoint: process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
        key: process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
      },
    });
    const parsed = tables
      .slice()
      .sort((left, right) => right.rows.length - left.rows.length)[0] ?? { headers: [], rows: [] };
    const fileId = `import-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    request.store!.storeImportPreview(fileId, parsed);

    return {
      headers: parsed.headers,
      sampleRows: parsed.rows.slice(0, 25),
      fileId,
      rowCount: parsed.rows.length,
      columnProfiles: buildImportColumnProfiles(parsed.headers, parsed.rows),
      pivotSummaries: buildImportPivotSummaries(parsed.headers, parsed.rows)
    };
  });

  const importProcessSchema = z.object({
    fileId: z.string().min(1),
    worksheetId: z.string().min(1),
    mapping: z.record(z.string())
  });

  app.post("/projects/:projectId/import-process", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const parsed = importProcessSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        message: "Invalid import process payload",
        issues: parsed.error.flatten()
      });
    }

    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }

    await request.store!.processImport(
      projectId,
      parsed.data.worksheetId,
      parsed.data.fileId,
      parsed.data.mapping
    );

    const payload = await buildWorkspaceResponse(request.store!, projectId);
    if (!payload) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    return payload;
  });

  // ── Plugin Routes ──────────────────────────────────────────────────

  app.get("/plugins", async (request) => request.store!.listPlugins());

  app.get("/plugins/:pluginId", async (request, reply) => {
    const { pluginId } = request.params as { pluginId: string };
    const plugin = await request.store!.getPlugin(pluginId);
    if (!plugin) {
      return reply.code(404).send({ message: "Plugin not found" });
    }
    return plugin;
  });

  app.post("/plugins", async (request, reply) => {
    const body = request.body as CreatePluginInput;
    const plugin = await request.store!.createPlugin(body);
    reply.code(201);
    return plugin;
  });

  app.patch("/plugins/:pluginId", async (request, reply) => {
    const { pluginId } = request.params as { pluginId: string };
    const patch = request.body as PluginPatchInput;
    try {
      const plugin = await request.store!.updatePlugin(pluginId, patch);
      return plugin;
    } catch {
      return reply.code(404).send({ message: "Plugin not found" });
    }
  });

  app.delete("/plugins/:pluginId", async (request, reply) => {
    const { pluginId } = request.params as { pluginId: string };
    try {
      const plugin = await request.store!.deletePlugin(pluginId);
      return plugin;
    } catch {
      return reply.code(404).send({ message: "Plugin not found" });
    }
  });

  // ── AI Plugin Generation ──────────────────────────────────────────
  app.post("/plugins/generate", async (request, reply) => {
    const { prompt, categories } = request.body as { prompt: string; categories?: string[] };
    if (!prompt?.trim()) return reply.code(400).send({ message: "prompt is required" });

    const settings = await request.store!.getSettings();
    const integrations = settings.integrations ?? {} as any;
    const apiKey = integrations.anthropicKey ?? process.env.ANTHROPIC_API_KEY ?? integrations.openaiKey ?? process.env.OPENAI_API_KEY ?? "";
    const provider = integrations.llmProvider ?? process.env.LLM_PROVIDER ?? (apiKey ? "anthropic" : "openai");
    const model = integrations.llmModel ?? process.env.LLM_MODEL ?? (provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o");

    if (!apiKey) return reply.code(400).send({ message: "No LLM API key configured. Set one in Settings > Integrations." });

    try {
      const { createLLMAdapter } = await import("@bidwright/agent");
      const adapter = createLLMAdapter({ provider: provider as any, apiKey, model });

      const categoryList = categories?.length ? categories.join(", ") : "Labour, Equipment, Material, Travel, General";

      const systemPrompt = `You are an expert construction estimating plugin builder. Generate complete plugin definitions for the Bidwright estimation platform.

A plugin has:
- name, slug (url-safe), icon (lucide icon name), category (one of: ${categoryList}), description, llmDescription (for AI agent), version, author, tags
- toolDefinitions: array of tools, each with:
  - id, name, description, llmDescription, parameters (array of {name, type, description, required}), outputType (line_items|worksheet|text_content|revision_patch|score|modifier|summary)
  - outputTemplate for declarative line item outputs when the tool creates estimate rows. Use field references, defaults, first/join/template values, and validation rules instead of relying on backend plugin IDs.
  - execution only when the tool needs a supported generic server capability such as labor_units, scoring_result_patch, table_hours, shop_pipe_estimate, or shop_weld_estimate. Never invent backend helper endpoints or exact slug/tool-name handlers.
  - ui: declarative UI schema with sections, each section has type (fields|table|scoring) and contains:
    - fields: array of {id, type (text|number|currency|percentage|select|search|computed|boolean|slider|textarea|date), label, description, placeholder, defaultValue, validation:{required,min,max}, width (full|half|third|quarter), options:[{value,label}], optionsSource, searchConfig, computation:{formula,dependencies,format(number|hours|currency|percentage)}}
    - table: {id, label, columns:[{id,label,type,width,editable,options,computation,aggregate(sum|avg)}], defaultRows, allowAddRow, allowDeleteRow, totalsRow, rowTemplate}
    - scoring: {id, label, criteria:[{id,label,description,weight,scale:{min,max,step,labels}}], resultMapping:[{minScore,maxScore,label,value,color}], outputField}

For computed fields, use formulas like "quantity * hoursPerUnit" referencing other field IDs. For selects with static options, include the options array. For searchable external data, put the HTTP API mapping in searchConfig.dataSource on the search field; do not use /api/plugins/helpers routes.

Return ONLY valid JSON — the complete plugin object. No markdown, no explanation.`;

      const response = await adapter.chat({
        model,
        systemPrompt,
        messages: [{ role: "user", content: `Generate a plugin for: ${prompt.trim()}` }],
        maxTokens: 8192,
        temperature: 0.3,
      });

      const text = response.content.find((b: any) => b.type === "text")?.text ?? "";
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
      const jsonStr = (jsonMatch[1] ?? text).trim();
      const generated = JSON.parse(jsonStr);

      return generated;
    } catch (err) {
      request.log.error(err, "Plugin generation failed");
      return reply.code(500).send({
        message: "Generation failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const findPluginField = (
    tool: { ui?: { sections?: Array<{ fields?: Array<{ id?: string; searchConfig?: unknown }> }> } },
    fieldId: string,
  ) => {
    for (const section of tool.ui?.sections ?? []) {
      const field = section.fields?.find((candidate) => candidate.id === fieldId);
      if (field) {
        return field;
      }
    }
    return null;
  };

  app.get("/plugins/:pluginId/tools/:toolId/fields/:fieldId/search", async (request, reply) => {
    const { pluginId, toolId, fieldId } = request.params as { pluginId: string; toolId: string; fieldId: string };
    const plugin = await request.store!.getPlugin(pluginId) ?? await request.store!.getPluginBySlug(pluginId);
    if (!plugin) {
      return reply.code(404).send({ message: "Plugin not found" });
    }
    if (!plugin.enabled) {
      return reply.code(403).send({ message: "Plugin is disabled" });
    }

    const tool = plugin.toolDefinitions.find((candidate) => candidate.id === toolId);
    if (!tool) {
      return reply.code(404).send({ message: "Plugin tool not found" });
    }

    const field = findPluginField(tool, fieldId);
    const dataSource = (field?.searchConfig as { dataSource?: unknown } | undefined)?.dataSource;
    if (!dataSource || typeof dataSource !== "object" || Array.isArray(dataSource)) {
      return reply.code(400).send({ message: "This plugin field does not define a remote search data source." });
    }

    try {
      return await executePluginSearchDataSource({
        dataSource: dataSource as Parameters<typeof executePluginSearchDataSource>[0]["dataSource"],
        requestQuery: request.query as Record<string, string | undefined>,
        pluginConfig: (plugin.config ?? {}) as Record<string, unknown>,
        env: process.env,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Plugin remote search failed.";
      request.log.error({ error, pluginId, toolId, fieldId }, "Plugin remote search failed");
      return reply.code(message.includes("required") ? 400 : 502).send({ message });
    }
  });

  app.post("/plugins/:pluginId/execute", async (request, reply) => {
    const { pluginId } = request.params as { pluginId: string };
    const body = request.body as {
      toolId?: string; projectId: string; revisionId: string; input: Record<string, unknown>;
      worksheetId?: string; replaceExecutionId?: string; formState?: Record<string, unknown>; executedBy?: "user" | "agent"; agentSessionId?: string;
    };
    try {
      const execution = await request.store!.executePlugin(
        pluginId, body.toolId ?? pluginId, body.projectId, body.revisionId, body.input ?? {},
        {
          worksheetId: body.worksheetId,
          replaceExecutionId: body.replaceExecutionId,
          formState: body.formState,
          executedBy: body.executedBy,
          agentSessionId: body.agentSessionId,
        },
      );
      reply.code(201);
      return execution;
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Execution failed" });
    }
  });

  // ── Plugin HTTP Fetch Proxy ──────────────────────────────────────
  // Allows plugins to make external HTTP requests via the server,
  // avoiding CORS issues and keeping API keys server-side in plugin config.

  app.post("/plugins/:pluginId/fetch", async (request, reply) => {
    const { pluginId } = request.params as { pluginId: string };
    const { url, method, headers, body: fetchBody, timeout } = request.body as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      timeout?: number;
    };

    if (!url) return reply.code(400).send({ message: "url is required" });

    // Validate the plugin exists and is enabled
    const plugin = await request.store!.getPlugin(pluginId);
    if (!plugin) return reply.code(404).send({ message: "Plugin not found" });
    if (!plugin.enabled) return reply.code(403).send({ message: "Plugin is disabled" });

    // Check allowed domains from plugin config
    const allowedDomains = (plugin.config.allowedDomains as string[] | undefined) ?? [];
    if (allowedDomains.length > 0) {
      try {
        const parsed = new URL(url);
        const domainAllowed = allowedDomains.some(
          (d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`)
        );
        if (!domainAllowed) {
          return reply.code(403).send({ message: `Domain ${parsed.hostname} not in plugin's allowed domains` });
        }
      } catch {
        return reply.code(400).send({ message: "Invalid URL" });
      }
    }

    // Merge plugin config headers (e.g., API keys) with request headers
    const configHeaders = (plugin.config.defaultHeaders as Record<string, string> | undefined) ?? {};
    const mergedHeaders: Record<string, string> = { ...configHeaders, ...headers };

    try {
      const controller = new AbortController();
      const fetchTimeout = Math.min(timeout ?? 30000, 60000);
      const timer = setTimeout(() => controller.abort(), fetchTimeout);

      const response = await fetch(url, {
        method: method ?? "GET",
        headers: mergedHeaders,
        body: fetchBody ? (typeof fetchBody === "string" ? fetchBody : JSON.stringify(fetchBody)) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const contentType = response.headers.get("content-type") ?? "";
      let responseBody: unknown;
      if (contentType.includes("application/json")) {
        responseBody = await response.json();
      } else {
        responseBody = await response.text();
      }

      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries((response.headers as any).entries()),
        body: responseBody,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fetch failed";
      return reply.code(502).send({ message: `External fetch failed: ${message}` });
    }
  });

  app.get("/projects/:projectId/plugin-executions", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }
    return request.store!.listPluginExecutions(projectId);
  });

  // ── Knowledge Book Routes ──────────────────────────────────────────

  app.get("/knowledge/books", async (request) => {
    const { projectId } = (request.query ?? {}) as { projectId?: string };
    return request.store!.listKnowledgeBooks(projectId);
  });

  app.get("/knowledge/books/:bookId", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const book = await request.store!.getKnowledgeBook(bookId);
    if (!book) return reply.code(404).send({ message: "Knowledge book not found" });
    return book;
  });

  app.post("/knowledge/books", async (request, reply) => {
    const body = request.body as {
      name: string; description: string;
      category: string; scope: string;
      projectId?: string | null;
      sourceFileName: string; sourceFileSize: number;
    };
    const book = await request.store!.createKnowledgeBook(body as Parameters<PrismaApiStore["createKnowledgeBook"]>[0]);
    reply.code(201);
    return book;
  });

  app.patch("/knowledge/books/:bookId", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const patch = request.body as Record<string, unknown>;
    try {
      return await request.store!.updateKnowledgeBook(bookId, patch as Parameters<PrismaApiStore["updateKnowledgeBook"]>[1]);
    } catch {
      return reply.code(404).send({ message: "Knowledge book not found" });
    }
  });

  app.delete("/knowledge/books/:bookId", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    try {
      return await request.store!.deleteKnowledgeBook(bookId);
    } catch {
      return reply.code(404).send({ message: "Knowledge book not found" });
    }
  });

  app.get("/knowledge/cabinets", async (request) => {
    const { itemType } = (request.query ?? {}) as { itemType?: "book" | "dataset" };
    return request.store!.listKnowledgeLibraryCabinets(itemType);
  });

  app.post("/knowledge/cabinets", async (request, reply) => {
    const body = request.body as Parameters<PrismaApiStore["createKnowledgeLibraryCabinet"]>[0];
    try {
      const cabinet = await request.store!.createKnowledgeLibraryCabinet(body);
      reply.code(201);
      return cabinet;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create cabinet";
      return reply.code(message.includes("not found") ? 404 : 400).send({ message });
    }
  });

  app.patch("/knowledge/cabinets/:cabinetId", async (request, reply) => {
    const { cabinetId } = request.params as { cabinetId: string };
    const patch = request.body as Parameters<PrismaApiStore["updateKnowledgeLibraryCabinet"]>[1];
    try {
      return await request.store!.updateKnowledgeLibraryCabinet(cabinetId, patch);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update cabinet";
      return reply.code(message.includes("not found") ? 404 : 400).send({ message });
    }
  });

  app.delete("/knowledge/cabinets/:cabinetId", async (request, reply) => {
    const { cabinetId } = request.params as { cabinetId: string };
    try {
      return await request.store!.deleteKnowledgeLibraryCabinet(cabinetId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete cabinet";
      return reply.code(message.includes("not found") ? 404 : 400).send({ message });
    }
  });

  app.get("/knowledge/books/:bookId/chunks", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const book = await request.store!.getKnowledgeBook(bookId);
    if (!book) return reply.code(404).send({ message: "Knowledge book not found" });
    const query = request.query as { limit?: string; offset?: string };
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 200) : undefined;
    const offset = query.offset ? parseInt(query.offset, 10) : undefined;
    if (limit != null) {
      return request.store!.listKnowledgeChunksPaginated(bookId, limit, offset ?? 0);
    }
    return request.store!.listKnowledgeChunks(bookId);
  });

  app.post("/knowledge/books/:bookId/chunks", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const body = request.body as { pageNumber?: number | null; sectionTitle: string; text: string; tokenCount?: number; order?: number };
    try {
      const chunk = await request.store!.createKnowledgeChunk(bookId, body);
      reply.code(201);
      return chunk;
    } catch {
      return reply.code(404).send({ message: "Knowledge book not found" });
    }
  });

  app.post("/knowledge/books/:bookId/chunks/batch", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const body = request.body as Array<{ pageNumber?: number | null; sectionTitle: string; text: string; tokenCount?: number; order?: number }>;
    const book = await request.store!.getKnowledgeBook(bookId);
    if (!book) return reply.code(404).send({ message: "Knowledge book not found" });
    const results = [];
    for (const item of body) {
      const chunk = await request.store!.createKnowledgeChunk(bookId, item);
      results.push(chunk);
    }
    reply.code(201);
    return results;
  });

  // ── Knowledge Documents / Pages ────────────────────────────────────────

  const scheduleKnowledgeDocumentIndex = (request: FastifyRequest, documentId: string) => {
    void knowledgeService.indexKnowledgeDocument(documentId, request.store!, request.user?.organizationId ?? undefined).catch((err) => {
      request.log.error(err, "Knowledge document indexing failed");
    });
  };

  app.get("/knowledge/documents", async (request) => {
    const { projectId } = (request.query ?? {}) as { projectId?: string };
    return request.store!.listKnowledgeDocuments(projectId);
  });

  app.post("/knowledge/documents", async (request, reply) => {
    const body = request.body as {
      title: string;
      description?: string;
      category?: string;
      scope?: string;
      projectId?: string | null;
      cabinetId?: string | null;
      tags?: string[];
      pageTitle?: string;
      contentJson?: Record<string, unknown>;
      contentMarkdown?: string;
      plainText?: string;
    };
    try {
      const document = await request.store!.createKnowledgeDocument(body as Parameters<PrismaApiStore["createKnowledgeDocument"]>[0]);
      await request.store!.createKnowledgeDocumentPage(document.id, {
        title: body.pageTitle || body.title || "Page 1",
        contentJson: body.contentJson ?? {},
        contentMarkdown: body.contentMarkdown ?? "",
        plainText: body.plainText ?? "",
      });
      scheduleKnowledgeDocumentIndex(request, document.id);
      reply.code(201);
      return (await request.store!.getKnowledgeDocument(document.id)) ?? document;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create knowledge document";
      return reply.code(message.includes("not found") ? 404 : 400).send({ message });
    }
  });

  app.get("/knowledge/documents/:documentId/pages", async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    try {
      return await request.store!.listKnowledgeDocumentPages(documentId);
    } catch {
      return reply.code(404).send({ message: "Knowledge document not found" });
    }
  });

  app.post("/knowledge/documents/:documentId/pages", async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const body = request.body as {
      title: string;
      contentJson?: Record<string, unknown>;
      contentMarkdown?: string;
      plainText?: string;
      metadata?: Record<string, unknown>;
      order?: number;
    };
    try {
      const page = await request.store!.createKnowledgeDocumentPage(documentId, body);
      scheduleKnowledgeDocumentIndex(request, documentId);
      reply.code(201);
      return page;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create page";
      return reply.code(message.includes("not found") ? 404 : 400).send({ message });
    }
  });

  app.patch("/knowledge/documents/:documentId/pages/:pageId", async (request, reply) => {
    const { documentId, pageId } = request.params as { documentId: string; pageId: string };
    const patch = request.body as Parameters<PrismaApiStore["updateKnowledgeDocumentPage"]>[1];
    try {
      const page = await request.store!.updateKnowledgeDocumentPage(pageId, patch);
      scheduleKnowledgeDocumentIndex(request, documentId);
      return page;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update page";
      return reply.code(message.includes("not found") ? 404 : 400).send({ message });
    }
  });

  app.delete("/knowledge/documents/:documentId/pages/:pageId", async (request, reply) => {
    const { documentId, pageId } = request.params as { documentId: string; pageId: string };
    try {
      const page = await request.store!.deleteKnowledgeDocumentPage(pageId);
      scheduleKnowledgeDocumentIndex(request, documentId);
      return page;
    } catch {
      return reply.code(404).send({ message: "Knowledge document page not found" });
    }
  });

  app.get("/knowledge/documents/:documentId/chunks", async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const { pageId } = (request.query ?? {}) as { pageId?: string };
    try {
      return await request.store!.listKnowledgeDocumentChunks(documentId, pageId);
    } catch {
      return reply.code(404).send({ message: "Knowledge document not found" });
    }
  });

  app.post("/knowledge/documents/:documentId/reindex", async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    try {
      return await knowledgeService.indexKnowledgeDocument(documentId, request.store!, request.user?.organizationId ?? undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to reindex knowledge document";
      return reply.code(message.includes("not found") ? 404 : 500).send({ message });
    }
  });

  app.get("/knowledge/documents/:documentId", async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const document = await request.store!.getKnowledgeDocument(documentId);
    if (!document) return reply.code(404).send({ message: "Knowledge document not found" });
    const pages = await request.store!.listKnowledgeDocumentPages(documentId);
    return { ...document, pages };
  });

  app.patch("/knowledge/documents/:documentId", async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const patch = request.body as Parameters<PrismaApiStore["updateKnowledgeDocument"]>[1];
    try {
      return await request.store!.updateKnowledgeDocument(documentId, patch);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update knowledge document";
      return reply.code(message.includes("not found") ? 404 : 400).send({ message });
    }
  });

  app.delete("/knowledge/documents/:documentId", async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    try {
      await knowledgeService.deleteKnowledgeDocumentIndex(documentId, request.user?.organizationId ?? undefined).catch(() => 0);
      return await request.store!.deleteKnowledgeDocument(documentId);
    } catch {
      return reply.code(404).send({ message: "Knowledge document not found" });
    }
  });

  app.get("/knowledge/search", async (request) => {
    const { q, bookId, documentId, limit, scope } = (request.query ?? {}) as { q?: string; bookId?: string; documentId?: string; limit?: string; scope?: string };
    const fetchLimit = limit ? parseInt(limit, 10) * 3 : 60;
    const normalizedScope = scope === "library" ? "global" : scope;
    const [chunks, documentChunks] = await Promise.all([
      documentId ? Promise.resolve([]) : request.store!.searchKnowledgeChunks(q ?? "", bookId, fetchLimit),
      bookId ? Promise.resolve([]) : request.store!.searchKnowledgeDocumentChunks(q ?? "", documentId, fetchLimit),
    ]);

    // Enrich with book metadata and apply scope filtering
    const bookCache = new Map<string, any>();
    const enriched: any[] = [];
    for (const chunk of chunks) {
      let book = bookCache.get(chunk.bookId);
      if (!book) {
        book = await request.store!.getKnowledgeBook(chunk.bookId);
        if (book) bookCache.set(chunk.bookId, book);
      }
      if (!book) continue;

      // Scope filtering
      if (normalizedScope === "global" && book.scope !== "global") continue;
      if (normalizedScope === "project" && book.scope !== "project") continue;

      enriched.push({
        ...chunk,
        bookName: book.name,
        source: book.sourceFileName || book.name,
        sourceType: "book",
      });
    }

    const documentCache = new Map<string, any>();
    const pageCache = new Map<string, any>();
    for (const chunk of documentChunks) {
      let doc = documentCache.get(chunk.documentId);
      if (!doc) {
        doc = await request.store!.getKnowledgeDocument(chunk.documentId);
        if (doc) {
          documentCache.set(chunk.documentId, doc);
          const pages = await request.store!.listKnowledgeDocumentPages(chunk.documentId);
          for (const page of pages) pageCache.set(page.id, page);
        }
      }
      if (!doc) continue;
      if (normalizedScope === "global" && doc.scope !== "global") continue;
      if (normalizedScope === "project" && doc.scope !== "project") continue;
      const page = chunk.pageId ? pageCache.get(chunk.pageId) : null;

      enriched.push({
        ...chunk,
        sourceType: "document_page",
        documentTitle: doc.title,
        pageTitle: page?.title ?? "",
        source: doc.title,
      });
    }

    const finalLimit = limit ? parseInt(limit, 10) : 20;
    return enriched
      .sort((left, right) => {
        const leftScore = Number(left.metadata?.searchMatch?.score ?? 0);
        const rightScore = Number(right.metadata?.searchMatch?.score ?? 0);
        return rightScore - leftScore;
      })
      .slice(0, finalLimit);
  });

  // ── Knowledge Book File Serving ────────────────────────────────────

  app.get("/knowledge/books/:bookId/file", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const book = await request.store!.getKnowledgeBook(bookId);
    if (!book) return reply.code(404).send({ message: "Knowledge book not found" });
    if (!book.storagePath) return reply.code(404).send({ message: "No source file stored for this book" });

    const absPath = resolveApiPath(book.storagePath);
    try {
      await import("node:fs/promises").then((fs) => fs.access(absPath));
    } catch {
      return reply.code(404).send({ message: "Source file not found on disk" });
    }

    const ext = book.sourceFileName.split(".").pop()?.toLowerCase() ?? "";
    const MIME: Record<string, string> = {
      pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", tiff: "image/tiff",
      tif: "image/tiff", bmp: "image/bmp",
      txt: "text/plain", csv: "text/csv", tsv: "text/tab-separated-values", json: "application/json",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xls: "application/vnd.ms-excel",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      rtf: "application/rtf",
      html: "text/html",
      htm: "text/html",
      mhtml: "multipart/related",
      mht: "multipart/related",
    };
    const contentType = MIME[ext] || "application/octet-stream";
    const inline = (request.query as { inline?: string })?.inline === "1";
    const disposition = inline ? "inline" : `attachment; filename="${book.sourceFileName}"`;

    const { createReadStream } = await import("node:fs");
    return reply
      .header("Content-Type", contentType)
      .header("Content-Disposition", disposition)
      .send(createReadStream(absPath));
  });

  app.get("/knowledge/books/:bookId/info", async (request) => {
    const { bookId } = request.params as { bookId: string };
    const book = await request.store!.getKnowledgeBook(bookId);
    if (!book) return { error: "Book not found" };
    return { book };
  });

  app.get("/knowledge/books/:bookId/thumbnail", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const book = await request.store!.getKnowledgeBook(bookId);
    if (!book) return reply.code(404).send({ message: "Knowledge book not found" });
    if (!book.storagePath) return reply.code(404).send({ message: "No source file" });

    const { relativeKnowledgeBookThumbnailPath } = await import("./paths.js");
    const thumbRelPath = relativeKnowledgeBookThumbnailPath(bookId);
    const thumbAbsPath = resolveApiPath(thumbRelPath);

    // Return cached thumbnail if it exists
    try {
      await import("node:fs/promises").then((fs) => fs.access(thumbAbsPath));
      const { createReadStream } = await import("node:fs");
      return reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", "public, max-age=86400")
        .send(createReadStream(thumbAbsPath));
    } catch {
      // Generate thumbnail
    }

    const sourceAbsPath = resolveApiPath(book.storagePath);
    const ext = book.sourceFileName.split(".").pop()?.toLowerCase() ?? "";

    if (ext === "pdf") {
      // Use pdftoppm to generate thumbnail from first page (Linux/Mac only)
      try {
        const { execSync } = await import("node:child_process");
        const { mkdir } = await import("node:fs/promises");
        // Check if pdftoppm is available
        const whichCmd = process.platform === "win32" ? "where" : "which";
        execSync(`${whichCmd} pdftoppm`, { stdio: "ignore" });
        await mkdir(path.dirname(thumbAbsPath), { recursive: true });
        execSync(
          `pdftoppm -f 1 -l 1 -png -r 150 -singlefile "${sourceAbsPath}" "${thumbAbsPath.replace(/\.png$/, "")}"`,
          { timeout: 15000 },
        );
        const { createReadStream } = await import("node:fs");
        return reply
          .header("Content-Type", "image/png")
          .header("Cache-Control", "public, max-age=86400")
          .send(createReadStream(thumbAbsPath));
      } catch {
        // pdftoppm not available (Windows) or failed — return a 204 so the UI shows a fallback
        return reply.code(204).send();
      }
    } else if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
      // For images, just serve the original
      const { createReadStream } = await import("node:fs");
      return reply
        .header("Content-Type", `image/${ext === "jpg" ? "jpeg" : ext}`)
        .header("Cache-Control", "public, max-age=86400")
        .send(createReadStream(sourceAbsPath));
    }

    return reply.code(404).send({ message: "No thumbnail available for this file type" });
  });

  // ── Dataset Routes ────────────────────────────────────────────────

  app.get("/datasets", async (request) => {
    const { projectId } = (request.query ?? {}) as { projectId?: string };
    return request.store!.listDatasets(projectId);
  });

  app.get("/datasets/:datasetId", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const dataset = await request.store!.getDataset(datasetId);
    if (!dataset) return reply.code(404).send({ message: "Dataset not found" });
    return dataset;
  });

  app.post("/datasets", async (request, reply) => {
    const body = request.body as Parameters<PrismaApiStore["createDataset"]>[0];
    const dataset = await request.store!.createDataset(body);
    reply.code(201);
    return dataset;
  });

  app.patch("/datasets/:datasetId", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const patch = request.body as Record<string, unknown>;
    try {
      return await request.store!.updateDataset(datasetId, patch as Parameters<PrismaApiStore["updateDataset"]>[1]);
    } catch {
      return reply.code(404).send({ message: "Dataset not found" });
    }
  });

  app.delete("/datasets/:datasetId", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    try {
      return await request.store!.deleteDataset(datasetId);
    } catch {
      return reply.code(404).send({ message: "Dataset not found" });
    }
  });

  app.get("/datasets/:datasetId/rows", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const { filter, sort, limit, offset } = (request.query ?? {}) as { filter?: string; sort?: string; limit?: string; offset?: string };
    const dataset = await request.store!.getDataset(datasetId);
    if (!dataset) return reply.code(404).send({ message: "Dataset not found" });
    return request.store!.listDatasetRows(datasetId, filter, sort, limit ? parseInt(limit, 10) : undefined, offset ? parseInt(offset, 10) : undefined);
  });

  app.post("/datasets/:datasetId/rows", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const body = request.body as { data: Record<string, unknown> };
    try {
      const row = await request.store!.createDatasetRow(datasetId, body.data ?? body);
      reply.code(201);
      return row;
    } catch {
      return reply.code(404).send({ message: "Dataset not found" });
    }
  });

  app.post("/datasets/:datasetId/rows/batch", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const body = request.body as { rows: Array<Record<string, unknown>> };
    try {
      const rows = await request.store!.createDatasetRowsBatch(datasetId, body.rows ?? body);
      reply.code(201);
      return rows;
    } catch {
      return reply.code(404).send({ message: "Dataset not found" });
    }
  });

  app.patch("/datasets/:datasetId/rows/:rowId", async (request, reply) => {
    const { rowId } = request.params as { datasetId: string; rowId: string };
    const body = request.body as { data: Record<string, unknown> };
    try {
      return await request.store!.updateDatasetRow(rowId, body.data ?? body);
    } catch {
      return reply.code(404).send({ message: "Dataset row not found" });
    }
  });

  app.delete("/datasets/:datasetId/rows/:rowId", async (request, reply) => {
    const { rowId } = request.params as { datasetId: string; rowId: string };
    try {
      return await request.store!.deleteDatasetRow(rowId);
    } catch {
      return reply.code(404).send({ message: "Dataset row not found" });
    }
  });

  // Global dataset search — searches across ALL datasets by name, tags, description, and row content
  app.get("/datasets/search/global", async (request, reply) => {
    const { q, limit: limitStr } = (request.query ?? {}) as { q?: string; limit?: string };
    if (!q) return { results: [] };
    const limit = parseInt(limitStr || "20");
    const stop = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "per", "the", "to", "with", "unit", "units", "row", "rows", "data", "dataset", "table"]);
    const words = q
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 1 && !stop.has(word));
    const anchorWords = words.filter((word) => /\d/.test(word) || word.length >= 6);

    // Get all datasets
    const allDatasets = await request.store!.listDatasets();

    // Score each dataset by name/tags/description match
    const scored = allDatasets.map((d: any) => {
      let score = 0;
      const nameL = (d.name || "").toLowerCase();
      const descL = (d.description || "").toLowerCase();
      const tagsL = (d.tags || []).map((t: string) => t.toLowerCase());
      const columnsL = Array.isArray(d.columns)
        ? d.columns.map((column: any) => `${column.name ?? ""} ${column.label ?? ""} ${column.key ?? ""}`.toLowerCase())
        : [];
      let anchorMatches = 0;

      for (const w of words) {
        const isAnchor = anchorWords.includes(w);
        let matched = false;
        if (nameL.includes(w)) { score += isAnchor ? 5 : 3; matched = true; }
        if (descL.includes(w)) { score += isAnchor ? 2 : 1; matched = true; }
        if (tagsL.some((t: string) => t.includes(w))) { score += isAnchor ? 4 : 2; matched = true; }
        if (columnsL.some((c: string) => c.includes(w))) { score += isAnchor ? 3 : 1.5; matched = true; }
        if (matched && isAnchor) anchorMatches += 1;
      }
      return { dataset: d, score, anchorMatches };
    });

    // Filter to those with score > 0, sort by score
    const matched = scored
      .filter((s: any) => s.score > 0 && (anchorWords.length === 0 || s.anchorMatches > 0))
      .sort((a: any, b: any) => b.score - a.score || b.anchorMatches - a.anchorMatches);

    // For top matches, fetch sample rows
    const results: any[] = [];
    for (const m of matched.slice(0, Math.min(limit, 10))) {
      const rowMatches = await request.store!.searchDatasetRows(m.dataset.id, q);
      const rows = rowMatches.length > 0
        ? { rows: rowMatches.slice(0, 5) }
        : await request.store!.listDatasetRows(m.dataset.id, undefined, undefined, 5, 0);
      results.push({
        datasetId: m.dataset.id,
        datasetName: m.dataset.name,
        description: m.dataset.description,
        tags: m.dataset.tags,
        columns: m.dataset.columns,
        rowCount: m.dataset.rowCount,
        score: m.score,
        anchorMatches: m.anchorMatches,
        matchedRows: rowMatches.length,
        sampleRows: rows.rows?.map((r: any) => r.data) || [],
      });
    }

    return { results, total: matched.length };
  });

  app.get("/datasets/:datasetId/search", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const { q } = (request.query ?? {}) as { q?: string };
    const dataset = await request.store!.getDataset(datasetId);
    if (!dataset) return reply.code(404).send({ message: "Dataset not found" });
    return request.store!.searchDatasetRows(datasetId, q ?? "");
  });

  app.post("/datasets/:datasetId/query", async (request, reply) => {
    const { datasetId } = request.params as { datasetId: string };
    const { filters } = request.body as { filters: Array<{ column: string; op: string; value: unknown }> };
    const dataset = await request.store!.getDataset(datasetId);
    if (!dataset) return reply.code(404).send({ message: "Dataset not found" });
    return request.store!.queryDataset(datasetId, filters as Parameters<PrismaApiStore["queryDataset"]>[1]);
  });

  // ── Estimator Persona Routes ────────────────────────────────────────

  app.register(authRoutes);
  app.register(adminRoutes);
  app.register(knowledgeRoutes);
  app.register(datasetRoutes);
  app.register(takeoffRoutes);
  app.register(visionRoutes);
  app.register(modelRoutes);
  app.register(fileIngestRoutes);
  app.register(scheduleImportRoutes);
  app.register(rateScheduleRoutes);
  app.register(settingsRoutes);
  app.register(integrationsRoutes);
  app.register(webhooksRoutes);
  app.register(costIntelligenceRoutes);
  app.register(estimateRoutes);
  app.register(catalogRoutes);
  app.register(laborUnitRoutes);
  app.register(assemblyRoutes);
  registerCliRoutes(app);
  registerReviewRoutes(app);

  app.addHook("onReady", async () => {
    await cleanExpiredSessions(prisma);
    setInterval(() => cleanExpiredSessions(prisma), 60 * 60 * 1000);

    // Clean up orphaned AI runs stuck at "running" from previous server crashes/restarts.
    // On startup, no CLI sessions are actually running, so any "running" AI run is orphaned.
    try {
      const orphaned = await prisma.aiRun.updateMany({
        where: { status: "running" },
        data: { status: "stopped" },
      });
      if (orphaned.count > 0) {
        console.log(`[startup] Cleaned ${orphaned.count} orphaned AI run(s) stuck at "running" → "stopped"`);
      }
    } catch (err) {
      console.error("[startup] Failed to clean orphaned AI runs:", err);
    }
  });

  return app;
}

export const createBidwrightServer = buildServer;
