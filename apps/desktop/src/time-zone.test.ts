import assert from "node:assert/strict";
import test from "node:test";

import { isIanaTimeZone, resolveIanaTimeZone } from "./time-zone.js";

test("desktop TZ helper rejects Windows display names", () => {
  assert.equal(isIanaTimeZone("Pacific Standard Time"), false);
  assert.equal(resolveIanaTimeZone("Pacific Standard Time", null), "UTC");
  assert.equal(resolveIanaTimeZone("America/Los_Angeles", null), "America/Los_Angeles");
});
