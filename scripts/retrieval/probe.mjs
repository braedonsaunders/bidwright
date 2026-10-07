#!/usr/bin/env node
/**
 * Retrieval probe: proves whether hybrid (semantic + lexical) search is live
 * for a deployment, and that known project/labour phrases are retrievable.
 *
 *   node scripts/retrieval/probe.mjs --api https://host/api --token <session> --project <projectId> \
 *     --q "base plate anchor" --q "millwright setting hours"
 *
 * Exit code 0 = hybrid lane active and every query returned at least one hit.
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
const token = opt("token", process.env.BIDWRIGHT_AUTH_TOKEN ?? "");
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

for (const q of queries) {
  const params = new URLSearchParams({ q, projectId, limit: "8" });
  const corpus = await get(`/knowledge/project-corpus/search?${params}`);
  const lanes = (corpus.hits ?? []).map((hit) => (hit.lanes ?? ["lexical"]).join("+"));
  const paged = (corpus.hits ?? []).filter((hit) => hit.pageNumber).length;
  console.log(`q="${q}": hits=${(corpus.hits ?? []).length} hybrid=${corpus.hybrid === true} withPage=${paged} lanes=[${lanes.join(",")}]`);
  for (const hit of (corpus.hits ?? []).slice(0, 3)) {
    console.log(`   - ${hit.fileName} p.${hit.pageNumber ?? "?"} [${hit.kind}] ${String(hit.snippet ?? "").slice(0, 110)}`);
  }
  if ((corpus.hits ?? []).length === 0 && exitCode === 0) exitCode = 3;
}
process.exit(exitCode);
