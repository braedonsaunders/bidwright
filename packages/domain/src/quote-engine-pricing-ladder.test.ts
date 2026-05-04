import test from "node:test";
import assert from "node:assert/strict";

import { calculateTotals, computeSummaryRows } from "./quote-engine";
import { createSummaryBuilderPreset, materializeSummaryRowsFromBuilder } from "./summary-builder";
import type { Adjustment, EntityCategory, EstimateFactor, QuoteRevision, Worksheet, WorksheetItem } from "./models";

function revision(): QuoteRevision {
  return {
    id: "rev-test",
    quoteId: "quote-test",
    revisionNumber: 0,
    title: "",
    description: "",
    notes: "",
    breakoutStyle: "grand_total",
    type: "Firm",
    scratchpad: "",
    leadLetter: "",
    dateEstimatedShip: null,
    dateQuote: null,
    dateDue: null,
    dateWalkdown: null,
    dateWorkStart: null,
    dateWorkEnd: null,
    shippingMethod: "",
    shippingTerms: "",
    freightOnBoard: "",
    status: "Open",
    defaultMarkup: 0,
    laborDifficulty: "",
    followUpNote: "",
    printEmptyNotesColumn: false,
    printCategory: [],
    printPhaseTotalOnly: false,
    grandTotal: 0,
    regHours: 0,
    overHours: 0,
    doubleHours: 0,
    breakoutPackage: [],
    calculatedCategoryTotals: [],
    summaryLayoutPreset: "custom",
    pdfPreferences: {},
    pricingLadder: {
      version: 1,
      directCost: 0,
      lineSubtotal: 0,
      adjustmentTotal: 0,
      netTotal: 0,
      grandTotal: 0,
      internalProfit: 0,
      internalMargin: 0,
      rows: [],
    },
    subtotal: 0,
    cost: 0,
    estimatedProfit: 0,
    estimatedMargin: 0,
    totalHours: 0,
    createdAt: "",
    updatedAt: "",
  };
}

function worksheetItem(patch: Partial<WorksheetItem>): WorksheetItem {
  return {
    id: patch.id ?? "item",
    worksheetId: "ws-test",
    phaseId: null,
    category: "Material",
    entityType: "Material",
    entityName: "Pipe",
    vendor: "",
    description: "",
    quantity: 1,
    uom: "EA",
    cost: 600,
    markup: 0,
    price: 1000,
    lineOrder: 0,
    rateScheduleItemId: null,
    itemId: null,
    tierUnits: {},
    sourceNotes: "",
    sourceAssemblyId: null,
    assemblyInstanceId: null,
    ...patch,
  };
}

function adjustment(patch: Partial<Adjustment>): Adjustment {
  return {
    id: patch.id ?? "adj",
    revisionId: "rev-test",
    order: patch.order ?? 0,
    kind: "modifier",
    pricingMode: "modifier",
    name: "Adjustment",
    description: "",
    type: "",
    financialCategory: "other",
    calculationBase: "selected_scope",
    active: true,
    appliesTo: "All",
    percentage: null,
    amount: null,
    show: "Yes",
    ...patch,
  };
}

function estimateFactor(patch: Partial<EstimateFactor>): EstimateFactor {
  return {
    id: patch.id ?? "factor-test",
    revisionId: "rev-test",
    order: patch.order ?? 0,
    name: patch.name ?? "Test Factor",
    code: patch.code ?? "TEST",
    description: patch.description ?? "",
    category: patch.category ?? "Productivity",
    impact: patch.impact ?? "labor_hours",
    value: patch.value ?? 1,
    active: patch.active ?? true,
    appliesTo: patch.appliesTo ?? "Labour",
    applicationScope: patch.applicationScope ?? "global",
    scope: patch.scope ?? { mode: "all" },
    formulaType: patch.formulaType ?? "fixed_multiplier",
    parameters: patch.parameters ?? {},
    confidence: patch.confidence ?? "medium",
    sourceType: patch.sourceType ?? "custom",
    sourceId: patch.sourceId ?? null,
    sourceRef: patch.sourceRef ?? {},
    tags: patch.tags ?? [],
  };
}

