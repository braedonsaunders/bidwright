/**
 * CLI Management Routes
 *
 * Endpoints for detecting, authenticating, and managing CLI agent runtimes.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { detectCli, checkCliAuth, spawnSession, stopSession, resumeSession, getSession, listSessions, listCliModels, type AgentRuntime } from "../services/cli-runtime.js";
import { getAdapter, isRegisteredRuntime, listAdapters, tryGetAdapter } from "../services/cli-adapters/registry.js";
import { generateInstructionFiles, symlinkKnowledgeBooks, writeKnowledgeDocumentSnapshots } from "../services/claude-md-generator.js";
import { writeAgentLibrarySnapshot } from "../services/agent-library-snapshot.js";
import { resolveProjectDir, resolveProjectDocumentsDir, resolveKnowledgeDir, apiDataRoot } from "../paths.js";
import { join } from "node:path";
import { prisma } from "@bidwright/db";
import { getAgentToolDisplayName } from "@bidwright/domain";
import { getSessionCookieToken } from "../services/session-cookie.js";

/** Extract session token from Authorization header, cookie, or query param */
function extractAuthToken(request: FastifyRequest): string {
  // 1. Bearer token from Authorization header
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  // 2. Session cookie (how the web frontend authenticates)
  const cookieToken = getSessionCookieToken(request);
  if (cookieToken) return cookieToken;
  // 3. Query param fallback (for SSE streams etc.)
  return (request.query as any)?.token || "";
}

function enrichCliToolEvent(evt: any) {
  if (evt?.type !== "tool_call" && evt?.type !== "tool") return evt;
  const toolId = evt?.data?.toolId;
  if (typeof toolId !== "string" || !toolId) return evt;
  return {
    ...evt,
    data: {
      ...(evt.data ?? {}),
      toolDisplayName: getAgentToolDisplayName(toolId),
    },
  };
}

function sanitizeCliEventForPersistence(value: unknown): unknown {
  if (typeof value === "string") {
    const redacted = value.replace(/[A-Za-z0-9+/=]{2000,}/g, "[large encoded payload omitted]");
    return redacted.length > 120_000 ? `${redacted.slice(0, 120_000)}\n[truncated]` : redacted;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeCliEventForPersistence(item));
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(source)) {
      if (key === "data" && source.type === "base64" && typeof entry === "string") {
        next[key] = "[large encoded payload omitted]";
      } else {
        next[key] = sanitizeCliEventForPersistence(entry);
      }
    }
    return next;
  }
  return value;
}

function buildSyntheticCompletionEvents(summary: any, updatedAt: Date | string | null | undefined) {
  const timestamp = updatedAt instanceof Date
    ? updatedAt.toISOString()
    : typeof updatedAt === "string" && updatedAt
      ? updatedAt
      : new Date().toISOString();

  const totalWorksheets = typeof summary?.totalWorksheets === "number" ? summary.totalWorksheets : null;
  const totalItems = typeof summary?.totalItems === "number" ? summary.totalItems : null;
  const totalLabourMH = typeof summary?.totalLabourMH === "number" ? summary.totalLabourMH : null;
  const parts = [
    totalWorksheets != null ? `${totalWorksheets} worksheet${totalWorksheets === 1 ? "" : "s"}` : null,
    totalItems != null ? `${totalItems} item${totalItems === 1 ? "" : "s"}` : null,
    totalLabourMH != null ? `~${totalLabourMH} labour MH` : null,
  ].filter(Boolean);

  const detail = parts.length > 0
    ? `Estimate finalized from workspace state — ${parts.join(", ")}.`
    : "Estimate finalized from workspace state.";

  const summaryNote = typeof summary?.note === "string" && summary.note.trim()
    ? summary.note.trim()
    : null;

  const message = summaryNote
    ? `Estimate complete. ${summaryNote}`
    : detail;

  return [
    {
      type: "progress",
      data: {
        phase: "Complete",
        detail,
        derived: true,
      },
      timestamp,
    },
    {
      type: "message",
      data: {
        role: "assistant",
        content: message,
        derived: true,
      },
      timestamp,
    },
    {
      type: "status",
      data: {
        status: "completed",
        derived: true,
      },
      timestamp,
    },
  ];
}

function asEstimateObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asEstimateArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readNumericValue(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readStringValue(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function toReadableText(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s+/g, " ");
    return normalized || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const joined = value.map(toReadableText).filter((entry): entry is string => !!entry).join(", ");
    return joined || null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const direct = readStringValue(record, ["statement", "text", "description", "message", "title", "label", "name", "summary", "note"]);
    if (direct) return direct;
  }
  return null;
}

function collectEstimateHighlights(items: unknown, limit = 3): string[] {
  return asEstimateArray(items)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return toReadableText(entry);
      const record = entry as Record<string, unknown>;
      const title = readStringValue(record, ["title", "label", "name"]);
      const detail = readStringValue(record, ["statement", "text", "description", "message", "summary", "note"]);
      if (title && detail && !detail.toLowerCase().startsWith(title.toLowerCase())) {
        return `${title}: ${detail}`;
      }
      return title || detail || null;
    })
    .filter((entry): entry is string => !!entry)
    .map((entry) => entry.replace(/^[•\-]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function formatCurrency(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatHours(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  }).format(value)} labour MH`;
}

function formatCount(value: number | null, label: string): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return `${rounded} ${label}${rounded === 1 ? "" : "s"}`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function isGenericCompletionMessage(content: unknown) {
  return typeof content === "string"
    && content.trim() === "Intake complete. Review the estimate worksheets and adjust pricing as needed.";
}

function hasRichCompletionSummary(events: PersistedCliEvent[]) {
  return events.some((event) => {
    if (event.type !== "message") return false;
    const data = (event.data || {}) as Record<string, unknown>;
    const content = typeof data.content === "string" ? data.content : "";
    if (!content.trim()) return false;
    if (data.derived === true) return true;
    return /^estimate complete\./i.test(content.trim())
      || /^estimate finalized\./i.test(content.trim())
      || /reply with .*revise/i.test(content);
  });
}

function buildEstimateCompletionEvents(
  strategy: {
    summary?: unknown;
    assumptions?: unknown;
    reconcileReport?: unknown;
    reviewRequired?: boolean | null;
  },
  updatedAt: Date | string | null | undefined,
  options?: { includeStatus?: boolean },
) {
  const timestamp = updatedAt instanceof Date
    ? updatedAt.toISOString()
    : typeof updatedAt === "string" && updatedAt
      ? updatedAt
      : new Date().toISOString();

  const summary = asEstimateObject(strategy.summary);
  const reconcileReport = asEstimateObject(strategy.reconcileReport);
  const totalValue = readNumericValue(summary, ["quotedTotal", "totalPrice", "grandTotal", "subtotal"]);
  const totalHours = readNumericValue(summary, ["totalLabourMH", "totalHours"]);
  const worksheetCount = readNumericValue(summary, ["totalWorksheets", "worksheetCount"]);
  const itemCount = readNumericValue(summary, ["totalItems", "lineItemCount", "itemCount"]);
  const detailParts = [
    formatCurrency(totalValue),
    formatCount(worksheetCount, "worksheet"),
    formatCount(itemCount, "line item"),
    formatHours(totalHours),
  ].filter((entry): entry is string => !!entry);

  const detail = detailParts.length > 0
    ? `Estimate finalized from workspace state with ${detailParts.join(", ")}.`
    : "Estimate finalized from workspace state.";

  const assumptionHighlights = collectEstimateHighlights(strategy.assumptions, 3);
  const riskHighlights = [
    ...collectEstimateHighlights(reconcileReport.majorRisks, 2),
    ...collectEstimateHighlights(reconcileReport.risks, 2),
    ...collectEstimateHighlights(reconcileReport.reviewItems, 2),
  ].filter((entry, index, source) => source.indexOf(entry) === index).slice(0, 3);

  if (strategy.reviewRequired) {
    riskHighlights.unshift("Human review is still required before this estimate should be treated as final.");
  }

  const breakdownParts = [
    ["labour", readNumericValue(summary, ["labourPrice"])],
    ["material", readNumericValue(summary, ["materialPrice"])],
    ["equipment", readNumericValue(summary, ["equipmentPrice"])],
    ["subcontract", readNumericValue(summary, ["subcontractorPrice"])],
    ["allowance", readNumericValue(summary, ["allowancePrice"])],
  ]
    .map(([label, value]) => {
      const formatted = formatCurrency(value as number | null);
      return formatted ? `${label} ${formatted}` : null;
    })
    .filter((entry): entry is string => !!entry)
    .slice(0, 4);

  const summaryLead = detailParts.length > 0
    ? `Estimate complete. I finished the estimate at ${formatCurrency(totalValue) ?? "the current workspace total"} based on ${joinList(detailParts.slice(1)) || "the current workspace state"}.`
    : "Estimate complete. I finished the estimate using the current workspace state.";
  const sections = [summaryLead];

  if (breakdownParts.length > 0) {
    sections.push(`Breakdown: ${breakdownParts.join(", ")}.`);
  }

  if (assumptionHighlights.length > 0) {
    sections.push(`Key assumptions: ${joinList(assumptionHighlights)}.`);
  }

  if (riskHighlights.length > 0) {
    sections.push(`Review notes: ${joinList(riskHighlights)}.`);
  }

  const summaryNote = readStringValue(summary, ["completionNotes", "note", "notes"]);
  if (summaryNote) {
    sections.push(summaryNote);
  }

  sections.push("Reply with any pricing, scope, schedule, or packaging changes and I can revise the estimate.");

  const events: PersistedCliEvent[] = [
    {
      type: "progress",
      data: {
        phase: "Complete",
        detail,
        derived: true,
      },
      timestamp,
    },
    {
      type: "message",
      data: {
        role: "assistant",
        content: sections.join("\n\n"),
        derived: true,
      },
      timestamp,
    },
  ];

  if (options?.includeStatus !== false) {
    events.push({
      type: "status",
      data: {
        status: "completed",
        derived: true,
      },
      timestamp,
    });
  }

  return events;
}

type PersistedCliEvent = {
  type?: string;
  data?: Record<string, unknown>;
  timestamp?: string;
};

type CliQuestionStep = {
  id?: string;
  prompt: string;
  options?: string[];
  allowMultiple?: boolean;
  placeholder?: string;
  context?: string;
};

type PendingQuestionState = {
  id: string;
  question: string;
  options?: string[];
  allowMultiple?: boolean;
  context?: string;
  questions?: CliQuestionStep[];
  createdAt: string;
  runId?: string | null;
};

function normalizeCliEventText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() : "";
}

function semanticCliEventKey(event: PersistedCliEvent): string | null {
  const type = event.type || "";
  const data = event.data || {};

  if ((type === "tool_call" || type === "tool" || type === "tool_result") && data.toolUseId) {
    return `${type}:${String(data.toolUseId)}`;
  }

  if (type === "askUser") {
    const questionId = data.questionId || data.id;
    if (questionId) return `askUser:${String(questionId)}`;
    const question = normalizeCliEventText(data.question);
    return question ? `askUser:${question}` : null;
  }

  if (type === "userAnswer") {
    const questionId = data.questionId || data.id;
    const answer = normalizeCliEventText(data.answer ?? data.text ?? data.content ?? data.message);
    if (questionId) return `userAnswer:${String(questionId)}:${answer}`;
    return answer ? `userAnswer:${answer}` : null;
  }

  return null;
}

function cliEventFingerprint(event: PersistedCliEvent): string {
  const semanticKey = semanticCliEventKey(event);
  if (semanticKey) return semanticKey;
  return JSON.stringify({
    type: event.type || "",
    timestamp: event.timestamp || "",
    data: event.data || null,
  });
}

function mergeCliEvents(existing: PersistedCliEvent[], incoming: PersistedCliEvent[]): PersistedCliEvent[] {
  const seen = new Set(existing.map(cliEventFingerprint));
  const merged = [...existing];

  for (const event of incoming) {
    const fingerprint = cliEventFingerprint(event);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    merged.push(event);
  }

  return merged;
}

const cliRunWriteLocks = new Map<string, Promise<void>>();

async function withCliRunWriteLock<T>(runId: string, work: () => Promise<T>): Promise<T> {
  const previous = cliRunWriteLocks.get(runId) || Promise.resolve();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lock = previous.catch(() => undefined).then(() => barrier);
  cliRunWriteLocks.set(runId, lock);

  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (cliRunWriteLocks.get(runId) === lock) {
      cliRunWriteLocks.delete(runId);
    }
  }
}

type PersistedCliRunRef = {
  id: string;
  events: PersistedCliEvent[];
};

function readCliRunEvents(run: { output?: unknown } | null | undefined): PersistedCliEvent[] {
  return (((run?.output as any)?.events || []) as PersistedCliEvent[]);
}

async function getCliRunById(projectId: string, runId: string): Promise<PersistedCliRunRef | null> {
  const run = await prisma.aiRun.findFirst({
    where: { id: runId, projectId, kind: "cli-intake" },
    select: { id: true, output: true },
  });
  if (!run) return null;
  return { id: run.id, events: readCliRunEvents(run) };
}

async function findCliRunByQuestionId(projectId: string, questionId: string): Promise<PersistedCliRunRef | null> {
  const runs = await prisma.aiRun.findMany({
    where: { projectId, kind: "cli-intake" },
    orderBy: { createdAt: "desc" },
    select: { id: true, output: true },
  });

  for (const run of runs) {
    const events = readCliRunEvents(run);
    if (hasCliQuestionEvent(events, questionId)) {
      return { id: run.id, events };
    }
  }

  return null;
}

async function getCliRunContext(
  projectId: string,
  options?: { questionId?: string; runId?: string | null },
): Promise<PersistedCliRunRef | null> {
  if (options?.runId) {
    const run = await getCliRunById(projectId, options.runId);
    if (run && (!options.questionId || hasCliQuestionEvent(run.events, options.questionId))) {
      return run;
    }
  }

  if (options?.questionId) {
    const run = await findCliRunByQuestionId(projectId, options.questionId);
    if (run) return run;
  }

  const latestRun = await prisma.aiRun.findFirst({
    where: { projectId, kind: "cli-intake" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      output: true,
    },
  });

  if (!latestRun) return null;
  return { id: latestRun.id, events: readCliRunEvents(latestRun) };
}

async function appendCliEventsToLatestRun(
  projectId: string,
  incoming: PersistedCliEvent[],
  options?: { questionId?: string; runId?: string | null },
): Promise<string | null> {
  if (incoming.length === 0) return null;

  const targetRun = await getCliRunContext(projectId, options);
  if (!targetRun) return null;

  await withCliRunWriteLock(targetRun.id, async () => {
    const freshRun = await getCliRunById(projectId, targetRun.id);
    const existing = freshRun?.events ?? [];
    const sanitizedIncoming = incoming.map((event) => sanitizeCliEventForPersistence(event) as PersistedCliEvent);
    await prisma.aiRun.update({
      where: { id: targetRun.id },
      data: {
        output: {
          events: mergeCliEvents(existing, sanitizedIncoming),
        } as any,
      },
    });
  });

  return targetRun.id;
}

async function getLatestCliRunEvents(
  projectId: string,
  options?: { questionId?: string; runId?: string | null },
): Promise<PersistedCliEvent[]> {
  return (await getCliRunContext(projectId, options))?.events ?? [];
}

function makeCliQuestionId() {
  return `ask-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function findCliQuestionAnswer(events: PersistedCliEvent[], questionId: string): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type !== "userAnswer") continue;
    const data = (event.data || {}) as Record<string, unknown>;
    if (data.questionId === questionId && typeof data.answer === "string") {
      return data.answer;
    }
  }
  return null;
}

