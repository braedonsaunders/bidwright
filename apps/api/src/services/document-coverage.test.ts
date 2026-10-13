import assert from "node:assert/strict";
import test from "node:test";
import { getDocumentCoverage } from "./document-coverage.js";

test("coverage resolves FileNode evidence aliases without duplicating linked documents", async () => {
  const db: any = {
    sourceDocument: { findMany: async () => [{ id: "doc-electrical", fileName: "Device schedule.pdf", pageCount: 2, checksum: "current" }] },
    activity: { findMany: async () => [{ data: { documentId: "doc-electrical", tool: "readDocumentText", pages: [1], offset: 0, returnedChars: 40, totalChars: 40, checksum: "obsolete" } }] },
    evidenceView: { findMany: async () => [{ documentId: "file-fn-electrical", pageNumber: 2, tool: "readDrawingPage", sourceChecksum: "current" }] },
    fileNode: { findMany: async () => [{ id: "fn-electrical", name: "Device schedule.pdf", documentId: null, metadata: { sourceDocumentId: "doc-electrical" } }, { id: "fn-doors", name: "Door schedule.xlsx", documentId: null, metadata: {} }] },
  };
  const coverage = await getDocumentCoverage("project-fixture", db);
  assert.equal(coverage.sources.length, 2);
  assert.deepEqual(coverage.sources.find(s => s.documentId === "doc-electrical")!.viewedPages, [2]);
  assert.deepEqual(coverage.sources.find(s => s.documentId === "doc-electrical")!.unreadPages, [1], "obsolete text reads do not cover a changed source");
  assert.equal(coverage.sources.find(s => s.documentId === "fn-doors")!.status, "unread");
});
