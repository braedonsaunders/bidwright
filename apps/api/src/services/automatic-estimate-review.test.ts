import assert from "node:assert/strict";
import test from "node:test";
import { automaticEstimateReview, finishAutomaticReview } from "./automatic-estimate-review.js";

const opts: any = { autoReviewInitialBuild: true, agentMode: "build_estimate", projectId: "p", aiRunId: "run", revisionId: "rev", runtime: "codex", authToken: "test", apiBaseUrl: "http://example.invalid" };
function database() {
  const run: any = { id: "run", input: { mode: "build_estimate" } };
  return { run, aiRun: { findFirst: async () => structuredClone(run), updateMany: async ({ where, data }: any) => {
    if (JSON.stringify(where.input.equals) !== JSON.stringify(run.input)) return { count: 0 };
    Object.assign(run, data); return { count: 1 };
  }, update: async ({ data }: any) => Object.assign(run, data) } };
}
test("one review and one revision claim survive duplicate completion callbacks", async t => {
  const db = database(), events: any[] = []; let launches = 0;
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    if (init.method === "POST") { launches++; return Response.json({ reviewId: "review" }); }
    return Response.json({ review: { id: "review", status: "completed", revisionId: "rev", findings: [{ id: "F1", rowIds: ["row"], suggestedFix: "Check boundary" }] } });
  });
  const results = await Promise.all([automaticEstimateReview(opts, e => events.push(e), db), automaticEstimateReview(opts, e => events.push(e), db)]);
  assert.equal(launches, 1); assert.equal(results.filter(Boolean).length, 1);
  assert.match(results.find(Boolean)!, /record why you disagree/);
  assert.equal(db.run.input.autoReviewCycle.phase, "revising");
  assert.equal(await automaticEstimateReview(opts, () => {}, db), null);
  assert.equal(db.run.input.autoReviewCycle.phase, "revising");
  await finishAutomaticReview(opts, "complete", undefined, db);
  assert.equal(db.run.input.autoReviewCycle.phase, "complete");
  assert.deepEqual(events.map(e => e.data.phase), ["reviewing", "revising"]);
});
test("failure stands as a fact and is never retried; disabled autoReview never launches", async t => {
  const db = database(), events: any[] = []; let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("unavailable", { status: 503 }); });
  assert.equal(await automaticEstimateReview(opts, e => events.push(e), db), null);
  assert.equal(db.run.input.autoReviewCycle.phase, "failed");
  assert.match(events.at(-1).data.detail, /Completion is unaffected/);
  await automaticEstimateReview(opts, () => {}, db);
  await automaticEstimateReview({ ...opts, autoReview: false }, () => {}, database());
  assert.equal(calls, 1);
});
test("persisted reviewing state after restart cannot launch another paid review", async t => {
  const db = database(); db.run.input.autoReviewCycle = { phase: "reviewing" };
  t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected launch"); });
  assert.equal(await automaticEstimateReview(opts, () => {}, db), null);
});
test("a different current revision prevents automatic edits and records the fact", async t => {
  const db = database();
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => init.method === "POST"
    ? Response.json({ reviewId: "review" })
    : Response.json({ review: { status: "completed", revisionId: "rev", currentRevisionId: "new-revision", findings: [] } }));
  assert.equal(await automaticEstimateReview(opts, () => {}, db), null);
  assert.equal(db.run.input.autoReviewCycle.phase, "failed");
  assert.match(db.run.input.autoReviewCycle.fact, /revision changed/);
});

test("a failed revision remains terminal rather than launching another review", async () => {
  const db = database(); db.run.input.autoReviewCycle = { phase: "revising", reviewId: "review" };
  await finishAutomaticReview(opts, "failed", "Provider disconnected", db);
  assert.equal(db.run.input.autoReviewCycle.phase, "failed");
  assert.equal(await automaticEstimateReview(opts, () => {}, db), null);
  assert.equal(db.run.input.autoReviewCycle.fact, "Provider disconnected");
});


test("only the initial build launches: follow-up, resumed and previous-run inputs are skipped", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unexpected launch"); });
  for (const input of [{ followUp: true }, { resumed: true }, { previousAiRunId: "initial" }]) {
    const db = database(); Object.assign(db.run.input, input);
    assert.equal(await automaticEstimateReview(opts, () => {}, db), null);
    assert.equal(db.run.input.autoReviewCycle, undefined);
  }
  await automaticEstimateReview({ ...opts, autoReviewInitialBuild: false }, () => {}, database());
  assert.equal(calls, 0);
});
test("a failed poll stops the owned review and records failure", async t => {
  const db = database(); let stopped = 0;
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => init.method === "POST"
    ? Response.json({ reviewId: "review" }) : new Response("unavailable", { status: 503 }));
  assert.equal(await automaticEstimateReview(opts, () => {}, db, undefined, () => { stopped++; }), null);
  assert.equal(stopped, 1);
  assert.equal(db.run.input.autoReviewCycle.phase, "failed");
});
