import assert from "node:assert/strict";
import test from "node:test";
import { searchReferenceBookPages } from "./reference-book-pages.js";

test("original PDF search returns physical pages and preserves the source table text", () => {
  const hits = searchReferenceBookPages(["Contents", "WELDING\n3/4 inch | 0.7 hours", "WELDING\n3 inch | 2.1 hours\nShop conditions"], "3 inch welding");
  assert.equal(hits[0].pageNumber, 3);
  assert.match(hits[0].text, /3 inch \| 2\.1 hours\nShop conditions/);
  assert.deepEqual(searchReferenceBookPages(["", ""], "welding"), []);
});
