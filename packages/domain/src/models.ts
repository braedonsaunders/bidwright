export type ProjectIngestionStatus = "queued" | "processing" | "ready" | "review" | "quoted";
export type QuoteStatus = "draft" | "review" | "submitted" | "awarded" | "lost";
export type AiRunStatus = "queued" | "running" | "complete" | "failed";
export type CatalogKind =
  | "labor"
  | "equipment"
  | "materials"
  | "knowledge_library"
  | "rate_book";

export interface Project {
  id: string;
  name: string;
  clientName: string;
  location: string;
  packageName: string;
  packageUploadedAt: string;
  ingestionStatus: ProjectIngestionStatus;
  summary: string;
  createdAt: string;
  updatedAt: string;
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

export interface Worksheet {
  id: string;
  revisionId: string;
  name: string;
  order: number;
}

export interface WorksheetItem {
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
  tierUnits?: Record<string, number>;
}

export interface Phase {
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

// ── Schedule Tasks ──────────────────────────────────────────────────────

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
export type RateScheduleCategory = "labour" | "equipment" | "materials" | "general";

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

export interface Activity {
  id: string;
  projectId: string;
  revisionId: string | null;
  type: string;
  data: Record<string, unknown>;
  userId: string | null;
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

export interface PluginField {
  id: string;
  type: PluginFieldType;
  label: string;
  description?: string;
  placeholder?: string;
  defaultValue?: unknown;
  options?: PluginFieldOption[];            // for select/multi-select/radio
  optionsSource?: {                         // dynamic options from dataset or API
    type: "dataset" | "api" | "cascade";
    datasetId?: string;
    column?: string;
    endpoint?: string;
    dependsOn?: string;                     // cascade: parent field id
    parentColumn?: string;                  // cascade: filter by parent value
  };
  validation?: PluginFieldValidation;
  conditionals?: PluginFieldConditional[];  // show/hide/modify based on other fields
  computation?: {                           // computed fields
    formula: string;                        // e.g., "quantity * hoursPerUnit * difficultyFactor"
    dependencies: string[];                 // field ids used in formula
    format?: string;                        // display format: "number", "currency", "hours"
  };
  searchConfig?: {                          // for "search" type fields
    endpoint: string;
    queryParam: string;
    displayField: string;
    valueField: string;
    resultFields?: string[];
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
  // For revision_patch: which field to write (e.g., "necaDifficulty", "defaultMarkup")
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
  laborHourReg?: number;
  laborHourOver?: number;
  laborHourDouble?: number;
  phaseId?: string;
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
  field: string;           // e.g., "necaDifficulty", "defaultMarkup"
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
  category: "labour" | "equipment" | "material" | "travel" | "general";
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
  general: { orgName: string; address: string; phone: string; website: string; logoUrl: string };
  email: { host: string; port: number; username: string; password: string; fromAddress: string; fromName: string };
  defaults: { defaultMarkup: number; breakoutStyle: string; quoteType: string; timezone: string; currency: string; dateFormat: string; fiscalYearStart: number };
  integrations: { openaiKey: string; anthropicKey: string; openrouterKey: string; geminiKey: string; llmProvider: string; llmModel: string };
  brand: BrandProfile;
}

// ── Knowledge Base ──

export interface KnowledgeBook {
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

export interface Dataset {
  id: string;
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
  worksheets: Worksheet[];
  worksheetItems: WorksheetItem[];
  phases: Phase[];
  modifiers: Modifier[];
  additionalLineItems: AdditionalLineItem[];
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
  datasets: Dataset[];
  datasetRows: DatasetRow[];
  entityCategories: EntityCategory[];
  scheduleTasks: ScheduleTask[];
  scheduleDependencies: ScheduleDependency[];
  rateSchedules: RateSchedule[];
  rateScheduleTiers: RateScheduleTier[];
  rateScheduleItems: RateScheduleItem[];
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

export interface RevisionTotals {
  subtotal: number;
  cost: number;
  estimatedProfit: number;
  estimatedMargin: number;
  calculatedTotal: number;
  regHours: number;
  overHours: number;
  doubleHours: number;
  totalHours: number;
  categoryTotals: Array<{
    name: string;
    value: number;
  }>;
  tierUnitTotals?: Record<string, number>;
  breakout: BreakoutEntry[];
}

export interface ProjectWorkspace {
  project: Project;
  sourceDocuments: SourceDocument[];
  quote: Quote;
  currentRevision: QuoteRevision;
  worksheets: Array<Worksheet & { items: WorksheetItem[] }>;
  phases: Phase[];
  modifiers: Modifier[];
  additionalLineItems: AdditionalLineItem[];
  conditions: Condition[];
  catalogs: Array<Catalog & { items: CatalogItem[] }>;
  aiRuns: AiRun[];
  citations: Citation[];
  scheduleTasks: ScheduleTask[];
  scheduleDependencies: ScheduleDependency[];
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
