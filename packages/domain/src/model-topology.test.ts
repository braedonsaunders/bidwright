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
