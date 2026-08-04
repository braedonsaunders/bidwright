import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { fetchWithRetry } from "./api-client.js";

test("MCP API calls fail clearly instead of hanging forever", async () => {
  const server = createServer(() => {
    // Deliberately never write a response.
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await assert.rejects(
      fetchWithRetry(`http://127.0.0.1:${address.port}/hang`, { method: "GET" }, 25),
      /timed out after 0s: GET/i,
    );
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
});
