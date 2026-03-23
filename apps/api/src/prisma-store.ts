import { randomUUID, createHash } from "node:crypto";
import { hashPassword } from "./services/auth-service.js";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildProjectWorkspace, summarizeProjectTotals } from "@bidwright/domain";
import type {
  Activity,
  AdditionalLineItem,
  AppSettings,
  AuthSession,
  BidwrightStore,
  Catalog,
  CatalogItem,
  Condition,
  ConditionLibraryEntry,
  Customer,
  CustomerContact,
  CustomerWithContacts,
  Dataset,
  DatasetRow,
  Department,
  EntityCategory,
  FileNode,
  Job,
  KnowledgeBook,
  KnowledgeChunk,
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
  ScheduleDependency,
  ScheduleTask,
  SourceDocument,
  User,
  WorksheetItem,
} from "@bidwright/domain";
import type { DocumentChunk, IngestionReport, PackageSourceKind } from "@bidwright/ingestion";
import { ingestCustomerPackage } from "@bidwright/ingestion";
import type { PrismaClient, Prisma } from "@bidwright/db";
import { prisma as sharedPrisma } from "@bidwright/db";

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

/** Map document type to knowledge category for vector indexing. */
function knowledgeCategoryFromDocType(docType: string): "estimating" | "labour" | "equipment" | "materials" | "safety" | "standards" | "general" {
  switch (docType) {
    case "spec":
    case "rfq":
    case "addendum":
      return "estimating";
    case "drawing":
      return "general";
    case "schedule":
      return "general";
    case "estimate_book":
      return "estimating";
    default:
      return "general";
  }
}

// ── Re-exported Interfaces ────────────────────────────────────────────────────
// These interfaces are re-exported so that existing consumers (server.ts, routes)
// continue to work unchanged.

export interface StoredPackageRecord {
  id: string;
  projectId: string;
  packageName: string;
  originalFileName: string;
  sourceKind: PackageSourceKind;
  storagePath: string;
  reportPath: string | null;
  chunksPath: string | null;
  checksum: string;
  totalBytes: number;
  status: "uploaded" | "processing" | "ready" | "failed";
  documentCount: number;
  chunkCount: number;
  documentIds: string[];
  unknownFiles: string[];
  uploadedAt: string;
  ingestedAt: string | null;
  updatedAt: string;
  error: string | null;
}

export interface IngestionJobRecord {
  id: string;
  projectId: string;
  packageId: string | null;
  kind: "package_upload" | "package_ingest" | "project_ingest";
  status: "queued" | "processing" | "complete" | "failed";
  progress: number;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  storagePath: string;
}

export interface WorkspaceStateRecord {
  projectId: string;
  state: Record<string, unknown>;
  updatedAt: string;
  storagePath: string;
}

export type PluginPatchInput = Partial<Pick<Plugin, "name" | "description" | "enabled" | "config" | "configSchema" | "toolDefinitions" | "tags" | "supportedCategories" | "defaultOutputType" | "llmDescription" | "documentation" | "icon" | "author">>;

export type CreatePluginInput = Omit<Plugin, "id" | "createdAt" | "updatedAt">;

export interface CreateProjectInput {
  name: string;
  clientName: string;
  location: string;
  packageName?: string;
  scope?: string;
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
  phaseWorksheetEnabled?: boolean;
  useCalculatedTotal?: boolean;
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
  necaDifficulty?: string;
  followUpNote?: string;
  printEmptyNotesColumn?: boolean;
  printCategory?: string[];
  printPhaseTotalOnly?: boolean;
  showOvertimeDoubletime?: boolean;
  grandTotal?: number;
  regHours?: number;
  overHours?: number;
  doubleHours?: number;
  breakoutPackage?: unknown[];
  calculatedCategoryTotals?: unknown[];
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
  category?: string;
  entityType?: string;
  entityName?: string;
  vendor?: string | null;
  description?: string;
  quantity?: number;
  uom?: string;
  cost?: number;
  markup?: number;
  price?: number;
  laborHourReg?: number;
  laborHourOver?: number;
  laborHourDouble?: number;
  lineOrder?: number;
  rateScheduleItemId?: string | null;
  tierUnits?: Record<string, number>;
}

export interface CreateWorksheetItemInput {
  phaseId?: string | null;
  category: string;
  entityType: string;
  entityName: string;
  vendor?: string | null;
  description: string;
  quantity: number;
  uom: string;
  cost: number;
  markup: number;
  price: number;
  laborHourReg: number;
  laborHourOver: number;
  laborHourDouble: number;
  lineOrder?: number;
  rateScheduleItemId?: string | null;
  tierUnits?: Record<string, number>;
}

export interface CreateWorksheetInput {
  name: string;
}

export interface WorksheetPatchInput {
  name?: string;
  order?: number;
}

export interface CreatePhaseInput {
  number?: string;
  name?: string;
  description?: string;
}

export interface PhasePatchInput {
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
  name?: string;
  description?: string;
  taskType?: "task" | "milestone";
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
  duration?: number;
  progress?: number;
  assignee?: string;
  order?: number;
}

export interface ScheduleTaskPatchInput {
  phaseId?: string | null;
  name?: string;
  description?: string;
  taskType?: "task" | "milestone";
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
  duration?: number;
  progress?: number;
  assignee?: string;
  order?: number;
}

