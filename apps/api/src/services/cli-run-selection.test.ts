import assert from "node:assert/strict";
import test from "node:test";

import { isOpenRun, isStillbornRun, selectLatestRun } from "./cli-run-selection.js";

const statusEvent = (status: string) => ({ type: "status", data: { status } });

/** A run that started and is still going. */
const openRun = (id: string) => ({
  id,
  status: "running",
  output: { events: [statusEvent("running"), { type: "tool_call", data: {} }] },
});

/** A run that started and finished. */
const finishedRun = (id: string, status = "completed") => ({
  id,
  status,
  output: { events: [statusEvent("running"), statusEvent(status)] },
});

/**
 * A resume that collided with a live agent: it failed without the CLI ever
 * reporting "running", because the process never got that far.
 */
const stillbornRun = (id: string) => ({
  id,
  status: "failed",
  output: {
    events: [
      { type: "error", data: { message: "thread-store conflict: thread 01a0 already has an active writer" } },
      { type: "message", data: { role: "assistant", content: "Intake failed (exit code 1)." } },
      statusEvent("failed"),
    ],
  },
});

test("classifies a collided resume as stillborn and a working run as open", () => {
  assert.equal(isStillbornRun(stillbornRun("r2")), true);
  assert.equal(isStillbornRun(finishedRun("r1", "failed")), false, "a run that started then failed is a real failure");
  assert.equal(isOpenRun(openRun("r1")), true);
  assert.equal(isOpenRun(finishedRun("r1")), false);
});

test("a failed resume does not mask the run that is still working", () => {
  // The incident: answering a question resumed on top of a live agent, the
  // runtime refused the second writer, and that sub-second failure became the
  // newest run -- so the whole project reported "failed" while the estimate was
  // still being built.
  const live = openRun("run-live");
  const latest = selectLatestRun([finishedRun("run-0"), live, stillbornRun("run-collision")]);
  assert.equal(latest, live, "status must follow the run that is actually running");
});

test("repeated failed resumes still do not mask it", () => {
  // Every Resume click appended another stillborn run, so a single-step lookback
  // would have gone straight back to reporting a failure.
  const live = openRun("run-live");
  const latest = selectLatestRun([
    live,
    stillbornRun("c1"),
    stillbornRun("c2"),
    stillbornRun("c3"),
    stillbornRun("c4"),
  ]);
  assert.equal(latest, live);
});

test("a genuine start-up failure is still reported", () => {
  // Nothing else is running, so this failure is the truth about the project and
  // must not be hidden behind the previous run's success.
  const collision = stillbornRun("run-failed-start");
  const latest = selectLatestRun([finishedRun("run-0"), collision]);
  assert.equal(latest, collision);
});

test("a failure after the live run ends is reported once it is the truth", () => {
  const latest = selectLatestRun([finishedRun("run-0"), stillbornRun("c1")]);
  assert.equal((latest as { id: string }).id, "c1");
});

test("the newest run wins in the ordinary case", () => {
  const newest = openRun("run-2");
  assert.equal(selectLatestRun([finishedRun("run-1"), newest]), newest);
  assert.equal(selectLatestRun([]), undefined);
});
