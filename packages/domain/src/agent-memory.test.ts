import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAgentMemory, setAgentMemorySection } from "./agent-memory.js";

test("keeps sections from both the API and the old flat agent shape", () => {
  const memory = normalizeAgentMemory({
    sections: { ingestion_results: "3 documents" },
    updatedAt: "2026-10-07T20:06:00.000Z",
    progress: "read p.4",
    decisions: { anchors: 5 },
  });
  assert.deepEqual(memory.sections, { progress: "read p.4", decisions: "{\"anchors\":5}", ingestion_results: "3 documents" });
  assert.equal(memory.updatedAt, "2026-10-07T20:06:00.000Z");
});

test("nested sections win over a stale flat duplicate", () => {
  assert.equal(normalizeAgentMemory({ progress: "old", sections: { progress: "new" } }).sections.progress, "new");
});

test("garbage normalises to an empty memory", () => {
  for (const raw of [null, undefined, "x", 3, []]) {
    assert.deepEqual(normalizeAgentMemory(raw), { sections: {}, updatedAt: null });
  }
});

test("setting a section replaces or appends without touching others", () => {
  const base = normalizeAgentMemory({ sections: { a: "1", b: "2" } });
  assert.deepEqual(setAgentMemorySection(base, "a", "3").sections, { a: "3", b: "2" });
  assert.deepEqual(setAgentMemorySection(base, "a", "3", true).sections, { a: "1\n3", b: "2" });
  assert.deepEqual(setAgentMemorySection(base, "c", "4", true).sections, { a: "1", b: "2", c: "4" });
});
