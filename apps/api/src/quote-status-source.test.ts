import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { resolveQuoteStatus } from "./store/mappers.js";

const store = readFileSync(new URL("./prisma-store.ts", import.meta.url), "utf8");
const schema = readFileSync(
  new URL("../../../packages/db/prisma/schema.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../../../packages/db/prisma/migrations/20260818000000_drop_quote_status/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

/** The Quote model block from schema.prisma. */
function quoteModel() {
  const start = schema.indexOf("model Quote {");
  assert.notEqual(start, -1, "Quote model not found");
  return schema.slice(start, schema.indexOf("\n}", start));
}

test("the Quote model has no status column", () => {
  // Two copies of status drifted: the quote's was written once as 'draft' and
  // never updated, so every list and dashboard row rendered "Other" - including
  // a quote that had actually been marked Awarded.
  const model = quoteModel();
  assert.ok(!/^\s+status\s+String/m.test(model), "Quote must not declare a status field");
  assert.match(migration, /ALTER TABLE "Quote" DROP COLUMN IF EXISTS "status"/);
});

test("nothing writes a status onto a quote row", () => {
  // Scoped to quote writes: other models legitimately have their own status
  // (KnowledgeDocument seeds 'draft', for one).
  const writes = [...store.matchAll(/(?:tx|this\.db)\.quote\.(?:create|update)\(\{/g)];
  assert.ok(writes.length > 0, "expected quote writes to exist");
  for (const write of writes) {
    const block = store.slice(write.index!, write.index! + 900);
    const body = block.slice(0, block.indexOf("\n      });") + 1 || block.length);
    assert.ok(
      !/^\s+status:/m.test(body),
      `a quote write still sets status:\n${body.slice(0, 300)}`,
    );
  }
});

test("a quote's status is its current revision's status", () => {
  const revisions = [
    { id: "rev-0", revisionNumber: 0, status: "Open" },
    { id: "rev-1", revisionNumber: 1, status: "Awarded" },
  ];
  assert.equal(resolveQuoteStatus({ currentRevisionId: "rev-1" }, revisions), "Awarded");
  assert.equal(resolveQuoteStatus({ currentRevisionId: "rev-0" }, revisions), "Open");
});

test("it falls back to the highest revision when currentRevisionId is unset", () => {
  const revisions = [
    { id: "rev-0", revisionNumber: 0, status: "Open" },
    { id: "rev-2", revisionNumber: 2, status: "Declined" },
    { id: "rev-1", revisionNumber: 1, status: "Pending" },
  ];
  assert.equal(resolveQuoteStatus({ currentRevisionId: null }, revisions), "Declined");
  assert.equal(resolveQuoteStatus({ currentRevisionId: "gone" }, revisions), "Declined");
});

test("a quote with no revisions reads as Open, never as a status the UI cannot label", () => {
  // "Other" was the symptom: the UI maps any unrecognised value to it.
  assert.equal(resolveQuoteStatus({ currentRevisionId: null }, []), "Open");
  assert.equal(resolveQuoteStatus({ currentRevisionId: "rev-1" }, [
    { id: "rev-1", revisionNumber: 1, status: "" },
  ]), "Open");
});

test("both project lists resolve status from the revision they already load", () => {
  for (const method of ["listProjectsWithState", "listProjectsForQuotesPage"]) {
    const start = store.indexOf(`async ${method}(`);
    assert.notEqual(start, -1, `${method} not found`);
    const rest = store.slice(start);
    const next = rest.search(/\n  (?:private |public )?async [a-zA-Z]/);
    const body = next === -1 ? rest : rest.slice(0, next);
    assert.match(body, /status: revision\?\.status \?\? "Open"/, `${method} must use the revision`);
  }
});

test("the paginated list filters and sorts on the revision's status", () => {
  // The page query returns ids only, so these drive filtering/ordering while the
  // row data comes from the mapping above - both must agree on the source.
  assert.match(store, /r\.status = ANY\(\$\$\{paramIdx\+\+\}::text\[\]\)/);
  assert.match(store, /r\.status AS q_status/);
});
