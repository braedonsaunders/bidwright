import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { registerQuoteTools } from "./quote-tools.js";

test("configured duration rows keep their category and separate quote rate cost/sell provenance", async t => {
  const handlers = new Map<string, any>();
  registerQuoteTools({ tool: (name: string, _description: string, shape: any, run: any) => handlers.set(name, (args: any) => run(z.object(shape).parse(args))) } as any);
  const ws = { worksheets: [{ id: "sheet", items: [] }], entityCategories: [{ id: "access", name: "Access", entityType: "Equipment", calculationType: "duration_rate", itemSource: "rate_schedule", defaultUom: "WK", validUoms: ["WK"] }],
    rateSchedules: [{ id: "quote-rates", scope: "revision", category: "Access", metadata: { currency: "CAD" }, items: [{ id: "lift", name: "Access lift", metadata: { supplier: "Supplier reference" } }], tiers: [{ id: "week", uom: "WK" }] }] };
  const writes: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    if (init.method === "GET") return Response.json({ workspace: ws });
    const body = JSON.parse(init.body); writes.push(body);
    return Response.json({ id: "quote-rates", item: { id: "row", ...body } });
  });
  const rates = await handlers.get("setRateScheduleItemRates")({ scheduleId: "quote-rates", itemId: "lift", costRates: { week: 100 }, rates: { week: 130 }, costProvenance: { basis: "supplier quote" }, sellProvenance: { basis: "authored" } });
  assert.equal(rates.isError, undefined);
  assert.deepEqual(writes[0], { costRates: { week: 100 }, rates: { week: 130 }, metadata: { supplier: "Supplier reference", costProvenance: { basis: "supplier quote" }, sellProvenance: { basis: "authored" } } });
  for (const task of ["Electrical device installation access", "Ceiling finishes access"]) {
    const result = await handlers.get("createRateScheduleWorksheetItem")({ worksheetId: "sheet", categoryId: "access", entityName: "Access lift", description: task, rateScheduleItemId: "lift", quantity: 2, uom: "WK", tierUnits: { week: 3 }, evidenceBasis: { quantity: { type: "assumption", rationale: "Three weeks per access unit" }, pricing: { type: "equipment_rental", sourceRefs: ["quote-rates"] } } });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(writes.at(-1).category, "Access");
    assert.equal(writes.at(-1).quantity, 2);
    assert.deepEqual(writes.at(-1).tierUnits, { week: 3 });
  }
});
