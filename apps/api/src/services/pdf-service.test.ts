import test from "node:test";
import assert from "node:assert/strict";

import { buildPdfDataPackage, buildSchedulePdfData, generatePdfHtml, generateSchedulePdfHtml, tierAbbreviation } from "./pdf-service";

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

/**
 * Mirrors the real tenant shape: tierUnits keyed by persisted RateScheduleTier
 * UUIDs, resolved through the schedule the line's rateScheduleItemId belongs
 * to. Production handed the PDF tier-less schedules, so every tier collapsed to
 * the "Standard" placeholder and lost its sort order.
 */
function tenantLabourWorkspace() {
  return {
    quote: { quoteNumber: "BW-1", title: "Tiered Labour" },
    currentRevision: { revisionNumber: 1, subtotal: 0, cost: 0, totalHours: 60 },
    project: {},
    entityCategories: [
      { id: "cat-labour", name: "Labour", entityType: "Labour", analyticsBucket: "labour", calculationType: "tiered_rate" },
    ],
    rateSchedules: [{
      id: "rs-1",
      name: "Birla Carbon 2026 (MECH)",
      // Deliberately not in display order — sortOrder is what must win.
      tiers: [
        { id: "rst-f77e654e", name: "Double Time", multiplier: 2, sortOrder: 2, uom: "HR" },
        { id: "rst-bd3f22d9", name: "Regular", multiplier: 1, sortOrder: 0, uom: "HR" },
        { id: "rst-1f1df26d", name: "Overtime", multiplier: 1.5, sortOrder: 1, uom: "HR" },
      ],
      items: [{ id: "rsi-d516a099", name: "MECH:Trade Labour" }],
    }],
    worksheets: [{
      name: "Mechanical",
      items: [{
        lineOrder: 1,
        categoryId: "cat-labour",
        category: "Labour",
        entityType: "Labour",
        entityName: "MECH:Trade Labour",
        rateScheduleItemId: "rsi-d516a099",
        // Key order here is the JSON blob's order, not the tier order.
        tierUnits: { "rst-1f1df26d": 10, "rst-bd3f22d9": 40, "rst-f77e654e": 10 },
        quantity: 1,
        uom: "HR",
        cost: 100,
        markup: 0.2,
        price: 120,
      }],
    }],
    phases: [],
    estimate: { totals: {} },
    summaryRows: [],
    adjustments: [],
    conditions: [],
    reportSections: [],
    scheduleTasks: [],
  };
}

test("labour tiers use the tenant's tier names, never the Standard placeholder", () => {
  const data = buildPdfDataPackage(tenantLabourWorkspace());
  const names = data.lineItems[0].unitTiers.map((tier) => tier.name);
  assert.deepEqual(names, ["Regular", "Overtime", "Double Time"]);
  assert.ok(!names.includes("Standard"), "tier names must resolve from the rate schedule");
});

test("labour tiers follow rate schedule sortOrder, not tierUnits key order", () => {
  const data = buildPdfDataPackage(tenantLabourWorkspace());
  assert.deepEqual(
    data.lineItems[0].unitTiers.map((tier) => [tier.name, tier.units]),
    [["Regular", 40], ["Overtime", 10], ["Double Time", 10]],
  );

  const html = generatePdfHtml(data, "backup", {
    sections: {
      coverPage: false, scopeOfWork: false, leadLetter: false, lineItems: true,
      phases: false, conditions: false, terms: false, pricingSummary: false,
      hoursSummary: true, labourSummary: true, notes: false, reportSections: false, schedule: false,
    },
  });
  assert.doesNotMatch(html, /Standard/, "no placeholder tier label reaches the PDF");
  // Summary headers must read left-to-right in tier order.
  const headerOrder = ["Regular", "Overtime (1.5x)", "Double Time (2x)"].map((label) => html.indexOf(label));
  assert.ok(headerOrder.every((position) => position >= 0), `all tier headers render: ${headerOrder}`);
  assert.deepEqual([...headerOrder].sort((a, b) => a - b), headerOrder, "headers ordered by tier sortOrder");
});

test("a multi-tier line renders one compact units cell instead of a stacked row", () => {
  const data = buildPdfDataPackage(tenantLabourWorkspace());
  const html = generatePdfHtml(data, "backup", {
    sections: {
      coverPage: false, scopeOfWork: false, leadLetter: false, lineItems: true,
      phases: false, conditions: false, terms: false, pricingSummary: false,
      hoursSummary: false, labourSummary: false, notes: false, reportSections: false, schedule: false,
    },
  });
  const row = html.slice(html.indexOf("MECH:Trade Labour"));
  const cell = row.slice(0, row.indexOf("</tr>"));
  // The old format stacked "Name: n h" per tier with <br>, tripling row height.
  assert.doesNotMatch(cell, /<br>\s*[^<]*:\s*\d/, "tiers are not stacked one per line");
  assert.match(cell, />40&nbsp;Reg · 10&nbsp;OT · 10&nbsp;DT</, "only the per-tier totals, on one line");
  // The grand total is the sum of what is already shown, and printing it too
  // pushed the cell onto a second line.
  assert.doesNotMatch(cell, /60 h/, "no redundant grand total on a tiered line");
});

test("tierAbbreviation keeps tenant-defined tier names short and distinct", () => {
  assert.equal(tierAbbreviation("Regular"), "Reg");
  assert.equal(tierAbbreviation("Overtime"), "OT");
  assert.equal(tierAbbreviation("Double Time"), "DT");
  // Unknown tenant names still shorten deterministically.
  assert.equal(tierAbbreviation("Night Shift"), "NS");
  assert.equal(tierAbbreviation("Sunday Premium Rate"), "SPR");
  assert.equal(tierAbbreviation("Holiday"), "Hol.");
  assert.equal(tierAbbreviation("Day"), "Day");
  assert.equal(tierAbbreviation(""), "");
});

