import type { NextRequest } from "next/server";
import { gzip as gzipCallback } from "node:zlib";
import { promisify } from "node:util";

export const runtime = "nodejs";

const INTERNAL_API_BASE_URL = process.env.INTERNAL_API_BASE_URL ?? "http://localhost:4001";
const gzipAsync = promisify(gzipCallback);
// Below this size gzip's overhead isn't worth it.
const COMPRESS_MIN_BYTES = 1024;

function buildTargetUrl(pathSegments: string[], request: NextRequest) {
  const pathname = pathSegments.join("/");
  const target = new URL(pathname, `${INTERNAL_API_BASE_URL.replace(/\/$/, "")}/`);
  request.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value);
  });
  return target;
}

async function proxyRequest(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const targetUrl = buildTargetUrl(path, request);

  const headers = new Headers(request.headers);
  headers.set("accept", headers.get("accept") ?? "application/json");
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("expect");
  headers.delete("keep-alive");
  headers.delete("proxy-authenticate");
  headers.delete("proxy-authorization");
  headers.delete("te");
  headers.delete("trailer");
  headers.delete("transfer-encoding");
  headers.delete("upgrade");
  // Always pull an *uncompressed* body from the API on this internal hop. Node's
  // undici only auto-decodes content-encoding in some versions; forwarding the
  // browser's Accept-Encoding made the API gzip a body that undici (on Node 22)
  // then left encoded — which we shipped to the browser with the header
  // stripped, so the browser saw raw gzip and JSON.parse threw "...is not valid
  // JSON" on binary glyphs. Identity removes that version-dependent ambiguity;
  // we re-apply gzip for the public browser leg ourselves below.
  headers.set("accept-encoding", "identity");

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
    cache: "no-store",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  const upstream = await fetch(targetUrl, init).catch((err) => (
    new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Proxy request failed" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    })
  ));
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  // Compress the public leg ourselves. The upstream hop is identity, so
  // `upstream.body` is always plain text here. We buffer + gzip only
  // application/json (workspace, list, and mutation payloads) when the browser
  // accepts gzip; streaming responses (text/event-stream SSE) and binary/file
  // downloads stream straight through, so we never break streaming or waste
  // cycles re-compressing already-compressed bytes.
  const contentType = upstream.headers.get("content-type") ?? "";
  const browserAcceptsGzip = /\bgzip\b/.test(request.headers.get("accept-encoding") ?? "");
  if (browserAcceptsGzip && contentType.includes("application/json") && upstream.body) {
    const raw = Buffer.from(await upstream.arrayBuffer());
    if (raw.byteLength >= COMPRESS_MIN_BYTES) {
      const compressed = await gzipAsync(raw);
      responseHeaders.set("content-encoding", "gzip");
      responseHeaders.set("content-length", String(compressed.byteLength));
      responseHeaders.append("vary", "Accept-Encoding");
      return new Response(compressed, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }
    return new Response(raw, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

type RouteContext = { params: Promise<unknown> };

function parsePathParams(params: unknown): string[] {
  const value = params as { path?: string[] };
  return Array.isArray(value.path) ? value.path : [];
}

async function handleRoute(request: NextRequest, context: RouteContext) {
  const path = parsePathParams(await context.params);
  return proxyRequest(request, { params: Promise.resolve({ path }) });
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handleRoute(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handleRoute(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return handleRoute(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handleRoute(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return handleRoute(request, context);
}
