import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Guards the evidence-gate contract against the failure seen on the Birla
 * electrical quote, where 60 of 65 createWorksheetItem calls were rejected.
 *
 * The rules live inside a closure in quote-tools.ts, so these reimplement the
 * two predicates from the source rather than importing them. The source is read
 * here so a change to the regex that does not update this file is visible.
 */

const source = readFileSync(new URL("./quote-tools.ts", import.meta.url), "utf8");

/** The separator class in looksLikeStructuredSourceRef's id patterns. */
function structuredRefPatterns() {
  const prefixed = source.match(/if \((\/\^\(doc\|document[^)]+?\)\[[^\]]+\]\/i)\.test\(value\)\) return true;/);
  const bareId = source.match(/if \((\/\^\[a-z\]\{2,8\}\[?[^/]*?\/i)\.test\(value\)\) return true;/);
  assert.ok(prefixed, "prefixed-id pattern not found in looksLikeStructuredSourceRef");
  assert.ok(bareId, "bare-id pattern not found in looksLikeStructuredSourceRef");
  return [prefixed[1], bareId[1]].map((literal) => {
    const body = literal.slice(1, literal.lastIndexOf("/"));
    return new RegExp(body, "i");
  });
}

function looksStructured(value: string) {
  return structuredRefPatterns().some((pattern) => pattern.test(value));
}

// ── The ids the system actually mints ──────────────────────────────────────

test("every id format the system mints counts as a structured source ref", () => {
  // doc_ and lis_ use an underscore. A hyphen-only rule scored a correctly
  // cited source document as zero structured refs, so the row was rejected for
  // "needs structured cite" no matter how accurately the agent cited it.
  const minted = [
    "doc_b25cb79d-b387-45f1-9248-3eaf2641335c",   // SourceDocument
    "lis_0001ce9912de0cef8faa8c84a220143e",       // LineItemSearchDocument
    "ecost-816cd480-1fb8-41d3-bef4-38646887b7ea", // EffectiveCost
    "rci-b4124b70-0415-4f01-8bb8-ba4689d37af7",   // ResourceCatalogItem
    "kb-b32cb26d-362d-45e5-a414-ee3162b74eaf",    // KnowledgeBook
    "ds-9f87cb2a-c384-4300-a280-6f627db1c0aa",    // Dataset
    "lu-3229b9dc-1f9b-4313-a911-ec75a619af2b",    // LaborUnit
    "rsi-4ec986af-dbf3-4674-a5ff-5c5344044cb1",   // RateScheduleItem
  ];
  for (const id of minted) {
    assert.ok(looksStructured(id), `${id} must count as a structured cite`);
  }
});

test("prose is still not a structured source ref", () => {
  // The agent tried these when it could not work out the required format; they
  // must keep failing, or the gate stops meaning anything.
  for (const value of ["best judgment", "see notes", "similar project", "n/a"]) {
    assert.equal(looksStructured(value), false, `${value} must not pass`);
  }
});

test("the rejection hint only names prefixes that exist", () => {
  const hint = source.match(/const STRUCTURED_SOURCE_REF_HINT = "([^"]+)"/);
  assert.ok(hint, "hint constant not found");
  assert.ok(
    !/\bdoc-</.test(hint[1]),
    "must not tell the agent to use doc-<id>; SourceDocument mints doc_<id>",
  );
  assert.match(hint[1], /doc_/, "names the real document id form");
  for (const message of [
    "Labour row needs laborUnitId",
    "Material/Sub/Equip/Allowance row needs",
    "row needs costResourceId/effectiveCostId/itemId",
  ]) {
    const index = source.indexOf(message);
    assert.notEqual(index, -1, `gate message missing: ${message}`);
    assert.match(
      source.slice(index - 120, index + 320),
      /STRUCTURED_SOURCE_REF_HINT/,
      `"${message}" must show the agent a usable cite format`,
    );
  }
});

// ── Truncated tool calls ───────────────────────────────────────────────────

/** Mirrors looksLikeTruncatedItemPayload. */
function looksTruncated(input: Record<string, unknown>) {
  const fields = JSON.parse(
    (source.match(/const WORKSHEET_ITEM_PAYLOAD_FIELDS = \[([\s\S]*?)\] as const;/) as RegExpMatchArray)[1]
      .replace(/,\s*$/, "")
      .replace(/^/, "[")
      .replace(/$/, "]")
      .replace(/'/g, '"'),
  ) as string[];
  const carries = fields.some((key) => {
    const value = input[key];
    if (value === undefined || value === null || value === "") return false;
    if (typeof value === "object" && Object.keys(value as object).length === 0) return false;
    return true;
  });
  if (carries) return false;
  return !String(input.description ?? "").trim() && !String(input.sourceNotes ?? "").trim();
}

test("a call carrying only the required fields is reported as truncated", () => {
  // The exact payload recorded 39 times on the Birla run, which the server
  // answered with "Line evidence basis is required" -- true, but it sent the
  // agent rewriting evidenceBasis instead of resending a smaller call.
  assert.equal(
    looksTruncated({
      entityName: 'Cable Tray — Aluminum Ladder 12" (supply)',
      worksheetId: "worksheet-a3ca93c9-15a7-4a3a-b4ba-0f97f307735c",
      description: "",
      sourceNotes: "",
      quantity: 1,
      uom: "EA",
    }),
    true,
  );
});

test("a real row is never mistaken for a truncated one", () => {
  assert.equal(
    looksTruncated({
      entityName: "Electrician",
      worksheetId: "worksheet-1",
      categoryId: "ecat-240a9ccf",
      quantity: 1,
      uom: "HR",
      sourceNotes: "NECA-12233 VFD 25-50 HP 9.5 HR/EA x 2",
    }),
    false,
  );
  assert.equal(
    looksTruncated({ entityName: "Row", worksheetId: "w1", evidenceBasis: { type: "mixed" } }),
    false,
  );
});

test("the truncation message tells the agent to change shape, not to retry", () => {
  const message = source.match(/const TRUNCATED_ITEM_PAYLOAD_MESSAGE = \[([\s\S]*?)\]\.join/);
  assert.ok(message, "truncation message not found");
  assert.match(message[1], /cut off/i, "names the actual cause");
  assert.match(message[1], /createRateScheduleWorksheetItem/, "points at the smaller tool");
  assert.match(message[1], /Do not retry the same way/i, "stops the retry loop");
});
