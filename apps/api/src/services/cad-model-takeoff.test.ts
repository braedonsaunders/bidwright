import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@bidwright/db";
import assert from "node:assert/strict";
import { getDwgProcessingResult, parseDxfDrawing } from "./dwg-processing-service.js";
import { queryCadDrawing, cadDrawingSvg, renderCadPng, prepareCadEntityTakeoff } from "./cad-takeoff-service.js";
import { computeTriangulatedMeshMetrics } from "./model-ingest/utils.js";
import { aggregatePersistedElements, persistedSolidMetrics } from "./model-metrics.js";

function drawing() {
  const pairs: Array<string | number> = [0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, 4, 0, "ENDSEC",
    0, "SECTION", 2, "BLOCKS", 0, "BLOCK", 2, "VALVE", 70, 0, 10, 0, 20, 0, 30, 0,
    0, "LINE", 5, "B1", 8, "symbols", 10, 0, 20, 0, 11, 10, 21, 0, 0, "ENDBLK", 0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    0, "LINE", 5, "A1", 8, "pipe", 10, 0, 20, 0, 11, 300, 21, 400,
    0, "ARC", 5, "A2", 8, "pipe", 10, 0, 20, 0, 40, 100, 50, 0, 51, 90,
    0, "LWPOLYLINE", 5, "A3", 8, "slab", 90, 4, 70, 1, 10, 0, 20, 0, 10, 100, 20, 0, 10, 100, 20, 100, 10, 0, 20, 100,
    0, "INSERT", 5, "C1", 8, "symbols", 2, "VALVE", 66, 1, 10, 0, 20, 0,
    0, "ATTRIB", 5, "D1", 330, "C1", 2, "TAG", 1, "V-1", 10, 0, 20, 0, 0, "SEQEND",
    0, "INSERT", 5, "C2", 8, "symbols", 2, "VALVE", 10, 200, 20, 0,
    0, "TEXT", 5, "T1", 8, "notes", 10, 0, 20, 200, 40, 10, 1, "TEST DRAWING",
    0, "ENDSEC", 0, "EOF"];
  return parseDxfDrawing(pairs.join("\n") + "\n", { projectId: "test", documentId: "test", fileName: "generated.dxf" });
}

test("generated DXF: native handles, INSERT attributes/count, source-unit lengths, arc radians and closed area", () => {
  const dxf = drawing();
  const query = queryCadDrawing(dxf, { groupBy: "layer" });
  assert.equal(query.units, "mm");
  assert.equal(query.entities.find((e) => e.handle === "A1")?.length, 500);
  assert.ok(Math.abs(query.entities.find((e) => e.handle === "A2")!.length! - Math.PI * 50) < 1e-6);
  assert.ok(Math.abs(query.entities.find((e) => e.handle === "A3")!.area! - 10000) < 1e-6);
  const blocks = queryCadDrawing(dxf, { blockName: "VALVE", groupBy: "block", limit: 1 });
  assert.equal(blocks.total, 2); assert.equal(blocks.groups[0].insertCount, 2); assert.equal(blocks.hasMore, true);
  assert.deepEqual(blocks.entities[0].attributes, { TAG: "V-1" });
  assert.ok(query.entities.some((e) => e.handle === "C2::B1"));
});

test("CAD rendering produces a PNG and an invertible normalized-view transform", async () => {
  const rendered = cadDrawingSvg(drawing(), {});
  const image = Buffer.from(await renderCadPng(rendered.svg), "base64");
  assert.equal(image.subarray(1, 4).toString(), "PNG");
  assert.equal(image.readUInt32BE(16), rendered.width);
  assert.equal(image.readUInt32BE(20), rendered.height);
  const t = rendered.transform;
  assert.ok(t.xPerNormalized > 0 && t.yPerNormalized < 0);
  assert.ok(rendered.svg.includes("TEST DRAWING"));
});

