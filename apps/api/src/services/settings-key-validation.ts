import { createContextualSealer } from "@appkit/crypto";

import { readIntegrationsEncryptionKey } from "./settings-secret-crypto.js";

const PROBE_HKDF_INFO = "bidwright:settings:key-probe:v1";
const PROBE_PLAINTEXT = "bidwright-integrations-key-probe:v1";
const PROBE_CONTEXT = {
  salt: "bidwright-integrations-key-probe:v1",
  additionalData: "bidwright:integrations-encryption-key:probe:v1",
};

export function createIntegrationsEncryptionKeyProbe(encodedKey: string): string {
  const sealer = createContextualSealer(readIntegrationsEncryptionKey(encodedKey), {
    hkdfInfo: PROBE_HKDF_INFO,
  });
  return sealer.sealSecret(PROBE_PLAINTEXT, PROBE_CONTEXT);
}

/**
 * Validate the configured key without consulting tenant-owned data. A probe is
 * optional for self-hosted/local installs, but production deployment supplies
 * one created with the established key so a different valid key is rejected.
 */
export function validateIntegrationsEncryptionKey(
  encodedKey = process.env.INTEGRATIONS_ENCRYPTION_KEY,
  probe = process.env.INTEGRATIONS_ENCRYPTION_KEY_PROBE,
): { probeVerified: boolean } {
  const masterKey = readIntegrationsEncryptionKey(encodedKey);
  if (!probe) {
    if ((process.env.BIDWRIGHT_MODE || "").trim().toLowerCase() === "server") {
      throw new Error(
        "INTEGRATIONS_ENCRYPTION_KEY_PROBE is required in Bidwright server mode.",
      );
    }
    return { probeVerified: false };
  }

  const plaintext = createContextualSealer(masterKey, {
    hkdfInfo: PROBE_HKDF_INFO,
  }).unsealSecret(probe, PROBE_CONTEXT);
  if (plaintext !== PROBE_PLAINTEXT) {
    throw new Error(
      "INTEGRATIONS_ENCRYPTION_KEY does not match INTEGRATIONS_ENCRYPTION_KEY_PROBE.",
    );
  }
  return { probeVerified: true };
}
