#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Json = Record<string, unknown>;

type Runtime = "claude-code" | "codex" | "gemini" | "opencode";
type RunMode = "full-intake" | "manual-question";

interface Args {
  apiUrl: string;
  token?: string;
  email?: string;
  password?: string;
  orgSlug?: string;
  projectId?: string;
  casesDir?: string;
  casePaths: string[];
  outDir: string;
  runtime: Runtime;
  model?: string;
  personaId?: string;
  scope?: string;
  clientName?: string;
  location?: string;
  mode: RunMode;
  question?: string;
  timeoutMinutes: number;
  ingestionTimeoutMinutes: number;
  pollSeconds: number;
  stallMinutes: number;
  maxCases?: number;
  repeat: number;
  repeatDelaySeconds: number;
  copyProjectPerRun: boolean;
  prepareOnly: boolean;
  autoAnswerQuestions: boolean;
  questionAnswer?: string;
  keepRunning: boolean;
  live: boolean;
  reviewCadenceSeconds: number;
  help: boolean;
  humanQuotePaths: string[];
}

interface EvalThresholds {
  minToolCalls?: number;
  minThinkingChars?: number;
  minDocumentReadCoverage?: number;
  minWorksheetItems?: number;
  minSourceNoteCoverage?: number;
  maxToolFailures?: number;
}

interface CaseExpectations {
  name?: string;
  projectName?: string;
  clientName?: string;
  location?: string;
  scope?: string;
  mode?: RunMode;
  question?: string;
  followUpQuestions?: string[];
  requiredTools?: string[];
  expectedTools?: string[];
  expectedDocumentNames?: string[];
  expectedKeywords?: string[];
  expectedEstimateKeywords?: string[];
  humanQuoteReferences?: HumanQuoteReferenceInput[];
  visualProbes?: VisualProbeExpectation[];
  thresholds?: EvalThresholds;
}

interface HumanQuoteReferenceInput {
  path: string;
  label?: string;
  role?: string;
  awarded?: boolean;
  notes?: string;
}

interface HumanQuoteLineItem {
  category: string;
  name: string;
  description: string;
  quantity: number | null;
  duration: number | null;
  overtime1_5: number | null;
  overtime2: number | null;
  price: number | null;
  raw: string;
}

interface HumanQuoteReferenceMetrics {
  path: string;
  label: string;
  role: string;
  awarded: boolean;
  notes: string;
  quoteNumber: string | null;
  title: string | null;
  pageCount: number | null;
  worksheetTotal: number | null;
  summaryTotal: number | null;
  lineItemCount: number;
  categoryTotals: Record<string, number>;
  scopeSignals: string[];
  lineItems: HumanQuoteLineItem[];
  extractionError?: string;
}

interface HumanQuoteMetrics {
  referenceCount: number;
  references: HumanQuoteReferenceMetrics[];
  combinedReferenceTotal: number | null;
  estimateTotal: number | null;
  totalDelta: number | null;
  totalRatio: number | null;
  lineItemSignalCoverage: number | null;
  matchedSignals: string[];
  missingSignals: string[];
  categoryComparison: Array<{
    category: string;
    humanReferenceTotal: number;
    agentEstimateTotal: number;
    delta: number;
  }>;
  note: string;
}

interface VisualProbeExpectation {
  id: string;
  prompt: string;
  expectedAnswer?: string | number;
  acceptedSignals?: string[];
  notes?: string;
}

interface EvalCase {
  id: string;
  baseId?: string;
  iteration?: number;
  repeatTotal?: number;
  zipPath: string;
  zipName: string;
  expectations: CaseExpectations;
}

interface ApiResponse<T> {
  status: number;
  data: T;
  text: string;
}

interface IngestionStatus {
  status?: string;
  documentCount?: number;
  job?: Json | null;
  documents?: Json[];
  summary?: {
    total?: number;
    extracted?: number;
    pending?: number;
    failed?: number;
  };
}

interface CliStatus {
  status?: string;
  runtime?: string;
  sessionId?: string;
  startedAt?: string;
  source?: string;
  events?: CliEvent[];
  runCount?: number;
}

interface CliEvent {
  type?: string;
  timestamp?: string;
  data?: unknown;
}

interface ToolCall {
  toolUseId?: string;
  toolId: string;
  input: unknown;
  timestamp?: string;
}

interface ToolResult {
  toolUseId?: string;
  toolId?: string;
  success: boolean;
  durationMs?: number;
  contentPreview?: string;
  timestamp?: string;
}

interface ToolMetrics {
  calls: ToolCall[];
  results: ToolResult[];
  totalCalls: number;
  totalResults: number;
  failedResults: number;
  unmatchedResults: number;
  unmatchedCalls: number;
  successRate: number;
  byTool: Record<string, {
    calls: number;
    results: number;
    failures: number;
    avgDurationMs: number | null;
  }>;
  requiredMissing: string[];
  expectedMissing: string[];
}

interface ReasoningMetrics {
  thinkingEvents: number;
  thinkingChars: number;
  assistantMessages: number;
  assistantChars: number;
  progressEvents: number;
}

interface DocumentMetrics {
  total: number;
  extracted: number;
  pending: number;
  failed: number;
  names: string[];
  readToolCalls: number;
  readDocumentIds: string[];
  readDocumentNames: string[];
  readCoverage: number | null;
  expectedMissing: string[];
}

interface EstimateMetrics {
  worksheets: number;
  items: number;
  totalValue: number | null;
  pricedItems: number;
  zeroValueItems: number;
  sourceNoteCoverage: number;
  costEvidenceCoverage: number;
  logicCoverage: number;
  expectedKeywordMissing: string[];
  visualAudit: VisualAuditMetrics;
  visualProbes: VisualProbeMetrics;
}

interface VisualAuditIssue {
  packageId?: string;
  packageName?: string;
  documentId?: string;
  pageNumber?: number;
  reason: string;
}

interface VisualAuditMetrics {
  drawingDrivenPackages: number;
  actualRenderedPages: number;
  actualZoomRegions: number;
  atlasStatus: string | null;
  atlasRegions: number;
  atlasDocumentRequests: number;
  promotedDocuments: number;
  providerRegions: number;
  cadNativeRegions: number;
  modelNativeRegions: number;
  evidenceClaims: number;
  verifierStatus: string | null;
  unresolvedContradictions: number;
  packagesMissingLedgerClaims: VisualAuditIssue[];
  packagesMissingActualRender: VisualAuditIssue[];
  packagesMissingActualZoom: VisualAuditIssue[];
  fullPageZoomEvidence: VisualAuditIssue[];
}

interface VisualProbeResult {
  id: string;
  prompt: string;
  expectedAnswer?: string | number;
  acceptedSignals: string[];
  status: "evidenced" | "reconciled" | "not_observed" | "mismatch";
  matchedSignals: string[];
  observedValues?: Array<string | number | boolean>;
  mismatchReason?: string;
  reconciliationReason?: string;
}

interface VisualProbeMetrics {
  probeCount: number;
  evidenced: number;
  results: VisualProbeResult[];
}

interface StageMetrics {
  savedStages: string[];
  missingCriticalStages: string[];
}

interface EstimatorJourneyEvent {
  index: number;
  timestamp?: string;
  phase: string;
  toolId: string;
  note: string;
}

interface EstimatorJourneyMetrics {
  phases: Record<string, {
    hits: number;
    firstIndex: number | null;
    tools: string[];
  }>;
  sequence: EstimatorJourneyEvent[];
  phaseOrder: string[];
  transitions: number;
  returnsToDocuments: number;
  actualVisualDrawingSignals: number;
  renderedDrawingPages: number;
  zoomedDrawingRegions: number;
  symbolScans: number;
  symbolImageScans: number;
  symbolCounts: number;
  drawingDeepReadSignals: number;
  takeoffSignals: number;
  referenceLookupSignals: number;
  laborBasisSignals: number;
  datasetSignals: number;
  pricingSignals: number;
  reconcileSignals: number;
  missingHumanBehaviors: string[];
}

interface QualityScore {
  score: number;
  grade: "pass" | "needs_review" | "fail";
  bands: Record<string, number>;
}

interface RunReport {
  label: string;
  kind: "intake" | "question";
  sessionId?: string;
  status: string;
  runtime?: string;
  startedAt?: string;
  completedAt?: string;
  durationSeconds: number;
  eventCount: number;
  toolMetrics: ToolMetrics;
  reasoningMetrics: ReasoningMetrics;
  stageMetrics: StageMetrics;
  journeyMetrics: EstimatorJourneyMetrics;
  findings: string[];
}

interface CaseReport {
  caseId: string;
  baseCaseId?: string;
  iteration?: number;
  repeatTotal?: number;
  name: string;
  zipPath: string;
  zipSha256: string;
  apiUrl: string;
  projectId?: string;
  quoteId?: string;
  revisionId?: string;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  ingestion: {
    status: string;
    durationSeconds: number;
    history: IngestionStatus[];
    final?: IngestionStatus;
  };
  runs: RunReport[];
  documentMetrics: DocumentMetrics;
  estimateMetrics: EstimateMetrics;
  humanQuoteMetrics?: HumanQuoteMetrics;
  quality: QualityScore;
  findings: string[];
  artifacts: {
    json: string;
    markdown: string;
    workspace?: string;
    observer?: string;
    events?: string;
    liveState?: string;
  };
}

interface LiveMonitor {
  enabled: boolean;
  caseId: string;
  caseDir: string;
  observerPath: string;
  eventsPath: string;
  liveStatePath: string;
  reviewCadenceMs: number;
  lastBriefAt: number;
  lastEventCountByRun: Record<string, number>;
  lastIngestionSignature?: string;
}

const DEFAULT_REQUIRED_TOOLS = [
  "getWorkspace",
  "getEstimateStrategy",
  "saveEstimateScopeGraph",
  "saveEstimateExecutionPlan",
  "saveEstimateAssumptions",
  "saveEstimatePackagePlan",
  "saveEstimateReconcile",
  "finalizeEstimateStrategy",
];

const DEFAULT_EXPECTED_TOOLS = [
  "readDocumentText",
  "readSpreadsheet",
  "getDocumentStructured",
  "buildDrawingAtlas",
  "searchDrawingRegions",
  "inspectDrawingRegion",
  "saveDrawingEvidenceClaim",
  "verifyDrawingEvidenceLedger",
  "listDrawingPages",
  "renderDrawingPage",
  "zoomDrawingRegion",
  "queryKnowledge",
  "recommendEstimateBasis",
  "searchLineItemCandidates",
  "recomputeEstimateBenchmarks",
  "updateQuote",
  "getItemConfig",
  "createWorksheet",
  "createWorksheetItem",
  "applySummaryPreset",
];

const DOCUMENT_READ_TOOLS = new Set([
  "readDocumentText",
  "readSpreadsheet",
  "getDocumentStructured",
  "scanDrawingSignals",
]);

const STRATEGY_STAGE_TOOLS = new Set([
  "saveEstimateScopeGraph",
  "saveEstimateExecutionPlan",
  "saveEstimateAssumptions",
  "saveEstimatePackagePlan",
  "saveEstimateAdjustments",
  "saveEstimateReconcile",
  "finalizeEstimateStrategy",
]);

const HUMAN_ESTIMATOR_PHASES = [
  "orientation",
  "document_inventory",
  "spec_reading",
  "drawing_deep_read",
  "takeoff",
  "reference_books",
  "datasets",
  "labor_units",
  "pricing_basis",
  "worksheet_build",
  "reconcile",
];

const PHASE_TOOL_PATTERNS: Array<{
  phase: string;
  matches: RegExp[];
  note: string;
}> = [
  {
    phase: "orientation",
    matches: [/^getWorkspace$/, /^getEstimateStrategy$/, /^readMemory$/],
    note: "oriented to workspace, quote, prior strategy, or memory",
  },
  {
    phase: "document_inventory",
    matches: [/^listDrawingPages$/, /^listDocuments$/, /^getDocumentStructured$/, /^buildDrawingAtlas$/, /^addSourceToDrawingAtlas$/],
    note: "built an inventory of source documents or structured document data",
  },
  {
    phase: "spec_reading",
    matches: [/^readDocumentText$/, /^readSpreadsheet$/],
    note: "read source specs, RFQs, spreadsheets, or book pages",
  },
  {
    phase: "drawing_deep_read",
    matches: [/^buildDrawingAtlas$/, /^addSourceToDrawingAtlas$/, /^promotePdfToDrawingEvidence$/, /^searchDrawingRegions$/, /^inspectDrawingRegion$/, /^renderDrawingPage$/, /^zoomDrawingRegion$/, /^scanDrawingSymbols$/, /^countSymbols/, /^scanDrawingSignals$/, /^listDrawingPages$/],
    note: "inspected drawing sheets, symbols, or zoomed drawing regions",
  },
  {
    phase: "takeoff",
    matches: [/takeoff/i, /^saveDrawingEvidenceClaim$/, /^countSymbols/, /^linkTakeoffAnnotationToWorksheetItem$/, /^listTakeoffAnnotations$/],
    note: "used takeoff annotations, symbol counts, or measured quantities",
  },
  {
    phase: "reference_books",
    matches: [/^searchLibraryCorpus$/, /^listKnowledgeBooks$/, /^queryKnowledge$/, /^queryGlobalLibrary$/, /^listKnowledgeDocuments$/],
    note: "looked up estimator references, books, or knowledge pages",
  },
  {
    phase: "datasets",
    matches: [/dataset/i, /^queryDatasets$/, /^listDatasets$/],
    note: "looked up dataset or table-backed production/pricing data",
  },
  {
    phase: "labor_units",
    matches: [/^listLaborUnitTree$/, /^listLaborUnits$/, /^searchLibraryCorpus$/, /^getLaborUnit/],
    note: "looked up labour productivity or labour-unit basis",
  },
  {
    phase: "pricing_basis",
    matches: [/^searchLibraryCorpus$/, /^recommendEstimateBasis$/, /^recommendCostSource$/, /^searchLineItemCandidates$/, /^previewAssembly$/, /^listRateSchedules$/, /^getRateSchedule/, /^importRateSchedule/, /^listRateScheduleItems$/],
    note: "looked up cost, catalog, assembly, benchmark, or rate basis",
  },
  {
    phase: "worksheet_build",
    matches: [/^updateQuote$/, /^createWorksheet$/, /^createWorksheetItem/, /^updateWorksheetItem$/, /^applySummaryPreset$/, /^recalculateTotals$/],
    note: "committed estimate structure or priced rows",
  },
  {
    phase: "reconcile",
    matches: [/^verifyDrawingEvidenceLedger$/, /^saveEstimateReconcile$/, /^finalizeEstimateStrategy$/, /^recomputeEstimateBenchmarks$/, /^saveEstimateAdjustments$/],
    note: "performed benchmark, adjustment, reconcile, or finalization work",
  },
];

const TERMINAL_AGENT_STATUSES = new Set(["completed", "failed", "stopped"]);
const READY_INGESTION_STATUSES = new Set(["ready", "review", "quoted", "estimating", "complete", "completed"]);
const FAILED_INGESTION_STATUSES = new Set(["failed", "error"]);

