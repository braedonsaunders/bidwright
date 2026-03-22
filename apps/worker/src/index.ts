import { createBidwrightWorkerRuntime } from './runtime.js';

export * from './orchestrator.js';
export * from './runtime.js';

const runtime = createBidwrightWorkerRuntime();

async function main(): Promise<void> {
  const [zipPath, packageName = 'Bidwright customer package'] = process.argv.slice(2);

  if (!zipPath) {
    console.log('Bidwright worker runtime ready.');
    console.log('Registered tasks: summarize-package, draft-phases, draft-worksheet, draft-equipment, quote-qa');
    return;
  }

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
}

void main().catch((error: unknown) => {
  console.error('Bidwright worker failed', error);
  process.exit(1);
});
