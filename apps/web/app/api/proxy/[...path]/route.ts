import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const INTERNAL_API_BASE_URL = process.env.INTERNAL_API_BASE_URL ?? "http://localhost:4001";

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
