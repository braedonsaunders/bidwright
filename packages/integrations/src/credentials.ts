import { decryptForOrg, encryptForOrg, type CryptoEnv } from "./crypto.js";

/**
 * Helpers for working with IntegrationCredential rows. The DB layer stays
 * in the API package so this module deals only with raw bytes ↔ plaintext
 * + the keyContext convention.
 *
 *   keyContext = `${integrationId}:${kind}`
 *
 * The context is bound to the ciphertext as AES-GCM AAD so a credential
 * row cannot be moved between integrations and decrypted under another
 * tenant's key.
 */

export function buildKeyContext(integrationId: string, kind: string): string {
  if (!integrationId || !kind) throw new Error("integrationId and kind required");
  return `${integrationId}:${kind}`;
}

export function encryptCredential(
  plaintext: string,
  organizationId: string,
  integrationId: string,
  kind: string,
  env: CryptoEnv = {},
): { ciphertext: string; keyContext: string } {
  const keyContext = buildKeyContext(integrationId, kind);
  const ciphertext = encryptForOrg(plaintext, organizationId, keyContext, env);
  return { ciphertext, keyContext };
}

export function decryptCredential(
  ciphertext: string,
  organizationId: string,
  integrationId: string,
  kind: string,
  expectedKeyContext: string | undefined,
  env: CryptoEnv = {},
): string {
  const keyContext = buildKeyContext(integrationId, kind);
  if (expectedKeyContext && expectedKeyContext !== keyContext) {
    throw new Error("Credential keyContext mismatch — refusing to decrypt.");
  }
  return decryptForOrg(ciphertext, organizationId, keyContext, env);
}