function usage() {
  return `Bidwright agent orchestration eval harness

Usage:
  pnpm eval:agent -- --cases ./eval-cases --out ./.bidwright/evals
  pnpm eval:agent -- ./cases/pump-station.zip ./cases/fab-package.zip

Auth:
  BIDWRIGHT_AUTH_TOKEN=... or BIDWRIGHT_EMAIL=... BIDWRIGHT_PASSWORD=...

Options:
  --api-url <url>                  Default: BIDWRIGHT_API_URL or http://localhost:4001
  --project-id <id>                Reuse an already-ingested project instead of uploading zips
  --cases <dir>                    Directory of .zip cases
  --out <dir>                      Output directory. Default: ./.bidwright/evals/<timestamp>
  --runtime <runtime>              claude-code | codex | gemini | opencode. Default: claude-code
  --model <model>                  Runtime model override
  --persona-id <id>                Estimator persona id
  --scope <text>                   Scope/commercial instruction override
  --client-name <name>             Upload client name
  --location <text>                Upload location
  --mode <full-intake|manual-question>
  --question <text>                Question for manual-question mode or follow-up probe
  --timeout-minutes <n>            Agent timeout. Default: 90
  --ingestion-timeout-minutes <n>  Ingestion timeout. Default: 30
  --poll-seconds <n>               Poll interval. Default: 5
  --stall-minutes <n>              Stop a running agent after no new events for this many minutes. Default: 8
  --review-cadence-seconds <n>     Live observer brief cadence. Default: 60
  --human-quote <pdf>              Awarded human quote PDF for calibration. Repeatable.
  --max-cases <n>                  Limit cases for a smoke run
  --repeat <n>                     Run each case repeatedly. Default: 1
  --repeat-delay-seconds <n>       Delay between repeated runs. Default: 0
  --no-copy-project-per-run        Reuse the same project directly instead of copying it for each attempt
  --prepare-only                   Upload/extract documents and stop before starting an agent
  --no-auto-answer-questions       Do not auto-answer blocking askUser prompts during eval runs
  --question-answer <text>         Auto-answer text for blocking askUser prompts
  --keep-running                   Do not call stop on timeout
  --no-live                        Disable the live observer dossier

Live observer:
  The harness streams ingestion, chat, tool calls/results, thinking snippets,
  and rolling review briefs into each case's observer.md and events.ndjson.
  The numeric bands are telemetry only. The actual quality decision is made
  by the Codex/human monitor watching those artifacts and iterating the agent.

Sidecar intake metadata:
  For package.zip, add package.eval.json or package.json with the same kind of
  metadata a human would enter on the intake page:
  {
    "name": "Pump station RFQ",
    "projectName": "Pump station RFQ Eval",
    "clientName": "Example Client",
    "location": "Example City",
    "scope": "Budget turnkey mechanical estimate"
  }

  Use --human-quote for awarded quote calibration after the run. Do not put
  hidden expected answers, package-specific probes, or human quote details in
  the agent intake metadata for normal UI-equivalent runs.
`;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apiUrl: process.env.BIDWRIGHT_API_URL || "http://localhost:4001",
    token: process.env.BIDWRIGHT_AUTH_TOKEN,
    email: process.env.BIDWRIGHT_EMAIL,
    password: process.env.BIDWRIGHT_PASSWORD,
    orgSlug: process.env.BIDWRIGHT_ORG_SLUG,
    projectId: process.env.BIDWRIGHT_EVAL_PROJECT_ID,
    casePaths: [],
    outDir: "",
    runtime: (process.env.BIDWRIGHT_AGENT_RUNTIME as Runtime) || "claude-code",
    model: process.env.BIDWRIGHT_AGENT_MODEL,
    personaId: process.env.BIDWRIGHT_PERSONA_ID,
    scope: process.env.BIDWRIGHT_EVAL_SCOPE,
    clientName: process.env.BIDWRIGHT_EVAL_CLIENT_NAME,
    location: process.env.BIDWRIGHT_EVAL_LOCATION,
    mode: "full-intake",
    question: process.env.BIDWRIGHT_EVAL_QUESTION,
    timeoutMinutes: Number(process.env.BIDWRIGHT_EVAL_TIMEOUT_MINUTES || 90),
    ingestionTimeoutMinutes: Number(process.env.BIDWRIGHT_EVAL_INGESTION_TIMEOUT_MINUTES || 30),
    pollSeconds: Number(process.env.BIDWRIGHT_EVAL_POLL_SECONDS || 5),
    stallMinutes: Number(process.env.BIDWRIGHT_EVAL_STALL_MINUTES || 8),
    repeat: Number(process.env.BIDWRIGHT_EVAL_REPEAT || 1),
    repeatDelaySeconds: Number(process.env.BIDWRIGHT_EVAL_REPEAT_DELAY_SECONDS || 0),
    copyProjectPerRun: process.env.BIDWRIGHT_EVAL_COPY_PROJECT_PER_RUN !== "false",
    prepareOnly: false,
    autoAnswerQuestions: process.env.BIDWRIGHT_EVAL_AUTO_ANSWER_QUESTIONS !== "false",
    questionAnswer: process.env.BIDWRIGHT_EVAL_QUESTION_ANSWER,
    keepRunning: false,
    live: process.env.BIDWRIGHT_EVAL_LIVE !== "false",
    reviewCadenceSeconds: Number(process.env.BIDWRIGHT_EVAL_REVIEW_CADENCE_SECONDS || 60),
    help: false,
    humanQuotePaths: splitPathList(process.env.BIDWRIGHT_EVAL_HUMAN_QUOTES),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };

    switch (arg) {
      case "--":
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--api-url":
        args.apiUrl = next();
        break;
      case "--token":
        args.token = next();
        break;
      case "--email":
        args.email = next();
        break;
      case "--password":
        args.password = next();
        break;
      case "--org-slug":
        args.orgSlug = next();
        break;
      case "--project-id":
        args.projectId = next();
        break;
      case "--cases":
        args.casesDir = next();
        break;
      case "--out":
        args.outDir = next();
        break;
      case "--runtime":
        args.runtime = next() as Runtime;
        break;
      case "--model":
        args.model = next();
        break;
      case "--persona-id":
        args.personaId = next();
        break;
      case "--scope":
        args.scope = next();
        break;
      case "--client-name":
        args.clientName = next();
        break;
      case "--location":
        args.location = next();
        break;
      case "--mode":
        args.mode = next() as RunMode;
        break;
      case "--question":
        args.question = next();
        break;
      case "--timeout-minutes":
        args.timeoutMinutes = Number(next());
        break;
      case "--ingestion-timeout-minutes":
        args.ingestionTimeoutMinutes = Number(next());
        break;
      case "--poll-seconds":
        args.pollSeconds = Number(next());
        break;
      case "--stall-minutes":
        args.stallMinutes = Number(next());
        break;
      case "--max-cases":
        args.maxCases = Number(next());
        break;
      case "--repeat":
        args.repeat = Number(next());
        break;
      case "--repeat-delay-seconds":
        args.repeatDelaySeconds = Number(next());
        break;
      case "--no-copy-project-per-run":
        args.copyProjectPerRun = false;
        break;
      case "--prepare-only":
        args.prepareOnly = true;
        break;
      case "--no-auto-answer-questions":
        args.autoAnswerQuestions = false;
        break;
      case "--question-answer":
        args.questionAnswer = next();
        break;
      case "--keep-running":
        args.keepRunning = true;
        break;
      case "--no-live":
        args.live = false;
        break;
      case "--review-cadence-seconds":
        args.reviewCadenceSeconds = Number(next());
        break;
      case "--human-quote":
        args.humanQuotePaths.push(next());
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
        args.casePaths.push(arg);
    }
  }

  if (!args.outDir) {
    args.outDir = path.resolve(".bidwright", "evals", timestampSlug(new Date()));
  } else {
    args.outDir = path.resolve(args.outDir);
  }
  args.apiUrl = args.apiUrl.replace(/\/+$/, "");

  if (!["claude-code", "codex", "gemini", "opencode"].includes(args.runtime)) {
    throw new Error(`Unsupported runtime: ${args.runtime}`);
  }
  if (!["full-intake", "manual-question"].includes(args.mode)) {
    throw new Error(`Unsupported mode: ${args.mode}`);
  }
  if (!Number.isFinite(args.timeoutMinutes) || args.timeoutMinutes <= 0) {
    throw new Error("--timeout-minutes must be a positive number");
  }
  if (!Number.isFinite(args.ingestionTimeoutMinutes) || args.ingestionTimeoutMinutes <= 0) {
    throw new Error("--ingestion-timeout-minutes must be a positive number");
  }
  if (!Number.isFinite(args.pollSeconds) || args.pollSeconds <= 0) {
    throw new Error("--poll-seconds must be a positive number");
  }
  if (!Number.isFinite(args.stallMinutes) || args.stallMinutes <= 0) {
    throw new Error("--stall-minutes must be a positive number");
  }
  if (!Number.isFinite(args.reviewCadenceSeconds) || args.reviewCadenceSeconds <= 0) {
    throw new Error("--review-cadence-seconds must be a positive number");
  }
  if (!Number.isFinite(args.repeat) || args.repeat <= 0) {
    throw new Error("--repeat must be a positive number");
  }
  args.repeat = Math.floor(args.repeat);
  if (!Number.isFinite(args.repeatDelaySeconds) || args.repeatDelaySeconds < 0) {
    throw new Error("--repeat-delay-seconds must be zero or a positive number");
  }

  return args;
}

function splitPathList(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  return text
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

class ApiClient {
  private cookieHeader = "";

  constructor(private readonly apiUrl: string, private token?: string) {}

  async login(email: string, password: string, orgSlug?: string) {
    const response = await this.requestJson<{ token?: string }>("/api/auth/login", {
      method: "POST",
      body: { email, password, ...(orgSlug ? { orgSlug } : {}) },
      auth: false,
    });
    if (response.data.token) this.token = response.data.token;
  }

  async uploadPackage(zipPath: string, fields: Record<string, string | undefined>) {
    const form = new FormData();
    const bytes = await readFile(zipPath);
    form.append("file", new Blob([bytes], { type: "application/zip" }), path.basename(zipPath));
    for (const [key, value] of Object.entries(fields)) {
      if (value && value.trim()) form.append(key, value.trim());
    }
    return this.requestJson<Json>("/ingestion/package", {
      method: "POST",
      body: form,
    });
  }

  async copyProject(projectId: string, options: { resetEstimate?: boolean } = {}) {
    return this.requestJson<Json>(`/projects/${projectId}/copy`, {
      method: "POST",
      body: options,
    });
  }

  async requestJson<T>(route: string, options: {
    method?: string;
    body?: unknown;
    auth?: boolean;
  } = {}): Promise<ApiResponse<T>> {
    const headers = new Headers();
    headers.set("Accept", "application/json");
    if (options.auth !== false && this.token) headers.set("Authorization", `Bearer ${this.token}`);
    if (this.cookieHeader) headers.set("Cookie", this.cookieHeader);

    let body: BodyInit | undefined;
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }

    const response = await fetch(`${this.apiUrl}${route}`, {
      method: options.method || "GET",
      headers,
      body,
    });
    this.captureCookies(response.headers);
    const text = await response.text();
    const data = parseJson(text) as T;
    if (!response.ok) {
      const message = getErrorMessage(data) || text || `${response.status} ${response.statusText}`;
      throw new Error(`${options.method || "GET"} ${route} failed: ${message}`);
    }
    return { status: response.status, data, text };
  }

  private captureCookies(headers: Headers) {
    const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    const rawCookies = typeof getSetCookie === "function" ? getSetCookie.call(headers) : [];
    const fallback = headers.get("set-cookie");
    const values = rawCookies.length ? rawCookies : fallback ? [fallback] : [];
    if (!values.length) return;

    const existing = new Map(
      this.cookieHeader
        .split(";")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const index = entry.indexOf("=");
          return index === -1 ? [entry, ""] : [entry.slice(0, index), entry.slice(index + 1)];
        }),
    );

    for (const value of values) {
      const cookiePair = value.split(";")[0]?.trim();
      if (!cookiePair) continue;
      const index = cookiePair.indexOf("=");
      if (index === -1) continue;
      existing.set(cookiePair.slice(0, index), cookiePair.slice(index + 1));
    }

    this.cookieHeader = [...existing.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const discoveredCases = args.projectId
    ? [projectCase(args.projectId, (await discoverCases(args).catch(() => []))[0])]
    : await discoverCases(args);
  const cases = expandRepeatedCases(discoveredCases, args.repeat);
  if (cases.length === 0) {
    throw new Error("No .zip eval cases found. Pass --cases <dir> or zip paths.");
  }

  await mkdir(args.outDir, { recursive: true });
  const client = new ApiClient(args.apiUrl, args.token);
  if (!args.token) {
    if (!args.email || !args.password) {
      throw new Error("Set BIDWRIGHT_AUTH_TOKEN, or BIDWRIGHT_EMAIL and BIDWRIGHT_PASSWORD.");
    }
    log(`Authenticating as ${args.email} against ${args.apiUrl}`);
    await client.login(args.email, args.password, args.orgSlug);
  }

  log(`Running ${cases.length} case(s). Artifacts: ${args.outDir}`);
  const reports: CaseReport[] = [];
  for (const [index, evalCase] of cases.entries()) {
    if (index > 0 && args.repeatDelaySeconds > 0) {
      await sleep(args.repeatDelaySeconds * 1000);
    }
    const repeatLabel = evalCase.repeatTotal && evalCase.repeatTotal > 1
      ? ` iteration ${evalCase.iteration}/${evalCase.repeatTotal}`
      : "";
    log(`\n[${index + 1}/${cases.length}] ${evalCase.zipName}${repeatLabel}`);
    const report = await runCase(client, args, evalCase).catch(async (error) => {
      const failed = await buildFailedCaseReport(args, evalCase, error);
      await persistCaseReport(failed, args.outDir);
      return failed;
    });
    reports.push(report);
    log(`Telemetry: ${report.quality.grade} ${report.quality.score}/100 ${report.name}`);
  }

  await writeAggregateReport(args.outDir, reports);
  const failures = reports.filter((report) => report.quality.grade === "fail").length;
  const needsReview = reports.filter((report) => report.quality.grade === "needs_review").length;
  log(`\nComplete telemetry: ${reports.length - failures - needsReview} clean, ${needsReview} needs review, ${failures} severe signal(s)`);
  log("Quality decision remains with the live monitor; telemetry is not an acceptance gate.");
}

async function discoverCases(args: Args): Promise<EvalCase[]> {
  const paths = [...args.casePaths];
  if (args.casesDir) {
    paths.push(...await listZipFiles(path.resolve(args.casesDir)));
  }

  const unique = [...new Set(paths.map((entry) => path.resolve(entry)))];
  const zipPaths = unique.filter((entry) => entry.toLowerCase().endsWith(".zip"));
  const limited = args.maxCases ? zipPaths.slice(0, args.maxCases) : zipPaths;
  const cases: EvalCase[] = [];

  for (const zipPath of limited) {
    const fileStat = await stat(zipPath).catch(() => null);
    if (!fileStat?.isFile()) throw new Error(`Case zip not found: ${zipPath}`);
    const zipName = path.basename(zipPath);
    const expectations = await loadExpectations(zipPath);
    cases.push({
      id: `${slug(path.basename(zipPath, ".zip"))}-${shortHash(zipPath)}`,
      zipPath,
      zipName,
      expectations,
    });
  }
  return cases;
}

function projectCase(projectId: string, metadataCase?: EvalCase): EvalCase {
  return {
    id: `${slug(projectId)}-${shortHash(projectId)}`,
    zipPath: metadataCase?.zipPath ?? "",
    zipName: metadataCase?.zipName ?? `project:${projectId}`,
    expectations: {
      ...(metadataCase?.expectations ?? {}),
      name: metadataCase?.expectations.name ?? `Prepared project ${projectId}`,
    },
  };
}

function expandRepeatedCases(cases: EvalCase[], repeat: number): EvalCase[] {
  if (repeat <= 1) return cases;
  return cases.flatMap((evalCase) =>
    Array.from({ length: repeat }, (_, index) => ({
      ...evalCase,
      baseId: evalCase.id,
      id: `${evalCase.id}-iter-${String(index + 1).padStart(2, "0")}`,
      iteration: index + 1,
      repeatTotal: repeat,
    })),
  );
}

async function listZipFiles(dir: string): Promise<string[]> {
  const dirStat = await stat(dir).catch(() => null);
  if (!dirStat?.isDirectory()) throw new Error(`Cases directory not found: ${dir}`);
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listZipFiles(fullPath));
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".zip")) files.push(fullPath);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function loadExpectations(zipPath: string): Promise<CaseExpectations> {
  const parsed = path.parse(zipPath);
  const candidates = [
    path.join(parsed.dir, `${parsed.name}.eval.json`),
    path.join(parsed.dir, `${parsed.name}.json`),
  ];
  for (const candidate of candidates) {
    const text = await readFile(candidate, "utf8").catch(() => null);
    if (!text) continue;
    const data = parseJson(text);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as CaseExpectations;
    }
    throw new Error(`Expectation sidecar is not an object: ${candidate}`);
  }
  return {};
}

async function runCase(client: ApiClient, args: Args, evalCase: EvalCase): Promise<CaseReport> {
  const startedAt = new Date();
  const expectations = evalCase.expectations;
  const mode = expectations.mode || args.mode;
  const caseName = expectations.name || (evalCase.zipPath ? path.basename(evalCase.zipPath, ".zip") : evalCase.zipName);
  const zipSha256 = evalCase.zipPath ? await fileSha256(evalCase.zipPath) : "prepared-project";
  const iterationSuffix = evalCase.repeatTotal && evalCase.repeatTotal > 1
    ? ` Iteration ${evalCase.iteration} of ${evalCase.repeatTotal}`
    : "";
  const projectName = expectations.projectName || `${caseName}${iterationSuffix} Eval ${timestampSlug(startedAt)}`;
  const monitor = await initLiveMonitor(args, evalCase, caseName);

  const uploadFields = {
    projectName,
    packageName: caseName,
    clientName: expectations.clientName || args.clientName || "Bidwright Eval Client",
    location: expectations.location || args.location || "Eval Lab",
    scope: expectations.scope || args.scope,
    sourceKind: "agent_eval",
  };

  let project: Json;
  let quote: Json;
  let revision: Json;
  let projectId: string;
  if (args.projectId) {
    log(`Reusing prepared project: ${args.projectId}`);
    await appendLiveNote(monitor, `Prepared project selected: ${args.projectId}`);
    if (args.copyProjectPerRun) {
      const copied = await client.copyProject(args.projectId, { resetEstimate: true });
      const copiedWorkspace = getObject(copied.data.workspace);
      project = getObject(copiedWorkspace.project);
      quote = getObject(copiedWorkspace.quote);
      revision = getObject(copiedWorkspace.currentRevision);
      projectId = getString(project.id);
      if (!projectId) throw new Error("Project copy response did not include workspace.project.id");
      await appendLiveNote(monitor, `Copied prepared project for fresh agent attempt: ${args.projectId} -> ${projectId}. Estimate artifacts were reset; source documents and extraction evidence were preserved.`);
    } else {
      const workspaceResponse = await client.requestJson<Json>(`/projects/${args.projectId}/workspace`);
      const workspace = getObject(workspaceResponse.data.workspace);
      project = getObject(workspace.project);
      quote = getObject(workspace.quote);
      revision = getObject(workspace.currentRevision);
      projectId = args.projectId;
      await appendLiveNote(monitor, `Running directly on prepared project without copy: ${projectId}`);
    }
  } else {
    log(`Uploading package: ${evalCase.zipName}`);
    const upload = await client.uploadPackage(evalCase.zipPath, uploadFields);
    project = getObject(upload.data.project);
    quote = getObject(upload.data.quote);
    revision = getObject(upload.data.revision);
    projectId = getString(project.id);
    if (!projectId) throw new Error("Upload response did not include project.id");
    await appendLiveNote(monitor, `Project created: ${projectId}`);
  }

  log(`Project ${projectId}: waiting for document extraction`);
  const ingestionStart = Date.now();
  const ingestion = await waitForIngestion(client, projectId, args, monitor);

  const runs: RunReport[] = [];
  if (args.prepareOnly) {
    const workspaceResponse = await client.requestJson<Json>(`/projects/${projectId}/workspace`);
    const workspace = getObject(workspaceResponse.data.workspace) || workspaceResponse.data;
    const documentMetrics = analyzeDocuments(ingestion.final, workspace, [], expectations);
    const estimateMetrics = analyzeEstimate(workspaceResponse.data, expectations);
    const humanQuoteMetrics = await analyzeHumanQuoteReferences(expectations, args, workspaceResponse.data);
    const completedAt = new Date();
    const report: CaseReport = {
      caseId: evalCase.id,
      baseCaseId: evalCase.baseId,
      iteration: evalCase.iteration,
      repeatTotal: evalCase.repeatTotal,
      name: caseName,
      zipPath: evalCase.zipPath,
      zipSha256,
      apiUrl: args.apiUrl,
      projectId,
      quoteId: getString(quote.id),
      revisionId: getString(revision.id),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationSeconds: secondsBetween(startedAt, completedAt),
      ingestion: {
        status: ingestion.final?.status || "unknown",
        durationSeconds: Math.round((Date.now() - ingestionStart) / 1000),
        history: ingestion.history,
        final: ingestion.final,
      },
      runs,
      documentMetrics,
      estimateMetrics,
      humanQuoteMetrics,
      quality: {
        score: 0,
        grade: "needs_review",
        bands: {},
      },
      findings: ["Prepared project only; no agent run requested."],
      artifacts: {
        json: "",
        markdown: "",
        observer: monitor.observerPath,
        events: monitor.eventsPath,
        liveState: monitor.liveStatePath,
        workspace: "",
      },
    };
    await appendLiveNote(monitor, `Prepare-only complete. Reuse with: pnpm eval:agent -- --project-id ${projectId} --repeat <n>`);
    await persistCaseReport(report, args.outDir, workspaceResponse.data);
    return report;
  }

  if (mode === "manual-question") {
    const question = expectations.question || args.question || defaultManualQuestion();
    runs.push(await runQuestion(client, args, projectId, question, "manual question", monitor));
  } else {
    runs.push(await runIntake(client, args, projectId, expectations.scope || args.scope, monitor));
    const followUps = [
      ...(args.question ? [args.question] : []),
      ...(expectations.followUpQuestions || []),
    ];
    for (const [index, question] of followUps.entries()) {
      runs.push(await runQuestion(client, args, projectId, question, `follow-up ${index + 1}`, monitor));
    }
  }

  const workspaceResponse = await client.requestJson<Json>(`/projects/${projectId}/workspace`);
  const finalStatus = await client.requestJson<CliStatus>(`/api/cli/${projectId}/status`).catch(() => null);
  const workspace = getObject(workspaceResponse.data.workspace) || workspaceResponse.data;
  const documentMetrics = analyzeDocuments(ingestion.final, workspace, finalStatus?.data.events || [], expectations);
  const estimateMetrics = analyzeEstimate(workspaceResponse.data, expectations);
  const humanQuoteMetrics = await analyzeHumanQuoteReferences(expectations, args, workspaceResponse.data);
  const findings = [
    ...buildCaseFindings(ingestion.final, documentMetrics, estimateMetrics, runs, expectations),
    ...buildHumanQuoteFindings(humanQuoteMetrics),
  ];
  const quality = scoreCase({
    ingestion: ingestion.final,
    runs,
    documentMetrics,
    estimateMetrics,
    findings,
    thresholds: expectations.thresholds,
  });
  const completedAt = new Date();

  const report: CaseReport = {
    caseId: evalCase.id,
    baseCaseId: evalCase.baseId,
    iteration: evalCase.iteration,
    repeatTotal: evalCase.repeatTotal,
    name: caseName,
    zipPath: evalCase.zipPath,
    zipSha256,
    apiUrl: args.apiUrl,
    projectId,
    quoteId: getString(quote.id),
    revisionId: getString(revision.id),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationSeconds: secondsBetween(startedAt, completedAt),
    ingestion: {
      status: ingestion.final?.status || "unknown",
      durationSeconds: Math.round((Date.now() - ingestionStart) / 1000),
      history: ingestion.history,
      final: ingestion.final,
    },
    runs,
    documentMetrics,
    estimateMetrics,
    humanQuoteMetrics,
    quality,
    findings,
    artifacts: {
      json: "",
      markdown: "",
      observer: monitor.observerPath,
      events: monitor.eventsPath,
      liveState: monitor.liveStatePath,
      workspace: "",
    },
  };

  await appendLiveReviewBrief(monitor, "final", runs[runs.length - 1], report);
  await persistCaseReport(report, args.outDir, workspaceResponse.data);
  return report;
}