/** Price Build fixture driven by the pricing ladder (no summary builder). */
function ladderWorkspace(adjustmentRows: any[], grandTotal: number) {
  const pricingLadder = {
    version: 1 as const,
    directCost: 600,
    lineSubtotal: 1000,
    adjustmentTotal: grandTotal - 1000,
    netTotal: grandTotal,
    grandTotal,
    internalProfit: grandTotal - 600,
    internalMargin: 0.4,
    rows: [
      { id: "line_subtotal", label: "Line Sell Subtotal", rowType: "base", financialCategory: "line_subtotal", baseAmount: 1000, value: 1000, cost: 600, margin: 0.4, runningTotal: 1000, affectsTotal: true, visible: true, active: true },
      ...adjustmentRows,
      { id: "grand_total", label: "Customer Total", rowType: "total", financialCategory: "total", baseAmount: grandTotal, value: grandTotal, cost: 600, margin: 0.4, runningTotal: grandTotal, affectsTotal: true, visible: true, active: true },
    ],
  };
  return {
    quote: { quoteNumber: "Q-2", title: "Adjustment Visibility" },
    currentRevision: { revisionNumber: 1, subtotal: grandTotal, cost: 600, totalHours: 0, pricingLadder },
    project: {},
    entityCategories: [],
    rateSchedules: [],
    worksheets: [],
    phases: [],
    estimate: { totals: { pricingLadder } },
    summaryRows: [],
    adjustments: [],
    conditions: [],
    reportSections: [],
    scheduleTasks: [],
  };
}

const adjustmentRow = (id: string, label: string, value: number, visible: boolean) => ({
  id: `adjustment:${id}`, label, rowType: "adjustment", financialCategory: "other",
  baseAmount: 1000, value, cost: 0, margin: 1, runningTotal: 1000 + value,
  affectsTotal: true, visible, active: true,
});

test("a hidden adjustment is absorbed into the rollup instead of being itemized", () => {
  // $1000 of lines + a $100 shown surcharge + a $50 hidden one = $1150.
  const data = buildPdfDataPackage(ladderWorkspace(
    [adjustmentRow("fuel", "Fuel Adjustment", 100, true), adjustmentRow("secret", "Internal Contingency", 50, false)],
    1150,
  ));
  const html = generatePdfHtml(data, "main");

  assert.doesNotMatch(html, /Internal Contingency/, "a hidden adjustment is never named");
  assert.match(html, /Fuel Adjustment/);
  // Rollup carries the hidden $50 so the printed column still reconciles:
  // 1050 + 100 = 1150.
  assert.match(html, /<td>Rollup<\/td><td class="num">\$1,050\.00<\/td>/);
  assert.match(html, /Price Build<\/td><td class="num">\$1,150\.00<\/td>/);
});

test("with no visible adjustments the Price Build prints one total, not a rollup plus total", () => {
  const data = buildPdfDataPackage(ladderWorkspace(
    [adjustmentRow("secret", "Internal Contingency", 50, false)],
    1050,
  ));
  const html = generatePdfHtml(data, "main");

  assert.doesNotMatch(html, /<td>Rollup<\/td>/, "no separate rollup row when it equals the total");
  assert.doesNotMatch(html, /Internal Contingency/);
  assert.match(html, /Price Build<\/td><td class="num">\$1,050\.00<\/td>/, "just the price total");
});

test("a quote with no adjustments at all prints a single Price Build total", () => {
  const data = buildPdfDataPackage(ladderWorkspace([], 1000));
  const html = generatePdfHtml(data, "main");
  assert.doesNotMatch(html, /<td>Rollup<\/td>/);
  assert.match(html, /Price Build<\/td><td class="num">\$1,000\.00<\/td>/);
});

test("the dedicated schedule PDF renders a landscape Gantt instead of a date table", () => {
  const html = generateSchedulePdfHtml(buildSchedulePdfData({
    project: { name: "Plant Outage" },
    quote: { customerName: "Kingdom Construction" },
    currentRevision: { dateWorkStart: "2026-09-01", dateWorkEnd: "2026-09-30" },
    phases: [{ id: "p1", name: "Install", number: "1", color: "#3b82f6" }],
    scheduleTasks: [{
      name: "Set transformer",
      phaseId: "p1",
      startDate: "2026-09-07",
      endDate: "2026-09-18",
      duration: 10,
      progress: 0.4,
      assignee: "Crew A",
      status: "in_progress",
      taskType: "task",
    }],
  }));
  assert.match(html, /class="gantt"/);
  assert.match(html, /class="bar"/);
  assert.match(html, /Set transformer/);
  assert.match(html, /size: landscape/);
});

test("freezeSectionOrder does not backfill default or custom sections", () => {
  const data = buildPdfDataPackage(workspaceFixture());
  const html = generatePdfHtml(data, "main", {
    freezeSectionOrder: true,
    sectionOrder: ["terms"],
    sections: {
      coverPage: false,
      scopeOfWork: false,
      leadLetter: false,
      lineItems: false,
      phases: false,
      conditions: false,
      terms: true,
      pricingSummary: false,
      hoursSummary: false,
      labourSummary: false,
      notes: false,
      reportSections: false,
      schedule: false,
    },
    customSections: [{ id: "extra", title: "Extra Block", content: "Should stay out", order: 0 }],
  });
  assert.doesNotMatch(html, /Scope of Work/);
  assert.doesNotMatch(html, /Extra Block/);
  assert.doesNotMatch(html, /Price Build/);
});
