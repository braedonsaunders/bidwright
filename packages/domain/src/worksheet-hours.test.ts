import test from "node:test";
import assert from "node:assert/strict";

import {
  getExtendedWorksheetHourBreakdown,
  getWorksheetHourBreakdown,
  getWorksheetUnitKind,
  rollupWorksheetUnits,
} from "./worksheet-hours";

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

test("getWorksheetHourBreakdown returns one entry per populated tier", () => {
  const breakdown = getWorksheetHourBreakdown(
    {
      entityName: "Trade Labour",
      rateScheduleItemId: "rsi-labour",
      tierUnits: {
        "tier-reg": 200,
        "tier-ot": 36.5,
        "tier-dt": 4,
      },
    },
    labourSchedules,
  );

  assert.equal(breakdown.total, 240.5);
  assert.deepEqual(
    breakdown.tiers.map((t) => ({ tierId: t.tierId, name: t.name, multiplier: t.multiplier, hours: t.hours })),
    [
      { tierId: "tier-reg", name: "Regular", multiplier: 1, hours: 200 },
      { tierId: "tier-ot", name: "Overtime", multiplier: 1.5, hours: 36.5 },
      { tierId: "tier-dt", name: "Double Time", multiplier: 2, hours: 4 },
    ],
  );
});

test("getWorksheetHourBreakdown skips zero/negative tier entries", () => {
  const breakdown = getWorksheetHourBreakdown(
    {
      entityName: "Trade Labour",
      rateScheduleItemId: "rsi-labour",
      tierUnits: {
        "tier-reg": 100,
        "tier-ot": 0,
        "tier-dt": -2,
      },
    },
    labourSchedules,
  );
  assert.equal(breakdown.tiers.length, 1);
  assert.equal(breakdown.tiers[0]!.tierId, "tier-reg");
  assert.equal(breakdown.total, 100);
});

test("getWorksheetHourBreakdown returns empty when tierUnits is empty", () => {
  const breakdown = getWorksheetHourBreakdown({ tierUnits: {} }, labourSchedules);
  assert.equal(breakdown.tiers.length, 0);
  assert.equal(breakdown.total, 0);
});

test("getExtendedWorksheetHourBreakdown multiplies hours by quantity", () => {
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

  assert.equal(breakdown.total, 30);
  assert.equal(breakdown.tiers[0]!.hours, 24);
  assert.equal(breakdown.tiers[1]!.hours, 6);
});

test("getWorksheetHourBreakdown sorts tiers by sortOrder then multiplier", () => {
  const schedules = [
    {
      tiers: [
        { id: "tier-dt", name: "Double Time", multiplier: 2, sortOrder: 1 },
        { id: "tier-reg", name: "Regular", multiplier: 1, sortOrder: 2 },
      ],
      items: [{ id: "rsi-labour", name: "Trade Labour", code: "LAB" }],
    },
  ];
  const breakdown = getWorksheetHourBreakdown(
    {
      entityName: "Trade Labour",
      rateScheduleItemId: "rsi-labour",
      tierUnits: { "tier-reg": 1, "tier-dt": 1 },
    },
    schedules,
  );
  assert.deepEqual(
    breakdown.tiers.map((t) => t.tierId),
    ["tier-dt", "tier-reg"],
  );
});

test("getExtendedWorksheetHourBreakdown preserves a zero quantity", () => {
  const breakdown = getExtendedWorksheetHourBreakdown(
    {
      rateScheduleItemId: "rsi-labour",
      tierUnits: { "tier-reg": 8 },
    },
    labourSchedules,
    0,
  );
  assert.equal(breakdown.total, 0);
});

test("semantic unit kind comes from category analytics instead of tier presence", () => {
  const categories = [
    { id: "cat-labour", name: "Crew", analyticsBucket: "labour", calculationType: "tiered_rate" },
    { id: "cat-equipment", name: "Rental", analyticsBucket: "equipment", calculationType: "duration_rate" },
  ];
  assert.equal(getWorksheetUnitKind({ categoryId: "cat-labour", tierUnits: { daily: 1 } }, categories), "labour_hours");
  assert.equal(getWorksheetUnitKind({ categoryId: "cat-equipment", tierUnits: { regular: 8 } }, categories), "equipment_duration");
});

test("rollupWorksheetUnits keeps equipment duration out of labour hours and extends quantity once", () => {
  const schedules = [
    ...labourSchedules,
    {
      tiers: [
        { id: "tier-day", name: "Daily", multiplier: 1, sortOrder: 1, uom: "DAY" },
        { id: "tier-week", name: "Weekly", multiplier: 3, sortOrder: 2, uom: "WK" },
      ],
      items: [{ id: "rsi-equipment", name: "Lift", code: "LIFT" }],
    },
  ];
  const categories = [
    { id: "cat-labour", name: "Labour", analyticsBucket: "labour", calculationType: "tiered_rate" },
    { id: "cat-equipment", name: "Equipment", analyticsBucket: "equipment", calculationType: "duration_rate" },
  ];
  const rollup = rollupWorksheetUnits(
    [
      {
        categoryId: "cat-labour",
        rateScheduleItemId: "rsi-labour",
        tierUnits: { "tier-reg": 8, "tier-ot": 2 },
        quantity: 2,
      },
      {
        categoryId: "cat-equipment",
        rateScheduleItemId: "rsi-equipment",
        tierUnits: { "tier-day": 5, "tier-week": 1 },
        quantity: 3,
      },
    ],
    schedules,
    categories,
  );

  assert.equal(rollup.labourHours.total, 20);
  assert.deepEqual(rollup.labourHours.tiers.map((tier) => [tier.name, tier.total]), [
    ["Regular", 16],
    ["Overtime", 4],
  ]);
  assert.equal(rollup.equipmentDuration.total, 18);
  assert.deepEqual(rollup.equipmentDuration.tiers.map((tier) => [tier.name, tier.total]), [
    ["Daily", 15],
    ["Weekly", 3],
  ]);
});
