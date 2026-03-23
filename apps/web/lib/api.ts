const DEFAULT_API_BASE_URL = "http://localhost:4001";

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

function resolveApiUrl(path: string) {
  return new URL(path, apiBaseUrl).toString();
}

function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("bw_token");
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (token && !headers["Authorization"]) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const { headers: _discardHeaders, ...restInit } = init ?? {};
  const response = await fetch(resolveApiUrl(path), {
    cache: "no-store",
    ...restInit,
    headers,
  });

  if (response.status === 401) {
    // Clear auth state and redirect to login
    if (typeof window !== "undefined" && !path.includes("/auth/")) {
      localStorage.removeItem("bw_token");
      localStorage.removeItem("bw_user");
      localStorage.removeItem("bw_org");
      window.location.href = "/login";
    }
  }

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
  rateScheduleItemId?: string | null;
  itemId?: string | null;
  tierUnits?: Record<string, number>;
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

export type ScheduleTaskType = "task" | "milestone";
export type ScheduleTaskStatus = "not_started" | "in_progress" | "complete" | "on_hold";
export type DependencyType = "FS" | "SS" | "FF" | "SF";

export interface ScheduleTask {
  id: string;
  projectId: string;
  revisionId: string;
  phaseId: string | null;
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
  rateSchedules: RateSchedule[];
  catalogs: CatalogSummary[];
  aiRuns: AiRun[];
  citations: Citation[];
  scheduleTasks: ScheduleTask[];
  scheduleDependencies: ScheduleDependency[];
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

export type CalculationType =
  | "auto_labour"
  | "auto_equipment"
  | "auto_stock"
  | "auto_consumable"
  | "auto_subcontract"
  | "direct_price"
  | "manual"
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
    laborHourReg: boolean;
    laborHourOver: boolean;
    laborHourDouble: boolean;
  };
  laborHourLabels: {
    reg: string;
    over: string;
    double: string;
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
  rateScheduleItemId?: string | null;
  itemId?: string | null;
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
  itemId?: string | null;
  tierUnits?: Record<string, number>;
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
}

export interface ScheduleTaskPatchInput {
  phaseId?: string | null;
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
}

export interface CreateDependencyInput {
  predecessorId: string;
  successorId: string;
  type?: DependencyType;
  lagDays?: number;
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
  const token = getAuthToken();
  const url = resolveApiUrl(`/projects/${projectId}/pdf/schedule`);
  return token ? `${url}?token=${token}` : url;
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
  name: string; code?: string; unit?: string; rates?: Record<string, number>; costRates?: Record<string, number>;
  burden?: number; perDiem?: number; catalogItemId?: string; sortOrder?: number;
}): Promise<RateSchedule> {
  return apiRequest<RateSchedule>(`/api/rate-schedules/${scheduleId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateRateScheduleItem(scheduleId: string, itemId: string, patch: {
  name?: string; code?: string; unit?: string; rates?: Record<string, number>; costRates?: Record<string, number>;
  burden?: number; perDiem?: number; sortOrder?: number;
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
  rates?: Record<string, number>; costRates?: Record<string, number>; burden?: number; perDiem?: number;
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
  scope?: string;
  notes?: string;
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
  const token = getAuthToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
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

  if (input.packageName) {
    formData.append("packageName", input.packageName);
    formData.append("projectName", input.packageName); // Also set project name from package name
  }
  if (input.clientName) formData.append("clientName", input.clientName);
  if (input.location) formData.append("location", input.location);
  if (input.dueDate) formData.append("dueDate", input.dueDate);
  if (input.scope) formData.append("scope", input.scope);
  if (input.notes) formData.append("notes", input.notes);

  const path = input.projectId ? `/projects/${input.projectId}/packages/upload` : "/ingestion/package";

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(resolveApiUrl(path), {
    method: "POST",
    body: formData,
    headers,
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
      ...(typeof window !== "undefined" && getAuthToken()
        ? { Authorization: `Bearer ${getAuthToken()}` }
        : {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Upload failed: ${response.status}`);
  }

  return response.json();
}

