import assert from "node:assert/strict";
import test from "node:test";

import { createLiveActionBridge } from "./live-action-bridge";

interface ViewerActions {
  selectRun: (runId: string) => string;
  isolateRun: (runId: string) => Promise<string>;
}

test("a captured bridge method follows the current viewer after detach and remount", async () => {
  const calls: string[] = [];
  let current: ViewerActions | null = {
    selectRun: (runId) => {
      calls.push(`docked:${runId}`);
      return "docked";
    },
    isolateRun: async (runId) => `docked:${runId}`,
  };

  const bridge = createLiveActionBridge<ViewerActions>(() => current);
  const selectRunFromOriginalRender = bridge.selectRun;
  const isolateRunFromOriginalRender = bridge.isolateRun;

  assert.equal(selectRunFromOriginalRender("run-a"), "docked");

  current = {
    selectRun: (runId) => {
      calls.push(`detached:${runId}`);
      return "detached";
    },
    isolateRun: async (runId) => `detached:${runId}`,
  };

  assert.equal(selectRunFromOriginalRender("run-b"), "detached");
  assert.equal(await isolateRunFromOriginalRender("run-b"), "detached:run-b");
  assert.deepEqual(calls, ["docked:run-a", "detached:run-b"]);
});

test("the bridge safely no-ops during the gap between viewer instances", () => {
  let current: ViewerActions | null = {
    selectRun: () => "docked",
    isolateRun: async () => "docked",
  };
  const bridge = createLiveActionBridge<ViewerActions>(() => current);

  current = null;

  assert.equal(bridge.selectRun("run-a"), undefined);
});
