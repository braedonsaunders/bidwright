import { createContextualSealer } from "@braedonsaunders/appkit-crypto";

const ENVELOPE_MARKER = "appkit.contextual-secret.v1";
const HKDF_INFO = "bidwright:settings:secret:v1";
const KEY_BYTES = 32;
const SECRET_FIELD_NAMES = new Set([
  "accessToken", "apiKey", "anthropicKey", "autodeskClientSecret", "azureDiKey",
  "clientSecret", "geminiApiKey", "geminiKey",
  "oauth2ClientSecret", "openaiKey", "openrouterKey", "password",
  "refreshToken", "smtpPassword",
]);

type SealedEnvelope = { __sealedSecret: typeof ENVELOPE_MARKER; ciphertext: string };

export interface SettingsSecretScope {
  kind: "organization" | "user" | "super-admin";
  id: string;
  tenantId?: string;
}

export function sealSettingsSecrets<T>(value: T, scope: SettingsSecretScope): T {
  return transform(value, scope, [], "seal") as T;
}

export function unsealSettingsSecrets<T>(value: T, scope: SettingsSecretScope): T {
  return transform(value, scope, [], "unseal") as T;
}

function transform(value: unknown, scope: SettingsSecretScope, path: string[], operation: "seal" | "unseal"): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => transform(entry, scope, [...path, String(index)], operation));
  }
  if (!value || typeof value !== "object") return value;
  if (isEnvelope(value)) {
    if (operation === "seal") throw new Error("Pre-sealed settings credential envelopes are not accepted.");
    const plaintext = sealer().unsealSecret(value.ciphertext, context(scope, path));
    if (plaintext === null) throw new Error(`Unable to unseal settings credential at ${path.join(".") || "<root>"}.`);
    return plaintext;
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const entryPath = [...path, key];
    if (operation === "seal" && SECRET_FIELD_NAMES.has(key) && typeof entry === "string" && entry.length > 0) {
      result[key] = {
        __sealedSecret: ENVELOPE_MARKER,
        ciphertext: sealer().sealSecret(entry, context(scope, entryPath)),
      } satisfies SealedEnvelope;
    } else {
      result[key] = transform(entry, scope, entryPath, operation);
    }
  }
  return result;
}

function context(scope: SettingsSecretScope, path: string[]) {
  return {
    salt: scope.tenantId || scope.id,
    additionalData: `${scope.kind}:${scope.id}:${path.join(".")}`,
  };
}

function sealer() {
  return createContextualSealer(readIntegrationsEncryptionKey(), { hkdfInfo: HKDF_INFO });
}

export function readIntegrationsEncryptionKey(encoded = process.env.INTEGRATIONS_ENCRYPTION_KEY): Buffer {
  if (!encoded) throw new Error("INTEGRATIONS_ENCRYPTION_KEY is required to protect settings credentials.");
  const masterKey = Buffer.from(encoded, "base64");
  if (masterKey.length !== KEY_BYTES || masterKey.toString("base64") !== encoded) {
    throw new Error("INTEGRATIONS_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return masterKey;
}

function isEnvelope(value: unknown): value is SealedEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.__sealedSecret === ENVELOPE_MARKER && typeof record.ciphertext === "string";
}
