/**
 * Post-deploy smoke for agent memory ownership and shape (PR #114).
 *
 * Proves, on the deployed build, that:
 *   1. the API's package-ingest writer leaves agent-memory.json readable and
 *      writable by the sandboxed agent (it used to be root:root 0644),
 *   2. a real sandboxed MCP writeMemory succeeds and readMemory returns the
 *      ingestion section alongside the agent's own section,
 *   3. API GET/PUT /agent-memory read and write the same normalised shape.
 *
 * Works entirely through the public API (no SSH). Every clone is appended to
 * the shared test-project ledger and deleted through the app at the end.
 *
 *   BIDWRIGHT_API_URL=https://bidwright.rassaun.com/proxy \
 *   BIDWRIGHT_AUTH_TOKEN_FILE=... \
 *   npx tsx scripts/eval/probe-agent-memory.ts --source <projectId> --ledger .../test-projects.txt
 */
import { appendFile, readFile, writeFile } from "node:fs/promises";

function option(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const apiUrl = (process.env.BIDWRIGHT_API_URL ?? "https://bidwright.rassaun.com/proxy").replace(/\/+$/, "");
const tokenFile = process.env.BIDWRIGHT_AUTH_TOKEN_FILE;
const token = (process.env.BIDWRIGHT_AUTH_TOKEN
  ?? (tokenFile ? (await readFile(tokenFile, "utf8")).trim().replace(/^.*=/, "").replace(/^"|"$/g, "") : "")).trim();
if (!token) throw new Error("Set BIDWRIGHT_AUTH_TOKEN or BIDWRIGHT_AUTH_TOKEN_FILE");
const source = option("--source");
if (!source) throw new Error("--source <projectId> is required");
const ledger = option("--ledger");
const runtime = option("--runtime", "openrouter")!;
const model = option("--model", "openai/gpt-6.1-sol")!;
const marker = `memory-smoke-${Date.now()}`;

async function request<T = any>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw Object.assign(new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 300)}`), { status: response.status });
  return (text ? JSON.parse(text) : null) as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const health = await request<{ deploymentTag?: string }>("/health");
const result: Record<string, unknown> = { deploymentTag: health.deploymentTag, model, runtime, marker, checks: {} };
const checks = result.checks as Record<string, boolean | string>;
let projectId = "";

try {
  const copied = await request<{ project?: { id: string }; id?: string; projectId?: string }>(`/projects/${source}/copy`, { resetEstimate: true });
  projectId = copied.project?.id ?? copied.projectId ?? copied.id ?? "";
  if (!projectId) throw new Error(`copy returned no project id: ${JSON.stringify(copied).slice(0, 200)}`);
  if (ledger) await appendFile(ledger, `${projectId} A memory-smoke ${new Date().toISOString()}\n`);
  result.projectId = projectId;

  // 1. Re-ingest the archive so the API's ingest-completion writer runs.
  const documents = await request<Array<{ id: string; fileType: string }>>(`/projects/${projectId}/documents`);
  const archive = documents.find((doc) => doc.fileType === "zip");
  if (!archive) throw new Error("copied project has no zip source document to re-ingest");
  await request(`/projects/${projectId}/documents/${archive.id}/reingest`, {});
  let memory: any = null;
  for (let i = 0; i < 60; i += 1) {
    await sleep(5000);
    memory = await request(`/projects/${projectId}/agent-memory`);
    if (memory?.sections?.ingestion_results) break;
  }
  checks.apiIngestSectionWritten = Boolean(memory?.sections?.ingestion_results);

  // 2. A real sandboxed agent writes and reads memory through MCP.
  const prompt = [
    `Call writeMemory with section "smoke" and content "${marker}".`,
    "Then call readMemory and reply with only the JSON it returned.",
    "Do not use the shell or edit files directly; use only those two tools.",
  ].join(" ");
  await request(`/api/cli/${projectId}/message`, { message: prompt, runtime, model, mode: "assist_edit" });
  let status: any = null;
  for (let i = 0; i < 60; i += 1) {
    await sleep(5000);
    status = await request(`/api/cli/${projectId}/status`);
    if (status?.status && status.status !== "running") break;
  }
  const events: any[] = Array.isArray(status?.events) ? status.events : [];
  const toolResults = events.filter((event) => event.type === "tool_result").map((event) => JSON.stringify(event.data ?? {}));
  const writeResult = toolResults.find((text) => text.includes("Saved to memory section: smoke"));
  checks.mcpWriteMemorySucceeded = Boolean(writeResult);
  checks.mcpNoPermissionError = !toolResults.some((text) => /EACCES|permission denied/i.test(text));
  checks.mcpUsedShell = events.some((event) => event.type === "tool_call" && /command_execution|shell|exec_command/i.test(JSON.stringify(event.data ?? {}))) ? "yes (should be no)" : "no";
  const after = await request<any>(`/projects/${projectId}/agent-memory`);
  checks.smokeSectionPersisted = after?.sections?.smoke === marker;
  checks.ingestSectionPreserved = Boolean(after?.sections?.ingestion_results);

  // 3. API PUT keeps both, in the same shape.
  await request(`/projects/${projectId}/agent-memory`, { section: "api_smoke", content: marker }, "PUT");
  const final = await request<any>(`/projects/${projectId}/agent-memory`);
  checks.apiPutKeepsAllSections = Boolean(final?.sections?.api_smoke && final?.sections?.smoke && final?.sections?.ingestion_results);
  result.runStatus = status?.status ?? null;
  result.passed = Object.values(checks).every((value) => value === true || value === "no");
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  result.passed = false;
} finally {
  if (projectId) {
    await request(`/api/cli/${projectId}/stop`, {}).catch(() => undefined);
    await request(`/projects/${projectId}`, undefined, "DELETE").catch((error) => { result.deleteError = String(error); });
    const gone = await request(`/projects/${projectId}`).then(() => false).catch((error) => error?.status === 404);
    result.deletedVerified404 = gone;
  }
  const out = option("--out", `memory-smoke-${Date.now()}.json`)!;
  await writeFile(out, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}
