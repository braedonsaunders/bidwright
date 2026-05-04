import test from "node:test";
import assert from "node:assert/strict";
import { buildCsv, escapeCsvCell, neutralizeCsvFormula } from "./csv";

test("neutralizeCsvFormula prefixes cells spreadsheet apps may execute", () => {
  assert.equal(neutralizeCsvFormula("=A1+A2"), "'=A1+A2");
  assert.equal(neutralizeCsvFormula("+15555550123"), "'+15555550123");
  assert.equal(neutralizeCsvFormula("-42"), "'-42");
  assert.equal(neutralizeCsvFormula("@cmd"), "'@cmd");
  assert.equal(neutralizeCsvFormula("ordinary text"), "ordinary text");
});

test("escapeCsvCell quotes after formula neutralization", () => {
  assert.equal(escapeCsvCell('=HYPERLINK("http://example.com")'), '"\'=HYPERLINK(""http://example.com"")"');
});

test("buildCsv applies one export policy across headers and rows", () => {
  assert.equal(buildCsv(["Name", "Qty"], [["=SUM(A1:A2)", 2]]), "Name,Qty\n'=SUM(A1:A2),2");
});
