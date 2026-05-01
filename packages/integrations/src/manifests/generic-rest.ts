import type { IntegrationManifest } from "../manifest/schema.js";

/**
 * Generic REST connector — escape hatch that lets users wire up any HTTP
 * API without authoring a full manifest. The end user supplies baseUrl +
 * auth choice + an "Invoke" action they parameterize at call time.
 *
 * Crucially this proves the manifest contract end-to-end: the same code path
 * that runs first-party connectors runs this one.
 */
export const genericRestManifest: IntegrationManifest = {
  id: "generic-rest",
  version: "1.0.0",
  name: "Generic REST API",
  description:
    "Connect to any HTTP API that speaks JSON. Configure a base URL and auth, then use the Invoke action to call it. Best for systems we don't have a first-party connector for yet.",
  category: "other",
  vendor: "Bidwright",
  source: "builtin",
  icon: "Globe",
  tags: ["custom", "rest", "json", "escape-hatch"],
  connection: {
    baseUrl: "{{config.baseUrl}}",
    auth: { type: "api_key", placement: "header", paramName: "Authorization", prefix: "Bearer " },
    fields: [
      {
        key: "baseUrl",
        label: "Base URL",
        type: "url",
        required: true,
        placeholder: "https://api.example.com/v1",
        helpText: "Root URL the connector prepends to action paths.",
      },
      {
        key: "authMode",
        label: "Authentication",
        type: "select",
        required: true,
        default: "bearer",
        options: [
          { value: "none",   label: "None (public API)" },
          { value: "bearer", label: "Bearer token" },
          { value: "header", label: "Custom header" },
          { value: "query",  label: "Query parameter" },
        ],
      },
      {
        key: "headerName",
        label: "Header name",
        type: "string",
        placeholder: "X-API-Key",
        helpText: "Used when Authentication = Custom header.",
        visibleIf: { key: "authMode", equals: "header" },
      },
      {
        key: "headerPrefix",
        label: "Header prefix",
        type: "string",
        placeholder: "Bearer ",
        helpText: "Optional prefix prepended to the credential. Include trailing space if needed.",
        visibleIf: { key: "authMode", equals: "header" },
      },
      {
        key: "queryName",
        label: "Query parameter",
        type: "string",
        placeholder: "api_key",
        visibleIf: { key: "authMode", equals: "query" },
      },
      {
        key: "apiKey",
        label: "API key / token",
        type: "secret",
        credentialKind: "api_key",
        placeholder: "Paste your token",
        visibleIf: { key: "authMode", equals: "bearer" },
      },
    ],
  },
  capabilities: {
    actions: [
      {
        id: "invoke",
        name: "Invoke endpoint",
        description: "Make an HTTP request to the configured API.",
        llmDescription:
          "Call an arbitrary HTTP endpoint on the configured base URL. Use only when you need data from a system that does not yet have a first-party connector.",
        input: [
          { name: "method", type: "string", description: "HTTP method", required: true, enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          { name: "path",   type: "string", description: "Path relative to base URL (or absolute https:// URL)", required: true },
          { name: "query",  type: "object", description: "Query parameters as a flat object", required: false },
          { name: "headers", type: "object", description: "Additional headers", required: false },
          { name: "body",   type: "object", description: "JSON request body", required: false },
        ],
        output: { select: "$" },
        request: {
          method: "GET",
          path: "{{input.path}}",
          query: {},
          headers: {},
          body: undefined,
          bodyEncoding: "json",
          timeoutMs: 30_000,
          retry: {
            maxAttempts: 3,
            initialDelayMs: 500,
            backoff: "exponential",
            retryOnStatus: [408, 429, 500, 502, 503, 504],
          },
        },
        mutates: true,
        requiresConfirmation: true,
        tags: ["rest", "custom"],
      },
    ],
    triggers: [],
    syncs: [],
  },
  ui: {
    sections: [
      {
        id: "connection",
        title: "Connection",
        description: "Where to call and how to authenticate.",
        fields: [],
      },
    ],
  },
};
