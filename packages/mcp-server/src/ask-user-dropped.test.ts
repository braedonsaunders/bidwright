import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

test("askUser returns control when the server has lost the question, and still delivers real answers", async () => {
  let answerNext = false;
  const api = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST" && request.url === "/api/cli/project-test/question") {
      response.end(JSON.stringify({ ok: true, questionId: answerNext ? "ask-answered" : "ask-dropped" }));
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/api/cli/project-test/pending-question")) {
      response.end(JSON.stringify(request.url.includes("ask-answered")
        ? { pending: false, answered: true, answer: "Vendor supplies hoses; we connect them." }
        : { pending: false, answered: false }));
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  assert.ok(address && typeof address === "object");

  const previous = {
    BIDWRIGHT_API_URL: process.env.BIDWRIGHT_API_URL,
    BIDWRIGHT_AUTH_TOKEN: process.env.BIDWRIGHT_AUTH_TOKEN,
    BIDWRIGHT_PROJECT_ID: process.env.BIDWRIGHT_PROJECT_ID,
    BIDWRIGHT_ASK_USER_POLL_MS: process.env.BIDWRIGHT_ASK_USER_POLL_MS,
  };
  process.env.BIDWRIGHT_API_URL = `http://127.0.0.1:${address.port}`;
  process.env.BIDWRIGHT_AUTH_TOKEN = "test-token";
  process.env.BIDWRIGHT_PROJECT_ID = "project-test";
  process.env.BIDWRIGHT_ASK_USER_POLL_MS = "2";

  try {
    const { registerSystemTools } = await import("./tools/system-tools.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerSystemTools(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const dropped = await client.callTool({ name: "askUser", arguments: { question: "Who routes the hoses?" } });
    assert.equal(dropped.isError, true);
    assert.match(JSON.stringify(dropped.content), /no longer pending/);

    answerNext = true;
    const answered = await client.callTool({ name: "askUser", arguments: { question: "Who routes the hoses?" } });
    assert.notEqual(answered.isError, true);
    assert.match(JSON.stringify(answered.content), /Vendor supplies hoses/);

    await client.close();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    api.close();
  }
});
