import type { FastifyInstance } from "fastify";
import { readFile as readFileFs } from "node:fs/promises";
import { resolveApiPath } from "../paths.js";
import {
  ToolRegistry,
  AgentLoop,
  type ToolExecutionContext,
  type AgentSession,
} from "@bidwright/agent";
import {
  quoteTools,
  systemTools,
  knowledgeTools,
  projectFileTools,
  datasetGenTools,
  webTools,
  scheduleTools,
  rateScheduleTools,
} from "@bidwright/agent";
import { pricingTools } from "@bidwright/agent";
import { createLLMAdapter } from "@bidwright/agent";
import { buildIntakeSystemPrompt, type IntakePromptParams } from "@bidwright/agent";
import { runIntakeOrchestration, type DocumentInfo } from "@bidwright/agent";

// In-memory intake session storage
const intakeSessions = new Map<string, AgentSession & {
  organizationId?: string;
  projectId: string;
  scope: string;
  intakeStatus: "running" | "completed" | "failed" | "stopped";
  summary?: string;
}>();

// Abort controllers for running sessions
const intakeAbortControllers = new Map<string, AbortController>();

// Helper to build sorted events from a session
function buildEventsFromSession(s: { toolCalls: any[]; messages: any[]; updatedAt: string }) {
  const items: Array<{ ts: string; kind: "tool" | "message"; data: any }> = [];
  for (const tc of s.toolCalls) {
    items.push({ ts: (tc as any).timestamp ?? "", kind: "tool", data: { toolId: (tc as any).toolId, success: (tc as any).result?.success, duration_ms: (tc as any).result?.duration_ms } });
  }
  for (const m of s.messages) {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    if (content) items.push({ ts: (m as any).timestamp ?? "", kind: "message", data: { role: (m as any).role, content } });
  }
  items.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
  return items.map((item, i) => ({ seq: i, type: item.kind, data: item.data }));
}

