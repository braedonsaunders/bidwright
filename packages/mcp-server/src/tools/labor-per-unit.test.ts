import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { registerQuoteTools } from "./quote-tools.js";

// Exact five refused batch-1 operations, with project/rate/tier identifiers scrubbed.
const operations = JSON.parse(readFileSync(new URL("../../../domain/src/__fixtures__/labor-per-unit-batch.json", import.meta.url), "utf8"));

test("single, rate, update and batch tools accept per-unit labour traces without dropping their sources", async t => {
  const tools = new Map<string, any>();
  registerQuoteTools({ tool: (name: string, _description: string, shape: any, run: any) => tools.set(name, (args: any) => run(z.object(shape).parse(args))) } as any);
  const items: any[] = operations.map((op: any, i: number) => ({ ...op.item, id: `row-${i}` }));
  const ws = { worksheets: [{ id: "sheet", items }], entityCategories: [{ id: "cat", name: "Labour", entityType: "Labour", calculationType: "tiered_rate", itemSource: "rate_schedule", defaultUom: "HR", allowedUoms: ["HR"] }],
    estimateStrategy: { assumptions: [{ id: "A03" }, { id: "A06" }] },
    rateSchedules: [{ id: "schedule", name: "Rates", category: "Labour", items: [{ id: "rate", name: "Trade Labour" }], tiers: [{ id: "regular", uom: "HR" }] }] };
  const writes: any[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: any) => {
    if (init.method === "GET") return Response.json({ workspace: ws });
    const body = JSON.parse(init.body); writes.push(body);
    return Response.json(body.operations ? { results: body.operations.map((op: any, index: number) => ({ index, op: op.op, itemId: `row-${index}`, item: op.item ?? op.patch })) } : { item: { id: "row", ...body } });
  });
  const batch = await tools.get("batchEditWorksheetItems")({ operations });
  assert.equal(batch.isError, undefined, JSON.stringify(batch));
  for (const [i, op] of writes[0].operations.entries()) {
    assert.equal(op.item.laborUnitId, operations[i].item.laborUnitId);
    assert.deepEqual(op.item.tierUnits, operations[i].item.tierUnits);
    assert.equal(op.item.derivation.formula, operations[i].item.derivation.formula);
    assert.deepEqual(op.item.derivation.inputs, operations[i].item.derivation.inputs);
  }
  for (const name of ["createWorksheetItem", "createRateScheduleWorksheetItem", "updateWorksheetItem"]) {
    const args = { ...operations[0].item, worksheetId: "sheet", ...(name === "updateWorksheetItem" ? { itemId: "row-0" } : {}) };
    const result = await tools.get(name)(args);
    assert.equal(result.isError, undefined, `${name}: ${JSON.stringify(result)}`);
    assert.equal(writes.at(-1).laborUnitId, operations[0].item.laborUnitId);
    assert.equal(writes.at(-1).derivation.result.value, 1.24191125);
  }
  const updated = await tools.get("batchEditWorksheetItems")({ operations: operations.map((op: any, i: number) => ({ op: "update", itemId: `row-${i}`, patch: op.item })) });
  assert.equal(updated.isError, undefined, JSON.stringify(updated));
  assert.equal(writes.at(-1).operations[0].patch.laborUnitId, operations[0].item.laborUnitId);

  const bad = structuredClone(operations);
  bad[0].item.tierUnits.regular = 2;
  const before = writes.length;
  const result = await tools.get("batchEditWorksheetItems")({ operations: bad });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Derivation produces 1.24191125 but the row tierUnits is 2/);
  assert.equal(writes.length, before, "invalid batch must not POST any operations");
});
