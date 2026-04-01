/**
 * Quote Review Routes
 *
 * Endpoints for spawning and managing AI-powered quote review sessions.
 * Reviews analyze project documents against the quoted estimate to identify
 * gaps, risks, overestimates, and actionable recommendations.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { detectCli, checkCliAuth, spawnSession, stopSession, getSession, type AgentRuntime } from "../services/cli-runtime.js";
import { generateReviewClaudeMd, symlinkKnowledgeBooks } from "../services/claude-md-generator.js";
import { resolveProjectDir, apiDataRoot } from "../paths.js";
import { prisma } from "@bidwright/db";
import { getSessionCookieToken } from "../services/session-cookie.js";
import { buildWorkspaceResponse } from "../server.js";

/** Extract session token from Authorization header, cookie, or query param */
function extractAuthToken(request: FastifyRequest): string {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const cookieToken = getSessionCookieToken(request);
  if (cookieToken) return cookieToken;
  return (request.query as any)?.token || "";
}

export function registerReviewRoutes(app: FastifyInstance) {

  // ── Start Review Session ──────────────────────────────────
  app.post("/api/review/:projectId/start", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = (request.body || {}) as {
      runtime?: AgentRuntime;
      model?: string;
    };

    const runtime: AgentRuntime = body.runtime || "claude-code";
    let model = body.model;
    if (runtime === "claude-code" && (!model || model.includes("/"))) {
      model = "sonnet";
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

    const projectDir = resolveProjectDir(projectId);

    // Symlink global knowledge books
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

    const settingsEarly = await store.getSettings();
    const integrationsEarly = (settingsEarly as any)?.integrations || {};

    // Generate review-specific CLAUDE.md
    await generateReviewClaudeMd({
      projectDir,
      projectName: project.name || "Untitled Project",
      clientName: project.clientName || "",
      location: project.location || "",
      scope: "",
      quoteNumber: quote.quoteNumber || "",
      dataRoot: apiDataRoot,
      documents,
      knowledgeBookFiles: linkedBookNames,
      maxConcurrentSubAgents: integrationsEarly.maxConcurrentSubAgents ?? 2,
    });

    // Create QuoteReview record
    const reviewId = `review-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    await prisma.quoteReview.create({
      data: {
        id: reviewId,
        projectId,
        revisionId: revision.id || "",
        status: "running",
        summary: {},
        coverage: [],
        findings: [],
        competitiveness: {},
        recommendations: [],
      },
    });

    // Create AiRun record
    const sessionId = `cli-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    await prisma.aiRun.create({
      data: {
        id: sessionId,
        projectId,
        revisionId: revision.id || "",
        kind: "cli-review",
        status: "running",
        model: model || "sonnet",
        input: { runtime, reviewId, documentCount: documents.length } as any,
        output: { events: [] } as any,
      },
    });

    // Update review with aiRunId
    await prisma.quoteReview.update({
      where: { id: reviewId },
      data: { aiRunId: sessionId },
    });

    // Spawn CLI
    const initialPrompt = `Read CLAUDE.md now. Execute the FULL review workflow:

1. Call getWorkspace — understand the complete estimate structure, all worksheets and line items
2. Read EVERY project document (specs, RFQs, BOMs, drawings) using Read tool on documents/ folder
3. Read knowledge books in knowledge/ folder — read table of contents, then relevant rate/productivity chapters
4. Cross-reference: for each spec section/requirement, check if a corresponding line item exists in the estimate
5. Call saveReviewCoverage with the scope coverage checklist
6. Identify gaps (unpriced scope), risks (unclear items, wrong assumptions), severity-rate each finding
7. Call saveReviewFindings with all gaps and risks
8. Analyze competitiveness: compare quoted hours and quantities against knowledge base benchmarks and industry standards
9. Call saveReviewCompetitiveness with overestimate/underestimate analysis and productivity benchmarking
10. Generate actionable recommendations — each must include specific resolution actions (which items to add/update/delete and how)
11. Call saveReviewRecommendation for EACH recommendation individually
12. Call saveReviewSummary with executive summary including quote total, key statistics, and critical findings

CRITICAL: You are reviewing an EXISTING estimate. Do NOT create, update, or delete any line items. Only ANALYZE and REPORT via the saveReview* tools. Be thorough — read every page of every document. Missing scope = missing findings.`;

    const settings = await store.getSettings();
    const integrations = (settings as any)?.integrations || {};

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
        customCliPath: integrations.claudeCodePath || undefined,
        anthropicApiKey: integrations.anthropicKey || process.env.ANTHROPIC_API_KEY || undefined,
        openaiApiKey: integrations.openaiKey || process.env.OPENAI_API_KEY || undefined,
      });

      // Persist events to DB
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
          console.error(`[review] Failed to persist events for ${sessionId}:`, err);
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
        eventBuffer.push({ ...evt, timestamp: new Date().toISOString() });
        scheduleFlush();
      });

      session.events.on("done", async (finalStatus: string) => {
        if (saveTimer) clearTimeout(saveTimer);
        try {
          await flushEvents();
          await prisma.aiRun.update({
            where: { id: sessionId },
            data: { status: finalStatus },
          });
          // Mark review as completed/failed
          await prisma.quoteReview.update({
            where: { id: reviewId },
            data: { status: finalStatus === "completed" ? "completed" : "failed" },
          });
        } catch (err) {
          console.error(`[review] Failed to persist final status for ${sessionId}:`, err);
        }
      });

      return { sessionId, reviewId, projectId, runtime, status: "running" };
    } catch (err) {
      await prisma.aiRun.update({ where: { id: sessionId }, data: { status: "failed" } }).catch(() => {});
      await prisma.quoteReview.update({ where: { id: reviewId }, data: { status: "failed" } }).catch(() => {});
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Failed to start review" });
    }
  });

  // ── Get Latest Review ─────────────────────────────────────
  app.get("/api/review/:projectId/latest", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const review = await prisma.quoteReview.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return { review: review || null };
  });

  // ── SSE Stream (reuses CLI stream for the project) ────────
  app.get("/api/review/:projectId/stream", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const session = getSession(projectId);

    if (!session) {
      return reply.code(404).send({ error: "No active session for this project" });
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });

    reply.raw.write(`: connected\n\n`);

    const onEvent = (evt: any) => {
      try {
        const payload = JSON.stringify(evt.data);
        reply.raw.write(`event: ${evt.type}\ndata: ${payload}\n\n`);
      } catch {}
    };

    session.events.on("event", onEvent);

    const pingTimer = setInterval(() => {
      try { reply.raw.write(`: ping\n\n`); } catch {}
    }, 15_000);

    reply.raw.on("close", () => {
      session.events.off("event", onEvent);
      clearInterval(pingTimer);
    });

    session.events.once("done", () => {
      session.events.off("event", onEvent);
      clearInterval(pingTimer);
      try { reply.raw.end(); } catch {}
    });
  });

  // ── Save Review Section (called by MCP tools) ─────────────
  app.post("/api/review/:projectId/save-section", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { section, data } = (request.body || {}) as {
      section: "coverage" | "findings" | "competitiveness" | "recommendations" | "summary";
      data: any;
    };

    if (!section || !data) {
      return reply.code(400).send({ error: "section and data required" });
    }

    // Find the most recent running review for this project
    const review = await prisma.quoteReview.findFirst({
      where: { projectId, status: "running" },
      orderBy: { createdAt: "desc" },
    });

    if (!review) {
      return reply.code(404).send({ error: "No active review found" });
    }

    // For array-type sections (coverage, findings, recommendations), append to existing
    if (section === "coverage" || section === "findings") {
      const existing = (review[section] as any[]) || [];
      const newItems = Array.isArray(data) ? data : [data];
      await prisma.quoteReview.update({
        where: { id: review.id },
        data: { [section]: [...existing, ...newItems] },
      });
    } else if (section === "recommendations") {
      const existing = (review.recommendations as any[]) || [];
      const rec = { ...data, status: "open" };
      await prisma.quoteReview.update({
        where: { id: review.id },
        data: { recommendations: [...existing, rec] },
      });
    } else {
      // Object-type sections (competitiveness, summary) — merge/replace
      await prisma.quoteReview.update({
        where: { id: review.id },
        data: { [section]: data },
      });
    }

    return { ok: true, section, reviewId: review.id };
  });

  // ── Resolve Recommendation ────────────────────────────────
  app.post("/api/review/:projectId/resolve/:recId", async (request, reply) => {
    const { projectId, recId } = request.params as { projectId: string; recId: string };
    const store = request.store!;

    const review = await prisma.quoteReview.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    if (!review) return reply.code(404).send({ error: "No review found" });

    const recs = (review.recommendations as any[]) || [];
    const rec = recs.find((r: any) => r.id === recId);
    if (!rec) return reply.code(404).send({ error: "Recommendation not found" });

    if (rec.status === "resolved") {
      return reply.code(400).send({ error: "Already resolved" });
    }

    // Execute resolution actions
    const actions = rec.resolution?.actions || [];
    const workspace = await store.getWorkspace(projectId);
    if (!workspace) return reply.code(404).send({ error: "Project not found" });

    const revisionId = workspace.currentRevision?.id;

    for (const action of actions) {
      try {
        switch (action.action) {
          case "createItem": {
            await store.createWorksheetItem(projectId, action.worksheetId, {
              ...action.item,
              lineOrder: action.item?.lineOrder || 999,
            });
            break;
          }
          case "updateItem": {
            await store.updateWorksheetItem(projectId, action.itemId, action.changes);
            break;
          }
          case "deleteItem": {
            await store.deleteWorksheetItem(projectId, action.itemId);
            break;
          }
          case "addCondition": {
            if (revisionId) {
              await store.createCondition(projectId, revisionId, {
                type: action.type || "clarification",
                value: action.value || "",
              });
            }
            break;
          }
          default:
            console.warn(`[review] Unknown resolution action: ${action.action}`);
        }
      } catch (err) {
        console.error(`[review] Failed to execute action ${action.action}:`, err);
      }
    }

    // Mark recommendation as resolved
    const updatedRecs = recs.map((r: any) =>
      r.id === recId ? { ...r, status: "resolved" } : r
    );
    await prisma.quoteReview.update({
      where: { id: review.id },
      data: { recommendations: updatedRecs },
    });

    // Return updated workspace response
    const freshWorkspace = await buildWorkspaceResponse(store, projectId);
    return freshWorkspace;
  });

  // ── Dismiss Recommendation ────────────────────────────────
  app.post("/api/review/:projectId/dismiss/:recId", async (request, reply) => {
    const { projectId, recId } = request.params as { projectId: string; recId: string };

    const review = await prisma.quoteReview.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    if (!review) return reply.code(404).send({ error: "No review found" });

    const recs = (review.recommendations as any[]) || [];
    const updatedRecs = recs.map((r: any) =>
      r.id === recId ? { ...r, status: "dismissed" } : r
    );

    await prisma.quoteReview.update({
      where: { id: review.id },
      data: { recommendations: updatedRecs },
    });

    return { ok: true };
  });

  // ── Stop Review Session ───────────────────────────────────
  app.post("/api/review/:projectId/stop", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const stopped = stopSession(projectId);

    // Mark review as completed
    const review = await prisma.quoteReview.findFirst({
      where: { projectId, status: "running" },
      orderBy: { createdAt: "desc" },
    });
    if (review) {
      await prisma.quoteReview.update({
        where: { id: review.id },
        data: { status: "completed" },
      });
    }

    return { stopped };
  });

  // ── Review Status ─────────────────────────────────────────
  app.get("/api/review/:projectId/status", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const session = getSession(projectId);

    const runs = await prisma.aiRun.findMany({
      where: { projectId, kind: "cli-review" },
      orderBy: { createdAt: "asc" },
    });

    if (runs.length === 0 && !session) {
      return { status: "none" };
    }

    const mergedEvents: any[] = [];
    for (const run of runs) {
      const runEvents = (run.output as any)?.events || [];
      if (runEvents.length < 3 && runs.length > 1) continue;
      mergedEvents.push({
        type: "run_divider",
        data: { runId: run.id, status: run.status, model: run.model, startedAt: run.createdAt?.toISOString?.() || "" },
        timestamp: run.createdAt?.toISOString?.() || "",
      });
      for (const event of runEvents) {
        mergedEvents.push(event);
      }
    }

    const latestRun = runs[runs.length - 1];
    const currentStatus = session?.status === "running" ? "running" : (latestRun?.status || "none");

    return {
      status: currentStatus,
      sessionId: latestRun?.id || session?.sessionId,
      events: mergedEvents,
    };
  });
}
