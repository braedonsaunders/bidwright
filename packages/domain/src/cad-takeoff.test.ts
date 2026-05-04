import test from "node:test";
import assert from "node:assert/strict";

import {
  cadPolylineLength,
  cadSignedPolylineArea,
  createCadTakeoffGroup,
  filterCadEntities,
  measureCadDrawing,
  measureCadEntity,
  measureCadGroups,
  type CadEntity,
  type CanonicalCadDrawing,
} from "./cad-takeoff";

const entities: CadEntity[] = [
  {
    id: "line-1",
    kind: "line",
    layerId: "power",
    start: { x: 0, y: 0 },
    end: { x: 120, y: 0 },
    source: { handle: "10A" },
  },
  {
    id: "room-1",
    kind: "polyline",
    layerId: "rooms",
    closed: true,
    vertices: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ],
    source: { handle: "10B" },
  },
  {
    id: "hidden-branch",
    kind: "line",
    layerId: "demo",
    start: { x: 0, y: 0 },
    end: { x: 60, y: 0 },
  },
  {
    id: "panel-count",
    kind: "block_reference",
    layerId: "power",
    blockId: "panel",
    insertionPoint: { x: 5, y: 5 },
  },
];

const drawing: CanonicalCadDrawing = {
  id: "drawing-1",
  name: "E1.01 Power Plan",
  version: 1,
  drawingUnit: "inch",
  measurementScale: { drawingUnitsPerOutputUnit: 12, outputUnit: "ft" },
  layers: [
    { id: "power", name: "E-POWER", visible: true, color: "#ff0000" },
    { id: "rooms", name: "A-ROOM", visible: true },
    { id: "demo", name: "E-DEMO", visible: false },
  ],
  blocks: [{ id: "panel", name: "PANELBOARD", basePoint: { x: 0, y: 0 }, entityIds: [] }],
  entities,
  groups: [
    createCadTakeoffGroup({
      id: "g-power",
      name: "Power branch",
      entities: [entities[0]!, entities[3]!],
      intent: "length",
      worksheetItemId: "item-1",
    }),
  ],
};

test("measureCadEntity scales line length from drawing units into output units", () => {
  const result = measureCadEntity(entities[0]!, { scale: drawing.measurementScale });

  assert.equal(result.length, 10);
  assert.equal(result.unit, "ft");
  assert.deepEqual(result.entityIds, ["line-1"]);
  assert.deepEqual(result.layerIds, ["power"]);
});

test("measureCadDrawing calculates closed polyline area and excludes hidden layers by default", () => {
  const result = measureCadDrawing(drawing);

  assert.equal(result.length, 15);
  assert.equal(Number(result.area.toFixed(6)), Number((200 / 144).toFixed(6)));
  assert.equal(result.perimeter, 5);
  assert.equal(result.count, 3);
  assert.deepEqual(result.entityIds, ["line-1", "panel-count", "room-1"]);
  assert.deepEqual(result.layerIds, ["power", "rooms"]);
  assert.equal(result.warnings.length, 1);
});

test("filterCadEntities can include hidden layers and narrow by layer or kind", () => {
  assert.deepEqual(
    filterCadEntities(drawing, { includeHidden: true, layerIds: ["demo"] }).map((entity) => entity.id),
    ["hidden-branch"],
  );
  assert.deepEqual(
    filterCadEntities(drawing, { entityKinds: ["polyline"] }).map((entity) => entity.id),
    ["room-1"],
  );
});

test("measureCadGroups returns scoped group rollups with worksheet links intact", () => {
  const [group] = measureCadGroups(drawing);

  assert.equal(group?.id, "g-power");
  assert.equal(group?.worksheetItemId, "item-1");
  assert.equal(group?.measurement.length, 10);
  assert.equal(group?.measurement.count, 2);
  assert.deepEqual(group?.measurement.entityIds, ["line-1", "panel-count"]);
});

test("cad polyline helpers handle DXF bulge arc segments", () => {
  const semicircle = [
    { x: -5, y: 0, bulge: 1 },
    { x: 5, y: 0 },
    { x: -5, y: 0 },
  ];

  assert.equal(Number(cadPolylineLength(semicircle, true).toFixed(6)), Number((Math.PI * 5 + 10).toFixed(6)));
  assert.equal(Number(Math.abs(cadSignedPolylineArea(semicircle, true)).toFixed(6)), Number(((Math.PI * 25) / 2).toFixed(6)));
});

test("measureCadEntity treats full ellipses as measurable closed geometry", () => {
  const result = measureCadEntity({
    id: "ellipse-1",
    kind: "ellipse",
    layerId: "rooms",
    center: { x: 0, y: 0 },
    majorRadius: 8,
    minorRadius: 3,
  });

  assert.ok(result.length > 0);
  assert.equal(Number(result.area.toFixed(6)), Number((Math.PI * 8 * 3).toFixed(6)));
  assert.equal(result.perimeter, result.length);
});
