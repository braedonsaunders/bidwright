import type { ManifestTrigger } from "../manifest/schema.js";
import { hmacVerify, timingSafeEqualHex } from "../crypto.js";
import { evalJsonPathFirst, selectAndMap, type JsonValue } from "./jsonpath.js";

/**
 * Inbound webhook verification + payload normalization.
 *
 * Returns a structured outcome the API layer can persist as an
 * IntegrationEvent and forward to the worker queue.
 */

export interface VerifyWebhookInput {
  trigger: ManifestTrigger;
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  parsedBody: unknown;
  /** Decrypted hmac_secret or shared_secret credential. */
  secret?: string;
}

export interface VerifyWebhookOutput {
  signatureValid: boolean | null;
  externalId: string | null;
  shapedPayload: unknown;
  reason?: string;
}

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

export function verifyWebhook(opts: VerifyWebhookInput): VerifyWebhookOutput {
  const { trigger, headers, rawBody, parsedBody, secret } = opts;

  // Replay protection if the manifest declares a timestamp header.
  if (trigger.timestampHeader) {
    const ts = getHeader(headers, trigger.timestampHeader);
    if (!ts) {
      return { signatureValid: false, externalId: null, shapedPayload: null, reason: "missing_timestamp" };
    }
    const tsNum = Number(ts);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > trigger.maxSkewSeconds) {
      return { signatureValid: false, externalId: null, shapedPayload: null, reason: "timestamp_skew" };
    }
  }

  let signatureValid: boolean | null = null;
  if (trigger.verify === "hmac") {
    if (!secret) return { signatureValid: false, externalId: null, shapedPayload: null, reason: "missing_secret" };
    const sig = getHeader(headers, trigger.signatureHeader);
    if (!sig) return { signatureValid: false, externalId: null, shapedPayload: null, reason: "missing_signature" };
    // Heuristic: Slack and Stripe both prefix with "v1=" / "sha256=" — try
    // common prefixes when the manifest does not specify exactly.
    const candidates = ["", "sha256=", "sha1=", "v0=", "v1="];
    signatureValid = candidates.some((prefix) =>
      hmacVerify("sha256", secret, rawBody, sig, { prefix })
    );
    if (!signatureValid) {
      return { signatureValid: false, externalId: null, shapedPayload: null, reason: "invalid_signature" };
    }
  } else if (trigger.verify === "shared_secret") {
    if (!secret) return { signatureValid: false, externalId: null, shapedPayload: null, reason: "missing_secret" };
    const sig = getHeader(headers, trigger.signatureHeader) ?? "";
    signatureValid = timingSafeEqualHex(secret, sig);
    if (!signatureValid) {
      return { signatureValid: false, externalId: null, shapedPayload: null, reason: "invalid_secret" };
    }
  }

  // Extract idempotency id
  let externalId: string | null = null;
  if (trigger.externalIdPath) {
    try {
      const v = evalJsonPathFirst(trigger.externalIdPath, parsedBody as JsonValue);
      if (v != null) externalId = typeof v === "string" ? v : JSON.stringify(v);
    } catch { /* ignore path errors */ }
  }

  // Shape the payload via the manifest's output mapping
  let shapedPayload: unknown = parsedBody;
  try {
    shapedPayload = selectAndMap(trigger.output.select ?? "$", trigger.output.map, parsedBody as JsonValue);
  } catch { /* fall back to raw body */ }

  return { signatureValid, externalId, shapedPayload };
}
