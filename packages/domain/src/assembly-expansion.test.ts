import test from "node:test";
import assert from "node:assert/strict";

import {
  type AssemblyDefinition,
  type CatalogItemRef,
  type EffectiveCostRef,
  type ExpansionContext,
  type RateScheduleItemRef,
  evalExpression,
  expandAssembly,
  findAssemblyCycles,
  summarizeExpandedAssemblyResources,
} from "./assembly-expansion";

// ── Expression evaluator tests ────────────────────────────────────────────

test("evalExpression handles literal numbers", () => {
  assert.equal(evalExpression("42", {}), 42);
  assert.equal(evalExpression("3.14", {}), 3.14);
  assert.equal(evalExpression("0", {}), 0);
  assert.equal(evalExpression("", {}), 0);
});

test("evalExpression handles arithmetic with precedence", () => {
  assert.equal(evalExpression("2 + 3 * 4", {}), 14);
  assert.equal(evalExpression("(2 + 3) * 4", {}), 20);
  assert.equal(evalExpression("10 - 4 - 2", {}), 4);
  assert.equal(evalExpression("12 / 4 / 3", {}), 1);
  assert.equal(evalExpression("-5 + 3", {}), -2);
});

test("evalExpression resolves identifiers from scope", () => {
  assert.equal(evalExpression("wallHeight * 2", { wallHeight: 8 }), 16);
  assert.equal(
    evalExpression("length * width", { length: 12, width: 5 }),
    60,
  );
});

test("evalExpression supports built-in functions", () => {
  assert.equal(evalExpression("ceil(7.2)", {}), 8);
  assert.equal(evalExpression("floor(7.9)", {}), 7);
  assert.equal(evalExpression("max(2, 5, 3)", {}), 5);
  assert.equal(evalExpression("min(2, 5, 3)", {}), 2);
  assert.equal(evalExpression("ceil(area / 32)", { area: 100 }), 4);
});

test("evalExpression rejects unknown identifiers", () => {
  assert.throws(() => evalExpression("foo", {}), /Unknown identifier "foo"/);
});

test("evalExpression rejects unknown functions", () => {
  assert.throws(() => evalExpression("nope(1)", {}), /Unknown function "nope"/);
});

test("evalExpression rejects division by zero", () => {
  assert.throws(() => evalExpression("5 / 0", {}), /Division by zero/);
});

test("evalExpression rejects malformed input", () => {
  assert.throws(() => evalExpression("(1 + 2", {}), /Expected '\)'/);
  assert.throws(() => evalExpression("1 + ", {}), /Expected number|Unexpected/);
});

// ── Expansion engine tests ────────────────────────────────────────────────

function makeContext(opts: {
  assemblies?: AssemblyDefinition[];
  catalogItems?: CatalogItemRef[];
  rateScheduleItems?: RateScheduleItemRef[];
  effectiveCosts?: EffectiveCostRef[];
}): ExpansionContext {
  return {
    assemblies: new Map((opts.assemblies ?? []).map((a) => [a.id, a])),
    catalogItems: new Map((opts.catalogItems ?? []).map((c) => [c.id, c])),
    rateScheduleItems: new Map((opts.rateScheduleItems ?? []).map((r) => [r.id, r])),
    effectiveCosts: new Map((opts.effectiveCosts ?? []).map((c) => [c.id, c])),
  };
}

test("expandAssembly emits a leaf item for a simple catalog component", () => {
  const ctx = makeContext({
    assemblies: [
      {
        id: "asm-1",
        name: "Drywall Patch Kit",
        parameters: [],
        components: [
          {
            id: "c1",
            componentType: "catalog_item",
            catalogItemId: "ci-drywall",
            quantityExpr: "2",
          },
        ],
      },
    ],
    catalogItems: [
      {
        id: "ci-drywall",
        code: "DW-58",
        name: "5/8 Drywall Sheet",
        unit: "SHT",
        unitCost: 12.5,
        unitPrice: 18,
      },
    ],
  });

  const { items, warnings } = expandAssembly("asm-1", 1, {}, ctx);

  assert.equal(warnings.length, 0);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.entityName, "5/8 Drywall Sheet");
  assert.equal(items[0]!.quantity, 2);
  assert.equal(items[0]!.unitCost, 12.5);
  assert.equal(items[0]!.uom, "SHT");
});

