import assert from "node:assert/strict";
import test from "node:test";
import { imageProbePattern } from "./image-probe-pattern.js";
import { scoreSavedOutcome } from "./outcome-score.js";
import { blindCopiedRevision, BLIND_REVISION_PATCH } from "./blind-copy.js";
import { referenceEvalOutputDir } from "./eval-output.js";
import { normalizedUnit, pickupSnapshot, scoreTakeoff, summarizeScores, type TakeoffReference, type TakeoffResult } from "./takeoff-reference.js";

function fixture() {
  const document = { id: "doc-copy", fileName: "synthetic.pdf", checksum: "synthetic-v1" };
  const count = { id: "count-copy", documentId: document.id, pageNumber: 1, annotationType: "count", label: "Fixtures", groupName: "",
    points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 100 }], measurement: { value: 3, unit: "ea" }, metadata: { measuredBy: "person" } };
  const length = { ...count, id: "length-copy", annotationType: "linear", label: "Pipe", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    measurement: { value: 10, unit: "m" }, calibration: { pixelsPerUnit: 10, unit: "m" } };
  const area = { ...length, id: "area-copy", annotationType: "area-rectangle", label: "Surface", points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], measurement: { value: 100, unit: "m2" } };
  const pickups = [count, length, area];
  const reference: TakeoffReference = { version: 1, reviewed: true, frozenAt: "2026-10-11T00:00:00Z", projectId: "source", calibrations: {},
    entries: pickups.map((pickup, i) => ({ pickupId: `human-${i}`, source: { documentId: "doc-source", fileName: document.fileName, checksum: document.checksum, revision: "v1" },
      page: 1, calibration: "calibration" in pickup ? pickup.calibration : null, quantity: pickup.measurement.value, unit: pickup.measurement.unit,
      kind: i === 0 ? "count" : i === 1 ? "length" : "area", scope: pickup.label, exclusions: [], snapshot: pickupSnapshot(pickup) })) };
  const result: TakeoffResult = { projectId: "copy", documents: [document], pickups,
    rows: pickups.map((pickup, i) => ({ id: `row-${i}`, quantity: pickup.measurement.value, unit: pickup.measurement.unit })),
    links: pickups.map((pickup, i) => ({ pickupId: pickup.id, worksheetItemId: `row-${i}`, quantityField: "value", multiplier: 1, derivedQuantity: pickup.measurement.value })) };
  return { reference, result };
}

test("real-shaped grouped count, calibrated length/area and linked rows score correctly", () => {
  const { reference, result } = fixture();
  const scored = scoreTakeoff(reference, result, { mode: "reuse", baseline: structuredClone(result.pickups) });
  assert.equal(scored.accuracy, 1);
  assert.deepEqual(scored.changedHumanPickups, []);
  assert.deepEqual(summarizeScores([scored, scored]).accuracy, { n: 2, mean: 1, variance: 0 });
  result.pickups[1].measurement.value = 10.5;
  result.pickups[2].measurement.value = 104;
  const tolerant = scoreTakeoff(reference, result, { mode: "independent" });
  assert.equal(tolerant.metrics.quantityAccuracy, 1);
  assert.equal(tolerant.metrics.usableLinks, 1 / 3); // stale link/row values are not usable
  assert.equal(scoreTakeoff(reference, result, { mode: "independent", tolerance: 0.01 }).metrics.quantityAccuracy, 1 / 3);
});

test("bad units, N squared counts, duplicate overlapping marks, stale sources and human edits lower outcomes", () => {
  const { reference, result } = fixture();
  const baseline = structuredClone(result.pickups);
  result.pickups.push({ ...structuredClone(result.pickups[0]), id: "duplicate", points: [{ x: 100.1, y: 100 }] });
  result.pickups[1].points[1].x = 150;
  result.pickups[1].measurement.unit = "ft";
  result.links[0].worksheetItemId = "missing-row";
  const scored = scoreTakeoff(reference, result, { mode: "reuse", baseline });
  assert.equal(scored.comparisons[0].observed, 6);
  assert.equal(scored.comparisons[0].quantityCorrect, false);
  assert.equal(scored.comparisons[0].usableLinks, false);
  assert.equal(scored.comparisons[1].unitCorrect, false);
  assert.deepEqual(scored.duplicates, [{ pickupIds: ["count-copy", "duplicate"] }]);
  assert.deepEqual(scored.changedHumanPickups, ["length-copy"]);
  result.documents[0].checksum = "changed-v2";
  assert.equal(scoreTakeoff(reference, result, { mode: "independent" }).metrics.quantityAccuracy, 0);
});