export function getFileDownloadUrl(projectId: string, nodeId: string, inline = false): string {
  const token = getAuthToken();
  const url = resolveApiUrl(`/projects/${projectId}/files/${nodeId}/download${inline ? "?inline=1" : ""}`);
  if (!token) return url;
  return url + (inline ? "&" : "?") + `token=${token}`;
}

export function getDocumentDownloadUrl(projectId: string, docId: string, inline = false): string {
  const token = getAuthToken();
  const url = resolveApiUrl(`/projects/${projectId}/documents/${docId}/download${inline ? "?inline=1" : ""}`);
  if (!token) return url;
  return url + (inline ? "&" : "?") + `token=${token}`;
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
// Settings
// ---------------------------------------------------------------------------

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

export interface AppSettingsRecord {
  general: { orgName: string; address: string; phone: string; website: string; logoUrl: string };
  email: { host: string; port: number; username: string; password: string; fromAddress: string; fromName: string };
  defaults: { defaultMarkup: number; breakoutStyle: string; quoteType: string; timezone: string; currency: string; dateFormat: string; fiscalYearStart: number };
  integrations: { openaiKey: string; anthropicKey: string; openrouterKey: string; geminiKey: string; lmstudioBaseUrl?: string; llmProvider: string; llmModel: string; azureDiEndpoint?: string; azureDiKey?: string };
  brand: BrandProfile;
}

export async function getSettings() {
  return apiRequest<AppSettingsRecord>("/settings");
}

export async function testEmailConnection() {
  return apiRequest<{ success: boolean; message: string }>("/settings/test-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export async function testProviderKey(provider: string, apiKey: string, baseUrl?: string) {
  return apiRequest<{ success: boolean; message: string }>("/settings/integrations/test-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey, baseUrl }),
  });
}

export async function fetchProviderModels(provider: string, apiKey: string, baseUrl?: string) {
  return apiRequest<{ models: { id: string; name: string }[] }>("/settings/integrations/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey, baseUrl }),
  });
}

export async function searchTools(query: string) {
  const params = new URLSearchParams({ search: query });
  return apiRequest<Array<{ id: string; name: string; description: string; pluginId: string }>>(`/api/tools?${params.toString()}`);
}

