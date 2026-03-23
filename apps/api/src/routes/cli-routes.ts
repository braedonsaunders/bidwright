/**
 * CLI Management Routes
 *
 * Endpoints for detecting, authenticating, and managing CLI agent runtimes.
 */

import type { FastifyInstance } from "fastify";
import { detectCli, checkCliAuth, spawnSession, stopSession, resumeSession, getSession, listSessions, sendMessage, type AgentRuntime } from "../services/cli-runtime.js";
import { generateClaudeMd, generateCodexMd, symlinkKnowledgeBooks } from "../services/claude-md-generator.js";
import { SSEStream } from "../services/sse-stream.js";
import { resolveProjectDir, resolveProjectDocumentsDir, resolveKnowledgeDir, apiDataRoot } from "../paths.js";
import type { PrismaApiStore } from "../prisma-store.js";

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

    return {
      claude: { ...claude, auth: claudeAuth },
      codex: { ...codex, auth: codexAuth },
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
    };

    const { projectId, runtime = "claude-code", model, scope, prompt } = body;
    const store = request.store!;

    // Get project context
    const workspace = await store.getWorkspace(projectId);
    if (!workspace) return reply.code(404).send({ error: "Project not found" });

    const project = workspace.projects?.[0] || {};
    const quote = workspace.quotes?.[0] || {};
    const revision = workspace.revisions?.[0] || {};
    const documents = (workspace.sourceDocuments || []).map((d: any) => ({
      id: d.id,
      fileName: d.fileName,
      fileType: d.fileType,
      documentType: d.documentType,
      pageCount: d.pageCount || 0,
      storagePath: d.storagePath || "",
    }));

    const projectDir = resolveProjectDir(projectId);

    // Generate CLAUDE.md / codex.md
    const params = {
      projectDir,
      projectName: project.name || "Untitled Project",
      clientName: project.clientName || "",
      location: project.projectAddress || "",
      scope: scope || "",
      quoteNumber: quote.quoteNumber || "",
      dataRoot: apiDataRoot,
      documents,
    };

    if (runtime === "claude-code") {
      await generateClaudeMd(params);
    } else {
      await generateCodexMd(params);
    }

    // Symlink global knowledge books
    const knowledgeBooks = workspace.knowledgeBooks || [];
    const globalBooks = knowledgeBooks.filter((b: any) => b.scope === "global" && b.storagePath);
    if (globalBooks.length > 0) {
      await symlinkKnowledgeBooks(
        projectDir,
        resolveKnowledgeDir(),
        globalBooks.map((b: any) => ({ bookId: b.id, fileName: b.sourceFileName || b.name, storagePath: b.storagePath }))
      );
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
      input: { runtime, scope, documentCount: documents.length } as any,
      output: { events: [] } as any,
    });

    // Get settings for auth token
    const settings = await store.getSettings();
    const integrations = (settings as any)?.integrations || {};

    // Spawn CLI
    const initialPrompt = prompt || "Start the intake estimation. Read the main specification document, understand the scope, then build out the complete estimate with worksheets and line items.";

    try {
      const session = await spawnSession({
        projectId,
        projectDir,
        prompt: initialPrompt,
        runtime,
        model,
        authToken: (request.headers.authorization?.replace("Bearer ", "") || (request.query as any)?.token || ""),
        apiBaseUrl: `http://localhost:${process.env.API_PORT || 4001}`,
        revisionId: revision.id,
        quoteId: quote.id,
        customCliPath: runtime === "claude-code"
          ? integrations.claudeCodePath || undefined
          : integrations.codexPath || undefined,
        anthropicApiKey: integrations.anthropicKey || process.env.ANTHROPIC_API_KEY || undefined,
        openaiApiKey: integrations.openaiKey || process.env.OPENAI_API_KEY || undefined,
      });

      // Persist events to DB
      let eventBuffer: any[] = [];
      let saveTimer: ReturnType<typeof setTimeout> | null = null;
      const persistEvents = () => {
        if (saveTimer) return;
        saveTimer = setTimeout(async () => {
          saveTimer = null;
          if (eventBuffer.length === 0) return;
          const toSave = [...eventBuffer];
          eventBuffer = [];
          try {
            const run = await store.getAiRun(sessionId);
            const existing = ((run?.output as any)?.events || []);
            await store.updateAiRun(sessionId, {
              output: { events: [...existing, ...toSave] } as any,
            });
          } catch (err) {
            console.error(`[cli] Failed to persist events for ${sessionId}:`, err);
            // Put events back so we don't lose them
            eventBuffer.unshift(...toSave);
          }
        }, 5000);
      };

      session.events.on("event", (evt: any) => {
        eventBuffer.push({ ...evt, timestamp: new Date().toISOString() });
        persistEvents();
      });

      session.events.on("done", async (finalStatus: string) => {
        if (saveTimer) clearTimeout(saveTimer);
        try {
          const run = await store.getAiRun(sessionId);
          const existing = ((run?.output as any)?.events || []);
          await store.updateAiRun(sessionId, {
            status: finalStatus,
            output: { events: [...existing, ...eventBuffer] } as any,
          });
        } catch (err) {
          console.error(`[cli] Failed to persist final events for ${sessionId}:`, err);
        }
      });

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

    const sse = new SSEStream(reply);

    // Forward events
    const onEvent = (evt: any) => {
      sse.send(evt);
    };

    session.events.on("event", onEvent);

    // Cleanup on disconnect
    reply.raw.on("close", () => {
      session.events.off("event", onEvent);
    });

    // When session ends, close SSE
    session.events.once("done", () => {
      sse.close();
    });
  });

  // ── Stop Session ────────────────────────────────────────────
  app.post("/api/cli/:projectId/stop", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const stopped = stopSession(projectId);
    return { stopped };
  });

  // ── Resume Session ──────────────────────────────────────────
  app.post("/api/cli/:projectId/resume", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = (request.body || {}) as { prompt?: string; model?: string };
    const projectDir = resolveProjectDir(projectId);

    const session = await resumeSession({
      projectId,
      projectDir,
      prompt: body.prompt,
      model: body.model,
    });

    return { sessionId: session.sessionId, status: "running" };
  });

  // ── Send Message to Session ─────────────────────────────────
  app.post("/api/cli/:projectId/message", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { message } = (request.body || {}) as { message: string };

    if (!message) return reply.code(400).send({ error: "Message required" });

    const sent = sendMessage(projectId, message);
    return { sent };
  });

  // ── Session Status ──────────────────────────────────────────
  app.get("/api/cli/:projectId/status", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const session = getSession(projectId);

    if (session) {
      return {
        status: session.status,
        runtime: session.runtime,
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        source: "live",
      };
    }

    // Fall back to DB
    const store = request.store!;
    const run = await store.getLatestAiRun(projectId, "cli-intake");
    if (run) {
      return {
        status: run.status,
        runtime: (run.input as any)?.runtime,
        sessionId: run.id,
        startedAt: run.createdAt,
        source: "db",
        events: (run.output as any)?.events || [],
      };
    }

    return { status: "none" };
  });

  // ── List All Sessions ───────────────────────────────────────
  app.get("/api/cli/sessions", async () => {
    return { sessions: listSessions() };
  });

  // ── Progress Webhook (called by MCP server) ─────────────────
  app.post("/agent/progress", async (request) => {
    const { phase, detail } = (request.body || {}) as { phase: string; detail: string };
    // This is called by the MCP server's reportProgress tool
    // The event will be picked up by the CLI's stdout parser
    // For now, just acknowledge
    return { ok: true };
  });
}
