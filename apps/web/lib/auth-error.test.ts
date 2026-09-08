import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "./api/client";
import { classifyAuthFailure } from "./auth-error";

test("a 401 is the login flow's business, not a backend outage", () => {
  const error = new ApiError("API request failed for /api/auth/me (401 Unauthorized)", {
    status: 401,
    path: "/api/auth/me",
  });
  assert.equal(classifyAuthFailure(error, "session"), null);
});

test("a failing setup API is reported with its status so the shell can explain it", () => {
  const error = new ApiError("API request failed for /api/setup/status (502 Bad Gateway): container failed", {
    status: 502,
    path: "/api/setup/status",
    body: "container failed",
  });

  const classified = classifyAuthFailure(error, "setup-status");
  assert.equal(classified?.status, 502);
  assert.equal(classified?.source, "setup-status");
  assert.match(classified?.message ?? "", /502 Bad Gateway/);
});

test("an unreachable API reports status 0 rather than passing for unauthenticated", () => {
  const error = new ApiError("API request failed for /api/setup/status: fetch failed", {
    status: 0,
    path: "/api/setup/status",
  });

  const classified = classifyAuthFailure(error, "setup-status");
  assert.equal(classified?.status, 0);
  assert.equal(error.isNetworkError, true);
  assert.equal(error.isServerError, false);
});

test("a non-ApiError throw still surfaces instead of being swallowed", () => {
  const classified = classifyAuthFailure(new TypeError("Failed to fetch"), "session");
  assert.equal(classified?.status, 0);
  assert.equal(classified?.message, "Failed to fetch");
});

test("apiRequest attaches the HTTP status to the thrown error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("container boot failed", { status: 502, statusText: "Bad Gateway" })) as typeof fetch;

  try {
    const { apiRequest } = await import("./api/client");
    await assert.rejects(
      () => apiRequest("/api/setup/status"),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 502);
        assert.equal(error.isServerError, true);
        assert.equal(error.body, "container boot failed");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a rejected fetch becomes a status-0 ApiError instead of a bare TypeError", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;

  try {
    const { apiRequest } = await import("./api/client");
    await assert.rejects(
      () => apiRequest("/api/setup/status"),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 0);
        assert.equal(error.isNetworkError, true);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