export async function updateSettings(patch: Partial<AppSettingsRecord>) {
  return apiRequest<AppSettingsRecord>("/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function getBrand() {
  return apiRequest<BrandProfile>("/settings/brand");
}

export async function updateBrand(patch: Partial<BrandProfile>) {
  return apiRequest<BrandProfile>("/settings/brand", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function captureBrand(websiteUrl: string) {
  return apiRequest<BrandProfile>("/settings/brand/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ websiteUrl }),
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
  organizationId?: string;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface OrgInfo {
  id: string;
  name: string;
  slug: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
  organization: OrgInfo | null;
  isSuperAdmin?: boolean;
}

export interface MeResponse {
  user: AuthUser;
  organization: OrgInfo | null;
  isSuperAdmin: boolean;
  impersonating: boolean;
}

export interface SignupRequest {
  orgName: string;
  orgSlug: string;
  email: string;
  name: string;
  password: string;
}

export interface SignupResponse {
  token: string;
  user: AuthUser;
  organization: OrgInfo;
}

export interface SetupStatusResponse {
  initialized: boolean;
  hasOrganizations: boolean;
  superAdminCount: number;
  organizationCount: number;
}

export async function login(email: string, password: string, orgSlug?: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, orgSlug }),
  });
}

export async function signup(data: SignupRequest): Promise<SignupResponse> {
  return apiRequest<SignupResponse>("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function superLogin(email: string, password: string): Promise<{ token: string; superAdmin: { id: string; email: string; name: string } }> {
  return apiRequest("/api/auth/super-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export async function getCurrentUser(): Promise<MeResponse> {
  return apiRequest<MeResponse>("/api/auth/me");
}

export async function getSetupStatus(): Promise<SetupStatusResponse> {
  return apiRequest<SetupStatusResponse>("/api/setup/status");
}

export async function initSetup(data: {
  email: string;
  name: string;
  password: string;
  orgName?: string;
  orgSlug?: string;
}): Promise<{ token: string; superAdmin: { id: string; email: string; name: string }; organization: OrgInfo | null }> {
  return apiRequest("/api/setup/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function seedSampleData(organizationId: string): Promise<{ ok: boolean; message: string }> {
  return apiRequest("/api/setup/seed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
}

export async function seedEssentials(organizationId: string): Promise<{ ok: boolean }> {
  return apiRequest("/api/setup/seed-essentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
}

// ── Admin API ─────────────────────────────────────────────────────────

export interface OrgLimits {
  maxUsers: number;
  maxProjects: number;
  maxStorage: number;
  maxKnowledgeBooks: number;
}

export interface AdminOrg {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  userCount: number;
  projectCount: number;
  knowledgeBookCount: number;
  limits: OrgLimits;
}

export async function adminListOrganizations(): Promise<AdminOrg[]> {
  return apiRequest<AdminOrg[]>("/api/admin/organizations");
}

export async function adminCreateOrganization(data: {
  name: string;
  slug?: string;
  adminEmail?: string;
  adminName?: string;
  adminPassword?: string;
}): Promise<{ organization: OrgInfo; adminUser: { id: string; email: string; name: string } | null }> {
  return apiRequest("/api/admin/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function adminDeleteOrganization(orgId: string): Promise<{ ok: boolean }> {
  return apiRequest(`/api/admin/organizations/${orgId}`, { method: "DELETE" });
}

export async function adminListOrgUsers(orgId: string): Promise<AuthUser[]> {
  return apiRequest<AuthUser[]>(`/api/admin/organizations/${orgId}/users`);
}

export async function adminImpersonate(organizationId: string): Promise<{ token: string; organization: OrgInfo }> {
  return apiRequest("/api/admin/impersonate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
}

export async function adminStopImpersonation(): Promise<{ ok: boolean }> {
  return apiRequest("/api/admin/stop-impersonation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export async function adminUpdateOrgLimits(orgId: string, limits: Partial<OrgLimits>): Promise<OrgLimits> {
  return apiRequest(`/api/admin/organizations/${orgId}/limits`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(limits),
  });
}

export async function adminCreateOrgUser(orgId: string, data: {
  email: string;
  name: string;
  role?: string;
  password?: string;
}): Promise<AuthUser> {
  return apiRequest(`/api/admin/organizations/${orgId}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function adminUpdateUser(userId: string, patch: Partial<{
  name: string;
  email: string;
  role: string;
  active: boolean;
  password: string;
}>): Promise<AuthUser> {
  return apiRequest(`/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function adminDeleteUser(userId: string): Promise<{ ok: boolean }> {
  return apiRequest(`/api/admin/users/${userId}`, { method: "DELETE" });
}

export async function adminMoveUser(userId: string, organizationId: string): Promise<AuthUser> {
  return apiRequest(`/api/admin/users/${userId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
}

export async function adminGetMyMemberships(): Promise<{ organizationIds: string[] }> {
  return apiRequest("/api/admin/my-memberships");
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
// Profile & Org Switching
// ---------------------------------------------------------------------------

export async function updateProfile(data: { name?: string; currentPassword?: string; newPassword?: string }) {
  return apiRequest<{ id: string; email: string; name: string }>("/api/auth/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export interface UserOrganization {
  organizationId: string;
  name: string;
  slug: string;
  role: string;
  current: boolean;
}

export async function listMyOrganizations(): Promise<UserOrganization[]> {
  return apiRequest<UserOrganization[]>("/api/auth/organizations");
}

export async function switchOrganization(organizationId: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>("/api/auth/switch-org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
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

export async function ingestKnowledgeFile(input: {
  file: File;
  title: string;
  category: string;
  scope?: string;
  projectId?: string;
}): Promise<KnowledgeBookRecord> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("title", input.title);
  form.append("category", input.category);
  if (input.scope) form.append("scope", input.scope);
  if (input.projectId) form.append("projectId", input.projectId);

  const token = getAuthToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(resolveApiUrl("/knowledge/ingest-file"), {
    method: "POST",
    headers,
    body: form,
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
  const token = getAuthToken();
  const url = resolveApiUrl(`/knowledge/books/${bookId}/file?inline=1`);
  return token ? `${url}&token=${token}` : url;
}

export function getBookThumbnailUrl(bookId: string) {
  const token = getAuthToken();
  const base = resolveApiUrl(`/knowledge/books/${bookId}/thumbnail`);
  return token ? `${base}?token=${token}` : base;
}

export async function searchBookChunks(bookId: string, query: string, limit = 20) {
  return apiRequest<{ hits: Array<{ id: string; text: string; score: number; sectionTitle?: string; pageNumber?: number }>; query: string; count: number }>(
    `/api/knowledge/search/enhanced?q=${encodeURIComponent(query)}&bookId=${bookId}&limit=${limit}`
  );
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
  source: "manual" | "import" | "ai_generated" | "plugin" | "library";
  sourceDescription: string;
  isTemplate?: boolean;
  sourceTemplateId?: string | null;
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
  duration_ms: number;
  errors: string[];
}

export async function runVisionCountSymbols(input: {
  projectId: string;
  documentId: string;
  pageNumber: number;
  boundingBox: VisionBoundingBox;
  threshold?: number;
  methods?: string[];
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
}) {
  return apiRequest<VisionCountAllPagesResult>("/api/vision/count-symbols-all-pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Intake Orchestration
// ---------------------------------------------------------------------------

export interface IntakeStartInput {
  projectId: string;
  scope?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  maxIterations?: number;
}

export interface IntakeStartResult {
  sessionId: string;
  projectId: string;
  scope: string;
  status: string;
  documentCount: number;
  message: string;
}

export interface IntakeStatusResult {
  sessionId: string;
  projectId: string;
  scope: string;
  status: "running" | "completed" | "failed";
  toolCallCount: number;
  messageCount: number;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  recentToolCalls: Array<{ toolId: string; success: boolean; duration_ms: number }>;
}

export async function startIntake(input: IntakeStartInput) {
  return apiRequest<IntakeStartResult>("/api/intake/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getIntakeStatus(sessionId: string) {
  return apiRequest<IntakeStatusResult>(`/api/intake/${sessionId}/status`);
}

export async function stopIntake(sessionId: string) {
  return apiRequest<{ message: string; status: string }>(`/api/intake/${sessionId}/stop`, {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// CLI Agent Runtime
// ---------------------------------------------------------------------------

export async function detectCli() {
  return apiRequest<{
    claude: { available: boolean; path: string; version?: string };
    codex: { available: boolean; path: string; version?: string };
  }>("/api/cli/detect");
}

export async function startCliSession(input: {
  projectId: string;
  runtime?: "claude-code" | "codex";
  model?: string;
  scope?: string;
  prompt?: string;
}) {
  return apiRequest<{ sessionId: string; projectId: string; runtime: string; status: string }>(
    "/api/cli/start",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
  );
}

export function connectCliStream(projectId: string): EventSource {
  const token = typeof window !== "undefined" ? localStorage.getItem("bw_token") : null;
  const url = new URL(`/api/cli/${projectId}/stream`, apiBaseUrl);
  if (token) url.searchParams.set("token", token);
  return new EventSource(url.toString());
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
