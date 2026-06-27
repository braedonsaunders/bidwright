import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveTakeoffShortcut,
  takeoffShortcutLabel,
  type TakeoffShortcutAction,
} from "./takeoff-shortcuts";

test("resolveTakeoffShortcut maps common undo and redo chords", () => {
  assert.deepEqual(resolveTakeoffShortcut({ key: "z", metaKey: true }, "bidwright"), { kind: "undo" });
  assert.deepEqual(resolveTakeoffShortcut({ key: "z", ctrlKey: true, shiftKey: true }, "bidwright"), { kind: "redo" });
  assert.deepEqual(resolveTakeoffShortcut({ key: "y", ctrlKey: true }, "planswift"), { kind: "redo" });
});

test("resolveTakeoffShortcut maps preset-specific tool chords", () => {
  assert.deepEqual(resolveTakeoffShortcut({ key: "v" }, "bidwright"), { kind: "tool", toolId: "select" });
  assert.deepEqual(resolveTakeoffShortcut({ key: "s" }, "bidwright"), { kind: "tool", toolId: "calibrate" });
  assert.deepEqual(resolveTakeoffShortcut({ key: "s" }, "planswift"), { kind: "tool", toolId: "select" });
  assert.deepEqual(resolveTakeoffShortcut({ key: "x" }, "planswift"), { kind: "tool", toolId: "calibrate" });
});

test("takeoffShortcutLabel returns labels for toolbar hints", () => {
  const action: TakeoffShortcutAction = { kind: "tool", toolId: "linear-polyline" };
  assert.equal(takeoffShortcutLabel(action, "bidwright"), "P");
  assert.equal(takeoffShortcutLabel(action, "planswift"), "D");
  assert.equal(takeoffShortcutLabel({ kind: "undo" }, "bidwright"), "Ctrl/Cmd+Z");
});

test("resolveTakeoffShortcut ignores modifier mismatches", () => {
  assert.equal(resolveTakeoffShortcut({ key: "l", ctrlKey: true }, "bidwright"), null);
  assert.equal(resolveTakeoffShortcut({ key: "z" }, "bidwright"), null);
});
