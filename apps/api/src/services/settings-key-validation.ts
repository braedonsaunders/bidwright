import { unsealSettingsSecrets } from "./settings-secret-crypto.js";

type StoredCredentialRecords = {
  organizations: Array<{
    organizationId: string;
    email: unknown;
    integrations: unknown;
  }>;
  users: Array<{
    userId: string;
    organizationId: string;
    integrations: unknown;
  }>;
  superAdmins: Array<{
    id: string;
    integrations: unknown;
  }>;
};

export function validateStoredSettingsCredentials(
  records: StoredCredentialRecords,
): { checkedRecords: number } {
  try {
    for (const settings of records.organizations) {
      const scope = {
        kind: "organization" as const,
        id: settings.organizationId,
        tenantId: settings.organizationId,
      };
      unsealSettingsSecrets(settings.email, scope);
      unsealSettingsSecrets(settings.integrations, scope);
    }
    for (const settings of records.users) {
      unsealSettingsSecrets(settings.integrations, {
        kind: "user",
        id: settings.userId,
        tenantId: settings.organizationId,
      });
    }
    for (const admin of records.superAdmins) {
      unsealSettingsSecrets(admin.integrations, {
        kind: "super-admin",
        id: admin.id,
      });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "credential decryption failed";
    throw new Error(
      `INTEGRATIONS_ENCRYPTION_KEY does not match stored settings credentials: ${detail}`,
    );
  }

  return {
    checkedRecords:
      records.organizations.length +
      records.users.length +
      records.superAdmins.length,
  };
}
