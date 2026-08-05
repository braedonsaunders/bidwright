import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptTakeoffSyncMessage,
  deliverDetachedTakeoffCommand,
  DETACHED_TAKEOFF_COMMAND_RECEIVER,
  replayDetachedViewerCommand,
  resolveDetachedModelCommandTarget,
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

test("same-origin detached delivery invokes the popup receiver synchronously", () => {
  const received: Array<{ run: string }> = [];
  const popup = {
    [DETACHED_TAKEOFF_COMMAND_RECEIVER]: (command: { run: string }) => received.push(command),
  };

  assert.equal(deliverDetachedTakeoffCommand(popup, { run: "run-b" }), true);
  assert.deepEqual(received, [{ run: "run-b" }]);
  assert.equal(deliverDetachedTakeoffCommand({}, { run: "run-c" }), false);
  assert.equal(deliverDetachedTakeoffCommand({
    [DETACHED_TAKEOFF_COMMAND_RECEIVER]: () => false,
  }, { run: "run-d" }), false);
});

test("same-origin detached delivery falls back when WindowProxy access fails", () => {
  const popup = new Proxy({}, {
    get() {
      throw new DOMException("Blocked while navigating", "SecurityError");
    },
  });

  assert.equal(deliverDetachedTakeoffCommand(popup, { run: "run-a" }), false);
});

test("source-document Navisworks viewers match through the active model asset", () => {
  assert.deepEqual(resolveDetachedModelCommandTarget(
    "asset-navisworks",
    "doc-source",
    "asset-navisworks",
    [{ id: "doc-source" }],
  ), { kind: "active" });
});

test("detached commands switch only when another synthetic model document owns the asset", () => {
  assert.deepEqual(resolveDetachedModelCommandTarget(
    "asset-b",
    "doc-a",
    "asset-a",
    [{ id: "model-asset-b", modelAssetId: "asset-b" }],
  ), { kind: "switch", documentId: "model-asset-b" });
  assert.equal(resolveDetachedModelCommandTarget("missing", "doc-a", "asset-a", []), null);
});
