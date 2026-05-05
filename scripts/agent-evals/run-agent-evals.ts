#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Blob } from "node:buffer";

type Json = Record<string, unknown>;

type Runtime = "claude-code" | "codex" | "gemini" | "opencode";
type RunMode = "full-intake" | "manual-question";

interface Args {
  apiUrl: string;
  token?: string;
  email?: string;
  password?: string;
  orgSlug?: string;
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
  maxCases?: number;
  keepRunning: boolean;
  live: boolean;
  reviewCadenceSeconds: number;
  help: boolean;
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
  thresholds?: EvalThresholds;
}

interface EvalCase {
  id: string;
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
}

interface StageMetrics {
  savedStages: string[];
  missingCriticalStages: string[];
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
  findings: string[];
}

interface CaseReport {
  caseId: string;
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
  "queryKnowledge",
  "recommendEstimateBasis",
  "recommendLaborBasis",
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
  --review-cadence-seconds <n>     Live observer brief cadence. Default: 60
  --max-cases <n>                  Limit cases for a smoke run
  --keep-running                   Do not call stop on timeout
  --no-live                        Disable the live observer dossier

Live observer:
  The harness streams ingestion, chat, tool calls/results, thinking snippets,
  and rolling review briefs into each case's observer.md and events.ndjson.
  The numeric bands are telemetry only. The actual quality decision is made
  by the Codex/human monitor watching those artifacts and iterating the agent.

Sidecar expectations:
  For package.zip, add package.eval.json or package.json with fields like:
  {
    "name": "Pump station RFQ",
    "scope": "Budget turnkey mechanical estimate",
    "requiredTools": ["getWorkspace", "saveEstimateScopeGraph"],
    "expectedDocumentNames": ["spec", "drawing"],
    "expectedKeywords": ["pump", "spool"],
    "followUpQuestions": ["What documents did you rely on?"]
  }
`;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apiUrl: process.env.BIDWRIGHT_API_URL || "http://localhost:4001",
    token: process.env.BIDWRIGHT_AUTH_TOKEN,
    email: process.env.BIDWRIGHT_EMAIL,
    password: process.env.BIDWRIGHT_PASSWORD,
    orgSlug: process.env.BIDWRIGHT_ORG_SLUG,
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
    keepRunning: false,
    live: process.env.BIDWRIGHT_EVAL_LIVE !== "false",
    reviewCadenceSeconds: Number(process.env.BIDWRIGHT_EVAL_REVIEW_CADENCE_SECONDS || 60),
    help: false,
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
      case "--max-cases":
        args.maxCases = Number(next());
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
  if (!Number.isFinite(args.reviewCadenceSeconds) || args.reviewCadenceSeconds <= 0) {
    throw new Error("--review-cadence-seconds must be a positive number");
  }

  return args;
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

  const cases = await discoverCases(args);
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
    log(`\n[${index + 1}/${cases.length}] ${evalCase.zipName}`);
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
  const caseName = expectations.name || path.basename(evalCase.zipPath, ".zip");
  const zipSha256 = await fileSha256(evalCase.zipPath);
  const projectName = expectations.projectName || `${caseName} Eval ${timestampSlug(startedAt)}`;
  const monitor = await initLiveMonitor(args, evalCase, caseName);

  const uploadFields = {
    projectName,
    packageName: caseName,
    clientName: expectations.clientName || args.clientName || "Bidwright Eval Client",
    location: expectations.location || args.location || "Eval Lab",
    scope: expectations.scope || args.scope,
    sourceKind: "agent_eval",
  };

  log(`Uploading package: ${evalCase.zipName}`);
  const upload = await client.uploadPackage(evalCase.zipPath, uploadFields);
  const project = getObject(upload.data.project);
  const quote = getObject(upload.data.quote);
  const revision = getObject(upload.data.revision);
  const projectId = getString(project.id);
  if (!projectId) throw new Error("Upload response did not include project.id");
  await appendLiveNote(monitor, `Project created: ${projectId}`);

  log(`Project ${projectId}: waiting for document extraction`);
  const ingestionStart = Date.now();
  const ingestion = await waitForIngestion(client, projectId, args, monitor);

  const runs: RunReport[] = [];
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
  const findings = [
    ...buildCaseFindings(ingestion.final, documentMetrics, estimateMetrics, runs, expectations),
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

    if (Date.now() - lastLog > 15_000) {
      log(`Ingestion ${status.status || "unknown"}: ${total - pending - failed}/${total} extracted, ${pending} pending, ${failed} failed`);
      lastLog = Date.now();
    }

    if (failedStatus || failed > 0) return { history, final: status };
    if (projectReady && pending === 0) return { history, final: status };

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
  let lastLog = 0;

  while (Date.now() < deadline) {
    const response = await client.requestJson<CliStatus>(`/api/cli/${projectId}/status`);
    lastStatus = response.data;
    const status = String(lastStatus.status || "none");
    const runEvents = sessionId ? sliceEventsForRun(lastStatus.events || [], sessionId) : (lastStatus.events || []);
    await observeRunEvents(monitor, label, sessionId, lastStatus, runEvents);

    if (Date.now() - lastLog > 20_000 || runEvents.length !== lastEventCount) {
      const tools = analyzeTools(runEvents, []);
      log(`${label}: ${status}, events=${runEvents.length}, tools=${tools.totalCalls}, failures=${tools.failedResults}`);
      lastEventCount = runEvents.length;
      lastLog = Date.now();
    }

    if (TERMINAL_AGENT_STATUSES.has(status)) {
      return { ...lastStatus, events: runEvents };
    }

    await sleep(args.pollSeconds * 1000);
  }

  if (!args.keepRunning) {
    await client.requestJson<Json>(`/api/cli/${projectId}/stop`, { method: "POST", body: {} }).catch(() => null);
  }
  await appendLiveNote(monitor, `${label} timed out after ${args.timeoutMinutes} minute(s). ${args.keepRunning ? "Left running." : "Stop requested."}`);
  return { ...lastStatus, status: "timeout", events: sessionId ? sliceEventsForRun(lastStatus.events || [], sessionId) : (lastStatus.events || []) };
}

function buildRunReport(label: string, kind: "intake" | "question", sessionId: string | undefined, status: CliStatus): RunReport {
  const events = status.events || [];
  const toolMetrics = analyzeTools(events, kind === "intake" ? DEFAULT_REQUIRED_TOOLS : ["getWorkspace", "getEstimateStrategy"]);
  const reasoningMetrics = analyzeReasoning(events);
  const stageMetrics = analyzeStages(toolMetrics.calls);
  const findings = buildRunFindings(kind, status, toolMetrics, reasoningMetrics, stageMetrics);
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
  if (run.kind === "intake" && run.stageMetrics.savedStages.length < 4) {
    items.push("Watch whether the agent is genuinely using the staged strategy scaffold before creating line items.");
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
    const tool = getString(data.toolId) || getString(data.name) || getString(data.toolName) || "unknown";
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
      const toolId = getString(data.toolId) || getString(data.name) || getString(data.toolName) || "unknown";
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
      const success = inferToolResultSuccess(data, content);
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
    const toolId = result.toolId || (result.toolUseId ? callsByUseId.get(result.toolUseId)?.toolId : undefined) || "unknown";
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

function analyzeDocuments(status: IngestionStatus | undefined, workspace: Json, events: CliEvent[], expectations: CaseExpectations): DocumentMetrics {
  const statusDocs = status?.documents || [];
  const workspaceDocs = Array.isArray(workspace.sourceDocuments) ? workspace.sourceDocuments as Json[] : [];
  const docs = statusDocs.length ? statusDocs : workspaceDocs;
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

  const extracted = Number(status?.summary?.extracted ?? docs.filter((doc) => doc.extractionState === "extracted" || doc.status === "complete" || doc.hasText === true).length);
  const pending = Number(status?.summary?.pending ?? docs.filter((doc) => doc.extractionState === "pending" || doc.status === "pending").length);
  const failed = Number(status?.summary?.failed ?? docs.filter((doc) => doc.extractionState === "failed" || doc.status === "failed").length);
  const total = Number(status?.summary?.total ?? status?.documentCount ?? docs.length);
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

function analyzeEstimate(workspaceResponse: Json, expectations: CaseExpectations): EstimateMetrics {
  const workspace = getObject(workspaceResponse.workspace) || workspaceResponse;
  const worksheets = Array.isArray(workspace.worksheets) ? workspace.worksheets as Json[] : [];
  const items = worksheets.flatMap((worksheet) => {
    const worksheetItems = worksheet.items;
    return Array.isArray(worksheetItems) ? worksheetItems as Json[] : [];
  });

  const totals = getObject(workspace.estimateTotals) || getObject(getObject(workspace.estimate)?.totals) || getObject(workspace.totals);
  const totalValue =
    getNumber(totals.calculatedTotal) ??
    getNumber(totals.totalPrice) ??
    getNumber(totals.subtotal) ??
    getNumber(workspace.total);

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
  };
}

function buildRunFindings(
  kind: "intake" | "question",
  status: CliStatus,
  toolMetrics: ToolMetrics,
  reasoningMetrics: ReasoningMetrics,
  stageMetrics: StageMetrics,
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
  if (documentMetrics.readToolCalls === 0) findings.push("Agent did not call any document read tool.");
  if (documentMetrics.readCoverage !== null && documentMetrics.readCoverage < (expectations.thresholds?.minDocumentReadCoverage ?? 0.35)) {
    findings.push(`Document read coverage is low: ${Math.round(documentMetrics.readCoverage * 100)}%.`);
  }
  if (documentMetrics.expectedMissing.length > 0) {
    findings.push(`Expected document name signal(s) missing: ${documentMetrics.expectedMissing.join(", ")}.`);
  }

  const intakeRun = runs.find((run) => run.kind === "intake");
  if (intakeRun) {
    if (estimateMetrics.worksheets === 0) findings.push("No worksheets were created.");
    if (estimateMetrics.items === 0) findings.push("No worksheet items were created.");
    if (!positive(estimateMetrics.totalValue)) findings.push("Estimate total is empty or zero.");
    if (estimateMetrics.items > 0 && estimateMetrics.logicCoverage < 0.5) {
      findings.push(`Only ${Math.round(estimateMetrics.logicCoverage * 100)}% of line items have visible pricing logic/evidence.`);
    }
    if (estimateMetrics.expectedKeywordMissing.length > 0) {
      findings.push(`Expected estimate keyword(s) missing: ${estimateMetrics.expectedKeywordMissing.join(", ")}.`);
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

  const ingestionReady = input.documentMetrics.pending === 0 && input.documentMetrics.failed === 0 && input.documentMetrics.extracted > 0;
  const runCompleted = input.runs.every((run) => run.status === "completed");
  const toolHealth = allFailedToolResults <= thresholds.maxToolFailures
    ? 1
    : Math.max(0, 1 - allFailedToolResults / Math.max(1, allFailedToolResults + 3));
  const toolDepth = Math.min(1, allToolCalls / Math.max(1, thresholds.minToolCalls));
  const reasoningDepth = Math.min(1, allThinkingChars / Math.max(1, thresholds.minThinkingChars));
  const stageCoverage = intake?.stageMetrics
    ? 1 - (intake.stageMetrics.missingCriticalStages.length / 6)
    : 0;
  const documentCoverage = input.documentMetrics.readCoverage === null
    ? 0
    : Math.min(1, input.documentMetrics.readCoverage / Math.max(0.01, thresholds.minDocumentReadCoverage));
  const estimateCompleteness = input.runs.some((run) => run.kind === "intake")
    ? Math.min(1, input.estimateMetrics.items / Math.max(1, thresholds.minWorksheetItems))
    : 1;
  const evidenceQuality = input.runs.some((run) => run.kind === "intake")
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
      findings: report.findings,
      report: report.artifacts.markdown,
    })),
  };
  await writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeFile(path.join(outDir, "summary.md"), renderSummaryMarkdown(reports), "utf8");
}

function renderSummaryMarkdown(reports: CaseReport[]) {
  const lines = [
    "# Bidwright Agent Eval Summary",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Case | Telemetry | Score | Project | Findings |",
    "| --- | --- | ---: | --- | --- |",
  ];
  for (const report of reports) {
    lines.push(`| ${escapeMd(report.name)} | ${report.quality.grade} | ${report.quality.score} | ${report.projectId || ""} | ${escapeMd(report.findings.slice(0, 3).join("; ") || "None")} |`);
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
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function renderCaseMarkdown(report: CaseReport) {
  const lines = [
    `# ${report.name}`,
    "",
    `Grade: **${report.quality.grade}** (${report.quality.score}/100)`,
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
  const endIndex = events.findIndex((event, index) => index > startIndex && event.type === "run_divider");
  return events.slice(startIndex + 1, endIndex === -1 ? undefined : endIndex);
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

function inferToolResultSuccess(data: Json, content: unknown) {
  if (data.success === false || data.isError === true || data.error) return false;
  const text = stringifyForSearch(content).slice(0, 2_000);
  if (/\b(error|exception|traceback|failed|enoent|eacces)\b/i.test(text)) return false;
  return true;
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

function defaultManualQuestion() {
  return "Summarize the current quote, identify the key documents you used, and call out the top estimate risks without changing the estimate.";
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
