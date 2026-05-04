import test from "node:test";
import assert from "node:assert/strict";

import type {
  Catalog,
  CatalogItem,
  Dataset,
  DatasetRow,
  RateSchedule,
  RateScheduleItem,
  WorksheetItem,
} from "./models";
import {
  type CostMatcherCandidate,
  matchCostCandidates,
  normalizeCostMatcherCandidates,
  normalizeUnit,
} from "./cost-matcher";

function makeCandidate(
  sourceId: string,
  name: string,
  opts: Partial<CostMatcherCandidate> = {},
): CostMatcherCandidate {
  return {
    id: opts.id ?? `catalog_item:${sourceId}`,
    sourceType: opts.sourceType ?? "catalog_item",
    sourceId,
    name,
    ...opts,
  };
}

test("matchCostCandidates ranks stronger lexical matches first", () => {
  const candidates = [
    makeCandidate("pipe", "Type L Copper Pipe", {
      code: "MAT-COP-PIPE",
      unit: "FT",
      category: "Material",
    }),
    makeCandidate("insulation", "Pipe Insulation", {
      code: "MAT-PIPE-INS",
      unit: "FT",
      category: "Material",
    }),
    makeCandidate("wire", "Copper Building Wire", {
      code: "MAT-COP-WIRE",
      unit: "FT",
      category: "Material",
    }),
  ];

  const results = matchCostCandidates("copper pipe", candidates, { topK: 3 });

  assert.equal(results.length, 3);
  assert.equal(results[0]?.candidate.sourceId, "pipe");
  assert.ok(results[0]!.score > results[1]!.score);
  assert.ok(results[0]!.confidence > 0.8);
  assert.match(results[0]!.reasons.join(" | "), /matched terms: copper, pipe/);
});

test("matchCostCandidates boosts exact unit matches", () => {
  const candidates = [
    makeCandidate("daily-electrician", "Journeyman Electrician", {
      unit: "DAY",
      category: "Labour",
    }),
    makeCandidate("hourly-electrician", "Journeyman Electrician", {
      unit: "HR",
      category: "Labour",
    }),
  ];

  const results = matchCostCandidates(
    { text: "journeyman electrician", unit: "hours" },
    candidates,
    { topK: 2 },
  );

  assert.equal(results[0]?.candidate.sourceId, "hourly-electrician");
  assert.equal(results[0]?.components.unit, 0.16);
  assert.match(results[0]!.reasons.join(" | "), /unit match: HR/);
});

test("matchCostCandidates returns no results for empty queries", () => {
  const candidates = [
    makeCandidate("pipe", "Copper Pipe", {
      unit: "FT",
      category: "Material",
    }),
  ];

  assert.deepEqual(matchCostCandidates("", candidates), []);
  assert.deepEqual(matchCostCandidates("   ", candidates, { topK: 5 }), []);
});

test("matchCostCandidates applies source and category boosts after lexical matching", () => {
  const candidates = [
    makeCandidate("material-crane", "75 Ton Crane", {
      unit: "EA",
      category: "Material",
      sourceLabel: "Material Catalog",
      source: "manual",
    }),
    makeCandidate("equipment-crane", "75 Ton Crane", {
      unit: "DAY",
      category: "Equipment",
      sourceType: "rate_schedule_item",
      sourceLabel: "Rental Equipment Rates",
      source: "revision",
    }),
  ];

  const results = matchCostCandidates(
    { text: "crane", category: "equipment", source: "Rental Equipment Rates" },
    candidates,
    { topK: 2 },
  );

  assert.equal(results[0]?.candidate.sourceId, "equipment-crane");
  assert.equal(results[0]?.components.category, 0.12);
  assert.equal(results[0]?.components.source, 0.1);
  assert.match(results[0]!.reasons.join(" | "), /category match: Equipment/);
  assert.match(results[0]!.reasons.join(" | "), /source match: Rental Equipment Rates/);
});

test("matchCostCandidates keeps topK stable for tied scores", () => {
  const candidates = [
    makeCandidate("a", "Generic Labor"),
    makeCandidate("b", "Generic Labor"),
    makeCandidate("c", "Generic Labor"),
    makeCandidate("d", "Generic Labor"),
  ];

  const first = matchCostCandidates("generic labor", candidates, { topK: 2 });
  const second = matchCostCandidates("generic labor", candidates, { topK: 2 });

  assert.deepEqual(
    first.map((result) => result.candidate.sourceId),
    ["a", "b"],
  );
  assert.deepEqual(
    second.map((result) => result.candidate.sourceId),
    ["a", "b"],
  );
});