function findPendingCliQuestionFromEvents(
  events: PersistedCliEvent[],
  questionId?: string,
): PendingQuestionState | null {
  let pending: PendingQuestionState | null = null;

  for (const event of events) {
    const data = (event.data || {}) as Record<string, unknown>;
    if (event.type === "askUser") {
      const id = typeof data.questionId === "string"
        ? data.questionId
        : typeof data.id === "string"
          ? data.id
          : null;
      if (questionId && id !== questionId) continue;
      if (!id && questionId) continue;
      pending = {
        id: id || "",
        question: typeof data.question === "string" ? data.question : "",
        options: Array.isArray(data.options) ? data.options as string[] : [],
        allowMultiple: data.allowMultiple === true,
        context: typeof data.context === "string" ? data.context : "",
        questions: Array.isArray(data.questions) ? data.questions as CliQuestionStep[] : [],
        createdAt: typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString(),
      };
      continue;
    }

    if (!pending) continue;

    if (event.type === "userAnswer") {
      const answerQuestionId = typeof data.questionId === "string" ? data.questionId : null;
      if (!pending.id || !answerQuestionId || answerQuestionId === pending.id) {
        pending = null;
      }
      continue;
    }

    if (event.type === "askUserTimeout") {
      const timeoutQuestionId = typeof data.questionId === "string" ? data.questionId : null;
      if (!pending.id || !timeoutQuestionId || timeoutQuestionId === pending.id) {
        pending = null;
      }
      continue;
    }

    // If the agent emitted any later activity after the question, it is no longer
    // blocked on that prompt even if the original askUser never received a userAnswer.
    pending = null;
  }

  return pending;
}

function hasCliQuestionEvent(events: PersistedCliEvent[], questionId: string): boolean {
  return events.some((event) => {
    if (event.type !== "askUser") return false;
    const data = (event.data || {}) as Record<string, unknown>;
    return data.questionId === questionId || data.id === questionId;
  });
}

function isCliRuntime(value: unknown): value is AgentRuntime {
  return isRegisteredRuntime(value);
}

function resolveCliRuntime(requestedRuntime: unknown, configuredRuntime?: unknown): AgentRuntime {
  if (isCliRuntime(requestedRuntime)) return requestedRuntime;
  if (isCliRuntime(configuredRuntime)) return configuredRuntime;
  return "claude-code";
}

type CliModelOption = {
  id: string;
  name: string;
  description: string;
};

function normalizeCliModel(runtime: AgentRuntime, model: string | null | undefined) {
  const adapter = tryGetAdapter(runtime);
  if (!adapter) return "";
  return adapter.normalizeModel(model ?? null);
}

function normalizeCliReasoningEffort(value: unknown): "auto" | "low" | "medium" | "high" | "extra_high" | "max" {
  if (value === "auto" || value === "low" || value === "medium" || value === "high" || value === "extra_high" || value === "max") {
    return value;
  }
  return "extra_high";
}

const READY_INGESTION_STATUSES = new Set(["ready", "review", "quoted", "estimating"]);

function ingestionStartBlock(project: { ingestionStatus?: unknown }) {
  const ingestionStatus = (project.ingestionStatus ?? "unknown") as string;
  if (READY_INGESTION_STATUSES.has(ingestionStatus)) return null;
  return {
    error: "Document extraction is still in progress. Wait for the project's documents to finish processing before starting an AI run.",
    ingestionStatus,
    retryable: ingestionStatus === "queued" || ingestionStatus === "processing",
  };
}

function mapClaudeEffort(effort: ReturnType<typeof normalizeCliReasoningEffort>): "low" | "medium" | "high" | "xhigh" | "max" | null {
  switch (effort) {
    case "low":
    case "medium":
    case "high":
    case "max":
      return effort;
    case "extra_high":
      return "xhigh";
    default:
      return null;
  }
}

function mapCodexEffort(effort: ReturnType<typeof normalizeCliReasoningEffort>): "low" | "medium" | "high" | "xhigh" | "max" | null {
  switch (effort) {
    case "low":
    case "medium":
    case "high":
    case "max":
      return effort;
    case "extra_high":
      return "xhigh";
    default:
      return null;
  }
}

function dedupeCliModels(models: CliModelOption[]) {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

async function fetchAnthropicCliModels(apiKey?: string): Promise<CliModelOption[]> {
  if (!apiKey) return [];
  try {
    const response = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!response.ok) return [];
    const data = await response.json() as { data?: Array<{ id: string; display_name?: string }> };
    return (data.data || [])
      .filter((model) => model.id.startsWith("claude-"))
      .map((model) => ({
        id: model.id,
        name: model.display_name || model.id,
        description: "Exact Anthropic model ID",
      }));
  } catch {
    return [];
  }
}

async function fetchOpenAiCliModels(apiKey?: string): Promise<CliModelOption[]> {
  if (!apiKey) return [];
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!response.ok) return [];
    const data = await response.json() as { data?: Array<{ id: string }> };
    return (data.data || [])
      .filter((model) =>
        /^(gpt-|o\d|codex-)/.test(model.id) &&
        !/audio|realtime|transcribe|image|vision|tts|embedding|omni|whisper|moderation/i.test(model.id),
      )
      .map((model) => ({
        id: model.id,
        name: model.id,
        description: "Available via the OpenAI Responses API",
      }));
  } catch {
    return [];
  }
}

