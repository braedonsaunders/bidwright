import { resolveTenantAiConfig, type TenantAiConfig } from "@bidwright/agent";
import type { FastifyRequest } from "fastify";

/** Resolve the authenticated user's effective, already-unsealed tenant AI settings. */
export async function getRequestAiConfig(request: FastifyRequest): Promise<TenantAiConfig | null> {
  const integrations = await request.store!.getEffectiveIntegrations(request.user?.id, {
    isSuperAdmin: request.user?.isSuperAdmin,
  });
  return resolveTenantAiConfig(integrations);
}

export async function requireRequestAiConfig(request: FastifyRequest): Promise<TenantAiConfig> {
  const config = await getRequestAiConfig(request);
  if (!config) {
    const error = new Error("Configure an AI provider in Settings → Integrations → AI Providers.");
    Object.assign(error, { statusCode: 422 });
    throw error;
  }
  return config;
}
