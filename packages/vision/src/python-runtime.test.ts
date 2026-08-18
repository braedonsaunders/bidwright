import assert from "node:assert/strict";
import test from "node:test";

import { parsePythonJson } from "./python-runtime";

test("a clean reply parses as-is", () => {
  const parsed = parsePythonJson<{ success: boolean; width: number }>('{"success": true, "width": 595}');
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value, { success: true, width: 595 });
});

test("a deprecation banner ahead of the payload no longer fails the call", () => {
  // Exactly what PyMuPDF prints to stdout when a tool imports the `fitz`
  // alias — it turned every render-page call into a 500.
  const stdout = [
    "PyMuPDF: the 'fitz' API is deprecated and will be removed in the future; use 'pymupdf' instead.",
    '{"success": true, "image": "data:image/png;base64,AAAA", "pageCount": 3}',
  ].join("\n");

  const parsed = parsePythonJson<{ success: boolean; pageCount: number }>(stdout);
  assert.ok(parsed.ok, "the payload is recovered from the polluted stream");
  assert.equal(parsed.value.success, true);
  assert.equal(parsed.value.pageCount, 3);
});

test("trailing chatter after the payload is tolerated", () => {
  const parsed = parsePythonJson<{ ok: boolean }>('{"ok": true}\nResourceWarning: unclosed file\n');
  assert.ok(parsed.ok);
  assert.equal(parsed.value.ok, true);
});

test("a top-level array payload survives the same treatment", () => {
  const parsed = parsePythonJson<number[]>('warning: something\n[1, 2, 3]');
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value, [1, 2, 3]);
});

test("output with no JSON at all still reports a diagnosable error", () => {
  const parsed = parsePythonJson("Traceback (most recent call last): ImportError: no module named cv2");
  assert.ok(!parsed.ok);
  assert.match(parsed.error, /Bad JSON/);
  // The operator needs to see what the tool actually said.
  assert.match(parsed.error, /ImportError/);
});

test("empty output is reported as empty rather than as malformed JSON", () => {
  const parsed = parsePythonJson("   ");
  assert.ok(!parsed.ok);
  assert.match(parsed.error, /no output/);
});
