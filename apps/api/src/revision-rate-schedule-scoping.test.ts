import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const store = readFileSync(new URL("./prisma-store.ts", import.meta.url), "utf8");

/** Body of a method in prisma-store.ts, from its signature to the next one. */
function methodBody(name: string) {
  const start = store.indexOf(`async ${name}(`);
  assert.notEqual(start, -1, `${name} not found in prisma-store.ts`);
  const rest = store.slice(start + name.length);
  const next = rest.search(/\n  (?:private |public )?async [a-zA-Z]/);
  return next === -1 ? rest : rest.slice(0, next);
}

test("createRevision rebuilds the rate-schedule search index", () => {
  // The bug: createRevision copies the rate schedules into the new revision and
  // repoints the quote at it, but the search index is scoped to the current
  // revision. Without a rebuild the picker keeps offering the OLD revision's
  // rateScheduleItemIds, which updateWorksheetItemWithSnapshot then rejects —
  // "no matching rate schedule item found in this revision" on every save.
  const body = methodBody("createRevision");
  assert.match(
    body,
    /refreshRateScheduleSearchDocuments\(projectId\)/,
    "createRevision must refresh the search index after copying rate schedules",
  );
});

test("createRevision refreshes after the transaction commits, not inside it", () => {
  // The refresh reads Quote.currentRevisionId, so it has to observe the
  // committed switch to the new revision.
  const body = methodBody("createRevision");
  const commitIdx = body.indexOf("return mapRevision(newRevision!)");
  const refreshIdx = body.indexOf("refreshRateScheduleSearchDocuments(projectId)");
  assert.ok(commitIdx !== -1 && refreshIdx !== -1, "expected both markers present");
  assert.ok(refreshIdx > commitIdx, "refresh must run after the transaction callback returns");
});

test("the line-item picker query is scoped to the current revision's schedules", () => {
  // Defence in depth: refreshRateScheduleSearchDocuments swallows its errors, so
  // a failed rebuild must not leave the picker serving unusable ids.
  const body = methodBody("searchLineItemCandidates");
  assert.match(
    body,
    /currentRevisionRateScheduleIds\(projectId\)/,
    "search must resolve the current revision's schedule ids",
  );
  assert.match(
    body,
    /d\."sourceType" <> 'rate_schedule_item'\s*\n\s*OR \(d\."payload"->>'scheduleId'\) = ANY\(\$14::text\[\]\)/,
    "search must filter rate-schedule docs to the current revision's schedules",
  );
});

test("the revision-scope parameter is actually bound to the query", () => {
  // A $14 in the SQL with only 13 arguments passed would throw at runtime.
  const body = methodBody("searchLineItemCandidates");
  const highest = Math.max(
    ...[...body.matchAll(/\$(\d+)::/g)].map((m) => Number(m[1])),
  );
  assert.equal(highest, 14, `expected $14 to be the highest bound param, saw $${highest}`);
  assert.match(body, /\n      currentRevisionScheduleIds,\n/, "the 14th argument must be passed");
});

test("currentRevisionRateScheduleIds resolves via the quote's current revision", () => {
  const body = methodBody("currentRevisionRateScheduleIds");
  assert.match(body, /findCurrentRevision\(projectId\)/);
  assert.match(body, /revisionId: revision\.id/, "must filter schedules by the resolved revision");
  assert.match(body, /if \(!revision\) return \[\]/, "no revision means nothing is offerable");
});
