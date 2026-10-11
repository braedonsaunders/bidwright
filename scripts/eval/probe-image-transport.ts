#!/usr/bin/env tsx
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { imageProbePattern } from "./image-probe-pattern.js";

const argv = process.argv.slice(2);
const option = (name: string, fallback = "") => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
const resolution = argv.includes("--measure-resolution");
const edges = option("--edges", resolution ? "1568,2000,2576" : "512").split(",").map(Number);
const repeat = Number(option("--repeat", "1"));
if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat must be a positive integer");
const probes = Array.from({ length: repeat }, (_, iteration) => edges.map((edge) => ({ edge, iteration: iteration + 1, ...imageProbePattern(edge, resolution) }))).flat();
const runtime = option("--runtime", "openrouter"), model = option("--model", "moonshotai/kimi-k3");
const out = option("--out", `image-probe-${Date.now()}.json`);
if (!argv.includes("--execute")) {
  const fixtureDir = option("--fixture-dir");
  if (fixtureDir) {
    await mkdir(fixtureDir, { recursive: true });
    for (const [index, probe] of probes.entries()) await writeFile(join(fixtureDir, `probe-${index}-${probe.edge}.png`), probe.png);
    await writeFile(join(fixtureDir, "answers.json"), JSON.stringify(probes.map(({ png, ...probe }) => probe), null, 2), { mode: 0o600 });
  }
  console.log(JSON.stringify({ runtime, model, edges, repeat, resolution, fixtureDir, modelRuns: probes.length,
    instruction: "Dry run. --execute creates an isolated project and spends model tokens. --measure-resolution tests 1/2/4-pixel digit strokes at each edge. No defaults change automatically." }, null, 2));
  process.exit(0);
}
const api = option("--api-url", process.env.BIDWRIGHT_API_URL || "http://localhost:4001").replace(/\/$/, "");
const source = option("--project-id");
if (!source) throw new Error("--project-id is required");
const tokenFile = option("--token-file");
const token = tokenFile ? (await readFile(tokenFile, "utf8")).trim() : process.env.BIDWRIGHT_AUTH_TOKEN;
if (!token) throw new Error("Set BIDWRIGHT_AUTH_TOKEN or --token-file");
const headers = { Authorization: `Bearer ${token}` };
async function request(path: string, body?: unknown) {
  const response = await fetch(`${api}${path}`, { headers: { ...headers, "Content-Type": "application/json" },
    method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json() as Promise<any>;
}
const copied = await request(`/projects/${source}/copy`, { resetEstimate: true });
const projectId = copied.workspace?.project?.id;
if (!projectId || projectId === source) throw new Error("No isolated clone; refusing to continue");
if (process.env.BIDWRIGHT_EVAL_PROJECT_LEDGER) await appendFile(process.env.BIDWRIGHT_EVAL_PROJECT_LEDGER,
  `${projectId} C pixel-probe-${model.replace(/[^a-z0-9._-]/gi, "_")} ${new Date().toISOString()}\n`);
const results: any[] = [];
const save = async () => {
  const summary = edges.map((edge) => {
    const attempts = results.filter((result) => result.edge === edge);
    return { edge, attempts: attempts.length, passes: attempts.filter((result) => result.passed).length,
      meanMarkerAccuracy: attempts.length ? attempts.reduce((sum, result) => sum + result.markerAccuracy, 0) / attempts.length : null };
  });
  const readable = summary.filter((entry) => entry.attempts === repeat && entry.passes === repeat).map((entry) => entry.edge);
  await writeFile(out, JSON.stringify({ runtime, model, projectId, resolution, results, summary,
    maxReadableTestedEdge: readable.length ? Math.max(...readable) : null,
    note: "Empirical digit readability, not provider pixel dimensions or drawing accuracy. A failure may be recognition or transport. Reported view dimensions describe the API image, not model-internal resizing. Keep defaults until repeat measurements justify a change." }, null, 2), { mode: 0o600 });
};
await save();
let active = false;
const stop = async () => { if (active) await request(`/api/cli/${projectId}/stop`, {}); active = false; };
const interrupt = () => { void stop().finally(() => process.exit(130)); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
try {
  for (const [index, probe] of probes.entries()) {
    const filename = `transport-probe-${index}.png`;
    const form = new FormData(); form.append("file", new Blob([new Uint8Array(probe.png)]), filename);
    const upload = await fetch(`${api}/projects/${projectId}/files/upload`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(60_000) });
    if (!upload.ok) throw new Error(`Upload failed: HTTP ${upload.status}`);
    const prompt = `Use listProjectImages and inspectProjectImage to inspect ${filename}. ${probe.question} Do not use shell, file-byte inspection, native image tools or external tools; inspect the image returned by inspectProjectImage. If you cannot see pixels say IMAGE_UNAVAILABLE.`;
    // Arm cleanup first: a timed-out start response can still start an agent.
    active = true;
    const started = await request(`/api/cli/${projectId}/message`, { message: prompt, runtime, model, mode: "qa" });
    const deadline = Date.now() + 5 * 60_000;
    let status: any;
    while (Date.now() < deadline) {
      status = await request(`/api/cli/${projectId}/status`);
      if (["completed", "failed", "stopped"].includes(status.status)) { active = false; break; }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const events: any[] = status?.events || [];
    const answer = events.filter((event) => event.type === "message" && event.data?.role === "assistant").at(-1)?.data.content || "";
    let observed: unknown;
    try { observed = JSON.parse(answer.match(/\[[\s\S]*?\]/)?.[0] || "null"); } catch { observed = null; }
    const inspected = events.some((event) => /inspectProjectImage/.test(event.data?.toolId || ""));
    const alternateImagePaths = events.filter((event) => event.type === "image_view" ||
      (event.type === "tool_call" && /^(command_execution|Bash|Read|shell|exec_command|view_image|read_file|python)$/i.test(String(event.data?.toolId || ""))))
      .map((event) => ({ type: event.type, toolId: event.data?.toolId ?? null }));
    const validTransport = status?.status === "completed" && inspected && alternateImagePaths.length === 0;
    const correct = probe.expected.map((expected, index) => Array.isArray(observed) && observed[index] === expected);
    const markerAccuracy = correct.filter(Boolean).length / correct.length;
    const views = await request(`/api/vision/views?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(started.sessionId)}`).catch(() => null);
    results.push({ edge: probe.edge, iteration: probe.iteration, markerScales: probe.markerScales, status: status?.status,
      runId: started.sessionId, expected: probe.expected, observed, correct, markerAccuracy,
      passed: validTransport && markerAccuracy === 1, validTransport, inspected, alternateImagePaths,
      returnedImageDimensions: views?.views?.map((view: any) => ({ width: view.width, height: view.height, imageWidth: view.imageWidth, imageHeight: view.imageHeight })), answer });
    await stop();
    await save();
  }
  console.log(JSON.stringify({ output: out, projectId, passed: results.every((result) => result.passed) }));
  if (results.some((result) => !result.passed)) process.exitCode = 1;
} finally { await stop(); process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); }
