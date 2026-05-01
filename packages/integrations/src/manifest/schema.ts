import { z } from "zod";

/**
 * Integration Manifest schema — the single declarative contract every
 * integration (built-in or user-authored) speaks. The same shape powers:
 *   - the Settings → Integrations install/configure UI (form is rendered
 *     from `connection.fields` + `ui.sections`),
 *   - the agent tool registrar (`integration.{slug}.{action}` from
 *     `capabilities.actions[]`),
 *   - the MCP server registrar (mirrors actions over MCP),
 *   - the BullMQ sync runner (`capabilities.syncs[]`),
 *   - the webhook receiver (`capabilities.triggers[]`).
 *
 * ── Versioning ────────────────────────────────────────────────────────────
 * `version` is semver. The installed `Integration` row freezes the manifest
 * at install time (`manifestSnapshot`) so manifest-author updates do not
 * silently change running connections.
 *
 * ── Templating ────────────────────────────────────────────────────────────
 * Strings inside `request.url`, `request.headers`, `request.body`, and
 * mapping JSONPaths support `{{...}}` substitution against:
 *   - `{{config.<key>}}`         — non-secret config from Integration.config
 *   - `{{credential.<kind>}}`    — decrypted credential value (server-side only)
 *   - `{{input.<param>}}`        — action input
 *   - `{{cursor}}`               — sync cursor
 *   - `{{now}}` / `{{nowIso}}`   — current time
 */

// ── Display-time UI ───────────────────────────────────────────────────────

export const manifestFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  type: z.enum([
    "string", "secret", "url", "email", "number", "boolean",
    "select", "multiselect", "textarea", "json", "info",
  ]),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  default: z.unknown().optional(),
  options: z
    .array(z.object({ value: z.string(), label: z.string() }))
    .optional(),
  pattern: z.string().optional(), // regex
  min: z.number().optional(),
  max: z.number().optional(),
  visibleIf: z
    .object({ key: z.string(), equals: z.unknown() })
    .optional(),
  // For type "secret", the persisted credential kind. Defaults to "api_key".
  credentialKind: z.string().optional(),
});

export type ManifestField = z.infer<typeof manifestFieldSchema>;

const uiSectionSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(manifestFieldSchema).default([]),
});

// ── Connection / Auth ─────────────────────────────────────────────────────

const apiKeyAuthSchema = z.object({
  type: z.literal("api_key"),
  // Where to place the credential on outbound requests.
  placement: z.enum(["header", "query", "body"]).default("header"),
  paramName: z.string().default("Authorization"),
  // Optional prefix, e.g. "Bearer " or "Token ".
  prefix: z.string().default(""),
});

const basicAuthSchema = z.object({
  type: z.literal("basic"),
  // Username can be a config field; password is always a secret credential.
  usernameField: z.string().default("username"),
});

const bearerAuthSchema = z.object({
  type: z.literal("bearer"),
  prefix: z.string().default("Bearer "),
});

const oauth2AuthSchema = z.object({
  type: z.literal("oauth2"),
  flow: z.enum(["authorization_code", "client_credentials"]).default("authorization_code"),
  authUrl: z.string().url().optional(), // not required for client_credentials
  tokenUrl: z.string().url(),
  scopes: z.array(z.string()).default([]),
  scopeSeparator: z.string().default(" "),
  // Where the access token is sent on outbound requests.
  tokenPlacement: z.enum(["header", "query"]).default("header"),
  tokenParamName: z.string().default("Authorization"),
  tokenPrefix: z.string().default("Bearer "),
  // Optional PKCE for public clients.
  pkce: z.boolean().default(false),
  // Static or templated extra params for the auth URL.
  extraAuthParams: z.record(z.string()).default({}),
  // Static or templated extra params for the token request body.
  extraTokenParams: z.record(z.string()).default({}),
  // Provider-style: "form" (application/x-www-form-urlencoded) or "json".
  tokenRequestStyle: z.enum(["form", "json"]).default("form"),
});

