import type { IntegrationManifest } from "../manifest/schema.js";

/**
 * Webhook In — accept signed inbound POST events at
 *   POST /api/webhooks/{integrationId}/event
 * and store them as IntegrationEvent rows for downstream processing.
 *
 * Receivers configure the URL + signing secret in the third-party tool that
 * fires the webhook. Bidwright verifies HMAC and persists the event.
 */
export const webhookInManifest: IntegrationManifest = {
  id: "webhook-in",
  version: "1.0.0",
  name: "Webhook (inbound)",
  description: "Receive signed JSON events at a Bidwright-hosted URL. Useful for surfacing third-party signals into the agent and review timeline.",
  category: "comms",
  vendor: "Bidwright",
  source: "builtin",
  icon: "Webhook",
  tags: ["webhook", "events", "inbound"],
  connection: {
    auth: { type: "none" },
    fields: [
      {
        key: "secret",
        label: "Signing secret",
        type: "secret",
        credentialKind: "hmac_secret",
        required: true,
        helpText:
          "Bidwright verifies HMAC-SHA256 of the raw request body using this secret, sent in the X-Signature header (with optional 'sha256=' prefix).",
      },
      {
        key: "info_url",
        label: "Webhook URL (read-only)",
        type: "info",
        helpText:
          "After install, copy the webhook URL from the integration detail page and paste it into the third-party tool that should fire events.",
      },
    ],
  },
  capabilities: {
    actions: [],
    triggers: [
      {
        id: "event",
        name: "Generic event",
        description: "Receives a signed JSON POST and stores it as an IntegrationEvent.",
        type: "webhook",
        verify: "hmac",
        signatureHeader: "X-Signature",
        timestampHeader: "X-Timestamp",
        maxSkewSeconds: 300,
        externalIdPath: "$.id",
        output: { select: "$" },
      },
    ],
    syncs: [],
  },
  ui: { sections: [] },
};