test("overlapping linear runs and fractional counts are defects; invalid/unreviewed reference cannot grade", () => {
  const { reference, result } = fixture();
  result.pickups.push({ ...result.pickups[1], id: "overlap", points: [{ x: 50, y: 0 }, { x: 150, y: 0 }] });
  assert.deepEqual(scoreTakeoff(reference, result, { mode: "independent" }).duplicates, [{ pickupIds: ["length-copy", "overlap"] }]);
  result.pickups[0].measurement.value = 3.01;
  assert.equal(scoreTakeoff(reference, result, { mode: "independent" }).comparisons[0].quantityCorrect, false);
  assert.throws(() => scoreTakeoff(reference, result, { mode: "reuse" }), /baseline/);
  assert.throws(() => scoreTakeoff(reference, result, { mode: "independent", tolerance: NaN }), /tolerance/);
  reference.reviewed = false;
  assert.throws(() => scoreTakeoff(reference, result, { mode: "independent" }), /reviewed:true/);
});

test("outcome scoring needs no tools, thoughts, strategy saves or visual artifacts", () => {
  const good = { runCompleted: true, sourceReady: true, extractedSources: 1, failedTools: 0, maxToolFailures: 0,
    estimating: true, items: 1, minItems: 1, pricedItems: 1, total: 10, defects: 0, findings: 0 };
  assert.equal(scoreSavedOutcome(good).score, 100);
  assert.equal(scoreSavedOutcome({ ...good, referenceAccuracy: 0 }).score, 80);
  assert.equal(scoreSavedOutcome({ ...good, defects: 1 }).grade, "needs_review");
  assert.equal(scoreSavedOutcome({ ...good, runCompleted: false }).grade, "fail");
  assert.ok(scoreSavedOutcome({ ...good, failedTools: 1 }).score < 100);
  const empty = scoreSavedOutcome({ ...good, items: 0, pricedItems: 0, total: 0 });
  assert.equal(empty.score, 60);
  assert.equal(empty.grade, "fail");
  assert.equal(scoreSavedOutcome({ ...good, extractedSources: 0 }).grade, "fail");
  assert.equal(scoreSavedOutcome({ ...good, estimating: false, items: 0, pricedItems: 0, total: 0 }).grade, "pass");
});

test("resolution fixtures have native dimensions and no answer metadata", () => {
  for (const edge of [1568, 2000, 2576]) {
    const pattern = imageProbePattern(edge, true);
    assert.equal(pattern.png.readUInt32BE(16), edge);
    assert.equal(pattern.png.readUInt32BE(20), edge);
    assert.equal(pattern.expected.length, 9);
    assert.ok(pattern.expected.every((answer) => /^\d{6}$/.test(answer)));
    assert.equal(pattern.png.includes(Buffer.from("tEXt")), false);
  }
});

