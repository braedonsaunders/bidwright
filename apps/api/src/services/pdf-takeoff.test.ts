import {
  mutateWorkspaceStateLocked,
  patchTakeoffCalibrations,
} from "./takeoff-calibration-state.js";
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
    updateTakeoffCalibrationKeys: async (
      _: string,
      documentId: string,
      changes: any,
      options: any,
    ) => {
      workspace = patchTakeoffCalibrations(
        workspace,
        documentId,
        changes,
        options,
      );
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
  const engine = async (request: any) => ({
    page: { width: 600, height: 800 },
    points: request.points,
  });
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

test("FileNode keys preserve UI calibration, pickups and human edits even with a linked document", async () => {
  const human = { pixelsPerUnit: 10, unit: "ft", measuredBy: "person" };
  let state: any = { takeoffCalibrations: { "file-node": { "1": human } } };
  const pickups: any[] = [];
  let calls = 0;
  const store: any = {
    getDocument: async (_: string, id: string) =>
      id === "linked" ? { id, storagePath: "synthetic.pdf" } : null,
    getFileNode: async (id: string) =>
      id === "node"
        ? { id, projectId: "project", type: "file", documentId: "linked" }
        : null,
    getWorkspaceState: async () => ({ state }),
    updateTakeoffCalibrationKeys: async (
      _: string,
      id: string,
      changes: any,
      options: any,
    ) => {
      state = patchTakeoffCalibrations(state, id, changes, options);
    },
    createPickup: async (_: string, input: any) => {
      const pickup = {
        ...input,
        id: "pickup",
        updatedAt: "2026-10-11T00:00:00.000Z",
      };
      pickups.push(pickup);
      return pickup;
    },
    listPickups: async () => pickups,
    updatePickup: async (_: string, patch: any) =>
      Object.assign(pickups[0], patch),
  };
  const service = new PdfTakeoffService(
    store,
    async () => ({
      projectId: "project",
      fileNodeId: "node",
      pageNumber: 1,
      rotation: 0,
    }),
    async (request: any) => {
      calls++;
      return { page: { width: 600, height: 800 }, points: request.points };
    },
  );
  const resolved = await service.resolve("project", { viewId: "view" });
  assert.equal(resolved.documentId, "file-node");
  assert.equal(resolved.doc.id, "linked");
  const saved = await service.save("project", {
    documentId: "file-node",
    type: "linear",
    points: [
      { x: 10, y: 10 },
      { x: 110, y: 10 },
    ],
  });
  assert.equal(calls, 1, "one Python page parse per measurement");
  assert.equal(saved.pickup.documentId, "file-node");
  assert.equal(saved.pickup.measurement.unit, "ft");
  assert.equal(saved.pickup.measurement.value, 10);
  await assert.rejects(
    service.setCalibration("project", {
      documentId: "file-node",
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
  const edited = await service.update("project", {
    pickupId: "pickup",
    editHuman: true,
    label: "Reviewed",
  });
  assert.equal(edited.pickup.measurement.unit, "ft");
  assert.equal(edited.pickup.measurement.value, 10);
});

test("pixel-only and conflicting-scale measurements save without estimate links", async () => {
  let cache: any = {};
  let links = 0;
  const store: any = {
    getDocument: async () => ({ id: "drawing", storagePath: "synthetic.pdf" }),
    getWorkspaceState: async () => ({
      state: { takeoffCalibrations: { drawing: cache } },
    }),
    createPickup: async (_: string, input: any) => ({ ...input, id: "pickup" }),
    createPickupLink: async () => {
      links++;
    },
  };
  const service = new PdfTakeoffService(
    store,
    async () => null,
    async (request: any) => ({
      page: { width: 600, height: 800 },
      points: request.points,
    }),
  );
  const input = {
    documentId: "drawing",
    type: "linear" as const,
    points: [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
    ],
    linkToItemId: "row",
  };
  assert.match(
    (await service.save("project", input)).linkError!,
    /Pixel measurements/,
  );
  const region = { x: 0, y: 0, width: 100, height: 100 };
  cache = {
    "region:1:a": { region, pageNumber: 1, pixelsPerUnit: 10, unit: "ft" },
    "region:1:b": { region, pageNumber: 1, pixelsPerUnit: 20, unit: "ft" },
  };
  const conflicting = await service.save("project", input);
  assert.equal(conflicting.pickup.measurement.unit, "px");
  assert.equal(conflicting.link, null);
  assert.equal(links, 0);
});

test("human edits made during geometry computation are protected by the original version", async () => {
  const pickup: any = {
    id: "pickup",
    documentId: "drawing",
    pageNumber: 1,
    annotationType: "linear",
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    metadata: { measuredBy: "agent" },
    updatedAt: "2026-10-11T00:00:00.000Z",
  };
  const store: any = {
    listPickups: async () => [pickup],
    getDocument: async () => ({ id: "drawing", storagePath: "synthetic.pdf" }),
    getWorkspaceState: async () => ({ state: {} }),
    updatePickup: async (_: string, patch: any, expected: string) => {
      assert.equal(expected, "2026-10-11T00:00:00.000Z");
      if (expected !== pickup.updatedAt)
        throw new Error("Pickup changed while measuring");
      Object.assign(pickup, patch);
    },
  };
  const service = new PdfTakeoffService(
    store,
    async () => null,
    async (request: any) => {
      pickup.updatedAt = "2026-10-11T00:00:01.000Z";
      pickup.label = "Human edit";
      return { page: { width: 600, height: 800 }, points: request.points };
    },
  );
  await assert.rejects(
    service.update("project", { pickupId: "pickup", label: "Agent edit" }),
    /changed while measuring/,
  );
  assert.equal(pickup.label, "Human edit");
});

test("per-key calibration patches preserve concurrent keys and reject stale UI undo", async () => {
  const first = { pixelsPerUnit: 10, unit: "ft", measuredBy: "agent" };
  const second = { pixelsPerUnit: 20, unit: "ft", measuredBy: "agent" };
  let state: any = { selectedDocumentId: "drawing" };
  let row: any = null;
  let lock = Promise.resolve();
  let lockCount = 0;
  const db: any = {
    $transaction: async (fn: any) => {
      let release!: () => void;
      let locked = false;
      const tx = {
        $queryRaw: async (sql: TemplateStringsArray) => {
          assert.match(sql.join("?"), /FOR UPDATE/);
          lockCount++;
          const prior = lock;
          lock = new Promise<void>((resolve) => {
            release = resolve;
          });
          await prior;
          locked = true;
        },
        workspaceState: {
          findUnique: async () => {
            assert.ok(locked);
            await Promise.resolve();
            return row ? structuredClone(row) : null;
          },
          create: async ({ data }: any) => {
            assert.equal(row, null);
            row = { id: "workspace", ...data };
            return row;
          },
          update: async ({ data }: any) => {
            row = { ...row, ...data };
            return row;
          },
        },
      };
      try {
        return await fn(tx);
      } finally {
        if (release) release();
      }
    },
  };
  const transaction = (key: string, calibration: any) =>
    mutateWorkspaceStateLocked(
      db,
      "project",
      (current) =>
        patchTakeoffCalibrations(current, "drawing", [{ key, calibration }], {
          agent: true,
        }),
      async () => state,
    );
  await Promise.all([transaction("1", first), transaction("2", second)]);
  assert.equal(lockCount, 2);
  state = row.state;
  assert.deepEqual(state.takeoffCalibrations.drawing, {
    "1": first,
    "2": second,
  });
  state = patchTakeoffCalibrations(state, "drawing", [
    { key: "1", calibration: second, expected: first },
  ]);
  assert.throws(
    () =>
      patchTakeoffCalibrations(state, "drawing", [
        { key: "1", calibration: null, expected: first },
      ]),
    /changed since/,
  );
  assert.equal(state.takeoffCalibrations.drawing["2"], second);
});
