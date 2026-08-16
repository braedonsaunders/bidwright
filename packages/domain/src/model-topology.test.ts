import assert from "node:assert/strict";
import test from "node:test";
import { buildModelTopology } from "./model-topology.js";

test("buildModelTopology rolls connected pipe segments into a measured authored system", () => {
  const elements = [0, 1, 2].map((index) => ({
    id: `pipe-${index}`,
    externalId: `P-${index}`,
    name: `Pipe ${index}`,
    elementClass: "IfcPipeSegment",
    elementType: "Carbon steel pipe",
    system: "CHWS-100",
    material: "Carbon steel",
    bbox: { min: [index * 10, 0, 0], max: [(index + 1) * 10, 1, 1] },
    quantities: [{ id: `q-${index}`, elementId: `pipe-${index}`, quantityType: "Length", value: 10, unit: "ft", confidence: 0.95 }],
  }));
  const result = buildModelTopology(elements, { units: "feet" });
  assert.equal(result.connections.length, 2);
  assert.equal(result.groups.filter((group) => group.kind === "system").length, 1);
  const estimate = result.groups.find((group) => group.kind === "estimate" && group.measurementType === "length");
  assert.ok(estimate);
  assert.equal(estimate.quantity, 30);
  assert.equal(estimate.unit, "ft");
  assert.deepEqual(estimate.memberElementIds, ["pipe-0", "pipe-1", "pipe-2"]);
});

test("buildModelTopology keeps incompatible authored systems separate", () => {
  const result = buildModelTopology([
    { id: "a", externalId: "a", name: "Pipe A", elementClass: "Pipe", system: "L-100", bbox: { min: [0, 0, 0], max: [10, 1, 1] } },
    { id: "b", externalId: "b", name: "Pipe B", elementClass: "Pipe", system: "L-200", bbox: { min: [10, 0, 0], max: [20, 1, 1] } },
  ], { units: "feet" });
  assert.equal(result.connections.length, 0);
  assert.equal(result.groups.filter((group) => group.kind === "system").length, 2);
});

test("estimate rollups span systems by default and recipes can preserve system boundaries", () => {
  const elements = ["L-100", "L-200"].map((system, index) => ({
    id: `pipe-${index}`,
    externalId: `pipe-${index}`,
    name: "Pipe",
    elementClass: "Pipe",
    system,
    material: "Carbon steel",
    properties: { "Pset.Specification": "STD", "Pset.Size": "4 in" },
    quantities: [{ id: `q-${index}`, quantityType: "Length", value: 10, unit: "ft" }],
  }));
  const defaultResult = buildModelTopology(elements, { units: "feet" });
  assert.equal(defaultResult.groups.filter((group) => group.kind === "estimate").length, 1);
  assert.equal(defaultResult.groups.find((group) => group.kind === "estimate")?.quantity, 20);

  const bySystem = buildModelTopology(elements, {
    units: "feet",
    estimateGroupBy: ["trade", "role", "system", "specification", "material", "size"],
  });
  assert.equal(bySystem.groups.filter((group) => group.kind === "estimate").length, 2);
});

test("buildModelTopology splits branches at junctions and retains estimate rollups", () => {
  const element = (id: string, name: string, elementClass: string, min: number[], max: number[]) => ({
    id,
    externalId: id,
    name,
    elementClass,
    system: "P-300",
    bbox: { min, max },
    quantities: [{ id: `q-${id}`, elementId: id, quantityType: "Length", value: 5, unit: "m" }],
  });
  const result = buildModelTopology([
    element("left", "Pipe left", "IfcPipeSegment", [0, 0, 0], [5, 1, 1]),
    element("tee", "Tee", "IfcPipeFitting", [5, 0, 0], [6, 1, 1]),
    element("right", "Pipe right", "IfcPipeSegment", [6, 0, 0], [11, 1, 1]),
    element("branch", "Pipe branch", "IfcPipeSegment", [5, 1, 0], [6, 6, 1]),
  ], { units: "metres" });
  assert.ok(result.groups.filter((group) => group.kind === "run").length >= 3);
  const linear = result.groups.find((group) => group.kind === "estimate" && group.name.includes("Linear run"));
  assert.equal(linear?.quantity, 15);
});

