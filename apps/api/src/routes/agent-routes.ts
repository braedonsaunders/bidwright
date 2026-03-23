import type { FastifyInstance } from "fastify";
import { ToolRegistry, AgentLoop, buildSystemPrompt, type ToolExecutionContext, type AgentSession, type WorkspaceSnapshot } from "@bidwright/agent";
import { quoteTools, systemTools, knowledgeTools, projectFileTools, datasetGenTools, webTools, scheduleTools, rateScheduleTools, pricingTools } from "@bidwright/agent";
import { createLLMAdapter } from "@bidwright/agent";
import { knowledgeService } from "../services/knowledge-service.js";

// In-memory session storage (sessions track orgId for consistency)
const sessions = new Map<string, AgentSession & { organizationId?: string }>();

export async function agentRoutes(app: FastifyInstance) {
  // Build registry once
  const registry = new ToolRegistry();
  registry.registerMany([...quoteTools, ...systemTools, ...knowledgeTools, ...projectFileTools, ...datasetGenTools, ...webTools, ...scheduleTools, ...rateScheduleTools, ...pricingTools]);

  app.post("/api/agent/sessions", async (request, reply) => {
    const body = request.body as { projectId: string; revisionId?: string; provider?: string; model?: string; apiKey?: string };
    const sessionId = `session-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

    const session: AgentSession & { organizationId?: string } = {
      id: sessionId,
      projectId: body.projectId,
      revisionId: body.revisionId ?? "",
      quoteId: "",
      userId: "",
      messages: [],
      toolCalls: [],
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      organizationId: request.user?.organizationId ?? undefined,
    };
    sessions.set(sessionId, session);

    reply.code(201);
    return { sessionId, status: "active", provider: body.provider ?? "anthropic", model: body.model ?? "claude-sonnet-4-20250514" };
  });

  app.post("/api/agent/sessions/:sessionId/messages", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const { content, provider, model, apiKey } = request.body as { content: string; provider?: string; model?: string; apiKey?: string };

    const session = sessions.get(sessionId);
    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    // Try to get API key from org settings, then env, then request override
    const settings = await request.store!.getSettings();
    const integrations = settings.integrations ?? {} as any;

    const resolvedProvider = provider ?? integrations.llmProvider ?? process.env.LLM_PROVIDER ?? "anthropic";
    const resolvedModel = model ?? integrations.llmModel ?? process.env.LLM_MODEL ?? "claude-sonnet-4-20250514";

    const keyMap: Record<string, string> = {
      anthropic: integrations.anthropicKey ?? process.env.ANTHROPIC_API_KEY ?? "",
      openai: integrations.openaiKey ?? process.env.OPENAI_API_KEY ?? "",
      openrouter: integrations.openrouterKey ?? process.env.OPENROUTER_API_KEY ?? "",
      gemini: integrations.geminiKey ?? process.env.GEMINI_API_KEY ?? "",
    };
    const resolvedApiKey = apiKey ?? keyMap[resolvedProvider] ?? "";

    if (!resolvedApiKey) {
      return {
        sessionId,
        message: `No API key configured for ${resolvedProvider}. Set ${resolvedProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} environment variable, or configure it in Settings > Integrations.`,
        toolCallsExecuted: [],
        citations: [],
        tokensUsed: { input: 0, output: 0 },
      };
    }

    try {
      const adapter = createLLMAdapter({ provider: resolvedProvider as any, apiKey: resolvedApiKey, model: resolvedModel });

      // Build workspace snapshot for system prompt
      const workspace = await request.store!.getWorkspace(session.projectId);
      const snapshot: WorkspaceSnapshot = workspace ? {
        projectName: workspace.project.name,
        clientName: workspace.project.clientName,
        location: workspace.project.location,
        quoteNumber: workspace.quote?.quoteNumber ?? "",
        revisionNumber: workspace.currentRevision?.revisionNumber ?? 0,
        status: (workspace.currentRevision as any)?.status ?? "Open",
        type: (workspace.currentRevision as any)?.type ?? "Firm",
        subtotal: workspace.currentRevision?.subtotal ?? 0,
        cost: workspace.currentRevision?.cost ?? 0,
        estimatedProfit: workspace.currentRevision?.estimatedProfit ?? 0,
        estimatedMargin: workspace.currentRevision?.estimatedMargin ?? 0,
        totalHours: workspace.currentRevision?.totalHours ?? 0,
        worksheetCount: workspace.worksheets?.length ?? 0,
        lineItemCount: workspace.worksheets?.reduce((s, w) => s + w.items.length, 0) ?? 0,
        phaseCount: workspace.phases?.length ?? 0,
        modifierCount: workspace.modifiers?.length ?? 0,
        documentCount: 0,
        citationCount: workspace.citations?.length ?? 0,
        aiRunCount: workspace.aiRuns?.length ?? 0,
        scheduleTaskCount: (workspace as any).scheduleTasks?.length ?? 0,
      } : {
        projectName: "Unknown", clientName: "", location: "", quoteNumber: "", revisionNumber: 0,
        status: "Open", type: "Firm", subtotal: 0, cost: 0, estimatedProfit: 0, estimatedMargin: 0,
        totalHours: 0, worksheetCount: 0, lineItemCount: 0, phaseCount: 0, modifierCount: 0,
        documentCount: 0, citationCount: 0, aiRunCount: 0, scheduleTaskCount: 0,
      };

      const systemPrompt = buildSystemPrompt(snapshot, registry.categories());

      const loop = new AgentLoop(
        { llm: adapter, maxIterations: 10, maxTokens: 4096, temperature: 0, systemPrompt },
        registry
      );

      const authToken = (request.headers.authorization ?? "").replace("Bearer ", "");
      const context: ToolExecutionContext = {
        projectId: session.projectId,
        revisionId: session.revisionId,
        quoteId: "",
        userId: request.user?.id ?? "",
        sessionId,
        apiBaseUrl: "http://localhost:4001",
        authToken,
      };

      const response = await loop.run(session, content, context);

      // Update session
      session.messages.push({ role: "user", content });
      session.messages.push({ role: "assistant", content: response.message });
      session.updatedAt = new Date().toISOString();

      return {
        sessionId,
        message: response.message,
        toolCallsExecuted: response.toolCallsExecuted,
        citations: response.citations,
        tokensUsed: response.tokensUsed,
      };
    } catch (error) {
      return {
        sessionId,
        message: `Agent error: ${error instanceof Error ? error.message : String(error)}`,
        toolCallsExecuted: [],
        citations: [],
        tokensUsed: { input: 0, output: 0 },
      };
    }
  });

  // Keep existing routes for sessions GET/DELETE, tools, knowledge, providers
  app.get("/api/agent/sessions/:sessionId", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = sessions.get(sessionId);
    return session ?? { error: "Session not found" };
  });

  app.delete("/api/agent/sessions/:sessionId", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    sessions.delete(sessionId);
    return { deleted: true };
  });

  // Tool listing from actual registry
  app.get("/api/tools", async (request) => {
    const query = request.query as { category?: string; search?: string };
    const tools = registry.list({ category: query.category, search: query.search });
    return { tools, count: tools.length, categories: registry.categories() };
  });

  // Dynamic tools CRUD - backed by Plugin model
  app.get("/api/tools/dynamic", async (request) => {
    const plugins = await request.store!.listPlugins();
    const dynamicTools = plugins
      .filter((p: any) => p.toolDefinitions && Array.isArray(p.toolDefinitions) && p.toolDefinitions.length > 0)
      .map((p: any) => ({ id: p.id, name: p.name, slug: p.slug, enabled: p.enabled, toolDefinitions: p.toolDefinitions }));
    return { tools: dynamicTools, count: dynamicTools.length };
  });
  app.post("/api/tools/dynamic", async (request, reply) => {
    const body = request.body as { name: string; slug?: string; description?: string; toolDefinitions: unknown[] };
    const plugin = await request.store!.createPlugin({
      name: body.name,
      slug: body.slug ?? body.name.toLowerCase().replace(/\s+/g, "-"),
      category: "dynamic" as const,
      description: body.description ?? "",
      toolDefinitions: (body.toolDefinitions ?? []) as any,
      config: {},
      version: "1.0.0",
      enabled: true,
    });
    reply.code(201);
    return plugin;
  });
  app.patch("/api/tools/dynamic/:toolId", async (request) => {
    const { toolId } = request.params as { toolId: string };
    const patch = request.body as Record<string, unknown>;
    const updated = await request.store!.updatePlugin(toolId, patch);
    return updated;
  });
  app.delete("/api/tools/dynamic/:toolId", async (request) => {
    const { toolId } = request.params as { toolId: string };
    await request.store!.deletePlugin(toolId);
    return { deleted: true };
  });

  // Knowledge search - uses vector search when available, falls back to text
  app.get("/api/knowledge/search", async (request) => {
    const query = request.query as { q?: string; projectId?: string; bookId?: string; limit?: string };
    if (!query.q) return { hits: [], query: "", count: 0 };
    const results = await knowledgeService.search(query.q, {
      projectId: query.projectId,
      bookId: query.bookId,
      limit: query.limit ? parseInt(query.limit, 10) : 20,
      includeProjectDocs: !!query.projectId,
    });
    return { hits: results, query: query.q, count: results.length };
  });

  app.get("/api/knowledge/documents/:projectId", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const docs = await request.store!.listDocuments(projectId);
    return { documents: docs, projectId };
  });

  app.post("/api/knowledge/ingest", async (request, reply) => {
    reply.code(201);
    return { status: "queued", message: "Document queued for ingestion" };
  });

  app.post("/api/knowledge/library", async (request, reply) => {
    reply.code(201);
    return { status: "queued", message: "Library document queued for ingestion" };
  });

  // Provider listing with OpenRouter and all providers
  app.get("/api/agent/providers", async () => ({
    providers: [
      { id: "anthropic", name: "Anthropic Claude", models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-4-5-20251001"] },
      { id: "openai", name: "OpenAI", models: ["gpt-4o", "gpt-4o-mini", "o3-mini", "o4-mini"] },
      { id: "openrouter", name: "OpenRouter", models: ["anthropic/claude-sonnet-4-20250514", "openai/gpt-4o", "google/gemini-2.5-pro", "meta-llama/llama-4-maverick"] },
      { id: "gemini", name: "Google Gemini", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
      { id: "lmstudio", name: "LM Studio (Local)", models: ["default"] },
    ],
  }));
}
