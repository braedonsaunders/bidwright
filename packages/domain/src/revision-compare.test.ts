import test from "node:test";
import assert from "node:assert/strict";

import { compareQuoteRevisions, type RevisionCompareSide } from "./revision-compare";
import { buildQuoteRevisionComparison } from "./quote-engine";
import { mockStore } from "./mock-data";
import type { BidwrightStore } from "./models";

function side(overrides: Partial<RevisionCompareSide> = {}): RevisionCompareSide {
  return {
    revision: { id: "rev-1", revisionNumber: 1, title: "Base", status: "Open", type: "Firm", updatedAt: "2026-01-01T00:00:00.000Z" },
    totals: { subtotal: 0, cost: 0, estimatedProfit: 0, estimatedMargin: 0, totalHours: 0, regHours: 0, overHours: 0, doubleHours: 0 },
    worksheets: [],
    phases: [],
    adjustments: [],
    ...overrides,
  };
}

/** `cost` is per-unit and `price` is the extended line total — the storage
 *  convention the calc engine enforces. */
function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "li-1",
    category: "Material",
    entityType: "Material",
    entityName: "Elbow 2in",
    description: "Butt weld elbow",
    uom: "EA",
    vendor: "",
    quantity: 10,
    cost: 5,
    price: 80,
    tierUnits: {},
    ...overrides,
  };
}

test("compareQuoteRevisions reports financial deltas with percentages", () => {
  const result = compareQuoteRevisions(
    side({ totals: { subtotal: 1000, cost: 600, estimatedProfit: 400, estimatedMargin: 0.4, totalHours: 100 } }),
    side({
      revision: { id: "rev-2", revisionNumber: 2, title: "Head", status: "Open", type: "Firm" },
      totals: { subtotal: 1250, cost: 700, estimatedProfit: 550, estimatedMargin: 0.44, totalHours: 90 },
    }),
  );

  const subtotal = result.financials.find((row) => row.key === "subtotal");
  assert.equal(subtotal?.base, 1000);
  assert.equal(subtotal?.head, 1250);
  assert.equal(subtotal?.delta, 250);
  assert.equal(subtotal?.percentDelta, 0.25);
  assert.equal(result.financials.find((row) => row.key === "totalHours")?.delta, -10);
  assert.equal(result.base.revisionNumber, 1);
  assert.equal(result.head.revisionNumber, 2);
});

test("a zero base metric reports no percentage rather than infinity", () => {
  const result = compareQuoteRevisions(side(), side({ totals: { subtotal: 500 } }));
  assert.equal(result.financials.find((row) => row.key === "subtotal")?.percentDelta, null);
});

test("positions pair on their natural key across freshly minted revision ids", () => {
  const base = side({
    worksheets: [{ id: "ws-a", name: "Piping", order: 0, items: [item({ id: "old-1" })] }],
  });
  const head = side({
    revision: { id: "rev-2", revisionNumber: 2, title: "Head" },
    // Same $8/EA rate, four more of them.
    worksheets: [{ id: "ws-b", name: "Piping", order: 0, items: [item({ id: "new-1", quantity: 14, price: 112 })] }],
  });

  const result = compareQuoteRevisions(base, head);

  assert.equal(result.lineItems.added.length, 0);
  assert.equal(result.lineItems.removed.length, 0);
  assert.equal(result.lineItems.changed.length, 1);
  assert.deepEqual(result.lineItems.changed[0].changes, ["quantity"]);
  assert.equal(result.lineItems.changed[0].quantityDelta, 4);
  assert.equal(result.lineItems.changed[0].extendedPriceDelta, 32);
  assert.equal(result.summary.quantityChangedCount, 1);
  assert.equal(result.summary.priceDelta, 32);
});