test("CLI freezes unreviewed data and prepares isolated repeat copies through API only", async () => {
  const { createServer } = await import("node:http");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const run = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), "takeoff-eval-"));
  const { result } = fixture();
  const projects = new Map<string, TakeoffResult>([["source", { ...structuredClone(result), projectId: "source" }]]);
  const paths: string[] = [];
  const revisionPatches: unknown[] = [];
  const server = createServer(async (request, response) => {
    try {
      const path = request.url!;
      paths.push(`${request.method} ${path}`);
      let text = "";
      for await (const chunk of request) text += chunk;
      const body = text ? JSON.parse(text) : {};
      const projectId = path.split("/")[path.startsWith("/api/") ? 3 : 2];
      const project = projects.get(projectId)!;
      let value: any;
      if (path.endsWith("/copy")) {
        const id = `copy-${projects.size}`;
        projects.set(id, { ...structuredClone(project), projectId: id, pickups: [], links: [], rows: [], documents: project.documents.map((doc) => ({ ...doc, id: `${id}-doc` })) });
        value = { workspace: { project: { id }, currentRevision: { id: "rev" } } };
      } else if (path.endsWith("/workspace")) value = { workspace: { sourceDocuments: project.documents, worksheets: [{ items: project.rows }] } };
      else if (path.endsWith("/workspace-state")) value = { state: { takeoffCalibrations: { "doc-copy": { 1: { pixelsPerUnit: 10, unit: "m" } } } } };
      else if (path.endsWith("/links")) value = project.links;
      else if (path.endsWith("/pickups") && request.method === "GET") value = project.pickups;
      else if (path.endsWith("/pickups") && request.method === "POST") {
        value = { ...body, id: `${projectId}-pickup-${project.pickups.length}` };
        project.pickups.push(value);
      } else if (path.includes("/revisions/") && request.method === "PATCH") { revisionPatches.push(body); value = {}; }
      else throw new Error(`Unexpected API call: ${request.method} ${path}`);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(value));
    } catch (error) { response.statusCode = 500; response.end(String(error)); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const cli = (...args: string[]) => run(process.execPath, ["--import", "tsx", resolve("scripts/eval/takeoff-reference-cli.ts"), ...args,
    "--api-url", `http://127.0.0.1:${address.port}`], { env: { ...process.env, BIDWRIGHT_AUTH_TOKEN: "synthetic-token" } });
  try {
    const referencePath = join(dir, "reference.json");
    await cli("freeze", "--project-id", "source", "--out", referencePath);
    const reference = JSON.parse(await readFile(referencePath, "utf8"));
    assert.equal(reference.reviewed, false);
    assert.equal(reference.entries.length, 3);
    reference.reviewed = true;
    await writeFile(referencePath, JSON.stringify(reference));
    for (const mode of ["reuse", "independent"]) {
      const runsPath = join(dir, `${mode}.json`);
      await cli("prepare", "--reference-file", referencePath, "--mode", mode, "--repeat", "2", "--out", runsPath, "--execute");
      const manifest = JSON.parse(await readFile(runsPath, "utf8"));
      assert.equal(manifest.runs.length, 2);
      for (const attempt of manifest.runs) {
        const project = projects.get(attempt.projectId)!;
        assert.equal(project.pickups.length, mode === "reuse" ? 3 : 0);
        assert.equal(attempt.baseline.length, mode === "reuse" ? 3 : 0);
        assert.ok(project.pickups.every((pickup) => pickup.documentId === project.documents[0].id));
      }
      await cli("score", "--reference-file", referencePath, "--runs-file", runsPath, "--out", join(dir, `${mode}-score.json`));
    }
    assert.equal(revisionPatches.length, 4);
    assert.ok(revisionPatches.every((patch) => JSON.stringify(patch) === JSON.stringify(BLIND_REVISION_PATCH)));
    assert.equal(projects.get("source")!.pickups.length, 3);
    assert.ok(!paths.some((path) => /\/api\/cli\//.test(path)));
    assert.ok(!paths.some((path) => /^(POST|PATCH|DELETE).*\/source\//.test(path) && !path.endsWith("/copy")));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});


test("independent takeoffs match geometry and UOM even with unrelated or empty labels", () => {
  const { reference, result } = fixture();
  result.pickups.forEach((pickup, index) => { pickup.label = index ? "agent choice" : ""; pickup.groupName = ""; });
  result.pickups[1].annotationType = "linear-polyline";
  result.pickups[1].points = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }];
  result.rows[0].unit = "EA";
  result.rows[1].unit = "M";
  result.rows[2].unit = "SM";
  const score = scoreTakeoff(reference, result, { mode: "independent" });
  assert.equal(score.accuracy, 1);
  assert.ok(score.comparisons.every((comparison) => !comparison.labelAgreement.agrees && !comparison.labelAgreement.scored));

  // A blinded agent can combine count groups whose human-only labels differ.
  const extra = structuredClone(reference.entries[0]);
  extra.pickupId = "human-extra";
  extra.scope = "Private grouping";
  extra.quantity = 1;
  extra.snapshot.points = [{ x: 400, y: 100 }];
  reference.entries.push(extra);
  result.pickups[0].points.push({ x: 400, y: 100 });
  result.pickups[0].measurement.value = result.rows[0].quantity = result.links[0].derivedQuantity = 4;
  assert.equal(scoreTakeoff(reference, result, { mode: "independent" }).accuracy, 1);

  result.pickups[1].points = [{ x: 0, y: 500 }, { x: 100, y: 500 }];
  const misplaced = scoreTakeoff(reference, result, { mode: "independent" });
  assert.equal(misplaced.comparisons[1].quantityCorrect, false);
  assert.ok(misplaced.unmatchedPickupIds.includes("length-copy"));
  assert.equal(scoreTakeoff(reference, result, { mode: "independent", pickupMapping: { "length-copy": "human-1" } }).accuracy, 1);
  result.pickups[1].measurement.unit = "ft";
  assert.equal(scoreTakeoff(reference, result, { mode: "independent", pickupMapping: { "length-copy": "human-1" } }).comparisons[1].unitCorrect, false);
  assert.throws(() => scoreTakeoff(reference, result, { mode: "independent", pickupMapping: { "missing": "human-1" } }), /unknown pickup/);
});

test("worksheet UOM aliases normalize without converting different units", () => {
  for (const [unit, expected] of Object.entries({ EA: "count", each: "count", LF: "ft", SF: "ft2", SY: "yd2", CY: "yd3", CF: "ft3", M: "m", SM: "m2", "m²": "m2", "m³": "m3" })) {
    assert.equal(normalizedUnit(unit), expected);
  }
  assert.notEqual(normalizedUnit("LF"), normalizedUnit("M"));
  const { reference, result } = fixture();
  reference.entries[1].unit = "ft";
  reference.entries[2].unit = "ft2";
  result.pickups[1].measurement.unit = "ft";
  result.pickups[2].measurement.unit = "ft2";
  result.rows[1].unit = "LF";
  result.rows[2].unit = "SF";
  assert.equal(scoreTakeoff(reference, result, { mode: "independent" }).accuracy, 1);
});

test("shared blinding clears copied revision narrative and refuses the source project", async () => {
  const revision = { title: "Private title", description: "Private scope", notes: "Private count",
    scratchpad: "Private calculation", leadLetter: "Private allowance", followUpNote: "Private quantity",
    shippingMethod: "Private method", shippingTerms: "Private terms", freightOnBoard: "Private freight", status: "Awarded" };
  await blindCopiedRevision("source", "copy", "rev", async (path, body) => {
    assert.equal(path, "/projects/copy/revisions/rev");
    Object.assign(revision, body);
  });
  assert.equal(revision.title, "Evaluation");
  assert.equal(revision.status, "Open");
  for (const key of ["description", "notes", "scratchpad", "leadLetter", "followUpNote", "shippingMethod", "shippingTerms", "freightOnBoard"] as const) assert.equal(revision[key], "");
  await assert.rejects(blindCopiedRevision("source", "source", "rev", async () => assert.fail("Source mutation")), /isolated/);
});

test("reference output defaults outside the checkout, including matrix child destinations", async () => {
  const { relative, isAbsolute, resolve } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const output = referenceEvalOutputDir("synthetic-run");
  const rel = relative(process.cwd(), output);
  assert.ok(rel.startsWith("..") || isAbsolute(rel));
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", resolve("scripts/eval/run-model-matrix.ts"),
    "--project-id", "synthetic", "--reference-file", "/tmp/synthetic-reference.json"]);
  const matrix = JSON.parse(stdout);
  assert.ok(matrix.output.startsWith(referenceEvalOutputDir("matrix-")));
});
