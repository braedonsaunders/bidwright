import test from "node:test";
import assert from "node:assert/strict";
import { firstAutodeskSelectedDbId } from "./autodesk-viewer-selection";

test("firstAutodeskSelectedDbId reads ordinary selection events", () => {
  assert.equal(firstAutodeskSelectedDbId({ dbIdArray: [381, 902] }), 381);
});

test("firstAutodeskSelectedDbId reads aggregate selection events", () => {
  assert.equal(firstAutodeskSelectedDbId({ selections: [{ dbIdArray: [] }, { dbIdArray: [44] }] }), 44);
});

test("firstAutodeskSelectedDbId treats a cleared selection as null", () => {
  assert.equal(firstAutodeskSelectedDbId({ dbIdArray: [] }), null);
});
