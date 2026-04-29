export { apiBaseUrl, apiRequest, resolveApiUrl } from "./api/client";
export * from "./api/settings";
export * from "./api/auth";

import { apiBaseUrl, apiRequest, resolveApiUrl } from "./api/client";

export interface ProjectListItem {
  id: string;
  name: string;
  clientName: string;
  location: string;
  scope: string;
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
    customerId?: string | null;
    customerName?: string | null;
    customerString?: string;
    userId?: string | null;
    userName?: string | null;
    departmentId?: string | null;
    departmentName?: string | null;
  } | null;
  latestRevision: {
    id: string;
    revisionNumber: number;
    subtotal: number;
    estimatedProfit: number;
    estimatedMargin: number;
  } | null;
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
  documentType: string;
  pageCount: number;
  checksum: string;
  storagePath: string;
  extractedText: string;
  structuredData?: SourceDocumentStructuredData | null;
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
  grandTotal: number;
  regHours: number;
  overHours: number;
  doubleHours: number;
  breakoutPackage: unknown[];
  calculatedCategoryTotals: unknown[];
  summaryLayoutPreset: SummaryPreset;
  pdfPreferences: Record<string, unknown>;
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
  unit1: number;
  unit2: number;
  unit3: number;
  lineOrder: number;
  rateScheduleItemId?: string | null;
  itemId?: string | null;
  tierUnits?: Record<string, number>;
  sourceNotes?: string;
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
  startDate?: string | null;
  endDate?: string | null;
  color?: string;
}

// ── Schedule Types ──────────────────────────────────────────────────────

export type ScheduleTaskType = "task" | "milestone" | "summary";
export type ScheduleTaskStatus = "not_started" | "in_progress" | "complete" | "on_hold";
export type DependencyType = "FS" | "SS" | "FF" | "SF";
export type ScheduleConstraintType = "asap" | "alap" | "snet" | "snlt" | "fnet" | "fnlt" | "mso" | "mfo";
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

export type AdjustmentKind = "modifier" | "line_item";
export type AdjustmentPricingMode =
  | "modifier"
  | "option_standalone"
  | "option_additional"
  | "line_item_additional"
  | "line_item_standalone"
  | "custom_total";

export interface ProjectAdjustment {
  id: string;
  revisionId: string;
  order: number;
  kind: AdjustmentKind;
  pricingMode: AdjustmentPricingMode;
  name: string;
  description: string;
  type: string;
  appliesTo: string;
  percentage: number | null;
  amount: number | null;
  show: "Yes" | "No";
}

export interface ProjectCondition {
  id: string;
  revisionId: string;
  type: string;
  value: string;
  order: number;
}

export interface AdditionalLineItem {
  id: string;
  revisionId: string;
  name: string;
  description: string;
  type: "OptionStandalone" | "OptionAdditional" | "LineItemAdditional" | "LineItemStandalone" | "CustomTotal";
  amount: number;
}

export type SummaryRowType = "category" | "phase" | "adjustment" | "heading" | "separator" | "subtotal";
export type SummaryRowStyle = "normal" | "bold" | "indent" | "highlight";
export type SummaryPreset = "quick_total" | "by_category" | "by_phase" | "phase_x_category" | "custom";
export type SummaryBuilderMode = "total" | "grouped" | "pivot";
export type SummaryBuilderDimension = "none" | "phase" | "category";

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
  totals: {
    label: string;
    visible: boolean;
  };
}

export interface SummaryRowData {
  id: string;
  revisionId: string;
  type: SummaryRowType;
  label: string;
  order: number;
  visible: boolean;
  style: SummaryRowStyle;
  sourceCategoryId?: string | null;
  sourceCategoryLabel?: string | null;
  sourcePhaseId?: string | null;
  sourceAdjustmentId?: string | null;
  computedValue: number;
  computedCost: number;
  computedMargin: number;
}

