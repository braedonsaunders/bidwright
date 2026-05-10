/**
 * Egress allowlist proxy for bwrap-isolated CLI sessions.
 *
 * Each per-tenant CLI session inside `BubblewrappedHost` gets pointed at
 * this proxy via `HTTPS_PROXY=http://bidwright:<secret>@127.0.0.1:<port>`.
 * The proxy authenticates incoming requests against an in-memory secret
 * generated at server boot, then permits only the host:port pairs on a
 * configurable allowlist (Anthropic / OpenAI / Google / OpenRouter / npm
 * / pypi / github / the Bidwright MCP server). Everything else is
 * rejected with a clear `403 EgressDenied` and logged.
 *
 * Why HTTP CONNECT and not socat / iptables / per-session netns:
 *   • CLI tools (`claude`, `codex`, `opencode`, `gemini`) all use Node's
 *     standard fetch/undici/axios under the hood — they respect HTTPS_PROXY
 *     out of the box, no source-side patching needed.
 *   • Bind to 127.0.0.1 so a misbehaving sandbox can only reach the proxy
 *     via the api container's loopback, never via the network.
 *   • Plain HTTP CONNECT tunnels are MITM-free: the proxy never sees the
 *     decrypted bytes of an LLM API call, only the destination host.
 *
 * What this is NOT:
 *   • A perimeter firewall — a malicious tool call from the agent could
 *     still call `curl --proxy ''` to bypass HTTPS_PROXY. For Bidwright's
 *     B2B authenticated trust model that's acceptable; cgroup-based
 *     enforcement is a future hardening path.
 *   • Per-tenant rate limiting / billing — the secret is per-process, not
 *     per-user, so we don't try to attribute traffic to individual tenants
 *     here. Add that with a JWT scheme if/when needed.
 */

import { createServer as createHttpServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createConnection } from "node:net";
import type { Duplex } from "node:stream";
import { randomBytes } from "node:crypto";

/**
 * Allowed (host, port) destinations. Pairs match exactly; the empty port
 * field is a wildcard ("any port"). Anything not in this list gets
 * rejected. Keep tight — every entry is an attack surface for exfiltration
 * if a tool call manages to talk to it.
 */
export interface AllowlistEntry {
  host: string;
  /** Optional explicit port; default 443. */
  port?: number;
}

const DEFAULT_ALLOWLIST: AllowlistEntry[] = [
  // ── LLM provider APIs ────────────────────────────────────────────
  { host: "api.anthropic.com" },
  { host: "api.openai.com" },
  { host: "auth.openai.com" }, // ChatGPT Plus/Pro OAuth
  { host: "generativelanguage.googleapis.com" },
  { host: "aiplatform.googleapis.com" },
  { host: "us-central1-aiplatform.googleapis.com" },
  { host: "openrouter.ai" },
  { host: "gateway.opencode.ai" }, // OpenCode Zen
  // ── Anthropic OAuth + token exchange ────────────────────────────
  { host: "console.anthropic.com" },
  { host: "claude.ai" },
  // ── Package registries the CLIs touch on cold-start ─────────────
  { host: "registry.npmjs.org" },
  { host: "registry.yarnpkg.com" },
  { host: "pypi.org" },
  { host: "files.pythonhosted.org" },
  // ── GitHub (claude /sdk-tools git clones, opencode plugin loader) ─
  { host: "github.com" },
  { host: "api.github.com" },
  { host: "objects.githubusercontent.com" },
  { host: "codeload.github.com" },
  { host: "raw.githubusercontent.com" },
];

export interface EgressProxyConfig {
  /** Defaults to 0 (random ephemeral port). Set explicitly for tests. */
  port?: number;
  /** Defaults to "127.0.0.1". */
  host?: string;
  /**
   * Replaces the default allowlist entirely when provided. Use
   * {@link defaultAllowlist} + spread to extend instead of replacing.
   */
  allowlist?: AllowlistEntry[];
  /**
   * Bidwright API base URL (e.g. `http://localhost:4001`). Parsed and added
   * to the allowlist so MCP traffic from the sandbox to the API server
   * works. Idempotent — already-listed hosts are not duplicated.
   */
  apiBaseUrl?: string;
}