test("a rate move is reported as a rate change, not a requantification", () => {
  const result = compareQuoteRevisions(
    side({ worksheets: [{ name: "Piping", order: 0, items: [item()] }] }),
    side({ worksheets: [{ name: "Piping", order: 0, items: [item({ cost: 6, price: 95 })] }] }),
  );

  const change = result.lineItems.changed[0];
  assert.deepEqual(change.changes, ["rate", "cost"]);
  assert.equal(change.unitPriceDelta, 1.5);
  assert.equal(change.extendedPriceDelta, 15);
  assert.equal(result.summary.rateChangedCount, 1);
  assert.equal(result.summary.quantityChangedCount, 0);
});

test("added and removed positions are reported with their extended value", () => {
  const result = compareQuoteRevisions(
    side({ worksheets: [{ name: "Piping", order: 0, items: [item({ entityName: "Dropped" })] }] }),
    side({ worksheets: [{ name: "Piping", order: 0, items: [item({ entityName: "Fresh", quantity: 2, price: 200, cost: 60 })] }] }),
  );

  assert.equal(result.lineItems.added.length, 1);
  assert.equal(result.lineItems.added[0].entityName, "Fresh");
  assert.equal(result.lineItems.added[0].extendedPrice, 200);
  assert.equal(result.lineItems.added[0].unitPrice, 100);
  assert.equal(result.lineItems.removed.length, 1);
  assert.equal(result.lineItems.removed[0].entityName, "Dropped");
  assert.equal(result.summary.priceDelta, 120);
  assert.equal(result.summary.costDelta, 70);
});

test("repeated positions pair in sheet order instead of churning as add plus delete", () => {
  const result = compareQuoteRevisions(
    side({
      worksheets: [{ name: "Piping", order: 0, items: [item({ quantity: 10, price: 80 }), item({ quantity: 20, price: 160 })] }],
    }),
    side({
      worksheets: [{ name: "Piping", order: 0, items: [item({ quantity: 10, price: 80 }), item({ quantity: 25, price: 200 })] }],
    }),
  );

  assert.equal(result.lineItems.added.length, 0);
  assert.equal(result.lineItems.removed.length, 0);
  assert.equal(result.lineItems.unchangedCount, 1);
  assert.equal(result.lineItems.changed.length, 1);
  assert.equal(result.lineItems.changed[0].quantityDelta, 5);
});

test("hours fall back to tier units x quantity when the caller does not resolve them", () => {
  const result = compareQuoteRevisions(
    side({ worksheets: [{ name: "Labour", order: 0, items: [item({ category: "Labour", quantity: 10, tierUnits: { "tier-reg": 2 } })] }] }),
    side({ worksheets: [{ name: "Labour", order: 0, items: [item({ category: "Labour", quantity: 10, tierUnits: { "tier-reg": 3 } })] }] }),
  );

  const change = result.lineItems.changed[0];
  assert.ok(change.changes.includes("hours"));
  assert.equal(change.base.hours, 20);
  assert.equal(change.head.hours, 30);
  assert.equal(result.summary.hoursDelta, 10);
});

test("resolved hours from the caller win over the tier-unit fallback", () => {
  const result = compareQuoteRevisions(
    side({ worksheets: [{ name: "Labour", order: 0, items: [item({ tierUnits: { reg: 2 }, quantity: 10, hours: 25 })] }] }),
    side({ worksheets: [{ name: "Labour", order: 0, items: [item({ tierUnits: { reg: 2 }, quantity: 10, hours: 25 })] }] }),
  );

  assert.equal(result.lineItems.changed.length, 0);
  assert.equal(result.lineItems.unchangedCount, 1);
});

