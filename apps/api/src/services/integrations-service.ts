import {
  builtinManifests,
  findBuiltinManifest,
  parseManifest,
  safeParseManifest,
  encryptCredential,
  decryptCredential,
  buildKeyContext,
  runAction,
  testConnection,
  buildAuthUrl,
  generateState,
  exchangeAuthorizationCode,
  refreshAccessToken,
  type IntegrationManifestParsed,
  type ManifestAction,
  type RunActionOutput,
  type TestConnectionOutput,
  type OAuth2Tokens,
} from "@bidwright/integrations";
import { prisma } from "@bidwright/db";

/**
 * IntegrationsService — owns all DB access for the integration framework.
 *
 * Tenancy invariant: every public method requires (or filters by) an
 * organizationId. The encrypted credentials are tenant-scoped via HKDF, so
 * even a programming error that leaked a row outside its org could not
 * decrypt under another tenant's derived key.
 */

export interface CreateIntegrationInput {
  manifestId: string;
  manifestSource?: "builtin" | "community" | "custom";
  customManifest?: unknown; // for source="custom" — full manifest JSON
  slug?: string; // defaults to manifestId; must be unique per-org
  displayName?: string;
  description?: string;
  config?: Record<string, unknown>;
  exposeToAgent?: boolean;
  exposeToMcp?: boolean;
}

export interface UpdateIntegrationInput {
  enabled?: boolean;
  displayName?: string;
  description?: string;
  config?: Record<string, unknown>;
  exposeToAgent?: boolean;
  exposeToMcp?: boolean;
  status?: string;
  lastError?: string | null;
}

export interface SetCredentialInput {
  kind: string;
  value: string;
  meta?: Record<string, unknown>;
  expiresAt?: Date | null;
  refreshAfter?: Date | null;
}

export interface InvokeActionInput {
  actionId: string;
  input: Record<string, unknown>;
  invokedBy?: "user" | "agent" | "sync" | "webhook" | "system";
  agentSessionId?: string | null;
  userId?: string | null;
  idempotencyKey?: string | null;
}

export interface IntegrationSummary {
  id: string;
  manifestId: string;
  manifestVersion: string;
  manifestSource: string;
  slug: string;
  displayName: string;
  description: string;
  category: string;
  icon: string | null;
  status: string;
  enabled: boolean;
  lastError: string | null;
  lastTestedAt: Date | null;
  lastConnectedAt: Date | null;
  exposeToAgent: boolean;
  exposeToMcp: boolean;
  capabilities: { actions: number; triggers: number; syncs: number };
  createdAt: Date;
  updatedAt: Date;
}

// ── Manifest resolution ───────────────────────────────────────────────────

/**
 * Load the manifest currently in effect for an Integration row. Always
 * uses the snapshot frozen at install time so manifest authors cannot
 * change running connections out from under the user.
 */
function manifestFromSnapshot(snapshot: unknown): IntegrationManifestParsed {
  // Trust-but-verify: snapshots persisted by us were validated at install,
  // but reparsing keeps the runtime honest.
  return parseManifest(snapshot);
}

// ── Credential decryption ─────────────────────────────────────────────────

async function loadCredentials(
  organizationId: string,
  integrationId: string,
): Promise<Record<string, string>> {
  const rows = await prisma.integrationCredential.findMany({ where: { integrationId } });
  const out: Record<string, string> = {};
  for (const row of rows) {
    try {
      out[row.kind] = decryptCredential(
        row.ciphertext,
        organizationId,
        integrationId,
        row.kind,
        row.keyContext,
      );
    } catch {
      // Bad credential row — skip; runner will report missing_credential.
    }
  }
  return out;
}

// ── Status transitions ────────────────────────────────────────────────────

