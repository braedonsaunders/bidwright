import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { indexLaborUnitPage, prepareLaborSemanticBatch, searchLaborVectors, laborContentHash, laborEmbeddingText, LABOR_SIMILARITY_FLOOR } from "./labor-vector-index.js";

function setup() {
  const updatedAt = new Date("2026-01-01T00:00:00Z");
  const unit = { id: "unit", name: "Fillet weld", outputUom: "FT", category: "Steel", updatedAt, libraryId: "library", library: { name: "Manual", organizationId: null, updatedAt } };
  const records = new Map<string, any>();
  const queries: any[] = [];
  let paid = 0, dimensions = 2, model = "test";
  const db: any = {
    $transaction: async (run: any) => run(db),
    laborUnit: { findMany: async (input: any) => {
      assert.equal(input.where.library.OR[1].organizationId, null);
      return input.where.id?.gt ? [] : [unit];
    } },
    $queryRawUnsafe: async (sql: string, ...params: any[]) => {
      queries.push([sql, params]);
      assert.doesNotMatch(sql, /\bvector_records\b/);
      if (sql.includes("pg_advisory")) return [];
      if (sql.includes("INSERT INTO")) {
        assert.match(sql, /FOR SHARE OF u, l/);
        assert.match(sql, /u\."updatedAt" = \$10::timestamp/);
        records.set(params[0], { unit_id: params[0], namespace: params[2], provider: params[3], model: params[4], dimensions: params[5], content_hash: params[6] });
        return [{ unit_id: params[0] }];
      }
      if (sql.startsWith("DELETE")) {
        const removed = [...records.values()].filter(r => r.model !== params[2] || r.dimensions !== params[3]);
        for (const row of removed) records.delete(row.unit_id);
        return removed;
      }
      return [...records.values()].filter(row => row.provider === params[0] && row.model === params[1] && row.dimensions === params[2]);
    },
  };
  const dependencies: any = {
    resolveEmbeddingConfig: async () => ({ provider: "openai", model, dimensions, source: "env" }),
    createEmbedder: () => ({ id: "openai", dimensions, embed: async (texts: string[]) => { paid++; return texts.map(() => Array(dimensions).fill(.1)); } }),
  };
  return { unit, records, db, queries, dependencies, store: { organizationId: "org" } as any, paid: () => paid,
    configure: (newModel: string, newDimensions: number) => { model = newModel; dimensions = newDimensions; } };
}

test("dry-run is read-only; shared units are embedded once across tenants; edits replace hashes", async () => {
  const s = setup();
  const dry = await indexLaborUnitPage(s.db, s.store, {}, s.dependencies);
  assert.equal(dry.pending, 1); assert.equal(s.paid(), 0);
  assert.ok(s.queries.every(([sql]) => sql.startsWith("SELECT")));
  s.queries.length = 0;
  assert.equal((await indexLaborUnitPage(s.db, s.store, { dryRun: false }, s.dependencies)).embedded, 1);
  assert.match(s.queries[0][0], /pg_advisory_xact_lock/);
  assert.equal((await indexLaborUnitPage(s.db, { organizationId: "second-org" } as any, { dryRun: false }, s.dependencies)).unchanged, 1);
  assert.equal(s.paid(), 1); assert.equal(s.records.size, 1);
  assert.equal(s.records.get("unit").namespace, "shared");
  s.unit.name = "Butt weld";
  await indexLaborUnitPage(s.db, s.store, { dryRun: false }, s.dependencies);
  assert.equal(s.paid(), 2);
  assert.equal(s.records.get("unit").content_hash, laborContentHash(laborEmbeddingText(s.unit)));
  assert.equal((await indexLaborUnitPage(s.db, s.store, { cursor: "unit" }, s.dependencies)).nextCursor, null);
});

test("model/dimension changes replace active rows and purge old records beyond the current page", async () => {
  const s = setup();
  await indexLaborUnitPage(s.db, s.store, { dryRun: false }, s.dependencies);
  s.records.set("later-unit", { unit_id: "later-unit", model: "test", dimensions: 2 });
  s.configure("new-model", 3);
  const result = await indexLaborUnitPage(s.db, s.store, { dryRun: false }, s.dependencies);
  assert.equal(result.embedded, 1); assert.equal(result.purged, 1);
  assert.equal(s.records.size, 1); assert.equal(s.records.get("unit").dimensions, 3);
  assert.ok(s.queries.some(([sql]) => sql.includes('v.unit_updated_at <> u."updatedAt"') && sql.includes('v.library_updated_at <> l."updatedAt"')));
});

