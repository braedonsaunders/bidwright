import type { FastifyReply, FastifyRequest } from "fastify";

export const SESSION_COOKIE_NAME = "bw_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function shouldUseSecureCookies() {
  return process.env.NODE_ENV === "production";
}

function buildCookieAttributes(maxAgeSeconds: number) {
  const parts = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (shouldUseSecureCookies()) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.header(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${buildCookieAttributes(SESSION_MAX_AGE_SECONDS)}`
  );
}

export function clearSessionCookie(reply: FastifyReply) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];

  if (shouldUseSecureCookies()) {
    parts.push("Secure");
  }

  reply.header("Set-Cookie", parts.join("; "));
}

export function getSessionCookieToken(request: FastifyRequest): string | null {
  const raw = request.headers.cookie;
  if (!raw) return null;

  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = rest.join("=");
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}
