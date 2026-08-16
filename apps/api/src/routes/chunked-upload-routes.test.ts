import assert from "node:assert/strict";
import test from "node:test";

import { isValidUploadId, planChunkAppend } from "./chunked-upload-routes.js";

test("planChunkAppend accepts a chunk at the exact current offset", () => {
  const plan = planChunkAppend({
    offset: 32,
    receivedBytes: 32,
    totalSize: 100,
    contentLength: 16,
  });
  assert.deepEqual(plan, { ok: true });
});

test("planChunkAppend rejects a mismatched offset with 409 so the client can resume", () => {
  const stale = planChunkAppend({ offset: 0, receivedBytes: 16, totalSize: 100, contentLength: 16 });
  assert.equal(stale.ok, false);
  assert.equal(!stale.ok && stale.status, 409);

  const ahead = planChunkAppend({ offset: 48, receivedBytes: 16, totalSize: 100, contentLength: 16 });
  assert.equal(ahead.ok, false);
  assert.equal(!ahead.ok && ahead.status, 409);
});

test("planChunkAppend rejects negative or non-integer offsets with 400", () => {
  for (const offset of [-1, 1.5, Number.NaN]) {
    const plan = planChunkAppend({ offset, receivedBytes: 0, totalSize: 100 });
    assert.equal(plan.ok, false);
    assert.equal(!plan.ok && plan.status, 400);
  }
});

test("planChunkAppend rejects a chunk that would exceed totalSize with 413", () => {
  const plan = planChunkAppend({
    offset: 96,
    receivedBytes: 96,
    totalSize: 100,
    contentLength: 16,
  });
  assert.equal(plan.ok, false);
  assert.equal(!plan.ok && plan.status, 413);
});

test("planChunkAppend refuses appends once all declared bytes are present", () => {
  const plan = planChunkAppend({ offset: 100, receivedBytes: 100, totalSize: 100, contentLength: 1 });
  assert.equal(plan.ok, false);
  assert.equal(!plan.ok && plan.status, 409);
});

test("planChunkAppend allows a chunk without a content-length header up to streaming enforcement", () => {
  // The streaming limiter enforces the ceiling byte-by-byte; the plan only
  // fast-fails when content-length is present and provably too large.
  const plan = planChunkAppend({ offset: 0, receivedBytes: 0, totalSize: 100, contentLength: null });
  assert.deepEqual(plan, { ok: true });
});

test("isValidUploadId only accepts UUID-shaped path segments", () => {
  assert.equal(isValidUploadId("11111111-2222-3333-4444-555555555555"), true);
  assert.equal(isValidUploadId(""), false);
  assert.equal(isValidUploadId(".."), false);
  assert.equal(isValidUploadId("../../etc/passwd"), false);
  assert.equal(isValidUploadId("11111111-2222-3333-4444-55555555555Z"), false);
  assert.equal(isValidUploadId("11111111222233334444555555555555"), false);
});