async function buildCliModelOptions(runtime: AgentRuntime, apiKey?: string): Promise<CliModelOption[]> {
  if (runtime === "claude-code") {
    const aliasModels: CliModelOption[] = [
      { id: "default", name: "Claude Default", description: "Use your Claude Code account default model" },
      { id: "best", name: "Claude Best", description: "Use the most capable available Claude alias" },
      { id: "sonnet", name: "Claude Sonnet", description: "Latest Sonnet alias for daily coding tasks" },
      { id: "opus", name: "Claude Opus", description: "Latest Opus alias for complex reasoning" },
      { id: "opusplan", name: "Claude Opus Plan", description: "Use Opus for planning and Sonnet for execution" },
      { id: "haiku", name: "Claude Haiku", description: "Fast Claude option for simple work" },
      { id: "sonnet[1m]", name: "Claude Sonnet 1M", description: "Latest Sonnet alias with 1M context" },
      { id: "opus[1m]", name: "Claude Opus 1M", description: "Latest Opus alias with 1M context" },
    ];
    return dedupeCliModels([...aliasModels, ...(await fetchAnthropicCliModels(apiKey))]);
  }
  if (runtime === "codex") {
    const defaultModels: CliModelOption[] = [
      { id: "gpt-5.4", name: "GPT-5.4", description: "Strong frontier default for complex agentic work" },
      { id: "gpt-5-codex", name: "GPT-5-Codex", description: "GPT-5 optimized for Codex-style coding" },
      { id: "gpt-5.3-codex", name: "GPT-5.3-Codex", description: "Agentic coding model with xhigh reasoning support" },
      { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", description: "Faster and cheaper than GPT-5.4" },
    ];
    return dedupeCliModels([...defaultModels, ...(await fetchOpenAiCliModels(apiKey))]);
  }
  // For non-Claude/Codex adapters, fall back to whatever static list the
  // adapter supplies (opencode, gemini both ship a baseline).
  const adapter = tryGetAdapter(runtime);
  if (!adapter) return [];
  const apiKeys: Record<string, string | undefined> = {};
  if (runtime === "gemini") apiKeys.google = apiKey;
  else if (runtime === "opencode") apiKeys.anthropic = apiKey;
  return adapter.listModels({ apiKeys: apiKeys as any });
}

function resolveCliPathOverride(
  runtime: AgentRuntime,
  integrations: Record<string, unknown>,
  requestedPath?: unknown,
): string | undefined {
  if (typeof requestedPath === "string" && requestedPath.trim()) return requestedPath.trim();
  const adapter = tryGetAdapter(runtime);
  if (!adapter) return undefined;
  const value = integrations[adapter.pathSettingKey];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Pick the runtime-specific API key for the legacy single-key plumbing. */
function resolveRuntimeApiKey(runtime: AgentRuntime, integrations: Record<string, unknown>): string | undefined {
  const adapter = tryGetAdapter(runtime);
  if (!adapter) return undefined;
  // Prefer the most-relevant integration key per runtime, fall back to env.
  if (runtime === "claude-code" || runtime === "opencode") {
    return (integrations.anthropicKey as string) || process.env.ANTHROPIC_API_KEY || undefined;
  }
  if (runtime === "codex") {
    return (integrations.openaiKey as string) || process.env.OPENAI_API_KEY || undefined;
  }
  if (runtime === "gemini") {
    return (
      (integrations.geminiKey as string) ||
      process.env.GOOGLE_API_KEY ||
      process.env.GEMINI_API_KEY ||
      undefined
    );
  }
  return undefined;
}

interface SpawnApiKeyBundle {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  openrouterApiKey?: string;
}

/** Build the full set of API keys to forward into spawnSession/resumeSession. */
function buildSpawnApiKeys(integrations: Record<string, unknown>): SpawnApiKeyBundle {
  return {
    anthropicApiKey:
      (integrations.anthropicKey as string) || process.env.ANTHROPIC_API_KEY || undefined,
    openaiApiKey:
      (integrations.openaiKey as string) || process.env.OPENAI_API_KEY || undefined,
    googleApiKey:
      (integrations.geminiKey as string) ||
      process.env.GOOGLE_API_KEY ||
      process.env.GEMINI_API_KEY ||
      undefined,
    openrouterApiKey:
      (integrations.openrouterKey as string) || process.env.OPENROUTER_API_KEY || undefined,
  };
}

async function listRuntimeModels(
  runtime: AgentRuntime,
  integrations: Record<string, unknown>,
  requestedPath?: unknown,
) {
  const cliPath = resolveCliPathOverride(runtime, integrations, requestedPath);
  const nativeModels = await listCliModels(
    runtime,
    cliPath,
  ).catch(() => []);

  if (nativeModels.length > 0) {
    return nativeModels.map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description,
      defaultReasoningEffort: model.defaultReasoningEffort ?? null,
      hidden: model.hidden ?? false,
      isDefault: model.isDefault ?? false,
      supportedReasoningEfforts: model.supportedReasoningEfforts ?? [],
    }));
  }

  return buildCliModelOptions(runtime, resolveRuntimeApiKey(runtime, integrations));
}

function buildResumePrompt(runtime: AgentRuntime, prompt?: string): string {
  if (typeof prompt === "string" && prompt.trim()) return prompt.trim();
  const adapter = tryGetAdapter(runtime);
  return (
    adapter?.defaultResumePrompt() ||
    "Resume the previous estimate session. Read CLAUDE.md, check the current state with getWorkspace and getEstimateStrategy, then continue from where you left off. Do not re-create phases, worksheets, or items that already exist."
  );
}

async function bindEstimateStrategyRun(projectId: string, revisionId: string | null | undefined, aiRunId: string) {
  if (!revisionId) return;

  await prisma.estimateStrategy.upsert({
    where: { revisionId },
    create: {
      projectId,
      revisionId,
      aiRunId,
      status: "in_progress",
      currentStage: "scope",
    },
    update: {
      aiRunId,
    },
  }).catch(() => {});
}

async function resolveEstimatorPersonaForPrompt(store: any, personaId: string | undefined) {
  if (!personaId) return null;
  const persona = await store.getEstimatorPersona(personaId);
  if (!persona) return null;

  const bookIds: string[] = Array.isArray(persona.knowledgeBookIds)
    ? persona.knowledgeBookIds
    : JSON.parse(persona.knowledgeBookIds as string || "[]");
  const knowledgeDocumentIds: string[] = Array.isArray((persona as any).knowledgeDocumentIds)
    ? (persona as any).knowledgeDocumentIds
    : JSON.parse((persona as any).knowledgeDocumentIds as string || "[]");
  const datasetTags: string[] = Array.isArray(persona.datasetTags)
    ? persona.datasetTags
    : JSON.parse(persona.datasetTags as string || "[]");

  let bookNames: string[] = [];
  let knowledgeDocumentNames: string[] = [];
  if (bookIds.length > 0) {
    const books = await Promise.all(bookIds.map((id) => store.getKnowledgeBook(id).catch(() => null)));
    bookNames = books.flatMap((book: any) => book?.name ? [book.name] : []);
  }
  if (knowledgeDocumentIds.length > 0) {
    const documents = await Promise.all(knowledgeDocumentIds.map((id) => store.getKnowledgeDocument(id).catch(() => null)));
    knowledgeDocumentNames = documents.flatMap((document: any) => document?.title ? [document.title] : []);
  }

  return {
    name: persona.name,
    trade: persona.trade,
    systemPrompt: persona.systemPrompt,
    knowledgeBookNames: bookNames,
    knowledgeDocumentNames,
    datasetTags,
    packageBuckets: Array.isArray((persona as any).packageBuckets) ? (persona as any).packageBuckets : [],
    defaultAssumptions: ((persona as any).defaultAssumptions as Record<string, unknown>) ?? {},
    productivityGuidance: ((persona as any).productivityGuidance as Record<string, unknown>) ?? {},
    commercialGuidance: ((persona as any).commercialGuidance as Record<string, unknown>) ?? {},
    reviewFocusAreas: Array.isArray((persona as any).reviewFocusAreas) ? (persona as any).reviewFocusAreas : [],
  };
}

async function prepareCliAgentWorkspace(input: {
  request: FastifyRequest;
  workspace: any;
  projectId: string;
  runtime: AgentRuntime;
  scope?: string;
  personaId?: string;
}) {
  const { request, workspace, projectId, runtime } = input;
  const store = request.store!;
  const project = workspace.project || {} as any;
  const quote = workspace.quote || {} as any;
  const effectiveScope = typeof input.scope === "string" && input.scope.trim()
    ? input.scope.trim()
    : typeof project.scope === "string" && project.scope.trim()
      ? project.scope.trim()
      : "";
  const documents = (workspace.sourceDocuments || []).map((d: any) => ({
    id: d.id,
    fileName: d.fileName,
    fileType: d.fileType,
    documentType: d.documentType,
    pageCount: d.pageCount || 0,
    storagePath: d.storagePath || "",
  }));

  const projectDir = resolveProjectDir(projectId);
  const knowledgeBooks = await store.listKnowledgeBooks() || [];
  const globalBooks = knowledgeBooks.filter((b: any) => b.scope === "global" && b.storagePath);
  const linkedBookNames = globalBooks.length > 0
    ? await symlinkKnowledgeBooks(
        projectDir,
        apiDataRoot,
        globalBooks.map((b: any) => ({ bookId: b.id, fileName: b.sourceFileName || b.name, storagePath: b.storagePath })),
      )
    : [];

  const knowledgeDocuments = await store.listKnowledgeDocuments(projectId) || [];
  const documentSnapshots = [];
  for (const document of knowledgeDocuments as any[]) {
    const pages = await store.listKnowledgeDocumentPages(document.id).catch(() => []);
    if (pages.length > 0) {
      documentSnapshots.push({
        id: document.id,
        title: document.title,
        description: document.description,
        category: document.category,
        tags: document.tags ?? [],
        pages,
      });
    }
  }
  const linkedKnowledgePageNames = documentSnapshots.length > 0
    ? await writeKnowledgeDocumentSnapshots(projectDir, documentSnapshots)
    : [];
  const librarySnapshot = await writeAgentLibrarySnapshot({
    projectDir,
    projectId,
    organizationId: request.user?.organizationId,
    store,
  });

  const settings = await store.getSettings();
  const integrations = (settings as any)?.integrations || {};
  const estimateDefaults = (settings as any)?.defaults || {};
  const persona = await resolveEstimatorPersonaForPrompt(store, input.personaId);

  await generateInstructionFiles(runtime, {
    projectDir,
    projectName: project.name || "Untitled Project",
    clientName: project.clientName || "",
    location: project.location || "",
    scope: effectiveScope,
    quoteNumber: quote.quoteNumber || "",
    dataRoot: apiDataRoot,
    documents,
    knowledgeBookFiles: linkedBookNames,
    knowledgeDocumentFiles: linkedKnowledgePageNames,
    librarySnapshot,
    estimateDefaults,
    maxConcurrentSubAgents: integrations.maxConcurrentSubAgents ?? 2,
    persona,
  });

  return {
    projectDir,
    effectiveScope,
    documents,
    settings,
    integrations,
  };
}

function attachCliRunPersistence(
  runId: string,
  session: { events: { on: (event: string, handler: (payload: any) => void) => void } },
) {
  let eventBuffer: PersistedCliEvent[] = [];
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

    const flushEvents = async () => {
      if (eventBuffer.length === 0) return;
      const toSave = [...eventBuffer];
      eventBuffer = [];
      try {
        await withCliRunWriteLock(runId, async () => {
          const run = await prisma.aiRun.findFirst({ where: { id: runId } });
          const existing = ((run?.output as any)?.events || []) as PersistedCliEvent[];
          await prisma.aiRun.update({
            where: { id: runId },
            data: {
              output: {
                events: mergeCliEvents(existing, toSave.map((event) => sanitizeCliEventForPersistence(event) as PersistedCliEvent)),
              } as any,
            },
          });
        });
      } catch (err) {
        console.error(`[cli] Failed to persist events for ${runId}:`, err);
        eventBuffer.unshift(...toSave);
      }
  };

  const scheduleFlush = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      await flushEvents();
    }, 3000);
  };

  session.events.on("event", (evt: any) => {
    const enriched = sanitizeCliEventForPersistence(enrichCliToolEvent(evt)) as PersistedCliEvent;
    eventBuffer.push({ ...enriched, timestamp: enriched?.timestamp || new Date().toISOString() });
    scheduleFlush();
  });

  session.events.on("done", async (finalStatus: string) => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    try {
      await flushEvents();
      await prisma.aiRun.update({
        where: { id: runId },
        data: { status: finalStatus },
      });
    } catch (err) {
      console.error(`[cli] Failed to persist final status for ${runId}:`, err);
    }
  });
}

