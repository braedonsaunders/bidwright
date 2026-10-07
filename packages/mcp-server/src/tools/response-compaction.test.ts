import assert from "node:assert/strict";
import test from "node:test";
import {
  compactLaborDiagnostics,
  compactLaborUnitRow,
  compactRateItem,
  compactRateMap,
  compactScheduleSummary,
  paginate,
  shouldIncludeRates,
} from "./response-compaction.js";

const schedule = {
  id: "rs-teva",
  name: "Teva 2026 D2D (MECH)",
  category: "Labour",
  scope: "global",
  description: "Mechanical day-to-day labour rates for the Stouffville site, including foreman and trade tiers and the standard overtime multipliers agreed for 2026.",
  tiers: [
    { id: "rst-reg", name: "Regular", multiplier: 1, uom: "HR" },
    { id: "rst-ot", name: "Overtime", multiplier: 1.5, uom: "HR" },
  ],
  items: Array.from({ length: 60 }, (_, i) => ({
    id: `rsi-${i}`,
    name: i === 0 ? "MECH:Trade Labour" : `Rate item ${i} with a fairly long descriptive name that keeps going`,
    code: `MECH-${i}`,
    unit: "HR",
    description: "Journeyman millwright, including small tools and consumables, site-wide, as agreed in the 2026 schedule negotiation.",
    rates: { "rst-reg": 98.9, "rst-ot": 148.35 },
    costRates: { "rst-reg": 61.1234, "rst-ot": 91.69 },
    burden: {},
    perDiem: null,
  })),
};

test("paginate exposes continuation and omitted counts and clamps limits", () => {
  const items = Array.from({ length: 73 }, (_, i) => i);
  const first = paginate(items, { limit: 500 }, { defaultLimit: 25, maxLimit: 100 });
  assert.equal(first.limit, 100);
  assert.equal(first.page.length, 73);
  assert.equal(first.hasMore, false);
  assert.equal(first.nextOffset, null);
  assert.equal(first.omitted, 0);
  const second = paginate(items, { limit: 25, offset: 50 }, { defaultLimit: 25, maxLimit: 100 });
  assert.deepEqual([second.page[0], second.page.at(-1)], [50, 72]);
  assert.equal(second.total, 73);
  assert.equal(second.omitted, 50);
  const third = paginate(items, {}, { defaultLimit: 25, maxLimit: 100 });
  assert.equal(third.page.length, 25);
  assert.equal(third.nextOffset, 25);
  assert.equal(third.omitted, 48);
});

test("a compact rate item keeps the selection essentials and stays small without rates", () => {
  const row = compactRateItem(schedule.items[0], schedule, { includeRates: false });
  assert.equal(row.rateScheduleItemId, "rsi-0");
  assert.equal(row.scheduleId, "rs-teva");
  assert.equal(row.unit, "HR");
  assert.equal(row.code, "MECH-0");
  assert.equal(row.rates, undefined);
  assert.ok(JSON.stringify(row).length < 350, `row is ${JSON.stringify(row).length} chars`);
  assert.ok(!("scheduleName" in row) && !("tierIds" in row), "schedule-level fields are not repeated per row");
});

test("rates are re-keyed by tier name, rounded to cents, and cost rates kept when they differ", () => {
  const row = compactRateItem(schedule.items[0], schedule, { includeRates: true });
  assert.deepEqual(row.rates, { Regular: 98.9, Overtime: 148.35 });
  assert.deepEqual(row.costRates, { Regular: 61.12, Overtime: 91.69 });
  assert.equal(row.burden, undefined, "empty burden is dropped");
  assert.equal(row.perDiem, undefined);
  // an unknown tier id is never dropped
  assert.deepEqual(compactRateMap({ "rst-unknown": 10 }, []), { "rst-unknown": 10 });
  assert.equal(compactRateMap({}, []), undefined);
});

test("rates are included for narrowed queries or small pages and omitted only for broad pages", () => {
  assert.equal(shouldIncludeRates({ narrowed: true, returned: 200 }), true, "q/scheduleId/category always exposes rates");
  assert.equal(shouldIncludeRates({ narrowed: false, returned: 20 }), true, "small unfiltered page still has rates");
  assert.equal(shouldIncludeRates({ narrowed: false, returned: 60 }), false, "broad page omits rates");
  assert.equal(shouldIncludeRates({ includeRates: true, narrowed: false, returned: 200 }), true, "explicit true wins");
  assert.equal(shouldIncludeRates({ includeRates: false, narrowed: true, returned: 1 }), false, "explicit false wins");
});

test("a schedule summary carries tier names by default, ids on request, and explicit sample omission", () => {
  const compact = compactScheduleSummary(schedule);
  assert.deepEqual(compact.tierNames, ["Regular", "Overtime"]);
  assert.equal(compact.tiers, undefined);
  assert.equal(compact.sampleItems, undefined);
  assert.equal(compact.itemCount, 60);
  assert.ok((compact.description ?? "").length <= 100);
  const withIds = compactScheduleSummary(schedule, { includeTiers: "ids", sampleItemCount: 3 });
  assert.deepEqual(withIds.tiers, [{ id: "rst-reg", name: "Regular" }, { id: "rst-ot", name: "Overtime" }]);
  assert.equal(withIds.sampleItems?.length, 3);
  assert.equal(withIds.sampleItemsOmitted, 57);
  assert.ok(JSON.stringify(compact).length < 400, `summary is ${JSON.stringify(compact).length} chars`);
});

test("a labour-unit row keeps id/code/hours/unit, collapses taxonomy, and drops prose", () => {
  const unit = {
    id: "lu-1", code: "GCM-254-002-01",
    name: "Erect light structural steel platform framing, bolted connections, under 10 ft elevation, including shakeout and plumb",
    discipline: "Mechanical", category: "Structural Steel", className: "Platforms", subClassName: "Light framing",
    outputUom: "TON", hoursNormal: 18.333333, entityCategoryType: "Labour",
    description: "Very long description ".repeat(40), tags: ["a", "b"], libraryId: "lib-1", sourceRef: { book: "x", page: 12 },
  };
  const row = compactLaborUnitRow(unit, { kind: "library", label: "Exact library unit match on 'platform' and 'structural steel' in class Platforms", matchType: "exact", sourceQuality: "high", confidence: 0.87654 });
  assert.equal(row.id, "lu-1");
  assert.equal(row.code, "GCM-254-002-01");
  assert.equal(row.hoursNormal, 18.33);
  assert.equal(row.outputUom, "TON");
  assert.equal(row.path, "Mechanical › Structural Steel › Platforms › Light framing");
  assert.equal(row.basis.confidence, 0.88);
  assert.ok((row.basis.label ?? "").length <= 60);
  assert.ok(!("description" in row) && !("sourceRef" in row) && !("matchType" in row), "prose and duplicated basis fields are gone");
  assert.ok(JSON.stringify(row).length < 450, `row is ${JSON.stringify(row).length} chars`);
});

test("labour diagnostics reduce to term hits and slice count with truncated keys named", () => {
  const compact = compactLaborDiagnostics({
    term: { platform: 120, steel: 340, erection: { hits: 12 } },
    querySlices: [{}, {}, {}],
    scoring: { huge: "x".repeat(5000) },
    candidatesConsidered: 5280,
  });
  assert.deepEqual(compact?.termHits, { platform: 120, steel: 340, erection: 12 });
  assert.equal(compact?.querySlices, 3);
  assert.deepEqual(compact?.truncatedKeys, ["scoring", "candidatesConsidered"]);
  assert.equal(compactLaborDiagnostics(null), undefined);
});
