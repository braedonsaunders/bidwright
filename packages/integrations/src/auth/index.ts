import type { ManifestAuth } from "../manifest/schema.js";

/**
 * Auth strategies project a credential set onto an outbound request before
 * the action runner sends it. Each strategy returns a *new* request shape
 * with headers / query / body / url augmented as needed.
 *
 * Credentials are passed as a flat `{ kind: plaintextValue }` map. Decryption
 * happens in the API layer; this package never touches encrypted bytes
 * directly so it can stay free of crypto + DB dependencies.
 */

export interface OutboundRequest {
  method: string;
  url: string;             // already templated, including query string if applicable
  headers: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  bodyEncoding: "json" | "form" | "none";
}

export interface AuthApplyContext {
  credentials: Record<string, string>;
  config: Record<string, unknown>;
}

export class AuthError extends Error {
  constructor(message: string, public readonly code: "missing_credential" | "expired" | "unsupported" = "missing_credential") {
    super(message);
    this.name = "AuthError";
  }
}

export function applyAuth(
  auth: ManifestAuth,
  request: OutboundRequest,
  ctx: AuthApplyContext,
): OutboundRequest {
  switch (auth.type) {
    case "none":   return request;
    case "api_key": return applyApiKey(auth, request, ctx);
    case "bearer":  return applyBearer(auth, request, ctx);
    case "basic":   return applyBasic(auth, request, ctx);
    case "oauth2":  return applyOAuth2(auth, request, ctx);
    case "hmac":    return request; // HMAC is applied post-body-serialization in the runner
    default: throw new AuthError(`Unsupported auth type: ${(auth as { type: string }).type}`, "unsupported");
  }
}

function requireCredential(ctx: AuthApplyContext, kind: string): string {
  const v = ctx.credentials[kind];
  if (!v) throw new AuthError(`Missing credential: ${kind}`);
  return v;
}

function applyApiKey(
  auth: Extract<ManifestAuth, { type: "api_key" }>,
  req: OutboundRequest,
  ctx: AuthApplyContext,
): OutboundRequest {
  const value = requireCredential(ctx, "api_key");
  const composed = `${auth.prefix ?? ""}${value}`;
  const next: OutboundRequest = {
    ...req,
    headers: { ...req.headers },
    query: { ...req.query },
  };
  if (auth.placement === "header") {
    next.headers[auth.paramName] = composed;
  } else if (auth.placement === "query") {
    next.query[auth.paramName] = composed;
  } else if (auth.placement === "body") {
    if (next.body && typeof next.body === "object" && !Array.isArray(next.body)) {
      next.body = { ...(next.body as Record<string, unknown>), [auth.paramName]: composed };
    } else {
      next.body = { [auth.paramName]: composed };
    }
  }
  return next;
}

function applyBearer(
  auth: Extract<ManifestAuth, { type: "bearer" }>,
  req: OutboundRequest,
  ctx: AuthApplyContext,
): OutboundRequest {
  const value = requireCredential(ctx, "bearer_token");
  return {
    ...req,
    headers: { ...req.headers, Authorization: `${auth.prefix ?? "Bearer "}${value}` },
  };
}

function applyBasic(
  auth: Extract<ManifestAuth, { type: "basic" }>,
  req: OutboundRequest,
  ctx: AuthApplyContext,
): OutboundRequest {
  const username = String(ctx.config[auth.usernameField] ?? "");
  const password = requireCredential(ctx, "basic_password");
  const encoded = Buffer.from(`${username}:${password}`).toString("base64");
  return {
    ...req,
    headers: { ...req.headers, Authorization: `Basic ${encoded}` },
  };
}

function applyOAuth2(
  auth: Extract<ManifestAuth, { type: "oauth2" }>,
  req: OutboundRequest,
  ctx: AuthApplyContext,
): OutboundRequest {
  const token = requireCredential(ctx, "oauth_access_token");
  const composed = `${auth.tokenPrefix ?? "Bearer "}${token}`;
  const next: OutboundRequest = {
    ...req,
    headers: { ...req.headers },
    query: { ...req.query },
  };
  if (auth.tokenPlacement === "header") {
    next.headers[auth.tokenParamName] = composed;
  } else {
    next.query[auth.tokenParamName] = token;
  }
  return next;
}