test("expandAssembly emits a leaf item for a cost intelligence component", () => {
  const ctx = makeContext({
    assemblies: [
      {
        id: "asm-cost",
        name: "Vendor-priced conduit kit",
        parameters: [{ key: "runs", defaultValue: "3" }],
        components: [
          {
            id: "c1",
            componentType: "cost_intelligence",
            effectiveCostId: "ecost-conduit",
            quantityExpr: "runs * 10",
            markupOverride: 0.15,
          },
        ],
      },
    ],
    effectiveCosts: [
      {
        id: "ecost-conduit",
        resourceId: "rci-conduit",
        catalogItemId: "ci-conduit",
        code: "EMT-34",
        name: "3/4 in EMT conduit",
        description: "Vendor observed 3/4 in EMT conduit",
        category: "Material",
        resourceType: "material",
        defaultUom: "LF",
        uom: "LF",
        unitCost: 1.75,
        unitPrice: null,
        vendorName: "North Supply",
        method: "latest_observation",
        effectiveDate: "2026-05-01",
        confidence: 0.82,
      },
    ],
  });

  const { items, warnings } = expandAssembly("asm-cost", 2, {}, ctx);

  assert.equal(warnings.length, 0);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.componentType, "cost_intelligence");
  assert.equal(items[0]!.effectiveCostId, "ecost-conduit");
  assert.equal(items[0]!.costResourceId, "rci-conduit");
  assert.equal(items[0]!.catalogItemId, "ci-conduit");
  assert.equal(items[0]!.entityName, "3/4 in EMT conduit");
  assert.equal(items[0]!.quantity, 60);
  assert.equal(items[0]!.unitCost, 1.75);
  assert.equal(items[0]!.unitPrice, 1.75);
  assert.equal(items[0]!.vendor, "North Supply");

  const rollup = summarizeExpandedAssemblyResources(items);
  assert.equal(rollup.length, 1);
  assert.equal(rollup[0]!.componentType, "cost_intelligence");
  assert.equal(rollup[0]!.lineCost, 105);
  assert.equal(rollup[0]!.linePrice, 120.75);
});

test("expandAssembly applies the outer quantity multiplier", () => {
  const ctx = makeContext({
    assemblies: [
      {
        id: "asm-1",
        name: "Per-LF Wall",
        parameters: [],
        components: [
          {
            id: "c1",
            componentType: "catalog_item",
            catalogItemId: "ci-stud",
            quantityExpr: "2",
          },
        ],
      },
    ],
    catalogItems: [
      { id: "ci-stud", name: "2x4 Stud", unit: "EA", unitCost: 4, unitPrice: 6 },
    ],
  });

  const { items } = expandAssembly("asm-1", 10, {}, ctx);
  assert.equal(items[0]!.quantity, 20);
});

test("expandAssembly resolves parameterised quantity expressions", () => {
  const ctx = makeContext({
    assemblies: [
      {
        id: "asm-wall",
        name: "Stud Wall (per LF)",
        parameters: [
          { key: "wallHeight", defaultValue: "8" },
          { key: "studSpacing", defaultValue: "16" },
        ],
        components: [
          {
            id: "c1",
            componentType: "catalog_item",
            catalogItemId: "ci-stud",
            quantityExpr: "ceil(12 / (studSpacing / 12)) + 1",
          },
        ],
      },
    ],
    catalogItems: [
      { id: "ci-stud", name: "2x4 Stud", unit: "EA", unitCost: 4, unitPrice: 6 },
    ],
  });

  const { items, warnings } = expandAssembly("asm-wall", 1, {}, ctx);

  assert.equal(warnings.length, 0);
  // 12 LF / 1.333 ft per stud = 9 → ceil(9) = 9 → + 1 = 10
  assert.equal(items[0]!.quantity, 10);
});

test("expandAssembly applies parameter overrides", () => {
  const ctx = makeContext({
    assemblies: [
      {
        id: "asm-wall",
        name: "Stud Wall",
        parameters: [{ key: "studSpacing", defaultValue: "16" }],
        components: [
          {
            id: "c1",
            componentType: "catalog_item",
            catalogItemId: "ci-stud",
            quantityExpr: "ceil(12 / (studSpacing / 12)) + 1",
          },
        ],
      },
    ],
    catalogItems: [
      { id: "ci-stud", name: "2x4 Stud", unit: "EA", unitCost: 4, unitPrice: 6 },
    ],
  });

  const tightSpacing = expandAssembly("asm-wall", 1, { studSpacing: 12 }, ctx);
  // 12 LF / 1 ft = 12 → +1 = 13
  assert.equal(tightSpacing.items[0]!.quantity, 13);

  const stringOverride = expandAssembly("asm-wall", 1, { studSpacing: "12" }, ctx);
  assert.equal(stringOverride.items[0]!.quantity, 13);
});

