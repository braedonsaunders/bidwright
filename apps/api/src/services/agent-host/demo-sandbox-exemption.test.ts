import assert from "node:assert/strict";
import test from "node:test";

import { __setAgentRuntimeHostForTests, assertAgentRuntimeHostReady, getAgentRuntimeHost } from "./index.js";

/**
 * The demo container runs BIDWRIGHT_MODE=server on an image that deliberately
 * ships without bubblewrap. Verifying a sandbox it never uses aborted startup
 * (index.ts exits on a fatal), so the Worker only ever saw a dead container.
 *
 * These run on any platform: the non-demo case is asserted through the
 * non-Linux guard, which is the same fail-closed path.
 */

function withEnv<T>(env: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("demo mode boots without verifying a process sandbox it will never use", async () => {
  await withEnv({ BIDWRIGHT_MODE: "server", BIDWRIGHT_DEMO_MODE: "1" }, async () => {
    await assertAgentRuntimeHostReady();
  });
});

test("a real server deployment still fails closed on an unusable sandbox", async () => {
  if (process.platform === "linux") return; // the Linux path needs a real bwrap probe
  await withEnv({ BIDWRIGHT_MODE: "server", BIDWRIGHT_DEMO_MODE: undefined, BIDWRIGHT_PUBLIC_DEMO: undefined }, async () => {
    await assert.rejects(() => assertAgentRuntimeHostReady(), /requires Linux/);
  });
});

test("demo mode refuses to hand out an agent host rather than running one unsandboxed", () => {
  __setAgentRuntimeHostForTests(null);
  try {
    withEnv({ BIDWRIGHT_MODE: "server", BIDWRIGHT_PUBLIC_DEMO: "1" }, () => {
      assert.throws(() => getAgentRuntimeHost(), /disabled in the public demo/);
    });
  } finally {
    __setAgentRuntimeHostForTests(null);
  }
});
