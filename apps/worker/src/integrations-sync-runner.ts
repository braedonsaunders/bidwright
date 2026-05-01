import { prisma } from "@bidwright/db";
import {
  decryptCredential, parseManifest, runSync,
  type IntegrationManifestParsed, type ManifestSync,
} from "@bidwright/integrations";

/**
 * Worker-side mirror of `apps/api/src/services/integrations-sync.ts`.
 *
 * Duplicated intentionally — the worker package cannot import from the
 * API package today (and shouldn't, since they deploy separately). The
 * integrations runtime + Prisma client are the shared substrate.
 *
 * If the worker is run with a Redis connection, the BullMQ "integration-syncs"
 * queue receives one job per due sync per tick. Each job calls
 * `runIntegrationSyncWorker(integrationId, resourceId)`.
 */

async function loadCredentials(organizationId: string, integrationId: string): Promise<Record<string, string>> {
  const rows = await prisma.integrationCredential.findMany({ where: { integrationId } });
  const out: Record<string, string> = {};
  for (const row of rows) {
    try {
      out[row.kind] = decryptCredential(row.ciphertext, organizationId, integrationId, row.kind, row.keyContext);
    } catch { /* skip */ }
  }
  return out;
}

export async function runIntegrationSyncWorker(integrationId: string, resourceId: string): Promise<void> {
  const integration = await prisma.integration.findUnique({ where: { id: integrationId } });
  if (!integration || !integration.enabled) return;

  let manifest: IntegrationManifestParsed;
  try { manifest = parseManifest(integration.manifestSnapshot); }
  catch { return; }

  const sync: ManifestSync | undefined = manifest.capabilities.syncs.find((s) => s.id === resourceId);
  if (!sync) return;

  const state = await prisma.integrationSyncState.upsert({
    where: { integrationId_resourceId: { integrationId, resourceId } },
    update: { status: "running", lastRunAt: new Date() },
    create: { integrationId, resourceId, status: "running", lastRunAt: new Date() },
  });

  const credentials = await loadCredentials(integration.organizationId, integrationId);
  const result = await runSync({
    manifest, sync,
    config: (integration.config as Record<string, unknown>) ?? {},
    credentials,
    cursor: state.cursor,
  });

  if (!result.success) {
    await prisma.integrationSyncState.update({
      where: { id: state.id },
      data: { status: "error", lastErrorAt: new Date(), lastError: result.error ?? null },
    });
    await prisma.integrationEvent.create({
      data: {
        integrationId, direction: "outbound",
        type: `sync.${resourceId}`, status: "failed",
        payload: { error: result.error, pages: result.pagesFetched },
        headers: {}, lastError: result.error ?? null,
      },
    });
    return;
  }

  let processed = 0;
  for (const r of result.records) {
    const existing = await prisma.externalRecord.findUnique({
      where: {
        integrationId_resourceId_externalId: { integrationId, resourceId, externalId: r.externalId },
      },
    });
    if (existing && existing.fingerprint === r.fingerprint) continue;
    await prisma.externalRecord.upsert({
      where: { integrationId_resourceId_externalId: { integrationId, resourceId, externalId: r.externalId } },
      update: { data: (r.data as object) ?? {}, fingerprint: r.fingerprint },
      create: { integrationId, resourceId, externalId: r.externalId, data: (r.data as object) ?? {}, fingerprint: r.fingerprint },
    });
    processed++;
  }

  await prisma.integrationSyncState.update({
    where: { id: state.id },
    data: {
      status: "idle",
      cursor: result.nextCursor,
      lastSuccessAt: new Date(),
      recordsLast: processed,
      recordsTotal: { increment: processed },
    },
  });

  await prisma.integrationEvent.create({
    data: {
      integrationId, direction: "outbound",
      type: `sync.${resourceId}`, status: "delivered",
      payload: { records: result.records.length, processed, pages: result.pagesFetched },
      headers: {},
    },
  });
}

/**
 * Enumerate every (integration, sync) due to run. The orchestrator schedules
 * one job per pair via repeatable jobs at boot time; this helper is also
 * useful for ad-hoc maintenance scripts.
 */
export async function listAllSyncResources(): Promise<Array<{
  integrationId: string;
  organizationId: string;
  resourceId: string;
  schedule: string;
}>> {
  const rows = await prisma.integration.findMany({
    where: { enabled: true },
    select: { id: true, organizationId: true, manifestSnapshot: true },
  });
  const out: Array<{ integrationId: string; organizationId: string; resourceId: string; schedule: string }> = [];
  for (const row of rows) {
    let manifest: IntegrationManifestParsed;
    try { manifest = parseManifest(row.manifestSnapshot); } catch { continue; }
    for (const s of manifest.capabilities.syncs) {
      if (s.direction === "push") continue; // worker pulls; pushes are user-initiated
      out.push({
        integrationId: row.id,
        organizationId: row.organizationId,
        resourceId: s.id,
        schedule: s.schedule,
      });
    }
  }
  return out;
}
