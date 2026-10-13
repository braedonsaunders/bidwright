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

test("outputs and their linked extractions do not inflate source coverage", async () => {
  const db: any = {
    sourceDocument: { findMany: async () => [
      { id: "spec", fileName: "Electrical specifications.pdf", pageCount: 572 },
      { id: "appendix", fileName: "Equipment appendix.pdf", pageCount: 403 },
      { id: "doors", fileName: "Door hardware.pdf", pageCount: 30 },
      { id: "output-doc", fileName: "Review.pdf", pageCount: 12 },
      { id: "output-meta-doc", fileName: "Basis.pdf", pageCount: 5 },
    ] },
    activity: { findMany: async () => [] },
    evidenceView: { findMany: async () => [{ documentId: "spec", pageNumber: 4, tool: "readDrawingPage" }] },
    fileNode: { findMany: async () => [
      { id: "out", name: "Estimate.md", metadata: { createdByAgent: true } },
      { id: "out-doc", documentId: "output-doc", metadata: { createdByAgent: true } },
      { id: "out-meta", metadata: { createdByAgent: true, sourceDocumentId: "output-meta-doc" } },
      // An imported/extracted source is still a source, even when an agent imported it.
      { id: "input", documentId: "doors", metadata: {} },
    ] },
  };
  const coverage = await getDocumentCoverage("fixture", db);
  assert.equal(coverage.totalDocuments, 3);
  assert.deepEqual(coverage.sources.map(s => s.documentId), ["appendix", "doors", "spec"]);
  assert.equal(coverage.sources[2].pageCoverage, "1/572 pages delivered");
  assert.equal(coverage.sources[0].pageCoverage, "0/403 pages delivered");
  assert.equal(coverage.sources.reduce((sum, s) => sum + (s.pageCount ?? 0), 0), 1005);
});
