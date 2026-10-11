#!/usr/bin/env tsx
// No model execution. References and run manifests stay outside the repository.
// freeze --project-id ID --out /private/reference.json [--pickup-ids ID,ID]
// prepare --reference-file /private/reference.json --mode independent|reuse --repeat 3 --out /private/runs.json [--execute]
// score --reference-file /private/reference.json --runs-file /private/runs.json --out /private/score.json [--tolerance 0.05]
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import {
  pickupKind, pickupQuantity, pickupSnapshot, scoreTakeoff, summarizeScores, validateReference,
  type EvalMode, type PreparedRun, type RecordLike, type TakeoffReference, type TakeoffResult,
} from "./takeoff-reference.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [command, ...args] = process.argv.slice(2);
const option = (flag: string, fallback = "") => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
if (!command || args.includes("--help") || command === "--help") {
  console.log("takeoff-reference-cli.ts freeze|prepare|score --out <outside-repo.json>\nfreeze: --project-id ID [--pickup-ids ID,ID]\nprepare: --reference-file FILE --mode reuse|independent [--repeat N] [--execute]\nscore: --reference-file FILE --runs-file FILE [--tolerance 0.05] [--coordinate-tolerance 0.5]\nAPI: --api-url URL --token-file FILE (or BIDWRIGHT_AUTH_TOKEN). No model runs are launched.");
  process.exit(0);
}
if (!["freeze", "prepare", "score"].includes(command)) throw new Error("Expected freeze, prepare or score");
const out = option("--out");
if (!out) throw new Error("--out is required and must be outside the repository");
async function externalOutput(file: string) {
  const target = resolve(file);
  // Check the nearest existing ancestor too, so a symlink cannot put customer
  // references in the worktree. Do this before creating any directories.
  let ancestor = dirname(target);
  while (true) {
    try { ancestor = await realpath(ancestor); break; }
    catch (error: any) { if (error.code !== "ENOENT") throw error; const parent = dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent; }
  }
  const inside = (path: string) => { const rel = relative(repoRoot, path); return !rel || (!rel.startsWith("..") && !isAbsolute(rel)); };
  if (inside(target) || inside(ancestor)) throw new Error("Customer reference output belongs outside the repository");
  await mkdir(dirname(target), { recursive: true });
  return target;
}
const destination = await externalOutput(out);
const save = (value: unknown) => writeFile(destination, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
const reference: TakeoffReference | undefined = command === "freeze" ? undefined : JSON.parse(await readFile(option("--reference-file"), "utf8"));
if (reference) validateReference(reference);
const mode = option("--mode", "independent") as EvalMode;
if (!["reuse", "independent"].includes(mode)) throw new Error("--mode is reuse or independent");
const repeat = Number(option("--repeat", "1"));
if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat is a positive integer");
if (command === "prepare" && !args.includes("--execute")) {
  console.log(JSON.stringify({ sourceProjectId: reference!.projectId, mode, repeat, output: destination,
    action: "Copy/reset source project via API, preserve source calibration, retain human pickups only in reuse mode. No model runs. Pass --execute to create copies." }, null, 2));
  process.exit(0);
}
const apiUrl = option("--api-url", process.env.BIDWRIGHT_API_URL ?? "http://localhost:4001").replace(/\/+$/, "");
const tokenFile = option("--token-file", process.env.BIDWRIGHT_AUTH_TOKEN_FILE);
const token = tokenFile ? (await readFile(tokenFile, "utf8")).trim() : process.env.BIDWRIGHT_AUTH_TOKEN;
if (!token) throw new Error("Set BIDWRIGHT_AUTH_TOKEN or --token-file");
async function api<T = any>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, { method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Bidwright-Actor": "eval-harness" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
async function readResult(projectId: string): Promise<TakeoffResult> {
  const [response, pickups, links] = await Promise.all([
    api(`/projects/${projectId}/workspace`), api(`/api/takeoff/${projectId}/pickups`), api(`/api/takeoff/${projectId}/links`),
  ]);
  const workspace = response.workspace ?? response;
  return { projectId, documents: workspace.sourceDocuments ?? [], pickups, links,
    rows: (workspace.worksheets ?? []).flatMap((worksheet: RecordLike) => worksheet.items ?? []),
    total: workspace.currentRevision?.calculatedTotal ?? workspace.estimateTotals?.calculatedTotal };
}
function remapDocuments(reference: TakeoffReference, documents: RecordLike[]) {
  const ids = new Map<string, string>();
  for (const entry of reference.entries) {
    const matches = documents.filter((doc) => doc.checksum === entry.source.checksum && doc.fileName === entry.source.fileName);
    if (matches.length !== 1) throw new Error(`Cannot uniquely remap ${entry.source.documentId}; checksum changed or source was not copied`);
    ids.set(entry.source.documentId, matches[0].id);
  }
  return ids;
}

if (command === "freeze") {
  const projectId = option("--project-id");
  if (!projectId) throw new Error("--project-id is required");
  const [result, state] = await Promise.all([readResult(projectId), api(`/projects/${projectId}/workspace-state`)]);
  const selected = option("--pickup-ids").split(",").filter(Boolean);
  if (selected.some((id) => !result.pickups.some((pickup) => pickup.id === id))) throw new Error("Selected pickup id does not exist in this project");
  // Older human marks have unrecorded provenance. An explicit id selection is
  // supported, but absence of agent metadata alone is not evidence of authorship.
  const humans = result.pickups.filter((pickup) => selected.length ? selected.includes(pickup.id) : pickup.metadata?.measuredBy === "person");
  const calibrations = state.state?.takeoffCalibrations ?? {};
  const frozen: TakeoffReference = { version: 1, reviewed: false, frozenAt: new Date().toISOString(), projectId, calibrations,
    entries: humans.map((pickup) => {
      const doc = result.documents.find((document) => document.id === pickup.documentId);
      if (!doc?.checksum) throw new Error(`Pickup ${pickup.id} has no source document checksum in the API workspace`);
      return { pickupId: pickup.id, source: { documentId: doc.id, fileName: doc.fileName, checksum: doc.checksum,
        revision: doc.revisionId ?? doc.revision ?? doc.updatedAt ?? null }, page: pickup.pageNumber,
        calibration: pickup.calibration ?? calibrations[pickup.documentId]?.[pickup.pageNumber] ?? null,
        quantity: pickupQuantity(pickup), unit: pickup.measurement?.unit ?? "", kind: pickupKind(pickup),
        scope: pickup.groupName || pickup.label, exclusions: pickup.metadata?.exclusions ?? [], snapshot: pickupSnapshot(pickup) };
    }) };
  validateReference(frozen, false);
  await save(frozen);
  console.log(JSON.stringify({ output: destination, pickups: frozen.entries.length, reviewed: false }));
} else if (command === "prepare") {
  // Same reset-copy and revision-text clearing as direct-estimator.ts. Copies
  // currently omit pickups, FileNodes and models; never reuse source model ids.
  const source = await readResult(reference!.projectId);
  remapDocuments(reference!, source.documents);
  if (mode === "reuse") {
    for (const entry of reference!.entries) {
      const pickup = source.pickups.find((pickup) => pickup.id === entry.pickupId);
      if (!pickup || !isDeepStrictEqual(pickupSnapshot(pickup), entry.snapshot)) throw new Error(`Human pickup ${entry.pickupId} changed since the reference was frozen; review a new reference`);
    }
  }
  if (reference!.entries.some((entry) => entry.snapshot.modelId || entry.snapshot.sourceKind === "model")) throw new Error("Project copy does not remap model assets; native model reference preparation is unavailable");
  const runs: PreparedRun[] = [];
  await save({ version: 1, referenceFile: resolve(option("--reference-file")), runs });
  for (let iteration = 1; iteration <= repeat; iteration++) {
    const copied = await api(`/projects/${reference!.projectId}/copy`, { resetEstimate: true });
    const workspace = copied.workspace ?? copied;
    const projectId = workspace.project?.id;
    if (!projectId || projectId === reference!.projectId) throw new Error("Copy returned no isolated project");
    const run: PreparedRun = { projectId, sourceProjectId: reference!.projectId, mode, iteration, prepared: false, baseline: [] };
    runs.push(run);
    // Persist immediately: even a failed preparation leaves a recoverable id.
    const record = () => writeFile(destination, JSON.stringify({ version: 1, referenceFile: resolve(option("--reference-file")), runs }, null, 2) + "\n", { mode: 0o600 });
    await record();
    const result = await readResult(projectId);
    const ids = remapDocuments(reference!, result.documents);
    const revisionId = workspace.currentRevision?.id ?? workspace.revision?.id;
    if (revisionId) await api(`/projects/${projectId}/revisions/${revisionId}`, { description: "", notes: "", status: "Open" }, "PATCH");
    for (const pickup of result.pickups) await api(`/api/takeoff/${projectId}/pickups/${pickup.id}`, undefined, "DELETE");
    const calibrations = Object.fromEntries([...ids].filter(([oldId]) => reference!.calibrations[oldId] !== undefined)
      .map(([oldId, newId]) => [newId, reference!.calibrations[oldId]]));
    await api(`/projects/${projectId}/workspace-state`, { takeoffCalibrations: calibrations }, "PATCH");
    if (mode === "reuse") {
      for (const entry of reference!.entries) {
        const pickup = await api(`/api/takeoff/${projectId}/pickups`, { ...entry.snapshot, documentId: ids.get(entry.source.documentId) });
        run.baseline.push(pickup);
        await record();
      }
    }
    run.prepared = true;
    await record();
  }
  console.log(JSON.stringify({ output: destination, mode, projects: runs.map((run) => run.projectId), modelRunsLaunched: 0 }));
} else {
  const manifest = JSON.parse(await readFile(option("--runs-file"), "utf8"));
  const scores = [];
  for (const run of manifest.runs as PreparedRun[]) {
    if (!run.prepared) throw new Error(`Run ${run.projectId} preparation is incomplete`);
    if (run.sourceProjectId !== reference!.projectId || run.projectId === reference!.projectId) throw new Error("Run manifest does not describe an isolated reference copy");
    const result = await readResult(run.projectId);
    scores.push(scoreTakeoff(reference!, result, { mode: run.mode, baseline: run.baseline,
      tolerance: Number(option("--tolerance", "0.05")), coordinateTolerance: Number(option("--coordinate-tolerance", "0.5")) }));
  }
  await save({ scores, summary: summarizeScores(scores) });
  console.log(JSON.stringify({ output: destination, summary: summarizeScores(scores) }, null, 2));
}
