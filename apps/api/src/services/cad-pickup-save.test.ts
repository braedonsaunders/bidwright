import test from "node:test";
import assert from "node:assert/strict";
import { PrismaApiStore } from "../prisma-store.js";

const entity = (entityId: string, patch = {}) => ({ entityId, entityType: "LINE", layer: "pipe", quantity: 12, unit: "in", measurementType: "length", selection: {}, ...patch });
function fixture(options: { rows?: any[]; failAt?: number; itemUnit?: string; foreignWorksheet?: boolean } = {}) {
  const rows = new Map((options.rows ?? []).map((row) => [row.id, row]));
  let writes = 0, transactions = 0;
  const db = { $transaction: async (work: (tx: any) => Promise<any>, config: any) => {
    transactions++;
    assert.equal(config.isolationLevel, "Serializable");
    const pending = new Map([...rows].map(([id, row]) => [id, structuredClone(row)]));
    const tx = {
      project: { findFirst: async () => ({ id: "p" }) },
      quote: { findFirst: async () => ({ currentRevisionId: "revision" }) },
      quoteRevision: { findFirst: async () => ({ id: "revision" }) },
      worksheetItem: { findFirst: async () => ({ worksheetId: "worksheet", uom: options.itemUnit ?? "in" }) },
      worksheet: { findFirst: async () => ({ revisionId: options.foreignWorksheet ? "other-revision" : "revision" }) },
      pickup: {
        findFirst: async ({ where }: any) => [...pending.values()].find((row) => Object.entries(where).every(([k, v]) => row[k] === v)),
        upsert: async ({ create }: any) => {
          if (++writes === options.failAt) throw new Error("Injected write failure");
          if (!pending.has(create.id)) pending.set(create.id, create);
          return pending.get(create.id);
        },
      },
    };
    const result = await work(tx);
    rows.clear(); for (const [id, row] of pending) rows.set(id, row);
    return result;
  } };
  return { store: new PrismaApiStore(db as any, "org"), rows, writes: () => writes, transactions: () => transactions };
}
const oldPickup = (measurement: Record<string, unknown>) => ({ id: "old", projectId: "p", documentId: "d", sourceKind: "cad-entity", cadEntityId: "B", measurement, label: "Human", points: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() });

test("CAD batch saves are atomic, idempotent and preserve matching human measurements", async () => {
  const f = fixture();
  const input = { documentId: "d", entities: [entity("A")] };
  const first = await f.store.saveCadEntityPickups("p", input);
  const row = [...f.rows.values()][0];
  assert.equal(row.sourceKind, "cad-entity"); assert.equal(row.cadEntityId, "A");
  row.measurement = { value: 18, unit: "in", type: "length" }; row.label = "Human measurement";
  const second = await f.store.saveCadEntityPickups("p", input);
  assert.equal(f.rows.size, 1); assert.equal(second.pickups[0].pickup.id, first.pickups[0].pickup.id);
  assert.equal(second.pickups[0].pickup.measurement.value, 18); assert.equal(second.pickups[0].pickup.label, "Human measurement");
  assert.equal(f.transactions(), 2);
  const failed = fixture({ failAt: 2 });
  await assert.rejects(failed.store.saveCadEntityPickups("p", { documentId: "d", entities: [entity("A"), entity("B")] }), /Injected/);
  assert.equal(failed.rows.size, 0);
});

test("all CAD measurements are validated before writes; conflicting pickups are returned unchanged", async () => {
  for (const measurement of [{ value: 1 }, { value: 1, type: "count", unit: "EA" }, { value: 1, type: "length", unit: "ft" }]) {
    const f = fixture({ rows: [oldPickup(measurement)] });
    const result = await f.store.saveCadEntityPickups("p", { documentId: "d", entities: [entity("A"), entity("B")], multiplier: 1 / 12 });
    assert.equal(result.saved, false); assert.deepEqual(result.conflicts[0].pickup.measurement, measurement);
    assert.equal(f.writes(), 0); assert.equal(f.rows.size, 1);
  }
  const f = fixture();
  await assert.rejects(f.store.saveCadEntityPickups("p", { documentId: "d", entities: [entity("A"), entity("B", { quantity: NaN })] }), /quantity/);
  assert.equal(f.writes(), 0);
});

test("CAD saves reject foreign worksheets and accept existing count aliases without unit conversion", async () => {
  const foreign = fixture({ foreignWorksheet: true });
  await assert.rejects(foreign.store.saveCadEntityPickups("p", { documentId: "d", worksheetItemId: "wrong", entities: [] }), /not found/);
  assert.equal(foreign.writes(), 0);
  for (const unit of ["PCS", "UNIT", "EA"]) {
    const f = fixture({ rows: [oldPickup({ value: 1, type: "count", unit: "PCS" })], itemUnit: unit });
    // A later conflict stops writes; the first count passes the same unit checks as a linked save.
    const result = await f.store.saveCadEntityPickups("p", { documentId: "d", worksheetItemId: "item", entities: [entity("A", { unit: "EA", measurementType: "count" }), entity("B")] });
    assert.equal(result.saved, false); assert.equal(f.writes(), 0);
    const unlinked = await f.store.saveCadEntityPickups("p", { documentId: "d", entities: [entity("B", { unit: "EA", measurementType: "count" })] });
    assert.equal(unlinked.saved, true);
  }
});

test("UI CAD quantity replacement clears stale measurement unit and type", async () => {
  let updated: any;
  const store = new PrismaApiStore({ pickup: {
    findFirst: async () => oldPickup({ value: 12, unit: "in", type: "length" }),
    update: async ({ data }: any) => { updated = data; return data; },
  } } as any, "org");
  await (store as any).upsertCadEntityPickup("p", { documentId: "d", entityId: "B", quantity: 1 });
  assert.deepEqual(updated.measurement, { value: 1 });
});
