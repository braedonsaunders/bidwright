import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("project image tools discover file nodes and return native image content", async () => {
  const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");

  const api = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (
      request.method === "GET"
      && request.url === "/projects/project-test/files/tree?scope=project"
    ) {
      response.end(JSON.stringify([
        {
          id: "folder-site",
          projectId: "project-test",
          parentId: null,
          name: "Site Photos",
          type: "directory",
          scope: "project",
        },
        {
          id: "image-north-wall",
          projectId: "project-test",
          parentId: "folder-site",
          name: "north-wall.jpg",
          type: "file",
          scope: "project",
          fileType: "jpg",
          size: 8,
        },
        {
          id: "notes",
          projectId: "project-test",
          parentId: null,
          name: "notes.txt",
          type: "file",
          scope: "project",
          fileType: "txt",
          size: 10,
        },
      ]));
      return;
    }

    if (
      request.method === "POST"
      && request.url === "/api/vision/project-image"
    ) {
      response.end(JSON.stringify({
        success: true,
        fileNodeId: "image-north-wall",
        fileName: "north-wall.jpg",
        mimeType: "image/jpeg",
        size: 8,
        image: `data:image/jpeg;base64,${jpegBase64}`,
      }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  assert.ok(address && typeof address === "object");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "packages/mcp-server/src/index.ts"],
    cwd: process.cwd(),
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] =>
          typeof entry[1] === "string"),
      ),
      BIDWRIGHT_API_URL: `http://127.0.0.1:${address.port}`,
      BIDWRIGHT_AUTH_TOKEN: "test-token",
      BIDWRIGHT_PROJECT_ID: "project-test",
      BIDWRIGHT_REVISION_ID: "revision-test",
      BIDWRIGHT_QUOTE_ID: "quote-test",
      BIDWRIGHT_AGENT_MODE: "qa",
    },
    stderr: "pipe",
  });
  const client = new Client(
    { name: "project-image-test", version: "1.0.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "listProjectImages"));
    assert.ok(tools.tools.some((tool) => tool.name === "inspectProjectImage"));

    const listed = await client.callTool({
      name: "listProjectImages",
      arguments: {},
    });
    const listText = listed.content.find((item) => item.type === "text");
    assert.ok(listText && listText.type === "text");
    const listPayload = JSON.parse(listText.text);
    assert.equal(listPayload.returned, 1);
    assert.equal(listPayload.images[0].fileNodeId, "image-north-wall");
    assert.equal(listPayload.images[0].path, "Site Photos/north-wall.jpg");

    const inspected = await client.callTool({
      name: "inspectProjectImage",
      arguments: { fileNodeId: "image-north-wall" },
    });
    const image = inspected.content.find((item) => item.type === "image");
    assert.ok(image && image.type === "image");
    assert.equal(image.mimeType, "image/jpeg");
    assert.equal(image.data, jpegBase64);
  } finally {
    await client.close().catch(() => undefined);
    api.close();
    await once(api, "close");
  }
});
