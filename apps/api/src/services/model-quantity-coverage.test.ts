import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@bidwright/db";
import { buildModelQuantityCoverage } from "./model-quantity-coverage.js";
import { getProjectModelAsset } from "./model-service.js";

test("coverage distinguishes unknown, not applicable and measured zero", () => {
  for (const facts of [{}, { elementCount: 0, estimateRelevantElementCount: 0, quantityElementCount: 0, quantityCount: 0 }]) {
    const result = buildModelQuantityCoverage(facts, "nwd", "indexed");
    assert.equal(result.quantityCoveragePercent, null);
    assert.doesNotMatch(result.summary, /0%/);
  }
  const empty = { elementCount: 5, estimateRelevantElementCount: 4, quantityElementCount: 0, quantityCount: 0 };
  assert.equal(buildModelQuantityCoverage(empty, "ifc", "indexed").quantityCoveragePercent, 0);
  assert.equal(buildModelQuantityCoverage(empty, "nwd", "processing").quantityCoveragePercent, null);
  assert.equal(buildModelQuantityCoverage(empty, "nwd", "failed").summary, "quantity coverage unknown");
});

test("model manifest coverage uses full persisted counts and reports mixed quantity sources", async t => {
  function mock(target: any, method: string, implementation: any) {
    const original = target[method]; target[method] = implementation;
    t.after(() => { target[method] = original; });
  }
  mock(prisma.modelAsset, "findFirst", async () => ({
    id: "model", format: "nwd", status: "indexed", manifest: { parser: "autodesk-aps" },
    elements: [{ id: "preview" }], quantities: [{ id: "preview-quantity" }],
  }));
  mock(prisma, "$queryRaw", async () => [{ facts: {
    elementCount: 10, estimateRelevantElementCount: 8, quantityElementCount: 6, quantityCount: 12,
    quantityMethods: { aps_model_derivative_property: 10, occt_closed_mesh_volume: 2 },
  } }]);
  const asset = await getProjectModelAsset("project", "model");
  assert.equal(asset!.manifest.quantityCoverage.quantityCoveragePercent, 75);
  assert.equal(asset!.manifest.quantityCoverage.quantityCount, 12);
  assert.equal(asset!.manifest.quantityCoverage.elementCount, 10);
  assert.match(asset!.manifest.quantityCoverage.summary, /authored Navisworks properties \(10\)/);
  assert.match(asset!.manifest.quantityCoverage.summary, /occt closed mesh volume \(2\)/);
});
