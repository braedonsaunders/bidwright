import type { IntegrationManifest } from "../manifest/schema.js";

/**
 * SFTP CSV — placeholder manifest for scheduled CSV pulls. The runtime path
 * here is HTTP-based (an SFTP-fronting microservice), but the manifest shape
 * is the same. Useful for supplier price feeds where a partner drops a CSV
 * to a known endpoint.
 */
export const sftpCsvManifest: IntegrationManifest = {
  id: "sftp-csv",
  version: "1.0.0",
  name: "SFTP CSV pull",
  description: "Scheduled CSV download from an HTTPS endpoint with optional basic auth — common for supplier price feeds.",
  category: "storage",
  vendor: "Bidwright",
  source: "builtin",
  icon: "FileSpreadsheet",
  tags: ["csv", "scheduled", "supplier"],
  connection: {
    baseUrl: "{{config.endpoint}}",
    allowedHosts: [],
    auth: { type: "basic", usernameField: "username" },
    fields: [
      { key: "endpoint", label: "HTTPS endpoint", type: "url", required: true, placeholder: "https://feed.example.com" },
      { key: "username", label: "Username", type: "string", required: false },
      { key: "basic_password", label: "Password", type: "secret", credentialKind: "basic_password" },
    ],
  },
  capabilities: {
    actions: [],
    triggers: [],
    syncs: [
      {
        id: "feed",
        name: "Feed",
        description: "Pull the configured CSV file and emit one record per row.",
        direction: "pull",
        schedule: "0 6 * * *",
        request: {
          method: "GET",
          path: "{{config.path}}",
          query: {},
          headers: { Accept: "text/csv" },
          body: undefined,
          bodyEncoding: "none",
          timeoutMs: 60_000,
          retry: { maxAttempts: 3, initialDelayMs: 1000, backoff: "exponential", retryOnStatus: [408, 429, 500, 502, 503, 504] },
        },
        recordsPath: "$._text",
        externalIdPath: "$",
        mapping: {},
        target: null,
      },
    ],
  },
  ui: { sections: [] },
};
