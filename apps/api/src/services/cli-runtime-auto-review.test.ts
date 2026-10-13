import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@bidwright/db";
import { __setAgentRuntimeHostForTests } from "./agent-host/index.js";
import { automaticReviewSessionKey, cancelAutomaticReview, getAdapter, getSession, getSessionForMode, spawnSession } from "./cli-runtime.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
class FakeChild extends EventEmitter {
  pid = 2147483647;
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = null; stderr = null;
  kill() { this.finish(0); return true; } // a late clean exit must not undo Stop
  finish(code: number) { this.exitCode = code; this.emit("exit", code, null); }
}
async function fixture(t: TestContext) {
  const projectDir = await mkdtemp(join(tmpdir(), "bidwright-auto-review-"));
  const projectId = projectDir.split("/").at(-1)!;
  const mockMethod = (delegate: any, key: string, method: any) => {
    const original = delegate[key]; delegate[key] = method;
    t.after(() => { delegate[key] = original; });
  };
  const rows = new Map<string, any>([[projectId, { id: projectId, input: {}, output: {} }]]);
  mockMethod(prisma.aiRun, "findFirst", async ({ where }: any) => structuredClone(rows.get(where.id)));
  mockMethod(prisma.aiRun, "create", async ({ data }: any) => { rows.set(data.id, structuredClone(data)); return data; });
  mockMethod(prisma.aiRun, "update", async ({ where, data }: any) => Object.assign(rows.get(where.id), data));
  mockMethod(prisma.aiRun, "updateMany", async ({ where, data }: any) => {
    const row = rows.get(where.id);
    if (JSON.stringify(row.input) !== JSON.stringify(where.input.equals)) return { count: 0 };
    Object.assign(row, data); return { count: 1 };
  });
  const adapter = getAdapter("codex");
  const prepare = t.mock.method(adapter, "prepareWorkspace", async () => ({}));
  const plan: any = { cliCmd: "fake-cli", args: [], extraEnv: {}, promptHandling: { kind: "flag", flag: "-p", index: 0 } };
  t.mock.method(adapter, "buildSpawnPlan", async () => plan);
  t.mock.method(adapter, "buildResumePlan", async () => plan);
  const children: FakeChild[] = [];
  __setAgentRuntimeHostForTests({ id: "test", async spawnProcess() { const child = new FakeChild(); children.push(child); return child as unknown as ChildProcess; } });
  t.after(async () => {
    await cancelAutomaticReview(projectId, "Test finished");
    for (const child of children) if (child.exitCode === null) child.finish(0);
    __setAgentRuntimeHostForTests(null);
    await new Promise(resolve => setImmediate(resolve));
  });
  const opts: any = { projectId, projectDir, aiRunId: projectId, revisionId: "rev", runtime: "codex", prompt: "Build", authToken: "test", apiBaseUrl: "http://example.invalid", agentMode: "build_estimate", autoReviewInitialBuild: true };
  const builder = await spawnSession(opts);
  builder.sessionId = "builder-session";
  return { opts, builder, children, prepare, rows };
}

test("completed build stays complete; Q&A runs while automatic review is pending; Stop only cancels continuation", { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const polling = deferred();
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    if (init.method === "POST") return Response.json({ reviewId: "review" });
    polling.resolve();
    return new Promise<Response>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  });
  f.children[0].finish(0);
  await polling.promise;
  assert.equal(f.builder.status, "completed");
  assert.equal(getSessionForMode(f.opts.projectId, "build_estimate")?.status, "running");
  await mkdir(join(f.opts.projectDir, ".bidwright-qa"));
  const qa = await spawnSession({ ...f.opts, projectDir: join(f.opts.projectDir, ".bidwright-qa"), agentMode: "qa", autoReview: false, autoReviewInitialBuild: false });
  assert.equal(getSessionForMode(f.opts.projectId, "qa"), qa);
  const phase = getSession(automaticReviewSessionKey(f.opts.projectId))!;
  assert.equal(await cancelAutomaticReview(f.opts.projectId, "User stopped review"), true);
  assert.equal(phase.status, "stopped");
  assert.equal(f.builder.status, "completed");
  assert.equal(qa.status, "running");
  assert.equal(f.rows.get(f.opts.projectId).input.autoReviewCycle.phase, "cancelled");
});

test("a build-mode takeover during revision preparation prevents spawn", { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const preparing = deferred(), release = deferred();
  f.prepare.mock.mockImplementation(async () => { preparing.resolve(); await release.promise; return {}; });
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => init.method === "POST"
    ? Response.json({ reviewId: "review" }) : Response.json({ review: { id: "review", status: "completed", revisionId: "rev", findings: [] } }));
  f.children[0].finish(0);
  await preparing.promise;
  const cancelled = cancelAutomaticReview(f.opts.projectId, "User build message takes over");
  release.resolve(); await cancelled;
  assert.equal(f.children.length, 1, "no revision child was spawned after cancellation");
  assert.equal(f.builder.status, "completed");
  assert.equal(getSession(automaticReviewSessionKey(f.opts.projectId))?.status, "stopped");
});

test("Stop during revision survives a late successful child exit", { timeout: 5000 }, async t => {
  const f = await fixture(t);
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => init.method === "POST"
    ? Response.json({ reviewId: "review" }) : Response.json({ review: { id: "review", status: "completed", revisionId: "rev", findings: [] } }));
  f.children[0].finish(0);
  while (f.children.length < 2 || getSession(automaticReviewSessionKey(f.opts.projectId))?.process !== f.children[1] as any) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const revision = getSession(automaticReviewSessionKey(f.opts.projectId))!;
  await cancelAutomaticReview(f.opts.projectId, "User takes over");
  f.children[1].emit("exit", 0, null);
  assert.equal(revision.status, "stopped");
  assert.equal(f.builder.status, "completed");
  assert.equal(f.rows.get(f.opts.projectId).input.autoReviewCycle.phase, "cancelled");
});

test("the revision finishes its own run and cannot trigger a second automatic review", { timeout: 5000 }, async t => {
  const f = await fixture(t); let reviews = 0;
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    if (init.method === "POST") { reviews++; return Response.json({ reviewId: "review" }); }
    return Response.json({ review: { id: "review", status: "completed", revisionId: "rev", findings: [] } });
  });
  f.children[0].finish(0);
  while (f.children.length < 2 || getSession(automaticReviewSessionKey(f.opts.projectId))?.process !== f.children[1] as any) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const revision = getSession(automaticReviewSessionKey(f.opts.projectId))!;
  f.children[1].finish(0);
  await revision._automaticTask;
  assert.equal(revision.status, "completed");
  assert.equal(f.builder.status, "completed");
  assert.notEqual(revision._spawnOpts?.aiRunId, f.builder._spawnOpts?.aiRunId);
  assert.equal(f.rows.get(f.opts.projectId).input.autoReviewCycle.phase, "complete");
  assert.equal(reviews, 1);
});
