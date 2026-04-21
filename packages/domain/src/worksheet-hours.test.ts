import test from "node:test";
import assert from "node:assert/strict";

import { getExtendedWorksheetHourBreakdown, getWorksheetHourBreakdown, mapLegacyUnitsToTierUnits } from "./worksheet-hours.js";

const labourSchedules = [
  {
    tiers: [
      { id: "tier-reg", name: "Regular", multiplier: 1, sortOrder: 1 },
      { id: "tier-ot", name: "Overtime", multiplier: 1.5, sortOrder: 2 },
      { id: "tier-dt", name: "Double Time", multiplier: 2, sortOrder: 3 },
    ],
    items: [{ id: "rsi-labour", name: "Trade Labour", code: "LAB" }],
  },
];

test("getWorksheetHourBreakdown maps tier units into legacy labour slots", () => {
  const breakdown = getWorksheetHourBreakdown(
    {
      entityName: "Trade Labour",
      rateScheduleItemId: "rsi-labour",
      unit1: 0,
      unit2: 0,
      unit3: 0,
      tierUnits: {
        "tier-reg": 200,
        "tier-ot": 36.5,
        "tier-dt": 4,
      },
    },
    labourSchedules,
  );

  assert.deepEqual(breakdown, {
    unit1: 200,
    unit2: 36.5,
    unit3: 4,
    total: 240.5,
    source: "tier",
  });
});

test("getExtendedWorksheetHourBreakdown multiplies derived hours by quantity", () => {
  const breakdown = getExtendedWorksheetHourBreakdown(
    {
      entityName: "Trade Labour",
      rateScheduleItemId: "rsi-labour",
      tierUnits: {
        "tier-reg": 8,
        "tier-ot": 2,
      },
    },
    labourSchedules,
    3,
  );

  assert.deepEqual(breakdown, {
    unit1: 24,
    unit2: 6,
    unit3: 0,
    total: 30,
    source: "tier",
  });
});

test("mapLegacyUnitsToTierUnits rebuilds canonical tier payloads", () => {
  const mapped = mapLegacyUnitsToTierUnits(
    {
      entityName: "Trade Labour",
      rateScheduleItemId: "rsi-labour",
      unit1: 120,
      unit2: 18,
      unit3: 6,
    },
    labourSchedules,
  );

  assert.deepEqual(mapped, {
    "tier-reg": 120,
    "tier-ot": 18,
    "tier-dt": 6,
  });
});
