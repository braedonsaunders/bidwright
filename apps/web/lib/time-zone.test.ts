import assert from "node:assert/strict";
import test from "node:test";

import { isIanaTimeZone, resolveIanaTimeZone } from "./time-zone.js";

test("accepts IANA zones and rejects Windows display names", () => {
  assert.equal(isIanaTimeZone("America/New_York"), true);
  assert.equal(isIanaTimeZone("America/Indiana/Indianapolis"), true);
  assert.equal(isIanaTimeZone("UTC"), true);
  assert.equal(isIanaTimeZone("Etc/GMT+5"), true);
  assert.equal(isIanaTimeZone("Eastern Standard Time"), false);
  assert.equal(isIanaTimeZone("EST"), false);
  assert.equal(isIanaTimeZone(""), false);
});

test("skips Windows TZ names and falls back to the host zone or UTC", () => {
  assert.equal(resolveIanaTimeZone("Eastern Standard Time", "America/Toronto"), "America/Toronto");
  assert.equal(resolveIanaTimeZone("Eastern Standard Time", null), "UTC");
  assert.equal(resolveIanaTimeZone("America/Toronto", null), "America/Toronto");
});
