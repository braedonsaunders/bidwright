import assert from "node:assert/strict";
import test from "node:test";
import { parsePcf } from "./pcf-parser.js";
import { parseSpoolyard } from "./spoolyard-parser.js";
import { pipingPickupInput, savePipingMto } from "./piping-service.js";
import { revisionImpactForPickups } from "../revision-impact-service.js";

const spec = { id: "S1", material: "steel", schedule: "40", rootGap: 2, sizes: [{ nps: 2 }], fittings: [{ id: "elbow", nps: 2, takeout: 100, description: "Elbow", partCode: "E2" }] };
function drawing() {
  return {
    schema: "bidwright-piping", version: 1, units: "imperial", specs: [spec],
    nodes: [
      { id: "a", kind: "end", position: [0, 0, 0] },
      { id: "b", kind: "elbow90", catalogId: "elbow", position: [1000, 0, 0] },
      { id: "w", kind: "weld", position: [1000, 1000, 0], field: true },
      { id: "c", kind: "end", position: [1000, 2000, 0] },
      { id: "s", kind: "support", associatedRunId: "r1", position: [500, 0, 0], quantity: 3 },
    ],
    runs: [
      { id: "r1", from: "a", to: "b", specId: "S1", nps: 2, endPrep: "BW", toField: false },
      { id: "r2", from: "b", to: "w", specId: "S1", nps: 2, endPrep: "BW", fromField: false },
      { id: "r3", from: "w", to: "c", specId: "S1", nps: 2, endPrep: "BW" },
    ],
  };
}

test("Spoolyard schema uses mm even in imperial display, cut lengths, explicit welds and attached supports", () => {
  const mto = parseSpoolyard(JSON.stringify(drawing(), null, 2));
  assert.equal(mto.lines.find(l => l.type === "PIPE")?.quantity, 2.794); // 898 + 897 + 999 mm
  assert.equal(mto.lines.find(l => l.type === "SUPPORT")?.quantity, 3);
  assert.equal(mto.lines.find(l => l.type === "ELBOW90")?.quantity, 1);
  assert.equal(mto.joints.knownCount, 3); // two elbow ports and one explicit weld node
  assert.equal(mto.lines.find(l => l.type === "JOINT" && l.skey === "WELD")?.scope, "field");
  assert.equal(mto.joints.status, "known");
  assert.ok(mto.lines.every(l => l.refs.every(r => r.line > 1 && r.path)));
});

test("Spoolyard unknown takeouts stay unknown; connector topology adds no pipe; missing IDs refuse", () => {
  const doc = drawing();
  doc.specs[0] = { ...spec, fittings: [{ ...spec.fittings[0], takeoutMissing: true } as any] };
  const mto = parseSpoolyard(JSON.stringify(doc));
  assert.equal(mto.lines.find(l => l.type === "PIPE")?.quantity, null);
  assert.equal(mto.warnings.length, 2);
  const connector = drawing();
  Object.assign(connector.runs[0], { connector: true, fromPrep: "FL", toPrep: "FL" });
  assert.equal(parseSpoolyard(JSON.stringify(connector)).lines.find(l => l.type === "PIPE")?.quantity, 1.896);
  const broken = drawing(); broken.runs[0].from = "absent";
  assert.throws(() => parseSpoolyard(JSON.stringify(broken)), /missing node/);
  broken.nodes.push(broken.nodes[0]);
  assert.throws(() => parseSpoolyard(JSON.stringify(broken)), /Duplicate/);
});

test("Spoolyard branch port takeouts and per-end preparations determine cuts and joints", () => {
  const doc = {
    schema: "bidwright-piping", version: 1, specs: [spec],
    nodes: [{ id: "a", kind: "end", position: [0, 0, 0] }, { id: "t", kind: "tee", position: [1000, 0, 0], takeout: 100, branchTakeout: 50, branchEdgeId: "branch" }, { id: "b", kind: "end", position: [1000, 1000, 0] }],
    runs: [{ id: "main", from: "a", to: "t", specId: "S1", nps: 2, endPrep: "BW" }, { id: "branch", from: "t", to: "b", specId: "S1", nps: 1, endPrep: "SW" }],
  };
  const mto = parseSpoolyard(JSON.stringify(doc));
  assert.equal(mto.lines.find(l => l.type === "PIPE" && l.size === "2 NPS in")?.quantity, 0.898);
  assert.equal(mto.lines.find(l => l.type === "PIPE" && l.size === "1 NPS in")?.quantity, 0.95);
  assert.equal(mto.lines.find(l => l.type === "JOINT" && l.skey === "SW")?.basis, "explicit branch end preparation");
});

