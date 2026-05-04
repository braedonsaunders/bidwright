import test from "node:test";
import assert from "node:assert/strict";

import {
  commitEstimateRunStage,
  createDefaultEstimateRunPlan,
  getBlockingGateIds,
  markEstimateRunStage,
  proposeEstimateRunStage,
  refreshEstimateRunPlan,
  summarizeEstimateRunPlan,
} from "./estimate-run-plan";

test("createDefaultEstimateRunPlan starts with intake ready and later stages blocked", () => {
  const plan = createDefaultEstimateRunPlan("run-1", "rev-1");
  assert.equal(plan.activeStageId, "intake");
  assert.equal(plan.stages[0].status, "ready");
  assert.equal(plan.stages[1].status, "blocked");
  assert.equal(plan.stages.at(-1)?.id, "finalize");
});

test("commitEstimateRunStage unblocks the next ordered stage", () => {
  let plan = createDefaultEstimateRunPlan("run-1");
  plan = commitEstimateRunStage(plan, "intake");

  const intake = plan.stages.find((stage) => stage.id === "intake");
  const quoteMetadata = plan.stages.find((stage) => stage.id === "quote_metadata");
  assert.deepEqual(intake?.progress, { completed: 3, total: 3 });
  assert.equal(quoteMetadata?.status, "ready");
  assert.equal(plan.activeStageId, "quote_metadata");
});

test("getBlockingGateIds reports unmet predecessor stages", () => {
  const plan = createDefaultEstimateRunPlan("run-1");
  const stage = plan.stages.find((candidate) => candidate.id === "quote_metadata");
  assert.ok(stage);
  assert.deepEqual(getBlockingGateIds(stage, plan), ["intake_complete"]);
});

test("proposeEstimateRunStage moves a stage into pending approval", () => {
  const plan = proposeEstimateRunStage(createDefaultEstimateRunPlan("run-1"), "intake");
  const intake = plan.stages.find((stage) => stage.id === "intake");
  assert.equal(intake?.proposalState, "proposed");
  assert.equal(intake?.approvalState, "pending");
});

test("summarizeEstimateRunPlan reports progress and blocking gates", () => {
  let plan = createDefaultEstimateRunPlan("run-1");
  plan = commitEstimateRunStage(plan, "intake");
  plan = commitEstimateRunStage(plan, "quote_metadata");
  plan = markEstimateRunStage(plan, "knowledge_gate", { status: "in_progress", progress: { completed: 2, total: 5 } });
  const summary = summarizeEstimateRunPlan(plan);

  assert.equal(summary.completedStages, 2);
  assert.equal(summary.totalStages, 13);
  assert.equal(summary.activeStageId, "knowledge_gate");
  assert.equal(summary.progressPct, 0.1846);
  assert.ok(summary.blockingGateIds.includes("knowledge_ready"));
});

test("refreshEstimateRunPlan preserves in-progress stages as active", () => {
  let plan = createDefaultEstimateRunPlan("run-1");
  plan = commitEstimateRunStage(plan, "intake");
  plan = markEstimateRunStage(plan, "quote_metadata", { status: "in_progress" });
  plan = refreshEstimateRunPlan(plan);

  assert.equal(plan.activeStageId, "quote_metadata");
});

test("markEstimateRunStage rejects unknown stage ids", () => {
  const plan = createDefaultEstimateRunPlan("run-1");
  assert.throws(
    () => markEstimateRunStage(plan, "not_a_stage", { status: "complete" }),
    /Estimate run stage "not_a_stage" not found/,
  );
});
