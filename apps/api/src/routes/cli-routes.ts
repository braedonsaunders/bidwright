/**
 * CLI Management Routes
 *
 * Endpoints for detecting, authenticating, and managing CLI agent runtimes.
 */

import type { FastifyInstance } from "fastify";
import { detectCli, checkCliAuth, spawnSession, stopSession, resumeSession, getSession, listSessions, type AgentRuntime } from "../services/cli-runtime.js";
import { generateClaudeMd, generateCodexMd, symlinkKnowledgeBooks } from "../services/claude-md-generator.js";
import { resolveProjectDir, resolveProjectDocumentsDir, resolveKnowledgeDir, apiDataRoot } from "../paths.js";
import { join } from "node:path";
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

    const claudeMd = `# Dataset Extraction Agent

You are extracting structured datasets from the knowledge book "${book.name}".
The book PDF is at \`book/${book.sourceFileName || "book.pdf"}\`.

## Your Task

Read the PDF directly to find and extract structured tables into Bidwright datasets.
Use the \`createDataset\` MCP tool to create each dataset with proper columns, rows, and rich tags.

## How to Work

1. **Read the PDF** — use the Read tool with \`pages\` parameter to view specific pages as images
2. **Identify tables** — look for man-hour tables, material tables, weight tables, etc.
3. **Extract data** — read the table values from the PDF page images
4. **Create datasets** — call \`createDataset\` for each table with:
   - Descriptive name (e.g. "Attaching Flanges - Screwed Type - Net Man Hours Each")
   - Rich tags for search (e.g. ["pipe", "flange", "screwed", "man-hours", "carbon-steel", "field-fabrication"])
   - Clean column definitions with types
   - All rows of data
   - Source page numbers and book ID
5. **Group related tables** — merge tables that span multiple pages into one dataset
6. **Skip non-data pages** — title pages, text-only pages, diagrams without tables

## Section Index (from text extraction)
${sectionsInfo}

## Guidelines

- **Rich tags are critical**: Include material type, operation type, pipe sizes, unit type (hours/lbs/feet), section of manual
- **Clean column names**: Use snake_case like "pipe_size_inches", "man_hours_each", "pressure_rating_lb"
- **Numeric columns**: Set type to "number" for all man-hour and measurement values
- **Merge multi-page tables**: Same table spanning pages should be one dataset
- **Preserve notes**: Include footnotes and conditions in the dataset description
- **Source tracking**: Always set sourceBookId="${bookId}" and sourcePages

## Book Info
- Name: ${book.name}
- Book ID: ${bookId}
- Pages: ${book.pageCount}
- Sections found: ${sectionMap.size}
`;

    await writeFile(join(workDir, "CLAUDE.md"), claudeMd);

    // Spawn CLI session — spawnSession handles MCP config + auth token internally
    const token = request.headers.authorization?.replace("Bearer ", "") || (request.query as any)?.token || "";
    const sessionResult = await spawnSession({
      projectId: bookId,
      projectDir: workDir,
      prompt: "Read the book-manifest.json to understand sections, then read actual PDF pages from book/ to identify and extract tables. For each table, call createDataset with proper columns, rows, and tags. Start now.",
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
}