const pcf = `UNITS-BORE INCH
UNITS-CO-ORDS MM
PIPELINE-REFERENCE LINE-1
    PIPING-SPEC S1
PIPE
    END-POINT 0 0 0 2 BW
    END-POINT 1000 0 0 2 BW
    ITEM-CODE P2
    FABRICATION-ITEM
PIPE
    END-POINT 1000 0 0 2 BW
    END-POINT 2000 0 0 2 BW
    ITEM-CODE P2
    FABRICATION-ITEM
ELBOW
    END-POINT 2000 0 0 2 BW
    END-POINT 2100 100 0 2 BW
    SKEY ELBW
    ITEM-CODE E2
ELBOW
    END-POINT 2100 1100 0 2 BW
    END-POINT 2200 1200 0 2 BW
    SKEY ELBW
    ITEM-CODE E2
TEE
    END-POINT 2200 1200 0 2
    END-POINT 2400 1200 0 2
    BRANCH1-POINT 2300 1300 0 1
FLANGE
    END-POINT 2400 1200 0 2 FL
    END-POINT 2450 1200 0 2 FL
    SKEY FLFL
FLANGE
    END-POINT 2450 1200 0 2 FL
    END-POINT 2500 1200 0 2 FL
    SKEY FLFL
WELD
    END-POINT 1000 0 0 2
    END-POINT 1000 0 0 2
    SKEY WF
MATERIALS
    ITEM-CODE P2
        DESCRIPTION Seamless pipe
`;

test("PCF aggregates material lines, preserves source refs, dedupes explicit weld location and reports absent semantics", () => {
  const mto = parsePcf(pcf);
  assert.equal(mto.lines.find(l => l.type === "PIPE")?.quantity, 2);
  assert.equal(mto.lines.find(l => l.type === "PIPE")?.description, "Seamless pipe");
  assert.equal(mto.lines.find(l => l.type === "PIPE")?.spec, "S1");
  assert.equal(mto.lines.find(l => l.type === "ELBOW")?.quantity, 2);
  assert.equal(mto.lines.find(l => l.type === "ELBOW")?.refs.length, 2);
  assert.equal(mto.joints.knownCount, 3); // explicit WELD + pipe/elbow BW + shared flange FL
  assert.equal(mto.joints.status, "unknown");
  assert.ok(mto.joints.unknown.some(u => u.reason.includes("semantics absent")));
  assert.equal(parsePcf(pcf.replace("UNITS-CO-ORDS MM", "UNITS-CO-ORDS UNKNOWN")).lines.find(l => l.type === "PIPE")?.quantity, null);
});

test("save MTO creates one pickup per aggregate and links its quantity once; invalid selection writes nothing", async () => {
  const mto = { ...parseSpoolyard(JSON.stringify(drawing())), source: { sourceId: "file", sourceKind: "file_node" as const, documentId: "file", fileNodeId: "file", fileName: "synthetic.piping", checksum: "abc" } };
  const pipe = mto.lines.find(l => l.type === "PIPE")!;
  const saved: any[] = [], linked: number[] = [];
  const store = {
    createPickup: async (_: string, input: any) => { const p = { ...input, id: String(saved.length) }; saved.push(p); return p; },
    createPickupLink: async (_: string, input: any) => { const quantity = saved.find(p => p.id === input.pickupId).measurement[input.quantityField] * input.multiplier; linked.push(quantity); return { ...input, derivedQuantity: quantity }; },
  };
  await savePipingMto(store as any, "project", mto, [{ lineId: pipe.id, worksheetItemId: "row" }]);
  assert.deepEqual(linked, [2.794]);
  assert.equal(saved[0].metadata.source, "piping");
  assert.equal(saved[0].metadata.itemRefs.length, 3);
  assert.ok(Math.abs(pipingPickupInput(mto, { lineId: pipe.id, unit: "ft" }).measurement.value - 2.794 / 0.3048) < 1e-10);
  assert.throws(() => pipingPickupInput(mto, { lineId: pipe.id, unit: "EA" }), /Cannot convert/);
  await assert.rejects(savePipingMto(store as any, "project", mto, [{ lineId: pipe.id }, { lineId: "absent" }]), /not found/);
  await assert.rejects(savePipingMto(store as any, "project", mto, [{ lineId: pipe.id }, { lineId: pipe.id }]), /Duplicate/);
  assert.equal(saved.length, 1);
});

