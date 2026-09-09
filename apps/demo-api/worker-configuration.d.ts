interface Env {
  BIDWRIGHT_API: DurableObjectNamespace;
  DATABASE_URL?: string;
  DEMO_ALLOWED_ORIGINS?: string;
  INTEGRATIONS_ENCRYPTION_KEY?: string;
  /** Optional. When set, the container verifies the key against it. */
  INTEGRATIONS_ENCRYPTION_KEY_PROBE?: string;
}
