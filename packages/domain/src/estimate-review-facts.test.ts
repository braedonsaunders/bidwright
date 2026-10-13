import assert from "node:assert/strict";
import test from "node:test";
import { summarizePricingIntegrity, summarizeUnlinkedMeasurements } from "./estimate-review-facts";
const row = { id: "r", description: "Pipe", quantity: 2, uom: "WK", price: 100, cost: 0, tierUnits: { weekly: 6 }, sourceEvidence: { evidenceBasis: { quantity: { quantityDriver: "2 units × 5WK" } } } };
test("missing rental cost and stale extended duration are facts, not price changes", () => {
  const workspace = { worksheets: [{ id: "w", items: [row] }] };
  const before = JSON.stringify(workspace), facts = summarizePricingIntegrity(workspace);
  assert.equal(facts.costUnknown.sell, 100, "saved row price is already extended");
  assert.deepEqual(facts.staleEvidence.rows[0].differences, [{ field: "extended WK", savedEvidence: 10, current: 12 }]);
  assert.equal(JSON.stringify(workspace), before);
});
test("candidate pickup links require compatible dimensions and label/source evidence", () => {
  const ws = { worksheets: [{ items: [{ id: "pipe", description: "gas pipe", quantity: 1, uom: "FT" }, { id: "stock", description: "gas pipe stock", uom: "EA" }] }], pickupLinks: [] };
  const result = summarizeUnlinkedMeasurements(ws, [{ id: "p", label: "gas pipe route", measurement: { value: 30, unit: "m" } }]);
  assert.equal(result.count, 1); assert.equal(result.pickups[0].candidates[0].rowId, "pipe");
  assert.match(result.pickups[0].candidates[0].conversion, /multiplier/);
  assert.equal(result.pickups[0].candidates.length, 1);
  assert.equal(summarizeUnlinkedMeasurements({ ...ws, pickupLinks: [{ pickupId: "p" }] }, [{ id: "p" }]).count, 0);
});
test("crew and rental comparisons use authored calendar inputs only", () => {
  const production = { id: "prod", description: "Shop pipe fabrication", category: "Labour", quantity: 1, tierUnits: { reg: 2816 }, derivation: { inputs: [{ name: "crewSize", value: 4 }, { name: "shiftHours", value: 8 }, { name: "workdaysPerWeek", value: 5 }] } };
  const foreman = { id: "foreman", description: "Shop foreman", category: "Labour", quantity: 1, tierUnits: { reg: 352 } };
  const rental = { id: "rental", description: "Rental", category: "Equipment", quantity: 2, uom: "WK", tierUnits: { weekly: 9 } };
  const workspace = { worksheets: [{ id: "shop", name: "Shop", items: [production, foreman, rental] }] };
  const facts = summarizePricingIntegrity(workspace).durationChecks[0];
  assert.equal(facts.requiredDays, 88);
  assert.deepEqual(facts.differences, [{ rowId: "foreman", coverageDays: 44, plannedOrDerivedDays: 88 }, { rowId: "rental", coverageDays: 45, plannedOrDerivedDays: 88 }]);
  production.derivation.inputs.pop();
  assert.equal(summarizePricingIntegrity(workspace).durationChecks[0].rentals[0].coverageDays, null);
});
