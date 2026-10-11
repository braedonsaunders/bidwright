import test from "node:test";
import assert from "node:assert/strict";
import { PrismaApiStore } from "../prisma-store.js";

test("CAD save shares the UI pickup path and preserves existing measurements on repeated saves", async () => {
  const rows = new Map<string, any>();
  const db = {
    project: { findFirst: async () => ({ id: "p" }) },
    pickup: {
      findFirst: async ({ where }: any) => [...rows.values()].find((row) => Object.entries(where).every(([k, v]) => row[k] === v)),
      upsert: async ({ create }: any) => { if (!rows.has(create.id)) rows.set(create.id, create); return rows.get(create.id); },
    },
  };
  const store = new PrismaApiStore(db as any, "org");
  const input = { documentId: "d", entities: [{ entityId: "A", entityType: "LINE", layer: "pipe", quantity: 12, unit: "in", measurementType: "length", selection: {} }] };
  const first = await store.saveCadEntityPickups("p", input);
  assert.equal(rows.size, 1);
  const row = [...rows.values()][0];
  assert.equal(row.sourceKind, "cad-entity"); assert.equal(row.cadEntityId, "A");
  row.measurement = { value: 18, unit: "in", type: "length" }; row.label = "Human measurement";
  const second = await store.saveCadEntityPickups("p", input);
  assert.equal(rows.size, 1); assert.equal(second.pickups[0].pickup.id, first.pickups[0].pickup.id);
  assert.equal(second.pickups[0].pickup.measurement.value, 18); assert.equal(second.pickups[0].pickup.label, "Human measurement");
});

test("CAD save refuses a worksheet from another project before creating pickups", async () => {
  let writes = 0;
  const store = new PrismaApiStore({
    project: { findFirst: async () => ({ id: "p" }) },
    quote: { findFirst: async () => ({ currentRevisionId: "revision" }) },
    quoteRevision: { findFirst: async () => ({ id: "revision" }) },
    worksheetItem: { findFirst: async () => ({ worksheetId: "other" }) },
    worksheet: { findFirst: async () => ({ revisionId: "other-revision" }) },
    pickup: { upsert: async () => { writes++; } },
  } as any, "org");
  await assert.rejects(store.saveCadEntityPickups("p", { documentId: "d", worksheetItemId: "wrong", entities: [] }), /not found/);
  assert.equal(writes, 0);
});
