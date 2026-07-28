import {
  dropInvalidProviderKeys,
  mergeIntegrations,
  prisma,
  unsealSettingsSecrets,
} from "@bidwright/db";
import { resolveTenantAiConfig, type TenantAiConfig } from "@bidwright/agent";

export async function loadTenantAiConfig(
  organizationId: string | undefined,
  userId?: string,
): Promise<TenantAiConfig> {
  if (!organizationId) {
    throw new Error("AI worker job is missing organizationId; tenant credentials cannot be resolved safely.");
  }

  const organizationSettings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { integrations: true },
  });
  const organizationIntegrations = dropInvalidProviderKeys(unsealSettingsSecrets(
    (organizationSettings?.integrations as Record<string, unknown> | null) ?? {},
    { kind: "organization", id: organizationId, tenantId: organizationId },
  ));

  let effectiveIntegrations = organizationIntegrations;
  if (userId) {
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { settings: { select: { integrations: true } } },
    });
    if (user?.settings) {
      const personal = dropInvalidProviderKeys(unsealSettingsSecrets(
        user.settings.integrations as Record<string, unknown>,
        { kind: "user", id: userId, tenantId: organizationId },
      ));
      effectiveIntegrations = mergeIntegrations(organizationIntegrations, personal);
    }
  }

  const config = resolveTenantAiConfig(effectiveIntegrations);
  if (!config) {
    throw new Error("No tenant AI provider is configured in Settings → Integrations → AI Providers.");
  }
  return config;
}
