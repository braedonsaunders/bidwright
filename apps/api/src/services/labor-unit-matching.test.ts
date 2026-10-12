import assert from "node:assert/strict";
import test from "node:test";
import { laborOperationQueries, laborUnitPresentation, summarizeLaborBasis, validateLineDerivation } from "@bidwright/domain";
import { laborUnitConversion, matchLaborBreakdown } from "./labor-unit-matching.js";
import { buildLaborUnitDerivation } from "./labor-unit-derivation.js";
import { buildEstimatorSearchProfile } from "./estimator-search.js";
import { rankIndexedCandidates } from "./indexed-search.js";

const rows = [
  { id: "fabricate", name: "Fabricate structural steel plate", className: "Steel Fabrication", hoursNormal: 6, outputUom: "TONNE" },
  { id: "weld", name: "Fillet weld aluminum", className: "Welding", hoursNormal: .2, outputUom: "FT" },
  { id: "erect", name: "Erect structural steel per ton", className: "Steel Erection", hoursNormal: 8, outputUom: "TON" },
  { id: "cut", name: "Cut steel plate", className: "Layout & Flame Cutting per Lineal Inch", hoursNormal: .05, outputUom: "LIN IN" },
  { id: "drill", name: "Drilling holes in welded attachments", className: "Steel Plate", hoursNormal: .3, outputUom: "EA" },
];
const rank = (q: string) => rankIndexedCandidates(rows, buildEstimatorSearchProfile(q), row => `${row.name} ${row.className}`, row => row.name);

test("retrieval probe keeps four operation queries and a compound breakdown separate", () => {
  for (const [query, id] of [["fabricate structural steel", "fabricate"], ["fillet weld aluminum", "weld"], ["erect structural steel per ton", "erect"], ["cut steel plate", "cut"]]) {
    assert.equal(rank(query)[0].item.id, id);
  }
  const phrases = laborOperationQueries("structural steel plate fabrication welding aluminum ramp");
  assert.deepEqual(phrases, ["structural steel plate fabrication", "welding aluminum ramp"]);
  assert.deepEqual(phrases.map(query => rank(query)[0].item.id), ["fabricate", "weld"]);
});

test("pivoted numeric row labels expose dimensions, value column, library and book/page", () => {
  const display = laborUnitPresentation({ name: "1", library: { name: "Manual" }, category: "Attachments", sourceRef: {
    datasetName: "Drilling Holes in Welded Attachments", rowDimensions: [{ key: "plate", label: "plate (in)", value: "1" }],
    valueColumnName: "hole ≤3/4in", sourceBookName: "Piping Manual", sourcePages: "115",
  } });
  assert.match(display.name, /Drilling Holes.*plate \(in\) 1.*hole ≤3\/4in/);
  assert.match(display.path, /^Manual ›/);
  assert.equal(display.sourceBook, "Piping Manual"); assert.equal(display.sourcePage, "115");
});

test("batch matching shares duplicate searches, caps concurrency, and reports weak/material-incomplete matches", async () => {
  let active = 0, peak = 0, calls = 0;
  const lines = Array.from({ length: 60 }, (_, index) => ({ operation: `operation ${index % 9}`, quantity: 4, uom: "ft" }));
  const result = await matchLaborBreakdown(lines, "field", async () => {
    calls++; peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return { units: [{ id: "unit", name: "Candidate", hoursNormal: .05, outputUom: "LIN IN", metadata: { searchMatch: { coverage: .6, score: 70 } }, sourceRef: {} }] as any };
  });
  assert.equal(calls, 9); assert.ok(peak <= 4);
  assert.equal(result.lines.length, 60); assert.equal(result.lines[0].status, "no good match");
  assert.ok(Math.abs(result.lines[0].candidates[0].conversion.multiplier - 12) < 1e-10);
  assert.equal(laborUnitConversion("ton", "tonne").multiplier, null);
  assert.equal(laborUnitConversion("EA", "ft").multiplier, null);
});

