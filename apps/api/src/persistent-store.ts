import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { buildProjectWorkspace, getProjectById, listProjects, mockStore, summarizeProjectTotals } from "@bidwright/domain";
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
  FileNode,
  Job,
  LabourRate,
  Modifier,
  Phase,
  Plugin,
  PluginExecution,
  Project,
  ProjectWorkspace,
  Quote,
  QuoteRevision,
  ReportSection,
  SourceDocument,
  User,
  WorksheetItem,
  KnowledgeBook,
  KnowledgeChunk,
  Dataset,
  DatasetRow,
} from "@bidwright/domain";
import type { DocumentChunk, IngestionReport, PackageSourceKind } from "@bidwright/ingestion";
import { ingestCustomerPackage } from "@bidwright/ingestion";

import {
  apiDataRoot,
  relativeJobPath,
  relativePackageArchivePath,
  relativePackageChunksPath,
  relativePackageDocumentPath,
  relativePackageReportPath,
  relativePackageRoot,
  relativeStatePath,
  relativeWorkspacePath,
  resolveApiPath,
  resolveRelativePath,
  sanitizeFileName
} from "./paths.js";

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

export interface ApiStateFile {
  version: 1;
  store: BidwrightStore;
  packages: StoredPackageRecord[];
  jobs: IngestionJobRecord[];
  workspaceStates: WorkspaceStateRecord[];
  settings: AppSettings;
}

export type PluginPatchInput = Partial<Pick<Plugin, "name" | "description" | "enabled" | "config">>;

export type CreatePluginInput = Omit<Plugin, "id" | "createdAt" | "updatedAt">;

const DEFAULT_SETTINGS: AppSettings = {
  general: { orgName: "", address: "", phone: "", website: "", logoUrl: "" },
  email: { host: "", port: 587, username: "", password: "", fromAddress: "", fromName: "" },
  defaults: { defaultMarkup: 15, breakoutStyle: "category", quoteType: "Firm" },
  integrations: { openaiKey: "", anthropicKey: "", openrouterKey: "", geminiKey: "", llmProvider: "anthropic", llmModel: "claude-sonnet-4-20250514" },
};

export interface CreateProjectInput {
  name: string;
  clientName: string;
  location: string;
  packageName?: string;
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

function calculateLineItem(
  item: WorksheetItem,
  _revision: QuoteRevision,
  labourRates: { name: string; regularRate: number; overtimeRate: number; doubleRate: number }[]
): Partial<WorksheetItem> {
  const category = item.category;

  switch (category) {
    case "Labour": {
      const rate = labourRates.find((r) => r.name === item.entityName) ?? labourRates[0];
      if (!rate) return {};
      const price =
        ((rate.regularRate * item.laborHourReg) +
          (rate.overtimeRate * item.laborHourOver) +
          (rate.doubleRate * item.laborHourDouble)) *
        item.quantity;
      return { price, cost: roundMoney(price * 0.7) };
    }
    case "Equipment": {
      const days = item.laborHourReg;
      const price = item.cost * days * item.quantity;
      return { price: roundMoney(price) };
    }
    case "Other Charges": {
      return { cost: 0, markup: 0 };
    }
    case "Consumables": {
      const cost = item.quantity * item.cost;
      const price = cost * (1 + item.markup);
      return { price: roundMoney(price) };
    }
    default: {
      const price = item.quantity * item.cost * (1 + item.markup);
      return { price: roundMoney(price) };
    }
  }
}

function isoNow() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function cloneStore(store: BidwrightStore) {
  return structuredClone(store);
}

function defaultProjectSummary(packageName: string, clientName: string) {
  return `${packageName} for ${clientName}`;
}

function makeQuoteNumber() {
  const now = new Date();
  const year = String(now.getUTCFullYear()).slice(-2);
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const suffix = randomUUID().slice(0, 4).toUpperCase();
  return `BW-${year}${month}${day}-${suffix}`;
}

function createEmptyRevision(revisionId: string, quoteId: string): QuoteRevision {
  const timestamp = isoNow();

  return {
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
    scratchpad: "",
    leadLetter: "",
    dateEstimatedShip: null,
    dateQuote: null,
    dateDue: null,
    dateWalkdown: null,
    dateWorkStart: null,
    dateWorkEnd: null,
    shippingMethod: "",
    shippingTerms: "",
    freightOnBoard: "",
    status: "Open",
    defaultMarkup: 0.2,
    necaDifficulty: "Normal",
    followUpNote: "",
    printEmptyNotesColumn: false,
    printCategory: [],
    printPhaseTotalOnly: false,
    showOvertimeDoubletime: false,
    grandTotal: 0,
    regHours: 0,
    overHours: 0,
    doubleHours: 0,
    breakoutPackage: [],
    calculatedCategoryTotals: [],
    subtotal: 0,
    cost: 0,
    estimatedProfit: 0,
    estimatedMargin: 0,
    calculatedTotal: 0,
    totalHours: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function createSeedWorkspaceState(projectId: string, quoteId: string, revisionId: string, worksheetId: string | null) {
  return {
    projectId,
    state: {
      activeTab: "overview",
      selectedQuoteId: quoteId,
      selectedRevisionId: revisionId,
      selectedWorksheetId: worksheetId,
      selectedDocumentId: null,
      openDocumentIds: [],
      filters: {
        documentKinds: [],
        search: ""
      },
      panels: {
        documents: true,
        estimate: true,
        ai: true
      }
    },
    updatedAt: isoNow(),
    storagePath: relativeWorkspacePath(projectId)
  };
}

function normalizeState(rawState: Partial<ApiStateFile> | undefined): ApiStateFile {
  const store = rawState?.store ? cloneStore(rawState.store) : cloneStore(mockStore);

  // Ensure all arrays exist (handles old state files missing new fields)
  if (!Array.isArray(store.labourRates)) store.labourRates = [];
  if (!Array.isArray(store.activities)) store.activities = [];
  if (!Array.isArray(store.conditionLibrary)) store.conditionLibrary = [];
  if (!Array.isArray(store.reportSections)) store.reportSections = [];
  if (!Array.isArray(store.additionalLineItems)) store.additionalLineItems = [];
  if (!Array.isArray(store.jobs)) store.jobs = [];
  if (!Array.isArray(store.fileNodes)) store.fileNodes = [];
  if (!Array.isArray(store.plugins)) store.plugins = [];
  if (!Array.isArray(store.pluginExecutions)) store.pluginExecutions = [];
  if (!Array.isArray(store.knowledgeBooks)) store.knowledgeBooks = [];
  if (!Array.isArray(store.knowledgeChunks)) store.knowledgeChunks = [];
  if (!Array.isArray(store.datasets)) store.datasets = [];
  if (!Array.isArray(store.datasetRows)) store.datasetRows = [];

  const packages = Array.isArray(rawState?.packages) ? rawState!.packages : [];
  const jobs = Array.isArray(rawState?.jobs) ? rawState!.jobs : [];
  const workspaceStates = Array.isArray(rawState?.workspaceStates) ? rawState!.workspaceStates : [];
  const settings: AppSettings = rawState?.settings ? structuredClone(rawState.settings) : structuredClone(DEFAULT_SETTINGS);

  for (const project of store.projects) {
    const quote = store.quotes.find((entry) => entry.projectId === project.id);
    const revision = quote ? store.revisions.find((entry) => entry.quoteId === quote.id) : undefined;
    const existingWorkspace = workspaceStates.find((entry) => entry.projectId === project.id);

    if (!existingWorkspace && quote && revision) {
      const worksheet = store.worksheets
        .filter((entry) => entry.revisionId === revision.id)
        .sort((left, right) => left.order - right.order)[0];
      workspaceStates.push(createSeedWorkspaceState(project.id, quote.id, revision.id, worksheet?.id ?? null));
    }
  }

  return {
    version: 1,
    store,
    packages,
    jobs,
    workspaceStates,
    settings
  };
}

function documentTypeFromIngestion(kind: string): SourceDocument["documentType"] {
  switch (kind) {
    case "rfq":
    case "spec":
    case "drawing":
    case "addendum":
      return kind;
    case "schedule":
    case "email":
    case "estimate_book":
    case "unknown":
    default:
      return "reference";
  }
}

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

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const contents = await readFile(filePath, "utf8");
    return JSON.parse(contents) as T;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as NodeJS.ErrnoException).code : null;
    if (code === "ENOENT") {
      return null;
    }

    throw error;
  }
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

export class BidwrightApiStore {
  private state: ApiStateFile | null = null;
  private loading: Promise<void> | null = null;
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly stateFilePath = resolveApiPath(relativeStatePath())) {}

  async initialize() {
    await this.ensureLoaded();
  }

  private async ensureLoaded() {
    if (this.state) {
      return;
    }

    if (!this.loading) {
      this.loading = (async () => {
        await mkdir(apiDataRoot, { recursive: true });
        const existing = await readJsonFile<ApiStateFile>(this.stateFilePath);
        this.state = normalizeState(existing ?? undefined);
        await this.persist();
      })();
    }

    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async persist() {
    if (!this.state) {
      return;
    }

    await writeJsonAtomic(this.stateFilePath, this.state);
  }

  private async runMutation<T>(mutator: (state: ApiStateFile) => Promise<T> | T): Promise<T> {
    await this.ensureLoaded();
    const next = this.mutationQueue.then(async () => {
      const draft = normalizeState(this.state ?? undefined);
      const result = await mutator(draft);
      this.state = draft;
      await this.persist();
      return result;
    });

    this.mutationQueue = next.then(
      () => undefined,
      () => undefined
    );

    return next;
  }

  private snapshot() {
    if (!this.state) {
      throw new Error("Bidwright API state is not initialized");
    }

    return normalizeState(this.state);
  }

  private pushActivity(state: ApiStateFile, projectId: string, revisionId: string | null, type: string, data: Record<string, unknown>) {
    state.store.activities.push({
      id: createId("activity"),
      projectId,
      revisionId,
      type,
      data,
      userId: null,
      createdAt: isoNow(),
    });
  }

  private syncProjectEstimate(state: ApiStateFile, projectId: string, timestamp = isoNow()) {
    const project = state.store.projects.find((entry) => entry.id === projectId);
    const quote = state.store.quotes.find((entry) => entry.projectId === projectId);
    const revision = quote ? state.store.revisions.find((entry) => entry.id === quote.currentRevisionId) : undefined;
    const totals = summarizeProjectTotals(state.store, projectId);

    if (project) {
      project.updatedAt = timestamp;
    }

    if (quote) {
      quote.updatedAt = timestamp;
    }

    if (revision && totals) {
      revision.subtotal = totals.subtotal;
      revision.cost = totals.cost;
      revision.estimatedProfit = totals.estimatedProfit;
      revision.estimatedMargin = totals.estimatedMargin;
      revision.calculatedTotal = totals.calculatedTotal;
      revision.totalHours = totals.totalHours;
      revision.updatedAt = timestamp;
    }

    return totals;
  }

  private findCurrentRevision(state: ApiStateFile, projectId: string) {
    const quote = state.store.quotes.find((entry) => entry.projectId === projectId);
    const revision = quote ? state.store.revisions.find((entry) => entry.id === quote.currentRevisionId) : undefined;

    return {
      quote,
      revision
    };
  }

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
        pageCount: inferPageCount(document, report.chunks)
      };

