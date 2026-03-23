import type { ToolExecutionContext } from "../types.js";

/**
 * Authenticated fetch wrapper for agent tools.
 * Automatically adds Authorization header from the execution context.
 */
export function apiFetch(ctx: ToolExecutionContext, url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (ctx.authToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${ctx.authToken}`);
  }
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers });
}
