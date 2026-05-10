import test from "node:test";
import assert from "node:assert/strict";

import {
  type EstimateValidationWorkspaceLike,
  validateEstimateWorkspace,
} from "./estimate-validation";

const labourCategory = {
  name: "Labour",
  entityType: "Labour",
  itemSource: "rate_schedule",
  calculationType: "hours",
  validUoms: ["HR"],
};

const materialCategory = {
  name: "Material",
  entityType: "Material",
  itemSource: "catalog",
  calculationType: "quantity",
  validUoms: ["EA", "SF"],
};

function baseWorkspace(overrides: Partial<EstimateValidationWorkspaceLike> = {}): EstimateValidationWorkspaceLike {
  return {
    entityCategories: [labourCategory, materialCategory],
    rateScheduleItems: [{ id: "rsi-electrician", name: "Electrician" }],
    rateScheduleTiers: [{ id: "tier-reg", name: "Regular" }],
    worksheets: [
      {
        id: "ws-1",
        name: "Electrical",
        items: [
          {
            id: "li-1",
            worksheetId: "ws-1",
            category: "Labour",
            entityType: "Labour",
            entityName: "Electrician",
            description: "Install devices",
            quantity: 1,
            uom: "HR",
            cost: 80,
            price: 120,
            rateScheduleItemId: "rsi-electrician",
            tierUnits: { "tier-reg": 8 },
            sourceNotes: "Foreman review, sheet E-101.",
          },
        ],
      },
    ],
    estimateStrategy: {
      id: "strategy-1",
      packagePlan: [
        {
          id: "pkg-electrical",
          name: "Electrical",
          pricingMode: "detailed",
          bindings: { worksheetIds: ["ws-1"] },
        },
      ],
    },
    ...overrides,
  };
}

test("validateEstimateWorkspace returns a clean score for a linked workspace", () => {
  const result = validateEstimateWorkspace(baseWorkspace());

  assert.equal(result.isValid, true);
  assert.equal(result.issues.length, 0);
  assert.equal(result.score.value, 100);
  assert.ok(result.summary.passedRuleIds.includes("rate_schedule.linkage.invalid_rate_schedule_payload"));
});

test("default rules flag missing worksheets and items", () => {
  const result = validateEstimateWorkspace({ worksheets: [], entityCategories: [] });
  const ruleIds = result.issues.map((issue) => issue.ruleId);

  assert.equal(result.isValid, false);
  assert.ok(ruleIds.includes("estimate.structure.missing_worksheets_or_items"));
  assert.equal(result.summary.bySeverity.critical, 1);
  assert.equal(result.summary.bySeverity.error, 1);
});

test("default rules flag zero pricing, missing source notes, and duplicate signatures", () => {
  const item = {
    category: "Material",
    entityType: "Material",
    entityName: "Panelboard",
    description: "Distribution panel",
    quantity: 2,
    uom: "EA",
    cost: 0,
    price: 0,
  };
  const result = validateEstimateWorkspace(baseWorkspace({
    worksheets: [
      {
        id: "ws-1",
        name: "Materials",
        items: [
          { ...item, id: "li-1", worksheetId: "ws-1" },
          { ...item, id: "li-2", worksheetId: "ws-1" },
        ],
      },
    ],
    estimateStrategy: {
      packagePlan: [{ id: "pkg-material", name: "Material", bindings: { worksheetIds: ["ws-1"] } }],
    },
  }));
  const ruleIds = new Set(result.issues.map((issue) => issue.ruleId));

  assert.equal(result.isValid, false);
  assert.ok(ruleIds.has("worksheet.pricing.zero_cost_or_price"));
  assert.ok(ruleIds.has("worksheet.evidence.missing_source_notes"));
  assert.ok(ruleIds.has("worksheet.consistency.duplicate_item_signature"));
});

