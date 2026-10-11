#!/usr/bin/env node
import { pathToFileURL } from "node:url";

/** @typedef {{ apiUrl: string, token: string, projectId: string, readOnly: boolean }} ClientConfig */
/** @param {ClientConfig} config */
export function createClient(config) {
  const base = new URL(config.apiUrl);
  /** @template T @param {"GET" | "POST"} method @param {string} path @param {unknown} [body] @returns {Promise<T | null>} */
  async function request(method, path, body) {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new Error("Expected an API path starting with /, not a URL");
    const url = new URL(path, base);
    if (url.origin !== base.origin) throw new Error("API host mismatch");
    const scoped = url.pathname.match(/^\/(?:api\/)?(?:projects|models|takeoff)\/([^/]+)/);
    if (scoped && decodeURIComponent(scoped[1]) !== config.projectId) throw new Error("Project path does not match BIDWRIGHT_PROJECT_ID");
    if (method === "POST" && config.readOnly) throw new Error("Writes are unavailable in Q&A/review mode");
    const response = await fetch(url, {
      method, redirect: "error", signal: AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/json", "X-Bidwright-Actor": "mcp-agent", ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`API ${method} ${url.pathname} failed: ${response.status} ${await response.text()}`);
    return response.status === 204 ? null : response.json();
  }
  /** @param {string} path @param {"elements" | "rows"} key @param {{limit: number, offset: number, all: boolean}} options */
  async function pages(path, key, options) {
    const rows = [];
    let offset = options.offset;
    for (;;) {
      const query = new URLSearchParams({ limit: String(options.limit), offset: String(offset) });
      const result = await request("GET", `${path}?${query}`);
      if (!options.all) return result;
      const page = result[key];
      if (!Array.isArray(page)) throw new Error(`Expected paginated ${key}`);
      rows.push(...page);
      offset += page.length;
      const total = result.total ?? result.count;
      if (page.length === 0 || (typeof total === "number" && offset >= total) || (total == null && page.length < options.limit)) return rows;
    }
  }
  return { request, pages };
}

/** @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
export async function runBw(args, env = process.env) {
  const client = createClient({
    apiUrl: env.BIDWRIGHT_API_URL || "http://localhost:4001", token: env.BIDWRIGHT_AUTH_TOKEN || "",
    projectId: env.BIDWRIGHT_PROJECT_ID || "", readOnly: env.BIDWRIGHT_AGENT_MODE === "qa" || env.BIDWRIGHT_REVIEW_ONLY === "true",
  });
  const [command, ...rest] = args;
  if (!command || command === "--help") return { usage: "bw overview|pickups|items|datasets|elements MODEL_ID|rows DATASET_ID [--all] [--limit N] [--offset N]; bw get PATH; bw post PATH JSON" };
  if (command === "get" || command === "post") {
    if (!rest[0]) throw new Error("An API path is required");
    return client.request(command === "get" ? "GET" : "POST", rest[0], command === "post" ? JSON.parse(rest[1] ?? "null") : undefined);
  }
  const projectId = encodeURIComponent(env.BIDWRIGHT_PROJECT_ID || "");
  if (!projectId) throw new Error("BIDWRIGHT_PROJECT_ID is required");
  if (command === "overview") return client.request("GET", `/api/projects/${projectId}/source-overview`);
  if (command === "pickups") return client.request("GET", `/api/takeoff/${projectId}/pickups`);
  if (command === "datasets") return client.request("GET", `/datasets?projectId=${projectId}`);
  if (command === "items") {
    /** @type {{workspace: {worksheets?: Array<{id: string, items?: Record<string, unknown>[]}>}} | null} */
    const result = await client.request("GET", `/projects/${projectId}/workspace`);
    return (result?.workspace.worksheets ?? []).flatMap(worksheet => (worksheet.items ?? []).map(item => ({ ...item, worksheetId: worksheet.id })));
  }
  if (command === "elements" || command === "rows") {
    if (!rest[0] || rest[0].startsWith("--")) throw new Error("A model/dataset ID is required");
    const options = { all: false, limit: 100, offset: 0 };
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === "--all") options.all = true;
      else if (rest[i] === "--limit" || rest[i] === "--offset") {
        const key = rest[i] === "--limit" ? "limit" : "offset";
        const value = Number(rest[++i]);
        if (!Number.isSafeInteger(value) || value < (key === "limit" ? 1 : 0) || (key === "limit" && value > 1000)) throw new Error(`Invalid ${key}`);
        options[key] = value;
      } else throw new Error(`Unknown option: ${rest[i]}`);
    }
    const id = encodeURIComponent(rest[0]);
    return client.pages(command === "elements" ? `/api/models/${projectId}/assets/${id}/elements` : `/datasets/${id}/rows`, command === "elements" ? "elements" : "rows", options);
  }
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBw(process.argv.slice(2)).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