test("migration separates HNSW, guards the extension and invalidates all edit/delete paths", () => {
  const migration = readFileSync(new URL("../../../../packages/db/prisma/migrations/20261012150000_labor_unit_vectors/migration.sql", import.meta.url), "utf8");
  assert.match(migration, /IF EXISTS \(SELECT 1 FROM pg_extension WHERE extname = 'vector'\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS labor_unit_vectors/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_labor_vectors_hnsw/);
  assert.match(migration, /REFERENCES "LaborUnit"\(id\) ON DELETE CASCADE/);
  assert.match(migration, /REFERENCES "LaborUnitLibrary"\(id\) ON DELETE CASCADE/);
  for (const table of ["LaborUnit", "LaborUnitLibrary"]) assert.ok(migration.includes(`AFTER UPDATE ON "${table}"`));
  assert.doesNotMatch(migration, /(?:INSERT INTO|ALTER TABLE|DELETE FROM) vector_records/);
});

test("breakdown embeddings batch once, deduplicate and cache queries and index-existence by tenant/model", async () => {
  let existenceReads = 0, calls = 0; const batches: string[][] = [];
  const deps: any = {
    resolveEmbeddingConfig: async () => ({ provider: "openai", model: "batch-test", dimensions: 2 }),
    createEmbedder: () => ({ dimensions: 2, embed: async (queries: string[]) => { calls++; batches.push(queries); return queries.map(() => [1, 0]); } }),
  };
  const db: any = { $queryRawUnsafe: async (sql: string, ...params: any[]) => {
    existenceReads++; assert.match(sql, /labor_unit_vectors/); assert.equal(params[0], "batch-org"); return [{ unit_id: "unit" }];
  } };
  const store: any = { organizationId: "batch-org" };
  const queries = Array.from({ length: 60 }, (_, index) => `operation ${index % 30}`);
  const batch = await prepareLaborSemanticBatch(db, store, queries, deps);
  assert.equal(batch?.queries.size, 30); assert.equal(calls, 1); assert.equal(batches[0].length, 30);
  await prepareLaborSemanticBatch(db, store, queries, deps);
  assert.equal(calls, 1); assert.equal(existenceReads, 1);
});

test("semantic eligibility/permissions and floor precede slots; missing index is cached without provider spend", async () => {
  let reads = 0;
  const deps: any = { resolveEmbeddingConfig: async () => ({ provider: "openai", model: "missing", dimensions: 2 }),
    createEmbedder: () => ({ dimensions: 2, embed: async () => { throw new Error("must not embed without index"); } }) };
  const db: any = { $queryRawUnsafe: async () => { reads++; return []; } };
  const store: any = { organizationId: "empty-org" };
  await prepareLaborSemanticBatch(db, store, ["weld"], deps);
  await prepareLaborSemanticBatch(db, store, ["other"], deps);
  assert.equal(reads, 1);
  let sql = "", params: any[] = [];
  db.$queryRawUnsafe = async (query: string, ...args: any[]) => { sql = query; params = args; return [{ id: "unit", score: .9 }]; };
  const batch = { providerKey: "provider", model: "test", dimensions: 2, queries: new Map([["weld", [1, 0]]]) };
  const hits = await searchLaborVectors(db, store, "weld", { batch, filters: { libraryId: "allowed", category: "Piping", excludeIds: ["lexical"], q: "ignored" } as any });
  assert.equal(hits[0].id, "unit");
  assert.match(sql, /WITH eligible AS MATERIALIZED/);
  assert.match(sql, /u\."libraryId" = \$7/); assert.match(sql, /u\."category" = \$8/);
  assert.match(sql, /u.id <> ALL\(\$9::text\[\]\)/);
  assert.match(sql, /l\."organizationId" = \$1 OR l\."organizationId" IS NULL/);
  assert.match(sql, /WHERE score >= \$6 ORDER BY score DESC, id LIMIT 10/);
  assert.equal(params[5], LABOR_SIMILARITY_FLOOR); assert.equal(params.length, 9);
  assert.ok(sql.indexOf('u."category"') < sql.indexOf("LIMIT 10"));
  await searchLaborVectors(db, store, "weld", { batch, filters: { subClassName: "", includeEmptyHierarchy: true } });
  assert.match(sql, /u\."subClassName" = \$7/); assert.equal(params[6], "");
  db.$queryRawUnsafe = async () => { throw new Error("offline"); };
  assert.deepEqual(await searchLaborVectors(db, store, "weld", { batch }), []);
});

test("batched retrieval preserves provider-specific query purpose", async (t) => {
  const { createEmbedder } = await import("@bidwright/vector");
  const bodies: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    bodies.push(JSON.parse(init.body));
    return Response.json({ embeddings: { float: [[1, 0], [0, 1]] } });
  });
  const embedder = createEmbedder({ provider: "cohere", apiKey: "test", dimensions: 2 });
  await embedder.embed(["weld", "cut"], "query");
  assert.equal(bodies.length, 1); assert.equal(bodies[0].input_type, "search_query");
  assert.deepEqual(bodies[0].texts, ["weld", "cut"]);
});