export interface SummaryRowInput {
  type?: SummaryRowType;
  label?: string;
  order?: number;
  visible?: boolean;
  style?: SummaryRowStyle;
  sourceCategoryId?: string | null;
  sourceCategoryLabel?: string | null;
  sourcePhaseId?: string | null;
  sourceAdjustmentId?: string | null;
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
  source: string;
  sourceDescription: string;
  isTemplate: boolean;
  sourceTemplateId: string | null;
  itemCount?: number;
  items?: CatalogItem[];
  createdAt: string;
  updatedAt: string;
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

export interface SourceTotalEntry {
  id: string;
  name: string;
  label: string;
  value: number;
  cost: number;
  margin: number;
  phaseId?: string | null;
  phaseLabel?: string | null;
}

export interface AdjustmentTotalEntry {
  id: string;
  label: string;
  kind: AdjustmentKind;
  pricingMode: AdjustmentPricingMode;
  type: string;
  appliesTo: string;
  show: "Yes" | "No";
  affectsSubtotal: boolean;
  value: number;
  cost: number;
  margin: number;
}

export interface EstimateData {
  revisionId: string;
  totals: {
    subtotal: number;
    cost: number;
    estimatedProfit: number;
    estimatedMargin: number;
    calculatedTotal?: number;
    regHours?: number;
    overHours?: number;
    doubleHours?: number;
    totalHours: number;
    categoryTotals: SourceTotalEntry[];
    phaseTotals: SourceTotalEntry[];
    phaseCategoryTotals: SourceTotalEntry[];
    adjustmentTotals: AdjustmentTotalEntry[];
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

export interface EstimateStrategy {
  id: string;
  projectId: string;
  revisionId: string;
  aiRunId?: string | null;
  personaId?: string | null;
  status: "draft" | "in_progress" | "ready_for_review" | "complete";
  currentStage: "scope" | "execution" | "packaging" | "benchmark" | "reconcile" | "complete";
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

export interface ProjectWorkspaceData {
  project: ProjectListItem;
  sourceDocuments: SourceDocument[];
  quote: ProjectListItem["quote"] & {
    createdAt: string;
    updatedAt: string;
    projectId: string;
    customerExistingNew: "Existing" | "New";
    customerId: string | null;
    customerName?: string | null;
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
  adjustments: ProjectAdjustment[];
  modifiers: ProjectModifier[];
  conditions: ProjectCondition[];
  additionalLineItems: AdditionalLineItem[];
  summaryBuilder?: SummaryBuilderConfig | null;
  summaryRows: SummaryRowData[];
  rateSchedules: RateSchedule[];
  catalogs: CatalogSummary[];
  aiRuns: AiRun[];
  citations: Citation[];
  scheduleTasks: ScheduleTask[];
  scheduleDependencies: ScheduleDependency[];
  scheduleCalendars: ScheduleCalendar[];
  scheduleBaselines: ScheduleBaseline[];
  scheduleBaselineTasks: ScheduleBaselineTask[];
  scheduleResources: ScheduleResource[];
  scheduleTaskAssignments: ScheduleTaskAssignment[];
  estimate: EstimateData;
  takeoffLinks?: TakeoffLinkRecord[];
  estimateStrategy?: EstimateStrategy | null;
  estimateFeedback?: EstimateCalibrationFeedback[];
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

export async function updateWorkspaceState(projectId: string, patch: Record<string, unknown>) {
  return apiRequest<WorkspaceStateRecord>(`/projects/${projectId}/workspace-state`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

// ---------------------------------------------------------------------------
// Entity Categories
// ---------------------------------------------------------------------------

export type CalculationType =
  | "manual"
  | "unit_markup"
  | "quantity_markup"
  | "tiered_rate"
  | "duration_rate"
  | "direct_total"
  | "formula";

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
    unit1: boolean;
    unit2: boolean;
    unit3: boolean;
  };
  unitLabels: {
    unit1: string;
    unit2: string;
    unit3: string;
  };
  calculationType: CalculationType;
  calcFormula: string;
  itemSource: "rate_schedule" | "catalog" | "freeform";
  catalogId?: string | null;
  color: string;
  order: number;
  isBuiltIn: boolean;
  enabled: boolean;
}

export async function getEntityCategories() {
  return apiRequest<EntityCategory[]>("/entity-categories");
}

export async function createEntityCategory(input: Partial<EntityCategory>) {
  return apiRequest<EntityCategory>("/entity-categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateEntityCategory(id: string, patch: Partial<EntityCategory>) {
  return apiRequest<EntityCategory>(`/entity-categories/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteEntityCategory(id: string) {
  return apiRequest<{ deleted: boolean }>(`/entity-categories/${id}`, {
    method: "DELETE",
  });
}

export async function reorderEntityCategories(orderedIds: string[]) {
  return apiRequest<void>("/entity-categories/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderedIds }),
  });
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

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

export async function getCustomers() {
  return apiRequest<Customer[]>("/customers");
}

export async function searchCustomers(query: string) {
  return apiRequest<Customer[]>(`/customers?q=${encodeURIComponent(query)}`);
}

export async function getCustomer(id: string) {
  return apiRequest<CustomerWithContacts>(`/customers/${id}`);
}

export async function createCustomer(input: Partial<Customer>) {
  return apiRequest<Customer>("/customers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateCustomer(id: string, patch: Partial<Customer>) {
  return apiRequest<Customer>(`/customers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteCustomer(id: string) {
  return apiRequest<{ deleted: boolean }>(`/customers/${id}`, {
    method: "DELETE",
  });
}

// Customer Contacts

export async function getCustomerContacts(customerId: string) {
  return apiRequest<CustomerContact[]>(`/customers/${customerId}/contacts`);
}

export async function createCustomerContact(customerId: string, input: Partial<CustomerContact>) {
  return apiRequest<CustomerContact>(`/customers/${customerId}/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateCustomerContact(customerId: string, contactId: string, patch: Partial<CustomerContact>) {
  return apiRequest<CustomerContact>(`/customers/${customerId}/contacts/${contactId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteCustomerContact(customerId: string, contactId: string) {
  return apiRequest<{ deleted: boolean }>(`/customers/${customerId}/contacts/${contactId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

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

export async function getDepartments() {
  return apiRequest<Department[]>("/departments");
}

export async function createDepartment(input: Partial<Department>) {
  return apiRequest<Department>("/departments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateDepartment(id: string, patch: Partial<Department>) {
  return apiRequest<Department>(`/departments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteDepartment(id: string) {
  return apiRequest<{ deleted: boolean }>(`/departments/${id}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Read-only queries
// ---------------------------------------------------------------------------

export interface OrgUser {
  id: string;
  name: string;
  email: string;
}

export interface OrgDepartment {
  id: string;
  name: string;
}

export interface ProjectsResponse {
  projects: ProjectListItem[];
  users: OrgUser[];
  departments: OrgDepartment[];
}

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

export interface CreateProjectResult {
  project: ProjectListItem;
  quote: ProjectListItem["quote"];
  revision: QuoteRevision | null;
  workspaceState: WorkspaceStateRecord | null;
}

export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
  return apiRequest<CreateProjectResult>("/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getProjects(): Promise<ProjectListItem[]> {
  const res = await apiRequest<ProjectListItem[] | ProjectsResponse>("/projects");
  // Handle both old (array) and new (object with users/departments) response shapes
  return Array.isArray(res) ? res : res.projects;
}

export async function getProjectsWithFilters(): Promise<ProjectsResponse> {
  const res = await apiRequest<ProjectListItem[] | ProjectsResponse>("/projects");
  if (Array.isArray(res)) return { projects: res, users: [], departments: [] };
  return res;
}

export async function getProject(projectId: string) {
  const projects = await getProjects();
  return projects.find((project) => project.id === projectId) ?? null;
}

export async function getProjectWorkspace(projectId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/workspace`);
}

export async function getEstimateStrategy(projectId: string) {
  return apiRequest<{ strategy: EstimateStrategy | null; feedback: EstimateCalibrationFeedback[] }>(`/api/estimate/${projectId}/strategy`);
}

export async function recomputeEstimateBenchmarks(projectId: string) {
  return apiRequest<WorkspaceResponse>(`/api/estimate/${projectId}/benchmarks/recompute`, {
    method: "POST",
  });
}

export async function finalizeEstimateStrategy(projectId: string, summary: Record<string, unknown>) {
  return apiRequest<WorkspaceResponse>(`/api/estimate/${projectId}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(summary),
  });
}

export async function saveEstimateFeedback(projectId: string, input: {
  source?: string;
  feedbackType?: string;
  sourceLabel?: string;
  humanSnapshot: Record<string, unknown>;
  corrections?: Array<Record<string, unknown>>;
  lessons?: Array<Record<string, unknown>>;
  notes?: string;
  quoteReviewId?: string | null;
}) {
  return apiRequest<WorkspaceResponse>(`/api/estimate/${projectId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
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
  unit1?: number;
  unit2?: number;
  unit3?: number;
  lineOrder?: number;
  rateScheduleItemId?: string | null;
  itemId?: string | null;
  tierUnits?: Record<string, number>;
  sourceNotes?: string;
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
  unit1: number;
  unit2: number;
  unit3: number;
  lineOrder?: number;
  rateScheduleItemId?: string | null;
  itemId?: string | null;
  tierUnits?: Record<string, number>;
  sourceNotes?: string;
}

export interface WorksheetItemMutationResponse {
  mode: "create" | "update" | "delete";
  item: WorkspaceWorksheetItem;
  currentRevision: QuoteRevision;
  estimateTotals: EstimateData["totals"];
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

export async function updateWorksheetItemFast(
  projectId: string,
  itemId: string,
  patch: WorksheetItemPatchInput,
) {
  return apiRequest<WorksheetItemMutationResponse>(
    `/projects/${projectId}/worksheet-items/${itemId}?response=delta`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    },
  );
}

export async function createWorksheetItemFast(
  projectId: string,
  worksheetId: string,
  input: CreateWorksheetItemInput,
) {
  return apiRequest<WorksheetItemMutationResponse>(
    `/projects/${projectId}/worksheets/${worksheetId}/items?response=delta`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
}

export async function deleteWorksheetItemFast(projectId: string, itemId: string) {
  return apiRequest<WorksheetItemMutationResponse>(
    `/projects/${projectId}/worksheet-items/${itemId}?response=delta`,
    {
      method: "DELETE",
    },
  );
}

export async function reorderWorksheetItems(
  projectId: string,
  worksheetId: string,
  orderedIds: string[]
): Promise<WorkspaceResponse> {
  return apiRequest<WorkspaceResponse>(
    `/projects/${projectId}/worksheets/${worksheetId}/items/reorder`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    }
  );
}

export async function importWorksheetItems(
  projectId: string,
  worksheetId: string,
  items: Array<Record<string, unknown>>
): Promise<WorkspaceResponse> {
  return apiRequest<WorkspaceResponse>(
    `/projects/${projectId}/worksheets/${worksheetId}/import`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    }
  );
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
  startDate?: string | null;
  endDate?: string | null;
  color?: string;
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
// Schedule Tasks
// ---------------------------------------------------------------------------

export interface CreateScheduleTaskInput {
  phaseId?: string | null;
  calendarId?: string | null;
  parentTaskId?: string | null;
  outlineLevel?: number;
  name?: string;
  description?: string;
  taskType?: ScheduleTaskType;
  status?: ScheduleTaskStatus;
  startDate?: string | null;
  endDate?: string | null;
  duration?: number;
  progress?: number;
  assignee?: string;
  order?: number;
  constraintType?: ScheduleConstraintType;
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
  taskType?: ScheduleTaskType;
  status?: ScheduleTaskStatus;
  startDate?: string | null;
  endDate?: string | null;
  duration?: number;
  progress?: number;
  assignee?: string;
  order?: number;
  constraintType?: ScheduleConstraintType;
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
  type?: DependencyType;
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

export interface ScheduleCalendarPatchInput extends CreateScheduleCalendarInput {}

export interface CreateScheduleResourceInput {
  calendarId?: string | null;
  name?: string;
  role?: string;
  kind?: ScheduleResourceKind;
  color?: string;
  defaultUnits?: number;
  capacityPerDay?: number;
  costRate?: number;
}

export interface ScheduleResourcePatchInput extends CreateScheduleResourceInput {}

export interface CreateScheduleBaselineInput {
  name?: string;
  description?: string;
  kind?: ScheduleBaselineKind;
  isPrimary?: boolean;
}

export async function createScheduleTask(projectId: string, input: CreateScheduleTaskInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule-tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateScheduleTask(projectId: string, taskId: string, patch: ScheduleTaskPatchInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule-tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteScheduleTask(projectId: string, taskId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule-tasks/${taskId}`, {
    method: "DELETE",
  });
}

export async function batchUpdateScheduleTasks(projectId: string, updates: Array<{ id: string } & ScheduleTaskPatchInput>) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule-tasks/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  });
}

export async function createScheduleDependency(projectId: string, input: CreateDependencyInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule-dependencies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteScheduleDependency(projectId: string, depId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule-dependencies/${depId}`, {
    method: "DELETE",
  });
}

export async function createScheduleCalendar(projectId: string, input: CreateScheduleCalendarInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule-calendars`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateScheduleCalendar(projectId: string, calendarId: string, patch: ScheduleCalendarPatchInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule-calendars/${calendarId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteScheduleCalendar(projectId: string, calendarId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule-calendars/${calendarId}`, {
    method: "DELETE",
  });
}

export async function createScheduleResource(projectId: string, input: CreateScheduleResourceInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule-resources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateScheduleResource(projectId: string, resourceId: string, patch: ScheduleResourcePatchInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule-resources/${resourceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteScheduleResource(projectId: string, resourceId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule-resources/${resourceId}`, {
    method: "DELETE",
  });
}

export async function createScheduleBaseline(projectId: string, input: CreateScheduleBaselineInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule-baselines`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteScheduleBaseline(projectId: string, baselineId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule-baselines/${baselineId}`, {
    method: "DELETE",
  });
}

export async function saveScheduleBaseline(projectId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule/save-baseline`, {
    method: "POST",
  });
}

export async function clearScheduleBaseline(projectId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/schedule/clear-baseline`, {
    method: "DELETE",
  });
}

export function getSchedulePdfUrl(projectId: string) {
  return resolveApiUrl(`/projects/${projectId}/pdf/schedule`);
}

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

export interface CreateAdjustmentInput {
  name?: string;
  description?: string;
  type?: string;
  kind?: AdjustmentKind;
  pricingMode?: AdjustmentPricingMode;
  appliesTo?: string;
  percentage?: number | null;
  amount?: number | null;
  show?: "Yes" | "No";
  order?: number;
}

export interface AdjustmentPatchInput extends CreateAdjustmentInput {}

export async function getAdjustments(projectId: string) {
  return apiRequest<ProjectAdjustment[]>(`/projects/${projectId}/adjustments`);
}

export async function createAdjustment(projectId: string, input: CreateAdjustmentInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/adjustments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function updateAdjustment(projectId: string, adjustmentId: string, patch: AdjustmentPatchInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/adjustments/${adjustmentId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

export async function deleteAdjustment(projectId: string, adjustmentId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/adjustments/${adjustmentId}`, {
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

export async function createConditionLibraryEntry(input: { type: string; value: string }) {
  return apiRequest<ConditionLibraryEntry>("/conditions/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteConditionLibraryEntry(entryId: string) {
  return apiRequest<ConditionLibraryEntry>(`/conditions/library/${entryId}`, {
    method: "DELETE",
  });
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
  return apiRequest<AdditionalLineItem[]>(`/projects/${projectId}/ali`);
}

export async function createAdditionalLineItem(projectId: string, input: CreateAdditionalLineItemInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/ali`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function updateAdditionalLineItem(projectId: string, aliId: string, patch: AdditionalLineItemPatchInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/ali/${aliId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
}

export async function deleteAdditionalLineItem(projectId: string, aliId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/ali/${aliId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Summary Rows
// ---------------------------------------------------------------------------

export async function listSummaryRows(projectId: string) {
  return apiRequest<SummaryRowData[]>(`/projects/${projectId}/summary-rows`);
}

export async function createSummaryRow(projectId: string, input: SummaryRowInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/summary-rows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateSummaryRow(projectId: string, rowId: string, patch: SummaryRowInput) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/summary-rows/${rowId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteSummaryRow(projectId: string, rowId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/summary-rows/${rowId}`, {
    method: "DELETE",
  });
}

export async function reorderSummaryRows(projectId: string, orderedIds: string[]) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/summary-rows/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderedIds }),
  });
}

export async function applySummaryPreset(projectId: string, preset: SummaryPreset) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/summary-rows/apply-preset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset }),
  });
}

export async function getSummaryBuilder(projectId: string) {
  return apiRequest<{ summaryBuilder: SummaryBuilderConfig }>(`/projects/${projectId}/summary-builder`);
}

export async function saveSummaryBuilder(projectId: string, config: SummaryBuilderConfig) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/summary-builder`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
}

// ---------------------------------------------------------------------------
// Rate Schedules
// ---------------------------------------------------------------------------

export interface RateScheduleTier {
  id: string;
  scheduleId: string;
  name: string;
  multiplier: number;
  sortOrder: number;
}

export interface RateScheduleItem {
  id: string;
  scheduleId: string;
  catalogItemId: string | null;
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
  scope: "global" | "revision";
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
  tiers: RateScheduleTier[];
  items: RateScheduleItem[];
}

// Org-level (master library)
export async function listRateSchedules(): Promise<RateSchedule[]> {
  return apiRequest<RateSchedule[]>("/api/rate-schedules");
}

export async function getRateSchedule(id: string): Promise<RateSchedule> {
  return apiRequest<RateSchedule>(`/api/rate-schedules/${id}`);
}

export async function createRateSchedule(input: {
  name: string; description?: string; category?: string; defaultMarkup?: number; autoCalculate?: boolean;
}): Promise<RateSchedule> {
  return apiRequest<RateSchedule>("/api/rate-schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateRateSchedule(id: string, patch: {
  name?: string; description?: string; category?: string; defaultMarkup?: number; autoCalculate?: boolean;
}): Promise<RateSchedule> {
  return apiRequest<RateSchedule>(`/api/rate-schedules/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteRateSchedule(id: string): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(`/api/rate-schedules/${id}`, { method: "DELETE" });
}

export async function addRateScheduleTier(scheduleId: string, input: {
  name: string; multiplier?: number; sortOrder?: number;
}): Promise<RateSchedule> {
  return apiRequest<RateSchedule>(`/api/rate-schedules/${scheduleId}/tiers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateRateScheduleTier(scheduleId: string, tierId: string, patch: {
  name?: string; multiplier?: number; sortOrder?: number;
}): Promise<RateSchedule> {
  return apiRequest<RateSchedule>(`/api/rate-schedules/${scheduleId}/tiers/${tierId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteRateScheduleTier(scheduleId: string, tierId: string): Promise<RateSchedule> {
  return apiRequest<RateSchedule>(`/api/rate-schedules/${scheduleId}/tiers/${tierId}`, { method: "DELETE" });
}

export async function addRateScheduleItem(scheduleId: string, input: {
  catalogItemId: string;
  rates?: Record<string, number>;
  costRates?: Record<string, number>;
  sortOrder?: number;
}): Promise<RateSchedule> {
  return apiRequest<RateSchedule>(`/api/rate-schedules/${scheduleId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateRateScheduleItem(scheduleId: string, itemId: string, patch: {
  rates?: Record<string, number>;
  sortOrder?: number;
}): Promise<RateSchedule> {
  return apiRequest<RateSchedule>(`/api/rate-schedules/${scheduleId}/items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteRateScheduleItem(scheduleId: string, itemId: string): Promise<RateSchedule> {
  return apiRequest<RateSchedule>(`/api/rate-schedules/${scheduleId}/items/${itemId}`, { method: "DELETE" });
}

export async function autoCalculateRateSchedule(id: string): Promise<RateSchedule> {
  return apiRequest<RateSchedule>(`/api/rate-schedules/${id}/auto-calculate`, {
    method: "POST",
  });
}

// Project-level (revision snapshots)
export async function listProjectRateSchedules(projectId: string): Promise<RateSchedule[]> {
  return apiRequest<RateSchedule[]>(`/projects/${projectId}/rate-schedules`);
}

export async function importRateSchedule(projectId: string, scheduleId: string): Promise<WorkspaceResponse> {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/rate-schedules/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheduleId }),
  });
}

export async function updateProjectRateSchedule(projectId: string, id: string, patch: {
  name?: string; description?: string; defaultMarkup?: number;
}): Promise<WorkspaceResponse> {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/rate-schedules/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteProjectRateSchedule(projectId: string, id: string): Promise<WorkspaceResponse> {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/rate-schedules/${id}`, { method: "DELETE" });
}

export async function updateProjectRateScheduleItem(projectId: string, scheduleId: string, itemId: string, patch: {
  rates?: Record<string, number>;
}): Promise<WorkspaceResponse> {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/rate-schedules/${scheduleId}/items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function autoCalculateProjectRateSchedule(projectId: string, id: string): Promise<WorkspaceResponse> {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/rate-schedules/${id}/auto-calculate`, {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export async function getActivities(projectId: string) {
  return apiRequest<Activity[]>(`/projects/${projectId}/activity`);
}

export async function revertActivity(projectId: string, activityId: string) {
  return apiRequest<WorkspaceResponse>(`/projects/${projectId}/activity/${activityId}/revert`, { method: "POST" });
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
  file?: File;
  files?: Array<File | PackageIngestFile>;
  projectId?: string;
  packageName?: string;
  clientName?: string;
  customerId?: string;
  location?: string;
  dueDate?: string;
  scope?: string;
  notes?: string;
}

export interface PackageIngestFile {
  file: File;
  relativePath?: string;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export function getQuotePdfUrl(projectId: string, templateType: string): string {
  return resolveApiUrl(`/projects/${projectId}/pdf/${templateType}`);
}

export function getQuotePdfPreviewUrl(projectId: string, templateType: string, layoutOptions?: Record<string, unknown>): string {
  const base = resolveApiUrl(`/projects/${projectId}/pdf/${templateType}`);
  if (!layoutOptions) return base;
  const encoded = encodeURIComponent(JSON.stringify(layoutOptions));
  return `${base}?layout=${encoded}`;
}

export async function fetchQuotePdfBlobUrl(projectId: string, templateType = "main", layoutOptions?: Record<string, unknown>): Promise<string> {
  let url = resolveApiUrl(`/projects/${projectId}/pdf/${templateType}`);
  if (layoutOptions) {
    url += `?layout=${encodeURIComponent(JSON.stringify(layoutOptions))}`;
  }
  const res = await fetch(url, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
  const blob = await res.blob();
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/pdf")) {
    const responseText = await blob.text().catch(() => "");
    const detail = responseText ? `: ${responseText.slice(0, 160)}` : "";
    throw new Error(`PDF fetch returned ${contentType || "a non-PDF response"}${detail}`);
  }
  const signature = await blob.slice(0, 5).text();
  if (signature !== "%PDF-") {
    throw new Error("PDF fetch returned invalid PDF bytes");
  }
  return URL.createObjectURL(blob);
}

// ---------------------------------------------------------------------------
// PDF Preferences (per-quote persistence)
// ---------------------------------------------------------------------------

export async function getPdfPreferences(projectId: string): Promise<Record<string, unknown>> {
  const data = await apiRequest<{ pdfPreferences: Record<string, unknown> }>(`/projects/${projectId}/pdf-preferences`);
  return data.pdfPreferences ?? {};
}

export async function savePdfPreferences(projectId: string, preferences: Record<string, unknown>): Promise<void> {
  await apiRequest(`/projects/${projectId}/pdf-preferences`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preferences),
  });
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
  const fileEntries = input.files?.length
    ? input.files.map((entry) =>
        entry instanceof File
          ? {
              file: entry,
              relativePath: (entry as File & { webkitRelativePath?: string }).webkitRelativePath || undefined,
            }
          : entry
      )
    : input.file
      ? [{
          file: input.file,
          relativePath: (input.file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined,
        }]
      : [];
  if (!fileEntries.length) {
    throw new Error("Select at least one package file.");
  }

  for (const entry of fileEntries) {
    formData.append("file", entry.file);
  }
  formData.append(
    "fileManifest",
    JSON.stringify(
      fileEntries.map((entry, index) => ({
        index,
        relativePath: entry.relativePath || undefined,
      }))
    )
  );

  if (input.packageName) {
    formData.append("packageName", input.packageName);
    formData.append("projectName", input.packageName); // Also set project name from package name
  }
  if (input.clientName) formData.append("clientName", input.clientName);
  if (input.customerId) formData.append("customerId", input.customerId);
  if (input.location) formData.append("location", input.location);
  if (input.dueDate) formData.append("dueDate", input.dueDate);
  if (input.scope) formData.append("scope", input.scope);
  if (input.notes) formData.append("notes", input.notes);

  const path = input.projectId ? `/projects/${input.projectId}/packages/upload` : "/ingestion/package";

  const response = await fetch(resolveApiUrl(path), {
    method: "POST",
    body: formData,
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "include",
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
    credentials: "include",
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

// ── AI-assisted bulk import (CSV / XLSX / PDF) ──────────────────────────

export type CatalogItemTargetField = "name" | "code" | "unit" | "unitCost" | "unitPrice" | "category" | "ignore";

export interface CatalogImportTable {
  sheetName: string;
  headers: string[];
  rows: string[][];
}

export interface CatalogImportAnalysis {
  tables: CatalogImportTable[];
  selectedTableIndex: number;
  detectedKind: "catalog" | "labour_rate" | "price_list" | "unknown";
  confidence: number;
  mapping: { byHeader: Record<string, CatalogItemTargetField> };
  notes: string;
  warnings: string[];
}

export async function analyzeCatalogImport(file: File): Promise<CatalogImportAnalysis> {
  const fd = new FormData();
  fd.append("file", file);
  return apiRequest<CatalogImportAnalysis>("/api/catalogs/import/analyze", {
    method: "POST",
    body: fd,
  });
}

// Analyze a knowledge book's stored source file (XLSX/CSV/PDF) — same response
// shape as analyzeCatalogImport so the import modal can reuse it directly.
export async function analyzeKnowledgeBookForImport(bookId: string): Promise<CatalogImportAnalysis> {
  return apiRequest<CatalogImportAnalysis>(`/api/knowledge/books/${bookId}/analyze-import`, {
    method: "POST",
  });
}

export async function commitCatalogImport(
  catalogId: string,
  input: {
    table: CatalogImportTable;
    mapping: { byHeader: Record<string, CatalogItemTargetField> };
    defaultCategory?: string;
  },
): Promise<{ created: number; catalogId: string; skipped: number; total: number }> {
  return apiRequest<{ created: number; catalogId: string; skipped: number; total: number }>(
    `/api/catalogs/${catalogId}/import/commit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

// ---------------------------------------------------------------------------
// Catalog Library (browse + adopt templates)
// ---------------------------------------------------------------------------

export async function listCatalogLibrary() {
  return apiRequest<CatalogSummary[]>("/catalogs/library");
}

export async function getCatalogLibraryItem(templateId: string, opts?: { limit?: number; offset?: number; filter?: string }) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  if (opts?.filter) params.set("filter", opts.filter);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<CatalogSummary & { items: CatalogItem[]; total: number }>(`/catalogs/library/${templateId}${qs}`);
}

export async function adoptCatalogTemplate(templateId: string) {
  return apiRequest<CatalogSummary>(`/catalogs/library/${templateId}/adopt`, {
    method: "POST",
  });
}

// Admin catalog template management
export async function adminListCatalogTemplates() {
  return apiRequest<CatalogSummary[]>("/api/admin/catalogs");
}

export async function adminGetCatalogTemplate(id: string, opts?: { limit?: number; offset?: number; filter?: string }) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  if (opts?.filter) params.set("filter", opts.filter);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<CatalogSummary & { items: CatalogItem[]; total: number }>(`/api/admin/catalogs/${id}${qs}`);
}

export async function adminCreateCatalogTemplate(input: { name: string; description?: string; kind?: string; source?: string; sourceDescription?: string }) {
  return apiRequest<CatalogSummary>("/api/admin/catalogs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function adminUpdateCatalogTemplate(id: string, patch: { name?: string; description?: string; kind?: string; sourceDescription?: string }) {
  return apiRequest<CatalogSummary>(`/api/admin/catalogs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function adminDeleteCatalogTemplate(id: string) {
  return apiRequest<{ ok: boolean }>(`/api/admin/catalogs/${id}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// File Node CRUD
// ---------------------------------------------------------------------------

export async function listFileNodes(projectId: string, parentId?: string) {
  const params = parentId ? `?parentId=${parentId}` : "";
  return apiRequest<FileNode[]>(`/projects/${projectId}/files${params}`);
}

export async function getFileTree(projectId: string, scope?: string) {
  const qs = scope ? `?scope=${scope}` : "";
  return apiRequest<FileNode[]>(`/projects/${projectId}/files/tree${qs}`);
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

export async function uploadFile(
  projectId: string,
  file: File,
  parentId?: string | null
): Promise<FileNode> {
  const formData = new FormData();
  formData.append("file", file);
  if (parentId) formData.append("parentId", parentId);

  const response = await fetch(resolveApiUrl(`/projects/${projectId}/files/upload`), {
    method: "POST",
    body: formData,
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Upload failed: ${response.status}`);
  }

  return response.json();
}

export async function saveFileNodeContent(
  projectId: string,
  nodeId: string,
  file: File
): Promise<FileNode> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(resolveApiUrl(`/projects/${projectId}/files/${nodeId}/content`), {
    method: "PUT",
    body: formData,
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Save failed: ${response.status}`);
  }

  return response.json();
}

export function getFileDownloadUrl(projectId: string, nodeId: string, inline = false): string {
  return resolveApiUrl(`/projects/${projectId}/files/${nodeId}/download${inline ? "?inline=1" : ""}`);
}

export function getDocumentDownloadUrl(projectId: string, docId: string, inline = false): string {
  return resolveApiUrl(`/projects/${projectId}/documents/${docId}/download${inline ? "?inline=1" : ""}`);
}

// ---------------------------------------------------------------------------
// Structured Extraction (Azure Document Intelligence)
// ---------------------------------------------------------------------------

export interface StructuredExtractionResult {
  content: string;
  pageCount: number;
  tables: Array<{
    pageNumber: number;
    headers: string[];
    rows: string[][];
    rawMarkdown: string;
  }>;
  keyValuePairs: Array<{ key: string; value: string; confidence: number }>;
  selectionMarks: Array<{ state: string; pageNumber: number; confidence: number }>;
  pages: Array<{ pageNumber: number; content: string; sectionCount: number }>;
  warnings: string[];
}

export async function extractStructuredContent(documentId: string): Promise<StructuredExtractionResult> {
  const res = await apiRequest<{ success: boolean; data: StructuredExtractionResult }>(
    "/api/knowledge/extract-structured",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId }),
    }
  );
  return res.data;
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

// Import domain types for local use
import type { Plugin as PluginRecord, PluginExecution as PluginExecutionRecord } from "@bidwright/domain";

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
  opts?: {
    worksheetId?: string;
    replaceExecutionId?: string;
    formState?: Record<string, unknown>;
    executedBy?: "user" | "agent";
    agentSessionId?: string;
  },
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

export interface PluginFetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

export interface PluginFetchResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
}

export async function pluginFetch(pluginId: string, request: PluginFetchRequest) {
  return apiRequest<PluginFetchResponse>(`/plugins/${pluginId}/fetch`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// ---------------------------------------------------------------------------
// Knowledge Books
// ---------------------------------------------------------------------------

export interface KnowledgeBookRecord {
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

export interface KnowledgeDocumentRecord {
  id: string;
  cabinetId: string | null;
  title: string;
  description: string;
  category: KnowledgeBookRecord["category"];
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

export interface KnowledgeDocumentPageRecord {
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

export interface KnowledgeDocumentChunkRecord {
  id: string;
  documentId: string;
  pageId: string | null;
  sectionTitle: string;
  text: string;
  tokenCount: number;
  order: number;
  metadata: Record<string, unknown>;
}

export interface KnowledgeLibraryCabinetRecord {
  id: string;
  organizationId: string;
  parentId: string | null;
  itemType: "book" | "dataset" | "document";
  name: string;
  createdAt: string;
  updatedAt: string;
}

export async function listKnowledgeBooks(projectId?: string) {
  const params = projectId ? `?projectId=${projectId}` : "";
  return apiRequest<KnowledgeBookRecord[]>(`/knowledge/books${params}`);
}

export async function listKnowledgeDocuments(projectId?: string) {
  const params = projectId ? `?projectId=${projectId}` : "";
  return apiRequest<KnowledgeDocumentRecord[]>(`/knowledge/documents${params}`);
}

export async function listKnowledgeLibraryCabinets(itemType?: KnowledgeLibraryCabinetRecord["itemType"]) {
  const params = itemType ? `?itemType=${itemType}` : "";
  return apiRequest<KnowledgeLibraryCabinetRecord[]>(`/knowledge/cabinets${params}`);
}

export async function createKnowledgeLibraryCabinet(input: {
  name: string;
  itemType: KnowledgeLibraryCabinetRecord["itemType"];
  parentId?: string | null;
}) {
  return apiRequest<KnowledgeLibraryCabinetRecord>("/knowledge/cabinets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateKnowledgeLibraryCabinet(
  cabinetId: string,
  patch: Partial<Pick<KnowledgeLibraryCabinetRecord, "name" | "parentId">>,
) {
  return apiRequest<KnowledgeLibraryCabinetRecord>(`/knowledge/cabinets/${cabinetId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteKnowledgeLibraryCabinet(cabinetId: string) {
  return apiRequest<KnowledgeLibraryCabinetRecord>(`/knowledge/cabinets/${cabinetId}`, {
    method: "DELETE",
  });
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

export async function ingestKnowledgeFile(input: {
  file: File;
  title: string;
  category: string;
  scope?: string;
  projectId?: string;
  cabinetId?: string | null;
}): Promise<KnowledgeBookRecord> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("title", input.title);
  form.append("category", input.category);
  if (input.scope) form.append("scope", input.scope);
  if (input.projectId) form.append("projectId", input.projectId);
  if (input.cabinetId) form.append("cabinetId", input.cabinetId);

  const response = await fetch(resolveApiUrl("/knowledge/ingest-file"), {
    method: "POST",
    headers: { Accept: "application/json" },
    body: form,
    credentials: "include",
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(err.message ?? "Upload failed");
  }
  return response.json();
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

export function getBookFileUrl(bookId: string) {
  return resolveApiUrl(`/knowledge/books/${bookId}/file?inline=1`);
}

export function getBookThumbnailUrl(bookId: string) {
  return resolveApiUrl(`/knowledge/books/${bookId}/thumbnail`);
}

export async function searchBookChunks(bookId: string, query: string, limit = 20) {
  return apiRequest<{ hits: Array<{ id: string; text: string; score: number; sectionTitle?: string; pageNumber?: number }>; query: string; count: number }>(
    `/api/knowledge/search/enhanced?q=${encodeURIComponent(query)}&bookId=${bookId}&limit=${limit}`
  );
}

export async function listKnowledgeChunks(bookId: string) {
  return apiRequest<KnowledgeChunkRecord[]>(`/knowledge/books/${bookId}/chunks`);
}

export async function listKnowledgeChunksPaginated(bookId: string, limit: number, offset: number) {
  return apiRequest<{ chunks: KnowledgeChunkRecord[]; total: number }>(
    `/knowledge/books/${bookId}/chunks?limit=${limit}&offset=${offset}`
  );
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

export async function getKnowledgeDocument(documentId: string) {
  return apiRequest<KnowledgeDocumentRecord & { pages: KnowledgeDocumentPageRecord[] }>(`/knowledge/documents/${documentId}`);
}

export async function createKnowledgeDocument(input: {
  title: string;
  description?: string;
  category?: KnowledgeDocumentRecord["category"];
  scope?: KnowledgeDocumentRecord["scope"];
  projectId?: string | null;
  cabinetId?: string | null;
  tags?: string[];
  pageTitle?: string;
  contentJson?: Record<string, unknown>;
  contentMarkdown?: string;
  plainText?: string;
}) {
  return apiRequest<KnowledgeDocumentRecord>("/knowledge/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateKnowledgeDocument(documentId: string, patch: Partial<KnowledgeDocumentRecord>) {
  return apiRequest<KnowledgeDocumentRecord>(`/knowledge/documents/${documentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteKnowledgeDocument(documentId: string) {
  return apiRequest<KnowledgeDocumentRecord>(`/knowledge/documents/${documentId}`, {
    method: "DELETE",
  });
}

export async function listKnowledgeDocumentPages(documentId: string) {
  return apiRequest<KnowledgeDocumentPageRecord[]>(`/knowledge/documents/${documentId}/pages`);
}

export async function createKnowledgeDocumentPage(documentId: string, input: {
  title: string;
  contentJson?: Record<string, unknown>;
  contentMarkdown?: string;
  plainText?: string;
  metadata?: Record<string, unknown>;
  order?: number;
}) {
  return apiRequest<KnowledgeDocumentPageRecord>(`/knowledge/documents/${documentId}/pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateKnowledgeDocumentPage(
  documentId: string,
  pageId: string,
  patch: Partial<KnowledgeDocumentPageRecord>,
) {
  return apiRequest<KnowledgeDocumentPageRecord>(`/knowledge/documents/${documentId}/pages/${pageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteKnowledgeDocumentPage(documentId: string, pageId: string) {
  return apiRequest<KnowledgeDocumentPageRecord>(`/knowledge/documents/${documentId}/pages/${pageId}`, {
    method: "DELETE",
  });
}

export async function reindexKnowledgeDocument(documentId: string) {
  return apiRequest<{ documentId: string; chunkCount: number; embeddingsGenerated: boolean; errors: string[] }>(
    `/knowledge/documents/${documentId}/reindex`,
    { method: "POST" },
  );
}

export async function listKnowledgeDocumentChunks(documentId: string, pageId?: string) {
  const params = pageId ? `?pageId=${encodeURIComponent(pageId)}` : "";
  return apiRequest<KnowledgeDocumentChunkRecord[]>(`/knowledge/documents/${documentId}/chunks${params}`);
}

export async function searchKnowledge(query: string, bookId?: string, limit?: number, documentId?: string) {
  const params = new URLSearchParams({ q: query });
  if (bookId) params.set("bookId", bookId);
  if (documentId) params.set("documentId", documentId);
  if (limit) params.set("limit", String(limit));
  return apiRequest<Array<(KnowledgeChunkRecord | KnowledgeDocumentChunkRecord) & {
    source?: string;
    sourceType?: "book" | "document_page";
    bookName?: string;
    documentTitle?: string;
    pageTitle?: string;
  }>>(`/knowledge/search?${params.toString()}`);
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
  cabinetId: string | null;
  name: string;
  description: string;
  category: "labour_units" | "equipment_rates" | "material_prices" | "productivity" | "burden_rates" | "custom";
  scope: "global" | "project";
  projectId: string | null;
  columns: DatasetColumnRecord[];
  rowCount: number;
  source: "manual" | "import" | "ai_generated" | "plugin" | "library";
  sourceDescription: string;
  isTemplate?: boolean;
  sourceTemplateId?: string | null;
  sourceBookId?: string | null;
  sourcePages?: string;
  tags?: string[];
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
  cabinetId?: string | null;
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

// ── Dataset Library (Templates) ──────────────────────────────────────────

// Admin endpoints
export async function adminListDatasetTemplates() {
  return apiRequest<DatasetRecord[]>("/api/admin/datasets");
}

export async function adminGetDatasetTemplate(id: string, opts?: { limit?: number; offset?: number; filter?: string }) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  if (opts?.filter) params.set("filter", opts.filter);
  const qs = params.toString();
  return apiRequest<DatasetRecord & { rows: DatasetRowRecord[]; total: number }>(`/api/admin/datasets/${id}${qs ? `?${qs}` : ""}`);
}

export async function adminCreateDatasetTemplate(input: {
  name: string;
  description: string;
  category: DatasetRecord["category"];
  columns: DatasetColumnRecord[];
  source?: DatasetRecord["source"];
  sourceDescription?: string;
}) {
  return apiRequest<DatasetRecord>("/api/admin/datasets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function adminUpdateDatasetTemplate(id: string, patch: Partial<DatasetRecord>) {
  return apiRequest<DatasetRecord>(`/api/admin/datasets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function adminDeleteDatasetTemplate(id: string) {
  return apiRequest<{ ok: boolean }>(`/api/admin/datasets/${id}`, { method: "DELETE" });
}

// Organization-facing library endpoints
export async function listDatasetLibrary() {
  return apiRequest<DatasetRecord[]>("/datasets/library");
}

export async function getDatasetLibraryItem(templateId: string) {
  return apiRequest<DatasetRecord & { rows: DatasetRowRecord[]; total: number }>(`/datasets/library/${templateId}`);
}

export async function adoptDatasetTemplate(templateId: string) {
  return apiRequest<DatasetRecord>(`/datasets/library/${templateId}/adopt`, { method: "POST" });
}

export async function extractDatasetsFromBook(bookId: string) {
  return apiRequest<{
    sessionId: string;
    bookId: string;
    bookName: string;
    sections: number;
    chunks: number;
    status: string;
  }>("/api/cli/extract-datasets", {
    method: "POST",
    body: JSON.stringify({ bookId }),
    headers: { "Content-Type": "application/json" },
  });
}

// ── Takeoff Annotations ──────────────────────────────────────────────────

export async function listTakeoffAnnotations(projectId: string, documentId?: string, page?: number) {
  const params = new URLSearchParams();
  if (documentId) params.set("documentId", documentId);
  if (page !== undefined) params.set("page", String(page));
  const qs = params.toString();
  return apiRequest<any[]>(`/api/takeoff/${projectId}/annotations${qs ? `?${qs}` : ""}`);
}

export async function createTakeoffAnnotation(projectId: string, data: Record<string, unknown>) {
  return apiRequest<any>(`/api/takeoff/${projectId}/annotations`, {
    method: "POST",
    body: JSON.stringify(data),
    headers: { "Content-Type": "application/json" },
  });
}

export async function updateTakeoffAnnotation(projectId: string, annotationId: string, data: Record<string, unknown>) {
  return apiRequest<any>(`/api/takeoff/${projectId}/annotations/${annotationId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
    headers: { "Content-Type": "application/json" },
  });
}

export async function deleteTakeoffAnnotation(projectId: string, annotationId: string) {
  return apiRequest<void>(`/api/takeoff/${projectId}/annotations/${annotationId}`, {
    method: "DELETE",
  });
}

// ── Takeoff Links (Annotation ↔ Line Item) ──────────────────────────────

export interface TakeoffLinkRecord {
  id: string;
  projectId: string;
  annotationId: string;
  worksheetItemId: string;
  quantityField: string;
  multiplier: number;
  derivedQuantity: number;
  annotation?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export async function listTakeoffLinks(
  projectId: string,
  annotationId?: string,
  worksheetItemId?: string,
) {
  const params = new URLSearchParams();
  if (annotationId) params.set("annotationId", annotationId);
  if (worksheetItemId) params.set("worksheetItemId", worksheetItemId);
  const qs = params.toString();
  return apiRequest<TakeoffLinkRecord[]>(`/api/takeoff/${projectId}/links${qs ? `?${qs}` : ""}`);
}

export async function createTakeoffLink(
  projectId: string,
  data: { annotationId: string; worksheetItemId: string; quantityField?: string; multiplier?: number },
) {
  return apiRequest<TakeoffLinkRecord>(`/api/takeoff/${projectId}/links`, {
    method: "POST",
    body: JSON.stringify(data),
    headers: { "Content-Type": "application/json" },
  });
}

export async function updateTakeoffLink(
  projectId: string,
  linkId: string,
  data: { quantityField?: string; multiplier?: number },
) {
  return apiRequest<TakeoffLinkRecord>(`/api/takeoff/${projectId}/links/${linkId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
    headers: { "Content-Type": "application/json" },
  });
}

export async function deleteTakeoffLink(projectId: string, linkId: string) {
  return apiRequest<void>(`/api/takeoff/${projectId}/links/${linkId}`, {
    method: "DELETE",
  });
}

// ── Vision / Auto-Count ──────────────────────────────────────────────────

export interface VisionBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}

export interface VisionMatch {
  rect: { x: number; y: number; width: number; height: number };
  confidence: number;
  image?: string;
  text?: string;
  detection_method: string;
}

export interface VisionCountResult {
  success: boolean;
  documentId: string;
  pageNumber: number;
  totalCount: number;
  matches: VisionMatch[];
  snippetImage?: string;
  imageWidth?: number;
  imageHeight?: number;
  duration_ms: number;
  errors: string[];
}

export async function runVisionCountSymbols(input: {
  projectId: string;
  documentId: string;
  pageNumber: number;
  boundingBox: VisionBoundingBox;
  threshold?: number;
  crossScale?: boolean;
}) {
  return apiRequest<VisionCountResult>("/api/vision/count-symbols", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export interface VisionCropResult {
  success: boolean;
  image: string | null;
  duration_ms: number;
}

export async function runVisionCropRegion(input: {
  projectId: string;
  documentId: string;
  pageNumber: number;
  boundingBox: VisionBoundingBox;
}) {
  return apiRequest<VisionCropResult>("/api/vision/crop-region", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function saveVisionCrop(input: {
  projectId: string;
  image: string;
  filename?: string;
}) {
  return apiRequest<{ success: boolean; filePath: string; filename: string }>("/api/vision/save-crop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// ── Vision / Find Symbols ────────────────────────────────────────────────

export interface VisionFindSymbolsResult {
  success: boolean;
  candidates: { x: number; y: number; w: number; h: number; area: number; cx: number; cy: number; aspect: number }[];
  total: number;
  imageWidth: number;
  imageHeight: number;
  duration_ms: number;
}

export async function runVisionFindSymbols(input: {
  projectId: string;
  documentId: string;
  pageNumber?: number;
  minSize?: number;
  maxSize?: number;
}) {
  return apiRequest<VisionFindSymbolsResult>("/api/vision/find-symbols", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// ── Vision / Count Symbols All Pages ─────────────────────────────────────

export interface VisionCountAllPagesResult {
  success: boolean;
  documentId: string;
  pages: { pageNumber: number; matches: VisionMatch[]; totalCount: number; errors: string[] }[];
  grandTotal: number;
  pageCount: number;
}

export async function runVisionCountAllPages(input: {
  projectId: string;
  documentId: string;
  boundingBox: VisionBoundingBox;
  threshold?: number;
  crossScale?: boolean;
}) {
  return apiRequest<VisionCountAllPagesResult>("/api/vision/count-symbols-all-pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// CLI Agent Runtime
// ---------------------------------------------------------------------------

export async function detectCli() {
  return apiRequest<{
    claude: {
      available: boolean;
      path: string;
      version?: string;
      auth?: { authenticated: boolean; method: string };
      models?: {
        id: string;
        name: string;
        description: string;
        defaultReasoningEffort?: string | null;
        hidden?: boolean;
        isDefault?: boolean;
        supportedReasoningEfforts?: string[];
      }[];
    };
    codex: {
      available: boolean;
      path: string;
      version?: string;
      auth?: { authenticated: boolean; method: string };
      models?: {
        id: string;
        name: string;
        description: string;
        defaultReasoningEffort?: string | null;
        hidden?: boolean;
        isDefault?: boolean;
        supportedReasoningEfforts?: string[];
      }[];
    };
    configured: {
      runtime: "claude-code" | "codex" | null;
      model: string | null;
    };
  }>("/api/cli/detect");
}

export async function listCliModels(runtime: "claude-code" | "codex", cliPath?: string | null) {
  const params = new URLSearchParams({ runtime });
  if (cliPath?.trim()) params.set("path", cliPath.trim());
  return apiRequest<{
    runtime: "claude-code" | "codex";
    queriedAt: string;
    models: {
      id: string;
      name: string;
      description: string;
      defaultReasoningEffort?: string | null;
      hidden?: boolean;
      isDefault?: boolean;
      supportedReasoningEfforts?: string[];
    }[];
  }>(`/api/cli/models?${params.toString()}`);
}

export async function startCliSession(input: {
  projectId: string;
  runtime?: "claude-code" | "codex";
  model?: string;
  scope?: string;
  prompt?: string;
  personaId?: string;
}) {
  return apiRequest<{ sessionId: string; projectId: string; runtime: string; status: string }>(
    "/api/cli/start",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
  );
}

// ── Estimator Personas ──────────────────────────────────────────────────

export interface EstimatorPersona {
  id: string;
  organizationId: string;
  name: string;
  trade: string;
  description: string;
  systemPrompt: string;
  knowledgeBookIds: string[];
  knowledgeDocumentIds: string[];
  datasetTags: string[];
  packageBuckets: string[];
  defaultAssumptions: Record<string, unknown>;
  productivityGuidance: Record<string, unknown>;
  commercialGuidance: Record<string, unknown>;
  reviewFocusAreas: string[];
  isDefault: boolean;
  enabled: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export async function listPersonas(): Promise<EstimatorPersona[]> {
  return apiRequest<EstimatorPersona[]>("/personas");
}

export async function createPersona(input: Partial<EstimatorPersona>): Promise<EstimatorPersona> {
  return apiRequest<EstimatorPersona>("/personas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updatePersona(id: string, patch: Partial<EstimatorPersona>): Promise<EstimatorPersona> {
  return apiRequest<EstimatorPersona>(`/personas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deletePersona(id: string): Promise<void> {
  await apiRequest(`/personas/${id}`, { method: "DELETE" });
}

export function connectCliStream(projectId: string): EventSource {
  const url = new URL(`/api/cli/${projectId}/stream`, apiBaseUrl);
  return new EventSource(url.toString(), { withCredentials: true });
}

export async function stopCliSession(projectId: string) {
  return apiRequest<{ stopped: boolean }>(`/api/cli/${projectId}/stop`, { method: "POST" });
}

export async function resumeCliSession(projectId: string, prompt?: string) {
  return apiRequest<{ sessionId: string; status: string }>(`/api/cli/${projectId}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
}

export async function sendCliMessage(projectId: string, message: string) {
  return apiRequest<{ sent?: boolean; sessionId?: string; status?: string; message?: string }>(`/api/cli/${projectId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

/** Lightweight Ask AI — direct API call, no CLI session */
export async function askAi(projectId: string, prompt: string, imagePath?: string) {
  return apiRequest<{ response: string }>(`/api/cli/${projectId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, imagePath }),
  });
}

export async function getCliStatus(projectId: string) {
  return apiRequest<{
    status: string;
    runtime?: string;
    sessionId?: string;
    startedAt?: string;
    source?: "live" | "db";
    events?: any[];
  }>(`/api/cli/${projectId}/status`);
}

export async function getCliPendingQuestion(projectId: string) {
  return apiRequest<{
    pending: boolean;
    answered?: boolean;
    answer?: string;
    questionId?: string | null;
    question?: string;
    options?: string[];
    allowMultiple?: boolean;
    context?: string;
    questions?: Array<{
      id?: string;
      prompt: string;
      options?: string[];
      allowMultiple?: boolean;
      placeholder?: string;
      context?: string;
    }>;
  }>(`/api/cli/${projectId}/pending-question`);
}

export async function answerCliQuestion(projectId: string, answer: string, questionId?: string | null) {
  return apiRequest<{ ok: boolean; message: string }>(`/api/cli/${projectId}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer, questionId: questionId || undefined }),
  });
}

// ── Quote Review ────────────────────────────────────────────────────────

export interface ReviewCoverageItem {
  id: string;
  specRef: string;
  requirement: string;
  status: "YES" | "VERIFY" | "NO";
  worksheetName?: string;
  notes?: string;
}

export type ReviewLifecycleState = "open" | "resolved";
export type ReviewItemState = "open" | "resolved" | "dismissed";

export interface ReviewFinding {
  id: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  description: string;
  specRef?: string;
  estimatedImpact?: string;
  status?: ReviewItemState;
  resolutionNote?: string;
}

export interface ReviewOverestimate {
  id: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
  area: string;
  analysis: string;
  currentValue?: string;
  benchmarkValue?: string;
  savingsRange: string;
  status?: ReviewItemState;
  resolutionNote?: string;
}

export interface ReviewBenchmarkStream {
  id: string;
  name: string;
  footage?: number;
  hours: number;
  productionRate?: number;
  unit?: string;
  fmTlRatio?: number;
  assessment: string;
}

export interface ReviewCompetitiveness {
  overestimates?: ReviewOverestimate[];
  underestimates?: Array<{
    id: string;
    impact: "HIGH" | "MEDIUM" | "LOW";
    area: string;
    analysis: string;
    riskRange: string;
    status?: ReviewItemState;
    resolutionNote?: string;
  }>;
  benchmarking?: {
    description?: string;
    streams: ReviewBenchmarkStream[];
  };
  totalSavingsRange?: string;
}

export interface ReviewRecommendation {
  id: string;
  title: string;
  description: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  impact: string;
  category?: string;
  status: ReviewItemState;
  reviewerNote?: string;
  resolution: {
    summary: string;
    actions: Array<{
      action: "createItem" | "updateItem" | "deleteItem" | "addCondition";
      worksheetId?: string;
      worksheetName?: string;
      itemId?: string;
      itemName?: string;
      item?: Record<string, unknown>;
      changes?: Record<string, unknown>;
      type?: string;
      value?: string;
    }>;
  };
}

export interface ReviewSummary {
  quoteTotal: number;
  worksheetCount: number;
  itemCount: number;
  totalHours?: number;
  coverageScore: string;
  riskCount: { critical: number; warning: number; info: number };
  potentialSavings?: string;
  keyFindings: string[];
  overallAssessment: string;
}

export interface QuoteReview {
  id: string;
  projectId: string;
  revisionId: string;
  aiRunId?: string;
  status: "running" | "completed" | "failed";
  reviewState: ReviewLifecycleState;
  isOutdated: boolean;
  outdatedReason?: string | null;
  quoteUpdatedAt?: string | null;
  reviewedQuoteUpdatedAt?: string | null;
  currentRevisionId?: string | null;
  summary: ReviewSummary;
  coverage: ReviewCoverageItem[];
  findings: ReviewFinding[];
  competitiveness: ReviewCompetitiveness;
  recommendations: ReviewRecommendation[];
  createdAt: string;
  updatedAt: string;
}

export async function startReview(projectId: string, options?: { runtime?: string; model?: string }) {
  return apiRequest<{ sessionId: string; reviewId: string; projectId: string; status: string }>(
    `/api/review/${projectId}/start`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options || {}) }
  );
}

export async function getLatestReview(projectId: string) {
  return apiRequest<{ review: QuoteReview | null }>(`/api/review/${projectId}/latest`);
}

export async function updateManualReview(
  projectId: string,
  patch: {
    coverage?: ReviewCoverageItem[];
    findings?: ReviewFinding[];
    competitiveness?: ReviewCompetitiveness;
    recommendations?: ReviewRecommendation[];
    summary?: Partial<ReviewSummary>;
    reviewState?: ReviewLifecycleState;
    refreshQuoteSnapshot?: boolean;
  },
) {
  return apiRequest<{ review: QuoteReview }>(`/api/review/${projectId}/manual`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function resolveRecommendation(projectId: string, recId: string) {
  return apiRequest<WorkspaceResponse>(`/api/review/${projectId}/resolve/${recId}`, { method: "POST" });
}

export async function dismissRecommendation(projectId: string, recId: string) {
  return apiRequest<{ ok: boolean }>(`/api/review/${projectId}/dismiss/${recId}`, { method: "POST" });
}

export async function stopReview(projectId: string) {
  return apiRequest<{ stopped: boolean }>(`/api/review/${projectId}/stop`, { method: "POST" });
}

export function connectReviewStream(projectId: string): EventSource {
  const url = new URL(`/api/review/${projectId}/stream`, apiBaseUrl);
  return new EventSource(url.toString(), { withCredentials: true });
}

export async function getReviewStatus(projectId: string) {
  return apiRequest<{ status: string; sessionId?: string; events?: any[] }>(`/api/review/${projectId}/status`);
}

// ── Labour Cost Tables ──────────────────────────────────────────────────

export interface LabourCostEntry {
  id: string;
  tableId: string;
  code: string;
  name: string;
  group: string;
  costRates: Record<string, number>;
  metadata: Record<string, unknown>;
  sortOrder: number;
}

export interface LabourCostTable {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  effectiveDate: string | null;
  expiryDate: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface LabourCostTableWithEntries extends LabourCostTable {
  entries: LabourCostEntry[];
}

export async function listLabourCostTables(): Promise<LabourCostTableWithEntries[]> {
  return apiRequest<LabourCostTableWithEntries[]>("/api/labour-cost-tables");
}

export async function getLabourCostTable(id: string): Promise<LabourCostTableWithEntries> {
  return apiRequest<LabourCostTableWithEntries>(`/api/labour-cost-tables/${id}`);
}

export async function createLabourCostTable(input: {
  name: string; description?: string; effectiveDate?: string; expiryDate?: string; metadata?: Record<string, unknown>;
}): Promise<LabourCostTableWithEntries> {
  return apiRequest<LabourCostTableWithEntries>("/api/labour-cost-tables", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateLabourCostTable(id: string, patch: {
  name?: string; description?: string; effectiveDate?: string | null; expiryDate?: string | null; metadata?: Record<string, unknown>;
}): Promise<LabourCostTableWithEntries> {
  return apiRequest<LabourCostTableWithEntries>(`/api/labour-cost-tables/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteLabourCostTable(id: string): Promise<void> {
  await apiRequest<{ deleted: boolean }>(`/api/labour-cost-tables/${id}`, { method: "DELETE" });
}

export async function createLabourCostEntry(tableId: string, input: {
  code: string; name: string; group?: string; costRates?: Record<string, number>; metadata?: Record<string, unknown>; sortOrder?: number;
}): Promise<LabourCostTableWithEntries> {
  return apiRequest<LabourCostTableWithEntries>(`/api/labour-cost-tables/${tableId}/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateLabourCostEntry(tableId: string, entryId: string, patch: {
  code?: string; name?: string; group?: string; costRates?: Record<string, number>; metadata?: Record<string, unknown>; sortOrder?: number;
}): Promise<LabourCostTableWithEntries> {
  return apiRequest<LabourCostTableWithEntries>(`/api/labour-cost-tables/${tableId}/entries/${entryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteLabourCostEntry(tableId: string, entryId: string): Promise<LabourCostTableWithEntries> {
  return apiRequest<LabourCostTableWithEntries>(`/api/labour-cost-tables/${tableId}/entries/${entryId}`, { method: "DELETE" });
}

// ── Burden Periods ──────────────────────────────────────────────────────

export interface BurdenPeriod {
  id: string;
  organizationId: string;
  name: string;
  group: string;
  percentage: number;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

export async function listBurdenPeriods(group?: string): Promise<BurdenPeriod[]> {
  const qs = group ? `?group=${encodeURIComponent(group)}` : "";
  return apiRequest<BurdenPeriod[]>(`/api/burden-periods${qs}`);
}

export async function createBurdenPeriod(input: {
  name: string; group: string; percentage: number; startDate: string; endDate: string;
}): Promise<BurdenPeriod> {
  return apiRequest<BurdenPeriod>("/api/burden-periods", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateBurdenPeriod(id: string, patch: {
  name?: string; group?: string; percentage?: number; startDate?: string; endDate?: string;
}): Promise<BurdenPeriod> {
  return apiRequest<BurdenPeriod>(`/api/burden-periods/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteBurdenPeriod(id: string): Promise<void> {
  await apiRequest<{ deleted: boolean }>(`/api/burden-periods/${id}`, { method: "DELETE" });
}

// ── Travel Policies ─────────────────────────────────────────────────────

export type PerDiemEmbedMode = "separate" | "embed_hourly" | "embed_cost_only";
export type FuelSurchargeAppliesTo = "labour" | "all" | "none";

export interface TravelPolicy {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  perDiemRate: number;
  perDiemEmbedMode: PerDiemEmbedMode;
  hoursPerDay: number;
  travelTimeHours: number;
  travelTimeTrips: number;
  kmToDestination: number;
  mileageRate: number;
  fuelSurchargePercent: number;
  fuelSurchargeAppliesTo: FuelSurchargeAppliesTo;
  accommodationRate: number;
  accommodationNights: number;
  showAsSeparateLine: boolean;
  breakoutLabel: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export async function listTravelPolicies(): Promise<TravelPolicy[]> {
  return apiRequest<TravelPolicy[]>("/api/travel-policies");
}

export async function getTravelPolicy(id: string): Promise<TravelPolicy> {
  return apiRequest<TravelPolicy>(`/api/travel-policies/${id}`);
}

export async function createTravelPolicy(input: {
  name: string; description?: string; perDiemRate?: number; perDiemEmbedMode?: PerDiemEmbedMode;
  hoursPerDay?: number; travelTimeHours?: number; travelTimeTrips?: number; kmToDestination?: number;
  mileageRate?: number; fuelSurchargePercent?: number; fuelSurchargeAppliesTo?: FuelSurchargeAppliesTo;
  accommodationRate?: number; accommodationNights?: number; showAsSeparateLine?: boolean;
  breakoutLabel?: string; metadata?: Record<string, unknown>;
}): Promise<TravelPolicy> {
  return apiRequest<TravelPolicy>("/api/travel-policies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateTravelPolicy(id: string, patch: {
  name?: string; description?: string; perDiemRate?: number; perDiemEmbedMode?: PerDiemEmbedMode;
  hoursPerDay?: number; travelTimeHours?: number; travelTimeTrips?: number; kmToDestination?: number;
  mileageRate?: number; fuelSurchargePercent?: number; fuelSurchargeAppliesTo?: FuelSurchargeAppliesTo;
  accommodationRate?: number; accommodationNights?: number; showAsSeparateLine?: boolean;
  breakoutLabel?: string; metadata?: Record<string, unknown>;
}): Promise<TravelPolicy> {
  return apiRequest<TravelPolicy>(`/api/travel-policies/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteTravelPolicy(id: string): Promise<void> {
  await apiRequest<{ deleted: boolean }>(`/api/travel-policies/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// 3D Model Intelligence
// ---------------------------------------------------------------------------

export interface ModelAsset {
  id: string;
  projectId: string;
  sourceDocumentId?: string | null;
  fileNodeId?: string | null;
  fileName: string;
  fileType: string;
  format: string;
  status: "indexed" | "partial" | "failed";
  units: string;
  checksum: string;
  storagePath: string;
  manifest: Record<string, unknown>;
  bom: Array<Record<string, unknown>>;
  elementStats: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  _count?: {
    elements: number;
    quantities: number;
    issues: number;
    takeoffLinks: number;
  };
}

export interface ModelElement {
  id: string;
  modelId: string;
  externalId: string;
  name: string;
  elementClass: string;
  elementType: string;
  system: string;
  level: string;
  material: string;
  bbox: Record<string, unknown>;
  geometryRef: string;
  properties: Record<string, unknown>;
  quantities?: ModelQuantity[];
  createdAt: string;
  updatedAt: string;
}

export interface ModelQuantity {
  id: string;
  modelId: string;
  elementId?: string | null;
  quantityType: string;
  value: number;
  unit: string;
  method: string;
  confidence: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ModelTakeoffLinkRecord {
  id: string;
  projectId: string;
  modelId: string;
  modelElementId?: string | null;
  modelQuantityId?: string | null;
  worksheetItemId: string;
  quantityField: string;
  multiplier: number;
  derivedQuantity: number;
  selection: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  worksheetItem?: (WorkspaceWorksheetItem & {
    worksheet?: {
      id: string;
      name: string;
      order: number;
    } | null;
  }) | null;
  modelElement?: ModelElement | null;
  modelQuantity?: ModelQuantity | null;
}

export interface ModelIssue {
  id: string;
  modelId: string;
  elementId?: string | null;
  severity: string;
  code: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export async function listModelAssets(projectId: string, refresh = false) {
  const qs = refresh ? "?refresh=1" : "";
  return apiRequest<{ assets: ModelAsset[]; syncedIds?: string[]; sourceCount?: number }>(`/api/models/${projectId}/assets${qs}`);
}

export async function syncModelAssets(projectId: string) {
  return apiRequest<{ assets: ModelAsset[]; syncedIds: string[]; sourceCount: number }>(`/api/models/${projectId}/assets/scan`, {
    method: "POST",
  });
}

export async function getModelAsset(projectId: string, modelId: string) {
  return apiRequest<{
    asset: ModelAsset & {
      elements: ModelElement[];
      quantities: ModelQuantity[];
      issues: ModelIssue[];
      boms: Array<{ id: string; grouping: string; rows: Array<Record<string, unknown>>; createdAt: string }>;
    };
  }>(`/api/models/${projectId}/assets/${modelId}`);
}

export async function getModelBom(projectId: string, modelId: string) {
  return apiRequest<{ model: ModelAsset; rows: Array<Record<string, unknown>>; rowCount: number }>(
    `/api/models/${projectId}/assets/${modelId}/bom`,
  );
}

export async function queryModelElements(projectId: string, modelId: string, filters: {
  text?: string;
  elementClass?: string;
  elementType?: string;
  system?: string;
  level?: string;
  material?: string;
  name?: string;
  limit?: number;
} = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  const qs = params.toString();
  return apiRequest<{ elements: ModelElement[]; count: number }>(
    `/api/models/${projectId}/assets/${modelId}/elements${qs ? `?${qs}` : ""}`,
  );
}

export async function listModelTakeoffLinks(projectId: string, modelId: string) {
  return apiRequest<{ links: ModelTakeoffLinkRecord[] }>(
    `/api/models/${projectId}/assets/${modelId}/takeoff-links`,
  );
}

export async function createModelTakeoffLink(
  projectId: string,
  modelId: string,
  input: {
    worksheetItemId: string;
    modelElementId?: string | null;
    modelQuantityId?: string | null;
    quantityField?: string;
    multiplier?: number;
    derivedQuantity?: number;
    selection?: unknown;
  },
) {
  return apiRequest<{ link: ModelTakeoffLinkRecord }>(`/api/models/${projectId}/assets/${modelId}/takeoff-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// ─── Drawing-revision diff + auto re-takeoff ────────────────────────────

export interface RevisionDiffSummary {
  id: string;
  projectId: string;
  baseModelId: string;
  baseModelName: string;
  headModelId: string;
  headModelName: string;
  summary: {
    elementsAdded?: number;
    elementsRemoved?: number;
    elementsModified?: number;
    affectedItems?: number;
    totalCostDelta?: number;
    totalPriceDelta?: number;
  };
  createdAt: string;
}

export interface RevisionImpactedItem {
  worksheetItemId: string;
  worksheetId: string;
  linkId: string;
  entityName: string;
  category: string;
  uom: string;
  multiplier: number;
  oldQuantity: number;
  newQuantity: number;
  unitCost: number;
  unitPrice: number;
  costDelta: number;
  priceDelta: number;
  changeType: "added" | "removed" | "modified";
}

export interface RevisionDiffChange {
  changeType: "added" | "removed" | "modified";
  externalId: string;
  baseElementId: string | null;
  headElementId: string | null;
  elementClass: string;
  elementType: string;
  name: string;
  level: string;
  beforeQuantities: Array<{ quantityType: string; value: number; unit: string }>;
  afterQuantities: Array<{ quantityType: string; value: number; unit: string }>;
  propertyChanges: Array<{ key: string; before: unknown; after: unknown }>;
  impactedItems: RevisionImpactedItem[];
}

export interface RevisionImpactReport {
  diffId: string;
  baseModelId: string;
  headModelId: string;
  projectId: string;
  summary: {
    elementsAdded: number;
    elementsRemoved: number;
    elementsModified: number;
    affectedItems: number;
    totalCostDelta: number;
    totalPriceDelta: number;
  };
  changes: RevisionDiffChange[];
  warnings: string[];
  aiNarrative: string | null;
  createdAt: string;
}

export async function listRevisionDiffs(projectId: string): Promise<RevisionDiffSummary[]> {
  return apiRequest<RevisionDiffSummary[]>(`/api/models/${projectId}/diffs`);
}

export async function createRevisionDiff(
  projectId: string,
  input: { baseModelId: string; headModelId: string },
): Promise<RevisionImpactReport> {
  return apiRequest<RevisionImpactReport>(`/api/models/${projectId}/diffs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getRevisionImpactReport(projectId: string, diffId: string): Promise<RevisionImpactReport> {
  return apiRequest<RevisionImpactReport>(`/api/models/${projectId}/diffs/${diffId}`);
}

export async function analyzeRevisionDiff(
  projectId: string,
  diffId: string,
  aiConfig?: { provider: string; apiKey: string; model: string },
): Promise<RevisionImpactReport> {
  return apiRequest<RevisionImpactReport>(`/api/models/${projectId}/diffs/${diffId}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aiConfig }),
  });
}

export async function applyRevisionRetakeoff(
  projectId: string,
  diffId: string,
  input: { onlyLinkIds?: string[] } = {},
): Promise<{ updated: number; skipped: number }> {
  return apiRequest<{ updated: number; skipped: number }>(`/api/models/${projectId}/diffs/${diffId}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// ─── Title-block scale detection (OCR) ─────────────────────────────────

export interface DetectedScaleRecord {
  raw: string;
  kind: "metric" | "imperial";
  label: string;
  multiplier: number;
  unit: "m" | "ft";
  confidence: number;
}

export type DisciplineKey =
  | "architectural"
  | "structural"
  | "civil"
  | "electrical"
  | "mechanical"
  | "plumbing"
  | "fire-protection"
  | "site"
  | "demolition"
  | "interior"
  | "landscape";

export interface DetectedDisciplineRecord {
  key: DisciplineKey;
  raw: string;
  confidence: number;
}

export interface DetectScaleResultRecord {
  ocrText: string;
  detectedScales: DetectedScaleRecord[];
  detectedDiscipline: DetectedDisciplineRecord | null;
  warnings: string[];
}

export async function detectTitleBlockScale(
  projectId: string,
  documentId: string,
  pageNumber: number,
): Promise<DetectScaleResultRecord> {
  return apiRequest<DetectScaleResultRecord>(
    `/api/takeoff/${projectId}/documents/${documentId}/detect-scale`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageNumber }),
    },
  );
}

// ─── Symbol legend reader ───────────────────────────────────────────────

export interface LegendEntryRecord {
  symbol: string;
  label: string;
  pageNumber: number;
  confidence: number;
}

export interface ExtractLegendResultRecord {
  entries: LegendEntryRecord[];
  warnings: string[];
}

export async function extractLegendFromPage(
  projectId: string,
  documentId: string,
  pageNumber: number,
): Promise<ExtractLegendResultRecord> {
  return apiRequest<ExtractLegendResultRecord>(
    `/api/takeoff/${projectId}/documents/${documentId}/extract-legend`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageNumber }),
    },
  );
}

// ─── Auto-takeoff line-item suggestions ─────────────────────────────────

export type LineItemSuggestionKind = "catalog" | "rateScheduleItem";

export interface LineItemSuggestionRecord {
  kind: LineItemSuggestionKind;
  id: string;
  name: string;
  code: string;
  unit: string;
  reasoning: string;
  confidence: number;
  recommendedQuantity: number;
}

export interface SuggestLineItemsResultRecord {
  annotationId: string;
  suggestions: LineItemSuggestionRecord[];
  warnings: string[];
}

export async function suggestLineItemsForAnnotation(
  projectId: string,
  annotationId: string,
): Promise<SuggestLineItemsResultRecord> {
  return apiRequest<SuggestLineItemsResultRecord>(
    `/api/takeoff/${projectId}/annotations/${annotationId}/suggest-line-items`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
  );
}

export async function deleteModelTakeoffLink(projectId: string, modelId: string, linkId: string) {
  return apiRequest<{ deleted: boolean }>(`/api/models/${projectId}/assets/${modelId}/takeoff-links/${linkId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Assemblies
// ---------------------------------------------------------------------------

export interface AssemblySummaryRecord {
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

export interface AssemblyParameterRecord {
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

export type AssemblyComponentTypeValue = "catalog_item" | "rate_schedule_item" | "sub_assembly";

export interface AssemblyComponentRecord {
  id: string;
  assemblyId: string;
  componentType: AssemblyComponentTypeValue;
  catalogItemId: string | null;
  rateScheduleItemId: string | null;
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

export interface AssemblyRecord {
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
  parameters: AssemblyParameterRecord[];
  components: AssemblyComponentRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface AssemblyInsertResult {
  workspace: WorkspaceResponse;
  insertion: {
    itemIds: string[];
    instanceId: string;
    warnings: string[];
  };
}

export async function listAssemblies(): Promise<AssemblySummaryRecord[]> {
  return apiRequest<AssemblySummaryRecord[]>("/api/assemblies");
}

export async function getAssembly(assemblyId: string): Promise<AssemblyRecord> {
  return apiRequest<AssemblyRecord>(`/api/assemblies/${assemblyId}`);
}

export async function createAssembly(input: {
  name: string;
  code?: string;
  description?: string;
  category?: string;
  unit?: string;
  metadata?: Record<string, unknown>;
}): Promise<AssemblyRecord> {
  return apiRequest<AssemblyRecord>("/api/assemblies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateAssembly(
  assemblyId: string,
  patch: Partial<{
    name: string;
    code: string;
    description: string;
    category: string;
    unit: string;
    metadata: Record<string, unknown>;
  }>,
): Promise<AssemblyRecord> {
  return apiRequest<AssemblyRecord>(`/api/assemblies/${assemblyId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteAssembly(assemblyId: string): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(`/api/assemblies/${assemblyId}`, { method: "DELETE" });
}

export async function createAssemblyParameter(
  assemblyId: string,
  input: {
    key: string;
    label?: string;
    description?: string;
    paramType?: string;
    defaultValue?: string;
    unit?: string;
    sortOrder?: number;
  },
): Promise<AssemblyParameterRecord> {
  return apiRequest<AssemblyParameterRecord>(`/api/assemblies/${assemblyId}/parameters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateAssemblyParameter(
  assemblyId: string,
  parameterId: string,
  patch: Partial<{
    key: string;
    label: string;
    description: string;
    paramType: string;
    defaultValue: string;
    unit: string;
    sortOrder: number;
  }>,
): Promise<AssemblyParameterRecord> {
  return apiRequest<AssemblyParameterRecord>(`/api/assemblies/${assemblyId}/parameters/${parameterId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteAssemblyParameter(assemblyId: string, parameterId: string): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(`/api/assemblies/${assemblyId}/parameters/${parameterId}`, {
    method: "DELETE",
  });
}

export async function createAssemblyComponent(
  assemblyId: string,
  input: {
    componentType: AssemblyComponentTypeValue;
    catalogItemId?: string | null;
    rateScheduleItemId?: string | null;
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
  },
): Promise<AssemblyComponentRecord> {
  return apiRequest<AssemblyComponentRecord>(`/api/assemblies/${assemblyId}/components`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateAssemblyComponent(
  assemblyId: string,
  componentId: string,
  patch: Partial<{
    componentType: AssemblyComponentTypeValue;
    catalogItemId: string | null;
    rateScheduleItemId: string | null;
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
  }>,
): Promise<AssemblyComponentRecord> {
  return apiRequest<AssemblyComponentRecord>(`/api/assemblies/${assemblyId}/components/${componentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteAssemblyComponent(
  assemblyId: string,
  componentId: string,
): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(`/api/assemblies/${assemblyId}/components/${componentId}`, {
    method: "DELETE",
  });
}

export interface AssemblyPreviewResult {
  items: Array<{
    componentPath: string[];
    componentType: string;
    catalogItemId?: string;
    rateScheduleItemId?: string;
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
  totals: { cost: number; price: number; lineCount: number };
  warnings: string[];
}

export async function previewAssemblyExpansion(input: {
  assemblyId: string;
  quantity: number;
  parameterValues?: Record<string, number | string>;
}): Promise<AssemblyPreviewResult> {
  return apiRequest<AssemblyPreviewResult>("/api/assemblies/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function saveSelectionAsAssembly(
  projectId: string,
  worksheetId: string,
  input: {
    name: string;
    code?: string;
    description?: string;
    category?: string;
    unit?: string;
    worksheetItemIds: string[];
  },
): Promise<{ assembly: AssemblyRecord; skippedFreeform: number }> {
  return apiRequest<{ assembly: AssemblyRecord; skippedFreeform: number }>(
    `/projects/${projectId}/worksheets/${worksheetId}/assemblies/save-selection`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export interface AssemblyInstanceSummary {
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

export async function listAssemblyInstances(projectId: string, worksheetId: string): Promise<AssemblyInstanceSummary[]> {
  return apiRequest<AssemblyInstanceSummary[]>(
    `/projects/${projectId}/worksheets/${worksheetId}/assemblies/instances`,
  );
}

export async function deleteAssemblyInstance(
  projectId: string,
  instanceId: string,
): Promise<{ workspace: WorkspaceResponse; deleted: { deleted: true; itemCount: number } }> {
  return apiRequest<{ workspace: WorkspaceResponse; deleted: { deleted: true; itemCount: number } }>(
    `/projects/${projectId}/assemblies/instances/${instanceId}`,
    { method: "DELETE" },
  );
}

export async function resyncAssemblyInstance(
  projectId: string,
  instanceId: string,
  input: { quantity?: number; parameterValues?: Record<string, number | string>; phaseId?: string | null },
): Promise<{
  workspace: WorkspaceResponse;
  resync: { itemIds: string[]; instanceId: string; warnings: string[]; itemCount: number };
}> {
  return apiRequest<{
    workspace: WorkspaceResponse;
    resync: { itemIds: string[]; instanceId: string; warnings: string[]; itemCount: number };
  }>(`/projects/${projectId}/assemblies/instances/${instanceId}/resync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function insertAssemblyIntoWorksheet(
  projectId: string,
  worksheetId: string,
  input: {
    assemblyId: string;
    quantity: number;
    parameterValues?: Record<string, number | string>;
    phaseId?: string | null;
  },
): Promise<AssemblyInsertResult> {
  return apiRequest<AssemblyInsertResult>(
    `/projects/${projectId}/worksheets/${worksheetId}/assemblies/insert`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}
