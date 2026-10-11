import assert from "node:assert/strict";
import test from "node:test";
import { PrismaApiStore } from "../prisma-store.js";
import { prisma } from "@bidwright/db";
import { saveSourceQuantityTakeoff, sourceQuantitySchema } from "./source-quantity-takeoff.js";

test("authored BOM quantities save visible provenance and link through the existing service", async (t) => {
  const saved: any[] = []; const links: any[] = [];
  const originalFile = prisma.fileNode.findFirst, originalItem = prisma.worksheetItem.findFirst;
  t.after(() => { prisma.fileNode.findFirst = originalFile; prisma.worksheetItem.findFirst = originalItem; });
  prisma.fileNode.findFirst = (async ({ where }: any) => where.id === "node" && where.projectId === "project" ? { id: "node" } : null) as any;
  prisma.worksheetItem.findFirst = (async () => ({ uom: "ft" })) as any;
  const store: any = {
    ensureSourceQuantityPickup: async (_project: string, input: any) => { saved.push(input); return { id: "pickup", ...input }; },
    ensurePickupLink: async (_project: string, input: any) => { links.push(input); return { id: "link", ...input }; },
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

test("HTTP retries and overlapping saves reuse source pickups and worksheet links", async (t) => {
  const pickups: any[] = [], links: any[] = [];
  let itemQuantity = 0, lockCalls = 0;
  const originalFile = prisma.fileNode.findFirst, originalItem = prisma.worksheetItem.findFirst;
  t.after(() => { prisma.fileNode.findFirst = originalFile; prisma.worksheetItem.findFirst = originalItem; });
  prisma.fileNode.findFirst = (async () => ({ id: "node" })) as any;
  prisma.worksheetItem.findFirst = (async () => ({ uom: "ft" })) as any;
  t.mock.method(PrismaApiStore.prototype as any, "recalcLinkedItemQuantity", async () => {
    itemQuantity = links.reduce((sum, link) => sum + link.derivedQuantity, 0);
  });
  const db: any = {
    project: { findFirst: async () => ({ id: "project" }) },
    quote: { findFirst: async () => ({ currentRevisionId: "revision" }) },
    quoteRevision: { findFirst: async () => ({ id: "revision" }) },
    worksheetItem: { findFirst: async () => ({ worksheetId: "sheet", uom: "ft" }) },
    worksheet: { findFirst: async () => ({ revisionId: "revision" }) },
    pickup: {
      findFirst: async ({ where }: any) => pickups.find(row => Object.entries(where).every(([key, value]) => key === "AND"
        ? (value as any[]).every(filter => Object.entries(filter).every(([field, condition]: any) =>
          JSON.stringify(condition.path.reduce((v: any, part: string) => v?.[part], row[field])) === JSON.stringify(condition.equals)))
        : row[key] === value)),
      create: async ({ data }: any) => { pickups.push(data); return data; },
    },
    pickupLink: {
      findUnique: async ({ where }: any) => links.find(row => Object.entries(where.pickupId_worksheetItemId).every(([key, value]) => row[key] === value)),
      create: async ({ data }: any) => { links.push(data); return data; },
    },
  };
  // Emulate the transaction-scoped advisory lock: release only after commit.
  let tail = Promise.resolve();
  db.$transaction = async (work: any) => {
    let release: (() => void) | undefined;
    const tx = { ...db, $executeRaw: async (sql: TemplateStringsArray) => {
      assert.match(sql.join("?"), /pg_advisory_xact_lock/);
      lockCalls++;
      const previous = tail;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
    } };
    try { return await work(tx); } finally { release?.(); }
  };
  const store = new PrismaApiStore(db, "org");
  const input = sourceQuantitySchema.parse({ documentId: "file-node", quantity: 317, unit: "ft", label: "Pipe", sourceRefs: [{ sheet: "BOM", row: 8 }], linkToItemId: "item" });
  const first = await saveSourceQuantityTakeoff(store, "project", input);
  const retries = await Promise.all(Array.from({ length: 3 }, () => saveSourceQuantityTakeoff(store, "project", input)));
  assert.equal(pickups.length, 1);
  assert.equal(links.length, 1);
  assert.equal(itemQuantity, 317);
  assert.ok(retries.every(result => result.pickup.id === first.pickup.id && result.link?.id === first.link?.id));
  assert.equal(lockCalls, 8);
  const different = await saveSourceQuantityTakeoff(store, "project", { ...input, quantity: 52.58, sourceRefs: [{ sheet: "BOM", row: 9 }] });
  assert.notEqual(different.pickup.id, first.pickup.id);
  assert.equal(pickups.length, 2);
  assert.equal(links.length, 2);
  assert.equal(itemQuantity, 369.58);
});
