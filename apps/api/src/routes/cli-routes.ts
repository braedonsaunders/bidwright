/**
 * CLI Management Routes
 *
 * Endpoints for detecting, authenticating, and managing CLI agent runtimes.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { detectCli, checkCliAuth, spawnSession, stopSession, resumeSession, getSession, listSessions, listCliModels, type AgentRuntime } from "../services/cli-runtime.js";
import { generateClaudeMd, generateCodexMd, symlinkKnowledgeBooks } from "../services/claude-md-generator.js";
import { resolveProjectDir, resolveProjectDocumentsDir, resolveKnowledgeDir, apiDataRoot } from "../paths.js";
import { join } from "node:path";
import { prisma } from "@bidwright/db";
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
  placeholder?: string;
  context?: string;
};

type PendingQuestionState = {
  id: string;
  question: string;
  options?: string[];
  context?: string;
  questions?: CliQuestionStep[];
  createdAt: string;
};

function cliEventFingerprint(event: PersistedCliEvent): string {
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

async function appendCliEventsToLatestRun(projectId: string, incoming: PersistedCliEvent[]) {
  if (incoming.length === 0) return;

  const latestRun = await prisma.aiRun.findFirst({
    where: { projectId, kind: "cli-intake" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      output: true,
    },
  });

  if (!latestRun) return;

  const existing = (((latestRun.output as any)?.events || []) as PersistedCliEvent[]);
  await prisma.aiRun.update({
    where: { id: latestRun.id },
    data: {
      output: {
        events: mergeCliEvents(existing, incoming),
      } as any,
    },
  });
}

async function getLatestCliRunEvents(projectId: string): Promise<PersistedCliEvent[]> {
  const latestRun = await prisma.aiRun.findFirst({
    where: { projectId, kind: "cli-intake" },
    orderBy: { createdAt: "desc" },
    select: { output: true },
  });
  return (((latestRun?.output as any)?.events || []) as PersistedCliEvent[]);
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
  return value === "claude-code" || value === "codex";
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

function isClaudeCliModel(model: string) {
  return ["default", "best", "sonnet", "opus", "haiku", "sonnet[1m]", "opus[1m]", "opusplan"].includes(model) || model.startsWith("claude-");
}

function isCodexCliModel(model: string) {
  return !!model.trim() && !isClaudeCliModel(model);
}

function normalizeCliModel(runtime: AgentRuntime, model: string | null | undefined) {
  if (runtime === "claude-code") {
    return model && isClaudeCliModel(model) ? model : "sonnet";
  }
  return model && isCodexCliModel(model) ? model : "gpt-5.4";
}

function normalizeCliReasoningEffort(value: unknown): "auto" | "low" | "medium" | "high" | "extra_high" | "max" {
  if (value === "auto" || value === "low" || value === "medium" || value === "high" || value === "extra_high" || value === "max") {
    return value;
  }
  return "extra_high";
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

  const defaultModels: CliModelOption[] = [
    { id: "gpt-5.4", name: "GPT-5.4", description: "Strong frontier default for complex agentic work" },
    { id: "gpt-5-codex", name: "GPT-5-Codex", description: "GPT-5 optimized for Codex-style coding" },
    { id: "gpt-5.3-codex", name: "GPT-5.3-Codex", description: "Agentic coding model with xhigh reasoning support" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", description: "Faster and cheaper than GPT-5.4" },
  ];
  return dedupeCliModels([...defaultModels, ...(await fetchOpenAiCliModels(apiKey))]);
}

function resolveCliPathOverride(
  runtime: AgentRuntime,
  integrations: Record<string, unknown>,
  requestedPath?: unknown,
) {
  if (typeof requestedPath === "string" && requestedPath.trim()) return requestedPath.trim();
  if (runtime === "claude-code") {
    return typeof integrations.claudeCodePath === "string" ? integrations.claudeCodePath : undefined;
  }
  return typeof integrations.codexPath === "string" ? integrations.codexPath : undefined;
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

  return buildCliModelOptions(
    runtime,
    runtime === "claude-code"
      ? (typeof integrations.anthropicKey === "string" ? integrations.anthropicKey : process.env.ANTHROPIC_API_KEY)
      : (typeof integrations.openaiKey === "string" ? integrations.openaiKey : process.env.OPENAI_API_KEY),
  );
}

function buildResumePrompt(runtime: AgentRuntime, prompt?: string) {
  if (typeof prompt === "string" && prompt.trim()) return prompt.trim();
  if (runtime === "codex") {
    return "Resume the previous estimate session. Read AGENTS.md, check the current state with getWorkspace and getEstimateStrategy, then continue from where you left off. Do not re-create phases, worksheets, or items that already exist.";
  }
  return "Resume the previous estimate session. Read CLAUDE.md, check the current state with getWorkspace and getEstimateStrategy, then continue from where you left off. Do not re-create phases, worksheets, or items that already exist.";
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
      const run = await prisma.aiRun.findFirst({ where: { id: runId } });
      const existing = ((run?.output as any)?.events || []) as PersistedCliEvent[];
      await prisma.aiRun.update({
        where: { id: runId },
        data: {
          output: {
            events: mergeCliEvents(existing, toSave),
          } as any,
        },
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
    eventBuffer.push({ ...evt, timestamp: evt?.timestamp || new Date().toISOString() });
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

    const claude = detectCli("claude-code", integrations.claudeCodePath || undefined);
    const codex = detectCli("codex", integrations.codexPath || undefined);
    const claudeAuth = checkCliAuth("claude-code", integrations.anthropicKey);
    const codexAuth = checkCliAuth("codex", integrations.openaiKey);

    return {
      claude: { ...claude, auth: claudeAuth },
      codex: { ...codex, auth: codexAuth },
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
      persona = await prisma.estimatorPersona.findFirst({
        where: { id: body.personaId },
      });
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

    // Fetch settings early so we can pass integrations into CLAUDE.md params
    const settingsEarly = await store.getSettings();
    const integrationsEarly = (settingsEarly as any)?.integrations || {};
    const estimateDefaults = (settingsEarly as any)?.defaults || {};
    const runtime = resolveCliRuntime(body.runtime, integrationsEarly.agentRuntime);
    const model = normalizeCliModel(runtime, body.model ?? integrationsEarly.agentModel);
    const reasoningEffort = normalizeCliReasoningEffort(integrationsEarly.agentReasoningEffort);

    // Generate CLAUDE.md / codex.md (includes knowledge book file list)
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
      estimateDefaults,
      maxConcurrentSubAgents: integrationsEarly.maxConcurrentSubAgents ?? 2,
      persona: persona ? await (async () => {
        const bookIds: string[] = Array.isArray(persona.knowledgeBookIds) ? persona.knowledgeBookIds : JSON.parse(persona.knowledgeBookIds as string || "[]");
        const datasetTags: string[] = Array.isArray(persona.datasetTags) ? persona.datasetTags : JSON.parse(persona.datasetTags as string || "[]");
        // Resolve book IDs to human-readable names for the agent prompt
        let bookNames: string[] = [];
        if (bookIds.length > 0) {
          const books = await prisma.knowledgeBook.findMany({ where: { id: { in: bookIds } }, select: { name: true } });
          bookNames = books.map((b: any) => b.name);
        }
        return {
          name: persona.name,
          trade: persona.trade,
          systemPrompt: persona.systemPrompt,
          knowledgeBookNames: bookNames,
          datasetTags,
          packageBuckets: Array.isArray((persona as any).packageBuckets) ? (persona as any).packageBuckets : [],
          defaultAssumptions: ((persona as any).defaultAssumptions as Record<string, unknown>) ?? {},
          productivityGuidance: ((persona as any).productivityGuidance as Record<string, unknown>) ?? {},
          commercialGuidance: ((persona as any).commercialGuidance as Record<string, unknown>) ?? {},
          reviewFocusAreas: Array.isArray((persona as any).reviewFocusAreas) ? (persona as any).reviewFocusAreas : [],
        };
      })() : null,
    };

    if (runtime === "claude-code") {
      await generateClaudeMd(params);
    } else {
      await generateCodexMd(params);
    }

    // Create AiRun record
    const sessionId = `cli-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    await store.createAiRun({
      id: sessionId,
      projectId,
      revisionId: revision.id || "",
      kind: "cli-intake",
      status: "running",
      model: model || (runtime === "claude-code" ? "sonnet" : "gpt-5.4"),
      input: { runtime, scope: effectiveScope, documentCount: documents.length } as any,
      output: { events: [] } as any,
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
    const instructionFile = runtime === "codex" ? "AGENTS.md" : "CLAUDE.md";

    // Spawn CLI
    const scopeDirective = effectiveScope
      ? `\n\nUSER SCOPE / COMMERCIAL INSTRUCTIONS (AUTHORITATIVE):\n${effectiveScope}\nTreat these instructions as binding commercial direction. If the user says an activity is subcontracted, already priced, owner-supplied, or otherwise commercially decided, do not re-estimate that package as self-performed labour unless the user explicitly asks for a validation breakdown.`
      : "";

    const initialPrompt = prompt || `Read ${instructionFile} now.${scopeDirective} Then execute the staged estimate workflow in order:

1. Read the documents and save the structured scope graph with saveEstimateScopeGraph.
2. Lock the execution model with saveEstimateExecutionPlan and saveEstimateAssumptions.
3. Define the commercial/package structure with saveEstimatePackagePlan.
4. ${benchmarkingEnabled ? "Run recomputeEstimateBenchmarks and review the historical comparison before creating labour hours." : "Skip recomputeEstimateBenchmarks because organization benchmarking is disabled, and record the top-down sanity checks you used in saveEstimateAdjustments."}
5. Call updateQuote, getItemConfig, import needed rate schedules, then create worksheets/items.
6. Build the quote summary breakout with applySummaryPreset using the most appropriate preset for the actual worksheet/phase structure, then perform the final self-review with saveEstimateReconcile and finalizeEstimateStrategy.

CRITICAL: Do not jump from document facts straight into line-item hours. The estimate is only valid after the scope graph, execution plan, package plan, ${benchmarkingEnabled ? "benchmark pass, " : ""}adjustment pass, and reconcile pass are all saved.`;

    try {
      const session = await spawnSession({
        projectId,
        projectDir,
        prompt: initialPrompt,
        runtime,
        model,
        authToken: extractAuthToken(request),
        apiBaseUrl: `http://localhost:${process.env.API_PORT || 4001}`,
        revisionId: revision.id,
        quoteId: quote.id,
        customCliPath: runtime === "claude-code"
          ? integrations.claudeCodePath || undefined
          : integrations.codexPath || undefined,
        anthropicApiKey: integrations.anthropicKey || process.env.ANTHROPIC_API_KEY || undefined,
        openaiApiKey: integrations.openaiKey || process.env.OPENAI_API_KEY || undefined,
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
        const payload = JSON.stringify(evt.data);
        reply.raw.write(`event: ${evt.type}\ndata: ${payload}\n\n`);
      } catch {}
    };

    session.events.on("event", onEvent);

    // Keep-alive ping every 15s
    const pingTimer = setInterval(() => {
      try { reply.raw.write(`: ping\n\n`); } catch {}
    }, 15_000);

    // Cleanup on client disconnect
    reply.raw.on("close", () => {
      session.events.off("event", onEvent);
      clearInterval(pingTimer);
    });

    // When session ends, close SSE
    session.events.once("done", () => {
      session.events.off("event", onEvent);
      clearInterval(pingTimer);
      try { reply.raw.end(); } catch {}
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
    const runtime: AgentRuntime = latestRuntime === "codex" || latestRuntime === "claude-code"
      ? latestRuntime
      : integrations.agentRuntime === "codex"
        ? "codex"
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
        customCliPath: runtime === "claude-code"
          ? integrations.claudeCodePath || undefined
          : integrations.codexPath || undefined,
        anthropicApiKey: integrations.anthropicKey || process.env.ANTHROPIC_API_KEY || undefined,
        openaiApiKey: integrations.openaiKey || process.env.OPENAI_API_KEY || undefined,
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
    const { message } = (request.body || {}) as { message: string };

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

    const settings = await store.getSettings();
    const integrations = (settings as any)?.integrations || {};
    const latestRun = await prisma.aiRun.findFirst({
      where: { projectId, kind: "cli-intake" },
      orderBy: { createdAt: "desc" },
      select: { id: true, model: true, input: true },
    });
    const latestRuntime = (latestRun?.input as any)?.runtime;
    const runtime: AgentRuntime = latestRuntime === "codex" || latestRuntime === "claude-code"
      ? latestRuntime
      : integrations.agentRuntime === "codex"
        ? "codex"
        : "claude-code";
    const model = normalizeCliModel(runtime, latestRun?.model ?? integrations.agentModel);
    const reasoningEffort = normalizeCliReasoningEffort(integrations.agentReasoningEffort);

    const sessionId = `cli-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
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
        followUp: true,
        previousAiRunId: latestRun?.id ?? null,
      } as any,
      output: { events: [] } as any,
    });
    await bindEstimateStrategyRun(projectId, workspace.currentRevision.id, sessionId);

    try {
      const session = await spawnSession({
        projectId,
        projectDir,
        prompt: message,
        runtime,
        model,
        authToken: extractAuthToken(request),
        apiBaseUrl: `http://localhost:${process.env.API_PORT || 4001}`,
        revisionId: workspace.currentRevision.id,
        quoteId: workspace.quote.id,
        customCliPath: runtime === "claude-code"
          ? integrations.claudeCodePath || undefined
          : integrations.codexPath || undefined,
        anthropicApiKey: integrations.anthropicKey || process.env.ANTHROPIC_API_KEY || undefined,
        openaiApiKey: integrations.openaiKey || process.env.OPENAI_API_KEY || undefined,
        reasoningEffort,
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

    // Determine current status: live session takes priority
    const currentStatus = session?.status === "running"
      ? "running"
      : (derivedStatus || latestRun?.status || "none");

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

For each table, call \`createDataset\` with:
- Descriptive name
- Rich tags array for search (material type, operation, pipe sizes, units, section name)
- Columns as [{name, type}] — use snake_case names, type "number" for numeric values
- Rows as arrays of values matching column order — use actual numbers not strings
- sourceBookId: "${bookId}"
- sourcePages: array of page numbers

Read the PDF in batches of 20 pages (it has ${book.pageCount} total). Scan every page.
Merge tables that span multiple pages. Skip non-data pages.
`;

    await writeFile(join(workDir, "CLAUDE.md"), claudeMd);
    await writeFile(join(workDir, "AGENTS.md"), claudeMd);
    await writeFile(join(workDir, "codex.md"), claudeMd);

    // Spawn CLI session — spawnSession handles MCP config + auth token internally
    const token = extractAuthToken(request);
    const sessionResult = await spawnSession({
      projectId: bookId,
      projectDir: workDir,
      prompt: `Read ${runtime === "codex" ? "AGENTS.md" : "CLAUDE.md"} then extract all data tables from the PDF in book/. Call createDataset for each table.`,
      runtime,
      model: normalizedModel,
      authToken: token,
      anthropicApiKey: integrations.anthropicKey || process.env.ANTHROPIC_API_KEY,
      openaiApiKey: integrations.openaiKey || process.env.OPENAI_API_KEY,
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
    const { phase, detail } = (request.body || {}) as { phase: string; detail: string };
    // This is called by the MCP server's reportProgress tool
    // The event will be picked up by the CLI's stdout parser
    // For now, just acknowledge
    return { ok: true };
  });

  // ── askUser question/answer flow ───────────────────────────
  // In-memory store for pending questions per project
  const pendingQuestions = new Map<string, PendingQuestionState>();

  // POST /api/cli/:projectId/question — MCP tool calls this to register a pending askUser prompt
  app.post("/api/cli/:projectId/question", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { question, options, context, questions } = (request.body || {}) as {
      question: string;
      options?: string[];
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
      await appendCliEventsToLatestRun(projectId, [supersededEvent]).catch(() => {});
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
        context: context || "",
        questions: questions || [],
      },
      timestamp,
    };
    const session = getSession(projectId);
    if (session) {
      session.events.emit("event", promptEvent);
    }
    await appendCliEventsToLatestRun(projectId, [promptEvent]).catch(() => {});

    pendingQuestions.set(projectId, {
      id: questionId,
      question,
      options,
      context,
      questions,
      createdAt: timestamp,
    });

    return { ok: true, questionId };
  });

  // GET /api/cli/:projectId/pending-question — frontend polls for pending question
  app.get("/api/cli/:projectId/pending-question", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { questionId } = (request.query ?? {}) as { questionId?: string };
    const latestEvents = await getLatestCliRunEvents(projectId);

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

    const inMemory = pendingQuestions.get(projectId);
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
      context: pending.context || "",
      questions: pending.questions || [],
    };
  });

  // POST /api/cli/:projectId/answer — frontend submits the user's answer
  app.post("/api/cli/:projectId/answer", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { answer, questionId } = (request.body || {}) as { answer: string; questionId?: string };

    const pending = pendingQuestions.get(projectId);
    const latestEvents = await getLatestCliRunEvents(projectId);
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
    await appendCliEventsToLatestRun(projectId, [answerEvent]).catch(() => {});

    return { ok: true, message: "Answer delivered to agent" };
  });

  app.post("/api/cli/:projectId/question-timeout", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const { questionId } = (request.body || {}) as { questionId?: string };
    const latestEvents = await getLatestCliRunEvents(projectId);
    const resolvedQuestionId = typeof questionId === "string" && questionId
      ? questionId
      : pendingQuestions.get(projectId)?.id || "";

    if (!resolvedQuestionId) {
      return { ok: true, cleared: false };
    }

    if (findCliQuestionAnswer(latestEvents, resolvedQuestionId) !== null) {
      if (pendingQuestions.get(projectId)?.id === resolvedQuestionId) {
        pendingQuestions.delete(projectId);
      }
      return { ok: true, cleared: false, alreadyAnswered: true };
    }

    if (pendingQuestions.get(projectId)?.id === resolvedQuestionId) {
      pendingQuestions.delete(projectId);
    }

    const timeoutEvent: PersistedCliEvent = {
      type: "askUserTimeout",
      data: {
        questionId: resolvedQuestionId,
      },
      timestamp: new Date().toISOString(),
    };
    const session = getSession(projectId);
    if (session) {
      session.events.emit("event", timeoutEvent);
    }
    await appendCliEventsToLatestRun(projectId, [timeoutEvent]).catch(() => {});

    return { ok: true, cleared: true };
  });
}
