/**
 * Run a Bidwright quote with a local Claude Code estimator instead of the
 * in-app runtime, so prompt/tool/estimating behaviour can be iterated on
 * quickly against production data.
 *
 * The estimator gets the same pieces a production Claude run gets: the
 * generated CLAUDE.md, the real Bidwright MCP server (pointed at the public
 * API), the project's documents in documents/, the document manifest and the
 * production first prompt. The library snapshot is not reproduced (it needs
 * direct database access); the library MCP tools cover the same data.
 *
 *   BIDWRIGHT_AUTH_TOKEN_FILE=<file> \
 *   npx tsx scripts/eval/direct-estimator.ts prepare --source <projectId> \
 *     --out <dir> --ledger <file> [--scope-file <file>] [--label <name>] [--not-blind]
 *   npx tsx scripts/eval/direct-estimator.ts cleanup --project <projectId>
 *
 * `prepare` copies the source project (estimate reset), records the copy in
 * the ledger, waits for extraction and writes a ready-to-run workspace plus
 * run.sh. Every copy must be removed with `cleanup` when finished.
 *
 * Blind mode (the default) is for comparing against the source quote: it
 * blanks the copied revision text and hides benchmarks and calibration
 * lessons, which include the source quote itself. askUser is always disabled
 * because no in-app run exists to carry the answer.
 */
import { spawnSync } from "node:child_process";
import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCompactClaudeMdContent } from "../../apps/api/src/services/claude-md-generator.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [command, ...rest] = process.argv.slice(2);
const option = (name: string, fallback?: string) => {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : fallback;
};

const apiUrl = (process.env.BIDWRIGHT_API_URL ?? "https://bidwright.rassaun.com/proxy").replace(/\/+$/, "");
if (!process.env.BIDWRIGHT_AUTH_TOKEN_FILE) throw new Error("Set BIDWRIGHT_AUTH_TOKEN_FILE to a file holding the API token");
const tokenFile = resolve(process.env.BIDWRIGHT_AUTH_TOKEN_FILE);
const parseToken = (text: string) => text.trim().replace(/^.*=/, "").replace(/^"|"$/g, "").trim();
const token = parseToken(await readFile(tokenFile, "utf8"));
if (!token) throw new Error(`No token in ${tokenFile}`);

async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    // The eval-harness actor keeps harness edits out of human-estimate feedback capture.
    headers: { Authorization: `Bearer ${token}`, "X-Bidwright-Actor": "eval-harness", ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  if (!response.ok) throw Object.assign(new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 300)}`), { status: response.status });
  return (text ? JSON.parse(text) : null) as T;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const READY = new Set(["ready", "review", "quoted", "estimating", "complete", "completed"]);
const FAILED = new Set(["failed", "error"]);
const ARCHIVE = /\.(zip|7z|rar)$/i;

async function waitForIngestion(projectId: string) {
  const deadline = Date.now() + 30 * 60_000;
  while (Date.now() < deadline) {
    const status = await api<any>(`/projects/${projectId}/ingestion-status`);
    const state = String(status?.status ?? "").toLowerCase();
    const summary = status?.summary ?? {};
    console.error(`ingestion ${state}: pending ${summary.pending ?? "?"}, failed ${summary.failed ?? "?"}, total ${summary.total ?? "?"}`);
    if (FAILED.has(state) || Number(summary.failed ?? 0) > 0) throw new Error(`Ingestion failed for ${projectId}`);
    if (READY.has(state)) return status;
    await sleep(10_000);
  }
  throw new Error(`Ingestion did not finish for ${projectId}`);
}

function initialPrompt(benchmarkingEnabled: boolean, scope: string, userPrompt: string) {
  // Mirrors POST /api/cli/start in apps/api/src/routes/cli-routes.ts.
  const scopeDirective = scope
    ? `\n\nUSER SCOPE / COMMERCIAL INSTRUCTIONS (AUTHORITATIVE):\n${scope}\nTreat these instructions as binding commercial direction. If the user says an activity is subcontracted, already priced, owner-supplied, or otherwise commercially decided, do not re-estimate that package as self-performed labour unless the user explicitly asks for a validation breakdown.`
    : "";
  return `Read CLAUDE.md now and follow its estimating workflow. Inspect original drawing pixels yourself using readDrawingPage/readDrawingTile and relevant project images with listProjectImages/inspectProjectImage. Restore current workspace and saved derivations before continuing existing work. Use authoritative Bidwright tools, respect source evidence and commercial scope, and complete final reconciliation before declaring the estimate ready. ${benchmarkingEnabled ? "Use comparable-job benchmarks when available; no-comparable results do not justify invented adjustments." : "Organization benchmarking is disabled."}${scopeDirective}

