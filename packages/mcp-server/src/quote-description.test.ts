import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test, { type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

test("quote tools save and expose the customer-facing revision narrative", async t => {
  const originalDescription = `<p>Customer-approved scope: ${"Install the specified piping and retain the owner-supplied equipment. ".repeat(100)}</p>`;
  const revision = { id: "revision-active", description: originalDescription, notes: "Owner supplies the pumps.", leadLetter: "Dear customer," };
  const oldRevision = { id: "revision-old", description: "Previously issued scope." };
  let failRevisionSave = false;
  let missingRevision = false;
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  const api = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url === "/projects/project-test/workspace") {
      response.end(JSON.stringify({ workspace: {
        project: { name: "Cooling water installation", clientName: "Customer" },
        currentRevision: missingRevision ? {} : revision,
        revisions: missingRevision ? [] : [oldRevision, revision],
      } }));
      return;
    }
    if (request.method === "PATCH") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const patch = JSON.parse(body);
      writes.push({ path: request.url!, body: patch });
      if (request.url === "/projects/project-test/revisions/revision-active") {
        if (failRevisionSave) {
          response.statusCode = 400;
          response.end(JSON.stringify({ message: "Revision description rejected" }));
          return;
        }
        Object.assign(revision, patch);
        response.end(JSON.stringify(revision));
        return;
      }
      if (request.url === "/projects/project-test") {
        // The legacy project endpoint selects a project quote independently.
        // Sending description here would mutate the wrong quote as well.
        if (patch.description) oldRevision.description = patch.description;
        response.end(JSON.stringify({ updated: true }));
        return;
      }
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "Unknown API path" }));
  });
  t.after(() => new Promise<void>((resolve, reject) => api.close(error => error ? reject(error) : resolve())));
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  assert.ok(address && typeof address === "object");
  const environment = {
    BIDWRIGHT_API_URL: process.env.BIDWRIGHT_API_URL,
    BIDWRIGHT_AUTH_TOKEN: process.env.BIDWRIGHT_AUTH_TOKEN,
    BIDWRIGHT_PROJECT_ID: process.env.BIDWRIGHT_PROJECT_ID,
    BIDWRIGHT_REVISION_ID: process.env.BIDWRIGHT_REVISION_ID,
  };
  process.env.BIDWRIGHT_API_URL = `http://127.0.0.1:${address.port}`;
  process.env.BIDWRIGHT_AUTH_TOKEN = "test-token";
  process.env.BIDWRIGHT_PROJECT_ID = "project-test";
  // Run this suite with and without a pinned run revision to cover both paths.
  process.env.BIDWRIGHT_REVISION_ID = process.env.BIDWRIGHT_TEST_PIN_REVISION ?? "";
  t.after(() => {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const { registerQuoteTools } = await import("./tools/quote-tools.js");
  async function connect(context: TestContext) {
    const server = new McpServer({ name: "quote-description-test", version: "1.0.0" });
    registerQuoteTools(server);
    const client = new Client({ name: "quote-description-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    context.after(async () => { await client.close(); await server.close(); });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
  }
  function readResult(result: Awaited<ReturnType<Client["callTool"]>>) {
    const content = result.content as Array<{ type: string; text?: string }>;
    return JSON.parse(content.find(block => block.type === "text")!.text!);
  }

  await t.test("workspace preserves the full existing description for editing and readback", async context => {
    const client = await connect(context);
    const saved = readResult(await client.callTool({ name: "getWorkspace", arguments: {} }));
    assert.equal(saved.revision.description, originalDescription);
    assert.equal(saved.revision.notes, revision.notes);
    assert.equal(saved.revision.leadLetter, revision.leadLetter);
  });

  await t.test("updateQuote saves paragraphs to the active revision and exposes them on readback", async context => {
    const client = await connect(context);
    writes.length = 0;
    const paragraphs = [
      "We are pleased to provide our quotation for the cooling water piping installation.",
      "Our scope includes field installation and testing of the specified piping. The customer supplies the pumps.",
      "This offer assumes the agreed access window. Electrical work remains by others.",
    ];
    const result = await client.callTool({ name: "updateQuote", arguments: { description: paragraphs.join("\n\n") } });
    assert.notEqual(result.isError, true);
    const expected = paragraphs.map(paragraph => `<p>${paragraph}</p>`).join("");
    assert.equal(revision.description, expected);
    assert.deepEqual(writes.map(write => write.path), ["/projects/project-test/revisions/revision-active"]);
    assert.equal(writes[0].body.description, expected);
    assert.equal(readResult(await client.callTool({ name: "getWorkspace", arguments: {} })).revision.description, expected);
    assert.equal(oldRevision.description, "Previously issued scope.");
  });

  await t.test("project metadata updates never send scope or notes through the legacy project route", async context => {
    const client = await connect(context);
    writes.length = 0;
    const result = await client.callTool({ name: "updateQuote", arguments: {
      projectName: "Cooling water replacement",
      description: "<p>Included installation.</p>",
      notes: "Owner supplies the pumps.",
    } });
    assert.notEqual(result.isError, true);
    assert.deepEqual(writes[0], { path: "/projects/project-test", body: { projectName: "Cooling water replacement" } });
    assert.deepEqual(writes[1], { path: "/projects/project-test/revisions/revision-active", body: {
      title: "Cooling water replacement", description: "<p>Included installation.</p>", notes: "Owner supplies the pumps.",
    } });
    assert.equal(oldRevision.description, "Previously issued scope.");
  });

  await t.test("updateRevision keeps rich paragraphs and uses the active revision rather than the first revision", async context => {
    const client = await connect(context);
    writes.length = 0;
    const html = "<p>We are pleased to quote the agreed installation.</p><p>The customer supplies the pumps.</p>";
    const result = await client.callTool({ name: "updateRevision", arguments: { description: html } });
    assert.notEqual(result.isError, true);
    assert.equal(revision.description, html);
    assert.equal(writes[0].path, "/projects/project-test/revisions/revision-active");
    assert.equal(oldRevision.description, "Previously issued scope.");
  });

  await t.test("updateRevision converts plain text to editor-compatible paragraphs", async context => {
    const client = await connect(context);
    await client.callTool({ name: "updateRevision", arguments: { description: "Included installation.\n\nOwner-supplied equipment." } });
    assert.equal(revision.description, "<p>Included installation.</p><p>Owner-supplied equipment.</p>");
  });

  await t.test("a failed revision save is an error rather than a successful quote update", async context => {
    const client = await connect(context);
    const before = revision.description;
    failRevisionSave = true;
    context.after(() => { failRevisionSave = false; });
    const result = await client.callTool({ name: "updateQuote", arguments: { description: "Replacement scope." } });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /Revision description rejected/);
    assert.equal(revision.description, before);
  });

  if (!process.env.BIDWRIGHT_TEST_PIN_REVISION) {
    await t.test("missing revision identity cannot silently write only the project description", async context => {
      const client = await connect(context);
      missingRevision = true;
      context.after(() => { missingRevision = false; });
      writes.length = 0;
      const result = await client.callTool({ name: "updateQuote", arguments: { description: "Replacement scope." } });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /not saved/);
      assert.equal(writes.length, 0);
    });
  }
});
