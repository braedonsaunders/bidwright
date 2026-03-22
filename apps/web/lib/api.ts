const DEFAULT_API_BASE_URL = "http://localhost:4001";

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

function resolveApiUrl(path: string) {
  return new URL(path, apiBaseUrl).toString();
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(resolveApiUrl(path), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `API request failed for ${path} (${response.status} ${response.statusText})${errorBody ? `: ${errorBody}` : ""}`
    );
  }

  return (await response.json()) as T;
}

export interface ProjectListItem {
  id: string;
  name: string;
  clientName: string;
  location: string;
  packageName: string;
  packageUploadedAt: string;
  ingestionStatus: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  quote: {
    id: string;
    quoteNumber: string;
    title: string;
    status: string;
    currentRevisionId: string;
  };
  latestRevision: {
    id: string;
    revisionNumber: number;
    subtotal: number;
    estimatedProfit: number;
    estimatedMargin: number;
  };
}

export interface SourceDocument {
  id: string;
  projectId: string;
  fileName: string;
  fileType: string;
  documentType: string;
  pageCount: number;
  checksum: string;
  storagePath: string;
  extractedText: string;
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
  breakoutStyle: string;
  phaseWorksheetEnabled?: boolean;
  useCalculatedTotal: boolean;
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
  necaDifficulty: string;
  followUpNote: string;
  printEmptyNotesColumn: boolean;
  printCategory: string[];
  printPhaseTotalOnly: boolean;
  showOvertimeDoubletime: boolean;
  grandTotal: number;
  regHours: number;
  overHours: number;
  doubleHours: number;
  breakoutPackage: unknown[];
  calculatedCategoryTotals: unknown[];
  subtotal: number;
  cost: number;
  estimatedProfit: number;
  estimatedMargin: number;
  calculatedTotal?: number;
  totalHours: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceWorksheetItem {
  id: string;
  worksheetId: string;
  phaseId?: string | null;
  category: string;
  entityType: string;
  entityName: string;
  vendor?: string;
  description: string;
  quantity: number;
  uom: string;
  cost: number;
  markup: number;
  price: number;
  laborHourReg: number;
  laborHourOver: number;
  laborHourDouble: number;
  lineOrder: number;
}

export interface WorkspaceWorksheet {
  id: string;
  revisionId: string;
  name: string;
  order: number;
  items: WorkspaceWorksheetItem[];
}

export interface ProjectPhase {
  id: string;
  revisionId: string;
  number: string;
  name: string;
  description: string;
  order: number;
}

export interface ProjectModifier {
  id: string;
  revisionId: string;
  name: string;
  type: string;
  appliesTo: string;
  percentage: number | null;
  amount: number | null;
  show: string;
}

export interface ProjectCondition {
  id: string;
  revisionId: string;
  type: string;
  value: string;
  order: number;
}

export interface LabourRate {
  id: string;
  revisionId: string;
  name: string;
  regularRate: number;
  overtimeRate: number;
  doubleRate: number;
}

export interface AdditionalLineItem {
  id: string;
  revisionId: string;
  name: string;
  description: string;
  type: "OptionStandalone" | "OptionAdditional" | "LineItemAdditional" | "LineItemStandalone" | "CustomTotal";
  amount: number;
}

export interface Activity {
  id: string;
  projectId: string;
  revisionId: string | null;
  type: string;
  data: Record<string, unknown>;
  userId: string | null;
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

export interface CatalogItem {
  id: string;
  catalogId: string;
  code: string;
  name: string;
  unit: string;
  unitCost: number;
  unitPrice: number;
  metadata: Record<string, string | number | boolean | null>;
}

export interface CatalogSummary {
  id: string;
  name: string;
  kind: string;
  scope: string;
  projectId: string | null;
  description: string;
  items?: CatalogItem[];
}

export interface FileNode {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  type: "file" | "directory";
  fileType?: string;
  size?: number;
  documentId?: string;
  storagePath?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface Citation {
  id: string;
  projectId: string;
  aiRunId: string;
  sourceDocumentId: string;
  resourceType: string;
  resourceKey: string;
  pageStart: number;
  pageEnd: number;
  excerpt: string;
  confidence: number;
}

export interface AiRun {
  id: string;
  projectId: string;
  revisionId: string;
  kind: string;
  status: string;
  model: string;
  promptVersion: string;
  input: {
    sources: string[];
    question: string;
  };
  output?: {
    phases?: string[];
    riskFlags?: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface EstimateTotalBreakout {
  name: string;
  value: number;
  cost: number;
  margin: number;
  type?: string;
  entityId?: string | null;
  category?: Array<{
    name: string;
    value: number;
    cost: number;
    margin: number;
  }>;
}

export interface EstimateData {
  revisionId: string;
  totals: {
    subtotal: number;
    cost: number;
    estimatedProfit: number;
    estimatedMargin: number;
    totalHours: number;
    breakout: EstimateTotalBreakout[];
  };
  lineItems: WorkspaceWorksheetItem[];
  summary: {
    sourceDocumentCount: number;
    worksheetCount: number;
    lineItemCount: number;
    citationCount: number;
    aiRunCount: number;
  };
}

export interface ProjectWorkspaceData {
  project: ProjectListItem;
  sourceDocuments: SourceDocument[];
  quote: ProjectListItem["quote"] & {
    createdAt: string;
    updatedAt: string;
    projectId: string;
    customerExistingNew: "Existing" | "New";
    customerId: string | null;
    customerString: string;
    customerContactId: string | null;
    customerContactString: string;
    customerContactEmailString: string;
    departmentId: string | null;
    userId: string | null;
  };
  currentRevision: QuoteRevision;
  worksheets: WorkspaceWorksheet[];
  phases: ProjectPhase[];
  modifiers: ProjectModifier[];
  conditions: ProjectCondition[];
  additionalLineItems: AdditionalLineItem[];
  labourRates: LabourRate[];
  catalogs: CatalogSummary[];
  aiRuns: AiRun[];
  citations: Citation[];
  estimate: EstimateData;
}

export interface PackageRecord {
  id: string;
  projectId: string;
  packageName: string;
  originalFileName: string;
  sourceKind: string;
  storagePath: string;
  reportPath: string | null;
  chunksPath: string | null;
  checksum: string;
  totalBytes: number;
  status: string;
  documentCount: number;
  chunkCount: number;
  documentIds: string[];
  unknownFiles: string[];
  uploadedAt: string;
  ingestedAt: string | null;
  updatedAt: string;
  error: string | null;
}

export interface JobRecord {
  id: string;
  projectId: string;
  packageId: string | null;
  kind: string;
  status: string;
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

export interface WorkspaceResponse {
  workspace: ProjectWorkspaceData;
  workspaceState: WorkspaceStateRecord | null;
  summaryMetrics: Array<{
    label: string;
    value: number;
  }>;
  packages: PackageRecord[];
  jobs: JobRecord[];
  documents: SourceDocument[];
}

// ---------------------------------------------------------------------------
// Entity Categories
// ---------------------------------------------------------------------------

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
    laborHourReg: boolean;
    laborHourOver: boolean;
    laborHourDouble: boolean;
  };
  laborHourLabels: {
    reg: string;
    over: string;
    double: string;
  };
  calculationType: "auto_labour" | "auto_equipment" | "auto_stock" | "auto_consumable" | "direct_price" | "manual";
}

export async function getEntityCategories() {
  return apiRequest<EntityCategory[]>("/entity-categories");
}

// ---------------------------------------------------------------------------
// Read-only queries
// ---------------------------------------------------------------------------

export async function getProjects() {
  return apiRequest<ProjectListItem[]>("/projects");
}

export async function getProject(projectId: string) {
  const projects = await getProjects();
  return projects.find((project) => project.id === projectId) ?? null;
}

export async function getProjectWorkspace(projectId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/workspace`);
}

export async function getProjectEstimate(projectId: string) {
  return apiRequest<EstimateData>(`/projects/${projectId}/estimate`);
}

export async function getCatalogs() {
  return apiRequest<CatalogSummary[]>("/catalogs");
}

export async function getAiRuns() {
  return apiRequest<AiRun[]>("/ai/runs");
}

// ---------------------------------------------------------------------------
// Revision mutations
// ---------------------------------------------------------------------------

export interface RevisionPatchInput {
  title?: string;
  description?: string;
  notes?: string;
  breakoutStyle?: string;
  phaseWorksheetEnabled?: boolean;
  useCalculatedTotal?: boolean;
  type?: "Firm" | "Budget" | "BudgetDNE";
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
  status?: "Open" | "Pending" | "Awarded" | "DidNotGet" | "Declined" | "Cancelled" | "Closed" | "Other";
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
  customerExistingNew?: "Existing" | "New";
  customerId?: string | null;
  customerString?: string;
  customerContactId?: string | null;
  customerContactString?: string;
  customerContactEmailString?: string;
  departmentId?: string | null;
  userId?: string | null;
}

export async function updateRevision(projectId: string, revisionId: string, patch: RevisionPatchInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/revisions/${revisionId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

export async function createRevision(projectId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/revisions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
}

export async function deleteRevisionById(projectId: string, revisionId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/revisions/${revisionId}`, {
    method: "DELETE",
  });
}

export async function activateRevision(projectId: string, revisionId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/revisions/${revisionId}/activate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
}

export async function copyQuote(projectId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/copy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
}

export async function updateQuote(projectId: string, patch: QuotePatchInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/quote`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

export async function makeRevisionZero(projectId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/make-revision-zero`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
}

// ---------------------------------------------------------------------------
// Worksheet items
// ---------------------------------------------------------------------------

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
}

export async function updateWorksheetItem(projectId: string, itemId: string, patch: WorksheetItemPatchInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/worksheet-items/${itemId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

export async function createWorksheetItem(projectId: string, worksheetId: string, input: CreateWorksheetItemInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/worksheets/${worksheetId}/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function deleteWorksheetItem(projectId: string, itemId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/worksheet-items/${itemId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Worksheets
// ---------------------------------------------------------------------------

export interface CreateWorksheetInput {
  name: string;
}

export interface WorksheetPatchInput {
  name?: string;
  order?: number;
}

export async function createWorksheet(projectId: string, input: CreateWorksheetInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/worksheets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function updateWorksheet(projectId: string, worksheetId: string, patch: WorksheetPatchInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/worksheets/${worksheetId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

export async function deleteWorksheet(projectId: string, worksheetId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/worksheets/${worksheetId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

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
}

export async function createPhase(projectId: string, input: CreatePhaseInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/phases`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function updatePhase(projectId: string, phaseId: string, patch: PhasePatchInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/phases/${phaseId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

export async function deletePhase(projectId: string, phaseId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/phases/${phaseId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

export interface CreateModifierInput {
  name?: string;
  type?: string;
  appliesTo?: string;
  percentage?: number | null;
  amount?: number | null;
  show?: string;
}

export interface ModifierPatchInput {
  name?: string;
  type?: string;
  appliesTo?: string;
  percentage?: number | null;
  amount?: number | null;
  show?: string;
}

export async function getModifiers(projectId: string) {
  return apiRequest<ProjectModifier[]>(`/projects/${projectId}/modifiers`);
}

export async function createModifier(projectId: string, input: CreateModifierInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/modifiers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function updateModifier(projectId: string, modifierId: string, patch: ModifierPatchInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/modifiers/${modifierId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

export async function deleteModifier(projectId: string, modifierId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/modifiers/${modifierId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

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

export async function getConditionLibrary() {
  return apiRequest<ConditionLibraryEntry[]>("/conditions/library");
}

export async function getConditions(projectId: string) {
  return apiRequest<ProjectCondition[]>(`/projects/${projectId}/conditions`);
}

export async function createCondition(projectId: string, input: CreateConditionInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/conditions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function updateCondition(projectId: string, conditionId: string, patch: ConditionPatchInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/conditions/${conditionId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

export async function deleteCondition(projectId: string, conditionId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/conditions/${conditionId}`, {
    method: "DELETE",
  });
}

export async function reorderConditions(projectId: string, orderedIds: string[]) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/conditions/reorder`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ orderedIds }),
  });
}

// ---------------------------------------------------------------------------
// Additional Line Items
// ---------------------------------------------------------------------------

export interface CreateAdditionalLineItemInput {
  name?: string;
  description?: string;
  type?: "OptionStandalone" | "OptionAdditional" | "LineItemAdditional" | "LineItemStandalone" | "CustomTotal";
  amount?: number;
}

export interface AdditionalLineItemPatchInput {
  name?: string;
  description?: string;
  type?: "OptionStandalone" | "OptionAdditional" | "LineItemAdditional" | "LineItemStandalone" | "CustomTotal";
  amount?: number;
}

export async function getAdditionalLineItems(projectId: string) {
  return apiRequest<AdditionalLineItem[]>(`/projects/${projectId}/additional-line-items`);
}

export async function createAdditionalLineItem(projectId: string, input: CreateAdditionalLineItemInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/additional-line-items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function updateAdditionalLineItem(projectId: string, aliId: string, patch: AdditionalLineItemPatchInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/additional-line-items/${aliId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

export async function deleteAdditionalLineItem(projectId: string, aliId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/additional-line-items/${aliId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Labour Rates
// ---------------------------------------------------------------------------

export interface CreateLabourRateInput {
  name?: string;
  regularRate?: number;
  overtimeRate?: number;
  doubleRate?: number;
}

export interface LabourRatePatchInput {
  name?: string;
  regularRate?: number;
  overtimeRate?: number;
  doubleRate?: number;
}

export async function getLabourRates(projectId: string) {
  return apiRequest<LabourRate[]>(`/projects/${projectId}/labour-rates`);
}

export async function createLabourRate(projectId: string, input: CreateLabourRateInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/labour-rates`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function updateLabourRate(projectId: string, rateId: string, patch: LabourRatePatchInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/labour-rates/${rateId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

export async function deleteLabourRate(projectId: string, rateId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/labour-rates/${rateId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export async function getActivities(projectId: string) {
  return apiRequest<Activity[]>(`/projects/${projectId}/activities`);
}

// ---------------------------------------------------------------------------
// Report Sections
// ---------------------------------------------------------------------------

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

export async function getReportSections(projectId: string) {
  return apiRequest<ReportSection[]>(`/projects/${projectId}/report-sections`);
}

export async function createReportSection(projectId: string, input: CreateReportSectionInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/report-sections`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function updateReportSection(projectId: string, sectionId: string, patch: ReportSectionPatchInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/report-sections/${sectionId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

export async function deleteReportSection(projectId: string, sectionId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/report-sections/${sectionId}`, {
    method: "DELETE",
  });
}

export async function reorderReportSections(projectId: string, orderedIds: string[]) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/report-sections/reorder`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ orderedIds }),
  });
}

// ---------------------------------------------------------------------------
// Project Status
// ---------------------------------------------------------------------------

export async function updateProjectStatus(projectId: string, status: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });
}

// ---------------------------------------------------------------------------
// Package Ingestion
// ---------------------------------------------------------------------------

export interface PackageIngestInput {
  file: File;
  projectId?: string;
  packageName?: string;
  clientName?: string;
  location?: string;
  dueDate?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export function getQuotePdfUrl(projectId: string, templateType: string): string {
  return resolveApiUrl(`/projects/${projectId}/pdf/${templateType}`);
}

// ---------------------------------------------------------------------------
// Send quote
// ---------------------------------------------------------------------------

export async function sendQuote(projectId: string, input: { contacts: string[]; message: string }) {
  return apiRequest<{ sent: boolean; message: string }>(`/projects/${projectId}/send-quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Delete project
// ---------------------------------------------------------------------------

export async function deleteProject(projectId: string) {
  return apiRequest<{ deleted: boolean }>(`/projects/${projectId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export async function aiRewriteDescription(projectId: string) {
  return apiRequest<{ description: string }>(`/projects/${projectId}/ai/description`, {
    method: "POST",
  });
}

export async function aiRewriteNotes(projectId: string) {
  return apiRequest<{ notes: string }>(`/projects/${projectId}/ai/notes`, {
    method: "POST",
  });
}

export async function aiSuggestPhases(projectId: string) {
  return apiRequest<{ phases: Array<{ number: string; name: string; description: string }> }>(
    `/projects/${projectId}/ai/phases`,
    { method: "POST" }
  );
}

export async function aiAcceptPhases(
  projectId: string,
  phases: Array<{ number: string; name: string; description: string }>
) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/ai/phases/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phases }),
  });
}

export async function aiSuggestEquipment(projectId: string) {
  return apiRequest<{
    equipment: Array<{
      name: string;
      description: string;
      quantity: number;
      duration: number;
      estimatedCost: number;
    }>;
  }>(`/projects/${projectId}/ai/equipment`, { method: "POST" });
}

export async function aiAcceptEquipment(projectId: string, equipment: unknown[]) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/ai/equipment/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ equipment }),
  });
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function createProjectJob(
  projectId: string,
  input: {
    name: string;
    foreman?: string;
    projectManager?: string;
    startDate?: string;
    shipDate?: string;
    poNumber?: string;
    poIssuer?: string;
  }
) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Package Ingestion
// ---------------------------------------------------------------------------

export async function submitPackageIngest(input: PackageIngestInput) {
  const formData = new FormData();
  formData.append("file", input.file);

  if (input.packageName) formData.append("packageName", input.packageName);
  if (input.clientName) formData.append("clientName", input.clientName);
  if (input.location) formData.append("location", input.location);
  if (input.dueDate) formData.append("dueDate", input.dueDate);
  if (input.notes) formData.append("notes", input.notes);

  const path = input.projectId ? `/projects/${input.projectId}/packages/upload` : "/ingestion/package";

  const response = await fetch(resolveApiUrl(path), {
    method: "POST",
    body: formData,
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    throw new Error(
      `Upload failed for ${path} (${response.status} ${response.statusText})${body ? `: ${typeof body === "string" ? body : JSON.stringify(body)}` : ""}`
    );
  }

  return body ?? { ok: true, status: response.status };
}

// ---------------------------------------------------------------------------
// Jobs (all)
// ---------------------------------------------------------------------------

export interface JobItem {
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
  status: string;
  createdAt: string;
}

export async function listAllJobs() {
  return apiRequest<JobItem[]>("/jobs");
}

// ---------------------------------------------------------------------------
// Import BOM
// ---------------------------------------------------------------------------

export interface ImportPreviewResponse {
  headers: string[];
  sampleRows: string[][];
  fileId: string;
}

export async function importPreview(projectId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(resolveApiUrl(`/projects/${projectId}/import-preview`), {
    method: "POST",
    body: formData,
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Import preview failed (${response.status} ${response.statusText})${errorBody ? `: ${errorBody}` : ""}`
    );
  }

  return (await response.json()) as ImportPreviewResponse;
}

export async function importProcess(
  projectId: string,
  input: { fileId: string; worksheetId: string; mapping: Record<string, string> }
) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/import-process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Catalog CRUD
// ---------------------------------------------------------------------------

export async function createCatalog(input: {
  name: string;
  kind: string;
  scope: string;
  projectId?: string | null;
  description?: string;
}) {
  return apiRequest<CatalogSummary>("/catalogs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateCatalog(catalogId: string, patch: Partial<CatalogSummary>) {
  return apiRequest<CatalogSummary>(`/catalogs/${catalogId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteCatalog(catalogId: string) {
  return apiRequest<{ deleted: boolean }>(`/catalogs/${catalogId}`, {
    method: "DELETE",
  });
}

export async function listCatalogItems(catalogId: string) {
  return apiRequest<CatalogItem[]>(`/catalogs/${catalogId}/items`);
}

export async function createCatalogItem(
  catalogId: string,
  input: { code: string; name: string; unit: string; unitCost: number; unitPrice: number; category?: string; metadata?: Record<string, unknown> }
) {
  return apiRequest<CatalogItem>(`/catalogs/${catalogId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateCatalogItem(
  catalogId: string,
  itemId: string,
  patch: Partial<CatalogItem> & { category?: string }
) {
  return apiRequest<CatalogItem>(`/catalogs/${catalogId}/items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteCatalogItem(catalogId: string, itemId: string) {
  return apiRequest<{ deleted: boolean }>(`/catalogs/${catalogId}/items/${itemId}`, {
    method: "DELETE",
  });
}

export async function searchCatalogItems(query: string, catalogId?: string) {
  const params = new URLSearchParams({ q: query });
  if (catalogId) params.set("catalogId", catalogId);
  return apiRequest<CatalogItem[]>(`/catalogs/search?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// File Node CRUD
// ---------------------------------------------------------------------------

export async function listFileNodes(projectId: string, parentId?: string) {
  const params = parentId ? `?parentId=${parentId}` : "";
  return apiRequest<FileNode[]>(`/projects/${projectId}/files${params}`);
}

export async function getFileTree(projectId: string) {
  return apiRequest<FileNode[]>(`/projects/${projectId}/files/tree`);
}

export async function createFileNode(
  projectId: string,
  input: { parentId?: string | null; name: string; type: "file" | "directory"; fileType?: string; size?: number; documentId?: string; metadata?: Record<string, unknown> }
) {
  return apiRequest<FileNode>(`/projects/${projectId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateFileNode(
  projectId: string,
  nodeId: string,
  patch: { name?: string; parentId?: string | null }
) {
  return apiRequest<FileNode>(`/projects/${projectId}/files/${nodeId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteFileNode(projectId: string, nodeId: string) {
  return apiRequest<{ deleted: boolean }>(`/projects/${projectId}/files/${nodeId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

// Re-export domain types for the plugin system
export type {
  Plugin as PluginRecord,
  PluginExecution as PluginExecutionRecord,
  PluginToolDefinition,
  PluginUISchema,
  PluginUISection,
  PluginField,
  PluginFieldOption,
  PluginFieldType,
  PluginFieldValidation,
  PluginFieldConditional,
  PluginTable,
  PluginTableColumn,
  PluginScoring,
  PluginScoringCriterion,
  PluginFieldGroup,
  PluginOutput,
  PluginOutputLineItem,
  PluginOutputWorksheet,
  PluginOutputTextContent,
  PluginOutputRevisionPatch,
  PluginOutputScore,
  PluginOutputSummary,
  PluginConfigField,
} from "@bidwright/domain";

export async function listPlugins() {
  return apiRequest<PluginRecord[]>("/plugins");
}

export async function getPlugin(pluginId: string) {
  return apiRequest<PluginRecord>(`/plugins/${pluginId}`);
}

export async function updatePlugin(pluginId: string, patch: Record<string, unknown>) {
  return apiRequest<PluginRecord>(`/plugins/${pluginId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function createPlugin(input: Record<string, unknown>) {
  return apiRequest<PluginRecord>("/plugins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deletePlugin(pluginId: string) {
  return apiRequest<PluginRecord>(`/plugins/${pluginId}`, { method: "DELETE" });
}

export async function executePlugin(
  pluginId: string,
  toolId: string,
  projectId: string,
  revisionId: string,
  input: Record<string, unknown>,
  opts?: { worksheetId?: string; formState?: Record<string, unknown>; executedBy?: "user" | "agent"; agentSessionId?: string },
) {
  return apiRequest<PluginExecutionRecord>(`/plugins/${pluginId}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toolId, projectId, revisionId, input, ...opts }),
  });
}

export async function listPluginExecutions(projectId: string) {
  return apiRequest<PluginExecutionRecord[]>(`/projects/${projectId}/plugin-executions`);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface AppSettingsRecord {
  general: { orgName: string; address: string; phone: string; website: string; logoUrl: string };
  email: { host: string; port: number; username: string; password: string; fromAddress: string; fromName: string };
  defaults: { defaultMarkup: number; breakoutStyle: string; quoteType: string };
  integrations: { openaiKey: string; anthropicKey: string; openrouterKey: string; geminiKey: string; llmProvider: string; llmModel: string };
}

export async function getSettings() {
  return apiRequest<AppSettingsRecord>("/settings");
}

export async function updateSettings(patch: Partial<AppSettingsRecord>) {
  return apiRequest<AppSettingsRecord>("/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "estimator" | "viewer";
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export async function login(email: string, password?: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<{ ok: boolean }> {
  const token = typeof window !== "undefined" ? localStorage.getItem("bw_token") ?? "" : "";
  return apiRequest<{ ok: boolean }>("/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ token }),
  });
}

export async function getCurrentUser(): Promise<AuthUser> {
  const token = typeof window !== "undefined" ? localStorage.getItem("bw_token") ?? "" : "";
  return apiRequest<AuthUser>("/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function listUsers(): Promise<AuthUser[]> {
  return apiRequest<AuthUser[]>("/users");
}

export async function createUser(input: { email: string; name: string; role: "admin" | "estimator" | "viewer"; password?: string }): Promise<AuthUser> {
  return apiRequest<AuthUser>("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateUser(userId: string, patch: Partial<{ email: string; name: string; role: "admin" | "estimator" | "viewer"; active: boolean; password: string }>): Promise<AuthUser> {
  return apiRequest<AuthUser>(`/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteUser(userId: string): Promise<AuthUser> {
  return apiRequest<AuthUser>(`/users/${userId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Knowledge Books
// ---------------------------------------------------------------------------

export interface KnowledgeBookRecord {
  id: string;
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
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunkRecord {
  id: string;
  bookId: string;
  pageNumber: number | null;
  sectionTitle: string;
  text: string;
  tokenCount: number;
  order: number;
  metadata: Record<string, unknown>;
}

export async function listKnowledgeBooks(projectId?: string) {
  const params = projectId ? `?projectId=${projectId}` : "";
  return apiRequest<KnowledgeBookRecord[]>(`/knowledge/books${params}`);
}

export async function getKnowledgeBook(bookId: string) {
  return apiRequest<KnowledgeBookRecord>(`/knowledge/books/${bookId}`);
}

export async function createKnowledgeBook(input: {
  name: string; description: string;
  category: KnowledgeBookRecord["category"]; scope: KnowledgeBookRecord["scope"];
  projectId?: string | null; sourceFileName: string; sourceFileSize: number;
}) {
  return apiRequest<KnowledgeBookRecord>("/knowledge/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateKnowledgeBook(bookId: string, patch: Partial<KnowledgeBookRecord>) {
  return apiRequest<KnowledgeBookRecord>(`/knowledge/books/${bookId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteKnowledgeBook(bookId: string) {
  return apiRequest<KnowledgeBookRecord>(`/knowledge/books/${bookId}`, {
    method: "DELETE",
  });
}

export async function listKnowledgeChunks(bookId: string) {
  return apiRequest<KnowledgeChunkRecord[]>(`/knowledge/books/${bookId}/chunks`);
}

export async function createKnowledgeChunk(bookId: string, input: {
  pageNumber?: number | null; sectionTitle: string; text: string; tokenCount?: number; order?: number;
}) {
  return apiRequest<KnowledgeChunkRecord>(`/knowledge/books/${bookId}/chunks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function createKnowledgeChunksBatch(bookId: string, chunks: Array<{
  pageNumber?: number | null; sectionTitle: string; text: string; tokenCount?: number; order?: number;
}>) {
  return apiRequest<KnowledgeChunkRecord[]>(`/knowledge/books/${bookId}/chunks/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(chunks),
  });
}

export async function searchKnowledge(query: string, bookId?: string, limit?: number) {
  const params = new URLSearchParams({ q: query });
  if (bookId) params.set("bookId", bookId);
  if (limit) params.set("limit", String(limit));
  return apiRequest<KnowledgeChunkRecord[]>(`/knowledge/search?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

export interface DatasetColumnRecord {
  key: string;
  name: string;
  type: "text" | "number" | "currency" | "percentage" | "boolean" | "select";
  required: boolean;
  options?: string[];
  unit?: string;
}

export interface DatasetRecord {
  id: string;
  name: string;
  description: string;
  category: "labour_units" | "equipment_rates" | "material_prices" | "productivity" | "burden_rates" | "custom";
  scope: "global" | "project";
  projectId: string | null;
  columns: DatasetColumnRecord[];
  rowCount: number;
  source: "manual" | "import" | "ai_generated" | "plugin";
  sourceDescription: string;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetRowRecord {
  id: string;
  datasetId: string;
  data: Record<string, unknown>;
  order: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export async function listDatasets(projectId?: string) {
  const params = projectId ? `?projectId=${projectId}` : "";
  return apiRequest<DatasetRecord[]>(`/datasets${params}`);
}

export async function getDataset(datasetId: string) {
  return apiRequest<DatasetRecord>(`/datasets/${datasetId}`);
}

export async function createDataset(input: {
  name: string; description: string;
  category: DatasetRecord["category"]; scope: DatasetRecord["scope"];
  projectId?: string | null; columns: DatasetColumnRecord[];
  source?: DatasetRecord["source"]; sourceDescription?: string;
}) {
  return apiRequest<DatasetRecord>("/datasets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateDataset(datasetId: string, patch: Partial<DatasetRecord>) {
  return apiRequest<DatasetRecord>(`/datasets/${datasetId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteDataset(datasetId: string) {
  return apiRequest<DatasetRecord>(`/datasets/${datasetId}`, {
    method: "DELETE",
  });
}

export async function listDatasetRows(datasetId: string, opts?: { filter?: string; sort?: string; limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (opts?.filter) params.set("filter", opts.filter);
  if (opts?.sort) params.set("sort", opts.sort);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return apiRequest<{ rows: DatasetRowRecord[]; total: number }>(`/datasets/${datasetId}/rows${qs ? `?${qs}` : ""}`);
}

export async function createDatasetRow(datasetId: string, data: Record<string, unknown>) {
  return apiRequest<DatasetRowRecord>(`/datasets/${datasetId}/rows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
}

export async function createDatasetRowsBatch(datasetId: string, rows: Array<Record<string, unknown>>) {
  return apiRequest<DatasetRowRecord[]>(`/datasets/${datasetId}/rows/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
}

export async function updateDatasetRow(datasetId: string, rowId: string, data: Record<string, unknown>) {
  return apiRequest<DatasetRowRecord>(`/datasets/${datasetId}/rows/${rowId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
}

export async function deleteDatasetRow(datasetId: string, rowId: string) {
  return apiRequest<DatasetRowRecord>(`/datasets/${datasetId}/rows/${rowId}`, {
    method: "DELETE",
  });
}

export async function searchDatasetRows(datasetId: string, query: string) {
  const params = new URLSearchParams({ q: query });
  return apiRequest<DatasetRowRecord[]>(`/datasets/${datasetId}/search?${params.toString()}`);
}

export async function queryDataset(datasetId: string, filters: Array<{ column: string; op: string; value: unknown }>) {
  return apiRequest<DatasetRowRecord[]>(`/datasets/${datasetId}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filters }),
  });
}
