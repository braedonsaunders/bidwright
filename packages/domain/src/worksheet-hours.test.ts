import test from "node:test";
import assert from "node:assert/strict";

import { getExtendedWorksheetHourBreakdown, getWorksheetHourBreakdown } from "./worksheet-hours";

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
