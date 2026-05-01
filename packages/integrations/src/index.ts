// ── Manifest schema + types ───────────────────────────────────────────────
export {
  integrationManifestSchema,
  parseManifest,
  safeParseManifest,
  type IntegrationManifest,
  type IntegrationManifestParsed,
  type ManifestAuth,
  type ManifestAction,
  type ManifestTrigger,
  type ManifestSync,
  type ManifestRequest,
  type ManifestConnection,
  type ManifestField,
} from "./manifest/schema.js";

// ── Built-in manifests ────────────────────────────────────────────────────
export {
  builtinManifests,
  findBuiltinManifest,
  listBuiltinManifestSummaries,
  genericRestManifest,
  webhookOutManifest,
  webhookInManifest,
  hubspotManifest,
  slackManifest,
  microsoft365Manifest,
  quickbooksManifest,
  procoreManifest,
  salesforceManifest,
  googleWorkspaceManifest,
  netsuiteManifest,
  sftpCsvManifest,
} from "./manifests/index.js";

// ── Crypto + credential helpers ───────────────────────────────────────────
export {
  encryptForOrg,
  decryptForOrg,
  maskSecret,
  hmacSign,
  hmacVerify,
  timingSafeEqualHex,
  IntegrationCryptoError,
  type CryptoEnv,
} from "./crypto.js";

export {
  buildKeyContext,
  encryptCredential,
  decryptCredential,
} from "./credentials.js";

// ── Auth strategies ───────────────────────────────────────────────────────
export {
  applyAuth,
  AuthError,
  type OutboundRequest,
  type AuthApplyContext,
} from "./auth/index.js";

export {
  buildAuthUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  clientCredentialsToken,
  generatePkcePair,
  generateState,
  type OAuth2Tokens,
  type OAuth2ClientCreds,
  type BuildAuthUrlOptions,
  type BuildAuthUrlResult,
  type ExchangeCodeOptions,
  type RefreshTokenOptions,
  type ClientCredentialsOptions,
} from "./auth/oauth2.js";

// ── Runtime ───────────────────────────────────────────────────────────────
export { runAction, type RunActionInput, type RunActionOutput } from "./runtime/action-runner.js";
export { testConnection, type TestConnectionInput, type TestConnectionOutput } from "./runtime/connection-test.js";
export { verifyWebhook, type VerifyWebhookInput, type VerifyWebhookOutput } from "./runtime/webhook-verify.js";
export { runSync, type RunSyncInput, type RunSyncOutput, type SyncRecord } from "./runtime/sync-runner.js";
export { renderString, renderDeep, resolveExpr, type TemplateContext } from "./runtime/template.js";
export { evalJsonPath, evalJsonPathFirst, applyMap, selectAndMap, type JsonValue } from "./runtime/jsonpath.js";