async function runIntake(client: ApiClient, args: Args, projectId: string, scope: string | undefined, monitor: LiveMonitor): Promise<RunReport> {
  log(`Starting full intake agent (${args.runtime}${args.model ? ` / ${args.model}` : ""})`);
  const start = await client.requestJson<Json>("/api/cli/start", {
    method: "POST",
    body: {
      projectId,
      runtime: args.runtime,
      ...(args.model ? { model: args.model } : {}),
      ...(args.personaId ? { personaId: args.personaId } : {}),
      ...(scope ? { scope } : {}),
    },
  });
  const sessionId = getString(start.data.sessionId);
  await appendLiveNote(monitor, `Started full intake session: ${sessionId || "unknown"}`);
  const status = await waitForAgentRun(client, args, projectId, sessionId, "full intake", monitor);
  return buildRunReport("full intake", "intake", sessionId, status);
}

async function runQuestion(client: ApiClient, args: Args, projectId: string, question: string, label: string, monitor: LiveMonitor): Promise<RunReport> {
  log(`Starting ${label}: ${truncate(question, 80)}`);
  const start = await client.requestJson<Json>(`/api/cli/${projectId}/message`, {
    method: "POST",
    body: {
      message: question,
      runtime: args.runtime,
      ...(args.model ? { model: args.model } : {}),
      ...(args.personaId ? { personaId: args.personaId } : {}),
      ...(args.scope ? { scope: args.scope } : {}),
    },
  });
  const sessionId = getString(start.data.sessionId);
  await appendLiveNote(monitor, `Started ${label} session: ${sessionId || "unknown"}\n\nQuestion: ${question}`);
  const status = await waitForAgentRun(client, args, projectId, sessionId, label, monitor);
  return buildRunReport(label, "question", sessionId, status);
}

async function waitForIngestion(client: ApiClient, projectId: string, args: Args, monitor: LiveMonitor) {
  const deadline = Date.now() + args.ingestionTimeoutMinutes * 60_000;
  const history: IngestionStatus[] = [];
  let lastLog = 0;
  let final: IngestionStatus | undefined;

  while (Date.now() < deadline) {
    const response = await client.requestJson<IngestionStatus>(`/projects/${projectId}/ingestion-status`);
    const status = response.data;
    history.push(slimIngestionStatus(status));
    final = status;
    await observeIngestion(monitor, status);

    const pending = Number(status.summary?.pending ?? 0);
    const failed = Number(status.summary?.failed ?? 0);
    const total = Number(status.summary?.total ?? status.documentCount ?? 0);
    const projectReady = READY_INGESTION_STATUSES.has(String(status.status || "").toLowerCase());
    const failedStatus = FAILED_INGESTION_STATUSES.has(String(status.status || "").toLowerCase());
    const jobComplete = String(status.job?.status || "").toLowerCase() === "complete";

    if (Date.now() - lastLog > 15_000) {
      log(`Ingestion ${status.status || "unknown"}: ${total - pending - failed}/${total} extracted, ${pending} pending, ${failed} failed`);
      lastLog = Date.now();
    }

    if (failedStatus || failed > 0) return { history, final: status };
    if (projectReady) return { history, final: status };

    await sleep(args.pollSeconds * 1000);
  }

  return { history, final };
}

async function waitForAgentRun(
  client: ApiClient,
  args: Args,
  projectId: string,
  sessionId: string | undefined,
  label: string,
  monitor: LiveMonitor,
): Promise<CliStatus> {
  const deadline = Date.now() + args.timeoutMinutes * 60_000;
  let lastStatus: CliStatus = { status: "none", events: [] };
  let lastEventCount = -1;
  let lastProgressAt = Date.now();
  let lastLog = 0;
  const answeredQuestions = new Set<string>();

  while (Date.now() < deadline) {
    const response = await client.requestJson<CliStatus>(`/api/cli/${projectId}/status`);
    lastStatus = response.data;
    const status = String(lastStatus.status || "none");
    const runEvents = sessionId ? sliceEventsForRun(lastStatus.events || [], sessionId) : (lastStatus.events || []);
    if (runEvents.length !== lastEventCount) {
      lastProgressAt = Date.now();
    }
    await observeRunEvents(monitor, label, sessionId, lastStatus, runEvents);
    await maybeAnswerPendingQuestion(client, args, projectId, label, monitor, answeredQuestions, runEvents);

    if (Date.now() - lastLog > 20_000 || runEvents.length !== lastEventCount) {
      const tools = analyzeTools(runEvents, []);
      const journey = analyzeEstimatorJourney(runEvents, tools.calls, label === "full intake" ? "intake" : "question");
      const journeyTail = journey.phaseOrder.slice(-5).join(" -> ") || "no journey yet";
      log(`${label}: ${status}, events=${runEvents.length}, tools=${tools.totalCalls}, failures=${tools.failedResults}, journey=${journeyTail}`);
      lastEventCount = runEvents.length;
      lastLog = Date.now();
    }

    if (TERMINAL_AGENT_STATUSES.has(status)) {
      return { ...lastStatus, events: runEvents };
    }

    const stalledMs = Date.now() - lastProgressAt;
    if (runEvents.length > 0 && stalledMs >= args.stallMinutes * 60_000) {
      const stalledMinutes = Math.round(stalledMs / 60_000);
      if (!args.keepRunning) {
        await client.requestJson<Json>(`/api/cli/${projectId}/stop`, { method: "POST", body: {} }).catch(() => null);
      }
      await appendLiveNote(
        monitor,
        `${label} stalled after ${stalledMinutes} minute(s) with no new agent events. ${args.keepRunning ? "Left running." : "Stop requested."}`,
      );
      return { ...lastStatus, status: "stalled", events: runEvents };
    }

    await sleep(args.pollSeconds * 1000);
  }

  if (!args.keepRunning) {
    await client.requestJson<Json>(`/api/cli/${projectId}/stop`, { method: "POST", body: {} }).catch(() => null);
  }
  await appendLiveNote(monitor, `${label} timed out after ${args.timeoutMinutes} minute(s). ${args.keepRunning ? "Left running." : "Stop requested."}`);
  return { ...lastStatus, status: "timeout", events: sessionId ? sliceEventsForRun(lastStatus.events || [], sessionId) : (lastStatus.events || []) };
}

async function maybeAnswerPendingQuestion(
  client: ApiClient,
  args: Args,
  projectId: string,
  label: string,
  monitor: LiveMonitor,
  answeredQuestions: Set<string>,
  events: CliEvent[] = [],
) {
  if (!args.autoAnswerQuestions) return;
  const pending = await client.requestJson<Json>(`/api/cli/${projectId}/pending-question`).catch(() => null);
  const pendingData = pending?.data && pending.data.pending === true
    ? pending.data
    : findUnansweredAskUserEvent(events);
  if (!pendingData) return;

  const questionId = getString(pendingData.questionId) || getString(pendingData.id) || stringifyForSearch(pendingData.question).slice(0, 80);
  if (!questionId || answeredQuestions.has(questionId)) return;
  answeredQuestions.add(questionId);

  const question = getString(pendingData.question);
  const answer = args.questionAnswer || defaultEvalQuestionAnswer(question);
  await appendLiveNote(monitor, [
    `Auto-answering blocking question during ${label}.`,
    "",
    `Question: ${question || "(unknown)"}`,
    "",
    `Answer: ${answer}`,
  ].join("\n"));
  await client.requestJson<Json>(`/api/cli/${projectId}/answer`, {
    method: "POST",
    body: { questionId, answer },
  });
}

function findUnansweredAskUserEvent(events: CliEvent[]): Json | null {
  const resolvedQuestionIds = new Set<string>();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const data = getObject(event.data);

    if (event.type === "userAnswer" || event.type === "askUserTimeout") {
      const questionId = getString(data.questionId) || getString(data.id);
      if (questionId) resolvedQuestionIds.add(questionId);
      continue;
    }

    if (event.type !== "askUser") continue;

    const questionId = getString(data.questionId) || getString(data.id);
    if (!questionId || resolvedQuestionIds.has(questionId)) continue;
    return {
      pending: true,
      questionId,
      id: questionId,
      question: getString(data.question),
      options: Array.isArray(data.options) ? data.options : [],
      allowMultiple: data.allowMultiple === true,
      context: getString(data.context),
      questions: Array.isArray(data.questions) ? data.questions : [],
    };
  }
  return null;
}

function buildRunReport(label: string, kind: "intake" | "question", sessionId: string | undefined, status: CliStatus): RunReport {
  const events = status.events || [];
  const toolMetrics = analyzeTools(events, kind === "intake" ? DEFAULT_REQUIRED_TOOLS : ["getWorkspace", "getEstimateStrategy"]);
  const reasoningMetrics = analyzeReasoning(events);
  const stageMetrics = analyzeStages(toolMetrics.calls);
  const journeyMetrics = analyzeEstimatorJourney(events, toolMetrics.calls, kind);
  const findings = buildRunFindings(kind, status, toolMetrics, reasoningMetrics, stageMetrics, journeyMetrics);
  const timestamps = events.map((event) => event.timestamp).filter((value): value is string => !!value);
  const startedAt = timestamps[0] || status.startedAt || new Date().toISOString();
  const completedAt = timestamps[timestamps.length - 1] || new Date().toISOString();

  return {
    label,
    kind,
    sessionId,
    status: status.status || "unknown",
    runtime: status.runtime,
    startedAt,
    completedAt,
    durationSeconds: Math.max(0, secondsBetween(new Date(startedAt), new Date(completedAt))),
    eventCount: events.length,
    toolMetrics,
    reasoningMetrics,
    stageMetrics,
    journeyMetrics,
    findings,
  };
}

async function initLiveMonitor(args: Args, evalCase: EvalCase, caseName: string): Promise<LiveMonitor> {
  const caseDir = path.join(args.outDir, evalCase.id);
  await mkdir(caseDir, { recursive: true });
  const monitor: LiveMonitor = {
    enabled: args.live,
    caseId: evalCase.id,
    caseDir,
    observerPath: path.join(caseDir, "observer.md"),
    eventsPath: path.join(caseDir, "events.ndjson"),
    liveStatePath: path.join(caseDir, "live-state.json"),
    reviewCadenceMs: args.reviewCadenceSeconds * 1000,
    lastBriefAt: 0,
    lastEventCountByRun: {},
  };

  if (!monitor.enabled) return monitor;

  await writeFile(monitor.eventsPath, "", "utf8");
  await writeFile(monitor.observerPath, [
    `# Live Observer: ${caseName}`,
    "",
    `Case ID: ${evalCase.id}`,
    `Package: ${evalCase.zipPath}`,
    `Started: ${new Date().toISOString()}`,
    "",
    "This is an observation dossier for Codex/human review. Metrics are telemetry, not verdicts.",
    "Use it to decide whether to interrupt, rerun, adjust prompts/tools, add a follow-up question, or patch the orchestration.",
    "",
    "## Review Lens",
    "",
    "- Is the agent grounding claims in actual document reads rather than package metadata or memory?",
    "- Are tool errors changing the agent's plan, or is it continuing as if everything worked?",
    "- Is it using the staged estimate strategy as a thinking scaffold before pricing?",
    "- Are quantities, labour hours, rates, and allowances traceable to documents, libraries, benchmarks, or explicit assumptions?",
    "- Did the agent build/search/inspect the drawing atlas before making drawing-driven claims?",
    "- Does every drawing-driven quantity have a saved evidence-ledger claim with crop coordinates/hash or BOM/table text?",
    "- Did the independent verifier try to falsify high-risk drawing claims before pricing?",
    "- Are drawing/image tools returning useful structured facts, or dumping noisy payloads that poison context?",
    "",
  ].join("\n"), "utf8");
  await writeLiveState(monitor, { caseId: evalCase.id, status: "initialized" });
  return monitor;
}

async function appendLiveNote(monitor: LiveMonitor, note: string) {
  if (!monitor.enabled) return;
  await appendFile(monitor.observerPath, `\n## ${new Date().toISOString()}\n\n${note}\n`, "utf8");
}

async function observeIngestion(monitor: LiveMonitor, status: IngestionStatus) {
  if (!monitor.enabled) return;
  const signature = JSON.stringify({
    status: status.status,
    job: status.job ? {
      status: status.job.status,
      progress: status.job.progress,
      stage: status.job.stage,
      currentDocumentName: status.job.currentDocumentName,
    } : null,
    summary: status.summary,
  });
  if (signature === monitor.lastIngestionSignature) return;
  monitor.lastIngestionSignature = signature;

  const total = Number(status.summary?.total ?? status.documentCount ?? 0);
  const extracted = Number(status.summary?.extracted ?? 0);
  const pending = Number(status.summary?.pending ?? 0);
  const failed = Number(status.summary?.failed ?? 0);
  const line = `- Ingestion ${status.status || "unknown"}: ${extracted}/${total} extracted, ${pending} pending, ${failed} failed${status.job?.stage ? ` (${status.job.stage})` : ""}`;
  await appendFile(monitor.observerPath, `${line}\n`, "utf8");
  await appendFile(monitor.eventsPath, `${JSON.stringify({
    ts: new Date().toISOString(),
    caseId: monitor.caseId,
    channel: "ingestion",
    status: slimIngestionStatus(status),
  })}\n`, "utf8");
  await writeLiveState(monitor, { caseId: monitor.caseId, channel: "ingestion", ingestion: slimIngestionStatus(status) });
}

async function observeRunEvents(
  monitor: LiveMonitor,
  label: string,
  sessionId: string | undefined,
  status: CliStatus,
  events: CliEvent[],
) {
  if (!monitor.enabled) return;
  const key = sessionId || label;
  const previousCount = monitor.lastEventCountByRun[key] ?? 0;
  const newEvents = events.slice(previousCount);
  if (newEvents.length > 0) {
    const ndjson = newEvents.map((event) => JSON.stringify({
      ts: new Date().toISOString(),
      caseId: monitor.caseId,
      label,
      sessionId,
      channel: "agent",
      event: compactEvent(event),
    })).join("\n");
    await appendFile(monitor.eventsPath, `${ndjson}\n`, "utf8");

    const rendered = newEvents.map((event) => renderLiveEvent(event)).filter(Boolean);
    if (rendered.length) {
      await appendFile(monitor.observerPath, `\n### ${label}: event delta (${newEvents.length})\n\n${rendered.join("\n")}\n`, "utf8");
    }
    monitor.lastEventCountByRun[key] = events.length;
  }

  if (Date.now() - monitor.lastBriefAt > monitor.reviewCadenceMs) {
    const kind = label === "full intake" ? "intake" : "question";
    const run = buildRunReport(label, kind, sessionId, { ...status, events });
    await appendLiveReviewBrief(monitor, label, run);
    monitor.lastBriefAt = Date.now();
  }
}

async function appendLiveReviewBrief(
  monitor: LiveMonitor,
  label: string,
  run?: RunReport,
  report?: CaseReport,
) {
  if (!monitor.enabled) return;
  const lines = [
    "",
    `## Live Review Brief: ${label}`,
    "",
    `Time: ${new Date().toISOString()}`,
  ];

  if (run) {
    lines.push(
      `Run status: ${run.status}`,
      `Events/tools: ${run.eventCount} events, ${run.toolMetrics.totalCalls} tool calls, ${run.toolMetrics.failedResults} failed results`,
      `Reasoning telemetry: ${run.reasoningMetrics.thinkingEvents} thinking events, ${run.reasoningMetrics.thinkingChars} chars`,
      `Strategy stages seen: ${run.stageMetrics.savedStages.join(", ") || "none yet"}`,
      `Estimator journey order: ${run.journeyMetrics.phaseOrder.join(" -> ") || "none yet"}`,
      "",
      "Monitor Watch Items:",
      ...buildMonitorWatchItems(run, report).map((item) => `- ${item}`),
      "",
    );
  }

  if (report) {
    lines.push(
      "Final Telemetry Snapshot:",
      `- Documents: ${report.documentMetrics.extracted}/${report.documentMetrics.total} extracted, ${report.documentMetrics.readToolCalls} read calls`,
      `- Estimate: ${report.estimateMetrics.worksheets} worksheets, ${report.estimateMetrics.items} items, total ${report.estimateMetrics.totalValue ?? "unknown"}`,
      `- Pricing logic coverage telemetry: ${Math.round(report.estimateMetrics.logicCoverage * 100)}%`,
      `- Drawing evidence: atlas=${report.estimateMetrics.visualAudit.atlasStatus || "missing"}, claims=${report.estimateMetrics.visualAudit.evidenceClaims}, verifier=${report.estimateMetrics.visualAudit.verifierStatus || "missing"}, contradictions=${report.estimateMetrics.visualAudit.unresolvedContradictions}`,
      `- Visual probes: ${report.estimateMetrics.visualProbes.evidenced}/${report.estimateMetrics.visualProbes.probeCount} evidenced`,
      "",
      "Codex Decision Slot:",
      "- Decision: pending live review",
      "- Notes: inspect the chat/tool transcript, compare against the package, then decide whether to patch orchestration or rerun.",
      "",
    );
  }

  await appendFile(monitor.observerPath, `${lines.join("\n")}\n`, "utf8");
  await writeLiveState(monitor, {
    caseId: monitor.caseId,
    label,
    run,
    report: report ? {
      projectId: report.projectId,
      qualityTelemetry: report.quality,
      findings: report.findings,
      documentMetrics: report.documentMetrics,
      estimateMetrics: report.estimateMetrics,
    } : undefined,
  });
}

