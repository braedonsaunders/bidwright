import type { IntegrationManifest } from "../manifest/schema.js";

/**
 * Webhook Out — fire-and-forget event publisher to any URL the user
 * configures. Useful for Zapier/Make/n8n hooks and lightweight
 * notifications. HMAC signing is supported for receivers that want to
 * verify Bidwright as the sender.
 */
export const webhookOutManifest: IntegrationManifest = {
  id: "webhook-out",
  version: "1.0.0",
  name: "Webhook (outbound)",
  description: "Send signed JSON payloads to a URL you control. Pairs with Zapier, Make, n8n, or any service that listens for webhooks.",
  category: "comms",
  vendor: "Bidwright",
  source: "builtin",
  icon: "Webhook",
  tags: ["webhook", "events", "outbound"],
  connection: {
    baseUrl: "{{config.targetUrl}}",
    auth: { type: "hmac", algorithm: "sha256", signatureHeader: "X-Bidwright-Signature", signaturePrefix: "sha256=", encoding: "hex" },
    fields: [
      {
        key: "targetUrl",
        label: "Target URL",
        type: "url",
        required: true,
        placeholder: "https://hooks.example.com/path",
        helpText: "Receives POST requests with a JSON body.",
      },
      {
        key: "hmac_secret",
        label: "Signing secret",
        type: "secret",
        credentialKind: "hmac_secret",
        helpText: "Receivers verify HMAC-SHA256 over the raw body using this secret. Generate a strong random value.",
      },
    ],
  },
  capabilities: {
    actions: [
      {
        id: "send",
        name: "Send event",
        description: "POST a JSON event to the configured URL with an HMAC signature.",
        input: [
          { name: "event", type: "string", description: "Short event name, e.g. 'quote.awarded'", required: true },
          { name: "data",  type: "object", description: "JSON payload", required: true },
        ],
        output: { select: "$" },
        request: {
          method: "POST",
          path: "",
          query: {},
          headers: { "Content-Type": "application/json" },
          body: { event: "{{input.event}}", data: "{{input.data}}", sentAt: "{{nowIso}}" },
          bodyEncoding: "json",
          timeoutMs: 15_000,
          retry: {
            maxAttempts: 4,
            initialDelayMs: 1_000,
            backoff: "exponential",
            retryOnStatus: [408, 429, 500, 502, 503, 504],
          },
        },
        mutates: true,
        requiresConfirmation: false,
        tags: ["events"],
      },
    ],
    triggers: [],
    syncs: [],
  },
  ui: { sections: [] },
};
