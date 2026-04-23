import { createHash } from "node:crypto";

import type {
  Activity,
  Adjustment,
  AdditionalLineItem,
  AppSettings,
  Catalog,
  CatalogItem,
  Condition,
  ConditionLibraryEntry,
  Customer,
  CustomerContact,
  Dataset,
  DatasetRow,
  Department,
  EntityCategory,
  EstimateCalibrationFeedback,
  EstimateStrategy,
  FileNode,
  Job,
  KnowledgeBook,
  KnowledgeLibraryCabinet,
  KnowledgeChunk,
  LabourCostEntry,
  LabourCostTable,
  LabourCostTableWithEntries,
  Modifier,
  Phase,
  Plugin,
  PluginExecution,
  Project,
  Quote,
  QuoteRevision,
  RateSchedule,
  RateScheduleItem,
  RateScheduleTier,
  RateScheduleWithChildren,
  ReportSection,
  ScheduleBaseline,
  ScheduleBaselineTask,
  ScheduleCalendar,
  ScheduleDependency,
  ScheduleResource,
  ScheduleTask,
  ScheduleTaskAssignment,
  SourceDocument,
  SummaryRow,
  TravelPolicy,
  User,
  WorksheetItem,
  BurdenPeriod,
} from "@bidwright/domain";
import { normalizeCalculationType } from "@bidwright/domain";
import type { DocumentChunk, IngestionReport, PackageSourceKind } from "@bidwright/ingestion";

import { relativeWorkspacePath } from "../paths.js";
import { decodeHtmlEntities } from "../text-utils.js";
import type { IngestionJobRecord, StoredPackageRecord, WorkspaceStateRecord } from "./types.js";

export const DEFAULT_BRAND: AppSettings["brand"] = {
  companyName: "", tagline: "", industry: "", description: "",
  services: [], targetMarkets: [], brandVoice: "",
  colors: { primary: "", secondary: "", accent: "" },
  logoUrl: "", socialLinks: {}, websiteUrl: "", lastCapturedAt: null,
};

export const DEFAULT_SETTINGS: AppSettings = {
  general: { orgName: "", address: "", phone: "", website: "", logoUrl: "" },
  email: { host: "", port: 587, username: "", password: "", fromAddress: "", fromName: "", authMethod: "smtp", oauth2TenantId: "", oauth2ClientId: "", oauth2ClientSecret: "" },
  defaults: {
    defaultMarkup: 15,
    breakoutStyle: "category",
    quoteType: "Firm",
    timezone: "America/New_York",
    currency: "USD",
    dateFormat: "MM/DD/YYYY",
    fiscalYearStart: 1,
    maxAgentIterations: 200,
    benchmarkingEnabled: true,
    benchmarkMinimumSimilarity: 0.55,
    benchmarkMaximumComparables: 5,
    benchmarkLowerHoursRatio: 0.75,
    benchmarkUpperHoursRatio: 1.25,
    requireHumanReviewForBenchmarkOutliers: true,
  },
  integrations: {
    openaiKey: "",
    anthropicKey: "",
    openrouterKey: "",
    geminiKey: "",
    llmProvider: "anthropic",
    llmModel: "claude-sonnet-4-20250514",
    azureDiEndpoint: "",
    azureDiKey: "",
    agentRuntime: undefined,
    agentModel: undefined,
    agentReasoningEffort: "extra_high",
    maxConcurrentSubAgents: 2,
  },
  brand: DEFAULT_BRAND,
  termsAndConditions: "",
};