test("buildModelTopology recovers native property lengths when legacy quantities are detached", () => {
  const result = buildModelTopology([
    { id: "p1", externalId: "1", name: "Pipe 1", elementClass: "PipeSegment", system: "L-9", properties: { "AutoCAD.Length": "9.25" } },
    { id: "p2", externalId: "2", name: "Pipe 2", elementClass: "PipeSegment", system: "L-9", properties: { "AutoCAD.Length": "4.75" } },
  ], { units: "feet" });
  const linear = result.groups.find((group) => group.kind === "estimate" && group.measurementType === "length");
  assert.equal(linear?.quantity, 14);
  assert.equal(linear?.unit, "ft");
});

test("buildModelTopology converts hinted inch lengths into the model's display feet", () => {
  // Mirrors an imperial Plant3D NWD: AutoCAD.Length serialized in drawing
  // units (inches) with a sibling Port1_LengthUnit hint, while the model's
  // display units report feet.
  const pipe = (id: string, inches: string) => ({
    id,
    externalId: id,
    name: "ACPPPIPE",
    elementClass: "9002",
    elementType: "ACPPPIPE",
    properties: {
      estimateRelevant: true,
      "AutoCAD.Class": "Pipe",
      "AutoCAD.Length": inches,
      "AutoCAD.PipeLineNumber": "3\"P-150S1-9002",
      "AutoCAD.Spec": "150S1",
      "AutoCAD.Size": "3\"",
      "AutoCAD.Port1_LengthUnit": "in",
      "AutoCAD.Port2_LengthUnit": "in",
    },
  });
  const result = buildModelTopology([pipe("pipe-1", "60"), pipe("pipe-2", "84")], { units: "ft" });
  const linear = result.groups.find((group) => group.kind === "estimate" && group.measurementType === "length");
  assert.ok(linear);
  assert.ok(Math.abs(linear.quantity - 12) < 1e-9, `expected 12 ft, got ${linear.quantity}`);
  assert.equal(linear.unit, "ft");
});

test("buildModelTopology disambiguates unitless lengths via the weight cross-check", () => {
  // No unit hint at all: the only signal is total weight vs weight-per-length
  // (3.158643 LB at 7.58 LB/FT implies 0.4167 ft = 5.0 in, so the raw 5.00049
  // must be inches, not feet).
  const result = buildModelTopology([{
    id: "pipe-1",
    externalId: "pipe-1",
    name: "ACPPPIPE",
    elementClass: "9002",
    properties: {
      estimateRelevant: true,
      "AutoCAD.Class": "Pipe",
      "AutoCAD.Length": "5.00049",
      "AutoCAD.Weight": "3.158643",
      "AutoCAD.WeightUnit": "LB",
      "AutoCAD.LinearWeight": "7.58",
      "AutoCAD.LinearWeightUnit": "LB/FT",
    },
  }], { units: "ft" });
  const linear = result.groups.find((group) => group.kind === "estimate" && group.measurementType === "length");
  assert.ok(linear);
  assert.ok(Math.abs(linear.quantity - 5.00049 / 12) < 1e-6, `expected ~0.4167 ft, got ${linear.quantity}`);
  assert.equal(linear.unit, "ft");
});

test("buildModelTopology re-units display-stamped quantity rows via the modal authored hint", () => {
  // Mirrors the E-012 NWD failure: most elements carry inch hints
  // (Port1_LengthUnit), but Navisworks pipes arrive as bare geometry lengths
  // pre-normalized into ModelQuantity rows whose unit was hard-stamped "ft"
  // by the APS adapter's guessUnits(). The stamped "ft" must lose to the
  // model-wide inch consensus (258.213 in = 21.518 ft, not 258 ft).
  const hintedFitting = (id: string) => ({
    id,
    externalId: id,
    name: "ACPPPIPEFITTING",
    elementClass: "9002",
    elementType: "ACPPPIPEFITTING",
    properties: {
      estimateRelevant: true,
      "AutoCAD.Class": "Pipe",
      "AutoCAD.Length": "4.709668",
      "AutoCAD.Spec": "150S1",
      "AutoCAD.Size": "3\"",
      "AutoCAD.Port1_LengthUnit": "in",
      "AutoCAD.Port2_LengthUnit": "in",
    },
  });
  const result = buildModelTopology([
    hintedFitting("fit-1"),
    hintedFitting("fit-2"),
    hintedFitting("fit-3"),
    {
      id: "pipe-1",
      externalId: "pipe-1",
      name: "Line",
      elementClass: "Pipe",
      properties: {
        estimateRelevant: true,
        "AutoCAD Geometry.Length": "258.213",
      },
      quantities: [{ quantityType: "Length", value: 258.213, unit: "ft", method: "aps_model_derivative_property", confidence: 0.8 }],
    },
  ], { units: "ft" });
  const linear = result.groups
    .filter((group) => group.kind === "estimate" && group.measurementType === "length")
    .reduce((sum, group) => sum + group.quantity, 0);
  // Fittings measure as counts; the pipe's stamped-"ft" 258.213 must re-unit
  // to inches via the modal hint → 21.518 ft.
  const expected = 258.213 / 12;
  assert.ok(Math.abs(linear - expected) < 1e-6, `expected ${expected} ft, got ${linear}`);
});

