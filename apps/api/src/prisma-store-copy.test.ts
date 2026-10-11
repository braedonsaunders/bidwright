import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveApiPath } from "./paths.js";
import { PrismaApiStore } from "./prisma-store.js";

test("blind project copies retain file-only models and remap document and folder references", async (t) => {
  const sourceDir = await mkdtemp(join(tmpdir(), "bidwright-copy-"));
  t.after(() => rm(sourceDir, { recursive: true, force: true }));
  await writeFile(join(sourceDir, "plant.nwd"), "original model bytes");
  const rows: Record<string, any[]> = {
    project: [{ id: "source", organizationId: "org", name: "Model project", scope: "Project input scope", clientName: "Client", location: "Site", isStandalone: false }],
    quote: [{ id: "quote", projectId: "source", currentRevisionId: "revision" }],
    quoteRevision: [{ id: "revision", quoteId: "quote", createdAt: new Date(), updatedAt: new Date() }],
    sourceDocument: [{ id: "doc", projectId: "source", fileName: "plant.ifc", storagePath: "source/plant.ifc" }],
    fileNode: [
      { id: "folder", projectId: "source", type: "folder", scope: "project", name: "Models", metadata: {} },
      { id: "linked", projectId: "source", type: "file", scope: "project", name: "plant.ifc", parentId: "folder", documentId: "doc", metadata: {} },
      { id: "nwd", projectId: "source", type: "file", scope: "project", name: "plant.nwd", parentId: "folder", storagePath: join(sourceDir, "plant.nwd"), metadata: {} },
      { id: "knowledge", projectId: "source", type: "file", scope: "knowledge", name: "reference.ifc", metadata: {} },
    ],
    workspaceState: [],
  };
  const original = structuredClone(rows);
  const db: any = {};
  for (const [name, data] of Object.entries(rows)) {
    const matches = (row: any, where: any) => Object.entries(where).every(([key, value]) => row[key] === value);
    db[name] = {
      findFirst: async ({ where }: any) => data.find(row => matches(row, where)),
      findMany: async ({ where }: any) => data.filter(row => matches(row, where)),
      create: async ({ data: row }: any) => { data.push(row); return row; },
    };
  }
  db.$transaction = async (callback: any) => callback(db);
  const store = new PrismaApiStore(db, "org");
  t.mock.method(store as any, "nextQuoteNumber", async () => "COPY");
  const copied = await store.copyQuote("source", { resetEstimate: true });
  const files = rows.fileNode.filter(row => row.projectId === copied.project.id);
  const doc = rows.sourceDocument.find(row => row.projectId === copied.project.id)!;
  assert.equal(files.length, 3);
  const folder = files.find(row => row.name === "Models")!;
  const linked = files.find(row => row.name === "plant.ifc")!;
  const nwd = files.find(row => row.name === "plant.nwd")!;
  assert.notEqual(doc.id, "doc");
  assert.equal(linked.documentId, doc.id);
  assert.equal(linked.parentId, folder.id);
  assert.equal(nwd.parentId, folder.id);
  t.after(() => rm(resolveApiPath("projects", copied.project.id), { recursive: true, force: true }));
  assert.equal(copied.project.scope, "Project input scope");
  assert.equal(copied.project.clientName, "Client");
  assert.equal(copied.project.location, "Site");
  assert.ok(nwd.storagePath.startsWith(`projects/${copied.project.id}/files/`));
  assert.equal(await readFile(resolveApiPath(nwd.storagePath), "utf8"), "original model bytes");
  await writeFile(resolveApiPath(nwd.storagePath), "copied file edited");
  assert.equal(await readFile(join(sourceDir, "plant.nwd"), "utf8"), "original model bytes");
  assert.equal(copied.copyWarnings.length, 1);
  assert.match(copied.copyWarnings[0].message, /ENOENT/);
  assert.ok(doc.storagePath.startsWith(`projects/${copied.project.id}/files/`));
  assert.equal(nwd.documentId, null);
  assert.notEqual(nwd.id, "nwd");
  for (const name of ["sourceDocument", "fileNode"]) {
    assert.deepEqual(rows[name].filter(row => row.projectId === "source"), original[name]);
  }
});
