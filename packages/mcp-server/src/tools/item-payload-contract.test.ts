import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Guards the worksheet-item payload contract (truncated payloads, batch
 * shapes). Originally added for an
 * electrical quote, where 60 of 65 createWorksheetItem calls were rejected.
 *
 * The rules live inside a closure in quote-tools.ts, so these reimplement the
 * two predicates from the source rather than importing them. The source is read
 * here so a change to the regex that does not update this file is visible.
 */

const source = readFileSync(new URL("./quote-tools.ts", import.meta.url), "utf8");

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
  // The exact payload recorded 39 times on that run, which the server
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

test("batchEditWorksheetItems documents the exact operation shapes", () => {
  // Round-3 GPT needed three calls to find the shape ({type,data}, flat fields, worksheetId inside item).
  const start = source.indexOf('"batchEditWorksheetItems",');
  const description = source.slice(start, source.indexOf("].join", start));
  assert.match(description, /\{"op":"create","worksheetId":"worksheet-…","item":\{/);
  assert.match(description, /\{"op":"update","itemId":"li-…","patch":\{/);
  assert.match(description, /\{"op":"delete","itemId":"li-…"\}/);
  assert.match(description, /no "type" or "data" key/);
});