test("revision impact returns affected human pickups, links and rows without changing them", () => {
  const pickup = { id: "p1", documentId: "doc", pageNumber: 1, modelId: "base", modelElementId: "element", metadata: { measuredBy: "person", sourceChecksum: "old" }, selection: {}, createdBy: "user", pickupLinks: [{ id: "link", worksheetItemId: "row", worksheetItem: { id: "row", quantity: 12 } }] };
  const current = { ...pickup, id: "p2", metadata: { measuredBy: "agent", sourceChecksum: "new" }, pickupLinks: [] };
  const candidates = [pickup, current, { ...pickup, id: "p3", metadata: {}, pickupLinks: [] }];
  const before = structuredClone(candidates);
  const impact = revisionImpactForPickups(candidates, { document: { id: "doc", checksum: "new", priorChecksum: "old" } });
  assert.deepEqual(impact.pickups.map(p => p.id), ["p1", "p3"]);
  assert.equal(impact.pickups[0].humanMade, true);
  assert.equal(impact.pickups[1].humanMade, null);
  assert.equal(impact.links.length, 1);
  assert.equal(impact.worksheetItems.length, 1);
  const diff = revisionImpactForPickups(candidates, { diff: { baseModelId: "base", headModelId: "head", rows: [{ baseElementId: "element", headElementId: "next", changeType: "modified", externalId: "native" }] } });
  assert.equal(diff.pickups.length, 3);
  assert.deepEqual(candidates, before);
  assert.equal(revisionImpactForPickups(candidates, { document: { id: "doc", checksum: "new", pageNumbers: [2] } }).pickups.length, 0);
});

test("source resolution scopes documents, files and linked documents to the project", async () => {
  const { prisma } = await import("@bidwright/db");
  const { readProjectSource } = await import("./piping-service.js");
  const originalDocument = prisma.sourceDocument.findFirst, originalFile = prisma.fileNode.findFirst;
  try {
    prisma.sourceDocument.findFirst = (async ({ where }: any) => { assert.equal(where.projectId, "project"); return null; }) as any;
    prisma.fileNode.findFirst = (async ({ where }: any) => { assert.equal(where.projectId, "project"); return where.id === "linked" ? { id: "linked", documentId: "foreign", storagePath: "/not-read", name: "source.piping" } : null; }) as any;
    await assert.rejects(readProjectSource("project", { sourceId: "foreign", sourceKind: "source_document" }), /not found in project/);
    await assert.rejects(readProjectSource("project", { sourceId: "foreign", sourceKind: "file_node" }), /not found in project/);
    await assert.rejects(readProjectSource("project", { sourceId: "linked", sourceKind: "file_node" }), /outside this project/);
  } finally {
    prisma.sourceDocument.findFirst = originalDocument;
    prisma.fileNode.findFirst = originalFile;
  }
});

test("piping extensions classify ahead of prose and expose piping capabilities", async () => {
  const { classifyDocument, pipingCapability } = await import("../../../../../packages/ingestion/src/classification.js");
  for (const extension of ["piping", "pcf"]) {
    assert.equal(classifyDocument({ name: `spec.${extension}`, path: `spec.${extension}`, extension, bytes: new Uint8Array(), size: 0 }, "request for quotation"), "piping");
    assert.deepEqual(pipingCapability(`source.${extension}`), { kind: "piping", format: extension, mto: true });
  }
});

