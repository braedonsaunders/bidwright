import type { FastifyInstance, FastifyRequest } from "fastify";
import { decryptCredential, parseManifest, verifyWebhook } from "@bidwright/integrations";
import { prisma } from "@bidwright/db";

/**
 * Public inbound webhook receiver.
 *
 * URL shape:
 *   POST /api/webhooks/:integrationId/:triggerId
 *
 * Public route — auth comes from manifest-declared signature verification
 * (HMAC over the raw body, optional timestamp anti-replay). Persists every
 * verified event as an `IntegrationEvent` for downstream processing by the
 * worker.
 *
 * The route is mounted under `/api/webhooks/...` which is intentionally
 * NOT in the auth middleware's public prefix list — we add it there.
 *
 * Body parsing: Fastify by default parses JSON. We need the *raw* body to
 * compute HMAC; we register a content-type parser that captures the raw
 * string before JSON.parse.
 */

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

interface WebhookParams {
  integrationId: string;
  triggerId: string;
}

export async function webhooksRoutes(app: FastifyInstance): Promise<void> {
  // Capture raw body alongside the parsed JSON.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const raw = typeof body === "string" ? body : body.toString("utf8");
    (_req as FastifyRequest).rawBody = raw;
    if (!raw) return done(null, {});
    try { done(null, JSON.parse(raw)); }
    catch (err) { done(err as Error, undefined); }
  });

  app.post<{ Params: WebhookParams }>(
    "/api/webhooks/:integrationId/:triggerId",
    async (request, reply) => {
      const { integrationId, triggerId } = request.params;
      const integration = await prisma.integration.findUnique({ where: { id: integrationId } });
      if (!integration) return reply.code(404).send({ error: "Unknown integration" });
      if (!integration.enabled) return reply.code(409).send({ error: "Integration disabled" });

      let manifest;
      try { manifest = parseManifest(integration.manifestSnapshot); }
      catch { return reply.code(500).send({ error: "Invalid manifest snapshot" }); }

      const trigger = manifest.capabilities.triggers.find((t) => t.id === triggerId);
      if (!trigger) return reply.code(404).send({ error: "Unknown trigger" });

      // Load secret if needed.
      let secret: string | undefined;
      if (trigger.verify === "hmac" || trigger.verify === "shared_secret") {
        const row = await prisma.integrationCredential.findFirst({
          where: { integrationId, kind: { in: ["hmac_secret", "shared_secret"] } },
        });
        if (!row) return reply.code(401).send({ error: "Missing webhook secret" });
        try {
          secret = decryptCredential(
            row.ciphertext, integration.organizationId, integrationId, row.kind, row.keyContext,
          );
        } catch { return reply.code(500).send({ error: "Credential decryption failed" }); }
      }

      const rawBody = request.rawBody ?? "";
      const verdict = verifyWebhook({
        trigger,
        headers: request.headers as Record<string, string | string[] | undefined>,
        rawBody,
        parsedBody: request.body ?? {},
        secret,
      });

      if (verdict.signatureValid === false) {
        // Slack URL verification escape: many providers expect plaintext
        // challenge response. Handle the most common case (Slack-style).
        const challenge = (request.body as { challenge?: string })?.challenge;
        if (challenge && trigger.id === "events") {
          return reply.type("text/plain").send(challenge);
        }
        return reply.code(401).send({ error: verdict.reason ?? "signature invalid" });
      }

      // Idempotency: if externalId is already present, no-op with 200.
      if (verdict.externalId) {
        const existing = await prisma.integrationEvent.findUnique({
          where: {
            integrationId_externalId: {
              integrationId,
              externalId: verdict.externalId,
            },
          },
        });
        if (existing) return { ok: true, deduped: true, eventId: existing.id };
      }

      const event = await prisma.integrationEvent.create({
        data: {
          integrationId,
          direction: "inbound",
          type: `webhook.${trigger.id}`,
          status: "delivered",
          payload: (verdict.shapedPayload as object) ?? {},
          headers: filterRecordableHeaders(request.headers),
          signatureValid: verdict.signatureValid,
          externalId: verdict.externalId,
        },
      });

      return { ok: true, eventId: event.id };
    },
  );
}

function filterRecordableHeaders(headers: FastifyRequest["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  const skip = new Set([
    "authorization", "cookie", "x-api-key",
    "x-bidwright-signature", "x-signature",
    "x-slack-signature", "x-hub-signature", "x-hub-signature-256",
  ]);
  for (const [k, v] of Object.entries(headers)) {
    if (skip.has(k.toLowerCase())) { out[k] = "***"; continue; }
    out[k] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return out;
}
