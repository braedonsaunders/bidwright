import assert from "node:assert/strict";
import test from "node:test";
import { abortableAgentSpawn } from "./abortable-agent-spawn.js";

test("stop during workspace preparation prevents the later spawn", async () => {
  const controller = new AbortController(); let spawns = 0;
  await Promise.resolve(); // asynchronous adapter/workspace preparation
  controller.abort(new Error("User took over"));
  await assert.rejects(abortableAgentSpawn(controller.signal, async () => { spawns++; return {}; }, async () => {}), /User took over/);
  assert.equal(spawns, 0);
});
test("stop during host spawn disposes the child before returning", async () => {
  const controller = new AbortController(); const child = { pid: 123 }; let stopped: unknown;
  let deliver!: (value: typeof child) => void;
  const host = new Promise<typeof child>(resolve => { deliver = resolve; });
  const spawning = abortableAgentSpawn(controller.signal, () => host, async value => { stopped = value; });
  controller.abort(new Error("Stopped")); deliver(child);
  await assert.rejects(spawning, /Stopped/);
  assert.equal(stopped, child);
});
test("an uncancelled spawn returns its child", async () => {
  const child = {};
  assert.equal(await abortableAgentSpawn(undefined, async () => child, async () => assert.fail("unexpected stop")), child);
});