function labourCategory(patch: Partial<EntityCategory> = {}): EntityCategory {
  return {
    id: "cat-labour",
    name: "Labour",
    entityType: "Labour",
    shortform: "LAB",
    defaultUom: "HR",
    validUoms: [],
    editableFields: { quantity: true, cost: true, markup: true, price: true, tierUnits: true },
    unitLabels: {},
    calculationType: "tiered_rate",
    calcFormula: "",
    itemSource: "rate_schedule",
    analyticsBucket: "labour",
    color: "",
    order: 0,
    isBuiltIn: true,
    enabled: true,
    ...patch,
  };
}

test("calculateTotals compounds cumulative modifier rows from the running quote total", () => {
  const worksheets: Array<Worksheet & { items: WorksheetItem[] }> = [
    { id: "ws-test", revisionId: "rev-test", name: "Worksheet", order: 0, items: [worksheetItem({})] },
  ];
  const adjustments = [
    adjustment({
      id: "adj-overhead",
      order: 0,
      name: "Overhead",
      financialCategory: "overhead",
      calculationBase: "line_subtotal",
      percentage: 0.1,
    }),
    adjustment({
      id: "adj-profit",
      order: 1,
      name: "Profit",
      financialCategory: "profit",
      calculationBase: "cumulative",
      percentage: 0.1,
    }),
  ];

  const totals = calculateTotals(revision(), worksheets, [], adjustments);

  assert.equal(totals.subtotal, 1210);
  assert.equal(totals.pricingLadder.lineSubtotal, 1000);
  assert.equal(totals.adjustmentTotals.find((entry) => entry.id === "adj-overhead")?.baseAmount, 1000);
  assert.equal(totals.adjustmentTotals.find((entry) => entry.id === "adj-overhead")?.value, 100);
  assert.equal(totals.adjustmentTotals.find((entry) => entry.id === "adj-profit")?.baseAmount, 1100);
  assert.equal(totals.adjustmentTotals.find((entry) => entry.id === "adj-profit")?.value, 110);
  assert.equal(totals.pricingLadder.rows.find((row) => row.id === "grand_total")?.runningTotal, 1210);
});

test("calculateTotals returns resource-style cost breakdowns using analytics buckets", () => {
  const worksheets: Array<Worksheet & { items: WorksheetItem[] }> = [
    {
      id: "ws-test",
      revisionId: "rev-test",
      name: "Worksheet",
      order: 0,
      items: [
        worksheetItem({ id: "mat", category: "Material", entityType: "Material", entityName: "Pipe", quantity: 2, cost: 50, price: 140 }),
        worksheetItem({ id: "lab", category: "Labour", entityType: "LaborClass", entityName: "Foreman", quantity: 3, cost: 80, price: 360 }),
      ],
    },
  ];
  const categories: EntityCategory[] = [
    { id: "cat-material", name: "Material", entityType: "Material", shortform: "MAT", defaultUom: "EA", validUoms: [], editableFields: { quantity: true, cost: true, markup: true, price: true, tierUnits: false }, unitLabels: {}, calculationType: "unit_markup", calcFormula: "", itemSource: "catalog", analyticsBucket: "material", color: "", order: 0, isBuiltIn: true, enabled: true },
    { id: "cat-labour", name: "Labour", entityType: "LaborClass", shortform: "LAB", defaultUom: "HR", validUoms: [], editableFields: { quantity: true, cost: true, markup: true, price: true, tierUnits: true }, unitLabels: {}, calculationType: "tiered_rate", calcFormula: "", itemSource: "rate_schedule", analyticsBucket: "labour", color: "", order: 1, isBuiltIn: true, enabled: true },
  ];

  const totals = calculateTotals(revision(), worksheets, [], [], [], categories);

  assert.deepEqual(
    totals.costBreakdown.map((entry) => ({ type: entry.type, cost: entry.cost, value: entry.value, itemCount: entry.itemCount })),
    [
      { type: "labour", cost: 240, value: 360, itemCount: 1 },
      { type: "material", cost: 100, value: 140, itemCount: 1 },
    ],
  );
});