function buildMonitorWatchItems(run: RunReport, report?: CaseReport) {
  const items: string[] = [];
  if (run.toolMetrics.failedResults > 0) {
    items.push("Open the failed tool result payloads and decide whether the agent recovered intelligently or hallucinated past the failure.");
  }
  if (run.toolMetrics.byTool.scanDrawingSignals?.calls) {
    items.push("Inspect scanDrawingSignals outputs for noisy base64 or low-value payloads; if noisy, patch the tool contract before rerunning.");
  }
  if (run.kind === "intake" && !run.toolMetrics.byTool.buildDrawingAtlas && (run.journeyMetrics.renderedDrawingPages > 0 || run.journeyMetrics.zoomedDrawingRegions > 0)) {
    items.push("The run used lower-level drawing tools without the Drawing Evidence Engine atlas; inspect whether crops were guessed instead of retrieved.");
  }
  if (run.kind === "intake" && run.toolMetrics.byTool.inspectDrawingRegion?.calls && !run.toolMetrics.byTool.saveDrawingEvidenceClaim?.calls) {
    items.push("The run inspected drawing regions but has not saved evidence-ledger claims; quantities may not be traceable.");
  }
  if (run.kind === "intake" && run.toolMetrics.byTool.saveDrawingEvidenceClaim?.calls && !run.toolMetrics.byTool.verifyDrawingEvidenceLedger?.calls) {
    items.push("The drawing evidence ledger has claims but no independent verifier pass yet.");
  }
  if (run.kind === "intake" && run.stageMetrics.savedStages.length < 4) {
    items.push("Watch whether the agent is genuinely using the staged strategy scaffold before creating line items.");
  }
  if (run.kind === "intake" && run.journeyMetrics.renderedDrawingPages > 0 && run.journeyMetrics.zoomedDrawingRegions === 0) {
    items.push("Drawing pass is still only page-level rendering; require a targeted zoom before accepting drawing-driven quantities.");
  }
  if (run.kind === "intake" && run.journeyMetrics.symbolScans > 0 && run.journeyMetrics.zoomedDrawingRegions === 0) {
    items.push("scanDrawingSymbols appeared before targeted zoom evidence; treat it as possible page-overview/checklist misuse, not proof of visual takeoff depth.");
  }
  if (run.kind === "intake" && run.journeyMetrics.missingHumanBehaviors.length > 0) {
    items.push(`Human-estimator journey gaps to inspect: ${run.journeyMetrics.missingHumanBehaviors.join(" ")}`);
  }
  if (run.kind === "intake" && run.journeyMetrics.returnsToDocuments === 0 && run.journeyMetrics.pricingSignals > 0) {
    items.push("The workflow has not shown a return from pricing/reference work back into documents/drawings; inspect for linear speedrun behavior.");
  }
  if (run.kind === "intake" && !run.toolMetrics.byTool.readDocumentText && !run.toolMetrics.byTool.getDocumentStructured && !run.toolMetrics.byTool.readSpreadsheet) {
    items.push("The agent has not visibly read source documents yet; check whether it is relying on package metadata only.");
  }
  if (run.reasoningMetrics.thinkingChars === 0) {
    items.push("No thinking events are visible from this runtime; judge depth from tool sequencing, intermediate saves, and assistant messages instead.");
  }
  if (report && report.estimateMetrics.items > 0 && report.estimateMetrics.logicCoverage < 0.65) {
    items.push("Sample line items manually: verify quantity/rate/hour logic is traceable, not just populated.");
  }
  if (items.length === 0) {
    items.push("No obvious telemetry anomalies yet; continue judging coherence, grounding, and estimate logic from the live transcript.");
  }
  return items;
}

function renderLiveEvent(event: CliEvent) {
  const data = getObject(event.data);
  const ts = event.timestamp ? event.timestamp.slice(11, 19) : new Date().toISOString().slice(11, 19);
  if (event.type === "tool_call" || event.type === "tool") {
    const tool = normalizeToolId(getString(data.toolId) || getString(data.name) || getString(data.toolName) || "unknown");
    return `- ${ts} tool call \`${tool}\` ${compactInline(data.input ?? data.arguments ?? data.args ?? {})}`;
  }
  if (event.type === "tool_result") {
    const success = inferToolResultSuccess(data, data.content ?? data.result ?? data.output ?? data.error);
    const marker = success ? "tool result" : "tool result needs inspection";
    return `- ${ts} ${marker} ${compactInline(data.content ?? data.result ?? data.output ?? data.error ?? {})}`;
  }
  if (event.type === "thinking") {
    return `- ${ts} thinking ${compactInline(data.content ?? data.text ?? data)}`;
  }
  if (event.type === "message") {
    const role = getString(data.role) || "assistant";
    return `- ${ts} ${role} message ${compactInline(data.content ?? data.text ?? data)}`;
  }
  if (event.type === "progress") {
    return `- ${ts} progress ${compactInline(data)}`;
  }
  if (event.type === "status") {
    return `- ${ts} status ${compactInline(data)}`;
  }
  if (event.type === "error") {
    return `- ${ts} error ${compactInline(data)}`;
  }
  return "";
}

function compactEvent(event: CliEvent) {
  return {
    ...event,
    data: compactUnknown(event.data, 1_200),
  };
}

function compactUnknown(value: unknown, maxLength: number): unknown {
  if (typeof value === "string") return compactText(value, maxLength);
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => compactUnknown(entry, Math.floor(maxLength / 2)));
  if (value && typeof value === "object") {
    const out: Json = {};
    for (const [key, child] of Object.entries(value as Json).slice(0, 40)) {
      out[key] = compactUnknown(child, Math.floor(maxLength / 2));
    }
    return out;
  }
  return value;
}

function compactInline(value: unknown) {
  return compactText(stringifyForSearch(value), 500);
}

function compactText(value: string, maxLength: number) {
  return truncate(value.replace(/[A-Za-z0-9+/=]{500,}/g, "[large encoded payload omitted]"), maxLength).replace(/\s+/g, " ").trim();
}

async function writeLiveState(monitor: LiveMonitor, state: Json) {
  if (!monitor.enabled) return;
  await writeFile(monitor.liveStatePath, JSON.stringify({
    updatedAt: new Date().toISOString(),
    ...state,
  }, null, 2), "utf8");
}

function analyzeTools(events: CliEvent[], requiredTools: string[], expectedTools: string[] = DEFAULT_EXPECTED_TOOLS): ToolMetrics {
  const calls: ToolCall[] = [];
  const results: ToolResult[] = [];
  const callsByUseId = new Map<string, ToolCall>();

  for (const event of events) {
    const data = getObject(event.data);
    if (event.type === "tool_call" || event.type === "tool") {
      const toolId = normalizeToolId(getString(data.toolId) || getString(data.name) || getString(data.toolName) || "unknown");
      const toolUseId = getString(data.toolUseId) || getString(data.id) || getString(data.toolCallId);
      const call = {
        toolUseId,
        toolId,
        input: data.input ?? data.arguments ?? data.args ?? {},
        timestamp: event.timestamp,
      };
      calls.push(call);
      if (toolUseId) callsByUseId.set(toolUseId, call);
    }
    if (event.type === "tool_result") {
      const toolUseId = getString(data.toolUseId) || getString(data.id) || getString(data.toolCallId) || getString(data.callId);
      const pairedCall = toolUseId ? callsByUseId.get(toolUseId) : undefined;
      const content = data.content ?? data.result ?? data.output ?? data.error;
      const success = inferToolResultSuccess(data, content, pairedCall?.toolId || getString(data.toolId) || getString(data.name));
      results.push({
        toolUseId,
        toolId: getString(data.toolId) || getString(data.name) || pairedCall?.toolId,
        success,
        durationMs: getNumber(data.duration_ms) ?? getNumber(data.durationMs),
        contentPreview: truncate(stringifyForSearch(content), 400),
        timestamp: event.timestamp,
      });
    }
  }

  const byTool: ToolMetrics["byTool"] = {};
  for (const call of calls) {
    byTool[call.toolId] ||= { calls: 0, results: 0, failures: 0, avgDurationMs: null };
    byTool[call.toolId].calls += 1;
  }

  const durationsByTool = new Map<string, number[]>();
  let unmatchedResults = 0;
  for (const result of results) {
      const toolId = normalizeToolId(result.toolId || (result.toolUseId ? callsByUseId.get(result.toolUseId)?.toolId : undefined) || "unknown");
    byTool[toolId] ||= { calls: 0, results: 0, failures: 0, avgDurationMs: null };
    byTool[toolId].results += 1;
    if (!result.success) byTool[toolId].failures += 1;
    if (typeof result.durationMs === "number" && Number.isFinite(result.durationMs)) {
      const list = durationsByTool.get(toolId) || [];
      list.push(result.durationMs);
      durationsByTool.set(toolId, list);
    }
    if (result.toolUseId && !callsByUseId.has(result.toolUseId)) unmatchedResults += 1;
  }

  for (const [toolId, durations] of durationsByTool.entries()) {
    byTool[toolId].avgDurationMs = Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
  }

  const resultIds = new Set(results.map((result) => result.toolUseId).filter(Boolean));
  const unmatchedCalls = calls.filter((call) => call.toolUseId && !resultIds.has(call.toolUseId)).length;
  const calledToolSet = new Set(calls.map((call) => call.toolId));
  const requiredMissing = requiredTools.filter((tool) => !calledToolSet.has(tool));
  const expectedMissing = expectedTools.filter((tool) => !calledToolSet.has(tool));
  const failedResults = results.filter((result) => !result.success).length;
  const totalResults = results.length;

  return {
    calls,
    results,
    totalCalls: calls.length,
    totalResults,
    failedResults,
    unmatchedResults,
    unmatchedCalls,
    successRate: totalResults > 0 ? round((totalResults - failedResults) / totalResults, 3) : 0,
    byTool,
    requiredMissing,
    expectedMissing,
  };
}

function analyzeReasoning(events: CliEvent[]): ReasoningMetrics {
  let thinkingEvents = 0;
  let thinkingChars = 0;
  let assistantMessages = 0;
  let assistantChars = 0;
  let progressEvents = 0;

  for (const event of events) {
    const data = getObject(event.data);
    if (event.type === "thinking") {
      thinkingEvents += 1;
      thinkingChars += stringifyForSearch(data.content ?? data.text ?? data).length;
    }
    if (event.type === "message") {
      const role = getString(data.role);
      if (!role || role === "assistant") {
        assistantMessages += 1;
        assistantChars += stringifyForSearch(data.content ?? data.text ?? data).length;
      }
    }
    if (event.type === "progress") progressEvents += 1;
  }

  return { thinkingEvents, thinkingChars, assistantMessages, assistantChars, progressEvents };
}

function analyzeStages(calls: ToolCall[]): StageMetrics {
  const savedStages = calls
    .filter((call) => STRATEGY_STAGE_TOOLS.has(call.toolId))
    .map((call) => call.toolId);
  const missingCriticalStages = DEFAULT_REQUIRED_TOOLS
    .filter((tool) => STRATEGY_STAGE_TOOLS.has(tool))
    .filter((tool) => !savedStages.includes(tool));
  return {
    savedStages: [...new Set(savedStages)],
    missingCriticalStages,
  };
}

function analyzeEstimatorJourney(events: CliEvent[], calls: ToolCall[], kind: "intake" | "question"): EstimatorJourneyMetrics {
  const phases: EstimatorJourneyMetrics["phases"] = Object.fromEntries(
    HUMAN_ESTIMATOR_PHASES.map((phase) => [phase, { hits: 0, firstIndex: null, tools: [] }]),
  );
  const sequence: EstimatorJourneyEvent[] = [];
  const callIndexes = new Map<ToolCall, number>();
  let callPointer = 0;

  for (const [index, event] of events.entries()) {
    if (event.type !== "tool_call" && event.type !== "tool") continue;
    const call = calls[callPointer];
    callPointer += 1;
    if (call) callIndexes.set(call, index);
  }

  for (const call of calls) {
    const eventIndex = callIndexes.get(call) ?? sequence.length;
    const matches = phasesForTool(call.toolId);
    for (const match of matches) {
      const phase = phases[match.phase] || { hits: 0, firstIndex: null, tools: [] };
      phase.hits += 1;
      phase.firstIndex ??= eventIndex;
      if (!phase.tools.includes(call.toolId)) phase.tools.push(call.toolId);
      phases[match.phase] = phase;
      sequence.push({
        index: eventIndex,
        timestamp: call.timestamp,
        phase: match.phase,
        toolId: call.toolId,
        note: match.note,
      });
    }
  }

  sequence.sort((a, b) => a.index - b.index);
  const phaseOrder = compressConsecutive(sequence.map((event) => event.phase));
  const returnsToDocuments = countReturnsToDocuments(phaseOrder);
  const renderedDrawingPages = countToolCalls(calls, "renderDrawingPage");
  const zoomedDrawingRegions = countToolCalls(calls, "zoomDrawingRegion");
  const symbolScans = countToolCalls(calls, "scanDrawingSymbols");
  const symbolImageScans = countSymbolImageScans(calls);
  const symbolCounts = countToolCalls(calls, "countSymbols") + countToolCalls(calls, "countSymbolsAllPages");
  const actualVisualDrawingSignals = countActualVisualDrawingSignals(calls);
  const missingHumanBehaviors: string[] = [];
  const hit = (phase: string) => (phases[phase]?.hits ?? 0) > 0;

  if (kind === "intake") {
    if (!hit("orientation")) missingHumanBehaviors.push("No visible orientation pass through workspace/strategy.");
    if (!hit("spec_reading") && !hit("document_inventory")) missingHumanBehaviors.push("No visible source document/spec reading before estimating.");
    if (actualVisualDrawingSignals === 0) missingHumanBehaviors.push("No visible native visual inspection of a rendered drawing image.");
    if (renderedDrawingPages > 0 && zoomedDrawingRegions === 0) {
      missingHumanBehaviors.push("Rendered drawing pages but did not zoom into any targeted drawing region.");
    }
    if (symbolScans > 0 && zoomedDrawingRegions === 0) {
      missingHumanBehaviors.push("scanDrawingSymbols was used without targeted zoom evidence; likely page-overview/checklist behavior.");
    }
    if (!hit("drawing_deep_read")) missingHumanBehaviors.push("No visible drawing deep-read, zoom, symbol scan, or drawing-page inspection.");
    if (!hit("takeoff")) missingHumanBehaviors.push("No visible takeoff or drawing-quantity loop.");
    if (!hit("reference_books")) missingHumanBehaviors.push("No visible estimator book/knowledge lookup.");
    if (!hit("labor_units")) missingHumanBehaviors.push("No visible labour productivity lookup.");
    if (!hit("pricing_basis")) missingHumanBehaviors.push("No visible cost/catalog/rate/assembly basis lookup before pricing.");
    if (!hit("worksheet_build")) missingHumanBehaviors.push("No visible worksheet-building phase.");
    if (!hit("reconcile")) missingHumanBehaviors.push("No visible benchmark/reconcile/final review phase.");
    if (returnsToDocuments === 0 && hit("worksheet_build")) {
      missingHumanBehaviors.push("No visible back-and-forth from pricing/building back to documents or drawings.");
    }
  } else {
    if (!hit("orientation")) missingHumanBehaviors.push("Question run did not visibly orient on workspace/strategy.");
    if (hit("worksheet_build")) missingHumanBehaviors.push("Question run used mutating worksheet/quote tools; check drawer guardrails.");
  }

  return {
    phases,
    sequence,
    phaseOrder,
    transitions: Math.max(0, phaseOrder.length - 1),
    returnsToDocuments,
    actualVisualDrawingSignals,
    renderedDrawingPages,
    zoomedDrawingRegions,
    symbolScans,
    symbolImageScans,
    symbolCounts,
    drawingDeepReadSignals: phases.drawing_deep_read?.hits ?? 0,
    takeoffSignals: phases.takeoff?.hits ?? 0,
    referenceLookupSignals: phases.reference_books?.hits ?? 0,
    laborBasisSignals: phases.labor_units?.hits ?? 0,
    datasetSignals: phases.datasets?.hits ?? 0,
    pricingSignals: phases.pricing_basis?.hits ?? 0,
    reconcileSignals: phases.reconcile?.hits ?? 0,
    missingHumanBehaviors,
  };
}

function countToolCalls(calls: ToolCall[], toolId: string) {
  return calls.filter((call) => call.toolId === toolId).length;
}

function phasesForTool(toolId: string) {
  return PHASE_TOOL_PATTERNS.filter((entry) => entry.matches.some((pattern) => pattern.test(toolId)));
}

function countSymbolImageScans(calls: ToolCall[]) {
  return calls.filter((call) => {
    if (call.toolId !== "scanDrawingSymbols") return false;
    const input = getObject(parseMaybeJson(call.input));
    return input.includeImage === true;
  }).length;
}

function countActualVisualDrawingSignals(calls: ToolCall[]) {
  return calls.filter((call) => {
    if (call.toolId === "inspectDrawingRegion" || call.toolId === "renderDrawingPage" || call.toolId === "zoomDrawingRegion" || call.toolId === "inspectDrawingTitleBlock") return true;
    return false;
  }).length;
}

function compressConsecutive(values: string[]) {
  const out: string[] = [];
  for (const value of values) {
    if (out[out.length - 1] !== value) out.push(value);
  }
  return out;
}

function countReturnsToDocuments(phaseOrder: string[]) {
  let returns = 0;
  for (let index = 1; index < phaseOrder.length; index += 1) {
    const previous = phaseOrder[index - 1];
    const current = phaseOrder[index];
    if (
      ["worksheet_build", "pricing_basis", "labor_units", "datasets", "reference_books"].includes(previous) &&
      ["spec_reading", "drawing_deep_read", "document_inventory", "takeoff"].includes(current)
    ) {
      returns += 1;
    }
  }
  return returns;
}

function analyzeDocuments(status: IngestionStatus | undefined, workspace: Json, events: CliEvent[], expectations: CaseExpectations): DocumentMetrics {
  const statusDocs = status?.documents || [];
  const workspaceDocs = Array.isArray(workspace.sourceDocuments) ? workspace.sourceDocuments as Json[] : [];
  const allDocs = statusDocs.length ? statusDocs : workspaceDocs;
  const docs = allDocs.filter((doc) => !isIgnorableProjectDocumentName(getString(doc.fileName) || getString(doc.name) || getString(doc.title)));
  const names = docs.map((doc) => getString(doc.fileName) || getString(doc.name) || getString(doc.title)).filter(Boolean);
  const docIdToName = new Map<string, string>();
  for (const doc of docs) {
    const id = getString(doc.id);
    const name = getString(doc.fileName) || getString(doc.name) || getString(doc.title);
    if (id && name) docIdToName.set(id, name);
  }

  const toolMetrics = analyzeTools(events, []);
  const readCalls = toolMetrics.calls.filter((call) => DOCUMENT_READ_TOOLS.has(call.toolId));
  const readDocumentIds = new Set<string>();
  const readDocumentNames = new Set<string>();
  for (const call of readCalls) {
    const input = parseMaybeJson(call.input);
    collectDocumentRefs(input, readDocumentIds, readDocumentNames);
  }

  const resolvedReadNames = new Set([...readDocumentNames]);
  for (const id of readDocumentIds) {
    const name = docIdToName.get(id);
    if (name) resolvedReadNames.add(name);
  }

  const extracted = docs.length
    ? docs.filter((doc) => doc.extractionState === "extracted" || doc.status === "complete" || doc.hasText === true).length
    : Number(status?.summary?.extracted ?? 0);
  const pending = docs.length
    ? docs.filter((doc) => doc.extractionState === "pending" || doc.status === "pending").length
    : Number(status?.summary?.pending ?? 0);
  const failed = docs.length
    ? docs.filter((doc) => doc.extractionState === "failed" || doc.status === "failed").length
    : Number(status?.summary?.failed ?? 0);
  const total = docs.length || Number(status?.summary?.total ?? status?.documentCount ?? 0);
  const readCoverage = total > 0 ? round(resolvedReadNames.size / total, 3) : null;
  const expectedMissing = missingNeedles(names.join("\n"), expectations.expectedDocumentNames || []);

  return {
    total,
    extracted,
    pending,
    failed,
    names,
    readToolCalls: readCalls.length,
    readDocumentIds: [...readDocumentIds],
    readDocumentNames: [...resolvedReadNames],
    readCoverage,
    expectedMissing,
  };
}

function isIgnorableProjectDocumentName(nameValue: unknown) {
  const name = String(nameValue ?? "").toLowerCase();
  const base = name.split(/[\\/]/).pop() || name;
  return (
    name.includes("__macosx/") ||
    base.startsWith("._") ||
    base === ".ds_store" ||
    base === "thumbs.db" ||
    base === "desktop.ini"
  );
}

function evidenceDocumentIdsMatch(leftValue: unknown, rightValue: unknown) {
  const left = String(leftValue ?? "").trim();
  const right = String(rightValue ?? "").trim();
  if (!left || !right) return false;
  if (left === right) return true;
  const compactLeft = left.replace(/\.\.\.|…/g, "");
  const compactRight = right.replace(/\.\.\.|…/g, "");
  if (compactLeft.length >= 12 && right.startsWith(compactLeft)) return true;
  if (compactRight.length >= 12 && left.startsWith(compactRight)) return true;
  return false;
}

