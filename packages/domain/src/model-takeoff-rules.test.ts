import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateModelTakeoff,
  aggregateModelTakeoffRules,
  buildModelTakeoffGroup,
  filterUnlinkedModelElements,
  matchesModelTakeoffPredicate,
  scoreModelTakeoffRule,
  type ModelTakeoffElement,
  type ModelTakeoffQuantityRule,
} from "./model-takeoff-rules";

const elements: ModelTakeoffElement[] = [
  {
    id: "wall-1",
    modelId: "model-a",
    name: "Level 1 Exterior Wall A",
    type: "Wall",
    category: "Architectural",
    level: "Level 1",
    material: "Concrete",
    classification: { masterformat: "03" },
    quantities: { area: 120, length: 30, volume: 18 },
    properties: { fireRating: "2hr" },
  },
  {
    id: "wall-2",
    modelId: "model-a",
    name: "Level 1 Exterior Wall B",
    type: "Wall",
    category: "Architectural",
    level: "Level 1",
    material: "Concrete",
    classification: { masterformat: "03" },
    quantities: { area: "80", length: 20 },
    linkedWorksheetItemIds: ["item-1"],
  },
  {
    id: "pipe-1",
    name: "CS Pipe Run",
    type: "Pipe",
    category: "Mechanical",
    level: "Mezzanine",
    material: "Carbon Steel",
    quantities: { length: 42.5 },
  },
  {
    id: "beam-1",
    modelId: "model-b",
    externalId: "ifc-beam-1",
    name: "Level 2 W12x26 Beam",
    elementClass: "Structural Framing",
    elementType: "Beam",
    level: "Level 2",
    material: "Steel",
    system: "Structural",
    quantities: [
      { id: "beam-length", quantityType: "length", value: "1,250.5 LF", unit: "LF", confidence: 0.8 },
      { id: "beam-weight", quantityType: "weight", value: 1500, unit: "LB" },
    ],
    properties: { identity: { mark: "B1" } },
  },
];

const wallAreaRule: ModelTakeoffQuantityRule = {
  id: "rule-wall-area",
  name: "Concrete wall area",
  predicate: { type: "Wall", level: "Level 1", material: "Concrete", classification: { masterformat: "03" } },
  quantityKind: "area",
  quantityKeys: ["netArea", "area"],
  outputUnit: "SF",
  worksheetCategory: "Material",
  confidence: 0.9,
};

test("matchesModelTakeoffPredicate matches common element fields and nested properties", () => {
  assert.equal(
    matchesModelTakeoffPredicate(elements[0], {
      type: ["Wall", "Curtain Wall"],
      nameContains: "exterior",
      propertyEquals: { fireRating: "2hr" },
    }),
    true,
  );
  assert.equal(matchesModelTakeoffPredicate(elements[2], { type: "Wall" }), false);
});

test("matchesModelTakeoffPredicate handles API model fields and ignores empty filters", () => {
  assert.equal(
    matchesModelTakeoffPredicate(elements[3], {
      externalId: "ifc-beam-1",
      type: "Beam",
      category: "Structural Framing",
      nameContains: "",
      propertyEquals: { "identity.mark": "B1", ignored: "" },
    }),
    true,
  );
  assert.equal(matchesModelTakeoffPredicate(elements[3], { elementClass: "Mechanical" }), false);
  assert.equal(matchesModelTakeoffPredicate(elements[0], { type: "", classification: { masterformat: "" } }), true);
});

test("aggregateModelTakeoff sums area quantities across matching elements", () => {
  const result = aggregateModelTakeoff(wallAreaRule, elements);
  assert.equal(result.quantity, 200);
  assert.equal(result.quantityKey, "area");
  assert.deepEqual(result.quantityKeysUsed, ["area"]);
  assert.deepEqual(result.sourceQuantityUnits, []);
  assert.equal(result.sourceQuantityConfidence, 1);
  assert.deepEqual(result.matchedElementIds, ["wall-1", "wall-2"]);
  assert.equal(result.worksheetItemProposal.quantity, 200);
  assert.equal(result.worksheetItemProposal.uom, "SF");
  assert.equal(result.confidence, 0.9);
});

test("aggregateModelTakeoff reads model quantity arrays from indexed 3D elements", () => {
  const result = aggregateModelTakeoff(
    {
      id: "rule-steel-length",
      name: "Steel beam length",
      predicate: { elementType: "Beam", material: "Steel" },
      quantityKind: "length",
      quantityKeys: ["length"],
      outputUnit: "LF",
    },
    elements,
  );

  assert.equal(result.quantity, 1250.5);
  assert.equal(result.quantityKey, "length");
  assert.deepEqual(result.quantityKeysUsed, ["length"]);
  assert.deepEqual(result.sourceQuantityUnits, ["LF"]);
  assert.equal(result.sourceQuantityConfidence, 0.8);
  assert.equal(result.confidence, 0.68);
  assert.deepEqual(result.matchedElementIds, ["beam-1"]);
});

test("aggregateModelTakeoff falls back to count rules without quantity keys", () => {
  const result = aggregateModelTakeoff(
    {
      id: "rule-wall-count",
      name: "Wall count",
      predicate: { type: "Wall" },
      quantityKind: "count",
      quantityKeys: [],
      outputUnit: "EA",
    },
    elements,
  );
  assert.equal(result.quantity, 2);
  assert.equal(result.quantityKey, "count");
  assert.equal(result.missingQuantityElementIds.length, 0);
});

test("aggregateModelTakeoffRules can run bulk rules over only unlinked elements", () => {
  const results = aggregateModelTakeoffRules(
    [
      {
        id: "rule-wall-count",
        name: "Wall count",
        predicate: { type: "Wall" },
        quantityKind: "count",
        quantityKeys: [],
        outputUnit: "EA",
      },
      {
        id: "rule-steel-length",
        name: "Steel beam length",
        predicate: { elementType: "Beam" },
        quantityKind: "length",
        quantityKeys: ["length"],
        outputUnit: "LF",
      },
    ],
    elements,
    { onlyUnlinked: true },
  );

  assert.equal(results[0].quantity, 1);
  assert.deepEqual(results[0].matchedElementIds, ["wall-1"]);
  assert.equal(results[1].quantity, 1250.5);
  assert.deepEqual(results[1].matchedElementIds, ["beam-1"]);
});

test("aggregateModelTakeoff reports missing quantities and lowers confidence", () => {
  const result = aggregateModelTakeoff(
    {
      ...wallAreaRule,
      quantityKeys: ["grossArea"],
    },
    elements,
  );
  assert.equal(result.quantity, 0);
  assert.deepEqual(result.missingQuantityElementIds, ["wall-1", "wall-2"]);
  assert.equal(result.confidence, 0);
});

test("filterUnlinkedModelElements removes elements already linked to worksheet items", () => {
  assert.deepEqual(filterUnlinkedModelElements(elements).map((element) => element.id), ["wall-1", "pipe-1", "beam-1"]);
});

test("scoreModelTakeoffRule rewards matched predicates with usable quantities", () => {
  assert.equal(scoreModelTakeoffRule(wallAreaRule, elements[2]), 0);
  assert.ok(scoreModelTakeoffRule(wallAreaRule, elements[0]) > 0.8);
});

test("buildModelTakeoffGroup stores matching element ids", () => {
  const group = buildModelTakeoffGroup("g1", "Level 1 walls", elements, { type: "Wall", level: "Level 1" });
  assert.deepEqual(group.elementIds, ["wall-1", "wall-2"]);
  assert.equal(group.modelId, "model-a");
});