export function registerCliRoutes(app: FastifyInstance) {

  // ── CLI Detection + Auth Status ──────────────────────────────
  app.get("/api/cli/detect", async (request) => {
    const store = request.store!;
    const settings = await store.getSettings();
    const integrations = (settings as any)?.integrations || {};
    const configuredRuntime = isCliRuntime(integrations.agentRuntime) ? integrations.agentRuntime : null;
    const configuredModel = configuredRuntime ? normalizeCliModel(configuredRuntime, integrations.agentModel) : null;

    // Build a per-adapter status block plus a flat `runtimes` map so the
    // settings UI can render any number of CLIs without code changes.
    const runtimes: Record<string, any> = {};
    for (const adapter of listAdapters()) {
      const cliPath = resolveCliPathOverride(adapter.id, integrations) || undefined;
      const detected = detectCli(adapter.id, cliPath);
      const auth = checkCliAuth(adapter.id, resolveRuntimeApiKey(adapter.id, integrations));
      const models = detected.available
        ? await listRuntimeModels(adapter.id, integrations).catch(() => [])
        : [];
      runtimes[adapter.id] = {
        id: adapter.id,
        displayName: adapter.displayName,
        installHint: adapter.installHint,
        pathSettingKey: adapter.pathSettingKey,
        primaryInstructionFile: adapter.primaryInstructionFile,
        experimental: adapter.experimental === true,
        ...detected,
        auth,
        models,
      };
    }

    return {
      // Legacy keys preserved for the existing settings UI / api.ts shape.
      claude: runtimes["claude-code"] || { available: false, path: "", auth: { authenticated: false, method: "none" } },
      codex: runtimes["codex"] || { available: false, path: "", auth: { authenticated: false, method: "none" } },
      runtimes,
      configured: {
        runtime: configuredRuntime,
        model: configuredModel,
      },
    };
  });

  // ── Start CLI Session ───────────────────────────────────────
  app.get("/api/cli/models", async (request, reply) => {
    const runtime = (request.query as any)?.runtime;
    const requestedPath = (request.query as any)?.path;
    if (!isCliRuntime(runtime)) {
      return reply.code(400).send({ error: "runtime must be 'claude-code' or 'codex'" });
    }

    const store = request.store!;
    const settings = await store.getSettings();
    const integrations = (settings as any)?.integrations || {};
    const cliPath = resolveCliPathOverride(runtime, integrations, requestedPath);
    const detected = detectCli(
      runtime,
      cliPath,
    );

    if (!detected.available) {
      return reply.code(404).send({ error: `${runtime} is not installed` });
    }

    return {
      runtime,
      models: await listRuntimeModels(runtime, integrations, cliPath),
      queriedAt: new Date().toISOString(),
    };
  });

  app.post("/api/cli/start", async (request, reply) => {
    const body = request.body as {
      projectId: string;
      runtime?: AgentRuntime;
      model?: string;
      scope?: string;
      prompt?: string;
      personaId?: string;
    };

    const { projectId, scope, prompt } = body;
    const store = request.store!;

    // Get project context
    const workspace = await store.getWorkspace(projectId);
    if (!workspace) return reply.code(404).send({ error: "Project not found" });

    const project = workspace.project || {} as any;
    const quote = workspace.quote || {} as any;
    const revision = workspace.currentRevision || {} as any;

    // ── Block while document extraction is still running ────────────────
    // The ingestion worker creates SourceDocument rows incrementally and may
    // delete-and-replace them when extraction completes. Generating the
    // CLAUDE.md / AGENTS.md / GEMINI.md manifest from a partial workspace
    // produces stale doc IDs that the agent can't resolve, which sends it
    // down expensive shell-OCR fallback paths. Refuse to start until the
    // project's ingestion status reaches a ready state.
    const ingestionBlock = ingestionStartBlock(project);
    if (ingestionBlock) return reply.code(409).send(ingestionBlock);

    const effectiveScope = typeof scope === "string" && scope.trim()
      ? scope.trim()
      : typeof project.scope === "string" && project.scope.trim()
        ? project.scope.trim()
        : "";
    const documents = (workspace.sourceDocuments || []).map((d: any) => ({
      id: d.id,
      fileName: d.fileName,
      fileType: d.fileType,
      documentType: d.documentType,
      pageCount: d.pageCount || 0,
      storagePath: d.storagePath || "",
    }));

    // Fetch persona if provided
    let persona = null;
    if (body.personaId) {
      persona = await store.getEstimatorPersona(body.personaId);
    }

    const projectDir = resolveProjectDir(projectId);

    // Symlink global knowledge books FIRST so CLAUDE.md can reference them
    const knowledgeBooks = await store.listKnowledgeBooks() || [];
    const globalBooks = knowledgeBooks.filter((b: any) => b.scope === "global" && b.storagePath);
    let linkedBookNames: string[] = [];
    if (globalBooks.length > 0) {
      linkedBookNames = await symlinkKnowledgeBooks(
        projectDir,
        apiDataRoot,
        globalBooks.map((b: any) => ({ bookId: b.id, fileName: b.sourceFileName || b.name, storagePath: b.storagePath }))
      );
    }

    const knowledgeDocuments = await store.listKnowledgeDocuments(projectId) || [];
    const documentSnapshots = [];
    for (const document of knowledgeDocuments as any[]) {
      const pages = await store.listKnowledgeDocumentPages(document.id).catch(() => []);
      if (pages.length > 0) {
        documentSnapshots.push({
          id: document.id,
          title: document.title,
          description: document.description,
          category: document.category,
          tags: document.tags ?? [],
          pages,
        });
      }
    }
    const linkedKnowledgePageNames = documentSnapshots.length > 0
      ? await writeKnowledgeDocumentSnapshots(projectDir, documentSnapshots)
      : [];
    const librarySnapshot = await writeAgentLibrarySnapshot({
      projectDir,
      projectId,
      organizationId: request.user?.organizationId,
      store,
    });

    // Fetch settings early so we can pass integrations into CLAUDE.md params
    const settingsEarly = await store.getSettings();
    const integrationsEarly = (settingsEarly as any)?.integrations || {};
    const estimateDefaults = (settingsEarly as any)?.defaults || {};
    const runtime = resolveCliRuntime(body.runtime, integrationsEarly.agentRuntime);
    const adapter = getAdapter(runtime);
    const model = normalizeCliModel(runtime, body.model ?? integrationsEarly.agentModel);
    const reasoningEffort = normalizeCliReasoningEffort(integrationsEarly.agentReasoningEffort);

    // Generate per-runtime instruction files (CLAUDE.md / AGENTS.md / GEMINI.md)
    const params = {
      projectDir,
      projectName: project.name || "Untitled Project",
      clientName: project.clientName || "",
      location: project.location || "",
      scope: effectiveScope,
      quoteNumber: quote.quoteNumber || "",
      dataRoot: apiDataRoot,
      documents,
      knowledgeBookFiles: linkedBookNames,
      knowledgeDocumentFiles: linkedKnowledgePageNames,
      librarySnapshot,
      estimateDefaults,
      maxConcurrentSubAgents: integrationsEarly.maxConcurrentSubAgents ?? 2,
      persona: persona ? await (async () => {
        const bookIds: string[] = Array.isArray(persona.knowledgeBookIds) ? persona.knowledgeBookIds : JSON.parse(persona.knowledgeBookIds as string || "[]");
        const knowledgeDocumentIds: string[] = Array.isArray((persona as any).knowledgeDocumentIds)
          ? (persona as any).knowledgeDocumentIds
          : JSON.parse((persona as any).knowledgeDocumentIds as string || "[]");
        const datasetTags: string[] = Array.isArray(persona.datasetTags) ? persona.datasetTags : JSON.parse(persona.datasetTags as string || "[]");
        // Resolve book IDs to human-readable names for the agent prompt
        let bookNames: string[] = [];
        let knowledgeDocumentNames: string[] = [];
        if (bookIds.length > 0) {
          const books = await Promise.all(bookIds.map((id) => store.getKnowledgeBook(id).catch(() => null)));
          bookNames = books.flatMap((book: any) => book?.name ? [book.name] : []);
        }
        if (knowledgeDocumentIds.length > 0) {
          const documents = await Promise.all(knowledgeDocumentIds.map((id) => store.getKnowledgeDocument(id).catch(() => null)));
          knowledgeDocumentNames = documents.flatMap((document: any) => document?.title ? [document.title] : []);
        }
        return {
          name: persona.name,
          trade: persona.trade,
          systemPrompt: persona.systemPrompt,
          knowledgeBookNames: bookNames,
          knowledgeDocumentNames,
          datasetTags,
          packageBuckets: Array.isArray((persona as any).packageBuckets) ? (persona as any).packageBuckets : [],
          defaultAssumptions: ((persona as any).defaultAssumptions as Record<string, unknown>) ?? {},
          productivityGuidance: ((persona as any).productivityGuidance as Record<string, unknown>) ?? {},
          commercialGuidance: ((persona as any).commercialGuidance as Record<string, unknown>) ?? {},
          reviewFocusAreas: Array.isArray((persona as any).reviewFocusAreas) ? (persona as any).reviewFocusAreas : [],
        };
      })() : null,
    };

    await generateInstructionFiles(runtime, params);

    // Create AiRun record. If the user typed an explicit prompt to kick the
    // session off, seed it as a "message" event so the chat panel renders
    // (and keeps rendering across reloads/polls) the user's bubble.
    const sessionId = `cli-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const seededEvents: PersistedCliEvent[] = [];
    if (typeof prompt === "string" && prompt.trim()) {
      seededEvents.push({
        type: "message",
        data: { role: "user", content: prompt.trim() },
        timestamp: new Date().toISOString(),
      });
    }
    await store.createAiRun({
      id: sessionId,
      projectId,
      revisionId: revision.id || "",
      kind: "cli-intake",
      status: "running",
      model: model || adapter.defaultModel,
      input: { runtime, scope: effectiveScope, documentCount: documents.length } as any,
      output: { events: seededEvents } as any,
    });

    await prisma.estimateStrategy.upsert({
      where: { revisionId: revision.id || "" },
      create: {
        projectId,
        revisionId: revision.id || "",
        aiRunId: sessionId,
        personaId: body.personaId || null,
        status: "in_progress",
        currentStage: "scope",
      },
      update: {
        aiRunId: sessionId,
        personaId: body.personaId || undefined,
        status: "in_progress",
        currentStage: "scope",
      },
    }).catch(() => {});

    // Get settings for auth token
    const settings = await store.getSettings();
    const integrations = (settings as any)?.integrations || {};
    const benchmarkingEnabled = (settings as any)?.defaults?.benchmarkingEnabled !== false;
    const instructionFile = adapter.primaryInstructionFile;

    // Spawn CLI
    const scopeDirective = effectiveScope
      ? `\n\nUSER SCOPE / COMMERCIAL INSTRUCTIONS (AUTHORITATIVE):\n${effectiveScope}\nTreat these instructions as binding commercial direction. If the user says an activity is subcontracted, already priced, owner-supplied, or otherwise commercially decided, do not re-estimate that package as self-performed labour unless the user explicitly asks for a validation breakdown.`
      : "";

    const startupDirective = `Read ${instructionFile} now. Then read the compact files library-snapshots/README.md and library-snapshots/library-index.md before pricing anything. Bidwright has dropped first-party library text corpora into library-snapshots/search in this runtime folder; use rg/grep or searchLibraryCorpus for fast retrieval across cost intelligence, catalogs, rates, labour units, assemblies, datasets, and knowledge indexes. Do not read large JSONL snapshots, all-library.search.txt, or files-manifest.jsonl wholesale; search them and use MCP tools for focused reads. Search/recommendation tools retrieve candidates only; the agent is responsible for relevance and source authority decisions. If you use TodoWrite, every todo object must include status exactly "pending", "in_progress", or "completed"; do not omit status on pending items. Use only Bidwright readMemory/writeMemory for project memory. Do not read, grep, inspect, write, or edit Claude global/project memory files under ~/.claude, previous-run memory folders, prior harness summaries, or files outside the project workspace unless the user explicitly provided them as current project inputs or asked for file edits.

BOM/SPREADSHEET REQUIREMENT: Before visual takeoff, inventory spreadsheet, CSV, BOM, bill-of-materials, parts-list, schedule, quote-sheet, and takeoff artifacts. Read spreadsheets with readSpreadsheet. For table-heavy PDF BOMs/parts lists, use getDocumentStructured plus focused readDocumentText. Treat those tables as high-authority quantity sources unless explicit source evidence proves they are superseded. A later drawing date or an isolated drawing callout is not enough by itself: it may have missing context. If BOM/spec/schedule values and drawing values disagree, record both source values in the Drawing Evidence Engine ledger when possible, then either use the BOM/spec/schedule baseline, attach explicit supersession/order-of-precedence/client-or-vendor confirmation evidence, or carry an assumption/ask the user. A carried assumption is not permission to price the lower-context drawing value as baseline when a BOM/spec/table carries the higher value; use the high-authority baseline plus a clarification/alternate unless the user/vendor/client explicitly confirms otherwise. For high-risk vendor/component/accessory counts, save dedicated quantity claims. Do not bury counts inside dimensions, weights, or source-note prose. Search both formal tables and relevant drawings when both exist; if they differ, save separate claims for both values before pricing.
When saving Drawing Evidence Engine claims, use method "bom_table" only for actual BOM, parts-list, schedule, spec-sheet, vendor-quote, model-BOM, or comparable quantity-table evidence. Use "ocr_text" for ordinary drawing notes, lift-plan text, general callouts, or OCR snippets that are not a formal quantity table/source.

VISUAL DRAWING REQUIREMENT: If the project contains drawings, build the Drawing Evidence Engine before saving drawing-driven scope/quantity decisions or pricing rows that depend on drawings. Azure/local extraction and PDF-native evidence are available immediately; LandingAI enrichment is optional background evidence and must not block your first estimating pass. Completed cached LandingAI regions may be reused when present. If one or more relevant PDFs are missing from the atlas, call addSourceToDrawingAtlas for each with a rationale and leave rebuildAtlas false unless you are adding a single urgent source; then call buildDrawingAtlas({ force: true }) once or let the next searchDrawingRegions perform a single lazy rebuild. When LandingAI finishes, you may be interrupted/resumed with a background evidence update; then rebuild/search the atlas and incorporate the new regions without duplicating existing worksheets, rows, packages, or claims. Call buildDrawingAtlas once, use searchDrawingRegions for the exact object/detail/BOM/count you need to prove, then inspectDrawingRegion on selected regions to get targeted high-res crop evidence. Prioritize high-authority table/spec/schedule matches returned by searchDrawingRegions before accepting a lower-context visual count. Only call concrete tools returned by ToolSearch; a server namespace without a concrete tool suffix is not callable and counts as a failed tool call. Use the actual returned drawing tools, such as searchDrawingRegions, inspectDrawingRegion, and saveDrawingEvidenceClaim. Do not guess random page crops and do not mark drawing inspection complete after full-page renders alone. readDocumentText/OCR from a drawing is useful context, not a visual takeoff. Before pricing drawing-derived quantities or finalizing, deliberately probe high-risk visual facts the way an estimator would: repeated components, connection counts, dimensions, equipment data, BOM/table quantities, and sheet conflicts. For structural/member takeoff, distinguish physical placements from unique mark IDs; price physical occurrences unless a schedule/BOM explicitly says marks are already totals. For every drawing-driven quantity claim, call saveDrawingEvidenceClaim with doc/page/region/bbox/tool/result/imageHash. If another source gives a different value, save the competing claim too or carry an explicit reconciled assumption; do not hide the conflict only in sourceNotes. Worksheet rows use evidenceBasis as a two-axis contract: evidenceBasis.quantity explains where the quantity/hours/duration came from, and evidenceBasis.pricing explains where the unit cost/rate/productivity came from. Put drawing_quantity/visual_takeoff/drawing_table/drawing_note and Drawing Evidence Engine claim IDs under evidenceBasis.quantity when the quantity is drawing-derived; put rate/manual/vendor/material/equipment/subcontract/document/allowance/indirect/assumption/mixed support under evidenceBasis.pricing. Run verifyDrawingEvidenceLedger before pricing drawing-driven rows and before finalize; reconcile contradictions or carry an explicit assumption. renderDrawingPage/zoomDrawingRegion are lower-level fallbacks for additional evidence, and symbol/count tools belong only after a specific tiny symbol has been visually identified. Persist the pass in saveEstimateScopeGraph.visualTakeoffAudit with completedBeforePricing:true only after ledger-backed visual evidence exists for drawing-driven packages. Use zoomEvidence only for targeted inspected crops; record BOM/schedule/parts-list extraction in tableEvidence unless you inspected a targeted table region.${scopeDirective}`;
    const userPrompt = typeof prompt === "string" && prompt.trim() ? prompt.trim() : "";
    const initialPrompt = userPrompt
      ? `${startupDirective}\n\nThen follow this user request:\n${userPrompt}`
      : `${startupDirective} Then execute the staged estimate workflow in order:

1. Read the documents, build/search/inspect the drawing atlas when drawings exist, save ledger claims for drawing-driven quantities, verify the ledger, and save the structured scope graph with saveEstimateScopeGraph including visualTakeoffAudit.
2. Search the runtime first-party text corpora in library-snapshots/search with rg/searchLibraryCorpus plus MCP knowledge/dataset/cost/labour tools for relevant books, datasets, cost intelligence, labour units, assemblies, catalogs, and rate books. The tools retrieve candidates only; the agent decides relevance, source authority, exact/similar/context/manual basis, and final worksheet rationale.
3. Lock the execution model with saveEstimateExecutionPlan and saveEstimateAssumptions.
4. Define the commercial/package structure with saveEstimatePackagePlan. Every package must include explicit planned worksheetName/textMatcher bindings; after worksheets exist, re-save the package plan with exact worksheetIds before finalize. Package bindings must be exclusive. Subcontract/allowance packages must not bind labour rows; put self-perform supervision/coordination in a separate detailed/general-conditions package. If supervision is carried in General Conditions/single-source mode, avoid foreman/superintendent/supervision/supervisor/general foreman/lead hand/leadman wording in execution worksheet labour row names, descriptions, and source notes.
5. ${benchmarkingEnabled ? "Run recomputeEstimateBenchmarks and review the historical comparison before creating labour hours, then run it again after worksheets/items and recalculateTotals before final reconcile." : "Skip recomputeEstimateBenchmarks because organization benchmarking is disabled. Without historical comparables, project an expected envelope from the source documents (line lists, BOMs, schedules, vendor quotes, scope tables, spec narratives, knowledge books, datasets) before pricing, record that projection and its evidence in saveEstimateAdjustments, and after worksheets/items exist recompare the built subtotal package-by-package against the projection so any package that materially exceeds or undershoots its projected envelope is caught and revised."}

EVIDENCE DISCIPLINE (mandatory, domain-agnostic):
- Every productivity-derived Labour row (any row whose hours come from quantity × rate, per-unit duration, or 'blended' productivity) MUST cite EITHER (a) a concrete laborUnitId from listLaborUnits/listLaborUnitTree/getLaborUnit with the source rate and any difficulty/condition multipliers reproduced in sourceNotes, OR (b) a specific source-document citation (spreadsheet sheet+row/cell, BOM/schedule line, knowledge-book table+row, dataset row) that supplies the hours/duration directly. Inventing productivity numbers without one of those references is forbidden in any trade or scope.
- Every Material and Subcontractor row MUST start with a cost-intelligence search via searchLineItemCandidates/recommendCostSource using the row's scope/SKU/equipment phrase before any price is written. Each priced Material/Subcontractor row resolves to one of these citations: (a) a structured cost-intelligence link — preserve costResourceId, effectiveCostId, or itemId on the row and reproduce the matched vendor/SKU/observation/source in sourceNotes; an exact match is preferred, a similar/analog match is acceptable as a ballpark with the analog rationale and confidence noted; (b) a vendor-quote document with specific document + page/section reference; (c) a knowledge-book/dataset/catalog citation with row/page; (d) an explicit assumption recording that cost-intelligence and the document set were searched and produced no usable match, including the search terms tried and a flag that vendor finalization is required. "Estimator allocation", "lump-sum allowance", or "industry-typical" alone — without a search-attempted record — is not acceptable on any priced row.
- If the source documents already contain hours/durations or vendor pricing for a package, prefer those over derived numbers; only derive when the source is silent and record the gap explicitly.
- Cost-intelligence is a per-organization corpus of prior-invoice/observation data — exact matches are most authoritative, similar matches are useful for triangulation, and a recorded "no match found" assumption is the right answer when the corpus does not cover this scope. Treat similar matches as ballpark figures (the human reviewer will refine with vendor quotes), not as final pricing.

SCOPE-TABLE COVERAGE (mandatory, domain-agnostic):
- Most RFQs/specs include a contractor-responsibility table or equivalent narrative. Read it before writing the package plan. Every scope item flagged as contractor-responsible must appear in the package plan as a Subcontractor line, an Allowance, an Equipment Rental line, or a Labour package with an explicit self-perform assumption documenting why.
- For specialty packages mentioned in the spec narrative but not in a formal scope table, decide subcontract vs self-perform from spec wording (third-party qualifications, certifications, vendor turnkey language, registration/inspection authority) and from rate-schedule availability; record the decision and rationale.
- Coverage is enforced at finalize through reconcileReport.coverageChecks: enumerate every contractor-responsible package you identified from the spec/scope-table/RFQ. Each coverageCheck must include name (the package as it appears in the source), sourceRef (document + page/section), status ('ok' once resolved), and either coveredBy.packageId/coveredBy.worksheetIds linking it to the plan, or coveredBy.assumptionId tied to a saved assumption that documents why it is not a dedicated plan entry. Entries with status='warning' or status='missing' will block finalize. If you genuinely identify no contractor-responsible specialty packages, add a single coverageCheck saying so and cite the spec section that confirms it.

CATEGORIZATION (use the system, not gut feel):
- Categorize every row using the entityCategories returned by getItemConfig and the imported rate schedule's category mapping. If an item matches a Rental Equipment / Equipment / Subcontractor rate-schedule item, use createRateScheduleWorksheetItem against that linked id; do not place it under Material because the row also has a price.
- Rentals (returned at end of project, weekly/monthly rate, vendor-owned) → Rental Equipment. Vendor turnkey packages → Subcontractor. Owned consumed-on-job small-tools/consumables → Consumables or Material per category definitions. Supervisory and trade hours → Labour with the matching rate-schedule tier.

6. Call updateQuote, getItemConfig, import needed rate schedules, then create worksheets/items. Before creating priced rows, use rg/searchLibraryCorpus and the authoritative MCP tools to gather first-party candidates; use searchLineItemCandidates/recommendEstimateBasis/recommendCostSource/listLaborUnitTree/listLaborUnits/getLaborUnit as candidate retrieval, not as source-selection authority. For labour productivity, browse the tree, use compact listLaborUnits for candidate search, and call getLaborUnit only for focused details on a shortlisted unit. Use queryKnowledge/queryDatasets when productivity, crew logic, standards, or estimator-book support would materially change the answer. If you use a labor unit as an analog, the agent must explain why the operation/unit/context is defensible and record the limitation in sourceNotes. For rate_schedule labour/equipment/general-conditions rows, prefer createRateScheduleWorksheetItem: provide the linked rateScheduleItemId and positive tierUnits/quantities only; the tool derives category/name and the system calculates cost/sell from the rate item. Use estimate factors for productivity, access, weather, safety, schedule, method, condition, escalation, or other multiplicative adjustments. Use global/scoped factors for broad impacts, and after worksheet items exist use line-level factors with applicationScope:"line" and scope:{mode:"line",worksheetItemIds:[...]} for row-specific impacts. Call listEstimateFactorLibrary with q/category filters, then listEstimateFactors/create/update factors with sourceRef evidence, then recalculateTotals/getWorkspace to verify factor totals and affected target lines. Do not hide factor effects inside quantities, tierUnits, unit costs, or hand-calculated labour values. Every worksheet row needs evidenceBasis when drawings exist. Prefer evidenceBasis.quantity.type for quantity provenance and evidenceBasis.pricing.type for cost/rate/productivity provenance. If a row has quantity from a drawing/model/takeoff and pricing from a material quote, use separate quantity and pricing basis fields; do not collapse both into one misleading type. For every rate_schedule category, including Rental Equipment, Labour, Equipment, and General Conditions resources, fetch a concrete rateScheduleItemId with listRateScheduleItems and preserve positive tierUnits as a JSON object, never a quoted/stringified value; do not pass cost, price, or markup for those rows because the system calculates them from the linked rate item; do not create or "clean up" those rows by omitting, nulling, or zeroing rateScheduleItemId/tierUnits.
7. Build the quote summary breakout with applySummaryPreset using the most appropriate preset for the actual worksheet/phase structure, re-save package bindings against the actual worksheets, then perform a fresh post-build evidence falsification pass before saveEstimateReconcile/finalizeEstimateStrategy. This is not a prose-only checklist: after worksheet items exist, call concrete source tools again. Re-search/inspect at least one drawing region or re-read the governing BOM/spec for drawing quantities, and re-search library/knowledge/rate evidence for the largest labour or priced rows. Use those fresh post-build source-return calls to look for contradictions, missing scope, or unsupported unit prices/hours. If you cannot make those calls, do not finalize; ask the user or state the blocker. If finalizeEstimateStrategy returns validation issues, repair them and retry until it succeeds or ask the user about a true blocker. When fixing supervision/package validation, choose one coverage model and move/relabel rows with valid positive rate-schedule tiers; do not zero out tierUnits to remove supervision.

CRITICAL: Do not jump from document facts straight into line-item hours. The estimate is only valid after the scope graph, execution plan, package plan, ${benchmarkingEnabled ? "benchmark pass, " : ""}adjustment pass, and reconcile pass are all saved.`;

    try {
      const session = await spawnSession({
        projectId,
        projectDir,
        prompt: initialPrompt,
        runtime,
        model,
        reasoningEffort,
        authToken: extractAuthToken(request),
        apiBaseUrl: `http://localhost:${process.env.API_PORT || 4001}`,
        revisionId: revision.id,
        quoteId: quote.id,
        customCliPath: resolveCliPathOverride(runtime, integrations),
        ...buildSpawnApiKeys(integrations),
      });

      attachCliRunPersistence(sessionId, session);

      return { sessionId, projectId, runtime, status: "running" };
    } catch (err) {
      await store.updateAiRun(sessionId, { status: "failed" });
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Failed to start CLI" });
    }
  });

  // ── SSE Stream ──────────────────────────────────────────────
  app.get("/api/cli/:projectId/stream", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const session = getSession(projectId);

    if (!session) {
      return reply.code(404).send({ error: "No active session for this project" });
    }

    // Set SSE headers manually and hijack the response so Fastify doesn't close it
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });

    // Send initial ping so the client knows it's connected
    reply.raw.write(`: connected\n\n`);

    // Forward events from CLI process to SSE
    const onEvent = (evt: any) => {
      try {
        const enriched = enrichCliToolEvent(evt);
        const payload = JSON.stringify(enriched.data);
        reply.raw.write(`event: ${enriched.type}\ndata: ${payload}\n\n`);
      } catch {}
    };

    session.events.on("event", onEvent);

    // Keep-alive ping every 15s
    const pingTimer = setInterval(() => {
      try { reply.raw.write(`: ping\n\n`); } catch {}
    }, 15_000);

    // When session ends, close SSE
    const onDone = () => {
      session.events.off("event", onEvent);
      clearInterval(pingTimer);
      try { reply.raw.end(); } catch {}
    };
    session.events.once("done", onDone);

    // Cleanup on client disconnect
    reply.raw.on("close", () => {
      session.events.off("event", onEvent);
      session.events.off("done", onDone);
      clearInterval(pingTimer);
    });

    // IMPORTANT: Don't return anything — keep the connection open
    // Fastify will not auto-close because we already wrote to reply.raw
  });

  // ── Stop Session ────────────────────────────────────────────
  app.post("/api/cli/:projectId/stop", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const stopped = stopSession(projectId);
    return { stopped };
  });

  // ── Resume Session ──────────────────────────────────────────
  app.post("/api/cli/:projectId/resume", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = (request.body || {}) as { prompt?: string; model?: string };
    const projectDir = resolveProjectDir(projectId);
    const store = request.store!;
    const workspace = await store.getWorkspace(projectId);
    if (!workspace) {
      return reply.code(404).send({ error: "Project not found" });
    }

    const settings = await store.getSettings();
    const integrations = (settings as any)?.integrations || {};
    const latestRun = await prisma.aiRun.findFirst({
      where: { projectId, kind: "cli-intake" },
      orderBy: { createdAt: "desc" },
      select: { id: true, model: true, input: true },
    });
    const latestRuntime = (latestRun?.input as any)?.runtime;
    const runtime: AgentRuntime = isCliRuntime(latestRuntime)
      ? latestRuntime
      : isCliRuntime(integrations.agentRuntime)
        ? integrations.agentRuntime
        : "claude-code";
    const model = normalizeCliModel(runtime, body.model ?? latestRun?.model ?? integrations.agentModel);
    const reasoningEffort = normalizeCliReasoningEffort(integrations.agentReasoningEffort);
    const resumePrompt = buildResumePrompt(runtime, body.prompt);
    const aiRunId = `cli-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

    try {
      const session = await resumeSession({
        projectId,
        projectDir,
        runtime,
        prompt: resumePrompt,
        model,
        authToken: extractAuthToken(request),
        apiBaseUrl: `http://localhost:${process.env.API_PORT || 4001}`,
        revisionId: workspace.currentRevision.id,
        quoteId: workspace.quote.id,
        customCliPath: resolveCliPathOverride(runtime, integrations),
        ...buildSpawnApiKeys(integrations),
        reasoningEffort,
      });

      await store.createAiRun({
        id: aiRunId,
        projectId,
        revisionId: workspace.currentRevision.id,
        kind: "cli-intake",
        status: "running",
        model,
        input: {
          runtime,
          prompt: resumePrompt,
          resumed: true,
          resumeSourceAiRunId: latestRun?.id ?? null,
          cliSessionId: session.sessionId || null,
        } as any,
        output: { events: [] } as any,
      });
      await bindEstimateStrategyRun(projectId, workspace.currentRevision.id, aiRunId);
      attachCliRunPersistence(aiRunId, session);

      return { sessionId: aiRunId, status: "running" };
    } catch (err) {
      await store.createAiRun({
        id: aiRunId,
        projectId,
        revisionId: workspace.currentRevision.id,
        kind: "cli-intake",
        status: "failed",
        model,
        input: {
          runtime,
          prompt: resumePrompt,
          resumed: true,
          resumeSourceAiRunId: latestRun?.id ?? null,
        } as any,
        output: { events: [] } as any,
      }).catch(() => {});
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Failed to resume session" });
    }
  });

  // ── Send Message to Session ─────────────────────────────────
  // Spawns a new CLI session with --resume if the previous session completed,
  // or returns error if a session is already running.
  app.post("/api/cli/:projectId/message", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { message, runtime: requestedRuntime, model: requestedModel, personaId, scope } = (request.body || {}) as {
      message: string;
      runtime?: AgentRuntime;
      model?: string;
      personaId?: string;
      scope?: string;
    };

    if (!message) return reply.code(400).send({ error: "Message required" });

    const existing = getSession(projectId);
    if (existing && existing.status === "running") {
      return reply.code(409).send({ error: "Session is already running. Stop it first or wait for it to complete." });
    }

    // Spawn a new session with the user's message as the prompt.
    // The workspace instruction files and agent-memory.json provide context.
    const projectDir = resolveProjectDir(projectId);
    const store = request.store!;
    const workspace = await store.getWorkspace(projectId);
    if (!workspace) return reply.code(404).send({ error: "Project not found" });
    const project = workspace.project || {} as any;
    const ingestionBlock = ingestionStartBlock(project);
    if (ingestionBlock) return reply.code(409).send(ingestionBlock);

    const settings = await store.getSettings();
    const integrations = (settings as any)?.integrations || {};
    const latestRun = await prisma.aiRun.findFirst({
      where: { projectId, kind: "cli-intake" },
      orderBy: { createdAt: "desc" },
      select: { id: true, model: true, input: true },
    });
    const latestRuntime = (latestRun?.input as any)?.runtime;
    const runtime: AgentRuntime = isCliRuntime(requestedRuntime)
      ? requestedRuntime
      : isCliRuntime(latestRuntime)
      ? latestRuntime
      : isCliRuntime(integrations.agentRuntime)
        ? integrations.agentRuntime
        : "claude-code";
    const model = normalizeCliModel(runtime, requestedModel ?? latestRun?.model ?? integrations.agentModel);
    const reasoningEffort = normalizeCliReasoningEffort(integrations.agentReasoningEffort);
    const prepared = await prepareCliAgentWorkspace({
      request,
      workspace,
      projectId,
      runtime,
      scope,
      personaId,
    });
    const adapter = getAdapter(runtime);
    const questionPrompt = `Read ${adapter.primaryInstructionFile} now. Then read the compact files library-snapshots/README.md and library-snapshots/library-index.md if the question needs project documents, estimating references, datasets, cost intelligence, labour units, assemblies, catalogs, or rate books. Search first-party library corpora in library-snapshots/search with rg/grep or searchLibraryCorpus. Do not read large JSONL snapshots, all-library.search.txt, or files-manifest.jsonl wholesale; search them and use MCP tools for focused reads.

This is a user chat question, not a full intake run. Answer the question against the current quote/workspace/documents. Call getWorkspace and getEstimateStrategy before making claims about the quote. Use readDocumentText/readSpreadsheet/getDocumentStructured only for the specific documents or page ranges needed. If the question needs drawing evidence, you may build/reuse the drawing atlas, searchDrawingRegions, and inspectDrawingRegion for targeted crops; do not execute the full staged estimate workflow, create worksheets/items, or finalize strategy unless the user explicitly asks you to do that.

User question:
${message}`;

    const sessionId = `cli-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    // Persist the user's prompt as a "message" event so the chat panel's
    // rebuild paths (initial restore / poll / terminal-status) keep the
    // user's bubble visible. Without this, the bubble survives only as
    // local React state and disappears the moment the client reloads
    // messages from the server.
    const userMessageEvent: PersistedCliEvent = {
      type: "message",
      data: { role: "user", content: message },
      timestamp: new Date().toISOString(),
    };
    await store.createAiRun({
      id: sessionId,
      projectId,
      revisionId: workspace.currentRevision.id,
      kind: "cli-intake",
      status: "running",
      model,
      input: {
        runtime,
        prompt: message,
        sessionPrompt: questionPrompt,
        followUp: true,
        previousAiRunId: latestRun?.id ?? null,
        scope: prepared.effectiveScope,
        documentCount: prepared.documents.length,
        personaId: personaId || null,
      } as any,
      output: { events: [userMessageEvent] } as any,
    });
    await bindEstimateStrategyRun(projectId, workspace.currentRevision.id, sessionId);

    try {
      const session = await spawnSession({
        projectId,
        projectDir,
        prompt: questionPrompt,
        runtime,
        model,
        authToken: extractAuthToken(request),
        apiBaseUrl: `http://localhost:${process.env.API_PORT || 4001}`,
        revisionId: workspace.currentRevision.id,
        quoteId: workspace.quote.id,
        customCliPath: resolveCliPathOverride(runtime, prepared.integrations),
        ...buildSpawnApiKeys(prepared.integrations),
        reasoningEffort,
        emitCompletionMessage: false,
      });

      attachCliRunPersistence(sessionId, session);

      return { sessionId, status: "running", message: "New session started with your message" };
    } catch (err) {
      await prisma.aiRun.update({ where: { id: sessionId }, data: { status: "failed" } }).catch(() => {});
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Failed to start session" });
    }
  });

  // ── Ask AI (lightweight — uses Claude CLI --print, no full session) ──
  // Used by takeoff/drawing analysis — spawns a one-shot CLI call
  app.post("/api/cli/:projectId/ask", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { prompt, imagePath } = (request.body || {}) as { prompt: string; imagePath?: string };
    if (!prompt) return reply.code(400).send({ error: "Prompt required" });

    // Build a prompt that includes the image path so Claude reads it
    let fullPrompt = prompt;
    if (imagePath) {
      fullPrompt = `First, look at the image file at "${imagePath}". Then answer: ${prompt}`;
    }

    const settings = await request.store!.getSettings();
    const integrations = (settings as any)?.integrations || {};
    const askModel = normalizeCliModel("claude-code", integrations.agentModel);
    const askEffort = mapClaudeEffort(normalizeCliReasoningEffort(integrations.agentReasoningEffort));

    try {
      const { execSync } = await import("node:child_process");
      const cliCmd = "claude";
      const args = [
        "--print",
        fullPrompt,
        "--model", askModel,
      ];
      if (askEffort) args.push("--effort", askEffort);

      // Build env — pass API key if configured
      const env: Record<string, string> = { ...process.env as any };
      if (integrations.anthropicKey) env.ANTHROPIC_API_KEY = integrations.anthropicKey;

      const result = execSync(
        `${cliCmd} ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`,
        {
          cwd: resolveProjectDir(projectId),
          env: env as NodeJS.ProcessEnv,
          timeout: 60_000,
          encoding: "utf-8",
          shell: true as any,
        }
      );

      return { response: result.trim() };
    } catch (err: any) {
      const output = err.stdout?.toString() || err.stderr?.toString() || err.message;
      return reply.code(500).send({ error: output || "AI request failed" });
    }
  });

  // ── Session Status ──────────────────────────────────────────
  app.get("/api/cli/:projectId/status", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const session = getSession(projectId);

    // Get ALL intake runs for this project, oldest first
    const runs = await prisma.aiRun.findMany({
      where: { projectId, kind: "cli-intake" },
      orderBy: { createdAt: "asc" },
    });

    if (runs.length === 0 && !session) {
      return { status: "none" };
    }

    const latestRun = runs[runs.length - 1];
    const latestRunEvents = ((latestRun?.output as any)?.events || []) as Array<{
      type?: string;
      timestamp?: string;
      data?: Record<string, unknown>;
    }>;
    const latestRunClosed = latestRunEvents.some((event) =>
      event?.type === "status" &&
      ((event.data as any)?.status === "completed" || (event.data as any)?.status === "failed" || (event.data as any)?.status === "stopped")
    );

    let derivedCompletionEvents: any[] = [];
    let derivedStatus: string | null = null;

    if (!session && latestRun?.revisionId) {
      const strategy = await prisma.estimateStrategy.findUnique({
        where: { revisionId: latestRun.revisionId },
        select: {
          aiRunId: true,
          status: true,
          currentStage: true,
          summary: true,
          assumptions: true,
          reconcileReport: true,
          reviewRequired: true,
          updatedAt: true,
        },
      });

      const strategyMatchesLatestRun =
        strategy?.aiRunId === latestRun.id &&
        (strategy.status === "complete" || strategy.status === "ready_for_review") &&
        strategy.currentStage === "complete";

      if (strategyMatchesLatestRun) {
        derivedStatus = "completed";

        const alreadyHasCompletionSummary = hasRichCompletionSummary(latestRunEvents);
        if (!alreadyHasCompletionSummary) {
          const lastEventTimestamp = latestRunEvents[latestRunEvents.length - 1]?.timestamp;
          const strategyUpdatedAt = strategy.updatedAt instanceof Date
            ? strategy.updatedAt.toISOString()
            : strategy.updatedAt;

          if (
            latestRunClosed
            || !lastEventTimestamp
            || (strategyUpdatedAt && strategyUpdatedAt >= lastEventTimestamp)
          ) {
            derivedCompletionEvents = buildEstimateCompletionEvents(strategy, strategy.updatedAt, {
              includeStatus: !latestRunClosed,
            });
          }
        }
      }
    }

    // Merge all runs into a single chronological event stream with run dividers
    const mergedEvents: any[] = [];
    for (const run of runs) {
      const runEvents = (run.output as any)?.events || [];
      // Skip empty/trivial runs (< 3 events) unless it's the only one
      if (runEvents.length < 3 && runs.length > 1) continue;

      // Add a run divider
      mergedEvents.push({
        type: "run_divider",
        data: {
          runId: run.id,
          status: run.status,
          model: run.model,
          startedAt: run.createdAt?.toISOString?.() || "",
        },
        timestamp: run.createdAt?.toISOString?.() || "",
      });

      // Add all events from this run
      for (const event of runEvents) {
        if (run.id === latestRun?.id && derivedCompletionEvents.length > 0 && isGenericCompletionMessage(event?.data?.content)) {
          continue;
        }
        mergedEvents.push(event);
      }

      if (run.id === latestRun?.id && derivedCompletionEvents.length > 0) {
        mergedEvents.push(...derivedCompletionEvents);
      }
    }

    // Determine current status: live session takes priority. If the API lost
    // the in-memory child-process handle but the latest run has no terminal
    // status event, keep reporting it as running so monitors can continue
    // polling persisted events and can still answer askUser prompts. A truly
    // dead orphan will be handled by the monitor's stall timeout instead of
    // being misreported as a clean stop.
    const latestStatusEvent = [...latestRunEvents].reverse().find((event) => event?.type === "status");
    const persistedStatus = latestRun?.status === "running" && latestRunClosed
      ? normalizeCliEventText((latestStatusEvent?.data as any)?.status) || latestRun.status
      : latestRun?.status;
    const currentStatus = session?.status === "running"
      ? "running"
      : (derivedStatus || persistedStatus || "none");

    return {
      status: currentStatus,
      runtime: (latestRun?.input as any)?.runtime || session?.runtime,
      sessionId: latestRun?.id || session?.sessionId,
      startedAt: runs[0]?.createdAt?.toISOString?.() || "",
      source: session?.status === "running" ? "live" : "db",
      events: mergedEvents,
      runCount: runs.filter(r => ((r.output as any)?.events || []).length >= 3).length,
    };
  });

  // ── List All Sessions ───────────────────────────────────────
  app.get("/api/cli/sessions", async () => {
    return { sessions: listSessions() };
  });

  // ── Dataset Extraction from Knowledge Book ──────────────────
  app.post("/api/cli/extract-datasets", async (request) => {
    const { bookId, runtime: requestedRuntime, model } = request.body as {
      bookId: string;
      runtime?: AgentRuntime;
      model?: string;
    };

    const store = request.store!;
    const book = await store.getKnowledgeBook(bookId);
    if (!book) return { error: "Book not found" };

    // Get Azure DI credentials
    const settings = await store.getSettings();
    const integrations = (settings as any)?.integrations || {};
    const runtime = resolveCliRuntime(requestedRuntime, integrations.agentRuntime);
    const normalizedModel = normalizeCliModel(runtime, model ?? integrations.agentModel);
    const reasoningEffort = normalizeCliReasoningEffort(integrations.agentReasoningEffort);

    // Create working directory for the extraction session
    const workDir = join(apiDataRoot, "dataset-extraction", bookId);
    const { mkdir, writeFile, copyFile, symlink } = await import("node:fs/promises");
    const { existsSync } = await import("node:fs");
    await mkdir(workDir, { recursive: true });
    await mkdir(join(workDir, "book"), { recursive: true });

    // Copy or symlink the book PDF
    const bookPath = join(apiDataRoot, book.storagePath!);
    const destBookPath = join(workDir, "book", book.sourceFileName || "book.pdf");
    if (existsSync(bookPath) && !existsSync(destBookPath)) {
      try { await symlink(bookPath, destBookPath); } catch { await copyFile(bookPath, destBookPath).catch(() => {}); }
    }

    // Get existing chunks from the book (already parsed by Azure DI during ingestion)
    const allChunks = await prisma.knowledgeChunk.findMany({
      where: { bookId },
      orderBy: { order: "asc" },
      select: { sectionTitle: true, pageNumber: true, text: true },
    });
    const chunks = allChunks;

    // Build a section manifest from chunks instead of re-parsing
    // The CLI agent will read the actual PDF pages directly for table data
    const sectionMap = new Map<string, { pages: Set<number>; chunkCount: number; preview: string }>();
    for (const chunk of chunks) {
      const section = chunk.sectionTitle || "Unknown";
      const existing = sectionMap.get(section) || { pages: new Set(), chunkCount: 0, preview: "" };
      if (chunk.pageNumber) existing.pages.add(chunk.pageNumber);
      existing.chunkCount++;
      if (!existing.preview) existing.preview = chunk.text.substring(0, 200);
      sectionMap.set(section, existing);
    }

    // Create a doc-like structure for the manifest
    const doc = { tables: [] as any[], metadata: { pageCount: book.pageCount } };

    // No pre-extracted table files — the CLI agent reads the PDF directly

    // Save section manifest (the CLI agent reads the PDF directly for table data)
    await writeFile(join(workDir, "book-manifest.json"), JSON.stringify({
      bookId,
      bookName: book.name,
      totalPages: book.pageCount,
      totalChunks: chunks.length,
      sections: [...sectionMap.entries()].map(([name, info]) => ({
        name,
        pages: [...info.pages].sort((a, b) => a - b),
        chunkCount: info.chunkCount,
        preview: info.preview.substring(0, 150),
      })),
    }, null, 2));

    // Write instruction file for dataset extraction
    // Build sections info for the instruction file
    const sectionsInfo = [...sectionMap.entries()]
      .map(([name, info]) => `  - "${name}" (${info.chunkCount} chunks, pages: ${[...info.pages].sort((a,b) => a-b).join(", ") || "?"})`)
      .slice(0, 50)
      .join("\n");

    const pdfFile = book.sourceFileName || "book.pdf";
    const claudeMd = `# Dataset Extraction

Extract structured data tables from \`book/${pdfFile}\` (${book.pageCount} pages).

Knowledge book id: "${bookId}"

Read the book with MCP first:
- Use \`readDocumentText\` with \`documentId: "${bookId}"\` and page ranges like \`pages: "1-20"\`.
- Use \`getBookPage\` only when the OCR text is ambiguous and you need the original page context.

Known sections:
${sectionsInfo || "  - No section index available. Read by page range."}

For each real table you find, call \`createDataset\` with this exact shape:
- \`name\`: descriptive dataset name
- \`description\`: source section, notes, conditions, units
- \`category\`: one of labour_units, equipment_rates, material_prices, productivity, burden_rates, custom
- \`tags\`: rich search tags such as material type, operation, pipe sizes, units, section name
- \`columns\`: objects like \`{ "key": "pipe_size", "label": "Pipe Size", "type": "text" }\`; use snake_case keys and \`type: "number"\` for numeric values
- \`rows\`: array of row objects keyed by those column keys; use actual numbers for numeric values
- \`sourceBookId\`: "${bookId}"
- \`sourcePages\`: a string page range like "85-87, 100"

Read the PDF in batches of 20 pages (it has ${book.pageCount} total). Scan every page.
Merge tables that span multiple pages. Skip non-data pages.
`;

    // Write the instruction content under every known runtime filename so
    // any registered adapter can pick it up.
    const adapter = getAdapter(runtime);
    const allInstructionFilenames = new Set<string>(["CLAUDE.md", "AGENTS.md", "codex.md"]);
    for (const cliAdapter of listAdapters()) {
      for (const filename of cliAdapter.instructionFiles) allInstructionFilenames.add(filename);
    }
    for (const filename of allInstructionFilenames) {
      await writeFile(join(workDir, filename), claudeMd);
    }

    // Spawn CLI session — spawnSession handles MCP config + auth token internally
    const token = extractAuthToken(request);
    const sessionResult = await spawnSession({
      projectId: bookId,
      projectDir: workDir,
      prompt: `Read ${adapter.primaryInstructionFile}. Use readDocumentText with documentId "${bookId}" to extract all data tables from this knowledge book. Call createDataset for each table using row objects keyed by column key.`,
      runtime,
      model: normalizedModel,
      authToken: token,
      ...buildSpawnApiKeys(integrations),
      reasoningEffort,
    });

    return {
      sessionId: sessionResult.sessionId,
      bookId,
      bookName: book.name,
      sections: sectionMap.size,
      chunks: chunks.length,
      workDir,
      status: "running",
    };
  });

  // ── Progress Webhook (called by MCP server) ─────────────────
  app.post("/agent/progress", async (request) => {
    const { phase, detail, projectId } = (request.body || {}) as { phase: string; detail: string; projectId?: string };
    const trimmedProjectId = typeof projectId === "string" ? projectId.trim() : "";
    const trimmedPhase = typeof phase === "string" && phase.trim() ? phase.trim() : "Working";
    const trimmedDetail = typeof detail === "string" && detail.trim() ? detail.trim() : "Agent progress update";
    const progressEvent: PersistedCliEvent = {
      type: "progress",
      data: {
        phase: trimmedPhase,
        detail: trimmedDetail,
        source: "reportProgress",
      },
      timestamp: new Date().toISOString(),
    };

    if (trimmedProjectId) {
      const session = getSession(trimmedProjectId);
      if (session) {
        session.events.emit("event", progressEvent);
      }
      await appendCliEventsToLatestRun(trimmedProjectId, [progressEvent]).catch(() => null);
    }

    return { ok: true, forwarded: Boolean(trimmedProjectId) };
  });

  // ── askUser question/answer flow ───────────────────────────
  // In-memory store for pending questions per project
  const pendingQuestions = new Map<string, PendingQuestionState>();

  // POST /api/cli/:projectId/question — MCP tool calls this to register a pending askUser prompt
  app.post("/api/cli/:projectId/question", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { question, options, allowMultiple, context, questions } = (request.body || {}) as {
      question: string;
      options?: string[];
      allowMultiple?: boolean;
      context?: string;
      questions?: CliQuestionStep[];
    };

    if (!question) return reply.code(400).send({ error: "question required" });

    const questionId = makeCliQuestionId();
    const timestamp = new Date().toISOString();

    // If there's already a pending question, mark it as superseded so any waiter can move on.
    const existing = pendingQuestions.get(projectId);
    if (existing) {
      const supersededEvent: PersistedCliEvent = {
        type: "userAnswer",
        data: {
          questionId: existing.id,
          answer: "Previous question superseded by a new one.",
          superseded: true,
        },
        timestamp,
      };
      const existingSession = getSession(projectId);
      if (existingSession) {
        existingSession.events.emit("event", supersededEvent);
      }
      await appendCliEventsToLatestRun(projectId, [supersededEvent], {
        questionId: existing.id,
        runId: existing.runId ?? null,
      }).catch(() => null);
      pendingQuestions.delete(projectId);
    }

    // Emit the question as an SSE event so the frontend sees it immediately
    const promptEvent: PersistedCliEvent = {
      type: "askUser",
      data: {
        questionId,
        id: questionId,
        question,
        options: options || [],
        allowMultiple: allowMultiple === true,
        context: context || "",
        questions: questions || [],
      },
      timestamp,
    };
    const session = getSession(projectId);
    if (session) {
      session.events.emit("event", promptEvent);
    }
    const runId = await appendCliEventsToLatestRun(projectId, [promptEvent]).catch(() => null);

    pendingQuestions.set(projectId, {
      id: questionId,
      question,
      options,
      allowMultiple: allowMultiple === true,
      context,
      questions,
      createdAt: timestamp,
      runId,
    });

    return { ok: true, questionId };
  });

  // GET /api/cli/:projectId/pending-question — frontend polls for pending question
  app.get("/api/cli/:projectId/pending-question", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { questionId } = (request.query ?? {}) as { questionId?: string };
    const inMemory = pendingQuestions.get(projectId);
    const latestEvents = await getLatestCliRunEvents(projectId, {
      questionId,
      runId: inMemory?.id === questionId ? inMemory?.runId ?? null : inMemory?.runId ?? null,
    });

    if (questionId) {
      const answered = findCliQuestionAnswer(latestEvents, questionId);
      if (answered !== null) {
        return {
          pending: false,
          answered: true,
          questionId,
          answer: answered,
        };
      }
    }

    const exactInMemory = questionId
      ? (inMemory?.id === questionId ? inMemory : null)
      : inMemory;
    let pending = exactInMemory;

    if (pending?.id && hasCliQuestionEvent(latestEvents, pending.id)) {
      const activeInHistory = findPendingCliQuestionFromEvents(latestEvents, pending.id);
      if (!activeInHistory) {
        pendingQuestions.delete(projectId);
        pending = null;
      }
    }

    if (!pending) {
      const derived = findPendingCliQuestionFromEvents(latestEvents, questionId);
      if (!derived) {
        return { pending: false, answered: false, questionId: questionId || null };
      }
      return {
        pending: true,
        questionId: derived.id || questionId || null,
        question: derived.question,
        options: derived.options || [],
        allowMultiple: derived.allowMultiple === true,
        context: derived.context || "",
        questions: derived.questions || [],
      };
    }

    if (!pending) {
      return { pending: false, answered: false, questionId: questionId || null };
    }
    return {
      pending: true,
      questionId: pending.id,
      question: pending.question,
      options: pending.options || [],
      allowMultiple: pending.allowMultiple === true,
      context: pending.context || "",
      questions: pending.questions || [],
    };
  });

  // POST /api/cli/:projectId/answer — frontend submits the user's answer
  app.post("/api/cli/:projectId/answer", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { answer, questionId } = (request.body || {}) as { answer: string; questionId?: string };

    const pending = pendingQuestions.get(projectId);
    const latestEvents = await getLatestCliRunEvents(projectId, {
      questionId,
      runId: pending?.runId ?? null,
    });
    const resolvedQuestionId = typeof questionId === "string" && questionId
      ? questionId
      : pending?.id || findPendingCliQuestionFromEvents(latestEvents)?.id || "";

    if (!resolvedQuestionId) {
      return reply.code(404).send({ error: "No pending question for this project" });
    }

    const normalizedAnswer = answer || "No specific answer provided. Use your best judgment.";

    if (pending?.id === resolvedQuestionId) {
      pendingQuestions.delete(projectId);
    }

    // Emit answer event so the stream picks it up
    const answerEvent: PersistedCliEvent = {
      type: "userAnswer",
      data: {
        questionId: resolvedQuestionId,
        answer: normalizedAnswer,
      },
      timestamp: new Date().toISOString(),
    };
    const session = getSession(projectId);
    if (session) {
      session.events.emit("event", answerEvent);
    }
    await appendCliEventsToLatestRun(projectId, [answerEvent], {
      questionId: resolvedQuestionId,
      runId: pending?.runId ?? null,
    }).catch(() => null);

    return { ok: true, message: "Answer delivered to agent" };
  });

  app.post("/api/cli/:projectId/question-timeout", async (request) => {
    // Backward-compatible no-op for older clients. askUser now blocks until an
    // explicit answer, matching the CLI behavior where an agent can wait for
    // days without inventing defaults or continuing past the user.
    const { projectId } = request.params as { projectId: string };
    const { questionId } = (request.body || {}) as { questionId?: string };
    const pending = pendingQuestions.get(projectId);
    return {
      ok: true,
      cleared: false,
      waiting: true,
      questionId: questionId || pending?.id || null,
    };
  });
}
