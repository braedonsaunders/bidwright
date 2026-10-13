import assert from "node:assert/strict";
import test from "node:test";
import { componentCensus } from "./component-census";
import { summarizeDocumentCoverage } from "./document-coverage";
import { summarizePricingIntegrity, summarizeUnlinkedMeasurements } from "./estimate-review-facts";

const deviceSchedule = { pageNumber: 2, markdown: "| Type | Tag | Qty |\n|---|---|---|\n| Receptacle | R-101 | 4 |\n| Luminaire | L-201 | 8 |" };
const doorSchedule = { pageNumber: 3, markdown: "| Type | Tag |\n|---|---|\n| Hardware set A | D-101 |\n| Hardware set A | D-102 |\n| Hardware set A | D-102 |" };

test("electrical schedules and door hardware census keep methods, pages and duplicate tags separate", () => {
  const census = componentCensus([deviceSchedule, doorSchedule, { pageNumber: 1, markdown: "| Symbol | Description |\n|---|---|\n| X | Anchor |" }], [{ pageNumber: 2, text: "R-101 R-101 R-102" }], ["R"]);
  assert.equal(census.entries.find(e => e.type === "Receptacle")?.count, 4);
  assert.equal(census.entries.find(e => e.type === "Hardware set A")?.count, 2);
  assert.equal(census.entries.find(e => e.method === "legend entry")?.count, null);
  assert.equal(census.entries.find(e => e.method === "tagged text references")?.count, 2);
  assert.equal(census.entries.find(e => e.type === "Hardware set A")?.pageNumber, 3);
  assert.match(census.fact, /not additive/);
});

test("coverage merges text offsets without claiming table or tile reads cover an entire page", () => {
  const documents = [{ id: "electrical", name: "Device schedules", pageCount: 3 }, { id: "doors", name: "Door hardware", pageCount: 2 }];
  const read = { documentId: "electrical", tool: "readDocumentText", pages: [2], totalChars: 100, offset: 0, returnedChars: 50, truncated: true };
  let facts = summarizeDocumentCoverage(documents, [read]);
  assert.equal(facts.sources[0].unreadPageCount, 3);
  facts = summarizeDocumentCoverage(documents, [read, { ...read, offset: 50, truncated: false }, { ...read, tool: "getDocumentStructured", pages: [3], returnedChars: 100 }], [{ documentId: "electrical", tool: "readDrawingTile", pageNumber: 1 }]);
  assert.deepEqual(facts.sources[0].textPages, [2]);
  assert.deepEqual(facts.sources[0].unreadPages, [1,3]);
  assert.equal(facts.sources[0].truncatedReads, 2);
  assert.equal(facts.sources[1].status, "unread");
});

test("currency mismatches and missing currencies are facts for any trade", () => {
  const items = [{ id: "electrician", quantity: 1, cost: 40, price: 60, rateResolution: { currency: "USD" } }, { id: "finish-lift", quantity: 1, cost: 50, price: 80, rateResolution: {} }];
  const ws = { quoteCurrency: "CAD", worksheets: [{ items }] };
  const before = JSON.stringify(ws);
  const facts = summarizePricingIntegrity(ws).currency;
  assert.equal(facts.count, 2);
  assert.deepEqual(facts.rows.map((r: any) => r.status), ["currency differs", "currency unknown"]);
  assert.equal(JSON.stringify(ws), before);
});

test("equipment support coverage crosses worksheets using an authored scope and calendar", () => {
  const ws = { entityCategories: [{ id: "equipment", name: "Access", analyticsBucket: "equipment" }], worksheets: [
    { id: "devices", items: [{ id: "install", category: "Labour", quantity: 1, tierUnits: { regular: 160 } }] },
    { id: "finishes", items: [{ id: "paint", category: "Labour", quantity: 1, tierUnits: { regular: 80 } }] },
    { id: "rentals", items: [{ id: "lift", categoryId: "equipment", quantity: 1, uom: "WK", tierUnits: { week: 1 }, sourceEvidence: { durationBasis: { supportsWorksheetIds: ["devices", "finishes"], crewSize: 2, shiftHours: 8, workdaysPerWeek: 5 } } }] },
  ] };
  const facts = summarizePricingIntegrity(ws).durationChecks[0];
  assert.equal(facts.productionHours, 240); assert.equal(facts.requiredDays, 15); assert.equal(facts.coverageDays, 5); assert.equal(facts.differs, true);
});

test("cited and possible snapshot pickup dependencies are per row, not just globally unlinked", () => {
  const pickups = [{ id: "p", documentId: "drawing", label: "Devices", measurement: { value: 12, unit: "EA" } }];
  const ws = { worksheets: [{ items: [{ id: "linked", quantity: 12, uom: "EA" }, { id: "cited", derivation: { inputs: [{ source: { ref: "p" } }] } }, { id: "snapshot", quantity: 12, uom: "EA", sourceEvidence: { documentId: "drawing" } }] }], pickupLinks: [{ pickupId: "p", itemId: "linked" }] };
  const facts = summarizeUnlinkedMeasurements(ws, pickups);
  assert.equal(facts.count, 0); assert.equal(facts.snapshotDependencies.count, 2);
  assert.deepEqual(facts.snapshotDependencies.rows.map(r => r.rowId), ["cited", "snapshot"]);
});

test("a schedule quantity keeps its authored unit instead of relabelling it as a component count", () => {
  const result = componentCensus([{ markdown: "| Type | Qty | Unit |\n|---|---|---|\n| Wall finish | 40 | M2 |\n| Wall finish | 12 | FT2 |" }], []);
  assert.deepEqual(result.entries.map(e => [e.count, e.unit]), [[40, "M2"], [12, "FT2"]]);
});