test("default rules validate rate schedule IDs, tier payloads, and quantity multiplication risk", () => {
  const result = validateEstimateWorkspace(baseWorkspace({
    worksheets: [
      {
        id: "ws-1",
        name: "Labour",
        items: [
          {
            id: "li-1",
            worksheetId: "ws-1",
            category: "Labour",
            entityType: "Labour",
            entityName: "Electrician",
            description: "Rough-in",
            quantity: 3,
            uom: "HR",
            cost: 80,
            price: 120,
            rateScheduleItemId: "missing-rsi",
            tierUnits: { "tier-reg": 30, "missing-tier": -1 },
            sourceNotes: "Crew plan.",
          },
        ],
      },
    ],
    estimateStrategy: {
      packagePlan: [{ id: "pkg-labour", name: "Labour", bindings: { categories: ["Labour"] } }],
    },
  }));
  const ruleIds = new Set(result.issues.map((issue) => issue.ruleId));

  assert.equal(result.isValid, false);
  assert.ok(ruleIds.has("rate_schedule.linkage.invalid_rate_schedule_payload"));
  assert.ok(ruleIds.has("rate_schedule.hours.suspicious_tier_quantity_multiplication"));
  assert.ok(result.issues.some((issue) => issue.message.includes("unknown rateScheduleItemId")));
  assert.ok(result.issues.some((issue) => issue.message.includes("unknown tier")));
});

test("default rules flag missing package bindings and takeoff evidence links", () => {
  const result = validateEstimateWorkspace(baseWorkspace({
    worksheets: [
      {
        id: "ws-1",
        name: "Architectural",
        items: [
          {
            id: "li-1",
            worksheetId: "ws-1",
            category: "Material",
            entityType: "Material",
            entityName: "Drywall",
            description: "Area takeoff from sheets",
            quantity: 125.5,
            uom: "SF",
            cost: 2,
            price: 3,
            sourceNotes: "Area takeoff from A-201.",
          },
        ],
      },
    ],
    estimateStrategy: {
      packagePlan: [{ id: "pkg-empty", name: "Unbound package", bindings: {} }],
    },
  }));
  const ruleIds = new Set(result.issues.map((issue) => issue.ruleId));

  assert.equal(result.isValid, false);
  assert.ok(ruleIds.has("strategy.package_plan.missing_bindings"));
  assert.ok(ruleIds.has("worksheet.evidence.missing_takeoff_or_model_links"));
});

test("takeoff-driven quantities pass when linked at workspace level", () => {
  const result = validateEstimateWorkspace(baseWorkspace({
    worksheets: [
      {
        id: "ws-1",
        name: "Architectural",
        items: [
          {
            id: "li-1",
            worksheetId: "ws-1",
            category: "Material",
            entityType: "Material",
            entityName: "Drywall",
            description: "Area takeoff from sheets",
            quantity: 125.5,
            uom: "SF",
            cost: 2,
            price: 3,
            sourceNotes: "Area takeoff from A-201.",
          },
        ],
      },
    ],
    estimateStrategy: {
      packagePlan: [{ id: "pkg-arch", name: "Architectural", bindings: { worksheetIds: ["ws-1"] } }],
    },
    takeoffLinks: [{ id: "tol-1", worksheetItemId: "li-1" }],
  }));

  assert.equal(
    result.issues.some((issue) => issue.ruleId === "worksheet.evidence.missing_takeoff_or_model_links"),
    false,
  );
});

test("default rules flag stale pricing and low confidence basis", () => {
  const result = validateEstimateWorkspace(baseWorkspace({
    validationDate: "2026-05-01T00:00:00.000Z",
    worksheets: [
      {
        id: "ws-1",
        name: "Materials",
        items: [
          {
            id: "li-1",
            worksheetId: "ws-1",
            category: "Material",
            entityType: "Material",
            entityName: "Switchgear",
            description: "Vendor budget carry",
            quantity: 1,
            uom: "EA",
            cost: 5000,
            price: 6500,
            sourceNotes: "Budget from supplier.",
            pricingUpdatedAt: "2025-07-01T00:00:00.000Z",
            confidence: 0.32,
          },
        ],
      },
    ],
    estimateStrategy: {
      packagePlan: [{ id: "pkg-material", name: "Material", bindings: { worksheetIds: ["ws-1"] } }],
    },
  }));
  const ruleIds = new Set(result.issues.map((issue) => issue.ruleId));

  assert.equal(result.isValid, false);
  assert.ok(ruleIds.has("worksheet.pricing.stale_price_basis"));
  assert.ok(ruleIds.has("worksheet.evidence.low_confidence_basis"));
  assert.ok(result.issues.some((issue) => issue.message.includes("304 days old")));
});

