import assert from "node:assert/strict";
import test from "node:test";
import { summarizePricingIntegrity, summarizeUnlinkedMeasurements } from "./estimate-review-facts";
const row = { id: "r", description: "Pipe", quantity: 2, uom: "WK", price: 100, cost: 0, tierUnits: { weekly: 6 }, sourceEvidence: { evidenceBasis: { quantity: { quantityDriver: "2 units × 5WK" } } } };
test("sell-only rentals have no cost warning while stale duration remains visible", () => {
  const workspace = { worksheets: [{ id: "w", items: [row] }] };
  const before = JSON.stringify(workspace), facts = summarizePricingIntegrity(workspace);
  assert.equal("costUnknown" in facts, false);
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
  const foreman = { id: "foreman", description: "Shop foreman", category: "Labour", quantity: 1, uom: "HR", tierUnits: { reg: 352 } };
  const rental = { id: "rental", description: "Rental", category: "Equipment", quantity: 2, uom: "WK", tierUnits: { weekly: 9 } };
  const workspace = { worksheets: [{ id: "shop", name: "Shop", items: [production, foreman, rental] }] };
  const facts = summarizePricingIntegrity(workspace).durationChecks;
  assert.deepEqual(facts.map(({ rowId, coverageDays, requiredDays, differs }) => ({ rowId, coverageDays, requiredDays, differs })), [{ rowId: "foreman", coverageDays: 44, requiredDays: 88, differs: true }, { rowId: "rental", coverageDays: 45, requiredDays: 88, differs: true }]);
  production.derivation.inputs.pop();
  assert.equal(summarizePricingIntegrity(workspace).durationChecks.find(r => r.rowId === "rental")?.coverageDays, null);
});
test("per-unit hour evidence is extended before comparing; standalone foreman hours remain detectable", () => {
  const basis = (rationale: string, quantityDriver?: string) => ({ evidenceBasis: { quantity: { rationale, quantityDriver } } });
  const rows = [
    { id: "rate", category: "Labour", quantity: 80, tierUnits: { reg: .5 }, sourceEvidence: basis("Purge work at .5 person-HR/shop joint", "80 output units × 0.5 person-hours/output unit") },
    { id: "extended", category: "Labour", quantity: 1, tierUnits: { reg: 96 }, sourceEvidence: basis("48 flange interfaces × 2 person-hours = 96 person-hours", "48 flange interfaces × 2 person-hours/interface") },
    { id: "foreman", category: "Labour", quantity: 1, tierUnits: { reg: 240 }, sourceEvidence: basis("112 person-hours shared supervision") },
    { id: "perUnit", category: "Labour", quantity: 2, tierUnits: { reg: 2 }, sourceEvidence: basis("2 person-hours per unit") },
    { id: "rental", quantity: 2, uom: "WK", tierUnits: { wk: 6 }, sourceEvidence: basis("", "2 units ×5weeks") },
  ];
  const facts = summarizePricingIntegrity({ worksheets: [{ items: rows }] }).staleEvidence;
  assert.deepEqual(facts.rows.map(r => r.rowId), ["foreman", "rental"]);
  assert.deepEqual(facts.rows[0].differences[0], { field: "labourHours", savedEvidence: 112, current: 240 });
  assert.deepEqual(facts.rows[1].differences[0], { field: "extended WK", savedEvidence: 10, current: 12 });
});
test("duration quantities without tiers and non-measurement annotations are not false alarms", () => {
  const facts = summarizePricingIntegrity({ worksheets: [{ items: [{ ...row, quantity: 10, tierUnits: {} }] }] });
  assert.equal(facts.staleEvidence.count, 0);
  const pickups = [
    { id: "note", annotationType: "note", measurement: { value: 1, unit: "EA" } },
    { id: "cal", annotationType: "calibration", measurement: { value: 10, unit: "m" } },
    { id: "empty", annotationType: "linear", measurement: {} },
    { id: "linked", annotationType: "linear", measurement: { value: 10, unit: "m" }, _count: { pickupLinks: 1 } },
    { id: "valid", annotationType: "linear", measurement: { value: 10, unit: "m" }, _count: { pickupLinks: 0 } },
  ];
  assert.deepEqual(summarizeUnlinkedMeasurements({}, pickups).pickups.map(p => p.pickupId), ["valid"]);
});
