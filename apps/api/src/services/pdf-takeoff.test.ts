import test from "node:test";
import assert from "node:assert/strict";
import {
  canvasToPdf,
  pdfToCanvas,
  viewToPdf,
  measureGeometry,
  replaceCalibration,
  selectCalibration,
} from "./pdf-takeoff-geometry.js";
import { PdfTakeoffService } from "./pdf-takeoff-service.js";

test("view crop rotation maps to page points and round-trips the UI canvas", () => {
  const p = viewToPdf({ x: 0.25, y: 0.5 }, 600, 800, 90, {
    x: 0.1,
    y: 0.2,
    width: 0.5,
    height: 0.4,
  });
  assert.ok(Math.abs(p.x - 240) < 1e-8);
  assert.ok(Math.abs(p.y - 620) < 1e-8);
  const page = { width: 600, height: 800 },
    canvas = { width: 1200, height: 1600 };
  const roundTrip = canvasToPdf(pdfToCanvas(p, page, canvas), page, canvas);
  assert.ok(Math.hypot(roundTrip.x - p.x, roundTrip.y - p.y) < 1e-8);
  assert.throws(() => viewToPdf({ x: 2, y: 0 }, 600, 800), /outside/);
});

test("detail calibration selection and conflicts do not silently choose a scale", () => {
  const page = { pixelsPerUnit: 10, unit: "ft" };
  const detail = {
    pixelsPerUnit: 20,
    unit: "ft",
    pageNumber: 1,
    region: { x: 0, y: 0, width: 100, height: 100 },
  };
  const cache = { "1": page, "region:1:a": detail };
  assert.equal(
    selectCalibration(cache, 1, [
      { x: 20, y: 20 },
      { x: 80, y: 20 },
    ]).calibration,
    detail,
  );
  assert.equal(
    selectCalibration(cache, 1, [
      { x: 120, y: 20 },
      { x: 180, y: 20 },
    ]).calibration,
    page,
  );
  assert.equal(
    selectCalibration(cache, 1, [
      { x: 20, y: 20 },
      { x: 180, y: 20 },
    ]).calibration,
    null,
  );
  assert.equal(
    selectCalibration(
      { ...cache, "region:1:b": { ...detail, pixelsPerUnit: 30 } },
      1,
      [{ x: 20, y: 20 }],
    ).calibration,
    null,
  );
  assert.throws(
    () => replaceCalibration({ "1": page }, "1", detail),
    /replaceHuman/,
  );
  assert.throws(
    () => replaceCalibration({ __default: page }, "1", detail),
    /replaceHuman/,
  );
  assert.equal(
    replaceCalibration({ "1": page }, "1", detail, true)["1"],
    detail,
  );
  assert.equal(
    measureGeometry(
      "area",
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      page,
    ).value,
    100,
  );
});

test("save and explicit link use UI payloads; comparisons stay unlinked; human edits and foreign views are preserved", async () => {
  const pickups: any[] = [];
  const links: any[] = [];
  let workspace: any = {
    takeoffCalibrations: {
      drawing: { "1": { pixelsPerUnit: 10, unit: "ft", measuredBy: "person" } },
    },
  };
  const store: any = {
    getDocument: async (projectId: string, id: string) =>
      projectId === "project" && id === "drawing"
        ? { id, storagePath: "synthetic.pdf" }
        : null,
    getWorkspaceState: async () => ({ state: workspace }),
    updateWorkspaceState: async (_: string, patch: any) => {
      workspace = { ...workspace, ...patch };
    },
    createPickup: async (projectId: string, input: any) => {
      const p = { ...input, projectId, id: `pickup-${pickups.length}` };
      pickups.push(p);
      return p;
    },
    listPickups: async () => pickups,
    updatePickup: async (id: string, patch: any) => {
      const p = pickups.find((p) => p.id === id);
      Object.assign(p, patch);
      return p;
    },
    createPickupLink: async (_: string, input: any) => {
      const pickup = pickups.find((p) => p.id === input.pickupId);
      const link = {
        ...input,
        derivedQuantity:
          pickup.measurement[input.quantityField] * input.multiplier,
      };
      links.push(link);
      return link;
    },
  };
  const engine = async () => ({ page: { width: 600, height: 800 } });
  const service = new PdfTakeoffService(
    store,
    async () => ({ projectId: "other", documentId: "drawing", pageNumber: 1 }),
    engine,
  );
  const result = await service.save("project", {
    documentId: "drawing",
    type: "polyline",
    points: [
      { x: 0, y: 0 },
      { x: 30, y: 40 },
      { x: 60, y: 80 },
    ],
    linkToItemId: "row",
    quantityField: "value",
  });
  assert.equal(result.pickup.measurement.value, 10);
  assert.equal(result.pickup.measurement.raw, 100);
  assert.equal(result.pickup.annotationType, "linear-polyline");
  assert.equal(result.pickup.metadata.pdfPageWidth, 600);
  assert.equal(links[0].derivedQuantity, 10);
  await service.save("project", {
    documentId: "drawing",
    type: "count",
    points: [
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ],
    comparisonGroup: "independent",
  });
  assert.equal(links.length, 1);
  assert.equal(pickups[1].measurement.value, 3);
  await assert.rejects(
    service.measure("project", {
      viewId: "foreign",
      type: "count",
      points: [{ x: 0.5, y: 0.5 }],
    }),
    /not found in project/,
  );
  await assert.rejects(
    service.setCalibration("project", {
      documentId: "drawing",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      knownDistance: 20,
      unit: "ft",
      source: "dimension",
    }),
    /replaceHuman/,
  );
  pickups[0].metadata.lastEditedBy = "person";
  await assert.rejects(
    service.update("project", { pickupId: pickups[0].id, label: "changed" }),
    /editHuman/,
  );
  const edited = await service.update("project", {
    pickupId: pickups[0].id,
    editHuman: true,
    points: [
      { x: 0, y: 0 },
      { x: 60, y: 80 },
    ],
    label: "Changed explicitly",
  });
  assert.equal(edited.pickup.measurement.value, 10);
  assert.equal(edited.pickup.label, "Changed explicitly");
});