test("takeoff-driven rows require direct quantity evidence, not generic citations", () => {
  const result = validateEstimateWorkspace(baseWorkspace({
    worksheets: [
      {
        id: "ws-1",
        name: "Architectural",
        items: [
          {
            id: "li-1",
            worksheetId: "ws-1",
            category: "Material",
            entityType: "Material",
            entityName: "Floor finish",
            description: "Area takeoff from sheets",
            quantity: 320,
            uom: "SF",
            cost: 8,
            price: 12,
            sourceNotes: "Sheet A-201.",
          },
        ],
      },
    ],
    estimateStrategy: {
      packagePlan: [{ id: "pkg-arch", name: "Architectural", bindings: { worksheetIds: ["ws-1"] } }],
    },
    evidenceLinks: [{ id: "ev-1", worksheetItemId: "li-1", kind: "document_page" }],
  }));

  assert.ok(
    result.issues.some((issue) => issue.ruleId === "worksheet.evidence.missing_takeoff_or_model_links"),
  );
});

test("assembly-backed rows validate resource type and total alignment", () => {
  const result = validateEstimateWorkspace(baseWorkspace({
    worksheets: [
      {
        id: "ws-1",
        name: "Assemblies",
        items: [
          {
            id: "li-1",
            worksheetId: "ws-1",
            category: "Labour",
            entityType: "Labour",
            entityName: "Fixture rough-in assembly",
            description: "Assembly inserted from library",
            quantity: 4,
            uom: "EA",
            cost: 100,
            price: 150,
            sourceNotes: "Assembly A-roughin.",
            sourceAssemblyId: "asm-roughin",
            resourceComposition: {
              unitCost: 80,
              unitPrice: 120,
              resources: [
                {
                  id: "res-material",
                  type: "material",
                  name: "Device box",
                  quantityPerUnit: 2,
                  unitCost: 20,
                  unitPrice: 30,
                },
              ],
            },
          },
        ],
      },
    ],
    estimateStrategy: {
      packagePlan: [{ id: "pkg-asm", name: "Assemblies", bindings: { worksheetIds: ["ws-1"] } }],
    },
  }));

  const issues = result.issues.filter((issue) => issue.ruleId === "worksheet.assembly.resource_mismatch");
  assert.equal(issues.length, 2);
  assert.ok(issues.some((issue) => issue.message.includes("categorized as labor")));
  assert.ok(issues.some((issue) => issue.message.includes("do not match")));
});

test("price variance rule flags benchmark outliers and below-cost pricing", () => {
  const result = validateEstimateWorkspace(baseWorkspace({
    worksheets: [
      {
        id: "ws-1",
        name: "Materials",
        items: [
          {
            id: "li-1",
            worksheetId: "ws-1",
            category: "Material",
            entityType: "Material",
            entityName: "Disconnect",
            description: "Quoted disconnect",
            quantity: 1,
            uom: "EA",
            cost: 1200,
            price: 900,
            sourceNotes: "Vendor quote.",
            metadata: {
              benchmarkUnitCost: 600,
              benchmarkUnitPrice: 500,
            },
          },
        ],
      },
    ],
    estimateStrategy: {
      packagePlan: [{ id: "pkg-material", name: "Material", bindings: { worksheetIds: ["ws-1"] } }],
    },
  }));
  const issues = result.issues.filter((issue) => issue.ruleId === "worksheet.pricing.price_variance_outlier");

  assert.equal(issues.length, 3);
  assert.ok(issues.some((issue) => issue.severity === "error" && issue.message.includes("below unit cost")));
  assert.ok(issues.some((issue) => issue.message.includes("Cost")));
  assert.ok(issues.some((issue) => issue.message.includes("Price")));
});
