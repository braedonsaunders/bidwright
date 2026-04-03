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

    // Generate CLAUDE.md / codex.md (includes knowledge book file list)
    const params = {
      projectDir,
      projectName: project.name || "Untitled Project",
      clientName: project.clientName || "",
      location: project.location || "",
      scope: scope || "",
      quoteNumber: quote.quoteNumber || "",
      dataRoot: apiDataRoot,
      documents,
      knowledgeBookFiles: linkedBookNames,
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
      input: { runtime, scope, documentCount: documents.length } as any,
      output: { events: [] } as any,
    });

    // Get settings for auth token
    const settings = await store.getSettings();
    const integrations = (settings as any)?.integrations || {};

    // Spawn CLI
    const initialPrompt = prompt || `Read CLAUDE.md now. Then execute the FULL estimation workflow:

1. Read the main spec document (use Read tool on documents/ folder)
2. Call updateQuote with project name, description, client name
3. Call getItemConfig to learn categories and rate schedules
4. Read knowledge books in knowledge/ folder — read table of contents then relevant chapters
5. listDatasets + queryDataset for production rates
6. importRateSchedule for each needed trade category
7. createWorksheet for each major scope section
8. createWorksheetItem for EVERY line item in EVERY worksheet — this is the BULK of your work
9. createCondition for exclusions and clarifications
10. Call getWorkspace at the end to verify worksheets have items

CRITICAL: You are NOT done until you have called createWorksheetItem multiple times to populate EVERY worksheet with real line items. Reading documents and writing a scope summary is only step 1-2 of 10. The MAJORITY of your work is steps 7-8: creating worksheets and populating them with dozens of line items each. If getWorkspace shows empty worksheets or zero items, you are NOT done. Keep going.`;

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
        authToken: extractAuthToken(request),
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
    }

    // Determine current status: live session takes priority
    const latestRun = runs[runs.length - 1];
    const currentStatus = session?.status === "running" ? "running" : (latestRun?.status || "none");

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
    resolve: (answer: string) => void;
  }>();

  // POST /api/cli/:projectId/question — MCP tool calls this, long-polls until user answers
  app.post("/api/cli/:projectId/question", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { question, options, context } = (request.body || {}) as { question: string; options?: string[]; context?: string };

    if (!question) return reply.code(400).send({ error: "question required" });

    // If there's already a pending question, reject old one
    const existing = pendingQuestions.get(projectId);
    if (existing) {
      existing.resolve("Previous question superseded by a new one.");
      pendingQuestions.delete(projectId);
    }

    // Emit the question as an SSE event so the frontend sees it
    const session = getSession(projectId);
    if (session) {
      session.events.emit("event", {
        type: "askUser",
        question,
        options: options || [],
        context: context || "",
      });
    }

    // Block until the user answers via /answer endpoint (max 5 min)
    const answer = await new Promise<string>((resolve) => {
      pendingQuestions.set(projectId, { question, options, context, resolve });

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
    const session = getSession(projectId);
    if (session) {
      session.events.emit("event", {
        type: "userAnswer",
        answer,
      });
    }

    return { ok: true, message: "Answer delivered to agent" };
  });
}