export function knowledgeCategoryFromDocType(docType: string): "estimating" | "labour" | "equipment" | "materials" | "safety" | "standards" | "general" {
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

export function inferPageCount(document: IngestionReport["documents"][number], chunks: DocumentChunk[]) {
  const relatedChunks = chunks.filter((chunk) => chunk.documentId === document.id);
  if (relatedChunks.length > 0) {
    return Math.max(1, relatedChunks.length);
  }
  const textLength = document.text.length;
  const estimated = Math.ceil(textLength / 1800);
  return Math.max(1, estimated || 1);
}

export function checksumForDocument(packageChecksum: string, document: IngestionReport["documents"][number]) {
  return createHash("sha256")
    .update(`${packageChecksum}:${document.sourcePath}:${document.text}:${document.kind}`)
    .digest("hex");
}

function toISOString(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function toISO(d: Date): string {
  return d.toISOString();
}

export function mapProject(p: any): Project {
  return {
    id: p.id,
    name: p.name,
    clientName: p.clientName,
    location: p.location,
    scope: p.scope ?? "",
    packageName: p.packageName,
    packageUploadedAt: p.packageUploadedAt,
    ingestionStatus: p.ingestionStatus as Project["ingestionStatus"],
    summary: p.summary,
    createdAt: toISO(p.createdAt),
    updatedAt: toISO(p.updatedAt),
  };
}

export function mapSourceDocument(d: any): SourceDocument {
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
    structuredData: d.structuredData ?? null,
    createdAt: toISO(d.createdAt),
    updatedAt: toISO(d.updatedAt),
  };
}

export function mapQuote(q: any): Quote {
  return {
    id: q.id,
    projectId: q.projectId,
    quoteNumber: q.quoteNumber,
    title: q.title,
    status: q.status as Quote["status"],
    currentRevisionId: q.currentRevisionId,
    customerExistingNew: q.customerExistingNew as Quote["customerExistingNew"],
    customerId: q.customerId ?? null,
    customerName: q.customer?.name ?? null,
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

export function mapRevision(r: any): QuoteRevision {
  return {
    id: r.id,
    quoteId: r.quoteId,
    revisionNumber: r.revisionNumber,
    title: r.title,
    description: r.description,
    notes: r.notes,
    breakoutStyle: r.breakoutStyle as QuoteRevision["breakoutStyle"],
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
    grandTotal: r.grandTotal,
    regHours: r.regHours,
    overHours: r.overHours,
    doubleHours: r.doubleHours,
    breakoutPackage: (r.breakoutPackage as unknown[]) ?? [],
    calculatedCategoryTotals: (r.calculatedCategoryTotals as unknown[]) ?? [],
    summaryLayoutPreset: (r.summaryLayoutPreset ?? "custom") as QuoteRevision["summaryLayoutPreset"],
    pdfPreferences: (r.pdfPreferences as Record<string, unknown>) ?? {},
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

export function mapWorksheet(w: any): { id: string; revisionId: string; name: string; order: number } {
  return { id: w.id, revisionId: w.revisionId, name: w.name, order: w.order };
}

export function mapWorksheetItem(i: any): WorksheetItem {
  return {
    id: i.id,
    worksheetId: i.worksheetId,
    phaseId: i.phaseId ?? null,
    category: i.category,
    entityType: i.entityType,
    entityName: decodeHtmlEntities(i.entityName ?? ""),
    vendor: i.vendor ? decodeHtmlEntities(i.vendor) : undefined,
    description: decodeHtmlEntities(i.description ?? ""),
    quantity: i.quantity,
    uom: i.uom,
    cost: i.cost,
    markup: i.markup,
    price: i.price,
    unit1: i.unit1,
    unit2: i.unit2,
    unit3: i.unit3,
    lineOrder: i.lineOrder,
    rateScheduleItemId: i.rateScheduleItemId ?? null,
    itemId: i.itemId ?? null,
    tierUnits: (i.tierUnits as Record<string, number>) ?? {},
    sourceNotes: decodeHtmlEntities(i.sourceNotes ?? ""),
  };
}

export function mapPhase(p: any): Phase {
  return { id: p.id, revisionId: p.revisionId, number: p.number, name: p.name, description: p.description, order: p.order, startDate: p.startDate ?? null, endDate: p.endDate ?? null, color: p.color ?? "" };
}

export function mapScheduleTask(t: any): ScheduleTask {
  return {
    id: t.id, projectId: t.projectId, revisionId: t.revisionId, phaseId: t.phaseId ?? null, calendarId: t.calendarId ?? null,
    parentTaskId: t.parentTaskId ?? null, outlineLevel: t.outlineLevel ?? 0,
    name: t.name, description: t.description, taskType: t.taskType as ScheduleTask["taskType"],
    status: t.status as ScheduleTask["status"], startDate: t.startDate ?? null, endDate: t.endDate ?? null,
    duration: t.duration, progress: t.progress, assignee: t.assignee, order: t.order,
    constraintType: (t.constraintType ?? "asap") as ScheduleTask["constraintType"],
    constraintDate: t.constraintDate ?? null,
    deadlineDate: t.deadlineDate ?? null,
    actualStart: t.actualStart ?? null,
    actualEnd: t.actualEnd ?? null,
    baselineStart: t.baselineStart ?? null, baselineEnd: t.baselineEnd ?? null,
    createdAt: toISO(t.createdAt), updatedAt: toISO(t.updatedAt),
  };
}

export function mapScheduleDependency(d: any): ScheduleDependency {
  return { id: d.id, predecessorId: d.predecessorId, successorId: d.successorId, type: d.type as ScheduleDependency["type"], lagDays: d.lagDays };
}

export function mapScheduleCalendar(c: any): ScheduleCalendar {
  return {
    id: c.id,
    projectId: c.projectId,
    revisionId: c.revisionId,
    name: c.name,
    description: c.description ?? "",
    isDefault: !!c.isDefault,
    workingDays: (c.workingDays as Record<string, boolean>) ?? {},
    shiftStartMinutes: c.shiftStartMinutes ?? 480,
    shiftEndMinutes: c.shiftEndMinutes ?? 1020,
    createdAt: toISO(c.createdAt),
    updatedAt: toISO(c.updatedAt),
  };
}

export function mapScheduleBaseline(b: any): ScheduleBaseline {
  return {
    id: b.id,
    projectId: b.projectId,
    revisionId: b.revisionId,
    name: b.name,
    description: b.description ?? "",
    kind: (b.kind ?? "custom") as ScheduleBaseline["kind"],
    isPrimary: !!b.isPrimary,
    createdAt: toISO(b.createdAt),
    updatedAt: toISO(b.updatedAt),
  };
}

export function mapScheduleBaselineTask(item: any): ScheduleBaselineTask {
  return {
    id: item.id,
    baselineId: item.baselineId,
    taskId: item.taskId,
    taskName: item.taskName ?? "",
    phaseId: item.phaseId ?? null,
    startDate: item.startDate ?? null,
    endDate: item.endDate ?? null,
    duration: item.duration ?? 0,
    createdAt: toISO(item.createdAt),
    updatedAt: toISO(item.updatedAt),
  };
}

export function mapScheduleResource(r: any): ScheduleResource {
  return {
    id: r.id,
    projectId: r.projectId,
    revisionId: r.revisionId,
    calendarId: r.calendarId ?? null,
    name: r.name,
    role: r.role ?? "",
    kind: (r.kind ?? "labor") as ScheduleResource["kind"],
    color: r.color ?? "",
    defaultUnits: r.defaultUnits ?? 1,
    capacityPerDay: r.capacityPerDay ?? 1,
    costRate: r.costRate ?? 0,
    createdAt: toISO(r.createdAt),
    updatedAt: toISO(r.updatedAt),
  };
}

export function mapScheduleTaskAssignment(a: any): ScheduleTaskAssignment {
  return {
    id: a.id,
    taskId: a.taskId,
    resourceId: a.resourceId,
    units: a.units ?? 1,
    role: a.role ?? "",
    createdAt: toISO(a.createdAt),
    updatedAt: toISO(a.updatedAt),
  };
}

export function mapAdjustment(a: any): Adjustment {
  return {
    id: a.id,
    revisionId: a.revisionId,
    order: a.order ?? 0,
    kind: a.kind as Adjustment["kind"],
    pricingMode: a.pricingMode as Adjustment["pricingMode"],
    name: a.name,
    description: a.description ?? "",
    type: a.type ?? "",
    appliesTo: a.appliesTo ?? "All",
    percentage: a.percentage ?? null,
    amount: a.amount ?? null,
    show: (a.show ?? "Yes") as Adjustment["show"],
  };
}

export function mapModifier(m: any): Modifier {
  return { id: m.id, revisionId: m.revisionId, name: m.name, type: m.type, appliesTo: m.appliesTo, percentage: m.percentage ?? null, amount: m.amount ?? null, show: m.show as Modifier["show"] };
}

export function mapAdditionalLineItem(a: any): AdditionalLineItem {
  return { id: a.id, revisionId: a.revisionId, name: a.name, description: a.description ?? undefined, type: a.type as AdditionalLineItem["type"], amount: a.amount };
}

export function mapSummaryRow(r: any): SummaryRow {
  return {
    id: r.id,
    revisionId: r.revisionId,
    type: r.type as SummaryRow["type"],
    label: r.label,
    order: r.order,
    visible: r.visible,
    style: (r.style ?? "normal") as SummaryRow["style"],
    sourceCategoryId: r.sourceCategoryId ?? null,
    sourceCategoryLabel: r.sourceCategoryLabel ?? r.sourceCategory ?? null,
    sourcePhaseId: r.sourcePhaseId ?? null,
    sourceAdjustmentId: r.sourceAdjustmentId ?? null,
    computedValue: r.computedValue ?? 0,
    computedCost: r.computedCost ?? 0,
    computedMargin: r.computedMargin ?? 0,
  };
}

export function mapCondition(c: any): Condition {
  return { id: c.id, revisionId: c.revisionId, type: c.type, value: c.value, order: c.order };
}

export function mapRateScheduleTier(t: any): RateScheduleTier {
  return { id: t.id, scheduleId: t.scheduleId, name: t.name, multiplier: t.multiplier, sortOrder: t.sortOrder };
}

export function mapRateScheduleItem(i: any): RateScheduleItem {
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

export function mapRateSchedule(s: any): RateSchedule {
  return {
    id: s.id, organizationId: s.organizationId, name: s.name, description: s.description,
    category: s.category, scope: s.scope as RateSchedule["scope"],
    projectId: s.projectId ?? null, revisionId: s.revisionId ?? null,
    sourceScheduleId: s.sourceScheduleId ?? null,
    travelPolicyId: s.travelPolicyId ?? null,
    effectiveDate: s.effectiveDate ?? null, expiryDate: s.expiryDate ?? null,
    defaultMarkup: s.defaultMarkup, autoCalculate: s.autoCalculate,
    metadata: (s.metadata as Record<string, unknown>) ?? {},
    createdAt: toISO(s.createdAt), updatedAt: toISO(s.updatedAt),
  };
}

export function mapRateScheduleWithChildren(s: any): RateScheduleWithChildren {
  return {
    ...mapRateSchedule(s),
    tiers: (s.tiers ?? []).map(mapRateScheduleTier),
    items: (s.items ?? []).map(mapRateScheduleItem),
  };
}

export function mapLabourCostEntry(e: any): LabourCostEntry {
  return {
    id: e.id, tableId: e.tableId, code: e.code, name: e.name,
    group: e.group, costRates: (e.costRates as Record<string, number>) ?? {},
    metadata: (e.metadata as Record<string, unknown>) ?? {}, sortOrder: e.sortOrder,
  };
}

export function mapLabourCostTable(t: any): LabourCostTable {
  return {
    id: t.id, organizationId: t.organizationId, name: t.name,
    description: t.description, effectiveDate: t.effectiveDate ?? null,
    expiryDate: t.expiryDate ?? null,
    metadata: (t.metadata as Record<string, unknown>) ?? {},
    createdAt: toISO(t.createdAt), updatedAt: toISO(t.updatedAt),
  };
}

export function mapLabourCostTableWithEntries(t: any): LabourCostTableWithEntries {
  return {
    ...mapLabourCostTable(t),
    entries: (t.entries ?? []).map(mapLabourCostEntry),
  };
}

export function mapBurdenPeriod(b: any): BurdenPeriod {
  return {
    id: b.id, organizationId: b.organizationId, name: b.name,
    group: b.group, percentage: b.percentage,
    startDate: b.startDate, endDate: b.endDate,
    createdAt: toISO(b.createdAt), updatedAt: toISO(b.updatedAt),
  };
}

export function mapTravelPolicy(t: any): TravelPolicy {
  return {
    id: t.id, organizationId: t.organizationId, name: t.name,
    description: t.description, perDiemRate: t.perDiemRate,
    perDiemEmbedMode: t.perDiemEmbedMode, hoursPerDay: t.hoursPerDay,
    travelTimeHours: t.travelTimeHours, travelTimeTrips: t.travelTimeTrips,
    kmToDestination: t.kmToDestination, mileageRate: t.mileageRate,
    fuelSurchargePercent: t.fuelSurchargePercent,
    fuelSurchargeAppliesTo: t.fuelSurchargeAppliesTo,
    accommodationRate: t.accommodationRate, accommodationNights: t.accommodationNights,
    showAsSeparateLine: t.showAsSeparateLine, breakoutLabel: t.breakoutLabel,
    metadata: (t.metadata as Record<string, unknown>) ?? {},
    createdAt: toISO(t.createdAt), updatedAt: toISO(t.updatedAt),
  };
}

export function mapActivity(a: any): Activity {
  const data = (a.data as Record<string, unknown>) ?? {};
  return {
    id: a.id,
    projectId: a.projectId,
    revisionId: a.revisionId ?? null,
    type: a.type,
    data,
    userId: a.userId ?? (data.actorId as string | null) ?? null,
    userName: a.user?.name ?? (data.actorName as string | null) ?? null,
    revertible: false,
    createdAt: toISO(a.createdAt),
  };
}

export function mapReportSection(s: any): ReportSection {
  return { id: s.id, revisionId: s.revisionId, sectionType: s.sectionType, title: s.title, content: s.content, order: s.order, parentSectionId: s.parentSectionId ?? null };
}

export function mapCatalog(c: any): Catalog {
  return {
    id: c.id, name: c.name, kind: c.kind as Catalog["kind"], scope: c.scope as Catalog["scope"],
    projectId: c.projectId ?? null, description: c.description,
    source: c.source ?? "manual", sourceDescription: c.sourceDescription ?? "",
    isTemplate: c.isTemplate ?? false, sourceTemplateId: c.sourceTemplateId ?? null,
    itemCount: c._count?.items ?? undefined,
    createdAt: toISO(c.createdAt), updatedAt: toISO(c.updatedAt),
  };
}

export function mapCatalogItem(i: any): CatalogItem {
  return { id: i.id, catalogId: i.catalogId, code: i.code, name: i.name, unit: i.unit, unitCost: i.unitCost, unitPrice: i.unitPrice, metadata: (i.metadata as Record<string, unknown>) ?? {} };
}

export function mapAiRun(r: any): { id: string; projectId: string; revisionId: string | null; kind: string; status: string; model: string; promptVersion: string; input: Record<string, unknown>; output: Record<string, unknown>; createdAt: string; updatedAt: string } {
  return { id: r.id, projectId: r.projectId, revisionId: r.revisionId ?? null, kind: r.kind, status: r.status, model: r.model, promptVersion: r.promptVersion, input: (r.input as Record<string, unknown>) ?? {}, output: (r.output as Record<string, unknown>) ?? {}, createdAt: toISO(r.createdAt), updatedAt: toISO(r.updatedAt) };
}

export function mapEstimateStrategy(row: any): EstimateStrategy {
  return {
    id: row.id,
    projectId: row.projectId,
    revisionId: row.revisionId,
    aiRunId: row.aiRunId ?? null,
    personaId: row.personaId ?? null,
    status: row.status,
    currentStage: row.currentStage,
    scopeGraph: (row.scopeGraph as Record<string, unknown>) ?? {},
    executionPlan: (row.executionPlan as Record<string, unknown>) ?? {},
    assumptions: (row.assumptions as Array<Record<string, unknown>>) ?? [],
    packagePlan: (row.packagePlan as Array<Record<string, unknown>>) ?? [],
    benchmarkProfile: (row.benchmarkProfile as Record<string, unknown>) ?? {},
    benchmarkComparables: (row.benchmarkComparables as Array<Record<string, unknown>>) ?? [],
    adjustmentPlan: (row.adjustmentPlan as Array<Record<string, unknown>>) ?? [],
    reconcileReport: (row.reconcileReport as Record<string, unknown>) ?? {},
    confidenceSummary: (row.confidenceSummary as Record<string, unknown>) ?? {},
    summary: (row.summary as Record<string, unknown>) ?? {},
    reviewRequired: row.reviewRequired ?? true,
    reviewCompleted: row.reviewCompleted ?? false,
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  };
}

export function mapEstimateCalibrationFeedback(row: any): EstimateCalibrationFeedback {
  return {
    id: row.id,
    projectId: row.projectId,
    revisionId: row.revisionId,
    strategyId: row.strategyId ?? null,
    quoteReviewId: row.quoteReviewId ?? null,
    source: row.source,
    feedbackType: row.feedbackType,
    sourceLabel: row.sourceLabel ?? "",
    aiSnapshot: (row.aiSnapshot as Record<string, unknown>) ?? {},
    humanSnapshot: (row.humanSnapshot as Record<string, unknown>) ?? {},
    deltaSummary: (row.deltaSummary as Record<string, unknown>) ?? {},
    corrections: (row.corrections as Array<Record<string, unknown>>) ?? [],
    lessons: (row.lessons as Array<Record<string, unknown>>) ?? [],
    notes: row.notes ?? "",
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  };
}

export function mapCitation(c: any): { id: string; projectId: string; aiRunId: string | null; sourceDocumentId: string | null; resourceType: string; resourceKey: string; pageStart: number | null; pageEnd: number | null; excerpt: string; confidence: number } {
  return { id: c.id, projectId: c.projectId, aiRunId: c.aiRunId ?? null, sourceDocumentId: c.sourceDocumentId ?? null, resourceType: c.resourceType, resourceKey: c.resourceKey, pageStart: c.pageStart ?? null, pageEnd: c.pageEnd ?? null, excerpt: c.excerpt, confidence: c.confidence };
}

export function mapConditionLibrary(c: any): ConditionLibraryEntry {
  return { id: c.id, type: c.type, value: c.value };
}

export function mapJob(j: any): Job {
  return { id: j.id, projectId: j.projectId, revisionId: j.revisionId, name: j.name, foreman: j.foreman, projectManager: j.projectManager, startDate: j.startDate ?? null, shipDate: j.shipDate ?? null, poNumber: j.poNumber, poIssuer: j.poIssuer, status: j.status as Job["status"], createdAt: toISO(j.createdAt) };
}

export function mapFileNode(n: any): FileNode {
  return { id: n.id, projectId: n.projectId, parentId: n.parentId ?? null, name: n.name, type: n.type as FileNode["type"], scope: n.scope ?? "project", fileType: n.fileType ?? undefined, size: n.size ?? undefined, documentId: n.documentId ?? undefined, storagePath: n.storagePath ?? undefined, metadata: (n.metadata as Record<string, unknown>) ?? {}, createdAt: toISO(n.createdAt), updatedAt: toISO(n.updatedAt), createdBy: n.createdBy ?? undefined };
}

export function mapTakeoffAnnotation(a: any) {
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

export function mapTakeoffLink(l: any) {
  return {
    id: l.id,
    projectId: l.projectId,
    annotationId: l.annotationId,
    worksheetItemId: l.worksheetItemId,
    quantityField: l.quantityField ?? "value",
    multiplier: l.multiplier ?? 1.0,
    derivedQuantity: l.derivedQuantity ?? 0,
    createdAt: toISO(l.createdAt),
    updatedAt: toISO(l.updatedAt),
  };
}

export function mapPlugin(p: any): Plugin {
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

export function mapPluginExecution(e: any): PluginExecution {
  return {
    id: e.id,
    pluginId: e.pluginId,
    toolId: e.toolId,
    projectId: e.projectId,
    revisionId: e.revisionId,
    worksheetId: e.worksheetId ?? undefined,
    input: (e.input as Record<string, unknown>) ?? {},
    formState: (e.formState as Record<string, unknown>) ?? undefined,
    output: (e.output as any) ?? { type: "summary" },
    appliedLineItemIds: e.appliedLineItemIds ?? [],
    status: e.status as PluginExecution["status"],
    error: e.error ?? undefined,
    executedBy: e.executedBy as PluginExecution["executedBy"] ?? undefined,
    agentSessionId: e.agentSessionId ?? undefined,
    createdAt: toISO(e.createdAt),
  };
}

export function mapUser(u: any): User {
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

export function mapPersona(row: any): any {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    trade: row.trade,
    description: row.description,
    systemPrompt: row.systemPrompt,
    knowledgeBookIds: Array.isArray(row.knowledgeBookIds) ? row.knowledgeBookIds : JSON.parse(row.knowledgeBookIds || "[]"),
    datasetTags: Array.isArray(row.datasetTags) ? row.datasetTags : JSON.parse(row.datasetTags || "[]"),
    packageBuckets: Array.isArray(row.packageBuckets) ? row.packageBuckets : (row.packageBuckets ?? []),
    defaultAssumptions: (row.defaultAssumptions as Record<string, unknown>) ?? {},
    productivityGuidance: (row.productivityGuidance as Record<string, unknown>) ?? {},
    commercialGuidance: (row.commercialGuidance as Record<string, unknown>) ?? {},
    reviewFocusAreas: Array.isArray(row.reviewFocusAreas) ? row.reviewFocusAreas : (row.reviewFocusAreas ?? []),
    isDefault: row.isDefault,
    enabled: row.enabled,
    order: row.order,
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  };
}

export function mapKnowledgeBook(b: any): KnowledgeBook {
  return {
    id: b.id,
    cabinetId: b.cabinetId ?? null,
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

export function mapKnowledgeLibraryCabinet(c: any): KnowledgeLibraryCabinet {
  return {
    id: c.id,
    organizationId: c.organizationId,
    parentId: c.parentId ?? null,
    itemType: c.itemType as KnowledgeLibraryCabinet["itemType"],
    name: c.name,
    createdAt: toISO(c.createdAt),
    updatedAt: toISO(c.updatedAt),
  };
}

export function mapKnowledgeChunk(c: any): KnowledgeChunk {
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

export function mapDataset(d: any): Dataset & { tags?: string[]; sourceBookId?: string; sourcePages?: string } {
  return {
    id: d.id,
    cabinetId: d.cabinetId ?? null,
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
    tags: d.tags ?? [],
    sourceBookId: d.sourceBookId ?? null,
    sourcePages: d.sourcePages ?? null,
    createdAt: toISO(d.createdAt),
    updatedAt: toISO(d.updatedAt),
  };
}

export function mapDatasetRow(r: any): DatasetRow {
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

export function mapEntityCategory(e: any): EntityCategory {
  return {
    id: e.id,
    name: e.name,
    entityType: e.entityType,
    shortform: e.shortform,
    defaultUom: e.defaultUom,
    validUoms: e.validUoms ?? [],
    editableFields: (e.editableFields as any) ?? {},
    unitLabels: (e.unitLabels as any) ?? {},
    calculationType: normalizeCalculationType(e.calculationType),
    calcFormula: e.calcFormula ?? "",
    itemSource: (e.itemSource as EntityCategory["itemSource"]) ?? "freeform",
    catalogId: e.catalogId ?? null,
    color: e.color ?? "#6b7280",
    order: e.order ?? 0,
    isBuiltIn: e.isBuiltIn ?? false,
    enabled: e.enabled ?? true,
  };
}

export function mapStoredPackage(p: any): StoredPackageRecord {
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

export function mapCustomer(c: any): Customer {
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

export function mapCustomerContact(c: any): CustomerContact {
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

export function mapDepartment(d: any): Department {
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

export function mapIngestionJob(j: any): IngestionJobRecord {
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

export function mapWorkspaceState(ws: any): WorkspaceStateRecord {
  return {
    projectId: ws.projectId,
    state: (ws.state as Record<string, unknown>) ?? {},
    updatedAt: toISO(ws.updatedAt),
    storagePath: relativeWorkspacePath(ws.projectId),
  };
}