const hmacAuthSchema = z.object({
  type: z.literal("hmac"),
  algorithm: z.enum(["sha1", "sha256", "sha512"]).default("sha256"),
  signatureHeader: z.string().default("X-Signature"),
  // Optional prefix, e.g. "sha256=".
  signaturePrefix: z.string().default(""),
  encoding: z.enum(["hex", "base64"]).default("hex"),
});

const noneAuthSchema = z.object({ type: z.literal("none") });

const authSchema = z.discriminatedUnion("type", [
  apiKeyAuthSchema,
  basicAuthSchema,
  bearerAuthSchema,
  oauth2AuthSchema,
  hmacAuthSchema,
  noneAuthSchema,
]);

const connectionSchema = z.object({
  baseUrl: z.string().optional(), // can be a config-templated string
  auth: authSchema,
  // Form fields rendered on the connect screen (account ids, regions, etc.).
  fields: z.array(manifestFieldSchema).default([]),
  // Optional generic probe used by `POST /integrations/:id/test`.
  test: z.object({
    method: z.enum(["GET", "POST", "HEAD"]).default("GET"),
    path: z.string(),
    expectStatus: z.array(z.number()).default([200]),
    headers: z.record(z.string()).default({}),
  }).optional(),
  // Allow-listed outbound hosts (defense in depth — the action runner already
  // pins to baseUrl + per-action paths; this is a belt for SSRF-prone setups).
  allowedHosts: z.array(z.string()).default([]),
});

// ── Capabilities ──────────────────────────────────────────────────────────

const ioFieldSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "object", "array"]).default("string"),
  description: z.string().default(""),
  required: z.boolean().default(false),
  enum: z.array(z.string()).optional(),
  default: z.unknown().optional(),
});

const requestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  // Path appended to connection.baseUrl. Supports {{...}} substitution.
  path: z.string(),
  query: z.record(z.string()).default({}),
  headers: z.record(z.string()).default({}),
  // JSON body, support templating in any string leaf.
  body: z.unknown().optional(),
  // For multipart/form-encoded (used by some OAuth2 token endpoints).
  bodyEncoding: z.enum(["json", "form", "none"]).default("json"),
  timeoutMs: z.number().int().positive().default(30_000),
  // Retry policy for transient failures (5xx / network / timeout).
  retry: z.object({
    maxAttempts: z.number().int().min(1).max(10).default(3),
    initialDelayMs: z.number().int().positive().default(500),
    backoff: z.enum(["fixed", "exponential"]).default("exponential"),
    retryOnStatus: z.array(z.number()).default([408, 429, 500, 502, 503, 504]),
  }).default({}),
});

const actionSchema = z.object({
  id: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  name: z.string(),
  description: z.string(),
  llmDescription: z.string().optional(),
  input: z.array(ioFieldSchema).default([]),
  output: z.object({
    // JSONPath-style mapping from response into a typed object the agent sees.
    // `$` refers to the parsed response body. Use "$" to pass through unchanged.
    select: z.string().default("$"),
    map: z.record(z.string()).optional(), // { "outKey": "$.responsePath" }
  }).default({ select: "$" }),
  request: requestSchema,
  mutates: z.boolean().default(true),
  requiresConfirmation: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
});

const triggerSchema = z.object({
  id: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  name: z.string(),
  description: z.string(),
  type: z.literal("webhook"),
  // Verification strategy — uses the auth.type=hmac config when "hmac".
  verify: z.enum(["none", "hmac", "shared_secret"]).default("none"),
  // Header carrying the signature when verify=hmac/shared_secret.
  signatureHeader: z.string().default("X-Signature"),
  // Header carrying a timestamp (for replay protection, optional).
  timestampHeader: z.string().optional(),
  // Maximum allowed clock skew in seconds when timestampHeader is set.
  maxSkewSeconds: z.number().int().positive().default(300),
  // Path to extract a stable external ID for idempotency.
  externalIdPath: z.string().optional(),
  // Optional output mapping for the event payload (same shape as actions).
  output: z.object({
    select: z.string().default("$"),
    map: z.record(z.string()).optional(),
  }).default({ select: "$" }),
});