test("calculateTotals applies scoped estimate factors before quote rollups", () => {
  const worksheets: Array<Worksheet & { items: WorksheetItem[] }> = [
    {
      id: "ws-test",
      revisionId: "rev-test",
      name: "Worksheet",
      order: 0,
      items: [
        worksheetItem({ id: "labour", category: "Labour", entityType: "Labour", entityName: "Electrician", price: 1000, cost: 600, tierUnits: { "tier-reg": 10 }, rateScheduleItemId: "rate-test" }),
        worksheetItem({ id: "material", category: "Material", entityType: "Material", entityName: "Wire", price: 500, cost: 300, tierUnits: {} }),
      ],
    },
  ];
  const categories: EntityCategory[] = [
    { id: "cat-material", name: "Material", entityType: "Material", shortform: "MAT", defaultUom: "EA", validUoms: [], editableFields: { quantity: true, cost: true, markup: true, price: true, tierUnits: false }, unitLabels: {}, calculationType: "unit_markup", calcFormula: "", itemSource: "catalog", analyticsBucket: "material", color: "", order: 0, isBuiltIn: true, enabled: true },
    { id: "cat-labour", name: "Labour", entityType: "Labour", shortform: "LAB", defaultUom: "HR", validUoms: [], editableFields: { quantity: true, cost: true, markup: true, price: true, tierUnits: true }, unitLabels: {}, calculationType: "tiered_rate", calcFormula: "", itemSource: "rate_schedule", analyticsBucket: "labour", color: "", order: 1, isBuiltIn: true, enabled: true },
  ];

  const totals = calculateTotals(revision(), worksheets, [], [], [], categories, null, [
    estimateFactor({
      id: "winter",
      name: "Winter weather",
      impact: "labor_hours",
      value: 1.1,
      scope: { mode: "category", analyticsBuckets: ["labour", "labor"] },
      sourceType: "knowledge",
      sourceRef: { basis: "Book-backed weather productivity factor" },
    }),
  ]);

  assert.equal(totals.lineSubtotalBeforeFactors, 1500);
  assert.equal(totals.totalHoursBeforeFactors, 10);
  assert.equal(totals.subtotal, 1600);
  assert.equal(totals.totalHours, 11);
  assert.equal(totals.factorTotals.length, 1);
  assert.equal(totals.factorTotals[0].targetCount, 1);
  assert.equal(totals.factorTotals[0].valueDelta, 100);
  assert.ok(totals.pricingLadder.rows.some((row) => row.rowType === "factor" && row.sourceFactorId === "winter"));
});

test("calculateTotals applies explicit line factors only to targeted worksheet rows", () => {
  const categories = [labourCategory()];
  const worksheets: Array<Worksheet & { items: WorksheetItem[] }> = [
    {
      id: "ws-test",
      revisionId: "rev-test",
      name: "Worksheet",
      order: 0,
      items: [
        worksheetItem({ id: "target", category: "Labour", entityType: "Labour", entityName: "Target", price: 1000, cost: 600, tierUnits: { "tier-reg": 10 }, rateScheduleItemId: "rate-test" }),
        worksheetItem({ id: "other", category: "Labour", entityType: "Labour", entityName: "Other", price: 1000, cost: 600, tierUnits: { "tier-reg": 10 }, rateScheduleItemId: "rate-test" }),
      ],
    },
  ];

  const totals = calculateTotals(revision(), worksheets, [], [], [], categories, null, [
    estimateFactor({
      id: "line-factor",
      value: 1.2,
      applicationScope: "line",
      scope: { mode: "line", worksheetItemIds: ["target"] },
    }),
  ]);

  assert.equal(totals.subtotal, 2200);
  assert.equal(totals.totalHours, 22);
  assert.equal(totals.factorTotals[0].targetCount, 1);
  assert.deepEqual(totals.factorTotals[0].targetLineItemIds, ["target"]);
  assert.equal(totals.adjustedLineItems.find((item) => item.id === "target")?.price, 1200);
  assert.equal(totals.adjustedLineItems.find((item) => item.id === "other")?.price, 1000);
});

