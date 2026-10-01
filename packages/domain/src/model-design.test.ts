import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDesignScalar, modelDesignPartSignature, validateModelDesign, type ModelDesign } from "./model-design";

const plate = (): ModelDesign => ({
  version: 1, name: "Mounting plate", units: "in", parameters: { width: 8, depth: 6, thickness: 0.25, hole_radius: 0.25 },
  features: [
    { id: "blank", op: "box", size: ["width", "depth", "thickness"] },
    { id: "hole", op: "cylinder", origin: ["width/2", "depth/2", -0.01], radius: "hole_radius", height: "thickness + 0.02" },
    { id: "plate", op: "cut", inputs: ["blank", "hole"] },
  ],
  parts: [{ id: "plate", name: "Mounting plate", feature: "plate", material: "A36 steel" }], assumptions: [],
});

test("dimension expressions retain intent when a parameter changes", () => {
  const recipe = plate();
  validateModelDesign(recipe);
  assert.equal(evaluateDesignScalar(recipe.features[1]!.origin![0], recipe.parameters), 4);
  recipe.parameters.width = 12;
  assert.equal(evaluateDesignScalar(recipe.features[1]!.origin![0], recipe.parameters), 6);
  assert.equal(evaluateDesignScalar("-(width - 2) / 2", recipe.parameters), -5);
});

test("model expressions cannot execute code or read object properties", () => {
  for (const expression of ["globalThis.fetch('secret')", "width.constructor", "Math.random()", "width;process.exit()", "1/0", "unknown + 2", "(2 + 3", "2 3"]) {
    assert.throws(() => evaluateDesignScalar(expression, { width: 8 }), expression);
  }
});

test("forward/cyclic references and duplicate IDs are rejected before touching CAD", () => {
  const forward = plate();
  forward.features[0]!.inputs = ["plate"];
  assert.throws(() => validateModelDesign(forward), /earlier features/);
  const duplicate = plate();
  duplicate.features[1]!.id = "blank";
  assert.throws(() => validateModelDesign(duplicate), /duplicate/);
});

test("incomplete model responses cannot silently discard a part", () => {
  const recipe = plate();
  recipe.parts[0]!.feature = "not_present";
  assert.throws(() => validateModelDesign(recipe), /Invalid part/);
  assert.throws(() => validateModelDesign({ ...plate(), parts: [] }), /requires/);
  const badTube = plate();
  badTube.features = [{ id: "tube", op: "tube", size: [2, 2, 36] }];
  assert.throws(() => validateModelDesign(badTube), /wall is required/);
});


test("changing one member dimension leaves unrelated part signatures unchanged", () => {
  const before = plate();
  before.parameters.leg_height = 36;
  before.features.push({ id: "leg", op: "tube", size: [2, 2, "leg_height"], wall: 0.125 });
  before.parts.push({ id: "leg", name: "Left leg", feature: "leg" });
  const after = structuredClone(before);
  after.parameters.leg_height = 40;
  after.features[0] = { size: ["width", "depth", "thickness"], op: "box", id: "blank" };
  assert.equal(modelDesignPartSignature(before, before.parts[0]!), modelDesignPartSignature(after, after.parts[0]!));
  assert.notEqual(modelDesignPartSignature(before, before.parts[1]!), modelDesignPartSignature(after, after.parts[1]!));
});

test("existing solids can be surgical edit inputs with an explicit target node", () => {
  const design = plate();
  design.features[0] = { id: "blank", op: "existing", nodeId: "imported-plate" };
  design.parts[0]!.nodeId = "imported-plate";
  validateModelDesign(design);
  const duplicate = structuredClone(design);
  duplicate.parts.push({ id: "other", name: "Other", feature: "plate", nodeId: "imported-plate" });
  assert.throws(() => validateModelDesign(duplicate), /same node/);
  delete design.features[0]!.nodeId;
  assert.throws(() => validateModelDesign(design), /requires nodeId/);
});
