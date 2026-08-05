import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptTakeoffSyncMessage,
  replayDetachedViewerCommand,
} from "./takeoff-detached-sync";

test("dual-transport takeoff messages are handled exactly once", () => {
  const handled = new Set<string>();

  assert.equal(acceptTakeoffSyncMessage(handled, "selection-1"), true);
  assert.equal(acceptTakeoffSyncMessage(handled, "selection-1"), false);
  assert.equal(acceptTakeoffSyncMessage(handled, undefined), true);
});

test("takeoff message dedupe remains bounded", () => {
  const handled = new Set<string>();
  for (const id of ["one", "two", "three"]) {
    assert.equal(acceptTakeoffSyncMessage(handled, id, 2), true);
  }

  assert.deepEqual([...handled], ["two", "three"]);
  assert.equal(acceptTakeoffSyncMessage(handled, "one", 2), true);
});

test("detached viewer readiness replays the latest model scope", () => {
  const sent: Array<{ action: string; ids: string[] }> = [];
  const command = { action: "focus-elements", ids: ["pipe-1", "pipe-2"] };

  assert.equal(replayDetachedViewerCommand(true, command, (next) => sent.push(next)), true);
  assert.deepEqual(sent, [command]);
  assert.equal(replayDetachedViewerCommand(false, command, (next) => sent.push(next)), false);
  assert.equal(
    replayDetachedViewerCommand<{ action: string; ids: string[] }>(true, null, (next) => sent.push(next)),
    false,
  );
  assert.deepEqual(sent, [command]);
});
