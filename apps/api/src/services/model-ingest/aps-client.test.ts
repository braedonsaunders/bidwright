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

test("failed derivative messages survive nested manifests and the terminal error", async (t) => {
  const { ApsTranslationError } = await import("./aps-client.js");
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => String(input).includes("authentication")
    ? jsonResponse({ access_token: "test", expires_in: 3600 })
    : jsonResponse({ urn: "model", status: "failed", progress: "complete", region: "US", derivatives: [{
      status: "failed", messages: [{ type: "error", code: "TranslationWorker-InternalFailure", message: "Unrecoverable exit code from extractor: -777" }],
      children: [{ messages: [{ type: "error", code: "Nested", message: ["Missing file", "xref"] }] }],
    }] }));
  await assert.rejects(new ApsClient("client", "secret").waitForTranslation("model"), (error: unknown) => {
    assert.ok(error instanceof ApsTranslationError);
    assert.match(error.message, /TranslationWorker-InternalFailure.*-777/);
    assert.equal(error.manifest.messages?.length, 2);
    assert.match(error.manifest.messages![1].message, /xref/);
    return true;
  });
});

test("APS 202 properties are polled until the actual element collection arrives", async (t) => {
  let propertyCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (String(input).includes("authentication")) return jsonResponse({ access_token: "test", expires_in: 3600 });
    if (String(input).endsWith("/metadata")) return jsonResponse({ data: { metadata: [{ guid: "view", role: "3d" }] } });
    propertyCalls++;
    return propertyCalls === 1 ? jsonResponse({ result: "success" }, 202)
      : jsonResponse({ data: { collection: [{ objectid: 1, name: "Pipe", properties: { Dimensions: { Length: { value: 317, units: "ft" } } } }] } });
  });
  const result = await new ApsClient("client", "secret").extractModelData("urn");
  assert.equal(propertyCalls, 2);
  assert.equal(result.objects.length, 1);
  assert.equal(result.objects[0].quantities[0].value, 317);
});

test("APS properties timeout cannot become an indexed empty model", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => String(input).includes("authentication")
    ? jsonResponse({ access_token: "test", expires_in: 3600 }) : jsonResponse({ result: "success" }, 202));
  await assert.rejects(new ApsClient("client", "secret").getViewProperties("urn", "view", 10), /still processing.*202/);
});

test("APS Plant3D quantities retain units and exclude containers and duplicate identities", async t => {
  const client = new ApsClient("client", "secret");
  client.getMetadataViews = async () => ({ data: { type: "metadata", metadata: [{ guid: "main", role: "3d", name: "Main" }] } });
  const properties = { Item: { Icon: "Geometry", "Source File": "plant.dwg" }, AutoCAD: {
    Class: "Pipe", PnPGuid: "pipe-1", Length: "120", Size: '3"', Spec: "150S1", Port1_LengthUnit: "in",
    Port1_NominalDiameter: "3", Port2_NominalDiameter: "3", MinCutLength: "3", Nozzle1_Length: "99",
  } };
  client.getViewProperties = async () => ({ data: { type: "properties", collection: [
    { objectid: 1, name: "Layer", properties: { Item: { Icon: "Layer" }, AutoCAD: {} } },
    { objectid: 4, name: "Container", properties: { Item: { Icon: "InsertGroup" }, AutoCAD: {} } },
    { objectid: 2, name: "Pipe", properties },
    { objectid: 3, name: "Duplicate", properties },
  ] } });
  const { objects } = await client.extractModelData("urn");
  const pipe = objects.find((o) => o.objectid === 3)!; // Flattened stack order selects this physical occurrence.
  assert.deepEqual(pipe.quantities, [{ quantityType: "Length", value: 120, unit: "in" }, { quantityType: "nominal_diameter", value: 3, unit: "" }]);
  assert.equal(pipe.properties["AutoCAD.Size"], '3"');
  assert.equal(objects.filter((o) => o.estimateRelevant).length, 1);
  assert.equal(objects.filter((o) => !o.estimateRelevant).every((o) => o.quantities.length === 0), true);
  t.mock.method(ApsClient.prototype, "getObjectDetails", async () => ({ urn: "urn", size: 1 }) as any);
  t.mock.method(ApsClient.prototype, "getManifest", async () => ({ status: "success" }) as any);
  t.mock.method(ApsClient.prototype, "extractModelData", async () => ({ objects, views: [] }));
  const { autodeskApsAdapter } = await import("./adapters/autodesk-aps-adapter.js");
  const result = await autodeskApsAdapter.ingest({ id: "source", projectId: "project", fileName: "plant.nwd", source: "source_document" }, {
    absPath: "/unused", checksum: "checksum", size: 1, format: "nwd", settings: { integrations: { autodeskClientId: "test", autodeskClientSecret: "test" } },
  });
  assert.equal(result.status, "indexed");
  assert.equal(result.bomRows.length, 1);
  assert.deepEqual((result.bomRows[0].quantities as any[]).find(q => q.type === "Length"), { type: "Length", value: 10, unit: "ft" });

});

test("Revit composites retain authored quantities; drawing units beat catalog length units", async () => {
  const client = new ApsClient("client", "secret");
  client.getMetadataViews = async () => ({ data: { type: "metadata", metadata: [{ guid: "main", role: "3d", name: "Main" }] } });
  client.getViewProperties = async (): Promise<Awaited<ReturnType<ApsClient["getViewProperties"]>>> => ({ data: { type: "properties", collection: [{
    objectid: 1, name: "Revit pipe", properties: { Item: { Icon: "Composite Object" }, General: { "Drawing Units": "mm" },
      AutoCAD: { GUID: "parent", Length: "120", Port1_LengthUnit: "in", Elevation: "20", Offset: "10", Port1_NominalDiameter: "3", LengthUnit: "in" },
      Dimensions: { Area: { value: 5, units: "m2" } } },
    children: [{ objectid: 2, name: "Mesh", properties: { Item: { Icon: "Geometry" } } }],
  }, { objectid: 3, name: "Duplicate parent", properties: { Item: { Icon: "Composite Object" }, Dimensions: { GUID: "same", Length: { value: 10, units: "ft" } } },
    children: [{ objectid: 4, name: "Physical child", properties: { Dimensions: { GUID: "same", Length: { value: 10, units: "ft" } } } }],
  }] } });
  const result = await client.extractModelData("urn");
  const parent = result.objects.find(o => o.objectid === 1)!;
  assert.equal(parent.estimateRelevant, true);
  assert.equal(parent.quantities.find(q => q.quantityType === "Length")?.unit, "mm");
  assert.equal(parent.quantities.find(q => q.quantityType === "Area")?.unit, "m2");
  for (const key of ["Elevation", "Offset", "nominal_diameter"]) assert.equal(parent.quantities.find(q => q.quantityType === key)?.unit, "");
  assert.equal(result.objects.find(o => o.objectid === 3)?.estimateRelevant, false);
  assert.equal(result.objects.find(o => o.objectid === 4)?.estimateRelevant, true);
});
