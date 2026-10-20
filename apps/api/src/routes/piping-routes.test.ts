import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { PrismaApiStore } from "../prisma-store.js";
import { pipingRoutes } from "./piping-routes.js";

// An in-memory PipingSpecLibraryEntry table with just the delegate calls the store makes.
function specLibraryDb() {
  const rows: any[] = [];
  const key = (where: any) => where.organizationId_specId;
  const find = (where: any) => rows.find(r => r.organizationId === key(where).organizationId && r.specId === key(where).specId);
  const without = (row: any, omit?: any) => (omit?.data ? (({ data: _data, ...rest }) => rest)(row) : row);
  return {
    rows,
    db: {
      pipingSpecLibraryEntry: {
        findMany: async ({ where, omit }: any) => rows.filter(r => r.organizationId === where.organizationId)
          .sort((a, b) => a.specId.localeCompare(b.specId)).map(r => without(r, omit)),
        findUnique: async ({ where }: any) => find(where) ?? null,
        upsert: async ({ where, create, update, omit }: any) => {
          const existing = find(where);
          if (existing) Object.assign(existing, update, { updatedAt: new Date(existing.updatedAt.getTime() + 1000) });
          else rows.push({ ...create, createdAt: new Date(0), updatedAt: new Date(0) });
          return without(find(where), omit);
        },
        deleteMany: async ({ where }: any) => {
          const index = rows.findIndex(r => r.organizationId === where.organizationId && r.specId === where.specId);
          if (index >= 0) rows.splice(index, 1);
          return { count: index >= 0 ? 1 : 0 };
        },
      },
    },
  };
}

const spec = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: `Spec ${id}`, material: "CS", rating: "150#", service: "Process", revision: "B",
  sizes: [{ nps: 2 }, { nps: 4 }], fittings: [{ id: `${id}:elbow`, nps: 2 }], ...extra,
});

test("piping spec library keeps one spec per id per organisation and derives summaries", async t => {
  const { rows, db } = specLibraryDb();
  const app = Fastify();
  app.decorateRequest("store", null);
  app.addHook("onRequest", async request => {
    const store = new PrismaApiStore(db as any, String(request.headers["x-org"] ?? "org"));
    store.setUserId("user-1");
    request.store = store;
  });
  await app.register(pipingRoutes);
  t.after(() => app.close());

  const put = (id: string, body: unknown, org = "org") =>
    app.inject({ method: "PUT", url: `/api/piping/spec-library/${encodeURIComponent(id)}`, headers: { "x-org": org }, payload: body as any });

  const saved = await put("ss-b", { spec: spec("ss-b", { custom: { kept: true } }) });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().specId, "ss-b");
  assert.equal(saved.json().rowCount, 3, "fittings + sizes");
  assert.equal(saved.json().updatedBy, "user-1");
  assert.equal(saved.json().spec, undefined, "a save does not echo the spec");
  assert.deepEqual(rows[0].data.custom, { kept: true }, "unknown spec keys are stored as sent");
  assert.equal((await put("ss-a", { spec: spec("ss-a", { service: undefined, revision: null }) })).json().service, "");
  assert.equal((await put("ss-a", { spec: spec("ss-a", { name: "Replaced" }) })).json().name, "Replaced");
  assert.equal(rows.filter(r => r.specId === "ss-a").length, 1, "saving under an existing id replaces it");
  assert.equal((await put("ss-a", { spec: spec("ss-a") }, "other")).statusCode, 200);

  const list = await app.inject({ method: "GET", url: "/api/piping/spec-library" });
  assert.deepEqual(list.json().map((s: any) => s.specId), ["ss-a", "ss-b"], "sorted by id, this organisation only");
  assert.ok(list.json().every((s: any) => s.spec === undefined && s.data === undefined));

  const got = await app.inject({ method: "GET", url: "/api/piping/spec-library/ss-b" });
  assert.deepEqual(got.json().spec, spec("ss-b", { custom: { kept: true } }));
  assert.equal((await app.inject({ method: "GET", url: "/api/piping/spec-library/absent" })).statusCode, 404);

  assert.equal((await put("ss-c", { spec: spec("ss-d") })).statusCode, 400, "the spec id must match the path");
  assert.equal((await put("ss-c", { spec: { id: "ss-c", name: "No rows" } })).statusCode, 400);
  assert.equal((await put("ss-c", spec("ss-c"))).statusCode, 400, "the spec is sent as { spec }");

  const removed = await app.inject({ method: "DELETE", url: "/api/piping/spec-library/ss-a" });
  assert.deepEqual(removed.json(), { deleted: true });
  assert.deepEqual((await app.inject({ method: "DELETE", url: "/api/piping/spec-library/ss-a" })).json(), { deleted: false });
  assert.ok(rows.some(r => r.organizationId === "other" && r.specId === "ss-a"), "another organisation's spec is untouched");
});
