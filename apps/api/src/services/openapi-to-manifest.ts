import type { IntegrationManifest, IntegrationManifestParsed } from "@bidwright/integrations";
import { parseManifest } from "@bidwright/integrations";

/**
 * Convert a (subset of) OpenAPI 3.0/3.1 spec into a draft Bidwright
 * integration manifest. Heuristics:
 *
 *   - One action per (path × method) combination — first 50 only.
 *   - Action id = `${method}_${slugified path}`.
 *   - Inputs are pulled from `parameters` (path, query, header) and the
 *     primary `application/json` request body schema.
 *   - Auth is inferred from the first matching `securitySchemes` entry —
 *     bearer / apiKey / oauth2 are recognized; otherwise auth=none.
 *
 * Output is always validated against the manifest schema before return,
 * so callers get either a guaranteed-valid manifest or a Zod error.
 */

interface OpenAPISpec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; description?: string; version?: string; "x-vendor"?: string };
  servers?: Array<{ url: string; description?: string }>;
  components?: {
    securitySchemes?: Record<string, OpenAPISecurityScheme>;
    schemas?: Record<string, unknown>;
  };
  paths?: Record<string, OpenAPIPathItem>;
  security?: Array<Record<string, string[]>>;
}

interface OpenAPISecurityScheme {
  type: "apiKey" | "http" | "oauth2" | "openIdConnect";
  scheme?: string;     // for http: "bearer" | "basic"
  in?: "header" | "query" | "cookie"; // for apiKey
  name?: string;       // for apiKey
  flows?: {
    authorizationCode?: {
      authorizationUrl: string; tokenUrl: string;
      scopes?: Record<string, string>;
    };
    clientCredentials?: { tokenUrl: string; scopes?: Record<string, string> };
  };
}

interface OpenAPIPathItem {
  parameters?: OpenAPIParameter[];
  get?: OpenAPIOperation;
  post?: OpenAPIOperation;
  put?: OpenAPIOperation;
  patch?: OpenAPIOperation;
  delete?: OpenAPIOperation;
}

interface OpenAPIParameter {
  name: string;
  in: "query" | "header" | "path" | "cookie";
  description?: string;
  required?: boolean;
  schema?: { type?: string; enum?: string[]; default?: unknown };
}

interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: {
    content?: Record<string, { schema?: OpenAPISchema }>;
  };
  responses?: Record<string, unknown>;
}

interface OpenAPISchema {
  type?: string;
  properties?: Record<string, OpenAPISchema>;
  required?: string[];
  items?: OpenAPISchema;
  description?: string;
  enum?: string[];
}

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function inferAuth(spec: OpenAPISpec): IntegrationManifest["connection"]["auth"] {
  const schemes = spec.components?.securitySchemes ?? {};
  const first = Object.values(schemes)[0];
  if (!first) return { type: "none" };
  if (first.type === "http" && first.scheme === "bearer") {
    return { type: "bearer", prefix: "Bearer " };
  }
  if (first.type === "http" && first.scheme === "basic") {
    return { type: "basic", usernameField: "username" };
  }
  if (first.type === "apiKey") {
    return {
      type: "api_key",
      placement: (first.in === "query" ? "query" : "header"),
      paramName: first.name ?? "Authorization",
      prefix: "",
    };
  }
  if (first.type === "oauth2") {
    const flow = first.flows?.authorizationCode;
    if (flow) {
      return {
        type: "oauth2",
        flow: "authorization_code",
        authUrl: flow.authorizationUrl,
        tokenUrl: flow.tokenUrl,
        scopes: Object.keys(flow.scopes ?? {}),
        scopeSeparator: " ",
        tokenPlacement: "header",
        tokenParamName: "Authorization",
        tokenPrefix: "Bearer ",
        pkce: false,
        extraAuthParams: {},
        extraTokenParams: {},
        tokenRequestStyle: "form",
      };
    }
    const cc = first.flows?.clientCredentials;
    if (cc) {
      return {
        type: "oauth2",
        flow: "client_credentials",
        tokenUrl: cc.tokenUrl,
        scopes: Object.keys(cc.scopes ?? {}),
        scopeSeparator: " ",
        tokenPlacement: "header",
        tokenParamName: "Authorization",
        tokenPrefix: "Bearer ",
        pkce: false,
        extraAuthParams: {},
        extraTokenParams: {},
        tokenRequestStyle: "form",
      };
    }
  }
  return { type: "none" };
}

function paramsToInput(parameters: OpenAPIParameter[] | undefined): Array<{
  name: string; type: "string" | "number" | "boolean" | "object" | "array";
  description: string; required: boolean; enum?: string[]; default?: unknown;
}> {
  const out: Array<{
    name: string; type: "string" | "number" | "boolean" | "object" | "array";
    description: string; required: boolean; enum?: string[]; default?: unknown;
  }> = [];
  for (const p of parameters ?? []) {
    if (p.in === "cookie") continue;
    const t = (p.schema?.type ?? "string") as "string" | "number" | "boolean" | "object" | "array";
    out.push({
      name: p.name,
      type: ["string", "number", "boolean", "object", "array"].includes(t) ? t : "string",
      description: p.description ?? "",
      required: !!p.required,
      enum: p.schema?.enum,
      default: p.schema?.default,
    });
  }
  return out;
}