async function setStatus(
  integrationId: string,
  status: string,
  fields: { lastError?: string | null; lastConnectedAt?: Date | null; lastTestedAt?: Date | null } = {},
): Promise<void> {
  await prisma.integration.update({
    where: { id: integrationId },
    data: {
      status,
      ...(fields.lastError !== undefined ? { lastError: fields.lastError } : {}),
      ...(fields.lastConnectedAt !== undefined ? { lastConnectedAt: fields.lastConnectedAt } : {}),
      ...(fields.lastTestedAt !== undefined ? { lastTestedAt: fields.lastTestedAt } : {}),
    },
  });
}

// ── OAuth state cache ─────────────────────────────────────────────────────
// In-memory map from `state` to { integrationId, codeVerifier, redirectUri }.
// State entries expire after 15 minutes. Survives single-process; for
// multi-process deployments behind a shared LB this should move to Redis.

interface OAuthStateEntry {
  integrationId: string;
  organizationId: string;
  codeVerifier?: string;
  redirectUri: string;
  createdAt: number;
}

const oauthStates = new Map<string, OAuthStateEntry>();
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

function reapOauthStates(): void {
  const now = Date.now();
  for (const [k, v] of oauthStates) {
    if (now - v.createdAt > OAUTH_STATE_TTL_MS) oauthStates.delete(k);
  }
}

// ── Service ───────────────────────────────────────────────────────────────

