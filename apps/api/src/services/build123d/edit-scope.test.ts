import test from "node:test";
import assert from "node:assert/strict";
import type { CadBuild } from "@bidwright/domain";
import { validateCadEditScope } from "./edit-scope.js";
const context = { nodes: [{ id: "cad-hopper", selected: true }, { id: "cad-pipe" }], cadParts: [{ id: "hopper", nodeId: "cad-hopper", fingerprint: "hopper-original" }, { id: "pipe", nodeId: "cad-pipe", fingerprint: "pipe-original" }] };
function build(parts: Array<{ id: string; fingerprint: string }>, removedParts: string[] = []): CadBuild {
  return { parts: parts.map(p => ({ ...p, name: p.id })), program: { imports: {}, removedParts }, sources: {} } as unknown as CadBuild;
}
test("a selected hopper edit preserves the pipe and cannot silently omit or change it", () => {
  const parts = [{ id: "hopper", fingerprint: "changed" }, { id: "pipe", fingerprint: "pipe-original" }];
  validateCadEditScope(build(parts), context);
  assert.throws(() => validateCadEditScope(build(parts.slice(0, 1)), context), /Retain unaffected part pipe/);
  assert.throws(() => validateCadEditScope(build([{ ...parts[0] }, { id: "pipe", fingerprint: "changed" }]), context), /outside the selected/);
  assert.throws(() => validateCadEditScope(build(parts.slice(0, 1), ["pipe"]), context), /outside the selected/);
});
test("manual edits require a new exact source, and manually deleted parts stay deleted", () => {
  const changed = build([{ id: "hopper", fingerprint: "changed" }, { id: "pipe", fingerprint: "pipe-original" }]);
  const manual = { ...context, nodes: [{ id: "cad-hopper", selected: true, manuallyModified: true }, { id: "cad-pipe" }] };
  assert.throws(() => validateCadEditScope(changed, manual), /NEW exact input/);
  changed.program.imports = { new_base: "cad-hopper" }; changed.sources = { new_base: { nodeId: "cad-hopper", brep: "current exact geometry" } };
  validateCadEditScope(changed, manual);
  assert.throws(() => validateCadEditScope(changed, manual, changed.sources), /NEW exact input/);
  assert.throws(() => validateCadEditScope(changed, { ...context, cadParts: [{ ...context.cadParts[0], manuallyDeleted: true }, context.cadParts[1]] }), /manually deleted/);
});
