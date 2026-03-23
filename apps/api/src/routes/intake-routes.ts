import type { FastifyInstance } from "fastify";
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

// In-memory intake session storage
const intakeSessions = new Map<string, AgentSession & {
  organizationId?: string;
  projectId: string;
  scope: string;
  intakeStatus: "running" | "completed" | "failed";
  summary?: string;
}>();

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

    const systemPrompt = buildIntakeSystemPrompt(promptParams);

    // Create session
    const sessionId = `intake-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const session: AgentSession & { organizationId?: string; projectId: string; scope: string; intakeStatus: "running" | "completed" | "failed"; summary?: string } = {
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

    // Create the agent with live callbacks
    const adapter = createLLMAdapter({
      provider: resolvedProvider as any,
      apiKey: resolvedApiKey,
      model: resolvedModel,
    });

    const loop = new AgentLoop(
      {
        llm: adapter,
        maxIterations,
        maxTokens: 4096,
        temperature: 0,
        systemPrompt,
        onToolCall: (tc) => {
          const s = intakeSessions.get(sessionId);
          if (s) {
            s.toolCalls.push(tc);
            s.updatedAt = new Date().toISOString();
          }
        },
        onMessage: (msg) => {
          const s = intakeSessions.get(sessionId);
          if (s) {
            s.messages.push(msg);
            s.updatedAt = new Date().toISOString();
          }
        },
      },
      registry
    );

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

    // Build the initial message
    const initialMessage = scope
      ? `Review the bid package documents for this project and build a complete estimate. Focus on scope: ${scope}`
      : "Review all bid package documents for this project and build a complete estimate covering the full scope of work.";

    // Add initial user message immediately
    session.messages.push({ role: "user", content: initialMessage });

    // Run the agent asynchronously — don't await
    (async () => {
      try {
        const response = await loop.run(session, initialMessage, context);
        const s = intakeSessions.get(sessionId);
        if (s) {
          s.intakeStatus = "completed";
          s.summary = response.message;
          s.updatedAt = new Date().toISOString();
        }
      } catch (error) {
        const s = intakeSessions.get(sessionId);
        if (s) {
          s.intakeStatus = "failed";
          s.summary = error instanceof Error ? error.message : String(error);
          s.updatedAt = new Date().toISOString();
        }
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
      recentToolCalls: session.toolCalls.map((tc: any) => ({
        toolId: tc.toolId ?? tc.id,
        success: tc.result?.success ?? tc.success,
        duration_ms: tc.result?.duration_ms ?? tc.duration_ms,
      })),
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
}
