/**
 * Docker-compose maps credential env vars with empty-string defaults
 * (`ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY:-}"`), so a container whose host
 * has no key still carries a SET-but-empty variable. Our own `||` fallback
 * chains treat that as unset, but spawned agent CLIs check for presence:
 * Claude Code sees a set ANTHROPIC_API_KEY and reports "claude.ai connectors
 * are disabled because ANTHROPIC_API_KEY or another auth source is set",
 * shadowing the user's claude.ai OAuth login even though the value is blank.
 *
 * Strip blank credential values from any env destined for a spawned agent.
 * Non-blank values pass through untouched — a real key configured at the
 * deployment level still wins, matching the documented CLI auth precedence.
 */
const CREDENTIAL_ENV_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
]);

export function stripBlankCredentialEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (CREDENTIAL_ENV_KEYS.has(key) && value.trim() === "") continue;
    out[key] = value;
  }
  return out;
}