const syncSchema = z.object({
  id: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  name: z.string(),
  description: z.string(),
  direction: z.enum(["pull", "push", "bidirectional"]).default("pull"),
  // Default cron schedule. Org admins can override via IntegrationSyncState.
  schedule: z.string().default("0 */6 * * *"),
  // For pull: how to fetch the next page of records.
  request: requestSchema.optional(),
  // For pull: cursor extraction from a successful response.
  cursor: z.object({
    fromResponse: z.string().optional(), // JSONPath to next-cursor in response
    fromHeader: z.string().optional(),   // header carrying next page link
    requestParam: z.string().optional(), // query param name to send the cursor
  }).optional(),
  // For pull: where to find the records array in the response.
  recordsPath: z.string().default("$.data"),
  // ID extraction from a single record.
  externalIdPath: z.string().default("$.id"),
  // Field mapping into Bidwright shape (informational — the actual mapping
  // logic is delegated to the manifest's resource handler).
  mapping: z.record(z.string()).default({}),
  // Optional Bidwright entity to upsert into; null means store only as
  // ExternalRecord and let the user wire it up later.
  target: z.string().nullable().default(null),
});

const capabilitiesSchema = z.object({
  actions: z.array(actionSchema).default([]),
  triggers: z.array(triggerSchema).default([]),
  syncs: z.array(syncSchema).default([]),
});

// ── Top-level Manifest ────────────────────────────────────────────────────

export const integrationManifestSchema = z.object({
  // Stable, machine-friendly id (e.g. "procore", "generic-rest").
  id: z.string().min(1).regex(/^[a-z][a-z0-9-]*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/),
  name: z.string(),
  description: z.string().default(""),
  category: z.enum([
    "erp", "accounting", "crm", "construction", "estimating",
    "cad_bim", "pricing", "sales", "documents", "comms",
    "compliance", "identity", "storage", "other",
  ]).default("other"),
  vendor: z.string().default(""),
  homepage: z.string().url().optional(),
  docsUrl: z.string().url().optional(),
  icon: z.string().optional(),
  tags: z.array(z.string()).default([]),
  source: z.enum(["builtin", "community", "custom"]).default("builtin"),
  connection: connectionSchema,
  capabilities: capabilitiesSchema.default({ actions: [], triggers: [], syncs: [] }),
  ui: z.object({
    sections: z.array(uiSectionSchema).default([]),
  }).default({ sections: [] }),
});

// Input type — what manifest authors write. Defaults stay optional.
// Always pass an authored manifest through `parseManifest()` before handing
// it to the runtime so defaults are filled in.
export type IntegrationManifest = z.input<typeof integrationManifestSchema>;
// Output type — what the runtime sees after Zod has applied defaults.
export type IntegrationManifestParsed = z.output<typeof integrationManifestSchema>;
export type ManifestAuth = z.output<typeof authSchema>;
export type ManifestAction = z.output<typeof actionSchema>;
export type ManifestTrigger = z.output<typeof triggerSchema>;
export type ManifestSync = z.output<typeof syncSchema>;
export type ManifestRequest = z.output<typeof requestSchema>;
export type ManifestConnection = z.output<typeof connectionSchema>;

/**
 * Validate and normalize a raw manifest. Throws ZodError on failure with a
 * useful path for surfacing in the manifest editor. Returns the *parsed*
 * (defaults-applied) shape so the runtime can rely on every field being set.
 */
export function parseManifest(raw: unknown): IntegrationManifestParsed {
  return integrationManifestSchema.parse(raw);
}

export function safeParseManifest(raw: unknown):
  | { ok: true; manifest: IntegrationManifestParsed }
  | { ok: false; error: z.ZodError } {
  const r = integrationManifestSchema.safeParse(raw);
  return r.success ? { ok: true, manifest: r.data } : { ok: false, error: r.error };
}