test("calculateTotals computes parameterized condition score sheet factors", () => {
  const categories = [labourCategory()];
  const worksheets: Array<Worksheet & { items: WorksheetItem[] }> = [
    { id: "ws-test", revisionId: "rev-test", name: "Worksheet", order: 0, items: [worksheetItem({ id: "labour", category: "Labour", entityType: "Labour", price: 1000, cost: 600, tierUnits: { "tier-reg": 10 }, rateScheduleItemId: "rate-test" })] },
  ];
  const criteria = Array.from({ length: 35 }, (_, index) => ({ condition: `Condition ${index + 1}`, score: index < 20 ? 4 : 0 }));

  const totals = calculateTotals(revision(), worksheets, [], [], [], categories, null, [
    estimateFactor({
      id: "condition-score-sheet",
      value: 1,
      formulaType: "neca_condition_score",
      parameters: { criteria },
    }),
  ]);

  assert.equal(totals.factorTotals[0].value, 1.15);
  assert.equal(totals.subtotal, 1150);
});

test("calculateTotals composes individual labor condition score factors", () => {
  const categories = [labourCategory()];
  const worksheets: Array<Worksheet & { items: WorksheetItem[] }> = [
    { id: "ws-test", revisionId: "rev-test", name: "Worksheet", order: 0, items: [worksheetItem({ id: "labour", category: "Labour", entityType: "Labour", price: 1000, cost: 600, tierUnits: { "tier-reg": 10 }, rateScheduleItemId: "rate-test" })] },
  ];

  const totals = calculateTotals(revision(), worksheets, [], [], [], categories, null, [
    estimateFactor({
      id: "working-height",
      value: 1,
      formulaType: "condition_score",
      parameters: { score: 5, maxScore: 5, calibrationTotalScore: 175, calibrationMultiplier: 1.3 },
    }),
    estimateFactor({
      id: "crew-density",
      value: 1,
      formulaType: "condition_score",
      parameters: { score: 5, maxScore: 5, calibrationTotalScore: 175, calibrationMultiplier: 1.3 },
    }),
  ]);

  assert.equal(totals.factorTotals.length, 2);
  assert.ok(totals.subtotal > 1000);
  assert.ok(totals.subtotal < 1020);
});

test("calculateTotals builds MasterFormat division and section rollups", () => {
  const worksheets: Array<Worksheet & { items: WorksheetItem[] }> = [
    {
      id: "ws-test",
      revisionId: "rev-test",
      name: "Worksheet",
      order: 0,
      items: [
        worksheetItem({ id: "cip", entityName: "Cast-in-place concrete", price: 100, classification: { masterformat: "03 30 00" } }),
        worksheetItem({ id: "precast", entityName: "Precast concrete", price: 200, classification: { masterformat: "03 40 00" } }),
        worksheetItem({ id: "electrical", entityName: "Panelboard", price: 300, classification: { masterformat: "26 24 16" } }),
        worksheetItem({ id: "misc", entityName: "Uncoded item", price: 50 }),
      ],
    },
  ];

  const divisionTotals = calculateTotals(revision(), worksheets, [], [], [], [], {
    classification: { standard: "masterformat", level: "division", includeUnclassified: true },
  });
  const byDivision = new Map(divisionTotals.classificationTotals.map((entry) => [entry.id, entry]));

  assert.equal(byDivision.get("masterformat:division:03")?.label, "03 - Concrete");
  assert.equal(byDivision.get("masterformat:division:03")?.value, 300);
  assert.equal(byDivision.get("masterformat:division:26")?.value, 300);
  assert.equal(byDivision.get("masterformat:division:__unclassified__")?.value, 50);

  const sectionTotals = calculateTotals(revision(), worksheets, [], [], [], [], {
    classification: { standard: "masterformat", level: "section", includeUnclassified: true },
  });
  const bySection = new Map(sectionTotals.classificationTotals.map((entry) => [entry.id, entry]));

  assert.equal(bySection.get("masterformat:section:03_30_00")?.value, 100);
  assert.equal(bySection.get("masterformat:section:03_40_00")?.value, 200);
});

