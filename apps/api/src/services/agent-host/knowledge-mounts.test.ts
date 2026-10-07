import assert from "node:assert/strict";
import test from "node:test";

import { authorizedKnowledgeMounts } from "./knowledge-mounts.js";

const deps = (books: Array<{ storagePath: string | null }>, seen: string[] = []) => ({
  knowledgeRoot: "/data/knowledge",
  dataRoot: "/data",
  exists: (path: string) => !path.includes("missing"),
  loadOrganizationBooks: async (projectId: string) => {
    seen.push(projectId);
    return books;
  },
});

test("binds exactly the organisation's book files the workspace links to", async () => {
  const seen: string[] = [];
  const mounts = await authorizedKnowledgeMounts("/data/projects/project-abc", deps([
    { storagePath: "knowledge/kb-1/Estimators Piping Man Hour.pdf" },
    { storagePath: "knowledge/kb-2/Mechanical Estimating Manual.pdf" },
    { storagePath: "knowledge/kb-1/Estimators Piping Man Hour.pdf" },
    { storagePath: null },
  ], seen));
  assert.deepEqual(seen, ["project-abc"]);
  assert.deepEqual(mounts, [
    "/data/knowledge/kb-1/Estimators Piping Man Hour.pdf",
    "/data/knowledge/kb-2/Mechanical Estimating Manual.pdf",
  ]);
});

test("never binds anything outside the knowledge root or a missing file", async () => {
  const mounts = await authorizedKnowledgeMounts("/data/projects/project-abc", deps([
    { storagePath: "../etc/shadow" },
    { storagePath: "projects/project-other/documents/secret.pdf" },
    { storagePath: "knowledge" },
    { storagePath: "knowledge/kb-9/missing.pdf" },
    { storagePath: "knowledge/kb-3/ok.pdf" },
  ]));
  assert.deepEqual(mounts, ["/data/knowledge/kb-3/ok.pdf"]);
});

test("non-project workspaces get no knowledge mounts", async () => {
  const seen: string[] = [];
  assert.deepEqual(await authorizedKnowledgeMounts("/data/agent-home/users/u1", deps([{ storagePath: "knowledge/kb-1/a.pdf" }], seen)), []);
  assert.deepEqual(seen, []);
});
