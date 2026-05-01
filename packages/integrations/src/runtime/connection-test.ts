import type { IntegrationManifestParsed } from "../manifest/schema.js";
import { applyAuth, type OutboundRequest } from "../auth/index.js";
import { renderDeep, renderString } from "./template.js";

/**
 * Manifest-driven connection probe. Hits `manifest.connection.test` (or, if
 * absent, falls back to a HEAD/GET on baseUrl) with the integration's auth
 * applied and validates the status against `expectStatus`.
 *
 * Returns a clean success/failure shape — never throws on transport errors.
 */

export interface TestConnectionInput {
  manifest: IntegrationManifestParsed;
  config: Record<string, unknown>;
  credentials: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface TestConnectionOutput {
  success: boolean;
  message: string;
  httpStatus?: number;
  durationMs: number;
}

export async function testConnection(opts: TestConnectionInput): Promise<TestConnectionOutput> {
  const { manifest, config, credentials } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const start = Date.now();
  const ctx = { config, credential: credentials, input: {}, cursor: null };

  const baseUrl = manifest.connection.baseUrl
    ? renderString(manifest.connection.baseUrl, ctx)
    : undefined;

  const test = manifest.connection.test;
  const method = test?.method ?? "GET";
  const path = test?.path ?? "";
  const headers = renderDeep(test?.headers ?? {}, ctx);
  const expect = test?.expectStatus ?? [200];

  let url: string;
  try {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      url = path;
    } else if (!baseUrl) {
      return {
        success: false,
        message: "Manifest does not declare a baseUrl or test path; cannot probe.",
        durationMs: Date.now() - start,
      };
    } else {
      const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
      url = new URL(path.startsWith("/") ? path.slice(1) : path, base).toString();
    }
  } catch (e) {
    return {
      success: false,
      message: `Invalid test URL: ${(e as Error).message}`,
      durationMs: Date.now() - start,
    };
  }

  let outbound: OutboundRequest;
  try {
    outbound = applyAuth(manifest.connection.auth, {
      method,
      url,
      headers: { Accept: "application/json", ...headers },
      query: {},
      body: undefined,
      bodyEncoding: "none",
    }, { credentials, config });
  } catch (e) {
    return {
      success: false,
      message: `Auth setup failed: ${(e as Error).message}`,
      durationMs: Date.now() - start,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);

  try {
    const res = await fetchImpl(outbound.url, {
      method: outbound.method,
      headers: outbound.headers,
      signal: controller.signal,
    });
    const ok = expect.includes(res.status);
    let detail = "";
    if (!ok) {
      try { detail = (await res.text()).slice(0, 400); } catch {}
    }
    return {
      success: ok,
      message: ok
        ? "Connected"
        : `Probe returned ${res.status}${detail ? ` — ${detail}` : ""}`,
      httpStatus: res.status,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      message: (err as Error).message ?? "Network error",
      durationMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timer);
  }
}
