import assert from "node:assert/strict";
import test from "node:test";
import { indexLaborUnitPage, searchLaborVectors, laborContentHash, laborEmbeddingText } from "./labor-vector-index.js";
import { PgVectorStore } from "@bidwright/vector";

function setup() {
  const unit = { id: "unit", name: "Fillet weld", outputUom: "FT", category: "Steel", libraryId: "library", library: { name: "Manual" } };
  const records = new Map<string, any>();
  const queries: any[] = [];
  let paid = 0;
  let storedDimensions = 2;
  const db: any = {
    laborUnit: { findMany: async (input: any) => {
      assert.deepEqual(input.where.library.OR, [{ organizationId: "org" }, { organizationId: null }]);
      return input.where.id?.gt ? [] : [unit];
    } },
    $queryRawUnsafe: async (sql: string, ...params: any[]) => {
      queries.push([sql, params]);
      if (sql.includes("pg_attribute")) return [{ type: `vector(${storedDimensions})` }];
      if (sql.startsWith("INSERT")) { records.set(params[0], { id: params[0], metadata: JSON.parse(params[8]), documentId: params[3] }); return []; }
      assert.equal(params[0], "org");
      return [...records.values()].filter(row => row.documentId === params[1]);
    },
  };
  const dependencies: any = {
    resolveEmbeddingConfig: async () => ({ provider: "openai", model: "test", dimensions: 2, source: "env" }),
    createEmbedder: () => ({ dimensions: 2, embed: async (texts: string[]) => { paid++; return texts.map(() => [1, 0]); } }),
  };
  return { unit, records, db, queries, dependencies, store: { organizationId: "org" } as any, paid: () => paid, setDimensions: (n: number) => { storedDimensions = n; } };
}

test("index dry-run is free; retry skips unchanged rows; edits re-index incrementally", async () => {
  const s = setup();
  const dry = await indexLaborUnitPage(s.db, s.store, {}, s.dependencies);
  assert.equal(dry.pending, 1); assert.equal(dry.embedded, 0); assert.equal(s.paid(), 0);
  assert.equal((await indexLaborUnitPage(s.db, s.store, { dryRun: false }, s.dependencies)).embedded, 1);
  assert.equal((await indexLaborUnitPage(s.db, s.store, { dryRun: false }, s.dependencies)).unchanged, 1);
  assert.equal(s.paid(), 1);
  s.unit.name = "Butt weld";
  assert.equal((await indexLaborUnitPage(s.db, s.store, { dryRun: false }, s.dependencies)).embedded, 1);
  assert.equal(s.paid(), 2);
  const record = [...s.records.values()][0];
  assert.equal(record.metadata.contentHash, laborContentHash(laborEmbeddingText(s.unit)));
  assert.equal((await indexLaborUnitPage(s.db, s.store, { cursor: "unit" }, s.dependencies)).nextCursor, null);
});

test("dimension mismatch stops before spending and model changes use a separate index", async () => {
  const s = setup(); s.setDimensions(3);
  await assert.rejects(indexLaborUnitPage(s.db, s.store, { dryRun: false }, s.dependencies), /dimensions differ/);
  assert.equal(s.paid(), 0);
  s.setDimensions(2);
  await indexLaborUnitPage(s.db, s.store, { dryRun: false }, s.dependencies);
  s.dependencies.resolveEmbeddingConfig = async () => ({ provider: "openai", model: "changed", dimensions: 2 });
  assert.equal((await indexLaborUnitPage(s.db, s.store, { dryRun: false }, s.dependencies)).embedded, 1);
  assert.equal(s.records.size, 2);
});

test("knowledge vector search excludes labour records in SQL before the result limit", async () => {
  let captured = ""; let args: unknown[] = [];
  const vector = new PgVectorStore(async (sql, params) => { captured = sql; args = params ?? []; return []; }, "tenant");
  await vector.search({ query: "steel", queryVector: [1, 0], excludeSourceTypes: ["labor_unit"] });
  assert.match(captured, /COALESCE\(metadata->>'sourceType'.*<> ALL/);
  assert.ok(args.includes("tenant")); assert.deepEqual(args.at(-1), ["labor_unit"]);
});

test("semantic search is free without an index, isolated by tenant, cached and optional on failure", async () => {
  let hasIndex = false, embeddings = 0;
  const seen: any[] = [];
  const db: any = { $queryRawUnsafe: async (sql: string, ...params: any[]) => {
    seen.push([sql, params]);
    if (sql.includes("LIMIT 1")) { assert.equal(params[0], "search-tenant"); return hasIndex ? [{ id: "vector" }] : []; }
    assert.equal(params[2], "search-tenant");
    return [{ id: "vector", chunk_id: "unit", document_id: params[3], project_id: null, scope: "library", text: "steel weld", metadata: { sourceType: "labor_unit" }, cosine_distance: .1 }];
  } };
  const dependencies: any = {
    resolveEmbeddingConfig: async () => ({ provider: "openai", model: "search-test", dimensions: 2 }),
    createEmbedder: () => ({ embedQuery: async () => { embeddings++; return [1, 0]; } }),
  };
  const store: any = { organizationId: "search-tenant" };
  assert.deepEqual(await searchLaborVectors(db, store, "weld", dependencies), []);
  assert.equal(embeddings, 0);
  hasIndex = true;
  assert.equal((await searchLaborVectors(db, store, "weld", dependencies))[0].id, "unit");
  await searchLaborVectors(db, store, "weld", dependencies);
  assert.equal(embeddings, 1);
  dependencies.createEmbedder = () => ({ embedQuery: async () => { throw new Error("provider offline"); } });
  assert.deepEqual(await searchLaborVectors(db, store, "other query", dependencies), []);
  assert.ok(seen.every(([sql]) => sql.includes("organization_id")));
});
