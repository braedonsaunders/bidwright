import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@bidwright/db";
import { createModelTakeoffLink, createModelTakeoffLinks } from "./model-service.js";

test("unknown-unit model links are refused before any pickup or link write", async t => {
  function mock(target: any, method: string, implementation: any) {
    const original = target[method]; target[method] = implementation;
    t.after(() => { target[method] = original; });
  }
  mock(prisma.modelAsset, "findFirst", async () => ({ id: "model" }));
  mock(prisma.worksheetItem, "findFirst", async () => ({ worksheet: { revision: { quote: { projectId: "project" } } } }));
  mock(prisma.modelQuantity, "findFirst", async () => ({ id: "quantity", unit: "", value: 120 }));
  mock(prisma.modelQuantity, "findMany", async () => [{ id: "quantity", unit: "" }]);
  mock(prisma.modelElement, "findMany", async () => [{ id: "element" }]);
  let writes = 0;
  mock(prisma.pickup, "findMany", async () => { writes++; return []; });
  mock(prisma.pickup, "create", async () => { writes++; return {}; });
  mock(prisma.pickupLink, "upsert", async () => { writes++; return {}; });
  const input = { modelId: "model", worksheetItemId: "item", modelElementId: "element", modelQuantityId: "quantity", derivedQuantity: 120 };
  await assert.rejects(createModelTakeoffLink("project", input), /units are unknown/);
  await assert.rejects(createModelTakeoffLinks("project", { ...input, links: [input] }), /units are unknown/);
  assert.equal(writes, 0);
});

test("model links expose the pickup id and retain authored units on save and retry", async t => {
  function mock(target: any, method: string, implementation: any) {
    const original = target[method]; target[method] = implementation;
    t.after(() => { target[method] = original; });
  }
  let saved: any = null;
  mock(prisma.modelAsset, "findFirst", async () => ({ id: "model" }));
  mock(prisma.worksheetItem, "findFirst", async () => ({ worksheet: { revision: { quote: { projectId: "project" } } } }));
  mock(prisma.modelQuantity, "findFirst", async () => ({ id: "quantity", unit: "ft", value: 12 }));
  mock(prisma.modelElement, "findFirst", async () => ({ id: "element", name: "Pipe" }));
  mock(prisma.pickup, "findFirst", async () => saved);
  mock(prisma.pickup, "create", async ({ data }: any) => saved = data);
  mock(prisma.pickup, "update", async ({ data }: any) => saved = { ...saved, ...data });
  mock(prisma.pickupLink, "upsert", async ({ create }: any) => create);
  const input = { modelId: "model", worksheetItemId: "item", modelElementId: "element", modelQuantityId: "quantity" };
  const result = await createModelTakeoffLink("project", input);
  assert.equal(result.pickupId, saved.id);
  assert.equal(saved.measurement.unit, "ft");
  assert.equal(saved.measurement.value, 12);
  delete saved.measurement.unit; // legacy mark, saved before units were persisted
  const retry = await createModelTakeoffLink("project", input);
  assert.equal(retry.pickupId, result.pickupId);
  assert.equal(saved.measurement.unit, "ft");
});