test("matchCostCandidates can boost prior and historical candidates", () => {
  const candidates = [
    makeCandidate("new", "Copper Pipe Install", { unit: "FT" }),
    makeCandidate("historical", "Copper Pipe Install", {
      sourceType: "workspace_item",
      unit: "FT",
    }),
  ];

  const results = matchCostCandidates("copper pipe install", candidates, {
    topK: 2,
    historicalMatches: [{ candidateId: "workspace_item:historical", reason: "used on prior estimate" }],
  });

  assert.equal(results[0]?.candidate.sourceId, "historical");
  assert.equal(results[0]?.components.prior, 0.1);
  assert.match(results[0]!.reasons.join(" | "), /historical match: used on prior estimate/);
});

test("normalizeCostMatcherCandidates creates catalog, rate, dataset, and workspace candidates", () => {
  const catalog: Catalog = {
    id: "catalog-material",
    name: "Material Catalog",
    kind: "materials",
    scope: "global",
    projectId: null,
    description: "Standard material costs",
    source: "manual",
    sourceDescription: "Company material book",
    isTemplate: false,
    sourceTemplateId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const catalogItem: CatalogItem = {
    id: "catalog-item-emt",
    catalogId: catalog.id,
    code: "EMT-050",
    name: "1/2 inch EMT Conduit",
    unit: "FT",
    unitCost: 1.2,
    unitPrice: 1.8,
    metadata: { category: "Conduit" },
  };
  const schedule: RateSchedule = {
    id: "schedule-labour",
    organizationId: "org-1",
    name: "Electrical Labour Rates",
    description: "Project labour schedule",
    category: "Labour",
    scope: "revision",
    projectId: "project-1",
    revisionId: "revision-1",
    sourceScheduleId: null,
    travelPolicyId: null,
    effectiveDate: null,
    expiryDate: null,
    defaultMarkup: 0.2,
    autoCalculate: true,
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const rateItem: RateScheduleItem = {
    id: "rate-item-foreman",
    scheduleId: schedule.id,
    catalogItemId: "",
    code: "LAB-FM",
    name: "Electrical Foreman",
    unit: "HR",
    rates: { regular: 125 },
    costRates: { regular: 85 },
    burden: 0.18,
    perDiem: 0,
    metadata: { trade: "Electrical" },
    sortOrder: 0,
  };
  const dataset: Dataset = {
    id: "dataset-electrical-labor",
    cabinetId: null,
    name: "Electrical Labor Units",
    description: "Labour units by conduit class",
    category: "labour_units",
    scope: "global",
    projectId: null,
    columns: [
      { key: "category", name: "Category", type: "text", required: true },
      { key: "class", name: "Class", type: "text", required: true },
      { key: "subClass", name: "Sub-Class", type: "text", required: false },
      { key: "uom", name: "Unit", type: "text", required: true },
      { key: "hourNormal", name: "Hours", type: "number", required: true, unit: "hrs/unit" },
    ],
    rowCount: 1,
    source: "manual",
    sourceDescription: "Company labor unit database",
    isTemplate: false,
    sourceTemplateId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const datasetRow: DatasetRow = {
    id: "dataset-row-emt",
    datasetId: dataset.id,
    data: {
      category: "Conduit",
      class: "EMT",
      subClass: "1 inch",
      uom: "EA",
      hourNormal: 0.3,
    },
    order: 0,
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const workspaceItem: WorksheetItem = {
    id: "workspace-row-1",
    worksheetId: "worksheet-1",
    category: "Material",
    entityType: "Material",
    entityName: "EMT Connector",
    description: "Historical row",
    quantity: 10,
    uom: "EA",
    cost: 2,
    markup: 0.2,
    price: 2.4,
    unit1: 0,
    unit2: 0,
    unit3: 0,
    lineOrder: 0,
  };

  const candidates = normalizeCostMatcherCandidates({
    catalogs: [catalog],
    catalogItems: [catalogItem],
    rateSchedules: [schedule],
    rateScheduleItems: [rateItem],
    datasets: [dataset],
    datasetRows: [datasetRow],
    workspaceItems: [workspaceItem],
  });

  assert.deepEqual(
    candidates.map((candidate) => candidate.sourceType),
    ["catalog_item", "rate_schedule_item", "dataset_row", "workspace_item"],
  );
  assert.equal(candidates[0]?.sourceLabel, "Material Catalog");
  assert.equal(candidates[1]?.unitCost, 85);
  assert.equal(candidates[2]?.name, "Conduit - EMT - 1 inch");
  assert.equal(candidates[3]?.unitPrice, 2.4);

  const results = matchCostCandidates(
    { text: "emt conduit", unit: "each", category: "Conduit" },
    candidates,
    { topK: 1 },
  );

  assert.equal(results[0]?.candidate.sourceType, "dataset_row");
  assert.equal(normalizeUnit(results[0]?.candidate.unit), "ea");
});
