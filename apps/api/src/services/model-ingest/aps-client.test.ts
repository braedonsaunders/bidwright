import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ApsClient } from "./aps-client.js";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("APS upload uses persistent storage and the Direct-to-S3 multipart flow", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const directory = await mkdtemp(join(tmpdir(), "bidwright-aps-"));
  const filePath = join(directory, "sample.nwd");
  await writeFile(filePath, Buffer.alloc((5 << 20) + 8, 7));

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/authentication/v2/token")) return jsonResponse({ access_token: "server-token", expires_in: 3600 });
    if (url.endsWith("/details")) return jsonResponse({ reason: "not found" }, 404);
    if (url.endsWith("/oss/v2/buckets")) return jsonResponse({ bucketKey: "created" });
    if (url.includes("/signeds3upload?") && init?.method !== "POST") {
      return jsonResponse({ uploadKey: "upload-key", urls: ["https://signed.invalid/part-1", "https://signed.invalid/part-2"] });
    }
    if (url.startsWith("https://signed.invalid/")) return new Response(null, { status: 200 });
    if (url.endsWith("/signeds3upload") && init?.method === "POST") {
      return jsonResponse({ bucketKey: "bucket", objectKey: "sample.nwd", objectId: "urn:adsk.objects:os.object:bucket/sample.nwd" });
    }
    throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
  };

  try {
    const result = await new ApsClient("client", "secret").uploadObject("sample.nwd", filePath);
    assert.ok(result.urn);
    const createBucket = calls.find((call) => call.url.endsWith("/oss/v2/buckets"));
    assert.equal(JSON.parse(String(createBucket?.init?.body)).policyKey, "persistent");
    assert.equal(calls.filter((call) => call.url.startsWith("https://signed.invalid/")).length, 2);
    assert.equal(calls.some((call) => /\/objects\/sample\.nwd$/.test(call.url) && call.init?.method === "PUT"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("APS viewer tokens are restricted to viewables:read", async () => {
  const originalFetch = globalThis.fetch;
  let tokenBody = "";
  globalThis.fetch = async (_input, init) => {
    tokenBody = String(init?.body ?? "");
    return jsonResponse({ access_token: "viewer-token", expires_in: 3599 });
  };
  try {
    const token = await new ApsClient("client", "secret").createViewerToken();
    assert.equal(token.accessToken, "viewer-token");
    assert.equal(new URLSearchParams(tokenBody).get("scope"), "viewables:read");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("APS metadata extraction accepts the current properties collection shape", async () => {
  const client = new ApsClient("client", "secret") as any;
  client.getMetadataViews = async () => ({
    data: { type: "metadata", metadata: [{ guid: "view-1", name: "Main", role: "3d" }] },
  });
  client.getViewProperties = async () => ({
    data: {
      type: "properties",
      collection: [{
        objectid: 42,
        name: "Pipe",
        properties: {
          Identity: { Category: "Pipes", Type: { displayValue: "Steel Pipe" } },
          Dimensions: { Length: { value: 12, units: "ft" } },
        },
      }],
    },
  });

  const result = await client.extractModelData("urn");
  assert.equal(result.objects.length, 1);
  assert.equal(result.objects[0].elementClass, "Pipes");
  assert.equal(result.objects[0].elementType, "Steel Pipe");
  assert.deepEqual(result.objects[0].quantities, [{ quantityType: "Length", value: 12, unit: "ft" }]);
});

test("APS metadata extraction preserves numeric-string BIM quantities", async () => {
  const client = new ApsClient("client", "secret") as any;
  client.getMetadataViews = async () => ({
    data: { type: "metadata", metadata: [{ guid: "view-1", name: "Main", role: "3d" }] },
  });
  client.getViewProperties = async () => ({
    data: {
      type: "properties",
      collection: [{
        objectid: 43,
        name: "ACPPPIPE",
        properties: {
          Item: { Type: "ACPPPIPE" },
          General: { Layer: "9001" },
          ItemDisplay: { Material: "AutoCAD Color Index 5" },
          AutoCAD: {
            Class: "Pipe",
            Length: "9.043757",
            PipeLineNumber: `3\"P-150S1-9001`,
            "Plant Material": "TP304L",
          },
        },
      }],
    },
  });

  const result = await client.extractModelData("urn");
  assert.equal(result.objects[0].elementClass, "Pipe");
  assert.equal(result.objects[0].system, `3\"P-150S1-9001`);
  assert.equal(result.objects[0].material, "TP304L");
  assert.deepEqual(result.objects[0].quantities, [{ quantityType: "Length", value: 9.043757, unit: "" }]);
});
