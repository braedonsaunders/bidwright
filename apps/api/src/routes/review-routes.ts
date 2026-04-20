/**
 * Quote Review Routes
 *
 * Endpoints for spawning and managing AI-powered quote review sessions.
 * Reviews analyze project documents against the quoted estimate to identify
 * gaps, risks, overestimates, and actionable recommendations.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { detectCli, checkCliAuth, spawnSession, stopSession, getSession, type AgentRuntime } from "../services/cli-runtime.js";
import { generateReviewClaudeMd, symlinkKnowledgeBooks } from "../services/claude-md-generator.js";
import { resolveProjectDir, apiDataRoot } from "../paths.js";
import { prisma } from "@bidwright/db";
import { getSessionCookieToken } from "../services/session-cookie.js";
import { buildWorkspaceResponse } from "../server.js";

const REVIEW_META_KEY = "__reviewMeta";
const REVIEW_STATES = new Set(["open", "resolved"]);
const REVIEW_ITEM_STATES = new Set(["open", "resolved", "dismissed"]);
const COVERAGE_STATES = new Set(["YES", "VERIFY", "NO"]);
const FINDING_SEVERITIES = new Set(["CRITICAL", "WARNING", "INFO"]);
const PRIORITY_LEVELS = new Set(["HIGH", "MEDIUM", "LOW"]);

type ReviewLifecycleState = "open" | "resolved";
type ReviewItemState = "open" | "resolved" | "dismissed";

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pickEnum<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return typeof value === "string" && allowed.has(value) ? (value as T) : fallback;
}

function fallbackId(prefix: string, index: number) {
  return `${prefix}-${index + 1}-${randomUUID().slice(0, 8)}`;
}

function stripReviewMeta(summary: unknown): Record<string, any> {
  if (!isRecord(summary)) return {};
  const clone = { ...summary };
  delete clone[REVIEW_META_KEY];
  return clone;
}

function extractReviewMeta(summary: unknown, fallbackSnapshot: string | null): {
  state: ReviewLifecycleState;
  quoteSnapshotUpdatedAt: string | null;
  resolvedAt: string | null;
} {
  const meta = isRecord(summary) && isRecord(summary[REVIEW_META_KEY]) ? summary[REVIEW_META_KEY] : {};
  return {
    state: pickEnum<ReviewLifecycleState>(meta.state, REVIEW_STATES, "open"),
    quoteSnapshotUpdatedAt: asOptionalString(meta.quoteSnapshotUpdatedAt) ?? fallbackSnapshot,
    resolvedAt: asOptionalString(meta.resolvedAt) ?? null,
  };
}

function attachReviewMeta(summary: unknown, meta: { state: ReviewLifecycleState; quoteSnapshotUpdatedAt: string | null; resolvedAt: string | null }) {
  return {
    ...stripReviewMeta(summary),
    [REVIEW_META_KEY]: {
      state: meta.state,
      quoteSnapshotUpdatedAt: meta.quoteSnapshotUpdatedAt,
      resolvedAt: meta.resolvedAt,
    },
  };
}

function normalizeCoverageItems(value: unknown) {
  const items = Array.isArray(value) ? value : [];
  return items.map((item, index) => {
    const entry = isRecord(item) ? item : {};
    return {
      id: asOptionalString(entry.id) ?? fallbackId("coverage", index),
      specRef: asString(entry.specRef),
      requirement: asString(entry.requirement),
      status: pickEnum<"YES" | "VERIFY" | "NO">(entry.status, COVERAGE_STATES, "VERIFY"),
      worksheetName: asOptionalString(entry.worksheetName),
      notes: asOptionalString(entry.notes),
    };
  });
}

function normalizeFindings(value: unknown) {
  const items = Array.isArray(value) ? value : [];
  return items.map((item, index) => {
    const entry = isRecord(item) ? item : {};
    return {
      id: asOptionalString(entry.id) ?? fallbackId("finding", index),
      severity: pickEnum<"CRITICAL" | "WARNING" | "INFO">(entry.severity, FINDING_SEVERITIES, "INFO"),
      title: asString(entry.title),
      description: asString(entry.description),
      specRef: asOptionalString(entry.specRef),
      estimatedImpact: asOptionalString(entry.estimatedImpact),
      status: pickEnum<ReviewItemState>(entry.status, REVIEW_ITEM_STATES, "open"),
      resolutionNote: asOptionalString(entry.resolutionNote),
    };
  });
}

function normalizeCompetitivenessEntries(value: unknown, kind: "overestimate" | "underestimate") {
  const items = Array.isArray(value) ? value : [];
  return items.map((item, index) => {
    const entry = isRecord(item) ? item : {};
    return {
      id: asOptionalString(entry.id) ?? fallbackId(kind, index),
      impact: pickEnum<"HIGH" | "MEDIUM" | "LOW">(entry.impact, PRIORITY_LEVELS, "MEDIUM"),
      area: asString(entry.area),
      analysis: asString(entry.analysis),
      currentValue: asOptionalString(entry.currentValue),
      benchmarkValue: asOptionalString(entry.benchmarkValue),
      savingsRange: kind === "overestimate" ? asString(entry.savingsRange) : undefined,
      riskRange: kind === "underestimate" ? asString(entry.riskRange) : undefined,
      status: pickEnum<ReviewItemState>(entry.status, REVIEW_ITEM_STATES, "open"),
      resolutionNote: asOptionalString(entry.resolutionNote),
    };
  });
}

function normalizeBenchmarkStreams(value: unknown) {
  const streams = Array.isArray(value) ? value : [];
  return streams.map((stream, index) => {
    const entry = isRecord(stream) ? stream : {};
    return {
      id: asOptionalString(entry.id) ?? fallbackId("benchmark", index),
      name: asString(entry.name),
      footage: asOptionalNumber(entry.footage),
      hours: asNumber(entry.hours, 0),
      productionRate: asOptionalNumber(entry.productionRate),
      unit: asOptionalString(entry.unit),
      fmTlRatio: asOptionalNumber(entry.fmTlRatio),
      assessment: asString(entry.assessment),
    };
  });
}

function normalizeCompetitiveness(value: unknown) {
  const entry = isRecord(value) ? value : {};
  const benchmarking = isRecord(entry.benchmarking) ? entry.benchmarking : {};
  return {
    totalSavingsRange: asOptionalString(entry.totalSavingsRange),
    overestimates: normalizeCompetitivenessEntries(entry.overestimates, "overestimate").map((item) => ({
      id: item.id,
      impact: item.impact,
      area: item.area,
      analysis: item.analysis,
      currentValue: item.currentValue,
      benchmarkValue: item.benchmarkValue,
      savingsRange: item.savingsRange ?? "",
      status: item.status,
      resolutionNote: item.resolutionNote,
    })),
    underestimates: normalizeCompetitivenessEntries(entry.underestimates, "underestimate").map((item) => ({
      id: item.id,
      impact: item.impact,
      area: item.area,
      analysis: item.analysis,
      riskRange: item.riskRange ?? "",
      status: item.status,
      resolutionNote: item.resolutionNote,
    })),
    benchmarking: {
      description: asOptionalString(benchmarking.description),
      streams: normalizeBenchmarkStreams(benchmarking.streams),
    },
  };
}

function normalizeRecommendations(value: unknown) {
  const items = Array.isArray(value) ? value : [];
  return items.map((item, index) => {
    const entry = isRecord(item) ? item : {};
    const resolution = isRecord(entry.resolution) ? entry.resolution : {};
    return {
      id: asOptionalString(entry.id) ?? fallbackId("recommendation", index),
      title: asString(entry.title),
      description: asString(entry.description),
      priority: pickEnum<"HIGH" | "MEDIUM" | "LOW">(entry.priority, PRIORITY_LEVELS, "MEDIUM"),
      impact: asString(entry.impact),
      category: asOptionalString(entry.category),
      status: pickEnum<ReviewItemState>(entry.status, REVIEW_ITEM_STATES, "open"),
      reviewerNote: asOptionalString(entry.reviewerNote),
      resolution: {
        summary: asString(resolution.summary),
        actions: Array.isArray(resolution.actions) ? resolution.actions : [],
      },
    };
  });
}

function normalizeSummary(value: unknown) {
  const summary = stripReviewMeta(value);
  const riskCount = isRecord(summary.riskCount) ? summary.riskCount : {};
  return {
    ...summary,
    quoteTotal: asNumber(summary.quoteTotal, 0),
    worksheetCount: asNumber(summary.worksheetCount, 0),
    itemCount: asNumber(summary.itemCount, 0),
    totalHours: asOptionalNumber(summary.totalHours),
    coverageScore: asString(summary.coverageScore),
    riskCount: {
      critical: asNumber(riskCount.critical, 0),
      warning: asNumber(riskCount.warning, 0),
      info: asNumber(riskCount.info, 0),
    },
    potentialSavings: asOptionalString(summary.potentialSavings),
    keyFindings: Array.isArray(summary.keyFindings) ? summary.keyFindings.map((item) => asString(item)).filter(Boolean) : [],
    overallAssessment: asString(summary.overallAssessment),
  };
}

async function getQuoteReviewContext(projectId: string) {
  const quote = await prisma.quote.findFirst({
    where: { projectId },
    select: { updatedAt: true, currentRevisionId: true },
  });
  const currentRevisionId = quote?.currentRevisionId ?? null;
  const revision = currentRevisionId
    ? await prisma.quoteRevision.findFirst({
        where: { id: currentRevisionId },
        select: { updatedAt: true },
      })
    : null;
  const scheduleAgg = currentRevisionId
    ? await prisma.scheduleTask.aggregate({
        where: { projectId, revisionId: currentRevisionId },
        _max: { updatedAt: true },
      })
    : { _max: { updatedAt: null as Date | null } };

  const timestamps = [quote?.updatedAt ?? null, revision?.updatedAt ?? null, scheduleAgg._max.updatedAt ?? null]
    .filter((value): value is Date => value instanceof Date)
    .sort((left, right) => left.getTime() - right.getTime());

  return {
    currentRevisionId,
    quoteUpdatedAt: timestamps.length > 0 ? timestamps[timestamps.length - 1].toISOString() : null,
  };
}

function serializeReview(review: any, context: { currentRevisionId: string | null; quoteUpdatedAt: string | null }) {
  const fallbackSnapshot = review.createdAt instanceof Date ? review.createdAt.toISOString() : new Date().toISOString();
  const meta = extractReviewMeta(review.summary, fallbackSnapshot);
  const reviewedQuoteUpdatedAt = meta.quoteSnapshotUpdatedAt ?? fallbackSnapshot;
  const currentQuoteMs = context.quoteUpdatedAt ? Date.parse(context.quoteUpdatedAt) : NaN;
  const reviewedQuoteMs = reviewedQuoteUpdatedAt ? Date.parse(reviewedQuoteUpdatedAt) : NaN;
  const revisionMismatch = !!(context.currentRevisionId && review.revisionId !== context.currentRevisionId);
  const changedAfterReview =
    Number.isFinite(currentQuoteMs) &&
    Number.isFinite(reviewedQuoteMs) &&
    currentQuoteMs > reviewedQuoteMs + 1000;
  const isOutdated = revisionMismatch || changedAfterReview;

  return {
    ...review,
    summary: normalizeSummary(review.summary),
    coverage: normalizeCoverageItems(review.coverage),
    findings: normalizeFindings(review.findings),
    competitiveness: normalizeCompetitiveness(review.competitiveness),
    recommendations: normalizeRecommendations(review.recommendations),
    reviewState: meta.state,
    reviewedQuoteUpdatedAt,
    quoteUpdatedAt: context.quoteUpdatedAt,
    currentRevisionId: context.currentRevisionId,
    isOutdated,
    outdatedReason: revisionMismatch
      ? "This review belongs to an older revision."
      : changedAfterReview
        ? "The quote has changed since this review was last marked current."
        : null,
  };
}

/** Extract session token from Authorization header, cookie, or query param */
function extractAuthToken(request: FastifyRequest): string {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const cookieToken = getSessionCookieToken(request);
  if (cookieToken) return cookieToken;
  return (request.query as any)?.token || "";
}

