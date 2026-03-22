import type { FastifyInstance } from "fastify";

export async function agentRoutes(app: FastifyInstance) {
  // Agent sessions
  app.post("/api/agent/sessions", async (request, reply) => {
    // Create a new agent session for a project
    // Body: { projectId, revisionId, provider?, model? }
    // Returns: { sessionId, status, createdAt }
    const body = request.body as { projectId: string; revisionId?: string; provider?: string; model?: string };
    const sessionId = `session-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    reply.code(201);
    return {
      sessionId,
      projectId: body.projectId,
      revisionId: body.revisionId ?? null,
      provider: body.provider ?? "anthropic",
      model: body.model ?? "claude-sonnet-4-20250514",
      status: "active",
      messages: [],
      toolCalls: [],
      createdAt: new Date().toISOString(),
    };
  });

  app.post("/api/agent/sessions/:sessionId/messages", async (request, reply) => {
    // Send a message to the agent
    // Body: { content: string }
    // Returns: agent response (for now non-streaming)
    const { sessionId } = request.params as { sessionId: string };
    const { content } = request.body as { content: string };
    return {
      sessionId,
      message: `[Agent placeholder] Received: "${content}". The agent loop will process this with tools when wired.`,
      toolCallsExecuted: [],
      citations: [],
      tokensUsed: { input: 0, output: 0 },
    };
  });

  app.get("/api/agent/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    return {
      sessionId,
      status: "active",
      messages: [],
      toolCalls: [],
    };
  });

  app.delete("/api/agent/sessions/:sessionId", async (request, reply) => {
    return { deleted: true };
  });

  // Tool listing
  app.get("/api/tools", async (request) => {
    const query = request.query as { category?: string; search?: string };
    // Return tool definitions (placeholder - will be wired to ToolRegistry)
    return {
      tools: [],
      count: 0,
      categories: ["quote", "knowledge", "vision", "analysis", "dynamic", "system"],
    };
  });

  app.get("/api/tools/dynamic", async () => {
    return { tools: [], count: 0 };
  });

  app.post("/api/tools/dynamic", async (request, reply) => {
    reply.code(201);
    return { id: `tool-${Date.now()}`, ...(request.body as Record<string, unknown>), createdAt: new Date().toISOString() };
  });

  app.patch("/api/tools/dynamic/:toolId", async (request) => {
    const { toolId } = request.params as { toolId: string };
    return { id: toolId, ...(request.body as Record<string, unknown>), updatedAt: new Date().toISOString() };
  });

  app.delete("/api/tools/dynamic/:toolId", async () => {
    return { deleted: true };
  });

  // Knowledge endpoints
  app.get("/api/knowledge/search", async (request) => {
    const query = request.query as { q?: string; projectId?: string; scope?: string; limit?: string };
    return { hits: [], query: query.q ?? "", count: 0 };
  });

  app.get("/api/knowledge/documents/:projectId", async (request) => {
    const { projectId } = request.params as { projectId: string };
    return { documents: [], projectId };
  });

  app.post("/api/knowledge/ingest", async (request, reply) => {
    reply.code(201);
    return { status: "queued", message: "Document queued for ingestion" };
  });

  app.post("/api/knowledge/library", async (request, reply) => {
    reply.code(201);
    return { status: "queued", message: "Library document queued for ingestion" };
  });

  // LLM provider config
  app.get("/api/agent/providers", async () => {
    return {
      providers: [
        { id: "anthropic", name: "Anthropic Claude", models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514"] },
        { id: "openai", name: "OpenAI", models: ["gpt-4o", "gpt-4o-mini", "o3-mini"] },
        { id: "openrouter", name: "OpenRouter", models: ["anthropic/claude-sonnet-4-20250514", "openai/gpt-4o"] },
        { id: "gemini", name: "Google Gemini", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
        { id: "lmstudio", name: "LM Studio (Local)", models: ["default"] },
      ],
    };
  });
}
