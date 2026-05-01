import { createHash, randomBytes } from "node:crypto";
import type { IntegrationManifestParsed } from "../manifest/schema.js";

/**
 * OAuth 2.0 helpers — build authorization URLs, generate PKCE pairs, and
 * exchange / refresh tokens. Stateless utility module; the API layer is
 * responsible for persisting state, code_verifiers, and resulting tokens.
 */

export interface OAuth2ClientCreds {
  clientId: string;
  clientSecret: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
  tokenType: string;
  raw: Record<string, unknown>;
}

export interface BuildAuthUrlOptions {
  manifest: IntegrationManifestParsed;
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
  /** When set, returns a `codeVerifier` you must persist for the callback. */
  pkce?: boolean;
  /** Templated extra params (already string-rendered). */
  extraParams?: Record<string, string>;
}

export interface BuildAuthUrlResult {
  url: string;
  codeVerifier?: string;
  codeChallenge?: string;
}

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function generateState(): string {
  return base64Url(randomBytes(24));
}

export function buildAuthUrl(opts: BuildAuthUrlOptions): BuildAuthUrlResult {
  const auth = opts.manifest.connection.auth;
  if (auth.type !== "oauth2") throw new Error("manifest auth is not oauth2");
  if (auth.flow !== "authorization_code") {
    throw new Error("buildAuthUrl is only valid for authorization_code flow");
  }
  if (!auth.authUrl) throw new Error("manifest oauth2 missing authUrl");

  const url = new URL(auth.authUrl);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", opts.state);

  const scopes = opts.scopes ?? auth.scopes ?? [];
  if (scopes.length > 0) {
    url.searchParams.set("scope", scopes.join(auth.scopeSeparator || " "));
  }

  let codeVerifier: string | undefined;
  let codeChallenge: string | undefined;
  if (opts.pkce ?? auth.pkce) {
    const pkce = generatePkcePair();
    codeVerifier = pkce.codeVerifier;
    codeChallenge = pkce.codeChallenge;
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }

  for (const [k, v] of Object.entries(opts.extraParams ?? {})) {
    if (v === "" || v == null) continue;
    url.searchParams.set(k, v);
  }

  return { url: url.toString(), codeVerifier, codeChallenge };
}

export interface ExchangeCodeOptions {
  manifest: IntegrationManifestParsed;
  client: OAuth2ClientCreds;
  redirectUri: string;
  code: string;
  codeVerifier?: string;
  /** Templated extra params (already string-rendered). */
  extraParams?: Record<string, string>;
}

async function postTokenRequest(
  tokenUrl: string,
  body: Record<string, string>,
  style: "form" | "json",
): Promise<Record<string, unknown>> {
  let response: Response;
  if (style === "form") {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) params.set(k, v);
    response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
    });
  } else {
    response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  }
  const text = await response.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    const err = (data as { error?: string; error_description?: string })?.error_description
      ?? (data as { error?: string })?.error
      ?? `OAuth2 token request failed (${response.status})`;
    throw new Error(err);
  }
  return data as Record<string, unknown>;
}

function parseTokenResponse(raw: Record<string, unknown>): OAuth2Tokens {
  const accessToken = String(raw.access_token ?? "");
  if (!accessToken) throw new Error("OAuth2 response missing access_token");
  const expiresIn = Number(raw.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + (expiresIn - 30) * 1000) // 30s safety margin
    : undefined;
  return {
    accessToken,
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : undefined,
    expiresAt,
    scope: typeof raw.scope === "string" ? raw.scope : undefined,
    tokenType: typeof raw.token_type === "string" ? raw.token_type : "Bearer",
    raw,
  };
}

export async function exchangeAuthorizationCode(opts: ExchangeCodeOptions): Promise<OAuth2Tokens> {
  const auth = opts.manifest.connection.auth;
  if (auth.type !== "oauth2") throw new Error("manifest auth is not oauth2");

  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.client.clientId,
    client_secret: opts.client.clientSecret,
    ...(opts.codeVerifier ? { code_verifier: opts.codeVerifier } : {}),
    ...(opts.extraParams ?? {}),
  };
  const raw = await postTokenRequest(auth.tokenUrl, body, auth.tokenRequestStyle ?? "form");
  return parseTokenResponse(raw);
}

export interface RefreshTokenOptions {
  manifest: IntegrationManifestParsed;
  client: OAuth2ClientCreds;
  refreshToken: string;
  scopes?: string[];
  extraParams?: Record<string, string>;
}

export async function refreshAccessToken(opts: RefreshTokenOptions): Promise<OAuth2Tokens> {
  const auth = opts.manifest.connection.auth;
  if (auth.type !== "oauth2") throw new Error("manifest auth is not oauth2");

  const body: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    client_id: opts.client.clientId,
    client_secret: opts.client.clientSecret,
    ...(opts.scopes && opts.scopes.length > 0
      ? { scope: opts.scopes.join(auth.scopeSeparator || " ") }
      : {}),
    ...(opts.extraParams ?? {}),
  };
  const raw = await postTokenRequest(auth.tokenUrl, body, auth.tokenRequestStyle ?? "form");
  const parsed = parseTokenResponse(raw);
  // Many providers rotate refresh tokens; preserve the old one if the
  // provider didn't return a new one.
  if (!parsed.refreshToken) parsed.refreshToken = opts.refreshToken;
  return parsed;
}

export interface ClientCredentialsOptions {
  manifest: IntegrationManifestParsed;
  client: OAuth2ClientCreds;
  scopes?: string[];
  extraParams?: Record<string, string>;
}

export async function clientCredentialsToken(opts: ClientCredentialsOptions): Promise<OAuth2Tokens> {
  const auth = opts.manifest.connection.auth;
  if (auth.type !== "oauth2") throw new Error("manifest auth is not oauth2");

  const body: Record<string, string> = {
    grant_type: "client_credentials",
    client_id: opts.client.clientId,
    client_secret: opts.client.clientSecret,
    ...(opts.scopes && opts.scopes.length > 0
      ? { scope: opts.scopes.join(auth.scopeSeparator || " ") }
      : {}),
    ...(opts.extraParams ?? {}),
  };
  const raw = await postTokenRequest(auth.tokenUrl, body, auth.tokenRequestStyle ?? "form");
  return parseTokenResponse(raw);
}
