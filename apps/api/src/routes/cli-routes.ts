/**
 * CLI Management Routes
 *
 * Endpoints for detecting, authenticating, and managing CLI agent runtimes.
 */

import type { FastifyInstance } from "fastify";
import { detectCli, checkCliAuth, spawnSession, stopSession, resumeSession, getSession, listSessions, sendMessage, type AgentRuntime } from "../services/cli-runtime.js";
import { generateClaudeMd, generateCodexMd, symlinkKnowledgeBooks } from "../services/claude-md-generator.js";
import { resolveProjectDir, resolveProjectDocumentsDir, resolveKnowledgeDir, apiDataRoot } from "../paths.js";
import { prisma } from "@bidwright/db";

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

    const { projectId, runtime = "claude-code", scope, prompt } = body;
    // Ensure model is valid for the chosen runtime — don't pass OpenRouter model IDs to Claude CLI
    let model = body.model;
    if (runtime === "claude-code" && (!model || model.includes("/"))) {
      model = "sonnet"; // Default Claude model for CLI
    } else if (runtime === "codex" && (!model || !model.startsWith("gpt"))) {
      model = "gpt-5.4";
    }
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

      // Persist events to DB using prisma directly (survives store context issues)
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
          console.error(`[cli] Failed to persist events for ${sessionId}:`, err);
          eventBuffer.unshift(...toSave); // Put back
        }
      };

      const scheduleFlush = () => {
        if (saveTimer) return;
        saveTimer = setTimeout(async () => {
          saveTimer = null;
          await flushEvents();
        }, 3000); // Flush every 3s
      };

      session.events.on("event", (evt: any) => {
        eventBuffer.push({ ...evt, timestamp: new Date().toISOString() });
        scheduleFlush();
      });

      session.events.on("done", async (finalStatus: string) => {
        if (saveTimer) clearTimeout(saveTimer);
        try {
          await flushEvents(); // Flush remaining events
          await prisma.aiRun.update({
            where: { id: sessionId },
            data: { status: finalStatus },
          });
        } catch (err) {
          console.error(`[cli] Failed to persist final status for ${sessionId}:`, err);
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
    const settings = await store.getSettings();
    const integrations = (settings as any)?.integrations || {};

    const sessionId = `cli-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    await prisma.aiRun.create({
      data: {
        id: sessionId,
        projectId,
        kind: "cli-intake",
        status: "running",
        model: "sonnet",
        input: { runtime: "claude-code", prompt: message } as any,
        output: { events: [] } as any,
      },
    });

    try {
      const session = await spawnSession({
        projectId,
        projectDir,
        prompt: message,
        runtime: "claude-code",
        model: "sonnet",
        authToken: request.headers.authorization?.replace("Bearer ", "") || "",
        apiBaseUrl: `http://localhost:${process.env.API_PORT || 4001}`,
        anthropicApiKey: integrations.anthropicKey || process.env.ANTHROPIC_API_KEY || undefined,
      });

      // Set up event persistence (same as start)
      let eventBuffer: any[] = [];
      let saveTimer: ReturnType<typeof setTimeout> | null = null;
      const flushEvents = async () => {
        if (eventBuffer.length === 0) return;
        const toSave = [...eventBuffer];
        eventBuffer = [];
        try {
          const run = await prisma.aiRun.findFirst({ where: { id: sessionId } });
          const existing = ((run?.output as any)?.events || []);
          await prisma.aiRun.update({ where: { id: sessionId }, data: { output: { events: [...existing, ...toSave] } as any } });
        } catch { eventBuffer.unshift(...toSave); }
      };
      session.events.on("event", (evt: any) => {
        eventBuffer.push({ ...evt, timestamp: new Date().toISOString() });
        if (!saveTimer) saveTimer = setTimeout(async () => { saveTimer = null; await flushEvents(); }, 3000);
      });
      session.events.on("done", async (finalStatus: string) => {
        if (saveTimer) clearTimeout(saveTimer);
        await flushEvents();
        await prisma.aiRun.update({ where: { id: sessionId }, data: { status: finalStatus } }).catch(() => {});
      });

      return { sessionId, status: "running", message: "New session started with your message" };
    } catch (err) {
      await prisma.aiRun.update({ where: { id: sessionId }, data: { status: "failed" } }).catch(() => {});
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Failed to start session" });
    }
  });

  // ── Session Status ──────────────────────────────────────────
  app.get("/api/cli/:projectId/status", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const session = getSession(projectId);

    // Always get events from DB (they're persisted every 3s)
    const run = await prisma.aiRun.findFirst({
      where: { projectId, kind: "cli-intake" },
      orderBy: { createdAt: "desc" },
    });
    if (run) {
      // If there's a live session, use its status (more up-to-date than DB)
      const liveStatus = session?.status;
      return {
        status: liveStatus || run.status,
        runtime: (run.input as any)?.runtime || session?.runtime,
        sessionId: run.id,
        startedAt: run.createdAt?.toISOString?.() || run.createdAt,
        source: liveStatus ? "live" : "db",
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
