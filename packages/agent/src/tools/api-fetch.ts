import type { ToolExecutionContext } from "../types.js";

/**
 * Authenticated fetch wrapper for agent tools.
 * Automatically adds Authorization header from the execution context.
 * Retries on transient errors (429, 502, 503, 504) with exponential backoff.
 */
export async function apiFetch(ctx: ToolExecutionContext, url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (ctx.authToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${ctx.authToken}`);
  }
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const MAX_RETRIES = 4;
  let lastRes: Response | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    lastRes = await fetch(url, { ...init, headers });

    // Retry on rate-limit and transient server errors
    if (lastRes.status === 429 || lastRes.status === 502 || lastRes.status === 503 || lastRes.status === 504) {
      if (attempt < MAX_RETRIES) {
        // Respect Retry-After header if present, otherwise exponential backoff
        const retryAfter = lastRes.headers.get("Retry-After");
        const delayMs = retryAfter
          ? Math.min(parseInt(retryAfter, 10) * 1000, 30_000)
          : Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 30_000);
        await sleep(delayMs);
        continue;
      }
    }

    return lastRes;
  }

  return lastRes!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
