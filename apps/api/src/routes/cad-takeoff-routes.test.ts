import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { prisma } from "@bidwright/db";
import { modelRoutes } from "./model-routes.js";
import { cadTakeoffRoutes } from "./cad-takeoff-routes.js";

test("CAD and model reads reject projects outside the caller's organization", async () => {
  const app = Fastify();
  app.decorateRequest("store", null);
  app.addHook("onRequest", async (request) => { request.store = { getProject: async () => null } as any; });
  await app.register(modelRoutes);
  try {
    for (const url of ["cad/query", "cad/render", "cad/takeoff", "assets/model/aggregate", "assets/model/solid-metrics"]) {
      const method = url.endsWith("solid-metrics") ? "GET" : "POST";
      const response = await app.inject({ method, url: `/api/models/foreign-project/${url}`, ...(method === "POST" ? { payload: {} } : {}) });
      assert.equal(response.statusCode, 404, url);
      assert.deepEqual(response.json(), { message: "Project not found" });
    }
  } finally { await app.close(); }
});

test("FileNode CAD saves use the Takeoff Studio document key while source reads use native ids", async () => {
  const app = Fastify();
  let saved: any;
  app.decorateRequest("store", null);
  app.addHook("onRequest", async (request) => { request.store = {
    getProject: async () => ({ id: "project" }),
    saveCadEntityPickups: async (_project: string, input: any) => { saved = input; return { saved: true, pickups: [] }; },
  } as any; });
  const original = prisma.fileNode.findFirst;
  prisma.fileNode.findFirst = (async ({ where }: any) => {
    assert.deepEqual(where, { id: "node", projectId: "project" });
    return { id: "node", type: "file", name: "cached.dwg", storagePath: "/missing-cached.dwg", metadata: { dwgTakeoff: {
      schemaVersion: 1, processorVersion: 3, sourceHash: "checksum", units: "in",
      entities: [{ id: "A", type: "LINE", layer: "pipe", start: { x: 0, y: 0 }, end: { x: 12, y: 0 }, raw: {} }],
    } } };
  }) as any;
  await app.register(cadTakeoffRoutes);
  try {
    const response = await app.inject({ method: "POST", url: "/api/models/project/cad/takeoff", payload: { sourceId: "node", sourceKind: "file_node", handles: ["A"], measurement: "length" } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(saved.documentId, "file-node"); assert.equal(saved.entities[0].quantity, 12);
    assert.equal(saved.entities[0].selection.sourceKind, "file_node");
  } finally { prisma.fileNode.findFirst = original; await app.close(); }
});