function regionNumber(region: Json, key: string) {
  const value = getNumber(region[key]);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isTargetedZoomRegion(regionValue: unknown) {
  const region = getObject(regionValue);
  const width = regionNumber(region, "width");
  const height = regionNumber(region, "height");
  const imageWidth = regionNumber(region, "imageWidth");
  const imageHeight = regionNumber(region, "imageHeight");
  if (!width || !height || width <= 0 || height <= 0) return false;
  if (!imageWidth || !imageHeight || imageWidth <= 0 || imageHeight <= 0) return true;
  const areaRatio = (width * height) / (imageWidth * imageHeight);
  return areaRatio < 0.75 && width < imageWidth * 0.95 && height < imageHeight * 0.95;
}

function regionsApproximatelyMatch(leftValue: unknown, rightValue: unknown) {
  const left = getObject(leftValue);
  const right = getObject(rightValue);
  return ["x", "y", "width", "height"].every((key) => {
    const leftNumber = regionNumber(left, key);
    const rightNumber = regionNumber(right, key);
    if (leftNumber === null || rightNumber === null) return false;
    const tolerance = Math.max(8, Math.abs(rightNumber) * 0.03);
    return Math.abs(leftNumber - rightNumber) <= tolerance;
  });
}

function collectActualVisualCalls(workspace: Json) {
  const renderedPages: Array<{ documentId: string; pageNumber: number }> = [];
  const zoomRegions: Array<{ documentId: string; pageNumber: number; region: Json }> = [];
  const aiRuns = Array.isArray(workspace.aiRuns) ? workspace.aiRuns as Json[] : [];
  const engine = drawingEngine(workspace);
  const atlas = getObject(engine.atlas);
  const atlasPages = Array.isArray(atlas.pages) ? atlas.pages as Json[] : [];
  const claims = Array.isArray(engine.claims) ? engine.claims as Json[] : [];

  for (const pageValue of atlasPages) {
    const page = getObject(pageValue);
    const documentId = getString(page.documentId);
    const pageNumber = getNumber(page.pageNumber);
    if (documentId && typeof pageNumber === "number") {
      renderedPages.push({ documentId, pageNumber });
    }
  }

  for (const claim of claims) {
    const evidence = Array.isArray(claim.evidence) ? claim.evidence as Json[] : [];
    for (const entryValue of evidence) {
      const entry = getObject(entryValue);
      const documentId = getString(entry.documentId);
      const pageNumber = getNumber(entry.pageNumber);
      const region = getObject(entry.region ?? entry.bbox);
      if (documentId && typeof pageNumber === "number" && Object.keys(region).length > 0) {
        zoomRegions.push({ documentId, pageNumber, region });
      }
    }
  }

  for (const run of aiRuns) {
    const output = getObject(run.output);
    const events = Array.isArray(output.events) ? output.events as Json[] : [];
    for (const event of events) {
      const type = getString(event.type);
      if (type !== "tool_call" && type !== "tool") continue;
      const data = getObject(event.data);
      const toolId = normalizeToolId(getString(data.toolId) || getString(event.toolId) || "");
      const input = getObject(data.input ?? event.input);
      const documentId = getString(input.documentId);
      const pageNumber = getNumber(input.pageNumber);
      if (!documentId || typeof pageNumber !== "number") continue;
      if (toolId === "renderDrawingPage") {
        renderedPages.push({ documentId, pageNumber });
      }
      if (toolId === "zoomDrawingRegion") {
        const region = getObject(input.region);
        if (Object.keys(region).length > 0) {
          zoomRegions.push({ documentId, pageNumber, region });
        }
      }
    }
  }

  return { renderedPages, zoomRegions };
}

function visualPageMatchesActual(evidence: unknown, actualPages: Array<{ documentId: string; pageNumber: number }>) {
  const entry = getObject(evidence);
  const pageNumber = getNumber(entry.pageNumber);
  if (typeof pageNumber !== "number") return false;
  return actualPages.some((page) =>
    page.pageNumber === pageNumber &&
    evidenceDocumentIdsMatch(entry.documentId, page.documentId)
  );
}

function visualZoomMatchesActual(evidence: unknown, actualZooms: Array<{ documentId: string; pageNumber: number; region: Json }>) {
  const entry = getObject(evidence);
  const pageNumber = getNumber(entry.pageNumber);
  if (typeof pageNumber !== "number" || !isTargetedZoomRegion(entry.region)) return false;
  return actualZooms.some((zoom) =>
    zoom.pageNumber === pageNumber &&
    evidenceDocumentIdsMatch(entry.documentId, zoom.documentId) &&
    isTargetedZoomRegion(zoom.region) &&
    regionsApproximatelyMatch(entry.region, zoom.region)
  );
}

function packageIdentity(entry: Json, reason: string, evidence?: Json): VisualAuditIssue {
  return {
    packageId: getString(entry.packageId) || undefined,
    packageName: getString(entry.packageName) || undefined,
    documentId: evidence ? getString(evidence.documentId) || undefined : undefined,
    pageNumber: evidence ? getNumber(evidence.pageNumber) : undefined,
    reason,
  };
}

function drawingEngine(workspace: Json) {
  const strategy = getObject(workspace.estimateStrategy);
  const summary = getObject(strategy.summary);
  return getObject(summary.drawingEvidenceEngine);
}

function claimPackageMatches(entry: Json, claim: Json) {
  const packageId = getString(entry.packageId).toLowerCase();
  const packageName = getString(entry.packageName).toLowerCase();
  const claimPackageId = getString(claim.packageId).toLowerCase();
  const claimPackageName = getString(claim.packageName).toLowerCase();
  if (packageId && claimPackageId && packageId === claimPackageId) return true;
  if (packageName && claimPackageName && packageName === claimPackageName) return true;
  if (packageId && claimPackageName && claimPackageName.includes(packageId)) return true;
  if (packageName && claimPackageId && packageName.includes(claimPackageId)) return true;
  return false;
}

function claimHasUsableEvidence(claim: Json) {
  const method = getString(claim.method).toLowerCase();
  const evidence = Array.isArray(claim.evidence) ? claim.evidence as Json[] : [];
  if (!getString(claim.quantityName) && !getString(claim.claim)) return false;
  if (claim.value === undefined || claim.value === null || claim.value === "") return false;
  if (method === "assumption") return stringifyForSearch(claim.assumption ?? claim.rationale).length >= 20;
  if (evidence.length === 0) return false;
  if (method === "visual_count" || method === "takeoff") {
    return evidence.some((entry) => (getString(entry.regionId) || Object.keys(getObject(entry.bbox)).length > 0) && getString(entry.imageHash).length >= 16);
  }
  if (method === "bom_table" || method === "ocr_text") {
    return evidence.some((entry) => getString(entry.regionId) || getString(entry.sourceText).length >= 20);
  }
  return evidence.length > 0 || stringifyForSearch(claim.rationale).length >= 20;
}

function analyzeVisualAudit(workspace: Json): VisualAuditMetrics {
  const strategy = getObject(workspace.estimateStrategy);
  const scopeGraph = getObject(strategy.scopeGraph);
  const audit = getObject(scopeGraph.visualTakeoffAudit);
  const packages = Array.isArray(audit.drawingDrivenPackages) ? audit.drawingDrivenPackages as Json[] : [];
  const actual = collectActualVisualCalls(workspace);
  const engine = drawingEngine(workspace);
  const atlas = getObject(engine.atlas);
  const atlasRegions = Array.isArray(atlas.regions) ? atlas.regions as Json[] : [];
  const atlasRegionTypes = atlasRegions.map((region) => getString(getObject(region).regionType));
  const claims = Array.isArray(engine.claims) ? engine.claims as Json[] : [];
  const atlasDocumentRequests = Array.isArray(engine.atlasDocumentRequests) ? engine.atlasDocumentRequests as Json[] : [];
  const promotedDocuments = Array.isArray(engine.promotedDocuments) ? engine.promotedDocuments as Json[] : [];
  const verifications = Array.isArray(engine.verifications) ? engine.verifications as Json[] : [];
  const latestVerification = getObject(verifications[0]);
  const contradictions = Array.isArray(engine.contradictions)
    ? (engine.contradictions as Json[]).filter((entry) => !["resolved", "carried_assumption"].includes(getString(getObject(entry).status).toLowerCase()))
    : [];
  const packagesMissingActualRender: VisualAuditIssue[] = [];
  const packagesMissingActualZoom: VisualAuditIssue[] = [];
  const fullPageZoomEvidence: VisualAuditIssue[] = [];
  const packagesMissingLedgerClaims: VisualAuditIssue[] = [];

  for (const entry of packages) {
    const renderedPages = Array.isArray(entry.renderedPages) ? entry.renderedPages as Json[] : [];
    const zoomEvidence = Array.isArray(entry.zoomEvidence) ? entry.zoomEvidence as Json[] : [];
    if (renderedPages.length > 0 && !renderedPages.some((page) => visualPageMatchesActual(page, actual.renderedPages))) {
      packagesMissingActualRender.push(packageIdentity(entry, "renderedPages did not match an actual atlas/render record"));
    }
    const fullPageEntries = zoomEvidence.filter((zoom) => !isTargetedZoomRegion(getObject(zoom).region));
    for (const zoom of fullPageEntries) {
      fullPageZoomEvidence.push(packageIdentity(entry, "zoomEvidence region is effectively full-page or missing dimensions", zoom));
    }
    if (zoomEvidence.length > 0 && !zoomEvidence.some((zoom) => visualZoomMatchesActual(zoom, actual.zoomRegions))) {
      packagesMissingActualZoom.push(packageIdentity(entry, "zoomEvidence did not match an actual targeted inspected/zoomed region"));
    }
    if (!claims.some((claim) => claimPackageMatches(entry, claim) && claimHasUsableEvidence(claim))) {
      packagesMissingLedgerClaims.push(packageIdentity(entry, "no usable Drawing Evidence Engine ledger claim for package"));
    }
  }

  return {
    drawingDrivenPackages: packages.length,
    actualRenderedPages: actual.renderedPages.length,
    actualZoomRegions: actual.zoomRegions.length,
    atlasStatus: getString(atlas.status) || null,
    atlasRegions: getNumber(atlas.regionCount) ?? 0,
    atlasDocumentRequests: atlasDocumentRequests.length,
    promotedDocuments: promotedDocuments.length,
    providerRegions: atlasRegionTypes.filter((type) => type.startsWith("provider_")).length,
    cadNativeRegions: atlasRegionTypes.filter((type) => type.startsWith("cad_")).length,
    modelNativeRegions: atlasRegionTypes.filter((type) => type.startsWith("model_")).length,
    evidenceClaims: claims.length,
    verifierStatus: getString(latestVerification.status) || null,
    unresolvedContradictions: contradictions.length,
    packagesMissingLedgerClaims,
    packagesMissingActualRender,
    packagesMissingActualZoom,
    fullPageZoomEvidence,
  };
}

function defaultVisualProbes(_workspace: Json, expectations: CaseExpectations): VisualProbeExpectation[] {
  const byId = new Map<string, VisualProbeExpectation>();
  for (const probe of expectations.visualProbes || []) byId.set(probe.id, probe);
  return [...byId.values()];
}

function visualProbeComparableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const matches = value.match(/-?\d+(?:\.\d+)?/g) || [];
    if (matches.length === 1) return Number(matches[0]);
  }
  return null;
}

