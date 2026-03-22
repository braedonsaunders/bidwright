import { createBidwrightWorkerRuntime } from './runtime.js';

export * from './orchestrator.js';
export * from './runtime.js';

async function main(): Promise<void> {
  const [zipPath, packageName = 'Bidwright customer package'] = process.argv.slice(2);

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  let redisConnection: any = undefined;
  try {
    const IORedis = (await import('ioredis')).default;
    redisConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  } catch {
    // ioredis not available — run without BullMQ
  }

  const runtime = createBidwrightWorkerRuntime(
    {},
    {
      llmProvider: process.env.LLM_PROVIDER ?? 'anthropic',
      llmApiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY,
      llmModel: process.env.LLM_MODEL,
      redisConnection,
    },
  );

  // If a zip path is given, run a one-off ingestion
  if (zipPath) {
    const report = await runtime.ingestPackage({
      packageName,
      zipInput: zipPath,
      sourceKind: 'project',
    });

    console.log(
      JSON.stringify(
        {
          packageId: report.packageId,
          packageName: report.packageName,
          documentCount: report.documents.length,
          chunkCount: report.chunks.length,
          unknownFiles: report.unknownFiles,
        },
        null,
        2,
      ),
    );
    if (redisConnection) await redisConnection.quit();
    return;
  }

  // Start as a long-running BullMQ worker process
  if (runtime.startWorkers) {
    runtime.startWorkers();
    console.log('[worker] Bidwright worker runtime started. Waiting for jobs...');
  } else {
    console.log('Bidwright worker runtime ready (no BullMQ).');
    console.log('Registered tasks: summarize-package, draft-phases, draft-worksheet, draft-equipment, quote-qa');
    return;
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[worker] Shutting down...');
    if (runtime.stopWorkers) await runtime.stopWorkers();
    if (redisConnection) await redisConnection.quit();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main().catch((error: unknown) => {
  console.error('Bidwright worker failed', error);
  process.exit(1);
});
