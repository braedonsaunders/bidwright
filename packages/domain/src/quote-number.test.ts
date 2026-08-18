import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_QUOTE_NUMBER_PATTERN,
  formatQuoteNumber,
  initialsFromName,
  nextQuoteNumberSequence,
  patternUsesSequence,
  quoteNumberSequenceMatcher,
  validateQuoteNumberPattern,
} from "./quote-number.js";

const AUG_18 = new Date(Date.UTC(2026, 7, 18));

test("renders the pattern the estimator asked for", () => {
  assert.equal(
    formatQuoteNumber("{INITIALS}-{YY}{MM}{DD}-{SEQ:4}", {
      initials: "BS",
      date: AUG_18,
      sequence: 35,
    }),
    "BS-260818-0035",
  );
});

test("the default pattern preserves the historical BW format", () => {
  const value = formatQuoteNumber(DEFAULT_QUOTE_NUMBER_PATTERN, { date: AUG_18 });
  assert.match(value, /^BW-260818-[0-9A-F]{4}$/);
});

test("sequence padding is configurable and defaults to 4", () => {
  const ctx = { initials: "BS", date: AUG_18, sequence: 7 };
  assert.equal(formatQuoteNumber("{SEQ}", ctx), "0007");
  assert.equal(formatQuoteNumber("{SEQ:2}", ctx), "07");
  assert.equal(formatQuoteNumber("{SEQ:6}", ctx), "000007");
});

test("initials come from a display name", () => {
  assert.equal(initialsFromName("Braedon Saunders"), "BS");
  assert.equal(initialsFromName("mary jane o'brien"), "MJO");
  assert.equal(initialsFromName(""), "");
  assert.equal(initialsFromName(null), "");
});

test("an unknown token stays visible instead of vanishing", () => {
  // Silently dropping it would ship a broken number to every quote.
  assert.equal(formatQuoteNumber("X-{NOPE}-{SEQ:2}", { sequence: 1 }), "X-{NOPE}-01");
  assert.deepEqual(validateQuoteNumberPattern("X-{NOPE}-{SEQ}"), ["Unknown token {NOPE}."]);
});

test("the sequence only counts numbers from the same scope", () => {
  const pattern = "{INITIALS}-{YY}{MM}{DD}-{SEQ:4}";
  const ctx = { initials: "BS", date: AUG_18 };
  const existing = [
    "BS-260818-0001",
    "BS-260818-0035",
    "BS-260817-0099", // yesterday - must not raise today's counter
    "MJ-260818-0500", // another user - must not raise BS's counter
    "BW-260818-A3F9", // legacy random-format number
  ];
  assert.equal(nextQuoteNumberSequence(pattern, existing, ctx), 36);
});

test("a pattern without date or initials runs one continuous sequence", () => {
  const pattern = "EST-{SEQ:3}";
  assert.equal(nextQuoteNumberSequence(pattern, ["EST-004", "EST-011"], {}), 12);
});

test("max+1 means deleting a quote never reissues its number", () => {
  const pattern = "EST-{SEQ:3}";
  // 011 was deleted; the next number must still be 012, not 011.
  assert.equal(nextQuoteNumberSequence(pattern, ["EST-010", "EST-012"], {}), 13);
});

test("the first number in an empty org is 1", () => {
  assert.equal(nextQuoteNumberSequence("EST-{SEQ:3}", [], {}), 1);
  assert.equal(formatQuoteNumber("EST-{SEQ:3}", { sequence: 1 }), "EST-001");
});

test("patterns without a sequence need no lookup", () => {
  assert.equal(patternUsesSequence(DEFAULT_QUOTE_NUMBER_PATTERN), false);
  assert.equal(patternUsesSequence("{SEQ:4}"), true);
  assert.equal(quoteNumberSequenceMatcher(DEFAULT_QUOTE_NUMBER_PATTERN), null);
  assert.equal(nextQuoteNumberSequence(DEFAULT_QUOTE_NUMBER_PATTERN, ["anything"]), 1);
});

test("regex metacharacters in a pattern are escaped, not interpreted", () => {
  const pattern = "A.B-{SEQ:2}";
  const matcher = quoteNumberSequenceMatcher(pattern)!;
  assert.ok(matcher.test("A.B-07"));
  assert.ok(!matcher.test("AXB-07"), "'.' must be literal");
});

test("a pattern that cannot produce unique numbers is rejected", () => {
  assert.deepEqual(validateQuoteNumberPattern(""), ["Pattern cannot be empty."]);
  assert.deepEqual(validateQuoteNumberPattern("FIXED-2026"), [
    "Pattern has no tokens, so every quote would get the same number.",
    "Add {SEQ} or {RAND} so each quote gets a distinct number.",
  ]);
  assert.deepEqual(validateQuoteNumberPattern("{INITIALS}-{YY}"), [
    "Add {SEQ} or {RAND} so each quote gets a distinct number.",
  ]);
  assert.deepEqual(validateQuoteNumberPattern("{INITIALS}-{YY}{MM}{DD}-{SEQ:4}"), []);
});