export interface CreateDependencyInput {
  predecessorId: string;
  successorId: string;
  type?: "FS" | "SS" | "FF" | "SF";
  lagDays?: number;
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

// ── Default Settings ──────────────────────────────────────────────────────────

const DEFAULT_BRAND: AppSettings["brand"] = {
  companyName: "", tagline: "", industry: "", description: "",
  services: [], targetMarkets: [], brandVoice: "",
  colors: { primary: "", secondary: "", accent: "" },
  logoUrl: "", socialLinks: {}, websiteUrl: "", lastCapturedAt: null,
};

const DEFAULT_SETTINGS: AppSettings = {
  general: { orgName: "", address: "", phone: "", website: "", logoUrl: "" },
  email: { host: "", port: 587, username: "", password: "", fromAddress: "", fromName: "" },
  defaults: { defaultMarkup: 15, breakoutStyle: "category", quoteType: "Firm", timezone: "America/New_York", currency: "USD", dateFormat: "MM/DD/YYYY", fiscalYearStart: 1, maxAgentIterations: 200 },
  integrations: { openaiKey: "", anthropicKey: "", openrouterKey: "", geminiKey: "", llmProvider: "anthropic", llmModel: "claude-sonnet-4-20250514" },
  brand: DEFAULT_BRAND,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function inferPageCount(document: IngestionReport["documents"][number], chunks: DocumentChunk[]) {
  const relatedChunks = chunks.filter((chunk) => chunk.documentId === document.id);
  if (relatedChunks.length > 0) {
    return Math.max(1, relatedChunks.length);
  }
  const textLength = document.text.length;
  const estimated = Math.ceil(textLength / 1800);
  return Math.max(1, estimated || 1);
}

function checksumForDocument(packageChecksum: string, document: IngestionReport["documents"][number]) {
  return createHash("sha256")
    .update(`${packageChecksum}:${document.sourcePath}:${document.text}:${document.kind}`)
    .digest("hex");
}

function relativePackageDocumentArtifact(packageId: string, documentId: string, title: string) {
  return relativePackageDocumentPath(packageId, documentId, title);
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

function toISOString(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function toISO(d: Date): string {
  return d.toISOString();
}

// ── Prisma → Domain Mappers ──────────────────────────────────────────────────

function mapProject(p: any): Project {
  return {
    id: p.id,
    name: p.name,
    clientName: p.clientName,
    location: p.location,
    packageName: p.packageName,
    packageUploadedAt: p.packageUploadedAt,
    ingestionStatus: p.ingestionStatus as Project["ingestionStatus"],
    summary: p.summary,
    createdAt: toISO(p.createdAt),
    updatedAt: toISO(p.updatedAt),
  };
}

function mapSourceDocument(d: any): SourceDocument {
  return {
    id: d.id,
    projectId: d.projectId,
    fileName: d.fileName,
    fileType: d.fileType,
    documentType: d.documentType as SourceDocument["documentType"],
    pageCount: d.pageCount,
    checksum: d.checksum,
    storagePath: d.storagePath,
    extractedText: d.extractedText,
    createdAt: toISO(d.createdAt),
    updatedAt: toISO(d.updatedAt),
  };
}

function mapQuote(q: any): Quote {
  return {
    id: q.id,
    projectId: q.projectId,
    quoteNumber: q.quoteNumber,
    title: q.title,
    status: q.status as Quote["status"],
    currentRevisionId: q.currentRevisionId,
    customerExistingNew: q.customerExistingNew as Quote["customerExistingNew"],
    customerId: q.customerId ?? null,
    customerString: q.customerString,
    customerContactId: q.customerContactId ?? null,
    customerContactString: q.customerContactString,
    customerContactEmailString: q.customerContactEmailString,
    departmentId: q.departmentId ?? null,
    userId: q.userId ?? null,
    createdAt: toISO(q.createdAt),
    updatedAt: toISO(q.updatedAt),
  };
}

function mapRevision(r: any): QuoteRevision {
  return {
    id: r.id,
    quoteId: r.quoteId,
    revisionNumber: r.revisionNumber,
    title: r.title,
    description: r.description,
    notes: r.notes,
    breakoutStyle: r.breakoutStyle as QuoteRevision["breakoutStyle"],
    phaseWorksheetEnabled: r.phaseWorksheetEnabled,
    useCalculatedTotal: r.useCalculatedTotal,
    type: r.type as QuoteRevision["type"],
    scratchpad: r.scratchpad,
    leadLetter: r.leadLetter,
    dateEstimatedShip: r.dateEstimatedShip ?? null,
    dateQuote: r.dateQuote ?? null,
    dateDue: r.dateDue ?? null,
    dateWalkdown: r.dateWalkdown ?? null,
    dateWorkStart: r.dateWorkStart ?? null,
    dateWorkEnd: r.dateWorkEnd ?? null,
    shippingMethod: r.shippingMethod,
    shippingTerms: r.shippingTerms,
    freightOnBoard: r.freightOnBoard,
    status: r.status as QuoteRevision["status"],
    defaultMarkup: r.defaultMarkup,
    necaDifficulty: r.necaDifficulty,
    followUpNote: r.followUpNote,
    printEmptyNotesColumn: r.printEmptyNotesColumn,
    printCategory: r.printCategory ?? [],
    printPhaseTotalOnly: r.printPhaseTotalOnly,
    showOvertimeDoubletime: r.showOvertimeDoubletime,
    grandTotal: r.grandTotal,
    regHours: r.regHours,
    overHours: r.overHours,
    doubleHours: r.doubleHours,
    breakoutPackage: (r.breakoutPackage as unknown[]) ?? [],
    calculatedCategoryTotals: (r.calculatedCategoryTotals as unknown[]) ?? [],
    subtotal: r.subtotal,
    cost: r.cost,
    estimatedProfit: r.estimatedProfit,
    estimatedMargin: r.estimatedMargin,
    calculatedTotal: r.calculatedTotal,
    totalHours: r.totalHours,
    createdAt: toISO(r.createdAt),
    updatedAt: toISO(r.updatedAt),
  };
}

function mapWorksheet(w: any): { id: string; revisionId: string; name: string; order: number } {
  return { id: w.id, revisionId: w.revisionId, name: w.name, order: w.order };
}

function mapWorksheetItem(i: any): WorksheetItem {
  return {
    id: i.id,
    worksheetId: i.worksheetId,
    phaseId: i.phaseId ?? null,
    category: i.category,
    entityType: i.entityType,
    entityName: i.entityName,
    vendor: i.vendor ?? undefined,
    description: i.description,
    quantity: i.quantity,
    uom: i.uom,
    cost: i.cost,
    markup: i.markup,
    price: i.price,
    laborHourReg: i.laborHourReg,
    laborHourOver: i.laborHourOver,
    laborHourDouble: i.laborHourDouble,
    lineOrder: i.lineOrder,
    rateScheduleItemId: i.rateScheduleItemId ?? null,
    tierUnits: (i.tierUnits as Record<string, number>) ?? {},
  };
}

function mapPhase(p: any): Phase {
  return { id: p.id, revisionId: p.revisionId, number: p.number, name: p.name, description: p.description, order: p.order, startDate: p.startDate ?? null, endDate: p.endDate ?? null, color: p.color ?? "" };
}

function mapScheduleTask(t: any): ScheduleTask {
  return {
    id: t.id, projectId: t.projectId, revisionId: t.revisionId, phaseId: t.phaseId ?? null,
    name: t.name, description: t.description, taskType: t.taskType as ScheduleTask["taskType"],
    status: t.status as ScheduleTask["status"], startDate: t.startDate ?? null, endDate: t.endDate ?? null,
    duration: t.duration, progress: t.progress, assignee: t.assignee, order: t.order,
    baselineStart: t.baselineStart ?? null, baselineEnd: t.baselineEnd ?? null,
    createdAt: toISO(t.createdAt), updatedAt: toISO(t.updatedAt),
  };
}

function mapScheduleDependency(d: any): ScheduleDependency {
  return { id: d.id, predecessorId: d.predecessorId, successorId: d.successorId, type: d.type as ScheduleDependency["type"], lagDays: d.lagDays };
}

function mapModifier(m: any): Modifier {
  return { id: m.id, revisionId: m.revisionId, name: m.name, type: m.type, appliesTo: m.appliesTo, percentage: m.percentage ?? null, amount: m.amount ?? null, show: m.show as Modifier["show"] };
}

function mapAdditionalLineItem(a: any): AdditionalLineItem {
  return { id: a.id, revisionId: a.revisionId, name: a.name, description: a.description ?? undefined, type: a.type as AdditionalLineItem["type"], amount: a.amount };
}

function mapCondition(c: any): Condition {
  return { id: c.id, revisionId: c.revisionId, type: c.type, value: c.value, order: c.order };
}

function mapRateScheduleTier(t: any): RateScheduleTier {
  return { id: t.id, scheduleId: t.scheduleId, name: t.name, multiplier: t.multiplier, sortOrder: t.sortOrder };
}

function mapRateScheduleItem(i: any): RateScheduleItem {
  return {
    id: i.id, scheduleId: i.scheduleId, catalogItemId: i.catalogItemId ?? null,
    code: i.code, name: i.name, unit: i.unit,
    rates: (i.rates as Record<string, number>) ?? {},
    costRates: (i.costRates as Record<string, number>) ?? {},
    burden: i.burden, perDiem: i.perDiem,
    metadata: (i.metadata as Record<string, unknown>) ?? {},
    sortOrder: i.sortOrder,
  };
}

function mapRateSchedule(s: any): RateSchedule {
  return {
    id: s.id, organizationId: s.organizationId, name: s.name, description: s.description,
    category: s.category, scope: s.scope as RateSchedule["scope"],
    projectId: s.projectId ?? null, revisionId: s.revisionId ?? null,
    sourceScheduleId: s.sourceScheduleId ?? null,
    effectiveDate: s.effectiveDate ?? null, expiryDate: s.expiryDate ?? null,
    defaultMarkup: s.defaultMarkup, autoCalculate: s.autoCalculate,
    metadata: (s.metadata as Record<string, unknown>) ?? {},
    createdAt: toISO(s.createdAt), updatedAt: toISO(s.updatedAt),
  };
}

function mapRateScheduleWithChildren(s: any): RateScheduleWithChildren {
  return {
    ...mapRateSchedule(s),
    tiers: (s.tiers ?? []).map(mapRateScheduleTier),
    items: (s.items ?? []).map(mapRateScheduleItem),
  };
}

function mapActivity(a: any): Activity {
  return { id: a.id, projectId: a.projectId, revisionId: a.revisionId ?? null, type: a.type, data: (a.data as Record<string, unknown>) ?? {}, userId: a.userId ?? null, createdAt: toISO(a.createdAt) };
}

function mapReportSection(s: any): ReportSection {
  return { id: s.id, revisionId: s.revisionId, sectionType: s.sectionType, title: s.title, content: s.content, order: s.order, parentSectionId: s.parentSectionId ?? null };
}

function mapCatalog(c: any): Catalog {
  return {
    id: c.id, name: c.name, kind: c.kind as Catalog["kind"], scope: c.scope as Catalog["scope"],
    projectId: c.projectId ?? null, description: c.description,
    source: c.source ?? "manual", sourceDescription: c.sourceDescription ?? "",
    isTemplate: c.isTemplate ?? false, sourceTemplateId: c.sourceTemplateId ?? null,
    itemCount: c._count?.items ?? undefined,
    createdAt: toISO(c.createdAt), updatedAt: toISO(c.updatedAt),
  };
}

function mapCatalogItem(i: any): CatalogItem {
  return { id: i.id, catalogId: i.catalogId, code: i.code, name: i.name, unit: i.unit, unitCost: i.unitCost, unitPrice: i.unitPrice, metadata: (i.metadata as Record<string, unknown>) ?? {} };
}

function mapAiRun(r: any): { id: string; projectId: string; revisionId: string | null; kind: string; status: string; model: string; promptVersion: string; input: Record<string, unknown>; output: Record<string, unknown>; createdAt: string; updatedAt: string } {
  return { id: r.id, projectId: r.projectId, revisionId: r.revisionId ?? null, kind: r.kind, status: r.status, model: r.model, promptVersion: r.promptVersion, input: (r.input as Record<string, unknown>) ?? {}, output: (r.output as Record<string, unknown>) ?? {}, createdAt: toISO(r.createdAt), updatedAt: toISO(r.updatedAt) };
}

function mapCitation(c: any): { id: string; projectId: string; aiRunId: string | null; sourceDocumentId: string | null; resourceType: string; resourceKey: string; pageStart: number | null; pageEnd: number | null; excerpt: string; confidence: number } {
  return { id: c.id, projectId: c.projectId, aiRunId: c.aiRunId ?? null, sourceDocumentId: c.sourceDocumentId ?? null, resourceType: c.resourceType, resourceKey: c.resourceKey, pageStart: c.pageStart ?? null, pageEnd: c.pageEnd ?? null, excerpt: c.excerpt, confidence: c.confidence };
}

function mapConditionLibrary(c: any): ConditionLibraryEntry {
  return { id: c.id, type: c.type, value: c.value };
}

function mapJob(j: any): Job {
  return { id: j.id, projectId: j.projectId, revisionId: j.revisionId, name: j.name, foreman: j.foreman, projectManager: j.projectManager, startDate: j.startDate ?? null, shipDate: j.shipDate ?? null, poNumber: j.poNumber, poIssuer: j.poIssuer, status: j.status as Job["status"], createdAt: toISO(j.createdAt) };
}

function mapFileNode(n: any): FileNode {
  return { id: n.id, projectId: n.projectId, parentId: n.parentId ?? null, name: n.name, type: n.type as FileNode["type"], scope: n.scope ?? "project", fileType: n.fileType ?? undefined, size: n.size ?? undefined, documentId: n.documentId ?? undefined, storagePath: n.storagePath ?? undefined, metadata: (n.metadata as Record<string, unknown>) ?? {}, createdAt: toISO(n.createdAt), updatedAt: toISO(n.updatedAt), createdBy: n.createdBy ?? undefined };
}

function mapTakeoffAnnotation(a: any) {
  return {
    id: a.id,
    projectId: a.projectId,
    documentId: a.documentId,
    pageNumber: a.pageNumber,
    annotationType: a.annotationType,
    label: a.label ?? "",
    color: a.color ?? "#3b82f6",
    lineThickness: a.lineThickness ?? 4,
    visible: a.visible ?? true,
    groupName: a.groupName ?? "",
    points: (a.points as Array<{ x: number; y: number }>) ?? [],
    measurement: (a.measurement as Record<string, unknown>) ?? {},
    calibration: a.calibration ?? null,
    metadata: (a.metadata as Record<string, unknown>) ?? {},
    createdBy: a.createdBy ?? undefined,
    createdAt: toISO(a.createdAt),
    updatedAt: toISO(a.updatedAt),
  };
}

function mapPlugin(p: any): Plugin {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    icon: p.icon ?? undefined,
    category: p.category as Plugin["category"],
    description: p.description,
    llmDescription: p.llmDescription ?? undefined,
    version: p.version,
    author: p.author ?? undefined,
    enabled: p.enabled,
    config: (p.config as Record<string, unknown>) ?? {},
    configSchema: p.configSchema as Plugin["configSchema"] ?? undefined,
    toolDefinitions: (p.toolDefinitions as Plugin["toolDefinitions"]) ?? [],
    defaultOutputType: p.defaultOutputType as Plugin["defaultOutputType"] ?? undefined,
    supportedCategories: p.supportedCategories ?? [],
    tags: p.tags ?? [],
    documentation: p.documentation ?? undefined,
    createdAt: toISO(p.createdAt),
    updatedAt: toISO(p.updatedAt),
  };
}

function mapPluginExecution(e: any): PluginExecution {
  return {
    id: e.id,
    pluginId: e.pluginId,
    toolId: e.toolId,
    projectId: e.projectId,
    revisionId: e.revisionId,
    worksheetId: e.worksheetId ?? undefined,
    input: (e.input as Record<string, unknown>) ?? {},
    formState: (e.formState as Record<string, unknown>) ?? undefined,
    output: (e.output as PluginOutput) ?? { type: "summary" },
    appliedLineItemIds: e.appliedLineItemIds ?? [],
    status: e.status as PluginExecution["status"],
    error: e.error ?? undefined,
    executedBy: e.executedBy as PluginExecution["executedBy"] ?? undefined,
    agentSessionId: e.agentSessionId ?? undefined,
    createdAt: toISO(e.createdAt),
  };
}

function mapUser(u: any): User {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as User["role"],
    active: u.active,
    passwordHash: u.passwordHash,
    lastLoginAt: toISOString(u.lastLoginAt),
    createdAt: toISO(u.createdAt),
    updatedAt: toISO(u.updatedAt),
  };
}

function mapKnowledgeBook(b: any): KnowledgeBook {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    category: b.category as KnowledgeBook["category"],
    scope: b.scope as KnowledgeBook["scope"],
    projectId: b.projectId ?? null,
    pageCount: b.pageCount,
    chunkCount: b.chunkCount,
    status: b.status as KnowledgeBook["status"],
    sourceFileName: b.sourceFileName,
    sourceFileSize: b.sourceFileSize,
    storagePath: b.storagePath ?? null,
    metadata: (b.metadata as Record<string, unknown>) ?? {},
    createdAt: toISO(b.createdAt),
    updatedAt: toISO(b.updatedAt),
  };
}

function mapKnowledgeChunk(c: any): KnowledgeChunk {
  return {
    id: c.id,
    bookId: c.bookId,
    pageNumber: c.pageNumber ?? null,
    sectionTitle: c.sectionTitle,
    text: c.text,
    tokenCount: c.tokenCount,
    order: c.order,
    metadata: (c.metadata as Record<string, unknown>) ?? {},
  };
}

function mapDataset(d: any): Dataset {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    category: d.category as Dataset["category"],
    scope: d.scope as Dataset["scope"],
    projectId: d.projectId ?? null,
    columns: (d.columns as Dataset["columns"]) ?? [],
    rowCount: d.rowCount,
    source: d.source as Dataset["source"],
    sourceDescription: d.sourceDescription,
    isTemplate: d.isTemplate ?? false,
    sourceTemplateId: d.sourceTemplateId ?? null,
    createdAt: toISO(d.createdAt),
    updatedAt: toISO(d.updatedAt),
  };
}

