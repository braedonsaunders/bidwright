/**
 * Per-user settings routes.
 *
 * The endpoints here are scoped to the *currently authenticated user*: they
 * read and write that user's UserSettings row only. Integration credentials
 * (API keys, OAuth tokens) and personal agent preferences (default runtime
 * / model / reasoning effort) live here, separate from the org-wide
 * OrganizationSettings exposed by `settings-routes.ts`.
 *
 * Resolution at the call site is "user wins where set, org defaults
 * otherwise" — see `PrismaApiStore.getEffectiveIntegrations()` and the
 * `mergeIntegrations()` helper in `@bidwright/db`.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

const integrationsPatchSchema = z.record(z.unknown());
const preferencesPatchSchema = z.record(z.unknown());

const userSettingsPatchSchema = z
  .object({
    integrations: integrationsPatchSchema.optional(),
    preferences: preferencesPatchSchema.optional(),
  })
  .strict();

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get("/user/settings", async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply.code(401).send({ error: "Unauthenticated" });
    }
    if (request.user?.isSuperAdmin) {
      return request.store!.getSuperAdminSettings(userId);
    }
    return request.store!.getUserSettings(userId);
  });

  app.patch("/user/settings", async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply.code(401).send({ error: "Unauthenticated" });
    }
    const parsed = userSettingsPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    if (request.user?.isSuperAdmin) {
      return request.store!.updateSuperAdminSettings(userId, parsed.data);
    }
    return request.store!.updateUserSettings(userId, parsed.data);
  });

  /**
   * Convenience endpoint for the agent / spawn pipeline. Returns the merged
   * integrations blob (org defaults + user overrides) that the spawn
   * pipeline actually uses, so the UI can show "Using: <X>" without having
   * to re-implement the merge logic. Never includes secrets — only flags
   * which provider/runtime resolves where.
   */
  app.get("/user/settings/effective", async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return reply.code(403).send({ error: "Unauthenticated" });

    const orgSettings = await request.store!.getSettings();
    const orgIntegrations = ((orgSettings as any)?.integrations ?? {}) as Record<string, unknown>;
    let userIntegrations: Record<string, unknown> = {};
    try {
      const personal = request.user?.isSuperAdmin
        ? await request.store!.getSuperAdminSettings(userId)
        : await request.store!.getUserSettings(userId);
      userIntegrations = personal.integrations;
    } catch {
      // No personal settings row — fine, just report org-only.
    }

    const fields = [
      { key: "anthropicKey", provider: "anthropic", kind: "api_key" },
      { key: "openaiKey", provider: "openai", kind: "api_key" },
      { key: "geminiKey", provider: "google", kind: "api_key" },
      { key: "openrouterKey", provider: "openrouter", kind: "api_key" },
      { key: "anthropicOauth", provider: "anthropic", kind: "oauth" },
      { key: "openaiOauth", provider: "openai", kind: "oauth" },
      { key: "googleOauth", provider: "google", kind: "oauth" },
    ] as const;

    const sources: Record<string, { source: "user" | "organization" | "none"; kind: "api_key" | "oauth" | null }> = {};
    for (const { key, provider, kind } of fields) {
      const userValue = userIntegrations[key];
      const orgValue = orgIntegrations[key];
      const hasUser = isPresent(userValue);
      const hasOrg = isPresent(orgValue);
      const slot = `${provider}.${kind}`;
      if (sources[slot]) {
        // Already populated by an earlier field for the same slot — keep first.
        continue;
      }
      sources[slot] = {
        source: hasUser ? "user" : hasOrg ? "organization" : "none",
        kind: hasUser || hasOrg ? kind : null,
      };
    }
    return { sources };
  });
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.some(([, v]) => isPresent(v));
  }
  return true;
}