test("phase, adjustment, and worksheet changes are reported separately", () => {
  const result = compareQuoteRevisions(
    side({
      worksheets: [{ name: "Piping", order: 0, items: [] }],
      phases: [{ id: "p1", number: "1", name: "Mobilize", description: "" }, { id: "p2", number: "2", name: "Install", description: "" }],
      adjustments: [
        { id: "a1", name: "Contingency", kind: "markup", percentage: 0.05, amount: null, active: true },
        { id: "a2", name: "Dropped Fee", kind: "markup", percentage: 0.02, amount: null, active: true },
      ],
    }),
    side({
      worksheets: [{ name: "Piping", order: 0, items: [] }, { name: "Equipment", order: 1, items: [] }],
      phases: [{ id: "p3", number: "1", name: "Mobilize & Setup", description: "" }, { id: "p4", number: "3", name: "Commission", description: "" }],
      adjustments: [
        { id: "a3", name: "Contingency", kind: "markup", percentage: 0.08, amount: null, active: true },
        { id: "a4", name: "Escalation", kind: "markup", percentage: 0.03, amount: null, active: true },
      ],
    }),
  );

  assert.deepEqual(result.worksheets.added, ["Equipment"]);
  assert.deepEqual(result.worksheets.removed, []);
  assert.deepEqual(result.phases.added.map((phase) => phase.number), ["3"]);
  assert.deepEqual(result.phases.removed.map((phase) => phase.number), ["2"]);
  assert.deepEqual(result.phases.changed.map((phase) => phase.changes), [["name"]]);
  assert.deepEqual(result.adjustments.added.map((entry) => entry.name), ["Escalation"]);
  assert.deepEqual(result.adjustments.removed.map((entry) => entry.name), ["Dropped Fee"]);
  assert.deepEqual(result.adjustments.changed[0].changes, ["percentage"]);
});

test("sub-cent calc noise does not surface as a change", () => {
  const result = compareQuoteRevisions(
    side({ worksheets: [{ name: "Piping", order: 0, items: [item({ price: 80 })] }] }),
    side({ worksheets: [{ name: "Piping", order: 0, items: [item({ price: 80.004 })] }] }),
  );

  assert.equal(result.lineItems.changed.length, 0);
  assert.equal(result.lineItems.unchangedCount, 1);
});

/* ── Store-backed path ────────────────────────────────────────────────────
 * `buildQuoteRevisionComparison` reads both revisions out of one store
 * snapshot and prices each through `calculateTotals`. The copy that
 * `createRevision` writes re-keys every id, so this mirrors that: new
 * worksheet and row ids on the head side, nothing carried over but content.
 */

/** Clone rev-0 onto a fresh revision the way `createRevision` does: new ids
 *  everywhere, including re-keyed rate schedules, tiers and rate items, with
 *  each row's `tierUnits` and `rateScheduleItemId` remapped onto them. */