function mapDatasetRow(r: any): DatasetRow {
  return {
    id: r.id,
    datasetId: r.datasetId,
    data: (r.data as Record<string, unknown>) ?? {},
    order: r.order,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    createdAt: toISO(r.createdAt),
    updatedAt: toISO(r.updatedAt),
  };
}

function mapEntityCategory(e: any): EntityCategory {
  return {
    id: e.id,
    name: e.name,
    entityType: e.entityType,
    shortform: e.shortform,
    defaultUom: e.defaultUom,
    validUoms: e.validUoms ?? [],
    editableFields: (e.editableFields as any) ?? {},
    laborHourLabels: (e.laborHourLabels as any) ?? {},
    calculationType: e.calculationType as EntityCategory["calculationType"],
    calcFormula: e.calcFormula ?? "",
    color: e.color ?? "#6b7280",
    order: e.order ?? 0,
    isBuiltIn: e.isBuiltIn ?? false,
    enabled: e.enabled ?? true,
  };
}

function mapStoredPackage(p: any): StoredPackageRecord {
  return {
    id: p.id,
    projectId: p.projectId,
    packageName: p.packageName,
    originalFileName: p.originalFileName,
    sourceKind: p.sourceKind as PackageSourceKind,
    storagePath: p.storagePath,
    reportPath: p.reportPath ?? null,
    chunksPath: p.chunksPath ?? null,
    checksum: p.checksum,
    totalBytes: p.totalBytes,
    status: p.status as StoredPackageRecord["status"],
    documentCount: p.documentCount,
    chunkCount: p.chunkCount,
    documentIds: p.documentIds ?? [],
    unknownFiles: p.unknownFiles ?? [],
    uploadedAt: toISO(p.uploadedAt),
    ingestedAt: toISOString(p.ingestedAt),
    updatedAt: toISO(p.updatedAt),
    error: p.error ?? null,
  };
}

function mapCustomer(c: any): Customer {
  return {
    id: c.id,
    organizationId: c.organizationId,
    name: c.name,
    shortName: c.shortName ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    website: c.website ?? "",
    addressStreet: c.addressStreet ?? "",
    addressCity: c.addressCity ?? "",
    addressProvince: c.addressProvince ?? "",
    addressPostalCode: c.addressPostalCode ?? "",
    addressCountry: c.addressCountry ?? "",
    notes: c.notes ?? "",
    active: c.active ?? true,
    createdAt: toISO(c.createdAt),
    updatedAt: toISO(c.updatedAt),
  };
}

function mapCustomerContact(c: any): CustomerContact {
  return {
    id: c.id,
    customerId: c.customerId,
    name: c.name,
    title: c.title ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    isPrimary: c.isPrimary ?? false,
    active: c.active ?? true,
    createdAt: toISO(c.createdAt),
    updatedAt: toISO(c.updatedAt),
  };
}

function mapDepartment(d: any): Department {
  return {
    id: d.id,
    organizationId: d.organizationId,
    name: d.name,
    code: d.code ?? "",
    description: d.description ?? "",
    active: d.active ?? true,
    createdAt: toISO(d.createdAt),
    updatedAt: toISO(d.updatedAt),
  };
}

function mapIngestionJob(j: any): IngestionJobRecord {
  return {
    id: j.id,
    projectId: j.projectId,
    packageId: j.packageId ?? null,
    kind: j.kind as IngestionJobRecord["kind"],
    status: j.status as IngestionJobRecord["status"],
    progress: j.progress,
    input: (j.input as Record<string, unknown>) ?? {},
    output: (j.output as Record<string, unknown>) ?? null,
    error: j.error ?? null,
    createdAt: toISO(j.createdAt),
    updatedAt: toISO(j.updatedAt),
    startedAt: toISOString(j.startedAt),
    completedAt: toISOString(j.completedAt),
    storagePath: j.storagePath ?? "",
  };
}

function mapWorkspaceState(ws: any): WorkspaceStateRecord {
  return {
    projectId: ws.projectId,
    state: (ws.state as Record<string, unknown>) ?? {},
    updatedAt: toISO(ws.updatedAt),
    storagePath: relativeWorkspacePath(ws.projectId),
  };
}

// ── Main Store Class ──────────────────────────────────────────────────────────

export class PrismaApiStore {
  private importCache = new Map<string, { headers: string[]; rows: string[][] }>();

