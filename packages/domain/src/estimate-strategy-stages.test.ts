import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceEstimateStrategyStage,
  collectBatchOperationProblems,
  normalizeCalibrationLessons,
  scoreCalibrationLesson,
  stageAfterSavingSections,
} from "./estimate-strategy-stages";

test("stage never moves backwards", () => {
  assert.equal(advanceEstimateStrategyStage("packaging", "scope"), "packaging");
  assert.equal(advanceEstimateStrategyStage("scope", "reconcile"), "reconcile");
  assert.equal(advanceEstimateStrategyStage(null, "execution"), "execution");
  assert.equal(advanceEstimateStrategyStage("bogus", "bogus"), "scope");
});

test("saving several sections at once lands on the furthest stage", () => {
  assert.equal(stageAfterSavingSections(null, ["scopeGraph", "executionPlan", "assumptions", "packagePlan"]), "packaging");
  assert.equal(stageAfterSavingSections("benchmark", ["scopeGraph", "summary"]), "benchmark");
  assert.equal(stageAfterSavingSections("scope", ["reconcileReport", "summary"]), "reconcile");
});

test("batch problems are collected for every failing operation, none applied", async () => {
  const ops = [
    { op: "create" as const, ref: "a" },
    { op: "update" as const, ref: "b" },
    { op: "delete" as const },
  ];
  const problems = await collectBatchOperationProblems(ops, async (operation) => {
    if (operation.op === "create") return "missing evidence";
    if (operation.op === "update") throw new Error("gate exploded");
    return null;
  });
  assert.deepEqual(problems.map((problem) => [problem.index, problem.ref, problem.error]), [
    [0, "a", "missing evidence"],
    [1, "b", "gate exploded"],
  ]);
  assert.deepEqual(await collectBatchOperationProblems(ops, () => null), []);
});

test("lessons normalize from strings and objects and score by tags then terms", () => {
  const lessons = normalizeCalibrationLessons([
    "Count base plates from the plan view",
    { lesson: "The base plate note gives anchors per plate, not a total", tags: ["Structural", "anchors"], context: "32 priced vs 6 drawn" },
    { text: "" },
    42,
  ]);
  assert.equal(lessons.length, 2);
  assert.deepEqual(lessons[1].tags, ["structural", "anchors"]);
  assert.ok(scoreCalibrationLesson(lessons[1], "epoxy anchor count", ["anchors"]) > scoreCalibrationLesson(lessons[0], "epoxy anchor count", ["anchors"]));
});