function storeWithSecondRevision(mutate: (items: BidwrightStore["worksheetItems"]) => void): BidwrightStore {
  const store: BidwrightStore = structuredClone(mockStore);
  const copyId = (id: string) => `${id}-copy`;
  const source = store.revisions.find((entry) => entry.id === "rev-0")!;
  store.revisions.push({ ...source, id: "rev-1", revisionNumber: 1, title: "Revised Takeoff" });

  store.rateSchedules.push(
    ...store.rateSchedules
      .filter((schedule) => schedule.revisionId === "rev-0")
      .map((schedule) => ({ ...schedule, id: copyId(schedule.id), revisionId: "rev-1" })),
  );
  const copiedScheduleIds = new Set(
    store.rateSchedules.filter((schedule) => schedule.revisionId === "rev-0").map((schedule) => schedule.id),
  );
  store.rateScheduleTiers.push(
    ...store.rateScheduleTiers
      .filter((tier) => copiedScheduleIds.has(tier.scheduleId))
      .map((tier) => ({ ...tier, id: copyId(tier.id), scheduleId: copyId(tier.scheduleId) })),
  );
  store.rateScheduleItems.push(
    ...store.rateScheduleItems
      .filter((rateItem) => copiedScheduleIds.has(rateItem.scheduleId))
      .map((rateItem) => ({
        ...rateItem,
        id: copyId(rateItem.id),
        scheduleId: copyId(rateItem.scheduleId),
        rates: Object.fromEntries(Object.entries(rateItem.rates ?? {}).map(([tierId, rate]) => [copyId(tierId), rate])),
      })),
  );

  const copiedWorksheets = store.worksheets
    .filter((worksheet) => worksheet.revisionId === "rev-0")
    .map((worksheet) => ({ ...worksheet, id: copyId(worksheet.id), revisionId: "rev-1" }));
  const copiedWorksheetIds = new Set(store.worksheets.filter((w) => w.revisionId === "rev-0").map((w) => w.id));
  const copiedItems = store.worksheetItems
    .filter((item) => copiedWorksheetIds.has(item.worksheetId))
    .map((item) => ({
      ...item,
      id: copyId(item.id),
      worksheetId: copyId(item.worksheetId),
      rateScheduleItemId: item.rateScheduleItemId ? copyId(item.rateScheduleItemId) : item.rateScheduleItemId,
      tierUnits: item.tierUnits
        ? Object.fromEntries(Object.entries(item.tierUnits).map(([tierId, hours]) => [copyId(tierId), hours]))
        : item.tierUnits,
    }));

  mutate(copiedItems);
  store.worksheets.push(...copiedWorksheets);
  store.worksheetItems.push(...copiedItems);
  store.phases.push(
    ...store.phases
      .filter((phase) => phase.revisionId === "rev-0")
      .map((phase) => ({ ...phase, id: copyId(phase.id), revisionId: "rev-1" })),
  );
  store.adjustments.push(
    ...store.adjustments
      .filter((adjustment) => adjustment.revisionId === "rev-0")
      .map((adjustment) => ({ ...adjustment, id: copyId(adjustment.id), revisionId: "rev-1" })),
  );
  store.estimateFactors = [
    ...(store.estimateFactors ?? []),
    ...(store.estimateFactors ?? [])
      .filter((factor) => factor.revisionId === "rev-0")
      .map((factor) => ({ ...factor, id: copyId(factor.id), revisionId: "rev-1" })),
  ];
  store.quotes = store.quotes.map((quote) => (quote.id === "quote-main" ? { ...quote, currentRevisionId: "rev-1" } : quote));
  return store;
}

test("an untouched revision copy compares as no change at all", () => {
  const store = storeWithSecondRevision(() => {});

  const result = buildQuoteRevisionComparison(store, "rev-0", "rev-1")!;

  assert.ok(result);
  assert.equal(result.lineItems.added.length, 0);
  assert.equal(result.lineItems.removed.length, 0);
  assert.equal(result.lineItems.changed.length, 0);
  assert.ok(result.lineItems.unchangedCount > 0);
  assert.equal(result.summary.priceDelta, 0);
  assert.equal(result.financials.find((row) => row.key === "subtotal")?.delta, 0);
});

test("a repriced row on the copied revision surfaces with its dollar movement", () => {
  const store = storeWithSecondRevision((items) => {
    const target = items.find((item) => item.id === "li-1-copy")!;
    target.price = target.price + 25_000;
  });

  const result = buildQuoteRevisionComparison(store, "rev-0", "rev-1")!;

  assert.equal(result.lineItems.changed.length, 1);
  assert.equal(result.lineItems.changed[0].extendedPriceDelta, 25_000);
  assert.ok(result.lineItems.changed[0].changes.includes("rate"));
  assert.equal(result.summary.priceDelta, 25_000);

  // The subtotal moves further than the line: this quote's adjustments apply
  // on top of the rows, which is why the two numbers are reported separately.
  const subtotalDelta = result.financials.find((row) => row.key === "subtotal")?.delta ?? 0;
  assert.ok(subtotalDelta > result.summary.priceDelta, `expected the subtotal delta to exceed ${result.summary.priceDelta}, got ${subtotalDelta}`);
});

test("comparing against a revision that is not on this quote returns nothing", () => {
  const store = storeWithSecondRevision(() => {});

  assert.equal(buildQuoteRevisionComparison(store, "rev-0", "rev-missing"), null);
  assert.equal(buildQuoteRevisionComparison(store, "rev-missing", "rev-1"), null);
});