  constructor(
    private readonly db: PrismaClient,
    private readonly organizationId: string,
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

  // ── Build BidwrightStore snapshot for domain functions ──────────────────

  private async buildStoreSnapshot(projectId: string): Promise<BidwrightStore> {
    const project = await this.db.project.findFirst({
      where: { id: projectId, organizationId: this.organizationId },
    });
    if (!project) throw new Error(`Project ${projectId} not found`);

    const quotes = await this.db.quote.findMany({ where: { projectId } });
    const quoteIds = quotes.map((q) => q.id);
    const revisions = await this.db.quoteRevision.findMany({ where: { quoteId: { in: quoteIds } } });
    const revisionIds = revisions.map((r) => r.id);
    const worksheets = await this.db.worksheet.findMany({ where: { revisionId: { in: revisionIds } } });
    const worksheetIds = worksheets.map((w) => w.id);
    const worksheetItems = await this.db.worksheetItem.findMany({ where: { worksheetId: { in: worksheetIds } } });
    const phases = await this.db.phase.findMany({ where: { revisionId: { in: revisionIds } } });
    const modifiers = await this.db.modifier.findMany({ where: { revisionId: { in: revisionIds } } });
    const additionalLineItems = await this.db.additionalLineItem.findMany({ where: { revisionId: { in: revisionIds } } });
    const conditions = await this.db.condition.findMany({ where: { revisionId: { in: revisionIds } } });
    const reportSections = await this.db.reportSection.findMany({ where: { revisionId: { in: revisionIds } } });
    const sourceDocuments = await this.db.sourceDocument.findMany({ where: { projectId } });
    const aiRuns = await this.db.aiRun.findMany({ where: { projectId } });
    const citations = await this.db.citation.findMany({ where: { projectId } });
    const activities = await this.db.activity.findMany({ where: { projectId } });
    const jobs = await this.db.job.findMany({ where: { projectId } });
    const fileNodes = await this.db.fileNode.findMany({ where: { projectId } });
    const pluginExecutions = await this.db.pluginExecution.findMany({ where: { projectId } });
    const scheduleTasks = await this.db.scheduleTask.findMany({ where: { projectId } });
    const scheduleTaskIds = scheduleTasks.map((t) => t.id);
    const scheduleDependencies = scheduleTaskIds.length > 0
      ? await this.db.scheduleDependency.findMany({ where: { predecessorId: { in: scheduleTaskIds } } })
      : [];

    // Global entities for the org
    const catalogs = await this.db.catalog.findMany({ where: { organizationId: this.organizationId } });
    const catalogIds = catalogs.map((c) => c.id);
    const catalogItems = await this.db.catalogItem.findMany({ where: { catalogId: { in: catalogIds } } });
    const conditionLibrary = await this.db.conditionLibraryEntry.findMany({ where: { organizationId: this.organizationId } });
    const plugins = await this.db.plugin.findMany({ where: { organizationId: this.organizationId } });
    const users = await this.db.user.findMany({ where: { organizationId: this.organizationId } });
    const knowledgeBooks = await this.db.knowledgeBook.findMany({ where: { organizationId: this.organizationId } });
    const knowledgeBookIds = knowledgeBooks.map((b) => b.id);
    const knowledgeChunks = await this.db.knowledgeChunk.findMany({ where: { bookId: { in: knowledgeBookIds } } });
    const datasets = await this.db.dataset.findMany({ where: { organizationId: this.organizationId } });
    const datasetIds = datasets.map((d) => d.id);
    const datasetRows = await this.db.datasetRow.findMany({ where: { datasetId: { in: datasetIds } } });
    const entityCategories = await this.db.entityCategory.findMany({ where: { organizationId: this.organizationId } });

    // Rate schedules: both revision-scoped and org-level
    const rateSchedules = await this.db.rateSchedule.findMany({
      where: { OR: [{ revisionId: { in: revisionIds } }, { organizationId: this.organizationId, scope: "global" }] },
      include: { tiers: true, items: true },
    });

    return {
      projects: [mapProject(project)],
      sourceDocuments: sourceDocuments.map(mapSourceDocument),
      quotes: quotes.map(mapQuote),
      revisions: revisions.map(mapRevision),
      worksheets: worksheets.map(mapWorksheet),
      worksheetItems: worksheetItems.map(mapWorksheetItem),
      phases: phases.map(mapPhase),
      modifiers: modifiers.map(mapModifier),
      additionalLineItems: additionalLineItems.map(mapAdditionalLineItem),
      conditions: conditions.map(mapCondition),
      catalogs: catalogs.map(mapCatalog),
      catalogItems: catalogItems.map(mapCatalogItem),
      aiRuns: aiRuns.map(mapAiRun) as any,
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
      knowledgeBooks: knowledgeBooks.map(mapKnowledgeBook),
      knowledgeChunks: knowledgeChunks.map(mapKnowledgeChunk),
      datasets: datasets.map(mapDataset),
      datasetRows: datasetRows.map(mapDatasetRow),
      entityCategories: entityCategories.map(mapEntityCategory) as any,
      scheduleTasks: scheduleTasks.map(mapScheduleTask),
      scheduleDependencies: scheduleDependencies.map(mapScheduleDependency),
      rateSchedules: rateSchedules.map(mapRateSchedule),
      rateScheduleTiers: rateSchedules.flatMap((s) => (s.tiers ?? []).map(mapRateScheduleTier)),
      rateScheduleItems: rateSchedules.flatMap((s) => (s.items ?? []).map(mapRateScheduleItem)),
    };
  }

  // ── Private: sync estimate totals back to the revision ──────────────────

  private async syncProjectEstimate(projectId: string, timestamp = isoNow()) {
    const store = await this.buildStoreSnapshot(projectId);
    const totals = summarizeProjectTotals(store, projectId);

    const quote = store.quotes.find((q) => q.projectId === projectId);
    const revision = quote ? store.revisions.find((r) => r.id === quote.currentRevisionId) : undefined;

    if (revision && totals) {
      await this.db.quoteRevision.update({
        where: { id: revision.id },
        data: {
          subtotal: totals.subtotal,
          cost: totals.cost,
          estimatedProfit: totals.estimatedProfit,
          estimatedMargin: totals.estimatedMargin,
          calculatedTotal: totals.calculatedTotal,
          totalHours: totals.totalHours,
        },
      });
    }

    await this.db.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date(timestamp) },
    });

    if (quote) {
      await this.db.quote.update({
        where: { id: quote.id },
        data: { updatedAt: new Date(timestamp) },
      });
    }

    return totals;
  }

  // ── Private: find current revision ──────────────────────────────────────

  private async findCurrentRevision(projectId: string) {
    const quote = await this.db.quote.findFirst({ where: { projectId } });
    if (!quote) return { quote: null, revision: null };
    const revision = await this.db.quoteRevision.findFirst({ where: { id: quote.currentRevisionId } });
    return { quote, revision };
  }

  // ── Private: push activity ──────────────────────────────────────────────

  private async pushActivity(projectId: string, revisionId: string | null, type: string, data: Record<string, unknown>) {
    await this.db.activity.create({
      data: {
        id: createId("activity"),
        projectId,
        revisionId,
        type,
        data: data as any,
        createdAt: new Date(),
      },
    });
  }

  // ── Private: save file artifacts for package ────────────────────────────

  private async saveArtifactsForPackage(packageId: string, report: IngestionReport, packageChecksum: string) {
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

    await this.db.quoteRevision.create({
      data: {
        id: revisionId,
        quoteId,
        revisionNumber: 0,
        title: "Initial Estimate",
        description: "Seeded estimate shell for the uploaded customer package.",
        notes: "Populate worksheets, phases, modifiers, and conditions as the estimate matures.",
        breakoutStyle: "phase_detail",
        phaseWorksheetEnabled: true,
        useCalculatedTotal: true,
        type: "Firm",
        status: "Open",
        defaultMarkup: 0.2,
        necaDifficulty: "Normal",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });

    await this.db.worksheet.create({
      data: {
        id: worksheetId,
        revisionId,
        name: "Estimate",
        order: 1,
      },
    });

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
    const [packages, jobs, workspaceStates, quotes, revisions] = await Promise.all([
      this.db.storedPackage.findMany({ where: { projectId: { in: projectIds } } }),
      this.db.ingestionJob.findMany({ where: { projectId: { in: projectIds } } }),
      this.db.workspaceState.findMany({ where: { projectId: { in: projectIds } } }),
      this.db.quote.findMany({ where: { projectId: { in: projectIds } } }),
      this.db.quoteRevision.findMany({
        where: { quote: { projectId: { in: projectIds } } },
      }),
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
    const [packages, knowledgeBooks] = await Promise.all([
      this.db.storedPackage.findMany({ where: { projectId }, select: { id: true } }),
      this.db.knowledgeBook.findMany({ where: { projectId }, select: { id: true } }),
    ]);

    // Prisma cascade deletes handle child entities
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
    await this.requireProject(projectId);
    const store = await this.buildStoreSnapshot(projectId);
    return summarizeProjectTotals(store, projectId);
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
    laborHourLabels?: Record<string, string>;
    calculationType?: string;
    calcFormula?: string;
    color?: string;
  }): Promise<EntityCategory> {
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
        editableFields: (input.editableFields ?? { quantity: true, cost: true, markup: true, price: true, laborHourReg: false, laborHourOver: false, laborHourDouble: false }) as any,
        laborHourLabels: (input.laborHourLabels ?? { reg: "Reg Hrs", over: "OT Hrs", double: "DT Hrs" }) as any,
        calculationType: input.calculationType ?? "manual",
        calcFormula: input.calcFormula ?? "",
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
    if (patch.laborHourLabels !== undefined) data.laborHourLabels = patch.laborHourLabels as any;
    if (patch.calculationType !== undefined) data.calculationType = patch.calculationType;
    if (patch.calcFormula !== undefined) data.calcFormula = patch.calcFormula;
    if (patch.color !== undefined) data.color = patch.color;
    if (patch.order !== undefined) data.order = patch.order;
    if (patch.enabled !== undefined) data.enabled = patch.enabled;

    const updated = await this.db.entityCategory.update({ where: { id }, data });
    return mapEntityCategory(updated);
  }

  async deleteEntityCategory(id: string): Promise<{ deleted: boolean }> {
    const existing = await this.db.entityCategory.findFirst({
      where: { id, organizationId: this.organizationId },
    });
    if (!existing) throw new Error(`Entity category ${id} not found`);
    if (existing.isBuiltIn) throw new Error("Cannot delete built-in entity category");

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

    const updated = await this.db.quoteRevision.update({
      where: { id: revisionId },
      data,
    });

    await this.pushActivity(projectId, revisionId, "revision_updated", { fields: Object.keys(patch) });
    await this.syncProjectEstimate(projectId);

    return mapRevision(updated);
  }

  // ── Worksheet Item CRUD ────────────────────────────────────────────────

  async createWorksheetItem(projectId: string, worksheetId: string, input: CreateWorksheetItemInput) {
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
    const lineOrder = input.lineOrder ?? ((maxOrder._max.lineOrder ?? 0) + 1);

    const item: WorksheetItem = {
      id: createId("li"),
      worksheetId,
      phaseId: input.phaseId ?? null,
      category: input.category,
      entityType: input.entityType,
      entityName: input.entityName,
      vendor: input.vendor ?? undefined,
      description: input.description,
      quantity: input.quantity,
      uom: input.uom,
      cost: input.cost,
      markup: input.markup,
      price: input.price,
      laborHourReg: input.laborHourReg,
      laborHourOver: input.laborHourOver,
      laborHourDouble: input.laborHourDouble,
      lineOrder,
      rateScheduleItemId: input.rateScheduleItemId ?? null,
      tierUnits: input.tierUnits ?? {},
    };

    const revisionSchedules = await this.db.rateSchedule.findMany({
      where: { revisionId: revision.id },
      include: { tiers: true, items: true },
    });
    const rateScheduleCtx = revisionSchedules.map((s) => ({
      items: (s.items ?? []).map((i) => ({ id: i.id, name: i.name, code: i.code, rates: (i.rates as Record<string, number>) ?? {}, costRates: (i.costRates as Record<string, number>) ?? {}, burden: i.burden, perDiem: i.perDiem })),
    }));
    const calculated = calculateLineItem(item, mapRevision(revision), rateScheduleCtx);
    Object.assign(item, calculated);

    const created = await this.db.worksheetItem.create({
      data: {
        id: item.id,
        worksheetId: item.worksheetId,
        phaseId: item.phaseId,
        category: item.category,
        entityType: item.entityType,
        entityName: item.entityName,
        vendor: item.vendor,
        description: item.description,
        quantity: item.quantity,
        uom: item.uom,
        cost: item.cost,
        markup: item.markup,
        price: item.price,
        laborHourReg: item.laborHourReg,
        laborHourOver: item.laborHourOver,
        laborHourDouble: item.laborHourDouble,
        lineOrder: item.lineOrder,
        rateScheduleItemId: item.rateScheduleItemId ?? null,
        tierUnits: item.tierUnits ?? {},
      },
    });

    await this.pushActivity(projectId, revision.id, "item_created", { itemId: item.id, entityName: item.entityName, category: item.category });
    await this.syncProjectEstimate(projectId);

    return mapWorksheetItem(created);
  }

  async createWorksheet(projectId: string, input: CreateWorksheetInput) {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) {
      throw new Error(`Project ${projectId} not found`);
    }

    const maxOrder = await this.db.worksheet.aggregate({
      where: { revisionId: revision.id },
      _max: { order: true },
    });
    const order = (maxOrder._max.order ?? 0) + 1;

    const worksheet = await this.db.worksheet.create({
      data: {
        id: createId("worksheet"),
        revisionId: revision.id,
        name: input.name.trim() || `Worksheet ${order}`,
        order,
      },
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

    const updated = await this.db.worksheet.update({ where: { id: worksheetId }, data });
    await this.syncProjectEstimate(projectId);
    return mapWorksheet(updated);
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
    await this.db.worksheetItem.deleteMany({ where: { worksheetId } });
    await this.db.worksheet.delete({ where: { id: worksheetId } });
    await this.syncProjectEstimate(projectId);

    return mapWorksheet(worksheet);
  }

  async updateWorksheetItem(projectId: string, itemId: string, patch: WorksheetItemPatchInput) {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    const item = await this.db.worksheetItem.findFirst({ where: { id: itemId } });
    if (!item) throw new Error(`Worksheet item ${itemId} not found for project ${projectId}`);
    const worksheet = await this.db.worksheet.findFirst({ where: { id: item.worksheetId } });

    if (!revision || !worksheet || worksheet.revisionId !== revision.id) {
      throw new Error(`Worksheet item ${itemId} not found for project ${projectId}`);
    }

    // Apply patch to a domain item for recalculation
    const domainItem = mapWorksheetItem(item);
    Object.assign(domainItem, patch);
    if (patch.vendor === null) {
      domainItem.vendor = undefined;
    }

    const revisionSchedules = await this.db.rateSchedule.findMany({
      where: { revisionId: revision.id },
      include: { tiers: true, items: true },
    });
    const rateScheduleCtx = revisionSchedules.map((s) => ({
      items: (s.items ?? []).map((i) => ({ id: i.id, name: i.name, code: i.code, rates: (i.rates as Record<string, number>) ?? {}, costRates: (i.costRates as Record<string, number>) ?? {}, burden: i.burden, perDiem: i.perDiem })),
    }));
    const calculated = calculateLineItem(domainItem, mapRevision(revision), rateScheduleCtx);
    Object.assign(domainItem, calculated);

    const updated = await this.db.worksheetItem.update({
      where: { id: itemId },
      data: {
        phaseId: domainItem.phaseId,
        category: domainItem.category,
        entityType: domainItem.entityType,
        entityName: domainItem.entityName,
        vendor: domainItem.vendor ?? null,
        description: domainItem.description,
        quantity: domainItem.quantity,
        uom: domainItem.uom,
        cost: domainItem.cost,
        markup: domainItem.markup,
        price: domainItem.price,
        laborHourReg: domainItem.laborHourReg,
        laborHourOver: domainItem.laborHourOver,
        laborHourDouble: domainItem.laborHourDouble,
        lineOrder: domainItem.lineOrder,
        rateScheduleItemId: domainItem.rateScheduleItemId ?? null,
        tierUnits: domainItem.tierUnits ?? {},
      },
    });

    await this.pushActivity(projectId, revision.id, "item_updated", { itemId, entityName: domainItem.entityName, patch: Object.keys(patch) });
    await this.syncProjectEstimate(projectId);

    return mapWorksheetItem(updated);
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
    const rateScheduleCtx = revisionSchedules.map((s) => ({
      items: (s.items ?? []).map((i) => ({ id: i.id, name: i.name, code: i.code, rates: (i.rates as Record<string, number>) ?? {}, costRates: (i.costRates as Record<string, number>) ?? {}, burden: i.burden, perDiem: i.perDiem })),
    }));
    const mappedRev = mapRevision(revision);

    const created: WorksheetItem[] = [];

    for (let idx = 0; idx < items.length; idx++) {
      const raw = items[idx];
      const item: WorksheetItem = {
        id: createId("li"),
        worksheetId,
        phaseId: raw.phaseId ? String(raw.phaseId) : null,
        category: String(raw.category ?? "Material"),
        entityType: String(raw.entityType ?? "Material"),
        entityName: String(raw.entityName ?? raw.name ?? "Imported Item"),
        vendor: raw.vendor ? String(raw.vendor) : undefined,
        description: String(raw.description ?? ""),
        quantity: Number(raw.quantity) || 1,
        uom: String(raw.uom ?? "EA"),
        cost: Number(raw.cost) || 0,
        markup: Number(raw.markup) || 0.2,
        price: Number(raw.price) || 0,
        laborHourReg: Number(raw.laborHourReg ?? raw.LabourHourReg) || 0,
        laborHourOver: Number(raw.laborHourOver ?? raw.LabourHourOver) || 0,
        laborHourDouble: Number(raw.laborHourDouble ?? raw.LabourHourDouble) || 0,
        lineOrder: baseOrder + idx + 1,
      };

      const calculated = calculateLineItem(item, mappedRev, rateScheduleCtx);
      Object.assign(item, calculated);

      await this.db.worksheetItem.create({
        data: {
          id: item.id,
          worksheetId: item.worksheetId,
          phaseId: item.phaseId,
          category: item.category,
          entityType: item.entityType,
          entityName: item.entityName,
          vendor: item.vendor,
          description: item.description,
          quantity: item.quantity,
          uom: item.uom,
          cost: item.cost,
          markup: item.markup,
          price: item.price,
          laborHourReg: item.laborHourReg,
          laborHourOver: item.laborHourOver,
          laborHourDouble: item.laborHourDouble,
          lineOrder: item.lineOrder,
        },
      });

      created.push(item);
      await this.pushActivity(projectId, revision.id, "item_created", { itemId: item.id, entityName: item.entityName, category: item.category });
    }

    await this.syncProjectEstimate(projectId);
    return created;
  }

  async deleteWorksheetItem(projectId: string, itemId: string) {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    const item = await this.db.worksheetItem.findFirst({ where: { id: itemId } });
    if (!item) throw new Error(`Worksheet item ${itemId} not found for project ${projectId}`);
    const worksheet = await this.db.worksheet.findFirst({ where: { id: item.worksheetId } });

    if (!revision || !worksheet || worksheet.revisionId !== revision.id) {
      throw new Error(`Worksheet item ${itemId} not found for project ${projectId}`);
    }

    await this.db.worksheetItem.delete({ where: { id: itemId } });
    await this.pushActivity(projectId, revision.id, "item_deleted", { itemId, entityName: item.entityName });
    await this.syncProjectEstimate(projectId);

    return mapWorksheetItem(item);
  }

  // ── Create Project ─────────────────────────────────────────────────────

  async createProject(input: CreateProjectInput) {
    const now = new Date();
    const nowISO = now.toISOString();
    const projectId = createId("project");
    const packageName = input.packageName ?? input.name;

    return await this.db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          id: projectId,
          organizationId: this.organizationId,
          name: input.name,
          clientName: input.clientName,
          location: input.location,
          packageName,
          packageUploadedAt: nowISO,
          ingestionStatus: "queued",
          scope: input.scope ?? "",
          summary: input.summary ?? defaultProjectSummary(packageName, input.clientName),
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
          status: "draft",
          currentRevisionId: revisionId,
          customerExistingNew: "New",
          createdAt: now,
          updatedAt: now,
        },
      });

      await tx.quoteRevision.create({
        data: {
          id: revisionId,
          quoteId,
          revisionNumber: 0,
          title: "Initial Estimate",
          description: "Seeded estimate shell for the uploaded customer package.",
          notes: "Populate worksheets, phases, modifiers, and conditions as the estimate matures.",
          breakoutStyle: "phase_detail",
          phaseWorksheetEnabled: true,
          useCalculatedTotal: true,
          type: "Firm",
          status: "Open",
          defaultMarkup: 0.2,
          necaDifficulty: "Normal",
          createdAt: now,
          updatedAt: now,
        },
      });

      await tx.worksheet.create({
        data: {
          id: worksheetId,
          revisionId,
          name: "Estimate",
          order: 1,
        },
      });

      const wsState = {
        activeTab: "overview",
        selectedQuoteId: quoteId,
        selectedRevisionId: revisionId,
        selectedWorksheetId: worksheetId,
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

      const quote = await tx.quote.findFirst({ where: { id: quoteId } });
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
  }

  // ── Package Registration ───────────────────────────────────────────────

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
      const report = await ingestCustomerPackage({
        packageId,
        packageName: pkg.packageName,
        sourceKind: pkg.sourceKind as PackageSourceKind,
        zipInput: zipPath,
      });

      await this.saveArtifactsForPackage(packageId, report, checksum);

      const timestamp = new Date();
      const timestampISO = timestamp.toISOString();

      const sourceDocuments: SourceDocument[] = report.documents.map((document) => ({
        id: document.id,
        projectId: project.id,
        fileName: sanitizeFileName(path.basename(document.sourcePath || document.title)),
        fileType: path.extname(document.sourcePath || document.title).replace(/^\./, "") || "txt",
        documentType: documentTypeFromIngestion(document.kind),
        pageCount: inferPageCount(document, report.chunks),
        checksum: checksumForDocument(checksum, document),
        storagePath: relativePackageDocumentArtifact(packageId, document.id, document.title),
        extractedText: document.text,
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
          await tx.sourceDocument.create({
            data: {
              id: doc.id,
              projectId: doc.projectId,
              fileName: doc.fileName,
              fileType: doc.fileType,
              documentType: doc.documentType,
              pageCount: doc.pageCount,
              checksum: doc.checksum,
              storagePath: doc.storagePath,
              extractedText: doc.extractedText,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
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
          },
        });

        // Update job
        await tx.ingestionJob.update({
          where: { id: ingestionJobId },
          data: {
            status: "complete",
            progress: 1,
            output: {
              packageId,
              reportPath: relativePackageReportPath(packageId),
              chunksPath: relativePackageChunksPath(packageId),
              unknownFiles: report.unknownFiles,
              documentCount: sourceDocuments.length,
              chunkCount: report.chunks.length,
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
        const { knowledgeService } = await import("../services/knowledge-service.js");
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
        },
      }).catch(() => {});

      await this.db.ingestionJob.update({
        where: { id: ingestionJobId },
        data: {
          status: "failed",
          progress: 1,
          error: message,
          updatedAt: failTime,
          completedAt: failTime,
        },
      }).catch(() => {});

      throw error;
    }
  }

  // ── Phase CRUD ─────────────────────────────────────────────────────────

  async createPhase(projectId: string, revisionId: string, input: CreatePhaseInput) {
    await this.requireProject(projectId);
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
    if (!revision) throw new Error(`Revision ${revisionId} not found for project ${projectId}`);

    const maxOrder = await this.db.phase.aggregate({
      where: { revisionId },
      _max: { order: true },
    });
    const order = (maxOrder._max.order ?? 0) + 1;

    const phase = await this.db.phase.create({
      data: {
        id: createId("phase"),
        revisionId,
        number: input.number ?? String(order),
        name: input.name ?? `Phase ${order}`,
        description: input.description ?? "",
        order,
      },
    });

    await this.pushActivity(projectId, revisionId, "phase_created", { phaseId: phase.id, name: phase.name });
    await this.syncProjectEstimate(projectId);
    return mapPhase(phase);
  }

  async updatePhase(projectId: string, phaseId: string, patch: PhasePatchInput) {
    await this.requireProject(projectId);
    const phase = await this.db.phase.findFirst({ where: { id: phaseId } });
    if (!phase) throw new Error(`Phase ${phaseId} not found for project ${projectId}`);

    const data: any = {};
    if (typeof patch.number === "string") data.number = patch.number;
    if (typeof patch.name === "string") data.name = patch.name;
    if (typeof patch.description === "string") data.description = patch.description;
    if (typeof patch.order === "number") data.order = patch.order;
    if (patch.startDate !== undefined) data.startDate = patch.startDate;
    if (patch.endDate !== undefined) data.endDate = patch.endDate;
    if (typeof patch.color === "string") data.color = patch.color;

    const updated = await this.db.phase.update({ where: { id: phaseId }, data });
    await this.syncProjectEstimate(projectId);
    return mapPhase(updated);
  }

  async deletePhase(projectId: string, phaseId: string) {
    await this.requireProject(projectId);
    const phase = await this.db.phase.findFirst({ where: { id: phaseId } });
    if (!phase) throw new Error(`Phase ${phaseId} not found for project ${projectId}`);

    // Unset phase on items
    await this.db.worksheetItem.updateMany({
      where: { phaseId },
      data: { phaseId: null },
    });

    await this.db.phase.delete({ where: { id: phaseId } });
    await this.pushActivity(projectId, phase.revisionId, "phase_deleted", { phaseId, name: phase.name });
    await this.syncProjectEstimate(projectId);
    return mapPhase(phase);
  }

  // ── Schedule Task CRUD ──────────────────────────────────────────────────

  async listScheduleTasks(projectId: string) {
    const { revision } = await this.findCurrentRevision(projectId);
    const tasks = await this.db.scheduleTask.findMany({
      where: { projectId, revisionId: revision.id },
      orderBy: { order: "asc" },
    });
    return tasks.map(mapScheduleTask);
  }

  async createScheduleTask(projectId: string, revisionId: string, input: CreateScheduleTaskInput) {
    await this.requireProject(projectId);
    const maxOrder = await this.db.scheduleTask.aggregate({
      where: { projectId, revisionId },
      _max: { order: true },
    });
    const order = input.order ?? (maxOrder._max.order ?? 0) + 1;

    const task = await this.db.scheduleTask.create({
      data: {
        id: createId("schtask"),
        projectId,
        revisionId,
        phaseId: input.phaseId ?? null,
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
      },
    });
    await this.pushActivity(projectId, revisionId, "schedule_task_created", { taskId: task.id, name: task.name });
    return mapScheduleTask(task);
  }

  async updateScheduleTask(projectId: string, taskId: string, patch: ScheduleTaskPatchInput) {
    await this.requireProject(projectId);
    const task = await this.db.scheduleTask.findFirst({ where: { id: taskId, projectId } });
    if (!task) throw new Error(`Schedule task ${taskId} not found`);

    const data: any = {};
    if (patch.phaseId !== undefined) data.phaseId = patch.phaseId;
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

    const updated = await this.db.scheduleTask.update({ where: { id: taskId }, data });
    return mapScheduleTask(updated);
  }

  async batchUpdateScheduleTasks(projectId: string, updates: Array<{ id: string } & ScheduleTaskPatchInput>) {
    await this.requireProject(projectId);
    const results: ScheduleTask[] = [];
    for (const upd of updates) {
      const { id, ...patch } = upd;
      const result = await this.updateScheduleTask(projectId, id, patch);
      results.push(result);
    }
    return results;
  }

  async deleteScheduleTask(projectId: string, taskId: string) {
    await this.requireProject(projectId);
    const task = await this.db.scheduleTask.findFirst({ where: { id: taskId, projectId } });
    if (!task) throw new Error(`Schedule task ${taskId} not found`);

    await this.db.scheduleDependency.deleteMany({
      where: { OR: [{ predecessorId: taskId }, { successorId: taskId }] },
    });
    await this.db.scheduleTask.delete({ where: { id: taskId } });
    await this.pushActivity(projectId, task.revisionId, "schedule_task_deleted", { taskId, name: task.name });
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

  // ── Schedule Baseline ──────────────────────────────────────────────────

  async saveBaseline(projectId: string) {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    const tasks = await this.db.scheduleTask.findMany({ where: { projectId, revisionId: revision.id } });
    for (const t of tasks) {
      await this.db.scheduleTask.update({
        where: { id: t.id },
        data: { baselineStart: t.startDate, baselineEnd: t.endDate },
      });
    }
  }

  async clearBaseline(projectId: string) {
    await this.requireProject(projectId);
    const { revision } = await this.findCurrentRevision(projectId);
    await this.db.scheduleTask.updateMany({
      where: { projectId, revisionId: revision.id },
      data: { baselineStart: null, baselineEnd: null },
    });
  }

  // ── Modifier CRUD ──────────────────────────────────────────────────────

  async listModifiers(projectId: string) {
    const { revision } = await this.findCurrentRevision(projectId);
    if (!revision) return [];
    const modifiers = await this.db.modifier.findMany({ where: { revisionId: revision.id } });
    return modifiers.map(mapModifier);
  }

  async createModifier(projectId: string, revisionId: string, input: CreateModifierInput) {
    await this.requireProject(projectId);
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
    if (!revision) throw new Error(`Revision ${revisionId} not found for project ${projectId}`);

    const modifier = await this.db.modifier.create({
      data: {
        id: createId("mod"),
        revisionId,
        name: input.name ?? "New Modifier",
        type: input.type ?? "percentage",
        appliesTo: input.appliesTo ?? "All",
        percentage: input.percentage ?? null,
        amount: input.amount ?? null,
        show: input.show ?? "Yes",
      },
    });

    await this.syncProjectEstimate(projectId);
    return mapModifier(modifier);
  }

  async updateModifier(projectId: string, modifierId: string, patch: ModifierPatchInput) {
    await this.requireProject(projectId);
    const modifier = await this.db.modifier.findFirst({ where: { id: modifierId } });
    if (!modifier) throw new Error(`Modifier ${modifierId} not found for project ${projectId}`);

    const updated = await this.db.modifier.update({
      where: { id: modifierId },
      data: patch as any,
    });

    await this.syncProjectEstimate(projectId);
    return mapModifier(updated);
  }

  async deleteModifier(projectId: string, modifierId: string) {
    await this.requireProject(projectId);
    const modifier = await this.db.modifier.findFirst({ where: { id: modifierId } });
    if (!modifier) throw new Error(`Modifier ${modifierId} not found for project ${projectId}`);

    await this.db.modifier.delete({ where: { id: modifierId } });
    await this.syncProjectEstimate(projectId);
    return mapModifier(modifier);
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
    const items = await this.db.additionalLineItem.findMany({ where: { revisionId: revision.id } });
    return items.map(mapAdditionalLineItem);
  }

  async createAdditionalLineItem(projectId: string, revisionId: string, input: CreateAdditionalLineItemInput) {
    await this.requireProject(projectId);
    const revision = await this.db.quoteRevision.findFirst({ where: { id: revisionId } });
    if (!revision) throw new Error(`Revision ${revisionId} not found for project ${projectId}`);

    const ali = await this.db.additionalLineItem.create({
      data: {
        id: createId("ali"),
        revisionId,
        name: input.name ?? "New Line Item",
        type: input.type ?? "LineItemAdditional",
        description: input.description ?? "",
        amount: input.amount ?? 0,
      },
    });

    await this.syncProjectEstimate(projectId);
    return mapAdditionalLineItem(ali);
  }

  async updateAdditionalLineItem(projectId: string, aliId: string, patch: AdditionalLineItemPatchInput) {
    await this.requireProject(projectId);
    const ali = await this.db.additionalLineItem.findFirst({ where: { id: aliId } });
    if (!ali) throw new Error(`Additional line item ${aliId} not found for project ${projectId}`);

    const updated = await this.db.additionalLineItem.update({
      where: { id: aliId },
      data: patch as any,
    });

    await this.syncProjectEstimate(projectId);
    return mapAdditionalLineItem(updated);
  }

  async deleteAdditionalLineItem(projectId: string, aliId: string) {
    await this.requireProject(projectId);
    const ali = await this.db.additionalLineItem.findFirst({ where: { id: aliId } });
    if (!ali) throw new Error(`Additional line item ${aliId} not found for project ${projectId}`);

    await this.db.additionalLineItem.delete({ where: { id: aliId } });
    await this.syncProjectEstimate(projectId);
    return mapAdditionalLineItem(ali);
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

  async createRateSchedule(input: {
    name: string; description?: string; category?: string; defaultMarkup?: number; autoCalculate?: boolean; metadata?: Record<string, unknown>;
  }): Promise<RateScheduleWithChildren> {
    const created = await this.db.rateSchedule.create({
      data: {
        id: createId("rs"),
        organizationId: this.organizationId,
        name: input.name,
        description: input.description ?? "",
        category: input.category ?? "labour",
        scope: "global",
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
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.defaultMarkup !== undefined) data.defaultMarkup = patch.defaultMarkup;
    if (patch.autoCalculate !== undefined) data.autoCalculate = patch.autoCalculate;
    if (patch.effectiveDate !== undefined) data.effectiveDate = patch.effectiveDate;
    if (patch.expiryDate !== undefined) data.expiryDate = patch.expiryDate;
    if (patch.metadata !== undefined) data.metadata = patch.metadata;
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

  async createRateScheduleTier(scheduleId: string, input: { name: string; multiplier?: number; sortOrder?: number }): Promise<RateScheduleWithChildren> {
    const schedule = await this.db.rateSchedule.findFirst({ where: { id: scheduleId, organizationId: this.organizationId } });
    if (!schedule) throw new Error(`Rate schedule ${scheduleId} not found`);
    const maxOrder = await this.db.rateScheduleTier.aggregate({ where: { scheduleId }, _max: { sortOrder: true } });
    await this.db.rateScheduleTier.create({
      data: { id: createId("rst"), scheduleId, name: input.name, multiplier: input.multiplier ?? 1.0, sortOrder: input.sortOrder ?? ((maxOrder._max.sortOrder ?? -1) + 1) },
    });
    return this.getRateSchedule(scheduleId);
  }

  async updateRateScheduleTier(tierId: string, patch: { name?: string; multiplier?: number; sortOrder?: number }): Promise<RateScheduleWithChildren> {
    const tier = await this.db.rateScheduleTier.findFirst({ where: { id: tierId } });
    if (!tier) throw new Error(`Rate schedule tier ${tierId} not found`);
    const schedule = await this.db.rateSchedule.findFirst({ where: { id: tier.scheduleId, organizationId: this.organizationId } });
    if (!schedule) throw new Error(`Rate schedule not found`);
    const data: any = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.multiplier !== undefined) data.multiplier = patch.multiplier;
    if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
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
    catalogItemId?: string; code?: string; name: string; unit?: string;
    rates?: Record<string, number>; costRates?: Record<string, number>;
    burden?: number; perDiem?: number; metadata?: Record<string, unknown>; sortOrder?: number;
  }): Promise<RateScheduleWithChildren> {
    const schedule = await this.db.rateSchedule.findFirst({ where: { id: scheduleId, organizationId: this.organizationId } });
    if (!schedule) throw new Error(`Rate schedule ${scheduleId} not found`);
    const maxOrder = await this.db.rateScheduleItem.aggregate({ where: { scheduleId }, _max: { sortOrder: true } });
    await this.db.rateScheduleItem.create({
      data: {
        id: createId("rsi"), scheduleId, catalogItemId: input.catalogItemId ?? null,
        code: input.code ?? "", name: input.name, unit: input.unit ?? "HR",
        rates: (input.rates ?? {}) as any, costRates: (input.costRates ?? {}) as any,
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
    code?: string; name?: string; unit?: string;
    rates?: Record<string, number>; costRates?: Record<string, number>;
    burden?: number; perDiem?: number; metadata?: Record<string, unknown>; sortOrder?: number;
  }): Promise<RateScheduleWithChildren> {
    const item = await this.db.rateScheduleItem.findFirst({ where: { id: itemId } });
    if (!item) throw new Error(`Rate schedule item ${itemId} not found`);
    const schedule = await this.db.rateSchedule.findFirst({ where: { id: item.scheduleId, organizationId: this.organizationId } });
    if (!schedule) throw new Error(`Rate schedule not found`);
    const data: any = {};
    if (patch.code !== undefined) data.code = patch.code;
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.unit !== undefined) data.unit = patch.unit;
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
          data: { id: newTierId, scheduleId: newSchedId, name: tier.name, multiplier: tier.multiplier, sortOrder: tier.sortOrder },
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
        await tx.rateScheduleItem.create({
          data: {
            id: createId("rsi"), scheduleId: newSchedId, catalogItemId: item.catalogItemId,
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
        data: { rates: newRates, costRates: newCostRates },
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
          phaseWorksheetEnabled: revData.phaseWorksheetEnabled ?? false,
          useCalculatedTotal: revData.useCalculatedTotal,
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
          necaDifficulty: revData.necaDifficulty,
          followUpNote: revData.followUpNote,
          printEmptyNotesColumn: revData.printEmptyNotesColumn,
          printCategory: revData.printCategory,
          printPhaseTotalOnly: revData.printPhaseTotalOnly,
          showOvertimeDoubletime: revData.showOvertimeDoubletime,
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
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });

      // Copy phases with ID mapping
      const phaseIdMap = new Map<string, string>();
      const oldPhases = await tx.phase.findMany({ where: { revisionId: currentRevision.id } });
      for (const oldPhase of oldPhases) {
        const newPhaseId = createId("phase");
        phaseIdMap.set(oldPhase.id, newPhaseId);
        await tx.phase.create({
          data: { id: newPhaseId, revisionId: newRevisionId, number: oldPhase.number, name: oldPhase.name, description: oldPhase.description, order: oldPhase.order },
        });
      }

      // Copy worksheets and items
      const oldWorksheets = await tx.worksheet.findMany({ where: { revisionId: currentRevision.id } });
      for (const oldWs of oldWorksheets) {
        const newWsId = createId("worksheet");
        await tx.worksheet.create({ data: { id: newWsId, revisionId: newRevisionId, name: oldWs.name, order: oldWs.order } });

        const oldItems = await tx.worksheetItem.findMany({ where: { worksheetId: oldWs.id } });
        for (const oldItem of oldItems) {
          await tx.worksheetItem.create({
            data: {
              id: createId("li"),
              worksheetId: newWsId,
              phaseId: oldItem.phaseId ? (phaseIdMap.get(oldItem.phaseId) ?? null) : oldItem.phaseId,
              category: oldItem.category, entityType: oldItem.entityType, entityName: oldItem.entityName,
              vendor: oldItem.vendor, description: oldItem.description, quantity: oldItem.quantity,
              uom: oldItem.uom, cost: oldItem.cost, markup: oldItem.markup, price: oldItem.price,
              laborHourReg: oldItem.laborHourReg, laborHourOver: oldItem.laborHourOver, laborHourDouble: oldItem.laborHourDouble,
              lineOrder: oldItem.lineOrder,
            },
          });
        }
      }

      // Copy modifiers
      const oldModifiers = await tx.modifier.findMany({ where: { revisionId: currentRevision.id } });
      for (const m of oldModifiers) {
        await tx.modifier.create({ data: { id: createId("mod"), revisionId: newRevisionId, name: m.name, type: m.type, appliesTo: m.appliesTo, percentage: m.percentage, amount: m.amount, show: m.show } });
      }

      // Copy ALIs
      const oldAlis = await tx.additionalLineItem.findMany({ where: { revisionId: currentRevision.id } });
      for (const a of oldAlis) {
        await tx.additionalLineItem.create({ data: { id: createId("ali"), revisionId: newRevisionId, name: a.name, description: a.description, type: a.type, amount: a.amount } });
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
            data: { id: newTierId, scheduleId: newSchedId, name: tier.name, multiplier: tier.multiplier, sortOrder: tier.sortOrder },
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
          await tx.rateScheduleItem.create({
            data: {
              id: createId("rsi"), scheduleId: newSchedId, catalogItemId: item.catalogItemId,
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
          breakoutStyle: revData.breakoutStyle, phaseWorksheetEnabled: revData.phaseWorksheetEnabled ?? false,
          useCalculatedTotal: revData.useCalculatedTotal, type: revData.type,
          scratchpad: revData.scratchpad, leadLetter: revData.leadLetter,
          dateEstimatedShip: revData.dateEstimatedShip, dateQuote: revData.dateQuote,
          dateDue: revData.dateDue, dateWalkdown: revData.dateWalkdown,
          dateWorkStart: revData.dateWorkStart, dateWorkEnd: revData.dateWorkEnd,
          shippingMethod: revData.shippingMethod, shippingTerms: revData.shippingTerms,
          freightOnBoard: revData.freightOnBoard, status: revData.status,
          defaultMarkup: revData.defaultMarkup, necaDifficulty: revData.necaDifficulty,
          followUpNote: revData.followUpNote, printEmptyNotesColumn: revData.printEmptyNotesColumn,
          printCategory: revData.printCategory, printPhaseTotalOnly: revData.printPhaseTotalOnly,
          showOvertimeDoubletime: revData.showOvertimeDoubletime,
          grandTotal: revData.grandTotal, regHours: revData.regHours, overHours: revData.overHours, doubleHours: revData.doubleHours,
          subtotal: revData.subtotal, cost: revData.cost, estimatedProfit: revData.estimatedProfit, estimatedMargin: revData.estimatedMargin,
          calculatedTotal: revData.calculatedTotal ?? 0, totalHours: revData.totalHours,
          breakoutPackage: revData.breakoutPackage as any,
          calculatedCategoryTotals: revData.calculatedCategoryTotals as any,
          createdAt: timestamp, updatedAt: timestamp,
        },
      });

      // Build phase ID map
      const phaseIdMap = new Map<string, string>();
      const oldPhases = await tx.phase.findMany({ where: { revisionId: sourceRevision.id } });
      for (const p of oldPhases) {
        const newId = createId("phase");
        phaseIdMap.set(p.id, newId);
        await tx.phase.create({ data: { id: newId, revisionId: newRevisionId, number: p.number, name: p.name, description: p.description, order: p.order } });
      }

      // Copy worksheets and items
      let firstWorksheetId: string | null = null;
      const oldWorksheets = await tx.worksheet.findMany({ where: { revisionId: sourceRevision.id } });
      for (const ws of oldWorksheets) {
        const newWsId = createId("worksheet");
        if (!firstWorksheetId) firstWorksheetId = newWsId;
        await tx.worksheet.create({ data: { id: newWsId, revisionId: newRevisionId, name: ws.name, order: ws.order } });
        const oldItems = await tx.worksheetItem.findMany({ where: { worksheetId: ws.id } });
        for (const it of oldItems) {
          await tx.worksheetItem.create({
            data: {
              id: createId("li"), worksheetId: newWsId,
              phaseId: it.phaseId ? (phaseIdMap.get(it.phaseId) ?? null) : it.phaseId,
              category: it.category, entityType: it.entityType, entityName: it.entityName,
              vendor: it.vendor, description: it.description, quantity: it.quantity,
              uom: it.uom, cost: it.cost, markup: it.markup, price: it.price,
              laborHourReg: it.laborHourReg, laborHourOver: it.laborHourOver, laborHourDouble: it.laborHourDouble,
              lineOrder: it.lineOrder,
            },
          });
        }
      }

      // Copy modifiers, ALIs, conditions, report sections
      for (const m of await tx.modifier.findMany({ where: { revisionId: sourceRevision.id } })) {
        await tx.modifier.create({ data: { id: createId("mod"), revisionId: newRevisionId, name: m.name, type: m.type, appliesTo: m.appliesTo, percentage: m.percentage, amount: m.amount, show: m.show } });
      }
      for (const a of await tx.additionalLineItem.findMany({ where: { revisionId: sourceRevision.id } })) {
        await tx.additionalLineItem.create({ data: { id: createId("ali"), revisionId: newRevisionId, name: a.name, description: a.description, type: a.type, amount: a.amount } });
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
    const quote = await this.db.quote.findFirst({ where: { projectId } });
    if (!quote) throw new Error(`Quote not found for project ${projectId}`);

    const updated = await this.db.quote.update({
      where: { id: quote.id },
      data: { ...patch as any, updatedAt: new Date() },
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

  async logActivity(projectId: string, revisionId: string | null, type: string, data: Record<string, unknown>) {
    await this.requireProject(projectId);
    const activity = await this.db.activity.create({
      data: {
        id: createId("activity"),
        projectId,
        revisionId,
        type,
        data: data as any,
        createdAt: new Date(),
      },
    });
    return mapActivity(activity);
  }

  async listActivities(projectId: string) {
    const activities = await this.db.activity.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return activities.map(mapActivity);
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
        scope: input.scope || "global",
        projectId: input.projectId ?? null,
        description: input.description ?? "",
      },
    });
    return mapCatalog(catalog);
  }

  async updateCatalog(catalogId: string, patch: CatalogPatchInput) {
    const catalog = await this.db.catalog.findFirst({ where: { id: catalogId, organizationId: this.organizationId } });
    if (!catalog) throw new Error(`Catalog ${catalogId} not found`);

    const data: any = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.kind !== undefined) data.kind = patch.kind;
    if (patch.scope !== undefined) data.scope = patch.scope;
    if (patch.projectId !== undefined) data.projectId = patch.projectId ?? null;
    if (patch.description !== undefined) data.description = patch.description;

    const updated = await this.db.catalog.update({ where: { id: catalogId }, data });
    return mapCatalog(updated);
  }

  async deleteCatalog(catalogId: string) {
    const catalog = await this.db.catalog.findFirst({ where: { id: catalogId, organizationId: this.organizationId } });
    if (!catalog) throw new Error(`Catalog ${catalogId} not found`);
    await this.db.catalogItem.deleteMany({ where: { catalogId } });
    await this.db.catalog.delete({ where: { id: catalogId } });
    return { deleted: true };
  }

  async listCatalogItems(catalogId: string) {
    const items = await this.db.catalogItem.findMany({ where: { catalogId } });
    return items.map(mapCatalogItem);
  }

  async createCatalogItem(catalogId: string, input: CreateCatalogItemInput) {
    const catalog = await this.db.catalog.findFirst({ where: { id: catalogId, organizationId: this.organizationId } });
    if (!catalog) throw new Error(`Catalog ${catalogId} not found`);

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
    const item = await this.db.catalogItem.findFirst({ where: { id: itemId } });
    if (!item) throw new Error(`Catalog item ${itemId} not found`);

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
    const item = await this.db.catalogItem.findFirst({ where: { id: itemId } });
    if (!item) throw new Error(`Catalog item ${itemId} not found`);
    await this.db.catalogItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  async searchCatalogItems(query: string, catalogId?: string) {
    const catalogIds = catalogId
      ? [catalogId]
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

    const data: any = { updatedAt: new Date() };
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.parentId !== undefined) data.parentId = patch.parentId ?? null;
    if (patch.storagePath !== undefined) data.storagePath = patch.storagePath;

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
    const annotation = await this.db.takeoffAnnotation.create({
      data: {
        id: createId("takeoff"),
        projectId,
        documentId: input.documentId,
        pageNumber: input.pageNumber,
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
        createdBy: input.createdBy,
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
    return mapTakeoffAnnotation(updated);
  }

  async deleteTakeoffAnnotation(annotationId: string) {
    const annotation = await this.db.takeoffAnnotation.findFirst({ where: { id: annotationId } });
    if (!annotation) throw new Error(`Takeoff annotation ${annotationId} not found`);
    await this.db.takeoffAnnotation.delete({ where: { id: annotationId } });
    return { deleted: true };
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

    for (const row of rows) {
      const entityNameIdx = getColumn("entityName");
      const entityName = entityNameIdx >= 0 ? row[entityNameIdx] : "";
      if (!entityName) continue;

      const descIdx = getColumn("description");
      const qtyIdx = getColumn("quantity");
      const uomIdx = getColumn("uom");
      const costIdx = getColumn("cost");
      const priceIdx = getColumn("price");
      const categoryIdx = getColumn("category");
      const vendorIdx = getColumn("vendor");

      const input: CreateWorksheetItemInput = {
        category: categoryIdx >= 0 && row[categoryIdx] ? row[categoryIdx] : "Material",
        entityType: "Material",
        entityName,
        vendor: vendorIdx >= 0 ? row[vendorIdx] : undefined,
        description: descIdx >= 0 ? row[descIdx] : "",
        quantity: qtyIdx >= 0 ? parseFloat(row[qtyIdx]) || 1 : 1,
        uom: uomIdx >= 0 && row[uomIdx] ? row[uomIdx] : "EA",
        cost: costIdx >= 0 ? parseFloat(row[costIdx]) || 0 : 0,
        markup: 0.2,
        price: priceIdx >= 0 ? parseFloat(row[priceIdx]) || 0 : 0,
        laborHourReg: 0,
        laborHourOver: 0,
        laborHourDouble: 0,
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

  async executePlugin(
    pluginId: string,
    toolId: string,
    projectId: string,
    revisionId: string,
    input: Record<string, unknown>,
    opts?: { worksheetId?: string; formState?: Record<string, unknown>; executedBy?: "user" | "agent"; agentSessionId?: string },
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

    const output: PluginOutput = { type: outputType, displayText: `Executed ${toolName} with provided input`, appliedEffects: [] };
    const appliedItemIds: string[] = [];

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
        if (output.scores.length === 0 && opts?.formState?.scoringData) {
          const scoringData = opts.formState.scoringData as Record<string, Record<string, number>>;
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

    // ── Apply effects to the quote ────────────────────────────────────

    if (output.lineItems && output.lineItems.length > 0) {
      const wsId = opts?.worksheetId ?? await this._resolveDefaultWorksheetId(projectId, revisionId);
      for (const item of output.lineItems) {
        const created = await this.createWorksheetItem(projectId, wsId, {
          category: item.category, entityType: item.entityType, entityName: item.entityName,
          vendor: item.vendor ?? null, description: item.description,
          quantity: item.quantity, uom: item.uom, cost: item.cost ?? 0,
          markup: item.markup ?? 0, price: item.price ?? 0,
          laborHourReg: item.laborHourReg ?? 0, laborHourOver: item.laborHourOver ?? 0,
          laborHourDouble: item.laborHourDouble ?? 0, phaseId: item.phaseId,
        });
        appliedItemIds.push(created.id);
      }
      output.appliedEffects!.push({ type: "line_items", description: `Created ${output.lineItems.length} line item(s)` });
    }

    if (output.worksheet) {
      const ws = await this.createWorksheet(projectId, { name: output.worksheet.name });
      for (const item of output.worksheet.items) {
        const created = await this.createWorksheetItem(projectId, ws.id, {
          category: item.category, entityType: item.entityType, entityName: item.entityName,
          vendor: item.vendor ?? null, description: item.description,
          quantity: item.quantity, uom: item.uom, cost: item.cost ?? 0,
          markup: item.markup ?? 0, price: item.price ?? 0,
          laborHourReg: item.laborHourReg ?? 0, laborHourOver: item.laborHourOver ?? 0,
          laborHourDouble: item.laborHourDouble ?? 0, phaseId: item.phaseId,
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

    const execution = await this.db.pluginExecution.create({
      data: {
        id: createId("pexec"),
        pluginId, toolId, projectId, revisionId,
        worksheetId: opts?.worksheetId,
        input: input as any,
        formState: opts?.formState as any,
        output: output as any,
        appliedLineItemIds: appliedItemIds.length > 0 ? appliedItemIds : undefined,
        status: "complete",
        executedBy: opts?.executedBy ?? "user",
        agentSessionId: opts?.agentSessionId,
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
    return {
      general: (settings.general as any) ?? DEFAULT_SETTINGS.general,
      email: (settings.email as any) ?? DEFAULT_SETTINGS.email,
      defaults: (settings.defaults as any) ?? DEFAULT_SETTINGS.defaults,
      integrations: (settings.integrations as any) ?? DEFAULT_SETTINGS.integrations,
      brand: (settings.brand as any) ?? DEFAULT_BRAND,
    } as AppSettings;
  }

  async updateSettings(patch: Partial<AppSettings>) {
    const existing = await this.getSettings();

    const merged = {
      general: patch.general ? { ...existing.general, ...patch.general } : existing.general,
      email: patch.email ? { ...existing.email, ...patch.email } : existing.email,
      defaults: patch.defaults ? { ...existing.defaults, ...patch.defaults } : existing.defaults,
      integrations: patch.integrations ? { ...existing.integrations, ...patch.integrations } : existing.integrations,
      brand: patch.brand ? { ...existing.brand, ...patch.brand } : existing.brand,
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
        updatedAt: new Date(),
      },
      update: {
        general: merged.general as any,
        email: merged.email as any,
        defaults: merged.defaults as any,
        integrations: merged.integrations as any,
        brand: merged.brand as any,
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

  async listKnowledgeBooks(projectId?: string): Promise<KnowledgeBook[]> {
    const where: any = { organizationId: this.organizationId };
    if (projectId) {
      where.OR = [{ projectId }, { scope: "global" }];
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
    sourceFileName: string;
    sourceFileSize: number;
    storagePath?: string | null;
  }): Promise<KnowledgeBook> {
    const book = await this.db.knowledgeBook.create({
      data: {
        id: createId("kb"),
        organizationId: this.organizationId,
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

  async updateKnowledgeBook(bookId: string, patch: Partial<Pick<KnowledgeBook, "name" | "description" | "category" | "scope" | "projectId" | "status" | "pageCount" | "chunkCount" | "metadata">>): Promise<KnowledgeBook> {
    const book = await this.db.knowledgeBook.findFirst({ where: { id: bookId, organizationId: this.organizationId } });
    if (!book) throw new Error(`Knowledge book ${bookId} not found`);

    const data: any = { updatedAt: new Date() };
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.scope !== undefined) data.scope = patch.scope;
    if (patch.projectId !== undefined) data.projectId = patch.projectId;
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
    const chunks = await this.db.knowledgeChunk.findMany({
      where: { bookId },
      orderBy: { order: "asc" },
    });
    return chunks.map(mapKnowledgeChunk);
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
    if (bookId) where.bookId = bookId;
    else {
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

  async listDatasets(projectId?: string): Promise<Dataset[]> {
    const where: any = { organizationId: this.organizationId, isTemplate: false };
    if (projectId) {
      where.OR = [{ projectId }, { scope: "global" }];
    }
    const datasets = await this.db.dataset.findMany({ where });
    return datasets.map(mapDataset);
  }

  async getDataset(datasetId: string): Promise<Dataset | null> {
    const dataset = await this.db.dataset.findFirst({ where: { id: datasetId, organizationId: this.organizationId } });
    return dataset ? mapDataset(dataset) : null;
  }

  async createDataset(input: {
    name: string;
    description: string;
    category: Dataset["category"];
    scope: Dataset["scope"];
    projectId?: string | null;
    columns: Dataset["columns"];
    source?: Dataset["source"];
    sourceDescription?: string;
  }): Promise<Dataset> {
    const dataset = await this.db.dataset.create({
      data: {
        id: createId("ds"),
        organizationId: this.organizationId,
        name: input.name,
        description: input.description,
        category: input.category,
        scope: input.scope,
        projectId: input.projectId ?? null,
        columns: input.columns as any,
        source: input.source ?? "manual",
        sourceDescription: input.sourceDescription ?? "",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return mapDataset(dataset);
  }

  async updateDataset(datasetId: string, patch: Partial<Pick<Dataset, "name" | "description" | "category" | "scope" | "projectId" | "columns" | "source" | "sourceDescription">>): Promise<Dataset> {
    const dataset = await this.db.dataset.findFirst({ where: { id: datasetId, organizationId: this.organizationId } });
    if (!dataset) throw new Error(`Dataset ${datasetId} not found`);

    const data: any = { updatedAt: new Date() };
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.scope !== undefined) data.scope = patch.scope;
    if (patch.projectId !== undefined) data.projectId = patch.projectId;
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
    let rows = await this.db.datasetRow.findMany({
      where: { datasetId },
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
    const row = await this.db.datasetRow.findFirst({ where: { id: rowId } });
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
    const row = await this.db.datasetRow.findFirst({ where: { id: rowId } });
    if (!row) throw new Error(`Dataset row ${rowId} not found`);

    const updated = await this.db.datasetRow.update({
      where: { id: rowId },
      data: { data: { ...(row.data as any), ...data } as any, updatedAt: new Date() },
    });
    return mapDatasetRow(updated);
  }

  async deleteDatasetRow(rowId: string): Promise<DatasetRow> {
    const row = await this.db.datasetRow.findFirst({ where: { id: rowId } });
    if (!row) throw new Error(`Dataset row ${rowId} not found`);

    await this.db.datasetRow.delete({ where: { id: rowId } });
    const remaining = await this.db.datasetRow.count({ where: { datasetId: row.datasetId } });
    await this.db.dataset.update({
      where: { id: row.datasetId },
      data: { rowCount: remaining, updatedAt: new Date() },
    });

    return mapDatasetRow(row);
  }

  async searchDatasetRows(datasetId: string, query: string): Promise<DatasetRow[]> {
    const rows = await this.db.datasetRow.findMany({ where: { datasetId } });
    const lowerQuery = query.toLowerCase();
    return rows
      .filter((r) => JSON.stringify(r.data).toLowerCase().includes(lowerQuery))
      .map(mapDatasetRow);
  }

  async queryDataset(datasetId: string, filters: Array<{ column: string; op: "eq" | "gt" | "lt" | "gte" | "lte" | "contains"; value: unknown }>): Promise<DatasetRow[]> {
    const rows = await this.db.datasetRow.findMany({ where: { datasetId } });
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
}

// ── Factory + backward-compat export ─────────────────────────────────────────

export function createApiStore(organizationId: string): PrismaApiStore {
  return new PrismaApiStore(sharedPrisma, organizationId);
}

// ── Dataset Library (system-level templates, not org-scoped) ─────────────────

export const datasetLibrary = {
  async listTemplates(): Promise<Dataset[]> {
    const datasets = await sharedPrisma.dataset.findMany({
      where: { isTemplate: true },
      orderBy: { name: "asc" },
    });
    return datasets.map(mapDataset);
  },

  async getTemplate(id: string): Promise<Dataset | null> {
    const dataset = await sharedPrisma.dataset.findFirst({
      where: { id, isTemplate: true },
    });
    return dataset ? mapDataset(dataset) : null;
  },

  async createTemplate(input: {
    name: string;
    description: string;
    category: Dataset["category"];
    columns: Dataset["columns"];
    source?: Dataset["source"];
    sourceDescription?: string;
  }): Promise<Dataset> {
    const dataset = await sharedPrisma.dataset.create({
      data: {
        id: createId("ds"),
        organizationId: null,
        name: input.name,
        description: input.description,
        category: input.category,
        scope: "global",
        columns: input.columns as any,
        source: input.source ?? "import",
        sourceDescription: input.sourceDescription ?? "",
        isTemplate: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return mapDataset(dataset);
  },

  async updateTemplate(
    id: string,
    patch: Partial<Pick<Dataset, "name" | "description" | "category" | "columns" | "sourceDescription">>,
  ): Promise<Dataset> {
    const existing = await sharedPrisma.dataset.findFirst({ where: { id, isTemplate: true } });
    if (!existing) throw new Error(`Template ${id} not found`);

    const data: any = { updatedAt: new Date() };
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.columns !== undefined) data.columns = patch.columns as any;
    if (patch.sourceDescription !== undefined) data.sourceDescription = patch.sourceDescription;

    const updated = await sharedPrisma.dataset.update({ where: { id }, data });
    return mapDataset(updated);
  },

  async deleteTemplate(id: string): Promise<void> {
    const existing = await sharedPrisma.dataset.findFirst({ where: { id, isTemplate: true } });
    if (!existing) throw new Error(`Template ${id} not found`);
    await sharedPrisma.datasetRow.deleteMany({ where: { datasetId: id } });
    await sharedPrisma.dataset.delete({ where: { id } });
  },

  async getTemplateRows(
    id: string,
    limit = 100,
    offset = 0,
    filter?: string,
  ): Promise<{ rows: DatasetRow[]; total: number }> {
    const allRows = await sharedPrisma.datasetRow.findMany({
      where: { datasetId: id },
      orderBy: { order: "asc" },
    });
    let mapped = allRows.map(mapDatasetRow);
    if (filter) {
      const lf = filter.toLowerCase();
      mapped = mapped.filter((r) => JSON.stringify(r.data).toLowerCase().includes(lf));
    }
    const total = mapped.length;
    return { rows: mapped.slice(offset, offset + limit), total };
  },

  async createTemplateRowsBatch(
    datasetId: string,
    rows: Array<Record<string, unknown>>,
  ): Promise<number> {
    const now = new Date();
    const existing = await sharedPrisma.datasetRow.count({ where: { datasetId } });
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      await sharedPrisma.datasetRow.createMany({
        data: batch.map((data, idx) => ({
          id: createId("dr"),
          datasetId,
          data: data as any,
          order: existing + i + idx,
          createdAt: now,
          updatedAt: now,
        })),
      });
    }
    await sharedPrisma.dataset.update({
      where: { id: datasetId },
      data: { rowCount: existing + rows.length, updatedAt: now },
    });
    return rows.length;
  },

  async deleteTemplateRows(id: string): Promise<void> {
    await sharedPrisma.datasetRow.deleteMany({ where: { datasetId: id } });
    await sharedPrisma.dataset.update({
      where: { id },
      data: { rowCount: 0, updatedAt: new Date() },
    });
  },

  async adoptTemplate(templateId: string, organizationId: string): Promise<Dataset> {
    const template = await sharedPrisma.dataset.findFirst({
      where: { id: templateId, isTemplate: true },
    });
    if (!template) throw new Error(`Template ${templateId} not found`);

    const now = new Date();
    const newId = createId("ds");

    const dataset = await sharedPrisma.dataset.create({
      data: {
        id: newId,
        organizationId,
        name: template.name,
        description: template.description,
        category: template.category,
        scope: "global",
        columns: template.columns as any,
        source: "library",
        sourceDescription: `Adopted from template: ${template.name}`,
        isTemplate: false,
        sourceTemplateId: templateId,
        createdAt: now,
        updatedAt: now,
      },
    });

    // Clone all rows in batches
    const allRows = await sharedPrisma.datasetRow.findMany({
      where: { datasetId: templateId },
      orderBy: { order: "asc" },
    });

    const BATCH = 500;
    for (let i = 0; i < allRows.length; i += BATCH) {
      const batch = allRows.slice(i, i + BATCH);
      await sharedPrisma.datasetRow.createMany({
        data: batch.map((r, idx) => ({
          id: createId("dr"),
          datasetId: newId,
          data: r.data as any,
          order: i + idx,
          createdAt: now,
          updatedAt: now,
        })),
      });
    }

    await sharedPrisma.dataset.update({
      where: { id: newId },
      data: { rowCount: allRows.length, updatedAt: now },
    });

    return mapDataset({ ...dataset, rowCount: allRows.length });
  },
};

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
