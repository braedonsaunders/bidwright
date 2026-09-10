import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import { normalizeSourceRef, sourceRefArray } from "./source-refs.js";

const schema = z.object({ sourceRefs: sourceRefArray("refs") });

test("strings pass through, trimmed", () => {
  assert.deepEqual(
    schema.parse({ sourceRefs: ["doc_abc123", "  lu-xyz789  "] }).sourceRefs,
    ["doc_abc123", "lu-xyz789"],
  );
});

test("an omitted array defaults to empty", () => {
  assert.deepEqual(schema.parse({}).sourceRefs, []);
});

test("object refs are accepted instead of failing the whole tool call", () => {
  // This is what the agent actually sent, and what came back as
  // "MCP error -32602: expected string, received object".
  const parsed = schema.parse({
    sourceRefs: [
      { documentId: "doc_3b409f90", page: 4 },
      { type: "library", title: "Cable Tray Spec.pdf" },
    ],
  });
  assert.deepEqual(parsed.sourceRefs, ["doc_3b409f90 p.4", "Cable Tray Spec.pdf"]);
});

test("an object with nothing identifiable is dropped, not stringified", () => {
  const parsed = schema.parse({ sourceRefs: [{ noExactMatch: true }, "kb-1a2b3c"] });
  assert.deepEqual(parsed.sourceRefs, ["kb-1a2b3c"], "no '[object Object]' entries");
});

test("normalized object refs satisfy the structured-cite rule", () => {
  // The point of accepting objects: the result has to actually pass the gate
  // that rejected the call in the first place.
  const looksStructured = (value: string) => /^[a-z]{2,8}[-_][a-z0-9]{6,}/i.test(value);
  assert.ok(looksStructured(normalizeSourceRef({ documentId: "doc_3b409f90a71c" })));
  assert.ok(looksStructured(normalizeSourceRef({ id: "lis_0001ce9912de0cef" })));
});
