import { ApiError } from "./api/client";

/**
 * A bootstrap failure that is NOT "nobody is signed in". A 401 means show the
 * login screen; anything else (backend down, container cold-start 502, proxy
 * HTML, offline) has to be surfaced, because there is no sign-in that fixes it
 * and the app would otherwise render an empty page.
 */
export interface AuthBootstrapError {
  message: string;
  status: number;
  /** The API call that failed, for the retry copy. */
  source: "setup-status" | "session";
}

/**
 * Turn a thrown bootstrap error into something the shell can render, or null
 * when it is the ordinary unauthenticated answer that the login flow owns.
 */
export function classifyAuthFailure(
  error: unknown,
  source: AuthBootstrapError["source"],
): AuthBootstrapError | null {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 401) return null;
  return {
    message: error instanceof Error && error.message
      ? error.message
      : "The Bidwright API could not be reached.",
    status,
    source,
  };
}
