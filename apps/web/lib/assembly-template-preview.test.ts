import test from "node:test";
import assert from "node:assert/strict";
import {
  appendFormulaVariable,
  buildAssemblyFormulaScope,
  extractFormulaVariables,
  summarizeAssemblyTemplate,
} from "./assembly-template-preview";

test("extractFormulaVariables ignores supported function names", () => {
  assert.deepEqual(extractFormulaVariables("ceil(length / spacing) + max(waste, 1)"), [
    "length",
    "spacing",
    "waste",
  ]);
});

test("buildAssemblyFormulaScope evaluates defaults in parameter order", () => {
  const result = buildAssemblyFormulaScope([
    { key: "length", defaultValue: "12" },
    { key: "waste", defaultValue: "length * 0.1" },
  ]);
  assert.equal(result.scope.length, 12);
  assert.ok(Math.abs(result.scope.waste - 1.2) < 0.000001);
  assert.deepEqual(result.invalidDefaultKeys, []);
});

test("summarizeAssemblyTemplate reports formula use and unused parameters", () => {
  assert.deepEqual(summarizeAssemblyTemplate(
    [
      { key: "length", defaultValue: "10" },
      { key: "spacing", defaultValue: "2" },
      { key: "height", defaultValue: "8" },
    ],
    [
      { quantityExpr: "ceil(length / spacing)" },
      { quantityExpr: "1" },
    ],
  ), {
    formulaCount: 1,
    referencedParameterKeys: ["length", "spacing"],
    unusedParameterKeys: ["height"],
    invalidDefaultKeys: [],
  });
});

test("appendFormulaVariable appends unique parameter tokens", () => {
  assert.equal(appendFormulaVariable("", "height"), "height");
  assert.equal(appendFormulaVariable("length", "height"), "length * height");
  assert.equal(appendFormulaVariable("length * height", "height"), "length * height");
});