function bodyToInput(op: OpenAPIOperation): Array<{
  name: string; type: "string" | "number" | "boolean" | "object" | "array";
  description: string; required: boolean;
}> {
  const json = op.requestBody?.content?.["application/json"]?.schema;
  if (!json || json.type !== "object" || !json.properties) return [];
  const required = new Set(json.required ?? []);
  const out: Array<{ name: string; type: "string" | "number" | "boolean" | "object" | "array"; description: string; required: boolean }> = [];
  for (const [name, prop] of Object.entries(json.properties)) {
    const t = (prop.type ?? "string") as "string" | "number" | "boolean" | "object" | "array";
    out.push({
      name,
      type: ["string", "number", "boolean", "object", "array"].includes(t) ? t : "string",
      description: prop.description ?? "",
      required: required.has(name),
    });
  }
  return out;
}

function pathToTemplated(path: string): string {
  // OpenAPI uses {param} — manifest already supports {{...}} at non-collision
  // positions; convert {param} → {{input.param}} so the runner substitutes.
  return path.replace(/\{([^}]+)\}/g, (_m, name: string) => `{{input.${name}}}`);
}

export function openapiToManifest(spec: OpenAPISpec, options: {
  manifestId?: string;
  vendor?: string;
  baseUrlOverride?: string;
}): IntegrationManifestParsed {
  const baseUrl = options.baseUrlOverride ?? spec.servers?.[0]?.url;
  if (!baseUrl) throw new Error("OpenAPI spec has no server / baseUrl. Pass baseUrlOverride.");

  const id = options.manifestId ?? slugify(spec.info?.title ?? "custom-openapi");
  const auth = inferAuth(spec);

  const fields: IntegrationManifest["connection"]["fields"] = [];
  if (auth.type === "api_key" || auth.type === "bearer") {
    fields.push({
      key: "apiKey",
      label: "API key",
      type: "secret",
      required: true,
      credentialKind: auth.type === "bearer" ? "bearer_token" : "api_key",
    });
  }
  if (auth.type === "basic") {
    fields.push(
      { key: "username", label: "Username", type: "string", required: true },
      { key: "basic_password", label: "Password", type: "secret", required: true, credentialKind: "basic_password" },
    );
  }

  const actions: NonNullable<IntegrationManifest["capabilities"]>["actions"] = [];
  let actionCount = 0;
  for (const [rawPath, item] of Object.entries(spec.paths ?? {})) {
    if (actionCount >= 50) break;
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      if (actionCount >= 50) break;
      const id = op.operationId
        ? slugify(op.operationId)
        : `${method}_${slugify(rawPath)}`;
      const allParams = [...(item.parameters ?? []), ...(op.parameters ?? [])];
      const queryParams = allParams.filter((p) => p.in === "query");
      const headerParams = allParams.filter((p) => p.in === "header");
      const inputs = [
        ...paramsToInput(allParams.filter((p) => p.in !== "header")),
        ...bodyToInput(op),
      ];
      const queryTpl: Record<string, string> = {};
      for (const q of queryParams) queryTpl[q.name] = `{{input.${q.name}}}`;
      const headersTpl: Record<string, string> = {};
      for (const h of headerParams) headersTpl[h.name] = `{{input.${h.name}}}`;

      const hasJsonBody = !!op.requestBody?.content?.["application/json"];
      const bodyTpl = hasJsonBody
        ? Object.fromEntries(bodyToInput(op).map((p) => [p.name, `{{input.${p.name}}}`]))
        : undefined;

      actions.push({
        id,
        name: op.summary ?? id,
        description: op.description ?? op.summary ?? `${method.toUpperCase()} ${rawPath}`,
        input: inputs,
        output: { select: "$" },
        request: {
          method: method.toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
          path: pathToTemplated(rawPath),
          query: queryTpl,
          headers: headersTpl,
          body: hasJsonBody ? bodyTpl : undefined,
          bodyEncoding: hasJsonBody ? "json" : "none",
          timeoutMs: 30_000,
          retry: { maxAttempts: 3, initialDelayMs: 500, backoff: "exponential", retryOnStatus: [408, 429, 500, 502, 503, 504] },
        },
        mutates: method !== "get",
        requiresConfirmation: method === "delete",
        tags: op.tags ?? [],
      });
      actionCount++;
    }
  }

  const manifest: IntegrationManifest = {
    id,
    version: spec.info?.version ?? "1.0.0",
    name: spec.info?.title ?? id,
    description: spec.info?.description ?? "",
    category: "other",
    vendor: options.vendor ?? spec.info?.["x-vendor"] ?? "",
    source: "custom",
    tags: [],
    connection: {
      baseUrl,
      auth,
      fields,
      allowedHosts: [],
    },
    capabilities: { actions, triggers: [], syncs: [] },
    ui: { sections: [] },
  };

  // Validate before returning — callers can rely on the result being legal.
  return parseManifest(manifest);
}
