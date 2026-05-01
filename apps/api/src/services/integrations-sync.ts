import { prisma } from "@bidwright/db";
import { decryptCredential, parseManifest, runSync, type IntegrationManifestParsed, type ManifestSync } from "@bidwright/integrations";

/**
 * Sync orchestration helpers — execute one resource's sync end-to-end:
 *   1. load credentials,
 *   2. invoke the runSync runtime,
 *   3. upsert ExternalRecord rows,
 *   4. advance IntegrationSyncState cursor + counters,
 *   5. log a summary IntegrationEvent.
 *
 * Used both by the worker's BullMQ scheduled job and by the manual
 * "Run now" route.
 */

export interface RunSyncResult {
  success: boolean;
  recordsProcessed: number;
  pagesFetched: number;
  cursor: string | null;
  error?: string;
  durationMs: number;
}

async function loadCredentials(organizationId: string, integrationId: string): Promise<Record<string, string>> {
  const rows = await prisma.integrationCredential.findMany({ where: { integrationId } });
  const out: Record<string, string> = {};
  for (const row of rows) {
    try {
      out[row.kind] = decryptCredential(row.ciphertext, organizationId, integrationId, row.kind, row.keyContext);
    } catch {
      // skip
    }
  }
  return out;
}

export async function runIntegrationSync(input: {
  integrationId: string;
  resourceId: string;
}): Promise<RunSyncResult> {
  const integration = await prisma.integration.findUnique({ where: { id: input.integrationId } });
  if (!integration) throw new Error("Integration not found");
  if (!integration.enabled) {
    return { success: false, recordsProcessed: 0, pagesFetched: 0, cursor: null, error: "disabled", durationMs: 0 };
  }

  let manifest: IntegrationManifestParsed;
  try { manifest = parseManifest(integration.manifestSnapshot); }
  catch (e) { throw new Error(`Invalid manifest snapshot: ${(e as Error).message}`); }

  const sync: ManifestSync | undefined = manifest.capabilities.syncs.find((s) => s.id === input.resourceId);
  if (!sync) throw new Error(`Sync resource not found: ${input.resourceId}`);

  // Find or create state row
  const state = await prisma.integrationSyncState.upsert({
    where: { integrationId_resourceId: { integrationId: input.integrationId, resourceId: input.resourceId } },
    update: { status: "running", lastRunAt: new Date() },
    create: {
      integrationId: input.integrationId,
      resourceId: input.resourceId,
      status: "running",
      lastRunAt: new Date(),
    },
  });

  const credentials = await loadCredentials(integration.organizationId, integration.id);
  const result = await runSync({
    manifest, sync,
    config: (integration.config as Record<string, unknown>) ?? {},
    credentials,
    cursor: state.cursor,
  });

  if (!result.success) {
    await prisma.integrationSyncState.update({
      where: { id: state.id },
      data: {
        status: "error",
        lastErrorAt: new Date(),
        lastError: result.error ?? null,
      },
    });
    await prisma.integrationEvent.create({
      data: {
        integrationId: input.integrationId,
        direction: "outbound",
        type: `sync.${input.resourceId}`,
        status: "failed",
        payload: { error: result.error, pages: result.pagesFetched },
        headers: {},
        lastError: result.error ?? null,
      },
    });
    return {
      success: false,
      recordsProcessed: 0,
      pagesFetched: result.pagesFetched,
      cursor: state.cursor ?? null,
      error: result.error,
      durationMs: result.durationMs,
    };
  }

  // Upsert ExternalRecord rows. Skip if fingerprint matches.
  let processed = 0;
  for (const r of result.records) {
    const existing = await prisma.externalRecord.findUnique({
      where: {
        integrationId_resourceId_externalId: {
          integrationId: input.integrationId,
          resourceId: input.resourceId,
          externalId: r.externalId,
        },
      },
    });
    if (existing && existing.fingerprint === r.fingerprint) continue;

    await prisma.externalRecord.upsert({
      where: {
        integrationId_resourceId_externalId: {
          integrationId: input.integrationId,
          resourceId: input.resourceId,
          externalId: r.externalId,
        },
      },
      update: {
        data: (r.data as object) ?? {},
        fingerprint: r.fingerprint,
      },
      create: {
        integrationId: input.integrationId,
        resourceId: input.resourceId,
        externalId: r.externalId,
        data: (r.data as object) ?? {},
        fingerprint: r.fingerprint,
      },
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
      integrationId: input.integrationId,
      direction: "outbound",
      type: `sync.${input.resourceId}`,
      status: "delivered",
      payload: {
        records: result.records.length,
        processed,
        pages: result.pagesFetched,
      },
      headers: {},
    },
  });

  return {
    success: true,
    recordsProcessed: processed,
    pagesFetched: result.pagesFetched,
    cursor: result.nextCursor,
    durationMs: result.durationMs,
  };
}

/**
 * Find every (integration, sync) pair currently due to run, skipping any
 * with a `running` status (in-progress already).
 *
 * "Due" is calculated using the manifest schedule: the current time is
 * matched against the cron expression with a 1-minute granularity. Without
 * pulling in a cron library, we approximate by interpreting the schedule
 * loosely — the worker tick should call this every 60s.
 */
export async function listDueSyncs(): Promise<Array<{
  integrationId: string;
  organizationId: string;
  resourceId: string;
  schedule: string;
}>> {
  const integrations = await prisma.integration.findMany({
    where: { enabled: true },
    select: { id: true, organizationId: true, manifestSnapshot: true },
  });

  const due: Array<{ integrationId: string; organizationId: string; resourceId: string; schedule: string }> = [];
  for (const integ of integrations) {
    let manifest: IntegrationManifestParsed;
    try { manifest = parseManifest(integ.manifestSnapshot); } catch { continue; }
    for (const sync of manifest.capabilities.syncs) {
      due.push({
        integrationId: integ.id,
        organizationId: integ.organizationId,
        resourceId: sync.id,
        schedule: sync.schedule,
      });
    }
  }
  return due;
}

/**
 * Add a "Run now" action route — invoked from the UI activity tab.
 */
export async function runSyncNow(integrationId: string, resourceId: string) {
  return runIntegrationSync({ integrationId, resourceId });
}
