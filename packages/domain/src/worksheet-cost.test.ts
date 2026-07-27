import test from "node:test";
import assert from "node:assert/strict";

import { isWorksheetCostLibraryManaged } from "./worksheet-cost";

test("manual category rows remain user-owned without a library reference", () => {
  assert.equal(isWorksheetCostLibraryManaged({}), false);
  assert.equal(isWorksheetCostLibraryManaged({ itemId: null }), false);
});

test("catalog and other library references own the row cost", () => {
  assert.equal(isWorksheetCostLibraryManaged({ itemId: "stock-item" }), true);
  assert.equal(isWorksheetCostLibraryManaged({ costResourceId: "cost-resource" }), true);
  assert.equal(isWorksheetCostLibraryManaged({ effectiveCostId: "effective-cost" }), true);
  assert.equal(isWorksheetCostLibraryManaged({ rateScheduleItemId: "rate-item" }), true);
});
