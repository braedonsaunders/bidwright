import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@bidwright/db";
import { saveSourceQuantityTakeoff, sourceQuantitySchema } from "./source-quantity-takeoff.js";

test("authored BOM quantities save visible provenance and link through the existing service", async (t) => {
  const saved: any[] = []; const links: any[] = [];
  const originalFile = prisma.fileNode.findFirst, originalItem = prisma.worksheetItem.findFirst;
  t.after(() => { prisma.fileNode.findFirst = originalFile; prisma.worksheetItem.findFirst = originalItem; });
  prisma.fileNode.findFirst = (async ({ where }: any) => where.id === "node" && where.projectId === "project" ? { id: "node" } : null) as any;
  prisma.worksheetItem.findFirst = (async () => ({ uom: "ft" })) as any;
  const store: any = {
    createPickup: async (_project: string, input: any) => { saved.push(input); return { id: "pickup", ...input }; },
    createPickupLink: async (_project: string, input: any) => { links.push(input); return { id: "link", ...input }; },
  };
  const input = sourceQuantitySchema.parse({ documentId: "file-node", quantity: 317, unit: "ft", label: '3 inch SCH10S pipe', sourceRefs: [{ sheet: "BOM", row: 8, cell: "F8", text: "317 ft" }], linkToItemId: "row" });
  const result = await saveSourceQuantityTakeoff(store, "project", input);
  assert.equal(result.pickup.documentId, "file-node");
  assert.equal(result.pickup.measurement.value, 317);
  assert.equal(result.pickup.metadata.source, "source-quantity");
  assert.equal(result.pickup.metadata.measuredBy, "agent");
  assert.deepEqual(result.pickup.metadata.sourceRefs, input.sourceRefs);
  assert.deepEqual(links[0], { pickupId: "pickup", worksheetItemId: "row", quantityField: "value", multiplier: 1 });
  const foreign = { ...input, documentId: "file-foreign" };
  await assert.rejects(saveSourceQuantityTakeoff(store, "project", foreign), /Source not found/);
  assert.equal(saved.length, 1);
  const pixels = await saveSourceQuantityTakeoff(store, "project", { ...input, unit: "px" });
  assert.match(pixels.linkError!, /Pixel/);
  const mismatch = await saveSourceQuantityTakeoff(store, "project", { ...input, unit: "m" });
  assert.match(mismatch.linkError!, /multiplier/);
  assert.equal(links.length, 1);
  await saveSourceQuantityTakeoff(store, "project", { ...input, unit: "m", multiplier: 3.28084 });
  assert.equal(links[1].multiplier, 3.28084);
  assert.equal(sourceQuantitySchema.safeParse({ ...input, quantity: -1 }).success, false);
  assert.equal(sourceQuantitySchema.safeParse({ ...input, sourceRefs: [{}] }).success, false);
});