test("MCP wrappers forward scoped source IDs to existing photo/scan services and declare writes", async () => {
  const { registerPipingTools } = await import("../../../../../packages/mcp-server/src/tools/piping-tools.js");
  const { AGENT_TOOL_REGISTRY } = await import("../../../../../packages/domain/src/agent-tool-registry.js");
  const handlers = new Map<string, (input: any) => Promise<unknown>>();
  registerPipingTools({ tool(name: string, _description: string, _schema: unknown, handler: any) { handlers.set(name, handler); } } as any);
  const calls: Array<{ url: string; body: any }> = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;
    const sources = [{ sourceId: "photo", sourceKind: "file_node" }];
    await handlers.get("runPhotoBom")!({ sources, focusPrompt: "Identify visible pipe" });
    await handlers.get("segmentPointCloud")!({ modelId: "scan", operation: "identify", sources, segmentIds: ["segment"] });
    await handlers.get("segmentPointCloud")!({ modelId: "scan", operation: "segment", voxel: 0.02 });
    assert.match(calls[0].url, /\/photo-bom$/);
    assert.deepEqual(calls[0].body.sources, sources);
    assert.match(calls[1].url, /\/assets\/scan\/segments\/identify$/);
    assert.deepEqual(calls[1].body.segmentIds, ["segment"]);
    assert.match(calls[2].url, /\/assets\/scan\/segment$/);
    for (const name of handlers.keys()) {
      const definition = AGENT_TOOL_REGISTRY[name as keyof typeof AGENT_TOOL_REGISTRY];
      assert.equal(("mutates" in definition ? definition.mutates : false), ["segmentPointCloud", "savePipingTakeoff"].includes(name));
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("PCF retains common variants and reports unknown component blocks with source refs", () => {
  const types = ["TEE-SET-ON", "TEE-STUB", "PIPE-FIXED", "MISC-COMPONENT", "ELBOW-REDUCING", "CUSTOM-FITTING"];
  const text = "UNITS-CO-ORDS MM\nUNITS-BORE INCH\nPIPELINE-REFERENCE P1\n" + types.map((type, i) => `${type}\n    END-POINT ${i * 1000} 0 0 2 BW\n    END-POINT ${i * 1000 + 100} 0 0 2 BW`).join("\n");
  const mto = parsePcf(text);
  assert.deepEqual(mto.lines.filter(l => l.type !== "JOINT").map(l => l.type), types.slice(0, -1));
  assert.equal(mto.lines.find(l => l.type === "PIPE-FIXED")?.quantity, 0.1);
  assert.ok(mto.warnings.some(w => w.includes("CUSTOM-FITTING")));
  const unknown = mto.joints.unknown.find(u => u.reason.includes("CUSTOM-FITTING"));
  assert.equal(unknown?.refs[0].line, 19);
  assert.equal(unknown?.refs[0].endLine, 21);
});

test("Spoolyard PCF weld-node and tagged CO-ORDS records count one physical weld", () => {
  // Geometry from exportPcf() for two runs meeting at one tagged weld node;
  // upstream welds() returns one. Both explicit records describe that weld.
  const text = `UNITS-CO-ORDS MM
UNITS-BORE INCH
PIPELINE-REFERENCE L1
WELD
    CENTRE-POINT 1000 0 0 2 BW
    END-POINT 1000 0 0 2 BW
    END-POINT 1000 0 0 2 BW
    CATEGORY-ERECTION
    WELD-IDENTIFIER W1
PIPE
    END-POINT 0 0 0 2 BW
    END-POINT 1000 0 0 2 BW
PIPE
    END-POINT 1000 0 0 2 BW
    END-POINT 2000 0 0 2 BW
WELD
    CO-ORDS 1000 0 0 2 BW
    WELD-IDENTIFIER W1
    CATEGORY-ERECTION`;
  const mto = parsePcf(text);
  assert.equal(mto.joints.knownCount, 1);
  assert.equal(mto.lines.find(l => l.type === "JOINT")?.refs.length, 2);
  assert.equal(mto.lines.find(l => l.type === "JOINT")?.scope, "field");
  assert.equal(parsePcf(text.replaceAll("CATEGORY-ERECTION", "CATEGORY-FABRICATION")).lines.find(l => l.type === "JOINT")?.scope, "shop");
  // A tagged CO-ORDS record also suppresses a joint derived from pipe endpoints.
  assert.equal(parsePcf(text.replace(/WELD\n    CENTRE-POINT[\s\S]*?    WELD-IDENTIFIER W1\n/, "")).joints.knownCount, 1);
});

test("large Spoolyard drawings retain accurate refs without quadratic scans", () => {
  const nodes = Array.from({ length: 8000 }, (_, i) => ({ id: `n${i}`, kind: i === 0 || i === 7999 ? "end" : "weld", position: [i * 1000, 0, 0] }));
  const runs = nodes.slice(1).map((_, i) => ({ id: `r${i}`, from: `n${i}`, to: `n${i + 1}`, specId: "S1", nps: 2, endPrep: "BW" }));
  const text = JSON.stringify({ schema: "bidwright-piping", version: 1, specs: [spec], nodes, runs }, null, 2);
  const start = performance.now();
  const mto = parseSpoolyard(text);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 5000, `8000 nodes took ${elapsed.toFixed(0)} ms`);
  const ref = mto.lines.flatMap(l => l.refs).find(r => r.id === "r7998")!;
  assert.ok(text.split("\n")[ref.line - 1].includes('"r7998"'));
  assert.equal(mto.joints.knownCount, 7998);
});

test("bounded source reads reject oversized files and FileNode save/revision IDs match the UI", async () => {
  const { mkdtemp, writeFile, truncate, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { prisma } = await import("@bidwright/db");
  const { getPipingMto, readBoundedProjectFile, MAX_PROJECT_SOURCE_BYTES } = await import("./piping-service.js");
  const { getRevisionImpact } = await import("../revision-impact-service.js");
  const root = await mkdtemp(join(tmpdir(), "piping-revision-"));
  const storagePath = join(root, "source.piping");
  const originals = { doc: prisma.sourceDocument.findFirst, file: prisma.fileNode.findFirst, views: prisma.evidenceView.findMany, pickups: prisma.pickup.findMany };
  try {
    await writeFile(storagePath, "");
    await truncate(storagePath, MAX_PROJECT_SOURCE_BYTES + 1);
    await assert.rejects(readBoundedProjectFile(storagePath), /8 MB/);
    await writeFile(storagePath, JSON.stringify(drawing()));
    prisma.sourceDocument.findFirst = (async () => null) as any;
    prisma.fileNode.findFirst = (async ({ where }: any) => {
      assert.equal(where.projectId, "project");
      const ids = where.OR?.map((clause: any) => clause.id) ?? [where.id];
      return ids.includes("file-node") ? { id: "file-node", documentId: null, storagePath, name: "source.piping" } : null;
    }) as any;
    prisma.evidenceView.findMany = (async () => []) as any;
    prisma.pickup.findMany = (async ({ where }: any) => {
      assert.ok(where.documentId.in.includes("file-file-node"));
      assert.ok(where.documentId.in.includes("file-node"));
      return ["file-file-node", "file-node"].map((documentId, i) => ({ id: `p${i}`, documentId, pageNumber: 1, modelId: null, modelElementId: null, metadata: { sourceChecksum: "prior", measuredBy: "person" }, selection: {}, createdBy: null, pickupLinks: [] }));
    }) as any;
    const mto = await getPipingMto("project", { sourceId: "file-node", sourceKind: "file_node" });
    assert.equal(pipingPickupInput(mto, { lineId: mto.lines[0].id }).documentId, "file-file-node");
    for (const documentId of ["file-node", "file-file-node"]) {
      const impact = await getRevisionImpact("project", { documentId, priorChecksum: "prior" });
      assert.equal(impact.pickups.length, 2);
      assert.equal(impact.summary.humanPickups, 2);
    }
  } finally {
    prisma.sourceDocument.findFirst = originals.doc;
    prisma.fileNode.findFirst = originals.file;
    prisma.evidenceView.findMany = originals.views;
    prisma.pickup.findMany = originals.pickups;
    await rm(root, { recursive: true, force: true });
  }
});

test("piping and scan routes reject inaccessible projects before global services run", async () => {
  const { default: Fastify } = await import("fastify");
  const { pipingRoutes } = await import("../../routes/piping-routes.js");
  const { modelRoutes } = await import("../../routes/model-routes.js");
  const app = Fastify();
  app.decorateRequest("store", null);
  app.addHook("onRequest", async request => {
    request.store = new Proxy({ getProject: async () => null }, { get(target, key) {
      if (key === "getProject") return target.getProject;
      throw new Error(`Unexpected store access: ${String(key)}`);
    } }) as any;
  });
  await app.register(pipingRoutes);
  await app.register(modelRoutes);
  try {
    const requests = [
      { method: "GET" as const, url: "/api/takeoff/foreign/piping/mto?sourceId=x&sourceKind=file_node" },
      { method: "POST" as const, url: "/api/takeoff/foreign/piping/pickups", payload: { sourceId: "x", sourceKind: "file_node", lines: [{ lineId: "x" }] } },
      { method: "GET" as const, url: "/api/takeoff/foreign/revision-impact?documentId=x" },
      { method: "POST" as const, url: "/api/models/foreign/assets/x/segment", payload: {} },
      { method: "GET" as const, url: "/api/models/foreign/assets/x/segments" },
      { method: "POST" as const, url: "/api/models/foreign/assets/x/segments/identify", payload: { sources: [{ sourceId: "x", sourceKind: "file_node" }] } },
    ];
    for (const request of requests) {
      const response = await app.inject(request);
      assert.equal(response.statusCode, 404, request.url);
      assert.equal(response.json().message, "Project not found");
    }
  } finally { await app.close(); }
});
