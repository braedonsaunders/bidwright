import assert from "node:assert/strict";
import test from "node:test";
import { groupCadEntities } from "./cad-entity-groups";

const rows = [
  { id: "1", layer: "Pipe", type: "LINE", layoutName: "Model", uom: "LF" },
  { id: "2", layer: "Pipe", type: "LINE", layoutName: "Model", uom: "LF" },
  { id: "3", layer: "Pipe", type: "HATCH", layoutName: "Model", uom: "SF" },
  { id: "4", layer: "Equipment", type: "INSERT", layoutName: "Plan", uom: "EA" },
];

test("groups CAD entities by ordered axes", () => {
  const groups = groupCadEntities(rows, ["layer", "type"]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].entities.length, 2);
  assert.match(groups[0].label, /Layer: Pipe · Type: LINE · LF/);
});

test("never mixes incompatible units in one rollup", () => {
  const groups = groupCadEntities(rows, ["layer"]);
  const pipe = groups.filter((group) => group.label.startsWith("Layer: Pipe"));
  assert.equal(pipe.length, 2);
  assert.deepEqual(pipe.map((group) => group.entities[0].uom).sort(), ["LF", "SF"]);
});

test("supports a flat list", () => {
  const groups = groupCadEntities(rows, []);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].entities.length, 4);
});
