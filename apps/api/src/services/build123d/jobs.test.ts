import test from "node:test";
import assert from "node:assert/strict";
import { startCadJob, getCadJob, cancelCadJob } from "./jobs.js";

test("CAD results and cancellation are isolated to the requesting user, organization and project", async () => {
  const scope = { userId: "alice", organizationId: "shop-a", projectId: "job-1" };
  const run = startCadJob(scope, null, { prompt: "Hopper" }, async () => ({ message: "What thickness?", build: null }));
  await new Promise(accept => setImmediate(accept));
  assert.equal(getCadJob(scope, run.id)?.status, "completed");
  for (const other of [{ ...scope, userId: "bob" }, { ...scope, organizationId: "shop-b" }, { ...scope, projectId: "job-2" }]) {
    assert.equal(getCadJob(other, run.id), null);
    assert.equal(cancelCadJob(other, run.id), false);
  }
  assert.equal(cancelCadJob(scope, run.id), true);
  assert.equal(getCadJob(scope, run.id), null);
});
test("stopping a design aborts its generator and prevents a late result from changing the job", async () => {
  const scope = { userId: "stop-test", organizationId: "shop-a", projectId: "job-1" };
  let signal: AbortSignal | undefined;
  let complete: (value: { message: string; build: null }) => void = () => {};
  const run = startCadJob(scope, null, { prompt: "Hopper" }, async (_config, _input, options) => {
    signal = options?.signal;
    return new Promise(accept => { complete = accept; });
  });
  assert.throws(() => startCadJob(scope, null, { prompt: "Another" }), /already running/);
  assert.equal(cancelCadJob(scope, run.id), true);
  assert.equal(signal?.aborted, true);
  complete({ message: "Late", build: null });
  await new Promise(accept => setImmediate(accept));
  assert.equal(getCadJob(scope, run.id), null);
});
