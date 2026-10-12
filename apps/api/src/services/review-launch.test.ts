import assert from "node:assert/strict";
import test from "node:test";
import { advisoryReviewLimit, reviewRunIsLive, coalesceReviewLaunch, reviewSessionKey, selectReviewSession } from "./review-launch.js";
import { buildReviewClaudeMdContent } from "./claude-md-generator.js";

test("simultaneous review requests share preparation and leave the estimator slot distinct", async () => {
  let launches = 0;
  const launch = async () => { launches++; await new Promise(resolve => setImmediate(resolve)); return { reviewId: "review" }; };
  const [first, retry] = await Promise.all([coalesceReviewLaunch("org:project", launch), coalesceReviewLaunch("org:project", launch)]);
  assert.equal(launches, 1); assert.equal(first, retry);
  assert.notEqual(reviewSessionKey("project"), "project");
  await coalesceReviewLaunch("org:project", launch); assert.equal(launches, 2);
});

test("advisory review brief carries rubric and basis without full-review or benchmark workflow", () => {
  const brief = buildReviewClaudeMdContent({ advisoryReview: true, laborBasis: { assumedHours: 15 }, documents: [], projectName: "Example", scope: "Scope", projectDir: "/tmp/example", dataRoot: "/tmp", quoteNumber: "Q", clientName: "Client", location: "Location" });
  assert.match(brief, /quantity accuracy spot-checks.*scope coverage.*traceability.*labour basis.*pricing integrity.*commercial clarity/);
  assert.match(brief, /"assumedHours":15/);
  assert.match(brief, /does not approve or finalize/);
  assert.doesNotMatch(brief, /FULL review workflow/);
});

test("review stream/stop controls never select a parent estimating session", () => {
  const parent = { status: "running", _spawnOpts: { reviewOnly: false } };
  const advisory = { status: "completed", _spawnOpts: { reviewOnly: true } };
  assert.equal(selectReviewSession(undefined, parent), undefined);
  assert.equal(selectReviewSession(advisory, parent), advisory);
  assert.equal(selectReviewSession(undefined, { ...advisory, status: "running" })?.status, "running");
});


test("advisory reuse requires the matching live session, and two attempts exhaust its budget", () => {
  const run = { id: "review-run", status: "running" };
  assert.equal(reviewRunIsLive(run, undefined), false);
  assert.equal(reviewRunIsLive(run, { status: "running", _spawnOpts: { aiRunId: "estimator" } }), false);
  assert.equal(reviewRunIsLive(run, { status: "completed", _spawnOpts: { aiRunId: run.id } }), false);
  assert.equal(reviewRunIsLive(run, { status: "running", _spawnOpts: { aiRunId: run.id } }), true);
  assert.equal(advisoryReviewLimit(1), null);
  assert.equal(advisoryReviewLimit(2)?.status, "limit_reached");
});

test("a full review cannot coalesce with an advisory launch", async () => {
  const [full, advisory] = await Promise.all([
    coalesceReviewLaunch("org:project:full", async () => "full"),
    coalesceReviewLaunch("org:project:advisory", async () => "advisory"),
  ]);
  assert.equal(full, "full"); assert.equal(advisory, "advisory");
});
