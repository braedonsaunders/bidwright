import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { prisma } from "@bidwright/db";
import { createRequire } from "node:module";

test("review routes isolate advisory results/saves, reconcile dead sessions, and cap attempts without spawning", async t => {
  // Route tests cannot spawn terminals; avoid loading the optional native PTY binary.
  const require = createRequire(import.meta.url);
  const ptyPath = require.resolve("node-pty");
  const previous = require.cache[ptyPath];
  require.cache[ptyPath] = { id: ptyPath, filename: ptyPath, loaded: true, exports: { spawn: () => { throw new Error("Unexpected terminal spawn"); } } } as any;
  t.after(() => { if (previous) require.cache[ptyPath] = previous; else delete require.cache[ptyPath]; });
  const { registerReviewRoutes } = await import("./review-routes.js");
  const now = new Date();
  const full: any = { id: "full", projectId: "p", revisionId: "rev", aiRunId: "full-run", status: "completed", summary: {}, createdAt: now };
  const advisory: any = { ...full, id: "advisory", aiRunId: "advisory-run", status: "running", summary: { __reviewMeta: { advisory: true } } };
  const queries: any[] = [];
  const updates: any[] = [];
  const mockMethod = (delegate: any, key: string, method: any) => {
    const original = delegate[key];
    delegate[key] = method;
    t.after(() => { delegate[key] = original; });
  };
  mockMethod(prisma.quote, "findFirst", async () => null);
  mockMethod(prisma.aiRun, "findFirst", async () => ({ id: "estimator" }) as any);
  mockMethod(prisma.aiRun, "findMany", async () => [{ id: "advisory-run" }, { id: "prior-advisory-run" }] as any);
  mockMethod(prisma.aiRun, "findUnique", async () => ({ id: "advisory-run", kind: "cli-advisory-review", status: "running" }) as any);
  mockMethod(prisma.quoteReview, "findFirst", async ({ where }: any) => {
    queries.push(where);
    return where.id === "advisory" || where.aiRunId ? advisory : full;
  });
  mockMethod(prisma.quoteReview, "update", async ({ where, data }: any) => {
    updates.push({ where, data });
    const row = where.id === "advisory" ? advisory : full;
    Object.assign(row, data); return row;
  });
  let fullPreparation = 0;
  const app = Fastify();
  app.decorateRequest("store", null);
  app.addHook("onRequest", async request => {
    request.store = {
      getProject: async () => ({ id: "p" }),
      getEffectiveIntegrations: async () => ({ agentRuntime: "codex" }),
      getWorkspace: async () => ({ project: { id: "p" }, currentRevision: { id: "rev" } }),
      // A deliberate boundary before any files or processes are created.
      listKnowledgeBooks: async () => { fullPreparation++; throw new Error("test preparation boundary"); },
    } as any;
  });
  registerReviewRoutes(app);
  try {
    const latest = await app.inject({ method: "GET", url: "/api/review/p/latest" });
    assert.equal(latest.json().review.id, "full");
    assert.deepEqual(queries.at(-1).OR, [{ aiRunId: null }, { aiRunId: { notIn: ["advisory-run", "prior-advisory-run"] } }]);
    const polled = await app.inject({ method: "GET", url: "/api/review/p/latest?reviewId=advisory" });
    assert.equal(polled.json().review.id, "advisory");
    assert.equal(polled.json().review.status, "failed", "a stale DB running status without a live session is terminal");
    advisory.status = "running";
    const saved = await app.inject({ method: "POST", url: "/api/review/p/save-section", headers: { "x-bidwright-run-id": "advisory-run" }, payload: { section: "summary", data: { overallAssessment: "Advisory only" } } });
    assert.equal(saved.json().reviewId, "advisory");
    assert.equal(queries.at(-1).aiRunId, "advisory-run");
    assert.equal(updates.at(-1).data.summary.__reviewMeta.advisory, true);
    const limited = await app.inject({ method: "POST", url: "/api/review/p/start", headers: { "x-bidwright-run-id": "estimator" }, payload: { advisory: true } });
    assert.equal(limited.statusCode, 200, limited.body);
    assert.equal(limited.json().status, "limit_reached");
    assert.equal(fullPreparation, 0);
    const startFull = await app.inject({ method: "POST", url: "/api/review/p/start", payload: {} });
    assert.equal(startFull.statusCode, 500);
    assert.match(startFull.body, /test preparation boundary/);
    assert.equal(fullPreparation, 1, "a full review passes advisory reuse and cap checks");
  } finally { await app.close(); }
});
