import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { laborSearchProfile, rankLaborCandidates, laborGranularityFacts } from "./labor-search.js";
import { matchLaborBreakdown } from "./labor-unit-matching.js";

// Compact captured library rows, including false positives; tests never access the shared database.
const rows = JSON.parse(readFileSync(new URL("./fixtures/labor-retrieval.json", import.meta.url), "utf8"));
const rank = (query: string, candidates = rows) => rankLaborCandidates<any>(candidates, laborSearchProfile(query));

test("structural queries prefer the task over coating headers and electrical structure connectors", () => {
  const erect = { id: "erect", name: "Erection of structural steel", outputUom: "TON", hoursNormal: 10 };
  assert.equal(rank("erect structural steel", [...rows, erect])[0].item.id, "erect");
  const structural = rank("fabricate structural steel ton")[0].item;
  assert.equal(structural.name, "Structural");
  assert.equal(structural.outputUom, "TON");
  assert.equal(structural.hoursNormal, 11.33);
  // The captured corpus has a generic structural row, not an explicit erection row.
  assert.equal(rank("erect structural steel")[0].item.name, "Structural");
});

test("welding and piping retrieval preserves size, material and operation", () => {
  assert.equal(rank("1/4 fillet weld carbon steel")[0].item.outputUom, "FT");
  assert.equal(rank("1/4 fillet weld carbon steel")[0].item.name, "1/4 Fillet Weld (Carbon Steel)");
  const butt = rank("butt weld 3 inch sch 10 stainless").slice(0, 2).map(entry => entry.item.name);
  assert.ok(butt.every(name => /Butt Weld.*NPS 3\b/i.test(name)));
  assert.ok(butt.some(name => /Stainless/i.test(name)));
  assert.match(rank("install 3 inch butterfly valve lug")[0].item.name, /Lug Style.*Dia 3/);
  assert.match(rank("hydrotest piping")[0].item.category, /Hydrostatic Testing/);
});

test("a repeated sibling header cannot outweigh an actual selected operation", () => {
  const result = rank("prime coat", [
    { name: "Assemble beam", className: "Prime Coat - First Coat - Add. Coat ".repeat(20), sourceRef: { valueColumnName: "Assembly" } },
    { name: "Brush prime coat", sourceRef: { valueColumnName: "Prime Coat" } },
  ]);
  assert.equal(result[0].item.name, "Brush prime coat");
  assert.ok(result[1].contextOnlyTerms.length);
});

test("weak or incompatible assembly matches expose table operations and units", async () => {
  const units: any[] = [
    { name: "Plates", outputUom: "EA", library: { name: "Steel Fabrication" }, className: "Connections" },
    { name: "Fillet weld", outputUom: "FT", library: { name: "Steel Fabrication" }, className: "Weld" },
    { name: "Unload", outputUom: "TONNE", library: { name: "Steel Fabrication" } },
  ];
  let lookups = 0;
  const result = await matchLaborBreakdown([
    { operation: "fabricate frame", quantity: 2, uom: "TON" },
    { operation: "plates", quantity: 2, uom: "TON" },
    { operation: "plates", quantity: 2, uom: "EA" },
  ], undefined, async () => ({ units }), async () => { lookups++; return laborGranularityFacts(units); });
  assert.equal(result.lines[0].status, "no good match");
  assert.match(result.lines[0].granularity.fact, /Plates.*EA.*Fillet weld.*FT.*Unload.*TONNE/);
  assert.equal(result.lines[1].status, "candidates");
  assert.ok(result.lines[1].granularity);
  assert.equal(result.lines[2].granularity, undefined);
  assert.equal(lookups, 2);
});

test("fractional nominal sizes do not penalize equal fractions or confuse them with whole inches", () => {
  const candidates = [
    { id: "half", name: "Butt weld NPS 1/2", outputUom: "EA" },
    { id: "two", name: "Butt weld NPS 2", outputUom: "EA" },
  ];
  assert.equal(rank("butt weld 1/2 inch", candidates)[0].item.id, "half");
  assert.equal(rank("butt weld 0.5 inch", candidates)[0].item.id, "half");
});
