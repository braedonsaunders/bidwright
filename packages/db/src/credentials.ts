/**
 * Per-user credential overrides.
 *
 * Bidwright stores integration credentials in two places:
 *   • OrganizationSettings.integrations — org-wide defaults set by an admin
 *     (e.g. a shared Anthropic API key that bills to the company card).
 *   • UserSettings.integrations          — per-user overrides set by the user
 *     (e.g. their personal Claude Pro OAuth token, or a personal Anthropic
 *     API key for testing).
 *
 * Both are JSON blobs whose keys match the existing integration field names
 * (`anthropicKey`, `openaiKey`, `geminiKey`, `openrouterKey`, …). OAuth tokens
 * for CLI subscription auth are nested objects keyed by `<provider>Oauth`,
 * e.g. `anthropicOauth = { accessToken, refreshToken, expiresAt }`.
 *
 * Resolution order, lowest priority first:
 *   1. Process env (`ANTHROPIC_API_KEY`, …) — handled by the existing call
 *      sites; this module is concerned with merging the two DB layers only.
 *   2. OrganizationSettings.integrations
 *   3. UserSettings.integrations  ← wins where the user has set a value
 *
 * The merge intentionally treats empty strings, `null`, `undefined`, and the
 * empty object `{}` as "user has not set this", so org defaults still apply
 * when a user clears their personal override in the UI.
 */

export type IntegrationsBlob = Record<string, unknown>;

function isMeaningfullySet(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return false;
    return entries.some(([, v]) => isMeaningfullySet(v));
  }
  return true;
}

/**
 * Shallow-merge a user's integration overrides onto org defaults. Keys whose
 * user value is "not meaningfully set" (empty string / null / `{}`) fall
 * through to the org value. Returns a fresh object — neither input is
 * mutated.
 */
export function mergeIntegrations(
  org: IntegrationsBlob | null | undefined,
  user: IntegrationsBlob | null | undefined,
): IntegrationsBlob {
  const merged: IntegrationsBlob = { ...(org ?? {}) };
  if (!user) return merged;
  for (const [key, value] of Object.entries(user)) {
    if (!isMeaningfullySet(value)) continue;
    merged[key] = value;
  }
  return merged;
}

/**
 * OAuth credential resolved from a (merged) integrations blob, ready to be
 * materialized as `~/.claude/.credentials.json` etc. inside a CLI namespace.
 */
export interface OauthCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

/** Read an OAuth block out of a merged integrations blob, if present. */
export function readOauthCredential(
  integrations: IntegrationsBlob,
  provider: "anthropic" | "openai" | "google",
): OauthCredential | undefined {
  const key =
    provider === "anthropic"
      ? "anthropicOauth"
      : provider === "openai"
        ? "openaiOauth"
        : "googleOauth";
  const value = integrations[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const accessToken = typeof record.accessToken === "string" ? record.accessToken : undefined;
  if (!accessToken) return undefined;
  const refreshToken = typeof record.refreshToken === "string" ? record.refreshToken : undefined;
  const expiresAt = typeof record.expiresAt === "string" ? record.expiresAt : undefined;
  return { accessToken, refreshToken, expiresAt };
}

/** Read a flat API key out of a merged integrations blob, if present. */
export function readApiKey(
  integrations: IntegrationsBlob,
  provider: "anthropic" | "openai" | "google" | "openrouter",
): string | undefined {
  const key =
    provider === "anthropic"
      ? "anthropicKey"
      : provider === "openai"
        ? "openaiKey"
        : provider === "google"
          ? "geminiKey"
          : "openrouterKey";
  const value = integrations[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Provider API key plausibility rules.
 *
 * Users paste passwords or random text into the "API key" fields (password
 * managers autofill them), and a stored junk "key" silently outranks working
 * OAuth credentials all the way down the credential chain — observed in
 * prod: `anthropicKey: "22Boswell"` made every agent session fail with a
 * 401 while the status pill claimed "Auth: API key".
 *
 * Prefixes for Anthropic / OpenAI / OpenRouter keys are documented and
 * stable. For Google we only reject values that cannot be any credential
 * (too short, or containing whitespace) since key shapes vary more.
 */
const PROVIDER_KEY_RULES: Record<string, { hint: string; valid: (v: string) => boolean }> = {
  anthropicKey: {
    hint: 'Anthropic API keys start with "sk-ant-"',
    valid: (v) => v.startsWith("sk-ant-"),
  },
  openaiKey: {
    hint: 'OpenAI API keys start with "sk-"',
    valid: (v) => v.startsWith("sk-"),
  },
  openrouterKey: {
    hint: 'OpenRouter API keys start with "sk-or-"',
    valid: (v) => v.startsWith("sk-or-"),
  },
  geminiKey: {
    hint: "Google AI API keys are at least 20 characters with no spaces",
    valid: (v) => v.length >= 20 && !/\s/.test(v),
  },
};

/**
 * Save-time validation: return one problem per provider-key field whose
 * (non-empty) value cannot be a real key. Empty/absent values are fine —
 * they mean "unset".
 */
export function invalidProviderKeys(
  integrations: IntegrationsBlob | null | undefined,
): Array<{ field: string; hint: string }> {
  const problems: Array<{ field: string; hint: string }> = [];
  if (!integrations) return problems;
  for (const [field, rule] of Object.entries(PROVIDER_KEY_RULES)) {
    const value = integrations[field];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (!rule.valid(trimmed)) problems.push({ field, hint: rule.hint });
  }
  return problems;
}

/**
 * Read-time defense for rows written before save-time validation existed:
 * return a copy of the blob with implausible provider-key values removed,
 * so junk can never reach checkAuth / spawn / model calls.
 */
export function dropInvalidProviderKeys(integrations: IntegrationsBlob): IntegrationsBlob {
  const cleaned: IntegrationsBlob = { ...integrations };
  for (const { field } of invalidProviderKeys(integrations)) {
    delete cleaned[field];
  }
  return cleaned;
}