function normalizeVisualProbeText(value: unknown) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u00d7\u2715]/g, "x")
    .replace(/(?<=[0-9'"])x(?=[0-9'"])/g, " x ")
    .replace(/[^a-z0-9'"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function visualProbeValuesMatch(expected: string | number, observed: unknown) {
  if (typeof expected === "number") {
    const observedNumber = visualProbeComparableNumber(observed);
    return observedNumber !== null && Math.abs(observedNumber - expected) < 0.0001;
  }
  const expectedText = normalizeVisualProbeText(expected);
  const observedText = normalizeVisualProbeText(observed);
  return expectedText.length > 0 && (observedText === expectedText || observedText.includes(expectedText));
}

function visualProbeSignalCarriesExpected(probe: VisualProbeExpectation, matchedSignals: string[]) {
  if (probe.expectedAnswer === undefined || matchedSignals.length === 0) return false;
  if (typeof probe.expectedAnswer === "number") {
    return matchedSignals.some((signal) => {
      const numbers = signal.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      return numbers.some((value) => Math.abs(value - Number(probe.expectedAnswer)) < 0.0001);
    });
  }
  const expectedText = normalizeVisualProbeText(probe.expectedAnswer);
  return expectedText.length > 0 && matchedSignals.some((signal) => normalizeVisualProbeText(signal).includes(expectedText));
}

function visualProbeAcceptedSignalMatches(probe: VisualProbeExpectation, text: string) {
  return (probe.acceptedSignals || []).some((signal) => {
    const normalized = normalizeVisualProbeText(signal);
    return normalized.length > 0 && text.includes(normalized);
  });
}

function visualProbeObservedValue(claim: Json) {
  const record = getObject(claim);
  return record.value ?? record.quantity ?? record.result ?? record.claimValue ?? null;
}

function stripDrawingEvidenceEngine(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDrawingEvidenceEngine);
  if (!value || typeof value !== "object") return value;
  const source = value as Json;
  const next: Json = {};
  for (const [key, entry] of Object.entries(source)) {
    if (key === "drawingEvidenceEngine") continue;
    next[key] = stripDrawingEvidenceEngine(entry);
  }
  return next;
}

function hasProbeFieldSelectingValue(value: unknown, probe: VisualProbeExpectation, expected: string | number, path: string[] = []): boolean {
  if (value === null || value === undefined) return false;
  const keyText = normalizeVisualProbeText(path.join(" "));
  const isProbeKey = visualProbeAcceptedSignalMatches(probe, keyText);

  if (isProbeKey && visualProbeValuesMatch(expected, value)) return true;

  if (Array.isArray(value)) {
    return value.some((entry, index) => hasProbeFieldSelectingValue(entry, probe, expected, [...path, String(index)]));
  }
  if (typeof value === "object") {
    const record = value as Json;
    const localText = normalizeVisualProbeText([
      record.quantityName,
      record.claim,
      record.name,
      record.entityName,
      record.description,
      record.sourceNotes,
      record.scope,
      record.rationale,
      record.quantityBasis,
    ].filter(Boolean).join(" "));
    const localMatchesProbe = visualProbeAcceptedSignalMatches(probe, localText);
    if (localMatchesProbe) {
      for (const field of ["quantity", "count", "value", "qty", "total"]) {
        if (visualProbeValuesMatch(expected, record[field])) return true;
      }
    }
    return Object.entries(record).some(([key, entry]) => hasProbeFieldSelectingValue(entry, probe, expected, [...path, key]));
  }
  return false;
}

function visualProbeAuthorityFailureReason(
  probe: VisualProbeExpectation,
  relatedClaims: Json[],
  decisionContext: unknown,
  mismatchedValues: Array<string | number | boolean>,
) {
  if (probe.expectedAnswer === undefined || mismatchedValues.length === 0) return null;
  const claimsText = normalizeVisualProbeText(stringifyForSearch({ probe, relatedClaims }));
  const hasHighAuthorityConflict = (
    ["bom", "bill material", "parts list", "spec sheet", "vendor", "manufacturer", "schedule"].some((term) => claimsText.includes(term)) &&
    mismatchedValues.some((value) => !visualProbeValuesMatch(probe.expectedAnswer, value))
  );
  if (!hasHighAuthorityConflict) return null;
  if (!hasProbeFieldSelectingValue(decisionContext, probe, probe.expectedAnswer)) return null;
  return `final estimate context still selects ${String(probe.expectedAnswer)} while higher-authority source evidence carries conflicting value(s): ${mismatchedValues.map(String).join(", ")}. The run should reconcile the sources or carry an explicit assumption.`;
}

function visualProbeAuthorityReconciliation(
  probe: VisualProbeExpectation,
  relatedClaims: Json[],
  matchedSignals: string[],
  mismatchedValues: Array<string | number | boolean>,
  decisionContext: unknown,
) {
  if (probe.expectedAnswer === undefined || relatedClaims.length === 0 || mismatchedValues.length === 0) return null;
  if (visualProbeAuthorityFailureReason(probe, relatedClaims, decisionContext, mismatchedValues)) return null;
  const text = normalizeVisualProbeText(stringifyForSearch({ probe, relatedClaims }));
  const sourceAuthorityTerms = [
    "bom",
    "bill material",
    "parts list",
    "spec sheet",
    "accessories table",
    "vendor",
    "manufacturer",
    "submittal",
    "schedule",
    "quote",
  ];
  const reconciliationTerms = [
    "governing",
    "current",
    "revision",
    "older revision",
    "superseded",
    "conflict",
    "contradiction",
    "another source",
    "also references",
    "basis",
    "carrying",
    "assumption",
  ];
  const hasExpectedSignal = matchedSignals.length > 0;
  const citesAuthority = sourceAuthorityTerms.some((term) => text.includes(term));
  const explainsDecision = reconciliationTerms.some((term) => text.includes(term));
  const hasExplicitOverrideEvidence = [
    "order of precedence",
    "revision history",
    "client confirmed",
    "vendor confirmed",
    "approved submittal",
    "addendum",
    "change order",
    "rfi response",
  ].some((term) => text.includes(term));
  const unsupportedDrawingOverride = (
    text.includes("drawing governs") ||
    text.includes("shop drawing governs") ||
    text.includes("new drawing governs") ||
    text.includes("newer drawing") ||
    text.includes("visual governs") ||
    text.includes("visual count governs") ||
    text.includes("drawing supersedes") ||
    text.includes("shop drawing supersedes") ||
    text.includes("superseded by drawing") ||
    text.includes("superseded by shop drawing") ||
    /drawing.{0,80}(governs|governing|supersedes)/.test(text) ||
    /(governs|governing|superseded by).{0,80}drawing/.test(text) ||
    text.includes("supersedes older spec")
  ) && !hasExplicitOverrideEvidence;
  if (unsupportedDrawingOverride) return null;
  if (!hasExpectedSignal || !citesAuthority || !explainsDecision) return null;
  return `probe value ${String(probe.expectedAnswer)} was seen, but observed claim value(s) ${mismatchedValues.map(String).join(", ")} were tied to a BOM/spec/source-authority decision`;
}

function visualProbeMatchesClaim(probe: VisualProbeExpectation, claim: Json) {
  const text = normalizeVisualProbeText(stringifyForSearch(claim));
  if (!text) return false;

  const stop = new Set(["how", "many", "what", "are", "the", "is", "present", "pages", "support", "from", "same", "documents", "quantity", "count"]);
  const terms = normalizeVisualProbeText(`${probe.id} ${probe.prompt} ${(probe.acceptedSignals || []).join(" ")}`)
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !stop.has(term) && !/^\d+$/.test(term));
  const uniqueTerms = [...new Set(terms)];
  const hits = uniqueTerms.filter((term) => text.includes(term)).length;
  return hits >= Math.min(2, uniqueTerms.length);
}

function analyzeVisualProbes(workspace: Json, expectations: CaseExpectations): VisualProbeMetrics {
  const probes = defaultVisualProbes(workspace, expectations);
  const engine = drawingEngine(workspace);
  const claims = Array.isArray(engine.claims) ? engine.claims : [];
  const searchable = normalizeVisualProbeText(stringifyForSearch({
    claims,
    estimateStrategy: getObject(workspace.estimateStrategy),
    worksheets: workspace.worksheets,
  }));
  const decisionContext = {
    estimateStrategy: stripDrawingEvidenceEngine(workspace.estimateStrategy),
    worksheets: workspace.worksheets,
  };
  const results = probes.map((probe) => {
    const acceptedSignals = [
      ...(probe.acceptedSignals || []),
      ...(typeof probe.expectedAnswer === "string" ? [String(probe.expectedAnswer)] : []),
    ].filter(Boolean);
    const matchedSignals = acceptedSignals.filter((signal) => {
      const normalizedSignal = normalizeVisualProbeText(signal);
      return normalizedSignal.length > 0 && searchable.includes(normalizedSignal);
    });
    const relatedClaims = claims.filter((claim) => visualProbeMatchesClaim(probe, claim));
    const observedValues = relatedClaims
      .map((claim) => visualProbeObservedValue(claim))
      .filter((value) => value !== null && value !== undefined) as Array<string | number | boolean>;

    if (probe.expectedAnswer !== undefined && relatedClaims.length > 0) {
      const matchingValues = observedValues.filter((value) => visualProbeValuesMatch(probe.expectedAnswer!, value));
      const mismatchedValues = observedValues.filter((value) => !visualProbeValuesMatch(probe.expectedAnswer!, value));
      const signalMatchedExpected = visualProbeSignalCarriesExpected(probe, matchedSignals);
      const authorityFailureReason = visualProbeAuthorityFailureReason(probe, relatedClaims as Json[], decisionContext, mismatchedValues);
      if (authorityFailureReason) {
        return {
          id: probe.id,
          prompt: probe.prompt,
          expectedAnswer: probe.expectedAnswer,
          acceptedSignals,
          status: "mismatch" as const,
          matchedSignals: [...matchedSignals, ...matchingValues.map((value) => `claim:${String(value)}`), ...(signalMatchedExpected ? [`signal:${String(probe.expectedAnswer)}`] : [])],
          observedValues,
          mismatchReason: authorityFailureReason,
        };
      }
      const reconciliationReason = mismatchedValues.length > 0
        ? visualProbeAuthorityReconciliation(probe, relatedClaims as Json[], matchedSignals, mismatchedValues, decisionContext)
        : null;
      if ((matchingValues.length > 0 || signalMatchedExpected) && reconciliationReason) {
        return {
          id: probe.id,
          prompt: probe.prompt,
          expectedAnswer: probe.expectedAnswer,
          acceptedSignals,
          status: "reconciled" as const,
          matchedSignals: [...matchedSignals, ...matchingValues.map((value) => `claim:${String(value)}`), ...(signalMatchedExpected ? [`signal:${String(probe.expectedAnswer)}`] : [])],
          observedValues,
          reconciliationReason,
        };
      }
      if (matchingValues.length > 0 || signalMatchedExpected || (typeof probe.expectedAnswer === "string" && matchedSignals.length > 0)) {
        return {
          id: probe.id,
          prompt: probe.prompt,
          expectedAnswer: probe.expectedAnswer,
          acceptedSignals,
          status: "evidenced" as const,
          matchedSignals: [...matchedSignals, ...matchingValues.map((value) => `claim:${String(value)}`), ...(signalMatchedExpected ? [`signal:${String(probe.expectedAnswer)}`] : [])],
          observedValues,
        };
      }
      if (mismatchedValues.length > 0) {
        if (reconciliationReason) {
          return {
            id: probe.id,
            prompt: probe.prompt,
            expectedAnswer: probe.expectedAnswer,
            acceptedSignals,
            status: "reconciled" as const,
            matchedSignals,
            observedValues,
            reconciliationReason,
          };
        }
        return {
          id: probe.id,
          prompt: probe.prompt,
          expectedAnswer: probe.expectedAnswer,
          acceptedSignals,
          status: "mismatch" as const,
          matchedSignals,
          observedValues,
          mismatchReason: `expected ${probe.expectedAnswer}, observed claim value(s) ${mismatchedValues.map(String).join(", ")}`,
        };
      }
    }

    return {
      id: probe.id,
      prompt: probe.prompt,
      expectedAnswer: probe.expectedAnswer,
      acceptedSignals,
      status: matchedSignals.length > 0 ? "evidenced" as const : "not_observed" as const,
      matchedSignals,
    };
  });
  return {
    probeCount: results.length,
    evidenced: results.filter((result) => result.status === "evidenced" || result.status === "reconciled").length,
    results,
  };
}

function analyzeEstimate(workspaceResponse: Json, expectations: CaseExpectations): EstimateMetrics {
  const workspace = getObject(workspaceResponse.workspace) || workspaceResponse;
  const worksheets = Array.isArray(workspace.worksheets) ? workspace.worksheets as Json[] : [];
  const items = worksheets.flatMap((worksheet) => {
    const worksheetItems = worksheet.items;
    return Array.isArray(worksheetItems) ? worksheetItems as Json[] : [];
  });

  const totals = getObject(workspace.estimateTotals) || getObject(getObject(workspace.estimate)?.totals) || getObject(workspace.totals);
  const summaryMetrics = Array.isArray(workspaceResponse.summaryMetrics) ? workspaceResponse.summaryMetrics as Json[] : [];
  const summaryEstimateTotal = summaryMetrics
    .map((metric) => getObject(metric))
    .find((metric) => getString(metric.label).toLowerCase() === "estimate total");
  const totalValue =
    getNumber(totals.calculatedTotal) ??
    getNumber(totals.totalPrice) ??
    getNumber(totals.subtotal) ??
    getNumber(workspace.total) ??
    getNumber(summaryEstimateTotal?.value);

  let pricedItems = 0;
  let zeroValueItems = 0;
  let sourceNotes = 0;
  let evidence = 0;
  let logic = 0;

  for (const item of items) {
    const quantity = getNumber(item.quantity);
    const cost = getNumber(item.cost);
    const price = getNumber(item.price);
    const hasValue = positive(quantity) && (positive(cost) || positive(price));
    if (hasValue) pricedItems += 1;
    if (!positive(price) && !positive(cost)) zeroValueItems += 1;

    const note = getString(item.sourceNotes) || getString(item.basis) || "";
    const sourceEvidence = item.sourceEvidence ?? item.costSnapshot ?? item.rateResolution ?? item.resourceComposition;
    const evidenceText = stringifyForSearch(sourceEvidence);
    if (note.trim().length >= 20) sourceNotes += 1;
    if (evidenceText.length > 4 && evidenceText !== "{}") evidence += 1;
    if (hasValue && (note.trim().length >= 20 || (evidenceText.length > 4 && evidenceText !== "{}"))) logic += 1;
  }

  const searchable = stringifyForSearch(workspaceResponse);
  return {
    worksheets: worksheets.length,
    items: items.length,
    totalValue: typeof totalValue === "number" && Number.isFinite(totalValue) ? round(totalValue, 2) : null,
    pricedItems,
    zeroValueItems,
    sourceNoteCoverage: items.length > 0 ? round(sourceNotes / items.length, 3) : 0,
    costEvidenceCoverage: items.length > 0 ? round(evidence / items.length, 3) : 0,
    logicCoverage: items.length > 0 ? round(logic / items.length, 3) : 0,
    expectedKeywordMissing: missingNeedles(searchable, expectations.expectedEstimateKeywords || expectations.expectedKeywords || []),
    visualAudit: analyzeVisualAudit(workspace),
    visualProbes: analyzeVisualProbes(workspace, expectations),
  };
}

async function analyzeHumanQuoteReferences(
  expectations: CaseExpectations,
  args: Args,
  workspaceResponse: Json,
): Promise<HumanQuoteMetrics | undefined> {
  const referenceInputs = normalizeHumanQuoteReferenceInputs(expectations, args);
  if (referenceInputs.length === 0) return undefined;

  const references = await Promise.all(referenceInputs.map((reference) => extractHumanQuoteReference(reference)));
  const combinedReferenceTotal = sumNullable(references.map((reference) => reference.summaryTotal));
  const workspace = getObject(workspaceResponse.workspace) || workspaceResponse;
  const estimateMetrics = analyzeEstimate(workspaceResponse, expectations);
  const estimateTotal = estimateMetrics.totalValue;
  const totalDelta = typeof combinedReferenceTotal === "number" && typeof estimateTotal === "number"
    ? round(estimateTotal - combinedReferenceTotal, 2)
    : null;
  const totalRatio = typeof combinedReferenceTotal === "number" && combinedReferenceTotal > 0 && typeof estimateTotal === "number"
    ? round(estimateTotal / combinedReferenceTotal, 3)
    : null;

  const signals = uniqueStringsLocal(references.flatMap((reference) => [
    ...reference.scopeSignals,
    ...reference.lineItems.flatMap((item) => [item.name, item.description]),
  ]))
    .map(cleanHumanQuoteSignal)
    .filter((signal) => signal.length >= 4)
    .filter((signal) => !/^(labou?r|material|equipment|subcontractors?|worksheet|fabrication|installation)$/i.test(signal))
    .slice(0, 80);
  const searchable = normalizeTextForComparison(stringifyForSearch(workspaceResponse));
  const matchedSignals = signals.filter((signal) => searchable.includes(normalizeTextForComparison(signal))).slice(0, 40);
  const missingSignals = signals.filter((signal) => !searchable.includes(normalizeTextForComparison(signal))).slice(0, 40);
  const lineItemSignalCoverage = signals.length > 0 ? round(matchedSignals.length / signals.length, 3) : null;

  const humanCategoryTotals = mergeCategoryTotals(references.map((reference) => reference.categoryTotals));
  const agentCategoryTotals = estimateCategoryTotals(workspace);
  const categories = uniqueStringsLocal([...Object.keys(humanCategoryTotals), ...Object.keys(agentCategoryTotals)]);
  const categoryComparison = categories
    .map((category) => {
      const humanReferenceTotal = round(humanCategoryTotals[category] ?? 0, 2);
      const agentEstimateTotal = round(agentCategoryTotals[category] ?? 0, 2);
      return {
        category,
        humanReferenceTotal,
        agentEstimateTotal,
        delta: round(agentEstimateTotal - humanReferenceTotal, 2),
      };
    })
    .filter((entry) => entry.humanReferenceTotal !== 0 || entry.agentEstimateTotal !== 0)
    .sort((left, right) => Math.abs(right.humanReferenceTotal || right.agentEstimateTotal) - Math.abs(left.humanReferenceTotal || left.agentEstimateTotal));

  return {
    referenceCount: references.length,
    references,
    combinedReferenceTotal,
    estimateTotal,
    totalDelta,
    totalRatio,
    lineItemSignalCoverage,
    matchedSignals,
    missingSignals,
    categoryComparison,
    note: "Human awarded-job quotes are calibration references, not deterministic gates or a target quality ceiling.",
  };
}

function normalizeHumanQuoteReferenceInputs(expectations: CaseExpectations, args: Args): HumanQuoteReferenceInput[] {
  const fromSidecar = expectations.humanQuoteReferences ?? [];
  const fromCli = args.humanQuotePaths.map((quotePath) => ({ path: quotePath }));
  return [...fromSidecar, ...fromCli]
    .map((reference) => ({
      ...reference,
      path: path.isAbsolute(reference.path) ? reference.path : path.resolve(reference.path),
    }))
    .filter((reference) => reference.path);
}

async function extractHumanQuoteReference(input: HumanQuoteReferenceInput): Promise<HumanQuoteReferenceMetrics> {
  const filePath = path.resolve(input.path);
  const label = input.label || path.basename(filePath, path.extname(filePath));
  try {
    const [text, pageCount] = await Promise.all([
      extractPdfText(filePath),
      pdfPageCount(filePath),
    ]);
    const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+$/g, ""));
    const lineItems = parseHumanQuoteLineItems(lines);
    const categoryTotals: Record<string, number> = {};
    for (const item of lineItems) {
      if (typeof item.price !== "number") continue;
      const key = normalizeHumanCategory(item.category);
      categoryTotals[key] = round((categoryTotals[key] ?? 0) + item.price, 2);
    }

    return {
      path: filePath,
      label,
      role: input.role || inferHumanQuoteRole(label, text),
      awarded: input.awarded !== false,
      notes: input.notes || "",
      quoteNumber: firstMatch(text, /QUOTE\s*#:\s*([A-Z0-9-]+)/i),
      title: inferHumanQuoteTitle(lines),
      pageCount,
      worksheetTotal: parseHumanQuoteMoneyLine(lines, /WORKSHEET\s+TOTAL/i),
      summaryTotal: parseHumanQuoteMoneyLine(lines, /^\s*TOTAL\s+/i),
      lineItemCount: lineItems.length,
      categoryTotals,
      scopeSignals: extractHumanQuoteScopeSignals(lines),
      lineItems,
    };
  } catch (error) {
    return {
      path: filePath,
      label,
      role: input.role || inferHumanQuoteRole(label, ""),
      awarded: input.awarded !== false,
      notes: input.notes || "",
      quoteNumber: null,
      title: null,
      pageCount: null,
      worksheetTotal: null,
      summaryTotal: null,
      lineItemCount: 0,
      categoryTotals: {},
      scopeSignals: [],
      lineItems: [],
      extractionError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function extractPdfText(filePath: string) {
  if (filePath.toLowerCase().endsWith(".txt")) return readFile(filePath, "utf8");
  const result = await execFileAsync("pdftotext", ["-layout", filePath, "-"], {
    maxBuffer: 20 * 1024 * 1024,
  });
  return result.stdout;
}

async function pdfPageCount(filePath: string) {
  if (!filePath.toLowerCase().endsWith(".pdf")) return null;
  try {
    const result = await execFileAsync("pdfinfo", [filePath], { maxBuffer: 1024 * 1024 });
    const match = result.stdout.match(/^Pages:\s*(\d+)/mi);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function parseHumanQuoteLineItems(lines: string[]): HumanQuoteLineItem[] {
  const detailsIndex = lines.findIndex((line) => /LINE\s+ITEM\s+DETAILS/i.test(line));
  const endIndex = lines.findIndex((line, index) => index > detailsIndex && /WORKSHEET\s+TOTAL/i.test(line));
  const slice = detailsIndex >= 0
    ? lines.slice(detailsIndex + 1, endIndex > detailsIndex ? endIndex : undefined)
    : lines;
  const items: HumanQuoteLineItem[] = [];
  for (const line of slice) {
    const item = parseHumanQuoteLineItem(line);
    if (item) items.push(item);
  }
  return items;
}

function parseHumanQuoteLineItem(line: string): HumanQuoteLineItem | null {
  const categoryMatch = line.match(/^\s*(Labou?r|Material|Equipment|Subcontractors?|Subcontractor|Rental|General Conditions)\b/i);
  if (!categoryMatch) return null;
  const priceMatch = line.match(/(\$?\s*[\d,]+\.\d{2})\s*$/);
  if (!priceMatch) return null;
  const beforePrice = line.slice(0, priceMatch.index).trimEnd();
  const numericMatch = beforePrice.match(/^(.*?)\s+([.,\d]+)\s+([.,\d]+)\s+([.,\d]+)\s+([.,\d]+)\s*$/);
  if (!numericMatch) return null;
  const category = normalizeHumanCategory(categoryMatch[1]);
  const textPart = numericMatch[1].replace(categoryMatch[0], "").trim();
  const textColumns = textPart.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
  const name = textColumns[0] && !textColumns[0].startsWith("-") ? textColumns[0] : "";
  const description = textColumns.length > 1
    ? textColumns.slice(1).join(" - ")
    : textColumns[0]?.startsWith("-")
      ? textColumns[0].replace(/^-\s*/, "")
      : "";

  return {
    category,
    name,
    description,
    quantity: parseLooseNumber(numericMatch[2]),
    duration: parseLooseNumber(numericMatch[3]),
    overtime1_5: parseLooseNumber(numericMatch[4]),
    overtime2: parseLooseNumber(numericMatch[5]),
    price: parseMoney(priceMatch[1]),
    raw: line.trim(),
  };
}

function inferHumanQuoteTitle(lines: string[]) {
  return lines
    .map((line) => line.trim())
    .find((line) => /project/i.test(line) && line.length < 120) || null;
}

function inferHumanQuoteRole(label: string, text: string) {
  const labelText = label.toLowerCase();
  if (labelText.includes("installation")) return "installation";
  if (labelText.includes("fabrication")) return "fabrication";
  const haystack = text.toLowerCase();
  if (haystack.includes("installation")) return "installation";
  if (haystack.includes("fabrication")) return "fabrication";
  return "awarded_reference";
}

function parseHumanQuoteMoneyLine(lines: string[], pattern: RegExp) {
  const values = lines
    .filter((line) => pattern.test(line))
    .map((line) => parseMoney(line))
    .filter((value): value is number => typeof value === "number");
  return values.length ? values[values.length - 1] : null;
}

function extractHumanQuoteScopeSignals(lines: string[]) {
  const detailsIndex = lines.findIndex((line) => /LINE\s+ITEM\s+DETAILS/i.test(line));
  const headerLines = lines.slice(0, detailsIndex > 0 ? detailsIndex : Math.min(lines.length, 120));
  return uniqueStringsLocal(headerLines
    .map((line) => line.trim())
    .filter((line) => line.length >= 8 && line.length <= 180)
    .filter((line) => /(^|\b)(install|receive|unload|rig|fabricate|hydro|disconnect|remove|dispose|support|piping|pump|vessel|heat exchanger|structural|penetrations?|valves?|instrumentation)\b/i.test(line))
    .map(cleanHumanQuoteSignal))
    .slice(0, 40);
}

function cleanHumanQuoteSignal(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[-•]\s*/, "")
    .replace(/^qty\.?\s*/i, "")
    .trim();
}

function firstMatch(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  return match?.[1]?.trim() || null;
}

function parseMoney(value: unknown) {
  const text = String(value ?? "");
  const matches = [...text.matchAll(/\$?\s*([\d,]+\.\d{2})/g)];
  const last = matches.at(-1)?.[1];
  return last ? Number(last.replace(/,/g, "")) : null;
}

function money(value: number) {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function maybeMoney(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? money(value) : "n/a";
}

function parseLooseNumber(value: unknown) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return null;
  const normalized = text.startsWith(".") ? `0${text}` : text;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeHumanCategory(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  if (/labou?r/.test(text)) return "Labour";
  if (/subcontract/.test(text)) return "Subcontractor";
  if (/equip|rental/.test(text)) return "Equipment";
  if (/material/.test(text)) return "Material";
  if (/general/.test(text)) return "General Conditions";
  return text ? text[0].toUpperCase() + text.slice(1) : "Uncategorized";
}

function sumNullable(values: Array<number | null>) {
  const numeric = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return numeric.length ? round(numeric.reduce((sum, value) => sum + value, 0), 2) : null;
}

function normalizeTextForComparison(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function uniqueStringsLocal(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function mergeCategoryTotals(totals: Array<Record<string, number>>) {
  const merged: Record<string, number> = {};
  for (const entry of totals) {
    for (const [category, value] of Object.entries(entry)) {
      merged[category] = round((merged[category] ?? 0) + value, 2);
    }
  }
  return merged;
}

function estimateCategoryTotals(workspace: Json) {
  const worksheets = Array.isArray(workspace.worksheets) ? workspace.worksheets as Json[] : [];
  const items = worksheets.flatMap((worksheet) => Array.isArray(worksheet.items) ? worksheet.items as Json[] : []);
  const totals: Record<string, number> = {};
  for (const item of items) {
    const category = normalizeHumanCategory(getString(item.category) || getString(item.entityType) || "Uncategorized");
    const quantity = getNumber(item.quantity) ?? 1;
    const unitCost = getNumber(item.cost);
    const itemTotal = getNumber(item.totalPrice)
      ?? getNumber(item.extendedPrice)
      ?? getNumber(item.price)
      ?? (typeof unitCost === "number" && typeof quantity === "number" ? unitCost * quantity : null);
    if (typeof itemTotal !== "number" || !Number.isFinite(itemTotal)) continue;
    totals[category] = round((totals[category] ?? 0) + itemTotal, 2);
  }
  return totals;
}

function buildHumanQuoteFindings(metrics?: HumanQuoteMetrics) {
  if (!metrics || metrics.referenceCount === 0) return [];
  const findings: string[] = [];
  const failed = metrics.references.filter((reference) => reference.extractionError);
  if (failed.length > 0) {
    findings.push(`Human reference quote extraction failed for ${failed.map((reference) => reference.label).join(", ")}.`);
  }
  if (typeof metrics.totalRatio === "number") {
    const delta = metrics.totalDelta !== null ? money(metrics.totalDelta) : "unknown delta";
    findings.push(`Human awarded-reference total comparison: agent/reference ratio ${metrics.totalRatio} (${delta}); calibration signal only, not a gate.`);
  }
  if (typeof metrics.lineItemSignalCoverage === "number" && metrics.lineItemSignalCoverage < 0.45) {
    findings.push(`Human quote scope signal coverage is low: ${Math.round(metrics.lineItemSignalCoverage * 100)}% of awarded-reference line/scope signals appear in the agent estimate.`);
  }
  return findings;
}

function buildRunFindings(
  kind: "intake" | "question",
  status: CliStatus,
  toolMetrics: ToolMetrics,
  reasoningMetrics: ReasoningMetrics,
  stageMetrics: StageMetrics,
  journeyMetrics: EstimatorJourneyMetrics,
) {
  const findings: string[] = [];
  if (status.status !== "completed") findings.push(`Agent run ended with status ${status.status || "unknown"}.`);
  if (toolMetrics.failedResults > 0) findings.push(`${toolMetrics.failedResults} tool result(s) failed.`);
  if (toolMetrics.unmatchedCalls > 0) findings.push(`${toolMetrics.unmatchedCalls} tool call(s) did not have a matched result event.`);
  if (toolMetrics.requiredMissing.length > 0) findings.push(`Missing required tool(s): ${toolMetrics.requiredMissing.join(", ")}.`);
  if (kind === "intake" && stageMetrics.missingCriticalStages.length > 0) {
    findings.push(`Missing staged estimate save(s): ${stageMetrics.missingCriticalStages.join(", ")}.`);
  }
  if (toolMetrics.totalCalls < (kind === "intake" ? 20 : 2)) {
    findings.push(`Tool usage looks shallow: only ${toolMetrics.totalCalls} call(s).`);
  }
  if (kind === "intake" && reasoningMetrics.thinkingChars < 300) {
    findings.push(`Reasoning telemetry looks thin: ${reasoningMetrics.thinkingChars} thinking character(s).`);
  }
  for (const behavior of journeyMetrics.missingHumanBehaviors) {
    findings.push(`Estimator journey gap: ${behavior}`);
  }
  return findings;
}

function buildCaseFindings(
  ingestion: IngestionStatus | undefined,
  documentMetrics: DocumentMetrics,
  estimateMetrics: EstimateMetrics,
  runs: RunReport[],
  expectations: CaseExpectations,
) {
  const findings: string[] = [];
  const status = String(ingestion?.status || "unknown").toLowerCase();
  if (FAILED_INGESTION_STATUSES.has(status) || documentMetrics.failed > 0) {
    findings.push(`Ingestion failed for ${documentMetrics.failed} document(s).`);
  }
  if (documentMetrics.pending > 0) findings.push(`${documentMetrics.pending} document(s) still pending after ingestion wait.`);
  if (documentMetrics.total > 0 && documentMetrics.extracted === 0) findings.push("No extracted documents were available to the agent.");
  const hasIntakeRun = runs.some((run) => run.kind === "intake");
  const hasDocumentInventory = runs.some((run) => (run.journeyMetrics.phases.document_inventory?.hits ?? 0) > 0);
  if (documentMetrics.readToolCalls === 0 && hasIntakeRun) findings.push("Agent did not call any document read tool.");
  if (!hasIntakeRun && documentMetrics.readToolCalls === 0 && !hasDocumentInventory) {
    findings.push("Question run did not call a document reader or document inventory tool.");
  }
  if (hasIntakeRun && documentMetrics.readCoverage !== null && documentMetrics.readCoverage < (expectations.thresholds?.minDocumentReadCoverage ?? 0.35)) {
    findings.push(`Document read coverage is low: ${Math.round(documentMetrics.readCoverage * 100)}%.`);
  }
  if (documentMetrics.expectedMissing.length > 0) {
    findings.push(`Expected document name signal(s) missing: ${documentMetrics.expectedMissing.join(", ")}.`);
  }

  if (hasIntakeRun) {
    if (estimateMetrics.worksheets === 0) findings.push("No worksheets were created.");
    if (estimateMetrics.items === 0) findings.push("No worksheet items were created.");
    if (!positive(estimateMetrics.totalValue)) findings.push("Estimate total is empty or zero.");
    if (estimateMetrics.items > 0 && estimateMetrics.logicCoverage < 0.5) {
      findings.push(`Only ${Math.round(estimateMetrics.logicCoverage * 100)}% of line items have visible pricing logic/evidence.`);
    }
    if (estimateMetrics.expectedKeywordMissing.length > 0) {
      findings.push(`Expected estimate keyword(s) missing: ${estimateMetrics.expectedKeywordMissing.join(", ")}.`);
    }
    if (!estimateMetrics.visualAudit.atlasStatus && estimateMetrics.visualAudit.drawingDrivenPackages > 0) {
      findings.push("Drawing-driven packages exist but the Drawing Evidence Engine atlas is missing.");
    }
    if (estimateMetrics.visualAudit.packagesMissingLedgerClaims.length > 0) {
      findings.push(`Drawing evidence ledger claims are missing for: ${estimateMetrics.visualAudit.packagesMissingLedgerClaims.map((item) => item.packageName || item.packageId || "unnamed package").join(", ")}.`);
    }
    if (estimateMetrics.visualAudit.unresolvedContradictions > 0) {
      findings.push(`Drawing evidence ledger has ${estimateMetrics.visualAudit.unresolvedContradictions} unresolved contradiction(s).`);
    }
    if (estimateMetrics.visualAudit.evidenceClaims > 0 && estimateMetrics.visualAudit.verifierStatus !== "passed" && estimateMetrics.visualAudit.verifierStatus !== "warning") {
      findings.push(`Drawing evidence verifier status is ${estimateMetrics.visualAudit.verifierStatus || "missing"}.`);
    }
    const mismatchedProbeResults = estimateMetrics.visualProbes.results.filter((probe) => probe.status === "mismatch");
    if (mismatchedProbeResults.length > 0) {
      findings.push(`Visual QA probe mismatch(es): ${mismatchedProbeResults.map((probe) => `${probe.id} (${probe.mismatchReason || "mismatch"})`).join(", ")}.`);
    }
    const missingProbeResults = estimateMetrics.visualProbes.results.filter((probe) => probe.status === "not_observed");
    if (estimateMetrics.visualProbes.probeCount > 0 && missingProbeResults.length > 0) {
      findings.push(`Visual QA probe signal(s) not evidenced: ${missingProbeResults.map((probe) => probe.id).join(", ")}.`);
    }
    if (estimateMetrics.visualAudit.packagesMissingActualRender.length > 0) {
      findings.push(`Visual audit page evidence does not match recorded atlas/render evidence for: ${estimateMetrics.visualAudit.packagesMissingActualRender.map((item) => item.packageName || item.packageId || "unnamed package").join(", ")}.`);
    }
    if (estimateMetrics.visualAudit.fullPageZoomEvidence.length > 0) {
      findings.push(`Visual audit includes full-page or missing-region zoom evidence for: ${estimateMetrics.visualAudit.fullPageZoomEvidence.map((item) => item.packageName || item.packageId || "unnamed package").join(", ")}.`);
    }
    if (estimateMetrics.visualAudit.packagesMissingActualZoom.length > 0) {
      findings.push(`Visual audit crop evidence does not match recorded inspected/zoomed regions for: ${estimateMetrics.visualAudit.packagesMissingActualZoom.map((item) => item.packageName || item.packageId || "unnamed package").join(", ")}.`);
    }
  }

  for (const run of runs) findings.push(...run.findings.map((finding) => `${run.label}: ${finding}`));
  return [...new Set(findings)];
}

function scoreCase(input: {
  ingestion?: IngestionStatus;
  runs: RunReport[];
  documentMetrics: DocumentMetrics;
  estimateMetrics: EstimateMetrics;
  findings: string[];
  thresholds?: EvalThresholds;
}): QualityScore {
  const thresholds = {
    minToolCalls: 25,
    minThinkingChars: 300,
    minDocumentReadCoverage: 0.35,
    minWorksheetItems: 1,
    minSourceNoteCoverage: 0.5,
    maxToolFailures: 0,
    ...input.thresholds,
  };
  const intake = input.runs.find((run) => run.kind === "intake") || input.runs[0];
  const allFailedToolResults = input.runs.reduce((sum, run) => sum + run.toolMetrics.failedResults, 0);
  const allToolCalls = input.runs.reduce((sum, run) => sum + run.toolMetrics.totalCalls, 0);
  const allThinkingChars = input.runs.reduce((sum, run) => sum + run.reasoningMetrics.thinkingChars, 0);
  const hasIntakeRun = input.runs.some((run) => run.kind === "intake");
  const hasDocumentInventory = input.runs.some((run) => (run.journeyMetrics.phases.document_inventory?.hits ?? 0) > 0);

  const ingestionReady = input.documentMetrics.pending === 0 && input.documentMetrics.failed === 0 && input.documentMetrics.extracted > 0;
  const runCompleted = input.runs.every((run) => run.status === "completed");
  const toolHealth = allFailedToolResults <= thresholds.maxToolFailures
    ? 1
    : Math.max(0, 1 - allFailedToolResults / Math.max(1, allFailedToolResults + 3));
  const toolDepthTarget = hasIntakeRun ? thresholds.minToolCalls : Math.min(thresholds.minToolCalls, 3);
  const toolDepth = Math.min(1, allToolCalls / Math.max(1, toolDepthTarget));
  const reasoningDepth = hasIntakeRun
    ? Math.min(1, allThinkingChars / Math.max(1, thresholds.minThinkingChars))
    : 1;
  const stageCoverage = !hasIntakeRun ? 1 : (
    intake?.stageMetrics
      ? 1 - (intake.stageMetrics.missingCriticalStages.length / 6)
      : 0
  );
  const documentCoverage = !hasIntakeRun && hasDocumentInventory
    ? 1
    : input.documentMetrics.readCoverage === null
    ? 0
    : Math.min(1, input.documentMetrics.readCoverage / Math.max(0.01, thresholds.minDocumentReadCoverage));
  const estimateCompleteness = hasIntakeRun
    ? Math.min(1, input.estimateMetrics.items / Math.max(1, thresholds.minWorksheetItems))
    : 1;
  const evidenceQuality = hasIntakeRun
    ? Math.min(1, input.estimateMetrics.logicCoverage / Math.max(0.01, thresholds.minSourceNoteCoverage))
    : 1;

  const bands = {
    ingestion: ingestionReady ? 10 : 0,
    completion: runCompleted ? 15 : 0,
    toolHealth: round(toolHealth * 15, 1),
    toolDepth: round(toolDepth * 10, 1),
    reasoning: round(reasoningDepth * 10, 1),
    stagedWorkflow: round(Math.max(0, stageCoverage) * 15, 1),
    documentCoverage: round(documentCoverage * 10, 1),
    estimateCompleteness: round(estimateCompleteness * 10, 1),
    evidenceQuality: round(evidenceQuality * 5, 1),
  };

  const score = Math.max(0, Math.min(100, round(Object.values(bands).reduce((sum, value) => sum + value, 0), 1)));
  const hardFail =
    !runCompleted ||
    allFailedToolResults > thresholds.maxToolFailures ||
    input.estimateMetrics.visualAudit.packagesMissingLedgerClaims.length > 0 ||
    input.estimateMetrics.visualAudit.unresolvedContradictions > 0 ||
    input.estimateMetrics.visualAudit.verifierStatus === "failed" ||
    input.estimateMetrics.visualAudit.packagesMissingActualZoom.length > 0 ||
    input.estimateMetrics.visualAudit.fullPageZoomEvidence.length > 0 ||
    input.findings.some((finding) => /No worksheet items|No extracted documents|Ingestion failed/i.test(finding));
  const grade: QualityScore["grade"] = hardFail || score < 60 ? "fail" : score < 85 || input.findings.length > 0 ? "needs_review" : "pass";
  return { score, grade, bands };
}

async function persistCaseReport(report: CaseReport, outDir: string, workspace?: Json) {
  const caseDir = path.join(outDir, report.caseId);
  await mkdir(caseDir, { recursive: true });
  const jsonPath = path.join(caseDir, "report.json");
  const markdownPath = path.join(caseDir, "report.md");
  const workspacePath = workspace ? path.join(caseDir, "workspace.json") : undefined;
  report.artifacts = {
    json: jsonPath,
    markdown: markdownPath,
    workspace: workspacePath,
    observer: report.artifacts.observer || path.join(caseDir, "observer.md"),
    events: report.artifacts.events || path.join(caseDir, "events.ndjson"),
    liveState: report.artifacts.liveState || path.join(caseDir, "live-state.json"),
  };
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await writeFile(markdownPath, renderCaseMarkdown(report), "utf8");
  if (workspacePath && workspace) await writeFile(workspacePath, JSON.stringify(workspace, null, 2), "utf8");
}

async function writeAggregateReport(outDir: string, reports: CaseReport[]) {
  const summary = {
    generatedAt: new Date().toISOString(),
    caseCount: reports.length,
    pass: reports.filter((report) => report.quality.grade === "pass").length,
    needsReview: reports.filter((report) => report.quality.grade === "needs_review").length,
    fail: reports.filter((report) => report.quality.grade === "fail").length,
    averageScore: reports.length ? round(reports.reduce((sum, report) => sum + report.quality.score, 0) / reports.length, 1) : 0,
    cases: reports.map((report) => ({
      caseId: report.caseId,
      name: report.name,
      grade: report.quality.grade,
      score: report.quality.score,
      projectId: report.projectId,
      humanReference: report.humanQuoteMetrics ? {
        referenceCount: report.humanQuoteMetrics.referenceCount,
        combinedReferenceTotal: report.humanQuoteMetrics.combinedReferenceTotal,
        estimateTotal: report.humanQuoteMetrics.estimateTotal,
        totalDelta: report.humanQuoteMetrics.totalDelta,
        totalRatio: report.humanQuoteMetrics.totalRatio,
        lineItemSignalCoverage: report.humanQuoteMetrics.lineItemSignalCoverage,
      } : undefined,
      findings: report.findings,
      report: report.artifacts.markdown,
    })),
  };
  await writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeFile(path.join(outDir, "summary.md"), renderSummaryMarkdown(reports), "utf8");
  await writeFile(path.join(outDir, "relentless-loop.md"), renderRelentlessLoopMarkdown(reports), "utf8");
}

function renderSummaryMarkdown(reports: CaseReport[]) {
  const lines = [
    "# Bidwright Agent Eval Summary",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Case | Telemetry | Score | Human Ref | Project | Findings |",
    "| --- | --- | ---: | --- | --- | --- |",
  ];
  for (const report of reports) {
    const human = report.humanQuoteMetrics
      ? `ratio ${report.humanQuoteMetrics.totalRatio ?? "n/a"}, delta ${maybeMoney(report.humanQuoteMetrics.totalDelta)}`
      : "n/a";
    lines.push(`| ${escapeMd(report.name)} | ${report.quality.grade} | ${report.quality.score} | ${escapeMd(human)} | ${report.projectId || ""} | ${escapeMd(report.findings.slice(0, 3).join("; ") || "None")} |`);
  }
  lines.push("", "## Tool Coverage", "");
  for (const report of reports) {
    const intake = report.runs.find((run) => run.kind === "intake") || report.runs[0];
    lines.push(`### ${report.name}`);
    lines.push("");
    lines.push(`- Total calls: ${intake?.toolMetrics.totalCalls ?? 0}`);
    lines.push(`- Failed results: ${intake?.toolMetrics.failedResults ?? 0}`);
    lines.push(`- Missing required: ${intake?.toolMetrics.requiredMissing.join(", ") || "None"}`);
    lines.push(`- Missing expected: ${intake?.toolMetrics.expectedMissing.join(", ") || "None"}`);
    lines.push(`- Estimator journey: ${intake?.journeyMetrics.phaseOrder.join(" -> ") || "None"}`);
    lines.push(`- Native visual drawing image inspections: ${intake?.journeyMetrics.actualVisualDrawingSignals ?? 0}`);
    lines.push(`- Drawing visual breakdown: renders=${intake?.journeyMetrics.renderedDrawingPages ?? 0}, zooms=${intake?.journeyMetrics.zoomedDrawingRegions ?? 0}, symbolScans=${intake?.journeyMetrics.symbolScans ?? 0}, symbolCounts=${intake?.journeyMetrics.symbolCounts ?? 0}`);
    lines.push(`- Drawing Evidence Engine: atlas=${report.estimateMetrics.visualAudit.atlasStatus || "missing"}, regions=${report.estimateMetrics.visualAudit.atlasRegions}, atlasRequests=${report.estimateMetrics.visualAudit.atlasDocumentRequests}, promotedDocs=${report.estimateMetrics.visualAudit.promotedDocuments}, Provider=${report.estimateMetrics.visualAudit.providerRegions}, CAD=${report.estimateMetrics.visualAudit.cadNativeRegions}, models=${report.estimateMetrics.visualAudit.modelNativeRegions}, claims=${report.estimateMetrics.visualAudit.evidenceClaims}, verifier=${report.estimateMetrics.visualAudit.verifierStatus || "missing"}`);
    lines.push(`- Visual probes: ${report.estimateMetrics.visualProbes.evidenced}/${report.estimateMetrics.visualProbes.probeCount} evidenced`);
    lines.push(`- Journey gaps: ${intake?.journeyMetrics.missingHumanBehaviors.join(" ") || "None"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function renderRelentlessLoopMarkdown(reports: CaseReport[]) {
  const groups = new Map<string, CaseReport[]>();
  for (const report of reports) {
    const key = report.baseCaseId || report.caseId;
    groups.set(key, [...(groups.get(key) || []), report]);
  }

  const lines = [
    "# Relentless Local Loop Review",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "This file is a reviewer notebook for repeated local runs. It highlights stability, repeated journey gaps, and places where Codex should inspect observer.md before changing orchestration.",
    "",
  ];

  for (const [groupId, groupReports] of groups.entries()) {
    const first = groupReports[0];
    const scores = groupReports.map((report) => report.quality.score);
    const totals = groupReports.map((report) => report.estimateMetrics.totalValue).filter((value): value is number => typeof value === "number");
    const humanRatios = groupReports
      .map((report) => report.humanQuoteMetrics?.totalRatio)
      .filter((value): value is number => typeof value === "number");
    const humanSignalCoverage = groupReports
      .map((report) => report.humanQuoteMetrics?.lineItemSignalCoverage)
      .filter((value): value is number => typeof value === "number");
    const findings = countStrings(groupReports.flatMap((report) => report.findings));
    const phaseOrders = countStrings(groupReports.map((report) => {
      const intake = report.runs.find((run) => run.kind === "intake") || report.runs[0];
      return intake?.journeyMetrics.phaseOrder.join(" -> ") || "no journey";
    }));
    const journeyGaps = countStrings(groupReports.flatMap((report) => report.runs.flatMap((run) => run.journeyMetrics.missingHumanBehaviors)));

    lines.push(`## ${first.name}`);
    lines.push("");
    lines.push(`Group ID: ${groupId}`);
    lines.push(`Runs: ${groupReports.length}`);
    lines.push(`Score telemetry: avg ${average(scores)}, min ${Math.min(...scores)}, max ${Math.max(...scores)}`);
    lines.push(`Estimate totals: ${totals.length ? `avg ${average(totals)}, min ${Math.min(...totals)}, max ${Math.max(...totals)}` : "none"}`);
    if (humanRatios.length > 0) {
      lines.push(`Human awarded-reference ratio: avg ${average(humanRatios)}, min ${Math.min(...humanRatios)}, max ${Math.max(...humanRatios)}`);
      lines.push(`Human awarded-reference signal coverage: avg ${Math.round(average(humanSignalCoverage) * 100)}%`);
    }
    lines.push("");
    lines.push("### Repeated Journey Shapes");
    lines.push("");
    for (const [shape, count] of Object.entries(phaseOrders).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      lines.push(`- ${count}x ${shape}`);
    }
    lines.push("");
    lines.push("### Recurring Journey Gaps");
    lines.push("");
    const gapEntries = Object.entries(journeyGaps).sort((a, b) => b[1] - a[1]);
    lines.push(...(gapEntries.length ? gapEntries.map(([gap, count]) => `- ${count}x ${gap}`) : ["- None"]));
    lines.push("");
    lines.push("### Recurring Findings");
    lines.push("");
    const findingEntries = Object.entries(findings).sort((a, b) => b[1] - a[1]);
    lines.push(...(findingEntries.length ? findingEntries.slice(0, 15).map(([finding, count]) => `- ${count}x ${finding}`) : ["- None"]));
    lines.push("");
    lines.push("### Observer Artifacts");
    lines.push("");
    for (const report of groupReports) {
      const label = report.iteration ? `iteration ${report.iteration}` : report.caseId;
      lines.push(`- ${label}: ${report.artifacts.observer || report.artifacts.markdown}`);
    }
    lines.push("");
    lines.push("### Codex Review Prompt");
    lines.push("");
    lines.push("- Compare the highest- and lowest-quality observer traces side by side.");
    lines.push("- Identify the first point where the agent stopped behaving like an estimator.");
    lines.push("- Patch prompts/tool contracts/orchestration only after the failure pattern repeats or is severe.");
    lines.push("- Rerun this same group until the journey shape stabilizes around deep document/drawing/reference/takeoff/reconcile loops.");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function renderHumanQuoteCalibration(metrics?: HumanQuoteMetrics) {
  if (!metrics || metrics.referenceCount === 0) return [];
  const lines = [
    "## Human Awarded Quote Calibration",
    "",
    metrics.note,
    "",
    `- Reference total: ${maybeMoney(metrics.combinedReferenceTotal)}`,
    `- Agent estimate total: ${maybeMoney(metrics.estimateTotal)}`,
    `- Delta: ${maybeMoney(metrics.totalDelta)}`,
    `- Agent/reference ratio: ${metrics.totalRatio ?? "n/a"}`,
    `- Awarded quote scope signal coverage: ${metrics.lineItemSignalCoverage === null ? "n/a" : `${Math.round(metrics.lineItemSignalCoverage * 100)}%`}`,
    "",
    "| Reference | Role | Quote # | Pages | Worksheet | Total | Lines | Status |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const reference of metrics.references) {
    lines.push([
      escapeMd(reference.label),
      escapeMd(reference.role),
      escapeMd(reference.quoteNumber || ""),
      reference.pageCount ?? "",
      maybeMoney(reference.worksheetTotal),
      maybeMoney(reference.summaryTotal),
      reference.lineItemCount,
      escapeMd(reference.extractionError || (reference.awarded ? "awarded/completed" : "reference")),
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  lines.push("");
  lines.push("### Human Quote Category Comparison");
  lines.push("");
  lines.push("| Category | Human Ref | Agent Estimate | Delta |");
  lines.push("| --- | ---: | ---: | ---: |");
  const categoryRows = metrics.categoryComparison.slice(0, 12);
  lines.push(...(categoryRows.length
    ? categoryRows.map((entry) => `| ${escapeMd(entry.category)} | ${money(entry.humanReferenceTotal)} | ${money(entry.agentEstimateTotal)} | ${money(entry.delta)} |`)
    : ["| None | n/a | n/a | n/a |"]));

  lines.push("");
  lines.push("### Awarded Quote Signal Coverage");
  lines.push("");
  lines.push(`Matched signals: ${metrics.matchedSignals.slice(0, 12).map(escapeMd).join("; ") || "None"}`);
  lines.push("");
  lines.push(`Missing signals: ${metrics.missingSignals.slice(0, 12).map(escapeMd).join("; ") || "None"}`);
  lines.push("");
  return lines;
}

function renderCaseMarkdown(report: CaseReport) {
  const lines = [
    `# ${report.name}`,
    "",
    `Telemetry signal: **${report.quality.grade}** (${report.quality.score}/100)`,
    "",
    `Project: ${report.projectId || "unknown"}`,
    `Package SHA-256: \`${report.zipSha256}\``,
    `Duration: ${report.durationSeconds}s`,
    `Live observer: ${report.artifacts.observer || "not captured"}`,
    `Event stream: ${report.artifacts.events || "not captured"}`,
    "",
    "## Findings",
    "",
    ...(report.findings.length ? report.findings.map((finding) => `- ${finding}`) : ["- None"]),
    "",
    "## Score Bands",
    "",
    "| Band | Points |",
    "| --- | ---: |",
    ...Object.entries(report.quality.bands).map(([band, value]) => `| ${band} | ${value} |`),
    "",
    "## Ingestion",
    "",
    `- Status: ${report.ingestion.status}`,
    `- Documents: ${report.documentMetrics.extracted}/${report.documentMetrics.total} extracted, ${report.documentMetrics.pending} pending, ${report.documentMetrics.failed} failed`,
    `- Read coverage: ${report.documentMetrics.readCoverage === null ? "n/a" : `${Math.round(report.documentMetrics.readCoverage * 100)}%`}`,
    `- Read tools: ${report.documentMetrics.readToolCalls}`,
    "",
    "## Estimate",
    "",
    `- Worksheets: ${report.estimateMetrics.worksheets}`,
    `- Items: ${report.estimateMetrics.items}`,
    `- Total: ${report.estimateMetrics.totalValue ?? "unknown"}`,
    `- Pricing logic coverage: ${Math.round(report.estimateMetrics.logicCoverage * 100)}%`,
    `- Source note coverage: ${Math.round(report.estimateMetrics.sourceNoteCoverage * 100)}%`,
    `- Visual audit packages: ${report.estimateMetrics.visualAudit.drawingDrivenPackages}`,
    `- Actual visual calls: renders=${report.estimateMetrics.visualAudit.actualRenderedPages}, zooms=${report.estimateMetrics.visualAudit.actualZoomRegions}`,
    `- Drawing Evidence Engine: atlas=${report.estimateMetrics.visualAudit.atlasStatus || "missing"}, regions=${report.estimateMetrics.visualAudit.atlasRegions}, atlasRequests=${report.estimateMetrics.visualAudit.atlasDocumentRequests}, promotedDocs=${report.estimateMetrics.visualAudit.promotedDocuments}, Provider=${report.estimateMetrics.visualAudit.providerRegions}, CAD=${report.estimateMetrics.visualAudit.cadNativeRegions}, models=${report.estimateMetrics.visualAudit.modelNativeRegions}, claims=${report.estimateMetrics.visualAudit.evidenceClaims}, verifier=${report.estimateMetrics.visualAudit.verifierStatus || "missing"}, contradictions=${report.estimateMetrics.visualAudit.unresolvedContradictions}`,
    `- Ledger claim gaps: ${report.estimateMetrics.visualAudit.packagesMissingLedgerClaims.length}`,
    `- Visual audit mismatches: render=${report.estimateMetrics.visualAudit.packagesMissingActualRender.length}, fullPageZoom=${report.estimateMetrics.visualAudit.fullPageZoomEvidence.length}, unmatchedZoom=${report.estimateMetrics.visualAudit.packagesMissingActualZoom.length}`,
    `- Visual QA probes: ${report.estimateMetrics.visualProbes.evidenced}/${report.estimateMetrics.visualProbes.probeCount} evidenced`,
    "",
    ...renderHumanQuoteCalibration(report.humanQuoteMetrics),
    "### Visual QA Probes",
    "",
    ...(report.estimateMetrics.visualProbes.results.length
      ? report.estimateMetrics.visualProbes.results.map((probe) =>
          `- ${probe.status}: ${probe.id} — expected ${probe.expectedAnswer ?? "signal"}; matched ${probe.matchedSignals.join(", ") || "none"}${probe.observedValues?.length ? `; observed ${probe.observedValues.map(String).join(", ")}` : ""}${probe.mismatchReason ? `; ${probe.mismatchReason}` : ""}${probe.reconciliationReason ? `; ${probe.reconciliationReason}` : ""}`
        )
      : ["- None configured"]),
    "",
    "## Runs",
    "",
  ];

  for (const run of report.runs) {
    lines.push(`### ${run.label}`);
    lines.push("");
    lines.push(`- Status: ${run.status}`);
    lines.push(`- Events: ${run.eventCount}`);
    lines.push(`- Tool calls: ${run.toolMetrics.totalCalls}`);
    lines.push(`- Tool success: ${Math.round(run.toolMetrics.successRate * 100)}%`);
    lines.push(`- Thinking chars: ${run.reasoningMetrics.thinkingChars}`);
    lines.push(`- Stages saved: ${run.stageMetrics.savedStages.join(", ") || "None"}`);
    lines.push(`- Missing required tools: ${run.toolMetrics.requiredMissing.join(", ") || "None"}`);
    lines.push(`- Estimator journey: ${run.journeyMetrics.phaseOrder.join(" -> ") || "None"}`);
    lines.push(`- Journey gaps: ${run.journeyMetrics.missingHumanBehaviors.join(" ") || "None"}`);
    lines.push(`- Native visual drawing image inspections: ${run.journeyMetrics.actualVisualDrawingSignals}`);
    lines.push(`- Drawing visual breakdown: renders=${run.journeyMetrics.renderedDrawingPages}, zooms=${run.journeyMetrics.zoomedDrawingRegions}, symbolScans=${run.journeyMetrics.symbolScans}, symbolCounts=${run.journeyMetrics.symbolCounts}`);
    lines.push(`- Returns to docs/drawings after pricing/reference: ${run.journeyMetrics.returnsToDocuments}`);
    lines.push("");
    lines.push("| Estimator Phase | Hits | First Event | Tools |");
    lines.push("| --- | ---: | ---: | --- |");
    for (const [phase, value] of Object.entries(run.journeyMetrics.phases)) {
      lines.push(`| ${escapeMd(phase)} | ${value.hits} | ${value.firstIndex ?? ""} | ${escapeMd(value.tools.join(", "))} |`);
    }
    lines.push("");
    lines.push("| Tool | Calls | Results | Failures | Avg ms |");
    lines.push("| --- | ---: | ---: | ---: | ---: |");
    for (const [tool, value] of Object.entries(run.toolMetrics.byTool).sort((a, b) => b[1].calls - a[1].calls)) {
      lines.push(`| ${escapeMd(tool)} | ${value.calls} | ${value.results} | ${value.failures} | ${value.avgDurationMs ?? ""} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function buildFailedCaseReport(args: Args, evalCase: EvalCase, error: unknown): Promise<CaseReport> {
  const now = new Date();
  const message = error instanceof Error ? error.message : String(error);
  const report: CaseReport = {
    caseId: evalCase.id,
    baseCaseId: evalCase.baseId,
    iteration: evalCase.iteration,
    repeatTotal: evalCase.repeatTotal,
    name: evalCase.expectations.name || path.basename(evalCase.zipPath, ".zip"),
    zipPath: evalCase.zipPath,
    zipSha256: await fileSha256(evalCase.zipPath).catch(() => "unknown"),
    apiUrl: args.apiUrl,
    startedAt: now.toISOString(),
    completedAt: now.toISOString(),
    durationSeconds: 0,
    ingestion: {
      status: "failed",
      durationSeconds: 0,
      history: [],
    },
    runs: [],
    documentMetrics: {
      total: 0,
      extracted: 0,
      pending: 0,
      failed: 0,
      names: [],
      readToolCalls: 0,
      readDocumentIds: [],
      readDocumentNames: [],
      readCoverage: null,
      expectedMissing: [],
    },
    estimateMetrics: {
      worksheets: 0,
      items: 0,
      totalValue: null,
      pricedItems: 0,
      zeroValueItems: 0,
      sourceNoteCoverage: 0,
      costEvidenceCoverage: 0,
      logicCoverage: 0,
      expectedKeywordMissing: [],
      visualAudit: {
        drawingDrivenPackages: 0,
        actualRenderedPages: 0,
        actualZoomRegions: 0,
        atlasStatus: null,
        atlasRegions: 0,
        atlasDocumentRequests: 0,
        promotedDocuments: 0,
        providerRegions: 0,
        cadNativeRegions: 0,
        modelNativeRegions: 0,
        evidenceClaims: 0,
        verifierStatus: null,
        unresolvedContradictions: 0,
        packagesMissingLedgerClaims: [],
        packagesMissingActualRender: [],
        packagesMissingActualZoom: [],
        fullPageZoomEvidence: [],
      },
      visualProbes: {
        probeCount: 0,
        evidenced: 0,
        results: [],
      },
    },
    quality: {
      score: 0,
      grade: "fail",
      bands: {},
    },
    findings: [message],
    artifacts: {
      json: "",
      markdown: "",
    },
  };
  log(`FAILED ${report.name}: ${message}`);
  return report;
}

function sliceEventsForRun(events: CliEvent[], sessionId: string) {
  const startIndex = events.findIndex((event) => event.type === "run_divider" && getString(getObject(event.data).runId) === sessionId);
  if (startIndex === -1) return events;
  // Async evidence can intentionally interrupt and resume the CLI runtime.
  // Treat follow-on run dividers as the same observed attempt so the harness
  // scores the complete agent journey instead of only the pre-interrupt turn.
  return events.slice(startIndex + 1);
}

function slimIngestionStatus(status: IngestionStatus): IngestionStatus {
  return {
    status: status.status,
    documentCount: status.documentCount,
    job: status.job ? {
      status: status.job.status,
      progress: status.job.progress,
      stage: status.job.stage,
      message: status.job.message,
      currentDocumentName: status.job.currentDocumentName,
      updatedAt: status.job.updatedAt,
    } : null,
    summary: status.summary,
    documents: (status.documents || []).map((doc) => ({
      id: doc.id,
      fileName: doc.fileName,
      fileType: doc.fileType,
      documentType: doc.documentType,
      pageCount: doc.pageCount,
      hasText: doc.hasText,
      extractionProvider: doc.extractionProvider,
      extractionState: doc.extractionState,
      status: doc.status,
      progress: doc.progress,
      error: doc.error,
    })),
  };
}

function inferToolResultSuccess(data: Json, content: unknown, toolId?: string) {
  if (isExpectedDomainNegativeResult(toolId, content)) return true;
  if (data.success === false || data.isError === true || data.error) return false;
  const text = stringifyForSearch(content).slice(0, 2_000);
  if (/\b(error|exception|traceback|failed|enoent|eacces)\b/i.test(text)) return false;
  return true;
}

function isExpectedDomainNegativeResult(toolId: string | undefined, content: unknown) {
  const normalizedToolId = normalizeToolId(toolId || "");
  if (normalizedToolId !== "verifyDrawingEvidenceLedger") return false;
  const payload = extractToolPayload(content);
  const verification = getObject(payload.verification);
  return getString(verification.status).toLowerCase() === "failed";
}

function extractToolPayload(content: unknown): Json {
  const direct = getObject(content);
  if (Object.keys(direct).length > 0) return direct;

  let value = content;
  if (typeof value === "string") {
    const parsed = parseJson(value);
    if (parsed !== null) value = parsed;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = getString(getObject(entry).text);
      if (!text) continue;
      const parsed = parseJson(text);
      const object = getObject(parsed);
      if (Object.keys(object).length > 0) return object;
    }
  }

  return {};
}

function collectDocumentRefs(input: unknown, ids: Set<string>, names: Set<string>) {
  if (input === null || input === undefined) return;
  if (typeof input === "string") {
    const docIds = input.match(/\bdoc-[a-f0-9-]{8,}\b/gi) || [];
    for (const id of docIds) ids.add(id);
    if (/\.(pdf|xlsx?|csv|docx?|png|jpe?g|tiff?|dwg|dxf)\b/i.test(input)) names.add(input);
    return;
  }
  if (Array.isArray(input)) {
    for (const value of input) collectDocumentRefs(value, ids, names);
    return;
  }
  if (typeof input === "object") {
    const object = input as Json;
    for (const [key, value] of Object.entries(object)) {
      const lower = key.toLowerCase();
      if (lower.includes("documentid") || lower === "id" || lower === "docid") {
        const id = getString(value);
        if (id) ids.add(id);
      }
      if (lower.includes("filename") || lower.includes("documentname") || lower === "path") {
        const name = getString(value);
        if (name) names.add(name);
      }
      collectDocumentRefs(value, ids, names);
    }
  }
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const parsed = parseJson(value);
  return parsed === null ? value : parsed;
}

function missingNeedles(haystack: string, needles: string[]) {
  const lower = haystack.toLowerCase();
  return needles.filter((needle) => !lower.includes(needle.toLowerCase()));
}

function normalizeToolId(toolId: string) {
  return toolId.replace(/^mcp__bidwright__/, "");
}

function defaultManualQuestion() {
  return "Summarize the current quote, identify the key documents you used, and call out the top estimate risks without changing the estimate.";
}

function defaultEvalQuestionAnswer(question: string) {
  const prompt = question.toLowerCase();
  if (/scope|included|package|bid/i.test(prompt)) {
    return "For this eval, proceed as if all real non-__MACOSX project packages and drawing/spec scopes are included in the bid. Ignore macOS resource-fork files, Thumbs.db, and folder placeholder artifacts. Where documents conflict or scope is uncertain, continue instead of blocking, but do not treat this answer as approval for a lower-context drawing note to override a BOM/spec/schedule/table. Use the high-authority BOM/spec/schedule/table baseline unless explicit supersession/order-of-precedence/client/vendor evidence says otherwise; carry the lower-context value as an alternate or clarification.";
  }
  if (/commercial|subcontract|self[- ]?perform|owner/i.test(prompt)) {
    return "For this eval, use your best estimator judgment from the documents. Treat clearly vendor/fabricator/specialty work as subcontract or allowance where appropriate, treat ordinary field/support work as self-performed when reasonable, and record the commercial treatment and confidence in assumptions/package plan.";
  }
  return "For this eval, continue using best estimator judgment from the documents. Make reasonable explicit assumptions, record open clarifications, and proceed through the full staged estimate workflow without waiting for more user input.";
}

function parseJson(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getErrorMessage(data: unknown) {
  const object = getObject(data);
  return getString(object.error) || getString(object.message) || getString(object.code);
}

function getObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function positive(value: unknown) {
  const number = typeof value === "number" ? value : getNumber(value);
  return typeof number === "number" && Number.isFinite(number) && number > 0;
}

function stringifyForSearch(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function round(value: number, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 2);
}

function countStrings(values: string[]) {
  const counts: Record<string, number> = {};
  for (const value of values) {
    if (!value) continue;
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function secondsBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

function timestampSlug(date: Date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "case";
}

function shortHash(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

async function fileSha256(filePath: string) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function escapeMd(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function log(message: string) {
  process.stdout.write(`${message}\n`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
