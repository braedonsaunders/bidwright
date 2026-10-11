import test from "node:test";
import assert from "node:assert/strict";
import { canPromoteSourceFile, resolveProjectSource } from "./project-source-resolver.js";

test("project source resolution accepts literal copied ids and UI keys without stripping real ids", async () => {
  const files: Record<string, any> = {
    "fn-one": { id: "fn-one", projectId: "p", type: "file", name: "one.pdf", storagePath: "one" },
    "file-copy": { id: "file-copy", projectId: "p", type: "file", name: "copy.pdf", storagePath: "copy" },
    "fn-linked": { id: "fn-linked", projectId: "p", type: "file", documentId: "doc", name: "linked.pdf" },
    "fn-foreign": { id: "fn-foreign", projectId: "other", type: "file" },
  };
  const store = { getFileNode: async (id: string) => files[id] ?? null,
    getDocument: async (_project: string, id: string) => id === "doc" ? { id, storagePath: "document" } : null };
  for (const [id, expected] of [["fn-one", "fn-one"], ["file-fn-one", "fn-one"], ["file-copy", "file-copy"], ["file-file-copy", "file-copy"]]) {
    const source = await resolveProjectSource(store, "p", id);
    assert.equal(source?.fileNodeId, expected);
    assert.equal(source?.documentId, `file-${expected}`);
  }
  assert.equal((await resolveProjectSource(store, "p", "file-fn-linked"))?.doc.id, "doc");
  assert.equal((await resolveProjectSource(store, "p", "doc"))?.fileNodeId, undefined);
  assert.equal(await resolveProjectSource(store, "p", "file-fn-foreign"), null);
});

test("single-source promotion refuses archives and model formats before reading bytes", () => {
  for (const file of ["a.nwd", "a.rvt", "a.ifc", "a.zip", "a.7z", "a.tar.gz", "a.rar"]) assert.equal(canPromoteSourceFile(file), false);
  for (const file of ["a.pdf", "a.xlsx", "a.txt"]) assert.equal(canPromoteSourceFile(file), true);
});
