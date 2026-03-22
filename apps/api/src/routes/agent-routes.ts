import type { FastifyInstance } from "fastify";
import { ToolRegistry, AgentLoop, buildSystemPrompt, type ToolExecutionContext, type AgentSession, type WorkspaceSnapshot } from "@bidwright/agent";
import { quoteTools, systemTools } from "@bidwright/agent";
import { createLLMAdapter } from "@bidwright/agent";
import { apiStore } from "../persistent-store.js";

// In-memory session storage
const sessions = new Map<string, AgentSession>();

export async function agentRoutes(app: FastifyInstance) {
  // Build registry once
  const registry = new ToolRegistry();
  registry.registerMany([...quoteTools, ...systemTools]);

  app.post("/api/agent/sessions", async (request, reply) => {
    const body = request.body as { projectId: string; revisionId?: string; provider?: string; model?: string; apiKey?: string };
    const sessionId = `session-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

    const session: AgentSession = {
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

    // Try to get API key from request, env, or settings
    const resolvedApiKey = apiKey
      ?? process.env.ANTHROPIC_API_KEY
      ?? process.env.OPENAI_API_KEY
      ?? "";

    const resolvedProvider = provider ?? process.env.LLM_PROVIDER ?? "anthropic";
    const resolvedModel = model ?? process.env.LLM_MODEL ?? "claude-sonnet-4-20250514";

    if (!resolvedApiKey) {
      // No API key - return helpful message instead of crashing
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
      const workspace = await apiStore.getWorkspace(session.projectId);
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
      } : {
        projectName: "Unknown", clientName: "", location: "", quoteNumber: "", revisionNumber: 0,
        status: "Open", type: "Firm", subtotal: 0, cost: 0, estimatedProfit: 0, estimatedMargin: 0,
        totalHours: 0, worksheetCount: 0, lineItemCount: 0, phaseCount: 0, modifierCount: 0,
        documentCount: 0, citationCount: 0, aiRunCount: 0,
      };

      const systemPrompt = buildSystemPrompt(snapshot, registry.categories());

      const loop = new AgentLoop(
        { llm: adapter, maxIterations: 10, maxTokens: 4096, temperature: 0, systemPrompt },
        registry
      );

      const context: ToolExecutionContext = {
        projectId: session.projectId,
        revisionId: session.revisionId,
        quoteId: "",
        userId: "",
        sessionId,
        apiBaseUrl: "http://localhost:4001",
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

  // Keep dynamic tools and knowledge placeholders
  app.get("/api/tools/dynamic", async () => ({ tools: [], count: 0 }));
  app.post("/api/tools/dynamic", async (request, reply) => {
    reply.code(201);
    return { id: `tool-${Date.now()}`, ...(request.body as Record<string, unknown>) };
  });
  app.patch("/api/tools/dynamic/:toolId", async (request) => {
    const { toolId } = request.params as { toolId: string };
    return { id: toolId, ...(request.body as Record<string, unknown>) };
  });
  app.delete("/api/tools/dynamic/:toolId", async () => ({ deleted: true }));

  // Knowledge search - wire to actual store
  app.get("/api/knowledge/search", async (request) => {
    const query = request.query as { q?: string; projectId?: string };
    if (!query.q || !query.projectId) return { hits: [], query: query.q ?? "", count: 0 };
    // Search source documents by text matching
    const workspace = await apiStore.getWorkspace(query.projectId);
    if (!workspace) return { hits: [], query: query.q, count: 0 };
    const q = (query.q ?? "").toLowerCase();
    const hits = (workspace.sourceDocuments ?? [])
      .filter(d => d.fileName.toLowerCase().includes(q) || (d.extractedText ?? "").toLowerCase().includes(q))
      .map(d => ({ documentId: d.id, fileName: d.fileName, excerpt: (d.extractedText ?? "").slice(0, 200), score: 1 }));
    return { hits, query: query.q, count: hits.length };
  });

  app.get("/api/knowledge/documents/:projectId", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const docs = await apiStore.listDocuments(projectId);
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