test("buildModelTopology keeps genuinely-authored explicit units despite a modal hint", () => {
  // An explicit unit that differs from the display unit is authored data and
  // must never be overridden by the majority hint.
  const hintedFitting = (id: string) => ({
    id,
    externalId: id,
    name: "ACPPPIPEFITTING",
    elementClass: "9002",
    properties: {
      estimateRelevant: true,
      "AutoCAD.Class": "Pipe",
      "AutoCAD.Length": "12",
      "AutoCAD.Port1_LengthUnit": "in",
      "AutoCAD.Port2_LengthUnit": "in",
    },
  });
  const result = buildModelTopology([
    hintedFitting("fit-1"),
    hintedFitting("fit-2"),
    hintedFitting("fit-3"),
    {
      id: "pipe-metric",
      externalId: "pipe-metric",
      name: "Line",
      elementClass: "Pipe",
      properties: { estimateRelevant: true },
      quantities: [{ quantityType: "Length", value: 2, unit: "m", method: "native", confidence: 1 }],
    },
  ], { units: "ft" });
  const linear = result.groups
    .filter((group) => group.kind === "estimate" && group.measurementType === "length")
    .reduce((sum, group) => sum + group.quantity, 0);
  // Fittings measure as counts; the metric pipe's authored "m" beats the
  // modal inch hint → 2 m = 6.5617 ft.
  const expected = 2 / 0.3048;
  assert.ok(Math.abs(linear - expected) < 1e-6, `expected ${expected} ft, got ${linear}`);
});

test("buildModelTopology converts explicit metric quantities into imperial display units", () => {
  const result = buildModelTopology([{
    id: "duct-1",
    externalId: "duct-1",
    name: "Duct segment",
    elementClass: "IfcDuctSegment",
    quantities: [{ id: "q-1", elementId: "duct-1", quantityType: "Length", value: 3048, unit: "mm" }],
  }], { units: "feet" });
  const linear = result.groups.find((group) => group.kind === "estimate" && group.measurementType === "length");
  assert.ok(linear);
  assert.ok(Math.abs(linear.quantity - 10) < 1e-9, `expected 10 ft, got ${linear.quantity}`);
  assert.equal(linear.unit, "ft");
});

test("buildModelTopology sums mixed-unit member lengths in one canonical unit", () => {
  const result = buildModelTopology([
    {
      id: "a",
      externalId: "a",
      name: "Pipe A",
      elementClass: "PipeSegment",
      system: "L-1",
      quantities: [{ id: "q-a", elementId: "a", quantityType: "Length", value: 2, unit: "m" }],
    },
    {
      id: "b",
      externalId: "b",
      name: "Pipe B",
      elementClass: "PipeSegment",
      system: "L-1",
      quantities: [{ id: "q-b", elementId: "b", quantityType: "Length", value: 500, unit: "mm" }],
    },
  ], { units: "m" });
  const linear = result.groups.find((group) => group.kind === "estimate" && group.measurementType === "length");
  assert.ok(linear);
  assert.ok(Math.abs(linear.quantity - 2.5) < 1e-9, `expected 2.5 m, got ${linear.quantity}`);
  assert.equal(linear.unit, "m");
});