${userPrompt ? `User request:\n${userPrompt}` : "Build the estimate from the current source package."}`;
}

// The MCP server imports @bidwright/domain from dist; a stale build enforces
// rules that no longer exist in source.
async function buildDomain() {
  const result = spawnSync("pnpm", ["--filter", "@bidwright/domain", "build"], { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"] });
  if (result.status !== 0) throw new Error("@bidwright/domain build failed");
}

async function prepare() {
  await buildDomain();
  const source = option("--source");
  const out = option("--out");
  const ledger = option("--ledger");
  if (!source || !out || !ledger) throw new Error("prepare needs --source, --out and --ledger");
  const label = option("--label", "direct")!;
  const scopeFile = option("--scope-file");
  const userPrompt = option("--prompt", "")!;
  // Benchmarks and calibration lessons include the source quote itself, so a
  // run compared against that quote must not see them.
  const blind = !rest.includes("--not-blind");

  const copied = await api<any>(`/projects/${source}/copy`, { body: { resetEstimate: true } });
  const copiedWorkspace = copied?.workspace ?? copied;
  const projectId: string = copiedWorkspace?.project?.id ?? copied?.project?.id ?? "";
  if (!projectId || projectId === source) throw new Error(`copy returned no isolated project: ${JSON.stringify(copied).slice(0, 200)}`);
  await appendFile(ledger, `${projectId} A ${label} ${new Date().toISOString()}\n`);
  console.error(`copied ${source} -> ${projectId} (ledgered)`);

  for (const document of copiedWorkspace?.sourceDocuments ?? []) {
    if (ARCHIVE.test(String(document.fileName ?? ""))) {
      await api(`/projects/${projectId}/documents/${document.id}/reingest`, { body: {} });
    }
  }
  await sleep(5_000);
  await waitForIngestion(projectId);

  // The copy keeps the source revision's description, notes and status,
  // which carry the human quote's wording.
  const copiedRevisionId = copiedWorkspace?.currentRevision?.id;
  if (blind && copiedRevisionId) {
    await api(`/projects/${projectId}/revisions/${copiedRevisionId}`, {
      method: "PATCH",
      body: { description: "", notes: "", status: "Open" },
    });
  }

  const workspace = (await api<any>(`/projects/${projectId}/workspace`))?.workspace;
  const project = workspace?.project ?? {};
  const quote = workspace?.quote ?? {};
  const revision = workspace?.currentRevision ?? {};
  const settings = await api<any>("/settings").catch(() => ({}));
  const scope = scopeFile ? (await readFile(scopeFile, "utf8")).trim() : String(project.scope ?? "").trim();

  const dir = resolve(out, projectId);
  await mkdir(join(dir, "documents"), { recursive: true });
  await mkdir(join(dir, ".bidwright"), { recursive: true });
  const documents = (workspace?.sourceDocuments ?? []).map((d: any) => ({
    id: d.id,
    fileName: d.fileName,
    fileType: d.fileType,
    documentType: d.documentType,
    pageCount: d.pageCount || 0,
    storagePath: `documents/${d.fileName}`,
  }));
  for (const document of documents) {
    if (ARCHIVE.test(document.fileName)) continue;
    const response = await fetch(`${apiUrl}/projects/${projectId}/documents/${document.id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) { console.error(`download failed ${document.fileName}: ${response.status}`); continue; }
    const target = join(dir, "documents", document.fileName);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
  }
  await writeFile(join(dir, ".bidwright", "document-manifest.jsonl"),
    documents.map((d: any) => JSON.stringify(d)).join("\n") + (documents.length ? "\n" : ""));

  const instructions = buildCompactClaudeMdContent({
    projectDir: dir,
    projectName: project.name || "Untitled Project",
    clientName: project.clientName || "",
    location: project.location || "",
    scope,
    quoteNumber: quote.quoteNumber || "",
    dataRoot: dir,
    documents,
    knowledgeBookFiles: [],
    knowledgeDocumentFiles: [],
    estimateDefaults: settings?.defaults ?? {},
    maxConcurrentSubAgents: settings?.integrations?.maxConcurrentSubAgents ?? 2,
    persona: null,
  } as any);
  // Blind runs cannot call the history tools, so do not tell the agent to.
  await writeFile(join(dir, "CLAUDE.md"), blind
    ? instructions
      .replace(/^- `listCalibrationLessons`:.*\n/m, "")
      .replace("`recomputeEstimateBenchmarks`, `verifyDrawingEvidenceLedger`, `finalizeEstimateStrategy`: optional comparison, source cross-checks,", "`verifyDrawingEvidenceLedger`, `finalizeEstimateStrategy`: optional source cross-checks")
    : instructions);

  const benchmarkingEnabled = !blind && settings?.defaults?.benchmarkingEnabled !== false;
  // askUser waits on the in-app run, which a direct run does not have.
  await writeFile(join(dir, "prompt.txt"), `${initialPrompt(benchmarkingEnabled, scope, userPrompt)}

No user is available during this run. Where you would ask, choose the most defensible option, save it as an assumption, and continue.`);

  // The MCP wrapper reads the token at start so no secret is written to disk.
  const tsx = join(repoRoot, "node_modules/.bin/tsx");
  const mcpEntry = join(repoRoot, "packages/mcp-server/src/index.ts");
  await writeFile(join(dir, "bidwright-mcp.sh"), `#!/bin/sh
BIDWRIGHT_AUTH_TOKEN="$(sed 's/^.*=//; s/^"//; s/"$//' '${tokenFile}' | tr -d '\\n')"
export BIDWRIGHT_AUTH_TOKEN
exec '${tsx}' '${mcpEntry}'
`);
  await chmod(join(dir, "bidwright-mcp.sh"), 0o700);
  await writeFile(join(dir, "mcp.json"), JSON.stringify({
    mcpServers: {
      bidwright: {
        command: join(dir, "bidwright-mcp.sh"),
        args: [],
        env: {
          BIDWRIGHT_API_URL: apiUrl,
          BIDWRIGHT_PROJECT_ID: projectId,
          BIDWRIGHT_REVISION_ID: revision.id ?? "",
          BIDWRIGHT_QUOTE_ID: quote.id ?? "",
          BIDWRIGHT_AGENT_MODE: "build_estimate",
        },
      },
    },
  }, null, 2));
  await writeFile(join(dir, "settings.json"), JSON.stringify({
    sandbox: { enabled: true, autoAllowBashIfSandboxed: true },
  }, null, 2));
  await writeFile(join(dir, "run.sh"), `#!/bin/sh
# Usage: ./run.sh [model] [effort]   (transcript -> transcript.jsonl)
cd "$(dirname "$0")"
claude -p "$(cat prompt.txt)" \\
  --model "\${1:-claude-opus-5-5}" --effort "\${2:-medium}" \\
  --mcp-config mcp.json --strict-mcp-config --settings settings.json \\
  --permission-mode acceptEdits \\
  --allowedTools mcp__bidwright Bash Read Grep Glob Write Edit WebSearch WebFetch Task \\${blind ? `
  --disallowedTools mcp__bidwright__recomputeEstimateBenchmarks mcp__bidwright__listCalibrationLessons \\` : ""}
  --disallowedTools mcp__bidwright__askUser \\
  --output-format stream-json --verbose > transcript.jsonl 2> stderr.log
`);
  await chmod(join(dir, "run.sh"), 0o700);
  console.log(JSON.stringify({ projectId, dir, documents: documents.length, scopeChars: scope.length }, null, 2));
}

async function cleanup() {
  const projectId = option("--project");
  if (!projectId) throw new Error("cleanup needs --project");
  await api(`/api/cli/${projectId}/stop`, { body: {} }).catch(() => undefined);
  await api(`/projects/${projectId}`, { method: "DELETE" });
  const gone = await api(`/projects/${projectId}`).then(() => false).catch((error) => error?.status === 404);
  console.log(JSON.stringify({ projectId, deletedVerified404: gone }));
}

if (command === "prepare") await prepare();
else if (command === "cleanup") await cleanup();
else throw new Error("usage: direct-estimator.ts prepare|cleanup ...");
