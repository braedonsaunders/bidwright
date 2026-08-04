import test from "node:test";
import assert from "node:assert/strict";

import { buildPdfDataPackage, generatePdfHtml } from "./pdf-service";

export function workspaceFixture() {
  const pricingLadder = {
    version: 1,
    directCost: 600,
    lineSubtotal: 1000,
    adjustmentTotal: 100,
    netTotal: 1100,
    grandTotal: 1100,
    internalProfit: 500,
    internalMargin: 0.4545,
    rows: [
      {
        id: "direct_cost",
        label: "Direct Cost",
        rowType: "base",
        financialCategory: "direct_cost",
        baseAmount: 600,
        value: 600,
        cost: 600,
        margin: 0,
        runningTotal: 600,
        affectsTotal: false,
        visible: true,
        active: true,
      },
      {
        id: "line_subtotal",
        label: "Line Sell Subtotal",
        rowType: "base",
        financialCategory: "line_subtotal",
        baseAmount: 1000,
        value: 1000,
        cost: 600,
        margin: 0.4,
        runningTotal: 1000,
        affectsTotal: true,
        visible: true,
        active: true,
      },
      {
        id: "fuel",
        label: "Fuel Adjustment",
        rowType: "adjustment",
        financialCategory: "other",
        baseAmount: 1000,
        value: 100,
        cost: 0,
        margin: 1,
        runningTotal: 1100,
        affectsTotal: true,
        visible: true,
        active: true,
      },
      {
        id: "grand_total",
        label: "Customer Total",
        rowType: "total",
        financialCategory: "total",
        baseAmount: 1100,
        value: 1100,
        cost: 600,
        margin: 0.4545,
        runningTotal: 1100,
        affectsTotal: true,
        visible: true,
        active: true,
      },
    ],
  };
  return {
    quote: { quoteNumber: "Q-1", title: "Canonical Quote", customerString: "Kingdom Construction" },
    currentRevision: {
      revisionNumber: 1,
      title: "Stale Revision Title",
      description: "Scope",
      subtotal: 1100,
      cost: 600,
      estimatedProfit: 500,
      estimatedMargin: 0.4545,
      totalHours: 20,
      pricingLadder,
    },
    project: { clientName: "Oxford County", location: "Site" },
    entityCategories: [
      { id: "labour", name: "Labour", entityType: "Labour", analyticsBucket: "labour", calculationType: "tiered_rate" },
      { id: "equipment", name: "Equipment", entityType: "Equipment", analyticsBucket: "equipment", calculationType: "duration_rate" },
    ],
    rateSchedules: [{
      tiers: [
        { id: "regular", name: "Straight Time", multiplier: 1, sortOrder: 1, uom: "HR" },
        { id: "premium", name: "Night Shift", multiplier: 1.25, sortOrder: 2, uom: "HR" },
        { id: "daily", name: "Daily", multiplier: 1, sortOrder: 1, uom: "DAY" },
      ],
      items: [
        { id: "labour-rate", name: "Welder" },
        { id: "equipment-rate", name: "Lift" },
      ],
    }],
    worksheets: [{
      name: "Work",
      items: [
        {
          lineOrder: 1,
          categoryId: "labour",
          category: "Labour",
          entityType: "Labour",
          entityName: "Welder",
          rateScheduleItemId: "labour-rate",
          tierUnits: { regular: 8, premium: 2 },
          quantity: 2,
          uom: "HR",
          cost: 200,
          markup: 0.2,
          price: 500,
        },
        {
          lineOrder: 2,
          categoryId: "equipment",
          category: "Equipment",
          entityType: "Equipment",
          entityName: "Lift",
          rateScheduleItemId: "equipment-rate",
          tierUnits: { daily: 5 },
          quantity: 3,
          uom: "DAY",
          cost: 100,
          markup: 0.2,
          price: 600,
        },
      ],
    }],
    phases: [],
    estimate: { totals: { pricingLadder } },
    summaryRows: [],
    adjustments: [],
    conditions: [],
    reportSections: [],
    scheduleTasks: [],
  };
}

test("proposal renders the shared Price Build without internal cost", () => {
  const data = buildPdfDataPackage(workspaceFixture());
  const html = generatePdfHtml(data, "main");
  assert.equal(data.title, "Canonical Quote");
  assert.match(html, /Canonical Quote/);
  assert.doesNotMatch(html, /Stale Revision Title/);
  assert.match(html, /Price Build/);
  assert.match(html, />Rollup</);
  assert.match(html, /Fuel Adjustment/);
  assert.match(html, /Prepared for <strong>Kingdom Construction/);
  assert.doesNotMatch(html, /Oxford County/);
  assert.doesNotMatch(html, /<h2>Adjustments/);
  assert.doesNotMatch(html, />Direct Cost</);
  assert.doesNotMatch(html, />Margin</);
});

test("site copy honours dynamic labour tiers and excludes equipment duration from labour", () => {
  const data = buildPdfDataPackage(workspaceFixture());
  const html = generatePdfHtml(data, "sitecopy", {
    sections: {
      coverPage: false,
      scopeOfWork: false,
      leadLetter: false,
      lineItems: true,
      phases: false,
      conditions: false,
      terms: false,
      pricingSummary: false,
      hoursSummary: true,
      labourSummary: true,
      notes: false,
      reportSections: false,
      schedule: false,
    },
  });
  assert.match(html, /Straight Time/);
  assert.match(html, /Night Shift \(1\.25x\)/);
  assert.match(html, />16</);
  assert.match(html, />4</);
  assert.doesNotMatch(html, /Regular/);
  assert.doesNotMatch(html, /Double Time/);
  assert.doesNotMatch(html, /\$200/);
  assert.doesNotMatch(html, /Daily<\/th>/);
});