test("calculateTotals builds standard classification division rollups beyond MasterFormat", () => {
  const worksheets: Array<Worksheet & { items: WorksheetItem[] }> = [
    {
      id: "ws-test",
      revisionId: "rev-test",
      name: "Worksheet",
      order: 0,
      items: [
        worksheetItem({
          id: "shell-primary",
          entityName: "Exterior enclosure",
          price: 100,
          classification: {
            uniformat: "B2010",
            omniclass: "21-02 10 20",
            uniclass: "Ss_25_10",
            din276: "334",
            nrm: "2.1.1",
            icms: "1.01",
          },
        }),
        worksheetItem({
          id: "shell-secondary",
          entityName: "Exterior openings",
          price: 50,
          classification: {
            uniformat: { code: "B2020", label: "Exterior Windows" },
            omniclass: "21-03",
            uniclass: "Ss_25_20",
            din276: "342",
            nrm: "2.2",
            icms: "1.02",
          },
        }),
      ],
    },
  ];

  const uniformatTotals = calculateTotals(revision(), worksheets, [], [], [], [], {
    classification: { standard: "uniformat", level: "division", includeUnclassified: false },
  });
  const uniformatByDivision = new Map(uniformatTotals.classificationTotals.map((entry) => [entry.id, entry]));
  assert.equal(uniformatByDivision.get("uniformat:division:b")?.label, "B - Shell");
  assert.equal(uniformatByDivision.get("uniformat:division:b")?.value, 150);

  const standardCases = [
    { standard: "omniclass" as const, id: "omniclass:division:21", label: "21 - OmniClass" },
    { standard: "uniclass" as const, id: "uniclass:division:ss", label: "Ss - Uniclass" },
    { standard: "din276" as const, id: "din276:division:300", label: "300 - Bauwerk - Baukonstruktionen" },
    { standard: "nrm" as const, id: "nrm:division:2", label: "2 - NRM" },
    { standard: "icms" as const, id: "icms:division:1", label: "1 - ICMS" },
  ];

  for (const entry of standardCases) {
    const totals = calculateTotals(revision(), worksheets, [], [], [], [], {
      classification: { standard: entry.standard, level: "division", includeUnclassified: false },
    });
    const byDivision = new Map(totals.classificationTotals.map((total) => [total.id, total]));
    assert.equal(byDivision.get(entry.id)?.label, entry.label);
    assert.equal(byDivision.get(entry.id)?.value, 150);
  }
});

test("summary builder materializes classification rows as live computed rows", () => {
  const worksheets: Array<Worksheet & { items: WorksheetItem[] }> = [
    {
      id: "ws-test",
      revisionId: "rev-test",
      name: "Worksheet",
      order: 0,
      items: [
        worksheetItem({ id: "cip", price: 100, classification: { masterformat: "03 30 00" } }),
        worksheetItem({ id: "precast", price: 200, classification: { masterformat: "03 40 00" } }),
      ],
    },
  ];
  const totals = calculateTotals(revision(), worksheets, [], [], [], [], {
    classification: { standard: "masterformat", level: "division", includeUnclassified: true },
  });
  const builder = createSummaryBuilderPreset("by_masterformat_division", totals);
  const materialized = materializeSummaryRowsFromBuilder(builder, totals).map((row, index) => ({
    ...row,
    id: `row-${index}`,
    revisionId: "rev-test",
    computedValue: 0,
    computedCost: 0,
    computedMargin: 0,
  }));
  const computed = computeSummaryRows(materialized, totals);

  const concrete = computed.find((row) => row.sourceClassificationId === "masterformat:division:03");
  assert.equal(concrete?.type, "classification");
  assert.equal(concrete?.computedValue, 300);
  assert.equal(computed.find((row) => row.type === "subtotal")?.computedValue, 300);
});
