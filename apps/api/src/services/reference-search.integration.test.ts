import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PrismaClient } from "@bidwright/db";
import { PrismaApiStore } from "../prisma-store.js";

const url = process.env.BIDWRIGHT_SEARCH_TEST_DATABASE_URL;
test("indexed retrieval preserves operation/size relevance, source identity and tenant boundaries", { skip: !url }, async () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const org = `search-proof-${randomUUID()}`, other = `${org}-other`;
  try {
    const migration = await readFile(new URL("../../../../packages/db/prisma/migrations/20261008010000_reference_search_indexes/migration.sql", import.meta.url), "utf8");
    for (const sql of migration.split(";").filter((statement) => statement.trim())) await db.$executeRawUnsafe(sql);
    await db.organization.createMany({ data: [{ id: org, name: "Search proof", slug: org }, { id: other, name: "Other proof", slug: other }] });
    const library = await db.laborUnitLibrary.create({ data: { organizationId: org, name: "Manual", description: "adhesive anchor stainless drill tap" } });
    const foreignLibrary = await db.laborUnitLibrary.create({ data: { organizationId: other, name: "Private manual" } });
    await db.laborUnit.createMany({ data: [
      { libraryId: library.id, name: "3/4 inch stainless butt welding", hoursNormal: 0.75 },
      { libraryId: library.id, name: "3/8 inch stainless butt welding", hoursNormal: 0.38 },
      { libraryId: library.id, name: "3 inch stainless butt welding", hoursNormal: 3 },
      { libraryId: library.id, name: "Tapping holes", description: "Threaded holes in steel", hoursNormal: 0.004 },
      { libraryId: library.id, name: "SelfDrillAnchors", hoursNormal: 0.24 },
      { libraryId: library.id, name: "Applying adhesive tape", hoursNormal: 0.2 },
      { libraryId: foreignLibrary.id, name: "3 inch stainless butt welding secret", hoursNormal: 99 },
    ] });
    const store = new PrismaApiStore(db, org);
    const welds = await store.listLaborUnits({ q: "3 inch stainless butt weld", limit: 8 });
    assert.equal(welds.units[0].name, "3 inch stainless butt welding");
    assert.equal(welds.units.some((unit) => unit.name.includes("secret")), false);
    const tap = await store.listLaborUnits({ q: "tap", limit: 8 });
    assert.equal(tap.units[0].name, "Tapping holes");
    assert.equal(tap.units[0].hoursNormal, 0.004);
    assert.equal((await store.listLaborUnits({ q: "self drill anchors" })).units[0].name, "SelfDrillAnchors");
    const book = await db.knowledgeBook.create({ data: { organizationId: org, name: "Fabrication handbook" } });
    const hidden = await db.knowledgeBook.create({ data: { organizationId: other, name: "Hidden handbook" } });
    const chunks = await db.knowledgeChunk.createMany({ data: [
      { bookId: book.id, text: "DRILL AND TAP\nSize | hours per hole\n1/4 inch | 0.004", order: 0, pageNumber: 9 },
      { bookId: book.id, text: "Table notes: shop conditions and pilot hole included", order: 1, pageNumber: 9 },
      { bookId: hidden.id, text: "drill tap hole 1/4 secret", order: 0 },
    ] });
    assert.equal(chunks.count, 3);
    const hits = await store.searchKnowledgeChunks("drill tap holes", undefined, 8, { scope: "global" });
    assert.equal(hits.every((hit) => hit.bookId === book.id), true);
    assert.equal(hits[0].pageNumber, 9);
    const passage = await store.getKnowledgePassage(book.id, { chunkId: hits[0].id }, 1);
    assert.equal(passage?.chunks.length, 2);
    assert.equal(await store.getKnowledgePassage(hidden.id, { chunkOrder: 0 }), null);
    const resolved = await store.resolveKnowledgeChunkReferences([{ bookId: book.id, chunkId: "chunk-0", text: hits[0].text }]);
    assert.equal(resolved.get(`${book.id}:chunk-0`)?.id, hits[0].id);
    const dataset = await db.dataset.create({ data: { organizationId: org, name: "Pipe operations" } });
    await db.datasetRow.createMany({ data: [
      { datasetId: dataset.id, data: { size: "3/4", operation: "stainless butt weld", hours: 0.75 }, order: 0 },
      { datasetId: dataset.id, data: { size: "3", operation: "stainless butt weld", hours: 3 }, order: 1 },
    ] });
    const rows = await store.searchDatasetRows(dataset.id, "3 stainless butt weld");
    assert.equal(rows[0].data.size, "3");
    const exact = await store.queryDataset(dataset.id, [{ column: "size", op: "eq", value: 3 }]);
    assert.equal(exact.length, 1);
    assert.equal(exact[0].data.size, "3");
    const browse = await store.listDatasetRows(dataset.id, undefined, undefined, 1, 1);
    assert.equal(browse.total, 2);
    assert.equal(browse.rows[0].data.size, "3");
    // Verify the expression index can serve the actual search predicate.
    await db.$executeRawUnsafe("SET enable_seqscan = off");
    const plan = await db.$queryRawUnsafe<any[]>(`EXPLAIN SELECT id FROM "DatasetRow" WHERE to_tsvector('english', regexp_replace("data"::text, '([[:lower:][:digit:]])([[:upper:]])', '\\1 \\2', 'g')) @@ websearch_to_tsquery('english', 'weld')`);
    assert.match(JSON.stringify(plan), /DatasetRow_reference_search_idx/);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org, other] } } });
    await db.$disconnect();
  }
});