test("buildModelTopology infers proximity connections in the coordinate space the hints declare", () => {
  // Coordinates and lengths in inches, display units feet. Without following
  // the hinted unit, the ft-scaled tolerance (0.04) can never bridge inch
  // coordinate gaps and every pipeline collapses to one unsplit run.
  const element = (id: string, elementClass: string, min: number[], max: number[], extra: Record<string, unknown> = {}) => ({
    id,
    externalId: id,
    name: elementClass,
    elementClass: "9002",
    elementType: elementClass,
    system: "P-9002",
    bbox: { min, max },
    properties: {
      estimateRelevant: true,
      "AutoCAD.Port1_LengthUnit": "in",
      ...extra,
    },
  });
  const result = buildModelTopology([
    element("left", "ACPPPIPE", [0, 0, 0], [60, 3.5, 3.5], { "AutoCAD.Class": "Pipe", "AutoCAD.Length": "60" }),
    element("tee", "ACPPPIPEINLINEASSET", [60.2, 0, 0], [66, 3.5, 3.5], { "AutoCAD.Class": "Tee" }),
    element("right", "ACPPPIPE", [66.2, 0, 0], [126, 3.5, 3.5], { "AutoCAD.Class": "Pipe", "AutoCAD.Length": "60" }),
  ], { units: "ft" });
  assert.equal(result.connections.length, 2);
  const linear = result.groups.find((group) => group.kind === "estimate" && group.measurementType === "length");
  assert.ok(linear);
  assert.ok(Math.abs(linear.quantity - 10) < 1e-9, `expected 10 ft, got ${linear.quantity}`);
});

test("buildModelTopology understands Plant3D pipeline semantics without treating IDs as quantities", () => {
  const pipe = (id: string, length: string) => ({
    id,
    externalId: id,
    name: "ACPPPIPE",
    elementClass: "9001",
    elementType: "ACPPPIPE",
    system: "P",
    material: "AutoCAD Color Index 5",
    properties: {
      estimateRelevant: true,
      "AutoCAD.Class": "Pipe",
      "AutoCAD.Length": length,
      "AutoCAD.PipeLineNumber": `3\"P-150S1-9001`,
      "AutoCAD.Line Number": "9001",
      "AutoCAD.Service": "P",
      "AutoCAD.Spec": "150S1",
      "AutoCAD.Size": `3\"`,
      "AutoCAD.Plant Material": "TP304L",
      "AutoCAD.PnPID": "1742",
    },
  });
  const result = buildModelTopology([
    pipe("pipe-1", "9.043757"),
    pipe("pipe-2", "4.956243"),
    {
      id: "elbow-1",
      externalId: "elbow-1",
      name: "ACPPPIPEINLINEASSET",
      elementClass: "9001",
      elementType: "ACPPPIPEINLINEASSET",
      properties: {
        estimateRelevant: true,
        "AutoCAD.Class": "Elbow",
        "AutoCAD.PipeLineNumber": `3\"P-150S1-9001`,
        "AutoCAD.Spec": "150S1",
        "AutoCAD.Size": `3\"`,
        "AutoCAD.Plant Material": "TP304L",
        "AutoCAD.PnPID": "1743",
      },
    },
    {
      id: "layer-1",
      externalId: "layer-1",
      name: "Layer",
      elementClass: "Layer",
      properties: { estimateRelevant: false, "AutoCAD.Length": "9999" },
    },
  ], { units: "feet" });

  const systems = result.groups.filter((group) => group.kind === "system");
  assert.equal(systems.length, 1);
  assert.equal(systems[0]?.name, `3\"P 150S1 9001`);
  assert.equal(result.groups.filter((group) => group.kind === "network").length, 1);
  assert.equal(result.groups.filter((group) => group.kind === "run").length, 1);
  const linear = result.groups.find((group) => group.kind === "estimate" && group.measurementType === "length");
  assert.equal(linear?.quantity, 14);
  assert.equal(linear?.unit, "ft");
  assert.equal(linear?.metadata.material, "TP304L");
  const fittings = result.groups.find((group) => group.kind === "estimate" && group.metadata.role === "fitting");
  assert.equal(fittings?.quantity, 1);
  assert.equal(fittings?.unit, "EA");
  assert.equal(result.diagnostics.elementCount, 3);
});