test("expandAssembly recurses into nested sub-assemblies with bindings", () => {
  const ctx = makeContext({
    assemblies: [
      {
        id: "asm-stud-pack",
        name: "Stud Pack",
        parameters: [{ key: "count", defaultValue: "1" }],
        components: [
          {
            id: "c1",
            componentType: "catalog_item",
            catalogItemId: "ci-stud",
            quantityExpr: "count",
          },
        ],
      },
      {
        id: "asm-wall",
        name: "Wall (per LF)",
        parameters: [{ key: "studsPerLf", defaultValue: "1" }],
        components: [
          {
            id: "c1",
            componentType: "sub_assembly",
            subAssemblyId: "asm-stud-pack",
            quantityExpr: "1",
            parameterBindings: { count: "studsPerLf" },
          },
        ],
      },
    ],
    catalogItems: [
      { id: "ci-stud", name: "2x4 Stud", unit: "EA", unitCost: 4, unitPrice: 6 },
    ],
  });

  const { items, warnings } = expandAssembly("asm-wall", 10, { studsPerLf: 0.75 }, ctx);

  assert.equal(warnings.length, 0);
  assert.equal(items.length, 1);
  // outer quantity 10, sub-assembly multiplier 1, stud-pack count = studsPerLf = 0.75
  // -> stud quantity = 0.75 * 1 * 10 = 7.5
  assert.equal(items[0]!.quantity, 7.5);
  assert.deepEqual(items[0]!.componentPath, ["Wall (per LF)", "Stud Pack"]);
});

test("expandAssembly evaluates rate-schedule labour components with overrides", () => {
  const ctx = makeContext({
    assemblies: [
      {
        id: "asm-1",
        name: "Hang Drywall",
        parameters: [],
        components: [
          {
            id: "c1",
            componentType: "rate_schedule_item",
            rateScheduleItemId: "rsi-installer",
            quantityExpr: "0.05",
            category: "Labour",
            costOverride: 95,
          },
        ],
      },
    ],
    rateScheduleItems: [
      {
        id: "rsi-installer",
        name: "Installer",
        unit: "HR",
        rates: { tier1: 120 },
        costRates: { tier1: 80 },
      },
    ],
  });

  const { items } = expandAssembly("asm-1", 100, {}, ctx);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.quantity, 5);
  assert.equal(items[0]!.unitCost, 95);
  assert.equal(items[0]!.unitPrice, 120);
  assert.equal(items[0]!.uom, "HR");
});

test("expandAssembly throws on a cycle in the assembly graph", () => {
  const ctx = makeContext({
    assemblies: [
      {
        id: "asm-a",
        name: "A",
        parameters: [],
        components: [
          { id: "c1", componentType: "sub_assembly", subAssemblyId: "asm-b", quantityExpr: "1" },
        ],
      },
      {
        id: "asm-b",
        name: "B",
        parameters: [],
        components: [
          { id: "c1", componentType: "sub_assembly", subAssemblyId: "asm-a", quantityExpr: "1" },
        ],
      },
    ],
  });

  assert.throws(() => expandAssembly("asm-a", 1, {}, ctx), /Cycle detected/);
});

test("expandAssembly tolerates the same sub-assembly used twice (not a cycle)", () => {
  const ctx = makeContext({
    assemblies: [
      {
        id: "asm-stud",
        name: "Stud",
        parameters: [],
        components: [
          {
            id: "c1",
            componentType: "catalog_item",
            catalogItemId: "ci-stud",
            quantityExpr: "1",
          },
        ],
      },
      {
        id: "asm-wall",
        name: "Wall",
        parameters: [],
        components: [
          { id: "c1", componentType: "sub_assembly", subAssemblyId: "asm-stud", quantityExpr: "2" },
          { id: "c2", componentType: "sub_assembly", subAssemblyId: "asm-stud", quantityExpr: "3" },
        ],
      },
    ],
    catalogItems: [
      { id: "ci-stud", name: "Stud", unit: "EA", unitCost: 4, unitPrice: 6 },
    ],
  });

  const { items, warnings } = expandAssembly("asm-wall", 1, {}, ctx);
  assert.equal(warnings.length, 0);
  assert.equal(items.length, 2);
  assert.equal(items[0]!.quantity, 2);
  assert.equal(items[1]!.quantity, 3);
});

