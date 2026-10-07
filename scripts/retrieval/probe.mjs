#!/usr/bin/env node
/**
 * Retrieval probe: proves whether hybrid (semantic + lexical) search is live
 * for a deployment, and that known project/labour phrases are retrievable.
 *
 *   node scripts/retrieval/probe.mjs --api https://host/api --token-file ~/.bb/thread-storage/agent-secrets/bidwright-session.token \
 *     --project <projectId> --q "base plate anchor" --q "millwright setting hours"
 *
 * Credentials never go on the command line: use --token-file <path> (first
 * line is the token) or the env vars BIDWRIGHT_AUTH_TOKEN / BIDWRIGHT_AUTH_TOKEN_FILE.
 *
 * Exit code 0 = hybrid lane active and every query hit in the project corpus or, failing that, the library.
 * Exit code 2 = embedder/index missing (lexical only). Exit code 3 = a query returned no hits.
 * Never prints credentials.
 */
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const queries = args.flatMap((value, index) => (value === "--q" ? [args[index + 1]] : []));
const api = (opt("api", process.env.BIDWRIGHT_API_URL ?? "http://localhost:4000")).replace(/\/$/, "");
import { readFileSync } from "node:fs";
const tokenFile = opt("token-file", process.env.BIDWRIGHT_AUTH_TOKEN_FILE ?? "");
let token = process.env.BIDWRIGHT_AUTH_TOKEN ?? "";
if (tokenFile) {
  try {
    token = readFileSync(tokenFile, "utf8").split(/\r?\n/)[0].trim();
  } catch (error) {
    console.error(`Could not read token file: ${error.message ?? error}`);
    process.exit(1);
  }
}
if (args.includes("--token")) {
  console.error("Refusing --token on the command line (it leaks into shell history and process lists). Use --token-file or BIDWRIGHT_AUTH_TOKEN.");
  process.exit(1);
}
const projectId = opt("project", process.env.BIDWRIGHT_PROJECT_ID ?? "");
if (!projectId) { console.error("--project <projectId> is required"); process.exit(1); }
if (queries.length === 0) queries.push("base plate anchor", "epoxy grout", "labour hours install");

const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
async function get(path) {
  const res = await fetch(`${api}${path}`, { headers });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

let exitCode = 0;
const status = await get(`/knowledge/embedding-status`).catch((error) => ({ error: String(error.message ?? error) }));
console.log("embedding-status:", JSON.stringify(status));
if (!status.enabled) {
  console.log("Hybrid lane INACTIVE: no embedder resolved (set EMBEDDING_PROVIDER, e.g. openrouter, and ensure the org/env key exists).");
  exitCode = 2;
} else if ((status.vectors?.project ?? 0) + (status.vectors?.library ?? 0) === 0) {
  console.log("Hybrid lane configured but the vector index is EMPTY: run POST /knowledge/reindex-books.");
  exitCode = 2;
}

// Project-corpus lane (this project's documents) for every query, then the
// library lane (global knowledge books) as the fallback: a labour/productivity
// phrase that is absent from the RFQ PDFs but present in the estimating
// manuals is a PASS, not a miss. Pass --lib-q to probe the library only.
const libraryQueries = args.flatMap((value, index) => (value === "--lib-q" ? [args[index + 1]] : []));
for (const q of queries) {
  const params = new URLSearchParams({ q, projectId, limit: "8" });
  const corpus = await get(`/knowledge/project-corpus/search?${params}`);
  const lanes = (corpus.hits ?? []).map((hit) => (hit.lanes ?? ["lexical"]).join("+"));
  const paged = (corpus.hits ?? []).filter((hit) => hit.pageNumber).length;
  console.log(`q="${q}": project hits=${(corpus.hits ?? []).length} hybrid=${corpus.hybrid === true} withPage=${paged} lanes=[${lanes.join(",")}]`);
  for (const hit of (corpus.hits ?? []).slice(0, 3)) {
    console.log(`   - ${hit.fileName} p.${hit.pageNumber ?? "?"} [${hit.kind}] ${String(hit.snippet ?? "").slice(0, 110)}`);
  }
  if ((corpus.hits ?? []).length > 0) continue;
  const library = await get(`/knowledge/search?${new URLSearchParams({ q, scope: "global", limit: "5" })}`);
  const libHits = Array.isArray(library) ? library : library.results ?? library.hits ?? [];
  console.log(`   library fallback: hits=${libHits.length}`);
  for (const hit of libHits.slice(0, 3)) {
    console.log(`   - ${String(hit.source ?? hit.bookName ?? "")} p.${hit.pageNumber ?? "?"} ${String(hit.text ?? "").replace(/\s+/g, " ").slice(0, 100)}`);
  }
  if (libHits.length === 0 && exitCode === 0) exitCode = 3;
}
for (const q of libraryQueries) {
  const library = await get(`/knowledge/search?${new URLSearchParams({ q, scope: "global", limit: "5" })}`);
  const libHits = Array.isArray(library) ? library : library.results ?? library.hits ?? [];
  console.log(`lib-q="${q}": library hits=${libHits.length}`);
  for (const hit of libHits.slice(0, 3)) {
    console.log(`   - ${String(hit.source ?? hit.bookName ?? "")} p.${hit.pageNumber ?? "?"} ${String(hit.text ?? "").replace(/\s+/g, " ").slice(0, 100)}`);
  }
  if (libHits.length === 0 && exitCode === 0) exitCode = 3;
}
process.exit(exitCode);
