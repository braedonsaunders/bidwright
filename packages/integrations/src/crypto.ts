import {
  createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual,
} from "node:crypto";

/**
 * Per-tenant credential encryption.
 *
 * Master key comes from the env var `INTEGRATIONS_ENCRYPTION_KEY` — a 32-byte
 * value, base64-encoded. (Generate with `openssl rand -base64 32`.) For each
 * organization we derive a unique data key with HKDF using the organization
 * ID as the salt and a stable label as the info string. This means a leaked
 * row outside its tenant context cannot be decrypted, and rotating the master
 * key while keeping per-tenant data keys is straightforward.
 *
 * Ciphertext layout (all base64-encoded as one string):
 *   version(1) || iv(12) || authTag(16) || ciphertext(...)
 *
 * AAD (additional authenticated data) binds the ciphertext to the credential's
 * `keyContext` (typically `${integrationId}:${kind}`) so a credential row
 * cannot be re-pointed to a different integration to decrypt it under another
 * org.
 */

const ALG = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const VERSION = 0x01;
const HKDF_INFO = "bidwright:integrations:credential:v1";

export interface CryptoEnv {
  /** 32-byte master key, base64. Required in production. */
  masterKey?: string;
}

export class IntegrationCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationCryptoError";
  }
}

function getMasterKey(env: CryptoEnv = {}): Buffer {
  const raw = env.masterKey ?? process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (!raw) {
    throw new IntegrationCryptoError(
      "INTEGRATIONS_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and set it in your environment."
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new IntegrationCryptoError("INTEGRATIONS_ENCRYPTION_KEY is not valid base64.");
  }
  if (key.length !== KEY_LEN) {
    throw new IntegrationCryptoError(
      `INTEGRATIONS_ENCRYPTION_KEY must decode to exactly ${KEY_LEN} bytes (got ${key.length}).`
    );
  }
  return key;
}

/**
 * RFC 5869 HKDF-SHA256, simplified for fixed 32-byte output.
 */
function hkdf(ikm: Buffer, salt: Buffer, info: Buffer): Buffer {
  // Extract
  const prk = createHmac("sha256", salt).update(ikm).digest();
  // Expand (single block for 32-byte output)
  const t1 = createHmac("sha256", prk).update(info).update(Buffer.from([0x01])).digest();
  return t1.subarray(0, KEY_LEN);
}

function deriveTenantKey(orgId: string, env: CryptoEnv = {}): Buffer {
  if (!orgId) throw new IntegrationCryptoError("Organization id required for key derivation.");
  const master = getMasterKey(env);
  return hkdf(master, Buffer.from(orgId, "utf8"), Buffer.from(HKDF_INFO, "utf8"));
}

/**
 * Encrypt a UTF-8 plaintext with the tenant's derived key.
 * `keyContext` is bound as AAD to prevent cross-credential reuse.
 */
export function encryptForOrg(
  plaintext: string,
  orgId: string,
  keyContext: string,
  env: CryptoEnv = {},
): string {
  const key = deriveTenantKey(orgId, env);
  const iv = randomBytes(IV_LEN);
  const aad = Buffer.from(keyContext, "utf8");
  const cipher = createCipheriv(ALG, key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(aad);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, enc]).toString("base64");
}

/**
 * Decrypt a payload produced by `encryptForOrg`. Returns the UTF-8 plaintext.
 * Throws on auth failure, version mismatch, or context mismatch.
 */
export function decryptForOrg(
  payload: string,
  orgId: string,
  keyContext: string,
  env: CryptoEnv = {},
): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < 1 + IV_LEN + TAG_LEN) {
    throw new IntegrationCryptoError("Ciphertext too short.");
  }
  const version = buf[0];
  if (version !== VERSION) {
    throw new IntegrationCryptoError(`Unsupported credential version: ${version}`);
  }
  const iv = buf.subarray(1, 1 + IV_LEN);
  const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const enc = buf.subarray(1 + IV_LEN + TAG_LEN);
  const key = deriveTenantKey(orgId, env);
  const aad = Buffer.from(keyContext, "utf8");
  const decipher = createDecipheriv(ALG, key, iv, { authTagLength: TAG_LEN });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(enc), decipher.final()]);
  return out.toString("utf8");
}

/**
 * Mask a secret for display. Keeps the first 4 and last 4 chars when long
 * enough; otherwise returns "****". Never log raw secrets — use this.
 */
export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length < 12) return "****";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * Constant-time signature comparison for HMAC verification on inbound
 * webhooks. Returns false on length mismatch (safely, no early return).
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/**
 * HMAC signature for outbound and inbound verification.
 */
export function hmacSign(
  algorithm: "sha1" | "sha256" | "sha512",
  secret: string,
  payload: string | Buffer,
  encoding: "hex" | "base64" = "hex",
): string {
  return createHmac(algorithm, secret).update(payload).digest(encoding);
}

/**
 * Verify an inbound HMAC. Strips an optional prefix (e.g. "sha256=") before
 * comparison and uses constant-time equality.
 */
export function hmacVerify(
  algorithm: "sha1" | "sha256" | "sha512",
  secret: string,
  payload: string | Buffer,
  signature: string,
  options: { encoding?: "hex" | "base64"; prefix?: string } = {},
): boolean {
  const encoding = options.encoding ?? "hex";
  const prefix = options.prefix ?? "";
  const stripped = prefix && signature.startsWith(prefix) ? signature.slice(prefix.length) : signature;
  const expected = hmacSign(algorithm, secret, payload, encoding);
  return timingSafeEqualHex(expected, stripped);
}
