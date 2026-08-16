import assert from "node:assert/strict";
import test from "node:test";

import { uploadFileChunked } from "./chunked-upload";

const PROJECT_ID = "project-test";
const UPLOAD_ID = "11111111-2222-3333-4444-555555555555";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFile(size: number, name = "scan.laz"): File {
  return new File([new Uint8Array(size)], name);
}

interface RecordedCall {
  method: string;
  path: string;
  offsetHeader: string | null;
  bodySize: number | null;
}

/**
 * Installs a mock fetch that simulates the chunked-upload API. `receivedBytes`
 * is the server-side byte count; `interceptPatch` can hijack individual PATCH
 * attempts (return a Response to short-circuit, throw to simulate a network
 * drop, or return null to fall through to the default append behavior).
 */
function installMockServer(t: { after: (fn: () => void) => void }, options: {
  initialReceivedBytes?: number;
  /** What the init POST claims the server has — lets a test hand the client a stale offset. */
  initResponseReceivedBytes?: number;
  totalSize: number;
  interceptPatch?: (attempt: number, offset: number) => Response | null;
}) {
  const calls: RecordedCall[] = [];
  const state = { receivedBytes: options.initialReceivedBytes ?? 0, patchAttempts: 0 };
  const completedNode = {
    id: "fn-1",
    projectId: PROJECT_ID,
    parentId: null,
    name: "scan.laz",
    type: "file",
    metadata: {},
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body;
    const bodySize = body instanceof Blob ? body.size : null;
    calls.push({
      method,
      path: url.pathname,
      offsetHeader: headers["x-upload-offset"] ?? null,
      bodySize,
    });

    if (method === "POST" && url.pathname === `/api/projects/${PROJECT_ID}/uploads`) {
      return jsonResponse(
        {
          uploadId: UPLOAD_ID,
          chunkSize: 16,
          receivedBytes: options.initResponseReceivedBytes ?? state.receivedBytes,
        },
        201,
      );
    }

    if (url.pathname === `/api/projects/${PROJECT_ID}/uploads/${UPLOAD_ID}`) {
      if (method === "GET") {
        return jsonResponse({
          receivedBytes: state.receivedBytes,
          totalSize: options.totalSize,
          fileName: "scan.laz",
        });
      }
      if (method === "PATCH") {
        state.patchAttempts += 1;
        const offset = Number.parseInt(headers["x-upload-offset"] ?? "", 10);
        const intercepted = options.interceptPatch?.(state.patchAttempts, offset);
        if (intercepted) return intercepted;
        if (offset !== state.receivedBytes) {
          return jsonResponse(
            { message: "Offset does not match received bytes", receivedBytes: state.receivedBytes },
            409,
          );
        }
        state.receivedBytes += bodySize ?? 0;
        return jsonResponse({ receivedBytes: state.receivedBytes });
      }
    }

    if (
      method === "POST" &&
      url.pathname === `/api/projects/${PROJECT_ID}/uploads/${UPLOAD_ID}/complete`
    ) {
      assert.equal(state.receivedBytes, options.totalSize, "complete called before all bytes arrived");
      return jsonResponse({ ...completedNode, size: state.receivedBytes }, 201);
    }

    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  return { calls, state, completedNode };
}

test("uploads sequential chunks and reports progress after each one", async (t) => {
  const file = makeFile(40);
  const server = installMockServer(t, { totalSize: 40 });
  const progress: Array<[number, number]> = [];

  const result = await uploadFileChunked(PROJECT_ID, file, {
    chunkSize: 16,
    onProgress: (sent, total) => progress.push([sent, total]),
  });

  const patches = server.calls.filter((c) => c.method === "PATCH");
  assert.deepEqual(
    patches.map((c) => [Number(c.offsetHeader), c.bodySize]),
    [[0, 16], [16, 16], [32, 8]],
  );
  assert.deepEqual(progress, [[16, 40], [32, 40], [40, 40]]);
  assert.equal(result.id, "fn-1");
  assert.equal((result as { size?: number }).size, 40);
  assert.equal(server.calls.at(-1)?.path, `/api/projects/${PROJECT_ID}/uploads/${UPLOAD_ID}/complete`);
});

test("a 409 offset conflict resyncs from the server's receivedBytes and resumes", async (t) => {
  const file = makeFile(48);
  // The server already holds 16 bytes from an interrupted earlier attempt,
  // but init hands the client a stale receivedBytes of 0, so the client's
  // first PATCH (offset 0) conflicts with a 409.
  const server = installMockServer(t, {
    initialReceivedBytes: 16,
    initResponseReceivedBytes: 0,
    totalSize: 48,
  });

  const progress: Array<[number, number]> = [];
  const result = await uploadFileChunked(PROJECT_ID, file, {
    chunkSize: 16,
    onProgress: (sent, total) => progress.push([sent, total]),
  });

  const patches = server.calls.filter((c) => c.method === "PATCH");
  // First PATCH at stale offset 0 conflicts; after the GET resync the client
  // resumes from 16 rather than restarting.
  assert.deepEqual(patches.map((c) => Number(c.offsetHeader)), [0, 16, 32]);
  assert.ok(
    server.calls.some((c) => c.method === "GET" && c.path.endsWith(`/uploads/${UPLOAD_ID}`)),
    "client should GET status after the 409",
  );
  assert.deepEqual(progress, [[32, 48], [48, 48]]);
  assert.equal(result.id, "fn-1");
});

test("a transient network error is retried and resumes from server state", async (t) => {
  const file = makeFile(32);
  let failedOnce = false;
  const server = installMockServer(t, {
    totalSize: 32,
    interceptPatch: (attempt) => {
      if (attempt === 1 && !failedOnce) {
        failedOnce = true;
        throw new TypeError("fetch failed");
      }
      return null;
    },
  });

  const result = await uploadFileChunked(PROJECT_ID, file, { chunkSize: 16 });

  assert.equal(server.state.receivedBytes, 32);
  assert.equal(result.id, "fn-1");
  const patches = server.calls.filter((c) => c.method === "PATCH");
  assert.equal(patches.length, 3, "failed first attempt plus two successful chunks");
});

test("a fatal server error is not retried", async (t) => {
  const file = makeFile(32);
  const server = installMockServer(t, {
    totalSize: 32,
    interceptPatch: () => jsonResponse({ message: "Chunk exceeds the declared totalSize" }, 413),
  });

  await assert.rejects(
    uploadFileChunked(PROJECT_ID, file, { chunkSize: 16 }),
    /Chunk exceeds the declared totalSize/,
  );
  const patches = server.calls.filter((c) => c.method === "PATCH");
  assert.equal(patches.length, 1, "413 must fail fast without retries");
});