export interface RunningEgressProxy {
  server: Server;
  port: number;
  host: string;
  /** Per-process secret. Inject as basic-auth password into HTTPS_PROXY. */
  secret: string;
  /** Build `HTTPS_PROXY` / `HTTP_PROXY` env values for a sandbox spawn. */
  toEnv(): Record<string, string>;
  /** Stop accepting new connections; existing tunnels finish gracefully. */
  close(): Promise<void>;
}

export function defaultAllowlist(): AllowlistEntry[] {
  return [...DEFAULT_ALLOWLIST];
}

function isHostAllowed(allow: AllowlistEntry[], host: string, port: number): boolean {
  // Exact host:port match first; then host with no explicit port (wildcard).
  for (const entry of allow) {
    if (entry.host !== host) continue;
    if (entry.port == null) return true;
    if (entry.port === port) return true;
  }
  return false;
}

function decodeBasicAuth(header: string | undefined): { user: string; pass: string } | null {
  if (!header) return null;
  if (!header.toLowerCase().startsWith("basic ")) return null;
  const encoded = header.slice(6).trim();
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf-8");
  } catch {
    return null;
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

export async function startEgressProxy(config: EgressProxyConfig = {}): Promise<RunningEgressProxy> {
  const allowlist = (config.allowlist ?? defaultAllowlist()).slice();

  // Splice the API base URL into the allowlist if it's not already there;
  // sandboxed CLIs need to talk to the MCP server which lives on the API.
  if (config.apiBaseUrl) {
    try {
      const url = new URL(config.apiBaseUrl);
      const apiHost = url.hostname;
      const apiPort = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
      if (apiHost && !allowlist.some((e) => e.host === apiHost && (e.port == null || e.port === apiPort))) {
        allowlist.push({ host: apiHost, port: apiPort });
      }
    } catch {
      console.warn(`[egress-proxy] could not parse apiBaseUrl ${config.apiBaseUrl}; MCP traffic may be denied`);
    }
  }

  const secret = randomBytes(24).toString("base64url");
  const expectedAuth = `Basic ${Buffer.from(`bidwright:${secret}`, "utf-8").toString("base64")}`;

  const server = createHttpServer((req, res) => handleHttpRequest(req, res, allowlist, expectedAuth));

  // Raw CONNECT requests bypass `request` and land here. This is the
  // common path because every LLM API and OAuth callback is HTTPS.
  server.on("connect", (req, clientSocket, head) => {
    handleConnect(req, clientSocket, head, allowlist, expectedAuth);
  });

  // Defensive: prevent crashes from a stray CONNECT-after-close.
  server.on("clientError", (err, socket) => {
    try {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    } catch {
      /* socket already gone */
    }
    if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") {
      console.error("[egress-proxy] clientError", err);
    }
  });

  const host = config.host ?? "127.0.0.1";
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port ?? 0, host, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve(addr.port);
      } else {
        reject(new Error("egress-proxy: failed to bind"));
      }
    });
  });

  console.log(
    `[egress-proxy] listening on ${host}:${port} (${allowlist.length} allowlist entries, MCP=${config.apiBaseUrl ?? "none"})`,
  );

  const proxyUrl = `http://bidwright:${secret}@${host}:${port}`;
  return {
    server,
    port,
    host,
    secret,
    toEnv() {
      // npm respects npm_config_proxy, python respects HTTP(S)_PROXY,
      // node uses the standard env vars, curl uses lowercase too.
      // Setting both upper and lower covers every CLI that follows convention.
      return {
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        http_proxy: proxyUrl,
        https_proxy: proxyUrl,
        // Bypass for connections that should never go through the proxy.
        // (loopback within the sandbox itself; `127.0.0.1` is the proxy
        // host but inside the sandbox there's nothing else on loopback.)
        NO_PROXY: "",
      };
    },
    close() {
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

function authOk(req: IncomingMessage, expectedAuth: string): boolean {
  const header = req.headers["proxy-authorization"];
  return typeof header === "string" && header === expectedAuth;
}

function rejectWithStatus(socket: Duplex, status: number, message: string): void {
  try {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
  } catch {
    /* ignore */
  }
  socket.end();
}

function parseTargetFromConnectUrl(url: string | undefined): { host: string; port: number } | null {
  if (!url) return null;
  // CONNECT URLs are `host:port`, no scheme.
  const idx = url.lastIndexOf(":");
  if (idx <= 0) return null;
  const host = url.slice(0, idx);
  const port = Number(url.slice(idx + 1));
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}

function handleConnect(
  req: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  allowlist: AllowlistEntry[],
  expectedAuth: string,
): void {
  if (!authOk(req, expectedAuth)) {
    console.warn(`[egress-proxy] CONNECT denied: bad/missing Proxy-Authorization (target=${req.url ?? "<none>"})`);
    rejectWithStatus(clientSocket, 407, "Proxy Authentication Required");
    return;
  }
  const target = parseTargetFromConnectUrl(req.url);
  if (!target) {
    rejectWithStatus(clientSocket, 400, "Bad CONNECT target");
    return;
  }
  if (!isHostAllowed(allowlist, target.host, target.port)) {
    console.warn(`[egress-proxy] CONNECT denied: ${target.host}:${target.port} (not on allowlist)`);
    rejectWithStatus(clientSocket, 403, "EgressDenied");
    return;
  }

  console.log(`[egress-proxy] CONNECT ${target.host}:${target.port}`);

  const upstream = createConnection({ host: target.host, port: target.port }, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-agent: bidwright-egress-proxy\r\n\r\n");
    if (head && head.length > 0) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  upstream.on("error", (err) => {
    console.warn(`[egress-proxy] upstream error for ${target.host}:${target.port}: ${(err as Error).message}`);
    try {
      clientSocket.end();
    } catch {
      /* ignore */
    }
  });
  clientSocket.on("error", () => {
    try {
      upstream.end();
    } catch {
      /* ignore */
    }
  });
  clientSocket.on("close", () => {
    try {
      upstream.end();
    } catch {
      /* ignore */
    }
  });
}

function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  allowlist: AllowlistEntry[],
  expectedAuth: string,
): void {
  if (!authOk(req, expectedAuth)) {
    res.writeHead(407, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "ProxyAuthRequired" }));
    return;
  }

  // Plain-HTTP forwarding is rare in our stack (npm / pypi / Anthropic /
  // OpenAI all enforce HTTPS) but we support it for completeness so a CLI
  // doing a 301-to-HTTPS dance from an HTTP URL still works.
  let target: URL;
  try {
    target = new URL(req.url ?? "");
  } catch {
    res.writeHead(400);
    res.end("Bad URL");
    return;
  }
  if (!target.host) {
    res.writeHead(400);
    res.end("Missing host");
    return;
  }
  const port = target.port ? Number(target.port) : 80;
  if (!isHostAllowed(allowlist, target.hostname, port)) {
    console.warn(`[egress-proxy] HTTP denied: ${target.hostname}:${port} ${target.pathname}`);
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "EgressDenied", host: target.hostname }));
    return;
  }

  console.log(`[egress-proxy] ${req.method ?? "GET"} ${target.hostname}:${port}${target.pathname}`);

  const upstreamSocket = createConnection({ host: target.hostname, port }, () => {
    const lines = [
      `${req.method ?? "GET"} ${target.pathname}${target.search ?? ""} HTTP/1.1`,
      `Host: ${target.host}`,
    ];
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase() === "proxy-authorization") continue;
      if (key.toLowerCase() === "host") continue;
      if (Array.isArray(value)) {
        for (const v of value) lines.push(`${key}: ${v}`);
      } else if (value !== undefined) {
        lines.push(`${key}: ${value}`);
      }
    }
    upstreamSocket.write(lines.join("\r\n") + "\r\n\r\n");
    req.pipe(upstreamSocket);
    upstreamSocket.pipe(res.socket!);
  });
  upstreamSocket.on("error", (err) => {
    console.warn(`[egress-proxy] upstream error: ${(err as Error).message}`);
    if (!res.headersSent) {
      res.writeHead(502);
      res.end();
    }
  });
}
