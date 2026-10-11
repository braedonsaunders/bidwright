import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@bidwright/db";
import { repairStoredNativePdfPageCount } from "./vision-routes.js";

test("reading a FileNode PDF does not repair a nonexistent SourceDocument", async t => {
  const original = prisma.sourceDocument.update;
  const writes: any[] = [];
  prisma.sourceDocument.update = (async (input: any) => { writes.push(input); return {}; }) as any;
  t.after(() => { prisma.sourceDocument.update = original; });
  await repairStoredNativePdfPageCount({ id: "fn-pdf", source: "file_node" }, 12);
  await repairStoredNativePdfPageCount({ id: "book", source: "knowledge_book" }, 12);
  assert.equal(writes.length, 0);
  await repairStoredNativePdfPageCount({ id: "doc", fileNodeId: "fn-linked", pageCount: 1 }, 12);
  assert.equal(writes[0].where.id, "doc");
  assert.equal(writes[0].data.pageCount, 12);
});