test("expandAssembly emits warnings for missing references", () => {
  const ctx = makeContext({
    assemblies: [
      {
        id: "asm-1",
        name: "Bad Refs",
        parameters: [],
        components: [
          { id: "c1", componentType: "catalog_item", catalogItemId: "ci-missing", quantityExpr: "1" },
          { id: "c2", componentType: "rate_schedule_item", rateScheduleItemId: "rsi-missing", quantityExpr: "1" },
        ],
      },
    ],
  });

  const { items, warnings } = expandAssembly("asm-1", 1, {}, ctx);
  assert.equal(items.length, 0);
  assert.equal(warnings.length, 2);
});

test("expandAssembly applies uom and markup overrides", () => {
  const ctx = makeContext({
    assemblies: [
      {
        id: "asm-1",
        name: "Override Test",
        parameters: [],
        components: [
          {
            id: "c1",
            componentType: "catalog_item",
            catalogItemId: "ci-bolt",
            quantityExpr: "10",
            uomOverride: "BX",
            markupOverride: 0.25,
            costOverride: 1.5,
          },
        ],
      },
    ],
    catalogItems: [
      { id: "ci-bolt", name: "Bolt", unit: "EA", unitCost: 0.5, unitPrice: 0.75 },
    ],
  });

  const { items } = expandAssembly("asm-1", 1, {}, ctx);
  assert.equal(items[0]!.uom, "BX");
  assert.equal(items[0]!.markup, 0.25);
  assert.equal(items[0]!.unitCost, 1.5);
});

test("summarizeExpandedAssemblyResources groups repeated recipe resources", () => {
  const ctx = makeContext({
    assemblies: [
      {
        id: "asm-wall",
        name: "Wall",
        parameters: [],
        components: [
          {
            id: "c1",
            componentType: "catalog_item",
            catalogItemId: "ci-stud",
            quantityExpr: "2",
            category: "Material",
          },
          {
            id: "c2",
            componentType: "catalog_item",
            catalogItemId: "ci-stud",
            quantityExpr: "3",
            category: "Material",
          },
          {
            id: "c3",
            componentType: "rate_schedule_item",
            rateScheduleItemId: "rsi-carpenter",
            quantityExpr: "1.5",
            category: "Labour",
          },
        ],
      },
    ],
    catalogItems: [
      { id: "ci-stud", name: "Stud", unit: "EA", unitCost: 4, unitPrice: 6 },
    ],
    rateScheduleItems: [
      {
        id: "rsi-carpenter",
        name: "Carpenter",
        unit: "HR",
        rates: { standard: 100 },
        costRates: { standard: 80 },
      },
    ],
  });

  const { items } = expandAssembly("asm-wall", 2, {}, ctx);
  const rollup = summarizeExpandedAssemblyResources(items);

  assert.equal(rollup.length, 2);
  const labour = rollup.find((entry) => entry.category === "Labour");
  const material = rollup.find((entry) => entry.category === "Material");

  assert.equal(material?.entityName, "Stud");
  assert.equal(material?.quantity, 10);
  assert.equal(material?.lineCost, 40);
  assert.equal(material?.linePrice, 60);
  assert.equal(material?.componentCount, 2);
  assert.equal(labour?.quantity, 3);
  assert.equal(labour?.lineCost, 240);
  assert.equal(labour?.averageUnitPrice, 100);
});

test("findAssemblyCycles detects direct and indirect cycles", () => {
  const map = new Map<string, AssemblyDefinition>([
    [
      "a",
      {
        id: "a",
        name: "A",
        parameters: [],
        components: [
          { id: "x", componentType: "sub_assembly", subAssemblyId: "b", quantityExpr: "1" },
        ],
      },
    ],
    [
      "b",
      {
        id: "b",
        name: "B",
        parameters: [],
        components: [
          { id: "y", componentType: "sub_assembly", subAssemblyId: "a", quantityExpr: "1" },
        ],
      },
    ],
  ]);

  const cycles = findAssemblyCycles("a", map);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ["a", "b", "a"]);
});

test("findAssemblyCycles returns empty for an acyclic tree", () => {
  const map = new Map<string, AssemblyDefinition>([
    [
      "root",
      {
        id: "root",
        name: "Root",
        parameters: [],
        components: [
          { id: "x", componentType: "sub_assembly", subAssemblyId: "leaf", quantityExpr: "1" },
        ],
      },
    ],
    ["leaf", { id: "leaf", name: "Leaf", parameters: [], components: [] }],
  ]);

  assert.deepEqual(findAssemblyCycles("root", map), []);
});