      await writeJsonAtomic(absoluteDocumentPath, payload);
    }
  }

  private projectHasQuote(store: BidwrightStore, projectId: string) {
    return Boolean(store.quotes.find((quote) => quote.projectId === projectId));
  }

  private ensureProjectSkeleton(state: ApiStateFile, project: Project) {
    if (this.projectHasQuote(state.store, project.id)) {
      return;
    }

    const quoteId = createId("quote");
    const revisionId = createId("revision");
    const worksheetId = createId("worksheet");
    const timestamp = isoNow();

    state.store.quotes.push({
      id: quoteId,
      projectId: project.id,
      quoteNumber: makeQuoteNumber(),
      title: project.name,
      status: "draft",
      currentRevisionId: revisionId,
      customerExistingNew: "New",
      customerId: null,
      customerString: "",
      customerContactId: null,
      customerContactString: "",
      customerContactEmailString: "",
      departmentId: null,
      userId: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    state.store.revisions.push(createEmptyRevision(revisionId, quoteId));
    state.store.worksheets.push({
      id: worksheetId,
      revisionId,
      name: "Estimate",
      order: 1
    });

    if (!state.workspaceStates.find((entry) => entry.projectId === project.id)) {
      state.workspaceStates.push(createSeedWorkspaceState(project.id, quoteId, revisionId, worksheetId));
    }
  }

  async listProjects() {
    await this.ensureLoaded();
    return listProjects(this.snapshot().store);
  }

  async listProjectsWithState() {
    await this.ensureLoaded();
    const snapshot = this.snapshot();
    const store = snapshot.store;

    return listProjects(store).map((project) => ({
      ...project,
      packageCount: snapshot.packages.filter((entry) => entry.projectId === project.id).length,
      jobCount: snapshot.jobs.filter((entry) => entry.projectId === project.id).length,
      workspaceState: snapshot.workspaceStates.find((entry) => entry.projectId === project.id) ?? null
    }));
  }

  async getProject(projectId: string) {
    await this.ensureLoaded();
    const snapshot = this.snapshot();
    const project = getProjectById(snapshot.store, projectId);
    if (!project) {
      return null;
    }

    return {
      ...project,
      packageCount: snapshot.packages.filter((entry) => entry.projectId === projectId).length,
      jobCount: snapshot.jobs.filter((entry) => entry.projectId === projectId).length,
      workspaceState: snapshot.workspaceStates.find((entry) => entry.projectId === projectId) ?? null
    };
  }

  async deleteProject(projectId: string) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((p) => p.id === projectId);
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      // Collect IDs to cascade-delete
      const quoteIds = state.store.quotes
        .filter((q) => q.projectId === projectId)
        .map((q) => q.id);
      const revisionIds = state.store.revisions
        .filter((r) => quoteIds.includes(r.quoteId))
        .map((r) => r.id);
      const worksheetIds = state.store.worksheets
        .filter((w) => revisionIds.includes(w.revisionId))
        .map((w) => w.id);

      state.store.projects = state.store.projects.filter((p) => p.id !== projectId);
      state.store.sourceDocuments = state.store.sourceDocuments.filter((d) => d.projectId !== projectId);
      state.store.quotes = state.store.quotes.filter((q) => q.projectId !== projectId);
      state.store.revisions = state.store.revisions.filter((r) => !revisionIds.includes(r.id));
      state.store.worksheets = state.store.worksheets.filter((w) => !revisionIds.includes(w.revisionId));
      state.store.worksheetItems = state.store.worksheetItems.filter((wi) => !worksheetIds.includes(wi.worksheetId));
      state.store.phases = state.store.phases.filter((p) => !revisionIds.includes(p.revisionId));
      state.store.modifiers = state.store.modifiers.filter((m) => !revisionIds.includes(m.revisionId));
      state.store.conditions = state.store.conditions.filter((c) => !revisionIds.includes(c.revisionId));
      state.store.additionalLineItems = state.store.additionalLineItems.filter((a) => !revisionIds.includes(a.revisionId));
      state.store.labourRates = state.store.labourRates.filter((lr) => !revisionIds.includes(lr.revisionId));
      state.store.aiRuns = state.store.aiRuns.filter((r) => r.projectId !== projectId);
      state.store.citations = state.store.citations.filter((c) => c.projectId !== projectId);
      state.store.activities = state.store.activities.filter((a) => a.projectId !== projectId);
      state.store.reportSections = state.store.reportSections.filter((rs) => !revisionIds.includes(rs.revisionId));
      state.store.jobs = state.store.jobs.filter((j) => j.projectId !== projectId);
      state.packages = state.packages.filter((p) => p.projectId !== projectId);
      state.jobs = state.jobs.filter((j) => j.projectId !== projectId);
      state.workspaceStates = state.workspaceStates.filter((ws) => ws.projectId !== projectId);

      return { deleted: true };
    });
  }

  async getWorkspace(projectId: string) {
    await this.ensureLoaded();
    return buildProjectWorkspace(this.snapshot().store, projectId);
  }

  async getEstimateTotals(projectId: string) {
    await this.ensureLoaded();
    return summarizeProjectTotals(this.snapshot().store, projectId);
  }

  async listPackages(projectId?: string) {
    await this.ensureLoaded();
    const packages = this.snapshot().packages;
    return projectId ? packages.filter((entry) => entry.projectId === projectId) : packages;
  }

  async getPackage(packageId: string) {
    await this.ensureLoaded();
    return this.snapshot().packages.find((entry) => entry.id === packageId) ?? null;
  }

  async listJobs(projectId?: string) {
    await this.ensureLoaded();
    const jobs = this.snapshot().jobs;
    return projectId ? jobs.filter((entry) => entry.projectId === projectId) : jobs;
  }

  async getJob(jobId: string) {
    await this.ensureLoaded();
    return this.snapshot().jobs.find((entry) => entry.id === jobId) ?? null;
  }

  async listDocuments(projectId: string) {
    await this.ensureLoaded();
    return this.snapshot().store.sourceDocuments.filter((entry) => entry.projectId === projectId);
  }

  async listAiRuns(projectId?: string) {
    await this.ensureLoaded();
    const runs = this.snapshot().store.aiRuns;
    return projectId ? runs.filter((entry) => entry.projectId === projectId) : runs;
  }

  async listCatalogs() {
    await this.ensureLoaded();
    return this.snapshot().store.catalogs;
  }

  async listCatalogRates() {
    await this.ensureLoaded();
    return this.snapshot().store.catalogItems.map((item) => ({
      id: item.id,
      catalogId: item.catalogId,
      code: item.code,
      name: item.name,
      unit: item.unit,
      unitCost: item.unitCost,
      unitPrice: item.unitPrice,
      metadata: item.metadata
    }));
  }

  async getWorkspaceState(projectId: string) {
    await this.ensureLoaded();
    return this.snapshot().workspaceStates.find((entry) => entry.projectId === projectId) ?? null;
  }

  async updateWorkspaceState(projectId: string, patch: Record<string, unknown>) {
    return this.runMutation(async (state) => {
      const existing = state.workspaceStates.find((entry) => entry.projectId === projectId);
      if (!existing) {
        const project = state.store.projects.find((entry) => entry.id === projectId);
        if (!project) {
          throw new Error(`Project ${projectId} not found`);
        }

        const quote = state.store.quotes.find((entry) => entry.projectId === projectId);
        const revision = quote ? state.store.revisions.find((entry) => entry.quoteId === quote.id) : undefined;
        const worksheet = revision
          ? state.store.worksheets
              .filter((entry) => entry.revisionId === revision.id)
              .sort((left, right) => left.order - right.order)[0]
          : undefined;

        state.workspaceStates.push({
          projectId,
          state: {
            activeTab: "overview",
            selectedQuoteId: quote?.id ?? null,
            selectedRevisionId: revision?.id ?? null,
            selectedWorksheetId: worksheet?.id ?? null,
            selectedDocumentId: null,
            openDocumentIds: [],
            filters: {
              documentKinds: [],
              search: ""
            },
            ...patch
          },
          updatedAt: isoNow(),
          storagePath: relativeWorkspacePath(projectId)
        });
      } else {
        existing.state = {
          ...existing.state,
          ...patch
        };
        existing.updatedAt = isoNow();
      }

      const workspace = state.workspaceStates.find((entry) => entry.projectId === projectId);
      if (workspace) {
        await writeJsonAtomic(resolveApiPath(workspace.storagePath), workspace);
      }

      return workspace;
    });
  }

  async updateRevision(projectId: string, revisionId: string, patch: RevisionPatchInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const quote = state.store.quotes.find((entry) => entry.projectId === projectId);
      const revision = state.store.revisions.find((entry) => entry.id === revisionId);

      if (!project || !quote || !revision || revision.quoteId !== quote.id) {
        throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
      }

      const timestamp = isoNow();
      Object.assign(revision, patch);
      revision.updatedAt = timestamp;
      this.pushActivity(state, projectId, revisionId, "revision_updated", { fields: Object.keys(patch) });
      this.syncProjectEstimate(state, projectId, timestamp);

      return revision;
    });
  }

  async createWorksheetItem(projectId: string, worksheetId: string, input: CreateWorksheetItemInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const { revision } = this.findCurrentRevision(state, projectId);
      const worksheet = state.store.worksheets.find((entry) => entry.id === worksheetId);

      if (!project || !revision || !worksheet || worksheet.revisionId !== revision.id) {
        throw new Error(`Worksheet ${worksheetId} not found for project ${projectId}`);
      }

      const lineOrder =
        input.lineOrder ??
        Math.max(
          0,
          ...state.store.worksheetItems
            .filter((entry) => entry.worksheetId === worksheetId)
            .map((entry) => entry.lineOrder)
        ) +
          1;

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
        lineOrder
      };

      // Auto-calculate line item values
      const labourRates = state.store.labourRates.filter((r) => r.revisionId === revision.id);
      const calculated = calculateLineItem(item, revision, labourRates);
      Object.assign(item, calculated);

      state.store.worksheetItems.push(item);
      this.pushActivity(state, projectId, revision.id, "item_created", { itemId: item.id, entityName: item.entityName, category: item.category });
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return item;
    });
  }

  async createWorksheet(projectId: string, input: CreateWorksheetInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const { revision } = this.findCurrentRevision(state, projectId);
      if (!project || !revision) {
        throw new Error(`Project ${projectId} not found`);
      }

      const order =
        Math.max(
          0,
          ...state.store.worksheets
            .filter((entry) => entry.revisionId === revision.id)
            .map((entry) => entry.order)
        ) + 1;

      const worksheet = {
        id: createId("worksheet"),
        revisionId: revision.id,
        name: input.name.trim() || `Worksheet ${order}`,
        order
      };

      state.store.worksheets.push(worksheet);
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return worksheet;
    });
  }

  async updateWorksheet(projectId: string, worksheetId: string, patch: WorksheetPatchInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const { revision } = this.findCurrentRevision(state, projectId);
      const worksheet = state.store.worksheets.find((entry) => entry.id === worksheetId);

      if (!project || !revision || !worksheet || worksheet.revisionId !== revision.id) {
        throw new Error(`Worksheet ${worksheetId} not found for project ${projectId}`);
      }

      if (typeof patch.name === "string") {
        worksheet.name = patch.name.trim() || worksheet.name;
      }

      if (typeof patch.order === "number") {
        worksheet.order = patch.order;
      }

      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return worksheet;
    });
  }

  async deleteWorksheet(projectId: string, worksheetId: string) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const { revision } = this.findCurrentRevision(state, projectId);
      const worksheets = state.store.worksheets.filter((entry) => entry.revisionId === revision?.id);
      const worksheet = state.store.worksheets.find((entry) => entry.id === worksheetId);

      if (!project || !revision || !worksheet || worksheet.revisionId !== revision.id) {
        throw new Error(`Worksheet ${worksheetId} not found for project ${projectId}`);
      }

      if (worksheets.length <= 1) {
        throw new Error("The last worksheet in a revision cannot be deleted");
      }

      state.store.worksheets = state.store.worksheets.filter((entry) => entry.id !== worksheetId);
      state.store.worksheetItems = state.store.worksheetItems.filter((entry) => entry.worksheetId !== worksheetId);

      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return worksheet;
    });
  }

  async updateWorksheetItem(projectId: string, itemId: string, patch: WorksheetItemPatchInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const { revision } = this.findCurrentRevision(state, projectId);
      const item = state.store.worksheetItems.find((entry) => entry.id === itemId);
      const worksheet = item ? state.store.worksheets.find((entry) => entry.id === item.worksheetId) : undefined;

      if (!project || !revision || !item || !worksheet || worksheet.revisionId !== revision.id) {
        throw new Error(`Worksheet item ${itemId} not found for project ${projectId}`);
      }

      Object.assign(item, patch);
      if (patch.vendor === null) {
        delete item.vendor;
      }

      // Auto-calculate line item values after patch
      const labourRates = state.store.labourRates.filter((r) => r.revisionId === revision.id);
      const calculated = calculateLineItem(item, revision, labourRates);
      Object.assign(item, calculated);

      this.pushActivity(state, projectId, revision.id, "item_updated", { itemId: item.id, entityName: item.entityName, patch: Object.keys(patch) });
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return item;
    });
  }

  async deleteWorksheetItem(projectId: string, itemId: string) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const { revision } = this.findCurrentRevision(state, projectId);
      const index = state.store.worksheetItems.findIndex((entry) => entry.id === itemId);
      const item = index >= 0 ? state.store.worksheetItems[index] : undefined;
      const worksheet = item ? state.store.worksheets.find((entry) => entry.id === item.worksheetId) : undefined;

      if (!project || !revision || !item || !worksheet || worksheet.revisionId !== revision.id) {
        throw new Error(`Worksheet item ${itemId} not found for project ${projectId}`);
      }

      state.store.worksheetItems.splice(index, 1);
      this.pushActivity(state, projectId, revision.id, "item_deleted", { itemId: item.id, entityName: item.entityName });
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return item;
    });
  }

  async createProject(input: CreateProjectInput) {
    return this.runMutation(async (state) => {
      const now = isoNow();
      const projectId = createId("project");
      const packageName = input.packageName ?? input.name;
      const project: Project = {
        id: projectId,
        name: input.name,
        clientName: input.clientName,
        location: input.location,
        packageName,
        packageUploadedAt: now,
        ingestionStatus: "queued",
        summary: input.summary ?? defaultProjectSummary(packageName, input.clientName),
        createdAt: now,
        updatedAt: now
      };

      state.store.projects.push(project);
      this.ensureProjectSkeleton(state, project);

      const quote = state.store.quotes.find((entry) => entry.projectId === projectId);
      const revision = quote ? state.store.revisions.find((entry) => entry.quoteId === quote.id) : undefined;
      const worksheet = revision
        ? state.store.worksheets
            .filter((entry) => entry.revisionId === revision.id)
            .sort((left, right) => left.order - right.order)[0]
        : undefined;

      const workspace = state.workspaceStates.find((entry) => entry.projectId === projectId);
      if (workspace) {
        workspace.state = {
          ...workspace.state,
          selectedQuoteId: quote?.id ?? null,
          selectedRevisionId: revision?.id ?? null,
          selectedWorksheetId: worksheet?.id ?? null
        };
        workspace.updatedAt = isoNow();
        await writeJsonAtomic(resolveApiPath(workspace.storagePath), workspace);
      }

      return {
        project,
        quote: quote ?? null,
        revision: revision ?? null,
        workspaceState: workspace ?? null
      };
    });
  }

  async registerUploadedPackage(input: RegisterPackageInput & UploadArtifact) {
    return this.runMutation(async (state) => {
      const now = isoNow();
      const jobId = createId("job");
      const record: StoredPackageRecord = {
        id: input.packageId,
        projectId: input.projectId,
        packageName: input.packageName,
        originalFileName: input.originalFileName,
        sourceKind: input.sourceKind ?? "project",
        storagePath: input.storagePath,
        reportPath: null,
        chunksPath: null,
        checksum: input.checksum,
        totalBytes: input.totalBytes,
        status: "uploaded",
        documentCount: 0,
        chunkCount: 0,
        documentIds: [],
        unknownFiles: [],
        uploadedAt: now,
        ingestedAt: null,
        updatedAt: now,
        error: null
      };

      state.packages = state.packages.filter((entry) => entry.id !== input.packageId);
      state.packages.push(record);

      const jobRecord: IngestionJobRecord = {
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
          totalBytes: input.totalBytes
        },
        output: {
          packageId: input.packageId
        },
        error: null,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        completedAt: now,
        storagePath: relativeJobPath(jobId)
      };

      state.jobs.push(jobRecord);

      await writeJsonAtomic(resolveApiPath(relativeJobPath(jobId)), jobRecord);

      return record;
    });
  }

  async ingestUploadedPackage(packageId: string): Promise<PackageIngestionOutcome> {
    await this.ensureLoaded();
    const state = this.snapshot();
    const packageRecord = state.packages.find((entry) => entry.id === packageId);
    if (!packageRecord) {
      throw new Error(`Package ${packageId} not found`);
    }

    const project = state.store.projects.find((entry) => entry.id === packageRecord.projectId);
    if (!project) {
      throw new Error(`Project ${packageRecord.projectId} not found`);
    }

    const ingestionJobId = createId("job");
    const ingestionJob: IngestionJobRecord = {
      id: ingestionJobId,
      projectId: project.id,
      packageId,
      kind: "package_ingest",
      status: "processing",
      progress: 0.25,
      input: {
        packageId,
        packageName: packageRecord.packageName,
        originalFileName: packageRecord.originalFileName,
        storagePath: packageRecord.storagePath,
        sourceKind: packageRecord.sourceKind
      },
      output: null,
      error: null,
      createdAt: isoNow(),
      updatedAt: isoNow(),
      startedAt: isoNow(),
      completedAt: null,
      storagePath: relativeJobPath(ingestionJobId)
    };

    await this.runMutation(async (draft) => {
      draft.jobs.push(ingestionJob);
      const targetPackage = draft.packages.find((entry) => entry.id === packageId);
      if (targetPackage) {
        targetPackage.status = "processing";
        targetPackage.updatedAt = isoNow();
        targetPackage.error = null;
      }

      const targetProject = draft.store.projects.find((entry) => entry.id === project.id);
      if (targetProject) {
        targetProject.ingestionStatus = "processing";
        targetProject.updatedAt = isoNow();
      }
    });

    const zipPath = resolveRelativePath(packageRecord.storagePath);
    const checksum = await sha256File(zipPath);

    try {
      const report = await ingestCustomerPackage({
        packageId,
        packageName: packageRecord.packageName,
        sourceKind: packageRecord.sourceKind,
        zipInput: zipPath
      });

      await this.saveArtifactsForPackage(packageId, report, checksum);

      const timestamp = isoNow();
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
        createdAt: timestamp,
        updatedAt: timestamp
      }));

      const jobResult = {
        packageId,
        reportPath: relativePackageReportPath(packageId),
        chunksPath: relativePackageChunksPath(packageId),
        unknownFiles: report.unknownFiles,
        documentCount: sourceDocuments.length,
        chunkCount: report.chunks.length
      };

      await this.runMutation(async (draft) => {
        const targetPackage = draft.packages.find((entry) => entry.id === packageId);
        const targetProject = draft.store.projects.find((entry) => entry.id === project.id);
        const targetJob = draft.jobs.find((entry) => entry.id === ingestionJob.id);

        if (!targetPackage || !targetProject || !targetJob) {
          throw new Error("Package ingestion state could not be finalized");
        }

        draft.store.sourceDocuments = draft.store.sourceDocuments.filter(
          (entry) => !targetPackage.documentIds.includes(entry.id)
        );
        draft.store.sourceDocuments.push(...sourceDocuments);

        targetPackage.status = "ready";
        targetPackage.reportPath = relativePackageReportPath(packageId);
        targetPackage.chunksPath = relativePackageChunksPath(packageId);
        targetPackage.documentIds = sourceDocuments.map((entry) => entry.id);
        targetPackage.documentCount = sourceDocuments.length;
        targetPackage.chunkCount = report.chunks.length;
        targetPackage.unknownFiles = report.unknownFiles;
        targetPackage.ingestedAt = timestamp;
        targetPackage.updatedAt = timestamp;
        targetPackage.error = null;

        targetJob.status = "complete";
        targetJob.progress = 1;
        targetJob.output = jobResult;
        targetJob.error = null;
        targetJob.updatedAt = timestamp;
        targetJob.completedAt = timestamp;

        targetProject.packageName = packageRecord.packageName;
        targetProject.packageUploadedAt = timestamp;
        targetProject.ingestionStatus = sourceDocuments.length > 0 ? "review" : "queued";
        targetProject.summary =
          sourceDocuments.length > 0
            ? `Ingested ${sourceDocuments.length} documents from ${packageRecord.packageName}.`
            : `Package ${packageRecord.packageName} uploaded and awaiting classification.`;
        targetProject.updatedAt = timestamp;

        const workspace = draft.workspaceStates.find((entry) => entry.projectId === project.id);
        if (workspace) {
          workspace.state = {
            ...workspace.state,
            lastPackageId: packageId,
            selectedDocumentId: sourceDocuments[0]?.id ?? workspace.state["selectedDocumentId"] ?? null,
            selectedQuoteId:
              typeof workspace.state.selectedQuoteId === "string" ? workspace.state.selectedQuoteId : null,
            selectedRevisionId:
              typeof workspace.state.selectedRevisionId === "string" ? workspace.state.selectedRevisionId : null,
            selectedWorksheetId:
              typeof workspace.state.selectedWorksheetId === "string" ? workspace.state.selectedWorksheetId : null
          };
          workspace.updatedAt = timestamp;
        } else {
          const quote = draft.store.quotes.find((entry) => entry.projectId === project.id);
          const revision = quote ? draft.store.revisions.find((entry) => entry.quoteId === quote.id) : undefined;
          const worksheet = revision
            ? draft.store.worksheets
                .filter((entry) => entry.revisionId === revision.id)
                .sort((left, right) => left.order - right.order)[0]
            : undefined;

          draft.workspaceStates.push({
            projectId: project.id,
            state: {
              activeTab: "overview",
              selectedQuoteId: quote?.id ?? null,
              selectedRevisionId: revision?.id ?? null,
              selectedWorksheetId: worksheet?.id ?? null,
              selectedDocumentId: sourceDocuments[0]?.id ?? null,
              openDocumentIds: [],
              filters: {
                documentKinds: [],
                search: ""
              },
              lastPackageId: packageId
            },
            updatedAt: timestamp,
            storagePath: relativeWorkspacePath(project.id)
          });
        }

        const workspaceRecord = draft.workspaceStates.find((entry) => entry.projectId === project.id);
        if (workspaceRecord) {
          await writeJsonAtomic(resolveApiPath(workspaceRecord.storagePath), workspaceRecord);
        }

        const totals = summarizeProjectTotals(draft.store, project.id);
        const currentQuote = draft.store.quotes.find((entry) => entry.projectId === project.id);
        const currentRevision = currentQuote
          ? draft.store.revisions.find((entry) => entry.quoteId === currentQuote.id)
          : undefined;

        if (currentQuote && currentRevision && totals) {
          currentRevision.subtotal = totals.subtotal;
          currentRevision.cost = totals.cost;
          currentRevision.estimatedProfit = totals.estimatedProfit;
          currentRevision.estimatedMargin = totals.estimatedMargin;
          currentRevision.calculatedTotal = totals.calculatedTotal;
          currentRevision.totalHours = totals.totalHours;
          currentRevision.updatedAt = timestamp;
          currentQuote.currentRevisionId = currentRevision.id;
          currentQuote.updatedAt = timestamp;
        }

        await writeJsonAtomic(resolveApiPath(targetJob.storagePath), targetJob);
      });

      const refreshed = this.snapshot();
      const refreshedProject = refreshed.store.projects.find((entry) => entry.id === project.id);
      const refreshedQuote = refreshed.store.quotes.find((entry) => entry.projectId === project.id);
      const refreshedRevision = refreshedQuote
        ? refreshed.store.revisions.find((entry) => entry.quoteId === refreshedQuote.id)
        : undefined;

      if (!refreshedProject || !refreshedQuote || !refreshedRevision) {
        throw new Error("Project workspace could not be rebuilt after ingestion");
      }

      const workspace = buildProjectWorkspace(refreshed.store, project.id);
      if (!workspace) {
        throw new Error("Workspace is unavailable after ingestion");
      }

      const totals = summarizeProjectTotals(refreshed.store, project.id);

      return {
        project: refreshedProject,
        quote: refreshedQuote,
        revision: refreshedRevision,
        packageRecord: this.snapshot().packages.find((entry) => entry.id === packageId) ?? packageRecord,
        job: this.snapshot().jobs.find((entry) => entry.id === ingestionJob.id) ?? ingestionJob,
        report,
        documents: sourceDocuments,
        workspace,
        totals
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Package ingestion failed";
      await this.runMutation(async (draft) => {
        const targetPackage = draft.packages.find((entry) => entry.id === packageId);
        const targetProject = draft.store.projects.find((entry) => entry.id === project.id);
        const targetJob = draft.jobs.find((entry) => entry.id === ingestionJob.id);

        if (targetPackage) {
          targetPackage.status = "failed";
          targetPackage.error = message;
          targetPackage.updatedAt = isoNow();
        }

        if (targetProject) {
          targetProject.ingestionStatus = "review";
          targetProject.summary = `${targetProject.packageName} uploaded, but ingestion failed: ${message}`;
          targetProject.updatedAt = isoNow();
        }

        if (targetJob) {
          targetJob.status = "failed";
          targetJob.progress = 1;
          targetJob.error = message;
          targetJob.updatedAt = isoNow();
          targetJob.completedAt = isoNow();
          await writeJsonAtomic(resolveApiPath(targetJob.storagePath), targetJob);
        }
      });

      throw error;
    }
  }
  // ── Phase CRUD ──────────────────────────────────────────────────────

  async createPhase(projectId: string, revisionId: string, input: CreatePhaseInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const revision = state.store.revisions.find((entry) => entry.id === revisionId);
      if (!project || !revision) {
        throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
      }

      const existingPhases = state.store.phases.filter((entry) => entry.revisionId === revisionId);
      const order = Math.max(0, ...existingPhases.map((entry) => entry.order)) + 1;

      const phase: Phase = {
        id: createId("phase"),
        revisionId,
        number: input.number ?? String(order),
        name: input.name ?? `Phase ${order}`,
        description: input.description ?? "",
        order
      };

      state.store.phases.push(phase);
      this.pushActivity(state, projectId, revisionId, "phase_created", { phaseId: phase.id, name: phase.name });
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return phase;
    });
  }

  async updatePhase(projectId: string, phaseId: string, patch: PhasePatchInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const phase = state.store.phases.find((entry) => entry.id === phaseId);
      if (!project || !phase) {
        throw new Error(`Phase ${phaseId} not found for project ${projectId}`);
      }

      if (typeof patch.number === "string") {
        phase.number = patch.number;
      }
      if (typeof patch.name === "string") {
        phase.name = patch.name;
      }
      if (typeof patch.description === "string") {
        phase.description = patch.description;
      }
      if (typeof patch.order === "number") {
        phase.order = patch.order;
      }

      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return phase;
    });
  }

  async deletePhase(projectId: string, phaseId: string) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const phase = state.store.phases.find((entry) => entry.id === phaseId);
      if (!project || !phase) {
        throw new Error(`Phase ${phaseId} not found for project ${projectId}`);
      }

      state.store.phases = state.store.phases.filter((entry) => entry.id !== phaseId);

      for (const item of state.store.worksheetItems) {
        if (item.phaseId === phaseId) {
          item.phaseId = null;
        }
      }

      this.pushActivity(state, projectId, phase.revisionId, "phase_deleted", { phaseId: phase.id, name: phase.name });
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return phase;
    });
  }

  // ── Modifier CRUD ──────────────────────────────────────────────────

  async listModifiers(projectId: string) {
    await this.ensureLoaded();
    const snapshot = this.snapshot();
    const { revision } = this.findCurrentRevision(snapshot, projectId);
    if (!revision) {
      return [];
    }
    return snapshot.store.modifiers.filter((entry) => entry.revisionId === revision.id);
  }

  async createModifier(projectId: string, revisionId: string, input: CreateModifierInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const revision = state.store.revisions.find((entry) => entry.id === revisionId);
      if (!project || !revision) {
        throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
      }

      const modifier: Modifier = {
        id: createId("mod"),
        revisionId,
        name: input.name ?? "New Modifier",
        type: input.type ?? "percentage",
        appliesTo: input.appliesTo ?? "All",
        percentage: input.percentage ?? null,
        amount: input.amount ?? null,
        show: input.show ?? "Yes"
      };

      state.store.modifiers.push(modifier);
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return modifier;
    });
  }

  async updateModifier(projectId: string, modifierId: string, patch: ModifierPatchInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const modifier = state.store.modifiers.find((entry) => entry.id === modifierId);
      if (!project || !modifier) {
        throw new Error(`Modifier ${modifierId} not found for project ${projectId}`);
      }

      Object.assign(modifier, patch);
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return modifier;
    });
  }

  async deleteModifier(projectId: string, modifierId: string) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const modifier = state.store.modifiers.find((entry) => entry.id === modifierId);
      if (!project || !modifier) {
        throw new Error(`Modifier ${modifierId} not found for project ${projectId}`);
      }

      state.store.modifiers = state.store.modifiers.filter((entry) => entry.id !== modifierId);
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return modifier;
    });
  }

  // ── Condition CRUD ─────────────────────────────────────────────────

  async listConditionLibrary() {
    await this.ensureLoaded();
    return this.snapshot().store.conditionLibrary;
  }

  async listConditions(projectId: string) {
    await this.ensureLoaded();
    const snapshot = this.snapshot();
    const { revision } = this.findCurrentRevision(snapshot, projectId);
    if (!revision) {
      return [];
    }
    return snapshot.store.conditions
      .filter((entry) => entry.revisionId === revision.id)
      .sort((left, right) => left.order - right.order);
  }

  async createCondition(projectId: string, revisionId: string, input: CreateConditionInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const revision = state.store.revisions.find((entry) => entry.id === revisionId);
      if (!project || !revision) {
        throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
      }

      const existingConditions = state.store.conditions.filter((entry) => entry.revisionId === revisionId);
      const order = input.order ?? Math.max(0, ...existingConditions.map((entry) => entry.order)) + 1;

      const condition: Condition = {
        id: createId("cond"),
        revisionId,
        type: input.type,
        value: input.value,
        order
      };

      state.store.conditions.push(condition);
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return condition;
    });
  }

  async updateCondition(projectId: string, conditionId: string, patch: ConditionPatchInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const condition = state.store.conditions.find((entry) => entry.id === conditionId);
      if (!project || !condition) {
        throw new Error(`Condition ${conditionId} not found for project ${projectId}`);
      }

      if (typeof patch.type === "string") {
        condition.type = patch.type;
      }
      if (typeof patch.value === "string") {
        condition.value = patch.value;
      }
      if (typeof patch.order === "number") {
        condition.order = patch.order;
      }

      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return condition;
    });
  }

  async deleteCondition(projectId: string, conditionId: string) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const condition = state.store.conditions.find((entry) => entry.id === conditionId);
      if (!project || !condition) {
        throw new Error(`Condition ${conditionId} not found for project ${projectId}`);
      }

      state.store.conditions = state.store.conditions.filter((entry) => entry.id !== conditionId);
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return condition;
    });
  }

  async reorderConditions(projectId: string, revisionId: string, orderedIds: string[]) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const revision = state.store.revisions.find((entry) => entry.id === revisionId);
      if (!project || !revision) {
        throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
      }

      for (let index = 0; index < orderedIds.length; index++) {
        const condition = state.store.conditions.find((entry) => entry.id === orderedIds[index]);
        if (condition && condition.revisionId === revisionId) {
          condition.order = index + 1;
        }
      }

      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return state.store.conditions
        .filter((entry) => entry.revisionId === revisionId)
        .sort((left, right) => left.order - right.order);
    });
  }

  // ── Additional Line Item CRUD ──────────────────────────────────────

  async listAdditionalLineItems(projectId: string) {
    await this.ensureLoaded();
    const snapshot = this.snapshot();
    const { revision } = this.findCurrentRevision(snapshot, projectId);
    if (!revision) {
      return [];
    }
    return snapshot.store.additionalLineItems.filter((entry) => entry.revisionId === revision.id);
  }

  async createAdditionalLineItem(projectId: string, revisionId: string, input: CreateAdditionalLineItemInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const revision = state.store.revisions.find((entry) => entry.id === revisionId);
      if (!project || !revision) {
        throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
      }

      const ali: AdditionalLineItem = {
        id: createId("ali"),
        revisionId,
        name: input.name ?? "New Line Item",
        type: input.type ?? "LineItemAdditional",
        description: input.description ?? "",
        amount: input.amount ?? 0
      };

      state.store.additionalLineItems.push(ali);
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return ali;
    });
  }

  async updateAdditionalLineItem(projectId: string, aliId: string, patch: AdditionalLineItemPatchInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const ali = state.store.additionalLineItems.find((entry) => entry.id === aliId);
      if (!project || !ali) {
        throw new Error(`Additional line item ${aliId} not found for project ${projectId}`);
      }

      Object.assign(ali, patch);
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return ali;
    });
  }

  async deleteAdditionalLineItem(projectId: string, aliId: string) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const ali = state.store.additionalLineItems.find((entry) => entry.id === aliId);
      if (!project || !ali) {
        throw new Error(`Additional line item ${aliId} not found for project ${projectId}`);
      }

      state.store.additionalLineItems = state.store.additionalLineItems.filter((entry) => entry.id !== aliId);
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return ali;
    });
  }

  // ── Labour Rate CRUD ───────────────────────────────────────────────

  async listLabourRates(projectId: string) {
    await this.ensureLoaded();
    const snapshot = this.snapshot();
    const { revision } = this.findCurrentRevision(snapshot, projectId);
    if (!revision) {
      return [];
    }
    return (snapshot.store.labourRates ?? []).filter((entry) => entry.revisionId === revision.id);
  }

  async createLabourRate(projectId: string, revisionId: string, input: CreateLabourRateInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const revision = state.store.revisions.find((entry) => entry.id === revisionId);
      if (!project || !revision) {
        throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
      }

      const rate: LabourRate = {
        id: createId("rate"),
        revisionId,
        name: input.name ?? "New Rate",
        regularRate: input.regularRate ?? 0,
        overtimeRate: input.overtimeRate ?? 0,
        doubleRate: input.doubleRate ?? 0
      };

      state.store.labourRates.push(rate);
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return rate;
    });
  }

  async updateLabourRate(projectId: string, rateId: string, patch: LabourRatePatchInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const rate = state.store.labourRates.find((entry) => entry.id === rateId);
      if (!project || !rate) {
        throw new Error(`Labour rate ${rateId} not found for project ${projectId}`);
      }

      Object.assign(rate, patch);
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return rate;
    });
  }

  async deleteLabourRate(projectId: string, rateId: string) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const rate = state.store.labourRates.find((entry) => entry.id === rateId);
      if (!project || !rate) {
        throw new Error(`Labour rate ${rateId} not found for project ${projectId}`);
      }

      state.store.labourRates = state.store.labourRates.filter((entry) => entry.id !== rateId);
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return rate;
    });
  }

  // ── Revision Management ────────────────────────────────────────────

  async createRevision(projectId: string, quoteId: string) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const quote = state.store.quotes.find((entry) => entry.id === quoteId && entry.projectId === projectId);
      if (!project || !quote) {
        throw new Error(`Quote ${quoteId} not found for project ${projectId}`);
      }

      const currentRevision = state.store.revisions.find((entry) => entry.id === quote.currentRevisionId);
      if (!currentRevision) {
        throw new Error(`Current revision not found for quote ${quoteId}`);
      }

      const maxRevisionNumber = Math.max(
        0,
        ...state.store.revisions
          .filter((entry) => entry.quoteId === quoteId)
          .map((entry) => entry.revisionNumber)
      );

      const newRevisionId = createId("revision");
      const timestamp = isoNow();

      const newRevision: QuoteRevision = {
        ...structuredClone(currentRevision),
        id: newRevisionId,
        revisionNumber: maxRevisionNumber + 1,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      state.store.revisions.push(newRevision);

      // Build a map of old phase IDs to new phase IDs
      const phaseIdMap = new Map<string, string>();
      const oldPhases = state.store.phases.filter((entry) => entry.revisionId === currentRevision.id);
      for (const oldPhase of oldPhases) {
        const newPhaseId = createId("phase");
        phaseIdMap.set(oldPhase.id, newPhaseId);
        state.store.phases.push({
          ...structuredClone(oldPhase),
          id: newPhaseId,
          revisionId: newRevisionId
        });
      }

      // Copy worksheets and items
      const oldWorksheets = state.store.worksheets.filter((entry) => entry.revisionId === currentRevision.id);
      for (const oldWorksheet of oldWorksheets) {
        const newWorksheetId = createId("worksheet");
        state.store.worksheets.push({
          ...structuredClone(oldWorksheet),
          id: newWorksheetId,
          revisionId: newRevisionId
        });

        const oldItems = state.store.worksheetItems.filter((entry) => entry.worksheetId === oldWorksheet.id);
        for (const oldItem of oldItems) {
          state.store.worksheetItems.push({
            ...structuredClone(oldItem),
            id: createId("li"),
            worksheetId: newWorksheetId,
            phaseId: oldItem.phaseId ? (phaseIdMap.get(oldItem.phaseId) ?? null) : oldItem.phaseId
          });
        }
      }

      // Copy modifiers
      const oldModifiers = state.store.modifiers.filter((entry) => entry.revisionId === currentRevision.id);
      for (const oldModifier of oldModifiers) {
        state.store.modifiers.push({
          ...structuredClone(oldModifier),
          id: createId("mod"),
          revisionId: newRevisionId
        });
      }

      // Copy additional line items
      const oldAlis = state.store.additionalLineItems.filter((entry) => entry.revisionId === currentRevision.id);
      for (const oldAli of oldAlis) {
        state.store.additionalLineItems.push({
          ...structuredClone(oldAli),
          id: createId("ali"),
          revisionId: newRevisionId
        });
      }

      // Copy conditions
      const oldConditions = state.store.conditions.filter((entry) => entry.revisionId === currentRevision.id);
      for (const oldCondition of oldConditions) {
        state.store.conditions.push({
          ...structuredClone(oldCondition),
          id: createId("cond"),
          revisionId: newRevisionId
        });
      }

      // Copy labour rates
      const oldRates = state.store.labourRates.filter((entry) => entry.revisionId === currentRevision.id);
      for (const oldRate of oldRates) {
        state.store.labourRates.push({
          ...structuredClone(oldRate),
          id: createId("rate"),
          revisionId: newRevisionId
        });
      }

      // Copy report sections
      const oldSections = state.store.reportSections.filter((entry) => entry.revisionId === currentRevision.id);
      const sectionIdMap = new Map<string, string>();
      for (const oldSection of oldSections) {
        const newSectionId = createId("section");
        sectionIdMap.set(oldSection.id, newSectionId);
        state.store.reportSections.push({
          ...structuredClone(oldSection),
          id: newSectionId,
          revisionId: newRevisionId
        });
      }
      // Remap parent section IDs
      for (const section of state.store.reportSections.filter((entry) => entry.revisionId === newRevisionId)) {
        if (section.parentSectionId && sectionIdMap.has(section.parentSectionId)) {
          section.parentSectionId = sectionIdMap.get(section.parentSectionId)!;
        }
      }

      // Switch to the new revision
      quote.currentRevisionId = newRevisionId;
      quote.updatedAt = timestamp;
      this.pushActivity(state, projectId, newRevisionId, "revision_created", { revisionNumber: newRevision.revisionNumber });
      this.syncProjectEstimate(state, projectId, timestamp);

      return newRevision;
    });
  }

  async deleteRevision(projectId: string, revisionId: string) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const revision = state.store.revisions.find((entry) => entry.id === revisionId);
      if (!project || !revision) {
        throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
      }

      if (revision.revisionNumber === 0) {
        throw new Error("Cannot delete the initial revision (revision 0)");
      }

      const quote = state.store.quotes.find((entry) => entry.id === revision.quoteId);
      if (quote && quote.currentRevisionId === revisionId) {
        const otherRevisions = state.store.revisions
          .filter((entry) => entry.quoteId === revision.quoteId && entry.id !== revisionId)
          .sort((left, right) => right.revisionNumber - left.revisionNumber);
        if (otherRevisions.length > 0) {
          quote.currentRevisionId = otherRevisions[0].id;
          quote.updatedAt = isoNow();
        }
      }

      // Remove all children
      const worksheetIds = state.store.worksheets
        .filter((entry) => entry.revisionId === revisionId)
        .map((entry) => entry.id);

      state.store.worksheetItems = state.store.worksheetItems.filter(
        (entry) => !worksheetIds.includes(entry.worksheetId)
      );
      state.store.worksheets = state.store.worksheets.filter((entry) => entry.revisionId !== revisionId);
      state.store.phases = state.store.phases.filter((entry) => entry.revisionId !== revisionId);
      state.store.modifiers = state.store.modifiers.filter((entry) => entry.revisionId !== revisionId);
      state.store.additionalLineItems = state.store.additionalLineItems.filter((entry) => entry.revisionId !== revisionId);
      state.store.conditions = state.store.conditions.filter((entry) => entry.revisionId !== revisionId);
      state.store.labourRates = state.store.labourRates.filter((entry) => entry.revisionId !== revisionId);
      state.store.reportSections = state.store.reportSections.filter((entry) => entry.revisionId !== revisionId);
      state.store.revisions = state.store.revisions.filter((entry) => entry.id !== revisionId);

      this.pushActivity(state, projectId, null, "revision_deleted", { revisionId, revisionNumber: revision.revisionNumber });
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return revision;
    });
  }

  async switchRevision(projectId: string, revisionId: string) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const quote = state.store.quotes.find((entry) => entry.projectId === projectId);
      const revision = state.store.revisions.find((entry) => entry.id === revisionId);
      if (!project || !quote || !revision || revision.quoteId !== quote.id) {
        throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
      }

      quote.currentRevisionId = revisionId;
      const timestamp = isoNow();
      quote.updatedAt = timestamp;
      this.syncProjectEstimate(state, projectId, timestamp);

      return revision;
    });
  }

  async copyQuote(projectId: string) {
    return this.runMutation(async (state) => {
      const sourceProject = state.store.projects.find((entry) => entry.id === projectId);
      const sourceQuote = state.store.quotes.find((entry) => entry.projectId === projectId);
      if (!sourceProject || !sourceQuote) {
        throw new Error(`Project ${projectId} not found or has no quote`);
      }

      const sourceRevision = state.store.revisions.find((entry) => entry.id === sourceQuote.currentRevisionId);
      if (!sourceRevision) {
        throw new Error(`Current revision not found for project ${projectId}`);
      }

      const timestamp = isoNow();
      const newProjectId = createId("project");
      const newQuoteId = createId("quote");
      const newRevisionId = createId("revision");

      // Copy project
      const newProject: Project = {
        ...structuredClone(sourceProject),
        id: newProjectId,
        name: `${sourceProject.name} (Copy)`,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      state.store.projects.push(newProject);

      // Copy quote
      state.store.quotes.push({
        ...structuredClone(sourceQuote),
        id: newQuoteId,
        projectId: newProjectId,
        quoteNumber: makeQuoteNumber(),
        currentRevisionId: newRevisionId,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      // Copy revision
      state.store.revisions.push({
        ...structuredClone(sourceRevision),
        id: newRevisionId,
        quoteId: newQuoteId,
        revisionNumber: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      // Build phase ID map
      const phaseIdMap = new Map<string, string>();
      const oldPhases = state.store.phases.filter((entry) => entry.revisionId === sourceRevision.id);
      for (const oldPhase of oldPhases) {
        const newPhaseId = createId("phase");
        phaseIdMap.set(oldPhase.id, newPhaseId);
        state.store.phases.push({
          ...structuredClone(oldPhase),
          id: newPhaseId,
          revisionId: newRevisionId
        });
      }

      // Copy worksheets and items
      const oldWorksheets = state.store.worksheets.filter((entry) => entry.revisionId === sourceRevision.id);
      let firstWorksheetId: string | null = null;
      for (const oldWorksheet of oldWorksheets) {
        const newWorksheetId = createId("worksheet");
        if (!firstWorksheetId) {
          firstWorksheetId = newWorksheetId;
        }
        state.store.worksheets.push({
          ...structuredClone(oldWorksheet),
          id: newWorksheetId,
          revisionId: newRevisionId
        });

        const oldItems = state.store.worksheetItems.filter((entry) => entry.worksheetId === oldWorksheet.id);
        for (const oldItem of oldItems) {
          state.store.worksheetItems.push({
            ...structuredClone(oldItem),
            id: createId("li"),
            worksheetId: newWorksheetId,
            phaseId: oldItem.phaseId ? (phaseIdMap.get(oldItem.phaseId) ?? null) : oldItem.phaseId
          });
        }
      }

      // Copy modifiers
      for (const oldModifier of state.store.modifiers.filter((entry) => entry.revisionId === sourceRevision.id)) {
        state.store.modifiers.push({
          ...structuredClone(oldModifier),
          id: createId("mod"),
          revisionId: newRevisionId
        });
      }

      // Copy ALIs
      for (const oldAli of state.store.additionalLineItems.filter((entry) => entry.revisionId === sourceRevision.id)) {
        state.store.additionalLineItems.push({
          ...structuredClone(oldAli),
          id: createId("ali"),
          revisionId: newRevisionId
        });
      }

      // Copy conditions
      for (const oldCondition of state.store.conditions.filter((entry) => entry.revisionId === sourceRevision.id)) {
        state.store.conditions.push({
          ...structuredClone(oldCondition),
          id: createId("cond"),
          revisionId: newRevisionId
        });
      }

      // Copy labour rates
      for (const oldRate of state.store.labourRates.filter((entry) => entry.revisionId === sourceRevision.id)) {
        state.store.labourRates.push({
          ...structuredClone(oldRate),
          id: createId("rate"),
          revisionId: newRevisionId
        });
      }

      // Copy report sections
      const sectionIdMap = new Map<string, string>();
      for (const oldSection of state.store.reportSections.filter((entry) => entry.revisionId === sourceRevision.id)) {
        const newSectionId = createId("section");
        sectionIdMap.set(oldSection.id, newSectionId);
        state.store.reportSections.push({
          ...structuredClone(oldSection),
          id: newSectionId,
          revisionId: newRevisionId
        });
      }
      for (const section of state.store.reportSections.filter((entry) => entry.revisionId === newRevisionId)) {
        if (section.parentSectionId && sectionIdMap.has(section.parentSectionId)) {
          section.parentSectionId = sectionIdMap.get(section.parentSectionId)!;
        }
      }

      // Copy source documents
      for (const oldDoc of state.store.sourceDocuments.filter((entry) => entry.projectId === projectId)) {
        state.store.sourceDocuments.push({
          ...structuredClone(oldDoc),
          id: createId("doc"),
          projectId: newProjectId,
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }

      // Seed workspace state
      state.workspaceStates.push(createSeedWorkspaceState(newProjectId, newQuoteId, newRevisionId, firstWorksheetId));

      this.syncProjectEstimate(state, newProjectId, timestamp);

      return {
        project: newProject,
        quote: state.store.quotes.find((entry) => entry.id === newQuoteId)!,
        revision: state.store.revisions.find((entry) => entry.id === newRevisionId)!
      };
    });
  }

  async updateQuote(projectId: string, patch: QuotePatchInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const quote = state.store.quotes.find((entry) => entry.projectId === projectId);

      if (!project || !quote) {
        throw new Error(`Quote not found for project ${projectId}`);
      }

      const timestamp = isoNow();
      Object.assign(quote, patch);
      quote.updatedAt = timestamp;

      return quote;
    });
  }

  async makeCurrentRevisionZero(projectId: string) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const quote = state.store.quotes.find((entry) => entry.projectId === projectId);
      if (!project || !quote) {
        throw new Error(`Project ${projectId} not found or has no quote`);
      }

      const currentRevision = state.store.revisions.find((entry) => entry.id === quote.currentRevisionId);
      if (!currentRevision) {
        throw new Error(`Current revision not found for project ${projectId}`);
      }

      const timestamp = isoNow();

      // Remove all other revisions and their associated data
      const otherRevisions = state.store.revisions.filter(
        (entry) => entry.quoteId === quote.id && entry.id !== currentRevision.id
      );
      const otherRevisionIds = new Set(otherRevisions.map((entry) => entry.id));

      // Collect worksheet IDs from other revisions for item cleanup
      const otherWorksheetIds = new Set(
        state.store.worksheets
          .filter((entry) => otherRevisionIds.has(entry.revisionId))
          .map((entry) => entry.id)
      );

      state.store.revisions = state.store.revisions.filter(
        (entry) => entry.quoteId !== quote.id || entry.id === currentRevision.id
      );
      state.store.worksheets = state.store.worksheets.filter(
        (entry) => !otherRevisionIds.has(entry.revisionId)
      );
      state.store.worksheetItems = state.store.worksheetItems.filter(
        (entry) => !otherWorksheetIds.has(entry.worksheetId)
      );
      state.store.phases = state.store.phases.filter(
        (entry) => !otherRevisionIds.has(entry.revisionId)
      );
      state.store.modifiers = state.store.modifiers.filter(
        (entry) => !otherRevisionIds.has(entry.revisionId)
      );
      state.store.additionalLineItems = state.store.additionalLineItems.filter(
        (entry) => !otherRevisionIds.has(entry.revisionId)
      );
      state.store.conditions = state.store.conditions.filter(
        (entry) => !otherRevisionIds.has(entry.revisionId)
      );
      state.store.labourRates = state.store.labourRates.filter(
        (entry) => !otherRevisionIds.has(entry.revisionId)
      );
      state.store.reportSections = state.store.reportSections.filter(
        (entry) => !otherRevisionIds.has(entry.revisionId)
      );

      // Promote current revision to rev 0
      currentRevision.revisionNumber = 0;
      currentRevision.updatedAt = timestamp;
      quote.updatedAt = timestamp;

      this.syncProjectEstimate(state, projectId, timestamp);

      return currentRevision;
    });
  }

  // ── Activity ───────────────────────────────────────────────────────

  async logActivity(projectId: string, revisionId: string | null, type: string, data: Record<string, unknown>) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      const activity: Activity = {
        id: createId("activity"),
        projectId,
        revisionId,
        type,
        data,
        userId: null,
        createdAt: isoNow()
      };

      state.store.activities.push(activity);
      return activity;
    });
  }

  async listActivities(projectId: string) {
    await this.ensureLoaded();
    return this.snapshot().store.activities
      .filter((entry) => entry.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  // ── Report Sections ────────────────────────────────────────────────

  async listReportSections(projectId: string) {
    await this.ensureLoaded();
    const snapshot = this.snapshot();
    const { revision } = this.findCurrentRevision(snapshot, projectId);
    if (!revision) {
      return [];
    }
    return snapshot.store.reportSections
      .filter((entry) => entry.revisionId === revision.id)
      .sort((left, right) => left.order - right.order);
  }

  async createReportSection(projectId: string, revisionId: string, input: CreateReportSectionInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const revision = state.store.revisions.find((entry) => entry.id === revisionId);
      if (!project || !revision) {
        throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
      }

      const existingSections = state.store.reportSections.filter((entry) => entry.revisionId === revisionId);
      const order = input.order ?? Math.max(0, ...existingSections.map((entry) => entry.order)) + 1;

      const section: ReportSection = {
        id: createId("section"),
        revisionId,
        sectionType: input.sectionType ?? "text",
        title: input.title ?? "",
        content: input.content ?? "",
        order,
        parentSectionId: input.parentSectionId ?? null
      };

      state.store.reportSections.push(section);
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return section;
    });
  }

  async updateReportSection(projectId: string, sectionId: string, patch: ReportSectionPatchInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const section = state.store.reportSections.find((entry) => entry.id === sectionId);
      if (!project || !section) {
        throw new Error(`Report section ${sectionId} not found for project ${projectId}`);
      }

      if (typeof patch.sectionType === "string") {
        section.sectionType = patch.sectionType;
      }
      if (typeof patch.title === "string") {
        section.title = patch.title;
      }
      if (typeof patch.content === "string") {
        section.content = patch.content;
      }
      if (typeof patch.order === "number") {
        section.order = patch.order;
      }
      if (patch.parentSectionId !== undefined) {
        section.parentSectionId = patch.parentSectionId;
      }

      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return section;
    });
  }

  async deleteReportSection(projectId: string, sectionId: string) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const section = state.store.reportSections.find((entry) => entry.id === sectionId);
      if (!project || !section) {
        throw new Error(`Report section ${sectionId} not found for project ${projectId}`);
      }

      state.store.reportSections = state.store.reportSections.filter((entry) => entry.id !== sectionId);
      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return section;
    });
  }

  async reorderReportSections(projectId: string, revisionId: string, orderedIds: string[]) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const revision = state.store.revisions.find((entry) => entry.id === revisionId);
      if (!project || !revision) {
        throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
      }

      for (let index = 0; index < orderedIds.length; index++) {
        const section = state.store.reportSections.find((entry) => entry.id === orderedIds[index]);
        if (section && section.revisionId === revisionId) {
          section.order = index + 1;
        }
      }

      const timestamp = isoNow();
      this.syncProjectEstimate(state, projectId, timestamp);

      return state.store.reportSections
        .filter((entry) => entry.revisionId === revisionId)
        .sort((left, right) => left.order - right.order);
    });
  }

  // ── Status Update ──────────────────────────────────────────────────

  async updateProjectStatus(projectId: string, patch: StatusPatchInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      project.ingestionStatus = patch.ingestionStatus;
      project.updatedAt = isoNow();

      return project;
    });
  }

  // ── Job CRUD ────────────────────────────────────────────────────────

  async createJob(projectId: string, revisionId: string, input: CreateJobInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((entry) => entry.id === projectId);
      const revision = state.store.revisions.find((entry) => entry.id === revisionId);
      if (!project || !revision) {
        throw new Error(`Revision ${revisionId} not found for project ${projectId}`);
      }

      const job: Job = {
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
        createdAt: isoNow(),
      };

      state.store.jobs.push(job);
      return job;
    });
  }

  // ── Catalog CRUD ─────────────────────────────────────────────────

  async createCatalog(input: CreateCatalogInput) {
    return this.runMutation(async (state) => {
      const catalog: Catalog = {
        id: createId("cat"),
        name: input.name,
        kind: (input.kind || "materials") as Catalog["kind"],
        scope: (input.scope || "global") as Catalog["scope"],
        projectId: input.projectId ?? null,
        description: input.description ?? "",
      };
      state.store.catalogs.push(catalog);
      return catalog;
    });
  }

  async updateCatalog(catalogId: string, patch: CatalogPatchInput) {
    return this.runMutation(async (state) => {
      const catalog = state.store.catalogs.find((c) => c.id === catalogId);
      if (!catalog) throw new Error(`Catalog ${catalogId} not found`);
      if (patch.name !== undefined) catalog.name = patch.name;
      if (patch.kind !== undefined) catalog.kind = patch.kind as Catalog["kind"];
      if (patch.scope !== undefined) catalog.scope = patch.scope as Catalog["scope"];
      if (patch.projectId !== undefined) catalog.projectId = patch.projectId ?? null;
      if (patch.description !== undefined) catalog.description = patch.description;
      return catalog;
    });
  }

  async deleteCatalog(catalogId: string) {
    return this.runMutation(async (state) => {
      const catalog = state.store.catalogs.find((c) => c.id === catalogId);
      if (!catalog) throw new Error(`Catalog ${catalogId} not found`);
      state.store.catalogs = state.store.catalogs.filter((c) => c.id !== catalogId);
      state.store.catalogItems = state.store.catalogItems.filter((i) => i.catalogId !== catalogId);
      return { deleted: true };
    });
  }

  async listCatalogItems(catalogId: string) {
    await this.ensureLoaded();
    return this.snapshot().store.catalogItems.filter((i) => i.catalogId === catalogId);
  }

  async createCatalogItem(catalogId: string, input: CreateCatalogItemInput) {
    return this.runMutation(async (state) => {
      const catalog = state.store.catalogs.find((c) => c.id === catalogId);
      if (!catalog) throw new Error(`Catalog ${catalogId} not found`);
      const item: CatalogItem = {
        id: createId("ci"),
        catalogId,
        code: input.code,
        name: input.name,
        unit: input.unit,
        unitCost: input.unitCost,
        unitPrice: input.unitPrice,
        metadata: { category: input.category ?? "", ...(input.metadata ?? {}) },
      };
      state.store.catalogItems.push(item);
      return item;
    });
  }

  async updateCatalogItem(itemId: string, patch: CatalogItemPatchInput) {
    return this.runMutation(async (state) => {
      const item = state.store.catalogItems.find((i) => i.id === itemId);
      if (!item) throw new Error(`Catalog item ${itemId} not found`);
      if (patch.code !== undefined) item.code = patch.code;
      if (patch.name !== undefined) item.name = patch.name;
      if (patch.unit !== undefined) item.unit = patch.unit;
      if (patch.unitCost !== undefined) item.unitCost = patch.unitCost;
      if (patch.unitPrice !== undefined) item.unitPrice = patch.unitPrice;
      if (patch.category !== undefined) {
        item.metadata = { ...item.metadata, category: patch.category };
      }
      if (patch.metadata !== undefined) {
        item.metadata = { ...item.metadata, ...patch.metadata };
      }
      return item;
    });
  }

  async deleteCatalogItem(itemId: string) {
    return this.runMutation(async (state) => {
      const item = state.store.catalogItems.find((i) => i.id === itemId);
      if (!item) throw new Error(`Catalog item ${itemId} not found`);
      state.store.catalogItems = state.store.catalogItems.filter((i) => i.id !== itemId);
      return { deleted: true };
    });
  }

  async searchCatalogItems(query: string, catalogId?: string) {
    await this.ensureLoaded();
    const snapshot = this.snapshot();
    let items = snapshot.store.catalogItems;
    if (catalogId) {
      items = items.filter((i) => i.catalogId === catalogId);
    }
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      (i) =>
        i.code.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        (typeof i.metadata?.category === "string" && i.metadata.category.toLowerCase().includes(q))
    );
  }

  // ── File Node CRUD ─────────────────────────────────────────────────

  async listFileNodes(projectId: string, parentId?: string | null) {
    await this.ensureLoaded();
    const nodes = this.snapshot().store.fileNodes.filter((n) => n.projectId === projectId);
    if (parentId === undefined) return nodes;
    return nodes.filter((n) => n.parentId === (parentId ?? null));
  }

  async getFileNode(nodeId: string) {
    await this.ensureLoaded();
    return this.snapshot().store.fileNodes.find((n) => n.id === nodeId) ?? null;
  }

  async createFileNode(projectId: string, input: CreateFileNodeInput) {
    return this.runMutation(async (state) => {
      const project = state.store.projects.find((p) => p.id === projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      if (input.parentId) {
        const parent = state.store.fileNodes.find((n) => n.id === input.parentId && n.projectId === projectId);
        if (!parent || parent.type !== "directory") {
          throw new Error(`Parent directory ${input.parentId} not found`);
        }
      }
      const timestamp = isoNow();
      const node: FileNode = {
        id: createId("fn"),
        projectId,
        parentId: input.parentId ?? null,
        name: input.name,
        type: input.type,
        fileType: input.fileType,
        size: input.size,
        documentId: input.documentId,
        storagePath: input.storagePath,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: input.createdBy,
      };
      state.store.fileNodes.push(node);
      return node;
    });
  }

  async updateFileNode(nodeId: string, patch: FileNodePatchInput) {
    return this.runMutation(async (state) => {
      const node = state.store.fileNodes.find((n) => n.id === nodeId);
      if (!node) throw new Error(`File node ${nodeId} not found`);
      if (patch.name !== undefined) node.name = patch.name;
      if (patch.parentId !== undefined) node.parentId = patch.parentId ?? null;
      node.updatedAt = isoNow();
      return node;
    });
  }

  async deleteFileNode(nodeId: string) {
    return this.runMutation(async (state) => {
      const node = state.store.fileNodes.find((n) => n.id === nodeId);
      if (!node) throw new Error(`File node ${nodeId} not found`);
      // Recursive delete: collect all descendant IDs
      const toDelete = new Set<string>([nodeId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const n of state.store.fileNodes) {
          if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
            toDelete.add(n.id);
            changed = true;
          }
        }
      }
      state.store.fileNodes = state.store.fileNodes.filter((n) => !toDelete.has(n.id));
      return { deleted: true };
    });
  }

  async getFileTree(projectId: string) {
    await this.ensureLoaded();
    return this.snapshot().store.fileNodes.filter((n) => n.projectId === projectId);
  }

  async listAllJobs() {
    await this.ensureLoaded();
    return this.snapshot().store.jobs;
  }

  async listProjectJobs(projectId: string) {
    await this.ensureLoaded();
    return this.snapshot().store.jobs.filter((entry) => entry.projectId === projectId);
  }

  // ── Import BOM (preview + process) ──────────────────────────────────

  private importCache = new Map<string, { headers: string[]; rows: string[][] }>();

  parseCSV(csvText: string): { headers: string[]; rows: string[][] } {
    const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      return { headers: [], rows: [] };
    }

    // Detect delimiter
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
    if (!cached) {
      throw new Error(`Import file ${fileId} not found or expired`);
    }

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

  // ── Plugin CRUD ──────────────────────────────────────────────────────

  async listPlugins() {
    await this.ensureLoaded();
    return this.snapshot().store.plugins;
  }

  async getPlugin(pluginId: string) {
    await this.ensureLoaded();
    return this.snapshot().store.plugins.find((p) => p.id === pluginId) ?? null;
  }

  async createPlugin(input: CreatePluginInput) {
    return this.runMutation(async (state) => {
      const plugin: Plugin = {
        id: createId("plugin"),
        ...input,
        createdAt: isoNow(),
        updatedAt: isoNow(),
      };
      state.store.plugins.push(plugin);
      return plugin;
    });
  }

  async updatePlugin(pluginId: string, patch: PluginPatchInput) {
    return this.runMutation(async (state) => {
      const plugin = state.store.plugins.find((p) => p.id === pluginId);
      if (!plugin) {
        throw new Error(`Plugin ${pluginId} not found`);
      }
      if (patch.name !== undefined) plugin.name = patch.name;
      if (patch.description !== undefined) plugin.description = patch.description;
      if (patch.enabled !== undefined) plugin.enabled = patch.enabled;
      if (patch.config !== undefined) plugin.config = { ...plugin.config, ...patch.config };
      plugin.updatedAt = isoNow();
      return plugin;
    });
  }

  async deletePlugin(pluginId: string) {
    return this.runMutation(async (state) => {
      const plugin = state.store.plugins.find((p) => p.id === pluginId);
      if (!plugin) {
        throw new Error(`Plugin ${pluginId} not found`);
      }
      state.store.plugins = state.store.plugins.filter((p) => p.id !== pluginId);
      state.store.pluginExecutions = state.store.pluginExecutions.filter((e) => e.pluginId !== pluginId);
      return plugin;
    });
  }

  async executePlugin(pluginId: string, projectId: string, revisionId: string, input: Record<string, unknown>) {
    return this.runMutation(async (state) => {
      const plugin = state.store.plugins.find((p) => p.id === pluginId);
      if (!plugin) {
        throw new Error(`Plugin ${pluginId} not found`);
      }
      const project = state.store.projects.find((p) => p.id === projectId);
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      const execution: PluginExecution = {
        id: createId("pexec"),
        pluginId,
        projectId,
        revisionId,
        input,
        output: { message: `Executed ${plugin.name} with provided input` },
        status: "complete",
        createdAt: isoNow(),
      };
      state.store.pluginExecutions.push(execution);
      return execution;
    });
  }

  async listPluginExecutions(projectId: string) {
    await this.ensureLoaded();
    return this.snapshot().store.pluginExecutions
      .filter((e) => e.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ── Settings ─────────────────────────────────────────────────────────

  async getSettings() {
    await this.ensureLoaded();
    return structuredClone(this.snapshot().settings);
  }

  async updateSettings(patch: Partial<AppSettings>) {
    return this.runMutation(async (state) => {
      if (patch.general) {
        state.settings.general = { ...state.settings.general, ...patch.general };
      }
      if (patch.email) {
        state.settings.email = { ...state.settings.email, ...patch.email };
      }
      if (patch.defaults) {
        state.settings.defaults = { ...state.settings.defaults, ...patch.defaults };
      }
      if (patch.integrations) {
        state.settings.integrations = { ...state.settings.integrations, ...patch.integrations };
      }
      return structuredClone(state.settings);
    });
  }

  // ── Users ──────────────────────────────────────────────────────────────

  async listUsers(): Promise<User[]> {
    await this.ensureLoaded();
    return structuredClone(this.snapshot().store.users ?? []);
  }

  async getUser(userId: string): Promise<User | null> {
    await this.ensureLoaded();
    const user = (this.snapshot().store.users ?? []).find((u) => u.id === userId);
    return user ? structuredClone(user) : null;
  }

  async createUser(input: CreateUserInput): Promise<User> {
    return this.runMutation(async (state) => {
      if (!state.store.users) state.store.users = [];
      const existing = state.store.users.find((u) => u.email === input.email);
      if (existing) throw new Error(`User with email ${input.email} already exists`);
      const now = isoNow();
      const user: User = {
        id: createId("user"),
        email: input.email,
        name: input.name,
        role: input.role,
        active: true,
        passwordHash: input.password ?? "",
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      };
      state.store.users.push(user);
      return structuredClone(user);
    });
  }

  async updateUser(userId: string, patch: UserPatchInput): Promise<User> {
    return this.runMutation(async (state) => {
      if (!state.store.users) state.store.users = [];
      const user = state.store.users.find((u) => u.id === userId);
      if (!user) throw new Error(`User ${userId} not found`);
      if (patch.email !== undefined) user.email = patch.email;
      if (patch.name !== undefined) user.name = patch.name;
      if (patch.role !== undefined) user.role = patch.role;
      if (patch.active !== undefined) user.active = patch.active;
      if (patch.password !== undefined) user.passwordHash = patch.password;
      user.updatedAt = isoNow();
      return structuredClone(user);
    });
  }

  async deleteUser(userId: string): Promise<User> {
    return this.runMutation(async (state) => {
      if (!state.store.users) state.store.users = [];
      const user = state.store.users.find((u) => u.id === userId);
      if (!user) throw new Error(`User ${userId} not found`);
      state.store.users = state.store.users.filter((u) => u.id !== userId);
      if (!state.store.authSessions) state.store.authSessions = [];
      state.store.authSessions = state.store.authSessions.filter((s) => s.userId !== userId);
      return structuredClone(user);
    });
  }

  // ── Auth ───────────────────────────────────────────────────────────────

  async login(email: string, password?: string): Promise<{ token: string; user: Omit<User, "passwordHash"> }> {
    return this.runMutation(async (state) => {
      if (!state.store.users) state.store.users = [];
      const user = state.store.users.find((u) => u.email === email);
      if (!user) throw new Error("Invalid credentials");
      if (!user.active) throw new Error("Account disabled");

      // In dev mode, skip password check if passwordHash is empty
      if (user.passwordHash && password !== user.passwordHash) {
        throw new Error("Invalid credentials");
      }

      if (!state.store.authSessions) state.store.authSessions = [];
      const token = randomUUID();
      const session: AuthSession = {
        id: createId("session"),
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        createdAt: isoNow(),
      };
      state.store.authSessions.push(session);
      user.lastLoginAt = isoNow();
      user.updatedAt = isoNow();

      const { passwordHash, ...safeUser } = user;
      return { token, user: structuredClone(safeUser) };
    });
  }

  async validateToken(token: string): Promise<Omit<User, "passwordHash"> | null> {
    await this.ensureLoaded();
    const sessions = this.snapshot().store.authSessions ?? [];
    const session = sessions.find((s) => s.token === token);
    if (!session) return null;
    if (new Date(session.expiresAt) < new Date()) return null;
    const users = this.snapshot().store.users ?? [];
    const user = users.find((u) => u.id === session.userId);
    if (!user || !user.active) return null;
    const { passwordHash, ...safeUser } = user;
    return structuredClone(safeUser);
  }

  async logout(token: string): Promise<void> {
    return this.runMutation(async (state) => {
      if (!state.store.authSessions) state.store.authSessions = [];
      state.store.authSessions = state.store.authSessions.filter((s) => s.token !== token);
    });
  }

  // ── Knowledge Books ──────────────────────────────────────────────────

  async listKnowledgeBooks(projectId?: string): Promise<KnowledgeBook[]> {
    await this.ensureLoaded();
    const books = this.snapshot().store.knowledgeBooks;
    if (projectId) {
      return books.filter((b) => b.projectId === projectId || b.scope === "global");
    }
    return books;
  }

  async getKnowledgeBook(bookId: string): Promise<KnowledgeBook | null> {
    await this.ensureLoaded();
    return this.snapshot().store.knowledgeBooks.find((b) => b.id === bookId) ?? null;
  }

  async createKnowledgeBook(input: {
    name: string;
    description: string;
    category: KnowledgeBook["category"];
    scope: KnowledgeBook["scope"];
    projectId?: string | null;
    sourceFileName: string;
    sourceFileSize: number;
  }): Promise<KnowledgeBook> {
    return this.runMutation(async (state) => {
      const now = isoNow();
      const book: KnowledgeBook = {
        id: createId("kb"),
        name: input.name,
        description: input.description,
        category: input.category,
        scope: input.scope,
        projectId: input.projectId ?? null,
        pageCount: 0,
        chunkCount: 0,
        status: "uploading",
        sourceFileName: input.sourceFileName,
        sourceFileSize: input.sourceFileSize,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };
      state.store.knowledgeBooks.push(book);
      return structuredClone(book);
    });
  }

  async updateKnowledgeBook(bookId: string, patch: Partial<Pick<KnowledgeBook, "name" | "description" | "category" | "scope" | "projectId" | "status" | "pageCount" | "chunkCount" | "metadata">>): Promise<KnowledgeBook> {
    return this.runMutation(async (state) => {
      const book = state.store.knowledgeBooks.find((b) => b.id === bookId);
      if (!book) throw new Error(`Knowledge book ${bookId} not found`);
      if (patch.name !== undefined) book.name = patch.name;
      if (patch.description !== undefined) book.description = patch.description;
      if (patch.category !== undefined) book.category = patch.category;
      if (patch.scope !== undefined) book.scope = patch.scope;
      if (patch.projectId !== undefined) book.projectId = patch.projectId;
      if (patch.status !== undefined) book.status = patch.status;
      if (patch.pageCount !== undefined) book.pageCount = patch.pageCount;
      if (patch.chunkCount !== undefined) book.chunkCount = patch.chunkCount;
      if (patch.metadata !== undefined) book.metadata = { ...book.metadata, ...patch.metadata };
      book.updatedAt = isoNow();
      return structuredClone(book);
    });
  }

  async deleteKnowledgeBook(bookId: string): Promise<KnowledgeBook> {
    return this.runMutation(async (state) => {
      const book = state.store.knowledgeBooks.find((b) => b.id === bookId);
      if (!book) throw new Error(`Knowledge book ${bookId} not found`);
      state.store.knowledgeBooks = state.store.knowledgeBooks.filter((b) => b.id !== bookId);
      state.store.knowledgeChunks = state.store.knowledgeChunks.filter((c) => c.bookId !== bookId);
      return structuredClone(book);
    });
  }

  async listKnowledgeChunks(bookId: string): Promise<KnowledgeChunk[]> {
    await this.ensureLoaded();
    return this.snapshot().store.knowledgeChunks
      .filter((c) => c.bookId === bookId)
      .sort((a, b) => a.order - b.order);
  }

  async createKnowledgeChunk(bookId: string, input: {
    pageNumber?: number | null;
    sectionTitle: string;
    text: string;
    tokenCount?: number;
    order?: number;
  }): Promise<KnowledgeChunk> {
    return this.runMutation(async (state) => {
      const book = state.store.knowledgeBooks.find((b) => b.id === bookId);
      if (!book) throw new Error(`Knowledge book ${bookId} not found`);
      const existingChunks = state.store.knowledgeChunks.filter((c) => c.bookId === bookId);
      const chunk: KnowledgeChunk = {
        id: createId("kc"),
        bookId,
        pageNumber: input.pageNumber ?? null,
        sectionTitle: input.sectionTitle,
        text: input.text,
        tokenCount: input.tokenCount ?? Math.ceil(input.text.length / 4),
        order: input.order ?? existingChunks.length,
        metadata: {},
      };
      state.store.knowledgeChunks.push(chunk);
      book.chunkCount = existingChunks.length + 1;
      book.updatedAt = isoNow();
      return structuredClone(chunk);
    });
  }

  async searchKnowledgeChunks(query: string, bookId?: string, limit = 20): Promise<KnowledgeChunk[]> {
    await this.ensureLoaded();
    const lowerQuery = query.toLowerCase();
    let chunks = this.snapshot().store.knowledgeChunks;
    if (bookId) {
      chunks = chunks.filter((c) => c.bookId === bookId);
    }
    return chunks
      .filter((c) => c.text.toLowerCase().includes(lowerQuery) || c.sectionTitle.toLowerCase().includes(lowerQuery))
      .slice(0, limit);
  }

  // ── Datasets ─────────────────────────────────────────────────────────

  async listDatasets(projectId?: string): Promise<Dataset[]> {
    await this.ensureLoaded();
    const datasets = this.snapshot().store.datasets;
    if (projectId) {
      return datasets.filter((d) => d.projectId === projectId || d.scope === "global");
    }
    return datasets;
  }

  async getDataset(datasetId: string): Promise<Dataset | null> {
    await this.ensureLoaded();
    return this.snapshot().store.datasets.find((d) => d.id === datasetId) ?? null;
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
    return this.runMutation(async (state) => {
      const now = isoNow();
      const dataset: Dataset = {
        id: createId("ds"),
        name: input.name,
        description: input.description,
        category: input.category,
        scope: input.scope,
        projectId: input.projectId ?? null,
        columns: input.columns,
        rowCount: 0,
        source: input.source ?? "manual",
        sourceDescription: input.sourceDescription ?? "",
        createdAt: now,
        updatedAt: now,
      };
      state.store.datasets.push(dataset);
      return structuredClone(dataset);
    });
  }

  async updateDataset(datasetId: string, patch: Partial<Pick<Dataset, "name" | "description" | "category" | "scope" | "projectId" | "columns" | "source" | "sourceDescription">>): Promise<Dataset> {
    return this.runMutation(async (state) => {
      const dataset = state.store.datasets.find((d) => d.id === datasetId);
      if (!dataset) throw new Error(`Dataset ${datasetId} not found`);
      if (patch.name !== undefined) dataset.name = patch.name;
      if (patch.description !== undefined) dataset.description = patch.description;
      if (patch.category !== undefined) dataset.category = patch.category;
      if (patch.scope !== undefined) dataset.scope = patch.scope;
      if (patch.projectId !== undefined) dataset.projectId = patch.projectId;
      if (patch.columns !== undefined) dataset.columns = patch.columns;
      if (patch.source !== undefined) dataset.source = patch.source;
      if (patch.sourceDescription !== undefined) dataset.sourceDescription = patch.sourceDescription;
      dataset.updatedAt = isoNow();
      return structuredClone(dataset);
    });
  }

  async deleteDataset(datasetId: string): Promise<Dataset> {
    return this.runMutation(async (state) => {
      const dataset = state.store.datasets.find((d) => d.id === datasetId);
      if (!dataset) throw new Error(`Dataset ${datasetId} not found`);
      state.store.datasets = state.store.datasets.filter((d) => d.id !== datasetId);
      state.store.datasetRows = state.store.datasetRows.filter((r) => r.datasetId !== datasetId);
      return structuredClone(dataset);
    });
  }

  async listDatasetRows(datasetId: string, filter?: string, sort?: string, limit = 100, offset = 0): Promise<{ rows: DatasetRow[]; total: number }> {
    await this.ensureLoaded();
    let rows = this.snapshot().store.datasetRows.filter((r) => r.datasetId === datasetId);

    if (filter) {
      const lowerFilter = filter.toLowerCase();
      rows = rows.filter((r) => JSON.stringify(r.data).toLowerCase().includes(lowerFilter));
    }

    if (sort) {
      const desc = sort.startsWith("-");
      const key = desc ? sort.slice(1) : sort;
      rows = [...rows].sort((a, b) => {
        const aVal = a.data[key];
        const bVal = b.data[key];
        if (typeof aVal === "number" && typeof bVal === "number") return desc ? bVal - aVal : aVal - bVal;
        return desc ? String(bVal ?? "").localeCompare(String(aVal ?? "")) : String(aVal ?? "").localeCompare(String(bVal ?? ""));
      });
    } else {
      rows = [...rows].sort((a, b) => a.order - b.order);
    }

    const total = rows.length;
    return { rows: rows.slice(offset, offset + limit), total };
  }

  async getDatasetRow(rowId: string): Promise<DatasetRow | null> {
    await this.ensureLoaded();
    return this.snapshot().store.datasetRows.find((r) => r.id === rowId) ?? null;
  }

  async createDatasetRow(datasetId: string, data: Record<string, unknown>): Promise<DatasetRow> {
    return this.runMutation(async (state) => {
      const dataset = state.store.datasets.find((d) => d.id === datasetId);
      if (!dataset) throw new Error(`Dataset ${datasetId} not found`);
      const existingRows = state.store.datasetRows.filter((r) => r.datasetId === datasetId);
      const now = isoNow();
      const row: DatasetRow = {
        id: createId("dr"),
        datasetId,
        data,
        order: existingRows.length,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };
      state.store.datasetRows.push(row);
      dataset.rowCount = existingRows.length + 1;
      dataset.updatedAt = now;
      return structuredClone(row);
    });
  }

  async createDatasetRowsBatch(datasetId: string, rows: Array<Record<string, unknown>>): Promise<DatasetRow[]> {
    return this.runMutation(async (state) => {
      const dataset = state.store.datasets.find((d) => d.id === datasetId);
      if (!dataset) throw new Error(`Dataset ${datasetId} not found`);
      const existingCount = state.store.datasetRows.filter((r) => r.datasetId === datasetId).length;
      const now = isoNow();
      const created: DatasetRow[] = rows.map((data, i) => ({
        id: createId("dr"),
        datasetId,
        data,
        order: existingCount + i,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      }));
      state.store.datasetRows.push(...created);
      dataset.rowCount = existingCount + created.length;
      dataset.updatedAt = now;
      return structuredClone(created);
    });
  }

  async updateDatasetRow(rowId: string, data: Record<string, unknown>): Promise<DatasetRow> {
    return this.runMutation(async (state) => {
      const row = state.store.datasetRows.find((r) => r.id === rowId);
      if (!row) throw new Error(`Dataset row ${rowId} not found`);
      row.data = { ...row.data, ...data };
      row.updatedAt = isoNow();
      return structuredClone(row);
    });
  }

  async deleteDatasetRow(rowId: string): Promise<DatasetRow> {
    return this.runMutation(async (state) => {
      const row = state.store.datasetRows.find((r) => r.id === rowId);
      if (!row) throw new Error(`Dataset row ${rowId} not found`);
      state.store.datasetRows = state.store.datasetRows.filter((r) => r.id !== rowId);
      const dataset = state.store.datasets.find((d) => d.id === row.datasetId);
      if (dataset) {
        dataset.rowCount = state.store.datasetRows.filter((r) => r.datasetId === row.datasetId).length;
        dataset.updatedAt = isoNow();
      }
      return structuredClone(row);
    });
  }

  async searchDatasetRows(datasetId: string, query: string): Promise<DatasetRow[]> {
    await this.ensureLoaded();
    const lowerQuery = query.toLowerCase();
    return this.snapshot().store.datasetRows
      .filter((r) => r.datasetId === datasetId && JSON.stringify(r.data).toLowerCase().includes(lowerQuery));
  }

  async queryDataset(datasetId: string, filters: Array<{ column: string; op: "eq" | "gt" | "lt" | "gte" | "lte" | "contains"; value: unknown }>): Promise<DatasetRow[]> {
    await this.ensureLoaded();
    return this.snapshot().store.datasetRows
      .filter((r) => r.datasetId === datasetId)
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

export const apiStore = new BidwrightApiStore();