export function registerReviewRoutes(app: FastifyInstance) {

  // ── Start Review Session ──────────────────────────────────
  app.post("/api/review/:projectId/start", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = (request.body || {}) as {
      runtime?: AgentRuntime;
      model?: string;
    };

    const runtime: AgentRuntime = body.runtime || "claude-code";
    let model = body.model;
    if (runtime === "claude-code" && (!model || model.includes("/"))) {
      model = "sonnet";
    } else if (runtime === "codex" && !model) {
      model = "gpt-5.4";
    }

    const store = request.store!;

    // Get project context
    const workspace = await store.getWorkspace(projectId);
    if (!workspace) return reply.code(404).send({ error: "Project not found" });

    const project = workspace.project || {} as any;
    const quote = workspace.quote || {} as any;
    const revision = workspace.currentRevision || {} as any;
    const documents = (workspace.sourceDocuments || []).map((d: any) => ({
      id: d.id,
      fileName: d.fileName,
      fileType: d.fileType,
      documentType: d.documentType,
      pageCount: d.pageCount || 0,
      storagePath: d.storagePath || "",
    }));

    const projectDir = resolveProjectDir(projectId);
    const reviewContext = await getQuoteReviewContext(projectId);

    // Symlink global knowledge books
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

    const settingsEarly = await store.getSettings();
    const integrationsEarly = (settingsEarly as any)?.integrations || {};

    // Generate review-specific CLAUDE.md
    await generateReviewClaudeMd({
      projectDir,
      projectName: project.name || "Untitled Project",
      clientName: project.clientName || "",
      location: project.location || "",
      scope: "",
      quoteNumber: quote.quoteNumber || "",
      dataRoot: apiDataRoot,
      documents,
      knowledgeBookFiles: linkedBookNames,
      maxConcurrentSubAgents: integrationsEarly.maxConcurrentSubAgents ?? 2,
    });

    // Create QuoteReview record
    const reviewId = `review-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    await prisma.quoteReview.create({
      data: {
        id: reviewId,
        projectId,
        revisionId: revision.id || "",
        status: "running",
        summary: attachReviewMeta({}, {
          state: "open",
          quoteSnapshotUpdatedAt: reviewContext.quoteUpdatedAt,
          resolvedAt: null,
        }),
        coverage: [],
        findings: [],
        competitiveness: {},
        recommendations: [],
      },
    });

    // Create AiRun record
    const sessionId = `cli-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    await prisma.aiRun.create({
      data: {
        id: sessionId,
        projectId,
        revisionId: revision.id || "",
        kind: "cli-review",
        status: "running",
        model: model || "sonnet",
        input: { runtime, reviewId, documentCount: documents.length } as any,
        output: { events: [] } as any,
      },
    });

    // Update review with aiRunId
    await prisma.quoteReview.update({
      where: { id: reviewId },
      data: { aiRunId: sessionId },
    });

    // Spawn CLI
    const instructionFile = runtime === "codex" ? "AGENTS.md" : "CLAUDE.md";
    const initialPrompt = `Read ${instructionFile} now. Execute the FULL review workflow:

1. Call getWorkspace — understand the complete estimate structure, all worksheets and line items
2. Read EVERY project document (specs, RFQs, BOMs, drawings) using Read tool on documents/ folder
3. Read knowledge books in knowledge/ folder — read table of contents, then relevant rate/productivity chapters
4. Cross-reference: for each spec section/requirement, check if a corresponding line item exists in the estimate
5. Call saveReviewCoverage with the scope coverage checklist
6. Identify gaps (unpriced scope), risks (unclear items, wrong assumptions), severity-rate each finding
7. Call saveReviewFindings with all gaps and risks
8. Analyze competitiveness: compare quoted hours and quantities against knowledge base benchmarks and industry standards
9. Call saveReviewCompetitiveness with overestimate/underestimate analysis and productivity benchmarking
10. Generate actionable recommendations — each must include specific resolution actions (which items to add/update/delete and how)
11. Call saveReviewRecommendation for EACH recommendation individually
12. Call saveReviewSummary with executive summary including quote total, key statistics, and critical findings

CRITICAL: You are reviewing an EXISTING estimate. Do NOT create, update, or delete any line items. Only ANALYZE and REPORT via the saveReview* tools. Be thorough — read every page of every document. Missing scope = missing findings.`;

    const settings = await store.getSettings();
    const integrations = (settings as any)?.integrations || {};
    const reasoningEffort = typeof integrations.agentReasoningEffort === "string" && integrations.agentReasoningEffort
      ? integrations.agentReasoningEffort
      : "extra_high";

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
        reasoningEffort,
      });

      // Persist events to DB
      let eventBuffer: any[] = [];
      let saveTimer: ReturnType<typeof setTimeout> | null = null;

      const flushEvents = async () => {
        if (eventBuffer.length === 0) return;
        const toSave = [...eventBuffer];
        eventBuffer = [];
        try {
          const run = await prisma.aiRun.findFirst({ where: { id: sessionId } });
          const existing = ((run?.output as any)?.events || []);
          await prisma.aiRun.update({
            where: { id: sessionId },
            data: { output: { events: [...existing, ...toSave] } as any },
          });
        } catch (err) {
          console.error(`[review] Failed to persist events for ${sessionId}:`, err);
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
        eventBuffer.push({ ...evt, timestamp: new Date().toISOString() });
        scheduleFlush();
      });

      session.events.on("done", async (finalStatus: string) => {
        if (saveTimer) clearTimeout(saveTimer);
        try {
          await flushEvents();
          await prisma.aiRun.update({
            where: { id: sessionId },
            data: { status: finalStatus },
          });
          // Mark review as completed/failed
          await prisma.quoteReview.update({
            where: { id: reviewId },
            data: { status: finalStatus === "completed" ? "completed" : "failed" },
          });
        } catch (err) {
          console.error(`[review] Failed to persist final status for ${sessionId}:`, err);
        }
      });

      return { sessionId, reviewId, projectId, runtime, status: "running" };
    } catch (err) {
      await prisma.aiRun.update({ where: { id: sessionId }, data: { status: "failed" } }).catch(() => {});
      await prisma.quoteReview.update({ where: { id: reviewId }, data: { status: "failed" } }).catch(() => {});
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Failed to start review" });
    }
  });

  // ── Get Latest Review ─────────────────────────────────────
  app.get("/api/review/:projectId/latest", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const review = await prisma.quoteReview.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    if (!review) return { review: null };
    const context = await getQuoteReviewContext(projectId);
    return { review: serializeReview(review, context) };
  });

  // ── SSE Stream (reuses CLI stream for the project) ────────
  app.get("/api/review/:projectId/stream", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const session = getSession(projectId);

    if (!session) {
      return reply.code(404).send({ error: "No active session for this project" });
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });

    reply.raw.write(`: connected\n\n`);

    const onEvent = (evt: any) => {
      try {
        const payload = JSON.stringify(evt.data);
        reply.raw.write(`event: ${evt.type}\ndata: ${payload}\n\n`);
      } catch {}
    };

    session.events.on("event", onEvent);

    const pingTimer = setInterval(() => {
      try { reply.raw.write(`: ping\n\n`); } catch {}
    }, 15_000);

    reply.raw.on("close", () => {
      session.events.off("event", onEvent);
      clearInterval(pingTimer);
    });

    session.events.once("done", () => {
      session.events.off("event", onEvent);
      clearInterval(pingTimer);
      try { reply.raw.end(); } catch {}
    });
  });

  // ── Save Review Section (called by MCP tools) ─────────────
  app.post("/api/review/:projectId/save-section", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { section, data } = (request.body || {}) as {
      section: "coverage" | "findings" | "competitiveness" | "recommendations" | "summary";
      data: any;
    };

    if (!section || !data) {
      return reply.code(400).send({ error: "section and data required" });
    }

    // Find the most recent running review for this project
    const review = await prisma.quoteReview.findFirst({
      where: { projectId, status: "running" },
      orderBy: { createdAt: "desc" },
    });

    if (!review) {
      return reply.code(404).send({ error: "No active review found" });
    }

    // For array-type sections (coverage, findings, recommendations), append to existing
    if (section === "coverage" || section === "findings") {
      const existing = (review[section] as any[]) || [];
      const newItems = Array.isArray(data) ? data : [data];
      await prisma.quoteReview.update({
        where: { id: review.id },
        data: { [section]: [...existing, ...newItems] },
      });
    } else if (section === "recommendations") {
      const existing = (review.recommendations as any[]) || [];
      const rec = { ...data, status: "open" };
      await prisma.quoteReview.update({
        where: { id: review.id },
        data: { recommendations: [...existing, rec] },
      });
    } else {
      // Object-type sections (competitiveness, summary) — merge/replace
      const nextValue =
        section === "summary"
          ? attachReviewMeta(data, extractReviewMeta(review.summary, review.createdAt.toISOString()))
          : data;
      await prisma.quoteReview.update({
        where: { id: review.id },
        data: { [section]: nextValue },
      });
      if (section === "summary") {
        const store = request.store;
        if (store) {
          await store.markEstimateReviewCompleted(projectId, review.revisionId, review.id).catch(() => null);
        }
      }
    }

    return { ok: true, section, reviewId: review.id };
  });

  app.put("/api/review/:projectId/manual", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = (request.body || {}) as {
      coverage?: unknown;
      findings?: unknown;
      competitiveness?: unknown;
      recommendations?: unknown;
      summary?: unknown;
      reviewState?: ReviewLifecycleState;
      refreshQuoteSnapshot?: boolean;
    };

    const review = await prisma.quoteReview.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    if (!review) return reply.code(404).send({ error: "No review found" });
    if (review.status === "running") {
      return reply.code(409).send({ error: "Stop the running review before making manual edits." });
    }

    const context = await getQuoteReviewContext(projectId);
    const fallbackSnapshot = review.createdAt.toISOString();
    const currentMeta = extractReviewMeta(review.summary, fallbackSnapshot);
    const nextMeta = { ...currentMeta };

    if (body.reviewState) {
      nextMeta.state = body.reviewState;
      nextMeta.resolvedAt = body.reviewState === "resolved" ? new Date().toISOString() : null;
    }

    const shouldRefreshSnapshot = body.refreshQuoteSnapshot === true || body.reviewState === "resolved";
    if (shouldRefreshSnapshot) {
      if (context.currentRevisionId && review.revisionId !== context.currentRevisionId) {
        return reply.code(409).send({ error: "This review was created on an older revision. Re-run the review instead of marking it current." });
      }
      nextMeta.quoteSnapshotUpdatedAt = context.quoteUpdatedAt ?? new Date().toISOString();
    }

    const currentSummary = stripReviewMeta(review.summary);
    const nextSummaryBase =
      body.summary !== undefined && isRecord(body.summary)
        ? { ...currentSummary, ...stripReviewMeta(body.summary) }
        : currentSummary;

    const updated = await prisma.quoteReview.update({
      where: { id: review.id },
      data: {
        ...(body.coverage !== undefined ? { coverage: normalizeCoverageItems(body.coverage) as any } : {}),
        ...(body.findings !== undefined ? { findings: normalizeFindings(body.findings) as any } : {}),
        ...(body.competitiveness !== undefined ? { competitiveness: normalizeCompetitiveness(body.competitiveness) as any } : {}),
        ...(body.recommendations !== undefined ? { recommendations: normalizeRecommendations(body.recommendations) as any } : {}),
        summary: attachReviewMeta(nextSummaryBase, nextMeta) as any,
      },
    });

    const refreshedContext = await getQuoteReviewContext(projectId);
    return { review: serializeReview(updated, refreshedContext) };
  });

  // ── Resolve Recommendation ────────────────────────────────
  app.post("/api/review/:projectId/resolve/:recId", async (request, reply) => {
    const { projectId, recId } = request.params as { projectId: string; recId: string };
    const store = request.store!;

    const review = await prisma.quoteReview.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    if (!review) return reply.code(404).send({ error: "No review found" });

    const recs = (review.recommendations as any[]) || [];
    const rec = recs.find((r: any) => r.id === recId);
    if (!rec) return reply.code(404).send({ error: "Recommendation not found" });

    if (rec.status === "resolved") {
      return reply.code(400).send({ error: "Already resolved" });
    }

    // Execute resolution actions
    const actions = rec.resolution?.actions || [];
    const workspace = await store.getWorkspace(projectId);
    if (!workspace) return reply.code(404).send({ error: "Project not found" });

    const revisionId = workspace.currentRevision?.id;

    for (const action of actions) {
      try {
        switch (action.action) {
          case "createItem": {
            await store.createWorksheetItem(projectId, action.worksheetId, {
              ...action.item,
              lineOrder: action.item?.lineOrder || 999,
            });
            break;
          }
          case "updateItem": {
            await store.updateWorksheetItem(projectId, action.itemId, action.changes);
            break;
          }
          case "deleteItem": {
            await store.deleteWorksheetItem(projectId, action.itemId);
            break;
          }
          case "addCondition": {
            if (revisionId) {
              await store.createCondition(projectId, revisionId, {
                type: action.type || "clarification",
                value: action.value || "",
              });
            }
            break;
          }
          default:
            console.warn(`[review] Unknown resolution action: ${action.action}`);
        }
      } catch (err) {
        console.error(`[review] Failed to execute action ${action.action}:`, err);
      }
    }

    // Mark recommendation as resolved
    const updatedRecs = recs.map((r: any) =>
      r.id === recId ? { ...r, status: "resolved" } : r
    );
    await prisma.quoteReview.update({
      where: { id: review.id },
      data: { recommendations: updatedRecs },
    });

    await store.captureAutomaticEstimateFeedback(projectId, {
      source: "review",
      feedbackType: "recommendation_resolved",
      sourceLabel: rec.title ?? "Resolved review recommendation",
      quoteReviewId: review.id,
      createNew: true,
      notes: rec.resolution?.summary ?? "",
      correction: {
        recommendationId: recId,
        title: rec.title ?? "",
        priority: rec.priority ?? null,
        actions,
        resolvedAt: new Date().toISOString(),
      },
    }).catch(() => null);

    // Return updated workspace response
    const freshWorkspace = await buildWorkspaceResponse(store, projectId);
    return freshWorkspace;
  });

  // ── Dismiss Recommendation ────────────────────────────────
  app.post("/api/review/:projectId/dismiss/:recId", async (request, reply) => {
    const { projectId, recId } = request.params as { projectId: string; recId: string };

    const review = await prisma.quoteReview.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    if (!review) return reply.code(404).send({ error: "No review found" });

    const recs = (review.recommendations as any[]) || [];
    const updatedRecs = recs.map((r: any) =>
      r.id === recId ? { ...r, status: "dismissed" } : r
    );

    await prisma.quoteReview.update({
      where: { id: review.id },
      data: { recommendations: updatedRecs },
    });

    return { ok: true };
  });

  // ── Stop Review Session ───────────────────────────────────
  app.post("/api/review/:projectId/stop", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const stopped = stopSession(projectId);

    // Mark review as completed
    const review = await prisma.quoteReview.findFirst({
      where: { projectId, status: "running" },
      orderBy: { createdAt: "desc" },
    });
    if (review) {
      await prisma.quoteReview.update({
        where: { id: review.id },
        data: { status: "completed" },
      });
    }

    return { stopped };
  });

  // ── Review Status ─────────────────────────────────────────
  app.get("/api/review/:projectId/status", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const session = getSession(projectId);

    const runs = await prisma.aiRun.findMany({
      where: { projectId, kind: "cli-review" },
      orderBy: { createdAt: "asc" },
    });

    if (runs.length === 0 && !session) {
      return { status: "none" };
    }

    const mergedEvents: any[] = [];
    for (const run of runs) {
      const runEvents = (run.output as any)?.events || [];
      if (runEvents.length < 3 && runs.length > 1) continue;
      mergedEvents.push({
        type: "run_divider",
        data: { runId: run.id, status: run.status, model: run.model, startedAt: run.createdAt?.toISOString?.() || "" },
        timestamp: run.createdAt?.toISOString?.() || "",
      });
      for (const event of runEvents) {
        mergedEvents.push(event);
      }
    }

    const latestRun = runs[runs.length - 1];
    const currentStatus = session?.status === "running" ? "running" : (latestRun?.status || "none");

    return {
      status: currentStatus,
      sessionId: latestRun?.id || session?.sessionId,
      events: mergedEvents,
    };
  });
}