export const integrationsService = {
  // ── Manifest catalog ────────────────────────────────────────────────────

  listAvailableManifests(): Array<{
    id: string; name: string; description: string; category: string;
    vendor: string; icon?: string; tags: string[]; version: string;
    authType: string; capabilities: { actions: number; triggers: number; syncs: number };
    source: "builtin";
  }> {
    return builtinManifests.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      category: m.category,
      vendor: m.vendor,
      icon: m.icon,
      tags: m.tags,
      version: m.version,
      authType: m.connection.auth.type,
      capabilities: {
        actions: m.capabilities.actions.length,
        triggers: m.capabilities.triggers.length,
        syncs: m.capabilities.syncs.length,
      },
      source: "builtin" as const,
    }));
  },

  getManifest(manifestId: string): IntegrationManifestParsed | undefined {
    return findBuiltinManifest(manifestId);
  },

  // ── Installed integrations ──────────────────────────────────────────────

  async list(organizationId: string): Promise<IntegrationSummary[]> {
    const rows = await prisma.integration.findMany({
      where: { organizationId },
      orderBy: [{ enabled: "desc" }, { displayName: "asc" }],
    });
    return rows.map((row): IntegrationSummary => {
      const snapshot = manifestFromSnapshot(row.manifestSnapshot);
      return {
        id: row.id,
        manifestId: row.manifestId,
        manifestVersion: row.manifestVersion,
        manifestSource: row.manifestSource,
        slug: row.slug,
        displayName: row.displayName,
        description: row.description,
        category: row.category,
        icon: row.icon,
        status: row.status,
        enabled: row.enabled,
        lastError: row.lastError,
        lastTestedAt: row.lastTestedAt,
        lastConnectedAt: row.lastConnectedAt,
        exposeToAgent: row.exposeToAgent,
        exposeToMcp: row.exposeToMcp,
        capabilities: {
          actions: snapshot.capabilities.actions.length,
          triggers: snapshot.capabilities.triggers.length,
          syncs: snapshot.capabilities.syncs.length,
        },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  },

  async get(organizationId: string, id: string): Promise<{
    integration: Awaited<ReturnType<typeof prisma.integration.findFirst>>;
    manifest: IntegrationManifestParsed;
    credentialKinds: string[];
  } | null> {
    const row = await prisma.integration.findFirst({ where: { id, organizationId } });
    if (!row) return null;
    const credentials = await prisma.integrationCredential.findMany({
      where: { integrationId: id },
      select: { kind: true },
    });
    return {
      integration: row,
      manifest: manifestFromSnapshot(row.manifestSnapshot),
      credentialKinds: credentials.map((c) => c.kind),
    };
  },

  async install(
    organizationId: string,
    input: CreateIntegrationInput,
    actor?: { id: string; name: string },
  ): Promise<IntegrationSummary> {
    // 1. Resolve manifest
    let manifest: IntegrationManifestParsed;
    const source = input.manifestSource ?? "builtin";
    if (source === "builtin") {
      const m = findBuiltinManifest(input.manifestId);
      if (!m) throw new Error(`Manifest not found: ${input.manifestId}`);
      manifest = m;
    } else if (source === "custom") {
      const parsed = safeParseManifest(input.customManifest);
      if (!parsed.ok) throw new Error(`Invalid manifest: ${parsed.error.message}`);
      manifest = parsed.manifest;
    } else {
      throw new Error(`Unsupported manifest source: ${source}`);
    }
    // Strip non-JSON-serializable values for safe Prisma JSON storage.
    const manifestForStorage = JSON.parse(JSON.stringify(manifest)) as object;

    // 2. Compute slug — uniqueness enforced by DB unique index
    const slug = (input.slug ?? manifest.id)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");

    // 3. Insert
    const created = await prisma.integration.create({
      data: {
        organizationId,
        manifestId: manifest.id,
        manifestVersion: manifest.version,
        manifestSource: source,
        manifestSnapshot: manifestForStorage,
        slug,
        displayName: input.displayName ?? manifest.name,
        description: input.description ?? manifest.description,
        icon: manifest.icon ?? null,
        category: manifest.category,
        config: (input.config ?? {}) as object,
        exposeToAgent: input.exposeToAgent ?? true,
        exposeToMcp: input.exposeToMcp ?? true,
        status: manifest.connection.auth.type === "none" ? "connected" : "needs_auth",
        createdBy: actor?.id ?? null,
      },
    });

    return {
      id: created.id,
      manifestId: created.manifestId,
      manifestVersion: created.manifestVersion,
      manifestSource: created.manifestSource,
      slug: created.slug,
      displayName: created.displayName,
      description: created.description,
      category: created.category,
      icon: created.icon,
      status: created.status,
      enabled: created.enabled,
      lastError: created.lastError,
      lastTestedAt: created.lastTestedAt,
      lastConnectedAt: created.lastConnectedAt,
      exposeToAgent: created.exposeToAgent,
      exposeToMcp: created.exposeToMcp,
      capabilities: {
        actions: manifest.capabilities.actions.length,
        triggers: manifest.capabilities.triggers.length,
        syncs: manifest.capabilities.syncs.length,
      },
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  },

  async update(organizationId: string, id: string, patch: UpdateIntegrationInput) {
    const existing = await prisma.integration.findFirst({ where: { id, organizationId } });
    if (!existing) throw new Error("Integration not found");
    return prisma.integration.update({
      where: { id },
      data: {
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.config !== undefined ? { config: patch.config as object } : {}),
        ...(patch.exposeToAgent !== undefined ? { exposeToAgent: patch.exposeToAgent } : {}),
        ...(patch.exposeToMcp !== undefined ? { exposeToMcp: patch.exposeToMcp } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
      },
    });
  },

  async uninstall(organizationId: string, id: string): Promise<void> {
    const existing = await prisma.integration.findFirst({ where: { id, organizationId } });
    if (!existing) throw new Error("Integration not found");
    await prisma.integration.delete({ where: { id } });
  },

  // ── Credentials ─────────────────────────────────────────────────────────

  async setCredential(
    organizationId: string,
    integrationId: string,
    input: SetCredentialInput,
  ): Promise<void> {
    const existing = await prisma.integration.findFirst({ where: { id: integrationId, organizationId } });
    if (!existing) throw new Error("Integration not found");
    const { ciphertext, keyContext } = encryptCredential(
      input.value, organizationId, integrationId, input.kind,
    );
    await prisma.integrationCredential.upsert({
      where: { integrationId_kind: { integrationId, kind: input.kind } },
      update: {
        ciphertext, keyContext,
        meta: (input.meta ?? {}) as object,
        expiresAt: input.expiresAt ?? null,
        refreshAfter: input.refreshAfter ?? null,
        rotatedAt: new Date(),
      },
      create: {
        integrationId,
        kind: input.kind,
        ciphertext, keyContext,
        meta: (input.meta ?? {}) as object,
        expiresAt: input.expiresAt ?? null,
        refreshAfter: input.refreshAfter ?? null,
      },
    });
    // Once any credential is set, we can move from needs_auth → connected
    // (the test endpoint or first action will refine status further).
    if (existing.status === "needs_auth") {
      await setStatus(integrationId, "connected", { lastConnectedAt: new Date(), lastError: null });
    }
  },

  async deleteCredential(
    organizationId: string,
    integrationId: string,
    kind: string,
  ): Promise<void> {
    const existing = await prisma.integration.findFirst({ where: { id: integrationId, organizationId } });
    if (!existing) throw new Error("Integration not found");
    await prisma.integrationCredential
      .delete({ where: { integrationId_kind: { integrationId, kind } } })
      .catch(() => undefined);
  },

  // ── Connection test ─────────────────────────────────────────────────────

  async test(organizationId: string, integrationId: string): Promise<TestConnectionOutput> {
    const got = await this.get(organizationId, integrationId);
    if (!got) throw new Error("Integration not found");
    const credentials = await loadCredentials(organizationId, integrationId);
    const result = await testConnection({
      manifest: got.manifest,
      config: (got.integration!.config as Record<string, unknown>) ?? {},
      credentials,
    });
    await setStatus(
      integrationId,
      result.success ? "connected" : "error",
      {
        lastTestedAt: new Date(),
        lastError: result.success ? null : result.message,
        ...(result.success ? { lastConnectedAt: new Date() } : {}),
      },
    );
    return result;
  },

  // ── Action invocation ───────────────────────────────────────────────────

  async invokeAction(
    organizationId: string,
    integrationId: string,
    input: InvokeActionInput,
  ): Promise<RunActionOutput & { runId: string }> {
    const got = await this.get(organizationId, integrationId);
    if (!got) throw new Error("Integration not found");
    if (!got.integration!.enabled) {
      const start = Date.now();
      return {
        runId: "",
        success: false,
        error: "Integration is disabled.",
        durationMs: Date.now() - start,
        attempts: 0,
      };
    }

    const action: ManifestAction | undefined = got.manifest.capabilities.actions.find(
      (a) => a.id === input.actionId,
    );
    if (!action) throw new Error(`Action not found: ${input.actionId}`);

    // Idempotency — if a key is provided and we already have a successful run, return it.
    if (input.idempotencyKey) {
      const prior = await prisma.integrationRun.findUnique({
        where: { integrationId_idempotencyKey: { integrationId, idempotencyKey: input.idempotencyKey } },
      });
      if (prior && prior.status === "success") {
        return {
          runId: prior.id,
          success: true,
          output: prior.output as unknown,
          httpStatus: prior.httpStatus ?? undefined,
          durationMs: prior.durationMs ?? 0,
          attempts: 0,
        };
      }
    }

    const credentials = await loadCredentials(organizationId, integrationId);

    // Persist a pending run row first so failures still leave a trace.
    const run = await prisma.integrationRun.create({
      data: {
        integrationId,
        actionId: action.id,
        status: "running",
        invokedBy: input.invokedBy ?? "user",
        agentSessionId: input.agentSessionId ?? null,
        userId: input.userId ?? null,
        input: input.input as object,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });

    const result = await runAction({
      manifest: got.manifest,
      action,
      config: (got.integration!.config as Record<string, unknown>) ?? {},
      credentials,
      input: input.input,
    });

    await prisma.integrationRun.update({
      where: { id: run.id },
      data: {
        status: result.success ? "success" : "error",
        output: (result.output as object) ?? undefined,
        error: result.error ?? null,
        httpStatus: result.httpStatus ?? null,
        durationMs: result.durationMs,
        completedAt: new Date(),
      },
    });

    if (!result.success) {
      await setStatus(integrationId, "error", { lastError: result.error ?? null });
    } else if (got.integration!.status === "error") {
      await setStatus(integrationId, "connected", { lastError: null, lastConnectedAt: new Date() });
    }

    // Mirror to events for the activity log.
    await prisma.integrationEvent.create({
      data: {
        integrationId,
        direction: "outbound",
        type: `action.${action.id}`,
        status: result.success ? "delivered" : "failed",
        payload: { input: input.input, output: result.output ?? null } as object,
        headers: {},
        lastError: result.error ?? null,
      },
    });

    return { ...result, runId: run.id };
  },

  // ── OAuth ───────────────────────────────────────────────────────────────

  /**
   * Read-only lookup of an OAuth state's integration / org binding. Used
   * by the unauthenticated callback route to find the right tenant before
   * exchanging the code. Does NOT consume the state.
   */
  peekOAuthState(state: string): { integrationId: string; organizationId: string } | null {
    reapOauthStates();
    const entry = oauthStates.get(state);
    if (!entry) return null;
    return { integrationId: entry.integrationId, organizationId: entry.organizationId };
  },

  beginOAuth(
    organizationId: string,
    integrationId: string,
    manifest: IntegrationManifestParsed,
    clientId: string,
    redirectUri: string,
  ): { url: string; state: string } {
    if (manifest.connection.auth.type !== "oauth2") {
      throw new Error("Integration is not OAuth2");
    }
    reapOauthStates();
    const state = generateState();
    const result = buildAuthUrl({
      manifest,
      clientId,
      redirectUri,
      state,
      scopes: manifest.connection.auth.scopes,
      pkce: manifest.connection.auth.pkce,
    });
    oauthStates.set(state, {
      integrationId,
      organizationId,
      codeVerifier: result.codeVerifier,
      redirectUri,
      createdAt: Date.now(),
    });
    return { url: result.url, state };
  },

  /**
   * Complete an OAuth2 authorization-code exchange and persist the resulting
   * tokens as encrypted credentials. Returns the integration row's new
   * `status` so the caller can redirect appropriately.
   */
  async completeOAuth(input: {
    state: string;
    code: string;
    clientId: string;
    clientSecret: string;
  }): Promise<{ integrationId: string; organizationId: string; status: string }> {
    reapOauthStates();
    const entry = oauthStates.get(input.state);
    if (!entry) throw new Error("Invalid or expired OAuth state.");
    oauthStates.delete(input.state);

    const got = await this.get(entry.organizationId, entry.integrationId);
    if (!got) throw new Error("Integration not found");

    const tokens: OAuth2Tokens = await exchangeAuthorizationCode({
      manifest: got.manifest,
      client: { clientId: input.clientId, clientSecret: input.clientSecret },
      redirectUri: entry.redirectUri,
      code: input.code,
      codeVerifier: entry.codeVerifier,
    });

    await this.setCredential(entry.organizationId, entry.integrationId, {
      kind: "oauth_access_token",
      value: tokens.accessToken,
      meta: { tokenType: tokens.tokenType, scope: tokens.scope ?? "" },
      expiresAt: tokens.expiresAt ?? null,
      refreshAfter: tokens.expiresAt ?? null,
    });

    if (tokens.refreshToken) {
      await this.setCredential(entry.organizationId, entry.integrationId, {
        kind: "oauth_refresh_token",
        value: tokens.refreshToken,
      });
    }

    await prisma.integration.update({
      where: { id: entry.integrationId },
      data: {
        status: "connected",
        lastConnectedAt: new Date(),
        lastError: null,
        scopes: tokens.scope ? tokens.scope.split(/[\s,]+/).filter(Boolean) : [],
      },
    });

    return {
      integrationId: entry.integrationId,
      organizationId: entry.organizationId,
      status: "connected",
    };
  },

  /**
   * Refresh an OAuth2 access token before it expires. Called lazily from the
   * action runner via `ensureFreshAccessToken` and on a schedule by the worker.
   */
  async refreshOAuthToken(input: {
    organizationId: string;
    integrationId: string;
    clientId: string;
    clientSecret: string;
  }): Promise<{ refreshed: boolean; expiresAt: Date | null }> {
    const got = await this.get(input.organizationId, input.integrationId);
    if (!got) throw new Error("Integration not found");
    if (got.manifest.connection.auth.type !== "oauth2") {
      return { refreshed: false, expiresAt: null };
    }

    const refreshRow = await prisma.integrationCredential.findUnique({
      where: { integrationId_kind: { integrationId: input.integrationId, kind: "oauth_refresh_token" } },
    });
    if (!refreshRow) return { refreshed: false, expiresAt: null };
    const refreshToken = decryptCredential(
      refreshRow.ciphertext, input.organizationId, input.integrationId, "oauth_refresh_token", refreshRow.keyContext,
    );

    const tokens = await refreshAccessToken({
      manifest: got.manifest,
      client: { clientId: input.clientId, clientSecret: input.clientSecret },
      refreshToken,
    });

    await this.setCredential(input.organizationId, input.integrationId, {
      kind: "oauth_access_token",
      value: tokens.accessToken,
      meta: { tokenType: tokens.tokenType, scope: tokens.scope ?? "" },
      expiresAt: tokens.expiresAt ?? null,
      refreshAfter: tokens.expiresAt ?? null,
    });
    if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
      await this.setCredential(input.organizationId, input.integrationId, {
        kind: "oauth_refresh_token",
        value: tokens.refreshToken,
      });
    }
    return { refreshed: true, expiresAt: tokens.expiresAt ?? null };
  },

  // ── Activity log ────────────────────────────────────────────────────────

  async listEvents(organizationId: string, integrationId: string, limit = 100) {
    const integration = await prisma.integration.findFirst({ where: { id: integrationId, organizationId } });
    if (!integration) throw new Error("Integration not found");
    return prisma.integrationEvent.findMany({
      where: { integrationId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 500),
    });
  },

  async listRuns(organizationId: string, integrationId: string, limit = 100) {
    const integration = await prisma.integration.findFirst({ where: { id: integrationId, organizationId } });
    if (!integration) throw new Error("Integration not found");
    return prisma.integrationRun.findMany({
      where: { integrationId },
      orderBy: { startedAt: "desc" },
      take: Math.min(limit, 500),
    });
  },

  // ── Agent / MCP tool surface ────────────────────────────────────────────

  /**
   * Return all `(integration, action)` pairs an agent or MCP server should
   * surface. Used by the agent registrar and the MCP integration registrar.
   */
  async listExposedActions(
    organizationId: string,
    surface: "agent" | "mcp",
  ): Promise<Array<{
    integrationId: string;
    slug: string;
    displayName: string;
    manifest: IntegrationManifestParsed;
    action: ManifestAction;
  }>> {
    const filter: Record<string, unknown> = {
      organizationId,
      enabled: true,
      ...(surface === "agent" ? { exposeToAgent: true } : { exposeToMcp: true }),
    };
    const rows = await prisma.integration.findMany({ where: filter });
    const out: Array<{
      integrationId: string; slug: string; displayName: string;
      manifest: IntegrationManifestParsed; action: ManifestAction;
    }> = [];
    for (const row of rows) {
      const manifest = manifestFromSnapshot(row.manifestSnapshot);
      for (const action of manifest.capabilities.actions) {
        out.push({
          integrationId: row.id,
          slug: row.slug,
          displayName: row.displayName,
          manifest,
          action,
        });
      }
    }
    return out;
  },
};

export type IntegrationsService = typeof integrationsService;
