import { apiRequest } from "./client";

// ── Types mirroring `apps/api/src/services/integrations-service.ts` ──────

export interface ManifestSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  vendor: string;
  icon?: string;
  tags: string[];
  version: string;
  authType: string;
  source: "builtin";
  capabilities: { actions: number; triggers: number; syncs: number };
}

export interface IntegrationSummary {
  id: string;
  manifestId: string;
  manifestVersion: string;
  manifestSource: string;
  slug: string;
  displayName: string;
  description: string;
  category: string;
  icon: string | null;
  status: string;
  enabled: boolean;
  lastError: string | null;
  lastTestedAt: string | null;
  lastConnectedAt: string | null;
  exposeToAgent: boolean;
  exposeToMcp: boolean;
  capabilities: { actions: number; triggers: number; syncs: number };
  createdAt: string;
  updatedAt: string;
}

export interface ManifestField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  default?: unknown;
  options?: Array<{ value: string; label: string }>;
  visibleIf?: { key: string; equals: unknown };
  credentialKind?: string;
  min?: number;
  max?: number;
  pattern?: string;
}

export interface ManifestActionDescriptor {
  id: string;
  name: string;
  description: string;
  llmDescription?: string;
  input: Array<{ name: string; type: string; description: string; required: boolean; enum?: string[]; default?: unknown }>;
  mutates: boolean;
  requiresConfirmation: boolean;
  tags: string[];
}

export interface IntegrationManifest {
  id: string;
  version: string;
  name: string;
  description: string;
  category: string;
  vendor: string;
  icon?: string;
  tags: string[];
  source: string;
  connection: {
    baseUrl?: string;
    auth: { type: string } & Record<string, unknown>;
    fields: ManifestField[];
    test?: { method: string; path: string; expectStatus: number[] };
    allowedHosts: string[];
  };
  capabilities: {
    actions: ManifestActionDescriptor[];
    triggers: Array<{ id: string; name: string; description: string; verify: string; signatureHeader: string }>;
    syncs: Array<{ id: string; name: string; description: string; direction: string; schedule: string; target: string | null }>;
  };
  ui: { sections: Array<{ id: string; title?: string; description?: string; fields: ManifestField[] }> };
}

export interface IntegrationDetail {
  integration: IntegrationSummary & { config: Record<string, unknown> };
  manifest: IntegrationManifest;
  credentials: Array<{ kind: string; masked: string }>;
  webhookUrl: string;
}

export interface IntegrationEvent {
  id: string;
  integrationId: string;
  direction: "inbound" | "outbound";
  type: string;
  status: string;
  payload: unknown;
  signatureValid: boolean | null;
  externalId: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
}

export interface IntegrationRun {
  id: string;
  integrationId: string;
  actionId: string;
  status: string;
  invokedBy: string;
  input: unknown;
  output: unknown;
  error: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
}

// ── API calls ────────────────────────────────────────────────────────────

export async function listManifests() {
  return apiRequest<{ manifests: ManifestSummary[] }>("/integrations/manifests");
}

export async function getManifest(manifestId: string) {
  return apiRequest<IntegrationManifest>(`/integrations/manifests/${manifestId}`);
}

export async function listIntegrations() {
  return apiRequest<{ integrations: IntegrationSummary[] }>("/integrations");
}

export async function getIntegration(id: string) {
  return apiRequest<IntegrationDetail>(`/integrations/${id}`);
}

export async function installIntegration(input: {
  manifestId: string;
  manifestSource?: "builtin" | "community" | "custom";
  customManifest?: unknown;
  slug?: string;
  displayName?: string;
  description?: string;
  config?: Record<string, unknown>;
  exposeToAgent?: boolean;
  exposeToMcp?: boolean;
}) {
  return apiRequest<IntegrationSummary>("/integrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateIntegration(id: string, patch: Partial<IntegrationSummary> & { config?: Record<string, unknown> }) {
  return apiRequest<IntegrationSummary>(`/integrations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function uninstallIntegration(id: string) {
  return apiRequest<{ deleted: boolean }>(`/integrations/${id}`, { method: "DELETE" });
}

export async function setIntegrationCredential(id: string, input: {
  kind: string;
  value: string;
  meta?: Record<string, unknown>;
  expiresAt?: string | null;
  refreshAfter?: string | null;
}) {
  return apiRequest<{ ok: true; masked: string }>(`/integrations/${id}/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteIntegrationCredential(id: string, kind: string) {
  return apiRequest<{ deleted: boolean }>(
    `/integrations/${id}/credentials/${encodeURIComponent(kind)}`,
    { method: "DELETE" },
  );
}

export async function testIntegration(id: string) {
  return apiRequest<{ success: boolean; message: string; httpStatus?: number; durationMs: number }>(
    `/integrations/${id}/test`,
    { method: "POST" },
  );
}

export async function invokeIntegrationAction(id: string, actionId: string, input: Record<string, unknown>, idempotencyKey?: string) {
  return apiRequest<{
    runId: string; success: boolean; output?: unknown; error?: string; httpStatus?: number; durationMs: number; attempts: number;
  }>(`/integrations/${id}/actions/${actionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, ...(idempotencyKey ? { idempotencyKey } : {}) }),
  });
}

export async function listIntegrationEvents(id: string) {
  return apiRequest<{ events: IntegrationEvent[] }>(`/integrations/${id}/events`);
}

export async function listIntegrationRuns(id: string) {
  return apiRequest<{ runs: IntegrationRun[] }>(`/integrations/${id}/runs`);
}

export async function generateManifestFromOpenAPI(input: {
  spec?: unknown;
  specUrl?: string;
  manifestId?: string;
  vendor?: string;
  baseUrlOverride?: string;
}) {
  return apiRequest<{ manifest: IntegrationManifest }>("/integrations/manifests/from-openapi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function beginIntegrationOAuth(
  id: string,
  input: { redirectUri: string; clientId: string; clientSecret: string },
) {
  return apiRequest<{ url: string; state: string }>(`/integrations/${id}/oauth/begin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
