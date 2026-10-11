import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createClient, runBw } from "./bw-client.mjs";

test("bw reads real model pagination and sends explicit writes to the authenticated API", async () => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, method: req.method, auth: req.headers.authorization, body });
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") res.end(JSON.stringify({ id: "created", ...JSON.parse(body) }));
    else {
      const offset = Number(new URL(req.url, "http://localhost").searchParams.get("offset"));
      res.end(JSON.stringify({ elements: [{ id: `element-${offset}` }], count: 2, limit: 1, offset }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const env = { BIDWRIGHT_API_URL: `http://127.0.0.1:${server.address().port}`, BIDWRIGHT_AUTH_TOKEN: "synthetic-token", BIDWRIGHT_PROJECT_ID: "project" };
    assert.deepEqual(await runBw(["elements", "model", "--all", "--limit", "1"], env), [{ id: "element-0" }, { id: "element-1" }]);
    assert.deepEqual(await runBw(["post", "/projects/project/worksheets", '{"name":"Installation"}'], env), { id: "created", name: "Installation" });
    assert.equal(requests.length, 3);
    assert.equal(requests[1].path, "/api/models/project/assets/model/elements?limit=1&offset=1");
    assert.ok(requests.every(req => req.auth === "Bearer synthetic-token"));
    const client = createClient({ apiUrl: env.BIDWRIGHT_API_URL, token: "synthetic-token", projectId: "project", readOnly: true });
    await assert.rejects(client.request("GET", "https://example.invalid/"), /API path/);
    await assert.rejects(client.request("GET", "//example.invalid/"), /API path/);
    await assert.rejects(client.request("GET", "/projects/other/workspace"), /Project path/);
    await assert.rejects(client.request("POST", "/projects/project/worksheets", {}), /unavailable/);
    assert.equal(requests.length, 3);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