export async function intakeRoutes(app: FastifyInstance) {
  // Build registry with all tools including pricing
  const registry = new ToolRegistry();
  registry.registerMany([
    ...quoteTools,
    ...systemTools,
    ...knowledgeTools,
    ...projectFileTools,
    ...datasetGenTools,
    ...webTools,
    ...scheduleTools,
    ...rateScheduleTools,
    ...pricingTools,
  ]);

  // ──────────────────────────────────────────────────────────────
  // POST /api/intake/start — Start autonomous intake agent
  // ──────────────────────────────────────────────────────────────
  app.post("/api/intake/start", async (request, reply) => {
    const body = request.body as {
      projectId: string;
      scope?: string;
      provider?: string;
      model?: string;
      apiKey?: string;
      maxIterations?: number;
    };

    if (!body.projectId) {
      return reply.code(400).send({ message: "projectId is required" });
    }

    const store = request.store!;

    // Load project and workspace
    const project = await store.getProject(body.projectId);
    if (!project) {
      return reply.code(404).send({ message: "Project not found" });
    }

    const workspace = await store.getWorkspace(body.projectId);
    if (!workspace) {
      return reply.code(404).send({ message: "Project workspace not found" });
    }

    // Wait for ingestion to complete before starting the agent
    const ingestionStatus = (project as any).ingestionStatus;
    if (ingestionStatus === "processing" || ingestionStatus === "queued") {
      // Poll until ready (max 5 minutes)
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const p = await store.getProject(body.projectId);
        const st = (p as any)?.ingestionStatus;
        if (st && st !== "processing" && st !== "queued") break;
      }
    }

    // Get documents for manifest
    const documents = await store.listDocuments(body.projectId);

    // Resolve LLM configuration from org settings, then env, then body overrides
    const settings = await store.getSettings();
    const integrations = settings.integrations ?? {} as any;

    const resolvedProvider = body.provider ?? integrations.llmProvider ?? process.env.LLM_PROVIDER ?? "anthropic";
    const resolvedModel = body.model ?? integrations.llmModel ?? process.env.LLM_MODEL ?? "claude-sonnet-4-20250514";

    const keyMap: Record<string, string> = {
      anthropic: integrations.anthropicKey ?? process.env.ANTHROPIC_API_KEY ?? "",
      openai: integrations.openaiKey ?? process.env.OPENAI_API_KEY ?? "",
      openrouter: integrations.openrouterKey ?? process.env.OPENROUTER_API_KEY ?? "",
      gemini: integrations.geminiKey ?? process.env.GEMINI_API_KEY ?? "",
    };
    const resolvedApiKey = body.apiKey ?? keyMap[resolvedProvider] ?? "";

    if (!resolvedApiKey) {
      return reply.code(400).send({
        message: `No API key configured for ${resolvedProvider}. Set the appropriate environment variable or pass apiKey.`,
      });
    }

    // Build intake system prompt
    const scope = body.scope ?? (project as any).scope ?? "";
    const promptParams: IntakePromptParams = {
      projectName: (project as any).name ?? project.name,
      clientName: (project as any).clientName ?? "",
      location: (project as any).location ?? "",
      scope,
      quoteNumber: workspace.quote?.quoteNumber ?? "",
      documents: documents.map((d: any) => ({
        id: d.id,
        fileName: d.fileName,
        fileType: d.fileType ?? "",
        documentType: d.documentType ?? "unknown",
        pageCount: d.pageCount ?? 0,
      })),
      toolCategories: registry.categories(),
    };

    let systemPrompt = buildIntakeSystemPrompt(promptParams);

    // Inject existing agent memory if available
    try {
      const memPath = resolveApiPath("projects", body.projectId, "agent-memory.json");
      const raw = await readFileFs(memPath, "utf8");
      const memory = JSON.parse(raw);
      if (memory.sections && Object.keys(memory.sections).length > 0) {
        const memoryText = Object.entries(memory.sections)
          .map(([k, v]) => `### ${k}\n${v}`)
          .join("\n\n");
        systemPrompt += `\n\n## Agent Memory (from prior sessions)\n\n${memoryText}`;
      }
    } catch {}

    // Create session + persist to DB
    const sessionId = `intake-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

    // Create AiRun record in DB for persistence
    await store.createAiRun({
      id: sessionId,
      projectId: body.projectId,
      revisionId: workspace.currentRevision?.id ?? "",
      kind: "intake",
      status: "running",
      model: resolvedModel,
      input: { scope, provider: resolvedProvider, documentCount: documents.length } as any,
      output: { events: [], summary: null } as any,
    });

    const session: AgentSession & { organizationId?: string; projectId: string; scope: string; intakeStatus: "running" | "completed" | "failed" | "stopped"; summary?: string } = {
      id: sessionId,
      projectId: body.projectId,
      revisionId: workspace.currentRevision?.id ?? "",
      quoteId: workspace.quote?.id ?? "",
      userId: "",
      messages: [],
      toolCalls: [],
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      organizationId: request.user?.organizationId ?? undefined,
      scope,
      intakeStatus: "running",
    };
    intakeSessions.set(sessionId, session);

    // Resolve max iterations from settings or body override (default 200)
    const maxIterations = body.maxIterations
      ?? (settings.defaults as any)?.maxAgentIterations
      ?? 200;

    const adapter = createLLMAdapter({
      provider: resolvedProvider as any,
      apiKey: resolvedApiKey,
      model: resolvedModel,
    });

    const authToken = (request.headers.authorization ?? "").replace("Bearer ", "");
    const context: ToolExecutionContext = {
      projectId: body.projectId,
      revisionId: workspace.currentRevision?.id ?? "",
      quoteId: workspace.quote?.id ?? "",
      userId: request.user?.id ?? "",
      sessionId,
      apiBaseUrl: "http://localhost:4001",
      authToken,
    };

    // Add initial message
    session.messages.push({ role: "user", content: "Starting intake estimation..." });

    // Create abort controller for this session
    const abortController = new AbortController();
    intakeAbortControllers.set(sessionId, abortController);

    // ── Tool registries for different phases ──
    const planningTools = new ToolRegistry();
    const itemTools = new ToolRegistry();
    for (const id of [
      "project.readFile", "project.listFiles", "project.getDocumentManifest", "project.searchFiles",
      "knowledge.queryProjectDocs", "quote.getWorkspace",
      "quote.createWorksheet", "quote.updateQuote", "quote.createCondition", "quote.createPhase",
      "system.readMemory", "system.writeMemory",
    ]) { const t = registry.get(id); if (t) planningTools.register(t); }

    for (const id of [
      "project.readFile", "project.searchFiles", "knowledge.queryProjectDocs",
      "quote.getItemConfig", "quote.createWorksheetItem", "quote.getWorkspace",
      "system.readMemory", "system.writeMemory",
    ]) { const t = registry.get(id); if (t) itemTools.register(t); }

    // Debounced DB persistence (save every 5 seconds, not every event)
    let dbSaveTimer: ReturnType<typeof setTimeout> | null = null;
    const persistToDb = () => {
      if (dbSaveTimer) return;
      dbSaveTimer = setTimeout(async () => {
        dbSaveTimer = null;
        const s = intakeSessions.get(sessionId);
        if (!s) return;
        try {
          await store.updateAiRun(sessionId, {
            status: s.intakeStatus,
            output: {
              events: buildEvents(s),
              summary: s.summary ?? null,
            } as any,
          });
        } catch {}
      }, 5000);
    };

    function buildEvents(s: typeof session) {
      const items: Array<{ ts: string; kind: "tool" | "message"; data: any }> = [];
      for (const tc of s.toolCalls) {
        items.push({ ts: (tc as any).timestamp ?? "", kind: "tool", data: { toolId: (tc as any).toolId, success: (tc as any).result?.success, duration_ms: (tc as any).result?.duration_ms } });
      }
      for (const m of s.messages) {
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        if (content) items.push({ ts: (m as any).timestamp ?? "", kind: "message", data: { role: (m as any).role, content } });
      }
      items.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
      return items.map((item, i) => ({ seq: i, type: item.kind, data: item.data }));
    }

    const onToolCall = (tc: any) => {
      const s = intakeSessions.get(sessionId);
      if (s) { s.toolCalls.push({ ...tc, timestamp: new Date().toISOString() }); s.updatedAt = new Date().toISOString(); }
      persistToDb();
    };
    const onMessage = (msg: any) => {
      const s = intakeSessions.get(sessionId);
      if (s) { s.messages.push({ ...msg, timestamp: new Date().toISOString() }); s.updatedAt = new Date().toISOString(); }
      persistToDb();
    };

    // ── 3-Phase Intake Pipeline ──
    (async () => {
      try {
        // ═══ PHASE 1: Scope & Worksheets (planning agent) ═══
        onMessage({ role: "assistant", content: "[Phase 1] Reading documents and writing scope..." });

        const planLoop = new AgentLoop({
          llm: adapter, maxIterations: Math.min(30, Math.floor(maxIterations * 0.15)),
          maxTokens: 4096, temperature: 0, abortSignal: abortController.signal,
          systemPrompt: systemPrompt + `\n\n## CURRENT PHASE: Scope & Worksheets\n\nYou are in Phase 1. Your job is to:\n1. Read the key documents (RFQ, main spec, quotation details)\n2. Write a detailed scope summary to memory section "scope_plan"\n3. Update the quote description with quote.updateQuote\n4. Create ALL worksheets needed (one per trade/system)\n5. Write worksheet IDs to memory section "worksheets_created"\n\nDo NOT create line items yet — that happens in Phase 2.\nFocus on understanding the full scope and creating the right worksheet structure.`,
          onToolCall, onMessage,
        }, planningTools);

        const planSession: AgentSession = {
          id: `${sessionId}-plan`, projectId: body.projectId, revisionId: context.revisionId,
          quoteId: context.quoteId, userId: "", messages: [], toolCalls: [],
          status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };

        await planLoop.run(planSession, "Read the key documents, write a detailed scope, and create all worksheets.", context);

        if (abortController.signal.aborted) throw new Error("Stopped by user");

        // ═══ PHASE 2: Spawn sub-agents per worksheet ═══
        // Get the worksheets that were just created
        const wsData = await store.getWorkspace(body.projectId);
        const worksheets = wsData?.worksheets?.filter((w: any) => w.name !== "Estimate") ?? [];

        onMessage({ role: "assistant", content: `[Phase 2] Populating ${worksheets.length} worksheets with line items...` });

        // Read scope plan from memory for sub-agent context
        let scopePlan = "";
        try {
          const memPath = resolveApiPath("projects", body.projectId, "agent-memory.json");
          const raw = await readFileFs(memPath, "utf8");
          const mem = JSON.parse(raw);
          scopePlan = mem.sections?.scope_plan ?? "";
        } catch {}

        // Spawn a sub-agent for each worksheet
        const itemIterationsPerWs = Math.max(15, Math.floor((maxIterations * 0.8) / Math.max(worksheets.length, 1)));

        for (const ws of worksheets) {
          if (abortController.signal.aborted) break;

          onMessage({ role: "assistant", content: `[Phase 2] Populating worksheet: ${ws.name}...` });

          const wsSession: AgentSession = {
            id: `${sessionId}-ws-${ws.id}`, projectId: body.projectId, revisionId: context.revisionId,
            quoteId: context.quoteId, userId: "", messages: [], toolCalls: [],
            status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          };

          const wsPrompt = `You are populating the "${ws.name}" worksheet (ID: ${ws.id}) for project "${(project as any).name}".

## Scope Context
${scopePlan || "Read the project documents to understand scope."}

## Your ONE Job
Create line items for the "${ws.name}" worksheet using quote.createWorksheetItem.
- worksheetId: "${ws.id}"
- Read relevant documents to find items for this system/trade
- Create a createWorksheetItem call for EVERY item
- Include: entityName, category (Material/Labour/Equipment/Subcontractor), description (cite source doc), quantity, uom, cost ($0 if unknown)

Do NOT create other worksheets. Only add items to worksheet "${ws.id}".`;

          const wsLoop = new AgentLoop({
            llm: adapter, maxIterations: itemIterationsPerWs,
            maxTokens: 4096, temperature: 0, abortSignal: abortController.signal,
            systemPrompt: wsPrompt,
            prepareStep: (step, history) => {
              const items = history.filter(h => h.toolId === "quote.createWorksheetItem").length;
              const reads = history.filter(h => h.toolId.includes("readFile")).length;
              if (reads >= 3 && items === 0) {
                return { injectMessage: `You've read enough. Create line items for "${ws.name}" now using quote.createWorksheetItem with worksheetId "${ws.id}".` };
              }
              return undefined;
            },
            onToolCall, onMessage,
          }, itemTools);

          try {
            await wsLoop.run(wsSession, `Read documents and create all line items for the "${ws.name}" worksheet.`, context);
          } catch (err) {
            onMessage({ role: "assistant", content: `[Phase 2] Error on ${ws.name}: ${err instanceof Error ? err.message : String(err)}` });
          }
        }

        // ═══ PHASE 3: Finalize ═══
        onMessage({ role: "assistant", content: "[Phase 3] Adding conditions and finalizing..." });

        const finalSession: AgentSession = {
          id: `${sessionId}-final`, projectId: body.projectId, revisionId: context.revisionId,
          quoteId: context.quoteId, userId: "", messages: [], toolCalls: [],
          status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };

        const finalLoop = new AgentLoop({
          llm: adapter, maxIterations: Math.min(10, Math.floor(maxIterations * 0.05)),
          maxTokens: 4096, temperature: 0, abortSignal: abortController.signal,
          systemPrompt: `You are finalizing the estimate for "${(project as any).name}". Add conditions (exclusions, clarifications, assumptions) and write a completion summary to memory. Use quote.createCondition and system.writeMemory.`,
          onToolCall, onMessage,
        }, planningTools);

        const finalResult = await finalLoop.run(finalSession, "Add conditions and write a completion summary.", context);

        const s = intakeSessions.get(sessionId);
        const finalStatus = abortController.signal.aborted ? "stopped" : "completed";
        if (s) {
          s.intakeStatus = finalStatus;
          s.summary = finalResult.message;
          s.updatedAt = new Date().toISOString();
        }
        // Final DB save
        await store.updateAiRun(sessionId, {
          status: finalStatus,
          output: { events: s ? buildEvents(s) : [], summary: finalResult.message } as any,
        }).catch(() => {});
      } catch (error) {
        const s = intakeSessions.get(sessionId);
        const finalStatus = abortController.signal.aborted ? "stopped" : "failed";
        const errMsg = error instanceof Error ? error.message : String(error);
        if (s) {
          s.intakeStatus = finalStatus;
          s.summary = errMsg;
          s.updatedAt = new Date().toISOString();
        }
        await store.updateAiRun(sessionId, {
          status: finalStatus,
          output: { events: s ? buildEvents(s) : [], summary: errMsg } as any,
        }).catch(() => {});
      } finally {
        intakeAbortControllers.delete(sessionId);
        if (dbSaveTimer) clearTimeout(dbSaveTimer);
      }
    })();

    // Update project ingestion status
    await store.updateProjectStatus(body.projectId, { ingestionStatus: "estimating" }).catch(() => {});

    reply.code(201);
    return {
      sessionId,
      projectId: body.projectId,
      scope,
      status: "running",
      documentCount: documents.length,
      message: "Intake agent started. Use GET /api/intake/:sessionId/status to check progress.",
    };
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/intake/:sessionId/status — Check intake progress
  // ──────────────────────────────────────────────────────────────
  app.get("/api/intake/:sessionId/status", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = intakeSessions.get(sessionId);

    if (!session) {
      return reply.code(404).send({ message: "Intake session not found" });
    }

    return {
      sessionId,
      projectId: session.projectId,
      scope: session.scope,
      status: session.intakeStatus,
      toolCallCount: session.toolCalls.length,
      messageCount: session.messages.length,
      summary: session.summary ?? null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      // Build a unified chronological stream of events
      events: (() => {
        const events: Array<{ seq: number; type: "tool" | "message"; data: any }> = [];
        let seq = 0;

        // Interleave messages and tool calls by their timestamps
        const allItems: Array<{ ts: string; kind: "tool" | "message"; data: any }> = [];

        for (const tc of session.toolCalls) {
          allItems.push({
            ts: (tc as any).timestamp ?? session.updatedAt,
            kind: "tool",
            data: { toolId: (tc as any).toolId ?? (tc as any).id, success: (tc as any).result?.success ?? (tc as any).success, duration_ms: (tc as any).result?.duration_ms ?? (tc as any).duration_ms },
          });
        }
        for (const m of session.messages) {
          const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
          if (!content) continue;
          allItems.push({
            ts: (m as any).timestamp ?? session.updatedAt,
            kind: "message",
            data: { role: (m as any).role ?? "assistant", content },
          });
        }

        // Sort by timestamp
        allItems.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));

        for (const item of allItems) {
          events.push({ seq: seq++, type: item.kind, data: item.data });
        }
        return events;
      })(),
    };
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/intake/:sessionId/messages — Get full message history
  // ──────────────────────────────────────────────────────────────
  app.get("/api/intake/:sessionId/messages", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = intakeSessions.get(sessionId);

    if (!session) {
      return reply.code(404).send({ message: "Intake session not found" });
    }

    return {
      sessionId,
      status: session.intakeStatus,
      messages: session.messages,
      toolCalls: session.toolCalls,
    };
  });

  // ──────────────────────────────────────────────────────────────
  // POST /api/intake/:sessionId/stop — Stop a running intake
  // ──────────────────────────────────────────────────────────────
  app.post("/api/intake/:sessionId/stop", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = intakeSessions.get(sessionId);

    if (!session) {
      return reply.code(404).send({ message: "Intake session not found" });
    }

    if (session.intakeStatus !== "running") {
      return { message: "Session is not running", status: session.intakeStatus };
    }

    const controller = intakeAbortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      session.intakeStatus = "stopped";
      session.updatedAt = new Date().toISOString();
      session.messages.push({ role: "assistant", content: "[Stopped by user]" });
    }

    return { message: "Session stopped", status: "stopped" };
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/intake/project/:projectId/latest — Get latest intake run from DB
  // ──────────────────────────────────────────────────────────────
  app.get("/api/intake/project/:projectId/latest", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    // First check if there's a running in-memory session
    for (const [sid, session] of intakeSessions.entries()) {
      if (session.projectId === projectId) {
        return {
          sessionId: sid,
          status: session.intakeStatus,
          source: "live",
          events: buildEventsFromSession(session),
          summary: session.summary ?? null,
          toolCallCount: session.toolCalls.length,
          messageCount: session.messages.length,
        };
      }
    }

    // Fall back to DB
    const run = await request.store!.getLatestAiRun(projectId, "intake");
    if (!run) {
      return reply.code(404).send({ message: "No intake runs found for this project" });
    }

    const output = run.output as any;
    return {
      sessionId: run.id,
      status: run.status,
      source: "db",
      events: output?.events ?? [],
      summary: output?.summary ?? null,
      toolCallCount: (output?.events ?? []).filter((e: any) => e.type === "tool").length,
      messageCount: (output?.events ?? []).filter((e: any) => e.type === "message").length,
    };
  });
}
