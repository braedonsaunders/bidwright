/**
 * CLI Management Routes
 *
 * Endpoints for detecting, authenticating, and managing CLI agent runtimes.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { detectCli, checkCliAuth, spawnSession, stopSession, resumeSession, getSession, listSessions, type AgentRuntime } from "../services/cli-runtime.js";
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

type PersistedCliEvent = {
  type?: string;
  data?: Record<string, unknown>;
  timestamp?: string;
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

function normalizeCliModel(runtime: AgentRuntime, model: string | null | undefined) {
  if (runtime === "claude-code") {
    return !model || model.includes("/") ? "sonnet" : model;
  }
  return !model || !model.startsWith("gpt") ? "gpt-5.4" : model;
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

    const claude = detectCli("claude-code");
    const codex = detectCli("codex");
    const claudeAuth = checkCliAuth("claude-code", integrations.anthropicKey);
    const codexAuth = checkCliAuth("codex", integrations.openaiKey);

    // Available models per runtime
    const claudeModels = claude.available ? [
      { id: "sonnet", name: "Claude Sonnet 4.6", description: "Fast, recommended for most estimates" },
      { id: "opus", name: "Claude Opus 4.6", description: "Highest quality, slower and more expensive" },
      { id: "haiku", name: "Claude Haiku 4.5", description: "Fastest and cheapest, less thorough" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (full ID)", description: "Explicit model ID" },
      { id: "claude-opus-4-6", name: "Claude Opus 4.6 (full ID)", description: "Explicit model ID" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (full ID)", description: "Explicit model ID" },
    ] : [];
    const codexModels = codex.available ? [
      { id: "gpt-5.4", name: "GPT-5.4", description: "Recommended for Codex" },
      { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", description: "Faster, cheaper" },
      { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", description: "Code-optimized" },
    ] : [];

    return {
      claude: { ...claude, auth: claudeAuth, models: claudeModels },
      codex: { ...codex, auth: codexAuth, models: codexModels },
      configured: {
        runtime: integrations.agentRuntime || null,
        model: integrations.agentModel || null,
      },
    };
  });

  // ── Start CLI Session ───────────────────────────────────────
  app.post("/api/cli/start", async (request, reply) => {
    const body = request.body as {
      projectId: string;
      runtime?: AgentRuntime;
      model?: string;
      scope?: string;
      prompt?: string;
      personaId?: string;
    };

    const { projectId, runtime = "claude-code", scope, prompt } = body;
    // Ensure model is valid for the chosen runtime — don't pass OpenRouter model IDs to Claude CLI
    const model = normalizeCliModel(runtime, body.model);
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

    // Spawn CLI
    const scopeDirective = effectiveScope
      ? `\n\nUSER SCOPE / COMMERCIAL INSTRUCTIONS (AUTHORITATIVE):\n${effectiveScope}\nTreat these instructions as binding commercial direction. If the user says an activity is subcontracted, already priced, owner-supplied, or otherwise commercially decided, do not re-estimate that package as self-performed labour unless the user explicitly asks for a validation breakdown.`
      : "";

    const initialPrompt = prompt || `Read CLAUDE.md now.${scopeDirective} Then execute the staged estimate workflow in order:

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
      select: { id: true, model: true },
    });
    const model = normalizeCliModel("claude-code", body.model ?? latestRun?.model ?? integrations.agentModel);
    const aiRunId = `cli-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

    try {
      const session = await resumeSession({
        projectId,
        projectDir,
        prompt: body.prompt,
        model,
        authToken: extractAuthToken(request),
        apiBaseUrl: `http://localhost:${process.env.API_PORT || 4001}`,
        customCliPath: integrations.claudeCodePath || undefined,
        anthropicApiKey: integrations.anthropicKey || process.env.ANTHROPIC_API_KEY || undefined,
      });

      await store.createAiRun({
        id: aiRunId,
        projectId,
        revisionId: workspace.currentRevision.id,
        kind: "cli-intake",
        status: "running",
        model,
        input: {
          runtime: "claude-code",
          prompt: body.prompt ?? "",
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
          runtime: "claude-code",
          prompt: body.prompt ?? "",
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

    // Spawn a new session with the user's message as the prompt
    // Claude Code will read CLAUDE.md + agent-memory.json for context
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

    try {
      const { execSync } = await import("node:child_process");
      const cliCmd = "claude";
      const args = [
        "--print",
        fullPrompt,
        "--model", "sonnet",
      ];

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
          updatedAt: true,
        },
      });

      const strategyMatchesLatestRun =
        strategy?.aiRunId === latestRun.id &&
        strategy.status === "complete" &&
        strategy.currentStage === "complete";

      if (strategyMatchesLatestRun) {
        derivedStatus = "completed";

        if (!latestRunClosed) {
          const lastEventTimestamp = latestRunEvents[latestRunEvents.length - 1]?.timestamp;
          const strategyUpdatedAt = strategy.updatedAt instanceof Date
            ? strategy.updatedAt.toISOString()
            : strategy.updatedAt;

          if (!lastEventTimestamp || (strategyUpdatedAt && strategyUpdatedAt > lastEventTimestamp)) {
            derivedCompletionEvents = buildSyntheticCompletionEvents(strategy.summary, strategy.updatedAt);
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
    const { bookId, runtime = "claude-code", model } = request.body as {
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

    // Write CLAUDE.md for dataset extraction
    // Build sections info for CLAUDE.md
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

    // Spawn CLI session — spawnSession handles MCP config + auth token internally
    const token = extractAuthToken(request);
    const sessionResult = await spawnSession({
      projectId: bookId,
      projectDir: workDir,
      prompt: `Read CLAUDE.md then extract all data tables from the PDF in book/. Call createDataset for each table.`,
      runtime,
      model,
      authToken: token,
      anthropicApiKey: integrations.anthropicKey || process.env.ANTHROPIC_API_KEY,
      openaiApiKey: integrations.openaiKey || process.env.OPENAI_API_KEY,
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
  const pendingQuestions = new Map<string, {
    question: string;
    options?: string[];
    context?: string;
    questions?: Array<{
      id?: string;
      prompt: string;
      options?: string[];
      placeholder?: string;
      context?: string;
    }>;
    resolve: (answer: string) => void;
  }>();

  // POST /api/cli/:projectId/question — MCP tool calls this, long-polls until user answers
  app.post("/api/cli/:projectId/question", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { question, options, context, questions } = (request.body || {}) as {
      question: string;
      options?: string[];
      context?: string;
      questions?: Array<{
        id?: string;
        prompt: string;
        options?: string[];
        placeholder?: string;
        context?: string;
      }>;
    };

    if (!question) return reply.code(400).send({ error: "question required" });

    // If there's already a pending question, reject old one
    const existing = pendingQuestions.get(projectId);
    if (existing) {
      existing.resolve("Previous question superseded by a new one.");
      pendingQuestions.delete(projectId);
    }

    // Emit the question as an SSE event so the frontend sees it immediately
    const promptEvent: PersistedCliEvent = {
      type: "askUser",
      data: { question, options: options || [], context: context || "", questions: questions || [] },
      timestamp: new Date().toISOString(),
    };
    const session = getSession(projectId);
    if (session) {
      session.events.emit("event", promptEvent);
    } else {
      await appendCliEventsToLatestRun(projectId, [promptEvent]).catch(() => {});
    }

    // Block until the user answers via /answer endpoint (max 5 min)
    const answer = await new Promise<string>((resolve) => {
      pendingQuestions.set(projectId, { question, options, context, questions, resolve });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (pendingQuestions.has(projectId)) {
          pendingQuestions.delete(projectId);
          resolve("No answer provided within timeout. Use your best judgment and document all assumptions.");
        }
      }, 5 * 60 * 1000);
    });

    return { answer };
  });

  // GET /api/cli/:projectId/pending-question — frontend polls for pending question
  app.get("/api/cli/:projectId/pending-question", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const pending = pendingQuestions.get(projectId);
    if (!pending) {
      return { pending: false };
    }
    return {
      pending: true,
      question: pending.question,
      options: pending.options || [],
      context: pending.context || "",
      questions: pending.questions || [],
    };
  });

  // POST /api/cli/:projectId/answer — frontend submits the user's answer
  app.post("/api/cli/:projectId/answer", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { answer } = (request.body || {}) as { answer: string };

    const pending = pendingQuestions.get(projectId);
    if (!pending) {
      return reply.code(404).send({ error: "No pending question for this project" });
    }

    pending.resolve(answer || "No specific answer provided. Use your best judgment.");
    pendingQuestions.delete(projectId);

    // Emit answer event so the stream picks it up
    const answerEvent: PersistedCliEvent = {
      type: "userAnswer",
      data: { answer },
      timestamp: new Date().toISOString(),
    };
    const session = getSession(projectId);
    if (session) {
      session.events.emit("event", answerEvent);
    } else {
      await appendCliEventsToLatestRun(projectId, [answerEvent]).catch(() => {});
    }

    return { ok: true, message: "Answer delivered to agent" };
  });
}
