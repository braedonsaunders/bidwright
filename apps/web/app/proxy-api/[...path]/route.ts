import type { NextRequest } from "next/server";

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

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
    cache: "no-store",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const upstream = await fetch(targetUrl, init);
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