const cube = [0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1];
const faces = [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7];
test("mesh metrics recenter offset solids and withhold open or non-manifold volume", () => {
  const offset = cube.map((v) => v + 1e9);
  const result = computeTriangulatedMeshMetrics(offset, faces);
  assert.equal(result.closed, true); assert.equal(result.volume, 1); assert.equal(result.surfaceArea, 6);
  assert.deepEqual(result.bbox, { min: [1e9, 1e9, 1e9], max: [1e9+1, 1e9+1, 1e9+1] });
  const open = computeTriangulatedMeshMetrics(offset, faces.slice(3));
  assert.equal(open.closed, false); assert.equal(open.volume, 0); assert.equal(open.surfaceArea, 5.5);
  assert.equal(computeTriangulatedMeshMetrics(offset, [...faces, 0,2,1]).closed, false);
});

test("aggregation keeps authored gross/net, geometric and units separate; legacy unchecked volume is hidden", () => {
  const elements = [{ id: "a", name: "Part", elementClass: "CAD_MESH", properties: { Pset: { Rating: "A" } }, quantities: [
    { quantityType: "volume", value: 5, unit: "m3", method: "ifc_declared_quantity", metadata: { qtoName: "NetVolume" } },
    { quantityType: "volume", value: 6, unit: "m3", method: "ifc_declared_quantity", metadata: { qtoName: "GrossVolume" } },
    { quantityType: "volume", value: 7, unit: "m3", method: "occt_closed_mesh_volume" },
  ] }];
  const result = aggregatePersistedElements(elements, { groupBy: "property", property: "Pset.Rating", elementIds: ["a", "a"] });
  assert.equal(result.groups[0].key, "A"); assert.equal(result.groups[0].elementCount, 1);
  assert.equal(result.groups[0].quantities.length, 3); assert.deepEqual(result.duplicateElementIds, ["a"]);
  assert.deepEqual(persistedSolidMetrics(elements).solids[0].metrics, []);
});

test("CAD saves validate every native handle and retain canonical quantity units", () => {
  const dxf = { ...drawing(), sourceHash: "checksum" };
  assert.throws(() => prepareCadEntityTakeoff(dxf, { handles: ["A1", "foreign"], measurement: "length", sourceKind: "file_node" }), /not found/);
  assert.throws(() => prepareCadEntityTakeoff(dxf, { handles: ["T1"], measurement: "area", sourceKind: "file_node" }), /unavailable/);
  const entities = prepareCadEntityTakeoff(dxf, { handles: ["A1", "A1"], measurement: "length", sourceKind: "file_node" });
  assert.equal(entities.length, 1); assert.equal(entities[0].unit, "in");
  assert.ok(Math.abs(entities[0].quantity - 500 / 25.4) < 1e-6);
  assert.equal(entities[0].selection.sourceHash, "checksum");
});

test("CAD read mode scopes FileNodes and never persists analysis", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cad-read-"));
  const path = join(dir, "read.dxf");
  await writeFile(path, [0, "SECTION", 2, "ENTITIES", 0, "LINE", 5, "A", 8, "0", 10, 0, 20, 0, 11, 1, 21, 0, 0, "ENDSEC", 0, "EOF"].join("\n") + "\n");
  const originalLookup = prisma.fileNode.findFirst, originalUpdate = prisma.fileNode.update;
  let updates = 0;
  prisma.fileNode.findFirst = (async ({ where }: any) => {
    assert.deepEqual(where, { id: "file", projectId: "project" });
    return { id: "file", type: "file", name: "read.dxf", storagePath: path, metadata: {} };
  }) as any;
  prisma.fileNode.update = (async () => { updates++; throw new Error("Read attempted to persist"); }) as any;
  try {
    const result = await getDwgProcessingResult("project", "file", { sourceKind: "file_node", persist: false });
    assert.equal(result.entities[0].id, "A"); assert.equal(result.units, "unitless");
    assert.equal(updates, 0);
  } finally { prisma.fileNode.findFirst = originalLookup; prisma.fileNode.update = originalUpdate; await rm(dir, { recursive: true, force: true }); }
});