test("matched row derivation records extended hours and separates rate pricing from productivity", () => {
  const item: any = { id: "row", description: "Weld", quantity: 10, uom: "FT", category: "Labour", rateScheduleItemId: "rate", tierUnits: { regular: .3 }, laborUnitId: "unit" };
  const unit = { id: "unit", name: "Weld", hoursNormal: .2, outputUom: "FT" };
  item.derivation = buildLaborUnitDerivation(item, unit);
  assert.equal(item.derivation.result.value, 3);
  assert.ok(Math.abs(item.derivation.inputs.find((input: any) => input.name === "factor").value - 1.5) < 1e-10);
  assert.deepEqual(validateLineDerivation(item.derivation, { expectedValue: 3 }).filter(issue => issue.severity === "error"), []);
  assert.equal(buildLaborUnitDerivation({ ...item, uom: "LS" }, unit), null);
  const ws: any = { worksheets: [{ items: [item, { ...item, id: "assumed", laborUnitId: null }] }],
    entityCategories: [{ id: "labor", name: "Labour", entityType: "Labour", analyticsBucket: "labour", calculationType: "rate_schedule" }],
    rateSchedules: [{ items: [{ id: "rate" }], tiers: [{ id: "regular", name: "Regular", uom: "HR" }] }] };
  assert.equal(summarizeLaborBasis(ws).sourcedHours, 3);
  assert.equal(summarizeLaborBasis(ws).assumedHours, 3);
  item.derivation.status = "stale";
  assert.equal(summarizeLaborBasis(ws).sourcedHours, 0);
  assert.equal(summarizeLaborBasis(ws).assumedHours, 6);
});

test("ordinary row creation persists matched productivity and a derivation without supplied tier hours", async t => {
  const { PrismaApiStore } = await import("../prisma-store.js");
  const proto = PrismaApiStore.prototype as any;
  const revision = { id: "revision", defaultMarkup: .2, createdAt: new Date(), updatedAt: new Date() };
  const category = { id: "cat", name: "Labour", entityType: "Labour", calculationType: "tiered_rate", itemSource: "rate_schedule" };
  const schedule = { createdAt: new Date(), updatedAt: new Date(), id: "schedule", revisionId: "revision", category: "Labour", name: "Rates", items: [{ id: "rate", name: "Welder", rates: { regular: 50 }, costRates: { regular: 40 } }], tiers: [{ id: "regular", name: "Regular", uom: "HR", multiplier: 1, sortOrder: 0 }] };
  const saved: any[] = [];
  const db: any = {
    project: { findFirst: async () => ({ id: "project" }) },
    worksheet: { findFirst: async () => ({ id: "sheet", revisionId: "revision" }) },
    entityCategory: { findMany: async () => [category] },
    rateSchedule: { findMany: async () => [schedule] },
    worksheetItem: { aggregate: async () => ({ _max: { lineOrder: 0 } }), create: async ({ data }: any) => { saved.push(data); return { ...data, entityCategory: category }; } },
  };
  t.mock.method(proto, "findCurrentRevision", async () => ({ revision }));
  t.mock.method(proto, "validateWorksheetItemProvenanceRefs", async () => {});
  t.mock.method(proto, "requireLaborUnit", async () => ({ id: "unit", name: "Weld", outputUom: "FT", hoursNormal: .2 }));
  t.mock.method(proto, "recordLineDerivationEvent", async () => {});
  t.mock.method(proto, "pushActivity", async () => {});
  t.mock.method(proto, "syncProjectEstimateForWorksheetItemMutation", async () => ({}));
  const store = new PrismaApiStore(db, "org");
  await store.createWorksheetItemWithSnapshot("project", "sheet", { category: "Labour", entityType: "Labour", entityName: "Welder", description: "Weld", laborUnitId: "unit", rateScheduleItemId: "rate", quantity: 10, uom: "FT" });
  assert.equal(saved[0].laborUnitId, "unit");
  assert.deepEqual(saved[0].tierUnits, { regular: .2 });
  assert.equal(saved[0].derivation.result.value, 2);
  assert.equal(saved[0].derivation.inputs.find((input: any) => input.name === "hoursNormal").source.ref, "unit");
});
