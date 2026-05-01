import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  maskSecret,
  verifyWebhook,
  decryptCredential,
  type IntegrationManifest,
} from "@bidwright/integrations";
import { prisma } from "@bidwright/db";

import { integrationsService } from "../services/integrations-service.js";
import { runSyncNow } from "../services/integrations-sync.js";
import { openapiToManifest } from "../services/openapi-to-manifest.js";

// ── Request schemas ───────────────────────────────────────────────────────

const installSchema = z.object({
  manifestId: z.string().min(1),
  manifestSource: z.enum(["builtin", "community", "custom"]).optional(),
  customManifest: z.unknown().optional(),
  slug: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  exposeToAgent: z.boolean().optional(),
  exposeToMcp: z.boolean().optional(),
});

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  exposeToAgent: z.boolean().optional(),
  exposeToMcp: z.boolean().optional(),
});

const setCredentialSchema = z.object({
  kind: z.string().min(1),
  value: z.string().min(1),
  meta: z.record(z.unknown()).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  refreshAfter: z.string().datetime().nullable().optional(),
});

const invokeSchema = z.object({
  input: z.record(z.unknown()).default({}),
  idempotencyKey: z.string().optional(),
});

const oauthBeginSchema = z.object({
  redirectUri: z.string().url(),
  // Per-org OAuth client credentials. Most providers (Slack, HubSpot,
  // Procore, Salesforce, etc.) require the customer to register their own
  // app and supply (clientId, clientSecret) here.
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

// ── OAuth client cache ────────────────────────────────────────────────────
// We never persist clientSecret unencrypted. When a user kicks off OAuth
// they pass it as part of the begin request; we encrypt it as a credential
// (kind="client_secret") so the callback can fetch it without re-asking.

async function persistOAuthClient(
  organizationId: string, integrationId: string, clientId: string, clientSecret: string,
): Promise<void> {
  await integrationsService.setCredential(organizationId, integrationId, {
    kind: "client_id",
    value: clientId,
  });
  await integrationsService.setCredential(organizationId, integrationId, {
    kind: "client_secret",
    value: clientSecret,
  });
}

async function loadOAuthClient(
  organizationId: string, integrationId: string,
): Promise<{ clientId: string; clientSecret: string } | null> {
  const rows = await prisma.integrationCredential.findMany({
    where: { integrationId, kind: { in: ["client_id", "client_secret"] } },
  });
  let clientId = ""; let clientSecret = "";
  for (const row of rows) {
    const value = decryptCredential(
      row.ciphertext, organizationId, integrationId, row.kind, row.keyContext,
    );
    if (row.kind === "client_id") clientId = value;
    if (row.kind === "client_secret") clientSecret = value;
  }
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// ── Routes ────────────────────────────────────────────────────────────────

export async function integrationsRoutes(app: FastifyInstance): Promise<void> {
  // ── Catalog ─────────────────────────────────────────────────────────────

  app.get("/integrations/manifests", async () => {
    return { manifests: integrationsService.listAvailableManifests() };
  });

  // ── Manifest authoring helpers ─────────────────────────────────────────

  app.post("/integrations/manifests/from-openapi", async (request, reply) => {
    const body = request.body as { spec?: unknown; specUrl?: string; manifestId?: string; vendor?: string; baseUrlOverride?: string };
    let spec: unknown;
    if (body.specUrl) {
      try {
        const res = await fetch(body.specUrl);
        if (!res.ok) return reply.code(400).send({ error: `Failed to fetch spec: ${res.status}` });
        const text = await res.text();
        try { spec = JSON.parse(text); }
        catch { return reply.code(400).send({ error: "specUrl did not return JSON" }); }
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    } else if (body.spec) {
      spec = body.spec;
    } else {
      return reply.code(400).send({ error: "Provide spec or specUrl" });
    }
    try {
      const manifest = openapiToManifest(spec as never, {
        manifestId: body.manifestId,
        vendor: body.vendor,
        baseUrlOverride: body.baseUrlOverride,
      });
      return { manifest };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get<{ Params: { manifestId: string } }>(
    "/integrations/manifests/:manifestId",
    async (request, reply) => {
      const m = integrationsService.getManifest(request.params.manifestId);
      if (!m) return reply.code(404).send({ error: "Manifest not found" });
      return m;
    },
  );

  // ── Installed integrations ──────────────────────────────────────────────

  app.get("/integrations", async (request) => {
    const orgId = request.user!.organizationId!;
    return { integrations: await integrationsService.list(orgId) };
  });

  app.get<{ Params: { id: string } }>("/integrations/:id", async (request, reply) => {
    const orgId = request.user!.organizationId!;
    const got = await integrationsService.get(orgId, request.params.id);
    if (!got) return reply.code(404).send({ error: "Integration not found" });

    // Mask secrets — only emit credential KIND list, never values.
    return {
      integration: got.integration,
      manifest: got.manifest,
      credentials: got.credentialKinds.map((kind) => ({ kind, masked: "********" })),
      webhookUrl: webhookPublicUrl(request.protocol, request.hostname, got.integration!.id),
    };
  });

  app.post("/integrations", async (request, reply) => {
    const parsed = installSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const orgId = request.user!.organizationId!;
    try {
      const created = await integrationsService.install(orgId, parsed.data, {
        id: request.user!.id,
        name: request.user!.name,
      });
      reply.code(201);
      return created;
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.patch<{ Params: { id: string } }>("/integrations/:id", async (request, reply) => {
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const orgId = request.user!.organizationId!;
    try {
      return await integrationsService.update(orgId, request.params.id, parsed.data);
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  app.delete<{ Params: { id: string } }>("/integrations/:id", async (request, reply) => {
    const orgId = request.user!.organizationId!;
    try {
      await integrationsService.uninstall(orgId, request.params.id);
      return { deleted: true };
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  // ── Credentials ─────────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>("/integrations/:id/credentials", async (request, reply) => {
    const parsed = setCredentialSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const orgId = request.user!.organizationId!;
    try {
      await integrationsService.setCredential(orgId, request.params.id, {
        kind: parsed.data.kind,
        value: parsed.data.value,
        meta: parsed.data.meta,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
        refreshAfter: parsed.data.refreshAfter ? new Date(parsed.data.refreshAfter) : null,
      });
      return { ok: true, masked: maskSecret(parsed.data.value) };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.delete<{ Params: { id: string; kind: string } }>(
    "/integrations/:id/credentials/:kind",
    async (request, reply) => {
      const orgId = request.user!.organizationId!;
      try {
        await integrationsService.deleteCredential(orgId, request.params.id, request.params.kind);
        return { deleted: true };
      } catch (e) {
        return reply.code(404).send({ error: (e as Error).message });
      }
    },
  );

  // ── Test connection ─────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>("/integrations/:id/test", async (request, reply) => {
    const orgId = request.user!.organizationId!;
    try {
      return await integrationsService.test(orgId, request.params.id);
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  // ── Action invocation ───────────────────────────────────────────────────

  app.post<{ Params: { id: string; actionId: string } }>(
    "/integrations/:id/actions/:actionId",
    async (request, reply) => {
      const parsed = invokeSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const orgId = request.user!.organizationId!;
      try {
        const result = await integrationsService.invokeAction(orgId, request.params.id, {
          actionId: request.params.actionId,
          input: parsed.data.input,
          invokedBy: "user",
          userId: request.user!.id,
          idempotencyKey: parsed.data.idempotencyKey ?? null,
        });
        if (!result.success) reply.code(502);
        return result;
      } catch (e) {
        return reply.code(404).send({ error: (e as Error).message });
      }
    },
  );

  // ── Sync resources ─────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>("/integrations/:id/syncs", async (request, reply) => {
    const orgId = request.user!.organizationId!;
    const got = await integrationsService.get(orgId, request.params.id);
    if (!got) return reply.code(404).send({ error: "Integration not found" });
    const { prisma } = await import("@bidwright/db");
    const states = await prisma.integrationSyncState.findMany({ where: { integrationId: request.params.id } });
    const map = new Map(states.map((s) => [s.resourceId, s] as const));
    return {
      syncs: got.manifest.capabilities.syncs.map((s) => ({
        ...s,
        state: map.get(s.id) ?? null,
      })),
    };
  });

  app.post<{ Params: { id: string; resourceId: string } }>(
    "/integrations/:id/syncs/:resourceId/run",
    async (request, reply) => {
      const orgId = request.user!.organizationId!;
      const got = await integrationsService.get(orgId, request.params.id);
      if (!got) return reply.code(404).send({ error: "Integration not found" });
      try {
        return await runSyncNow(request.params.id, request.params.resourceId);
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    },
  );

  // ── Activity log + runs ─────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>("/integrations/:id/events", async (request, reply) => {
    const orgId = request.user!.organizationId!;
    try {
      return { events: await integrationsService.listEvents(orgId, request.params.id) };
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>("/integrations/:id/runs", async (request, reply) => {
    const orgId = request.user!.organizationId!;
    try {
      return { runs: await integrationsService.listRuns(orgId, request.params.id) };
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  // ── OAuth dance ─────────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>("/integrations/:id/oauth/begin", async (request, reply) => {
    const parsed = oauthBeginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const orgId = request.user!.organizationId!;
    const got = await integrationsService.get(orgId, request.params.id);
    if (!got) return reply.code(404).send({ error: "Integration not found" });
    if (got.manifest.connection.auth.type !== "oauth2") {
      return reply.code(400).send({ error: "Integration is not OAuth2" });
    }
    await persistOAuthClient(orgId, request.params.id, parsed.data.clientId, parsed.data.clientSecret);
    const { url, state } = integrationsService.beginOAuth(
      orgId, request.params.id, got.manifest, parsed.data.clientId, parsed.data.redirectUri,
    );
    return { url, state };
  });

  // Callback authenticates via the opaque `state` token minted at begin
  // (not the cookie session). It is registered under `/auth/...` so that
  // the auth middleware's PUBLIC_PREFIXES whitelist lets it through.
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/integrations/oauth/callback",
    async (request, reply) => {
      const { code, state, error } = request.query;
      if (error) {
        return reply.type("text/html").send(oauthErrorHtml(error));
      }
      if (!code || !state) {
        return reply.code(400).send("Missing code or state");
      }
      try {
        const peek = integrationsService.peekOAuthState(state);
        if (!peek) return reply.code(400).send("Invalid or expired state");
        const client = await loadOAuthClient(peek.organizationId, peek.integrationId);
        if (!client) return reply.code(400).send("OAuth client credentials missing");
        const result = await integrationsService.completeOAuth({
          state,
          code,
          clientId: client.clientId,
          clientSecret: client.clientSecret,
        });
        return reply.type("text/html").send(oauthSuccessHtml(result.integrationId));
      } catch (e) {
        return reply.type("text/html").send(oauthErrorHtml((e as Error).message));
      }
    },
  );
}

// ── Webhook public URL helper ─────────────────────────────────────────────

function webhookPublicUrl(protocol: string, host: string, integrationId: string): string {
  return `${protocol}://${host}/api/webhooks/${integrationId}/event`;
}

// ── HTML responses for OAuth callback ─────────────────────────────────────

function oauthSuccessHtml(integrationId: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Connected</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 16px;color:#111}
h1{color:#16a34a}</style></head>
<body><h1>Connected ✓</h1>
<p>This integration is now connected. You can close this window.</p>
<script>
try {
  if (window.opener) {
    window.opener.postMessage({ type: 'bidwright:integration:connected', integrationId: ${JSON.stringify(integrationId)} }, '*');
    setTimeout(() => window.close(), 800);
  }
} catch (e) {}
</script></body></html>`;
}

function oauthErrorHtml(msg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Connect failed</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 16px;color:#111}
h1{color:#dc2626}</style></head>
<body><h1>Connect failed</h1>
<p>${escapeHtml(msg)}</p>
<p>You can close this window and retry from Bidwright.</p></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
