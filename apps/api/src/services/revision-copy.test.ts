import assert from "node:assert/strict";
import test from "node:test";

import { remapRateScheduleItemId, remapTierUnits } from "./revision-copy";

// A revision copy mints new ids for every tier and schedule item.
const tierIdMap = new Map([
  ["rst-old-regular", "rst-new-regular"],
  ["rst-old-overtime", "rst-new-overtime"],
  ["rst-old-double", "rst-new-double"],
]);
const scheduleItemIdMap = new Map([["rsi-old-trade-labour", "rsi-new-trade-labour"]]);

test("copied tier hours follow the tiers into the new revision", () => {
  // Carried over verbatim, these keys matched no tier of the new revision, so
  // the copied worksheet reported no hours at all.
  const remapped = remapTierUnits(
    { "rst-old-regular": 40, "rst-old-overtime": 10, "rst-old-double": 10 },
    tierIdMap,
  );

  assert.deepEqual(remapped, {
    "rst-new-regular": 40,
    "rst-new-overtime": 10,
    "rst-new-double": 10,
  });
  assert.equal(Object.values(remapped).reduce((sum, hours) => sum + hours, 0), 60, "no hours lost");
});

test("legacy alias keys survive the copy", () => {
  // Older rows key hours by synthetic aliases that name no tier row. Dropping
  // an unmapped key would silently delete hours the estimator entered.
  assert.deepEqual(
    remapTierUnits({ __reg: 8, __ot: 2, "rst-old-regular": 4 }, tierIdMap),
    { __reg: 8, __ot: 2, "rst-new-regular": 4 },
  );
});

test("non-numeric and empty tier payloads degrade to zero rather than NaN", () => {
  assert.deepEqual(remapTierUnits({ "rst-old-regular": "not a number" }, tierIdMap), { "rst-new-regular": 0 });
  assert.deepEqual(remapTierUnits({}, tierIdMap), {});
  assert.deepEqual(remapTierUnits(null, tierIdMap), {});
  assert.deepEqual(remapTierUnits(undefined, tierIdMap), {});
  // An array is not a tier map; treat it as empty rather than indexing it.
  assert.deepEqual(remapTierUnits([1, 2], tierIdMap), {});
});

test("a copied row points at the copied rate item", () => {
  // Left unmapped, the new revision rejected its own rate items as
  // non-existent when the row was edited.
  assert.equal(
    remapRateScheduleItemId("rsi-old-trade-labour", scheduleItemIdMap),
    "rsi-new-trade-labour",
  );
});

test("rows without a rate item stay without one", () => {
  assert.equal(remapRateScheduleItemId(null, scheduleItemIdMap), null);
  assert.equal(remapRateScheduleItemId("", scheduleItemIdMap), null);
  assert.equal(remapRateScheduleItemId(undefined, scheduleItemIdMap), null);
});

test("an unmapped rate item keeps its reference instead of losing its pricing basis", () => {
  assert.equal(remapRateScheduleItemId("rsi-unknown", scheduleItemIdMap), "rsi-unknown");
});
