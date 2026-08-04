import test from "node:test";
import assert from "node:assert/strict";
import { groupModelElements, type GroupableModelElement } from "./model-element-groups";

const elements: GroupableModelElement[] = [
  { id: "1", elementClass: "Pipe", material: "Carbon steel", level: "L1", classification: { uniformat: "D20" } },
  { id: "2", elementClass: "Pipe", material: "Carbon steel", level: "L2", classification: { uniformat: "D20" } },
  { id: "3", elementClass: "Pipe", material: "Copper", level: "L1", classification: { uniformat: "D20" } },
  { id: "4", elementClass: "Valve", material: "", level: "L1", classification: {} },
];

test("groupModelElements supports composite estimating axes", () => {
  const groups = groupModelElements(elements, ["elementClass", "material"]);
  assert.deepEqual(groups.map((group) => [group.label, group.elements.length]), [
    ["Pipe · Carbon steel", 2],
    ["Pipe · Copper", 1],
    ["Valve · No material", 1],
  ]);
});

test("groupModelElements keeps unclassified groups last", () => {
  const groups = groupModelElements(elements, ["uniformat"]);
  assert.equal(groups[0]?.label, "D20");
  assert.equal(groups.at(-1)?.label, "No uniformat");
});

test("groupModelElements returns no groups for flat mode", () => {
  assert.deepEqual(groupModelElements(elements, []), []);
});
