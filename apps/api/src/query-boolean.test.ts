import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { z } from "zod";

import { parseQueryBoolean } from "./query-boolean.js";

test("query-string false stays false — z.coerce.boolean treats it as true", () => {
  assert.equal(z.coerce.boolean().parse("false"), true, "documents the Zod footgun");
  assert.equal(parseQueryBoolean("false"), false);
  assert.equal(parseQueryBoolean("true"), true);
  assert.equal(parseQueryBoolean("0"), false);
  assert.equal(parseQueryBoolean("1"), true);
  assert.equal(parseQueryBoolean(undefined), undefined);
});

test("line-item search does not coerce refresh=false into a full index rebuild", () => {
  const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/projects/:projectId/line-item-search"');
  assert.notEqual(start, -1, "line-item-search route missing");
  const rest = source.slice(start, start + 2500);
  assert.match(rest, /parseQueryBoolean/, "must parse refresh with parseQueryBoolean");
  assert.doesNotMatch(rest, /z\.coerce\.boolean/, "z.coerce.boolean turns refresh=false into a rebuild");
});
