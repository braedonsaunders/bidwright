const DEFAULT_API_BASE_URL = "http://localhost:4001";

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

export function resolveApiUrl(path: string) {
  return new URL(path, apiBaseUrl).toString();
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.headers as Record<string, string> ?? {}),
  };

  const { headers: _discardHeaders, ...restInit } = init ?? {};
  const response = await fetch(resolveApiUrl(path), {
    cache: "no-store",
    credentials: "include",
    ...restInit,
    headers,
  });

  if (response.status === 401) {
    if (typeof window !== "undefined" && !path.includes("/auth/")) {
      localStorage.removeItem("bw_user");
      localStorage.removeItem("bw_org");
      window.location.href = "/login";
    }
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `API request failed for ${path} (${response.status} ${response.statusText})${errorBody ? `: ${errorBody}` : ""}`
    );
  }

  return (await response.json()) as T;
}
