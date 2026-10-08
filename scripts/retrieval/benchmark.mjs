#!/usr/bin/env node
// Read-only corpus benchmark. Cases and full results stay in caller-owned files.
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
const { values } = parseArgs({ options: { api: { type: "string" }, "token-file": { type: "string" }, cases: { type: "string" }, out: { type: "string" }, repeat: { type: "string", default: "3" } } });
if (!values.api || !values["token-file"] || !values.cases || !values.out) throw new Error("Pass --api --token-file --cases --out [--repeat 3]; credentials must never be passed as command arguments");
const token = (await readFile(values["token-file"], "utf8")).trim();
const cases = JSON.parse(await readFile(values.cases, "utf8"));
const headers = { Authorization: `Bearer ${token}` };
const api = values.api.replace(/\/$/, "");
const health = await fetch(`${api}/health`, { headers }).then((response) => response.json());
const results = [];
for (const { source, query } of cases) {
  const route = { labor: "/api/labor-units/units", books: "/knowledge/search", datasets: "/datasets/search/global" }[source];
  if (!route) throw new Error(`Unknown source ${source}`);
  const samples = [];
  for (let attempt = 0; attempt < Math.max(1, Number(values.repeat)); attempt++) {
    const params = new URLSearchParams({ q: query, limit: "8", ...(source === "books" ? { scope: "global" } : {}) });
    const start = performance.now();
    const response = await fetch(`${api}${route}?${params}`, { headers, signal: AbortSignal.timeout(60000) });
    const body = await response.text();
    const ms = Math.round(performance.now() - start);
    const data = JSON.parse(body);
    const rows = source === "labor" ? data.units : source === "books" ? data : data.results;
    samples.push({ ms, status: response.status, bytes: Buffer.byteLength(body), data, top: (rows ?? []).slice(0, 5) });
    if (!response.ok) throw new Error(`${source} HTTP ${response.status}`);
  }
  const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const summary = { source, query, coldMs: samples[0].ms, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], samples };
  results.push(summary);
  console.log(JSON.stringify({ ...summary, samples: undefined }));
}
await writeFile(values.out, JSON.stringify({ health, completedAt: new Date().toISOString(), results }, null, 2));
